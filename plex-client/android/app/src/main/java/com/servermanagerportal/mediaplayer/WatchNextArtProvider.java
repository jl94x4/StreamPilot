package com.servermanagerportal.mediaplayer;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Read-only images for Watch Next rows. The launcher loads poster_art_uri itself and
 * cannot send our auth, so stills are cached here and served without a token.
 */
public class WatchNextArtProvider extends ContentProvider {
    private static final String DIR = "watchnext";

    static String authority(Context context) {
        return context.getPackageName() + ".watchnextart";
    }

    static Uri uriFor(Context context, String providerId) {
        return new Uri.Builder()
            .scheme("content")
            .authority(authority(context))
            .appendPath(fileName(providerId))
            .build();
    }

    static File fileFor(Context context, String providerId) {
        File dir = new File(context.getFilesDir(), DIR);
        if (!dir.exists()) dir.mkdirs();
        return new File(dir, fileName(providerId));
    }

    static boolean exists(Context context, String providerId) {
        return fileFor(context, providerId).length() > 0;
    }

    static void delete(Context context, String providerId) {
        File file = fileFor(context, providerId);
        if (file.exists()) file.delete();
    }

    private static String fileName(String providerId) {
        return String.valueOf(providerId).replaceAll("[^A-Za-z0-9_-]", "_") + ".jpg";
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Nullable
    @Override
    public ParcelFileDescriptor openFile(@NonNull Uri uri, @NonNull String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Read-only");
        Context context = getContext();
        String name = uri.getLastPathSegment();
        // Only flat names this class wrote. No paths, so nothing outside the folder is reachable.
        if (context == null || name == null || !name.matches("[A-Za-z0-9_-]+\\.jpg")) {
            throw new FileNotFoundException(String.valueOf(uri));
        }
        File file = new File(new File(context.getFilesDir(), DIR), name);
        if (!file.isFile()) throw new FileNotFoundException(String.valueOf(uri));
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Nullable
    @Override
    public String getType(@NonNull Uri uri) {
        return "image/jpeg";
    }

    @Nullable
    @Override
    public Cursor query(@NonNull Uri uri, @Nullable String[] projection, @Nullable String selection,
                        @Nullable String[] selectionArgs, @Nullable String sortOrder) {
        return null;
    }

    @Nullable
    @Override
    public Uri insert(@NonNull Uri uri, @Nullable ContentValues values) {
        return null;
    }

    @Override
    public int delete(@NonNull Uri uri, @Nullable String selection, @Nullable String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(@NonNull Uri uri, @Nullable ContentValues values, @Nullable String selection,
                      @Nullable String[] selectionArgs) {
        return 0;
    }
}
