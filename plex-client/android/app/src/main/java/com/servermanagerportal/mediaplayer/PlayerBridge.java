package com.servermanagerportal.mediaplayer;

import androidx.annotation.Nullable;

import com.getcapacitor.JSObject;

import java.lang.ref.WeakReference;

/**
 * Singleton glue between {@link NativeMediaPlayerPlugin} (JS) and {@link PlayerActivity}.
 */
public final class PlayerBridge {
    private static final PlayerBridge INSTANCE = new PlayerBridge();

    private WeakReference<NativeMediaPlayerPlugin> pluginRef = new WeakReference<>(null);
    private WeakReference<PlayerActivity> activityRef = new WeakReference<>(null);
    private volatile boolean playerForeground;

    private PlayerBridge() {}

    public static PlayerBridge get() {
        return INSTANCE;
    }

    public void attachPlugin(NativeMediaPlayerPlugin plugin) {
        pluginRef = new WeakReference<>(plugin);
    }

    public void detachPlugin(NativeMediaPlayerPlugin plugin) {
        NativeMediaPlayerPlugin current = pluginRef.get();
        if (current == plugin) {
            pluginRef = new WeakReference<>(null);
        }
    }

    public void attachActivity(PlayerActivity activity) {
        activityRef = new WeakReference<>(activity);
    }

    public void detachActivity(PlayerActivity activity) {
        PlayerActivity current = activityRef.get();
        if (current == activity) {
            activityRef = new WeakReference<>(null);
        }
    }

    @Nullable
    public PlayerActivity activity() {
        return activityRef.get();
    }

    public void setPlayerForeground(boolean foreground) {
        playerForeground = foreground;
        if (foreground) keepHostWebViewAlive();
    }

    public boolean isPlayerForeground() {
        return playerForeground;
    }

    public void keepHostWebViewAlive() {
        NativeMediaPlayerPlugin plugin = pluginRef.get();
        if (plugin != null) plugin.keepHostWebViewAlive();
    }

    public void emit(String event, JSObject data) {
        NativeMediaPlayerPlugin plugin = pluginRef.get();
        if (plugin != null) {
            plugin.notifyPlayerEvent(event, data);
        }
    }

    public boolean updateSrc(String url, @Nullable String headersJson, long offsetMs) {
        PlayerActivity activity = activityRef.get();
        if (activity == null) return false;
        activity.runOnUiThread(() -> activity.applyUpdateSrc(url, headersJson, offsetMs));
        return true;
    }

    public boolean seekTo(long positionMs) {
        PlayerActivity activity = activityRef.get();
        if (activity == null) return false;
        activity.runOnUiThread(() -> activity.applySeek(positionMs));
        return true;
    }

    public boolean setSpeed(float speed) {
        PlayerActivity activity = activityRef.get();
        if (activity == null) return false;
        activity.runOnUiThread(() -> activity.applySpeed(speed));
        return true;
    }
}
