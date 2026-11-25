package com.servermanagerportal.mediaplayer;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.os.Handler;
import android.os.Looper;
import android.util.LruCache;
import android.webkit.CookieManager;
import android.widget.ImageView;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Small image loader for the native Home: memory LRU, disk cache, down-sampled decode on a
 * few worker threads. A view is tagged with the URL it wants, so a recycled card never
 * shows a stale picture.
 */
final class NativeHomeImages {
    private static final int TIMEOUT_MS = 12_000;
    private static final long DISK_MAX_BYTES = 256L * 1024 * 1024;

    private final File dir;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService pool = Executors.newFixedThreadPool(3);
    private final LruCache<String, Bitmap> memory;

    private final boolean lowRam;

    NativeHomeImages(Context context) {
        boolean low = false;
        try {
            android.app.ActivityManager am = (android.app.ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
            low = am != null && am.isLowRamDevice();
        } catch (Throwable ignored) { android.util.Log.w("SPSwallowed", "NativeHomeImages:47" + " " + ignored.getClass().getSimpleName()); }
        lowRam = low;
        dir = new File(context.getCacheDir(), "native-home-images");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        long budget = Math.min(96L * 1024 * 1024, Runtime.getRuntime().maxMemory() / 6);
        memory = new LruCache<String, Bitmap>((int) budget) {
            @Override
            protected int sizeOf(String key, Bitmap value) {
                return value.getByteCount();
            }
        };
    }

    interface Done {
        void onBitmap(Bitmap bitmap);
    }

    /** Fill {@code target} with the picture at {@code url}, decoded near {@code reqW} x {@code reqH}. */
    void load(String url, ImageView target, int reqW, int reqH) {
        load(url, target, reqW, reqH, null);
    }

    /** {@code missing} runs (on the main thread) when there is no picture to show: no url, or it failed to load. */
    void load(String url, ImageView target, int reqW, int reqH, Runnable missing) {
        if (url == null || url.isEmpty()) {
            target.setTag(null);
            target.setImageDrawable(null);
            if (missing != null) missing.run();
            return;
        }
        if (url.equals(target.getTag())) return;
        target.setTag(url);
        Bitmap hit = memory.get(url);
        if (hit != null) {
            target.setImageBitmap(hit);
            return;
        }
        target.setImageDrawable(null);
        fetch(url, reqW, reqH, bitmap -> {
            if (!url.equals(target.getTag())) return;
            if (bitmap != null) target.setImageBitmap(bitmap);
            else if (missing != null) missing.run();
        });
    }

    /**
     * A still that may hide a spoiler: when {@code spoiler}, it is shown blurred and a little darker and greyer
     * (the page's blur(18px) saturate(.6) brightness(.8)). The blur is a tiny copy scaled back up, so it works on
     * every Android version. Otherwise the plain picture.
     */
    void loadStill(String url, ImageView target, int reqW, int reqH, boolean spoiler) {
        if (!spoiler) {
            target.clearColorFilter();
            load(url, target, reqW, reqH);
            return;
        }
        ColorMatrix cm = new ColorMatrix();
        cm.setSaturation(0.6f);
        ColorMatrix dim = new ColorMatrix();
        dim.setScale(0.8f, 0.8f, 0.8f, 1f);
        cm.postConcat(dim);
        target.setColorFilter(new ColorMatrixColorFilter(cm));
        if (url == null || url.isEmpty()) {
            load("", target, reqW, reqH);
            return;
        }
        final String tag = "spoiler:" + url;
        if (tag.equals(target.getTag())) return;
        target.setTag(tag);
        target.setImageDrawable(null);
        get(url, reqW, reqH, bitmap -> {
            if (bitmap == null || !tag.equals(target.getTag())) return;
            try {
                Bitmap small = bitmap;
                int w = Math.max(1, bitmap.getWidth());
                int h = Math.max(1, bitmap.getHeight());
                int goalW = 96;
                int goalH = Math.max(1, Math.round(goalW * (float) h / w));
                // Halve towards the goal so the shrink averages the whole picture, then the last step to size.
                while (small.getWidth() > goalW * 2) {
                    Bitmap next = Bitmap.createScaledBitmap(small, Math.max(goalW, small.getWidth() / 2),
                        Math.max(goalH, small.getHeight() / 2), true);
                    if (small != bitmap) small.recycle();
                    small = next;
                }
                Bitmap tiny = Bitmap.createScaledBitmap(small, goalW, goalH, true);
                if (small != bitmap && small != tiny) small.recycle();
                target.setImageBitmap(softBlur(tiny));
            } catch (Throwable ignored) { android.util.Log.w("SPSwallowed", "NativeHomeImages:138" + " " + ignored.getClass().getSimpleName()); }
        });
    }

    /** A few box-blur passes over a small bitmap: smooth, with no visible pixel grid when it is scaled back up. */
    private static Bitmap softBlur(Bitmap src) {
        final int w = src.getWidth();
        final int h = src.getHeight();
        final int radius = 5;
        int[] a = new int[w * h];
        int[] b = new int[w * h];
        src.getPixels(a, 0, w, 0, 0, w, h);
        for (int pass = 0; pass < 3; pass++) {
            boxPass(a, b, w, h, radius, true);
            boxPass(b, a, w, h, radius, false);
        }
        Bitmap out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        out.setPixels(a, 0, w, 0, 0, w, h);
        return out;
    }

    private static void boxPass(int[] in, int[] out, int w, int h, int r, boolean horizontal) {
        final int len = horizontal ? w : h;
        final int lines = horizontal ? h : w;
        final int div = r * 2 + 1;
        for (int line = 0; line < lines; line++) {
            int sr = 0, sg = 0, sb = 0;
            for (int i = -r; i <= r; i++) {
                int c = in[idx(Math.max(0, Math.min(len - 1, i)), line, w, horizontal)];
                sr += (c >> 16) & 255;
                sg += (c >> 8) & 255;
                sb += c & 255;
            }
            for (int i = 0; i < len; i++) {
                out[idx(i, line, w, horizontal)] = 0xFF000000 | ((sr / div) << 16) | ((sg / div) << 8) | (sb / div);
                int add = in[idx(Math.min(len - 1, i + r + 1), line, w, horizontal)];
                int sub = in[idx(Math.max(0, i - r), line, w, horizontal)];
                sr += ((add >> 16) & 255) - ((sub >> 16) & 255);
                sg += ((add >> 8) & 255) - ((sub >> 8) & 255);
                sb += (add & 255) - (sub & 255);
            }
        }
    }

    private static int idx(int pos, int line, int w, boolean horizontal) {
        return horizontal ? line * w + pos : pos * w + line;
    }

    /** Decoded bitmap for {@code url} (cache or network), delivered on the main thread. */
    void get(String url, int reqW, int reqH, Done done) {
        if (url == null || url.isEmpty()) {
            done.onBitmap(null);
            return;
        }
        Bitmap hit = memory.get(url);
        if (hit != null) {
            done.onBitmap(hit);
            return;
        }
        fetch(url, reqW, reqH, done);
    }

    /** True when the decoded picture is already in memory (it can be shown at once). */
    boolean cached(String url) {
        return url != null && !url.isEmpty() && memory.get(url) != null;
    }

    /** Weak devices keep fewer pictures warm. */
    boolean isLowRam() {
        return lowRam;
    }

    private volatile int warmGen;

    /** Warm-ups queued for a focus the user has already left are skipped. */
    void cancelWarm() {
        warmGen++;
    }

    /** Warm the cache without a view (posters just off screen). */
    void prefetch(String url, int reqW, int reqH) {
        if (url == null || url.isEmpty() || memory.get(url) != null) return;
        fetch(url, reqW, reqH, null);
    }

    // One download / decode per picture at a time: a prefetch and the picture on screen asking for the same file
    // must not write the same temp file twice (that left the backdrop unchanged).
    private final java.util.Map<String, java.util.List<Done>> inFlight = new java.util.HashMap<>();
    private final ExecutorService warm = Executors.newSingleThreadExecutor();

    private void fetch(String url, int reqW, int reqH, Done done) {
        synchronized (inFlight) {
            java.util.List<Done> waiting = inFlight.get(url);
            if (waiting != null) {
                if (done != null) waiting.add(done);
                return;
            }
            waiting = new java.util.ArrayList<>();
            if (done != null) waiting.add(done);
            inFlight.put(url, waiting);
        }
        // The picture someone is waiting for goes first; warming runs on its own thread.
        final int gen = warmGen;
        final boolean warming = done == null;
        (warming ? warm : pool).execute(() -> {
            if (warming && gen != warmGen) {
                synchronized (inFlight) {
                    java.util.List<Done> late = inFlight.get(url);
                    if (late == null || late.isEmpty()) {
                        inFlight.remove(url);
                        return;
                    }
                }
            }
            Bitmap bitmap = memory.get(url);
            if (bitmap == null) {
                bitmap = decode(url, reqW, reqH);
                if (bitmap != null) memory.put(url, bitmap);
            }
            final Bitmap result = bitmap;
            final java.util.List<Done> callbacks;
            synchronized (inFlight) {
                callbacks = inFlight.remove(url);
            }
            if (callbacks != null && !callbacks.isEmpty()) {
                main.post(() -> {
                    for (Done d : callbacks) d.onBitmap(result);
                });
            }
        });
    }

    private Bitmap decode(String url, int reqW, int reqH) {
        try {
            File file = new File(dir, key(url));
            // A half-written or truncated picture (green / purple bands when decoded) is thrown away and fetched again.
            if (file.isFile() && !complete(file)) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
            }
            if (!file.isFile() || file.length() == 0) {
                if (!download(url, file)) return null;
            } else {
                //noinspection ResultOfMethodCallIgnored
                file.setLastModified(System.currentTimeMillis());
            }
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            try (InputStream in = new FileInputStream(file)) {
                BitmapFactory.decodeStream(in, null, bounds);
            }
            // PNG sub-sampling just drops pixels (JPEG's averages them), so a large clear logo came out jagged:
            // decode PNGs at up to twice the size wanted and shrink the rest of the way with smoothing.
            final boolean png = "image/png".equalsIgnoreCase(bounds.outMimeType);
            final int keep = png ? 2 : 1;
            int sample = 1;
            while (bounds.outWidth / (sample * 2) >= reqW * keep && bounds.outHeight / (sample * 2) >= reqH * keep) sample *= 2;
            // Huge originals (a 4800px logo is ~28 MB decoded) still drop one step on weak sticks, while staying above the size wanted.
            while (png && (long) (bounds.outWidth / sample) * (bounds.outHeight / sample) > 4_000_000L
                    && bounds.outWidth / (sample * 2) >= reqW && bounds.outHeight / (sample * 2) >= reqH) {
                sample *= 2;
            }
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = sample;
            // Full 32-bit colour everywhere: 16-bit pictures band in the soft fades (the cache is limited by bytes, so it stays safe).
            Bitmap bitmap;
            try (InputStream in = new FileInputStream(file)) {
                bitmap = BitmapFactory.decodeStream(in, null, opts);
            }
            if (bitmap == null || !png) return bitmap;
            bitmap = smoothShrink(bitmap, reqW, reqH);
            // Logos are drawn smaller than their pixels: mipmaps keep that shrink smooth (transparent pictures only,
            // so posters and backdrops use no extra GPU memory).
            if (bitmap.hasAlpha()) bitmap.setHasMipMap(true);
            return bitmap;
        } catch (Throwable ignored) {
            return null;
        }
    }

    /**
     * Shrinks to the smallest size that still covers reqW x reqH (the same rule as the sub-sampling), halving with
     * filtering so every source pixel counts; never enlarges.
     */
    private static Bitmap smoothShrink(Bitmap src, int reqW, int reqH) {
        int w = src.getWidth();
        int h = src.getHeight();
        if (reqW <= 0 || reqH <= 0 || w <= 0 || h <= 0) return src;
        float scale = Math.max(reqW / (float) w, reqH / (float) h);
        if (scale >= 0.95f) return src;
        int goalW = Math.max(1, Math.round(w * scale));
        int goalH = Math.max(1, Math.round(h * scale));
        Bitmap cur = src;
        try {
            while (cur.getWidth() / 2 >= goalW && cur.getHeight() / 2 >= goalH) {
                Bitmap next = Bitmap.createScaledBitmap(cur, cur.getWidth() / 2, cur.getHeight() / 2, true);
                if (cur != src) cur.recycle();
                cur = next;
            }
            if (cur.getWidth() != goalW || cur.getHeight() != goalH) {
                Bitmap next = Bitmap.createScaledBitmap(cur, goalW, goalH, true);
                if (next != cur && cur != src) cur.recycle();
                cur = next;
            }
            if (cur != src) src.recycle();
            return cur;
        } catch (Throwable e) {
            if (cur != src) cur.recycle();
            return src;
        }
    }

    /**
     * A copy of src at exactly w x h, shrunk by filtered halving so a large clear logo keeps clean edges. Views
     * show logos at their real pixel size with this: drawing a 2-3x bigger bitmap smaller on screen only gets
     * bilinear filtering (crops and copies lose the mipmaps), which is what made the edges jagged. src (often
     * a cached bitmap) is never recycled; returns src itself when it is already that size.
     */
    static Bitmap scaledExactly(Bitmap src, int w, int h) {
        if (src == null || w <= 0 || h <= 0) return src;
        if (src.getWidth() == w && src.getHeight() == h) return src;
        Bitmap cur = src;
        try {
            while (cur.getWidth() / 2 >= w && cur.getHeight() / 2 >= h) {
                Bitmap next = Bitmap.createScaledBitmap(cur, cur.getWidth() / 2, cur.getHeight() / 2, true);
                if (cur != src) cur.recycle();
                cur = next;
            }
            if (cur.getWidth() != w || cur.getHeight() != h) {
                Bitmap next = Bitmap.createScaledBitmap(cur, w, h, true);
                if (next != cur && cur != src) cur.recycle();
                cur = next;
            }
            // Already the on-screen pixel size: no density rescale on top. A copy keeps the source's density,
            // and an ImageView sized to its picture (adjustViewBounds) then drew it smaller again.
            if (cur != src) cur.setDensity(Bitmap.DENSITY_NONE);
            return cur;
        } catch (Throwable e) {
            if (cur != src) cur.recycle();
            return src;
        }
    }

    /** {@link #scaledExactly} at the largest size that fits inside boxW x boxH, keeping the shape. */
    static Bitmap fittedInside(Bitmap src, int boxW, int boxH) {
        if (src == null || boxW <= 0 || boxH <= 0 || src.getWidth() <= 0 || src.getHeight() <= 0) return src;
        float scale = Math.min(boxW / (float) src.getWidth(), boxH / (float) src.getHeight());
        if (scale >= 1f) return src;
        return scaledExactly(src,
            Math.max(1, Math.round(src.getWidth() * scale)),
            Math.max(1, Math.round(src.getHeight() * scale)));
    }

    private boolean download(String url, File out) {
        HttpURLConnection conn = null;
        File tmp = new File(out.getPath() + ".part");
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(TIMEOUT_MS);
            conn.setReadTimeout(TIMEOUT_MS);
            String cookie = null;
            try {
                cookie = CookieManager.getInstance().getCookie(url);
            } catch (Throwable ignored) { android.util.Log.w("SPSwallowed", "NativeHomeImages:403" + " " + ignored.getClass().getSimpleName()); }
            if (cookie != null && !cookie.isEmpty()) conn.setRequestProperty("Cookie", cookie);
            if (conn.getResponseCode() != 200) return false;
            try (InputStream in = conn.getInputStream(); FileOutputStream fos = new FileOutputStream(tmp)) {
                byte[] buf = new byte[16 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) fos.write(buf, 0, n);
            }
            long expected = conn.getContentLengthLong();
            if (expected > 0 && tmp.length() != expected) {
                //noinspection ResultOfMethodCallIgnored
                tmp.delete();
                return false;
            }
            if (!complete(tmp)) {
                //noinspection ResultOfMethodCallIgnored
                tmp.delete();
                return false;
            }
            if (!tmp.renameTo(out)) return false;
            trimDisk();
            return true;
        } catch (Throwable ignored) {
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /** A JPEG must end with its end marker, a PNG with IEND: anything shorter was cut off. */
    private static boolean complete(File file) {
        try (java.io.RandomAccessFile raf = new java.io.RandomAccessFile(file, "r")) {
            long len = raf.length();
            if (len < 16) return false;
            byte[] head = new byte[2];
            raf.readFully(head);
            if ((head[0] & 0xFF) == 0xFF && (head[1] & 0xFF) == 0xD8) {
                int back = (int) Math.min(len, 64);
                byte[] tail = new byte[back];
                raf.seek(len - back);
                raf.readFully(tail);
                for (int i = tail.length - 1; i >= 1; i--) {
                    if (tail[i] == 0) continue; // padding after the marker
                    return (tail[i - 1] & 0xFF) == 0xFF && (tail[i] & 0xFF) == 0xD9;
                }
                return false;
            }
            if ((head[0] & 0xFF) == 0x89) {
                byte[] tail = new byte[12];
                raf.seek(len - 12);
                raf.readFully(tail);
                return tail[4] == 'I' && tail[5] == 'E' && tail[6] == 'N' && tail[7] == 'D';
            }
            return true; // another format: leave it to the decoder
        } catch (Throwable t) {
            return false;
        }
    }

    private void trimDisk() {
        File[] files = dir.listFiles();
        if (files == null || files.length < 200) return;
        long total = 0;
        for (File f : files) total += f.length();
        if (total <= DISK_MAX_BYTES) return;
        java.util.Arrays.sort(files, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
        for (File f : files) {
            if (total <= DISK_MAX_BYTES * 8 / 10) break;
            long len = f.length();
            if (f.delete()) total -= len;
        }
    }

    private static String key(String url) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-1").digest(url.getBytes(StandardCharsets.UTF_8));
            ByteArrayOutputStream sb = new ByteArrayOutputStream();
            for (byte b : hash) sb.write(String.format("%02x", b).getBytes(StandardCharsets.US_ASCII), 0, 2);
            return sb.toString("US-ASCII");
        } catch (Throwable e) {
            return Integer.toHexString(url.hashCode());
        }
    }
}
