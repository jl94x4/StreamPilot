package com.servermanagerportal.mediaplayer;

import android.content.Context;
import android.graphics.Typeface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * The app font (Settings) for the native screens. The page's chosen face is passed down by key ("inter", "lora"...,
 * "default" = the built-in Satoshi headings / Switzer text); the faces are ttf instances bundled in
 * assets/native-fonts (built by scripts/build-native-fonts.py).
 */
final class NativeFonts {
    private NativeFonts() {
    }

    /** The chosen app font key. Changed through {@link #setKey}. */
    private static volatile String key = "default";
    private static JSONObject index;
    private static final Map<String, Typeface> cache = new HashMap<>();

    static String key() {
        return key;
    }

    /** @return true when the font changed (native views built before must be rebuilt to pick it up). */
    static synchronized boolean setKey(String next) {
        String k = next == null || next.isEmpty() ? "default" : next;
        if (k.equals(key)) return false;
        key = k;
        return true;
    }

    private static synchronized JSONObject index(Context context) {
        if (index != null) return index;
        try (InputStream in = context.getAssets().open("native-fonts/index.json")) {
            byte[] bytes = new byte[in.available()];
            int read = in.read(bytes);
            index = new JSONObject(new String(bytes, 0, Math.max(0, read), "UTF-8"));
        } catch (Exception e) {
            index = new JSONObject();
        }
        return index;
    }

    private static int nearest(JSONArray weights, int want) {
        int best = -1;
        int bestGap = Integer.MAX_VALUE;
        for (int i = 0; i < weights.length(); i++) {
            int w = weights.optInt(i, 400);
            int gap = Math.abs(w - want);
            if (gap < bestGap || (gap == bestGap && w > best)) {
                best = w;
                bestGap = gap;
            }
        }
        return best;
    }

    /** True when the user picked a font of their own (not the built-in look). */
    static boolean custom() {
        return !"default".equals(key);
    }

    /** The face for a CSS-style weight (400..800) in the chosen font. */
    static synchronized Typeface face(Context context, int weight) {
        String family;
        // "default" keeps the native screens' original Roboto; any chosen font replaces it everywhere.
        family = "default".equals(key) ? "roboto" : key;
        return faceOf(context, family, weight);
    }

    /** A specific bundled family (no app-font override), e.g. "creato". */
    static synchronized Typeface faceOf(Context context, String family, int weight) {
        JSONArray weights = index(context).optJSONArray(family);
        if (weights == null || weights.length() == 0) return fallback(weight);
        int w = nearest(weights, weight);
        String id = family + "-" + w;
        Typeface hit = cache.get(id);
        if (hit != null) return hit;
        try {
            Typeface made = Typeface.createFromAsset(context.getAssets(), "native-fonts/" + id + ".ttf");
            cache.put(id, made);
            return made;
        } catch (Exception e) {
            return fallback(weight);
        }
    }

    private static Typeface fallback(int weight) {
        return weight >= 700 ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT;
    }
}
