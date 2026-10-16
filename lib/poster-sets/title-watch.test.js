import assert from 'node:assert/strict';
import test from 'node:test';
import {
    findWatchesForLibraryTitle,
    libraryHintsFromAssets,
    watchMatchesLibraryTitle,
} from './title-watch.js';

test('libraryHintsFromAssets keeps movie titles from a collection apply', () => {
    const hints = libraryHintsFromAssets([
        { title: 'The Nun', kind: 'collection', matched: true, tmdbId: '343611' },
        { title: 'Annabelle', kind: 'collection', matched: true },
        { title: 'The Conjuring', label: 'The Conjuring (2013)', matched: true, ratingKey: '123' },
        { title: '', matched: false },
    ]);
    assert.equal(hints.length, 3);
    assert.equal(hints[0].title, 'The Nun');
    assert.equal(hints[0].tmdbId, '343611');
    assert.equal(hints[2].ratingKey, '123');
});

test('collection watches match child movies via libraryHints, not the collection tmdbId', () => {
    const watch = {
        id: 'w1',
        enabled: true,
        title: 'The Conjuring Collection',
        setKind: 'collection',
        tmdbId: '259693',
        url: 'https://mediux.pro/sets/99',
        libraryHints: [
            { title: 'The Nun', tmdbId: '343611', ratingKey: '10' },
            { title: 'Annabelle', tmdbId: '250546', ratingKey: '11' },
            { title: 'The Conjuring', tmdbId: '138843', ratingKey: '12' },
        ],
    };

    assert.equal(watchMatchesLibraryTitle(watch, { title: 'The Nun' }), true);
    assert.equal(watchMatchesLibraryTitle(watch, { title: 'Annabelle (2014)' }), true);
    assert.equal(watchMatchesLibraryTitle(watch, { ratingKey: '12' }), true);
    assert.equal(watchMatchesLibraryTitle(watch, { tmdbId: '250546' }), true);
    assert.equal(watchMatchesLibraryTitle(watch, { tmdbId: '259693' }), false);
    assert.equal(watchMatchesLibraryTitle(watch, { title: 'Insidious' }), false);

    const hits = findWatchesForLibraryTitle([watch], { title: 'The Nun', tmdbId: '343611' });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].id, 'w1');
});

test('disabled collection watches still match so the UI can list them', () => {
    const watch = {
        id: 'w2',
        enabled: false,
        title: 'The Conjuring Collection',
        setKind: 'collection',
        libraryHints: [{ title: 'The Nun' }],
    };
    assert.equal(watchMatchesLibraryTitle(watch, { title: 'The Nun' }), true);
});
