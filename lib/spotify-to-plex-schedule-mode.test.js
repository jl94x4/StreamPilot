import assert from 'node:assert/strict';
import test from 'node:test';
import {
    isSpotifyPortalScheduleMode,
    normalizeSpotifyToPlexScheduleMode,
    resolveSpotifyToPlexScheduleMode,
} from './spotify-to-plex-schedule-mode.js';
import { buildSpotifyToPlexSupervisordConf } from './spotify-to-plex-supervisor.js';

test('normalizeSpotifyToPlexScheduleMode accepts sidecar and portal', () => {
    assert.equal(normalizeSpotifyToPlexScheduleMode('portal'), 'portal');
    assert.equal(normalizeSpotifyToPlexScheduleMode('sidecar'), 'sidecar');
    assert.equal(normalizeSpotifyToPlexScheduleMode('invalid'), 'sidecar');
});

test('resolveSpotifyToPlexScheduleMode falls back to legacy scheduledSyncEnabled', () => {
    assert.equal(resolveSpotifyToPlexScheduleMode({
        spotifyToPlexScheduledSyncEnabled: true,
    }), 'portal');
    assert.equal(resolveSpotifyToPlexScheduleMode({
        spotifyToPlexScheduleMode: 'sidecar',
        spotifyToPlexScheduledSyncEnabled: true,
    }), 'sidecar');
});

test('buildSpotifyToPlexSupervisordConf disables sync-scheduler in portal mode', () => {
    const sidecar = buildSpotifyToPlexSupervisordConf({ spotifyToPlexScheduleMode: 'sidecar' });
    const portal = buildSpotifyToPlexSupervisordConf({ spotifyToPlexScheduleMode: 'portal' });
    assert.match(sidecar, /\[program:sync-scheduler\][\s\S]*autostart=true/);
    assert.match(portal, /\[program:sync-scheduler\][\s\S]*autostart=false/);
});
