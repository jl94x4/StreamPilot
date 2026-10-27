package com.servermanagerportal.mediaplayer;

import android.net.Uri;

import androidx.annotation.Nullable;

import org.json.JSONObject;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;

/** Stream URL rules for {@link PlayerActivity}: classify, rewrite and log playback URLs. */
final class PlaybackUrls {
    private PlaybackUrls() {}

    static boolean isTranscodeUrl(String url) {
        if (url == null) return false;
        String lower = url.toLowerCase(Locale.US);
        return lower.contains(".m3u8") || lower.contains("/transcode/") || lower.contains("/hls/");
    }

    /** PMS universal transcode start (HLS), e.g. /video/:/transcode/universal/start.m3u8?… */
    static boolean isUniversalStartUrl(@Nullable String url) {
        return url != null && url.contains("/transcode/universal/start.m3u8");
    }

    /**
     * The same transcode, started at another point (seconds). PMS restarts a running session
     * at the new offset when the same session id asks again, so a seek needs nothing else.
     * Null when the URL is not a universal start.
     */
    @Nullable
    static String withTranscodeOffset(@Nullable String url, long offsetSec) {
        if (!isUniversalStartUrl(url)) return null;
        String value = String.valueOf(Math.max(0L, offsetSec));
        if (url.matches("(?s).*[?&]offset=[^&#]*.*")) {
            return url.replaceFirst("([?&])offset=[^&#]*", "$1offset=" + value);
        }
        return url + (url.contains("?") ? "&" : "?") + "offset=" + value;
    }

    /** The decision call PMS wants before a start (without it a fresh start can answer 400). */
    @Nullable
    static String transcodeDecisionUrl(@Nullable String startUrl) {
        if (!isUniversalStartUrl(startUrl)) return null;
        return startUrl.replaceFirst("/transcode/universal/start[.]m3u8", "/transcode/universal/decision");
    }

    /** Deepest cause of a playback error, as "SocketException: Connection reset" (empty if none). */
    static String describeCause(@Nullable Throwable error) {
        if (error == null) return "";
        Throwable root = error;
        int guard = 0;
        while (root.getCause() != null && root.getCause() != root && guard++ < 8) root = root.getCause();
        if (root == error) return "";
        String text = root.getClass().getSimpleName();
        String detail = root.getMessage();
        if (detail != null && !detail.trim().isEmpty()) text = text + ": " + detail.trim();
        // Never show a token from a URL in the message.
        text = text.replaceAll("(?i)(X-Plex-Token|access_token)=[^&\\s]+", "$1=…");
        return text.length() > 160 ? text.substring(0, 160) + "…" : text;
    }

    static boolean isDirectPlayUrl(@Nullable String url) {
        return url != null && !url.isEmpty() && !isTranscodeUrl(url);
    }

    static boolean isLocalPlaybackUrl(String url) {
        if (url == null) return false;
        String lower = url.trim().toLowerCase(Locale.US);
        return lower.startsWith("file:") || lower.startsWith("content:") || lower.startsWith("/");
    }

    static String queryParam(Uri uri, String key) {
        if (uri == null || key == null) return "";
        try {
            String value = uri.getQueryParameter(key);
            return value == null ? "" : value.trim();
        } catch (Throwable ignored) {
            return "";
        }
    }

    /**
     * Build a PMS universal HLS URL from a failed Direct Play /library/parts/ stream.
     * Uses timeline credentials when present; otherwise pulls token/host from the part URL.
     */
    @Nullable
    static String partsUrlToPmsHls(
        String partUrl,
        String key,
        int mediaIdx,
        long offsetMs,
        @Nullable String timelineOrigin,
        @Nullable String timelineToken,
        @Nullable String timelineClientId,
        @Nullable String timelineSessionId,
        @Nullable String audioStreamId,
        @Nullable String subtitleStreamId,
        boolean burnImageSubtitles
    ) {
        if (key == null || key.trim().isEmpty()) return null;
        try {
            Uri part = Uri.parse(partUrl);
            String origin = timelineOrigin != null ? timelineOrigin.trim().replaceAll("/+$", "") : "";
            if (origin.isEmpty()) {
                String scheme = part.getScheme();
                String authority = part.getAuthority();
                if (scheme == null || authority == null) return null;
                origin = scheme + "://" + authority;
            }
            String token = timelineToken != null ? timelineToken.trim() : "";
            if (token.isEmpty()) {
                token = part.getQueryParameter("X-Plex-Token");
                if (token == null || token.isEmpty()) token = part.getQueryParameter("access_token");
            }
            if (token == null || token.isEmpty()) return null;
            String clientId = timelineClientId != null && !timelineClientId.isEmpty()
                ? timelineClientId
                : part.getQueryParameter("X-Plex-Client-Identifier");
            if (clientId == null || clientId.isEmpty()) clientId = "streampilot-android";
            String sessionId = timelineSessionId != null && !timelineSessionId.isEmpty()
                ? timelineSessionId
                : part.getQueryParameter("X-Plex-Session-Identifier");
            if (sessionId == null || sessionId.isEmpty()) {
                sessionId = part.getQueryParameter("session");
            }
            if (sessionId == null || sessionId.isEmpty()) sessionId = "smp-fb-" + System.currentTimeMillis();
            Uri.Builder builder = Uri.parse(origin + "/video/:/transcode/universal/start.m3u8").buildUpon();
            builder.appendQueryParameter("hasMDE", "1");
            builder.appendQueryParameter("path", "/library/metadata/" + key.trim());
            builder.appendQueryParameter("mediaIndex", String.valueOf(Math.max(0, mediaIdx)));
            builder.appendQueryParameter("partIndex", "0");
            builder.appendQueryParameter("protocol", "hls");
            builder.appendQueryParameter("fastSeek", "1");
            builder.appendQueryParameter("directPlay", "0");
            builder.appendQueryParameter("directStreamAudio", "1");
            // Accept EAC3/AC3 on remux like official Plex — do not force AAC convert.
            builder.appendQueryParameter("audioCodec", "aac,mp3,ac3,eac3,eac3_joc,flac,opus,mp4a");
            String subId = subtitleStreamId != null && subtitleStreamId.matches("\\d+")
                ? subtitleStreamId : "";
            boolean burn = burnImageSubtitles && !subId.isEmpty();
            builder.appendQueryParameter("directStream", burn ? "0" : "1");
            builder.appendQueryParameter("subtitleSize", burn ? "100" : "0");
            builder.appendQueryParameter("subtitles", burn ? "burn" : "none");
            builder.appendQueryParameter("advancedSubtitles", burn ? "burn" : "none");
            builder.appendQueryParameter("subtitleStreamID", burn ? subId : "0");
            builder.appendQueryParameter("audioBoost", "100");
            builder.appendQueryParameter("videoQuality", "100");
            builder.appendQueryParameter("videoResolution", "3840x2160");
            builder.appendQueryParameter("maxVideoBitrate", "200000");
            builder.appendQueryParameter("session", sessionId);
            builder.appendQueryParameter("X-Plex-Platform", "Android");
            builder.appendQueryParameter("X-Plex-Product", "StreamPilot");
            builder.appendQueryParameter("X-Plex-Device", "Android TV");
            builder.appendQueryParameter("X-Plex-Client-Identifier", clientId);
            builder.appendQueryParameter("X-Plex-Session-Identifier", sessionId);
            builder.appendQueryParameter("X-Plex-Token", token);
            builder.appendQueryParameter("access_token", token);
            if (offsetMs > 0) {
                builder.appendQueryParameter("offset", String.valueOf(Math.max(0, offsetMs / 1000L)));
            }
            if (audioStreamId != null && !audioStreamId.isEmpty() && audioStreamId.matches("\\d+")) {
                builder.appendQueryParameter("audioStreamID", audioStreamId);
            }
            return builder.build().toString();
        } catch (Throwable ignored) {
            return null;
        }
    }

    static String fileUrlToHls(String url) {
        String next = url.replaceFirst("/file/(\\d+)", "/hls/$1/master.m3u8");
        if (next.equals(url)) return url;
        Uri uri = Uri.parse(next);
        Uri.Builder builder = uri.buildUpon().clearQuery();
        for (String key : uri.getQueryParameterNames()) {
            if ("hevc".equals(key) || "ac3".equals(key) || "client".equals(key)
                || "textSubs".equals(key) || "download".equals(key)) {
                continue;
            }
            String value = uri.getQueryParameter(key);
            if (value != null) builder.appendQueryParameter(key, value);
        }
        if (uri.getQueryParameter("quality") == null) {
            builder.appendQueryParameter("quality", "original");
        }
        return builder.build().toString();
    }

    static String withHlsQuality(String url, String qualityId) {
        Uri uri = Uri.parse(url);
        Uri.Builder builder = uri.buildUpon().clearQuery();
        boolean wroteQuality = false;
        for (String key : uri.getQueryParameterNames()) {
            if ("quality".equals(key)) {
                builder.appendQueryParameter("quality", qualityId);
                wroteQuality = true;
                continue;
            }
            String value = uri.getQueryParameter(key);
            if (value != null) builder.appendQueryParameter(key, value);
        }
        if (!wroteQuality) builder.appendQueryParameter("quality", qualityId);
        String next = builder.build().toString();
        if (qualityId.equals(uri.getQueryParameter("quality"))) return url;
        return next;
    }

    static String summarizeUrl(String url) {
        try {
            Uri uri = Uri.parse(url);
            return uri.getScheme() + "://" + uri.getHost() + uri.getPath();
        } catch (Throwable ignored) {
            return "(invalid)";
        }
    }

    static Map<String, String> parseHeaders(@Nullable String json) {
        Map<String, String> headers = new HashMap<>();
        if (json == null || json.trim().isEmpty()) return headers;
        try {
            JSONObject obj = new JSONObject(json);
            Iterator<String> keys = obj.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                String value = obj.optString(key, "");
                if (key != null && !key.isEmpty() && value != null && !value.isEmpty()) {
                    headers.put(key, value);
                }
            }
        } catch (Exception ignored) {
            /* keep empty */
        }
        return headers;
    }
}
