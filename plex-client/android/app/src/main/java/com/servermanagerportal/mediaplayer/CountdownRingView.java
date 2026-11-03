package com.servermanagerportal.mediaplayer;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.util.AttributeSet;
import android.util.TypedValue;
import android.view.View;

import androidx.annotation.Nullable;

/**
 * Up Next countdown: a ring that empties in the accent colour, with the seconds left inside.
 * Two arcs and a number per tick, so it costs next to nothing on a TV.
 */
public class CountdownRingView extends View {

    private final Paint track = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint arc = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF bounds = new RectF();
    private float remaining = 1f;
    private int seconds;

    public CountdownRingView(Context context) {
        this(context, null);
    }

    public CountdownRingView(Context context, @Nullable AttributeSet attrs) {
        super(context, attrs);
        float stroke = dp(3.5f);
        track.setStyle(Paint.Style.STROKE);
        track.setStrokeWidth(stroke);
        track.setColor(0x40FFFFFF);
        arc.setStyle(Paint.Style.STROKE);
        arc.setStrokeWidth(stroke);
        arc.setStrokeCap(Paint.Cap.ROUND);
        arc.setColor(accentColor(context));
        fill.setColor(0xB3000000);
        text.setColor(Color.WHITE);
        text.setTextAlign(Paint.Align.CENTER);
        text.setTypeface(Typeface.DEFAULT_BOLD);
    }

    private static int accentColor(Context context) {
        TypedValue value = new TypedValue();
        if (context.getTheme().resolveAttribute(R.attr.playerAccent, value, true)) return value.data;
        return 0xFFF59E0B;
    }

    private float dp(float value) {
        return value * getResources().getDisplayMetrics().density;
    }

    /** @param fraction share of the countdown still to go, 1 → 0. */
    public void setCountdown(float fraction, int secondsLeft) {
        float next = Math.max(0f, Math.min(1f, fraction));
        if (next == remaining && secondsLeft == seconds) return;
        remaining = next;
        seconds = secondsLeft;
        invalidate();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        float inset = arc.getStrokeWidth() / 2f + dp(1);
        bounds.set(inset, inset, getWidth() - inset, getHeight() - inset);
        canvas.drawOval(bounds, fill);
        canvas.drawOval(bounds, track);
        canvas.drawArc(bounds, -90f, 360f * remaining, false, arc);
        text.setTextSize(getHeight() * 0.36f);
        float baseline = getHeight() / 2f - (text.descent() + text.ascent()) / 2f;
        canvas.drawText(String.valueOf(Math.max(0, seconds)), getWidth() / 2f, baseline, text);
    }
}
