import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildSpotifyToPlexLogsView,
    detectSpotifyToPlexSyncFailure,
    summarizeSpotifyToPlexLogs,
} from './spotify-to-plex-api.js';

test('summarizeSpotifyToPlexLogs reads object type-log timestamps', () => {
    const summary = summarizeSpotifyToPlexLogs({
        sync_type_log: {
            playlists: { type: 'playlists', start: Date.parse('2026-01-01T01:00:00.000Z'), end: Date.parse('2026-01-01T02:00:00.000Z'), status: 'success' },
        },
        sync_log: { playlists: [] },
    });
    assert.equal(summary.lastSync.playlists, '2026-01-01T02:00:00.000Z');
    assert.equal(summary.playlistRunCount, 1);
});

test('summarizeSpotifyToPlexLogs extracts last sync and playlist run count', () => {
    const summary = summarizeSpotifyToPlexLogs({
        sync_type_log: { playlists: '2026-01-01T02:00:00.000Z' },
        sync_log: {
            playlists: [
                { success: true, finishedAt: '2026-01-01T01:00:00.000Z' },
                { success: true, finishedAt: '2026-01-02T02:00:00.000Z' },
            ],
        },
    });
    assert.equal(summary.playlistRunCount, 2);
    assert.equal(summary.lastSync.playlists, '2026-01-01T02:00:00.000Z');
});

test('detectSpotifyToPlexSyncFailure finds recent failed sync entries', () => {
    const now = Date.parse('2026-01-03T12:00:00.000Z');
    const failure = detectSpotifyToPlexSyncFailure({
        sync_log: {
            playlists: [{ success: false, error: 'timeout', finishedAt: '2026-01-03T02:00:00.000Z' }],
        },
    }, { now, maxAgeMs: 24 * 3600 * 1000 });
    assert.ok(failure);
    assert.equal(failure.failures[0].type, 'playlists');
    assert.match(failure.failures[0].message, /timeout/);
});

test('detectSpotifyToPlexSyncFailure ignores stale failures', () => {
    const now = Date.parse('2026-01-03T12:00:00.000Z');
    const failure = detectSpotifyToPlexSyncFailure({
        sync_log: {
            playlists: [{ success: false, error: 'old', finishedAt: '2025-01-01T02:00:00.000Z' }],
        },
    }, { now, maxAgeMs: 24 * 3600 * 1000 });
    assert.equal(failure, null);
});

test('buildSpotifyToPlexLogsView fills empty arrays from type-log and portal jobs', () => {
    const view = buildSpotifyToPlexLogsView({
        sync_type_log: { albums: '2026-01-04T03:00:00.000Z' },
        sync_log: { playlists: [], albums: [], users: [] },
    }, [{
        id: 'pls-1',
        status: 'running',
        message: 'Matching tracks in Plex (34/40 cached)…',
        done: 34,
        total: 40,
        startedAt: Date.parse('2026-01-04T04:00:00.000Z'),
        finishedAt: null,
        ok: null,
    }]);
    assert.equal(view.sync_log.playlists[0].message.includes('34/40'), true);
    assert.equal(view.sync_log.albums[0].finishedAt, '2026-01-04T03:00:00.000Z');
    assert.equal(view.sync_log.users.length, 0);
});

test('summarizeSpotifyToPlexLogs counts portal playlist jobs', () => {
    const summary = summarizeSpotifyToPlexLogs({
        sync_log: { playlists: [] },
    }, {
        playlistJobs: [
            { id: 'pls-1', status: 'success', message: 'Created Hits', finishedAt: Date.parse('2026-01-05T02:00:00.000Z'), ok: true },
        ],
    });
    assert.equal(summary.playlistRunCount, 1);
    assert.equal(summary.lastSync.playlists, '2026-01-05T02:00:00.000Z');
});
