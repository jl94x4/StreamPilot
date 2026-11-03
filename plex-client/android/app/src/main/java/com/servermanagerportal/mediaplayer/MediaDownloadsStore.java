package com.servermanagerportal.mediaplayer;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

/** JSON index + files under getFilesDir()/downloads. */
final class MediaDownloadsStore {
    private static final String TAG = "MediaDownloadsStore";
    private static final String INDEX_NAME = "index.json";

    private final File root;
    private final File indexFile;
    private JSONObject index = new JSONObject();

    MediaDownloadsStore(Context context) {
        root = new File(context.getFilesDir(), "downloads");
        if (!root.exists() && !root.mkdirs()) {
            Log.w(TAG, "Could not create downloads dir");
        }
        indexFile = new File(root, INDEX_NAME);
        load();
    }

    File rootDir() {
        return root;
    }

    synchronized JSONObject get(String id) {
        return index.optJSONObject(id);
    }

    synchronized List<JSONObject> list() {
        List<JSONObject> out = new ArrayList<>();
        Iterator<String> keys = index.keys();
        while (keys.hasNext()) {
            JSONObject row = index.optJSONObject(keys.next());
            if (row != null) out.add(copy(row));
        }
        out.sort((a, b) -> Long.compare(b.optLong("createdAt", 0), a.optLong("createdAt", 0)));
        return out;
    }

    synchronized JSONObject findByRatingKey(String ratingKey) {
        String key = String.valueOf(ratingKey == null ? "" : ratingKey).trim();
        if (key.isEmpty()) return null;
        Iterator<String> keys = index.keys();
        while (keys.hasNext()) {
            JSONObject row = index.optJSONObject(keys.next());
            if (row != null && key.equals(String.valueOf(row.optString("ratingKey", "")).trim())) {
                return copy(row);
            }
        }
        return null;
    }

    synchronized void put(JSONObject row) {
        if (row == null) return;
        String id = String.valueOf(row.optString("id", "")).trim();
        if (id.isEmpty()) return;
        try {
            index.put(id, copy(row));
            persist();
        } catch (Exception e) {
            Log.w(TAG, "put failed", e);
        }
    }

    synchronized boolean delete(String id) {
        String key = String.valueOf(id == null ? "" : id).trim();
        if (key.isEmpty()) return false;
        JSONObject row = index.optJSONObject(key);
        if (row != null) {
            String path = String.valueOf(row.optString("filePath", "")).trim();
            if (!path.isEmpty()) {
                File file = new File(path);
                if (file.exists() && !file.delete()) {
                    Log.w(TAG, "Could not delete file " + path);
                }
            }
            String thumb = String.valueOf(row.optString("thumbPath", "")).trim();
            if (!thumb.isEmpty()) {
                File thumbFile = new File(thumb);
                if (thumbFile.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    thumbFile.delete();
                }
            }
            index.remove(key);
            persist();
            return true;
        }
        return false;
    }

    File fileFor(String id, String ext) {
        String safeExt = String.valueOf(ext == null ? "bin" : ext).replaceAll("[^a-zA-Z0-9]+", "");
        if (safeExt.isEmpty()) safeExt = "bin";
        return new File(root, id + "." + safeExt);
    }

    private void load() {
        if (!indexFile.exists()) {
            index = new JSONObject();
            return;
        }
        try (FileInputStream in = new FileInputStream(indexFile)) {
            byte[] buf = new byte[(int) Math.min(indexFile.length(), 4_000_000)];
            int n = in.read(buf);
            String raw = n > 0 ? new String(buf, 0, n, StandardCharsets.UTF_8) : "{}";
            JSONObject parsed = new JSONObject(raw);
            // Accept either map-by-id or { items: [...] }
            if (parsed.has("items") && parsed.opt("items") instanceof JSONArray) {
                index = new JSONObject();
                JSONArray items = parsed.optJSONArray("items");
                if (items != null) {
                    for (int i = 0; i < items.length(); i += 1) {
                        JSONObject row = items.optJSONObject(i);
                        if (row == null) continue;
                        String id = String.valueOf(row.optString("id", "")).trim();
                        if (!id.isEmpty()) index.put(id, row);
                    }
                }
            } else {
                index = parsed;
            }
        } catch (Exception e) {
            Log.w(TAG, "load index failed", e);
            index = new JSONObject();
        }
    }

    private void persist() {
        try (FileOutputStream out = new FileOutputStream(indexFile)) {
            out.write(index.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            Log.w(TAG, "persist index failed", e);
        }
    }

    private static JSONObject copy(JSONObject row) {
        try {
            return new JSONObject(row.toString());
        } catch (Exception e) {
            return row;
        }
    }
}
