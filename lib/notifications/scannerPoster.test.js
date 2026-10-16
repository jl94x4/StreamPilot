import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveScannerNotifyPoster } from './scannerPoster.js';

test('resolveScannerNotifyPoster uses the Sonarr webhook poster without TMDB', async () => {
    let called = false;
    const meta = await resolveScannerNotifyPoster({
        artwork: {
            mediaType: 'tv',
            tmdbId: 2316,
            posterUrl: 'https://artworks.thetvdb.com/banners/posters/73244-1.jpg',
        },
        tv: async () => {
            called = true;
            return { posterPath: '/should-not-run.jpg' };
        },
    });
    assert.equal(called, false);
    assert.equal(meta.posterUrl, 'https://artworks.thetvdb.com/banners/posters/73244-1.jpg');
    assert.equal(meta.tmdbId, 2316);
    assert.equal(meta.mediaType, 'tv');
});

test('resolveScannerNotifyPoster falls back to TMDB when Sonarr only sent MediaCover', async () => {
    const meta = await resolveScannerNotifyPoster({
        artwork: { mediaType: 'tv', tmdbId: 2316 },
        tv: async (id) => {
            assert.equal(id, 2316);
            return { posterPath: '/office.jpg' };
        },
    });
    assert.equal(meta.posterPath, '/office.jpg');
    assert.equal(meta.posterUrl, 'https://image.tmdb.org/t/p/w185/office.jpg');
    assert.equal(meta.tmdbId, 2316);
});

test('resolveScannerNotifyPoster skips TMDB for movies without an id', async () => {
    let called = false;
    const meta = await resolveScannerNotifyPoster({
        artwork: { mediaType: 'movie', posterUrl: '/MediaCover/1/poster.jpg' },
        movie: async () => {
            called = true;
            return { posterPath: '/dune.jpg' };
        },
    });
    assert.equal(called, false);
    assert.equal(meta.posterUrl, undefined);
    assert.equal(meta.mediaType, 'movie');
});
