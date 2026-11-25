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
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final ConcurrentHashMap<String, AtomicBoolean> cancelFlags = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Future<?>> running = new ConcurrentHashMap<>();
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    public void load() {
        super.load();
        store = new MediaDownloadsStore(getContext());
        // A download cut off by the app being killed has no thread behind it any more: show it
        // as failed so it can be retried instead of sitting on "Downloading" forever.
        try {
            for (JSONObject row : store.list()) {
                String status = row.optString("status", "");
                if ("downloading".equals(status) || "queued".equals(status)) {
                    row.put("status", "error");
                    row.put("error", "Interrupted when the app closed");
                    store.put(row);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "could not reset interrupted downloads", e);
        }
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
        // Retry of a failed row: keep its id and file so a partly downloaded file carries on.
        String resumeId = String.valueOf(call.getString("resumeId", "")).trim();
        File resumeDest = null;
        if (!resumeId.isEmpty()) {
            JSONObject prior = store.get(resumeId);
            String priorStatus = prior == null ? "" : prior.optString("status", "");
            String priorPath = prior == null ? "" : prior.optString("filePath", "");
            if (prior != null && !priorPath.isEmpty() && !"complete".equals(priorStatus)
                && !"downloading".equals(priorStatus) && !"queued".equals(priorStatus)) {
                id = resumeId;
                resumeDest = new File(priorPath);
            }
        }
        String title = String.valueOf(call.getString("title", "Download")).trim();
        if (title.isEmpty()) title = "Download";
        String type = String.valueOf(call.getString("type", "movie")).trim();
        String serverId = String.valueOf(call.getString("serverId", "")).trim();
        String plexGuid = String.valueOf(call.getString("plexGuid", "")).trim();
        String fileName = String.valueOf(call.getString("fileName", "")).trim();
        String thumbUrl = String.valueOf(call.getString("thumbUrl", "")).trim();
        String meta = String.valueOf(call.getString("meta", "")).trim();
        long expectedBytes = 0;
        try {
            Double bytes = call.getDouble("bytes", 0d);
            if (bytes != null && bytes > 0) expectedBytes = bytes.longValue();
        } catch (Throwable ignored) { android.util.Log.w("SPSwallowed", "MediaDownloadsPlugin:152" + " " + ignored.getClass().getSimpleName()); }

        String ext = extensionFromFileName(fileName, url);
        File dest = resumeDest != null ? resumeDest : store.fileFor(id, ext);
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
            row.put("meta", meta);
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
        final String runId = id;
        final File runDest = dest;
        Future<?> future = executor.submit(() -> runDownload(runId, url, headers, runDest, cancel));
        running.put(id, future);
        keepAlive();

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
            } catch (Exception ignored) { android.util.Log.w("SPSwallowed", "MediaDownloadsPlugin:216" + " " + ignored.getClass().getSimpleName()); }
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

    private static final int MAX_ATTEMPTS = 12;
    private static final long[] BACKOFF_MS = { 2000, 4000, 8000, 15000, 30000 };

    /** A failure worth another attempt (network drop, short read, server hiccup). */
    private static class RetryableException extends Exception {
        RetryableException(String message) { super(message); }
    }

    /** A fresh PMS transcode session id each attempt, so a half-started session never clashes. */
    private static String freshSession(String url) {
        if (url.indexOf("/transcode/") < 0) return url;
        String id = "smp-dl-" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
        return url.replaceAll("([?&](?:session|X-Plex-Session-Identifier)=)[^&]*", "$1" + id);
    }

    private void runDownload(String id, String url, JSObject headers, File dest, AtomicBoolean cancel) {
        File partial = new File(dest.getAbsolutePath() + ".part");
        boolean transcode = url.indexOf("/transcode/") >= 0;
        if (transcode && partial.exists()) {
            //noinspection ResultOfMethodCallIgnored
            partial.delete(); // a conversion stream cannot be resumed
        }
        String lastError = "Download failed";
        try {
            updateStatus(id, "downloading", partial.exists() ? partial.length() : 0, -1, "");
            for (int attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
                if (cancel.get() || Thread.currentThread().isInterrupted()) throw new InterruptedException("cancelled");
                try {
                    transferOnce(id, transcode ? freshSession(url) : url, headers, dest, partial, transcode, cancel);
                    return;
                } catch (RetryableException e) {
                    lastError = e.getMessage() == null ? "Download failed" : e.getMessage();
                    Log.w(TAG, "attempt " + (attempt + 1) + " failed: " + lastError);
                    if (transcode && partial.exists()) {
                        //noinspection ResultOfMethodCallIgnored
                        partial.delete();
                    }
                    long wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
                    updateStatus(id, "downloading", partial.exists() ? partial.length() : 0, -1, "Reconnecting… (" + lastError + ")");
                    Thread.sleep(wait);
                }
            }
            throw new RuntimeException(lastError);
        } catch (InterruptedException e) {
            //noinspection ResultOfMethodCallIgnored
            partial.delete();
            //noinspection ResultOfMethodCallIgnored
            dest.delete();
            updateStatus(id, "cancelled", 0, -1, "Cancelled");
            emit("error", statusPayload(id));
        } catch (Exception e) {
            Log.w(TAG, "download failed", e);
            // Keep the partial file: Retry resumes from it.
            long kept = partial.exists() ? partial.length() : 0;
            updateStatus(id, "error", kept, -1, e.getMessage() == null ? "Download failed" : e.getMessage());
            emit("error", statusPayload(id));
        } finally {
            cancelFlags.remove(id);
            running.remove(id);
            keepAlive();
        }
    }

    /** One connection: resumes the .part file with a Range request when it can, and checks the size at the end. */
    private void transferOnce(String id, String url, JSObject headers, File dest, File partial, boolean transcode, AtomicBoolean cancel)
        throws RetryableException, InterruptedException {
        HttpURLConnection conn = null;
        InputStream in = null;
        FileOutputStream out = null;
        try {
            long have = (!transcode && partial.exists()) ? partial.length() : 0;
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(CONNECT_MS);
            conn.setReadTimeout(READ_MS);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("User-Agent", "StreamPilot-MediaPlayer/1.0");
            conn.setRequestProperty("Accept-Encoding", "identity");
            if (headers != null) {
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    Object value = headers.opt(key);
                    if (value != null) conn.setRequestProperty(key, String.valueOf(value));
                }
            }
            if (have > 0) conn.setRequestProperty("Range", "bytes=" + have + "-");
            int code = conn.getResponseCode();
            if (code == 416 && have > 0) {
                // Nothing left to resume from: start the file over.
                //noinspection ResultOfMethodCallIgnored
                partial.delete();
                throw new RetryableException("Restarting download");
            }
            if (code < 200 || code >= 300) {
                String detail = "";
                try {
                    InputStream err = conn.getErrorStream();
                    if (err != null) {
                        byte[] eb = new byte[300];
                        int en = err.read(eb);
                        if (en > 0) detail = new String(eb, 0, en, "UTF-8").replaceAll("<[^>]*>", " ").replaceAll("\\s+", " ").trim();
                        err.close();
                    }
                } catch (Exception ignored) { android.util.Log.w("SPSwallowed", "MediaDownloadsPlugin:375" + " " + ignored.getClass().getSimpleName()); }
                String message = "Download failed (" + code + ")" + (detail.isEmpty() ? "" : ": " + detail);
                boolean transientCode = code >= 500 || code == 408 || code == 429 || code == 423 || (transcode && code == 400);
                if (transientCode) throw new RetryableException(message);
                throw new RuntimeException(message);
            }
            boolean resumed = code == 206 && have > 0;
            if (!resumed) have = 0; // server ignored Range (or none asked): write from the start
            long length = conn.getContentLengthLong();
            long total = length > 0 ? have + length : -1;
            in = new BufferedInputStream(conn.getInputStream());
            out = new FileOutputStream(partial, resumed);
            byte[] buf = new byte[64 * 1024];
            long written = have;
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
                    updateStatus(id, "downloading", written, total, "");
                }
            }
            out.flush();
            out.close();
            out = null;
            if (total > 0 && written < total) {
                throw new RetryableException("Connection dropped at " + (written * 100 / total) + "%");
            }
            if (written <= 0) throw new RetryableException("Server sent no data");
            if (dest.exists() && !dest.delete()) {
                Log.w(TAG, "Could not replace existing file");
            }
            if (!partial.renameTo(dest)) {
                try (FileOutputStream fos = new FileOutputStream(dest);
                     InputStream fis = new BufferedInputStream(new java.io.FileInputStream(partial))) {
                    int c;
                    while ((c = fis.read(buf)) >= 0) fos.write(buf, 0, c);
                } catch (java.io.IOException e) {
                    throw new RetryableException("Could not save the file: " + e.getMessage());
                }
                //noinspection ResultOfMethodCallIgnored
                partial.delete();
            }
            JSONObject row = store.get(id);
            if (row != null) {
                try {
                    row.put("status", "complete");
                    row.put("bytes", dest.length());
                    row.put("totalBytes", dest.length());
                    row.put("filePath", dest.getAbsolutePath());
                    row.put("localUrl", Uri.fromFile(dest).toString());
                    row.put("error", "");
                } catch (Exception ignored) { android.util.Log.w("SPSwallowed", "MediaDownloadsPlugin:433" + " " + ignored.getClass().getSimpleName()); }
                store.put(row);
                emit("complete", toJs(row));
            }
        } catch (RetryableException | InterruptedException e) {
            throw e;
        } catch (java.io.IOException e) {
            throw new RetryableException(e.getMessage() == null ? "Network error" : e.getMessage());
        } finally {
            try { if (out != null) out.close(); } catch (Exception ignored) { /* ignore */ }
            try { if (in != null) in.close(); } catch (Exception ignored) { /* ignore */ }
            if (conn != null) conn.disconnect();
        }
    }

    /** Foreground service while any download runs, so Android keeps the app alive in the background. */
    private void keepAlive() {
        try {
            int active = running.size();
            if (active <= 0) {
                MediaDownloadService.hide(getContext());
                return;
            }
            MediaDownloadService.show(getContext(), active == 1 ? "Downloading 1 title" : "Downloading " + active + " titles");
            if (android.os.Build.VERSION.SDK_INT >= 33 && getActivity() != null
                && getContext().checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                getActivity().requestPermissions(new String[] { android.Manifest.permission.POST_NOTIFICATIONS }, 4211);
            }
        } catch (Throwable t) {
            Log.w(TAG, "keepAlive failed", t);
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
        } catch (Exception ignored) { android.util.Log.w("SPSwallowed", "MediaDownloadsPlugin:508" + " " + ignored.getClass().getSimpleName()); }
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
