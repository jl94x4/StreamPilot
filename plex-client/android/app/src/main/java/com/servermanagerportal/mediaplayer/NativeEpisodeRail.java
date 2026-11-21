package com.servermanagerportal.mediaplayer;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.view.animation.DecelerateInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.LinearSmoothScroller;
import androidx.recyclerview.widget.RecyclerView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * The horizontal episode rail of the TV season / episode pages, drawn natively (same look as the web
 * cards: 16:9 still, E-badge, watch bar, watched tick, amber ring and 1.042 grow). It sits at the
 * rect of the web rail (which stays in the page, invisible) and owns Left / Right. Up, Down and the left
 * edge are handed back to the page, which runs its normal spatial navigation from the hidden card.
 * All sizes are the web page's 1920 px layout (dp equals that on TV).
 */
final class NativeEpisodeRail extends FrameLayout {

    interface Listener {
        void onOpen(String key);
        void onLongPress(String key);
        void onFocus(String key);
        /** Up / Down / Left-at-the-first-card: the page takes the remote and runs the key itself. */
        void onHandoff(String dir, String key);
        /** Title page Up / Down: the page may step straight to another native row, so the remote is not taken from native first. */
        default void onVertical(String dir, String key) {
            onHandoff(dir, key);
        }
        void onActivity();
        void onHoldEnd();
    }

    static final class Ep {
        String key = "";
        String img = "";
        String label = "";
        float progress;
        boolean watched;
        boolean spoiler;
    }

    // Measured from the web page (px at 1920).
    private static final float CARD_W = 510f;
    private static final float CARD_H = 286.875f;
    private static final float GAP = 24f;
    private static final float PAD_L = 15f;
    private static final float PAD_T = 23f;
    private static final float PAD_R = 55f;
    private static final float PAD_B = 27f;
    private static final float RADIUS = 6f;
    private static final float RING = 3f;
    private static final float FOCUS_SCALE = 1.042f;
    private static final long FOCUS_NOTIFY_MS = 110;
    private static final long HOLD_START_MS = 180;
    private static final long HOLD_STEP_MS = 55;
    private static final int AMBER = Color.rgb(245, 158, 11);

    private final Listener listener;
    private final NativeHomeImages images;
    private final float density;
    /** The page's own scale (its UI size): every card measure follows the web rail's real height. */
    private float zoom = 1f;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final RecyclerView rv;
    private final LinearLayoutManager lm;
    private final Adapter adapter = new Adapter();
    private final Typeface badgeFace;

    private List<Ep> eps = new ArrayList<>();
    private int idx;
    private String idxKey = "";
    private boolean rectKnown;
    private long lastActivityAt;
    private long lastMoveAt;
    private int holdDir;           // -1 left, +1 right, 0 none
    private boolean holdPending;   // a long Select / Menu opened a web menu: swallow that key until it is let go
    private String pendingFocusKey;
    private String notifyKey = "";
    private int lastW;
    private int lastH;

    private final Runnable notifyFocus = new Runnable() {
        @Override
        public void run() {
            if (!notifyKey.isEmpty()) listener.onFocus(notifyKey);
        }
    };
    private final Runnable holdTick = new Runnable() {
        @Override
        public void run() {
            if (holdDir == 0) return;
            int next = idx + holdDir;
            if (next < 0 || next >= eps.size()) {
                holdDir = 0;
                return;
            }
            moveTo(next, true);
            handler.postDelayed(this, HOLD_STEP_MS);
        }
    };
    private final Runnable holdTimeout = this::finishHold;

    NativeEpisodeRail(Context context, NativeHomeImages images, Listener listener) {
        super(context);
        this.images = images;
        this.listener = listener;
        this.density = context.getResources().getDisplayMetrics().density;
        this.badgeFace = NativeHomeView.font(context, 700);
        setVisibility(GONE);
        setFocusable(false);

        rv = new RecyclerView(context);
        lm = new LinearLayoutManager(context, RecyclerView.HORIZONTAL, false) {
            @Override
            public boolean requestChildRectangleOnScreen(@NonNull RecyclerView parent, @NonNull View child,
                                                         @NonNull Rect rect, boolean immediate, boolean focusedChildVisible) {
                return false; // scrolled by hand (flush to the padded left edge, like the web rail)
            }
        };
        rv.setLayoutManager(lm);
        rv.setItemAnimator(null);
        rv.setHasFixedSize(true);
        rv.setItemViewCacheSize(4);
        rv.setOverScrollMode(View.OVER_SCROLL_NEVER);
        rv.setClipToPadding(false);
        rv.setClipChildren(false); // the ring and grow draw outside the card
        rv.setPadding(dp(PAD_L), dp(PAD_T), dp(PAD_R), dp(PAD_B));
        rv.setAdapter(adapter);
        addView(rv, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private int dp(float v) {
        return Math.round(v * density * zoom);
    }

    // ----- data -----------------------------------------------------------------------

    static List<Ep> parse(String json) {
        List<Ep> out = new ArrayList<>();
        try {
            JSONArray arr = new JSONObject(json).optJSONArray("items");
            if (arr == null) return out;
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                Ep e = new Ep();
                e.key = o.optString("key");
                e.img = o.optString("img");
                e.label = o.optString("label");
                e.progress = (float) o.optDouble("progress", 0);
                e.watched = o.optBoolean("watched", false);
                e.spoiler = o.optBoolean("spoiler", false);
                out.add(e);
            }
        } catch (Throwable ignored) {
            /* bad payload: show nothing */
        }
        return out;
    }

    private static boolean same(List<Ep> a, List<Ep> b) {
        if (a.size() != b.size()) return false;
        for (int i = 0; i < a.size(); i++) {
            Ep x = a.get(i);
            Ep y = b.get(i);
            if (!x.key.equals(y.key) || !x.img.equals(y.img) || !x.label.equals(y.label)
                || x.progress != y.progress || x.watched != y.watched || x.spoiler != y.spoiler) return false;
        }
        return true;
    }

    private static boolean sameKeys(List<Ep> a, List<Ep> b) {
        if (a.size() != b.size()) return false;
        for (int i = 0; i < a.size(); i++) if (!a.get(i).key.equals(b.get(i).key)) return false;
        return true;
    }

    void setItems(List<Ep> next, String focusKey) {
        if (!same(eps, next)) {
            boolean keys = sameKeys(eps, next);
            boolean hadFocus = hasFocusInside();
            eps = next;
            if (keys) {
                adapter.notifyItemRangeChanged(0, eps.size()); // same cards: a rebind keeps Android focus
            } else {
                adapter.notifyDataSetChanged();
                int at = indexOf(idxKey);
                idx = at >= 0 ? at : Math.min(idx, Math.max(0, eps.size() - 1));
                if (hadFocus && !eps.isEmpty()) focusIndex(idx, true);
            }
        }
        if (eps.isEmpty()) {
            setVisibility(GONE);
            return;
        }
        updateVisibility();
        applyPendingFocus();
        if (focusKey != null && !focusKey.isEmpty() && indexOf(focusKey) >= 0 && idxKey.isEmpty()) {
            idx = indexOf(focusKey);
            idxKey = focusKey;
            lm.scrollToPositionWithOffset(idx, 0); // opens already scrolled to the spotlight card
        }
    }

    private int indexOf(String key) {
        if (key == null || key.isEmpty()) return -1;
        for (int i = 0; i < eps.size(); i++) if (eps.get(i).key.equals(key)) return i;
        return -1;
    }

    /** Where the web rail is, in the web page's layout px; {@code vw} is the page's layout width. */
    void setRect(float x, float y, float w, float h, float vw) {
        View parent = (View) getParent();
        if (parent == null || vw <= 0 || parent.getWidth() <= 0) return;
        float k = parent.getWidth() / vw;
        int pw = Math.round(w * k);
        int ph = Math.round(h * k);
        // The constants are the page at 100%; a smaller page (90% UI size...) has a shorter rail, and full-size
        // cards were cut off at its bottom. Scale them to the rail the page really has.
        float base = (PAD_T + CARD_H + PAD_B) * density;
        float nz = base > 0 ? Math.max(0.5f, Math.min(1.5f, ph / base)) : 1f;
        if (Math.abs(nz - zoom) > 0.004f) {
            zoom = nz;
            rv.setPadding(dp(PAD_L), dp(PAD_T), dp(PAD_R), dp(PAD_B));
            // New card views: their badge, tick and bar were sized at the old scale.
            rv.getRecycledViewPool().clear();
            rv.setAdapter(adapter);
            if (!eps.isEmpty()) lm.scrollToPositionWithOffset(Math.min(idx, eps.size() - 1), 0);
        }
        if (pw != lastW || ph != lastH) {
            lastW = pw;
            lastH = ph;
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(pw, ph, Gravity.TOP | Gravity.START);
            setLayoutParams(lp);
        }
        setTranslationX(x * k);
        setTranslationY(y * k);
        rectKnown = true;
        updateVisibility();
    }

    private void updateVisibility() {
        int want = rectKnown && !eps.isEmpty() ? VISIBLE : GONE;
        if (getVisibility() != want) setVisibility(want);
    }

    /** The page left (or the rail is gone). */
    void clear() {
        stopHold();
        handler.removeCallbacks(notifyFocus);
        holdPending = false;
        handler.removeCallbacks(holdTimeout);
        rectKnown = false;
        pendingKey = null;
        setSuppressed(false); // a page that left while a menu hid the rail must not leave the next one hidden
        eps = new ArrayList<>();
        idx = 0;
        idxKey = "";
        adapter.notifyDataSetChanged();
        setVisibility(GONE);
    }

    boolean hasFocusInside() {
        return getVisibility() == VISIBLE && findFocus() != null;
    }

    // ----- focus + scroll -------------------------------------------------------------

    /** The page asks the rail to take the remote on this episode (web focus landed on its hidden card). */
    private String pendingKey;

    void focusKey(String key) {
        if (eps.isEmpty() || getVisibility() != VISIBLE || getWidth() <= 0) {
            pendingKey = key == null ? "" : key; // the page focused its hidden card before the rail had data / a size
            applyPendingFocus();
            return;
        }
        pendingKey = null;
        // The page echoes every native focus move back (its hidden card takes focus too): already there, so leave the
        // pan and the ring alone. Re-claiming snapped the rail and made the ring blink.
        if (key != null && key.equals(idxKey) && findFocus() != null) return;
        int at = indexOf(key);
        if (at < 0) at = Math.min(idx, Math.max(0, eps.size() - 1));
        focusIndex(at, true);
    }

    private int attemptsLeft;

    private void retryPending() {
        postDelayed(() -> {
            if (pendingKey == null) return;
            if (!eps.isEmpty() && getVisibility() == VISIBLE && getWidth() > 0) {
                focusKey(pendingKey);
            } else if (attemptsLeft-- > 0) {
                retryPending();
            }
        }, 60);
    }

    /** Called when data or size arrives: honour a focus request that came too early. */
    private void applyPendingFocus() {
        if (pendingKey == null) return;
        attemptsLeft = 40;
        retryPending();
    }

    void restoreFocus() {
        if (eps.isEmpty()) return;
        focusIndex(Math.min(idx, eps.size() - 1), true);
    }

    private void focusIndex(int at, boolean instant) {
        idx = at;
        idxKey = eps.get(at).key;
        scrollFlush(at, instant);
        RecyclerView.ViewHolder vh = rv.findViewHolderForAdapterPosition(at);
        if (vh != null) {
            vh.itemView.requestFocus();
            return;
        }
        claimWhenBound(at, 12);
    }

    /** The target card is not bound yet (a scroll is still laying it out): keep trying, or focus is lost. */
    private void claimWhenBound(int at, int tries) {
        rv.postDelayed(() -> {
            if (idx != at || at >= eps.size()) return; // a newer move took over
            RecyclerView.ViewHolder late = rv.findViewHolderForAdapterPosition(at);
            if (late != null) {
                if (!late.itemView.isFocused()) late.itemView.requestFocus();
            } else if (tries > 0) {
                claimWhenBound(at, tries - 1);
            }
        }, 16);
    }

    /** The focused card slides flush to the rail's padded left edge, as the web rail pans. */
    private void scrollFlush(int at, boolean instant) {
        if (instant) {
            rv.stopScroll();
            lm.scrollToPositionWithOffset(at, 0);
            return;
        }
        LinearSmoothScroller scroller = new LinearSmoothScroller(getContext()) {
            @Override
            protected int getHorizontalSnapPreference() {
                return SNAP_TO_START;
            }

            @Override
            protected int calculateTimeForDeceleration(int dx) {
                return 170;
            }

            @Override
            protected int calculateTimeForScrolling(int dx) {
                return 170;
            }
        };
        scroller.setTargetPosition(at);
        lm.startSmoothScroll(scroller);
    }

    private void moveTo(int at, boolean instant) {
        long now = System.currentTimeMillis();
        boolean quick = instant || now - lastMoveAt < 220; // held / rapid presses jump, overlapping pans would bounce
        lastMoveAt = now;
        focusIndex(at, quick);
    }

    // ----- keys -----------------------------------------------------------------------

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (getVisibility() == VISIBLE && findFocus() != null && handleKey(event)) return true;
        return super.dispatchKeyEvent(event);
    }

    /** A menu or the sidebar is open over the page: the rail is not drawn (it sits above the WebView). */
    void setSuppressed(boolean on) {
        suppressed = on;
        setAlpha(on ? 0f : 1f);
    }

    private boolean suppressed;
    private long keepRingUntil;
    private final Runnable ringExpired = new Runnable() {
        @Override
        public void run() {
            for (int i = 0; i < rv.getChildCount(); i++) {
                View c = rv.getChildAt(i);
                if (!c.isFocused() && c.getScaleX() > 1f) c.animate().scaleX(1f).scaleY(1f).setDuration(180).start();
                c.invalidate();
                if (c instanceof Card) ((Card) c).updateRing();
            }
        }
    };

    private boolean handleKey(KeyEvent event) {
        int code = event.getKeyCode();
        boolean confirm = code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER
            || code == KeyEvent.KEYCODE_NUMPAD_ENTER || code == KeyEvent.KEYCODE_BUTTON_A;
        if (holdPending && (confirm || code == KeyEvent.KEYCODE_MENU)) {
            // The menu is opening on the page: this press stays here until it is let go.
            if (event.getAction() == KeyEvent.ACTION_UP) finishHold();
            return true;
        }
        if (code == KeyEvent.KEYCODE_MENU) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                View focused = findFocus();
                if (focused != null) focused.performLongClick();
            }
            return true;
        }
        boolean left = code == KeyEvent.KEYCODE_DPAD_LEFT;
        boolean right = code == KeyEvent.KEYCODE_DPAD_RIGHT;
        boolean up = code == KeyEvent.KEYCODE_DPAD_UP;
        boolean down = code == KeyEvent.KEYCODE_DPAD_DOWN;
        if (!(left || right || up || down)) return false;
        if (event.getAction() == KeyEvent.ACTION_UP) {
            if (left || right) stopHold();
            return true;
        }
        if (event.getRepeatCount() > 0) return true; // the hold timer drives held Left / Right
        long now = event.getEventTime();
        if (now - lastActivityAt > 250) {
            lastActivityAt = now;
            listener.onActivity();
        }
        if (eps.isEmpty()) return true;
        int at = Math.max(0, Math.min(idx, eps.size() - 1));
        if (up || down) {
            stopHold();
            listener.onVertical(up ? "up" : "down", eps.get(at).key);
            return true;
        }
        if (left) {
            if (at == 0) {
                stopHold();
                listener.onHandoff("left", eps.get(0).key);
                return true;
            }
            moveTo(at - 1, false);
            armHold(-1);
            return true;
        }
        if (at < eps.size() - 1) {
            moveTo(at + 1, false);
            armHold(1);
        }
        return true;
    }

    private void armHold(int dir) {
        stopHold();
        holdDir = dir;
        handler.postDelayed(holdTick, HOLD_START_MS);
    }

    private void stopHold() {
        holdDir = 0;
        handler.removeCallbacks(holdTick);
    }

    private void startMenuHold() {
        holdPending = true;
        handler.removeCallbacks(holdTimeout);
        handler.postDelayed(holdTimeout, 2500);
    }

    private void finishHold() {
        if (!holdPending) return;
        holdPending = false;
        handler.removeCallbacks(holdTimeout);
        listener.onHoldEnd();
    }

    @Override
    protected void onDetachedFromWindow() {
        stopHold();
        super.onDetachedFromWindow();
    }

    // ----- cards ----------------------------------------------------------------------

    private final class Adapter extends RecyclerView.Adapter<Holder> {
        @NonNull
        @Override
        public Holder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            return new Holder(new Card(parent.getContext()));
        }

        @Override
        public void onBindViewHolder(@NonNull Holder holder, int position) {
            holder.card.bind(position, eps.get(position), position == eps.size() - 1);
        }

        @Override
        public int getItemCount() {
            return eps.size();
        }
    }

    private static final class Holder extends RecyclerView.ViewHolder {
        final Card card;

        Holder(@NonNull Card card) {
            super(card);
            this.card = card;
        }
    }

    private final class Card extends FrameLayout {
        private final FrameLayout frame;
        private final ImageView image;
        private final View barTrack;
        private final View barFill;
        private final Badge badge;
        private final Tick tick;
        private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final float corner = dp(RADIUS);
        private Ep data;
        private int pos;

        Card(Context context) {
            super(context);
            setFocusable(true);
            setClickable(true);
            setLongClickable(true);
            setWillNotDraw(false);
            setClipChildren(false);
            ring.setStyle(Paint.Style.STROKE);
            ring.setColor(AMBER);
            ring.setStrokeWidth(dp(RING));

            frame = new FrameLayout(context);
            frame.setBackgroundColor(Color.argb(77, 0, 0, 0));
            frame.setOutlineProvider(new ViewOutlineProvider() {
                @Override
                public void getOutline(View view, Outline outline) {
                    outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), corner);
                }
            });
            frame.setClipToOutline(true);
            addView(frame, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            ringView = new RingView(context);
            ringView.setVisibility(GONE);

            image = new ImageView(context);
            image.setScaleType(ImageView.ScaleType.CENTER_CROP);
            frame.addView(image, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

            barTrack = new View(context);
            barTrack.setBackgroundColor(Color.argb(128, 0, 0, 0));
            frame.addView(barTrack, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(8), Gravity.BOTTOM));
            barFill = new View(context);
            barFill.setBackgroundColor(Color.rgb(229, 160, 13));
            frame.addView(barFill, new LayoutParams(0, dp(8), Gravity.BOTTOM | Gravity.START));

            badge = new Badge(context);
            LayoutParams blp = new LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.TOP | Gravity.START);
            blp.leftMargin = dp(12f);
            blp.topMargin = dp(11f);
            frame.addView(badge, blp);

            tick = new Tick(context);
            LayoutParams tlp = new LayoutParams(dp(30), dp(30), Gravity.TOP | Gravity.END);
            tlp.topMargin = dp(7.5f);
            tlp.rightMargin = dp(7.5f);
            frame.addView(tick, tlp);

            addView(ringView, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            setOnClickListener(v -> {
                if (data == null) return;
                keepRingUntil = System.currentTimeMillis() + 900; // the page takes the remote for a moment: the ring stays
                handler.postDelayed(ringExpired, 950);
                listener.onOpen(data.key);
            });
            setOnLongClickListener(v -> {
                if (data == null) return false;
                startMenuHold();
                listener.onLongPress(data.key);
                return true;
            });
        }

        boolean retained() {
            return data != null && System.currentTimeMillis() < keepRingUntil && data.key.equals(idxKey);
        }

        void bind(int position, Ep ep, boolean last) {
            pos = position;
            data = ep;
            RecyclerView.LayoutParams lp = new RecyclerView.LayoutParams(dp(CARD_W), Math.round(density * zoom * CARD_H));
            lp.rightMargin = last ? 0 : dp(GAP);
            setLayoutParams(lp);
            images.loadStill(ep.img, image, dp(CARD_W), Math.round(density * zoom * CARD_H), ep.spoiler);
            badge.setLabel(ep.label);
            badge.setVisibility(ep.label.isEmpty() ? GONE : VISIBLE);
            tick.setVisibility(ep.watched ? VISIBLE : GONE);
            if (ep.progress > 0f) {
                barTrack.setVisibility(VISIBLE);
                barFill.setVisibility(VISIBLE);
                LayoutParams plp = (LayoutParams) barFill.getLayoutParams();
                plp.width = Math.max(1, Math.round(dp(CARD_W) * Math.min(1f, ep.progress)));
                barFill.setLayoutParams(plp);
            } else {
                barTrack.setVisibility(GONE);
                barFill.setVisibility(GONE);
            }
            boolean focused = isFocused() || retained();
            setScaleX(focused ? FOCUS_SCALE : 1f);
            setScaleY(focused ? FOCUS_SCALE : 1f);
            updateRing();
        }

        /** The focus ring is its own child view: shown / hidden on focus, never re-recorded with the card. */
        private final RingView ringView;

        void updateRing() {
            boolean on = isFocused() || retained();
            if (on) {
                ringView.show();
            } else if (ringView.getVisibility() == VISIBLE) {
                // A moment of grace: a focus hand-over between two views never blinks the ring off.
                postDelayed(() -> {
                    if (!isFocused() && !retained()) ringView.setVisibility(GONE);
                }, 120);
            }
        }

        @Override
        protected void onFocusChanged(boolean gained, int direction, Rect previouslyFocusedRect) {
            super.onFocusChanged(gained, direction, previouslyFocusedRect);
            if (gained) NativeDetailRail.releaseHeldLooks();
            float to = (gained || retained()) ? FOCUS_SCALE : 1f;
            animate().cancel();
            animate().scaleX(to).scaleY(to).setDuration(180).setInterpolator(new DecelerateInterpolator()).start();
            invalidate();
            updateRing();
            if (gained && data != null) {
                idx = pos;
                idxKey = data.key;
                notifyKey = data.key;
                handler.removeCallbacks(notifyFocus);
                handler.postDelayed(notifyFocus, FOCUS_NOTIFY_MS);
            }
        }
    }

    /** The focus ring, drawn just outside the card's edge (the parent does not clip children). */
    private final class RingView extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private float inset;

        RingView(Context context) {
            super(context);
            paint.setStyle(Paint.Style.STROKE);
            setWillNotDraw(false);
            setFocusable(false);
            setClickable(false);
        }

        void show() {
            paint.setColor(NativeHomeView.ringColor != 0 ? NativeHomeView.ringColor : AMBER);
            paint.setStrokeWidth(dp(RING) * NativeHomeView.ringScale);
            inset = dp(RING / 2f) * NativeHomeView.ringScale;
            if (getVisibility() != VISIBLE) setVisibility(VISIBLE);
            invalidate();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            float corner = dp(RADIUS);
            canvas.drawRoundRect(-inset, -inset, getWidth() + inset, getHeight() + inset, corner + inset, corner + inset, paint);
        }
    }

    /** "E1": black rounded label, top left of the still. */
    private final class Badge extends View {
        private final Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
        private String label = "";

        Badge(Context context) {
            super(context);
            bg.setColor(Color.BLACK);
            text.setColor(Color.WHITE);
            text.setTypeface(badgeFace);
            text.setTextSize(dp(16.4f));
            text.setLetterSpacing(0.04f);
        }

        void setLabel(String value) {
            label = value == null ? "" : value;
            requestLayout();
            invalidate();
        }

        @Override
        protected void onMeasure(int w, int h) {
            setMeasuredDimension(Math.round(text.measureText(label)) + dp(18f), dp(29.4f));
        }

        @Override
        protected void onDraw(Canvas canvas) {
            canvas.drawRoundRect(new RectF(0, 0, getWidth(), getHeight()), dp(7f), dp(7f), bg);
            Paint.FontMetrics fm = text.getFontMetrics();
            canvas.drawText(label, dp(9f), getHeight() / 2f - (fm.ascent + fm.descent) / 2f, text);
        }
    }

    /** The watched tick: amber disc with a dark check, top right (episode cards). */
    private final class Tick extends View {
        private final Paint disc = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint check = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Path path = new Path();

        Tick(Context context) {
            super(context);
            disc.setColor(Color.rgb(229, 160, 13));
            check.setStyle(Paint.Style.STROKE);
            check.setStrokeCap(Paint.Cap.ROUND);
            check.setStrokeJoin(Paint.Join.ROUND);
            check.setColor(Color.rgb(9, 9, 11));
        }

        @Override
        protected void onDraw(Canvas canvas) {
            float w = getWidth();
            float cx = w / 2f;
            float cy = getHeight() / 2f;
            disc.setShadowLayer(dp(3), 0, dp(1.5f), Color.argb(90, 0, 0, 0));
            canvas.drawCircle(cx, cy, w / 2f - dp(2), disc);
            float size = dp(15);
            float s = size / 24f;
            check.setStrokeWidth(2.5f * s);
            path.reset();
            float ox = cx - size / 2f;
            float oy = cy - size / 2f;
            path.moveTo(ox + 20 * s, oy + 6 * s);
            path.lineTo(ox + 9 * s, oy + 17 * s);
            path.lineTo(ox + 4 * s, oy + 12 * s);
            canvas.drawPath(path, check);
        }
    }
}
