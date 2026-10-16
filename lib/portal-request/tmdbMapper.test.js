import assert from 'node:assert/strict';
import test from 'node:test';
import { mapMovieDetails, mapTvDetails } from './tmdbMapper.js';

test('mapTvDetails does not flag Western animation as anime', () => {
    const mapped = mapTvDetails({
        id: 1,
        name: 'Adventure Time: Fionna and Cake',
        original_language: 'en',
        origin_country: ['US'],
        genres: [{ id: 16, name: 'Animation' }],
        keywords: { results: [] },
    });
    assert.equal(mapped.isAnime, false);
});

test('mapTvDetails flags Japanese animation as anime', () => {
    const mapped = mapTvDetails({
        id: 2,
        name: 'Frieren: Beyond Journey\'s End',
        original_language: 'ja',
        origin_country: ['JP'],
        genres: [{ id: 16, name: 'Animation' }],
        keywords: { results: [] },
    });
    assert.equal(mapped.isAnime, true);
});

test('mapMovieDetails does not flag Western animation as anime', () => {
    const mapped = mapMovieDetails({
        id: 1,
        title: 'Toy Story',
        original_language: 'en',
        genres: [{ id: 16, name: 'Animation' }],
        keywords: { keywords: [] },
    });
    assert.equal(mapped.isAnime, false);
});
