package com.servermanagerportal.mediaplayer;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.net.Uri;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class PlexTimelineReporterTest {

    private static PlexTimelineReporter reporter() {
        return new PlexTimelineReporter("test-agent");
    }

    @Test
    public void absorbsPmsCredentialsFromADirectStreamUrl() {
        PlexTimelineReporter r = reporter();
        r.absorbFromUrl("https://pms.local:32400/library/parts/5/file.mkv"
            + "?X-Plex-Token=tok&X-Plex-Client-Identifier=cid&session=s9&X-Plex-Device-Name=Lounge");
        assertEquals("https://pms.local:32400", r.origin);
        assertEquals("tok", r.token);
        assertEquals("cid", r.clientId);
        assertEquals("s9", r.sessionId);
        assertEquals("Lounge", r.deviceName);
        assertEquals("StreamPilot", r.product);
        assertTrue(r.hasPmsCredentials());
    }

    @Test
    public void ignoresPortalUrlsAndKeepsAnExistingOrigin() {
        PlexTimelineReporter r = reporter();
        r.absorbFromUrl("https://portal/api/media-player/file/1?access_token=portalJwt");
        assertEquals("", r.token);
        assertFalse(r.hasPmsCredentials());

        r.origin = "https://pms.first:32400";
        r.absorbFromUrl("http://other:32400/library/parts/1/file.mkv?access_token=t2");
        assertEquals("https://pms.first:32400", r.origin);
        assertEquals("t2", r.token);
    }

    @Test
    public void sessionTimelineOverridesOnlyNonBlankValues() throws Exception {
        PlexTimelineReporter r = reporter();
        r.applySessionTimeline(new JSONObject()
            .put("origin", "https://pms.local:32400//")
            .put("token", " tok ")
            .put("product", "")
            .put("version", "2.1.0"));
        assertEquals("https://pms.local:32400", r.origin);
        assertEquals("tok", r.token);
        assertEquals("StreamPilot", r.product);
        assertEquals("2.1.0", r.version);
        r.applySessionTimeline(null);
        assertEquals("tok", r.token);
    }

    @Test
    public void normalizeStateMapsUnknownStatesToPlaying() {
        assertEquals("paused", PlexTimelineReporter.normalizeState("paused"));
        assertEquals("stopped", PlexTimelineReporter.normalizeState("stopped"));
        assertEquals("buffering", PlexTimelineReporter.normalizeState("buffering"));
        assertEquals("playing", PlexTimelineReporter.normalizeState("seeking"));
        assertEquals("playing", PlexTimelineReporter.normalizeState(null));
    }

    @Test
    public void throttlesRoutinePingsButNotPauseStopOrStateChanges() {
        PlexTimelineReporter r = reporter();
        assertTrue(r.shouldPing("playing", 10_000));
        assertFalse(r.shouldPing("playing", 12_000));
        assertTrue(r.shouldPing("playing", 15_000));
        assertTrue(r.shouldPing("buffering", 15_500));
        assertTrue(r.shouldPing("paused", 15_600));
        assertTrue(r.shouldPing("paused", 15_700));
        assertTrue(r.shouldPing("stopped", 15_800));
    }

    @Test
    public void watchedAtNinetyPercentLastFifteenSecondsOrCredits() {
        long hour = 3_600_000L;
        assertFalse(PlexTimelineReporter.isWatchedPosition(hour / 2, hour, -1));
        assertTrue(PlexTimelineReporter.isWatchedPosition((long) (hour * 0.9), hour, -1));
        assertTrue(PlexTimelineReporter.isWatchedPosition(hour - 10_000, hour, -1));
        assertTrue(PlexTimelineReporter.isWatchedPosition(hour / 2, hour, hour / 2));
        assertTrue(PlexTimelineReporter.isWatchedPosition(5_000, 0, 1_000));
        assertFalse(PlexTimelineReporter.isWatchedPosition(5_000, 0, -1));
        // Short clip: the last 15 seconds start before 90%.
        assertTrue(PlexTimelineReporter.isWatchedPosition(16_000, 30_000, -1));
    }

    @Test
    public void pmsTimelineUrlCarriesStateTimeAndNumericTrackIds() {
        PlexTimelineReporter r = reporter();
        r.origin = "https://pms.local:32400";
        r.token = "tok";
        r.sessionId = "sess";
        Uri uri = Uri.parse(r.buildPmsTimelineUrl("77", "paused", 61_000, -5, false, "a12", null));
        assertEquals("/:/timeline", uri.getPath());
        assertEquals("77", uri.getQueryParameter("ratingKey"));
        assertEquals("/library/metadata/77", uri.getQueryParameter("key"));
        assertEquals("paused", uri.getQueryParameter("state"));
        assertEquals("61000", uri.getQueryParameter("time"));
        assertEquals("0", uri.getQueryParameter("duration"));
        assertEquals("video", uri.getQueryParameter("type"));
        assertEquals("streampilot-android", uri.getQueryParameter("X-Plex-Client-Identifier"));
        assertEquals("sess", uri.getQueryParameter("X-Plex-Session-Identifier"));
        assertEquals("12", uri.getQueryParameter("audioStreamID"));
        assertEquals("0", uri.getQueryParameter("subtitleStreamID"));

        Uri music = Uri.parse(r.buildPmsTimelineUrl("78", "playing", 0, 200_000, true, "", "s5"));
        assertEquals("music", music.getQueryParameter("type"));
        assertNull(music.getQueryParameter("audioStreamID"));
        assertEquals("5", music.getQueryParameter("subtitleStreamID"));
    }

    @Test
    public void pmsUrlsNeedCredentials() {
        PlexTimelineReporter r = reporter();
        assertNull(r.buildPmsTimelineUrl("1", "playing", 0, 0, false, null, null));
        assertNull(r.buildScrobbleUrl("1"));
        r.origin = "https://pms";
        r.token = "tok";
        assertNull(r.buildScrobbleUrl(" "));
        Uri scrobble = Uri.parse(r.buildScrobbleUrl("9"));
        assertEquals("/:/scrobble", scrobble.getPath());
        assertEquals("9", scrobble.getQueryParameter("key"));
        assertEquals("tok", scrobble.getQueryParameter("X-Plex-Token"));
    }

    @Test
    public void portalTimelineUsesTheStreamOriginAndAJsonBody() throws Exception {
        assertEquals("https://portal.example:8443/api/media-player/timeline",
            PlexTimelineReporter.buildPortalTimelineUrl("https://portal.example:8443/api/media-player/hls/1/master.m3u8?x=1"));
        assertEquals("https://portal.example/api/media-player/timeline",
            PlexTimelineReporter.buildPortalTimelineUrl("https://portal.example/api/media-player/file/1"));
        assertNull(PlexTimelineReporter.buildPortalTimelineUrl("https://pms/library/parts/1/file.mkv"));
        assertNull(PlexTimelineReporter.buildPortalTimelineUrl(null));

        PlexTimelineReporter r = reporter();
        r.sessionId = "sess";
        JSONObject body = new JSONObject(r.buildPortalTimelineBody("5", "playing", 1_000, -1, "", "0"));
        assertEquals("5", body.getString("ratingKey"));
        assertEquals("playing", body.getString("state"));
        assertEquals(1_000, body.getLong("timeMs"));
        assertEquals(0, body.getLong("durationMs"));
        assertEquals("sess", body.getString("sessionId"));
        assertFalse(body.has("audioStreamId"));
        assertEquals("0", body.getString("subtitleStreamId"));
    }
}
