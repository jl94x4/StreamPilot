package com.servermanagerportal.mediaplayer;

import androidx.annotation.Nullable;

import java.util.ArrayList;

/**
 * Player settings menu navigation: which sub-menus are open (Back walks this
 * stack) and where a leaf pick returns to. {@link PlayerActivity} renders the
 * menus; this only tracks the path.
 */
final class PlayerMenuNav {
    /** Where a leaf menu goes after a pick. */
    enum Return {
        CLOSE,
        SETTINGS_ROOT,
        PLAYBACK,
        SUBTITLES
    }

    static final String SETTINGS = "settings";
    static final String PLAYBACK = "playback";
    static final String SUBTITLE = "subtitle";

    private final ArrayList<String> stack = new ArrayList<>();
    /** Opened from the settings root (vs a direct chip shortcut). */
    private boolean settingsTreeActive;

    boolean settingsTreeActive() {
        return settingsTreeActive;
    }

    boolean isEmpty() {
        return stack.isEmpty();
    }

    boolean topIs(String id) {
        return !stack.isEmpty() && id.equals(stack.get(stack.size() - 1));
    }

    /** Sheet closed. */
    void reset() {
        stack.clear();
        settingsTreeActive = false;
    }

    void openSettingsRoot() {
        settingsTreeActive = true;
        stack.clear();
        stack.add(SETTINGS);
    }

    /** Subtitles menu, always on top of settings: settings → subtitle. */
    void openSubtitlesRoot() {
        settingsTreeActive = true;
        while (!stack.isEmpty() && !SUBTITLE.equals(stack.get(stack.size() - 1))
            && !SETTINGS.equals(stack.get(stack.size() - 1))) {
            stack.remove(stack.size() - 1);
        }
        if (stack.isEmpty()) stack.add(SETTINGS);
        if (!SUBTITLE.equals(stack.get(stack.size() - 1))) stack.add(SUBTITLE);
    }

    /** Enter a sub-menu (no duplicate when rebuilding the same one). */
    void push(String id) {
        if (stack.isEmpty() || !id.equals(stack.get(stack.size() - 1))) {
            stack.add(id);
        }
    }

    /** A sub-menu had nothing to show: undo its push when it came from settings. */
    void dropEmptyLeaf() {
        if (settingsTreeActive && !stack.isEmpty()) {
            stack.remove(stack.size() - 1);
        }
    }

    /** Back: leave the current menu. Returns the menu to show now, or null to close. */
    @Nullable
    String pop() {
        if (stack.isEmpty()) return null;
        stack.remove(stack.size() - 1);
        if (stack.isEmpty()) return null;
        return stack.get(stack.size() - 1);
    }

    /** Back to the subtitles menu after a pick inside it. */
    void trimToSubtitles() {
        while (!stack.isEmpty() && !SUBTITLE.equals(stack.get(stack.size() - 1))) {
            stack.remove(stack.size() - 1);
        }
    }

    Return leafReturnTarget() {
        if (!settingsTreeActive) return Return.CLOSE;
        if (stack.size() >= 2 && PLAYBACK.equals(stack.get(stack.size() - 2))) {
            return Return.PLAYBACK;
        }
        if (stack.size() >= 2 && SUBTITLE.equals(stack.get(stack.size() - 2))) {
            return Return.SUBTITLES;
        }
        return Return.SETTINGS_ROOT;
    }
}
