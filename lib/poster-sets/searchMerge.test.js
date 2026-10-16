import assert from 'node:assert/strict';
import test from 'node:test';
import {
    excludeBlockedCreators,
    excludeBlockedHandles,
    filterCollectionSets,
    isCollectionSet,
    keepFollowedCreatorsOnly,
    libraryItemToSearchTitle,
    mergePosterSearchSets,
    mergePosterSearchTitles,
    mergeTitleSearchWithLibrary,
} from './searchMerge.js';

test('excludeBlockedCreators hides matching handles and keeps unknown users', () => {
    const sets = [
        { setId: '1', url: 'https://theposterdb.com/set/1', user: 'muikman2000', title: 'A' },
        { setId: '2', url: 'https://theposterdb.com/set/2', user: '@TheHeir', title: 'B' },
        { setId: '3', url: 'https://theposterdb.com/set/3', user: null, title: 'C' },
    ];
    const filtered = excludeBlockedCreators(sets, ['MuikMan2000']);
    assert.deepEqual(filtered.map((set) => set.setId), ['2', '3']);
});

test('excludeBlockedHandles drops blocked usernames from scrape lists', () => {
    const names = excludeBlockedHandles(['MuikMan2000', '@TheHeir', 'other'], ['muikman2000']);
    assert.deepEqual(names, ['@TheHeir', 'other']);
    assert.deepEqual(excludeBlockedHandles(['MuikMan2000'], []), ['MuikMan2000']);
});

test('keepFollowedCreatorsOnly keeps matching handles and drops unknown users', () => {
    const sets = [
        { setId: '1', url: 'https://theposterdb.com/set/1', user: 'muikman2000', title: 'A' },
        { setId: '2', url: 'https://theposterdb.com/set/2', user: '@TheHeir', title: 'B' },
        { setId: '3', url: 'https://theposterdb.com/set/3', user: null, title: 'C' },
    ];
    const filtered = keepFollowedCreatorsOnly(sets, ['TheHeir']);
    assert.deepEqual(filtered.map((set) => set.setId), ['2']);
    assert.deepEqual(keepFollowedCreatorsOnly(sets, []).map((set) => set.setId), []);
});

test('mergePosterSearchSets drops blocked creators after follow ranking', () => {
    const merged = mergePosterSearchSets([
        { setId: '1', url: 'https://theposterdb.com/poster/set/1', user: 'muikman2000', title: 'Carolina', provider: 'posterdb' },
        { setId: '2', url: 'https://theposterdb.com/poster/set/2', user: 'TheHeir', title: 'Carolina', provider: 'posterdb' },
    ], 'posterdb', {
        preferredCreators: ['muikman2000'],
        blockedCreators: ['muikman2000'],
    });
    assert.equal(merged.sets.length, 1);
    assert.equal(merged.sets[0].user, 'TheHeir');
});

test('isCollectionSet keeps boxsets, collection posters, and large packs', () => {
    assert.equal(isCollectionSet({ setKind: 'boxset', title: 'MCU' }), true);
    assert.equal(isCollectionSet({ setKind: 'collection', title: 'Star Wars' }), true);
    assert.equal(isCollectionSet({ mediaType: 'collection', title: 'Pixar' }), true);
    assert.equal(isCollectionSet({ title: 'Marvel Cinematic Universe Collection' }), true);
    assert.equal(isCollectionSet({ title: 'John Wick', posterCount: 24 }), true);
    assert.equal(isCollectionSet({ title: 'The Batman', posterCount: 4 }), false);
    assert.equal(isCollectionSet({ setKind: 'title_cards', posterCount: 40, title: 'Season 1' }), false);
    assert.equal(isCollectionSet({ title: 'Episode Title Cards' }), false);
});

test('libraryItemToSearchTitle requires a TMDB id and marks in-library', () => {
    assert.equal(libraryItemToSearchTitle({ title: 'The Westies', year: 2026, mediaType: 'show' }), null);
    const title = libraryItemToSearchTitle({
        title: 'The Westies',
        year: 2026,
        mediaType: 'show',
        tmdbId: '2881972',
        thumb: '/library/metadata/1/thumb/9',
    });
    assert.equal(title.id, '2881972');
    assert.equal(title.provider, 'mediux');
    assert.equal(title.inLibrary, true);
    assert.equal(title.url, 'https://mediux.pro/shows/2881972');
    assert.match(title.thumbUrl, /\/api\/plex\/image\?path=/);
});

test('mergeTitleSearchWithLibrary puts library hits first and collapses the same TMDB id', () => {
    const merged = mergeTitleSearchWithLibrary([
        {
            id: '2881972',
            title: 'The Westies',
            year: 2026,
            url: 'https://mediux.pro/shows/2881972',
            provider: 'mediux',
            mediaType: 'show',
        },
        {
            id: '11',
            title: 'Star Wars',
            year: 1977,
            url: 'https://mediux.pro/movies/11',
            provider: 'mediux',
            mediaType: 'movie',
        },
    ], [
        {
            title: 'The Westies',
            year: 2028,
            mediaType: 'show',
            tmdbId: '2881972',
        },
    ]);
    assert.equal(merged.titles[0].id, '2881972');
    assert.equal(merged.titles[0].inLibrary, true);
    assert.equal(merged.titles.length, 2);
    assert.equal(merged.titles[1].id, '11');
});

test('mergePosterSearchTitles keeps a single card for the same MediUX TMDB id', () => {
    const merged = mergePosterSearchTitles([
        { id: '1', title: 'Dune', year: 2021, url: 'https://mediux.pro/movies/1', provider: 'mediux' },
        { id: '1', title: 'Dune', year: 2024, url: 'https://mediux.pro/movies/1', provider: 'mediux', inLibrary: true },
    ]);
    assert.equal(merged.titles.length, 1);
    assert.equal(merged.titles[0].inLibrary, true);
});

test('filterCollectionSets drops single-title posters', () => {
    const filtered = filterCollectionSets([
        { setId: '1', title: 'Dune', posterCount: 3, setKind: 'posters' },
        { setId: '2', title: 'Dune Collection', posterCount: 2 },
        { setId: '3', title: 'MCU Boxset', setKind: 'boxset' },
    ]);
    assert.deepEqual(filtered.map((set) => set.setId), ['2', '3']);
});
