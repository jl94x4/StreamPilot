package com.servermanagerportal.mediaplayer;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.util.AttributeSet;
import android.view.View;

import androidx.annotation.Nullable;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Draws "Who's on screen" over the paused video: a circle round each recognised face with the
 * actor and character under it. Left / Right pick one (white box, black text, like the rest of
 * the app; the others dim) and OK opens that person.
 */
public class FaceLabelsView extends View {
    /** A shot with nobody recognised says so briefly, then gets out of the way. */
    private static final long NOTHING_FOUND_MS = 2500L;

    private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint pill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint dimPill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint panel = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint nameText = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint roleText = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint dimNameText = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint dimRoleText = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint infoText = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final float dp;

    @Nullable private String status;
    /** Every face found, left to right, in the order Left / Right step through them (named or not). */
    private final List<WhoIsOnScreen.FoundFace> named = new ArrayList<>();
    private int selected = -1;
    /** Where the video picture sits in this view (letterbox / zoom aware). */
    private final RectF video = new RectF();
    private final Runnable hideRunnable = this::clear;

    public FaceLabelsView(Context context) {
        this(context, null);
    }

    public FaceLabelsView(Context context, @Nullable AttributeSet attrs) {
        super(context, attrs);
        dp = getResources().getDisplayMetrics().density;
        ring.setStyle(Paint.Style.STROKE);
        ring.setColor(accentColor(context));
        ring.setShadowLayer(6 * dp, 0, 0, 0x99000000);
        pill.setColor(0xFFFFFFFF);
        dimPill.setColor(0xCC0B0B0D);
        panel.setColor(0xCC000000);
        nameText.setColor(0xFFFFFFFF);
        nameText.setShadowLayer(5 * dp, 0, 0, 0xE6000000);
        nameText.setTextSize(15 * dp);
        nameText.setTypeface(Typeface.DEFAULT_BOLD);
        roleText.setColor(0xE6FFFFFF);
        roleText.setShadowLayer(5 * dp, 0, 0, 0xE6000000);
        roleText.setTextSize(12 * dp);
        dimNameText.set(nameText);
        dimNameText.setColor(0xB3FFFFFF);
        dimRoleText.set(roleText);
        dimRoleText.setColor(0x80FFFFFF);
        infoText.setColor(0xFFFFFFFF);
        infoText.setTextSize(13 * dp);
        setWillNotDraw(false);
    }

    private static int accentColor(Context context) {
        android.util.TypedValue value = new android.util.TypedValue();
        if (context.getTheme().resolveAttribute(R.attr.playerAccent, value, true)) return value.data;
        return 0xFFFFFFFF;
    }

    void showStatus(String message) {
        removeCallbacks(hideRunnable);
        named.clear();
        selected = -1;
        status = message;
        setVisibility(VISIBLE);
        invalidate();
    }

    void showResult(WhoIsOnScreen.Result next, RectF videoRect) {
        removeCallbacks(hideRunnable);
        named.clear();
        selected = -1;
        video.set(videoRect);
        if (next.faces != null) {
            // Unnamed faces stay up too, as "Who is this?", so they can be named and learned.
            named.addAll(next.faces);
        }
        Collections.sort(named, (a, b) -> Float.compare(a.box.centerX(), b.box.centerX()));
        if (named.isEmpty()) {
            status = next.error != null
                ? getContext().getString(R.string.player_faces_failed)
                : getContext().getString(R.string.player_faces_none);
            postDelayed(hideRunnable, NOTHING_FOUND_MS);
        } else {
            status = null;
        }
        setVisibility(VISIBLE);
        invalidate();
    }

    void clear() {
        removeCallbacks(hideRunnable);
        named.clear();
        selected = -1;
        status = null;
        setVisibility(GONE);
    }

    /** Faces up for picking (named and "Who is this?"). */
    int faceCount() {
        return getVisibility() == VISIBLE ? named.size() : 0;
    }

    /** Left / Right: the first press picks the nearest end, then it walks and stops at the ends. */
    void step(int direction) {
        if (named.isEmpty()) return;
        if (selected < 0) selected = direction > 0 ? 0 : named.size() - 1;
        else selected = Math.max(0, Math.min(named.size() - 1, selected + direction));
        invalidate();
    }

    @Nullable
    WhoIsOnScreen.Person selectedPerson() {
        WhoIsOnScreen.FoundFace face = selectedFace();
        return face == null ? null : face.person;
    }

    @Nullable
    WhoIsOnScreen.FoundFace selectedFace() {
        return selected >= 0 && selected < named.size() ? named.get(selected) : null;
    }

    /** A "Who is this?" answer: the label changes straight away. */
    void nameFace(WhoIsOnScreen.FoundFace face, WhoIsOnScreen.Person person) {
        face.person = person;
        face.bestGuess = null;
        invalidate();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        for (int i = 0; i < named.size(); i++) drawFace(canvas, named.get(i), i);
        if (status != null) drawStatus(canvas, status);
        else if (!named.isEmpty()) drawHint(canvas);
    }

    private void drawFace(Canvas canvas, WhoIsOnScreen.FoundFace face, int index) {
        float left = video.left + face.box.left * video.width();
        float right = video.left + face.box.right * video.width();
        float top = video.top + face.box.top * video.height();
        float bottom = video.top + face.box.bottom * video.height();
        float cx = (left + right) / 2f;
        float cy = (top + bottom) / 2f;
        float radius = Math.max(right - left, bottom - top) * 0.62f;
        // Nothing picked: every label white (the look that tested best). One picked: it stays
        // white with a heavier ring and the rest dim, so it reads as focused.
        boolean picked = selected == index;
        boolean dim = selected >= 0 && !picked;
        ring.setStrokeWidth((picked ? 5 : 3) * dp);
        if (face.person == null) {
            // Not recognised: a fainter ring and "Who is this?", dim unless it is the one picked.
            ring.setAlpha(picked ? 255 : 110);
            canvas.drawCircle(cx, cy, radius, ring);
            drawLabel(canvas, cx, cy + radius + 6 * dp,
                getContext().getString(R.string.player_faces_unknown), null, !picked);
            return;
        }
        ring.setAlpha(dim ? 140 : 255);
        canvas.drawCircle(cx, cy, radius, ring);
        String role = face.person.role == null || face.person.role.isEmpty() ? null : face.person.role;
        drawLabel(canvas, cx, cy + radius + 6 * dp, face.person.name, role, dim);
    }

    private void drawLabel(Canvas canvas, float cx, float top, String name, @Nullable String role, boolean dim) {
        Paint nameP = dim ? dimNameText : nameText;
        Paint roleP = dim ? dimRoleText : roleText;
        float padX = 10 * dp;
        float padY = 6 * dp;
        float nameW = nameP.measureText(name);
        float roleW = role == null ? 0 : roleP.measureText(role);
        float width = Math.max(nameW, roleW) + padX * 2;
        float nameH = nameP.getTextSize();
        float roleH = role == null ? 0 : roleP.getTextSize() + 3 * dp;
        float height = nameH + roleH + padY * 2;
        float left = Math.max(4 * dp, Math.min(getWidth() - width - 4 * dp, cx - width / 2f));
        float y = Math.min(top, getHeight() - height - 4 * dp);
        // No box behind the names: the accent ring marks the face, the text carries a shadow.
        canvas.drawText(name, left + (width - nameW) / 2f, y + padY + nameH * 0.85f, nameP);
        if (role != null) {
            canvas.drawText(role, left + (width - roleW) / 2f, y + padY + nameH + roleH * 0.85f, roleP);
        }
    }

    /** Small pill, top left: working, or nothing found. */
    private void drawStatus(Canvas canvas, String text) {
        float pad = 10 * dp;
        float width = infoText.measureText(text) + pad * 2;
        float height = infoText.getTextSize() + pad * 1.6f;
        float left = 24 * dp;
        float top = 24 * dp;
        canvas.drawRoundRect(new RectF(left, top, left + width, top + height), height / 2f, height / 2f, panel);
        canvas.drawText(text, left + pad, top + height / 2f + infoText.getTextSize() * 0.35f, infoText);
    }

    /** Bottom centre, once names are up: how to use them. */
    private void drawHint(Canvas canvas) {
        String text = getContext().getString(R.string.player_faces_hint);
        float pad = 12 * dp;
        float width = infoText.measureText(text) + pad * 2;
        float height = infoText.getTextSize() + pad * 1.4f;
        float left = (getWidth() - width) / 2f;
        float top = getHeight() - height - 28 * dp;
        canvas.drawRoundRect(new RectF(left, top, left + width, top + height), height / 2f, height / 2f, panel);
        canvas.drawText(text, left + pad, top + height / 2f + infoText.getTextSize() * 0.35f, infoText);
    }
}
