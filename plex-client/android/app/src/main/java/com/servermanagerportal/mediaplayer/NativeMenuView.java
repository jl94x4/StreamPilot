package com.servermanagerportal.mediaplayer;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.PorterDuff;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.SystemClock;
import android.util.Base64;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * The title context menu (long-press on a poster, the page's more button), drawn natively over the page.
 * The page keeps every action: it sends the rows it has, and gets back which one was picked.
 * Up / Down move, Left / Right move across the star row, Select picks, Back closes.
 */
final class NativeMenuView extends FrameLayout {

    interface Listener {
        /** {@code sub}: "" for a row, "1".."5" or "clear" for the stars. */
        void onPick(int index, String sub);

        void onBack();

        /** Any key: the page's idle timer (screensaver) cannot see native keys. */
        void onActivity();
    }

    private static final int AMBER = Color.rgb(229, 160, 13);
    /** All menu text (title, items, values, stars) is drawn 10% under its base size. */
    private static final float TEXT_SCALE = 0.90f;

    private final Listener listener;
    private final NativeHomeImages images;
    private final float s;
    private final ScrollView scroll;
    private final LinearLayout column;
    private final LinearLayout panel;

    private static final class Cell {
        String kind;
        int index;          // index in the page's list
        View view;
        boolean disabled;
        // stars
        TextView[] stars;
        TextView clear;
        int starAt;         // 0..4 = star, 5 = clear
        int filled;
        boolean primary;
        TextView label;
        ImageView iconView;
        TextView chev;
        TextView value;
        boolean valueDim;
    }

    private final List<Cell> cells = new ArrayList<>();
    private int sel = -1;
    private String signature = "";
    private long ignoreSelectUntil;
    private boolean sawUp;

    NativeMenuView(Context context, NativeHomeImages images, Listener listener) {
        super(context);
        this.images = images;
        this.listener = listener;
        this.s = context.getResources().getDisplayMetrics().widthPixels / 1920f;
        setBackgroundColor(0x59000000);
        setFocusable(true);
        setFocusableInTouchMode(true);
        setClickable(true);
        setVisibility(GONE);

        panel = new LinearLayout(context);
        panel.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xFF1C1E24);
        bg.setCornerRadius(px(28));
        bg.setStroke(Math.max(1, px(1.5f)), 0x29FFFFFF);
        panel.setBackground(bg);
        panel.setClipToOutline(true);
        panel.setOutlineProvider(new ViewOutlineProvider() {
            @Override
            public void getOutline(View v, Outline o) {
                o.setRoundRect(0, 0, v.getWidth(), v.getHeight(), px(28));
            }
        });
        LayoutParams lp = new LayoutParams(px(460), ViewGroup.LayoutParams.MATCH_PARENT, Gravity.END);
        lp.setMargins(0, px(24), px(23), px(24));
        addView(panel, lp);

        scroll = new ScrollView(context);
        scroll.setVerticalScrollBarEnabled(false);
        scroll.setOverScrollMode(OVER_SCROLL_NEVER);
        scroll.setFocusable(false);
        column = new LinearLayout(context);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(px(24), px(18), px(24), px(18));
        scroll.addView(column, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        panel.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private final android.view.ViewTreeObserver.OnGlobalFocusChangeListener keepFocus = (oldFocus, newFocus) -> {
        // While the menu is up it owns the remote: the page grabbing focus back (a Select release, a
        // hand-off event) must not strand the keys in the WebView.
        if (getVisibility() == VISIBLE && newFocus != this) post(() -> {
            if (getVisibility() == VISIBLE && !isFocused()) requestFocus();
        });
    };

    @Override
    protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        getViewTreeObserver().addOnGlobalFocusChangeListener(keepFocus);
    }

    @Override
    protected void onDetachedFromWindow() {
        getViewTreeObserver().removeOnGlobalFocusChangeListener(keepFocus);
        super.onDetachedFromWindow();
    }

    /** Logo at its real on-screen size (measured once laid out): shrinking a bigger bitmap while drawing jags the edges. */
    private void showFittedLogo(final ImageView logo, final Bitmap bmp) {
        logo.post(() -> {
            int boxW = logo.getWidth() - logo.getPaddingLeft() - logo.getPaddingRight();
            int boxH = logo.getHeight() - logo.getPaddingTop() - logo.getPaddingBottom();
            if (boxW <= 0 || boxH <= 0) {
                boxW = px(420);
                boxH = px(124);
            }
            logo.setImageBitmap(NativeHomeImages.fittedInside(bmp, boxW, boxH));
        });
    }

    private int px(float v) {
        return Math.round(v * s);
    }

    /** Show (or refresh) the list. A new list starts on its first row; the same list keeps the spot. */
    void setData(String json) {
        try {
            JSONObject root = new JSONObject(json);
            JSONArray items = root.optJSONArray("items");
            if (items == null) return;
            StringBuilder sig = new StringBuilder();
            for (int i = 0; i < items.length(); i++) {
                JSONObject it = items.getJSONObject(i);
                sig.append(it.optString("k")).append(':').append(it.optString("label")).append(it.optString("val")).append('|');
            }
            boolean same = sig.toString().equals(signature);
            signature = sig.toString();
            int keep = same ? sel : -1;
            boolean wasShown = getVisibility() == VISIBLE;
            build(root, items);
            if (!wasShown) {
                setAlpha(0f);
                setVisibility(VISIBLE);
                animate().alpha(1f).setDuration(110).start();
                bringToFront();
                ignoreSelectUntil = SystemClock.uptimeMillis() + 750;
                sawUp = false;
                requestFocus();
            }
            if (keep < 0 && cells.size() == items.length()) {
                // A choice list opens on the value that is on now.
                for (int i = 0; i < items.length(); i++) {
                    if (items.getJSONObject(i).optBoolean("cur", false) && !cells.get(i).disabled) keep = i;
                }
            }
            select(keep >= 0 && keep < cells.size() ? keep : firstEnabled(), false);
        } catch (Exception ignored) { android.util.Log.w("SPSwallowed", "NativeMenuView:192" + " " + ignored.getClass().getSimpleName()); }
    }

    void hideMenu() {
        animate().cancel();
        setAlpha(1f);
        setVisibility(GONE);
        column.removeAllViews();
        cells.clear();
        signature = "";
        sel = -1;
    }

    private int firstEnabled() {
        for (int i = 0; i < cells.size(); i++) {
            if (!cells.get(i).disabled) return i;
        }
        return cells.isEmpty() ? -1 : 0;
    }

    private void build(JSONObject root, JSONArray items) throws Exception {
        column.removeAllViews();
        cells.clear();
        Context c = getContext();

        String logoData = root.optString("logoData", "");
        String logoUrl = root.optString("logoUrl", "");
        String title = root.optString("title", "");
        if (!logoData.isEmpty() || !logoUrl.isEmpty()) {
            ImageView logo = new ImageView(c);
            logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
            LinearLayout.LayoutParams llp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, px(124));
            llp.bottomMargin = px(8);
            column.addView(logo, llp);
            if (!logoData.isEmpty()) {
                byte[] raw = Base64.decode(logoData, Base64.DEFAULT);
                Bitmap bmp = BitmapFactory.decodeByteArray(raw, 0, raw.length);
                if (bmp != null) showFittedLogo(logo, bmp);
            } else {
                images.get(logoUrl, px(420), px(124), bmp -> {
                    if (bmp != null) showFittedLogo(logo, bmp);
                });
            }
        } else if (!title.isEmpty()) {
            TextView t = text(title, 34, Color.WHITE, true);
            t.setGravity(Gravity.CENTER);
            t.setSingleLine(true);
            t.setEllipsize(android.text.TextUtils.TruncateAt.END);
            LinearLayout.LayoutParams llp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            llp.topMargin = px(6);
            llp.bottomMargin = px(14);
            column.addView(t, llp);
        }
        String server = root.optString("server", "");
        if (!server.isEmpty()) {
            TextView t = text(server.toUpperCase(), 17, 0xB3FFFFFF, true);
            t.setGravity(Gravity.CENTER);
            t.setLetterSpacing(0.1f);
            LinearLayout.LayoutParams llp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            llp.bottomMargin = px(16);
            column.addView(t, llp);
        }

        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.getJSONObject(i);
            String kind = it.optString("k");
            Cell cell = new Cell();
            cell.kind = kind;
            cell.index = i;
            cell.disabled = it.optBoolean("dis", false);
            if ("stars".equals(kind)) buildStars(cell, it);
            else if ("pill".equals(kind)) buildPill(cell, it);
            else buildRow(cell, it);
            cells.add(cell);
        }
    }

    private TextView text(String value, float sp, int color, boolean bold) {
        TextView t = new TextView(getContext());
        t.setText(value);
        t.setTextColor(color);
        t.setTextSize(TypedValue.COMPLEX_UNIT_PX, px(sp * TEXT_SCALE));
        if (NativeFonts.custom()) t.setTypeface(NativeFonts.face(getContext(), bold ? 700 : 500));
        else t.setTypeface(bold ? Typeface.DEFAULT_BOLD : Typeface.create("sans-serif-medium", Typeface.NORMAL));
        t.setIncludeFontPadding(false);
        return t;
    }

    private Bitmap icon(JSONObject it) {
        String b64 = it.optString("icon", "");
        if (b64.isEmpty()) return null;
        try {
            byte[] raw = Base64.decode(b64, Base64.DEFAULT);
            return BitmapFactory.decodeByteArray(raw, 0, raw.length);
        } catch (Exception e) {
            return null;
        }
    }

    private void buildPill(Cell cell, JSONObject it) {
        boolean primary = it.optBoolean("primary", false);
        cell.primary = primary;
        LinearLayout row = new LinearLayout(getContext());
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER);
        int fill = 0x29FFFFFF;
        int ink = Color.WHITE;
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(fill);
        bg.setCornerRadius(px(40));
        row.setBackground(bg);
        Bitmap ic = icon(it);
        if (ic != null) {
            ImageView iv = new ImageView(getContext());
            iv.setImageBitmap(ic);
            iv.setColorFilter(ink, PorterDuff.Mode.SRC_IN);
            LinearLayout.LayoutParams ilp = new LinearLayout.LayoutParams(px(30), px(30));
            ilp.rightMargin = px(12);
            row.addView(iv, ilp);
            cell.iconView = iv;
        }
        cell.label = text(it.optString("label"), 25, ink, true);
        row.addView(cell.label);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, px(68));
        lp.bottomMargin = px(12);
        column.addView(row, lp);
        cell.view = row;
    }

    private void buildRow(Cell cell, JSONObject it) {
        LinearLayout row = new LinearLayout(getContext());
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(px(it.optBoolean("sub", false) ? 62 : 22), 0, px(18), 0);
        Bitmap ic = icon(it);
        if (ic != null) {
            ImageView iv = new ImageView(getContext());
            iv.setImageBitmap(ic);
            LinearLayout.LayoutParams ilp = new LinearLayout.LayoutParams(px(26), px(26));
            ilp.rightMargin = px(22);
            row.addView(iv, ilp);
            cell.iconView = iv;
        }
        TextView label = text(it.optString("label"), 24, cell.disabled ? 0x80FFFFFF : 0xF2FFFFFF, false);
        label.setSingleLine(true);
        label.setEllipsize(android.text.TextUtils.TruncateAt.END);
        row.addView(label, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        cell.label = label;
        String val = it.optString("val", "");
        if (!val.isEmpty()) {
            cell.valueDim = it.optBoolean("valDim", false);
            TextView v = text(val, 22, cell.valueDim ? 0x73FFFFFF : 0xF2FFFFFF, false);
            v.setSingleLine(true);
            v.setEllipsize(android.text.TextUtils.TruncateAt.END);
            v.setMaxWidth(px(170));
            LinearLayout.LayoutParams vlp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            vlp.leftMargin = px(12); vlp.rightMargin = px(8);
            row.addView(v, vlp);
            cell.value = v;
        }
        if (it.optBoolean("chev", false)) {
            TextView chev = text("›", 34, 0x99FFFFFF, false);
            row.addView(chev);
            cell.chev = chev;
        }
        column.addView(row, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, px(60)));
        cell.view = row;
    }

    private void buildStars(Cell cell, JSONObject it) {
        LinearLayout box = new LinearLayout(getContext());
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(px(22), px(6), px(12), px(6));
        TextView cap = text(it.optString("label", "RATE").toUpperCase(), 15, 0x73FFFFFF, true);
        cap.setLetterSpacing(0.14f);
        box.addView(cap, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        LinearLayout line = new LinearLayout(getContext());
        line.setOrientation(LinearLayout.HORIZONTAL);
        line.setGravity(Gravity.CENTER_VERTICAL);
        cell.stars = new TextView[5];
        cell.filled = it.optInt("filled", 0);
        for (int i = 0; i < 5; i++) {
            TextView st = text(i < cell.filled ? "★" : "☆", 40, i < cell.filled ? AMBER : 0x59FFFFFF, false);
            st.setGravity(Gravity.CENTER);
            line.addView(st, new LinearLayout.LayoutParams(px(52), px(52)));
            cell.stars[i] = st;
        }
        if (it.optBoolean("clear", false)) {
            TextView clr = text(it.optString("clearLabel", "Clear"), 20, 0x99FFFFFF, true);
            clr.setPadding(px(12), 0, px(12), 0);
            clr.setGravity(Gravity.CENTER);
            line.addView(clr, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, px(52)));
            cell.clear = clr;
        }
        LinearLayout.LayoutParams llp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        llp.topMargin = px(6);
        box.addView(line, llp);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = px(12);
        column.addView(box, lp);
        cell.view = box;
        cell.starAt = Math.max(0, Math.min(4, cell.filled > 0 ? cell.filled - 1 : 2));
    }

    // ----- focus drawing --------------------------------------------------------------

    private GradientDrawable ring(float radius, int fill) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(fill);
        d.setCornerRadius(radius);
        int accent = NativeHomeView.ringColor != 0 ? NativeHomeView.ringColor : Color.rgb(245, 245, 245);
        d.setStroke(Math.max(2, Math.round(px(3) * NativeHomeView.ringScale)), accent);
        return d;
    }

    private static final int INK = 0xFF18181B;

    private GradientDrawable fillShape(int color, float radius) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(radius);
        return d;
    }

    /** Same shapes as the web menu: the focused row is a full white pill with dark text, nothing outlined. */
    private void paint(Cell cell, boolean focused) {
        int ink = focused ? INK : (cell.disabled ? 0x80FFFFFF : 0xF2FFFFFF);
        if ("stars".equals(cell.kind)) {
            for (int i = 0; i < 5; i++) {
                // No box: the star under the cursor just lights up (and the ones before it, like a rating bar).
                boolean lit = focused && i <= cell.starAt && cell.starAt < 5;
                cell.stars[i].setBackground(null);
                cell.stars[i].setTextColor(lit ? AMBER : (focused ? 0x59FFFFFF : (i < cell.filled ? AMBER : 0x59FFFFFF)));
                cell.stars[i].setText(lit || (!focused && i < cell.filled) ? "★" : "☆");
            }
            if (cell.clear != null) {
                boolean on = focused && cell.starAt == 5;
                cell.clear.setBackground(on ? fillShape(Color.WHITE, px(14)) : null);
                cell.clear.setTextColor(on ? INK : 0x99FFFFFF);
            }
            return;
        }
        boolean pill = "pill".equals(cell.kind);
        if (focused) cell.view.setBackground(fillShape(Color.WHITE, px(pill ? 40 : 30)));
        else cell.view.setBackground(pill ? fillShape(0x29FFFFFF, px(40)) : null);
        if (pill && !focused) ink = Color.WHITE;
        if (cell.label != null) cell.label.setTextColor(ink);
        if (cell.value != null) cell.value.setTextColor(focused ? INK : (cell.valueDim ? 0x73FFFFFF : 0xF2FFFFFF));
        if (cell.chev != null) cell.chev.setTextColor(focused ? INK : 0x99FFFFFF);
        if (cell.iconView != null) cell.iconView.setColorFilter(focused ? INK : (pill ? Color.WHITE : 0xE6FFFFFF), PorterDuff.Mode.SRC_IN);
    }

    private void select(int at, boolean smooth) {
        if (at < 0 || at >= cells.size()) return;
        if (sel >= 0 && sel < cells.size()) paint(cells.get(sel), false);
        sel = at;
        Cell cell = cells.get(at);
        paint(cell, true);
        final View v = cell.view;
        v.post(() -> {
            int top = v.getTop() - px(40);
            int bottom = v.getBottom() + px(40);
            int viewTop = scroll.getScrollY();
            int viewBottom = viewTop + scroll.getHeight();
            int target = viewTop;
            if (at == 0 || firstEnabled() == at) target = 0;
            else if (top < viewTop) target = top;
            else if (bottom > viewBottom) target = bottom - scroll.getHeight();
            if (target != viewTop) {
                if (smooth) scroll.smoothScrollTo(0, target);
                else scroll.scrollTo(0, target);
            }
        });
    }

    private void move(int dir) {
        int at = sel;
        for (int i = 0; i < cells.size(); i++) {
            at += dir;
            if (at < 0 || at >= cells.size()) return;
            if (!cells.get(at).disabled) {
                select(at, true);
                return;
            }
        }
    }

    // ----- keys -----------------------------------------------------------------------

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (getVisibility() != VISIBLE) return super.dispatchKeyEvent(event);
        int code = event.getKeyCode();
        boolean down = event.getAction() == KeyEvent.ACTION_DOWN;
        if (down) listener.onActivity();
        if (code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_ESCAPE) {
            if (!down) listener.onBack();
            return true;
        }
        boolean select = code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER
            || code == KeyEvent.KEYCODE_NUMPAD_ENTER || code == KeyEvent.KEYCODE_BUTTON_A;
        if (select) {
            if (!down) sawUp = true;
            // The Select that opened the menu is still down (or just let go): it must not pick the first row.
            if (SystemClock.uptimeMillis() < ignoreSelectUntil && !sawUp) return true;
            if (!down || event.getRepeatCount() > 0) return true;
            pick();
            return true;
        }
        if (code == KeyEvent.KEYCODE_DPAD_UP || code == KeyEvent.KEYCODE_DPAD_DOWN
            || code == KeyEvent.KEYCODE_DPAD_LEFT || code == KeyEvent.KEYCODE_DPAD_RIGHT) {
            if (!down) return true;
            if (code == KeyEvent.KEYCODE_DPAD_UP) move(-1);
            else if (code == KeyEvent.KEYCODE_DPAD_DOWN) move(1);
            else if (sel >= 0 && sel < cells.size() && "stars".equals(cells.get(sel).kind)) {
                Cell cell = cells.get(sel);
                int max = cell.clear != null ? 5 : 4;
                int next = Math.max(0, Math.min(max, cell.starAt + (code == KeyEvent.KEYCODE_DPAD_RIGHT ? 1 : -1)));
                if (next != cell.starAt) {
                    cell.starAt = next;
                    paint(cell, true);
                }
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    private void pick() {
        if (sel < 0 || sel >= cells.size()) return;
        Cell cell = cells.get(sel);
        if (cell.disabled) return;
        if ("stars".equals(cell.kind)) {
            listener.onPick(cell.index, cell.starAt >= 5 ? "clear" : String.valueOf(cell.starAt + 1));
        } else {
            listener.onPick(cell.index, "");
        }
    }
}
