package com.servermanagerportal.mediaplayer;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * The season bar of a TV episode / season page, drawn natively at the web bar's rect. The web pills stay in the
 * page (invisible, focusable); native owns Left / Right (and scrolls a long bar itself) and hands Down and
 * Left-at-the-edge back, like NativeDetailActions.
 */
final class NativeSeasonTabs extends FrameLayout {

    static final String PREFIX = "tabs~";

    private static final class Item {
        String key = "";
        String text = "";
        boolean active;
        float x;
        float y;
        float w;
        float h;
    }

    private final NativeEpisodeRail.Listener listener;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<Item> items = new ArrayList<>();
    private final List<Pill> pills = new ArrayList<>();
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF box = new RectF();
    private final Path clip = new Path();
    private float k = 1f;
    private float lastVw;
    private int lastW;
    private int lastH;
    private float size = 10f;
    private int weight = 500;
    private float bw = 0.5f;
    private float scroll; // page units
    private float lastSl = -1f;
    private float barW;
    private boolean rectKnown;
    private boolean handedOff;
    private long handoffAt;
    private long lastActivityAt;
    private String notifyKey = "";
    private String sig = "";

    private final Runnable notifyFocus = new Runnable() {
        @Override
        public void run() {
            if (!notifyKey.isEmpty() && notifyKey.equals(focusedKey()) && !handedOff) listener.onFocus(PREFIX + notifyKey);
        }
    };

    NativeSeasonTabs(Context context, NativeEpisodeRail.Listener listener) {
        super(context);
        this.listener = listener;
        setVisibility(GONE);
        setFocusable(false);
        setWillNotDraw(false);
        setDescendantFocusability(FOCUS_BLOCK_DESCENDANTS);
    }

    void setData(JSONObject root) {
        String next = root.toString();
        if (next.equals(sig)) return;
        sig = next;
        size = (float) root.optDouble("size", 10);
        weight = root.optInt("weight", 500);
        bw = (float) root.optDouble("bw", 0.5);
        float sl = (float) root.optDouble("sl", 0);
        String focused = focusedKey();
        List<Item> fresh = new ArrayList<>();
        JSONArray arr = root.optJSONArray("items");
        if (arr != null) {
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                Item it = new Item();
                it.key = o.optString("key");
                it.text = o.optString("t");
                it.active = o.optBoolean("active", false);
                it.x = (float) o.optDouble("x", 0);
                it.y = (float) o.optDouble("y", 0);
                it.w = (float) o.optDouble("w", 0);
                it.h = (float) o.optDouble("h", 0);
                fresh.add(it);
            }
        }
        if (sl != lastSl) {
            lastSl = sl;
            scroll = sl;
        }
        // Same pills (only the active season or the sizes moved): update them in place. Rebuilding dropped the
        // focused pill, Android put focus on the first one ("Show"), and the highlight flicked there.
        if (fresh.size() == pills.size() && !pills.isEmpty()) {
            boolean sameKeys = true;
            for (int i = 0; i < fresh.size(); i++) {
                if (!fresh.get(i).key.equals(pills.get(i).item.key)) {
                    sameKeys = false;
                    break;
                }
            }
            if (sameKeys) {
                items.clear();
                for (int i = 0; i < fresh.size(); i++) {
                    Item src = fresh.get(i);
                    Item dst = pills.get(i).item;
                    dst.text = src.text;
                    dst.active = src.active;
                    dst.x = src.x;
                    dst.y = src.y;
                    dst.w = src.w;
                    dst.h = src.h;
                    items.add(dst);
                    pills.get(i).invalidate();
                }
                layoutPills();
                updateVisibility();
                return;
            }
        }
        items.clear();
        items.addAll(fresh);
        removeAllViews();
        pills.clear();
        for (Item it : items) {
            Pill p = new Pill(getContext(), it);
            pills.add(p);
            addView(p);
        }
        layoutPills();
        // Put focus back on the same season (or the active one) straight away, whatever just happened.
        if (focused != null && !pills.isEmpty()) {
            int at = indexOf(focused);
            if (at < 0) at = activeIndex();
            if (at < 0) at = 0;
            reveal(at);
            pills.get(at).requestFocus();
        }
        updateVisibility();
    }

    private void layoutPills() {
        for (Pill p : pills) {
            Item it = p.item;
            p.setLayoutParams(new LayoutParams(Math.max(1, Math.round(it.w * k)), Math.max(1, Math.round(it.h * k)),
                Gravity.TOP | Gravity.START));
            p.setTranslationX((it.x - scroll) * k);
            p.setTranslationY(it.y * k);
        }
        invalidate();
    }

    void setRect(float x, float y, float w, float h, float vw) {
        View parent = (View) getParent();
        if (parent == null || vw <= 0 || parent.getWidth() <= 0) return;
        float nk = parent.getWidth() / vw;
        barW = w;
        if (Math.abs(nk - k) > 0.0001f || vw != lastVw) {
            k = nk;
            lastVw = vw;
            layoutPills();
        }
        int pw = Math.round(w * k);
        int ph = Math.round(h * k);
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

    private void updateVisibility() {
        int want = rectKnown && !items.isEmpty() ? VISIBLE : GONE;
        if (getVisibility() != want) setVisibility(want);
    }

    void setSuppressed(boolean on) {
        setAlpha(on ? 0f : 1f);
    }

    void clear() {
        allowFocus(false);
        handler.removeCallbacks(notifyFocus);
        rectKnown = false;
        setSuppressed(false);
        items.clear();
        pills.clear();
        removeAllViews();
        sig = "";
        lastSl = -1f;
        setVisibility(GONE);
    }

    boolean hasKey(String key) {
        return indexOf(key) >= 0;
    }

    boolean hasFocusInside() {
        return getVisibility() == VISIBLE && findFocus() != null;
    }

    private int activeIndex() {
        for (int i = 0; i < items.size(); i++) if (items.get(i).active) return i;
        return -1;
    }

    private int indexOf(String key) {
        if (key == null) return -1;
        String k2 = key.startsWith(PREFIX) ? key.substring(PREFIX.length()) : key;
        for (int i = 0; i < items.size(); i++) if (items.get(i).key.equals(k2)) return i;
        return -1;
    }

    private String focusedKey() {
        View f = findFocus();
        return f instanceof Pill ? ((Pill) f).item.key : null;
    }

    private void allowFocus(boolean on) {
        setDescendantFocusability(on ? FOCUS_AFTER_DESCENDANTS : FOCUS_BLOCK_DESCENDANTS);
    }

    void focusKey(String key) {
        if (pills.isEmpty()) return;
        if (SystemClock.uptimeMillis() - handoffAt < 300) return;
        int at = indexOf(key);
        // A key this bar does not have (the page is mid-reload to another season): the active season, never
        // the first pill — falling back to "Show" made the highlight flick to Show before the new season.
        if (at < 0) at = activeIndex();
        if (at < 0) at = 0;
        handedOff = false;
        allowFocus(true);
        reveal(at);
        pills.get(at).requestFocus();
    }

    /** Scroll the bar (like the web one) so the pill is not hidden at an edge. */
    private void reveal(int at) {
        Item it = items.get(at);
        float peek = 12f;
        float before = scroll;
        if (it.x - scroll < peek) scroll = Math.max(0, it.x - peek);
        else if (it.x + it.w - scroll > barW - peek) scroll = it.x + it.w - barW + peek;
        if (scroll != before) layoutPills();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (getVisibility() == VISIBLE && findFocus() != null && handleKey(event)) return true;
        return super.dispatchKeyEvent(event);
    }

    private boolean handleKey(KeyEvent event) {
        int code = event.getKeyCode();
        boolean left = code == KeyEvent.KEYCODE_DPAD_LEFT;
        boolean right = code == KeyEvent.KEYCODE_DPAD_RIGHT;
        boolean up = code == KeyEvent.KEYCODE_DPAD_UP;
        boolean down = code == KeyEvent.KEYCODE_DPAD_DOWN;
        if (!(left || right || up || down)) return false;
        if (event.getAction() == KeyEvent.ACTION_UP) return true;
        long now = event.getEventTime();
        if (event.getRepeatCount() == 0 && now - lastActivityAt > 250) {
            lastActivityAt = now;
            listener.onActivity();
        }
        View f = findFocus();
        int at = -1;
        for (int i = 0; i < pills.size(); i++) if (pills.get(i) == f) at = i;
        if (at < 0) return true;
        String key = items.get(at).key;
        if (up || down || (left && at == 0)) {
            if (event.getRepeatCount() > 0) return true;
            handedOff = true;
            handoffAt = SystemClock.uptimeMillis();
            listener.onHandoff(up ? "up" : down ? "down" : "left", PREFIX + key);
            allowFocus(false);
            handler.removeCallbacks(notifyFocus);
            return true;
        }
        int to = at + (left ? -1 : 1);
        if (to >= 0 && to < pills.size()) {
            reveal(to);
            pills.get(to).requestFocus();
        }
        return true;
    }

    @Override
    protected void dispatchDraw(Canvas canvas) {
        float w = getWidth();
        float h = getHeight();
        float r = h / 2f;
        float b = Math.max(1f, bw * k);
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(Color.argb(204, 8, 12, 18));
        box.set(0, 0, w, h);
        canvas.drawRoundRect(box, r, r, paint);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(b);
        paint.setColor(Color.argb(36, 255, 255, 255));
        box.set(b / 2f, b / 2f, w - b / 2f, h - b / 2f);
        canvas.drawRoundRect(box, r, r, paint);
        int save = canvas.save();
        clip.reset();
        box.set(b, b, w - b, h - b);
        clip.addRoundRect(box, r, r, Path.Direction.CW);
        canvas.clipPath(clip);
        super.dispatchDraw(canvas);
        canvas.restoreToCount(save);
    }

    private final class Pill extends View {
        final Item item;
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF r = new RectF();

        Pill(Context context, Item item) {
            super(context);
            this.item = item;
            setFocusable(true);
            setFocusableInTouchMode(false);
            setClickable(true);
            setDefaultFocusHighlightEnabled(false);
            setOnClickListener(v -> listener.onOpen(PREFIX + item.key));
        }

        @Override
        protected void onFocusChanged(boolean gain, int direction, android.graphics.Rect prev) {
            super.onFocusChanged(gain, direction, prev);
            invalidate();
            if (gain) {
                notifyKey = item.key;
                handler.removeCallbacks(notifyFocus);
                handler.postDelayed(notifyFocus, 110);
            }
        }

        @Override
        protected void onDraw(Canvas canvas) {
            boolean on = isFocused();
            float w = getWidth();
            float h = getHeight();
            if (on || item.active) {
                p.setStyle(Paint.Style.FILL);
                p.setColor(on ? Color.WHITE : Color.argb(51, 255, 255, 255));
                r.set(0, 0, w, h);
                canvas.drawRoundRect(r, h / 2f, h / 2f, p);
            }
            p.setStyle(Paint.Style.FILL);
            p.setColor(on ? Color.rgb(17, 17, 17) : item.active ? Color.WHITE : Color.argb(199, 255, 255, 255));
            p.setTypeface(NativeHomeView.font(getContext(), weight));
            p.setTextSize(size * k);
            p.setTextAlign(Paint.Align.CENTER);
            Paint.FontMetrics fm = p.getFontMetrics();
            canvas.drawText(item.text, w / 2f, h / 2f - (fm.ascent + fm.descent) / 2f, p);
        }
    }
}
