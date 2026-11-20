package com.servermanagerportal.mediaplayer;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.os.Handler;
import android.os.Looper;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.DecelerateInterpolator;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * The TV Settings screen drawn natively: header, tabs, rows (toggles, choices, hearts, inputs, buttons, reorder
 * rows) and Save / Discard. The web page stays mounted (invisible) and remains the source of truth: a payload
 * scraped from it describes the rows; Enter on a row asks the page to click the matching web twin. Sizes are in
 * "1920 units" (the screen width), the same numbers measured off the web rows.
 */
final class NativeSettingsView extends FrameLayout {

    static final String PREFIX = "settings~";
    private static final long FOCUS_NOTIFY_MS = 110;

    private static final class Row {
        String k = "";
        String t = "";
        String d = "";
        String v = "";
        String style = "";
        boolean on;
        boolean err;
        int n;
        int sel;
        String[] keys = new String[0];
        String[] labels = new String[0];
        boolean[] dis = new boolean[0];
        boolean focusable;
        // layout (px)
        float y;
        float h;
        StaticLayout titleL;
        StaticLayout descL;
        StaticLayout textL;
        float[] chipX = new float[0];
        float[] chipW = new float[0];
        float[] chipY = new float[0];
        float chipH;
    }

    private final NativeEpisodeRail.Listener listener;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<Row> rows = new ArrayList<>();
    private final Body body;
    private int accent = Color.rgb(245, 158, 11);
    private float k = 1f;
    private float u = 1f;
    private int rectW;
    private boolean rectKnown;
    private boolean suppressed;
    private long lastActivityAt;
    private String sig = "";
    private String editingKey = "";
    private int focusRow = -1;
    private int focusSub;
    private String notifyKey = "";
    private boolean handedOff;
    private long handoffAt;
    private float scrollY;
    private float contentH;
    private ValueAnimator scrollAnim;
    private int laidOutW = -1;

    private final Runnable notifyFocus = new Runnable() {
        @Override
        public void run() {
            if (!notifyKey.isEmpty() && body.isFocused() && !handedOff) listener.onFocus(PREFIX + notifyKey);
        }
    };

    NativeSettingsView(Context context, NativeEpisodeRail.Listener listener) {
        super(context);
        this.listener = listener;
        setVisibility(GONE);
        setFocusable(false);
        setClipChildren(true);
        setDescendantFocusability(FOCUS_BLOCK_DESCENDANTS);
        body = new Body(context);
        addView(body, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    // ----- data -----------------------------------------------------------------------

    void setData(JSONObject root) {
        String next = root.toString();
        if (next.equals(sig)) return;
        sig = next;
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
        editingKey = root.optString("editing", "");
        String heldKey = focusedSubKey();
        rows.clear();
        JSONArray arr = root.optJSONArray("rows");
        if (arr != null) {
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                Row r = new Row();
                r.k = o.optString("k");
                r.t = o.optString("t");
                r.d = o.optString("d");
                r.v = o.optString("v");
                r.style = o.optString("style");
                r.on = o.optBoolean("on", false);
                r.err = o.optBoolean("err", false);
                r.n = o.optInt("n", 0);
                r.sel = o.optInt("sel", 0);
                JSONArray ks = o.optJSONArray("keys");
                JSONArray ls = o.optJSONArray("labels");
                JSONArray ds = o.optJSONArray("dis");
                int cnt = ks != null ? ks.length() : 0;
                r.keys = new String[cnt];
                r.labels = new String[cnt];
                r.dis = new boolean[cnt];
                for (int j = 0; j < cnt; j++) {
                    r.keys[j] = ks.optString(j);
                    r.labels[j] = ls != null ? ls.optString(j) : "";
                    r.dis[j] = ds != null && ds.optBoolean(j, false);
                }
                r.focusable = cnt > 0;
                rows.add(r);
            }
        }
        laidOutW = -1;
        relayout();
        // Keep the remote on the same element after a rescan (a toggle flipped, a tab switched, a row moved).
        if (heldKey != null) {
            int[] at = find(heldKey);
            if (at != null) {
                focusRow = at[0];
                focusSub = at[1];
            } else if (focusRow >= rows.size() || focusRow < 0 || !rows.get(focusRow).focusable) {
                focusRow = firstFocusable();
                focusSub = 0;
            } else if (focusSub >= rows.get(focusRow).keys.length) {
                focusSub = 0;
            }
        }
        body.invalidate();
        updateVisibility();
    }

    private int[] find(String key) {
        if (key == null) return null;
        String kk = key.startsWith(PREFIX) ? key.substring(PREFIX.length()) : key;
        for (int i = 0; i < rows.size(); i++) {
            Row r = rows.get(i);
            for (int j = 0; j < r.keys.length; j++) if (r.keys[j].equals(kk)) return new int[]{i, j};
        }
        return null;
    }

    private String focusedSubKey() {
        if (!body.isFocused() || focusRow < 0 || focusRow >= rows.size()) return null;
        Row r = rows.get(focusRow);
        return focusSub >= 0 && focusSub < r.keys.length ? r.keys[focusSub] : null;
    }

    private int firstFocusable() {
        for (int i = 0; i < rows.size(); i++) if (rows.get(i).focusable) return i;
        return -1;
    }

    // ----- geometry -------------------------------------------------------------------

    /** The settings column's place: x / width in the page's layout px ({@code vw} = the page's layout width). */
    void setRect(float x, float y, float w, float h, float vw) {
        View parent = (View) getParent();
        if (parent == null || vw <= 0 || parent.getWidth() <= 0) return;
        k = parent.getWidth() / vw;
        u = parent.getWidth() / 1920f;
        int pw = Math.max(1, Math.round(w * k));
        if (pw != rectW) {
            rectW = pw;
            setLayoutParams(new FrameLayout.LayoutParams(pw, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.TOP | Gravity.START));
            laidOutW = -1;
            relayout();
        }
        setTranslationX(x * k);
        rectKnown = true;
        updateVisibility();
    }

    private void updateVisibility() {
        int want = rectKnown && !rows.isEmpty() ? VISIBLE : GONE;
        if (getVisibility() != want) setVisibility(want);
    }

    void setSuppressed(boolean on) {
        suppressed = on;
        setAlpha(on ? 0f : 1f);
    }

    void clear() {
        allowFocus(false);
        handler.removeCallbacks(notifyFocus);
        rectKnown = false;
        setSuppressed(false);
        rows.clear();
        sig = "";
        focusRow = -1;
        scrollY = 0;
        rectW = 0;
        setVisibility(GONE);
    }

    boolean hasKey(String key) {
        return find(key) != null;
    }

    boolean hasFocusInside() {
        return getVisibility() == VISIBLE && body.isFocused();
    }

    private final TextPaint tp = new TextPaint(Paint.ANTI_ALIAS_FLAG);

    private TextPaint paintFor(float size, int weight, int color, float spacingEm) {
        TextPaint p = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        p.setTypeface(NativeHomeView.font(getContext(), weight));
        p.setTextSize(size * u);
        p.setColor(color);
        p.setLetterSpacing(spacingEm);
        return p;
    }

    private StaticLayout wrap(String text, TextPaint p, int width) {
        return StaticLayout.Builder.obtain(text, 0, text.length(), p, Math.max(1, width))
            .setAlignment(Layout.Alignment.ALIGN_NORMAL).setLineSpacing(0f, 1f).setIncludePad(false).build();
    }

    private static final float PAD_X = 30f;
    private static final float PAD_Y = 20f;
    private static final float GAP = 12f;
    private static final float TITLE = 22f;
    private static final float DESC = 17.5f;

    private void relayout() {
        if (u <= 0 || rectW <= 0) return;
        float W = rectW;
        float y = 56 * u;
        Row prev = null;
        for (Row r : rows) {
            float gapBefore = 0;
            switch (r.k) {
                case "eyebrow": {
                    TextPaint p = paintFor(14, 900, Color.WHITE, 0.2f);
                    r.titleL = wrap(r.t.toUpperCase(), p, (int) W);
                    r.h = r.titleL.getHeight();
                    break;
                }
                case "title": {
                    TextPaint p = paintFor(46, 900, Color.WHITE, -0.01f);
                    r.titleL = wrap(r.t, p, (int) W);
                    r.h = r.titleL.getHeight();
                    gapBefore = 6;
                    break;
                }
                case "hint": {
                    TextPaint p = paintFor(DESC + 2, 400, Color.argb(140, 255, 255, 255), 0f);
                    r.titleL = wrap(r.t, p, (int) W);
                    r.h = r.titleL.getHeight();
                    gapBefore = 10;
                    break;
                }
                case "tabs": {
                    gapBefore = 30;
                    layoutTabs(r, W);
                    break;
                }
                case "h": {
                    TextPaint p = paintFor(15, 900, Color.argb(140, 255, 255, 255), 0.18f);
                    r.titleL = wrap(r.t.toUpperCase(), p, (int) W);
                    r.h = r.titleL.getHeight();
                    gapBefore = 16;
                    break;
                }
                case "p":
                case "status":
                case "ver": {
                    boolean ver = r.k.equals("ver");
                    TextPaint p = paintFor(ver ? 16 : DESC, r.k.equals("status") ? 700 : 400,
                        r.err ? Color.rgb(248, 113, 113) : Color.argb(ver ? 110 : 150, 255, 255, 255), 0f);
                    r.titleL = wrap(r.t, p, (int) W);
                    r.h = r.titleL.getHeight();
                    gapBefore = ver ? 30 : 2;
                    break;
                }
                case "toggle":
                case "choice":
                case "heart": {
                    layoutRow(r, W);
                    break;
                }
                case "input": {
                    TextPaint p = paintFor(TITLE - 2, 700, Color.WHITE, 0f);
                    r.titleL = wrap(r.t, p, (int) W);
                    r.h = r.titleL.getHeight() + 10 * u + 70 * u;
                    break;
                }
                case "btn": {
                    r.h = 60 * u;
                    break;
                }
                case "reorder": {
                    r.h = 72 * u;
                    break;
                }
                case "save": {
                    r.h = 56 * u;
                    gapBefore = 22;
                    break;
                }
                default:
                    r.h = 0;
            }
            if (prev != null) {
                boolean card = isCard(r) && isCard(prev);
                y += (card ? GAP : gapBefore + (isCard(prev) && !isCard(r) ? 10 : 0)) * u;
                if (!card && gapBefore == 0) y += 4 * u;
            }
            r.y = y;
            y += r.h;
            prev = r;
        }
        contentH = y + 120 * u;
        laidOutW = rectW;
        clampScroll();
    }

    private static boolean isCard(Row r) {
        switch (r.k) {
            case "toggle": case "choice": case "heart": case "btn": case "reorder": case "input": return true;
            default: return false;
        }
    }

    private void layoutRow(Row r, float W) {
        float rightW;
        if (r.k.equals("toggle")) {
            TextPaint p = paintFor(17.5f, 900, Color.WHITE, 0.12f);
            rightW = p.measureText("OFF") + 18 * u + 68 * u;
        } else if (r.k.equals("choice")) {
            TextPaint p = paintFor(20, 700, Color.WHITE, 0f);
            rightW = Math.min(W * 0.4f, p.measureText(r.v) + 24 * u * 2 + 20 * u);
        } else {
            rightW = 36 * u;
        }
        float textW = W - 2 * PAD_X * u - rightW - 24 * u;
        r.titleL = wrap(r.t, paintFor(TITLE, 700, Color.WHITE, 0f), (int) textW);
        r.descL = r.d.isEmpty() ? null : wrap(r.d, paintFor(DESC, 400, Color.argb(150, 255, 255, 255), 0f), (int) textW);
        float inner = r.titleL.getHeight() + (r.descL != null ? 6 * u + r.descL.getHeight() : 0);
        r.h = Math.max(inner + 2 * PAD_Y * u, 78 * u);
    }

    private void layoutTabs(Row r, float W) {
        int n = r.labels.length;
        r.chipX = new float[n];
        r.chipW = new float[n];
        r.chipY = new float[n];
        TextPaint p = paintFor(23, 700, Color.WHITE, 0f);
        float cx = 0;
        float cy = 0;
        float ch = 56 * u;
        r.chipH = ch;
        float gap = 8 * u;
        for (int i = 0; i < n; i++) {
            float w = p.measureText(r.labels[i]) + 2 * 26 * u;
            if (cx > 0 && cx + w > W) {
                cx = 0;
                cy += ch + gap;
            }
            r.chipX[i] = cx;
            r.chipW[i] = w;
            r.chipY[i] = cy;
            cx += w + gap;
        }
        r.h = cy + ch;
    }

    // ----- focus + keys ---------------------------------------------------------------

    private void allowFocus(boolean on) {
        setDescendantFocusability(on ? FOCUS_AFTER_DESCENDANTS : FOCUS_BLOCK_DESCENDANTS);
    }

    void focusKey(String key) {
        if (rows.isEmpty()) return;
        if (android.os.SystemClock.uptimeMillis() - handoffAt < 300) return;
        int[] at = find(key);
        if (at == null) {
            int f = firstFocusable();
            if (f < 0) return;
            at = new int[]{f, 0};
        }
        handedOff = false;
        focusRow = at[0];
        focusSub = at[1];
        allowFocus(true);
        body.requestFocus();
        ensureVisible(false);
        body.invalidate();
        scheduleNotify();
    }

    private void scheduleNotify() {
        String key = focusedSubKey();
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
        if (!(left || right || up || down || ok)) return false;
        if (focusRow < 0 || focusRow >= rows.size()) return true;
        if (ok) {
            if (event.getAction() == KeyEvent.ACTION_UP && event.getRepeatCount() == 0) activate();
            return true;
        }
        if (event.getAction() == KeyEvent.ACTION_UP) return true;
        long now = event.getEventTime();
        if (now - lastActivityAt > 250) {
            lastActivityAt = now;
            listener.onActivity();
        }
        Row r = rows.get(focusRow);
        if (up || down) {
            int to = nextRow(focusRow, up ? -1 : 1);
            if (to >= 0) {
                focusRow = to;
                focusSub = Math.min(focusSub, rows.get(to).keys.length - 1);
                if (rows.get(to).k.equals("tabs")) focusSub = Math.max(0, rows.get(to).sel);
                if (!rows.get(to).k.equals("tabs") && !rows.get(to).k.equals("reorder") && !rows.get(to).k.equals("save")) focusSub = 0;
                ensureVisible(true);
                body.invalidate();
                scheduleNotify();
            }
            return true;
        }
        if (right && focusSub + 1 < r.keys.length) {
            focusSub++;
            ensureVisible(true);
            body.invalidate();
            scheduleNotify();
            return true;
        }
        if (left && focusSub > 0) {
            focusSub--;
            body.invalidate();
            scheduleNotify();
            return true;
        }
        if (left && event.getRepeatCount() == 0) {
            String key = r.keys[Math.max(0, Math.min(focusSub, r.keys.length - 1))];
            handedOff = true;
            handoffAt = android.os.SystemClock.uptimeMillis();
            listener.onHandoff("left", PREFIX + key);
            allowFocus(false);
            handler.removeCallbacks(notifyFocus);
        }
        return true;
    }

    private int nextRow(int from, int dir) {
        int i = from + dir;
        while (i >= 0 && i < rows.size()) {
            if (rows.get(i).focusable) return i;
            i += dir;
        }
        return -1;
    }

    private void activate() {
        String key = focusedSubKey();
        if (key == null) return;
        Row r = rows.get(focusRow);
        if (r.k.equals("tabs")) return; // the tab already switched on focus
        if (focusSub < r.dis.length && r.dis[focusSub] && !r.k.equals("save")) return;
        listener.onOpen(PREFIX + key);
    }

    // ----- scrolling ------------------------------------------------------------------

    private float maxScroll() {
        return Math.max(0f, contentH - getHeight());
    }

    private void clampScroll() {
        scrollY = Math.max(0f, Math.min(scrollY, maxScroll()));
    }

    private void ensureVisible(boolean animate) {
        if (focusRow < 0 || focusRow >= rows.size() || getHeight() <= 0) return;
        Row r = rows.get(focusRow);
        float margin = 150 * u;
        float top = r.y;
        float bottom = r.y + r.h;
        float target = scrollY;
        if (focusRow == firstFocusable()) target = 0;
        else if (top - margin < scrollY) target = top - margin;
        else if (bottom + margin > scrollY + getHeight()) target = bottom + margin - getHeight();
        target = Math.max(0f, Math.min(target, maxScroll()));
        if (Math.abs(target - scrollY) < 1f) return;
        if (scrollAnim != null) scrollAnim.cancel();
        if (!animate) {
            scrollY = target;
            return;
        }
        scrollAnim = ValueAnimator.ofFloat(scrollY, target);
        scrollAnim.setDuration(170);
        scrollAnim.setInterpolator(new DecelerateInterpolator());
        scrollAnim.addUpdateListener(a -> {
            scrollY = (float) a.getAnimatedValue();
            body.invalidate();
        });
        scrollAnim.start();
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        super.onSizeChanged(w, h, oldw, oldh);
        clampScroll();
    }

    // ----- drawing --------------------------------------------------------------------

    private final class Body extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF box = new RectF();
        private final Path path = new Path();
        private float downY;
        private float downScroll;
        private boolean dragging;

        Body(Context context) {
            super(context);
            setFocusable(true);
            setFocusableInTouchMode(false);
            setDefaultFocusHighlightEnabled(false);
        }

        @Override
        protected void onFocusChanged(boolean gainFocus, int direction, android.graphics.Rect previouslyFocusedRect) {
            super.onFocusChanged(gainFocus, direction, previouslyFocusedRect);
            if (gainFocus && (focusRow < 0 || focusRow >= rows.size())) {
                focusRow = firstFocusable();
                focusSub = 0;
            }
            invalidate();
            if (gainFocus) scheduleNotify();
        }

        @Override
        public boolean onTouchEvent(MotionEvent e) {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downY = e.getY();
                    downScroll = scrollY;
                    dragging = false;
                    return true;
                case MotionEvent.ACTION_MOVE:
                    if (Math.abs(e.getY() - downY) > 12 * u) dragging = true;
                    if (dragging) {
                        scrollY = downScroll + (downY - e.getY());
                        clampScroll();
                        invalidate();
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                    if (!dragging) tap(e.getX(), e.getY() + scrollY);
                    return true;
                default:
                    return true;
            }
        }

        private void tap(float x, float y) {
            for (int i = 0; i < rows.size(); i++) {
                Row r = rows.get(i);
                if (!r.focusable || y < r.y || y > r.y + r.h) continue;
                int sub = 0;
                if (r.k.equals("tabs")) {
                    for (int j = 0; j < r.chipX.length; j++) {
                        if (x >= r.chipX[j] && x <= r.chipX[j] + r.chipW[j] && y >= r.y + r.chipY[j] && y <= r.y + r.chipY[j] + r.chipH) sub = j;
                    }
                } else if (r.k.equals("reorder")) {
                    sub = x > getWidth() - 100 * u ? 1 : (x > getWidth() - 170 * u ? 0 : -1);
                    if (sub < 0) return;
                } else if (r.k.equals("save")) {
                    sub = x > 260 * u ? 1 : 0;
                }
                sub = Math.min(sub, r.keys.length - 1);
                focusRow = i;
                focusSub = sub;
                handedOff = false;
                allowFocus(true);
                requestFocus();
                invalidate();
                scheduleNotify();
                if (!r.k.equals("tabs")) listener.onOpen(PREFIX + r.keys[sub]);
                return;
            }
        }

        private float baseline(float cy, TextPaint p) {
            Paint.FontMetrics fm = p.getFontMetrics();
            return cy - (fm.ascent + fm.descent) / 2f;
        }

        private void text(Canvas c, String s, float x, float cy, float size, int weight, int color, float spacing, boolean right, float maxW) {
            tp.setTypeface(NativeHomeView.font(getContext(), weight));
            tp.setTextSize(size * u);
            tp.setColor(color);
            tp.setLetterSpacing(spacing);
            String out = maxW > 0 ? TextUtils.ellipsize(s, tp, maxW, TextUtils.TruncateAt.END).toString() : s;
            float w = tp.measureText(out);
            c.drawText(out, right ? x - w : x, baseline(cy, tp), tp);
        }

        private void drawLayout(Canvas c, StaticLayout l, float x, float y, int color) {
            if (l == null) return;
            c.save();
            c.translate(x, y);
            l.getPaint().setColor(color);
            l.draw(c);
            c.restore();
        }

        @Override
        protected void onDraw(Canvas c) {
            if (laidOutW != rectW) relayout();
            boolean held = isFocused();
            float W = getWidth();
            float top = scrollY;
            float bot = scrollY + getHeight();
            c.save();
            c.translate(0, -scrollY);
            for (int i = 0; i < rows.size(); i++) {
                Row r = rows.get(i);
                if (r.y + r.h < top - 20 || r.y > bot + 20) continue;
                boolean rowFocus = held && i == focusRow;
                switch (r.k) {
                    case "eyebrow":
                        drawLayout(c, r.titleL, 0, r.y, accent);
                        break;
                    case "title":
                        drawLayout(c, r.titleL, 0, r.y, Color.WHITE);
                        break;
                    case "hint":
                    case "h":
                    case "p":
                    case "status":
                    case "ver":
                        drawLayout(c, r.titleL, 0, r.y, r.titleL.getPaint().getColor());
                        break;
                    case "tabs":
                        drawTabs(c, r, rowFocus);
                        break;
                    case "toggle":
                    case "choice":
                    case "heart":
                        drawCard(c, r, W, rowFocus);
                        break;
                    case "input":
                        drawInput(c, r, W, rowFocus);
                        break;
                    case "btn":
                        drawButton(c, r, W, rowFocus);
                        break;
                    case "reorder":
                        drawReorder(c, r, W, rowFocus);
                        break;
                    case "save":
                        drawSave(c, r, W, rowFocus);
                        break;
                    default:
                        break;
                }
            }
            c.restore();
        }

        private void card(Canvas c, Row r, float W, boolean focus, int tint) {
            float rad = 20 * u;
            box.set(0, r.y, W, r.y + r.h);
            paint.setStyle(Paint.Style.FILL);
            if (focus) {
                paint.setColor(Color.WHITE);
                c.drawRoundRect(box, rad, rad, paint);
                return;
            }
            paint.setColor(tint != 0 ? tint : Color.argb(13, 255, 255, 255));
            c.drawRoundRect(box, rad, rad, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(Math.max(1f, u));
            paint.setColor(Color.argb(26, 255, 255, 255));
            box.set(u / 2f, r.y + u / 2f, W - u / 2f, r.y + r.h - u / 2f);
            c.drawRoundRect(box, rad, rad, paint);
        }

        private void drawCard(Canvas c, Row r, float W, boolean focus) {
            int ink = focus ? Color.rgb(24, 24, 27) : Color.WHITE;
            int muted = focus ? Color.argb(150, 24, 24, 27) : Color.argb(150, 255, 255, 255);
            int tint = 0;
            if (r.k.equals("heart") && r.on) {
                tint = Color.argb(26, Color.red(accent), Color.green(accent), Color.blue(accent));
            }
            card(c, r, W, focus, tint);
            if (r.k.equals("heart") && r.on && !focus) {
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(Math.max(1f, u));
                paint.setColor(Color.argb(102, Color.red(accent), Color.green(accent), Color.blue(accent)));
                box.set(u / 2f, r.y + u / 2f, W - u / 2f, r.y + r.h - u / 2f);
                c.drawRoundRect(box, 20 * u, 20 * u, paint);
            }
            float inner = r.titleL.getHeight() + (r.descL != null ? 6 * u + r.descL.getHeight() : 0);
            float ty = r.y + (r.h - inner) / 2f;
            drawLayout(c, r.titleL, PAD_X * u, ty, ink);
            if (r.descL != null) drawLayout(c, r.descL, PAD_X * u, ty + r.titleL.getHeight() + 6 * u, muted);
            float cy = r.y + r.h / 2f;
            float right = W - PAD_X * u;
            if (r.k.equals("toggle")) {
                float sw = 68 * u;
                float sh = 40 * u;
                box.set(right - sw, cy - sh / 2f, right, cy + sh / 2f);
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(r.on ? accent : (focus ? Color.argb(77, 24, 24, 27) : Color.argb(51, 255, 255, 255)));
                c.drawRoundRect(box, sh / 2f, sh / 2f, paint);
                float kn = 30 * u;
                float kx = right - sw + 5 * u + (r.on ? 28 * u : 0);
                paint.setColor(Color.WHITE);
                c.drawCircle(kx + kn / 2f, cy, kn / 2f, paint);
                String label = r.on ? "ON" : "OFF";
                text(c, label, right - sw - 18 * u, cy, 17.5f, 900, r.on ? accent : (focus ? Color.argb(140, 24, 24, 27) : Color.argb(150, 255, 255, 255)), 0.12f, true, 0);
            } else if (r.k.equals("choice")) {
                tp.setTypeface(NativeHomeView.font(getContext(), 700));
                tp.setTextSize(20 * u);
                tp.setLetterSpacing(0f);
                float maxW = W * 0.4f - 24 * u * 2 - 20 * u;
                String shown = TextUtils.ellipsize(r.v, tp, maxW, TextUtils.TruncateAt.END).toString();
                float tw = tp.measureText(shown);
                float chipW = tw + 24 * u * 2 + 20 * u;
                float chipH = 46 * u;
                box.set(right - chipW, cy - chipH / 2f, right, cy + chipH / 2f);
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(focus ? Color.argb(26, 24, 24, 27) : Color.argb(26, 255, 255, 255));
                c.drawRoundRect(box, chipH / 2f, chipH / 2f, paint);
                text(c, shown, right - chipW + 24 * u, cy, 20, 700, focus ? Color.rgb(24, 24, 27) : Color.argb(230, 255, 255, 255), 0f, false, 0);
                float ax = right - 24 * u - 6 * u;
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(2.6f * u);
                paint.setStrokeCap(Paint.Cap.ROUND);
                paint.setColor(focus ? Color.argb(130, 24, 24, 27) : Color.argb(130, 255, 255, 255));
                path.reset();
                path.moveTo(ax - 5 * u, cy - 7 * u);
                path.lineTo(ax + 2 * u, cy);
                path.lineTo(ax - 5 * u, cy + 7 * u);
                c.drawPath(path, paint);
            } else {
                drawHeart(c, right - 14 * u, cy, 13 * u, r.on, focus ? Color.rgb(24, 24, 27) : (r.on ? accent : Color.argb(150, 255, 255, 255)));
            }
        }

        private void drawHeart(Canvas c, float cx, float cy, float s, boolean filled, int color) {
            path.reset();
            path.moveTo(cx, cy + s * 0.95f);
            path.cubicTo(cx - s * 1.9f, cy - s * 0.1f, cx - s * 0.95f, cy - s * 1.35f, cx, cy - s * 0.35f);
            path.cubicTo(cx + s * 0.95f, cy - s * 1.35f, cx + s * 1.9f, cy - s * 0.1f, cx, cy + s * 0.95f);
            path.close();
            paint.setColor(color);
            paint.setStrokeJoin(Paint.Join.ROUND);
            paint.setStrokeWidth(2.2f * u);
            paint.setStyle(filled ? Paint.Style.FILL_AND_STROKE : Paint.Style.STROKE);
            c.drawPath(path, paint);
        }

        private void drawInput(Canvas c, Row r, float W, boolean focus) {
            drawLayout(c, r.titleL, 0, r.y, Color.WHITE);
            float by = r.y + r.titleL.getHeight() + 10 * u;
            float bh = 70 * u;
            boolean editing = !editingKey.isEmpty() && r.keys.length > 0 && editingKey.equals(r.keys[0]);
            box.set(0, by, W, by + bh);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.argb(102, 0, 0, 0));
            c.drawRoundRect(box, 20 * u, 20 * u, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(Math.max(1f, (focus || editing ? 2.5f : 1f) * u));
            paint.setColor(focus || editing ? Color.argb(230, Color.red(accent), Color.green(accent), Color.blue(accent)) : Color.argb(38, 255, 255, 255));
            box.inset(u / 2f, u / 2f);
            c.drawRoundRect(box, 20 * u, 20 * u, paint);
            boolean empty = r.v.isEmpty();
            String shown = empty ? r.d : r.v;
            text(c, editing ? shown + "|" : shown, 30 * u, by + bh / 2f, 20, 400, empty && !editing ? Color.argb(100, 255, 255, 255) : Color.WHITE, 0f, false, W - 60 * u);
        }

        private void drawButton(Canvas c, Row r, float W, boolean focus) {
            card(c, r, W, focus, 0);
            int color = focus ? Color.rgb(24, 24, 27) : ("accent".equals(r.style) ? accent : Color.argb(150, 255, 255, 255));
            tp.setTypeface(NativeHomeView.font(getContext(), 700));
            tp.setTextSize(20 * u);
            tp.setLetterSpacing(0f);
            float tw = tp.measureText(r.t);
            text(c, r.t, (W - tw) / 2f, r.y + r.h / 2f, 20, 700, color, 0f, false, W - 60 * u);
        }

        private void drawReorder(Canvas c, Row r, float W, boolean rowFocus) {
            float cy = r.y + r.h / 2f;
            float rad = 22 * u;
            box.set(0, r.y, W, r.y + r.h);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.argb(13, 255, 255, 255));
            c.drawRoundRect(box, rad, rad, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(Math.max(1f, u));
            paint.setColor(Color.argb(26, 255, 255, 255));
            box.inset(u / 2f, u / 2f);
            c.drawRoundRect(box, rad, rad, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.argb(26, 255, 255, 255));
            c.drawCircle(46 * u, cy, 16 * u, paint);
            tp.setTypeface(NativeHomeView.font(getContext(), 700));
            tp.setTextSize(16 * u);
            float nw = tp.measureText(String.valueOf(r.n));
            text(c, String.valueOf(r.n), 46 * u - nw / 2f, cy, 16, 700, Color.argb(210, 255, 255, 255), 0f, false, 0);
            text(c, r.t, 82 * u, cy, 20, 700, Color.WHITE, 0f, false, W - 82 * u - 190 * u);
            for (int s = 0; s < 2; s++) {
                float bx = W - 36 * u - s * 0f - (1 - s) * 68 * u;
                bx = W - 96 * u + s * 62 * u;
                boolean f = rowFocus && focusSub == s;
                boolean dis = s < r.dis.length && r.dis[s];
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(f ? Color.WHITE : Color.argb(dis ? 8 : 13, 255, 255, 255));
                c.drawCircle(bx, cy, 22 * u, paint);
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(2.6f * u);
                paint.setStrokeCap(Paint.Cap.ROUND);
                paint.setStrokeJoin(Paint.Join.ROUND);
                paint.setColor(f ? Color.rgb(24, 24, 27) : Color.argb(dis ? 70 : 160, 255, 255, 255));
                path.reset();
                float d = s == 0 ? 1f : -1f;
                path.moveTo(bx - 8 * u, cy + d * 3 * u);
                path.lineTo(bx, cy - d * 5 * u);
                path.lineTo(bx + 8 * u, cy + d * 3 * u);
                c.drawPath(path, paint);
            }
        }

        private void drawSave(Canvas c, Row r, float W, boolean rowFocus) {
            String[] labels = r.labels;
            float x = 0;
            float h = r.h;
            for (int s = 0; s < labels.length; s++) {
                tp.setTypeface(NativeHomeView.font(getContext(), 700));
                tp.setTextSize(20 * u);
                tp.setLetterSpacing(0f);
                float w = tp.measureText(labels[s]) + 2 * 30 * u + (s == 0 ? 36 * u : 0);
                boolean f = rowFocus && focusSub == s;
                boolean dis = s < r.dis.length && r.dis[s];
                box.set(x, r.y, x + w, r.y + h);
                paint.setStyle(Paint.Style.FILL);
                if (s == 0) {
                    paint.setColor(accent);
                } else {
                    paint.setColor(Color.argb(13, 255, 255, 255));
                }
                paint.setAlpha(dis ? 110 : 255);
                if (s != 0) paint.setColor(Color.argb(dis ? 8 : 13, 255, 255, 255));
                c.drawRoundRect(box, 14 * u, 14 * u, paint);
                if (s != 0) {
                    paint.setStyle(Paint.Style.STROKE);
                    paint.setStrokeWidth(Math.max(1f, u));
                    paint.setColor(Color.argb(dis ? 20 : 38, 255, 255, 255));
                    box.inset(u / 2f, u / 2f);
                    c.drawRoundRect(box, 14 * u, 14 * u, paint);
                    box.inset(-u / 2f, -u / 2f);
                }
                if (f) {
                    paint.setStyle(Paint.Style.STROKE);
                    paint.setStrokeWidth(4 * u);
                    paint.setColor(Color.WHITE);
                    box.inset(2 * u, 2 * u);
                    c.drawRoundRect(box, 12 * u, 12 * u, paint);
                }
                int ink = s == 0 ? Color.WHITE : Color.WHITE;
                text(c, labels[s], x + (s == 0 ? 30 * u + 36 * u : 30 * u), r.y + h / 2f, 20, 700, Color.argb(dis ? 120 : 255, Color.red(ink), Color.green(ink), Color.blue(ink)), 0f, false, 0);
                if (s == 0) drawDisk(c, x + 30 * u + 10 * u, r.y + h / 2f, 10 * u, Color.argb(dis ? 120 : 255, 255, 255, 255));
                x += w + 12 * u;
            }
        }

        private void drawDisk(Canvas c, float cx, float cy, float s, int color) {
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(2.2f * u);
            paint.setColor(color);
            box.set(cx - s, cy - s, cx + s, cy + s);
            c.drawRoundRect(box, 3 * u, 3 * u, paint);
            box.set(cx - s * 0.5f, cy - s, cx + s * 0.5f, cy - s * 0.2f);
            c.drawRect(box, paint);
        }

        private void drawTabs(Canvas c, Row r, boolean rowFocus) {
            for (int i = 0; i < r.labels.length; i++) {
                boolean f = rowFocus && focusSub == i;
                boolean sel = i == r.sel;
                float x = r.chipX[i];
                float y = r.y + r.chipY[i];
                box.set(x, y, x + r.chipW[i], y + r.chipH);
                if (f) {
                    paint.setStyle(Paint.Style.FILL);
                    paint.setColor(Color.WHITE);
                    c.drawRoundRect(box, r.chipH / 2f, r.chipH / 2f, paint);
                }
                int ink = f ? Color.rgb(24, 24, 27) : (sel ? Color.WHITE : Color.argb(140, 255, 255, 255));
                text(c, r.labels[i], x + 26 * u, y + r.chipH / 2f, 23, 700, ink, 0f, false, 0);
            }
        }
    }
}
