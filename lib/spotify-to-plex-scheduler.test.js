import assert from 'node:assert/strict';
import test from 'node:test';
import {
    computeNextSpotifySyncRun,
    isSpotifySyncScheduleActive,
    normalizeSpotifySyncIntervalHours,
} from './spotify-to-plex-scheduler.js';

test('normalizeSpotifySyncIntervalHours clamps to 1–168 hours', () => {
    assert.equal(normalizeSpotifySyncIntervalHours(0), 1);
    assert.equal(normalizeSpotifySyncIntervalHours(6), 6);
    assert.equal(normalizeSpotifySyncIntervalHours(999), 168);
});

test('isSpotifySyncScheduleActive requires feature and portal schedule mode', () => {
    assert.equal(isSpotifySyncScheduleActive({
        spotifyToPlexEnabled: true,
        mediaServerType: 'plex',
        spotifyToPlexInternalUrl: 'http://spotify-to-plex:9030',
        spotifyToPlexScheduleMode: 'portal',
    }), true);
    assert.equal(isSpotifySyncScheduleActive({
        spotifyToPlexEnabled: true,
        mediaServerType: 'plex',
        spotifyToPlexInternalUrl: 'http://spotify-to-plex:9030',
        spotifyToPlexScheduleMode: 'sidecar',
    }), false);
});

test('computeNextSpotifySyncRun adds interval after last run', () => {
    const last = '2026-01-01T00:00:00.000Z';
    const next = computeNextSpotifySyncRun({
        spotifyToPlexScheduledSyncIntervalHours: 6,
        spotifyToPlexScheduledSyncLastRunAt: last,
    });
    assert.equal(next, '2026-01-01T06:00:00.000Z');
});
