package com.servermanagerportal.mediaplayer;

import android.os.Build;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.annotation.Nullable;

/** Row building and focus / scroll helpers for the player settings sheet. */
final class PlayerMenuRows {
    private PlayerMenuRows() {}

    static boolean isDescendantOf(@Nullable View child, @Nullable View ancestor) {
        if (child == null || ancestor == null) return false;
        View walk = child;
        while (walk != null) {
            if (walk == ancestor) return true;
            Object parent = walk.getParent();
            walk = parent instanceof View ? (View) parent : null;
        }
        return false;
    }

    /** Label of the menu row that holds focus, so a rebuilt menu can refocus it. */
    @Nullable
    static String focusedRowLabel(@Nullable ViewGroup menuList, @Nullable View focus) {
        if (menuList == null) return null;
        if (focus == null) return null;
        View row = focus;
        while (row != null && row.getParent() != menuList) {
            Object parent = row.getParent();
            row = parent instanceof View ? (View) parent : null;
        }
        if (row == null || row.getParent() != menuList) return null;
        TextView labelView = row.findViewById(R.id.player_menu_row_label);
        if (labelView == null) return null;
        CharSequence text = labelView.getText();
        return text == null ? null : text.toString();
    }

    /** Focus the row with this label (else the first row) and restore its scroll. */
    static void focusRow(@Nullable ViewGroup menuList, @Nullable ScrollView menuScroll, @Nullable String label, int fallbackScrollY) {
        if (menuList == null || menuList.getChildCount() == 0) return;
        View target = null;
        if (label != null && !label.isEmpty()) {
            for (int i = 0; i < menuList.getChildCount(); i++) {
                View child = menuList.getChildAt(i);
                TextView labelView = child.findViewById(R.id.player_menu_row_label);
                if (labelView != null && label.contentEquals(labelView.getText())) {
                    target = child;
                    break;
                }
            }
        }
        final View toFocus = target != null ? target : menuList.getChildAt(0);
        final boolean foundLabel = target != null;
        toFocus.post(() -> {
            if (menuScroll != null) {
                if (foundLabel) {
                    menuScroll.scrollTo(0, Math.max(0, toFocus.getTop() - 24));
                } else {
                    menuScroll.scrollTo(0, Math.max(0, fallbackScrollY));
                }
            }
            toFocus.requestFocus();
        });
    }

    static void focusFirstRow(@Nullable ViewGroup menuList, @Nullable ScrollView menuScroll) {
        if (menuList == null || menuList.getChildCount() == 0) return;
        final View toFocus = menuList.getChildAt(0);
        toFocus.post(() -> {
            if (menuScroll != null) menuScroll.scrollTo(0, 0);
            toFocus.requestFocus();
        });
    }

    /** "Label ……… value" row. Not selectable = dimmed but still focusable (so D-pad can pass over it). */
    static void addSettingsRow(
        @Nullable ViewGroup menuList,
        LayoutInflater inflater,
        String label,
        String value,
        boolean visible,
        boolean selectable,
        Runnable onClick
    ) {
        if (!visible || menuList == null) return;
        View row = inflater.inflate(R.layout.player_menu_row_value, menuList, false);
        TextView labelView = row.findViewById(R.id.player_menu_row_label);
        TextView valueView = row.findViewById(R.id.player_menu_row_value);
        if (labelView != null) labelView.setText(label);
        if (valueView != null) {
            String detail = value == null ? "" : value.trim();
            if (detail.length() > 28) detail = detail.substring(0, 25) + "…";
            valueView.setText(detail);
            valueView.setVisibility(detail.isEmpty() ? View.GONE : View.VISIBLE);
        }
        if (Build.VERSION.SDK_INT >= 26) row.setDefaultFocusHighlightEnabled(false);
        if (!selectable) {
            row.setEnabled(false);
            row.setFocusable(true);
            row.setAlpha(0.45f);
            row.setOnClickListener(v -> {
                if (onClick != null) onClick.run();
            });
        } else {
            row.setAlpha(1f);
            row.setOnClickListener(v -> {
                if (onClick != null) onClick.run();
            });
        }
        menuList.addView(row);
    }
}
