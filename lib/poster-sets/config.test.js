import assert from 'node:assert/strict';
import test from 'node:test';
import {
    normalizePosterSetsConfig,
    posterSetsWatchProviderAllowed,
    warmMediaAllows,
    resolvePosterSetsSearchProvider,
} from './config.js';

test('normalizePosterSetsConfig persists library cache build scope', () => {
    const saved = normalizePosterSetsConfig({
        tpdbCacheWarmMedia: 'show',
        tpdbCacheWarmSource: 'recent',
        tpdbCacheSkipCached: false,
        tpdbCacheFollowedCreatorsOnly: true,
    });
    assert.equal(saved.tpdbCacheWarmMedia, 'show');
    assert.equal(saved.tpdbCacheWarmSource, 'recent');
    assert.equal(saved.tpdbCacheSkipCached, false);
    assert.equal(saved.tpdbCacheFollowedCreatorsOnly, true);
});

test('normalizePosterSetsConfig defaults build scope to movies + TV', () => {
    const saved = normalizePosterSetsConfig({});
    assert.equal(saved.tpdbCacheWarmMedia, 'all');
    assert.equal(saved.tpdbCacheWarmSource, 'full');
    assert.equal(saved.tpdbCacheSkipCached, true);
    assert.equal(saved.tpdbCacheFollowedCreatorsOnly, false);
});

test('normalizePosterSetsConfig maps tv/series warm media to show', () => {
    assert.equal(normalizePosterSetsConfig({ tpdbCacheWarmMedia: 'tv' }).tpdbCacheWarmMedia, 'show');
    assert.equal(normalizePosterSetsConfig({ tpdbCacheWarmMedia: 'series' }).tpdbCacheWarmMedia, 'show');
});

test('normalizePosterSetsConfig rejects unknown media filters', () => {
    const saved = normalizePosterSetsConfig({
        tpdbCacheWarmMedia: 'anime',
        tpdbCacheWarmSource: 'everything',
    });
    assert.equal(saved.tpdbCacheWarmMedia, 'all');
    assert.equal(saved.tpdbCacheWarmSource, 'full');
});

test('normalizePosterSetsConfig defaults on-add cache and first-run flags', () => {
    const saved = normalizePosterSetsConfig({});
    assert.equal(saved.tpdbCacheOnLibraryAdd, true);
    assert.equal(saved.tpdbFirstRunBackfillDone, false);
});

test('warmMediaAllows honors TV-only and movies-only scopes', () => {
    assert.equal(warmMediaAllows('show', 'movie'), false);
    assert.equal(warmMediaAllows('show', 'show'), true);
    assert.equal(warmMediaAllows('tv', 'series'), true);
    assert.equal(warmMediaAllows('movie', 'show'), false);
    assert.equal(warmMediaAllows('movie', 'movie'), true);
    assert.equal(warmMediaAllows('all', 'movie'), true);
    assert.equal(warmMediaAllows('all', 'show'), true);
});

test('normalizePosterSetsConfig defaults sources on', () => {
    const saved = normalizePosterSetsConfig({});
    assert.equal(saved.tpdbEnabled, true);
    assert.equal(saved.tpdbSearchEnabled, true);
    assert.equal(saved.copyLibraryTitleEnabled, true);
    assert.equal(saved.mediuxEnabled, true);
});

test('normalizePosterSetsConfig persists source toggles off', () => {
    const saved = normalizePosterSetsConfig({ tpdbEnabled: false, tpdbSearchEnabled: false, mediuxEnabled: false, copyLibraryTitleEnabled: false });
    assert.equal(saved.tpdbEnabled, false);
    assert.equal(saved.tpdbSearchEnabled, false);
    assert.equal(saved.copyLibraryTitleEnabled, false);
    assert.equal(saved.mediuxEnabled, false);
});

test('resolvePosterSetsSearchProvider honors disabled sources', () => {
    assert.equal(resolvePosterSetsSearchProvider({ tpdbEnabled: true, mediuxEnabled: true }, 'both'), 'both');
    assert.equal(resolvePosterSetsSearchProvider({ tpdbEnabled: false, mediuxEnabled: true }, 'both'), 'mediux');
    assert.equal(resolvePosterSetsSearchProvider({ tpdbEnabled: true, mediuxEnabled: false }, 'both'), 'posterdb');
    assert.equal(resolvePosterSetsSearchProvider({ tpdbEnabled: false, mediuxEnabled: true }, 'posterdb'), null);
    assert.equal(resolvePosterSetsSearchProvider({ tpdbEnabled: false, mediuxEnabled: false }, 'both'), null);
});

test('TPDB search can be off while watches still allow ThePosterDB', () => {
    const config = { tpdbEnabled: true, tpdbSearchEnabled: false, mediuxEnabled: true };
    assert.equal(resolvePosterSetsSearchProvider(config, 'both'), 'mediux');
    assert.equal(resolvePosterSetsSearchProvider(config, 'posterdb'), null);
    assert.equal(posterSetsWatchProviderAllowed(config, { url: 'https://theposterdb.com/set/1' }), true);
    assert.equal(posterSetsWatchProviderAllowed({ tpdbEnabled: false }, { url: 'https://theposterdb.com/set/1' }), false);
});
