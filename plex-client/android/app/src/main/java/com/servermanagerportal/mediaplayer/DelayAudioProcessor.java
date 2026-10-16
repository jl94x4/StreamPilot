package com.servermanagerportal.mediaplayer;

import androidx.media3.common.C;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.audio.BaseAudioProcessor;
import androidx.media3.common.util.UnstableApi;

import java.nio.ByteBuffer;

/**
 * PCM delay line so lip-sync can lag audio behind video. Inactive while delay is 0
 * so bitstream passthrough is not forced through a PCM processor.
 */
@UnstableApi
final class DelayAudioProcessor extends BaseAudioProcessor {
    private int delayMs;
    private byte[] ring = new byte[0];
    private int ringSize;
    private int writePos;
    private int primed;

    void setDelayMs(int delayMs) {
        int next = Math.max(0, Math.min(1000, delayMs));
        if (this.delayMs == next) return;
        this.delayMs = next;
        flush();
    }

    int delayMs() {
        return delayMs;
    }

    @Override
    public AudioFormat onConfigure(AudioFormat inputAudioFormat) throws UnhandledAudioFormatException {
        if (delayMs <= 0) return AudioFormat.NOT_SET;
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT
            && inputAudioFormat.encoding != C.ENCODING_PCM_FLOAT) {
            throw new UnhandledAudioFormatException(inputAudioFormat);
        }
        int bytesPerSecond = inputAudioFormat.sampleRate * inputAudioFormat.bytesPerFrame;
        ringSize = Math.max(inputAudioFormat.bytesPerFrame, (int) ((bytesPerSecond * (long) delayMs) / 1000L));
        ring = new byte[ringSize];
        writePos = 0;
        primed = 0;
        return inputAudioFormat;
    }

    @Override
    public void queueInput(ByteBuffer inputBuffer) {
        int remaining = inputBuffer.remaining();
        if (remaining == 0) return;
        ByteBuffer out = replaceOutputBuffer(remaining);
        byte[] chunk = new byte[remaining];
        inputBuffer.get(chunk);
        if (ringSize <= 0) {
            out.put(chunk);
            out.flip();
            return;
        }
        for (int i = 0; i < remaining; i++) {
            byte incoming = chunk[i];
            byte outgoing = 0;
            if (primed >= ringSize) {
                outgoing = ring[writePos];
            } else {
                primed += 1;
            }
            ring[writePos] = incoming;
            writePos += 1;
            if (writePos >= ringSize) writePos = 0;
            out.put(outgoing);
        }
        out.flip();
    }

    @Override
    public void onFlush() {
        writePos = 0;
        primed = 0;
        if (ringSize > 0 && ring.length == ringSize) {
            java.util.Arrays.fill(ring, (byte) 0);
        }
    }

    @Override
    public void onReset() {
        ring = new byte[0];
        ringSize = 0;
        writePos = 0;
        primed = 0;
    }
}
