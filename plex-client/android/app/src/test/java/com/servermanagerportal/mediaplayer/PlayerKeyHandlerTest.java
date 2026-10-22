package com.servermanagerportal.mediaplayer;

import static org.junit.Assert.assertEquals;

import android.view.KeyEvent;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.util.ArrayList;
import java.util.List;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class PlayerKeyHandlerTest {

    /** Player state the test sets, plus a log of what the handler asked for. */
    private static final class FakeHost implements PlayerKeyHandler.Host {
        final List<String> calls = new ArrayList<>();
        boolean menuOpen;
        boolean statsVisible;
        boolean chromeVisible;
        boolean seekHold;
        boolean upNextVisible;
        boolean upNextFocused;
        boolean ended;
        boolean music;
        boolean confirmTarget = true;
        boolean chapters;
        boolean seekBarFocused;
        boolean settingsButton = true;
        boolean skipChip;

        @Override public boolean isOptionDialogShowing() { return menuOpen; }
        @Override public void popMenuOrClose() { calls.add("popMenu"); }
        @Override public boolean isStatsKey(int keyCode) { return keyCode == KeyEvent.KEYCODE_INFO; }
        @Override public boolean statsVisible() { return statsVisible; }
        @Override public void toggleStatsOverlay() { calls.add("toggleStats"); }
        @Override public void hideStatsOverlay() { calls.add("hideStats"); }
        @Override public boolean chromeVisible() { return chromeVisible; }
        @Override public void setChromeVisible(boolean visible) { calls.add("chrome:" + visible); }
        @Override public void bumpChrome() { calls.add("bump"); }
        @Override public boolean seekHoldActive() { return seekHold; }
        @Override public void startSeekHold(int direction) { calls.add("hold:" + direction); }
        @Override public void stopSeekHold() { calls.add("stopHold"); }
        @Override public boolean isUpNextVisible() { return upNextVisible; }
        @Override public boolean isUpNextFocused() { return upNextFocused; }
        @Override public void focusUpNextControls() { calls.add("focusUpNext"); }
        @Override public boolean playbackEndedNow() { return ended; }
        @Override public boolean musicMode() { return music; }
        @Override public void finishWithResult(boolean ended, boolean playNext) { calls.add("finish:" + ended + ":" + playNext); }
        @Override public void minimizeToBrowse() { calls.add("minimize"); }
        @Override public boolean isPlaybackConfirmTarget() { return confirmTarget; }
        @Override public boolean hasChapters() { return chapters; }
        @Override public void skipChapter(int direction) { calls.add("chapter:" + direction); }
        @Override public void skipNextFromPlugin() { calls.add("next"); }
        @Override public void finishForPlayPrevious() { calls.add("previous"); }
        @Override public void showSettingsRoot() { calls.add("settings"); }
        @Override public void applyPlayPause(boolean play) { calls.add(play ? "play" : "pause"); }
        @Override public void togglePlayPause() { calls.add("toggle"); }
        @Override public void focusPlayPauseButton() { calls.add("focusPlay"); }
        @Override public boolean isSeekBarFocused() { return seekBarFocused; }
        @Override public boolean hasSettingsButton() { return settingsButton; }
        @Override public boolean trySkipFromRemote() { calls.add("trySkip"); return skipChip; }
    }

    private FakeHost host;
    private PlayerKeyHandler keys;

    @Before
    public void setUp() {
        host = new FakeHost();
        keys = new PlayerKeyHandler(host);
    }

    private static KeyEvent down(int keyCode) {
        return new KeyEvent(KeyEvent.ACTION_DOWN, keyCode);
    }

    private static KeyEvent repeat(int keyCode) {
        return new KeyEvent(0, 0, KeyEvent.ACTION_DOWN, keyCode, 1);
    }

    private PlayerKeyHandler.Result press(int keyCode) {
        return keys.onKeyDown(keyCode, down(keyCode));
    }

    @Test
    public void backClosesTheOpenMenuFirst() {
        host.menuOpen = true;
        assertEquals(PlayerKeyHandler.Result.HANDLED, keys.dispatchKeyEvent(down(KeyEvent.KEYCODE_BACK)));
        assertEquals(PlayerKeyHandler.Result.HANDLED, press(KeyEvent.KEYCODE_BACK));
        assertEquals(PlayerKeyHandler.Result.HANDLED, keys.onKeyDown(KeyEvent.KEYCODE_BACK, repeat(KeyEvent.KEYCODE_BACK)));
        assertEquals(List.of("popMenu", "popMenu"), host.calls);
        assertEquals(PlayerKeyHandler.Result.SUPER, press(KeyEvent.KEYCODE_DPAD_DOWN));
    }

    @Test
    public void backHidesVisibleControlsBeforeLeaving() {
        host.chromeVisible = true;
        host.upNextVisible = true;
        assertEquals(PlayerKeyHandler.Result.HANDLED, press(KeyEvent.KEYCODE_BACK));
        assertEquals(List.of("stopHold", "chrome:false", "focusUpNext"), host.calls);
    }

    @Test
    public void backWithControlsHiddenLeavesInTheRightWay() {
        host.ended = true;
        press(KeyEvent.KEYCODE_BACK);
        assertEquals("finish:true:false", host.calls.get(1));

        setUp();
        host.statsVisible = true;
        press(KeyEvent.KEYCODE_BACK);
        assertEquals("hideStats", host.calls.get(1));

        setUp();
        host.upNextVisible = true;
        press(KeyEvent.KEYCODE_BACK);
        assertEquals("finish:true:false", host.calls.get(1));

        setUp();
        host.music = true;
        press(KeyEvent.KEYCODE_BACK);
        assertEquals("minimize", host.calls.get(1));

        setUp();
        press(KeyEvent.KEYCODE_ESCAPE);
        assertEquals(List.of("stopHold", "finish:false:false"), host.calls);
    }

    @Test
    public void okTogglesPlaybackOnKeyUpNotDown() {
        assertEquals(PlayerKeyHandler.Result.HANDLED, press(KeyEvent.KEYCODE_DPAD_CENTER));
        assertEquals(List.of(), host.calls);
        assertEquals(PlayerKeyHandler.Result.HANDLED, keys.onKeyUp(KeyEvent.KEYCODE_DPAD_CENTER));
        assertEquals(List.of("trySkip", "toggle"), host.calls);
    }

    @Test
    public void okOnASkipChipSkipsInsteadOfPausing() {
        host.skipChip = true;
        keys.onKeyUp(KeyEvent.KEYCODE_ENTER);
        assertEquals(List.of("trySkip"), host.calls);
    }

    @Test
    public void longPressShowsStatsAndSwallowsItsKeyUp() {
        assertEquals(PlayerKeyHandler.Result.HANDLED, keys.onKeyLongPress(KeyEvent.KEYCODE_DPAD_CENTER));
        assertEquals(PlayerKeyHandler.Result.HANDLED, keys.onKeyUp(KeyEvent.KEYCODE_DPAD_CENTER));
        assertEquals(List.of("toggleStats"), host.calls);
        // The next press is a normal one again.
        keys.onKeyUp(KeyEvent.KEYCODE_DPAD_CENTER);
        assertEquals(List.of("toggleStats", "trySkip", "toggle"), host.calls);
        assertEquals(PlayerKeyHandler.Result.SUPER, keys.onKeyLongPress(KeyEvent.KEYCODE_DPAD_LEFT));
    }

    @Test
    public void dpadLeftRightSeekWithControlsHiddenAndHoldIgnoresRepeats() {
        assertEquals(PlayerKeyHandler.Result.HANDLED, press(KeyEvent.KEYCODE_DPAD_LEFT));
        assertEquals(PlayerKeyHandler.Result.HANDLED, keys.onKeyDown(KeyEvent.KEYCODE_DPAD_RIGHT, repeat(KeyEvent.KEYCODE_DPAD_RIGHT)));
        assertEquals(List.of("hold:-1"), host.calls);
        host.seekHold = true;
        assertEquals(PlayerKeyHandler.Result.HANDLED, press(KeyEvent.KEYCODE_DPAD_RIGHT));
        assertEquals(List.of("hold:-1"), host.calls);
        keys.onKeyUp(KeyEvent.KEYCODE_DPAD_RIGHT);
        assertEquals("stopHold", host.calls.get(1));
    }

    @Test
    public void upDownWithControlsHiddenShowsThemOnPlay() {
        assertEquals(PlayerKeyHandler.Result.HANDLED, press(KeyEvent.KEYCODE_DPAD_UP));
        assertEquals(List.of("bump", "focusPlay"), host.calls);
    }

    @Test
    public void seekBarHandlesItsOwnLeftRight() {
        host.chromeVisible = true;
        host.seekBarFocused = true;
        assertEquals(PlayerKeyHandler.Result.IGNORED, press(KeyEvent.KEYCODE_DPAD_RIGHT));
        assertEquals(List.of("bump"), host.calls);
    }

    @Test
    public void mediaKeys() {
        press(KeyEvent.KEYCODE_MEDIA_PAUSE);
        press(KeyEvent.KEYCODE_MEDIA_PLAY);
        press(KeyEvent.KEYCODE_MEDIA_STOP);
        press(KeyEvent.KEYCODE_MEDIA_NEXT);
        press(KeyEvent.KEYCODE_MEDIA_PREVIOUS);
        assertEquals(List.of("pause", "play", "finish:false:false", "next", "previous"), host.calls);

        setUp();
        host.chapters = true;
        press(KeyEvent.KEYCODE_CHANNEL_UP);
        press(KeyEvent.KEYCODE_CHANNEL_DOWN);
        assertEquals(List.of("chapter:1", "chapter:-1"), host.calls);

        setUp();
        host.chromeVisible = true;
        host.confirmTarget = false;
        press(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE);
        press(KeyEvent.KEYCODE_MEDIA_FAST_FORWARD);
        assertEquals(List.of("bump", "toggle", "bump", "hold:1"), host.calls);
    }

    @Test
    public void upNextCardKeepsTheDpadAndOk() {
        host.upNextVisible = true;
        assertEquals(PlayerKeyHandler.Result.SUPER, press(KeyEvent.KEYCODE_DPAD_LEFT));
        host.upNextFocused = true;
        assertEquals(PlayerKeyHandler.Result.HANDLED, press(KeyEvent.KEYCODE_DPAD_DOWN));
        host.confirmTarget = false;
        assertEquals(PlayerKeyHandler.Result.SUPER, press(KeyEvent.KEYCODE_DPAD_CENTER));
        assertEquals(PlayerKeyHandler.Result.SUPER, keys.onKeyUp(KeyEvent.KEYCODE_DPAD_CENTER));
        assertEquals(List.of("focusUpNext"), host.calls);
    }

    @Test
    public void menuKeyOpensSettings() {
        assertEquals(PlayerKeyHandler.Result.HANDLED, press(KeyEvent.KEYCODE_MENU));
        assertEquals(List.of("bump", "settings"), host.calls);

        setUp();
        host.chromeVisible = true;
        host.settingsButton = false;
        assertEquals(PlayerKeyHandler.Result.SUPER, press(KeyEvent.KEYCODE_MENU));
    }

    @Test
    public void statsKeyTogglesTheOverlay() {
        assertEquals(PlayerKeyHandler.Result.HANDLED, keys.dispatchKeyEvent(down(KeyEvent.KEYCODE_INFO)));
        assertEquals(PlayerKeyHandler.Result.SUPER, keys.dispatchKeyEvent(down(KeyEvent.KEYCODE_DPAD_UP)));
        assertEquals(List.of("toggleStats"), host.calls);
    }
}
