import assert from 'node:assert/strict';
import test from 'node:test';
import {
    applyShowEpisodeActivity,
    daysSinceTimestamp,
    parseTimestampMs,
    summarizeShowEpisodeActivity,
} from './episodeActivity.js';

const NOW = Date.parse('2026-09-10T12:00:00.000Z');

test('parseTimestampMs accepts unix seconds, ms, and ISO dates', () => {
    assert.equal(parseTimestampMs(1_704_067_200), 1_704_067_200_000);
    assert.equal(parseTimestampMs(1_704_067_200_000), 1_704_067_200_000);
    assert.equal(parseTimestampMs('2024-01-01'), Date.parse('2024-01-01'));
    assert.equal(parseTimestampMs(''), null);
    assert.equal(parseTimestampMs(null), null);
});

test('daysSinceTimestamp floors whole days', () => {
    assert.equal(daysSinceTimestamp('2026-09-09T12:00:00.000Z', NOW), 1);
    assert.equal(daysSinceTimestamp('2026-03-14T12:00:00.000Z', NOW), 180);
    assert.equal(daysSinceTimestamp(null, NOW), null);
});

test('summarizeShowEpisodeActivity uses latest aired episode and ignores future air dates', () => {
    const summary = summarizeShowEpisodeActivity([
        { originallyAvailableAt: '2023-01-01', addedAt: '2023-01-02T00:00:00.000Z' },
        { originallyAvailableAt: '2026-09-09', addedAt: '2026-09-09T18:00:00.000Z' },
        { originallyAvailableAt: '2026-12-01', addedAt: '2026-09-09T18:00:00.000Z' },
        { originallyAvailableAt: '', addedAt: null },
    ], { now: NOW });
    assert.equal(summary.daysSinceLastEpisodeAired, 1);
    assert.equal(summary.lastEpisodeAiredAt.startsWith('2026-09-09'), true);
    assert.equal(summary.daysSinceLastEpisodeAdded, 0);
});

test('show added years ago still reports a recent last episode', () => {
    const summary = summarizeShowEpisodeActivity([
        { originallyAvailableAt: '2026-09-09', addedAt: '2026-09-09T18:00:00.000Z' },
    ], { now: NOW });
    assert.equal(summary.daysSinceLastEpisodeAired, 1);
    const show = applyShowEpisodeActivity({ title: 'Average Joe', daysSinceAdded: 400 }, summary);
    assert.equal(show.daysSinceAdded, 400);
    assert.equal(show.daysSinceLastEpisodeAired, 1);
});
