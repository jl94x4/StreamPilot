import assert from 'node:assert/strict';
import test from 'node:test';
import {
    dedupePersonCredits,
    mergeEnrichedPersonCredits,
    personCreditYear,
    pickTmdbPersonMatch,
    splitBiography,
    splitPersonCredits,
    formatPersonDate,
    personAgeYears,
} from './personCredits.js';

test('dedupePersonCredits keeps unique titles, prefers posters, and sorts newest first', () => {
    const out = dedupePersonCredits([
        { id: 1, mediaType: 'movie', title: 'Yesterday', releaseDate: '2019-06-28', popularity: 40 },
        { id: 1, mediaType: 'movie', title: 'Yesterday', releaseDate: '2019-06-28', posterPath: '/y.jpg', character: 'Jack' },
        { id: 2, mediaType: 'tv', name: 'EastEnders', firstAirDate: '2007-01-01', posterPath: '/e.jpg' },
        { id: 3, mediaType: 'movie', title: 'Tenet', releaseDate: '2020-08-26', posterPath: '/t.jpg' },
        { id: 4, mediaType: 'movie', title: '' },
        { mediaType: 'movie', title: 'No id' },
    ]);
    assert.deepEqual(out.map((row) => row.title || row.name), ['Tenet', 'Yesterday', 'EastEnders']);
    assert.equal(out[1].character, 'Jack');
    assert.equal(out[1].posterPath, '/y.jpg');
    assert.equal(personCreditYear(out[0]), '2020');
});

test('splitPersonCredits separates acting and crew filmography', () => {
    const out = splitPersonCredits({
        cast: [{ id: 10, mediaType: 'movie', title: 'Good Grief', releaseDate: '2023-01-01' }],
        crew: [{ id: 10, mediaType: 'movie', title: 'Good Grief', releaseDate: '2023-01-01', job: 'Producer' }],
    });
    assert.equal(out.cast.length, 1);
    assert.equal(out.crew.length, 1);
    assert.equal(out.crew[0].job, 'Producer');
});

test('mergeEnrichedPersonCredits patches availability onto matching titles', () => {
    const current = [
        { id: 1, mediaType: 'movie', title: 'Yesterday' },
        { id: 2, mediaType: 'tv', name: 'Damned' },
    ];
    const merged = mergeEnrichedPersonCredits(current, [
        { id: 2, mediaType: 'tv', name: 'Damned', mediaInfo: { status: 5 } },
    ]);
    assert.equal(merged[0].mediaInfo, undefined);
    assert.equal(merged[1].mediaInfo.status, 5);
});

test('pickTmdbPersonMatch prefers exact names and overlapping on-server titles', () => {
    const picked = pickTmdbPersonMatch([
        { id: 1, mediaType: 'movie', title: 'Avatar' },
        { id: 9, mediaType: 'person', name: 'James Jordan', popularity: 80, knownFor: [{ title: 'Unrelated' }] },
        { id: 11, mediaType: 'person', name: 'James Jordan', popularity: 12, knownFor: [{ title: 'Lioness' }] },
        { id: 22, mediaType: 'person', name: 'Zoe Saldana', popularity: 90, knownFor: [{ title: 'Avatar' }] },
    ], { name: 'James Jordan', knownTitles: ['Lioness'] });
    assert.equal(picked.id, 11);

    const accent = pickTmdbPersonMatch([
        { id: 22, mediaType: 'person', name: 'Zoe Saldana', popularity: 40 },
        { id: 23, mediaType: 'person', name: 'Someone Else', popularity: 99 },
    ], { name: 'Zoe Saldaña' });
    assert.equal(accent.id, 22);
});

test('splitBiography keeps the first paragraph until Read more', () => {
    const split = splitBiography('First paragraph.\n\nSecond paragraph.\n\nThird.');
    assert.equal(split.first, 'First paragraph.');
    assert.equal(split.hasMore, true);
    assert.equal(split.rest.includes('Second'), true);
    assert.equal(splitBiography('Just one line.').hasMore, false);
});

test('formatPersonDate and personAgeYears handle birth and death', () => {
    assert.equal(formatPersonDate('1971-02-11', 'en-GB'), '11 Feb 1971');
    assert.equal(personAgeYears('1971-02-11', '2025-02-11'), 54);
    assert.equal(personAgeYears('1971-02-11', '2025-02-10'), 53);
    assert.equal(personAgeYears('not-a-date'), null);
});
