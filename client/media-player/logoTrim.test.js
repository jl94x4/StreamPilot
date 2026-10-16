import assert from 'node:assert/strict';
import test from 'node:test';
import { findStudioMark, leftOpaqueInset, topOpaqueInset } from './logoTrim.ts';

const rgba = (width, height, paint) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const i = (y * width + x) * 4;
            const alpha = paint(x, y) ? 255 : 0;
            data[i] = alpha;
            data[i + 1] = alpha;
            data[i + 2] = alpha;
            data[i + 3] = alpha;
        }
    }
    return data;
};

test('leftOpaqueInset is 0 when the logo already starts at the left edge', () => {
    const data = rgba(20, 10, (x) => x < 8);
    assert.equal(leftOpaqueInset(data, 20, 10), 0);
});

test('leftOpaqueInset measures blank PNG columns as a fraction of width', () => {
    const data = rgba(20, 10, (x) => x >= 6);
    assert.ok(Math.abs(leftOpaqueInset(data, 20, 10) - 0.3) < 0.001);
});

test('leftOpaqueInset ignores a single stray pixel on the left', () => {
    const data = rgba(20, 10, (x, y) => x >= 6 || (x === 0 && y === 0));
    assert.ok(Math.abs(leftOpaqueInset(data, 20, 10) - 0.3) < 0.001);
});

test('leftOpaqueInset is 0 for an empty image', () => {
    const data = rgba(16, 8, () => false);
    assert.equal(leftOpaqueInset(data, 16, 8), 0);
});

test('topOpaqueInset measures blank PNG rows as a fraction of height', () => {
    const data = rgba(10, 20, (_x, y) => y >= 4);
    assert.ok(Math.abs(topOpaqueInset(data, 10, 20) - 0.2) < 0.001);
});

test('findStudioMark detects a narrow studio script above a wider title', () => {
    const data = rgba(80, 40, (x, y) => (
        (y >= 4 && y < 10 && x >= 30 && x < 50)
        || (y >= 18 && y < 34 && x >= 8 && x < 72)
    ));
    const mark = findStudioMark(data, 80, 40);
    assert.ok(mark);
    assert.ok(mark.markTop < 0.2);
    assert.ok(mark.markBottom < mark.titleTop);
    assert.ok(mark.markRight - mark.markLeft < 0.4);
});

test('findStudioMark ignores a two-line title of similar width', () => {
    const data = rgba(80, 40, (x, y) => (
        (y >= 4 && y < 14 && x >= 8 && x < 72)
        || (y >= 22 && y < 34 && x >= 10 && x < 70)
    ));
    assert.equal(findStudioMark(data, 80, 40), null);
});

test('findStudioMark ignores a title with no mark above it', () => {
    const data = rgba(40, 20, (x, y) => y >= 6 && y < 16 && x >= 4 && x < 36);
    assert.equal(findStudioMark(data, 40, 20), null);
});

test('leftOpaqueInset treats letterbox-black JPEG padding as blank', () => {
    const data = new Uint8ClampedArray(20 * 10 * 4);
    for (let y = 0; y < 10; y += 1) {
        for (let x = 0; x < 20; x += 1) {
            const i = (y * 20 + x) * 4;
            const ink = x >= 5;
            data[i] = ink ? 240 : 4;
            data[i + 1] = ink ? 240 : 4;
            data[i + 2] = ink ? 240 : 4;
            data[i + 3] = 255;
        }
    }
    assert.ok(Math.abs(leftOpaqueInset(data, 20, 10) - 0.25) < 0.001);
});
