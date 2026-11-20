package com.servermanagerportal.mediaplayer;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * The action buttons of a TV details page (Play / Resume, restart, trailer, watched, watchlist, more ...), drawn
 * natively at the web row's rect. The web buttons stay in the page (invisible, still focusable) so every action,
 * menu and dialog keeps running on them; this view owns Left / Right and hands every other key back, the same
 * way NativeDetailRail does. Every size is measured off the web buttons (page viewport units).
 */
final class NativeDetailActions extends FrameLayout {

    static final String PREFIX = "actions~";

    private static final long FOCUS_NOTIFY_MS = 110;

    private static final class Item {
        String key = "";
        boolean primary;
        boolean disabled;
        float x;
        float y;
        float w;
        float h;
        float bw;
        String label = "";
        float lx;
        float ly;
        float lw;
        float lh;
        float size;
        int weight = 500;
        float ix;
        float iy;
        float iw;
        float ih;
        Bitmap icon;
        Bitmap iconFocus;
        String sig = "";
    }

    private final NativeEpisodeRail.Listener listener;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<Item> items = new ArrayList<>();
    private final List<Btn> buttons = new ArrayList<>();
    private int accent = Color.rgb(245, 158, 11);
    private float k = 1f;
    private float lastVw;
    private int lastW;
    private int lastH;
    private boolean rectKnown;
    private boolean suppressed;
    private long lastActivityAt;
    private String notifyKey = "";
    private String sig = "";
    private boolean handedOff;
    /** Moving down to a real target: the button's look goes at once. Up may bounce straight back, so it holds. */
    private boolean noHold;
    private long handoffAt;

    private final Runnable notifyFocus = new Runnable() {
        @Override
        public void run() {
            // Only while native still holds the remote on that button (a hand-off may have moved on by now).
            String held = focusedKey();
            if (!notifyKey.isEmpty() && notifyKey.equals(held) && !handedOff) listener.onFocus(PREFIX + notifyKey);
        }
    };

    NativeDetailActions(Context context, NativeEpisodeRail.Listener listener) {
        super(context);
        this.listener = listener;
        setVisibility(GONE);
        setFocusable(false);
        setClipChildren(false);
        // A button that becomes visible must not grab the remote from the page on its own.
        setDescendantFocusability(FOCUS_BLOCK_DESCENDANTS);
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
        String focusedKey = focusedKey();
        List<Item> old = new ArrayList<>(items);
        items.clear();
        JSONArray arr = root.optJSONArray("items");
        if (arr != null) {
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                Item it = new Item();
                it.key = o.optString("key");
                it.primary = o.optBoolean("primary", false);
                it.disabled = o.optBoolean("dis", false);
                it.x = (float) o.optDouble("x", 0);
                it.y = (float) o.optDouble("y", 0);
                it.w = (float) o.optDouble("w", 0);
                it.h = (float) o.optDouble("h", 0);
                it.bw = (float) o.optDouble("bw", 0.5);
                JSONObject lab = o.optJSONObject("label");
                if (lab != null) {
                    it.label = lab.optString("t");
                    it.lx = (float) lab.optDouble("x", 0);
                    it.ly = (float) lab.optDouble("y", 0);
                    it.lw = (float) lab.optDouble("w", 0);
                    it.lh = (float) lab.optDouble("h", 0);
                    it.size = (float) lab.optDouble("size", 10);
                    it.weight = lab.optInt("weight", 500);
                }
                JSONObject ic = o.optJSONObject("icon");
                if (ic != null) {
                    it.ix = (float) ic.optDouble("x", 0);
                    it.iy = (float) ic.optDouble("y", 0);
                    it.iw = (float) ic.optDouble("w", 0);
                    it.ih = (float) ic.optDouble("h", 0);
                    it.sig = ic.optString("n", "").length() + ":" + ic.optString("f", "").length() + ":" + ic.optString("s", "");
                    Item prev = null;
                    for (Item p : old) if (p.key.equals(it.key) && p.sig.equals(it.sig) && p.icon != null) prev = p;
                    if (prev != null) {
                        it.icon = prev.icon;
                        it.iconFocus = prev.iconFocus;
                    } else {
                        it.icon = decode(ic.optString("n", ""));
                        it.iconFocus = decode(ic.optString("f", ""));
                    }
                }
                items.add(it);
            }
        }
        rebuild(focusedKey);
        updateVisibility();
    }

    private static Bitmap decode(String b64) {
        if (b64 == null || b64.isEmpty()) return null;
        try {
            byte[] raw = Base64.decode(b64, Base64.DEFAULT);
            return BitmapFactory.decodeByteArray(raw, 0, raw.length);
        } catch (Throwable t) {
            return null;
        }
    }

    private void rebuild(String focusedKey) {
        boolean hadFocus = focusedKey != null;
        // Same buttons in the same order (a label, icon or enabled state changed): update them in place.
        if (buttons.size() == items.size() && !buttons.isEmpty()) {
            boolean same = true;
            for (int i = 0; i < items.size(); i++) if (!buttons.get(i).item.key.equals(items.get(i).key)) same = false;
            if (same) {
                for (int i = 0; i < items.size(); i++) buttons.get(i).item = items.get(i);
                layoutButtons();
                return;
            }
        }
        removeAllViews();
        buttons.clear();
        for (Item it : items) {
            Btn b = new Btn(getContext(), it);
            buttons.add(b);
            addView(b);
        }
        layoutButtons();
        if (hadFocus) focusKey(focusedKey);
    }

    private void layoutButtons() {
        for (Btn b : buttons) {
            Item it = b.item;
            LayoutParams lp = new LayoutParams(Math.max(1, Math.round(it.w * k)), Math.max(1, Math.round(it.h * k)),
                Gravity.TOP | Gravity.START);
            lp.leftMargin = Math.round(it.x * k);
            lp.topMargin = Math.round(it.y * k);
            b.setLayoutParams(lp);
            b.invalidate();
        }
    }

    /** Where the web row is, in the page's layout px; {@code vw} is the page's layout width. */
    void setRect(float x, float y, float w, float h, float vw) {
        View parent = (View) getParent();
        if (parent == null || vw <= 0 || parent.getWidth() <= 0) return;
        float nk = parent.getWidth() / vw;
        if (Math.abs(nk - k) > 0.0001f || vw != lastVw) {
            k = nk;
            lastVw = vw;
            layoutButtons();
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
        suppressed = on;
        setAlpha(on ? 0f : 1f);
    }

    /** The page left (or the row is gone). */
    void clear() {
        allowFocus(false);
        handler.removeCallbacks(notifyFocus);
        rectKnown = false;
        setSuppressed(false);
        items.clear();
        buttons.clear();
        removeAllViews();
        sig = "";
        setVisibility(GONE);
    }

    boolean hasKey(String key) {
        return indexOf(key) >= 0;
    }

    boolean hasFocusInside() {
        return getVisibility() == VISIBLE && findFocus() != null;
    }

    private int indexOf(String key) {
        if (key == null) return -1;
        String k2 = key.startsWith(PREFIX) ? key.substring(PREFIX.length()) : key;
        for (int i = 0; i < items.size(); i++) if (items.get(i).key.equals(k2)) return i;
        return -1;
    }

    private String focusedKey() {
        View f = findFocus();
        if (f instanceof Btn) return ((Btn) f).item.key;
        return null;
    }

    // ----- focus + keys ---------------------------------------------------------------

    private void allowFocus(boolean on) {
        setDescendantFocusability(on ? FOCUS_AFTER_DESCENDANTS : FOCUS_BLOCK_DESCENDANTS);
    }

    void focusKey(String key) {
        if (buttons.isEmpty()) return;
        // The page re-focusing the hidden button as the WebView takes the remote is not a request to give it back.
        if (android.os.SystemClock.uptimeMillis() - handoffAt < 300) return;
        int at = indexOf(key);
        if (at < 0 || items.get(at).disabled) at = firstEnabled();
        if (at < 0) return;
        handedOff = false;
        noHold = false;
        allowFocus(true);
        buttons.get(at).requestFocus();
    }

    private int firstEnabled() {
        for (int i = 0; i < items.size(); i++) if (!items.get(i).disabled) return i;
        return -1;
    }

    private int step(int from, int dir) {
        int i = from + dir;
        while (i >= 0 && i < items.size()) {
            if (!items.get(i).disabled) return i;
            i += dir;
        }
        return -1;
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
        if (!(left || right || up || down)) return false; // Enter etc.: the focused button's own click
        if (event.getAction() == KeyEvent.ACTION_UP) return true;
        if (event.getRepeatCount() > 0 && (up || down)) return true;
        long now = event.getEventTime();
        if (now - lastActivityAt > 250) {
            lastActivityAt = now;
            listener.onActivity();
        }
        View f = findFocus();
        int at = -1;
        for (int i = 0; i < buttons.size(); i++) if (buttons.get(i) == f) at = i;
        if (at < 0) return true;
        String key = items.get(at).key;
        if (up || down) {
            noHold = down;
            handedOff = true;
            handoffAt = android.os.SystemClock.uptimeMillis();
            listener.onVertical(up ? "up" : "down", PREFIX + key);
            allowFocus(false);
            handedOff = true;
            handler.removeCallbacks(notifyFocus);
            return true;
        }
        int to = step(at, left ? -1 : 1);
        if (to >= 0) {
            buttons.get(to).requestFocus();
            return true;
        }
        if (left && event.getRepeatCount() == 0) {
            handedOff = true;
            handoffAt = android.os.SystemClock.uptimeMillis();
            listener.onHandoff("left", PREFIX + key);
            allowFocus(false);
            handedOff = true;
            handler.removeCallbacks(notifyFocus);
        }
        return true;
    }

    // ----- one button -----------------------------------------------------------------

    private final class Btn extends View {
        Item item;
        long holdUntil;
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF box = new RectF();

        Btn(Context context, Item item) {
            super(context);
            this.item = item;
            setFocusable(!item.disabled);
            setFocusableInTouchMode(false);
            setClickable(!item.disabled);
            setAlpha(item.disabled ? 0.5f : 1f);
            setOnClickListener(v -> listener.onOpen(PREFIX + item.key));
            setDefaultFocusHighlightEnabled(false);
        }

        @Override
        protected void onFocusChanged(boolean gainFocus, int direction, android.graphics.Rect previouslyFocusedRect) {
            super.onFocusChanged(gainFocus, direction, previouslyFocusedRect);
            invalidate();
            if (!gainFocus) {
                // Native<->web focus handoffs leave ~150ms with nothing focused; keep the look so it doesn't blink.
                holdUntil = android.os.SystemClock.uptimeMillis() + 260;
                postInvalidateDelayed(270);
                NativeDetailRail.holdLook(() -> {
                    holdUntil = 0;
                    invalidate();
                });
            }
            if (gainFocus) {
                NativeDetailRail.releaseHeldLooks();
                notifyKey = item.key;
                handler.removeCallbacks(notifyFocus);
                handler.postDelayed(notifyFocus, FOCUS_NOTIFY_MS);
            }
        }

        @Override
        protected void onDraw(Canvas canvas) {
            boolean on = isFocused();
            if (!on && !noHold && android.os.SystemClock.uptimeMillis() < holdUntil) {
                boolean other = false;
                for (Btn b : buttons) if (b != this && b.isFocused()) other = true;
                on = !other;
            }
            float w = getWidth();
            float h = getHeight();
            float bw = Math.max(1f, item.bw * k);
            int fg;
            if (on) {
                fg = item.primary ? Color.rgb(17, 17, 17) : Color.rgb(11, 11, 13);
            } else {
                fg = item.primary ? Color.rgb(17, 17, 17) : Color.WHITE;
            }
            float r = h / 2f;
            if (on) {
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(Color.WHITE);
                box.set(0, 0, w, h);
                canvas.drawRoundRect(box, r, r, paint);
            } else if (item.primary) {
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(accent);
                box.set(0, 0, w, h);
                canvas.drawRoundRect(box, r, r, paint);
            } else {
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(Color.argb(13, 255, 255, 255));
                box.set(0, 0, w, h);
                canvas.drawRoundRect(box, r, r, paint);
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(bw);
                paint.setColor(Color.argb(38, 255, 255, 255));
                box.set(bw / 2f, bw / 2f, w - bw / 2f, h - bw / 2f);
                canvas.drawRoundRect(box, r, r, paint);
            }
            Bitmap icon = on && item.iconFocus != null ? item.iconFocus : item.icon;
            if (icon != null && item.iw > 0 && item.ih > 0) {
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(Color.WHITE);
                paint.setFilterBitmap(true);
                box.set((item.ix - item.x) * k, (item.iy - item.y) * k, (item.ix - item.x + item.iw) * k, (item.iy - item.y + item.ih) * k);
                canvas.drawBitmap(icon, null, box, paint);
            }
            if (!item.label.isEmpty()) {
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(fg);
                paint.setTypeface(NativeHomeView.font(getContext(), item.weight));
                paint.setTextSize(item.size * k);
                paint.setTextAlign(Paint.Align.LEFT);
                Paint.FontMetrics fm = paint.getFontMetrics();
                float cy = (item.ly - item.y + item.lh / 2f) * k;
                float base = cy - (fm.ascent + fm.descent) / 2f;
                canvas.drawText(item.label, (item.lx - item.x) * k, base, paint);
            }
        }
    }
}
