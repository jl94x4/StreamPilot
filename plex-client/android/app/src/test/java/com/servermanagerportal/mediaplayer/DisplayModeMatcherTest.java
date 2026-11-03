package com.servermanagerportal.mediaplayer;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.util.Arrays;
import java.util.List;

public class DisplayModeMatcherTest {
    private static DisplayModeMatcher.Mode mode(int id, int w, int h, float hz) {
        return new DisplayModeMatcher.Mode(id, w, h, hz);
    }

    /** A typical 4K TV: 23.976 / 24 / 25 / 29.97 / 50 / 59.94 / 60 at 2160p, plus 1080p modes. */
    private static final List<DisplayModeMatcher.Mode> TV = Arrays.asList(
        mode(1, 3840, 2160, 60f),
        mode(2, 3840, 2160, 59.94f),
        mode(3, 3840, 2160, 50f),
        mode(4, 3840, 2160, 29.97f),
        mode(5, 3840, 2160, 25f),
        mode(6, 3840, 2160, 24f),
        mode(7, 3840, 2160, 23.976f),
        mode(8, 1920, 1080, 23.976f),
        mode(9, 1920, 1080, 60f)
    );

    @Test
    public void filmPicksTheExact23976ModeOver60Hz() {
        assertEquals(7, DisplayModeMatcher.pickModeId(23.976f, TV.get(0), TV));
    }

    @Test
    public void exact24ContentPicks24Hz() {
        assertEquals(6, DisplayModeMatcher.pickModeId(24f, TV.get(0), TV));
    }

    @Test
    public void pal25ContentPicks25HzBeforeTheHigher50HzMultiple() {
        assertEquals(5, DisplayModeMatcher.pickModeId(25f, TV.get(0), TV));
    }

    @Test
    public void keepsTheCurrentModeWhenItAlreadyFits() {
        // 50Hz is a whole multiple of 25fps, so no HDMI re-sync.
        assertEquals(3, DisplayModeMatcher.pickModeId(25f, TV.get(2), TV));
    }

    @Test
    public void staysAtTheCurrentResolution() {
        DisplayModeMatcher.Mode current1080 = TV.get(8);
        assertEquals(8, DisplayModeMatcher.pickModeId(23.976f, current1080, TV));
    }

    @Test
    public void uses24HzFor23976WhenThereIsNo23976Mode() {
        List<DisplayModeMatcher.Mode> modes = Arrays.asList(
            mode(1, 1920, 1080, 60f),
            mode(2, 1920, 1080, 24f)
        );
        assertEquals(2, DisplayModeMatcher.pickModeId(23.976f, modes.get(0), modes));
    }

    @Test
    public void defaultsToZeroWhenNothingFitsOrFpsIsUnknown() {
        List<DisplayModeMatcher.Mode> sixtyOnly = Arrays.asList(mode(1, 1920, 1080, 60f), mode(2, 1920, 1080, 59.94f));
        assertEquals(0, DisplayModeMatcher.pickModeId(23.976f, sixtyOnly.get(0), sixtyOnly));
        assertEquals(0, DisplayModeMatcher.pickModeId(0f, TV.get(0), TV));
        assertEquals(0, DisplayModeMatcher.pickModeId(24f, null, TV));
    }

    @Test
    public void ntsc2997KeepsACurrentRateWithinTheTolerance() {
        // 60Hz is within 0.2% of 2 x 29.97, so the current mode is kept (no re-sync).
        assertEquals(1, DisplayModeMatcher.pickModeId(29.97f, TV.get(0), TV));
        assertEquals(2, DisplayModeMatcher.pickModeId(29.97f, TV.get(1), TV));
        // From 50Hz (does not fit) it picks the exact 29.97 mode.
        assertEquals(4, DisplayModeMatcher.pickModeId(29.97f, TV.get(2), TV));
    }
}
