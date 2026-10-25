import assert from 'node:assert/strict';
import test from 'node:test';
import {
    browseGridMove,
    nearestByMiddleY,
    pickSpatialIndex,
    rankRowsInDirection,
    SEARCH_PAD_LAST_ROW,
    searchFocusPlan,
    spanOverlap,
} from './tvSpatial.js';

const rect = (left, top, width, height) => ({
    left, top, width, height, right: left + width, bottom: top + height,
});

/** A rail of `count` posters 200x300 with a 20px gap, starting at x. */
const rail = (top, count, { x = 40, width = 200, height = 300, gap = 20 } = {}) => (
    Array.from({ length: count }, (_, i) => rect(x + i * (width + gap), top, width, height))
);

test('spanOverlap measures shared length and never goes negative', () => {
    assert.equal(spanOverlap(0, 10, 5, 20), 5);
    assert.equal(spanOverlap(0, 10, 10, 20), 0);
    assert.equal(spanOverlap(0, 10, 30, 40), 0);
});

test('left / right pick the nearest poster on the same row', () => {
    const row = rail(100, 5);
    assert.equal(pickSpatialIndex(row[2], row, 'right'), 3);
    assert.equal(pickSpatialIndex(row[2], row, 'left'), 1);
});

test('left at the start of a row and right at its end stop', () => {
    const row = rail(100, 3);
    assert.equal(pickSpatialIndex(row[0], row, 'left'), -1);
    assert.equal(pickSpatialIndex(row[2], row, 'right'), -1);
});

test('left / right ignore items on another row, even when closer', () => {
    const from = rect(260, 100, 200, 300);
    const below = rect(480, 500, 200, 300);
    const sameRowFar = rect(920, 100, 200, 300);
    assert.equal(pickSpatialIndex(from, [below, sameRowFar], 'right'), 1);
});

test('down from a poster lands on the poster under it in the next rail', () => {
    const top = rail(100, 5);
    const next = rail(460, 5);
    assert.equal(pickSpatialIndex(top[3], next, 'down'), 3);
    assert.equal(pickSpatialIndex(next[1], top, 'up'), 1);
});

test('down never skips a closer short row (Top Cast) for a lined-up later rail', () => {
    const from = rect(260, 100, 200, 300);
    // Cast circles sit left of the focused poster; the rail after them lines up exactly.
    const cast = rail(440, 2, { width: 120, height: 120, gap: 20 });
    const laterRail = rail(620, 5);
    const index = pickSpatialIndex(from, [...laterRail, ...cast], 'down');
    assert.ok(index >= laterRail.length, `picked later rail item ${index}`);
});

test('down into a row with nothing under the focused column enters at its left end', () => {
    const from = rect(1200, 100, 200, 300);
    const shortRow = rail(460, 3); // ends at x=680, well left of the focused poster
    assert.equal(pickSpatialIndex(from, shortRow, 'down'), 0);
});

test('down from the hero (wide button) prefers the overlapping poster', () => {
    const playButton = rect(80, 600, 260, 70);
    const firstRail = rail(760, 6);
    assert.equal(pickSpatialIndex(playButton, firstRail, 'down'), 0);
    const infoButton = rect(360, 600, 200, 70);
    assert.equal(pickSpatialIndex(infoButton, firstRail, 'down'), 1);
});

test('zero-size items are skipped and an empty source rect finds nothing', () => {
    const row = [rect(300, 100, 0, 0), rect(520, 100, 200, 300)];
    assert.equal(pickSpatialIndex(rect(40, 100, 200, 300), row, 'right'), 1);
    assert.equal(pickSpatialIndex(rect(0, 0, 0, 0), row, 'right'), -1);
});

test('rankRowsInDirection returns the closest rows first, at most three', () => {
    const from = rect(40, 400, 200, 300);
    const rows = [rect(0, 1500, 1920, 340), rect(0, 740, 1920, 340), rect(0, 50, 1920, 300), rect(0, 1100, 1920, 340), rect(0, 1900, 1920, 340)];
    assert.deepEqual(rankRowsInDirection(from, rows, 'down'), [1, 3, 0]);
    assert.deepEqual(rankRowsInDirection(from, rows, 'up'), [2]);
    assert.deepEqual(rankRowsInDirection(from, [rect(0, 800, 0, 0)], 'down'), []);
});

test('nearestByMiddleY picks the letter level with the poster', () => {
    const letters = Array.from({ length: 5 }, (_, i) => rect(1860, 100 + i * 40, 30, 30));
    assert.equal(nearestByMiddleY(195, letters), 2);
    assert.equal(nearestByMiddleY(0, letters), 0);
    assert.equal(nearestByMiddleY(100, []), -1);
});

test('browse grid: left / right move within a row, right edge goes to the letter bar', () => {
    assert.deepEqual(browseGridMove(7, 6, 'left'), { type: 'poster', index: 6, fallback: 'none' });
    assert.deepEqual(browseGridMove(6, 6, 'left'), { type: 'none' });
    assert.deepEqual(browseGridMove(7, 6, 'right'), { type: 'poster', index: 8, fallback: 'letter' });
    assert.deepEqual(browseGridMove(11, 6, 'right'), { type: 'letter' });
});

test('browse grid: up from the top row goes to filters, or loads earlier rows', () => {
    assert.deepEqual(browseGridMove(3, 6, 'up'), { type: 'above' });
    assert.deepEqual(browseGridMove(3, 6, 'up', 120), { type: 'before' });
    assert.deepEqual(browseGridMove(3, 6, 'up', NaN), { type: 'above' });
    assert.deepEqual(browseGridMove(9, 6, 'up'), { type: 'poster', index: 3, fallback: 'stay' });
});

test('browse grid: down into a part-filled or unmounted row loads it', () => {
    assert.deepEqual(browseGridMove(9, 6, 'down'), { type: 'poster', index: 15, fallback: 'load' });
});

test('search keys: left at column 0 stops, right moves along the row', () => {
    assert.deepEqual(searchFocusPlan({ row: 1, col: 0 }, 'left'), [{ kind: 'none' }]);
    assert.deepEqual(searchFocusPlan({ row: 1, col: 3 }, 'left'), [{ kind: 'key', row: 1, col: 2 }, { kind: 'none' }]);
    assert.deepEqual(searchFocusPlan({ row: 1, col: 4 }, 'right'), [
        { kind: 'key', row: 1, col: 5 },
        { kind: 'panel' },
        { kind: 'self' },
    ]);
});

test('search keys: right from the last column goes into the results panel', () => {
    assert.deepEqual(searchFocusPlan({ row: 2, col: 5 }, 'right'), [{ kind: 'panel' }, { kind: 'self' }]);
    assert.deepEqual(searchFocusPlan({ row: SEARCH_PAD_LAST_ROW, col: 2 }, 'right'), [{ kind: 'panel' }, { kind: 'self' }]);
});

test('search keys: up / down keep the column, and map onto the 3-key action row', () => {
    assert.deepEqual(searchFocusPlan({ row: 0, col: 2 }, 'up'), [{ kind: 'self' }]);
    assert.deepEqual(searchFocusPlan({ row: 2, col: 4 }, 'up'), [{ kind: 'key', row: 1, col: 4 }, { kind: 'self' }]);
    assert.deepEqual(searchFocusPlan({ row: 5, col: 0 }, 'down')[0], { kind: 'key', row: 6, col: 0 });
    assert.deepEqual(searchFocusPlan({ row: 5, col: 3 }, 'down')[0], { kind: 'key', row: 6, col: 1 });
    assert.deepEqual(searchFocusPlan({ row: 5, col: 5 }, 'down')[0], { kind: 'key', row: 6, col: 2 });
    assert.deepEqual(searchFocusPlan({ row: 6, col: 1 }, 'up')[0], { kind: 'key', row: 5, col: 2 });
    assert.deepEqual(searchFocusPlan({ row: 6, col: 2 }, 'down'), [{ kind: 'self' }]);
});
