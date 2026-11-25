package com.servermanagerportal.mediaplayer;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.util.AttributeSet;
import android.view.View;

/** Thin chapter dividers drawn over the seek bar's track. Never takes focus or touches. */
public class ChapterTicksView extends View {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private long[] starts = new long[0];
    private long durationMs;

    public ChapterTicksView(Context c, AttributeSet a) {
        super(c, a);
        paint.setColor(0xFF000000);
        paint.setAlpha(190);
        setFocusable(false);
        setClickable(false);
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
    }

    public void setChapters(long[] startsMs, long durationMs) {
        this.starts = startsMs == null ? new long[0] : startsMs;
        this.durationMs = durationMs;
        invalidate();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        if (durationMs <= 0 || starts.length == 0) return;
        float dp = getResources().getDisplayMetrics().density;
        float inset = 9f * dp;
        float w = getWidth() - inset * 2;
        float cy = getHeight() / 2f;
        float half = 3f * dp;
        paint.setStrokeWidth(Math.max(2f, 2f * dp));
        for (long s : starts) {
            if (s <= 0 || s >= durationMs) continue;
            float x = inset + w * ((float) s / durationMs);
            canvas.drawLine(x, cy - half, x, cy + half, paint);
        }
    }
}
