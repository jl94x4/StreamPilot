package com.servermanagerportal.mediaplayer;

import android.view.Display;

import androidx.annotation.Nullable;

import java.util.ArrayList;
import java.util.List;

/**
 * Refresh-rate matching for Android 6–11 (Fire OS 7 included): pick the display mode
 * {@link PlayerActivity} asks the window for when a video starts.
 */
final class DisplayModeMatcher {
    private DisplayModeMatcher() {}

    /** The parts of {@link Display.Mode} the choice uses, so it can be tested off-device. */
    static final class Mode {
        final int id;
        final int width;
        final int height;
        final float refreshRate;

        Mode(int id, int width, int height, float refreshRate) {
            this.id = id;
            this.width = width;
            this.height = height;
            this.refreshRate = refreshRate;
        }

        static Mode of(Display.Mode mode) {
            return new Mode(mode.getModeId(), mode.getPhysicalWidth(), mode.getPhysicalHeight(), mode.getRefreshRate());
        }
    }

    static List<Mode> of(Display.Mode[] modes) {
        List<Mode> out = new ArrayList<>();
        if (modes == null) return out;
        for (Display.Mode mode : modes) out.add(Mode.of(mode));
        return out;
    }

    /**
     * Mode id at the current resolution whose refresh is a whole multiple of fps, or 0
     * (system default) when fps is unknown or nothing fits. The current mode wins when it
     * already fits; otherwise the closest rate, then the lowest multiple.
     */
    static int pickModeId(float fps, @Nullable Mode current, List<Mode> supported) {
        if (fps <= 0 || current == null || supported == null) return 0;
        Mode best = null;
        double bestError = Double.MAX_VALUE;
        int bestMultiple = Integer.MAX_VALUE;
        for (Mode mode : supported) {
            if (mode.width != current.width || mode.height != current.height) continue;
            float hz = mode.refreshRate;
            int multiple = Math.round(hz / fps);
            if (multiple < 1) continue;
            // 0.2% lets a 24.000Hz mode take 23.976 content when no 23.976 mode exists.
            double error = Math.abs(hz - multiple * fps) / (multiple * fps);
            if (error > 0.002) continue;
            if (mode.id == current.id) {
                best = mode;
                break;
            }
            if (error < bestError - 0.0001 || (Math.abs(error - bestError) <= 0.0001 && multiple < bestMultiple)) {
                best = mode;
                bestError = error;
                bestMultiple = multiple;
            }
        }
        return best != null ? best.id : 0;
    }
}
