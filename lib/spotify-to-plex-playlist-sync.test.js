import assert from 'node:assert/strict';
import test from 'node:test';
import {
    applyPlexPlaylistArtwork,
    chunkItems,
    collectPlaylistArtworkUrls,
    createPlaylistArtworkApplier,
    isAllowedPlaylistArtworkUrl,
    isSpotifySyncTimeoutError,
    matchPlexTrackBatch,
    matchedPlexItems,
    mergeSearchResults,
    normalizeSpotifyTracks,
    pickUploadedPosterKey,
    runPool,
    savedPlaylistIds,
    summarizePlaylistSyncResults,
    syncSpotifyPlaylistToPlex,
    syncSpotifyPlaylistsToPlex,
    toPlexSearchItems,
} from './spotify-to-plex-playlist-sync.js';

test('normalizeSpotifyTracks reads tracks or items arrays', () => {
    assert.deepEqual(normalizeSpotifyTracks({
        tracks: [{ id: 't1', title: 'Song', artists: ['A'], album: 'LP', album_id: 'al1' }],
    }), [{
        id: 't1', title: 'Song', artists: ['A'], album: 'LP', album_id: 'al1',
    }]);
    assert.equal(normalizeSpotifyTracks({ items: [{ id: 't2', name: 'B', artist: 'X' }] })[0].title, 'B');
});

test('matchedPlexItems uses the first Plex hit', () => {
    assert.deepEqual(matchedPlexItems([
        { result: [{ id: '/library/1', source: 'server' }, { id: '/library/2' }] },
        { result: [] },
        { result: [{ id: '/library/3' }] },
    ]), [
        { key: '/library/1', source: 'server' },
        { key: '/library/3', source: undefined },
    ]);
});

test('matchedPlexItems keeps Spotify playlist order after concurrent matches', () => {
    assert.deepEqual(matchedPlexItems(
        [{ id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't1' }],
        [
            { id: 't3', result: [{ id: '/lib/3', source: 's' }] },
            { id: 't1', result: [{ id: '/lib/1', source: 's' }] },
            { id: 't2', result: [] },
        ],
    ), [
        { key: '/lib/1', source: 's' },
        { key: '/lib/3', source: 's' },
        { key: '/lib/1', source: 's' },
    ]);
});

test('mergeSearchResults prefers cached rows and drops duplicates', () => {
    const merged = mergeSearchResults(
        [{ id: 't1', result: [{ id: 'cached' }] }],
        [{ id: 't1', result: [{ id: 'fresh' }] }, { id: 't2', result: [{ id: 'new' }] }],
    );
    assert.equal(merged.length, 2);
    assert.equal(merged[0].result[0].id, 'cached');
});

test('chunkItems splits match batches', () => {
    assert.deepEqual(chunkItems([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test('isSpotifySyncTimeoutError detects abort and gateway timeouts', () => {
    assert.equal(isSpotifySyncTimeoutError(new Error('Spotify Sync worker timed out. Try a smaller playlist, or retry.')), true);
    const gateway = new Error('proxy');
    gateway.status = 504;
    assert.equal(isSpotifySyncTimeoutError(gateway), true);
    assert.equal(isSpotifySyncTimeoutError(new Error('Save this playlist first')), false);
});

test('runPool keeps a concurrency cap', async () => {
    let inflight = 0;
    let max = 0;
    await runPool([1, 2, 3, 4], 2, async () => {
        inflight += 1;
        max = Math.max(max, inflight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inflight -= 1;
    });
    assert.equal(max, 2);
});

test('matchPlexTrackBatch splits a timed-out batch instead of failing', async () => {
    const sizes = [];
    const result = await matchPlexTrackBatch({
        batch: [{ id: 'a' }, { id: 'b' }],
        type: 'spotify-playlist',
        fetchJson: async (opts) => {
            sizes.push(opts.body.items.length);
            if (opts.body.items.length > 1) {
                throw new Error('Spotify Sync worker timed out. Try a smaller playlist, or retry.');
            }
            return [{ id: opts.body.items[0].id, result: [{ id: `/lib/${opts.body.items[0].id}` }] }];
        },
    });
    assert.deepEqual(sizes, [2, 1, 1]);
    assert.equal(result.length, 2);
    assert.equal(result[0].result[0].id, '/lib/a');
});

test('matchPlexTrackBatch skips a single track that still times out', async () => {
    const result = await matchPlexTrackBatch({
        batch: [{ id: 'stuck' }],
        type: 'spotify-playlist',
        fetchJson: async () => {
            throw new Error('Spotify Sync worker timed out. Try a smaller playlist, or retry.');
        },
    });
    assert.deepEqual(result, [{ id: 'stuck', result: [] }]);
});

test('savedPlaylistIds skips plex-media placeholders', () => {
    assert.deepEqual(savedPlaylistIds([
        { id: 'pl1', type: 'spotify-playlist' },
        { id: 'media', type: 'plex-media' },
        { id: 'al1', type: 'spotify-album' },
    ]), ['pl1', 'al1']);
});

test('summarizePlaylistSyncResults reports mixed outcomes', () => {
    const summary = summarizePlaylistSyncResults([
        { ok: true, matched: 10, missing: 1, message: 'Created A' },
        { ok: false, error: 'not found' },
    ]);
    assert.equal(summary.ok, false);
    assert.match(summary.message, /failed/);
});

test('syncSpotifyPlaylistToPlex matches tracks and creates a Plex playlist', async () => {
    const calls = [];
    const artwork = [];
    const result = await syncSpotifyPlaylistToPlex({
        id: 'pl1',
        applyArtwork: async ({ ratingKey, imageUrls }) => {
            artwork.push({ ratingKey, imageUrls });
            return { ok: true, url: imageUrls[0] };
        },
        fetchJson: async (opts) => {
            calls.push(`${opts.method || 'GET'} ${opts.path}`);
            if (String(opts.path).startsWith('/api/saved-items')) {
                return [{ id: 'pl1', title: 'Gym', type: 'spotify-playlist', image: 'https://i.scdn.co/image/gym' }];
            }
            if (String(opts.path).includes('/api/spotify/items/')) {
                return { title: 'Gym', tracks: [
                    { id: 't1', title: 'One', artists: ['A'], album: 'LP', album_id: 'al' },
                    { id: 't2', title: 'Two', artists: ['B'], album: 'LP', album_id: 'al' },
                    { id: 't3', title: 'Three', artists: ['C'], album: 'LP', album_id: 'al' },
                ] };
            }
            if (opts.path === '/api/plex/cached') return [{ id: 't3', result: [{ id: '/lib/3', source: 's' }] }];
            if (opts.path === '/api/plex/tracks') {
                assert.equal(opts.body.fast, true);
                return [
                    { id: 't2', result: [{ id: '/lib/2', source: 's' }] },
                    { id: 't1', result: [{ id: '/lib/1', source: 's' }] },
                ];
            }
            if (String(opts.path).startsWith('/api/playlists/pl1')) {
                const err = new Error('missing');
                err.status = 404;
                throw err;
            }
            if (opts.path === '/api/playlists' && opts.method === 'POST') {
                assert.equal(opts.body.items.length, 3);
                assert.equal(opts.body.name, 'Gym');
                assert.equal(opts.body.thumb, 'https://i.scdn.co/image/gym');
                assert.deepEqual(opts.body.items.map((item) => item.key), ['/lib/1', '/lib/2', '/lib/3']);
                return { id: 'plex-9', link: 'http://plex/playlist' };
            }
            throw new Error(`unexpected ${opts.path}`);
        },
    });
    assert.equal(result.ok, true);
    assert.equal(result.created, true);
    assert.equal(result.matched, 3);
    assert.equal(result.plexId, 'plex-9');
    assert.equal(result.artworkApplied, true);
    assert.deepEqual(artwork[0], { ratingKey: 'plex-9', imageUrls: ['https://i.scdn.co/image/gym'] });
    assert.ok(calls.some((line) => line.startsWith('POST /api/playlists')));
});

test('syncSpotifyPlaylistToPlex updates an existing Plex playlist', async () => {
    const result = await syncSpotifyPlaylistToPlex({
        id: 'pl1',
        fetchJson: async (opts) => {
            if (String(opts.path).startsWith('/api/saved-items')) {
                return [{ id: 'pl1', title: 'Gym', type: 'spotify-playlist' }];
            }
            if (String(opts.path).includes('/api/spotify/items/')) {
                return { tracks: [{ id: 't1', title: 'One', artists: ['A'] }] };
            }
            if (opts.path === '/api/plex/cached') return [{ id: 't1', result: [{ id: '/lib/1' }] }];
            if (opts.path === '/api/plex/tracks') return [];
            if (opts.path === '/api/playlists/pl1' && !opts.method) return { id: 'plex-9', link: 'http://plex/old' };
            if (opts.path === '/api/playlists/pl1' && opts.method === 'PUT') return { id: 'plex-9', link: 'http://plex/new' };
            throw new Error(`unexpected ${opts.method} ${opts.path}`);
        },
    });
    assert.equal(result.created, false);
    assert.equal(result.link, 'http://plex/new');
    assert.match(result.message, /Updated/);
});

test('toPlexSearchItems keeps artist arrays for the worker matcher', () => {
    assert.deepEqual(toPlexSearchItems([{ id: 't', title: 'S', artists: ['A'], album: 'L', album_id: 'x' }]), [
        { id: 't', title: 'S', artists: ['A'], album: 'L', album_id: 'x' },
    ]);
});

test('syncSpotifyPlaylistsToPlex loads all saved ids when all is set', async () => {
    const summary = await syncSpotifyPlaylistsToPlex({
        all: true,
        fetchJson: async (opts) => {
            if (opts.path === '/api/saved-items') {
                return [{ id: 'pl1', type: 'spotify-playlist' }, { id: 'skip', type: 'plex-media' }];
            }
            if (String(opts.path).startsWith('/api/saved-items?id=')) {
                return [{ id: 'pl1', title: 'Gym', type: 'spotify-playlist' }];
            }
            if (String(opts.path).includes('/api/spotify/items/')) {
                return { tracks: [{ id: 't1', title: 'One', artists: ['A'] }] };
            }
            if (opts.path === '/api/plex/cached') return [{ id: 't1', result: [{ id: '/lib/1' }] }];
            if (opts.path === '/api/plex/tracks') return [];
            if (String(opts.path).startsWith('/api/playlists/pl1') && !opts.method) {
                const err = new Error('missing');
                err.status = 404;
                throw err;
            }
            if (opts.path === '/api/playlists' && opts.method === 'POST') return { id: 'plex-9' };
            throw new Error(`unexpected ${opts.method} ${opts.path}`);
        },
    });
    assert.equal(summary.ok, true);
    assert.equal(summary.results.length, 1);
    assert.equal(summary.results[0].created, true);
});

test('collectPlaylistArtworkUrls prefers public images and resolves worker paths', () => {
    assert.deepEqual(collectPlaylistArtworkUrls({
        savedItem: { image: '/api/plex/image?path=x' },
        spotifyData: { image: 'https://i.scdn.co/image/abc', images: [{ url: 'https://i.scdn.co/image/big' }] },
        workerBase: 'http://127.0.0.1:9030',
    }), [
        'http://127.0.0.1:9030/api/plex/image?path=x',
        'https://i.scdn.co/image/abc',
        'https://i.scdn.co/image/big',
    ]);
});

test('isAllowedPlaylistArtworkUrl blocks private hosts unless allowed', () => {
    assert.equal(isAllowedPlaylistArtworkUrl('https://i.scdn.co/image/abc'), true);
    assert.equal(isAllowedPlaylistArtworkUrl('http://127.0.0.1:9030/api/image'), false);
    assert.equal(isAllowedPlaylistArtworkUrl('http://127.0.0.1:9030/api/image', { allowPrivate: true }), true);
});

test('applyPlexPlaylistArtwork uploads the first image that downloads', async () => {
    const uploaded = [];
    const result = await applyPlexPlaylistArtwork({
        ratingKey: 'plex-9',
        imageUrls: ['https://bad.example/missing', 'https://i.scdn.co/image/ok'],
        fetchImage: async (url) => {
            if (url.includes('missing')) throw new Error('404');
            return { buffer: Buffer.from([1, 2, 3]), contentType: 'image/jpeg' };
        },
        uploadPoster: async (opts) => { uploaded.push(opts); },
    });
    assert.equal(result.ok, true);
    assert.equal(uploaded[0].ratingKey, 'plex-9');
    assert.equal(uploaded[0].buffer.length, 3);
});

test('pickUploadedPosterKey prefers an uploaded poster', () => {
    assert.equal(pickUploadedPosterKey({
        MediaContainer: {
            Metadata: [
                { ratingKey: 'metadata://default' },
                { ratingKey: 'upload://posters/abc', key: '/file?url=upload://posters/abc' },
            ],
        },
    }), 'upload://posters/abc');
    assert.match(pickUploadedPosterKey({
        raw: '<Photo ratingKey="upload://posters/xyz" key="/library/metadata/1/file?url=upload://posters/xyz" />',
    }), /upload:\/\/posters\/xyz/);
});

test('createPlaylistArtworkApplier posts image bytes to Plex', async () => {
    const calls = [];
    const apply = createPlaylistArtworkApplier({
        plexBaseUrl: 'http://plex:32400',
        plexToken: 'tok',
        plexHeaders: (token, extra) => ({ 'X-Plex-Token': token, ...extra }),
        fetchImpl: async (url, opts = {}) => {
            const method = String(opts.method || 'GET').toUpperCase();
            calls.push({ url: String(url), method, type: opts.headers?.['Content-Type'] });
            if (String(url).includes('i.scdn.co')) {
                return {
                    ok: true,
                    headers: { get: () => 'image/jpeg' },
                    arrayBuffer: async () => Uint8Array.from([9, 8, 7]).buffer,
                };
            }
            if (method === 'POST' && String(url).includes('/posters')) {
                return { ok: true, text: async () => '' };
            }
            if (method === 'GET' && String(url).includes('/posters')) {
                return {
                    ok: true,
                    text: async () => JSON.stringify({
                        MediaContainer: { Metadata: [{ ratingKey: 'upload://posters/abc' }] },
                    }),
                };
            }
            if (method === 'PUT' && /\/poster(\?|$)/.test(String(url))) {
                return { ok: true, text: async () => '' };
            }
            return { ok: false, status: 500, text: async () => 'unexpected' };
        },
    });
    const result = await apply({
        ratingKey: '99',
        imageUrls: ['https://i.scdn.co/image/abc'],
    });
    assert.equal(result.ok, true);
    assert.equal(calls[0].method, 'GET');
    assert.ok(calls.some((call) => call.method === 'POST' && call.url.includes('/library/metadata/99/posters')));
    assert.ok(calls.some((call) => call.method === 'GET' && call.url.includes('/library/metadata/99/posters')));
    assert.ok(calls.some((call) => call.method === 'PUT' && call.url.includes('/library/metadata/99/poster') && call.url.includes('upload')));
    assert.equal(calls.find((call) => call.method === 'POST').type, 'image/jpeg');
});
