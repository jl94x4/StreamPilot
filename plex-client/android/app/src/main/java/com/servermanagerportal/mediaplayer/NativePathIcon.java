package com.servermanagerportal.mediaplayer;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.view.View;

import java.util.ArrayList;
import java.util.List;

/** A small vector mark drawn from SVG path data in a {@code vw x vh} view box (the page's Lucide / brand icons). */
final class NativePathIcon extends View {
    private static final class Op {
        Path path;
        int fill;
        int stroke;
        float strokeW;
    }

    private final float vw;
    private final float vh;
    private final List<Op> ops = new ArrayList<>();
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);

    NativePathIcon(Context context, float vw, float vh) {
        super(context);
        this.vw = vw;
        this.vh = vh;
    }

    /** Path data; fill / stroke colours are ARGB, 0 = none. */
    NativePathIcon path(String d, int fill, int stroke, float strokeW) {
        Op op = new Op();
        op.path = androidx.core.graphics.PathParser.createPathFromPathData(d);
        op.fill = fill;
        op.stroke = stroke;
        op.strokeW = strokeW;
        if (op.path != null) ops.add(op);
        invalidate();
        return this;
    }

    NativePathIcon circle(float cx, float cy, float r, int fill) {
        Op op = new Op();
        op.path = new Path();
        op.path.addCircle(cx, cy, r, Path.Direction.CW);
        op.fill = fill;
        ops.add(op);
        invalidate();
        return this;
    }

    @Override
    protected void onDraw(Canvas canvas) {
        float s = Math.min(getWidth() / vw, getHeight() / vh);
        canvas.save();
        canvas.translate((getWidth() - vw * s) / 2f, (getHeight() - vh * s) / 2f);
        canvas.scale(s, s);
        for (Op op : ops) {
            if (op.fill != 0) {
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(op.fill);
                canvas.drawPath(op.path, paint);
            }
            if (op.stroke != 0) {
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(op.strokeW);
                paint.setStrokeCap(Paint.Cap.ROUND);
                paint.setStrokeJoin(Paint.Join.ROUND);
                paint.setColor(op.stroke);
                canvas.drawPath(op.path, paint);
            }
        }
        canvas.restore();
    }
}
