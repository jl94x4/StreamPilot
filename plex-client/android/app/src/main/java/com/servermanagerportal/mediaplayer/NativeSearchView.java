package com.servermanagerportal.mediaplayer;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.os.Handler;
import android.os.Looper;
import android.text.TextPaint;
import android.text.TextUtils;
import android.view.Gravity;
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
 * The TV search screen's left panel drawn natively: the title, what has been typed (with a blinking caret) and the
 * on-screen keyboard. The web panel stays mounted (invisible) and stays the source of truth: its keys are measured
 * into the payload (so the native keys sit exactly where the web ones are) and Enter on a key asks the page to click
 * the matching web twin. Sizes arrive in the page's layout px; {@code k} scales them to the screen.
 */
final class NativeSearchView extends FrameLayout {

    static final String PREFIX = "search~";
    private static final long FOCUS_NOTIFY_MS = 90;

    private static final class Key {
        String key = "";
        String label = "";
        boolean action;
        boolean back;
        int row;
        float x;
        float y;
        float w;
        float h;
    }

    private final NativeEpisodeRail.Listener listener;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<Key> keys = new ArrayList<>();
    private final Body body;
    private int accent = Color.rgb(245, 158, 11);
    private float k = 1f;
    private boolean rectKnown;
    private boolean suppressed;
    private long lastActivityAt;
    private String sig = "";
    private int focusIdx = -1;
    private String notifyKey = "";
    private boolean handedOff;
    private long handoffAt;
    private boolean caretOn = true;
    private int rectW;
    private int rectH;

    private String eyebrow = "";
    private String query = "";
    private String placeholder = "";
    private boolean empty = true;
    private float eyeX;
    private float eyeY;
    private float eyeH;
    private float eyeSize = 13f;
    private float qX;
    private float qY;
    private float qW;
    private float qH;
    private float qSize = 33f;
    private float keySize = 19f;
    private float actionSize = 15f;
    private float keyRadius = 12f;

    private final Runnable notifyFocus = new Runnable() {
        @Override
        public void run() {
            if (!notifyKey.isEmpty() && body.isFocused() && !handedOff) listener.onFocus(PREFIX + notifyKey);
        }
    };

    private final Runnable blink = new Runnable() {
        @Override
        public void run() {
            caretOn = !caretOn;
            body.invalidate(0, Math.max(0, Math.round((qY - 2) * k)), Math.max(1, rectW), Math.round((qY + qH + 2) * k));
            if (getVisibility() == VISIBLE && !suppressed) handler.postDelayed(this, 525);
        }
    };

    NativeSearchView(Context context, NativeEpisodeRail.Listener listener) {
        super(context);
        this.listener = listener;
        setVisibility(GONE);
        setFocusable(false);
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
        eyebrow = root.optString("eyebrow", "");
        query = root.optString("query", "");
        placeholder = root.optString("placeholder", "");
        empty = root.optBoolean("empty", query.trim().isEmpty());
        eyeX = (float) root.optDouble("eyeX", 0);
        eyeY = (float) root.optDouble("eyeY", 0);
        eyeH = (float) root.optDouble("eyeH", 20);
        eyeSize = (float) root.optDouble("eyeSize", 13);
        qX = (float) root.optDouble("qX", 0);
        qY = (float) root.optDouble("qY", 0);
        qW = (float) root.optDouble("qW", 300);
        qH = (float) root.optDouble("qH", 56);
        qSize = (float) root.optDouble("qSize", 33);
        keySize = (float) root.optDouble("keySize", 19);
        actionSize = (float) root.optDouble("actionSize", 15);
        keyRadius = (float) root.optDouble("radius", 12);
        String held = focusedKey();
        keys.clear();
        JSONArray arr = root.optJSONArray("keys");
        if (arr != null) {
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                Key kk = new Key();
                kk.key = o.optString("k");
                kk.label = o.optString("l");
                kk.action = o.optBoolean("a", false);
                kk.back = "backspace".equals(kk.key);
                kk.row = o.optInt("r", 0);
                kk.x = (float) o.optDouble("x", 0);
                kk.y = (float) o.optDouble("y", 0);
                kk.w = (float) o.optDouble("w", 40);
                kk.h = (float) o.optDouble("h", 40);
                keys.add(kk);
            }
        }
        if (held != null) {
            int at = indexOf(held);
            focusIdx = at >= 0 ? at : (keys.isEmpty() ? -1 : 0);
        }
        body.invalidate();
        updateVisibility();
    }

    private int indexOf(String key) {
        if (key == null) return -1;
        String kk = key.startsWith(PREFIX) ? key.substring(PREFIX.length()) : key;
        for (int i = 0; i < keys.size(); i++) if (keys.get(i).key.equals(kk)) return i;
        return -1;
    }

    private String focusedKey() {
        if (!body.isFocused() || focusIdx < 0 || focusIdx >= keys.size()) return null;
        return keys.get(focusIdx).key;
    }

    boolean hasKey(String key) {
        return indexOf(key) >= 0;
    }

    boolean hasFocusInside() {
        return getVisibility() == VISIBLE && body.isFocused();
    }

    // ----- geometry -------------------------------------------------------------------

    /** The panel's place in the page's layout px ({@code vw} = the page's layout width). */
    void setRect(float x, float y, float w, float h, float vw) {
        View parent = (View) getParent();
        if (parent == null || vw <= 0 || parent.getWidth() <= 0) return;
        k = parent.getWidth() / vw;
        int pw = Math.max(1, Math.round(w * k));
        int ph = Math.max(1, Math.round(h * k));
        if (pw != rectW || ph != rectH) {
            rectW = pw;
            rectH = ph;
            setLayoutParams(new FrameLayout.LayoutParams(pw, ph, Gravity.TOP | Gravity.START));
        }
        setTranslationX(x * k);
        setTranslationY(y * k);
        rectKnown = true;
        updateVisibility();
    }

    private void updateVisibility() {
        int want = rectKnown && !keys.isEmpty() ? VISIBLE : GONE;
        if (getVisibility() != want) {
            setVisibility(want);
            handler.removeCallbacks(blink);
            if (want == VISIBLE) handler.postDelayed(blink, 525);
        }
    }

    void setSuppressed(boolean on) {
        suppressed = on;
        setAlpha(on ? 0f : 1f);
        handler.removeCallbacks(blink);
        if (!on && getVisibility() == VISIBLE) handler.postDelayed(blink, 525);
    }

    void clear() {
        allowFocus(false);
        handler.removeCallbacks(notifyFocus);
        handler.removeCallbacks(blink);
        rectKnown = false;
        setSuppressed(false);
        keys.clear();
        sig = "";
        focusIdx = -1;
        rectW = 0;
        rectH = 0;
        setVisibility(GONE);
    }

    // ----- focus + keys ---------------------------------------------------------------

    private void allowFocus(boolean on) {
        setDescendantFocusability(on ? FOCUS_AFTER_DESCENDANTS : FOCUS_BLOCK_DESCENDANTS);
    }

    void focusKey(String key) {
        if (keys.isEmpty()) return;
        if (android.os.SystemClock.uptimeMillis() - handoffAt < 300) return;
        int at = indexOf(key);
        if (at < 0) at = 0;
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
        if (!(left || right || up || down || ok)) return false;
        if (focusIdx < 0 || focusIdx >= keys.size()) return true;
        if (ok) {
            if (event.getAction() == KeyEvent.ACTION_UP && event.getRepeatCount() == 0) listener.onOpen(PREFIX + keys.get(focusIdx).key);
            return true;
        }
        if (event.getAction() == KeyEvent.ACTION_UP) return true;
        long now = event.getEventTime();
        if (now - lastActivityAt > 250) {
            lastActivityAt = now;
            listener.onActivity();
        }
        int to = neighbour(focusIdx, left ? -1 : right ? 1 : 0, up ? -1 : down ? 1 : 0);
        if (to >= 0) {
            focusIdx = to;
            body.invalidate();
            scheduleNotify();
            return true;
        }
        // Nothing further that way inside the keyboard: Left / Right go to the sidebar / the results.
        if ((left || right) && event.getRepeatCount() == 0) {
            handedOff = true;
            handoffAt = android.os.SystemClock.uptimeMillis();
            listener.onHandoff(left ? "left" : "right", PREFIX + keys.get(focusIdx).key);
            allowFocus(false);
            handler.removeCallbacks(notifyFocus);
        }
        return true;
    }

    /** The key next to {@code from}: same row for Left / Right, the nearest one (by centre) in the next row for Up / Down. */
    private int neighbour(int from, int dx, int dy) {
        Key a = keys.get(from);
        float cx = a.x + a.w / 2f;
        int best = -1;
        float bestD = Float.MAX_VALUE;
        for (int i = 0; i < keys.size(); i++) {
            if (i == from) continue;
            Key b = keys.get(i);
            float bx = b.x + b.w / 2f;
            if (dx != 0) {
                if (b.row != a.row || (bx - cx) * dx <= 0) continue;
                float d = Math.abs(bx - cx);
                if (d < bestD) {
                    bestD = d;
                    best = i;
                }
            } else {
                if (b.row != a.row + dy) continue;
                float d = Math.abs(bx - cx);
                if (d < bestD) {
                    bestD = d;
                    best = i;
                }
            }
        }
        return best;
    }

    // ----- drawing --------------------------------------------------------------------

    private final class Body extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final TextPaint tp = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        private final RectF box = new RectF();
        private final Path path = new Path();

        Body(Context context) {
            super(context);
            setFocusable(true);
            setFocusableInTouchMode(false);
            setDefaultFocusHighlightEnabled(false);
        }

        @Override
        protected void onFocusChanged(boolean gainFocus, int direction, android.graphics.Rect previouslyFocusedRect) {
            super.onFocusChanged(gainFocus, direction, previouslyFocusedRect);
            if (gainFocus && (focusIdx < 0 || focusIdx >= keys.size())) focusIdx = keys.isEmpty() ? -1 : 0;
            invalidate();
            if (gainFocus) scheduleNotify();
        }

        @Override
        public boolean onTouchEvent(MotionEvent e) {
            if (e.getActionMasked() != MotionEvent.ACTION_UP) return true;
            float x = e.getX() / k;
            float y = e.getY() / k;
            for (int i = 0; i < keys.size(); i++) {
                Key kk = keys.get(i);
                if (x >= kk.x && x <= kk.x + kk.w && y >= kk.y && y <= kk.y + kk.h) {
                    focusIdx = i;
                    handedOff = false;
                    allowFocus(true);
                    requestFocus();
                    invalidate();
                    scheduleNotify();
                    listener.onOpen(PREFIX + kk.key);
                    return true;
                }
            }
            return true;
        }

        private void text(Canvas c, String s, float x, float cy, float size, int weight, int color, float spacing, boolean center, float maxW) {
            tp.setTypeface(NativeHomeView.font(getContext(), weight));
            tp.setTextSize(size * k);
            tp.setColor(color);
            tp.setLetterSpacing(spacing);
            String out = maxW > 0 ? TextUtils.ellipsize(s, tp, maxW, TextUtils.TruncateAt.START).toString() : s;
            float w = tp.measureText(out);
            Paint.FontMetrics fm = tp.getFontMetrics();
            c.drawText(out, center ? x - w / 2f : x, cy - (fm.ascent + fm.descent) / 2f, tp);
        }

        @Override
        protected void onDraw(Canvas c) {
            boolean held = isFocused();
            // Eyebrow.
            text(c, eyebrow.toUpperCase(), (eyeX + 22) * k, (eyeY + eyeH / 2f) * k, eyeSize, 900, accent, 0.18f, false, 0);
            // Search glyph (a small ring and handle) before it.
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(2f * k);
            paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setColor(accent);
            float gx = (eyeX + 9) * k;
            float gy = (eyeY + eyeH / 2f - 1) * k;
            c.drawCircle(gx, gy, 5.5f * k, paint);
            c.drawLine(gx + 4f * k, gy + 4f * k, gx + 7.5f * k, gy + 7.5f * k, paint);
            // Query line.
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.argb(36, 255, 255, 255));
            c.drawRect(qX * k, (qY + qH - 2f) * k, (qX + qW) * k, (qY + qH) * k, paint);
            float baseY = (qY + qH - 12f - qSize * 0.35f) * k;
            float maxW = (qW - 14f) * k;
            String shown = empty ? placeholder : query;
            int color = empty ? Color.argb(92, 255, 255, 255) : Color.WHITE;
            tp.setTypeface(NativeHomeView.font(getContext(), empty ? 600 : 700));
            tp.setTextSize(qSize * k);
            tp.setLetterSpacing(0f);
            String out = TextUtils.ellipsize(shown, tp, maxW, TextUtils.TruncateAt.START).toString();
            float tw = tp.measureText(out);
            tp.setColor(color);
            c.drawText(out, qX * k, baseY, tp);
            if (caretOn) {
                paint.setColor(accent);
                float cx = qX * k + tw + 3f * k;
                c.drawRoundRect(new RectF(cx, baseY - qSize * 0.92f * k, cx + 3f * k, baseY + qSize * 0.12f * k), 2f * k, 2f * k, paint);
            }
            // Keys.
            for (int i = 0; i < keys.size(); i++) {
                Key kk = keys.get(i);
                boolean f = held && i == focusIdx;
                float cxk = (kk.x + kk.w / 2f) * k;
                float cyk = (kk.y + kk.h / 2f) * k;
                float s = f ? 1.07f : 1f;
                float hw = kk.w * k * s / 2f;
                float hh = kk.h * k * s / 2f;
                box.set(cxk - hw, cyk - hh, cxk + hw, cyk + hh);
                float r = keyRadius * k * s;
                if (f) {
                    paint.setStyle(Paint.Style.FILL);
                    paint.setColor(Color.argb(70, 0, 0, 0));
                    c.drawRoundRect(box.left, box.top + 8f * k, box.right, box.bottom + 8f * k, r, r, paint);
                }
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(f ? Color.WHITE : Color.argb(kk.action ? 28 : 18, 255, 255, 255));
                c.drawRoundRect(box, r, r, paint);
                int ink = f ? Color.rgb(11, 11, 13) : Color.argb(230, 255, 255, 255);
                if (kk.back) {
                    drawBackspace(c, cxk, cyk, 20f * k * s, ink);
                } else {
                    text(c, kk.label, cxk, cyk, (kk.action ? actionSize : keySize) * s, 700, ink, kk.action ? 0.03f : 0f, true, 0);
                }
            }
        }

        private void drawBackspace(Canvas c, float cx, float cy, float size, int color) {
            float w = size;
            float h = size * 0.72f;
            float l = cx - w / 2f;
            float t = cy - h / 2f;
            path.reset();
            path.moveTo(l, cy);
            path.lineTo(l + w * 0.28f, t);
            path.lineTo(l + w, t);
            path.lineTo(l + w, t + h);
            path.lineTo(l + w * 0.28f, t + h);
            path.close();
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(Math.max(1.5f, size * 0.09f));
            paint.setStrokeJoin(Paint.Join.ROUND);
            paint.setColor(color);
            c.drawPath(path, paint);
            float xc = l + w * 0.64f;
            float d = h * 0.2f;
            c.drawLine(xc - d, cy - d, xc + d, cy + d, paint);
            c.drawLine(xc - d, cy + d, xc + d, cy - d, paint);
            paint.setStyle(Paint.Style.FILL);
        }
    }
}
