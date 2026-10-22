import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    normalizePosterSetsConfig,
    posterSetsWatchProviderAllowed,
    librariesForPosterSets,
    readPosterSetsJson,
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

test('librariesForPosterSets keeps every TV and movie library', () => {
    const picked = librariesForPosterSets([
        { title: 'TV Shows', type: 'show' },
        { title: 'TV Shows - Kids', type: 'show' },
        { title: 'Anime', type: 'series' },
        { title: 'Movies', type: 'movie' },
        { title: '4K Movies', type: 'movie' },
        { title: 'Music', type: 'artist' },
    ]);
    assert.deepEqual(picked.tv_library, ['TV Shows', 'TV Shows - Kids', 'Anime']);
    assert.deepEqual(picked.movie_library, ['Movies', '4K Movies']);
    assert.deepEqual(picked.skipped, ['Music']);
});

test('readPosterSetsJson quarantines an empty or truncated file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'poster-sets-json-'));
    const filePath = path.join(dir, 'history.json');
    await fs.writeFile(filePath, '', 'utf8');
    assert.equal(await readPosterSetsJson(filePath, 'history'), null);
    const left = await fs.readdir(dir);
    assert.equal(left.some((name) => name.startsWith('history.json.corrupt-')), true);

    const truncated = path.join(dir, 'watches.json');
    await fs.writeFile(truncated, '{"watches":[', 'utf8');
    assert.equal(await readPosterSetsJson(truncated, 'watches'), null);
    const after = await fs.readdir(dir);
    assert.equal(after.some((name) => name.startsWith('watches.json.corrupt-')), true);
});

test('TPDB search can be off while watches still allow ThePosterDB', () => {
    const config = { tpdbEnabled: true, tpdbSearchEnabled: false, mediuxEnabled: true };
    assert.equal(resolvePosterSetsSearchProvider(config, 'both'), 'mediux');
    assert.equal(resolvePosterSetsSearchProvider(config, 'posterdb'), null);
    assert.equal(posterSetsWatchProviderAllowed(config, { url: 'https://theposterdb.com/set/1' }), true);
    assert.equal(posterSetsWatchProviderAllowed({ tpdbEnabled: false }, { url: 'https://theposterdb.com/set/1' }), false);
});
