package com.servermanagerportal.mediaplayer;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.PorterDuff;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.TextUtils;
import android.text.style.ForegroundColorSpan;
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
 * The Home billboard copy (service mark, clear logo or title, tagline, meta line, synopsis, cast), drawn natively
 * at the web billboard's place. The page still works out WHAT to show for the focused title and sends it here as
 * JSON; this view only draws it. Bottom-anchored like the page's block, so a short synopsis grows upward.
 */
final class NativeBillboardView extends FrameLayout {
    // All sizes are in the page's 1920-wide layout units (like the rest of the native Home).
    private static final float LEFT = 135f;
    private static final float WIDTH = 840f;
    private static final float HEIGHT = 420f;
    private static final float BOTTOM = 472f;      // the block's bottom edge, from the top of the screen
    private static final float LOGO_H = 84f;
    private static final float LOGO_MAX_W = 440f;
    private static final float SVC_H = 47f;
    private static final float SVC_MAX_W = 280f;
    private static final float GAP = 8f;

    private final NativeHomeImages images;
    private final float density;
    private final LinearLayout content;
    private final ImageView svc;
    private final ImageView logo;
    private final TextView title;
    private final TextView tagline;
    private final LinearLayout metaRow;
    private final LinearLayout watched;
    private final PathIcon checkIcon;
    private final PathIcon csmIcon;
    private final TextView csmText;
    private final TextView meta;
    private final TextView summary;
    private final TextView cast;

    private String lastJson = "";
    private String logoUrl = "";
    private String title0 = "";
    private boolean logoOk;

    NativeBillboardView(Context context, NativeHomeImages images) {
        super(context);
        this.images = images;
        this.density = context.getResources().getDisplayMetrics().density;
        setClipChildren(false);
        setClipToPadding(false);
        setFocusable(false);
        setVisibility(GONE);

        content = new LinearLayout(context);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.BOTTOM | Gravity.START);
        addView(content, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        svc = new ImageView(context);
        svc.setAdjustViewBounds(true);
        svc.setScaleType(ImageView.ScaleType.FIT_START);
        svc.setMaxHeight(dp(SVC_H));
        svc.setMaxWidth(dp(SVC_MAX_W));
        content.addView(svc, lp(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, GAP));

        logo = new ImageView(context);
        logo.setScaleType(ImageView.ScaleType.FIT_START);
        content.addView(logo, lp(dp(LOGO_MAX_W), dp(LOGO_H), GAP));

        title = text(context, 43f, 700, 1f, 0xFFF4F4F5);
        title.setMaxLines(2);
        title.setEllipsize(TextUtils.TruncateAt.END);
        content.addView(title, lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, GAP));

        tagline = text(context, 19f, 400, 1f, Color.argb(190, 255, 255, 255));
        tagline.setTypeface(Typeface.create(NativeFonts.face(context, 400), Typeface.ITALIC));
        tagline.setMaxLines(1);
        tagline.setEllipsize(TextUtils.TruncateAt.END);
        content.addView(tagline, lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, GAP));

        metaRow = new LinearLayout(context);
        metaRow.setOrientation(LinearLayout.HORIZONTAL);
        metaRow.setGravity(Gravity.CENTER_VERTICAL);
        watched = new LinearLayout(context);
        watched.setOrientation(LinearLayout.HORIZONTAL);
        watched.setGravity(Gravity.CENTER_VERTICAL);
        watched.setPadding(dp(12), dp(4), dp(12), dp(4));
        checkIcon = new PathIcon(context, 24f, 24f);
        checkIcon.stroke(new String[]{"M20 6 9 17l-5-5"}, 0xFF111111, 2.5f);
        LinearLayout.LayoutParams cip = new LinearLayout.LayoutParams(dp(15), dp(15));
        cip.rightMargin = dp(5);
        watched.addView(checkIcon, cip);
        TextView watchedText = text(context, 17f, 500, 1f, 0xFF111111);
        watchedText.setText("Watched");
        watched.addView(watchedText, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        metaRow.addView(watched, lp(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, 0f));
        meta = text(context, 19f, 500, 1f, Color.argb(209, 255, 255, 255));
        meta.setMaxLines(1);
        meta.setEllipsize(TextUtils.TruncateAt.END);
        metaRow.addView(meta, lp(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, 0f));
        csmIcon = new PathIcon(context, 89.759f, 78.983f);
        csmIcon.fill(new String[]{"circle", "M70.169,41.356 C69.492,48.475 66.78,55.593 61.017,61.017 C55.254,66.78 47.797,69.831 39.661,69.831 C31.525,69.831 23.729,66.78 17.966,61.017 C12.203,55.254 9.153,47.458 9.153,39.322 C9.153,31.186 12.203,23.729 17.966,17.966 C23.729,12.203 31.525,8.814 39.661,8.814 C47.797,8.814 55.254,12.203 61.017,17.966 C62.034,18.983 63.051,20 64.068,21.017 L69.831,13.898 C69.153,13.22 68.475,12.203 67.458,11.525 C60,4.068 50.169,0 39.661,0 C29.153,0 18.983,4.068 11.525,11.525 C4.068,18.983 -0,28.814 -0,39.322 C-0,49.831 4.068,60 11.525,67.458 C18.983,74.915 29.153,78.983 39.661,78.983 C50.169,78.983 60,74.915 67.458,67.458 C77.288,57.627 80.678,44.068 78.305,31.525 L70.169,41.356",
            "M43.39,56.61 L43.39,56.61 C36.61,56.61 32.542,52.203 31.864,51.186 L21.017,40 C19.322,38.305 19.322,35.593 21.017,34.237 C22.712,32.542 25.424,32.542 27.119,34.237 L37.966,45.763 L37.966,45.763 C37.966,45.763 40.339,48.136 43.39,48.136 C46.102,48.136 48.814,46.441 51.525,43.39 L82.373,6.102 C83.729,4.407 86.441,4.068 88.136,5.424 C90.169,7.119 90.169,9.492 88.814,11.525 L57.627,49.153 C53.22,53.898 48.475,56.61 43.39,56.61"},
            new int[]{0xFFFFFFFF, 0xFF33A544, 0xFF1A1A1A});
        LinearLayout.LayoutParams csp = new LinearLayout.LayoutParams(dp(24), dp(21));
        csp.rightMargin = dp(6);
        metaRow.addView(csmIcon, csp);
        csmText = text(context, 19f, 500, 1f, Color.argb(209, 255, 255, 255));
        csmText.setMaxLines(1);
        metaRow.addView(csmText, lp(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, 0f));
        content.addView(metaRow, lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, GAP));

        summary = text(context, 20.4f, 400, 1.45f, Color.argb(199, 255, 255, 255));
        summary.setMaxLines(3);
        summary.setEllipsize(TextUtils.TruncateAt.END);
        content.addView(summary, lp(dp(WIDTH), ViewGroup.LayoutParams.WRAP_CONTENT, GAP));

        cast = text(context, 15f, 400, 1.35f, Color.argb(140, 255, 255, 255));
        cast.setMaxLines(1);
        cast.setEllipsize(TextUtils.TruncateAt.END);
        content.addView(cast, lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 0f));
    }

    /** The slot inside the Home view: the page's billboard rect. */
    static FrameLayout.LayoutParams slot(float density) {
        FrameLayout.LayoutParams p = new FrameLayout.LayoutParams(Math.round(WIDTH * density), Math.round(HEIGHT * density));
        p.leftMargin = Math.round(LEFT * density);
        p.topMargin = Math.round((BOTTOM - HEIGHT) * density);
        return p;
    }

    private int dp(float v) {
        return Math.round(v * density);
    }

    private LinearLayout.LayoutParams lp(int w, int h, float bottomGap) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(w, h);
        p.bottomMargin = dp(bottomGap);
        p.gravity = Gravity.START;
        return p;
    }

    private TextView text(Context context, float sizePx, int weight, float lineMult, int color) {
        TextView t = new TextView(context);
        t.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, sizePx * density);
        t.setTypeface(NativeFonts.face(context, weight));
        t.setTextColor(color);
        t.setIncludeFontPadding(false);
        if (lineMult > 1f) {
            if (android.os.Build.VERSION.SDK_INT >= 28) t.setLineHeight(Math.round(sizePx * density * lineMult));
            else t.setLineSpacing(0f, lineMult);
        }
        t.setFocusable(false);
        return t;
    }

    void clear() {
        lastJson = "";
        logoUrl = "";
        animate().cancel();
        setVisibility(GONE);
    }

    /**
     * {key, dir, logo, title, tagline, watched, meta:[{t,k}], csm, summary, cast, svc, svcColor}. Repeated JSON is
     * ignored; a row change (dir set) fades the old block out and the new one in, anything else swaps in place.
     */
    void set(String json, int accent) {
        if (json == null || json.equals(lastJson)) return;
        lastJson = json;
        try {
            final JSONObject o = new JSONObject(json);
            final String dir = o.optString("dir", "");
            final boolean first = getVisibility() != VISIBLE;
            if (!dir.isEmpty() && !first) {
                content.animate().cancel();
                content.animate().alpha(0f).translationY(dp("down".equals(dir) ? -14f : 14f)).setDuration(110).withEndAction(() -> {
                    bind(o, accent);
                    content.setTranslationY(dp("down".equals(dir) ? 14f : -14f));
                    content.animate().alpha(1f).translationY(0f).setDuration(190).start();
                }).start();
                return;
            }
            content.animate().cancel();
            content.setAlpha(1f);
            content.setTranslationY(0f);
            bind(o, accent);
            setVisibility(VISIBLE);
        } catch (Throwable ignored) {
            lastJson = "";
        }
    }

    private void bind(JSONObject o, int accent) {
        setVisibility(VISIBLE);
        title0 = o.optString("title");
        bindService(o.optString("svc"), o.optString("svcData"), o.optBoolean("svcColor", false));
        bindLogo(o.optString("logo"), title0);

        String tag = o.optString("tagline");
        tagline.setVisibility(tag.isEmpty() ? GONE : VISIBLE);
        tagline.setText(tag);

        boolean isWatched = o.optBoolean("watched", false);
        JSONArray parts = o.optJSONArray("meta");
        String csm = o.optString("csm");
        boolean any = isWatched || (parts != null && parts.length() > 0) || !csm.isEmpty();
        metaRow.setVisibility(any ? VISIBLE : GONE);
        if (any) {
            watched.setVisibility(isWatched ? VISIBLE : GONE);
            if (isWatched) {
                GradientDrawable pill = new GradientDrawable();
                pill.setColor(accent);
                pill.setCornerRadius(dp(30f));
                watched.setBackground(pill);
            }
            SpannableStringBuilder sb = new SpannableStringBuilder();
            final int sep = Color.argb(115, 255, 255, 255);
            boolean needSep = isWatched;
            if (parts != null) {
                for (int i = 0; i < parts.length(); i++) {
                    JSONObject p = parts.optJSONObject(i);
                    if (p == null) continue;
                    if (needSep) appendColored(sb, "  ·  ", sep);
                    String kind = p.optString("k");
                    int color = "future".equals(kind) ? accent : "title".equals(kind) ? 0xFFFFFFFF : Color.argb(209, 255, 255, 255);
                    appendColored(sb, p.optString("t"), color);
                    needSep = true;
                }
            }
            if (!csm.isEmpty() && needSep) appendColored(sb, "  ·  ", sep);
            meta.setVisibility(sb.length() > 0 ? VISIBLE : GONE);
            csmIcon.setVisibility(csm.isEmpty() ? GONE : VISIBLE);
            csmText.setVisibility(csm.isEmpty() ? GONE : VISIBLE);
            csmText.setText(csm);
            meta.setText(sb);
            LinearLayout.LayoutParams wlp = (LinearLayout.LayoutParams) watched.getLayoutParams();
            wlp.rightMargin = dp(10f);
            watched.setLayoutParams(wlp);
        }

        // Collapsed like the page shows it: a summary with blank lines in it drew a gap mid-synopsis.
        String sum = o.optString("summary").replaceAll("\\s+", " ").trim();
        summary.setVisibility(sum.isEmpty() ? GONE : VISIBLE);
        summary.setText(sum);
        String cs = o.optString("cast");
        cast.setVisibility(cs.isEmpty() ? GONE : VISIBLE);
        cast.setText(cs);
    }

    /** A small vector mark drawn from SVG path data (the page's Check and Common Sense Media icons). */
    private static final class PathIcon extends View {
        private final float vw;
        private final float vh;
        private android.graphics.Path[] paths = new android.graphics.Path[0];
        private int[] colors = new int[0];
        private boolean stroked;
        private float strokeW;
        private final android.graphics.Paint paint = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);

        PathIcon(Context context, float vw, float vh) {
            super(context);
            this.vw = vw;
            this.vh = vh;
        }

        void stroke(String[] d, int color, float width) {
            stroked = true;
            strokeW = width;
            build(d, new int[]{color});
        }

        /** "circle" = the CSM white disc; any other entry is path data. */
        void fill(String[] d, int[] cols) {
            stroked = false;
            build(d, cols);
        }

        private void build(String[] d, int[] cols) {
            paths = new android.graphics.Path[d.length];
            for (int i = 0; i < d.length; i++) {
                if ("circle".equals(d[i])) {
                    android.graphics.Path c = new android.graphics.Path();
                    c.addCircle(39.661f, 39.322f, 30.5f, android.graphics.Path.Direction.CW);
                    paths[i] = c;
                } else {
                    paths[i] = androidx.core.graphics.PathParser.createPathFromPathData(d[i]);
                }
            }
            colors = cols;
            invalidate();
        }

        @Override
        protected void onDraw(android.graphics.Canvas canvas) {
            float s = Math.min(getWidth() / vw, getHeight() / vh);
            canvas.save();
            canvas.translate((getWidth() - vw * s) / 2f, (getHeight() - vh * s) / 2f);
            canvas.scale(s, s);
            for (int i = 0; i < paths.length; i++) {
                if (paths[i] == null) continue;
                paint.setColor(colors[Math.min(i, colors.length - 1)]);
                if (stroked) {
                    paint.setStyle(android.graphics.Paint.Style.STROKE);
                    paint.setStrokeWidth(strokeW);
                    paint.setStrokeCap(android.graphics.Paint.Cap.ROUND);
                    paint.setStrokeJoin(android.graphics.Paint.Join.ROUND);
                } else {
                    paint.setStyle(android.graphics.Paint.Style.FILL);
                }
                canvas.drawPath(paths[i], paint);
            }
            canvas.restore();
        }
    }

    private static void appendColored(SpannableStringBuilder sb, String s, int color) {
        int start = sb.length();
        sb.append(s);
        sb.setSpan(new ForegroundColorSpan(color), start, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    }

    private void bindService(String url, String data, boolean keepColor) {
        if (data != null && !data.isEmpty()) {
            try {
                byte[] raw = android.util.Base64.decode(data, android.util.Base64.DEFAULT);
                Bitmap bmp = android.graphics.BitmapFactory.decodeByteArray(raw, 0, raw.length);
                if (bmp != null) {
                    svc.setTag(null);
                    svc.setVisibility(VISIBLE);
                    if (keepColor) svc.clearColorFilter();
                    else svc.setColorFilter(Color.WHITE, PorterDuff.Mode.SRC_IN);
                    showService(bmp);
                    return;
                }
            } catch (Throwable ignored) {
                /* fall through to no mark */
            }
        }
        if (url == null || url.isEmpty()) {
            svc.setVisibility(GONE);
            svc.setTag(null);
            return;
        }
        svc.setVisibility(VISIBLE);
        if (keepColor) svc.clearColorFilter();
        else svc.setColorFilter(Color.WHITE, PorterDuff.Mode.SRC_IN);
        if (url.equals(svc.getTag()) && svc.getDrawable() != null) return;
        svc.setTag(url);
        svc.setImageDrawable(null);
        images.get(url, dp(SVC_MAX_W), dp(SVC_H), bmp -> {
            if (!url.equals(svc.getTag())) return;
            if (bmp == null) {
                svc.setVisibility(GONE);
                return;
            }
            showService(bmp);
        });
    }

    /** Network / studio mark at its real on-screen size: a big PNG shrunk while drawing came out jagged. */
    private void showService(Bitmap bmp) {
        svc.setImageBitmap(NativeHomeImages.fittedInside(bmp, dp(SVC_MAX_W), dp(SVC_H)));
    }

    private void bindLogo(final String url, String name) {
        if (url == null || url.isEmpty()) {
            logoUrl = "";
            logoOk = false;
            logo.setVisibility(GONE);
            logo.setImageDrawable(null);
            showTitle(name, true);
            return;
        }
        if (url.equals(logoUrl) && logoOk) {
            logo.setVisibility(VISIBLE);
            showTitle(name, false);
            return;
        }
        logoUrl = url;
        logoOk = false;
        // Hold the logo's slot (and no title yet) until the picture is measured, like the page does.
        logo.setImageDrawable(null);
        logo.setVisibility(INVISIBLE);
        LinearLayout.LayoutParams hold = (LinearLayout.LayoutParams) logo.getLayoutParams();
        hold.width = dp(LOGO_MAX_W);
        hold.height = dp(LOGO_H);
        logo.setLayoutParams(hold);
        showTitle(name, false);
        images.get(url, dp(LOGO_MAX_W * 2), dp(LOGO_H * 2.6f), bitmap -> {
            if (!url.equals(logoUrl)) return;
            if (bitmap == null) {
                logo.setVisibility(GONE);
                showTitle(title0, true);
                return;
            }
            applyLogo(bitmap);
        });
    }

    private void showTitle(String name, boolean on) {
        title.setVisibility(on ? VISIBLE : GONE);
        if (on) title.setText(name);
    }

    /** Crops the transparent border (the page measures it too) and sizes the mark: small / tall marks are grown. */
    private void applyLogo(Bitmap src) {
        try {
            int w = src.getWidth();
            int h = src.getHeight();
            int[] px = new int[w * h];
            src.getPixels(px, 0, w, 0, 0, w, h);
            int l = w, t = h, r = -1, b = -1;
            for (int y = 0; y < h; y++) {
                int row = y * w;
                for (int x = 0; x < w; x++) {
                    if ((px[row + x] >>> 24) > 12) {
                        if (x < l) l = x;
                        if (x > r) r = x;
                        if (y < t) t = y;
                        if (y > b) b = y;
                    }
                }
            }
            Bitmap shown = src;
            float contentW = 1f;
            float contentH = 1f;
            if (r >= l && b >= t && (r - l + 1 < w || b - t + 1 < h)) {
                int cw = r - l + 1;
                int ch = b - t + 1;
                shown = Bitmap.createBitmap(src, l, t, cw, ch);
                contentW = cw / (float) w;
                contentH = ch / (float) h;
            }
            float ratio = shown.getWidth() / (float) Math.max(1, shown.getHeight());
            float shape = ratio < 3f ? (float) Math.sqrt(3f / ratio) : 1f;
            float boost = contentH < 0.98f ? 1.15f : 1f;
            float hh = Math.min(LOGO_H * shape * boost, LOGO_H * Math.max(contentH, 0.2f) * 2.3f);
            hh = Math.max(hh, LOGO_H * 0.5f);
            float ww = hh * ratio;
            if (ww > LOGO_MAX_W * Math.max(contentW, 0.6f)) {
                ww = LOGO_MAX_W * Math.max(contentW, 0.6f);
                hh = ww / ratio;
            }
            LinearLayout.LayoutParams p = (LinearLayout.LayoutParams) logo.getLayoutParams();
            p.width = dp(ww);
            p.height = dp(hh);
            logo.setLayoutParams(p);
            logo.setImageBitmap(NativeHomeImages.scaledExactly(shown, p.width, p.height));
            logo.setVisibility(VISIBLE);
            logoOk = true;
            showTitle(title0, false);
        } catch (Throwable e) {
            logo.setVisibility(GONE);
            showTitle(title0, true);
        }
    }

    /** The sidebar slid the page right: the copy follows it. */
    void setShift(float px) {
        animate().cancel();
        animate().translationX(dp(px)).setDuration(180).setInterpolator(new android.view.animation.DecelerateInterpolator()).start();
    }
}
