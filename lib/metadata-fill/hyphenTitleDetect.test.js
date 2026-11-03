import test from 'node:test';
import assert from 'node:assert/strict';
import {
    needsHyphenTitleFix,
    tmdbTitleHasHyphen,
    normalizeCompareTitle,
} from './hyphenTitleDetect.js';
import {
    buildPlexMovieTitleEditParams,
    buildPlexMovieTitleUnlockParams,
} from './plexWrite.js';

test('tmdbTitleHasHyphen detects hyphenated titles', () => {
    assert.equal(tmdbTitleHasHyphen('Z-O-M-B-I-E-S'), true);
    assert.equal(tmdbTitleHasHyphen('Spider-Man'), true);
    assert.equal(tmdbTitleHasHyphen('Zombies'), false);
    assert.equal(tmdbTitleHasHyphen(''), false);
});

test('needsHyphenTitleFix for Zombies vs Z-O-M-B-I-E-S', () => {
    const hit = needsHyphenTitleFix({
        plexTitle: 'Zombies',
        tmdbTitle: 'Z-O-M-B-I-E-S',
    });
    assert.equal(hit.needs, true);
    assert.equal(hit.plexTitle, 'Zombies');
    assert.equal(hit.tmdbTitle, 'Z-O-M-B-I-E-S');
});

test('needsHyphenTitleFix skips when titles already match', () => {
    assert.equal(needsHyphenTitleFix({
        plexTitle: 'Z-O-M-B-I-E-S',
        tmdbTitle: 'Z-O-M-B-I-E-S',
    }).needs, false);
    assert.equal(needsHyphenTitleFix({
        plexTitle: 'z-o-m-b-i-e-s',
        tmdbTitle: 'Z-O-M-B-I-E-S',
    }).needs, false);
});

test('needsHyphenTitleFix skips when TMDB title has no hyphen', () => {
    assert.equal(needsHyphenTitleFix({
        plexTitle: 'Zombies',
        tmdbTitle: 'Zombies',
    }).needs, false);
    assert.equal(needsHyphenTitleFix({
        plexTitle: 'Avatar',
        tmdbTitle: 'Avatar',
    }).needs, false);
    assert.equal(needsHyphenTitleFix({
        plexTitle: 'The Avengers',
        tmdbTitle: 'The Avengers',
    }).needs, false);
});

test('needsHyphenTitleFix needs fix when Plex title empty but TMDB has hyphen', () => {
    assert.equal(needsHyphenTitleFix({
        plexTitle: '',
        tmdbTitle: 'X-Men',
    }).needs, true);
});

test('normalizeCompareTitle trims and lowercases', () => {
    assert.equal(normalizeCompareTitle('  Foo '), 'foo');
});

test('buildPlexMovieTitleEditParams locks movie title (type=1)', () => {
    const params = buildPlexMovieTitleEditParams({
        ratingKey: '4242',
        title: 'Z-O-M-B-I-E-S',
        lock: true,
    });
    assert.equal(params.get('type'), '1');
    assert.equal(params.get('id'), '4242');
    assert.equal(params.get('title.value'), 'Z-O-M-B-I-E-S');
    assert.equal(params.get('title.locked'), '1');
});

test('buildPlexMovieTitleUnlockParams clears title lock', () => {
    const params = buildPlexMovieTitleUnlockParams({ ratingKey: '99' });
    assert.equal(params.get('type'), '1');
    assert.equal(params.get('id'), '99');
    assert.equal(params.get('title.locked'), '0');
    assert.equal(params.get('title.value'), null);
});
