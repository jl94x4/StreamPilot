import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applySpotifyToPlexDefaults,
    isLeakedSpotifyToPlexEmbedAssetPath,
    isSpotifyToPlexEnabled,
    parseSpotifyToPlexEmbedFromReferer,
    resolveSpotifyToPlexCallbackUrl,
    resolveSpotifyToPlexWorkerUpstreamPath,
    sanitizeSpotifyToPlexProxyBase,
} from './spotify-to-plex-proxy.js';

test('isSpotifyToPlexEnabled requires Plex and internal URL', () => {
    assert.equal(isSpotifyToPlexEnabled({
        spotifyToPlexEnabled: true,
        mediaServerType: 'plex',
        spotifyToPlexInternalUrl: 'http://127.0.0.1:9030',
    }), true);
    assert.equal(isSpotifyToPlexEnabled({
        spotifyToPlexEnabled: true,
        mediaServerType: 'jellyfin',
        spotifyToPlexInternalUrl: 'http://127.0.0.1:9030',
    }), false);
    assert.equal(isSpotifyToPlexEnabled({
        spotifyToPlexEnabled: true,
        mediaServerType: 'plex',
        spotifyToPlexInternalUrl: '',
    }), false);
});

test('applySpotifyToPlexDefaults fills docker hostname', () => {
    const { config, changed } = applySpotifyToPlexDefaults({ spotifyToPlexEnabled: true });
    assert.equal(changed, true);
    assert.equal(config.spotifyToPlexInternalUrl, 'http://spotify-to-plex:9030');
});

test('resolveSpotifyToPlexCallbackUrl uses public base and base path', () => {
    const url = resolveSpotifyToPlexCallbackUrl(
        { publicDomain: 'https://portal.example.com' },
        (path) => `/portal${path}`,
        (cfg) => cfg.publicDomain,
    );
    assert.equal(url, 'https://portal.example.com/portal/api/spotify-to-plex/callback');
});

test('parseSpotifyToPlexEmbedFromReferer extracts entity id', () => {
    const parsed = parseSpotifyToPlexEmbedFromReferer('https://portal.example.com/api/spotify-to-plex-embed/app/manage-users');
    assert.deepEqual(parsed, { entityId: 'app' });
});

test('isLeakedSpotifyToPlexEmbedAssetPath matches STP namespaces', () => {
    assert.equal(isLeakedSpotifyToPlexEmbedAssetPath('/_next/static/chunk.js'), true);
    assert.equal(isLeakedSpotifyToPlexEmbedAssetPath('/api/playlists'), true);
    assert.equal(isLeakedSpotifyToPlexEmbedAssetPath('/api/spotify/login'), true);
    assert.equal(isLeakedSpotifyToPlexEmbedAssetPath('/api/config/public'), false);
});

test('sanitizeSpotifyToPlexProxyBase strips trailing path', () => {
    assert.equal(
        sanitizeSpotifyToPlexProxyBase('http://127.0.0.1:9030/foo/', { allowPrivate: true }),
        'http://127.0.0.1:9030',
    );
});

test('resolveSpotifyToPlexWorkerUpstreamPath only allows STP API prefixes', () => {
    assert.equal(resolveSpotifyToPlexWorkerUpstreamPath('saved-items'), '/api/saved-items');
    assert.equal(resolveSpotifyToPlexWorkerUpstreamPath('spotify/users'), '/api/spotify/users');
    assert.equal(resolveSpotifyToPlexWorkerUpstreamPath('spotify/users/abc/items'), '/api/spotify/users/abc/items');
    assert.equal(resolveSpotifyToPlexWorkerUpstreamPath('../etc/passwd'), '');
    assert.equal(resolveSpotifyToPlexWorkerUpstreamPath('config/public'), '');
});
