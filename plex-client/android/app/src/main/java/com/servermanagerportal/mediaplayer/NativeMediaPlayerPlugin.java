package com.servermanagerportal.mediaplayer;

import android.content.Intent;
import android.webkit.WebView;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeMediaPlayer")
public class NativeMediaPlayerPlugin extends Plugin {

    @Override
    public void load() {
        super.load();
        PlayerBridge.get().attachPlugin(this);
    }

    @Override
    protected void handleOnDestroy() {
        PlayerBridge.get().detachPlugin(this);
        super.handleOnDestroy();
    }

    void notifyPlayerEvent(String event, JSObject data) {
        notifyListeners(event, data == null ? new JSObject() : data);
    }

    /** Keep timeline JS running while ExoPlayer is in front of the WebView. */
    void keepHostWebViewAlive() {
        try {
            if (getBridge() == null || getBridge().getWebView() == null) return;
            WebView webView = getBridge().getWebView();
            resumeWebView(webView);
            webView.post(() -> resumeWebView(webView));
        } catch (Throwable ignored) {
            /* plugin not attached */
        }
    }

    private static void resumeWebView(WebView webView) {
        if (webView == null) return;
        try {
            webView.onResume();
            webView.resumeTimers();
        } catch (Throwable ignored) {
            /* older WebView */
        }
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("value", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || url.trim().isEmpty()) {
            call.reject("url is required");
            return;
        }

        Intent intent = new Intent(getContext(), PlayerActivity.class);
        intent.putExtra(PlayerActivity.EXTRA_URL, url.trim());
        intent.putExtra(PlayerActivity.EXTRA_TITLE, call.getString("title", ""));
        intent.putExtra(PlayerActivity.EXTRA_LOGO_URL, call.getString("logoUrl", ""));
        Integer offset = call.getInt("offsetMs", 0);
        intent.putExtra(PlayerActivity.EXTRA_OFFSET_MS, offset == null ? 0 : offset);

        JSObject headers = call.getObject("headers");
        if (headers != null) {
            intent.putExtra(PlayerActivity.EXTRA_HEADERS_JSON, headers.toString());
        }

        String sessionJson = call.getString("sessionJson", "");
        if (sessionJson != null && !sessionJson.isEmpty()) {
            intent.putExtra(PlayerActivity.EXTRA_SESSION_JSON, sessionJson);
        }

        Double speed = call.getDouble("speed", 1.0);
        intent.putExtra(PlayerActivity.EXTRA_SPEED, speed == null ? 1f : speed.floatValue());

        Boolean autoplayNext = call.getBoolean("autoplayNext", true);
        intent.putExtra(PlayerActivity.EXTRA_AUTOPLAY_NEXT, autoplayNext == null || autoplayNext);

        Boolean autoSkipIntro = call.getBoolean("autoSkipIntro", false);
        intent.putExtra(PlayerActivity.EXTRA_AUTO_SKIP_INTRO, autoSkipIntro != null && autoSkipIntro);

        Boolean autoSkipCredits = call.getBoolean("autoSkipCredits", false);
        intent.putExtra(PlayerActivity.EXTRA_AUTO_SKIP_CREDITS, autoSkipCredits != null && autoSkipCredits);

        PlayerActivity existing = PlayerBridge.get().activity();
        if (existing != null && !existing.isFinishing()) {
            existing.runOnUiThread(existing::finishFromPlugin);
        }
        PlayerBridge.get().setPlayerForeground(true);
        startActivityForResult(call, intent, "onPlayerFinished");
    }

    @PluginMethod
    public void close(PluginCall call) {
        PlayerBridge.get().setPlayerForeground(false);
        PlayerActivity activity = PlayerBridge.get().activity();
        if (activity != null && !activity.isFinishing()) {
            activity.runOnUiThread(activity::finishFromPlugin);
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void updateSrc(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || url.trim().isEmpty()) {
            call.reject("url is required");
            return;
        }
        JSObject headers = call.getObject("headers");
        String headersJson = headers != null ? headers.toString() : null;
        Integer offset = call.getInt("offsetMs", 0);
        long offsetMs = offset == null ? 0L : offset.longValue();
        boolean ok = PlayerBridge.get().updateSrc(url.trim(), headersJson, offsetMs);

        String sessionJson = call.getString("sessionJson", null);
        PlayerActivity activity = PlayerBridge.get().activity();
        if (activity != null && sessionJson != null && !sessionJson.isEmpty()) {
            activity.runOnUiThread(() -> activity.applySessionJson(sessionJson));
        }

        JSObject ret = new JSObject();
        ret.put("ok", ok);
        if (!ok) {
            call.reject("No active player");
            return;
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void updateSession(PluginCall call) {
        String sessionJson = call.getString("sessionJson", "");
        PlayerActivity activity = PlayerBridge.get().activity();
        if (activity == null || sessionJson == null || sessionJson.trim().isEmpty()) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            call.resolve(ret);
            return;
        }
        activity.runOnUiThread(() -> activity.applySessionJson(sessionJson));
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void seek(PluginCall call) {
        Integer position = call.getInt("positionMs", 0);
        long positionMs = position == null ? 0L : position.longValue();
        boolean ok = PlayerBridge.get().seekTo(positionMs);
        JSObject ret = new JSObject();
        ret.put("ok", ok);
        call.resolve(ret);
    }

    @PluginMethod
    public void setSpeed(PluginCall call) {
        Double speed = call.getDouble("speed", 1.0);
        float value = speed == null ? 1f : speed.floatValue();
        boolean ok = PlayerBridge.get().setSpeed(value);
        JSObject ret = new JSObject();
        ret.put("ok", ok);
        call.resolve(ret);
    }

    @PluginMethod
    public void setPaused(PluginCall call) {
        Boolean paused = call.getBoolean("paused", true);
        boolean shouldPause = paused == null || paused;
        PlayerActivity activity = PlayerBridge.get().activity();
        if (activity == null || activity.isFinishing()) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            call.resolve(ret);
            return;
        }
        activity.runOnUiThread(() -> activity.applyPlayPause(!shouldPause));
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void skipNext(PluginCall call) {
        PlayerActivity activity = PlayerBridge.get().activity();
        if (activity == null || activity.isFinishing()) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            call.resolve(ret);
            return;
        }
        activity.runOnUiThread(activity::skipNextFromPlugin);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void show(PluginCall call) {
        PlayerActivity activity = PlayerBridge.get().activity();
        if (activity == null || activity.isFinishing()) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            call.resolve(ret);
            return;
        }
        activity.runOnUiThread(activity::markRestored);
        try {
            android.app.Activity host = getActivity();
            Intent intent = new Intent(host != null ? host : getContext(), PlayerActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            if (host != null) host.startActivity(intent);
            else getContext().startActivity(intent);
        } catch (Throwable ignored) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            call.resolve(ret);
            return;
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @ActivityCallback
    private void onPlayerFinished(PluginCall call, ActivityResult result) {
        PlayerBridge.get().setPlayerForeground(false);
        if (call == null) {
            return;
        }
        Intent data = result.getData();
        boolean ended = data != null && data.getBooleanExtra(PlayerActivity.EXTRA_ENDED, false);
        boolean error = data != null && data.getBooleanExtra(PlayerActivity.EXTRA_ERROR, false);
        boolean playNext = data != null && data.getBooleanExtra(PlayerActivity.EXTRA_PLAY_NEXT, false);
        long positionMs = data != null ? data.getLongExtra(PlayerActivity.EXTRA_POSITION_MS, 0L) : 0L;
        String nextRatingKey = data != null ? data.getStringExtra(PlayerActivity.EXTRA_NEXT_RATING_KEY) : null;

        JSObject ret = new JSObject();
        ret.put("ended", ended);
        ret.put("positionMs", positionMs);
        ret.put("error", error);
        ret.put("playNext", playNext);
        if (nextRatingKey != null && !nextRatingKey.isEmpty()) {
            ret.put("nextRatingKey", nextRatingKey);
        }
        call.resolve(ret);
    }
}
