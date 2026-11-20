package com.servermanagerportal.mediaplayer;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.PorterDuff;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The text of a movie / show page, drawn natively above the WebView at the web blocks' places: the service mark and
 * clear logo, the premiere line + tagline + meta chips + rating pills, and the synopsis. The page measures each web
 * block (they stay in the layout, invisible) and sends text + rects; this only draws them.
 * Rects arrive in the page's viewport units and are scaled by the screen; type sizes are in 1920-wide units.
 */
final class NativeDetailsText extends FrameLayout {
    private static final float LOGO_H = 95f;
    private static final float LOGO_MAX_W = 400f;

    private final Context context;
    private final NativeHomeImages images;
    private float k = 1f;      // page viewport units -> px
    private float u = 1f;      // 1920-wide type units -> px
    private float lastVw;
    private int lastW = -1;
    private int lastH = -1;
    private boolean rectKnown;
    private boolean suppressed;
    private boolean hasData;
    private String lastJson = "";
    private int accent = 0xFFF59E0B;
    private String logoUrl = "";
    private boolean logoOk;

    NativeDetailsText(Context context, NativeHomeImages images) {
        super(context);
        this.context = context;
        this.images = images;
        this.u = context.getResources().getDisplayMetrics().density;
        setClipChildren(false);
        setFocusable(false);
        setVisibility(GONE);
    }

    private int px(float v) {
        return Math.round(v * u);
    }

    private static int rgb(String triple, int fallback) {
        try {
            String[] p = triple.trim().split("[ ,]+");
            if (p.length >= 3) return Color.rgb(Integer.parseInt(p[0]), Integer.parseInt(p[1]), Integer.parseInt(p[2]));
        } catch (Throwable ignored) {
            /* fall through */
        }
        return fallback;
    }

    void setData(JSONObject o) {
        String json = o.toString();
        if (json.equals(lastJson)) return;
        lastJson = json;
        accent = rgb(o.optString("accent"), accent);
        removeAllViews();
        hasData = false;
        JSONObject identity = o.optJSONObject("identity");
        JSONObject meta = o.optJSONObject("meta");
        JSONObject synopsis = o.optJSONObject("synopsis");
        JSONObject heading = o.optJSONObject("heading");
        if (identity != null) addBlock(identity, buildIdentity(identity));
        if (heading != null) addBlock(heading, buildStyled(heading));
        if (meta != null) addBlock(meta, buildMeta(meta));
        if (synopsis != null) addBlock(synopsis, buildSynopsis(synopsis));
        hasData = getChildCount() > 0;
        updateVisibility();
    }

    private void addBlock(JSONObject o, View v) {
        if (v == null) return;
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
            Math.max(1, Math.round((float) o.optDouble("w", 1) * k)), Math.max(1, Math.round((float) o.optDouble("h", 1) * k)),
            Gravity.TOP | Gravity.START);
        if (o.has("fs")) {
            // Typed like the web block, but the native font runs a touch wider: some slack so a line keeps its breaks.
            lp.width = Math.max(1, Math.round((float) o.optDouble("w", 1) * k * 1.12f));
            lp.height = ViewGroup.LayoutParams.WRAP_CONTENT;
        }
        lp.leftMargin = Math.round((float) o.optDouble("dx", 0) * k);
        lp.topMargin = Math.round((float) o.optDouble("dy", 0) * k);
        v.setTag(o.toString());
        addView(v, lp);
    }

    // ----- blocks ----------------------------------------------------------------------

    private LinearLayout buildIdentity(JSONObject o) {
        LinearLayout col = new LinearLayout(context);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.TOP | Gravity.START);
        String svcData = o.optString("svcData");
        String svcUrl = o.optString("svc");
        if (!svcData.isEmpty() || !svcUrl.isEmpty()) {
            ImageView svc = new ImageView(context);
            svc.setAdjustViewBounds(true);
            svc.setScaleType(ImageView.ScaleType.FIT_START);
            svc.setMaxHeight(px(40f));
            svc.setMaxWidth(px(240f));
            if (!o.optBoolean("svcColor", false)) svc.setColorFilter(Color.WHITE, PorterDuff.Mode.SRC_IN);
            boolean done = false;
            if (!svcData.isEmpty()) {
                try {
                    byte[] raw = android.util.Base64.decode(svcData, android.util.Base64.DEFAULT);
                    Bitmap bmp = android.graphics.BitmapFactory.decodeByteArray(raw, 0, raw.length);
                    if (bmp != null) {
                        svc.setImageBitmap(bmp);
                        done = true;
                    }
                } catch (Throwable ignored) {
                    /* fall through */
                }
            }
            if (!done && !svcUrl.isEmpty()) images.load(svcUrl, svc, px(240f), px(40f));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.bottomMargin = px(12f);
            col.addView(svc, lp);
        }
        final String name = o.optString("title");
        final String url = o.optString("logo");
        final ImageView logo = new ImageView(context);
        logo.setScaleType(ImageView.ScaleType.FIT_START);
        final TextView title = text(46f, 800, 0xFFFFFFFF);
        title.setMaxLines(2);
        title.setEllipsize(TextUtils.TruncateAt.END);
        title.setText(name);
        if (url.isEmpty()) {
            col.addView(title, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        } else {
            logoUrl = url;
            logoOk = false;
            col.addView(logo, new LinearLayout.LayoutParams(px(LOGO_MAX_W), px(LOGO_H)));
            col.addView(title, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            title.setVisibility(GONE);
            logo.setVisibility(INVISIBLE);
            images.get(url, px(LOGO_MAX_W * 2), px(LOGO_H * 2.6f), bitmap -> {
                if (!url.equals(logoUrl)) return;
                if (bitmap == null) {
                    logo.setVisibility(GONE);
                    title.setVisibility(VISIBLE);
                    return;
                }
                applyLogo(logo, bitmap);
            });
        }
        return col;
    }

    /** Crops the transparent border and sizes the mark to the page's logo slot: full height, narrower for wide marks. */
    private void applyLogo(ImageView logo, Bitmap src) {
        try {
            int w = src.getWidth();
            int h = src.getHeight();
            int[] pxs = new int[w * h];
            src.getPixels(pxs, 0, w, 0, 0, w, h);
            int l = w, t = h, r = -1, b = -1;
            for (int y = 0; y < h; y++) {
                int row = y * w;
                for (int x = 0; x < w; x++) {
                    if ((pxs[row + x] >>> 24) > 12) {
                        if (x < l) l = x;
                        if (x > r) r = x;
                        if (y < t) t = y;
                        if (y > b) b = y;
                    }
                }
            }
            Bitmap shown = src;
            if (r >= l && b >= t && (r - l + 1 < w || b - t + 1 < h)) shown = Bitmap.createBitmap(src, l, t, r - l + 1, b - t + 1);
            float ratio = shown.getWidth() / (float) Math.max(1, shown.getHeight());
            float hh = ratio > 3f ? LOGO_H * (float) Math.sqrt(3f / ratio) : LOGO_H;
            float ww = hh * ratio;
            if (ww > LOGO_MAX_W) {
                ww = LOGO_MAX_W;
                hh = ww / ratio;
            }
            ViewGroup.LayoutParams lp = logo.getLayoutParams();
            lp.width = px(ww);
            lp.height = px(hh);
            logo.setLayoutParams(lp);
            logo.setImageBitmap(shown);
            logo.setVisibility(VISIBLE);
            logoOk = true;
        } catch (Throwable e) {
            logo.setVisibility(GONE);
        }
    }

    private LinearLayout buildMeta(JSONObject o) {
        LinearLayout col = new LinearLayout(context);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.TOP | Gravity.START);
        String premiere = o.optString("premiere");
        if (!premiere.isEmpty()) {
            TextView t = text(20f, 700, accent);
            t.setText(premiere);
            col.addView(t, rowLp(8f));
        }
        String tagline = o.optString("tagline");
        if (!tagline.isEmpty()) {
            TextView t = text(20f, 400, Color.argb(217, 255, 255, 255));
            t.setTypeface(Typeface.create(NativeFonts.face(context, 400), Typeface.ITALIC));
            t.setText(tagline);
            col.addView(t, rowLp(8f));
        }
        JSONArray chips = o.optJSONArray("chips");
        if (chips != null && chips.length() > 0) {
            LinearLayout row = new LinearLayout(context);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            for (int i = 0; i < chips.length(); i++) {
                JSONObject c = chips.optJSONObject(i);
                if (c == null) continue;
                LinearLayout chip = new LinearLayout(context);
                chip.setOrientation(LinearLayout.HORIZONTAL);
                chip.setGravity(Gravity.CENTER_VERTICAL);
                View icon = chipIcon(c.optString("i"));
                if (icon != null) {
                    LinearLayout.LayoutParams ilp = new LinearLayout.LayoutParams(px("csm".equals(c.optString("i")) ? 24f : 18f), px(18f));
                    ilp.rightMargin = px(6f);
                    chip.addView(icon, ilp);
                }
                TextView t = text(18f, 500, c.optBoolean("a", false) ? accent : 0xFFFFFFFF);
                t.setText(c.optString("l"));
                chip.addView(t, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
                LinearLayout.LayoutParams clp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, px(32f));
                if (i > 0) clp.leftMargin = px(30f);
                row.addView(chip, clp);
            }
            col.addView(row, rowLp(10f));
        }
        JSONArray pills = o.optJSONArray("pills");
        if (pills != null && pills.length() > 0) {
            LinearLayout row = new LinearLayout(context);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            for (int i = 0; i < pills.length(); i++) {
                JSONObject p = pills.optJSONObject(i);
                if (p == null) continue;
                LinearLayout pill = new LinearLayout(context);
                pill.setOrientation(LinearLayout.HORIZONTAL);
                pill.setGravity(Gravity.CENTER_VERTICAL);
                String kind = p.optString("k");
                View mark = pillMark(kind, p.optBoolean("f", true));
                if (mark != null) {
                    LinearLayout.LayoutParams mlp = "rt".equals(kind) || "rta".equals(kind)
                        ? new LinearLayout.LayoutParams(px(24f), px(24f))
                        : new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, px(20f));
                    mlp.rightMargin = px(7f);
                    pill.addView(mark, mlp);
                }
                TextView s = text(15.6f, 500, 0xFFFFFFFF);
                s.setText(p.optString("s"));
                pill.addView(s, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
                LinearLayout.LayoutParams plp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, px(37f));
                if (i > 0) plp.leftMargin = px(18f);
                row.addView(pill, plp);
            }
            col.addView(row, rowLp(0f));
        }
        return col;
    }

    private View chipIcon(String kind) {
        int white = 0xFFFFFFFF;
        switch (kind) {
            case "cal":
                return new NativePathIcon(context, 24f, 24f)
                    .path("M8 2v4", 0, white, 2f).path("M16 2v4", 0, white, 2f)
                    .path("M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", 0, white, 2f)
                    .path("M3 10h18", 0, white, 2f);
            case "clock":
                return new NativePathIcon(context, 24f, 24f)
                    .path("M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z", 0, white, 2f).path("M12 6v6l4 2", 0, white, 2f);
            case "star":
                return new NativePathIcon(context, 24f, 24f)
                    .path("M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z", 0, accent, 2f);
            case "csm":
                return new NativePathIcon(context, 89.759f, 78.983f)
                    .circle(39.661f, 39.322f, 30.5f, 0xFFFFFFFF)
                    .path("M70.169,41.356 C69.492,48.475 66.78,55.593 61.017,61.017 C55.254,66.78 47.797,69.831 39.661,69.831 C31.525,69.831 23.729,66.78 17.966,61.017 C12.203,55.254 9.153,47.458 9.153,39.322 C9.153,31.186 12.203,23.729 17.966,17.966 C23.729,12.203 31.525,8.814 39.661,8.814 C47.797,8.814 55.254,12.203 61.017,17.966 C62.034,18.983 63.051,20 64.068,21.017 L69.831,13.898 C69.153,13.22 68.475,12.203 67.458,11.525 C60,4.068 50.169,0 39.661,0 C29.153,0 18.983,4.068 11.525,11.525 C4.068,18.983 -0,28.814 -0,39.322 C-0,49.831 4.068,60 11.525,67.458 C18.983,74.915 29.153,78.983 39.661,78.983 C50.169,78.983 60,74.915 67.458,67.458 C77.288,57.627 80.678,44.068 78.305,31.525 L70.169,41.356", 0xFF33A544, 0, 0f)
                    .path("M43.39,56.61 L43.39,56.61 C36.61,56.61 32.542,52.203 31.864,51.186 L21.017,40 C19.322,38.305 19.322,35.593 21.017,34.237 C22.712,32.542 25.424,32.542 27.119,34.237 L37.966,45.763 L37.966,45.763 C37.966,45.763 40.339,48.136 43.39,48.136 C46.102,48.136 48.814,46.441 51.525,43.39 L82.373,6.102 C83.729,4.407 86.441,4.068 88.136,5.424 C90.169,7.119 90.169,9.492 88.814,11.525 L57.627,49.153 C53.22,53.898 48.475,56.61 43.39,56.61", 0xFF1A1A1A, 0, 0f);
            default:
                return null;
        }
    }

    private View pillMark(String kind, boolean fresh) {
        switch (kind) {
            case "rt": {
                int c = fresh ? 0xFFFA320A : 0xFF6B7280;
                return new NativePathIcon(context, 24f, 24f)
                    .circle(12f, 13f, 8f, c)
                    .path("M9 5c0-2 1.5-3 3-3s3 1 3 3", 0, 0xFF166534, 1.5f)
                    .path("M9 6a3 1.5 0 1 0 6 0a3 1.5 0 1 0-6 0z", 0xFF166534, 0, 0f);
            }
            case "rta": {
                int c = fresh ? 0xFFFA320A : 0xFF6B7280;
                return new NativePathIcon(context, 24f, 24f)
                    .path("M6 10h12v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-8z", c, 0, 0f)
                    .circle(8f, 8f, 2f, 0xFFFBBF24).circle(12f, 7f, 2.2f, 0xFFFDE047).circle(16f, 8f, 2f, 0xFFFBBF24)
                    .circle(10f, 5.5f, 1.6f, 0xFFFDE047).circle(14f, 5.5f, 1.6f, 0xFFFBBF24);
            }
            case "imdb":
                return badge("IMDb", 0xFFF5C518, 0xFF111111);
            case "tmdb":
                return badge("TMDB", 0xFF01B4E4, 0xFFFFFFFF);
            case "tvdb":
                return badge("TVDB", 0xFF6CD3A0, 0xFF000000);
            default:
                return null;
        }
    }

    private TextView badge(String label, int bg, int fg) {
        TextView t = text(11.2f, 900, fg);
        t.setText(label);
        t.setGravity(Gravity.CENTER);
        t.setPadding(px(6.5f), 0, px(6.5f), 0);
        GradientDrawable d = new GradientDrawable();
        d.setColor(bg);
        d.setCornerRadius(px(5f));
        t.setBackground(d);
        return t;
    }

    /** A text block typed like the web one (episode page): size / weight / line height / colour measured by the page. */
    private TextView buildStyled(JSONObject o) {
        String s = o.optString("text");
        if (s.isEmpty()) return null;
        float fs = (float) o.optDouble("fs", 0) * k;
        TextView t = new TextView(context);
        t.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, fs > 0 ? fs : 17f * u);
        t.setTypeface(NativeFonts.face(context, o.optInt("fw", 400)));
        t.setTextColor(cssColor(o.optString("col"), 0xFFFFFFFF));
        t.setIncludeFontPadding(false);
        t.setFocusable(false);
        t.setText(s);
        float lh = (float) o.optDouble("lh", 0) * k;
        if (lh > 0 && android.os.Build.VERSION.SDK_INT >= 28) t.setLineHeight(Math.round(lh));
        return t;
    }

    private static int cssColor(String c, int fallback) {
        try {
            int open = c.indexOf('(');
            int close = c.indexOf(')');
            if (open < 0 || close < 0) return fallback;
            String[] p = c.substring(open + 1, close).split("[ ,/]+");
            if (p.length < 3) return fallback;
            int a = p.length >= 4 ? Math.round(Float.parseFloat(p[3]) * 255f) : 255;
            return Color.argb(a, Math.round(Float.parseFloat(p[0])), Math.round(Float.parseFloat(p[1])), Math.round(Float.parseFloat(p[2])));
        } catch (Throwable ignored) {
            return fallback;
        }
    }

    private TextView buildSynopsis(JSONObject o) {
        if (o.has("fs")) return buildStyled(o);
        String s = o.optString("text");
        if (s.isEmpty()) return null;
        TextView t = text(17f, 400, 0xFFFFFFFF);
        t.setText(s);
        if (android.os.Build.VERSION.SDK_INT >= 28) t.setLineHeight(px(24.65f));
        return t;
    }

    private TextView text(float size, int weight, int color) {
        TextView t = new TextView(context);
        t.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, size * u);
        t.setTypeface(NativeFonts.face(context, weight));
        t.setTextColor(color);
        t.setIncludeFontPadding(false);
        t.setFocusable(false);
        return t;
    }

    private LinearLayout.LayoutParams rowLp(float bottom) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.bottomMargin = px(bottom);
        return p;
    }

    // ----- placement -------------------------------------------------------------------

    /** The page origin (viewport units) of the first block; every block was sent relative to it. */
    void setRect(float x, float y, float w, float h, float vw) {
        View parent = (View) getParent();
        if (parent == null || vw <= 0 || parent.getWidth() <= 0) return;
        float nk = parent.getWidth() / vw;
        if (Math.abs(nk - k) > 0.0001f || vw != lastVw) {
            k = nk;
            lastVw = vw;
            u = parent.getWidth() / 1920f;
            String json = lastJson;
            lastJson = "";
            try {
                if (!json.isEmpty()) setData(new JSONObject(json));
            } catch (Throwable ignored) {
                /* keep the old draw */
            }
        }
        int pw = Math.max(1, Math.round(w * k));
        int ph = Math.max(1, Math.round(h * k));
        if (pw != lastW || ph != lastH) {
            lastW = pw;
            lastH = ph;
            setLayoutParams(new FrameLayout.LayoutParams(pw, ph, Gravity.TOP | Gravity.START));
        }
        setTranslationX(x * k);
        setTranslationY(y * k);
        rectKnown = true;
        updateVisibility();
    }

    void setSuppressed(boolean on) {
        suppressed = on;
        updateVisibility();
    }

    void clear() {
        rectKnown = false;
        hasData = false;
        lastJson = "";
        logoUrl = "";
        removeAllViews();
        setVisibility(GONE);
    }

    private void updateVisibility() {
        setVisibility(hasData && rectKnown && !suppressed ? VISIBLE : GONE);
    }
}
