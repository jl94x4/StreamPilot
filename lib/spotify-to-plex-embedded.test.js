import assert from 'node:assert/strict';
import test from 'node:test';
import {
    applySpotifyToPlexBundledDefaults,
    buildSpotifyToPlexEmbeddedSupervisordConf,
    isUnexpectedSpotifyToPlexSupervisorExit,
    isUsingBundledSpotifyToPlexUrl,
    SPOTIFY_TO_PLEX_BUNDLED_URL,
} from './spotify-to-plex-embedded.js';

test('applySpotifyToPlexBundledDefaults is noop when Spotify Sync disabled', () => {
    const { config, changed } = applySpotifyToPlexBundledDefaults({
        spotifyToPlexEnabled: false,
        spotifyToPlexInternalUrl: 'http://spotify-to-plex:9030',
    });
    assert.equal(changed, false);
    assert.equal(config.spotifyToPlexInternalUrl, 'http://spotify-to-plex:9030');
});

test('isUsingBundledSpotifyToPlexUrl matches loopback URL', () => {
    assert.equal(isUsingBundledSpotifyToPlexUrl({
        spotifyToPlexInternalUrl: SPOTIFY_TO_PLEX_BUNDLED_URL,
    }), true);
    assert.equal(isUsingBundledSpotifyToPlexUrl({
        spotifyToPlexInternalUrl: 'http://spotify-to-plex:9030',
    }), false);
});

test('buildSpotifyToPlexEmbeddedSupervisordConf disables sync-scheduler in portal mode', () => {
    const sidecar = buildSpotifyToPlexEmbeddedSupervisordConf({
        stpRoot: '/app/spotify-to-plex',
        configDataDir: '/app/config/spotify-to-plex',
        scheduleMode: 'sidecar',
    });
    const portal = buildSpotifyToPlexEmbeddedSupervisordConf({
        stpRoot: '/app/spotify-to-plex',
        configDataDir: '/app/config/spotify-to-plex',
        scheduleMode: 'portal',
    });
    assert.match(sidecar, /\[program:sync-scheduler\][\s\S]*autostart=true/);
    assert.match(portal, /\[program:sync-scheduler\][\s\S]*autostart=false/);
    assert.match(sidecar, /HOSTNAME="0\.0\.0\.0"/);
    assert.match(sidecar, /HOST="0\.0\.0\.0"/);
    assert.match(sidecar, /SPOTIFY_TO_PLEX_CONFIG_DIR="\/app\/config\/spotify-to-plex"/);
    assert.match(sidecar, /STORAGE_DIR="\/app\/config\/spotify-to-plex"/);
});

test('planned SIGKILL during worker restart is not an unexpected crash', () => {
    assert.equal(isUnexpectedSpotifyToPlexSupervisorExit({
        stoppingIntentionally: true,
        signal: 'SIGKILL',
        code: null,
    }), false);
    assert.equal(isUnexpectedSpotifyToPlexSupervisorExit({
        planned: true,
        signal: 'SIGKILL',
        code: null,
    }), false);
    assert.equal(isUnexpectedSpotifyToPlexSupervisorExit({
        signal: 'SIGTERM',
        code: null,
    }), false);
    assert.equal(isUnexpectedSpotifyToPlexSupervisorExit({
        code: 0,
    }), false);
});

test('unexpected SIGKILL or crash exit still counts as a failure', () => {
    assert.equal(isUnexpectedSpotifyToPlexSupervisorExit({
        signal: 'SIGKILL',
        code: null,
    }), true);
    assert.equal(isUnexpectedSpotifyToPlexSupervisorExit({
        code: 1,
    }), true);
});
