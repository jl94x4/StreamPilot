import assert from 'node:assert/strict';
import test from 'node:test';
import {
    scoreWikipediaSearchHit,
    factRelatesToTitle,
    filterFactsForTitle,
    titlesLikelyMatch,
    buildDiscoveryFacts,
} from './discovery-facts.js';

test('scoreWikipediaSearchHit prefers exact film match with year', () => {
    const exact = scoreWikipediaSearchHit(
        { title: 'Inception (2010 film)' },
        'Inception',
        '2010',
        'movie',
    );
    const wrong = scoreWikipediaSearchHit(
        { title: 'Inception (TV series)' },
        'Inception',
        '2010',
        'movie',
    );
    assert.ok(exact > wrong);
    assert.ok(exact >= 18);
});

test('scoreWikipediaSearchHit rejects unrelated titles', () => {
    const score = scoreWikipediaSearchHit(
        { title: 'Friends (1994 TV series)' },
        'Breaking Bad',
        '2008',
        'tv',
    );
    assert.equal(score, -100);
});

test('factRelatesToTitle rejects facts about unrelated titles', () => {
    assert.equal(
        factRelatesToTitle('Friends ran for ten seasons on NBC.', 'Breaking Bad'),
        false,
    );
    assert.equal(
        factRelatesToTitle('Breaking Bad was filmed largely in Albuquerque.', 'Breaking Bad'),
        true,
    );
});

test('filterFactsForTitle drops unrelated wiki facts', () => {
    const filtered = filterFactsForTitle([
        'The sitcom Friends premiered in 1994.',
        'Breaking Bad used a real pizza throw on set.',
    ], 'Breaking Bad');
    assert.equal(filtered.length, 1);
    assert.match(filtered[0], /Breaking Bad/);
});

test('titlesLikelyMatch compares normalized roots', () => {
    assert.equal(titlesLikelyMatch('Breaking Bad', 'Breaking Bad (2008)'), true);
    assert.equal(titlesLikelyMatch('Friends', 'Breaking Bad'), false);
});

test('buildDiscoveryFacts looks up Wikipedia with the show title when TMDB details are missing', async () => {
    const urls = [];
    const fetchFn = async (url) => {
        urls.push(String(url));
        return { ok: false, status: 404, json: async () => ({}) };
    };
    await buildDiscoveryFacts({
        details: null,
        mediaType: 'tv',
        fetchFn,
        expectedTitle: 'The Hawke',
    });
    assert.ok(urls.some((url) => decodeURIComponent(url).toLowerCase().includes('hawke')));
});
