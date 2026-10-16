import assert from 'node:assert/strict';
import test from 'node:test';
import { findOverlappingTitleWatches, findSameTitleWatches, normalizeWatchTitleKey, watchArtSlots, watchesOverlapArtSlots, watchesShareTitle } from './watchTitle.js';

test('normalizeWatchTitleKey drops years and pack words', () => {
    assert.equal(normalizeWatchTitleKey("It's Always Sunny in Philadelphia (2005)"), 'it s always sunny in philadelphia');
    assert.equal(normalizeWatchTitleKey('The Runner Poster Set'), 'the runner');
});

test('watchesShareTitle matches tmdb even when titles differ slightly', () => {
    assert.equal(
        watchesShareTitle(
            { title: 'The Runner', tmdbId: '99' },
            { title: 'The Runner (2026)', tmdbId: '99' },
        ),
        true,
    );
});

test('watchesShareTitle does not merge different tmdb ids that share a name', () => {
    assert.equal(
        watchesShareTitle(
            { title: 'The Dark', tmdbId: '1' },
            { title: 'The Dark', tmdbId: '2' },
        ),
        false,
    );
});

test('watchesShareTitle matches a titled TPDB pin to a MediUX pin with tmdb', () => {
    assert.equal(
        watchesShareTitle(
            { title: 'Sliders', tmdbId: '5' },
            { title: 'Sliders' },
        ),
        true,
    );
});

test('findSameTitleWatches ignores the same set URL', () => {
    const existing = [{ id: 'a', url: 'https://mediux.pro/sets/1', title: 'Sliders', tmdbId: '5' }];
    const hits = findSameTitleWatches(existing, {
        id: 'a',
        url: 'https://mediux.pro/sets/1',
        title: 'Sliders',
        tmdbId: '5',
    });
    assert.equal(hits.length, 0);
});

test('findSameTitleWatches returns other pins for the same show', () => {
    const existing = [
        { id: 'a', url: 'https://mediux.pro/sets/1', title: 'Babylon 5', tmdbId: '10' },
        { id: 'b', url: 'https://mediux.pro/sets/9', title: 'Camp Rock', tmdbId: '11' },
    ];
    const hits = findSameTitleWatches(existing, {
        url: 'https://theposterdb.com/set/2',
        title: 'Babylon 5',
        tmdbId: '10',
    });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].id, 'a');
});

test('title-card and poster watches for the same show do not overlap', () => {
    const titleCards = { mediuxFilters: ['title_card'], setKind: 'title_cards' };
    const posters = { mediuxFilters: ['show_cover', 'season_cover'], setKind: 'posters' };
    assert.equal(watchesOverlapArtSlots(titleCards, posters), false);
    assert.deepEqual([...watchArtSlots(titleCards)], ['title_cards']);
    assert.deepEqual([...watchArtSlots(posters)].sort(), ['posters']);
});

test('two poster watches for the same show overlap', () => {
    assert.equal(
        watchesOverlapArtSlots(
            { mediuxFilters: ['show_cover'] },
            { mediuxFilters: ['season_cover', 'show_cover'] },
        ),
        true,
    );
});

test('findOverlappingTitleWatches keeps a title-card pin when adding posters', () => {
    const existing = [
        {
            id: 'cards',
            url: 'https://mediux.pro/sets/7265',
            title: 'Westworld',
            tmdbId: '63247',
            mediuxFilters: ['title_card'],
            setKind: 'title_cards',
        },
        {
            id: 'other-posters',
            url: 'https://mediux.pro/sets/99',
            title: 'Westworld',
            tmdbId: '63247',
            mediuxFilters: ['show_cover', 'season_cover'],
            setKind: 'posters',
        },
    ];
    const incomingPosters = {
        url: 'https://theposterdb.com/set/2',
        title: 'Westworld',
        tmdbId: '63247',
        mediuxFilters: ['show_cover', 'season_cover'],
        setKind: 'posters',
    };
    const hits = findOverlappingTitleWatches(existing, incomingPosters);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].id, 'other-posters');
});
