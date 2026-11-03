package com.servermanagerportal.mediaplayer;

import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * In-app offline downloads for phone (Plex-style).
 * Files live under getFilesDir()/downloads — no storage permission required.
 */
@CapacitorPlugin(name = "MediaDownloads")
public class MediaDownloadsPlugin extends Plugin {
    private static final String TAG = "MediaDownloads";
    private static final int CONNECT_MS = 20_000;
    private static final int READ_MS = 60_000;

    private MediaDownloadsStore store;
    private final ExecutorService executor = Executors.newFixedThreadPool(2);
    private final ConcurrentHashMap<String, AtomicBoolean> cancelFlags = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Future<?>> running = new ConcurrentHashMap<>();
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    public void load() {
        super.load();
        store = new MediaDownloadsStore(getContext());
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("value", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void list(PluginCall call) {
        ensureStore();
        JSArray items = new JSArray();
        for (JSONObject row : store.list()) {
            items.put(toJs(row));
        }
        JSObject ret = new JSObject();
        ret.put("items", items);
        call.resolve(ret);
    }

    @PluginMethod
    public void get(PluginCall call) {
        ensureStore();
        String id = call.getString("id", "");
        String ratingKey = call.getString("ratingKey", "");
        JSONObject row = null;
        if (id != null && !id.trim().isEmpty()) row = store.get(id.trim());
        if (row == null && ratingKey != null && !ratingKey.trim().isEmpty()) {
            row = store.findByRatingKey(ratingKey.trim());
        }
        JSObject ret = new JSObject();
        ret.put("item", row == null ? null : toJs(row));
        call.resolve(ret);
    }

    @PluginMethod
    public void start(PluginCall call) {
        ensureStore();
        String url = String.valueOf(call.getString("url", "")).trim();
        if (url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        String ratingKey = String.valueOf(call.getString("ratingKey", "")).trim();
        if (ratingKey.isEmpty()) {
            call.reject("ratingKey is required");
            return;
        }

        JSONObject existing = store.findByRatingKey(ratingKey);
        if (existing != null) {
            String status = String.valueOf(existing.optString("status", ""));
            if ("complete".equals(status) || "downloading".equals(status) || "queued".equals(status)) {
                JSObject ret = new JSObject();
                ret.put("item", toJs(existing));
                call.resolve(ret);
                return;
            }
        }

        String id = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        String title = String.valueOf(call.getString("title", "Download")).trim();
        if (title.isEmpty()) title = "Download";
        String type = String.valueOf(call.getString("type", "movie")).trim();
        String serverId = String.valueOf(call.getString("serverId", "")).trim();
        String plexGuid = String.valueOf(call.getString("plexGuid", "")).trim();
        String fileName = String.valueOf(call.getString("fileName", "")).trim();
        String thumbUrl = String.valueOf(call.getString("thumbUrl", "")).trim();
        long expectedBytes = 0;
        try {
            Double bytes = call.getDouble("bytes", 0d);
            if (bytes != null && bytes > 0) expectedBytes = bytes.longValue();
        } catch (Throwable ignored) { /* ignore */ }

        String ext = extensionFromFileName(fileName, url);
        File dest = store.fileFor(id, ext);
        JSObject headers = call.getObject("headers");

        JSONObject row = new JSONObject();
        try {
            row.put("id", id);
            row.put("ratingKey", ratingKey);
            row.put("title", title);
            row.put("type", type);
            row.put("serverId", serverId);
            row.put("plexGuid", plexGuid);
            row.put("fileName", fileName.isEmpty() ? dest.getName() : fileName);
            row.put("filePath", dest.getAbsolutePath());
            row.put("thumbPath", "");
            row.put("thumbUrl", thumbUrl);
            row.put("bytes", 0L);
            row.put("totalBytes", expectedBytes);
            row.put("status", "queued");
            row.put("createdAt", System.currentTimeMillis());
            row.put("error", "");
            row.put("localUrl", Uri.fromFile(dest).toString());
        } catch (Exception e) {
            call.reject("Could not create download entry");
            return;
        }
        store.put(row);

        AtomicBoolean cancel = new AtomicBoolean(false);
        cancelFlags.put(id, cancel);
        Future<?> future = executor.submit(() -> runDownload(id, url, headers, dest, cancel));
        running.put(id, future);

        JSObject ret = new JSObject();
        ret.put("item", toJs(row));
        call.resolve(ret);
        emit("progress", toJs(row));
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        ensureStore();
        String id = String.valueOf(call.getString("id", "")).trim();
        if (id.isEmpty()) {
            call.reject("id is required");
            return;
        }
        AtomicBoolean flag = cancelFlags.get(id);
        if (flag != null) flag.set(true);
        Future<?> future = running.remove(id);
        if (future != null) future.cancel(true);

        JSONObject row = store.get(id);
        if (row != null) {
            try {
                row.put("status", "cancelled");
                store.put(row);
                emit("error", toJs(row));
            } catch (Exception ignored) { /* ignore */ }
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void delete(PluginCall call) {
        ensureStore();
        String id = String.valueOf(call.getString("id", "")).trim();
        String ratingKey = String.valueOf(call.getString("ratingKey", "")).trim();
        if (id.isEmpty() && !ratingKey.isEmpty()) {
            JSONObject row = store.findByRatingKey(ratingKey);
            if (row != null) id = String.valueOf(row.optString("id", "")).trim();
        }
        if (id.isEmpty()) {
            call.reject("id is required");
            return;
        }
        AtomicBoolean flag = cancelFlags.remove(id);
        if (flag != null) flag.set(true);
        Future<?> future = running.remove(id);
        if (future != null) future.cancel(true);
        boolean ok = store.delete(id);
        JSObject ret = new JSObject();
        ret.put("ok", ok);
        call.resolve(ret);
    }

    @PluginMethod
    public void getLocalUrl(PluginCall call) {
        ensureStore();
        String id = String.valueOf(call.getString("id", "")).trim();
        String ratingKey = String.valueOf(call.getString("ratingKey", "")).trim();
        JSONObject row = null;
        if (!id.isEmpty()) row = store.get(id);
        if (row == null && !ratingKey.isEmpty()) row = store.findByRatingKey(ratingKey);
        JSObject ret = new JSObject();
        if (row == null || !"complete".equals(row.optString("status"))) {
            ret.put("url", "");
            call.resolve(ret);
            return;
        }
        String path = String.valueOf(row.optString("filePath", "")).trim();
        File file = path.isEmpty() ? null : new File(path);
        if (file == null || !file.exists()) {
            ret.put("url", "");
            call.resolve(ret);
            return;
        }
        ret.put("url", Uri.fromFile(file).toString());
        ret.put("item", toJs(row));
        call.resolve(ret);
    }

    private void runDownload(String id, String url, JSObject headers, File dest, AtomicBoolean cancel) {
        HttpURLConnection conn = null;
        InputStream in = null;
        FileOutputStream out = null;
        File partial = new File(dest.getAbsolutePath() + ".part");
        try {
            updateStatus(id, "downloading", 0, -1, null);
            URL target = new URL(url);
            conn = (HttpURLConnection) target.openConnection();
            conn.setConnectTimeout(CONNECT_MS);
            conn.setReadTimeout(READ_MS);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("User-Agent", "StreamPilot-MediaPlayer/1.0");
            conn.setRequestProperty("Accept-Encoding", "identity");
            if (headers != null) {
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    Object value = headers.get(key);
                    if (value != null) conn.setRequestProperty(key, String.valueOf(value));
                }
            }
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                throw new RuntimeException("Download failed (" + code + ")");
            }
            long total = conn.getContentLengthLong();
            in = new BufferedInputStream(conn.getInputStream());
            out = new FileOutputStream(partial);
            byte[] buf = new byte[64 * 1024];
            long written = 0;
            long lastEmit = 0;
            int n;
            while ((n = in.read(buf)) >= 0) {
                if (cancel.get() || Thread.currentThread().isInterrupted()) {
                    throw new InterruptedException("cancelled");
                }
                out.write(buf, 0, n);
                written += n;
                long now = System.currentTimeMillis();
                if (now - lastEmit > 400 || (total > 0 && written >= total)) {
                    lastEmit = now;
                    updateStatus(id, "downloading", written, total, null);
                }
            }
            out.flush();
            out.close();
            out = null;
            if (dest.exists() && !dest.delete()) {
                Log.w(TAG, "Could not replace existing file");
            }
            if (!partial.renameTo(dest)) {
                // Fallback copy
                try (FileOutputStream fos = new FileOutputStream(dest);
                     InputStream fis = new BufferedInputStream(new java.io.FileInputStream(partial))) {
                    int c;
                    while ((c = fis.read(buf)) >= 0) fos.write(buf, 0, c);
                }
                //noinspection ResultOfMethodCallIgnored
                partial.delete();
            }
            JSONObject row = store.get(id);
            if (row != null) {
                row.put("status", "complete");
                row.put("bytes", dest.length());
                row.put("totalBytes", dest.length());
                row.put("filePath", dest.getAbsolutePath());
                row.put("localUrl", Uri.fromFile(dest).toString());
                row.put("error", "");
                store.put(row);
                emit("complete", toJs(row));
            }
        } catch (InterruptedException e) {
            //noinspection ResultOfMethodCallIgnored
            partial.delete();
            //noinspection ResultOfMethodCallIgnored
            dest.delete();
            updateStatus(id, "cancelled", 0, -1, "Cancelled");
            emit("error", statusPayload(id));
        } catch (Exception e) {
            Log.w(TAG, "download failed", e);
            //noinspection ResultOfMethodCallIgnored
            partial.delete();
            //noinspection ResultOfMethodCallIgnored
            dest.delete();
            updateStatus(id, "error", 0, -1, e.getMessage() == null ? "Download failed" : e.getMessage());
            emit("error", statusPayload(id));
        } finally {
            cancelFlags.remove(id);
            running.remove(id);
            try { if (out != null) out.close(); } catch (Exception ignored) { /* ignore */ }
            try { if (in != null) in.close(); } catch (Exception ignored) { /* ignore */ }
            if (conn != null) conn.disconnect();
        }
    }

    private void updateStatus(String id, String status, long bytes, long total, String error) {
        JSONObject row = store.get(id);
        if (row == null) return;
        try {
            row.put("status", status);
            if (bytes >= 0) row.put("bytes", bytes);
            if (total >= 0) row.put("totalBytes", total);
            if (error != null) row.put("error", error);
            store.put(row);
            if ("downloading".equals(status) || "queued".equals(status)) {
                emit("progress", toJs(row));
            }
        } catch (Exception e) {
            Log.w(TAG, "updateStatus failed", e);
        }
    }

    private JSObject statusPayload(String id) {
        JSONObject row = store.get(id);
        return row == null ? new JSObject() : toJs(row);
    }

    private void emit(String event, JSObject data) {
        main.post(() -> notifyListeners(event, data == null ? new JSObject() : data));
    }

    private void ensureStore() {
        if (store == null) store = new MediaDownloadsStore(getContext());
    }

    private static String extensionFromFileName(String fileName, String url) {
        String name = fileName == null ? "" : fileName;
        int dot = name.lastIndexOf('.');
        if (dot > 0 && dot < name.length() - 1) {
            return name.substring(dot + 1);
        }
        try {
            String path = Uri.parse(url).getLastPathSegment();
            if (path != null) {
                int d = path.lastIndexOf('.');
                if (d > 0 && d < path.length() - 1) return path.substring(d + 1);
            }
        } catch (Exception ignored) { /* ignore */ }
        return "bin";
    }

    private static JSObject toJs(JSONObject row) {
        JSObject out = new JSObject();
        if (row == null) return out;
        Iterator<String> keys = row.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            Object value = row.opt(key);
            if (value == null || value == JSONObject.NULL) {
                out.put(key, JSONObject.NULL);
            } else if (value instanceof Number || value instanceof Boolean || value instanceof String) {
                out.put(key, value);
            } else {
                out.put(key, String.valueOf(value));
            }
        }
        return out;
    }
}
