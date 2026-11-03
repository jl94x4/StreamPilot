package com.servermanagerportal.mediaplayer;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class PlayerMenuNavTest {

    @Test
    public void backWalksSubMenusThenCloses() {
        PlayerMenuNav nav = new PlayerMenuNav();
        nav.openSettingsRoot();
        nav.push("subtitle");
        nav.push("subAppear");
        assertEquals("subtitle", nav.pop());
        assertEquals("settings", nav.pop());
        assertNull(nav.pop());
        assertNull(nav.pop());
    }

    @Test
    public void pushDoesNotDuplicateTheMenuBeingRebuilt() {
        PlayerMenuNav nav = new PlayerMenuNav();
        nav.openSettingsRoot();
        nav.push("speed");
        nav.push("speed");
        assertEquals("settings", nav.pop());
    }

    @Test
    public void leafPickReturnsToItsParentMenu() {
        PlayerMenuNav nav = new PlayerMenuNav();
        assertEquals(PlayerMenuNav.Return.CLOSE, nav.leafReturnTarget());

        nav.openSettingsRoot();
        nav.push("speed");
        assertEquals(PlayerMenuNav.Return.SETTINGS_ROOT, nav.leafReturnTarget());

        nav.openSubtitlesRoot();
        nav.push("subSize");
        assertEquals(PlayerMenuNav.Return.SUBTITLES, nav.leafReturnTarget());

        nav.openSettingsRoot();
        nav.push("playback");
        nav.push("zoom");
        assertEquals(PlayerMenuNav.Return.PLAYBACK, nav.leafReturnTarget());
    }

    @Test
    public void subtitlesRootAlwaysSitsOnSettings() {
        PlayerMenuNav nav = new PlayerMenuNav();
        nav.openSubtitlesRoot();
        assertTrue(nav.settingsTreeActive());
        assertTrue(nav.topIs("subtitle"));
        assertEquals("settings", nav.pop());

        // Re-opening from a deeper subtitle menu trims back to "subtitle".
        nav.openSettingsRoot();
        nav.push("subtitle");
        nav.push("subAppear");
        nav.push("subColor");
        nav.openSubtitlesRoot();
        assertTrue(nav.topIs("subtitle"));
        assertEquals("settings", nav.pop());
    }

    @Test
    public void trimToSubtitlesDropsMenusAboveIt() {
        PlayerMenuNav nav = new PlayerMenuNav();
        nav.openSettingsRoot();
        nav.push("subtitle");
        nav.push("subAppear");
        nav.push("subColor");
        nav.trimToSubtitles();
        assertTrue(nav.topIs("subtitle"));
    }

    @Test
    public void emptyLeafIsUndoneOnlyInsideTheSettingsTree() {
        PlayerMenuNav nav = new PlayerMenuNav();
        nav.openSettingsRoot();
        nav.push("chapters");
        nav.dropEmptyLeaf();
        assertTrue(nav.topIs("settings"));

        PlayerMenuNav direct = new PlayerMenuNav();
        direct.push("audio");
        direct.dropEmptyLeaf();
        assertTrue(direct.topIs("audio"));
    }

    @Test
    public void resetClosesEverything() {
        PlayerMenuNav nav = new PlayerMenuNav();
        nav.openSettingsRoot();
        nav.push("sleep");
        nav.reset();
        assertTrue(nav.isEmpty());
        assertFalse(nav.settingsTreeActive());
        assertFalse(nav.topIs("settings"));
        assertEquals(PlayerMenuNav.Return.CLOSE, nav.leafReturnTarget());
    }
}
