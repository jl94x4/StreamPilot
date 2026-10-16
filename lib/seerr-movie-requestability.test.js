import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateSeerrMovieRequestability } from './seerr-movie-requestability.js';

test('keeps 4K requestable when Seerr HD status is already available', () => {
    const result = evaluateSeerrMovieRequestability({
        mediaStatus: 5,
        mediaStatus4k: 1,
        hasHdServer: true,
        has4kServer: true,
        canRequest4k: true,
    });
    assert.equal(result.canRequest, true);
    assert.equal(result.libraryQualities.hd, true);
    assert.equal(result.libraryQualities['4k'], false);
    assert.match(result.availabilityNote, /4K/);
    assert.equal(result.blockReason, null);
});

test('keeps HD requestable when only 4K is in the library', () => {
    const result = evaluateSeerrMovieRequestability({
        mediaStatus: 1,
        mediaStatus4k: 5,
        hasHdServer: true,
        has4kServer: true,
        canRequest4k: true,
    });
    assert.equal(result.canRequest, true);
    assert.equal(result.libraryQualities.hd, false);
    assert.equal(result.libraryQualities['4k'], true);
    assert.match(result.availabilityNote, /HD/);
});

test('blocks when both qualities are available', () => {
    const result = evaluateSeerrMovieRequestability({
        mediaStatus: 5,
        mediaStatus4k: 5,
        hasHdServer: true,
        has4kServer: true,
        canRequest4k: true,
    });
    assert.equal(result.canRequest, false);
    assert.equal(result.blockReason, 'This movie is already available.');
});

test('keeps 4K requestable when HD is already pending in Seerr', () => {
    const result = evaluateSeerrMovieRequestability({
        mediaStatus: 2,
        mediaStatus4k: 1,
        hasHdServer: true,
        has4kServer: true,
        canRequest4k: true,
    });
    assert.equal(result.canRequest, true);
    assert.equal(result.requestedQualities.hd, true);
    assert.equal(result.requestedQualities['4k'], false);
});

test('blocks when HD is pending and no 4K server exists', () => {
    const result = evaluateSeerrMovieRequestability({
        mediaStatus: 2,
        mediaStatus4k: 1,
        hasHdServer: true,
        has4kServer: false,
        canRequest4k: false,
    });
    assert.equal(result.canRequest, false);
    assert.equal(result.blockReason, 'This movie already has a pending request.');
});
