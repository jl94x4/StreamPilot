package com.servermanagerportal.mediaplayer;

import android.net.Uri;
import android.util.Log;
import android.webkit.CookieManager;

import androidx.annotation.Nullable;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Plex "now playing" / progress reporting for {@link PlayerActivity}: direct PMS
 * /:/timeline when the stream carries PMS credentials, otherwise the portal's
 * /api/media-player/timeline. Holds the credentials and the ping throttle; the
 * activity supplies position, state and track ids.
 */
final class PlexTimelineReporter {
    // Same tag as PlayerActivity so existing logcat filters keep catching these.
    private static final String TAG = "SmpPlayerActivity";

    String origin = "";
    String token = "";
    String clientId = "";
    String product = "StreamPilot";
    String version = "1.0.0";
    String platform = "Android";
    String device = "Android TV";
    String deviceName = "StreamPilot";
    String sessionId = "";

    private final String userAgent;
    private long lastPingElapsedMs;
    private String lastState = "";

    PlexTimelineReporter(String userAgent) {
        this.userAgent = userAgent;
    }

    /** Session JSON "timeline" block from the web player. Blank values keep what we have. */
    void applySessionTimeline(@Nullable JSONObject timeline) {
        if (timeline == null) return;
        String origin = timeline.optString("origin", "").trim().replaceAll("/+$", "");
        if (!origin.isEmpty()) this.origin = origin;
        String token = timeline.optString("token", "").trim();
        if (!token.isEmpty()) this.token = token;
        String clientId = timeline.optString("clientId", "").trim();
        if (!clientId.isEmpty()) this.clientId = clientId;
        String product = timeline.optString("product", "").trim();
        if (!product.isEmpty()) this.product = product;
        String version = timeline.optString("version", "").trim();
        if (!version.isEmpty()) this.version = version;
        String platform = timeline.optString("platform", "").trim();
        if (!platform.isEmpty()) this.platform = platform;
        String device = timeline.optString("device", "").trim();
        if (!device.isEmpty()) this.device = device;
        String deviceName = timeline.optString("deviceName", "").trim();
        if (!deviceName.isEmpty()) this.deviceName = deviceName;
        String sessionId = timeline.optString("sessionId", "").trim();
        if (!sessionId.isEmpty()) this.sessionId = sessionId;
    }

    /** Pick up PMS credentials from a direct (non-portal) stream URL. */
    void absorbFromUrl(String url) {
        if (url == null || url.isEmpty() || url.contains("/api/media-player/")) return;
        try {
            Uri parsed = Uri.parse(url);
            String token = PlaybackUrls.queryParam(parsed, "X-Plex-Token");
            if (token.isEmpty()) token = PlaybackUrls.queryParam(parsed, "access_token");
            if (!token.isEmpty()) this.token = token;
            String clientId = PlaybackUrls.queryParam(parsed, "X-Plex-Client-Identifier");
            if (!clientId.isEmpty()) this.clientId = clientId;
            String session = PlaybackUrls.queryParam(parsed, "X-Plex-Session-Identifier");
            if (session.isEmpty()) session = PlaybackUrls.queryParam(parsed, "session");
            if (!session.isEmpty()) this.sessionId = session;
            String product = PlaybackUrls.queryParam(parsed, "X-Plex-Product");
            if (!product.isEmpty()) this.product = product;
            String platform = PlaybackUrls.queryParam(parsed, "X-Plex-Platform");
            if (!platform.isEmpty()) this.platform = platform;
            String device = PlaybackUrls.queryParam(parsed, "X-Plex-Device");
            if (!device.isEmpty()) this.device = device;
            String deviceName = PlaybackUrls.queryParam(parsed, "X-Plex-Device-Name");
            if (!deviceName.isEmpty()) this.deviceName = deviceName;
            if ((this.origin == null || this.origin.isEmpty())
                    && parsed.getScheme() != null
                    && parsed.getHost() != null) {
                String origin = parsed.getScheme() + "://" + parsed.getHost();
                if (parsed.getPort() != -1) origin += ":" + parsed.getPort();
                this.origin = origin;
            }
        } catch (Throwable ignored) {
            /* malformed playback url */
        }
    }

    boolean hasPmsCredentials() {
        return origin != null && !origin.isEmpty() && token != null && !token.isEmpty();
    }

    /** Plex only knows playing / paused / stopped / buffering. */
    static String normalizeState(String rawState) {
        String state = "playing";
        if ("paused".equals(rawState) || "stopped".equals(rawState) || "buffering".equals(rawState)) {
            state = rawState;
        }
        return state;
    }

    /**
     * At most one routine ping per 5s; stop and state changes always go. A paused player
     * is routine too: the 1s UI tick asks every second, and sending each one flooded PMS.
     */
    boolean shouldPing(String state, long nowElapsedMs) {
        boolean important = "stopped".equals(state) || !state.equals(lastState);
        if (!important && nowElapsedMs - lastPingElapsedMs < 5_000) return false;
        lastPingElapsedMs = nowElapsedMs;
        lastState = state;
        return true;
    }

    /**
     * Plex counts a title as watched past 90%, in the last 15s, or once credits start.
     * creditsStartMs &lt; 0 means no credits marker.
     */
    static boolean isWatchedPosition(long positionMs, long durationMs, long creditsStartMs) {
        if (creditsStartMs >= 0 && positionMs >= creditsStartMs) return true;
        if (durationMs <= 0) return false;
        if (positionMs >= (long) (durationMs * 0.9d)) return true;
        return positionMs > Math.max(0L, durationMs - 15_000L);
    }

    @Nullable
    String buildScrobbleUrl(String ratingKey) {
        if (ratingKey == null || ratingKey.trim().isEmpty()) return null;
        if (!hasPmsCredentials()) return null;
        Uri.Builder builder = Uri.parse(origin + "/:/scrobble").buildUpon();
        builder.appendQueryParameter("identifier", "com.plexapp.plugins.library");
        builder.appendQueryParameter("key", ratingKey);
        builder.appendQueryParameter("X-Plex-Token", token);
        return builder.build().toString();
    }

    @Nullable
    String buildPmsTimelineUrl(
        String ratingKey,
        String state,
        long positionMs,
        long durationMs,
        boolean musicMode,
        @Nullable String audioStreamId,
        @Nullable String subtitleStreamId
    ) {
        if (!hasPmsCredentials()) return null;
        try {
            Uri.Builder builder = Uri.parse(origin + "/:/timeline").buildUpon();
            builder.appendQueryParameter("ratingKey", ratingKey);
            builder.appendQueryParameter("key", "/library/metadata/" + ratingKey);
            builder.appendQueryParameter("identifier", "com.plexapp.plugins.library");
            builder.appendQueryParameter("state", state);
            builder.appendQueryParameter("time", String.valueOf(positionMs));
            builder.appendQueryParameter("playbackTime", String.valueOf(positionMs));
            builder.appendQueryParameter("duration", String.valueOf(Math.max(0L, durationMs)));
            builder.appendQueryParameter("type", musicMode ? "music" : "video");
            builder.appendQueryParameter("hasMDE", "1");
            builder.appendQueryParameter("X-Plex-Token", token);
            builder.appendQueryParameter("X-Plex-Client-Identifier",
                    clientId == null || clientId.isEmpty() ? "streampilot-android" : clientId);
            builder.appendQueryParameter("X-Plex-Product", product);
            builder.appendQueryParameter("X-Plex-Version", version);
            builder.appendQueryParameter("X-Plex-Platform", platform);
            builder.appendQueryParameter("X-Plex-Device", device);
            builder.appendQueryParameter("X-Plex-Device-Name", deviceName);
            builder.appendQueryParameter("X-Plex-Provides", "player,controller");
            if (sessionId != null && !sessionId.isEmpty()) {
                builder.appendQueryParameter("X-Plex-Session-Identifier", sessionId);
            }
            String audioId = audioStreamId == null ? "" : audioStreamId.replaceAll("\\D", "");
            if (!audioId.isEmpty()) builder.appendQueryParameter("audioStreamID", audioId);
            String subId = subtitleStreamId == null ? "" : subtitleStreamId.replaceAll("\\D", "");
            builder.appendQueryParameter("subtitleStreamID", subId.isEmpty() ? "0" : subId);
            return builder.build().toString();
        } catch (Throwable e) {
            Log.w(TAG, "Plex timeline URL skipped", e);
            return null;
        }
    }

    /** Portal timeline endpoint on the same origin as a portal stream URL, else null. */
    @Nullable
    static String buildPortalTimelineUrl(@Nullable String currentUrl) {
        if (currentUrl == null || !currentUrl.contains("/api/media-player/")) return null;
        try {
            Uri parsed = Uri.parse(currentUrl);
            if (parsed.getScheme() == null || parsed.getHost() == null) return null;
            String origin = parsed.getScheme() + "://" + parsed.getHost();
            if (parsed.getPort() != -1) origin += ":" + parsed.getPort();
            return origin + "/api/media-player/timeline";
        } catch (Throwable ignored) {
            return null;
        }
    }

    @Nullable
    String buildPortalTimelineBody(
        String ratingKey,
        String state,
        long positionMs,
        long durationMs,
        @Nullable String audioStreamId,
        @Nullable String subtitleStreamId
    ) {
        try {
            JSONObject body = new JSONObject();
            body.put("ratingKey", ratingKey);
            body.put("state", state);
            body.put("timeMs", positionMs);
            body.put("durationMs", Math.max(0L, durationMs));
            if (sessionId != null && !sessionId.isEmpty()) {
                body.put("sessionId", sessionId);
            }
            if (audioStreamId != null && !audioStreamId.isEmpty()) body.put("audioStreamId", audioStreamId);
            if (subtitleStreamId != null) body.put("subtitleStreamId", subtitleStreamId);
            return body.toString();
        } catch (Throwable ignored) {
            return null;
        }
    }

    /** Blocking; call off the main thread. */
    void httpPing(String url, @Nullable String body, String method) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(4_000);
            conn.setReadTimeout(4_000);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestMethod(method);
            conn.setRequestProperty("Accept", "application/json, text/plain, */*");
            conn.setRequestProperty("User-Agent", userAgent);
            if (token != null && !token.isEmpty()) {
                conn.setRequestProperty("X-Plex-Token", token);
            }
            if (clientId != null && !clientId.isEmpty()) {
                conn.setRequestProperty("X-Plex-Client-Identifier", clientId);
            }
            if (sessionId != null && !sessionId.isEmpty()) {
                conn.setRequestProperty("X-Plex-Session-Identifier", sessionId);
            }
            conn.setRequestProperty("X-Plex-Product", product);
            conn.setRequestProperty("X-Plex-Device-Name", deviceName);
            conn.setRequestProperty("X-Plex-Provides", "player,controller");
            try {
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null && !cookie.isEmpty()) conn.setRequestProperty("Cookie", cookie);
            } catch (Throwable ignored) {
                /* cookies optional for direct PMS */
            }
            if (body != null) {
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                conn.setRequestProperty("X-Requested-With", "ServerManagerPortal");
                try (OutputStream out = conn.getOutputStream()) {
                    out.write(bytes);
                }
            }
            conn.getResponseCode();
        } catch (Throwable e) {
            Log.w(TAG, "Plex timeline ping failed", e);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
