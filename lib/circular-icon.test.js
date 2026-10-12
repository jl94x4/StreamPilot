import assert from 'node:assert/strict';
import test from 'node:test';
import { PNG } from 'pngjs';
import {
    makeCircularPwaIconPng,
    makeHomeScreenIconPng,
    makeNotificationBadgeMaskPng,
    makeNotificationBadgePng,
} from './circular-icon.js';

const solidPng = (width, height, r, g, b, a = 255) => {
    const png = new PNG({ width, height });
    for (let i = 0; i < width * height; i += 1) {
        png.data[i * 4] = r;
        png.data[i * 4 + 1] = g;
        png.data[i * 4 + 2] = b;
        png.data[i * 4 + 3] = a;
    }
    return PNG.sync.write(png);
};

const pixelAt = (png, x, y) => {
    const i = (y * png.width + x) * 4;
    return { r: png.data[i], g: png.data[i + 1], b: png.data[i + 2], a: png.data[i + 3] };
};

test('favicon badgeScale 1 fills the canvas and leaves transparent corners', () => {
    const out = makeCircularPwaIconPng(solidPng(80, 80, 220, 40, 40), 64, { badgeScale: 1 });
    const png = PNG.sync.read(out);
    assert.equal(png.width, 64);
    assert.equal(png.height, 64);
    assert.equal(pixelAt(png, 0, 0).a, 0);
    assert.equal(pixelAt(png, 63, 0).a, 0);
    assert.equal(pixelAt(png, 0, 63).a, 0);
    assert.equal(pixelAt(png, 63, 63).a, 0);
    const center = pixelAt(png, 32, 32);
    assert.ok(center.a > 200);
    assert.ok(center.r > 180);
});

test('default PWA badgeScale pads the circle inside the canvas', () => {
    const out = makeCircularPwaIconPng(solidPng(80, 80, 220, 40, 40), 64);
    const png = PNG.sync.read(out);
    assert.equal(pixelAt(png, 2, 32).a, 0);
    const center = pixelAt(png, 32, 32);
    assert.ok(center.a > 200);
});

test('home-screen icon is fully opaque for wide wordmarks', () => {
    const wide = solidPng(240, 48, 230, 90, 40);
    const out = makeHomeScreenIconPng(wide, 64, { wideLogoScale: 0.9 });
    const png = PNG.sync.read(out);
    assert.equal(png.width, 64);
    assert.equal(png.height, 64);
    assert.equal(pixelAt(png, 0, 0).a, 255);
    assert.equal(pixelAt(png, 63, 63).a, 255);
    const center = pixelAt(png, 32, 32);
    assert.ok(center.a === 255);
    assert.ok(center.r > 180);
});

test('home-screen icon keeps opaque plate for square marks', () => {
    const out = makeHomeScreenIconPng(solidPng(80, 80, 40, 160, 220), 64);
    const png = PNG.sync.read(out);
    assert.equal(pixelAt(png, 0, 0).a, 255);
    assert.ok(pixelAt(png, 32, 32).a === 255);
});

test('notification badge uses source alpha as a white silhouette', () => {
    const png = new PNG({ width: 32, height: 32 });
    for (let i = 0; i < 32 * 32; i += 1) {
        png.data[i * 4] = 0;
        png.data[i * 4 + 1] = 90;
        png.data[i * 4 + 2] = 200;
        png.data[i * 4 + 3] = 0;
    }
    for (let y = 8; y < 24; y += 1) {
        for (let x = 8; x < 24; x += 1) {
            const i = (y * 32 + x) * 4;
            png.data[i] = 0;
            png.data[i + 1] = 90;
            png.data[i + 2] = 200;
            png.data[i + 3] = 255;
        }
    }
    const out = PNG.sync.read(makeNotificationBadgePng(PNG.sync.write(png), 64));
    assert.equal(pixelAt(out, 0, 0).a, 0);
    const center = pixelAt(out, 32, 32);
    assert.equal(center.r, 255);
    assert.equal(center.g, 255);
    assert.equal(center.b, 255);
    assert.equal(center.a, 255);
});

test('uploaded badge with transparency uses its own alpha, zoomed to fill', () => {
    const png = new PNG({ width: 32, height: 32 });
    for (let y = 12; y < 20; y += 1) {
        for (let x = 8; x < 24; x += 1) {
            const i = (y * 32 + x) * 4;
            png.data[i] = 30;
            png.data[i + 1] = 200;
            png.data[i + 2] = 90;
            png.data[i + 3] = 255;
        }
    }
    const out = PNG.sync.read(makeNotificationBadgeMaskPng(PNG.sync.write(png), 64));
    assert.equal(pixelAt(out, 0, 0).a, 0);
    const center = pixelAt(out, 32, 32);
    assert.equal(center.r, 255);
    assert.equal(center.a, 255);
    // 16x8 mark should be zoomed to span nearly the full canvas width.
    assert.ok(pixelAt(out, 6, 32).a > 200, 'mark should be zoomed to fill');
    assert.equal(pixelAt(out, 32, 4).a, 0, 'vertical margins stay transparent');
});

test('uploaded flat black-on-white badge inverts to a white mask', () => {
    const png = new PNG({ width: 32, height: 32 });
    for (let i = 0; i < 32 * 32; i += 1) {
        png.data[i * 4] = 250;
        png.data[i * 4 + 1] = 250;
        png.data[i * 4 + 2] = 250;
        png.data[i * 4 + 3] = 255;
    }
    for (let y = 10; y < 22; y += 1) {
        for (let x = 10; x < 22; x += 1) {
            const i = (y * 32 + x) * 4;
            png.data[i] = 10;
            png.data[i + 1] = 10;
            png.data[i + 2] = 10;
        }
    }
    const out = PNG.sync.read(makeNotificationBadgeMaskPng(PNG.sync.write(png), 64));
    const center = pixelAt(out, 32, 32);
    assert.equal(center.r, 255);
    assert.ok(center.a > 200, 'dark mark should become the white mask');
    assert.ok(pixelAt(out, 1, 1).a < 40, 'light background should be transparent');
});

test('notification badge extracts the light mark from a dark plate and zooms it to fill', () => {
    const png = new PNG({ width: 64, height: 64 });
    const cx = 31.5;
    const cy = 31.5;
    for (let y = 0; y < 64; y += 1) {
        for (let x = 0; x < 64; x += 1) {
            const i = (y * 64 + x) * 4;
            const dx = x - cx;
            const dy = y - cy;
            const insideCircle = Math.sqrt((dx * dx) + (dy * dy)) <= 28;
            const insideMark = x >= 18 && x <= 45 && y >= 22 && y <= 41;
            png.data[i] = insideMark ? 245 : (insideCircle ? 12 : 0);
            png.data[i + 1] = insideMark ? 245 : (insideCircle ? 16 : 0);
            png.data[i + 2] = insideMark ? 250 : (insideCircle ? 22 : 0);
            png.data[i + 3] = insideCircle ? 255 : 0;
        }
    }
    const out = PNG.sync.read(makeNotificationBadgePng(PNG.sync.write(png), 64));
    assert.equal(pixelAt(out, 2, 2).a, 0);
    // A solid-disc silhouette would be opaque near the circle top — the plate must be gone.
    assert.ok(pixelAt(out, 32, 4).a < 40, 'dark plate should be punched out');
    const mark = pixelAt(out, 32, 32);
    assert.equal(mark.r, 255);
    assert.equal(mark.g, 255);
    assert.equal(mark.b, 255);
    assert.ok(mark.a > 200, 'light mark should be the status-bar mask');
    // The mark was a small central rectangle; it should be zoomed to span the canvas width.
    assert.ok(pixelAt(out, 6, 32).a > 200, 'mark should be zoomed to fill the badge');
    assert.ok(pixelAt(out, 57, 32).a > 200, 'mark should be zoomed to fill the badge');
});
