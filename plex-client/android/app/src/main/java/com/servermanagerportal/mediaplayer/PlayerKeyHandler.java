package com.servermanagerportal.mediaplayer;

import android.view.KeyEvent;

/**
 * Remote / keyboard handling for {@link PlayerActivity}: Back, OK, D-pad, media keys
 * and the long-press stats overlay. Decides what each key does in the current player
 * state; the activity performs it through {@link Host} and forwards to Android when
 * the result is {@link Result#SUPER}.
 */
final class PlayerKeyHandler {
    /** What the activity's key override should return. */
    enum Result {
        /** Consumed: return true. */
        HANDLED,
        /** Not consumed and not forwarded: return false. */
        IGNORED,
        /** Let Android handle it: return super.onKey…(). */
        SUPER
    }

    /** Player state and actions the key rules need. */
    interface Host {
        boolean isOptionDialogShowing();

        void popMenuOrClose();

        boolean isStatsKey(int keyCode);

        boolean statsVisible();

        void toggleStatsOverlay();

        void hideStatsOverlay();

        boolean chromeVisible();

        void setChromeVisible(boolean visible);

        void bumpChrome();

        boolean seekHoldActive();

        void startSeekHold(int direction);

        void stopSeekHold();

        boolean isUpNextVisible();

        boolean isUpNextFocused();

        void focusUpNextControls();

        /** playbackEnded, or the player reports STATE_ENDED. */
        boolean playbackEndedNow();

        boolean musicMode();

        void finishWithResult(boolean ended, boolean playNext);

        void minimizeToBrowse();

        /** Focus is on Play/Pause, the seek bar, or nothing in particular. */
        boolean isPlaybackConfirmTarget();

        boolean hasChapters();

        void skipChapter(int direction);

        void skipNextFromPlugin();

        void finishForPlayPrevious();

        void showSettingsRoot();

        void applyPlayPause(boolean play);

        void togglePlayPause();

        void focusPlayPauseButton();

        boolean isSeekBarFocused();

        boolean hasSettingsButton();

        /** OK on a visible skip-intro / skip-credits chip. */
        boolean trySkipFromRemote();
    }

    private final Host host;
    /** Swallow the key-up that ends a long press. */
    private boolean confirmLongPress;
    /**
     * OK / play-pause went down in this player. The press on Watch that opens the player
     * goes down in the browse screen and can release here; that release must not pause.
     */
    private boolean confirmDownSeen;

    PlayerKeyHandler(Host host) {
        this.host = host;
    }

    private static boolean isConfirm(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_DPAD_CENTER
            || keyCode == KeyEvent.KEYCODE_ENTER
            || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER;
    }

    Result dispatchKeyEvent(KeyEvent event) {
        int keyCode = event.getKeyCode();
        if (host.isOptionDialogShowing()) {
            if (keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_ESCAPE) {
                if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                    host.popMenuOrClose();
                }
                return Result.HANDLED;
            }
            return Result.SUPER;
        }
        boolean confirm = isConfirm(keyCode);
        boolean mediaToggle = keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE;
        if ((confirm || mediaToggle)
            && event.getAction() == KeyEvent.ACTION_DOWN
            && event.getRepeatCount() == 0) {
            confirmDownSeen = true;
            event.startTracking();
        }
        if (event.getAction() == KeyEvent.ACTION_DOWN && host.isStatsKey(keyCode)) {
            host.toggleStatsOverlay();
            return Result.HANDLED;
        }
        return Result.SUPER;
    }

    Result onKeyLongPress(int keyCode) {
        if (isConfirm(keyCode) || keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) {
            confirmLongPress = true;
            host.toggleStatsOverlay();
            return Result.HANDLED;
        }
        return Result.SUPER;
    }

    Result onKeyDown(int keyCode, KeyEvent event) {
        if (host.isOptionDialogShowing()) {
            if (keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_ESCAPE) {
                if (event.getRepeatCount() == 0) host.popMenuOrClose();
                return Result.HANDLED;
            }
            return Result.SUPER;
        }
        if (keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_ESCAPE) {
            host.stopSeekHold();
            if (host.chromeVisible()) {
                host.setChromeVisible(false);
                if (host.isUpNextVisible()) host.focusUpNextControls();
                return Result.HANDLED;
            }
            if (host.playbackEndedNow()) {
                host.finishWithResult(true, false);
                return Result.HANDLED;
            }
            if (host.statsVisible()) {
                host.hideStatsOverlay();
                return Result.HANDLED;
            }
            // Up next / More like this: Back leaves the player for the episode overview.
            // "Watch credits" on the card is the path to keep playing through the end.
            if (host.isUpNextVisible()) {
                host.finishWithResult(true, false);
                return Result.HANDLED;
            }
            if (host.musicMode()) {
                host.minimizeToBrowse();
                return Result.HANDLED;
            }
            host.finishWithResult(false, false);
            return Result.HANDLED;
        }

        boolean mediaToggle = keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE;
        boolean mediaPlay = keyCode == KeyEvent.KEYCODE_MEDIA_PLAY;
        boolean mediaPause = keyCode == KeyEvent.KEYCODE_MEDIA_PAUSE;
        boolean confirm = isConfirm(keyCode);

        if ((confirm || mediaToggle) && host.isPlaybackConfirmTarget()) {
            event.startTracking();
            return Result.HANDLED;
        }

        if (keyCode == KeyEvent.KEYCODE_MEDIA_STOP) {
            host.finishWithResult(false, false);
            return Result.HANDLED;
        }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_NEXT || keyCode == KeyEvent.KEYCODE_CHANNEL_UP) {
            if (host.hasChapters()) host.skipChapter(1);
            else host.skipNextFromPlugin();
            return Result.HANDLED;
        }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_PREVIOUS || keyCode == KeyEvent.KEYCODE_CHANNEL_DOWN) {
            if (host.hasChapters()) host.skipChapter(-1);
            else host.finishForPlayPrevious();
            return Result.HANDLED;
        }

        boolean seekLeft = keyCode == KeyEvent.KEYCODE_MEDIA_REWIND || keyCode == KeyEvent.KEYCODE_DPAD_LEFT;
        boolean seekRight = keyCode == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT;
        // Hold already running: keep consuming left/right so chrome focus cannot swallow the repeat.
        if (host.seekHoldActive() && (seekLeft || seekRight)) return Result.HANDLED;

        if (!host.chromeVisible()) {
            // Up-next card: D-pad must move between its buttons, not open the OSD / seek.
            if (host.isUpNextVisible()) {
                if (!host.isUpNextFocused()) host.focusUpNextControls();
                if (keyCode == KeyEvent.KEYCODE_DPAD_LEFT
                    || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT
                    || keyCode == KeyEvent.KEYCODE_DPAD_UP
                    || keyCode == KeyEvent.KEYCODE_DPAD_DOWN) {
                    if (keyCode == KeyEvent.KEYCODE_DPAD_LEFT || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
                        return Result.SUPER;
                    }
                    return Result.HANDLED;
                }
                if (confirm) {
                    // Let onKeyUp / the focused button handle OK — do not toggle play/pause.
                    return Result.SUPER;
                }
                if (keyCode == KeyEvent.KEYCODE_MENU) {
                    host.bumpChrome();
                    host.showSettingsRoot();
                    return Result.HANDLED;
                }
            }
            if (mediaPause) {
                host.applyPlayPause(false);
                return Result.HANDLED;
            }
            if (mediaPlay) {
                host.applyPlayPause(true);
                return Result.HANDLED;
            }
            if (seekLeft || seekRight) {
                if (event.getRepeatCount() == 0) host.startSeekHold(seekLeft ? -1 : 1);
                return Result.HANDLED;
            }
            if (keyCode == KeyEvent.KEYCODE_MENU) {
                host.bumpChrome();
                host.showSettingsRoot();
                return Result.HANDLED;
            }
            if (keyCode == KeyEvent.KEYCODE_DPAD_UP || keyCode == KeyEvent.KEYCODE_DPAD_DOWN) {
                host.bumpChrome();
                host.focusPlayPauseButton();
                return Result.HANDLED;
            }
            return Result.SUPER;
        }

        // Chrome visible but up-next is on screen — keep focus on the card, don't refill OSD timer onto Play.
        if (host.isUpNextVisible() && host.isUpNextFocused()) {
            if (keyCode == KeyEvent.KEYCODE_DPAD_LEFT
                || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT
                || keyCode == KeyEvent.KEYCODE_DPAD_UP
                || keyCode == KeyEvent.KEYCODE_DPAD_DOWN
                || confirm) {
                return Result.SUPER;
            }
        }

        host.bumpChrome();
        boolean seekFocused = host.isSeekBarFocused();
        if (mediaPause) {
            host.applyPlayPause(false);
            return Result.HANDLED;
        }
        if (mediaPlay) {
            host.applyPlayPause(true);
            return Result.HANDLED;
        }
        if (mediaToggle) {
            host.togglePlayPause();
            return Result.HANDLED;
        }
        if (seekFocused && (seekLeft || seekRight)) {
            // SeekBar OnKeyListener handles hold; avoid double-seek here.
            return Result.IGNORED;
        }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_REWIND || keyCode == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD) {
            if (event.getRepeatCount() == 0) {
                host.startSeekHold(keyCode == KeyEvent.KEYCODE_MEDIA_REWIND ? -1 : 1);
            }
            return Result.HANDLED;
        }
        if (keyCode == KeyEvent.KEYCODE_MENU && host.hasSettingsButton()) {
            host.showSettingsRoot();
            return Result.HANDLED;
        }
        return Result.SUPER;
    }

    Result onKeyUp(int keyCode) {
        if (keyCode == KeyEvent.KEYCODE_DPAD_LEFT
            || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT
            || keyCode == KeyEvent.KEYCODE_MEDIA_REWIND
            || keyCode == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD) {
            host.stopSeekHold();
        }
        boolean mediaToggle = keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE;
        boolean confirm = isConfirm(keyCode);
        if (confirm || mediaToggle) {
            boolean downSeen = confirmDownSeen;
            confirmDownSeen = false;
            if (confirmLongPress) {
                confirmLongPress = false;
                return Result.HANDLED;
            }
            if (host.isOptionDialogShowing()) return Result.SUPER;
            // Up-next Play now / Watch credits must receive OK — never toggle the OSD.
            if (host.isUpNextVisible()) {
                if (!host.isUpNextFocused()) host.focusUpNextControls();
                if (host.isUpNextFocused() || !host.isPlaybackConfirmTarget()) {
                    return Result.SUPER;
                }
            }
            if (!host.isPlaybackConfirmTarget()) return Result.SUPER;
            if (!downSeen) return Result.HANDLED;
            if (!host.chromeVisible() && confirm && host.trySkipFromRemote()) return Result.HANDLED;
            host.togglePlayPause();
            return Result.HANDLED;
        }
        return Result.SUPER;
    }
}
