package com.servermanagerportal.mediaplayer;

import androidx.annotation.Nullable;
import androidx.media3.common.Format;
import androidx.media3.common.text.Cue;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.text.SubtitleDecoderFactory;
import androidx.media3.extractor.text.Subtitle;
import androidx.media3.extractor.text.SubtitleDecoder;
import androidx.media3.extractor.text.SubtitleDecoderException;
import androidx.media3.extractor.text.SubtitleInputBuffer;
import androidx.media3.extractor.text.SubtitleOutputBuffer;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Shifts decoded subtitle event times by a signed offset (µs).
 * Positive = show later; negative = show earlier (Plex-style delay / auto-sync).
 */
@UnstableApi
final class OffsettingSubtitleDecoderFactory implements SubtitleDecoderFactory {
    private final SubtitleDecoderFactory base = SubtitleDecoderFactory.DEFAULT;
    private volatile long offsetUs;

    void setOffsetUs(long offsetUs) {
        this.offsetUs = offsetUs;
    }

    long offsetUs() {
        return offsetUs;
    }

    @Override
    public boolean supportsFormat(Format format) {
        return base.supportsFormat(format);
    }

    @Override
    public SubtitleDecoder createDecoder(Format format) {
        return new OffsettingDecoder(base.createDecoder(format), this);
    }

    private static Subtitle snapshot(Subtitle src) {
        int count = Math.max(0, src.getEventTimeCount());
        long[] times = new long[count];
        List<List<Cue>> cuesPerEvent = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            long t = src.getEventTime(i);
            times[i] = t;
            List<Cue> cues = src.getCues(t);
            cuesPerEvent.add(cues == null ? Collections.emptyList() : new ArrayList<>(cues));
        }
        return new FixedSubtitle(times, cuesPerEvent);
    }

    private static final class FixedSubtitle implements Subtitle {
        private final long[] times;
        private final List<List<Cue>> cuesPerEvent;

        FixedSubtitle(long[] times, List<List<Cue>> cuesPerEvent) {
            this.times = times;
            this.cuesPerEvent = cuesPerEvent;
        }

        @Override
        public int getNextEventTimeIndex(long timeUs) {
            for (int i = 0; i < times.length; i++) {
                if (times[i] > timeUs) return i;
            }
            return -1;
        }

        @Override
        public int getEventTimeCount() {
            return times.length;
        }

        @Override
        public long getEventTime(int index) {
            return times[index];
        }

        @Override
        public List<Cue> getCues(long timeUs) {
            int idx = -1;
            for (int i = 0; i < times.length; i++) {
                if (times[i] <= timeUs) idx = i;
                else break;
            }
            if (idx < 0) return Collections.emptyList();
            return cuesPerEvent.get(idx);
        }
    }

    private static final class OffsettingSubtitle implements Subtitle {
        private final Subtitle inner;
        private final long offsetUs;

        OffsettingSubtitle(Subtitle inner, long offsetUs) {
            this.inner = inner;
            this.offsetUs = offsetUs;
        }

        @Override
        public int getNextEventTimeIndex(long timeUs) {
            return inner.getNextEventTimeIndex(timeUs - offsetUs);
        }

        @Override
        public int getEventTimeCount() {
            return inner.getEventTimeCount();
        }

        @Override
        public long getEventTime(int index) {
            return inner.getEventTime(index) + offsetUs;
        }

        @Override
        public List<Cue> getCues(long timeUs) {
            return inner.getCues(timeUs - offsetUs);
        }
    }

    private static final class OffsettingDecoder implements SubtitleDecoder {
        private final SubtitleDecoder inner;
        private final OffsettingSubtitleDecoderFactory factory;

        OffsettingDecoder(SubtitleDecoder inner, OffsettingSubtitleDecoderFactory factory) {
            this.inner = inner;
            this.factory = factory;
        }

        @Override
        public String getName() {
            return "smp-offset(" + inner.getName() + ")";
        }

        @Override
        public void setOutputStartTimeUs(long outputStartTimeUs) {
            inner.setOutputStartTimeUs(outputStartTimeUs);
        }

        @Override
        public void setPositionUs(long positionUs) {
            inner.setPositionUs(positionUs);
        }

        @Override
        @Nullable
        public SubtitleInputBuffer dequeueInputBuffer() throws SubtitleDecoderException {
            return inner.dequeueInputBuffer();
        }

        @Override
        public void queueInputBuffer(SubtitleInputBuffer inputBuffer) throws SubtitleDecoderException {
            inner.queueInputBuffer(inputBuffer);
        }

        @Override
        @Nullable
        public SubtitleOutputBuffer dequeueOutputBuffer() throws SubtitleDecoderException {
            SubtitleOutputBuffer out = inner.dequeueOutputBuffer();
            if (out == null) return null;
            long offset = factory.offsetUs();
            if (offset == 0 || out.isEndOfStream()) return out;
            try {
                Subtitle shifted = new OffsettingSubtitle(snapshot(out), offset);
                out.setContent(out.timeUs, shifted, /* subsampleOffsetUs= */ 0);
            } catch (Throwable ignored) {
                /* keep original cues if snapshot fails */
            }
            return out;
        }

        @Override
        public void flush() {
            inner.flush();
        }

        @Override
        public void release() {
            inner.release();
        }
    }
}
