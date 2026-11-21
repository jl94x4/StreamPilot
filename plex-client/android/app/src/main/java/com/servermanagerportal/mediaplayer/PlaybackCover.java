package com.servermanagerportal.mediaplayer;

import android.app.Activity;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ProgressBar;

import java.lang.ref.WeakReference;

/**
 * Black "starting next episode" cover over the whole app window, natively drawn rails, text and buttons included.
 * The player closes for the next episode and reopens with it; the page's own black bridge sits under the native
 * layers, so without this the episode page showed for a moment in between. Up from the moment the player closes
 * for play-next; the page takes it down once the next player opens or the hand-off is cancelled (safety timeout).
 */
final class PlaybackCover {
    private static final long SAFETY_MS = 20_000L;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static WeakReference<Activity> host = new WeakReference<>(null);
    private static View cover;
    private static final Runnable SAFETY = PlaybackCover::hide;

    private PlaybackCover() {
    }

    /** The app window (MainActivity) the cover goes over. */
    static void setHost(Activity activity) {
        host = new WeakReference<>(activity);
    }

    static void show() {
        MAIN.post(() -> {
            Activity activity = host.get();
            if (activity == null || activity.isFinishing()) return;
            ViewGroup content = activity.findViewById(android.R.id.content);
            if (content == null) return;
            if (cover == null || cover.getParent() != content) {
                if (cover != null && cover.getParent() instanceof ViewGroup) ((ViewGroup) cover.getParent()).removeView(cover);
                FrameLayout frame = new FrameLayout(activity);
                frame.setBackgroundColor(Color.BLACK);
                frame.setClickable(true);
                frame.setFocusable(false);
                ProgressBar spin = new ProgressBar(activity);
                spin.setIndeterminate(true);
                int size = Math.round(40 * activity.getResources().getDisplayMetrics().density);
                frame.addView(spin, new FrameLayout.LayoutParams(size, size, Gravity.CENTER));
                content.addView(frame, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                cover = frame;
            }
            cover.setVisibility(View.VISIBLE);
            cover.bringToFront();
            MAIN.removeCallbacks(SAFETY);
            MAIN.postDelayed(SAFETY, SAFETY_MS);
        });
    }

    /** The next player opened: drop the cover once its window has had time to draw over the app. */
    static void hideSoon() {
        MAIN.postDelayed(PlaybackCover::hide, 700);
    }

    static void hide() {
        MAIN.post(() -> {
            MAIN.removeCallbacks(SAFETY);
            if (cover != null) cover.setVisibility(View.GONE);
        });
    }
}
