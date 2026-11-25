package com.servermanagerportal.mediaplayer;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Shader;
import android.os.Handler;
import android.os.Looper;
import android.text.TextPaint;
import android.text.TextUtils;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * The always-there chrome of the TV app drawn natively over the page: the side menu (icons when closed, labelled
 * panel when open) and the clock. The web copies stay mounted (invisible) and stay the source of truth: their layout
 * is measured into the payload, so the native menu sits exactly where the web one is, and Enter on an item asks the
 * page to click its web twin. Positions arrive in the page's layout px; {@code k} scales them to the screen.
 */
final class NativeChromeView extends FrameLayout {

    static final String PREFIX = "nav~";
    private static final long LONG_PRESS_MS = 600;
    private boolean okLong;
    private static final long FOCUS_NOTIFY_MS = 70;

    private static final class Shape {
        Path[] paths = new Path[0];
        float x;
        float y;
        float w;
        float h;
        int color = Color.WHITE;
        float stroke = 2f;
        float vbSize = 24f;
    }

    private static final class Item {
        String key = "";
        String label = "";
        boolean active;
        boolean focusable;
        float x;
        float y;
        float w;
        float h;
        float clipTop = -1f;
        float clipBottom = -1f;
        float labelX;
        float labelW;
        float labelSize = 14f;
        int labelColor = Color.WHITE;
        boolean hasLabel;
        String avatar = "";
        String initial = "";
        float avX;
        float avY;
        float avW;
        List<Shape> shapes = new ArrayList<>();
        Bitmap avatarBmp;
    }

    private static final class Text {
        String t = "";
        float x;
        float y;
        float w;
        float h;
        float size = 10f;
        int color = Color.WHITE;
        float spacing;
    }

    private final NativeEpisodeRail.Listener listener;
    private final NativeHomeImages images;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<Item> items = new ArrayList<>();
    private final List<Text> labels = new ArrayList<>();
    private final List<float[]> rules = new ArrayList<>();
    private final List<int[]> ruleColors = new ArrayList<>();
    private final Body body;

    private String sig = "";
    private float k = 1f;
    private boolean navOn;
    private boolean expanded;
    private int panelColor;
    private float rootX;
    private float rootY;
    private float rootW;
    private float rootH;
    private float rootRadius = 28f;
    private boolean clockOn;
    /**
     * Home's clock as last drawn, in screen px, so the player's clock can be the same (PlayerActivity): its top and
     * right edge, size, text size, pill and text colours, and 12 / 24 hour (from Home's own label).
     */
    static volatile boolean clockKnown;
    static volatile float clockTopPx, clockRightPx, clockWidthPx, clockHeightPx, clockTextPx;
    static volatile int clockBgColor, clockTextColor = Color.WHITE;
    static volatile boolean clock24 = true;
    private String clockText = "";
    private float clkX;
    private float clkY;
    private float clkW;
    private float clkH;
    private float clkSize = 17f;
    private int clkBg;
    private int clkColor = Color.WHITE;
    private boolean hidden;
    private boolean dimmed;
    private int accent = Color.rgb(245, 158, 11);
    private int focusIdx = -1;
    private String notifyKey = "";
    private boolean handedOff;
    private long handoffAt;
    private long lastActivityAt;

    private final Runnable notifyFocus = new Runnable() {
        @Override
        public void run() {
            if (!notifyKey.isEmpty() && body.isFocused() && !handedOff) listener.onFocus(PREFIX + notifyKey);
        }
    };

    NativeChromeView(Context context, NativeEpisodeRail.Listener listener, NativeHomeImages images) {
        super(context);
        this.listener = listener;
        this.images = images;
        setFocusable(false);
        setClipChildren(false);
        setDescendantFocusability(FOCUS_BLOCK_DESCENDANTS);
        body = new Body(context);
        addView(body, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setVisibility(GONE);
    }

    // ----- data -----------------------------------------------------------------------

    void setData(JSONObject root) {
        String next = root.toString();
        if (next.equals(sig)) return;
        sig = next;
        View parent = (View) getParent();
        float vw = (float) root.optDouble("vw", 0);
        if (parent != null && vw > 0 && parent.getWidth() > 0) k = parent.getWidth() / vw;
        String rgb = root.optString("accent", "");
        if (!rgb.isEmpty()) {
            String[] p = rgb.trim().split("[ ,]+");
            if (p.length >= 3) {
                try {
                    accent = Color.rgb(Integer.parseInt(p[0]), Integer.parseInt(p[1]), Integer.parseInt(p[2]));
                } catch (NumberFormatException ignored) {
                    /* keep */
                }
            }
        }
        hidden = root.optBoolean("hidden", false);
        dimmed = root.optBoolean("dim", false);
        String held = focusedKey();
        items.clear();
        labels.clear();
        rules.clear();
        ruleColors.clear();
        JSONObject nav = root.optJSONObject("nav");
        navOn = nav != null;
        if (nav != null) {
            expanded = nav.optBoolean("expanded", false);
            panelColor = nav.optInt("panel", 0);
            rootX = (float) nav.optDouble("x", 0);
            rootY = (float) nav.optDouble("y", 0);
            rootW = (float) nav.optDouble("w", 0);
            rootH = (float) nav.optDouble("h", 0);
            rootRadius = (float) nav.optDouble("r", 28);
            JSONArray arr = nav.optJSONArray("items");
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject o = arr.optJSONObject(i);
                    if (o != null) items.add(parseItem(o));
                }
            }
            JSONArray ls = nav.optJSONArray("labels");
            if (ls != null) {
                for (int i = 0; i < ls.length(); i++) {
                    JSONObject o = ls.optJSONObject(i);
                    if (o == null) continue;
                    Text t = new Text();
                    t.t = o.optString("t");
                    t.x = (float) o.optDouble("x");
                    t.y = (float) o.optDouble("y");
                    t.w = (float) o.optDouble("w");
                    t.h = (float) o.optDouble("h");
                    t.size = (float) o.optDouble("s", 10);
                    t.color = o.optInt("c", Color.WHITE);
                    t.spacing = (float) o.optDouble("sp", 0);
                    labels.add(t);
                }
            }
            JSONArray rs = nav.optJSONArray("rules");
            if (rs != null) {
                for (int i = 0; i < rs.length(); i++) {
                    JSONObject o = rs.optJSONObject(i);
                    if (o == null) continue;
                    rules.add(new float[]{(float) o.optDouble("x"), (float) o.optDouble("y"), (float) o.optDouble("w"), (float) o.optDouble("h")});
                    ruleColors.add(new int[]{o.optInt("c", Color.argb(38, 255, 255, 255))});
                }
            }
        }
        JSONObject clk = root.optJSONObject("clock");
        clockOn = clk != null && !clk.optString("t").isEmpty();
        if (clk != null) {
            clockText = clk.optString("t");
            clkX = (float) clk.optDouble("x");
            clkY = (float) clk.optDouble("y");
            clkW = (float) clk.optDouble("w");
            clkH = (float) clk.optDouble("h");
            clkSize = (float) clk.optDouble("s", 17);
            clkBg = clk.optInt("bg", 0);
            clkColor = clk.optInt("c", Color.WHITE);
        }
        if (held != null) {
            int at = indexOf(held);
            focusIdx = at >= 0 ? at : firstFocusable();
        }
        updateVisibility();
        body.invalidate();
    }

    private Item parseItem(JSONObject o) {
        Item it = new Item();
        it.key = o.optString("k");
        it.label = o.optString("l");
        it.active = o.optBoolean("a", false);
        it.focusable = o.optBoolean("f", false);
        it.x = (float) o.optDouble("x");
        it.y = (float) o.optDouble("y");
        it.w = (float) o.optDouble("w");
        it.h = (float) o.optDouble("h");
        it.clipTop = (float) o.optDouble("ct", -1);
        it.clipBottom = (float) o.optDouble("cb", -1);
        it.hasLabel = o.optBoolean("hl", false);
        it.labelX = (float) o.optDouble("lx", 0);
        it.labelW = (float) o.optDouble("lw", 0);
        it.labelSize = (float) o.optDouble("ls", 14);
        it.labelColor = o.optInt("lc", Color.WHITE);
        it.avatar = o.optString("av");
        it.initial = o.optString("in");
        it.avX = (float) o.optDouble("avx", 0);
        it.avY = (float) o.optDouble("avy", 0);
        it.avW = (float) o.optDouble("avw", 0);
        JSONArray sh = o.optJSONArray("sh");
        if (sh != null) {
            for (int i = 0; i < sh.length(); i++) {
                JSONObject s = sh.optJSONObject(i);
                if (s == null) continue;
                Shape shape = new Shape();
                JSONArray ds = s.optJSONArray("d");
                int n = ds != null ? ds.length() : 0;
                shape.paths = new Path[n];
                for (int j = 0; j < n; j++) {
                    try {
                        shape.paths[j] = androidx.core.graphics.PathParser.createPathFromPathData(ds.optString(j));
                    } catch (Throwable ignored) {
                        shape.paths[j] = null;
                    }
                }
                shape.x = (float) s.optDouble("x");
                shape.y = (float) s.optDouble("y");
                shape.w = (float) s.optDouble("w");
                shape.h = (float) s.optDouble("h");
                shape.color = s.optInt("c", Color.WHITE);
                shape.stroke = (float) s.optDouble("sw", 2);
                shape.vbSize = (float) s.optDouble("vb", 24);
                it.shapes.add(shape);
            }
        }
        if (!it.avatar.isEmpty()) {
            final String url = it.avatar;
            final Item target = it;
            images.get(url, Math.max(64, Math.round(it.avW * k * 2)), Math.max(64, Math.round(it.avW * k * 2)), bmp -> {
                if (bmp == null) return;
                target.avatarBmp = bmp;
                body.invalidate();
            });
        }
        return it;
    }

    private int indexOf(String key) {
        if (key == null) return -1;
        String kk = key.startsWith(PREFIX) ? key.substring(PREFIX.length()) : key;
        for (int i = 0; i < items.size(); i++) if (items.get(i).key.equals(kk)) return i;
        return -1;
    }

    private int firstFocusable() {
        for (int i = 0; i < items.size(); i++) if (items.get(i).focusable) return i;
        return -1;
    }

    private String focusedKey() {
        if (!body.isFocused() || focusIdx < 0 || focusIdx >= items.size()) return null;
        return items.get(focusIdx).key;
    }

    boolean hasKey(String key) {
        return key != null && key.startsWith(PREFIX) && indexOf(key) >= 0;
    }

    boolean hasFocusInside() {
        return getVisibility() == VISIBLE && body.isFocused();
    }

    private void updateVisibility() {
        boolean any = !hidden && (navOn || clockOn);
        int want = any ? VISIBLE : GONE;
        if (getVisibility() != want) setVisibility(want);
        setAlpha(dimmed ? 0.3f : 1f);
    }

    void clear() {
        allowFocus(false);
        handler.removeCallbacks(notifyFocus);
        items.clear();
        labels.clear();
        rules.clear();
        ruleColors.clear();
        sig = "";
        navOn = false;
        clockOn = false;
        focusIdx = -1;
        setVisibility(GONE);
    }

    // ----- focus + keys ---------------------------------------------------------------

    private void allowFocus(boolean on) {
        setDescendantFocusability(on ? FOCUS_AFTER_DESCENDANTS : FOCUS_BLOCK_DESCENDANTS);
    }

    void focusKey(String key) {
        if (items.isEmpty()) return;
        if (android.os.SystemClock.uptimeMillis() - handoffAt < 300) return;
        int at = indexOf(key);
        if (at < 0 || !items.get(at).focusable) at = firstFocusable();
        if (at < 0) return;
        handedOff = false;
        focusIdx = at;
        allowFocus(true);
        body.requestFocus();
        body.invalidate();
        scheduleNotify();
    }

    private void scheduleNotify() {
        String key = focusedKey();
        if (key == null) return;
        notifyKey = key;
        handler.removeCallbacks(notifyFocus);
        handler.postDelayed(notifyFocus, FOCUS_NOTIFY_MS);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (getVisibility() == VISIBLE && body.isFocused() && handleKey(event)) return true;
        return super.dispatchKeyEvent(event);
    }

    private boolean handleKey(KeyEvent event) {
        int code = event.getKeyCode();
        boolean left = code == KeyEvent.KEYCODE_DPAD_LEFT;
        boolean right = code == KeyEvent.KEYCODE_DPAD_RIGHT;
        boolean up = code == KeyEvent.KEYCODE_DPAD_UP;
        boolean down = code == KeyEvent.KEYCODE_DPAD_DOWN;
        boolean ok = code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER || code == KeyEvent.KEYCODE_NUMPAD_ENTER;
        boolean menu = code == KeyEvent.KEYCODE_MENU;
        if (!(left || right || up || down || ok || menu)) return false;
        if (focusIdx < 0 || focusIdx >= items.size()) return true;
        if (menu) {
            // The remote's Menu key: same as holding OK (library options for a library row).
            if (event.getAction() == KeyEvent.ACTION_UP) listener.onLongPress(PREFIX + items.get(focusIdx).key);
            return true;
        }
        if (ok) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                if (event.getRepeatCount() == 0) okLong = false;
                else if (!okLong && (event.isLongPress() || event.getEventTime() - event.getDownTime() >= LONG_PRESS_MS)) {
                    // Held: the page shows the row's options (library scan); the release must not open it.
                    okLong = true;
                    listener.onLongPress(PREFIX + items.get(focusIdx).key);
                }
                return true;
            }
            if (okLong) {
                okLong = false;
                return true;
            }
            if (event.getRepeatCount() == 0) listener.onOpen(PREFIX + items.get(focusIdx).key);
            return true;
        }
        if (event.getAction() == KeyEvent.ACTION_UP) return true;
        long now = event.getEventTime();
        if (now - lastActivityAt > 250) {
            lastActivityAt = now;
            listener.onActivity();
        }
        if (left) return true;
        if (right) {
            if (event.getRepeatCount() == 0) {
                handedOff = true;
                handoffAt = android.os.SystemClock.uptimeMillis();
                listener.onHandoff("right", PREFIX + items.get(focusIdx).key);
                allowFocus(false);
                handler.removeCallbacks(notifyFocus);
                body.invalidate();
            }
            return true;
        }
        int step = up ? -1 : 1;
        int i = focusIdx + step;
        while (i >= 0 && i < items.size() && !items.get(i).focusable) i += step;
        if (i >= 0 && i < items.size()) {
            focusIdx = i;
            body.invalidate();
            scheduleNotify();
        }
        return true;
    }

    // ----- drawing --------------------------------------------------------------------

    private final class Body extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final TextPaint tp = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        private final RectF box = new RectF();
        private final Path scaled = new Path();
        private final android.graphics.Matrix matrix = new android.graphics.Matrix();

        Body(Context context) {
            super(context);
            setFocusable(true);
            setFocusableInTouchMode(false);
            setDefaultFocusHighlightEnabled(false);
        }

        @Override
        protected void onFocusChanged(boolean gainFocus, int direction, android.graphics.Rect previouslyFocusedRect) {
            super.onFocusChanged(gainFocus, direction, previouslyFocusedRect);
            if (gainFocus && (focusIdx < 0 || focusIdx >= items.size())) focusIdx = firstFocusable();
            invalidate();
            if (gainFocus) scheduleNotify();
        }

        @Override
        public boolean onTouchEvent(MotionEvent e) {
            if (!navOn || hidden) return false;
            float x = e.getX() / k;
            float y = e.getY() / k;
            if (e.getX() / k < rootX || e.getX() / k > rootX + rootW || e.getY() / k < rootY || e.getY() / k > rootY + rootH) return false;
            for (int i = 0; i < items.size(); i++) {
                Item it = items.get(i);
                if (x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h) {
                    if (e.getActionMasked() == MotionEvent.ACTION_UP) {
                        focusIdx = it.focusable ? i : focusIdx;
                        handedOff = false;
                        listener.onOpen(PREFIX + it.key);
                    }
                    return true;
                }
            }
            return false;
        }

        private void text(Canvas c, String s, float x, float cy, float size, int weight, int color, float spacing, float maxW, boolean center) {
            tp.setTypeface(NativeHomeView.font(getContext(), weight));
            tp.setTextSize(size * k);
            tp.setColor(color);
            tp.setLetterSpacing(spacing);
            String out = maxW > 0 ? TextUtils.ellipsize(s, tp, maxW, TextUtils.TruncateAt.END).toString() : s;
            float w = tp.measureText(out);
            Paint.FontMetrics fm = tp.getFontMetrics();
            c.drawText(out, center ? x - w / 2f : x, cy - (fm.ascent + fm.descent) / 2f, tp);
        }

        @Override
        protected void onDraw(Canvas c) {
            if (hidden) return;
            if (clockOn) drawClock(c);
            if (!navOn) return;
            boolean held = isFocused();
            // Panel.
            if (panelColor != 0) {
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(panelColor);
                box.set(rootX * k, rootY * k, (rootX + rootW) * k, (rootY + rootH) * k);
                c.drawRoundRect(box, rootRadius * k, rootRadius * k, paint);
            }
            c.save();
            // The web list clips at its box vertically only: icons may overhang sideways (the focus pill).
            c.clipRect(0, rootY * k, getWidth(), (rootY + rootH) * k);
            for (int i = 0; i < rules.size(); i++) {
                float[] r = rules.get(i);
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(ruleColors.get(i)[0]);
                c.drawRect(r[0] * k, r[1] * k, (r[0] + r[2]) * k, (r[1] + Math.max(1f, r[3])) * k, paint);
            }
            for (Text t : labels) {
                text(c, t.t.toUpperCase(), t.x * k, (t.y + t.h / 2f) * k, t.size, 700, t.color, t.spacing, t.w * k + 4f * k, false);
            }
            for (int i = 0; i < items.size(); i++) {
                Item it = items.get(i);
                if (it.clipTop >= 0f) {
                    c.save();
                    c.clipRect(0, it.clipTop * k, getWidth(), it.clipBottom * k);
                    drawItem(c, it, held && i == focusIdx);
                    c.restore();
                } else {
                    drawItem(c, it, held && i == focusIdx);
                }
            }
            c.restore();
        }

        private void drawItem(Canvas c, Item it, boolean focus) {
            float cy = (it.y + it.h / 2f) * k;
            if (focus) {
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(Color.WHITE);
                box.set(it.x * k, it.y * k, (it.x + it.w) * k, (it.y + it.h) * k);
                float r = Math.min(it.w, it.h) / 2f * k;
                c.drawRoundRect(box, r, r, paint);
            }
            int ink = Color.rgb(17, 17, 20);
            for (Shape s : it.shapes) drawShape(c, s, focus ? ink : s.color);
            if (it.avW > 0) drawAvatar(c, it, focus);
            if (it.hasLabel && !it.label.isEmpty()) {
                int col = focus ? ink : it.labelColor;
                text(c, it.label, it.labelX * k, cy, it.labelSize, 600, col, 0f, it.labelW * k + 2f * k, false);
            }
        }

        private void drawShape(Canvas c, Shape s, int color) {
            float sc = Math.min(s.w, s.h) / s.vbSize * k;
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(Math.max(1f, s.stroke * sc));
            paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setStrokeJoin(Paint.Join.ROUND);
            paint.setColor(color);
            for (Path p : s.paths) {
                if (p == null) continue;
                matrix.reset();
                matrix.setScale(sc, sc);
                matrix.postTranslate(s.x * k, s.y * k);
                scaled.reset();
                p.transform(matrix, scaled);
                c.drawPath(scaled, paint);
            }
            paint.setStyle(Paint.Style.FILL);
        }

        private void drawAvatar(Canvas c, Item it, boolean focus) {
            float d = it.avW * k;
            float cx = (it.avX + it.avW / 2f) * k;
            float cy = (it.avY + it.avW / 2f) * k;
            paint.setStyle(Paint.Style.FILL);
            if (it.avatarBmp != null) {
                BitmapShader sh = new BitmapShader(it.avatarBmp, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP);
                matrix.reset();
                float s = d / Math.min(it.avatarBmp.getWidth(), it.avatarBmp.getHeight());
                matrix.setScale(s, s);
                matrix.postTranslate(cx - it.avatarBmp.getWidth() * s / 2f, cy - it.avatarBmp.getHeight() * s / 2f);
                sh.setLocalMatrix(matrix);
                paint.setShader(sh);
                c.drawCircle(cx, cy, d / 2f, paint);
                paint.setShader(null);
            } else {
                paint.setColor(Color.argb(26, 255, 255, 255));
                c.drawCircle(cx, cy, d / 2f, paint);
                text(c, it.initial, cx, cy, it.avW * 0.55f, 800, focus ? Color.rgb(17, 17, 20) : Color.WHITE, 0f, 0f, true);
            }
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(Math.max(1f, k));
            paint.setColor(Color.argb(focus ? 60 : 51, focus ? 0 : 255, focus ? 0 : 255, focus ? 0 : 255));
            c.drawCircle(cx, cy, d / 2f, paint);
            paint.setStyle(Paint.Style.FILL);
        }

        private void drawClock(Canvas c) {
            clockTopPx = clkY * k;
            clockRightPx = getWidth() - (clkX + clkW) * k;
            clockWidthPx = clkW * k;
            clockHeightPx = clkH * k;
            clockTextPx = clkSize * k;
            clockBgColor = clkBg;
            clockTextColor = clkColor;
            clock24 = !clockText.matches("(?i).*\\b[ap]\\.?m\\.?(\\b.*|$)");
            clockKnown = clockWidthPx > 0;
            paint.setStyle(Paint.Style.FILL);
            if (clkBg != 0) {
                paint.setColor(clkBg);
                box.set(clkX * k, clkY * k, (clkX + clkW) * k, (clkY + clkH) * k);
                float r = clkH / 2f * k;
                c.drawRoundRect(box, r, r, paint);
            }
            text(c, clockText, (clkX + clkW / 2f) * k, (clkY + clkH / 2f) * k, clkSize, 500, clkColor, 0f, 0f, true);
        }
    }
}
