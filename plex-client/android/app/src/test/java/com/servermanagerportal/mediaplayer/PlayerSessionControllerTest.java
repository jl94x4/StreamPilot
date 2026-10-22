package com.servermanagerportal.mediaplayer;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import android.net.Uri;

import androidx.media3.common.C;
import androidx.media3.common.MediaMetadata;
import androidx.media3.exoplayer.ExoPlayer;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

import java.util.ArrayList;
import java.util.List;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class PlayerSessionControllerTest {

    /** Records what the session asked the activity to do. */
    private static final class FakeHost implements PlayerSessionController.Host {
        final List<String> calls = new ArrayList<>();
        long position = 0;
        long duration = 0;
        long origin = 0;

        @Override
        public void applyPlayPause(boolean play) {
            calls.add(play ? "play" : "pause");
        }

        @Override
        public void seekToContent(long contentMs, boolean immediate) {
            calls.add("seekTo:" + contentMs + ":" + immediate);
        }

        @Override
        public void seekByWithFlash(long deltaMs) {
            calls.add("seekBy:" + deltaMs);
        }

        @Override
        public long contentPositionMs() {
            return position;
        }

        @Override
        public long contentDurationMs() {
            return duration;
        }

        @Override
        public long timelineOriginMs() {
            return origin;
        }
    }

    private ExoPlayer exo;
    private FakeHost host;
    private PlayerSessionController.SessionPlayer session;

    @Before
    public void setUp() {
        exo = new ExoPlayer.Builder(RuntimeEnvironment.getApplication()).build();
        host = new FakeHost();
        session = new PlayerSessionController.SessionPlayer(exo, host);
    }

    @After
    public void tearDown() {
        exo.release();
    }

    @Test
    public void playPauseGoThroughTheOnScreenControlPath() {
        session.play();
        session.pause();
        session.setPlayWhenReady(true);
        assertEquals(List.of("play", "pause", "play"), host.calls);
    }

    @Test
    public void seeksUseContentTimeAndTheTenSecondStep() {
        session.seekTo(90_000);
        session.seekBack();
        session.seekForward();
        assertEquals(List.of("seekTo:90000:true", "seekBy:-10000", "seekBy:10000"), host.calls);
        assertEquals(10_000, session.getSeekBackIncrement());
        assertEquals(10_000, session.getSeekForwardIncrement());
    }

    @Test
    public void positionAndDurationAreContentTimeIncludingTheTranscodeOffset() {
        host.position = 1_800_000;
        host.duration = 5_400_000;
        host.origin = 1_200_000;
        assertEquals(1_800_000, session.getCurrentPosition());
        assertEquals(1_800_000, session.getContentPosition());
        assertEquals(5_400_000, session.getDuration());
        assertEquals(5_400_000, session.getContentDuration());
        // Idle player has buffered nothing, so buffered = origin.
        assertEquals(1_200_000, session.getBufferedPosition());
        assertEquals(1_200_000, session.getContentBufferedPosition());
    }

    @Test
    public void unknownDurationIsReportedAsUnset() {
        host.duration = 0;
        assertEquals(C.TIME_UNSET, session.getDuration());
    }

    @Test
    public void metadataCarriesTitleSubtitleAndSafeArtwork() {
        MediaMetadata meta = PlayerSessionController.metadata("Heat", "1995", "https://img.example/poster.jpg");
        assertEquals("Heat", String.valueOf(meta.title));
        assertEquals("Heat", String.valueOf(meta.displayTitle));
        assertEquals("1995", String.valueOf(meta.subtitle));
        assertEquals(Uri.parse("https://img.example/poster.jpg"), meta.artworkUri);
    }

    @Test
    public void metadataNeverPublishesATokenBearingArtworkUrl() {
        assertNull(PlayerSessionController.metadata("A", "", "https://portal/api/img?access_token=jwt").artworkUri);
        assertNull(PlayerSessionController.metadata("A", "", "https://pms:32400/photo?X-Plex-Token=t").artworkUri);
        assertNull(PlayerSessionController.metadata("A", "", "file:///data/poster.jpg").artworkUri);
        assertNull(PlayerSessionController.metadata(null, null, null).title);
    }
}
