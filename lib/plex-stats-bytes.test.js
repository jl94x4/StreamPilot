import assert from 'node:assert/strict';
import test from 'node:test';
import { asArray, extractPlexItemBytes, nextPlexContainerStart } from './plex-stats-bytes.js';

test('asArray wraps single objects', () => {
    assert.deepEqual(asArray(null), []);
    assert.deepEqual(asArray([{ id: 1 }]), [{ id: 1 }]);
    assert.deepEqual(asArray({ id: 1, Part: { size: 10 } }), [{ id: 1, Part: { size: 10 } }]);
});

test('extractPlexItemBytes reads Part.size from array Media', () => {
    const bytes = extractPlexItemBytes({
        Media: [{ Part: [{ size: 100 }, { size: '50' }] }],
    });
    assert.equal(bytes, 150);
});

test('extractPlexItemBytes reads single Media/Part objects (music tracks)', () => {
    // Classic Plex JSON shape for a track: Media and Part are objects, not arrays.
    const bytes = extractPlexItemBytes({
        Media: {
            duration: 180000,
            bitrate: 320,
            Part: { size: '5432100', file: '/music/a.flac' },
        },
    });
    assert.equal(bytes, 5432100);
});

test('extractPlexItemBytes falls back to duration × bitrate', () => {
    const bytes = extractPlexItemBytes({
        duration: 10_000,
        Media: { duration: 10_000, bitrate: 128 },
    });
    // 10s * 128kbps = 10 * 16000 = 160000 bytes
    assert.equal(bytes, 160000);
});

test('nextPlexContainerStart steps by returned items, not requested page size', () => {
    assert.equal(nextPlexContainerStart(0, 1000), 1000);
    assert.equal(nextPlexContainerStart(1000, 500), 1500);
    assert.equal(nextPlexContainerStart(0, 0), null);
    assert.equal(nextPlexContainerStart(2000, 2000), 4000);
});

test('extractPlexItemBytes returns 0 for empty media', () => {
    assert.equal(extractPlexItemBytes({}), 0);
    assert.equal(extractPlexItemBytes({ Media: [] }), 0);
});
