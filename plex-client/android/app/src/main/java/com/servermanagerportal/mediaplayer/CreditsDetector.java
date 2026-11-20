package com.servermanagerportal.mediaplayer;

import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import android.os.Build;
import android.util.Log;

import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Finds where the end credits start in an episode Plex has no credits marker for.
 *
 * Tunneled video never reaches the surface, so the playing picture cannot be read. Instead a second
 * metadata retriever pulls a few tiny frames from the last minutes of the same file, on a low
 * priority thread, and looks for the credits look: a mostly dark picture with small bright text.
 * The credits are the unbroken run of such frames that reaches the end of the file.
 */
final class CreditsDetector {
    private static final String TAG = "CreditsDetector";
    private static final int W = 128;
    private static final int H = 72;
    private static final long STEP_MS = 10_000;
    private static final long MIN_RUN_MS = 25_000;
    private static final long BUDGET_MS = 100_000;

    private CreditsDetector() {}

    /** Returns the credits start in ms, or -1 when nothing credits-like was found. */
    static long detect(String url, Map<String, String> headers, long durationMs, AtomicBoolean cancel) {
        if (url == null || url.isEmpty() || durationMs < 8 * 60_000L) return -1;
        MediaMetadataRetriever mmr = new MediaMetadataRetriever();
        long began = android.os.SystemClock.elapsedRealtime();
        try {
            if (url.startsWith("http")) mmr.setDataSource(url, headers);
            else mmr.setDataSource(url);
            // Sanity: a mid-episode frame must not be black, or this decoder/stream cannot be read.
            int mid = classify(frameAt(mmr, durationMs / 2));
            Log.i(TAG, "mid-episode kind=" + mid);
            if (mid == 1) return -2;
            long windowMs = Math.min(8 * 60_000L, durationMs * 3 / 10);
            long t = durationMs - 8_000;
            long floor = durationMs - windowMs;
            int gap = 0;
            int textFrames = 0;
            long earliest = -1;
            while (t >= floor) {
                if (cancel.get() || android.os.SystemClock.elapsedRealtime() - began > BUDGET_MS) return -1;
                int kind = classify(frameAt(mmr, t));
                Log.i(TAG, "t=" + (t / 1000) + "s kind=" + kind);
                if (kind == 0) {
                    if (++gap >= 2) break;
                } else {
                    gap = 0;
                    if (kind == 2) textFrames++;
                    earliest = t;
                }
                t -= STEP_MS;
            }
            if (earliest < 0 || textFrames < 3) return -1;
            if (durationMs - earliest < MIN_RUN_MS) return -1;
            // Refine: the real start sits somewhere in the step before the earliest hit.
            long refined = earliest;
            for (long probe = earliest - 2_500; probe > earliest - STEP_MS - 2_500 && probe > floor - STEP_MS; probe -= 2_500) {
                if (cancel.get()) return -1;
                if (classify(frameAt(mmr, probe)) == 0) break;
                refined = probe;
            }
            Log.i(TAG, "credits start " + (refined / 1000) + "s of " + (durationMs / 1000) + "s");
            return refined;
        } catch (Throwable error) {
            Log.w(TAG, "detect failed: " + error);
            return -1;
        } finally {
            try {
                mmr.release();
            } catch (Throwable ignored) {
                /* nothing */
            }
        }
    }

    private static Bitmap frameAt(MediaMetadataRetriever mmr, long ms) {
        long us = ms * 1000L;
        if (Build.VERSION.SDK_INT >= 27) {
            return mmr.getScaledFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, W, H);
        }
        Bitmap full = mmr.getFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
        if (full == null) return null;
        Bitmap small = Bitmap.createScaledBitmap(full, W, H, true);
        if (small != full) full.recycle();
        return small;
    }

    /** 0 = ordinary picture, 1 = black, 2 = text on dark. */
    private static int classify(Bitmap bmp) {
        if (bmp == null) return 0;
        try {
            int w = bmp.getWidth();
            int h = bmp.getHeight();
            int[] px = new int[w * h];
            bmp.getPixels(px, 0, w, 0, 0, w, h);
            int dark = 0;
            int bright = 0;
            int textRows = 0;
            int transitions = 0;
            for (int y = 0; y < h; y++) {
                int rowBright = 0;
                boolean prev = false;
                int rowTransitions = 0;
                for (int x = 0; x < w; x++) {
                    int c = px[y * w + x];
                    int luma = (((c >> 16) & 255) * 3 + ((c >> 8) & 255) * 6 + (c & 255)) / 10;
                    if (luma < 45) dark++;
                    boolean b = luma > 150;
                    if (b) {
                        bright++;
                        rowBright++;
                    }
                    if (b != prev) rowTransitions++;
                    prev = b;
                }
                if (rowBright >= 2) {
                    textRows++;
                    transitions += rowTransitions;
                }
            }
            bmp.recycle();
            float total = w * h;
            float darkFrac = dark / total;
            float brightFrac = bright / total;
            Log.i(TAG, "frame dark=" + darkFrac + " bright=" + brightFrac + " rows=" + (textRows / (float) h));
            if (darkFrac >= 0.97f && brightFrac < 0.002f) return 1;
            boolean sparse = darkFrac >= 0.72f && brightFrac >= 0.003f && brightFrac <= 0.22f;
            float rowFrac = textRows / (float) h;
            float perRow = textRows == 0 ? 0 : transitions / (float) textRows;
            return sparse && rowFrac >= 0.12f && rowFrac <= 0.9f && perRow >= 4f ? 2 : 0;
        } catch (Throwable error) {
            return 0;
        }
    }
}
