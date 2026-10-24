package com.servermanagerportal.mediaplayer;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import androidx.annotation.Nullable;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * On-device image cache for Plex artwork, like the official app's: every PMS photo
 * transcode the WebView asks for is kept on disk (LRU, capped), so posters, stills,
 * logos and backdrops come back instantly — across screens and app restarts. The
 * WebView's own HTTP cache is small and shared, and evicted them almost at once.
 */
final class PlexImageCache {
    private static final long MAX_BYTES = 256L * 1024 * 1024;
    private static final long TRIM_TO_BYTES = MAX_BYTES * 8 / 10;
    /** Plex artwork URLs carry the image's update stamp, so this only bounds stale files. */
    private static final long MAX_AGE_MS = 30L * 24 * 60 * 60 * 1000;
    private static final int TRIM_EVERY_WRITES = 40;
    private static final int TIMEOUT_MS = 15_000;

    private final File dir;
    private final AtomicInteger writesSinceTrim = new AtomicInteger();

    PlexImageCache(Context context) {
        dir = new File(context.getCacheDir(), "plex-images");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
    }

    /** Only PMS photo transcodes: everything else (API, playback, app assets) is untouched. */
    boolean handles(@Nullable WebResourceRequest request) {
        if (request == null || !"GET".equalsIgnoreCase(request.getMethod())) return false;
        Uri uri = request.getUrl();
        if (uri == null) return false;
        String scheme = uri.getScheme();
        if (!"https".equals(scheme) && !"http".equals(scheme)) return false;
        String path = uri.getPath();
        return path != null && path.equals("/photo/:/transcode");
    }

    /** Cached file, or download-then-cache. Null lets the WebView load it normally. */
    @Nullable
    WebResourceResponse serve(WebResourceRequest request) {
        try {
            Uri uri = request.getUrl();
            String key = cacheKey(uri);
            File body = new File(dir, key + ".img");
            File type = new File(dir, key + ".type");
            long now = System.currentTimeMillis();
            if (body.isFile() && body.length() > 0 && now - body.lastModified() < MAX_AGE_MS) {
                //noinspection ResultOfMethodCallIgnored
                body.setLastModified(now);
                return response(body, readType(type));
            }
            String mime = download(uri.toString(), request.getRequestHeaders(), body, type);
            if (mime == null) return null;
            if (writesSinceTrim.incrementAndGet() >= TRIM_EVERY_WRITES) {
                writesSinceTrim.set(0);
                trim();
            }
            return response(body, mime);
        } catch (Throwable ignored) {
            return null;
        }
    }

    /**
     * Same image fetched over LAN or remote addresses shares one entry: the plex.direct
     * hash names the server, and the token is not part of what the image is.
     */
    private static String cacheKey(Uri uri) throws Exception {
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.US);
        String server = host;
        if (host.endsWith(".plex.direct")) {
            String[] labels = host.split("\\.");
            if (labels.length >= 3) server = labels[1];
        } else if (uri.getPort() > 0) {
            server = host + ":" + uri.getPort();
        }
        List<String> names = new ArrayList<>(uri.getQueryParameterNames());
        Collections.sort(names);
        StringBuilder raw = new StringBuilder(server).append('|').append(uri.getPath());
        for (String name : names) {
            if (name.toLowerCase(Locale.US).startsWith("x-plex-")) continue;
            raw.append('&').append(name).append('=').append(uri.getQueryParameter(name));
        }
        MessageDigest digest = MessageDigest.getInstance("SHA-1");
        byte[] hash = digest.digest(raw.toString().getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder(hash.length * 2);
        for (byte b : hash) hex.append(String.format(Locale.US, "%02x", b));
        return hex.toString();
    }

    /** Writes the image and its content type; returns the type, or null if it isn't a 200 image. */
    @Nullable
    private String download(String url, @Nullable Map<String, String> headers, File body, File type) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(TIMEOUT_MS);
        conn.setReadTimeout(TIMEOUT_MS);
        conn.setInstanceFollowRedirects(true);
        if (headers != null) {
            for (Map.Entry<String, String> header : headers.entrySet()) {
                String name = header.getKey();
                if (name == null || "range".equalsIgnoreCase(name)) continue;
                conn.setRequestProperty(name, header.getValue());
            }
        }
        try {
            if (conn.getResponseCode() != 200) return null;
            String mime = conn.getContentType();
            if (mime == null || !mime.toLowerCase(Locale.US).startsWith("image/")) return null;
            int semi = mime.indexOf(';');
            if (semi > 0) mime = mime.substring(0, semi).trim();
            // Temp + rename: concurrent requests for one image never read a half file.
            File temp = new File(dir, body.getName() + "." + Thread.currentThread().getId() + ".tmp");
            try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(temp)) {
                byte[] buffer = new byte[16 * 1024];
                int read;
                while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
            }
            if (temp.length() == 0 || !temp.renameTo(body)) {
                //noinspection ResultOfMethodCallIgnored
                temp.delete();
                return null;
            }
            try (OutputStream out = new FileOutputStream(type)) {
                out.write(mime.getBytes(StandardCharsets.UTF_8));
            }
            return mime;
        } finally {
            conn.disconnect();
        }
    }

    private static String readType(File type) {
        try (InputStream in = new FileInputStream(type)) {
            byte[] bytes = new byte[64];
            int read = in.read(bytes);
            if (read > 0) return new String(bytes, 0, read, StandardCharsets.UTF_8).trim();
        } catch (Exception ignored) {
            /* fall through */
        }
        return "image/jpeg";
    }

    private static WebResourceResponse response(File body, String mime) throws Exception {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "max-age=2592000");
        // Lets canvas colour sampling read the art (PMS sends no CORS headers).
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Content-Length", String.valueOf(body.length()));
        return new WebResourceResponse(mime, null, 200, "OK", headers, new FileInputStream(body));
    }

    /** Drop the least recently used files once the cache passes its cap. */
    private void trim() {
        File[] files = dir.listFiles((d, name) -> name.endsWith(".img"));
        if (files == null) return;
        long total = 0;
        for (File file : files) total += file.length();
        if (total <= MAX_BYTES) return;
        Arrays.sort(files, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
        for (File file : files) {
            if (total <= TRIM_TO_BYTES) break;
            total -= file.length();
            String base = file.getName().substring(0, file.getName().length() - 4);
            //noinspection ResultOfMethodCallIgnored
            file.delete();
            //noinspection ResultOfMethodCallIgnored
            new File(dir, base + ".type").delete();
        }
    }
}
