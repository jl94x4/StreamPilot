package com.servermanagerportal.mediaplayer;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.view.animation.PathInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.LinearSmoothScroller;
import androidx.recyclerview.widget.RecyclerView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * A horizontal rail of a TV details page (cast, related titles), drawn natively at the rect of the web rail.
 * The web rail stays in the page (invisible, still focusable) so Up / Down navigation, the held menu and the
 * open all keep running on it; this view owns Left / Right and hands every other key back. Every size comes in
 * the payload (measured off the web cards, in the page's layout px) and is scaled to the screen here.
 * One instance per rail (the plugin keeps them by id).
 */
final class NativeDetailRail extends FrameLayout {

    static final class Item {
        String key = "";
        String img = "";
        String title = "";
        String sub = "";
        float progress;
        boolean watched;
    }

    static final class Layout {
        float cardW = 110f;
        float imgW = 110f;
        float imgH = 165f;
        float gap = 16f;
        float padL = 0f;
        float padT = 0f;
        float padR = 40f;
        float padB = 0f;
        float radius = 6f;
        boolean circle;
        boolean center;
        boolean menu = true;
        float capTop = 8f;
        float titleSize = 14f;
        float titleLine = 17f;
        int titleLines = 2;
        int titleColor = Color.WHITE;
        boolean titleBold;
        float subSize = 12f;
        float subLine = 16f;
        int subLines = 1;
        int subColor = Color.argb(160, 255, 255, 255);
        float subTop = 2f;
    }

    private static final float FOCUS_SCALE = 1.042f;
    private static final long FOCUS_NOTIFY_MS = 110;
    private static final long HOLD_START_MS = 180;
    private static final long HOLD_STEP_MS = 55;
    private static final int AMBER = Color.rgb(245, 158, 11);

    private final NativeEpisodeRail.Listener listener;
    private final NativeHomeImages images;
    private final float density;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final RecyclerView rv;
    private final LinearLayoutManager lm;
    private final Adapter adapter = new Adapter();
    private final Typeface face;
    private final Typeface bold;
    private final String id;

    private List<Item> items = new ArrayList<>();
    private Layout layout = new Layout();
    private float k = 1f; // page layout px -> screen px
    private int idx;
    private String idxKey = "";
    private boolean rectKnown;
    private long lastActivityAt;
    private long lastMoveAt;
    private int holdDir;
    private boolean holdPending;
    private String notifyKey = "";
    private int lastW;
    private int lastH;
    private boolean suppressed;
    private float lastVw;

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
            if (next < 0 || next >= items.size()) {
                holdDir = 0;
                return;
            }
            moveTo(next, true);
            handler.postDelayed(this, HOLD_STEP_MS);
        }
    };
    private final Runnable holdTimeout = this::finishHold;

    NativeDetailRail(Context context, String id, NativeHomeImages images, NativeEpisodeRail.Listener listener) {
        super(context);
        this.id = id;
        this.images = images;
        this.listener = listener;
        this.density = context.getResources().getDisplayMetrics().density;
        this.face = loadFace(context);
        this.bold = NativeHomeView.font(context, 700);
        setVisibility(GONE);
        setClipChildren(false); // a caption line below the web rail's rect must not be cut off
        setFocusable(false);
        // A card that becomes visible must not grab the remote from the page on its own: focus only goes in when asked.
        setDescendantFocusability(FOCUS_BLOCK_DESCENDANTS);

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
        rv.setHasFixedSize(false);
        rv.setItemViewCacheSize(6);
        rv.setOverScrollMode(View.OVER_SCROLL_NEVER);
        rv.setClipToPadding(false);
        rv.setClipChildren(false);
        rv.setAdapter(adapter);
        addView(rv, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    /** Looks kept lit for a moment after focus left a native view (handoff gap): dropped the moment any native view gains focus. */
    private static final java.util.ArrayList<Runnable> HELD_LOOKS = new java.util.ArrayList<>();

    static void holdLook(Runnable drop) {
        HELD_LOOKS.add(drop);
    }

    static void releaseHeldLooks() {
        if (HELD_LOOKS.isEmpty()) return;
        java.util.ArrayList<Runnable> copy = new java.util.ArrayList<>(HELD_LOOKS);
        HELD_LOOKS.clear();
        for (Runnable run : copy) run.run();
    }

    private static Typeface loadFace(Context context) {
        if (NativeFonts.custom()) return NativeFonts.face(context, 400);
        try {
            return Typeface.createFromAsset(context.getAssets(), "native-fonts/creato-500.otf");
        } catch (Throwable t) {
            return NativeHomeView.font(context, 400);
        }
    }

    String id() {
        return id;
    }

    private int px(float layoutPx) {
        return Math.round(layoutPx * k);
    }

    // ----- data -----------------------------------------------------------------------

    static List<Item> parseItems(JSONObject root) {
        List<Item> out = new ArrayList<>();
        JSONArray arr = root.optJSONArray("items");
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            Item it = new Item();
            it.key = o.optString("key");
            it.img = o.optString("img");
            it.title = o.optString("title");
            it.sub = o.optString("sub");
            it.progress = (float) o.optDouble("progress", 0);
            it.watched = o.optBoolean("watched", false);
            out.add(it);
        }
        return out;
    }

    private static int color(JSONObject o, String name, int fallback) {
        JSONArray a = o.optJSONArray(name);
        if (a == null || a.length() < 3) return fallback;
        return Color.argb((int) Math.round(255 * a.optDouble(3, 1.0)), a.optInt(0), a.optInt(1), a.optInt(2));
    }

    static Layout parseLayout(JSONObject root) {
        Layout l = new Layout();
        JSONObject o = root.optJSONObject("layout");
        if (o == null) return l;
        l.cardW = (float) o.optDouble("cardW", l.cardW);
        l.imgW = (float) o.optDouble("imgW", l.cardW);
        l.imgH = (float) o.optDouble("imgH", l.imgH);
        l.gap = (float) o.optDouble("gap", l.gap);
        l.padL = (float) o.optDouble("padL", l.padL);
        l.padT = (float) o.optDouble("padT", l.padT);
        l.padR = (float) o.optDouble("padR", l.padR);
        l.padB = (float) o.optDouble("padB", l.padB);
        l.radius = (float) o.optDouble("radius", l.radius);
        l.circle = o.optBoolean("circle", false);
        l.center = o.optBoolean("center", false);
        l.menu = o.optBoolean("menu", true);
        l.capTop = (float) o.optDouble("capTop", l.capTop);
        l.titleSize = (float) o.optDouble("titleSize", l.titleSize);
        l.titleLine = (float) o.optDouble("titleLine", l.titleLine);
        l.titleLines = o.optInt("titleLines", l.titleLines);
        l.titleColor = color(o, "titleColor", l.titleColor);
        l.titleBold = o.optBoolean("titleBold", false);
        l.subSize = (float) o.optDouble("subSize", l.subSize);
        l.subLine = (float) o.optDouble("subLine", l.subLine);
        l.subLines = o.optInt("subLines", l.subLines);
        l.subColor = color(o, "subColor", l.subColor);
        l.subTop = (float) o.optDouble("subTop", l.subTop);
        return l;
    }

    private static boolean sameItems(List<Item> a, List<Item> b) {
        if (a.size() != b.size()) return false;
        for (int i = 0; i < a.size(); i++) {
            Item x = a.get(i);
            Item y = b.get(i);
            if (!x.key.equals(y.key) || !x.img.equals(y.img) || !x.title.equals(y.title) || !x.sub.equals(y.sub)
                || x.progress != y.progress || x.watched != y.watched) return false;
        }
        return true;
    }

    private static boolean sameKeys(List<Item> a, List<Item> b) {
        if (a.size() != b.size()) return false;
        for (int i = 0; i < a.size(); i++) if (!a.get(i).key.equals(b.get(i).key)) return false;
        return true;
    }

    void setData(JSONObject root, String focusKey) {
        List<Item> next = parseItems(root);
        Layout nextLayout = parseLayout(root);
        boolean layoutChanged = !sameLayout(layout, nextLayout);
        layout = nextLayout;
        if (layoutChanged) applyPadding();
        if (!sameItems(items, next) || layoutChanged) {
            boolean keys = sameKeys(items, next);
            boolean hadFocus = hasFocusInside();
            items = next;
            if (keys && !layoutChanged) {
                adapter.notifyItemRangeChanged(0, items.size());
            } else {
                adapter.notifyDataSetChanged();
                int at = indexOf(idxKey);
                idx = at >= 0 ? at : Math.min(idx, Math.max(0, items.size() - 1));
                if (hadFocus && !items.isEmpty()) focusIndex(idx, true);
            }
        }
        if (items.isEmpty()) {
            setVisibility(GONE);
            return;
        }
        updateVisibility();
        if (focusKey != null && !focusKey.isEmpty() && indexOf(focusKey) >= 0 && idxKey.isEmpty()) {
            idx = indexOf(focusKey);
            idxKey = focusKey;
            lm.scrollToPositionWithOffset(idx, 0);
        }
    }

    private static boolean sameLayout(Layout a, Layout b) {
        return a.cardW == b.cardW && a.imgW == b.imgW && a.imgH == b.imgH && a.gap == b.gap
            && a.padL == b.padL && a.padT == b.padT && a.padR == b.padR && a.padB == b.padB
            && a.radius == b.radius && a.circle == b.circle && a.center == b.center && a.capTop == b.capTop
            && a.titleSize == b.titleSize && a.titleLine == b.titleLine && a.titleLines == b.titleLines
            && a.titleColor == b.titleColor && a.titleBold == b.titleBold && a.subSize == b.subSize
            && a.subLine == b.subLine && a.subLines == b.subLines && a.subColor == b.subColor && a.subTop == b.subTop;
    }

    private void applyPadding() {
        rv.setPadding(px(layout.padL), px(layout.padT), px(layout.padR), px(layout.padB));
    }

    private int indexOf(String key) {
        if (key == null || key.isEmpty()) return -1;
        for (int i = 0; i < items.size(); i++) if (items.get(i).key.equals(key)) return i;
        return -1;
    }

    boolean hasKey(String key) {
        return indexOf(key) >= 0;
    }

    /** Where the web rail is, in the web page's layout px; {@code vw} is the page's layout width. */
    void setRect(float x, float y, float w, float h, float vw) {
        View parent = (View) getParent();
        if (parent == null || vw <= 0 || parent.getWidth() <= 0) return;
        float nk = parent.getWidth() / vw;
        if (Math.abs(nk - k) > 0.0001f || vw != lastVw) {
            k = nk;
            lastVw = vw;
            applyPadding();
            adapter.notifyDataSetChanged();
        }
        int pw = Math.round(w * k);
        // Slack below the web rail: the cards are measured against this height, and a caption taller than the web's (two role lines) was squeezed and cut off.
        int ph = Math.round((h + 80f) * k);
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

    /** The page left (or the rail is gone). */
    void clear() {
        allowFocus(false);
        stopHold();
        handler.removeCallbacks(notifyFocus);
        holdPending = false;
        handler.removeCallbacks(holdTimeout);
        rectKnown = false;
        setSuppressed(false);
        items = new ArrayList<>();
        idx = 0;
        idxKey = "";
        adapter.notifyDataSetChanged();
        setVisibility(GONE);
    }

    private View findFocusInRail() {
        return findFocus();
    }

    boolean hasFocusInside() {
        return getVisibility() == VISIBLE && findFocus() != null;
    }

    // ----- focus + scroll -------------------------------------------------------------

    void focusKey(String key) {
        if (items.isEmpty()) return;
        if (key != null && key.equals(idxKey) && findFocus() != null) return; // the page echoing our own move
        int at = indexOf(key);
        if (at < 0) at = Math.min(idx, items.size() - 1);
        focusIndex(at, true);
    }

    private void allowFocus(boolean on) {
        setDescendantFocusability(on ? FOCUS_AFTER_DESCENDANTS : FOCUS_BLOCK_DESCENDANTS);
    }

    private void focusIndex(int at, boolean instant) {
        allowFocus(true);
        idx = at;
        idxKey = items.get(at).key;
        scrollFlush(at, instant);
        RecyclerView.ViewHolder vh = rv.findViewHolderForAdapterPosition(at);
        if (vh != null) {
            vh.itemView.requestFocus();
            return;
        }
        rv.post(() -> {
            RecyclerView.ViewHolder late = rv.findViewHolderForAdapterPosition(at);
            if (late != null) late.itemView.requestFocus();
        });
    }

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
        boolean quick = instant || now - lastMoveAt < 220;
        lastMoveAt = now;
        focusIndex(at, quick);
    }

    // ----- keys -----------------------------------------------------------------------

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (getVisibility() == VISIBLE && findFocus() != null && handleKey(event)) return true;
        return super.dispatchKeyEvent(event);
    }

    void setSuppressed(boolean on) {
        suppressed = on;
        setAlpha(on ? 0f : 1f);
    }

    private boolean handleKey(KeyEvent event) {
        int code = event.getKeyCode();
        boolean confirm = code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER
            || code == KeyEvent.KEYCODE_NUMPAD_ENTER || code == KeyEvent.KEYCODE_BUTTON_A;
        if (holdPending && (confirm || code == KeyEvent.KEYCODE_MENU)) {
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
        if (event.getRepeatCount() > 0) return true;
        long now = event.getEventTime();
        if (now - lastActivityAt > 250) {
            lastActivityAt = now;
            listener.onActivity();
        }
        if (items.isEmpty()) return true;
        int at = Math.max(0, Math.min(idx, items.size() - 1));
        if (up || down) {
            stopHold();
            listener.onVertical(up ? "up" : "down", items.get(at).key);
            allowFocus(false);
            return true;
        }
        if (left) {
            if (at == 0) {
                stopHold();
                listener.onHandoff("left", items.get(0).key);
                allowFocus(false);
                return true;
            }
            moveTo(at - 1, false);
            armHold(-1);
            return true;
        }
        if (at < items.size() - 1) {
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
            return new Holder(new Cell(parent.getContext()));
        }

        @Override
        public void onBindViewHolder(@NonNull Holder holder, int position) {
            holder.cell.bind(position, items.get(position), position == items.size() - 1);
        }

        @Override
        public int getItemCount() {
            return items.size();
        }
    }

    private static final class Holder extends RecyclerView.ViewHolder {
        final Cell cell;

        Holder(@NonNull Cell cell) {
            super(cell);
            this.cell = cell;
        }
    }

    private final class Cell extends LinearLayout {
        private final Pic pic;
        private final TextView title;
        private final TextView sub;
        private Item data;
        private int pos;

        Cell(Context context) {
            super(context);
            setOrientation(VERTICAL);
            setFocusable(true);
            setClickable(true);
            setLongClickable(true);
            setClipChildren(false);
            setClipToPadding(false);

            pic = new Pic(context);
            addView(pic, new LinearLayout.LayoutParams(100, 100));
            title = text(context);
            addView(title, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            sub = text(context);
            addView(sub, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

            setOnClickListener(v -> {
                if (data != null) listener.onOpen(data.key);
            });
            setOnLongClickListener(v -> {
                if (data == null || !layout.menu) return false;
                startMenuHold();
                listener.onLongPress(data.key);
                return true;
            });
        }

        private final Runnable dropLook = this::dropLookNow;

        private void dropLookNow() {
            if (!isFocused()) pic.setFocusedLook(false);
        }

        private TextView text(Context context) {
            TextView t = new TextView(context);
            t.setIncludeFontPadding(false);
            t.setEllipsize(TextUtils.TruncateAt.END);
            return t;
        }

        private void style(TextView t, Typeface tf, float size, float line, int lines, int color, float top, boolean center) {
            t.setTypeface(tf);
            t.setTextColor(color);
            t.setMaxLines(Math.max(1, lines));
            t.setGravity(center ? Gravity.CENTER_HORIZONTAL : Gravity.START);
            t.setTextSize(TypedValue.COMPLEX_UNIT_PX, size * k);
            Paint.FontMetrics fm = t.getPaint().getFontMetrics();
            float natural = fm.descent - fm.ascent;
            t.setLineSpacing(Math.max(0f, line * k - natural), 1f);
            LinearLayout.LayoutParams lp = (LinearLayout.LayoutParams) t.getLayoutParams();
            lp.topMargin = px(top);
            t.setLayoutParams(lp);
        }

        void bind(int position, Item item, boolean last) {
            pos = position;
            data = item;
            Layout l = layout;
            RecyclerView.LayoutParams lp = new RecyclerView.LayoutParams(px(l.cardW), ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.rightMargin = last ? 0 : px(l.gap);
            setLayoutParams(lp);
            LinearLayout.LayoutParams plp = (LinearLayout.LayoutParams) pic.getLayoutParams();
            plp.width = px(l.imgW);
            plp.height = px(l.imgH);
            plp.gravity = l.center ? Gravity.CENTER_HORIZONTAL : Gravity.START;
            pic.setLayoutParams(plp);
            pic.bind(item);
            title.setText(item.title);
            title.setVisibility(item.title.isEmpty() ? GONE : VISIBLE);
            style(title, l.titleBold ? bold : face, l.titleSize, l.titleLine, l.titleLines, l.titleColor, l.capTop, l.center);
            sub.setText(item.sub);
            sub.setVisibility(item.sub.isEmpty() ? GONE : VISIBLE);
            style(sub, face, l.subSize, l.subLine, l.subLines, l.subColor, l.subTop, l.center);
        }

        @Override
        protected void onFocusChanged(boolean gained, int direction, Rect previouslyFocusedRect) {
            super.onFocusChanged(gained, direction, previouslyFocusedRect);
            if (gained) {
                removeCallbacks(dropLook);
                releaseHeldLooks();
                pic.setFocusedLook(true);
            } else {
                // Moving to a neighbour drops the look at once. Leaving the rail (native<->web handoff) leaves ~150ms with
                // nothing focused, so keep the look briefly instead of blinking off and on.
                post(() -> {
                    if (findFocusInRail() == null) {
                        allowFocus(false);
                        postDelayed(dropLook, 240);
                        holdLook(dropLook);
                    } else {
                        pic.setFocusedLook(false);
                    }
                });
            }
            if (gained && data != null) {
                idx = pos;
                idxKey = data.key;
                notifyKey = data.key;
                handler.removeCallbacks(notifyFocus);
                handler.postDelayed(notifyFocus, FOCUS_NOTIFY_MS);
            }
        }
    }

    /** The picture (rounded or round) with its watch bar, watched tick, and the focus ring + grow. */
    private final class Pic extends FrameLayout {
        private final ImageView image;
        private final View barTrack;
        private final View barFill;
        private final Tick tick;
        private final FrameLayout frame;
        private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
        private PersonView person;
        private boolean focusedLook;

        Pic(Context context) {
            super(context);
            setWillNotDraw(false);
            setClipChildren(false);
            ring.setStyle(Paint.Style.STROKE);
            frame = new FrameLayout(context);
            frame.setBackgroundColor(Color.rgb(22, 27, 34));
            frame.setOutlineProvider(new ViewOutlineProvider() {
                @Override
                public void getOutline(View view, Outline outline) {
                    if (layout.circle) {
                        outline.setOval(0, 0, view.getWidth(), view.getHeight());
                    } else {
                        outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), px(layout.radius));
                    }
                }
            });
            frame.setClipToOutline(true);
            addView(frame, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            image = new ImageView(context);
            image.setScaleType(ImageView.ScaleType.CENTER_CROP);
            frame.addView(image, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            person = new PersonView(context);
            person.setVisibility(GONE);
            frame.addView(person, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            barTrack = new View(context);
            barTrack.setBackgroundColor(Color.argb(179, 0, 0, 0));
            frame.addView(barTrack, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 8, Gravity.BOTTOM));
            barFill = new View(context);
            barFill.setBackgroundColor(Color.rgb(229, 160, 13));
            frame.addView(barFill, new LayoutParams(0, 8, Gravity.BOTTOM | Gravity.START));
            tick = new Tick(context);
            frame.addView(tick, new LayoutParams(30, 30));
        }

        void bind(Item item) {
            int w = px(layout.imgW);
            int h = px(layout.imgH);
            frame.invalidateOutline();
            person.setVisibility(GONE);
            images.load(item.img, image, w, h, () -> {
                // A cast member without a photo: the web page's people icon, not an empty disc.
                if (layout.circle) person.setVisibility(VISIBLE);
            });
            int barH = px(8f);
            ((LayoutParams) barTrack.getLayoutParams()).height = barH;
            if (item.progress > 0f) {
                barTrack.setVisibility(VISIBLE);
                barFill.setVisibility(VISIBLE);
                LayoutParams plp = (LayoutParams) barFill.getLayoutParams();
                plp.height = barH;
                plp.width = Math.max(1, Math.round(w * Math.min(1f, item.progress)));
                barFill.setLayoutParams(plp);
            } else {
                barTrack.setVisibility(GONE);
                barFill.setVisibility(GONE);
            }
            if (item.watched) {
                LayoutParams tlp = (LayoutParams) tick.getLayoutParams();
                tlp.width = px(12f);
                tlp.height = px(12f);
                int edge = px(3f);
                tlp.gravity = Gravity.BOTTOM | Gravity.START;
                tlp.leftMargin = edge;
                tlp.bottomMargin = px(item.progress > 0f ? 6f : 3f);
                tick.setLayoutParams(tlp);
                tick.setVisibility(VISIBLE);
            } else {
                tick.setVisibility(GONE);
            }
            setFocusedLook(getParent() != null && ((View) getParent()).isFocused());
        }

        void setFocusedLook(boolean on) {
            focusedLook = on;
            float to = on ? FOCUS_SCALE : 1f;
            animate().cancel();
            animate().scaleX(to).scaleY(to).setDuration(240)
                .setInterpolator(new PathInterpolator(0.22f, 1f, 0.36f, 1f)).start();
            invalidate();
        }

        @Override
        protected void dispatchDraw(Canvas canvas) {
            super.dispatchDraw(canvas);
            if (!focusedLook) return;
            float scale = NativeHomeView.ringScale;
            ring.setColor(NativeHomeView.ringColor != 0 ? NativeHomeView.ringColor : AMBER);
            float stroke = px(3f) * scale;
            ring.setStrokeWidth(stroke);
            // Grow inward once the ring would reach the next card: the gap (less the focus zoom) is the room outside.
            float room = (px(layout.gap) / 2f - (FOCUS_SCALE - 1f) * getWidth() / 2f) / FOCUS_SCALE;
            float outer = Math.min(px(1.5f) * scale + stroke / 2f, Math.max(px(1f), room - px(1f)));
            float inset = outer - stroke / 2f;
            if (layout.circle) {
                canvas.drawOval(-inset, -inset, getWidth() + inset, getHeight() + inset, ring);
            } else {
                float r = px(layout.radius) + inset;
                canvas.drawRoundRect(-inset, -inset, getWidth() + inset, getHeight() + inset, r, r, ring);
            }
        }
    }

    /** The web page's "Users" placeholder for a cast member with no photo. */
    private final class PersonView extends View {
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Path path = new Path();

        PersonView(Context context) {
            super(context);
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeCap(Paint.Cap.ROUND);
            p.setStrokeJoin(Paint.Join.ROUND);
            p.setColor(Color.argb(160, 148, 163, 184));
        }

        @Override
        protected void onDraw(Canvas canvas) {
            float size = getWidth() * 0.30f;
            float s = size / 24f;
            float ox = (getWidth() - size) / 2f;
            float oy = (getHeight() - size) / 2f;
            p.setStrokeWidth(2f * s);
            // lucide "users": a head and shoulders, and a second person behind.
            canvas.drawCircle(ox + 9 * s, oy + 7 * s, 4 * s, p);
            path.reset();
            path.moveTo(ox + 2 * s, oy + 21 * s);
            path.lineTo(ox + 2 * s, oy + 19 * s);
            path.cubicTo(ox + 2 * s, oy + 16.8f * s, ox + 4 * s, oy + 15 * s, ox + 6 * s, oy + 15 * s);
            path.lineTo(ox + 12 * s, oy + 15 * s);
            path.cubicTo(ox + 14 * s, oy + 15 * s, ox + 16 * s, oy + 16.8f * s, ox + 16 * s, oy + 19 * s);
            path.lineTo(ox + 16 * s, oy + 21 * s);
            canvas.drawPath(path, p);
            path.reset();
            path.moveTo(ox + 16 * s, oy + 3.1f * s);
            path.cubicTo(ox + 18.3f * s, oy + 3.7f * s, ox + 19.5f * s, oy + 5.2f * s, ox + 19.5f * s, oy + 7 * s);
            path.cubicTo(ox + 19.5f * s, oy + 8.8f * s, ox + 18.3f * s, oy + 10.3f * s, ox + 16 * s, oy + 10.9f * s);
            canvas.drawPath(path, p);
            path.reset();
            path.moveTo(ox + 22 * s, oy + 21 * s);
            path.lineTo(ox + 22 * s, oy + 19 * s);
            path.cubicTo(ox + 22 * s, oy + 17.2f * s, ox + 20.8f * s, oy + 15.7f * s, ox + 19 * s, oy + 15.1f * s);
            canvas.drawPath(path, p);
        }
    }

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
            disc.setShadowLayer(px(1.2f), 0, px(0.6f), Color.argb(90, 0, 0, 0));
            canvas.drawCircle(cx, cy, w / 2f - px(0.8f), disc);
            float size = px(9f);
            float s = size / 24f;
            check.setStrokeWidth(3.2f * s);
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
