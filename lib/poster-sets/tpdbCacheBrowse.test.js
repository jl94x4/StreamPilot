import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyTpdbCacheBrowse,
    coverageKeyForLibraryItem,
    coverageKeyFromTitleCacheFileName,
    coverageKeysFromTitleCacheEntry,
    itemIsTpdbCached,
} from './tpdbCacheBrowse.js';

test('coverageKeyForLibraryItem uses media type + numeric TMDB id', () => {
    assert.equal(coverageKeyForLibraryItem({ tmdbId: '123', mediaType: 'show' }), 'show:123');
    assert.equal(coverageKeyForLibraryItem({ tmdbId: '99', mediaType: 'movie' }), 'movie:99');
    assert.equal(coverageKeyForLibraryItem({ tmdbId: 'abc' }), null);
    assert.equal(coverageKeyForLibraryItem({ id: '999', mediaType: 'movie' }), null);
});

test('coverageKeyForLibraryItem supports TVDB-only titles', () => {
    assert.equal(coverageKeyForLibraryItem({ tvdbId: '78804', mediaType: 'show' }), 'tvdb:show:78804');
    assert.equal(coverageKeyForLibraryItem({ tvdbId: '121361', mediaType: 'tv' }), 'tvdb:show:121361');
    // TMDB wins when both are present (shared id space is disambiguated by prefix).
    assert.equal(
        coverageKeyForLibraryItem({ tmdbId: '1396', tvdbId: '78804', mediaType: 'show' }),
        'show:1396',
    );
});

test('itemIsTpdbCached matches either TMDB or TVDB coverage key', () => {
    const cachedKeys = new Set(['show:1396']);
    assert.equal(
        itemIsTpdbCached({ tmdbId: '1396', tvdbId: '78804', mediaType: 'show' }, cachedKeys),
        true,
    );
    // Plex often only exposes TVDB while warm saved under TMDB — index must include both.
    assert.equal(
        itemIsTpdbCached({ tvdbId: '78804', mediaType: 'show' }, new Set(['tvdb:show:78804', 'show:1396'])),
        true,
    );
    assert.equal(
        itemIsTpdbCached({ tvdbId: '78804', mediaType: 'show' }, new Set(['show:1396'])),
        false,
    );
});

test('coverageKeysFromTitleCacheEntry indexes embedded TVDB on TMDB files', () => {
    const keys = coverageKeysFromTitleCacheEntry(
        { tmdbId: '1396', tvdbId: '78804', mediaType: 'show' },
        'tmdb_show_1396.json',
    );
    assert.ok(keys.includes('show:1396'));
    assert.ok(keys.includes('tvdb:show:78804'));
});

test('coverageKeyFromTitleCacheFileName parses tmdb and tvdb cache filenames', () => {
    assert.equal(coverageKeyFromTitleCacheFileName('tmdb_movie_550.json'), 'movie:550');
    assert.equal(coverageKeyFromTitleCacheFileName('tmdb_show_1396.json'), 'show:1396');
    assert.equal(coverageKeyFromTitleCacheFileName('tvdb_show_78804.json'), 'tvdb:show:78804');
    assert.equal(coverageKeyFromTitleCacheFileName('hint_movie_foo_2011.json'), null);
});

test('applyTpdbCacheBrowse filters cached vs uncached and paginates', () => {
    const items = [
        { title: 'A', tmdbId: '1', mediaType: 'movie' },
        { title: 'B', tmdbId: '2', mediaType: 'movie' },
        { title: 'C', tmdbId: '3', mediaType: 'show' },
        { title: 'D', mediaType: 'movie' },
        { title: 'E', tvdbId: '78804', mediaType: 'show' },
    ];
    const cachedKeys = new Set(['movie:1', 'show:3', 'tvdb:show:78804']);

    const cached = applyTpdbCacheBrowse(items, { cachedKeys, cacheStatus: 'cached', limit: 60 });
    assert.deepEqual(cached.items.map((item) => item.title), ['A', 'C', 'E']);
    assert.equal(cached.total, 3);

    const uncached = applyTpdbCacheBrowse(items, { cachedKeys, cacheStatus: 'uncached', limit: 60 });
    assert.deepEqual(uncached.items.map((item) => item.title), ['B', 'D']);
    assert.equal(uncached.total, 2);
});

test('applyTpdbCacheBrowse cachedFirst keeps original order within groups', () => {
    const items = [
        { title: 'Uncached 1', tmdbId: '10', mediaType: 'movie' },
        { title: 'Cached 1', tmdbId: '11', mediaType: 'movie' },
        { title: 'Uncached 2', tmdbId: '12', mediaType: 'show' },
        { title: 'Cached 2', tmdbId: '13', mediaType: 'show' },
    ];
    const cachedKeys = new Set(['movie:11', 'show:13']);
    const result = applyTpdbCacheBrowse(items, {
        cachedKeys,
        sort: 'cachedFirst',
        start: 0,
        limit: 60,
    });
    assert.deepEqual(result.items.map((item) => item.title), [
        'Cached 1',
        'Cached 2',
        'Uncached 1',
        'Uncached 2',
    ]);
    assert.equal(itemIsTpdbCached(items[1], cachedKeys), true);
});
