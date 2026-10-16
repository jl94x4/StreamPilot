import assert from 'node:assert/strict';
import { focalFromFaces, formatBackgroundPosition, formatTvDetailsBackdropPosition, formatWebDetailsBackdropPosition, posterSurfaceFromRgba } from './imageFocalPoint.ts';

const box = (x, y, width, height) => ({ boundingBox: { x, y, width, height } });

// Single face in upper third → focal sits near eye-line, not chin.
{
    const focal = focalFromFaces([box(400, 80, 120, 140)], 1000, 562);
    assert.ok(focal);
    assert.ok(focal.y < 28, `expected upper bias, got y=${focal.y}`);
    assert.ok(focal.y >= 6);
    assert.ok(focal.x > 40 && focal.x < 55);
}

// Tiny noise face should not dominate a large subject.
{
    const focal = focalFromFaces([
        box(100, 40, 180, 200),
        box(800, 400, 20, 24),
    ], 1000, 562);
    assert.ok(focal);
    assert.ok(focal.x < 40, `expected left subject, got x=${focal.x}`);
    assert.ok(focal.y < 30);
}

// Covered/lower secondary face should not pull crop down too far.
{
    const focal = focalFromFaces([
        box(200, 60, 150, 170),
        box(520, 90, 140, 160),
    ], 1000, 562);
    assert.ok(focal);
    assert.ok(focal.y <= 32);
}

assert.equal(formatBackgroundPosition({ x: 40, y: 18 }), '40% 18%');
assert.equal(formatBackgroundPosition(), '50% 22%');
assert.equal(formatTvDetailsBackdropPosition({ x: 30, y: 18 }), '52% 18%');
assert.equal(formatTvDetailsBackdropPosition({ x: 60, y: 22 }), '63% 22%');
assert.equal(formatWebDetailsBackdropPosition({ x: 30, y: 18 }), '46% 44%');
assert.equal(formatWebDetailsBackdropPosition({ x: 60, y: 22 }), '54% 45%');

{
    const fire = new Uint8Array(32);
    for (let i = 0; i < 8; i += 1) {
        fire[i * 4] = 210;
        fire[i * 4 + 1] = 70;
        fire[i * 4 + 2] = 28;
        fire[i * 4 + 3] = 255;
    }
    const rgb = posterSurfaceFromRgba(fire);
    assert.ok(rgb);
    const [r, g, b] = rgb.split(' ').map(Number);
    assert.ok(r > g && r > b, `expected red-dominant surface, got ${rgb}`);
    assert.ok(r >= 70, `expected vivid red, got ${rgb}`);
}

{
    const pale = new Uint8Array(16);
    pale.set([250, 248, 230, 255, 255, 255, 255, 255, 240, 236, 210, 255, 252, 250, 245, 255]);
    const rgb = posterSurfaceFromRgba(pale);
    if (rgb) {
        const [r, g, b] = rgb.split(' ').map(Number);
        const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        assert.ok(y <= 82, `pale poster must not stay bright, luma=${y}`);
    }
}

console.log('image focal point ok');
