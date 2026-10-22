package com.servermanagerportal.mediaplayer;

import android.content.Context;
import android.net.Uri;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.media3.common.C;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.session.MediaSession;

import java.util.Locale;

/**
 * Expose playback to the system: Assistant ("pause", "skip back"), the TV's
 * now-playing card and phone remotes. Commands go through the same paths as
 * the on-screen controls (via {@link Host}) so userPaused and transcode seeks
 * stay correct.
 */
final class PlayerSessionController {
    private static final String TAG = "SmpPlayerActivity";
    static final long SEEK_STEP_MS = 10_000;
    private static int sessionSeq;

    /** The on-screen control paths and content clock of {@link PlayerActivity}. */
    interface Host {
        void applyPlayPause(boolean play);

        void seekToContent(long contentMs, boolean immediate);

        void seekByWithFlash(long deltaMs);

        long contentPositionMs();

        long contentDurationMs();

        /** Content time already skipped by a transcode URL offset. */
        long timelineOriginMs();
    }

    private final Context context;
    private final Host host;
    @Nullable
    private MediaSession mediaSession;

    PlayerSessionController(Context context, Host host) {
        this.context = context;
        this.host = host;
    }

    void start(@Nullable Player player) {
        if (player == null || mediaSession != null) return;
        try {
            Player.Commands commands = new Player.Commands.Builder()
                .addAll(
                    Player.COMMAND_PLAY_PAUSE,
                    Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
                    Player.COMMAND_SEEK_BACK,
                    Player.COMMAND_SEEK_FORWARD,
                    Player.COMMAND_GET_CURRENT_MEDIA_ITEM,
                    Player.COMMAND_GET_TIMELINE,
                    Player.COMMAND_GET_METADATA
                )
                .build();
            mediaSession = new MediaSession.Builder(context, new SessionPlayer(player, host))
                // singleTop can open the next title before this activity's onDestroy.
                .setId("player-" + (++sessionSeq))
                .setCallback(new MediaSession.Callback() {
                    @Override
                    public MediaSession.ConnectionResult onConnect(
                        MediaSession session,
                        MediaSession.ControllerInfo controller
                    ) {
                        return new MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                            .setAvailablePlayerCommands(commands)
                            .build();
                    }
                })
                .build();
        } catch (Throwable e) {
            Log.w(TAG, "MediaSession unavailable", e);
            mediaSession = null;
        }
    }

    void release() {
        if (mediaSession == null) return;
        try {
            mediaSession.release();
        } catch (Throwable ignored) {
            /* ignore */
        }
        mediaSession = null;
    }

    /** Title / episode line / poster for the TV now-playing card and Assistant. */
    static MediaMetadata metadata(@Nullable String titleText, @Nullable String subtitleText, @Nullable String artUrl) {
        MediaMetadata.Builder meta = new MediaMetadata.Builder();
        if (titleText != null && !titleText.isEmpty()) meta.setTitle(titleText).setDisplayTitle(titleText);
        if (subtitleText != null && !subtitleText.isEmpty()) meta.setSubtitle(subtitleText);
        String art = artUrl == null ? "" : artUrl.trim();
        // Session metadata is readable by any media controller. Never hand out a URL
        // that carries the portal / Plex token.
        String lowerArt = art.toLowerCase(Locale.US);
        boolean tokenInUrl = lowerArt.contains("access_token=") || lowerArt.contains("x-plex-token=");
        if ((art.startsWith("http://") || art.startsWith("https://")) && !tokenInUrl) {
            meta.setArtworkUri(Uri.parse(art));
        }
        return meta.build();
    }

    /** Session view of the player: content time (transcode offset included) and UI-path controls. */
    static final class SessionPlayer extends ForwardingPlayer {
        private final Host host;

        SessionPlayer(Player player, Host host) {
            super(player);
            this.host = host;
        }

        @Override
        public void play() {
            host.applyPlayPause(true);
        }

        @Override
        public void pause() {
            host.applyPlayPause(false);
        }

        @Override
        public void setPlayWhenReady(boolean playWhenReady) {
            host.applyPlayPause(playWhenReady);
        }

        @Override
        public void seekTo(long positionMs) {
            host.seekToContent(positionMs, true);
        }

        @Override
        public void seekBack() {
            host.seekByWithFlash(-SEEK_STEP_MS);
        }

        @Override
        public void seekForward() {
            host.seekByWithFlash(SEEK_STEP_MS);
        }

        @Override
        public long getSeekBackIncrement() {
            return SEEK_STEP_MS;
        }

        @Override
        public long getSeekForwardIncrement() {
            return SEEK_STEP_MS;
        }

        @Override
        public long getCurrentPosition() {
            return host.contentPositionMs();
        }

        @Override
        public long getContentPosition() {
            return host.contentPositionMs();
        }

        @Override
        public long getBufferedPosition() {
            return host.timelineOriginMs() + Math.max(0, super.getBufferedPosition());
        }

        @Override
        public long getContentBufferedPosition() {
            return getBufferedPosition();
        }

        @Override
        public long getDuration() {
            long duration = host.contentDurationMs();
            return duration > 0 ? duration : C.TIME_UNSET;
        }

        @Override
        public long getContentDuration() {
            return getDuration();
        }
    }
}
