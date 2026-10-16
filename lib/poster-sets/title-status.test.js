import assert from 'node:assert/strict';
import test from 'node:test';
import {
    enrichWatchesWithHistoryHints,
    libraryTitleMatchesWatchingIndex,
    watchingIndexFromWatches,
} from './title-status.js';

test('watching index includes collection child titles from libraryHints', () => {
    const index = watchingIndexFromWatches([{
        id: 'w1',
        enabled: true,
        title: 'The Conjuring Collection',
        setKind: 'collection',
        tmdbId: '259693',
        libraryHints: [
            { title: 'The Nun', tmdbId: '343611', ratingKey: '10' },
            { title: 'Annabelle', tmdbId: '250546' },
        ],
    }]);

    assert.equal(libraryTitleMatchesWatchingIndex(index, { title: 'The Nun' }), true);
    assert.equal(libraryTitleMatchesWatchingIndex(index, { title: 'Annabelle (2014)' }), true);
    assert.equal(libraryTitleMatchesWatchingIndex(index, { title: 'The Conjuring' }), true);
    assert.equal(libraryTitleMatchesWatchingIndex(index, { ratingKey: '10' }), true);
    assert.equal(libraryTitleMatchesWatchingIndex(index, { tmdbId: '250546' }), true);
    assert.equal(libraryTitleMatchesWatchingIndex(index, { tmdbId: '259693' }), false);
    assert.equal(libraryTitleMatchesWatchingIndex(index, { title: 'Insidious' }), false);
});

test('watching index ignores disabled watches', () => {
    const index = watchingIndexFromWatches([{
        id: 'w1',
        enabled: false,
        title: 'The Nun',
        libraryHints: [{ title: 'The Nun', tmdbId: '343611' }],
    }]);
    assert.equal(libraryTitleMatchesWatchingIndex(index, { title: 'The Nun' }), false);
});

test('history selectedAssets backfill child titles onto a collection watch', () => {
    const enriched = enrichWatchesWithHistoryHints(
        [{
            id: 'w1',
            enabled: true,
            title: 'The Conjuring Collection',
            setKind: 'collection',
            url: 'https://mediux.pro/sets/99',
            libraryHints: [],
        }],
        [{
            input: {
                url: 'https://mediux.pro/sets/99',
                selectedAssets: [
                    { title: 'The Nun', matched: true },
                    { title: 'Annabelle', matched: true },
                ],
            },
        }],
    );
    assert.equal(enriched[0].libraryHints.some((hint) => hint.title === 'The Nun'), true);
    const index = watchingIndexFromWatches(enriched);
    assert.equal(libraryTitleMatchesWatchingIndex(index, { title: 'The Nun' }), true);
    assert.equal(libraryTitleMatchesWatchingIndex(index, { title: 'Annabelle' }), true);
});
