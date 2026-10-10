package com.servermanagerportal.mediaplayer;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognizerIntent;
import android.util.DisplayMetrics;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.Nullable;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

import java.util.ArrayList;

public class MainActivity extends BridgeActivity {
    /** Desktop-like CSS layout width on leanback (phone density makes TV look zoomed-in). */
    private static final int TV_TARGET_CSS_WIDTH = 1920;
    private static final int VOICE_SEARCH_REQUEST = 9173;

    @Override
    protected void attachBaseContext(Context newBase) {
        super.attachBaseContext(applyTvDensity(newBase));
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeMediaPlayerPlugin.class);
        registerPlugin(DeviceUiPlugin.class);
        super.onCreate(savedInstanceState);
        applyWebViewDisplayFixes();
        scheduleAppVersion();
        scheduleTvMark();
        schedulePhoneMark();
        registerSpaBackHandler();
    }

    /**
     * SPA pushState does not update WebView.canGoBack(), so Capacitor finishes the
     * Activity on hardware Back. Route Back into the JS history handler first.
     */
    private void registerSpaBackHandler() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (bridge == null || bridge.getWebView() == null) {
                    finishIfUnhandled(this);
                    return;
                }
                bridge.getWebView().evaluateJavascript(
                    "(function(){try{return !!(window.__SMP_HANDLE_BACK__&&window.__SMP_HANDLE_BACK__());}catch(e){return false;}})()",
                    value -> {
                        boolean handled = value != null && value.contains("true");
                        if (!handled) {
                            finishIfUnhandled(this);
                        }
                    }
                );
            }
        });
    }

    private void finishIfUnhandled(OnBackPressedCallback callback) {
        runOnUiThread(() -> {
            callback.setEnabled(false);
            try {
                getOnBackPressedDispatcher().onBackPressed();
            } finally {
                callback.setEnabled(true);
            }
        });
    }

    @Override
    public void onStart() {
        super.onStart();
        applyWebViewDisplayFixes();
        scheduleAppVersion();
        scheduleTvMark();
        schedulePhoneMark();
    }

    @Override
    public void onResume() {
        super.onResume();
        wakeWebViewAfterNativePlayer();
    }

    @Override
    public void onPause() {
        super.onPause();
        keepWebViewAliveForNativePlayer();
    }

    @Override
    public void onStop() {
        super.onStop();
        keepWebViewAliveForNativePlayer();
    }

    private void keepWebViewAliveForNativePlayer() {
        if (!PlayerBridge.get().isPlayerForeground()) return;
        resumeHostWebView();
    }

    private void wakeWebViewAfterNativePlayer() {
        resumeHostWebView();
        if (!PlayerBridge.get().consumePendingWebViewWake()) return;
        if (bridge == null || bridge.getWebView() == null) return;
        WebView webView = bridge.getWebView();
        webView.post(() -> {
            resumeHostWebView();
            try {
                webView.invalidate();
                webView.requestLayout();
                // ExoPlayer often leaves the WebView compositor black until it is remounted.
                if (webView.getVisibility() == View.VISIBLE) {
                    webView.setVisibility(View.INVISIBLE);
                    webView.post(() -> {
                        webView.setVisibility(View.VISIBLE);
                        webView.invalidate();
                        webView.requestFocus();
                    });
                }
            } catch (Throwable ignored) {
                /* older WebView */
            }
        });
    }

    private void resumeHostWebView() {
        if (bridge == null || bridge.getWebView() == null) return;
        try {
            WebView webView = bridge.getWebView();
            webView.onResume();
            webView.resumeTimers();
            webView.invalidate();
        } catch (Throwable ignored) {
            /* older WebView */
        }
    }

    /**
     * Force a density so widthPixels maps to ~1920 CSS px without CSS zoom/transform.
     * cssWidth ≈ widthPixels * 160 / densityDpi
     */
    private static Context applyTvDensity(Context base) {
        if (base == null || !isTelevisionDevice(base)) return base;
        try {
            DisplayMetrics metrics = base.getResources().getDisplayMetrics();
            int widthPx = Math.max(metrics.widthPixels, metrics.heightPixels);
            if (widthPx < 720) return base;
            int densityDpi = Math.round(160f * widthPx / (float) TV_TARGET_CSS_WIDTH);
            densityDpi = Math.max(120, Math.min(640, densityDpi));
            Configuration config = new Configuration(base.getResources().getConfiguration());
            if (config.densityDpi == densityDpi) return base;
            config.densityDpi = densityDpi;
            return base.createConfigurationContext(config);
        } catch (Throwable ignored) {
            return base;
        }
    }

    private void applyWebViewDisplayFixes() {
        if (bridge == null || bridge.getWebView() == null) {
            return;
        }
        WebView webView = bridge.getWebView();
        webView.setBackgroundColor(isTelevisionDevice(this) ? 0xFF07080C : 0xFF242830);
        WebSettings settings = webView.getSettings();
        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        settings.setCacheMode(debuggable ? WebSettings.LOAD_NO_CACHE : WebSettings.LOAD_DEFAULT);
        if (debuggable) {
            webView.clearCache(true);
        }
        settings.setTextZoom(100);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUseWideViewPort(true);
        // Overview mode lays out at ~980px then scales — phone media queries never match.
        settings.setLoadWithOverviewMode(false);
        settings.setNeedInitialFocus(true);

        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.setDescendantFocusability(ViewGroup.FOCUS_AFTER_DESCENDANTS);
        if (isTelevisionDevice(this)) {
            // System / WebView chrome scrollbars ignore CSS on many TV WebViews.
            webView.setVerticalScrollBarEnabled(false);
            webView.setHorizontalScrollBarEnabled(false);
            webView.setScrollBarStyle(View.SCROLLBARS_INSIDE_OVERLAY);
            webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                try {
                    webView.setVerticalScrollbarThumbDrawable(null);
                    webView.setHorizontalScrollbarThumbDrawable(null);
                } catch (Throwable ignored) {
                    /* older WebView */
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                webView.setDefaultFocusHighlightEnabled(false);
                webView.setFocusedByDefault(true);
                webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true);
            }
            webView.post(() -> webView.requestFocus(View.FOCUS_DOWN));
        }
    }

    private void scheduleAppVersion() {
        if (bridge == null || bridge.getWebView() == null) return;
        final String versionName = readInstalledVersionName();
        if (versionName.isEmpty()) return;
        bridge.getWebView().post(() -> {
            if (bridge == null || bridge.getWebView() == null) return;
            bridge.getWebView().evaluateJavascript(
                "(function(){"
                    + "window.__PLEX_CLIENT__=Object.assign({},window.__PLEX_CLIENT__||{},{appVersion:"
                    + jsString(versionName)
                    + "});"
                    + "})();",
                null
            );
        });
    }

    private String readInstalledVersionName() {
        try {
            PackageInfo info;
            if (Build.VERSION.SDK_INT >= 33) {
                info = getPackageManager().getPackageInfo(getPackageName(), PackageManager.PackageInfoFlags.of(0));
            } else {
                info = getPackageManager().getPackageInfo(getPackageName(), 0);
            }
            if (info == null || info.versionName == null) return "";
            return info.versionName.trim();
        } catch (Throwable ignored) {
            return "";
        }
    }

    private static String jsString(String value) {
        if (value == null) return "\"\"";
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\"";
    }

    private void scheduleTvMark() {
        if (!isTelevisionDevice(this)) return;
        if (bridge == null || bridge.getWebView() == null) return;
        // Mark leanback + apply CSS zoom density (WebView ignores Activity densityDpi).
        bridge.getWebView().postDelayed(() -> {
            if (bridge == null || bridge.getWebView() == null) return;
            bridge.getWebView().evaluateJavascript(
                "(function(){"
                    + "if(typeof window.__SMP_MARK_TV__==='function'){window.__SMP_MARK_TV__();return;}"
                    + "window.__PLEX_CLIENT__=Object.assign({},window.__PLEX_CLIENT__||{},{isTv:true});"
                    + "document.documentElement.dataset.tv='1';"
                    + "document.documentElement.dataset.plexClient='1';"
                    + "if(typeof window.__SMP_APPLY_TV_SCALE__==='function'){window.__SMP_APPLY_TV_SCALE__();}"
                    + "})();",
                null
            );
        }, 300);
        bridge.getWebView().postDelayed(() -> {
            if (bridge == null || bridge.getWebView() == null) return;
            bridge.getWebView().evaluateJavascript(
                "(function(){if(typeof window.__SMP_APPLY_TV_SCALE__==='function'){window.__SMP_APPLY_TV_SCALE__();}})();",
                null
            );
        }, 900);
    }

    private void schedulePhoneMark() {
        if (isTelevisionDevice(this)) return;
        if (bridge == null || bridge.getWebView() == null) return;
        bridge.getWebView().post(() -> {
            if (bridge == null || bridge.getWebView() == null) return;
            bridge.getWebView().evaluateJavascript(
                "(function(){"
                    + "if(document.documentElement.dataset.tv==='1')return;"
                    + "document.documentElement.dataset.phoneNative='1';"
                    + "document.documentElement.dataset.phone='1';"
                    + "if(typeof window.__SMP_MARK_PHONE__==='function'){window.__SMP_MARK_PHONE__();}"
                    + "})();",
                null
            );
        });
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        if (event.getAction() == KeyEvent.ACTION_DOWN
            && (code == KeyEvent.KEYCODE_SEARCH || code == KeyEvent.KEYCODE_VOICE_ASSIST)
            && !PlayerBridge.get().isPlayerForeground()) {
            startVoiceSearch();
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    private void startVoiceSearch() {
        evalJs(
            "(function(){try{"
                + "if(typeof window.__SMP_OPEN_SEARCH__==='function'){window.__SMP_OPEN_SEARCH__();}"
                + "else{window.dispatchEvent(new Event('smp-player-search-open'));}"
                + "}catch(e){}})();"
        );
        try {
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_PROMPT, getString(R.string.player_voice_search));
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            startActivityForResult(intent, VOICE_SEARCH_REQUEST);
        } catch (Throwable ignored) {
            /* Fire TV / Android TV without a recognizer still get a focused search field. */
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != VOICE_SEARCH_REQUEST || resultCode != Activity.RESULT_OK || data == null) return;
        ArrayList<String> results = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        if (results == null || results.isEmpty()) return;
        String query = results.get(0);
        if (query == null || query.trim().isEmpty()) return;
        evalJs(
            "(function(){try{window.dispatchEvent(new CustomEvent('smp-player-voice-result',{detail:"
                + JSONObject.quote(query.trim())
                + "}));}catch(e){}})();"
        );
    }

    private void evalJs(String script) {
        if (bridge == null || bridge.getWebView() == null) return;
        bridge.getWebView().post(() -> {
            if (bridge == null || bridge.getWebView() == null) return;
            bridge.getWebView().evaluateJavascript(script, null);
        });
    }

    private static boolean isTelevisionDevice(Context context) {
        if (context == null) return false;
        PackageManager pm = context.getPackageManager();
        if (pm != null && (
            pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
            || pm.hasSystemFeature("android.software.leanback")
        )) {
            return true;
        }
        int uiMode = context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_TYPE_MASK;
        return uiMode == Configuration.UI_MODE_TYPE_TELEVISION;
    }
}
