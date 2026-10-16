import assert from 'node:assert/strict';
import test from 'node:test';
import { createSpotifyWebClient } from './spotify-to-plex-spotify-web.js';

test('createSpotifyWebClient fetches a token then artist albums', async () => {
    const calls = [];
    const client = createSpotifyWebClient({
        clientId: 'id',
        clientSecret: 'secret',
        now: () => 1_000,
        fetchImpl: async (url, opts) => {
            calls.push({ url: String(url), method: opts?.method || 'GET' });
            if (String(url).includes('/api/token')) {
                return {
                    ok: true,
                    json: async () => ({ access_token: 'tok', expires_in: 3600 }),
                };
            }
            if (String(url).includes('/albums')) {
                return {
                    ok: true,
                    json: async () => ({ items: [{ id: 'al1', name: 'LP' }], total: 1 }),
                };
            }
            return { ok: true, json: async () => ({ id: 'ar1', name: 'Band' }) };
        },
    });
    const artist = await client.getArtist('ar1');
    const albums = await client.getArtistAlbums('ar1');
    assert.equal(artist.name, 'Band');
    assert.equal(albums[0].id, 'al1');
    assert.equal(calls.filter((call) => call.url.includes('/api/token')).length, 1);
    assert.equal(calls[0].method, 'POST');
});

test('searchPlaylists queries the catalog and owner:spotify, skipping duplicates', async () => {
    const calls = [];
    const client = createSpotifyWebClient({
        clientId: 'id',
        clientSecret: 'secret',
        now: () => 1_000,
        fetchImpl: async (url) => {
            const href = String(url);
            calls.push(href);
            if (href.includes('/api/token')) {
                return {
                    ok: true,
                    json: async () => ({ access_token: 'tok', expires_in: 3600 }),
                };
            }
            if (href.includes('owner%3Aspotify') || href.includes('owner:spotify')) {
                return {
                    ok: true,
                    json: async () => ({
                        playlists: {
                            items: [
                                { id: '37i9dQZF1DX0XUs1Z1lmNH', name: 'Hot Hits USA' },
                                { id: 'shared', name: 'Shared' },
                            ],
                        },
                    }),
                };
            }
            return {
                ok: true,
                json: async () => ({
                    playlists: {
                        items: [
                            { id: 'userpl', name: 'Hot gym' },
                            { id: 'shared', name: 'Shared' },
                            null,
                        ],
                    },
                }),
            };
        },
    });
    const playlists = await client.searchPlaylists('Hot Hits');
    assert.deepEqual(playlists.map((item) => item.id), ['userpl', 'shared', '37i9dQZF1DX0XUs1Z1lmNH']);
    const searchUrls = calls.filter((url) => url.includes('/v1/search'));
    assert.equal(searchUrls.length, 2);
    assert.equal(searchUrls.every((url) => url.includes('limit=10')), true);
});

test('searchPlaylists clamps requested limit to Spotify search max of 10', async () => {
    const calls = [];
    const client = createSpotifyWebClient({
        clientId: 'id',
        clientSecret: 'secret',
        now: () => 1_000,
        fetchImpl: async (url) => {
            const href = String(url);
            calls.push(href);
            if (href.includes('/api/token')) {
                return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
            }
            return { ok: true, json: async () => ({ playlists: { items: [] } }) };
        },
    });
    await client.searchPlaylists('Bassline', { limit: 20 });
    const searchUrls = calls.filter((url) => url.includes('/v1/search'));
    assert.equal(searchUrls.length > 0, true);
    assert.equal(searchUrls.every((url) => url.includes('limit=10')), true);
    assert.equal(searchUrls.some((url) => url.includes('limit=20')), false);
});
