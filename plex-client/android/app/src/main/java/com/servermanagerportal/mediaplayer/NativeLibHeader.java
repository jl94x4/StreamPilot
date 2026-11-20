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
 * A library page's header drawn natively: the title and the tab pills (Recommended / Browse / Collections / Studios).
 * The web copies stay mounted (invisible, laid out, focusable) and stay the source of truth: positions are measured
 * into the payload and Enter asks the page to click the matching web tab. On the Browse tab the header scrolls away
 * with the grid; the grid reports its scroll straight here so both move in the same frame.
 */
final class NativeLibHeader extends FrameLayout {

    static final String PREFIX = "lh~";
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

    private static final class Note {
        String t = "";
        float x;
        float y;
        float w;
        float h;
        float size = 16f;
        int color = Color.WHITE;
    }

    private static final class Tab {
        List<Shape> shapes = new ArrayList<>();
        float size;
        int weight;
        float textX = -1f;
        float textW;
        int borderColor;
        float borderW;
        String key = "";
        String text = "";
        boolean active;
        float x;
        float y;
        float w;
        float h;
        int color = Color.WHITE;
        int bg;
    }

    private final NativeEpisodeRail.Listener listener;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<Tab> tabs = new ArrayList<>();
    private final List<Note> notes = new ArrayList<>();
    private final Body body;

    private String sig = "";
    private float k = 1f;
    private boolean hidden;
    private boolean follow;
    private float scrollY;
    private String title = "";
    private float tX;
    private float tY;
    private float tW;
    private float tH;
    private float tSize = 28f;
    private float tabSize = 16f;
    private int tabWeight = 700;
    private float tabSpacing;
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

    NativeLibHeader(Context context, NativeEpisodeRail.Listener listener) {
        super(context);
        this.listener = listener;
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
        hidden = root.optBoolean("hidden", false);
        follow = root.optBoolean("follow", false);
        String held = focusedKey();
        tabs.clear();
        notes.clear();
        title = root.optString("title");
        tX = (float) root.optDouble("tx", 0);
        tY = (float) root.optDouble("ty", 0);
        tW = (float) root.optDouble("tw", 0);
        tH = (float) root.optDouble("th", 0);
        tSize = (float) root.optDouble("ts", 28);
        tabSize = (float) root.optDouble("size", 16);
        tabWeight = root.optInt("weight", 700);
        tabSpacing = (float) root.optDouble("sp", 0);
        JSONArray arr = root.optJSONArray("tabs");
        if (arr != null) {
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                Tab t = new Tab();
                t.key = o.optString("k");
                t.text = o.optString("t");
                t.active = o.optBoolean("a", false);
                t.x = (float) o.optDouble("x");
                t.y = (float) o.optDouble("y");
                t.w = (float) o.optDouble("w");
                t.h = (float) o.optDouble("h");
                t.color = o.optInt("c", Color.WHITE);
                t.bg = o.optInt("bg", 0);
                t.size = (float) o.optDouble("s", 0);
                t.weight = o.optInt("wt", 0);
                t.textX = o.has("lx") ? (float) o.optDouble("lx") : -1f;
                t.textW = (float) o.optDouble("lw", 0);
                t.borderColor = o.optInt("bc", 0);
                t.borderW = (float) o.optDouble("bw", 0);
                JSONArray sh = o.optJSONArray("sh");
                if (sh != null) {
                    for (int j = 0; j < sh.length(); j++) {
                        JSONObject so = sh.optJSONObject(j);
                        if (so == null) continue;
                        Shape shape = new Shape();
                        JSONArray ds = so.optJSONArray("d");
                        int n = ds != null ? ds.length() : 0;
                        shape.paths = new Path[n];
                        for (int q = 0; q < n; q++) {
                            try {
                                shape.paths[q] = androidx.core.graphics.PathParser.createPathFromPathData(ds.optString(q));
                            } catch (Throwable ignored) {
                                shape.paths[q] = null;
                            }
                        }
                        shape.x = (float) so.optDouble("x");
                        shape.y = (float) so.optDouble("y");
                        shape.w = (float) so.optDouble("w");
                        shape.h = (float) so.optDouble("h");
                        shape.color = so.optInt("c", Color.WHITE);
                        shape.stroke = (float) so.optDouble("sw", 2);
                        shape.vbSize = (float) so.optDouble("vb", 24);
                        t.shapes.add(shape);
                    }
                }
                tabs.add(t);
            }
        }
        JSONArray ns = root.optJSONArray("notes");
        if (ns != null) {
            for (int i = 0; i < ns.length(); i++) {
                JSONObject o = ns.optJSONObject(i);
                if (o == null) continue;
                Note n = new Note();
                n.t = o.optString("t");
                n.x = (float) o.optDouble("x");
                n.y = (float) o.optDouble("y");
                n.w = (float) o.optDouble("w");
                n.h = (float) o.optDouble("h");
                n.size = (float) o.optDouble("s", 16);
                n.color = o.optInt("c", Color.WHITE);
                notes.add(n);
            }
        }
        if (held != null) {
            int at = indexOf(held);
            focusIdx = at >= 0 ? at : 0;
        }
        if (!follow) scrollY = 0f;
        updateVisibility();
        body.invalidate();
    }

    /** The Browse grid scrolled: {@code y} page layout px the content moved up. */
    void setScroll(float y) {
        float next = follow ? y : 0f;
        if (next == scrollY) return;
        scrollY = next;
        body.invalidate();
    }

    private int indexOf(String key) {
        if (key == null) return -1;
        String kk = key.startsWith(PREFIX) ? key.substring(PREFIX.length()) : key;
        for (int i = 0; i < tabs.size(); i++) if (tabs.get(i).key.equals(kk)) return i;
        return -1;
    }

    private String focusedKey() {
        if (!body.isFocused() || focusIdx < 0 || focusIdx >= tabs.size()) return null;
        return tabs.get(focusIdx).key;
    }

    boolean hasKey(String key) {
        return key != null && key.startsWith(PREFIX) && indexOf(key) >= 0;
    }

    boolean hasFocusInside() {
        return getVisibility() == VISIBLE && body.isFocused();
    }

    private void updateVisibility() {
        boolean any = !hidden && (!tabs.isEmpty() || !title.isEmpty());
        int want = any ? VISIBLE : GONE;
        if (getVisibility() != want) setVisibility(want);
    }

    void clear() {
        allowFocus(false);
        handler.removeCallbacks(notifyFocus);
        tabs.clear();
        notes.clear();
        sig = "";
        title = "";
        focusIdx = -1;
        scrollY = 0f;
        setVisibility(GONE);
    }

    // ----- focus + keys ---------------------------------------------------------------

    private void allowFocus(boolean on) {
        setDescendantFocusability(on ? FOCUS_AFTER_DESCENDANTS : FOCUS_BLOCK_DESCENDANTS);
    }

    void focusKey(String key) {
        if (tabs.isEmpty()) return;
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

    private void handoff(String dir) {
        handedOff = true;
        handoffAt = android.os.SystemClock.uptimeMillis();
        listener.onHandoff(dir, PREFIX + tabs.get(focusIdx).key);
        allowFocus(false);
        handler.removeCallbacks(notifyFocus);
        body.invalidate();
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
        if (focusIdx < 0 || focusIdx >= tabs.size()) return true;
        if (ok) {
            if (event.getAction() == KeyEvent.ACTION_UP && event.getRepeatCount() == 0) listener.onOpen(PREFIX + tabs.get(focusIdx).key);
            return true;
        }
        if (event.getAction() == KeyEvent.ACTION_UP) return true;
        long now = event.getEventTime();
        if (now - lastActivityAt > 250) {
            lastActivityAt = now;
            listener.onActivity();
        }
        String dir = left ? "left" : right ? "right" : up ? "up" : "down";
        int i = neighbour(dir);
        if (i >= 0) {
            focusIdx = i;
            body.invalidate();
            scheduleNotify();
        } else if (event.getRepeatCount() == 0) {
            handoff(dir);
        }
        return true;
    }

    /** The control to move to from the focused one: same row for Left / Right, the nearest row for Up / Down. */
    private int neighbour(String dir) {
        Tab cur = tabs.get(focusIdx);
        float cx = cur.x + cur.w / 2f;
        float cy = cur.y + cur.h / 2f;
        boolean horiz = dir.equals("left") || dir.equals("right");
        int best = -1;
        float bestScore = Float.MAX_VALUE;
        for (int i = 0; i < tabs.size(); i++) {
            if (i == focusIdx) continue;
            Tab t = tabs.get(i);
            float tx = t.x + t.w / 2f;
            float ty = t.y + t.h / 2f;
            float score;
            if (horiz) {
                if (Math.abs(ty - cy) > Math.max(cur.h, t.h) * 0.5f) continue;
                float dx = dir.equals("left") ? cx - tx : tx - cx;
                if (dx <= 0f) continue;
                score = dx;
            } else {
                float dy = dir.equals("up") ? cy - ty : ty - cy;
                if (dy <= Math.max(cur.h, t.h) * 0.5f) continue;
                score = dy * 1000f + Math.abs(tx - cx);
            }
            if (score < bestScore) {
                bestScore = score;
                best = i;
            }
        }
        return best;
    }

    // ----- drawing --------------------------------------------------------------------

    private final class Body extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final TextPaint tp = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        private final RectF box = new RectF();

        Body(Context context) {
            super(context);
            setFocusable(true);
            setFocusableInTouchMode(false);
            setDefaultFocusHighlightEnabled(false);
        }

        @Override
        protected void onFocusChanged(boolean gainFocus, int direction, android.graphics.Rect previouslyFocusedRect) {
            super.onFocusChanged(gainFocus, direction, previouslyFocusedRect);
            if (gainFocus && (focusIdx < 0 || focusIdx >= tabs.size())) focusIdx = 0;
            invalidate();
            if (gainFocus) scheduleNotify();
        }

        @Override
        public boolean onTouchEvent(MotionEvent e) {
            if (hidden) return false;
            float x = e.getX() / k;
            float y = e.getY() / k + scrollY;
            for (int i = 0; i < tabs.size(); i++) {
                Tab t = tabs.get(i);
                if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) {
                    if (e.getActionMasked() == MotionEvent.ACTION_UP) {
                        focusIdx = i;
                        handedOff = false;
                        listener.onOpen(PREFIX + t.key);
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

        private final Path scaled = new Path();
        private final android.graphics.Matrix matrix = new android.graphics.Matrix();

        private void drawShape(Canvas c, Shape sh, int color) {
            float sc = Math.min(sh.w, sh.h) / sh.vbSize * k;
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(Math.max(1f, sh.stroke * sc));
            paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setStrokeJoin(Paint.Join.ROUND);
            paint.setColor(color);
            for (Path p : sh.paths) {
                if (p == null) continue;
                matrix.reset();
                matrix.setScale(sc, sc);
                matrix.postTranslate(sh.x * k, sh.y * k);
                scaled.reset();
                p.transform(matrix, scaled);
                c.drawPath(scaled, paint);
            }
            paint.setStyle(Paint.Style.FILL);
        }

        @Override
        protected void onDraw(Canvas c) {
            if (hidden) return;
            c.save();
            c.translate(0f, -scrollY * k);
            if (!title.isEmpty()) {
                paint.setStyle(Paint.Style.FILL);
                text(c, title, tX * k, (tY + tH / 2f) * k, tSize, 800, Color.WHITE, -0.02f, (tW + 4f) * k, false);
            }
            boolean focused = isFocused();
            for (int i = 0; i < tabs.size(); i++) {
                Tab t = tabs.get(i);
                boolean focus = focused && i == focusIdx && !handedOff;
                box.set(t.x * k, t.y * k, (t.x + t.w) * k, (t.y + t.h) * k);
                float r = Math.min(t.w, t.h) / 2f * k;
                if (focus) {
                    paint.setStyle(Paint.Style.FILL);
                    paint.setColor(Color.WHITE);
                    c.drawRoundRect(box, r, r, paint);
                } else if (Color.alpha(t.bg) > 0) {
                    paint.setStyle(Paint.Style.FILL);
                    paint.setColor(t.bg);
                    c.drawRoundRect(box, r, r, paint);
                }
                if (!focus && t.borderW > 0f && Color.alpha(t.borderColor) > 0) {
                    float bw = Math.max(1f, t.borderW * k);
                    paint.setStyle(Paint.Style.STROKE);
                    paint.setStrokeWidth(bw);
                    paint.setColor(t.borderColor);
                    box.inset(bw / 2f, bw / 2f);
                    c.drawRoundRect(box, r, r, paint);
                }
                int ink = focus ? Color.rgb(11, 15, 25) : t.color;
                for (Shape sh : t.shapes) drawShape(c, sh, focus ? ink : sh.color);
                float size = t.size > 0f ? t.size : tabSize;
                int weight = t.weight > 0 ? t.weight : tabWeight;
                if (t.textX >= 0f) text(c, t.text, t.textX * k, (t.y + t.h / 2f) * k, size, weight, ink, tabSpacing, (t.textW + 3f) * k, false);
                else text(c, t.text, (t.x + t.w / 2f) * k, (t.y + t.h / 2f) * k, size, weight, ink, tabSpacing, 0f, true);
            }
            for (Note n : notes) text(c, n.t, n.x * k, (n.y + n.h / 2f) * k, n.size, 500, n.color, 0f, (n.w + 4f) * k, false);
            c.restore();
        }
    }
}
