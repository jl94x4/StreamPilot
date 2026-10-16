import assert from 'node:assert/strict';
import test from 'node:test';
import {
    decideRating,
    decideWatched,
    episodeKey,
    idsFromGuids,
    movieKey,
} from './ids.js';

test('idsFromGuids reads imdb, tmdb, and tvdb agent urls', () => {
    const ids = idsFromGuids([
        { id: 'plex://movie/abc' },
        { id: 'imdb://tt0110912' },
        { id: 'tmdb://603' },
        { id: 'tvdb://81189' },
    ]);
    assert.deepEqual(ids, { imdb: 'tt0110912', tmdb: 603, tvdb: 81189 });
    assert.equal(movieKey(ids), 'imdb:tt0110912');
    assert.equal(episodeKey({ tvdb: 81189 }, 1, 3), 'tvdb:81189:s1e3');
});

test('decideWatched fills gaps on the first run and follows later changes', () => {
    assert.equal(decideWatched({
        plexWatched: true,
        traktWatched: false,
        prev: null,
        plexToTrakt: true,
        traktToPlex: true,
    }), 'toTrakt');
    assert.equal(decideWatched({
        plexWatched: false,
        traktWatched: true,
        prev: null,
        plexToTrakt: true,
        traktToPlex: true,
    }), 'toPlex');
    assert.equal(decideWatched({
        plexWatched: false,
        traktWatched: true,
        prev: { plexWatched: true, traktWatched: true },
        plexToTrakt: true,
        traktToPlex: true,
    }), 'none');
    assert.equal(decideWatched({
        plexWatched: true,
        traktWatched: false,
        prev: { plexWatched: false, traktWatched: false },
        plexToTrakt: true,
        traktToPlex: true,
    }), 'toTrakt');
});

test('decideRating does not overwrite a disagreement on the first run', () => {
    assert.equal(decideRating({
        plexRating: 8,
        traktRating: 6,
        prev: null,
        plexToTrakt: true,
        traktToPlex: true,
    }), 'none');
    assert.equal(decideRating({
        plexRating: 9,
        traktRating: null,
        prev: null,
        plexToTrakt: true,
        traktToPlex: true,
    }), 'toTrakt');
    assert.equal(decideRating({
        plexRating: 9,
        traktRating: 6,
        prev: { plexRating: 7, traktRating: 6 },
        plexToTrakt: true,
        traktToPlex: true,
    }), 'toTrakt');
});
