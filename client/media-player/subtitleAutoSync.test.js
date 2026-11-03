import assert from 'node:assert/strict';
import test from 'node:test';
import {
    computeSubtitleSyncOffsetMs,
    parseSrtCueStartsMs,
    speechOnsetsFromBitmap,
} from './subtitleAutoSync.js';

test('parseSrtCueStartsMs reads cue starts', () => {
    const srt = `1
00:00:01,000 --> 00:00:02,000
Hello

2
00:00:05,500 --> 00:00:06,000
World
`;
    assert.deepEqual(parseSrtCueStartsMs(srt), [1000, 5500]);
});

test('computeSubtitleSyncOffsetMs finds a clear offset', () => {
    const cues = [1000, 5000, 9000, 13000, 17000];
    const speech = cues.map((n) => n + 800);
    assert.equal(computeSubtitleSyncOffsetMs(cues, speech), 800);
});

test('speechOnsetsFromBitmap detects rising edges', () => {
    const bytes = new Uint8Array(20);
    bytes[5] = 1;
    bytes[6] = 1;
    bytes[10] = 1;
    assert.deepEqual(speechOnsetsFromBitmap(bytes, 10), [50, 100]);
});
