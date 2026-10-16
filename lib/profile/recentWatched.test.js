import assert from 'node:assert/strict';
import test from 'node:test';
import {
    filterRecentlyWatchedHistory,
    historyItemCountsAsRecentlyWatched,
    historyItemWatchPercent,
} from './recentWatched.js';

test('historyItemWatchPercent prefers Tautulli percent_complete (0–100)', () => {
    assert.equal(historyItemWatchPercent({ percentComplete: 82, viewOffset: 10, duration: 1000 }), 82);
    assert.equal(historyItemWatchPercent({ percentComplete: 0 }), 0);
    assert.equal(historyItemWatchPercent({ percentComplete: '100' }), 100);
});

test('historyItemWatchPercent treats (0, 1) as a fraction, not 1% as 100%', () => {
    assert.equal(historyItemWatchPercent({ percentComplete: 0.8 }), 80);
    assert.equal(historyItemWatchPercent({ percentComplete: 1 }), 1);
});

test('historyItemWatchPercent falls back to viewOffset / duration', () => {
    assert.ok(Math.abs(historyItemWatchPercent({ viewOffset: 800, duration: 1000 }) - 80) < 0.001);
    assert.ok(Math.abs(historyItemWatchPercent({ viewOffset: 800000, duration: 1000000 }) - 80) < 0.001);
});

test('historyItemWatchPercent falls back to playDuration / duration', () => {
    assert.ok(Math.abs(historyItemWatchPercent({ playDuration: 45 * 60, duration: 60 * 60 }) - 75) < 0.001);
    assert.ok(Math.abs(historyItemWatchPercent({ playDuration: 45 * 60 * 1000, duration: 60 * 60 * 1000 }) - 75) < 0.001);
});

test('movies and episodes need at least 75% watched', () => {
    assert.equal(historyItemCountsAsRecentlyWatched({ type: 'movie', percentComplete: 74 }), false);
    assert.equal(historyItemCountsAsRecentlyWatched({ type: 'movie', percentComplete: 75 }), true);
    assert.equal(historyItemCountsAsRecentlyWatched({ type: 'episode', percentComplete: 90 }), true);
    assert.equal(historyItemCountsAsRecentlyWatched({ type: 'episode', percentComplete: 20 }), false);
});

test('watchedStatus only counts when percent is unknown', () => {
    assert.equal(historyItemCountsAsRecentlyWatched({ type: 'movie', watchedStatus: 1 }), true);
    assert.equal(historyItemCountsAsRecentlyWatched({ type: 'movie', watchedStatus: 0 }), false);
    assert.equal(historyItemCountsAsRecentlyWatched({ type: 'movie', percentComplete: 10, watchedStatus: 1 }), false);
});

test('movies and episodes with no completion signal are excluded', () => {
    assert.equal(historyItemCountsAsRecentlyWatched({ type: 'movie', title: 'Heat' }), false);
    assert.equal(historyItemCountsAsRecentlyWatched({ type: 'episode', title: 'Pilot' }), false);
});

test('music tracks stay in recently watched without a percent', () => {
    assert.equal(historyItemCountsAsRecentlyWatched({ type: 'track', title: 'Song' }), true);
});

test('filterRecentlyWatchedHistory drops short plays then applies the limit', () => {
    const rows = [
        { type: 'episode', title: 'Preview', percentComplete: 8 },
        { type: 'movie', title: 'Finished', percentComplete: 92 },
        { type: 'episode', title: 'Almost', percentComplete: 76 },
        { type: 'episode', title: 'Nope', percentComplete: 40 },
        { type: 'track', title: 'Song' },
    ];
    assert.deepEqual(
        filterRecentlyWatchedHistory(rows, { limit: 2 }).map((row) => row.title),
        ['Finished', 'Almost'],
    );
});
