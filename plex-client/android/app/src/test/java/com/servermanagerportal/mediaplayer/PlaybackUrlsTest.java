package com.servermanagerportal.mediaplayer;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.net.Uri;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.util.Map;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class PlaybackUrlsTest {

    @Test
    public void classifiesTranscodeDirectAndLocalUrls() {
        assertTrue(PlaybackUrls.isTranscodeUrl("https://pms:32400/video/:/transcode/universal/start.m3u8?x=1"));
        assertTrue(PlaybackUrls.isTranscodeUrl("https://portal/api/media-player/hls/12/master.m3u8"));
        assertTrue(PlaybackUrls.isTranscodeUrl("https://portal/api/media-player/HLS/12/index"));
        assertFalse(PlaybackUrls.isTranscodeUrl("https://pms:32400/library/parts/55/file.mkv"));
        assertFalse(PlaybackUrls.isTranscodeUrl(null));

        assertTrue(PlaybackUrls.isDirectPlayUrl("https://pms:32400/library/parts/55/file.mkv"));
        assertFalse(PlaybackUrls.isDirectPlayUrl("https://pms/video/:/transcode/universal/start.m3u8"));
        assertFalse(PlaybackUrls.isDirectPlayUrl(""));
        assertFalse(PlaybackUrls.isDirectPlayUrl(null));

        assertTrue(PlaybackUrls.isLocalPlaybackUrl("file:///data/user/0/app/files/dl/1.mkv"));
        assertTrue(PlaybackUrls.isLocalPlaybackUrl(" content://downloads/1"));
        assertTrue(PlaybackUrls.isLocalPlaybackUrl("/sdcard/Movies/a.mp4"));
        assertFalse(PlaybackUrls.isLocalPlaybackUrl("https://pms/library/parts/1/file.mkv"));
        assertFalse(PlaybackUrls.isLocalPlaybackUrl(null));
    }

    @Test
    public void partsUrlFallsBackToPmsHlsWithTheTokenFromThePartUrl() {
        String hls = PlaybackUrls.partsUrlToPmsHls(
            "https://pms.example:32400/library/parts/55/123/file.mkv?X-Plex-Token=abc&X-Plex-Client-Identifier=cid&session=s1",
            " 9876 ", 2, 125_500L,
            null, null, null, null, "4242", null, false
        );
        Uri uri = Uri.parse(hls);
        assertEquals("https", uri.getScheme());
        assertEquals("pms.example:32400", uri.getAuthority());
        assertEquals("/video/:/transcode/universal/start.m3u8", uri.getPath());
        assertEquals("/library/metadata/9876", uri.getQueryParameter("path"));
        assertEquals("2", uri.getQueryParameter("mediaIndex"));
        assertEquals("abc", uri.getQueryParameter("X-Plex-Token"));
        assertEquals("abc", uri.getQueryParameter("access_token"));
        assertEquals("cid", uri.getQueryParameter("X-Plex-Client-Identifier"));
        assertEquals("s1", uri.getQueryParameter("session"));
        assertEquals("125", uri.getQueryParameter("offset"));
        assertEquals("4242", uri.getQueryParameter("audioStreamID"));
        assertEquals("0", uri.getQueryParameter("directPlay"));
        assertEquals("1", uri.getQueryParameter("directStream"));
        assertEquals("none", uri.getQueryParameter("subtitles"));
        assertEquals("0", uri.getQueryParameter("subtitleStreamID"));
    }

    @Test
    public void partsUrlBurnsImageSubtitlesOnHlsFallback() {
        String hls = PlaybackUrls.partsUrlToPmsHls(
            "https://pms.example:32400/library/parts/55/file.mkv?X-Plex-Token=abc",
            "99", 0, 0L,
            null, null, null, null, "10", "77", true
        );
        Uri uri = Uri.parse(hls);
        assertEquals("0", uri.getQueryParameter("directStream"));
        assertEquals("burn", uri.getQueryParameter("subtitles"));
        assertEquals("burn", uri.getQueryParameter("advancedSubtitles"));
        assertEquals("77", uri.getQueryParameter("subtitleStreamID"));
        assertEquals("100", uri.getQueryParameter("subtitleSize"));
    }

    @Test
    public void partsUrlPrefersTimelineCredentialsAndSkipsBadAudioIds() {
        String hls = PlaybackUrls.partsUrlToPmsHls(
            "https://other:32400/library/parts/1/file.mkv?X-Plex-Token=fromUrl",
            "10", -3, 0L,
            "https://pms.local:32400///", "timelineToken", "timelineClient", "timelineSession", "eng",
            null, false
        );
        Uri uri = Uri.parse(hls);
        assertEquals("pms.local:32400", uri.getAuthority());
        assertEquals("timelineToken", uri.getQueryParameter("X-Plex-Token"));
        assertEquals("timelineClient", uri.getQueryParameter("X-Plex-Client-Identifier"));
        assertEquals("timelineSession", uri.getQueryParameter("X-Plex-Session-Identifier"));
        assertEquals("0", uri.getQueryParameter("mediaIndex"));
        assertNull(uri.getQueryParameter("offset"));
        assertNull(uri.getQueryParameter("audioStreamID"));
    }

    @Test
    public void partsUrlNeedsAKeyAndAToken() {
        assertNull(PlaybackUrls.partsUrlToPmsHls(
            "https://pms/library/parts/1/file.mkv?X-Plex-Token=abc", " ", 0, 0, null, null, null, null, null, null, false));
        assertNull(PlaybackUrls.partsUrlToPmsHls(
            "https://pms/library/parts/1/file.mkv", "10", 0, 0, null, null, null, null, null, null, false));
    }

    @Test
    public void fileUrlBecomesPortalHlsWithoutDirectPlayFlags() {
        String hls = PlaybackUrls.fileUrlToHls(
            "https://portal/api/media-player/file/321?access_token=t&hevc=1&ac3=1&client=tv&textSubs=1&download=1&server=s");
        Uri uri = Uri.parse(hls);
        assertEquals("/api/media-player/hls/321/master.m3u8", uri.getPath());
        assertEquals("t", uri.getQueryParameter("access_token"));
        assertEquals("s", uri.getQueryParameter("server"));
        assertEquals("original", uri.getQueryParameter("quality"));
        assertNull(uri.getQueryParameter("hevc"));
        assertNull(uri.getQueryParameter("ac3"));
        assertNull(uri.getQueryParameter("client"));
        assertNull(uri.getQueryParameter("textSubs"));
        assertNull(uri.getQueryParameter("download"));

        String keepsQuality = PlaybackUrls.fileUrlToHls("https://portal/api/media-player/file/9?quality=720p");
        assertEquals("720p", Uri.parse(keepsQuality).getQueryParameter("quality"));

        String notAFileUrl = "https://pms/library/parts/1/file.mkv?x=1";
        assertEquals(notAFileUrl, PlaybackUrls.fileUrlToHls(notAFileUrl));
    }

    @Test
    public void withHlsQualityReplacesOrAddsQualityAndKeepsSameUrlWhenUnchanged() {
        String url = "https://portal/api/media-player/hls/1/master.m3u8?access_token=t&quality=original";
        Uri replaced = Uri.parse(PlaybackUrls.withHlsQuality(url, "1080p"));
        assertEquals("1080p", replaced.getQueryParameter("quality"));
        assertEquals("t", replaced.getQueryParameter("access_token"));

        Uri added = Uri.parse(PlaybackUrls.withHlsQuality("https://portal/hls/1/master.m3u8?a=1", "720p"));
        assertEquals("720p", added.getQueryParameter("quality"));
        assertEquals("1", added.getQueryParameter("a"));

        assertEquals(url, PlaybackUrls.withHlsQuality(url, "original"));
    }

    @Test
    public void summarizeUrlDropsQueryAndToken() {
        assertEquals("https://pms.example/library/parts/1/file.mkv",
            PlaybackUrls.summarizeUrl("https://pms.example:32400/library/parts/1/file.mkv?X-Plex-Token=secret"));
    }

    @Test
    public void parseHeadersKeepsNonEmptyStringValues() {
        Map<String, String> headers = PlaybackUrls.parseHeaders(
            "{\"Authorization\":\"Bearer x\",\"Empty\":\"\",\"X-Plex-Token\":\"abc\"}");
        assertEquals(2, headers.size());
        assertEquals("Bearer x", headers.get("Authorization"));
        assertEquals("abc", headers.get("X-Plex-Token"));
        assertTrue(PlaybackUrls.parseHeaders(null).isEmpty());
        assertTrue(PlaybackUrls.parseHeaders("not json").isEmpty());
    }

    @Test
    public void queryParamTrimsAndTreatsMissingAsEmpty() {
        Uri uri = Uri.parse("https://pms/x?session=%20abc%20");
        assertEquals("abc", PlaybackUrls.queryParam(uri, "session"));
        assertEquals("", PlaybackUrls.queryParam(uri, "missing"));
        assertEquals("", PlaybackUrls.queryParam(null, "session"));
    }

    @Test
    public void movesUniversalTranscodeToAnotherOffset() {
        String start = "https://pms:32400/video/:/transcode/universal/start.m3u8?path=%2Flibrary%2Fmetadata%2F1&session=s1&offset=90&X-Plex-Token=t";
        assertEquals(
            "https://pms:32400/video/:/transcode/universal/start.m3u8?path=%2Flibrary%2Fmetadata%2F1&session=s1&offset=30&X-Plex-Token=t",
            PlaybackUrls.withTranscodeOffset(start, 30));
        assertEquals(
            "https://pms:32400/video/:/transcode/universal/start.m3u8?session=s1&offset=420",
            PlaybackUrls.withTranscodeOffset("https://pms:32400/video/:/transcode/universal/start.m3u8?session=s1", 420));
        assertEquals(
            "https://pms:32400/video/:/transcode/universal/decision?path=%2Flibrary%2Fmetadata%2F1&session=s1&offset=90&X-Plex-Token=t",
            PlaybackUrls.transcodeDecisionUrl(start));
        assertNull(PlaybackUrls.withTranscodeOffset("https://pms/library/parts/1/file.mkv", 30));
        assertNull(PlaybackUrls.transcodeDecisionUrl("https://pms/livetv/sessions/x/index.m3u8"));
    }
}
