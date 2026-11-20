package com.servermanagerportal.mediaplayer;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Keeps the process alive while offline downloads run. Without a foreground service Android
 * freezes or kills the app soon after it leaves the screen, which cut every download short.
 * The downloads themselves still run in {@link MediaDownloadsPlugin}.
 */
public class MediaDownloadService extends Service {
    private static final String CHANNEL_ID = "smp_downloads";
    private static final int NOTIFICATION_ID = 4210;
    private static final String EXTRA_TEXT = "text";
    private PowerManager.WakeLock wakeLock;

    /** Start, or refresh the notification text of, the service. */
    public static void show(Context context, String text) {
        Intent intent = new Intent(context, MediaDownloadService.class);
        intent.putExtra(EXTRA_TEXT, text == null ? "" : text);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent);
            else context.startService(intent);
        } catch (Throwable ignored) {
            /* app not allowed to start a service right now */
        }
    }

    public static void hide(Context context) {
        try {
            context.stopService(new Intent(context, MediaDownloadService.class));
        } catch (Throwable ignored) { /* ignore */ }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String text = intent == null ? "" : intent.getStringExtra(EXTRA_TEXT);
        Notification notification = buildNotification(text == null || text.isEmpty() ? "Downloading" : text);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Throwable t) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (wakeLock == null) {
            try {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "smp:downloads");
                    wakeLock.setReferenceCounted(false);
                    wakeLock.acquire(6 * 60 * 60 * 1000L);
                }
            } catch (Throwable ignored) { /* ignore */ }
        }
        return START_NOT_STICKY;
    }

    private Notification buildNotification(String text) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Downloads", NotificationManager.IMPORTANCE_LOW);
            channel.setShowBadge(false);
            nm.createNotificationChannel(channel);
        }
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pending = PendingIntent.getActivity(this, 0, open, piFlags);
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        return builder
            .setContentTitle("StreamPilot downloads")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(pending)
            .build();
    }

    @Override
    public void onDestroy() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Throwable ignored) { /* ignore */ }
        wakeLock = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
