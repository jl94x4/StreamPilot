package com.servermanagerportal.mediaplayer;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.tvprovider.media.tv.TvContractCompat;
import androidx.tvprovider.media.tv.WatchNextProgram;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Android TV home screen "Continue Watching" (Watch Next) for titles played here.
 * Rows deep-link back to the item page via {@link #DEEP_LINK_SCHEME}. Fire OS has no
 * Watch Next provider, so this is a no-op there.
 */
final class WatchNext {
    private static final String TAG = "WatchNext";
    static final String DEEP_LINK_SCHEME = "smpplayer";
    static final String DEEP_LINK_HOST_ITEM = "item";
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();

    static final class Entry {
        String ratingKey = "";
        String serverId = "";
        boolean episode;
        String title = "";
        String episodeTitle = "";
        int seasonNumber;
        int episodeNumber;
        long positionMs;
        long durationMs;
        String artUrl = "";
        @Nullable Map<String, String> artHeaders;
    }

    private WatchNext() {}

    static boolean supported(Context context) {
        if (context == null || Build.VERSION.SDK_INT < 26) return false;
        PackageManager pm = context.getPackageManager();
        return pm != null && pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK);
    }

    static void publish(Context context, Entry entry) {
        if (!supported(context) || entry == null || entry.ratingKey.isEmpty()) return;
        final Context app = context.getApplicationContext();
        IO.execute(() -> {
            try {
                publishNow(app, entry);
            } catch (Throwable e) {
                Log.w(TAG, "Watch Next publish failed", e);
            }
        });
    }

    static void remove(Context context, String serverId, String ratingKey) {
        if (!supported(context) || ratingKey == null || ratingKey.isEmpty()) return;
        final Context app = context.getApplicationContext();
        final String providerId = providerId(serverId, ratingKey);
        IO.execute(() -> {
            try {
                WatchNextProgram existing = find(app.getContentResolver(), providerId);
                if (existing != null) {
                    app.getContentResolver().delete(TvContractCompat.buildWatchNextProgramUri(existing.getId()), null, null);
                }
                WatchNextArtProvider.delete(app, providerId);
            } catch (Throwable e) {
                Log.w(TAG, "Watch Next remove failed", e);
            }
        });
    }

    private static void publishNow(Context context, Entry entry) {
        ContentResolver resolver = context.getContentResolver();
        String providerId = providerId(entry.serverId, entry.ratingKey);
        WatchNextProgram existing = find(resolver, providerId);
        // The user removed it from the row. Do not push it back.
        if (existing != null && !existing.isBrowsable()) return;

        Uri art = WatchNextArtProvider.uriFor(context, providerId);
        if (!WatchNextArtProvider.exists(context, providerId) && !cacheArt(context, providerId, entry)) {
            art = null;
        }

        WatchNextProgram.Builder builder = new WatchNextProgram.Builder();
        builder.setWatchNextType(TvContractCompat.WatchNextPrograms.WATCH_NEXT_TYPE_CONTINUE)
            .setType(entry.episode
                ? TvContractCompat.PreviewProgramColumns.TYPE_TV_EPISODE
                : TvContractCompat.PreviewProgramColumns.TYPE_MOVIE)
            .setTitle(entry.title)
            .setLastEngagementTimeUtcMillis(System.currentTimeMillis())
            .setLastPlaybackPositionMillis(clampInt(entry.positionMs))
            .setDurationMillis(clampInt(entry.durationMs))
            .setInternalProviderId(providerId)
            .setIntentUri(deepLink(context, entry.ratingKey, entry.serverId));
        if (entry.episode) {
            if (!entry.episodeTitle.isEmpty()) builder.setEpisodeTitle(entry.episodeTitle);
            if (entry.seasonNumber > 0) builder.setSeasonNumber(entry.seasonNumber);
            if (entry.episodeNumber > 0) builder.setEpisodeNumber(entry.episodeNumber);
        }
        if (art != null) {
            builder.setPosterArtUri(art)
                .setPosterArtAspectRatio(TvContractCompat.PreviewProgramColumns.ASPECT_RATIO_16_9);
        }

        WatchNextProgram program = builder.build();
        if (existing != null) {
            resolver.update(TvContractCompat.buildWatchNextProgramUri(existing.getId()), program.toContentValues(), null, null);
        } else {
            resolver.insert(TvContractCompat.WatchNextPrograms.CONTENT_URI, program.toContentValues());
        }
    }

    @Nullable
    private static WatchNextProgram find(ContentResolver resolver, String providerId) {
        // The provider only returns this app's own rows.
        try (Cursor cursor = resolver.query(
            TvContractCompat.WatchNextPrograms.CONTENT_URI,
            WatchNextProgram.PROJECTION,
            null,
            null,
            null
        )) {
            while (cursor != null && cursor.moveToNext()) {
                WatchNextProgram program = WatchNextProgram.fromCursor(cursor);
                if (providerId.equals(program.getInternalProviderId())) return program;
            }
        }
        return null;
    }

    /** Download the still once with the session's auth, so no token lands in the launcher DB. */
    private static boolean cacheArt(Context context, String providerId, Entry entry) {
        if (entry.artUrl == null || !entry.artUrl.startsWith("http")) return false;
        HttpURLConnection conn = null;
        File target = WatchNextArtProvider.fileFor(context, providerId);
        File temp = new File(target.getParentFile(), target.getName() + ".tmp");
        try {
            conn = (HttpURLConnection) new URL(entry.artUrl).openConnection();
            conn.setConnectTimeout(8_000);
            conn.setReadTimeout(12_000);
            conn.setInstanceFollowRedirects(true);
            if (entry.artHeaders != null) {
                for (Map.Entry<String, String> header : entry.artHeaders.entrySet()) {
                    if (header.getKey() != null && header.getValue() != null) {
                        conn.setRequestProperty(header.getKey(), header.getValue());
                    }
                }
            }
            conn.setRequestProperty("Accept", "image/*,*/*;q=0.8");
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) return false;
            long written = 0;
            try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(temp)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) != -1) {
                    written += n;
                    if (written > 4_000_000) return false;
                    out.write(buf, 0, n);
                }
            }
            if (written < 32) return false;
            return temp.renameTo(target);
        } catch (Throwable e) {
            Log.w(TAG, "Watch Next art download failed", e);
            return false;
        } finally {
            if (conn != null) conn.disconnect();
            if (temp.exists()) temp.delete();
        }
    }

    static Uri deepLink(Context context, String ratingKey, String serverId) {
        Uri.Builder data = new Uri.Builder()
            .scheme(DEEP_LINK_SCHEME)
            .authority(DEEP_LINK_HOST_ITEM)
            .appendPath(ratingKey);
        if (serverId != null && !serverId.isEmpty()) data.appendQueryParameter("server", serverId);
        Intent intent = new Intent(Intent.ACTION_VIEW, data.build());
        intent.setClassName(context.getPackageName(), MainActivity.class.getName());
        return Uri.parse(intent.toUri(Intent.URI_INTENT_SCHEME));
    }

    private static String providerId(String serverId, String ratingKey) {
        String server = serverId == null ? "" : serverId;
        return server + ":" + ratingKey;
    }

    private static int clampInt(long value) {
        return (int) Math.max(0, Math.min(Integer.MAX_VALUE, value));
    }
}
