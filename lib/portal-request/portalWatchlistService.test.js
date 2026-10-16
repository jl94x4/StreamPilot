import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldSkipWatchlistRequest } from './portalWatchlistService.js';

test('skips titles that cannot be requested', () => {
    assert.equal(shouldSkipWatchlistRequest({ canRequest: false }, { mediaType: 'movie' }), true);
    assert.equal(shouldSkipWatchlistRequest(null, { mediaType: 'movie' }), true);
});

test('skips movies already available or already in HD', () => {
    assert.equal(shouldSkipWatchlistRequest({
        canRequest: true,
        mediaStatus: 5,
        libraryQualities: { hd: false },
    }, { mediaType: 'movie' }), true);

    assert.equal(shouldSkipWatchlistRequest({
        canRequest: true,
        mediaStatus: 3,
        libraryQualities: { hd: true, '4k': false },
    }, { mediaType: 'movie', is4k: false }), true);

    assert.equal(shouldSkipWatchlistRequest({
        canRequest: true,
        mediaStatus: 3,
        libraryQualities: { hd: true, '4k': false },
    }, { mediaType: 'movie', is4k: true }), false);
});

test('skips titles with an existing request including failed and declined', () => {
    assert.equal(shouldSkipWatchlistRequest({
        canRequest: true,
        mediaStatus: 1,
        existingRequestStatus: 4,
    }, { mediaType: 'tv' }), true);

    assert.equal(shouldSkipWatchlistRequest({
        canRequest: true,
        mediaStatus: 1,
        existingRequestStatus: 3,
    }, { mediaType: 'movie' }), true);

    assert.equal(shouldSkipWatchlistRequest({
        canRequest: true,
        mediaStatus: 1,
        existingRequestStatus: 1,
    }, { mediaType: 'tv' }), true);
});

test('allows missing HD movies and incomplete series', () => {
    assert.equal(shouldSkipWatchlistRequest({
        canRequest: true,
        mediaStatus: 1,
        libraryQualities: { hd: false, '4k': false },
    }, { mediaType: 'movie' }), false);

    assert.equal(shouldSkipWatchlistRequest({
        canRequest: true,
        mediaStatus: 4,
    }, { mediaType: 'tv' }), false);
});
