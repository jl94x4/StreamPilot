package com.servermanagerportal.mediaplayer;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.DashPathEffect;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.util.AttributeSet;
import android.view.View;

import androidx.annotation.Nullable;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Draws "Who's on screen" over the paused video: a circle round each recognised face with the
 * actor and character under it, plus (test build) timings and the near-misses with their scores.
 */
public class FaceLabelsView extends View {
    private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint missRing = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint pill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint panel = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint nameText = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint roleText = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint infoText = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final float dp;

    @Nullable private WhoIsOnScreen.Result result;
    @Nullable private String status;
    /** Where the video picture sits in this view (letterbox / zoom aware). */
    private final RectF video = new RectF();

    public FaceLabelsView(Context context) {
        this(context, null);
    }

    public FaceLabelsView(Context context, @Nullable AttributeSet attrs) {
        super(context, attrs);
        dp = getResources().getDisplayMetrics().density;
        ring.setStyle(Paint.Style.STROKE);
        ring.setStrokeWidth(3 * dp);
        ring.setColor(0xFFFFFFFF);
        ring.setShadowLayer(6 * dp, 0, 0, 0x99000000);
        missRing.setStyle(Paint.Style.STROKE);
        missRing.setStrokeWidth(1.5f * dp);
        missRing.setColor(0x99FFFFFF);
        missRing.setPathEffect(new DashPathEffect(new float[] { 6 * dp, 5 * dp }, 0));
        pill.setColor(0xFFFFFFFF);
        panel.setColor(0xCC000000);
        nameText.setColor(0xFF0B0B0D);
        nameText.setTextSize(15 * dp);
        nameText.setTypeface(Typeface.DEFAULT_BOLD);
        roleText.setColor(0xB30B0B0D);
        roleText.setTextSize(12 * dp);
        infoText.setColor(0xFFFFFFFF);
        infoText.setTextSize(12 * dp);
        setWillNotDraw(false);
    }

    void showStatus(String message) {
        result = null;
        status = message;
        setVisibility(VISIBLE);
        invalidate();
    }

    void showResult(WhoIsOnScreen.Result next, RectF videoRect) {
        result = next;
        status = null;
        video.set(videoRect);
        setVisibility(VISIBLE);
        invalidate();
    }

    void clear() {
        result = null;
        status = null;
        setVisibility(GONE);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        List<String> lines = new ArrayList<>();
        if (status != null) lines.add(status);
        WhoIsOnScreen.Result shown = result;
        if (shown != null) {
            if (shown.error != null) {
                lines.add(shown.error);
            } else {
                int named = 0;
                for (WhoIsOnScreen.FoundFace face : shown.faces) {
                    drawFace(canvas, face);
                    if (face.person != null) named++;
                }
                lines.add(String.format(Locale.US, "Who's on screen (test): %d face%s, %d named",
                    shown.faces.size(), shown.faces.size() == 1 ? "" : "s", named));
                lines.add(String.format(Locale.US, "Frame %d ms · Faces %d ms · Cast %d ms (%d/%d photos usable) · Match %d ms",
                    shown.frameMs, shown.detectMs, shown.castMs, shown.castWithFaces, shown.castTotal, shown.matchMs));
            }
        }
        drawInfo(canvas, lines);
    }

    private void drawFace(Canvas canvas, WhoIsOnScreen.FoundFace face) {
        float left = video.left + face.box.left * video.width();
        float right = video.left + face.box.right * video.width();
        float top = video.top + face.box.top * video.height();
        float bottom = video.top + face.box.bottom * video.height();
        float cx = (left + right) / 2f;
        float cy = (top + bottom) / 2f;
        float radius = Math.max(right - left, bottom - top) * 0.62f;
        int pct = Math.round(face.score * 100);
        if (face.person == null) {
            canvas.drawCircle(cx, cy, radius, missRing);
            String guess = face.bestGuess == null ? "?" : "? " + face.bestGuess + " " + pct + "%";
            drawLabel(canvas, cx, cy + radius + 6 * dp, guess, null, 0.75f);
            return;
        }
        canvas.drawCircle(cx, cy, radius, ring);
        String role = face.person.role == null || face.person.role.isEmpty()
            ? pct + "%"
            : face.person.role + " · " + pct + "%";
        drawLabel(canvas, cx, cy + radius + 6 * dp, face.person.name, role, 1f);
    }

    private void drawLabel(Canvas canvas, float cx, float top, String name, @Nullable String role, float alpha) {
        float padX = 10 * dp;
        float padY = 6 * dp;
        float nameW = nameText.measureText(name);
        float roleW = role == null ? 0 : roleText.measureText(role);
        float width = Math.max(nameW, roleW) + padX * 2;
        float nameH = nameText.getTextSize();
        float roleH = role == null ? 0 : roleText.getTextSize() + 3 * dp;
        float height = nameH + roleH + padY * 2;
        float left = Math.max(4 * dp, Math.min(getWidth() - width - 4 * dp, cx - width / 2f));
        float y = Math.min(top, getHeight() - height - 4 * dp);
        int pillAlpha = Math.round(255 * alpha);
        pill.setAlpha(pillAlpha);
        canvas.drawRoundRect(new RectF(left, y, left + width, y + height), 10 * dp, 10 * dp, pill);
        canvas.drawText(name, left + (width - nameW) / 2f, y + padY + nameH * 0.85f, nameText);
        if (role != null) {
            canvas.drawText(role, left + (width - roleW) / 2f, y + padY + nameH + roleH * 0.85f, roleText);
        }
    }

    private void drawInfo(Canvas canvas, List<String> lines) {
        if (lines.isEmpty()) return;
        float pad = 10 * dp;
        float lineH = infoText.getTextSize() + 5 * dp;
        float width = 0;
        for (String line : lines) width = Math.max(width, infoText.measureText(line));
        float left = 24 * dp;
        float top = 24 * dp;
        canvas.drawRoundRect(new RectF(left, top, left + width + pad * 2, top + lineH * lines.size() + pad * 2 - 5 * dp),
            10 * dp, 10 * dp, panel);
        for (int i = 0; i < lines.size(); i++) {
            canvas.drawText(lines.get(i), left + pad, top + pad + infoText.getTextSize() + i * lineH, infoText);
        }
    }
}
