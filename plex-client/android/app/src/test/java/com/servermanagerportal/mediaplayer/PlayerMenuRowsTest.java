package com.servermanagerportal.mediaplayer;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.appcompat.view.ContextThemeWrapper;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class PlayerMenuRowsTest {
    private Context context;
    private LinearLayout menuList;
    private LayoutInflater inflater;

    @Before
    public void setUp() {
        context = new ContextThemeWrapper(RuntimeEnvironment.getApplication(), R.style.PlayerTheme);
        menuList = new LinearLayout(context);
        inflater = LayoutInflater.from(context);
    }

    @Test
    public void addsALabelValueRowAndShortensLongValues() {
        final int[] clicks = {0};
        PlayerMenuRows.addSettingsRow(menuList, inflater, "Audio", "English · Dolby TrueHD Atmos 7.1 (Default)", true, true,
            () -> clicks[0]++);
        assertEquals(1, menuList.getChildCount());
        View row = menuList.getChildAt(0);
        TextView label = row.findViewById(R.id.player_menu_row_label);
        TextView value = row.findViewById(R.id.player_menu_row_value);
        assertEquals("Audio", label.getText().toString());
        // Over 28 characters: first 25 plus an ellipsis.
        assertEquals("English · Dolby TrueHD At…", value.getText().toString());
        assertEquals(View.VISIBLE, value.getVisibility());
        row.performClick();
        assertEquals(1, clicks[0]);
    }

    @Test
    public void hiddenRowsAreSkippedAndUnselectableRowsAreDimmed() {
        PlayerMenuRows.addSettingsRow(menuList, inflater, "Hidden", "", false, false, null);
        assertEquals(0, menuList.getChildCount());

        PlayerMenuRows.addSettingsRow(menuList, inflater, "Versions", " ", true, false, null);
        View row = menuList.getChildAt(0);
        assertFalse(row.isEnabled());
        assertTrue(row.isFocusable());
        assertEquals(0.45f, row.getAlpha(), 0.001f);
        assertEquals(View.GONE, row.<TextView>findViewById(R.id.player_menu_row_value).getVisibility());

        PlayerMenuRows.addSettingsRow(null, inflater, "No list", "x", true, true, null);
    }

    @Test
    public void focusedRowLabelFindsTheRowHoldingFocus() {
        PlayerMenuRows.addSettingsRow(menuList, inflater, "Speed", "1×", true, true, null);
        PlayerMenuRows.addSettingsRow(menuList, inflater, "Sleep", "Off", true, true, null);
        View second = menuList.getChildAt(1);
        assertEquals("Sleep", PlayerMenuRows.focusedRowLabel(menuList, second));
        assertEquals("Sleep", PlayerMenuRows.focusedRowLabel(menuList, second.findViewById(R.id.player_menu_row_value)));
        assertNull(PlayerMenuRows.focusedRowLabel(menuList, new View(context)));
        assertNull(PlayerMenuRows.focusedRowLabel(menuList, null));
        assertNull(PlayerMenuRows.focusedRowLabel(null, second));
    }

    @Test
    public void isDescendantOfWalksParents() {
        PlayerMenuRows.addSettingsRow(menuList, inflater, "Speed", "1×", true, true, null);
        View label = menuList.getChildAt(0).findViewById(R.id.player_menu_row_label);
        assertTrue(PlayerMenuRows.isDescendantOf(label, menuList));
        assertTrue(PlayerMenuRows.isDescendantOf(menuList, menuList));
        assertFalse(PlayerMenuRows.isDescendantOf(menuList, label));
        assertFalse(PlayerMenuRows.isDescendantOf(null, menuList));
    }
}
