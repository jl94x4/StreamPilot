package com.servermanagerportal.mediaplayer;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.Base64;
import android.util.LruCache;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.PathInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.GridLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * A library's Browse grid (poster, watched tick, watch bar, title + year caption), drawn natively behind the
 * page. The page keeps its (invisible) copy of the grid for menus, paging and every action, plus the header
 * (tabs, sort, filters) and the A-Z bar. Every size comes from the page's own layout ({@code layout} in the
 * payload, in the page's layout px, scaled to the screen here), so the cards line up with the web ones.
 * Left / Right / Up / Down walk the grid here; the edges are handed back to the page.
 */
final class NativeBrowseGrid extends FrameLayout {

    interface Listener {
        void onOpen(String key);
        void onLongPress(String key);
        /** The focused card changed (index into the list). */
        void onFocus(String key, int index);
        /** Up from the first row, Right from the last column / card: the page runs the key from that card. */
        void onHandoff(String dir, String key);
        void onEdgeLeft();
        void onActivity();
        void onHoldEnd();
        /** The grid scrolled: {@code y} px (page layout px) the content moved up from its start (header sync). */
        void onScroll(float y);
    }

    static final class Item {
        String key = "";
        String img = "";
        String title = "";
        String sub = "";
        String note = "";
        float progress;
        boolean watched;
        String tick = "bottom-left";
        /** "poster" (default), "tile" (Studios: tinted backdrop + logo) or "header" (a section title). */
        String type = "poster";
        int tint = Color.rgb(44, 79, 134);
        /** Whitened logo as a data URL; wantLogo with no logo yet draws nothing (no flash of the name). */
        String logo = "";
        boolean wantLogo;
        /** Header: extra space above it (layout px). */
        float top;
    }

    static final class Layout {
        int cols = 8;
        float cardW = 200.7f;
        float colGap = 12.5f;
        float rowGap = 12.5f;
        float posterH = 301f;
        float radius = 6f;
        float padL = 136f;
        float padT = 202f;
        float capTop = 11f;
        float capLeft = 0f;
        float titleSize = 17f;
        float titleLine = 21.25f;
        float subSize = 14f;
        float subLine = 25f;
        float subTop = 2.5f;
        float bottomPad = 160f;
        boolean square;
        /** Studios: tiles and section headers instead of posters and captions. */
        boolean tile;
        float headH = 60f;
        float headRowH = 40f;
        float headSize = 29f;
        float nameSize = 19f;
    }

    private static final float FOCUS_SCALE = 1.042f;
    private static final int AMBER = Color.rgb(245, 158, 11);

    private final Listener listener;
    private final NativeHomeImages images;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final RecyclerView rv;
    private final GridLayoutManager lm;
    private final Adapter adapter = new Adapter();
    private final Typeface face;

    private List<Item> items = new ArrayList<>();
    private Layout layout = new Layout();
    private float k = 1f; // page layout px -> screen px
    private int idx;
    private String idxKey = "";
    private long lastActivityAt;
    private boolean holdPending;
    private long lastReportedScrollAt;
    private float lastScrollY = -1f;
    private int lastPadT;
    private boolean inputBlocked;
    private final Runnable holdTimeout = this::finishHold;

    NativeBrowseGrid(Context context, NativeHomeImages images, Listener listener) {
        super(context);
        this.images = images;
        this.listener = listener;
        this.face = loadFace(context);
        setVisibility(GONE);
        setFocusable(false);

        rv = new RecyclerView(context);
        lm = new GridLayoutManager(context, 8) {
            @Override
            public boolean requestChildRectangleOnScreen(@NonNull RecyclerView parent, @NonNull View child,
                                                         @NonNull Rect rect, boolean immediate, boolean focusedChildVisible) {
                return false; // scrolled by hand (see ensureVisible)
            }
        };
        lm.setSpanSizeLookup(new GridLayoutManager.SpanSizeLookup() {
            @Override
            public int getSpanSize(int position) {
                return isHeader(position) ? Math.max(1, layout.cols) : 1;
            }
        });
        rv.setLayoutManager(lm);
        rv.setItemAnimator(null);
        rv.setHasFixedSize(false);
        rv.setItemViewCacheSize(8);
        rv.setOverScrollMode(View.OVER_SCROLL_NEVER);
        rv.setClipToPadding(false);
        rv.setClipChildren(false);
        rv.setAdapter(adapter);
        rv.addOnScrollListener(new RecyclerView.OnScrollListener() {
            @Override
            public void onScrolled(@NonNull RecyclerView r, int dx, int dy) {
                reportScroll();
            }
        });
        addView(rv, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private static Typeface loadFace(Context context) {
        if (NativeFonts.custom()) return NativeFonts.face(context, 500);
        try {
            return Typeface.createFromAsset(context.getAssets(), "native-fonts/creato-500.otf");
        } catch (Throwable t) {
            return NativeHomeView.font(context, 500);
        }
    }

    private int[] secStart = new int[0];

    private boolean isHeader(int i) {
        return i >= 0 && i < items.size() && "header".equals(items.get(i).type);
    }

    /** Studios: for every item, the index of the section header it sits under. */
    private void indexSections() {
        secStart = new int[items.size()];
        int cur = 0;
        for (int i = 0; i < items.size(); i++) {
            if (isHeader(i)) cur = i;
            secStart[i] = cur;
        }
    }

    private int sectionCount(int header) {
        int n = 0;
        for (int i = header + 1; i < items.size() && !isHeader(i); i++) n++;
        return n;
    }

    private int px(float layoutPx) {
        return Math.round(layoutPx * k);
    }

    // ----- data -----------------------------------------------------------------------

    static Layout parseLayout(JSONObject o) {
        Layout l = new Layout();
        if (o == null) return l;
        l.cols = Math.max(1, o.optInt("cols", l.cols));
        l.cardW = (float) o.optDouble("cardW", l.cardW);
        l.colGap = (float) o.optDouble("colGap", l.colGap);
        l.rowGap = (float) o.optDouble("rowGap", l.rowGap);
        l.posterH = (float) o.optDouble("posterH", l.posterH);
        l.radius = (float) o.optDouble("radius", l.radius);
        l.padL = (float) o.optDouble("padL", l.padL);
        l.padT = (float) o.optDouble("padT", l.padT);
        l.capTop = (float) o.optDouble("capTop", l.capTop);
        l.capLeft = (float) o.optDouble("capLeft", l.capLeft);
        l.titleSize = (float) o.optDouble("titleSize", l.titleSize);
        l.titleLine = (float) o.optDouble("titleLine", l.titleLine);
        l.subSize = (float) o.optDouble("subSize", l.subSize);
        l.subLine = (float) o.optDouble("subLine", l.subLine);
        l.subTop = (float) o.optDouble("subTop", l.subTop);
        l.bottomPad = (float) o.optDouble("bottomPad", l.bottomPad);
        l.square = o.optBoolean("square", false);
        l.tile = o.optBoolean("tile", false);
        l.headH = (float) o.optDouble("headH", l.headH);
        l.headRowH = (float) o.optDouble("headRowH", l.headRowH);
        l.headSize = (float) o.optDouble("headSize", l.headSize);
        l.nameSize = (float) o.optDouble("nameSize", l.nameSize);
        // More air between posters (the focus ring and zoom were crowding the neighbours): the same row width,
        // slightly narrower cards and a wider gap.
        if (l.cardW > 80f) {
            float give = 7f;
            float ratio = (l.cardW - give) / l.cardW;
            l.posterH *= ratio;
            l.cardW -= give;
            l.colGap += give;
            l.rowGap += 4f;
        }
        return l;
    }

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
            it.note = o.optString("note");
            it.progress = (float) o.optDouble("progress", 0);
            it.watched = o.optBoolean("watched", false);
            it.tick = o.optString("tick", "bottom-left");
            it.type = o.optString("type", "poster");
            String tint = o.optString("tint", "");
            if (!tint.isEmpty()) {
                try {
                    it.tint = Color.parseColor(tint);
                } catch (Throwable ignored) {
                    /* keep the default */
                }
            }
            it.logo = o.optString("logo", "");
            it.wantLogo = o.optBoolean("wantLogo", false);
            it.top = (float) o.optDouble("top", 0);
            out.add(it);
        }
        return out;
    }

    private static boolean sameItem(Item a, Item b) {
        return a.key.equals(b.key) && a.img.equals(b.img) && a.title.equals(b.title) && a.sub.equals(b.sub)
            && a.note.equals(b.note) && a.progress == b.progress && a.watched == b.watched && a.tick.equals(b.tick)
            && a.type.equals(b.type) && a.tint == b.tint && a.logo.equals(b.logo) && a.wantLogo == b.wantLogo && a.top == b.top;
    }

    /** {@code vw}: the page's layout width (to scale its px to the screen). */
    void setData(String json, float vw, boolean fresh) {
        try {
            JSONObject root = new JSONObject(json);
            Layout next = parseLayout(root.optJSONObject("layout"));
            List<Item> list = parseItems(root);
            View parent = (View) getParent();
            if (parent != null && vw > 0 && parent.getWidth() > 0) k = parent.getWidth() / vw;
            boolean layoutChanged = layoutDiffers(layout, next);
            layout = next;
            if (layoutChanged) {
                lm.setSpanCount(layout.cols);
                // Equal-width cells: size them to card + gap like the page's grid, not spread over the screen.
                int fill = parent != null ? parent.getWidth() : 0;
                int padR = fill > 0
                    ? Math.max(0, fill - px(layout.padL) - Math.round(layout.cols * (px(layout.cardW) + px(layout.colGap))))
                    : 0;
                rv.setPadding(px(layout.padL), px(layout.padT), padR, px(layout.bottomPad));
                lastPadT = px(layout.padT);
            }
            if (fresh) {
                idx = 0;
                idxKey = "";
                lastScrollY = -1f;
                rv.stopScroll();
                lm.scrollToPositionWithOffset(0, 0);
            }
            apply(list, layoutChanged);
        } catch (Throwable ignored) {
            /* bad payload: keep what is shown */
        }
    }

    private static boolean layoutDiffers(Layout a, Layout b) {
        return a.cols != b.cols || a.cardW != b.cardW || a.colGap != b.colGap || a.rowGap != b.rowGap
            || a.posterH != b.posterH || a.padL != b.padL || a.padT != b.padT || a.titleSize != b.titleSize
            || a.titleLine != b.titleLine || a.subSize != b.subSize || a.subLine != b.subLine
            || a.capTop != b.capTop || a.subTop != b.subTop || a.bottomPad != b.bottomPad || a.radius != b.radius
            || a.tile != b.tile || a.headH != b.headH || a.headRowH != b.headRowH || a.headSize != b.headSize || a.nameSize != b.nameSize;
    }

    private void apply(List<Item> next, boolean relayout) {
        List<Item> old = items;
        items = next;
        indexSections();
        if (next.isEmpty()) {
            adapter.notifyDataSetChanged();
            setVisibility(GONE);
            return;
        }
        setVisibility(VISIBLE);
        if (relayout) {
            adapter.notifyDataSetChanged();
            return;
        }
        int oldSize = old.size();
        int newSize = next.size();
        boolean appended = newSize >= oldSize && oldSize > 0;
        for (int i = 0; appended && i < oldSize; i++) {
            if (!old.get(i).key.equals(next.get(i).key)) appended = false;
        }
        if (appended) {
            // Same cards, maybe a changed one (watched, progress), maybe more on the end: leave scroll and focus alone.
            for (int i = 0; i < oldSize; i++) {
                if (!sameItem(old.get(i), next.get(i))) adapter.notifyItemChanged(i);
            }
            if (newSize > oldSize) adapter.notifyItemRangeInserted(oldSize, newSize - oldSize);
            return;
        }
        // Posters came in ahead of the old ones (paged upwards): keep the same card where it is.
        int shift = -1;
        if (oldSize > 0) {
            String first = old.get(0).key;
            for (int i = 0; i < newSize; i++) {
                if (next.get(i).key.equals(first)) {
                    shift = i;
                    break;
                }
            }
        }
        boolean hadFocus = hasFocusInside();
        if (shift > 0) {
            View top = rv.getChildCount() > 0 ? rv.getChildAt(0) : null;
            int topOffset = top != null ? top.getTop() : 0;
            int anchor = top != null ? rv.getChildAdapterPosition(top) : 0;
            adapter.notifyDataSetChanged();
            if (anchor >= 0) lm.scrollToPositionWithOffset(anchor + shift, topOffset);
            idx += shift;
        } else {
            adapter.notifyDataSetChanged();
            int at = indexOf(idxKey);
            idx = at >= 0 ? at : Math.min(idx, newSize - 1);
            if (at < 0) lm.scrollToPositionWithOffset(0, 0);
        }
        if (hadFocus) focusIndex(idx, true);
    }

    private int indexOf(String key) {
        if (key == null || key.isEmpty()) return -1;
        for (int i = 0; i < items.size(); i++) if (items.get(i).key.equals(key)) return i;
        return -1;
    }

    void clear() {
        handler.removeCallbacks(holdTimeout);
        holdPending = false;
        items = new ArrayList<>();
        indexSections();
        idx = 0;
        idxKey = "";
        lastScrollY = -1f;
        adapter.notifyDataSetChanged();
        setVisibility(GONE);
    }

    boolean hasFocusInside() {
        return getVisibility() == VISIBLE && findFocus() != null;
    }

    void setBlocked(boolean blocked) {
        inputBlocked = blocked;
        rv.setDescendantFocusability(blocked ? ViewGroup.FOCUS_BLOCK_DESCENDANTS : ViewGroup.FOCUS_AFTER_DESCENDANTS);
        if (blocked) rv.clearFocus();
    }

    /** The sidebar slid the page right by {@code layoutPx}. */
    void setShift(float layoutPx) {
        rv.animate().cancel();
        rv.animate().translationX(layoutPx * k).setDuration(180).setInterpolator(new DecelerateInterpolator()).start();
    }

    // ----- focus + scroll -------------------------------------------------------------

    /** The page asks for the remote on this card (its hidden copy got focus). */
    void focusKey(String key) {
        if (items.isEmpty()) return;
        int at = indexOf(key);
        if (at < 0) at = Math.min(idx, items.size() - 1);
        focusIndex(at, true);
    }

    void restoreFocus() {
        if (items.isEmpty()) return;
        focusIndex(Math.min(idx, items.size() - 1), true);
    }

    private int nearTries;
    private int lateTries;

    private void focusIndex(int at, boolean instant) {
        if (at < 0 || at >= items.size()) return;
        if (isHeader(at)) at = Math.min(items.size() - 1, at + 1);
        if (isHeader(at)) return;
        final int target = at;
        idx = at;
        idxKey = items.get(at).key;
        RecyclerView.ViewHolder vh = rv.findViewHolderForAdapterPosition(at);
        if (vh == null && layout.tile && nearTries < 2) {
            // Just past the screen edge (next section's first row): nudge by a row, then place it exactly, no jump.
            int first = lm.findFirstVisibleItemPosition();
            int last = lm.findLastVisibleItemPosition();
            int span = layout.cols + 2;
            int step = 0;
            if (at > last && at - last <= span) step = px(280f);
            else if (at < first && first - at <= span) step = -px(280f);
            if (step != 0) {
                nearTries++;
                rv.stopScroll();
                rv.scrollBy(0, step);
                rv.post(() -> {
                    focusIndex(target, true);
                    nearTries = 0;
                });
                return;
            }
        }
        if (vh == null) {
            // Far away (a letter jump, a restored spot): put its row at the top, then focus it.
            rv.stopScroll();
            lm.scrollToPositionWithOffset(at, Math.round(px(24f)));
            lateTries = 0;
            rv.post(new Runnable() {
                @Override
                public void run() {
                    RecyclerView.ViewHolder late = rv.findViewHolderForAdapterPosition(target);
                    if (late != null) {
                        late.itemView.requestFocus();
                        ensureVisible(late.itemView, true);
                    } else if (lateTries++ < 12) {
                        rv.postDelayed(this, 40); // first layout of a fresh page isn't done yet
                    }
                }
            });
            return;
        }
        vh.itemView.requestFocus();
        ensureVisible(vh.itemView, instant);
    }

    /** Scroll just enough to show the card's row (poster and caption), like the page's nearest-scroll. */
    private void ensureVisible(View card, boolean instant) {
        int h = rv.getHeight();
        if (h <= 0) return;
        int top = card.getTop();
        int bottom = card.getBottom();
        int topEdge = px(30f);
        int bottomEdge = h - px(40f);
        // The first rows never scroll past the page's own start (the header stays in view).
        int dy = 0;
        RecyclerView.ViewHolder holder = rv.getChildViewHolder(card);
        int pos = holder != null ? holder.getAdapterPosition() : -1;
        if (layout.tile && pos >= 0 && pos < items.size()) {
            // Studios: the first row of a section scrolls its title into view with it; the very first one goes back to the start.
            int start = secStart[pos];
            if (pos - start - 1 < layout.cols) {
                View head = lm.findViewByPosition(start);
                if (head != null) {
                    if (start == 0) dy = Math.round(head.getTop() - lastPadT);
                    else if (head.getTop() < topEdge) dy = head.getTop() - topEdge;
                    else if (bottom > bottomEdge) dy = bottom - bottomEdge;
                    if (dy == 0) return;
                    if (instant) {
                        rv.stopScroll();
                        rv.scrollBy(0, dy);
                    } else {
                        rv.smoothScrollBy(0, dy, new PathInterpolator(0.22f, 1f, 0.36f, 1f), 170);
                    }
                    return;
                }
                // Its section title has scrolled far out of the list: bring it back, and the row with it.
                rv.stopScroll();
                lm.scrollToPositionWithOffset(start, start == 0 ? 0 : topEdge);
                return;
            }
        }
        if (pos >= 0 && pos < layout.cols && !layout.tile) dy = Math.round(top - lastPadT); // first row: back to the very start
        else if (top < topEdge) dy = top - topEdge;
        else if (bottom > bottomEdge) dy = bottom - bottomEdge;
        if (dy == 0) return;
        if (instant) {
            rv.stopScroll();
            rv.scrollBy(0, dy);
        } else {
            rv.smoothScrollBy(0, dy, new PathInterpolator(0.22f, 1f, 0.36f, 1f), 170);
        }
    }

    private void reportScroll() {
        // Page header sync: how far the content moved up from its start (only while it matters).
        float y;
        View first = rv.getLayoutManager() != null ? lm.findViewByPosition(0) : null;
        if (first != null) y = Math.max(0f, lastPadT - first.getTop());
        else y = lastPadT + px(400f); // first row is long gone
        if (y == lastScrollY) return;
        lastScrollY = y;
        listener.onScroll(y / k);
    }

    // ----- keys -----------------------------------------------------------------------

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (inputBlocked) return false;
        if (getVisibility() == VISIBLE && findFocus() != null && handleKey(event)) return true;
        return super.dispatchKeyEvent(event);
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
        if (event.getAction() != KeyEvent.ACTION_DOWN) return true;
        long now = event.getEventTime();
        if (now - lastActivityAt > 250) {
            lastActivityAt = now;
            listener.onActivity();
        }
        if (items.isEmpty()) return true;
        int cols = layout.cols;
        int at = Math.max(0, Math.min(idx, items.size() - 1));
        boolean repeat = event.getRepeatCount() > 0;
        if (layout.tile) {
            if (isHeader(at)) at = Math.min(items.size() - 1, at + 1);
            return navTiles(at, left, right, up, repeat);
        }
        if (left) {
            if (at % cols == 0) {
                if (!repeat) listener.onEdgeLeft();
                return true;
            }
            focusIndex(at - 1, repeat);
            return true;
        }
        if (right) {
            if (at % cols == cols - 1 || at == items.size() - 1) {
                if (!repeat) listener.onHandoff("right", items.get(at).key);
                return true;
            }
            focusIndex(at + 1, repeat);
            return true;
        }
        if (up) {
            if (at < cols) {
                if (!repeat) listener.onHandoff("up", items.get(at).key);
                return true;
            }
            focusIndex(at - cols, repeat);
            return true;
        }
        // Down: the next row (the last, short row takes the last card); nothing below stays put.
        int next = at + cols;
        if (next >= items.size()) {
            int lastRowStart = ((items.size() - 1) / cols) * cols;
            if (at >= lastRowStart) return true;
            next = items.size() - 1;
        }
        focusIndex(next, repeat);
        return true;
    }

    /** Studios: Left / Right / Up / Down across tiles and section headers (headers are skipped). */
    private boolean navTiles(int at, boolean left, boolean right, boolean up, boolean repeat) {
        int cols = layout.cols;
        int start = secStart[at];
        int pos = at - start - 1;
        int count = sectionCount(start);
        int col = pos % cols;
        String key = items.get(at).key;
        if (left) {
            if (col == 0) {
                if (!repeat) listener.onEdgeLeft();
                return true;
            }
            focusIndex(at - 1, repeat);
            return true;
        }
        if (right) {
            if (col == cols - 1 || pos == count - 1) {
                if (!repeat) listener.onHandoff("right", key);
                return true;
            }
            focusIndex(at + 1, repeat);
            return true;
        }
        if (up) {
            if (pos >= cols) {
                focusIndex(at - cols, repeat);
                return true;
            }
            int prev = -1;
            for (int i = start - 1; i >= 0; i--) {
                if (isHeader(i)) {
                    prev = i;
                    break;
                }
            }
            if (prev < 0) {
                if (!repeat) listener.onHandoff("up", key);
                return true;
            }
            int pc = sectionCount(prev);
            int lastRow = ((pc - 1) / cols) * cols;
            focusIndex(prev + 1 + Math.min(pc - 1, lastRow + col), repeat);
            return true;
        }
        if (pos + cols < count) {
            focusIndex(at + cols, repeat);
            return true;
        }
        int lastRow = ((count - 1) / cols) * cols;
        if (pos < lastRow) {
            focusIndex(start + count, repeat); // short last row: its last tile
            return true;
        }
        int next = start + 1 + count;
        if (next >= items.size()) return true;
        int nc = sectionCount(next);
        focusIndex(next + 1 + Math.min(nc - 1, col), repeat);
        return true;
    }

    private void startHold() {
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

    // ----- cards ----------------------------------------------------------------------

    private final class Adapter extends RecyclerView.Adapter<RecyclerView.ViewHolder> {
        @Override
        public int getItemViewType(int position) {
            return isHeader(position) ? 1 : 0;
        }

        @NonNull
        @Override
        public RecyclerView.ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            if (viewType == 1) return new HeaderHolder(new HeaderView(parent.getContext()));
            return new Holder(new Cell(parent.getContext()));
        }

        @Override
        public void onBindViewHolder(@NonNull RecyclerView.ViewHolder holder, int position) {
            if (holder instanceof HeaderHolder) ((HeaderHolder) holder).header.bind(items.get(position));
            else ((Holder) holder).cell.bind(position, items.get(position));
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

    private static final class HeaderHolder extends RecyclerView.ViewHolder {
        final HeaderView header;

        HeaderHolder(@NonNull HeaderView header) {
            super(header);
            this.header = header;
        }
    }

    /** Studios: a section title (play mark + text), like a Home row header. */
    private final class HeaderView extends View {
        private final Paint mark = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint glow = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Path play = new Path();
        private String title = "";

        HeaderView(Context context) {
            super(context);
            setFocusable(false);
            text.setTypeface(NativeHomeView.font(context, 800));
            text.setColor(Color.WHITE);
            play.moveTo(5, 3);
            play.lineTo(19, 12);
            play.lineTo(5, 21);
            play.close();
        }

        void bind(Item item) {
            title = item.title;
            RecyclerView.LayoutParams lp = new RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, px(layout.headH));
            lp.topMargin = px(item.top);
            setLayoutParams(lp);
            invalidate();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            int accent = NativeHomeView.ringColor != 0 ? NativeHomeView.ringColor : AMBER;
            float size = px(layout.headSize);
            float side = size * 0.777f;
            float rowH = px(layout.headRowH);
            text.setTextSize(size);
            mark.setColor(accent);
            mark.setStyle(Paint.Style.FILL_AND_STROKE);
            mark.setStrokeJoin(Paint.Join.ROUND);
            glow.setColor(accent);
            glow.setAlpha(110);
            glow.setStyle(Paint.Style.FILL_AND_STROKE);
            glow.setStrokeWidth(4f);
            glow.setMaskFilter(new android.graphics.BlurMaskFilter(4f, android.graphics.BlurMaskFilter.Blur.NORMAL));
            canvas.save();
            canvas.translate(0f, (rowH - side) / 2f);
            float sc = side / 24f;
            canvas.scale(sc, sc);
            canvas.drawPath(play, glow);
            mark.setStrokeWidth(2f);
            canvas.drawPath(play, mark);
            canvas.restore();
            Paint.FontMetrics fm = text.getFontMetrics();
            float baseline = rowH / 2f - (fm.ascent + fm.descent) / 2f;
            canvas.drawText(title, side + size * 0.42f, baseline, text);
        }
    }

    /** One grid cell: the poster (takes the focus ring and grow) and its caption underneath. */
    private final class Cell extends LinearLayout {
        private final Poster poster;
        private final TextView title;
        private final TextView sub;
        private final TextView note;
        private Item data;

        Cell(Context context) {
            super(context);
            setOrientation(VERTICAL);
            setFocusable(true);
            setClickable(true);
            setLongClickable(true);
            setClipChildren(false);
            setClipToPadding(false);

            poster = new Poster(context);
            addView(poster, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 100));

            title = text(context);
            title.setMaxLines(2);
            title.setEllipsize(TextUtils.TruncateAt.END);
            addView(title, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            sub = text(context);
            sub.setMaxLines(1);
            sub.setEllipsize(TextUtils.TruncateAt.END);
            addView(sub, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            note = text(context);
            note.setMaxLines(1);
            note.setEllipsize(TextUtils.TruncateAt.END);
            note.setTypeface(NativeHomeView.font(context, 700));
            addView(note, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

            setOnClickListener(v -> {
                if (data != null) listener.onOpen(data.key);
            });
            setOnLongClickListener(v -> {
                if (data == null || !"poster".equals(data.type)) return false;
                startHold();
                listener.onLongPress(data.key);
                return true;
            });
        }

        private TextView text(Context context) {
            TextView t = new TextView(context);
            t.setTypeface(face);
            t.setIncludeFontPadding(false);
            t.setTextColor(Color.WHITE);
            t.setSingleLine(false);
            return t;
        }

        private void style(TextView t, float sizeLayout, float lineLayout, float topLayout, float leftLayout) {
            t.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, sizeLayout * k);
            Paint.FontMetrics fm = t.getPaint().getFontMetrics();
            float natural = fm.descent - fm.ascent;
            t.setLineSpacing(Math.max(0f, lineLayout * k - natural), 1f);
            LinearLayout.LayoutParams lp = (LinearLayout.LayoutParams) t.getLayoutParams();
            lp.topMargin = px(topLayout);
            lp.leftMargin = px(leftLayout);
            t.setLayoutParams(lp);
        }

        void bind(int position, Item item) {
            data = item;
            Layout l = layout;
            RecyclerView.LayoutParams lp = new RecyclerView.LayoutParams(px(l.cardW), ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.rightMargin = px(l.colGap);
            lp.bottomMargin = px(l.rowGap);
            setLayoutParams(lp);
            LinearLayout.LayoutParams plp = (LinearLayout.LayoutParams) poster.getLayoutParams();
            plp.height = px(l.posterH);
            poster.setLayoutParams(plp);
            poster.bind(item, px(l.cardW), px(l.posterH));
            if ("tile".equals(item.type)) {
                title.setVisibility(GONE);
                sub.setVisibility(GONE);
                note.setVisibility(GONE);
                return;
            }
            title.setVisibility(VISIBLE);
            title.setText(item.title);
            style(title, l.titleSize, l.titleLine, l.capTop, l.capLeft);
            boolean hasSub = !item.sub.isEmpty();
            sub.setVisibility(hasSub ? VISIBLE : GONE);
            sub.setText(item.sub);
            sub.setTextColor(Color.argb(255, 255, 255, 255));
            style(sub, l.subSize, l.subLine, l.subTop, l.capLeft);
            boolean hasNote = !item.note.isEmpty();
            note.setVisibility(hasNote ? VISIBLE : GONE);
            note.setText(item.note);
            note.setTextColor(AMBER);
            style(note, l.subSize, l.subLine, l.subTop, l.capLeft);
        }

        @Override
        protected void onFocusChanged(boolean gained, int direction, Rect previouslyFocusedRect) {
            super.onFocusChanged(gained, direction, previouslyFocusedRect);
            poster.setFocusedLook(gained);
            if (gained && data != null) {
                int at = getBindingPos();
                if (at >= 0) {
                    idx = at;
                    idxKey = data.key;
                    listener.onFocus(data.key, at);
                }
            }
        }

        private int getBindingPos() {
            RecyclerView.ViewHolder vh = rv.getChildViewHolder(this);
            return vh != null ? vh.getBindingAdapterPosition() : -1;
        }
    }

    /** The poster picture with its radius, watch bar, watched tick, and the focus ring + grow. */
    private final class Poster extends FrameLayout {
        private final ImageView image;
        private final View barTrack;
        private final View barFill;
        private final Tick tick;
        private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
        private boolean focusedLook;
        private float radius;
        private final FrameLayout frame;
        private final View wash;
        private final ImageView logoView;
        private final TextView nameView;
        private boolean tileLook;

        Poster(Context context) {
            super(context);
            setWillNotDraw(false);
            setClipChildren(false);
            ring.setStyle(Paint.Style.STROKE);
            frame = new FrameLayout(context);
            frame.setBackgroundColor(Color.rgb(22, 27, 34));
            frame.setOutlineProvider(new ViewOutlineProvider() {
                @Override
                public void getOutline(View view, Outline outline) {
                    outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), radius);
                }
            });
            frame.setClipToOutline(true);
            addView(frame, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            image = new ImageView(context);
            image.setScaleType(ImageView.ScaleType.CENTER_CROP);
            frame.addView(image, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            wash = new View(context);
            wash.setVisibility(GONE);
            frame.addView(wash, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            logoView = new ImageView(context);
            logoView.setScaleType(ImageView.ScaleType.FIT_CENTER);
            logoView.setVisibility(GONE);
            frame.addView(logoView, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            nameView = new TextView(context);
            nameView.setTypeface(NativeHomeView.font(context, 800));
            nameView.setTextColor(Color.WHITE);
            nameView.setGravity(Gravity.CENTER);
            nameView.setIncludeFontPadding(false);
            nameView.setMaxLines(2);
            nameView.setEllipsize(TextUtils.TruncateAt.END);
            nameView.setVisibility(GONE);
            frame.addView(nameView, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            barTrack = new View(context);
            barTrack.setBackgroundColor(Color.argb(179, 0, 0, 0));
            frame.addView(barTrack, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 8, Gravity.BOTTOM));
            barFill = new View(context);
            barFill.setBackgroundColor(Color.rgb(229, 160, 13));
            frame.addView(barFill, new LayoutParams(0, 8, Gravity.BOTTOM | Gravity.START));
            tick = new Tick(context);
            frame.addView(tick, new LayoutParams(30, 30));
        }

        void bind(Item item, int w, int h) {
            radius = px(layout.radius);
            ((View) image.getParent()).invalidateOutline();
            tileLook = "tile".equals(item.type);
            bindTile(item, w, h);
            images.load(item.img, image, w, h);
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
                tlp.width = px(30f);
                tlp.height = px(30f);
                boolean top = item.tick.startsWith("top");
                boolean left = item.tick.endsWith("left");
                int edge = px(7.5f);
                int bottom = px(item.progress > 0f ? 15f : 7.5f);
                tlp.gravity = (top ? Gravity.TOP : Gravity.BOTTOM) | (left ? Gravity.START : Gravity.END);
                tlp.leftMargin = left ? edge : 0;
                tlp.rightMargin = left ? 0 : edge;
                tlp.topMargin = top ? edge : 0;
                tlp.bottomMargin = top ? 0 : bottom;
                tick.setLayoutParams(tlp);
                tick.setVisibility(VISIBLE);
            } else {
                tick.setVisibility(GONE);
            }
            setFocusedLook(getParent() != null && ((View) getParent()).isFocused());
        }

        /** Studios tile: tinted backdrop, colour wash and the whitened logo (or the name when there is none). */
        private void bindTile(Item item, int w, int h) {
            if (!tileLook) {
                frame.setBackgroundColor(Color.rgb(22, 27, 34));
                image.clearColorFilter();
                wash.setVisibility(GONE);
                logoView.setVisibility(GONE);
                nameView.setVisibility(GONE);
                return;
            }
            frame.setBackgroundColor(item.tint);
            ColorMatrix grey = new ColorMatrix();
            grey.setSaturation(0.65f);
            grey.postConcat(new ColorMatrix(new float[]{0.9f, 0, 0, 0, 0, 0, 0.9f, 0, 0, 0, 0, 0, 0.9f, 0, 0, 0, 0, 0, 1, 0}));
            image.setColorFilter(new ColorMatrixColorFilter(grey));
            wash.setVisibility(VISIBLE);
            wash.setBackgroundColor(item.tint);
            wash.setAlpha(focusedLook ? 0.6f : 0.78f);
            int padX = Math.round(w * 0.16f);
            int padY = Math.round(h * 0.12f);
            Bitmap logo = item.logo.isEmpty() ? null : decodeLogo(item);
            if (logo != null) {
                logoView.setPadding(padX, padY, padX, padY);
                logoView.setImageBitmap(logo);
                logoView.setVisibility(VISIBLE);
                nameView.setVisibility(GONE);
            } else {
                logoView.setVisibility(GONE);
                if (item.wantLogo) {
                    nameView.setVisibility(GONE); // the logo is on its way: no flash of the name
                } else {
                    nameView.setPadding(padX, padY, padX, padY);
                    nameView.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, px(layout.nameSize));
                    nameView.setText(item.title);
                    nameView.setVisibility(VISIBLE);
                }
            }
        }

        void setFocusedLook(boolean on) {
            focusedLook = on;
            if (tileLook) wash.setAlpha(on ? 0.6f : 0.78f);
            float to = on ? FOCUS_SCALE : 1f;
            animate().cancel();
            animate().scaleX(to).scaleY(to).setDuration(240)
                .setInterpolator(new PathInterpolator(0.22f, 1f, 0.36f, 1f)).start();
            invalidate();
        }

        @Override
        protected void dispatchDraw(Canvas canvas) {
            super.dispatchDraw(canvas);
            if (focusedLook) {
                float scale = NativeHomeView.ringScale;
                ring.setColor(NativeHomeView.ringColor != 0 ? NativeHomeView.ringColor : AMBER);
                float stroke = px(3f) * scale;
                ring.setStrokeWidth(stroke);
                // Grow the ring inward once it would reach the neighbouring poster or title: the gap
                // between cards (less what the focus zoom already takes) is all the room outside.
                // The ring sits just inside the poster edge so it never meets the next poster's picture.
                float inset = -stroke / 2f;
                canvas.drawRoundRect(-inset, -inset, getWidth() + inset, getHeight() + inset,
                    radius + inset, radius + inset, ring);
            }
        }
    }

    private final LruCache<String, Bitmap> logoCache = new LruCache<>(48);

    private Bitmap decodeLogo(Item item) {
        String ck = item.key + ":" + item.logo.length();
        Bitmap hit = logoCache.get(ck);
        if (hit != null) return hit;
        try {
            int comma = item.logo.indexOf(',');
            byte[] raw = Base64.decode(item.logo.substring(comma + 1), Base64.DEFAULT);
            Bitmap made = BitmapFactory.decodeByteArray(raw, 0, raw.length);
            if (made != null) logoCache.put(ck, made);
            return made;
        } catch (Throwable t) {
            return null;
        }
    }

    /** The watched tick: accent circle with a dark check. */
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
            disc.setShadowLayer(px(3f), 0, px(1.5f), Color.argb(90, 0, 0, 0));
            canvas.drawCircle(cx, cy, w / 2f - px(2f), disc);
            float size = px(15f);
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
