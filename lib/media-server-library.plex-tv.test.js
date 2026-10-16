import assert from 'node:assert/strict';
import test from 'node:test';
import {
    browsePlexLibraryMedia,
    fetchPlexItemProviderIds,
    hydratePlexLibraryProviderIds,
    plexSectionAllTypeQuery,
} from './media-server-library.js';

const jsonResponse = (body) => ({
    json: async () => body,
});

const plexDeps = (fetchImpl) => ({
    getPlexConnectionUri: async () => 'http://plex.test',
    plexClientHeaders: () => ({}),
    fetchImpl,
});

test('plexSectionAllTypeQuery pins TV to series and movies to movies', () => {
    assert.equal(plexSectionAllTypeQuery('show'), '&type=2');
    assert.equal(plexSectionAllTypeQuery('movie'), '&type=1');
    assert.equal(plexSectionAllTypeQuery(''), '');
});

test('browsePlexLibraryMedia requests TV /all with type=2', async () => {
    const calls = [];
    const deps = plexDeps(async (url) => {
        const href = String(url);
        calls.push(href);
        if (href.includes('/library/sections?')) {
            return jsonResponse({
                MediaContainer: {
                    Directory: [{ key: '2', title: 'TV Shows', type: 'show', size: 0 }],
                },
            });
        }
        if (href.includes('/library/sections/2/all') && href.includes('X-Plex-Container-Size=0')) {
            return jsonResponse({ MediaContainer: { totalSize: 1, size: 0 } });
        }
        return jsonResponse({
            MediaContainer: {
                totalSize: 1,
                Metadata: [{
                    ratingKey: '101',
                    title: 'Breaking Bad',
                    year: 2008,
                    type: 'show',
                    Guid: [{ id: 'tvdb://81189' }],
                }],
            },
        });
    });

    const result = await browsePlexLibraryMedia(
        { plexToken: 'token' },
        deps,
        { mediaType: 'show', limit: 40 },
    );
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].mediaType, 'show');
    assert.equal(result.items[0].tvdbId, '81189');
    const browseUrl = calls.find((url) => (
        url.includes('/library/sections/2/all') && url.includes('includeGuids=1')
    ));
    assert.ok(browseUrl, 'expected TV library /all browse');
    assert.match(browseUrl, /type=2/);
    const countUrl = calls.find((url) => (
        url.includes('/library/sections/2/all') && url.includes('X-Plex-Container-Size=0')
    ));
    assert.ok(countUrl);
    assert.match(countUrl, /type=2/);
});

test('fetchPlexItemProviderIds walks episode rating keys up to the show', async () => {
    const deps = plexDeps(async (url) => {
        const href = String(url);
        if (href.includes('/library/metadata/ep-9')) {
            return jsonResponse({
                MediaContainer: {
                    Metadata: [{
                        type: 'episode',
                        ratingKey: 'ep-9',
                        grandparentRatingKey: '55',
                        title: 'Pilot',
                    }],
                },
            });
        }
        if (href.includes('/library/metadata/55')) {
            return jsonResponse({
                MediaContainer: {
                    Metadata: [{
                        type: 'show',
                        ratingKey: '55',
                        title: 'Breaking Bad',
                        Guid: [{ id: 'tvdb://81189' }, { id: 'tmdb://1396' }],
                    }],
                },
            });
        }
        throw new Error(`unexpected url ${href}`);
    });

    const ids = await fetchPlexItemProviderIds({ plexToken: 'token' }, deps, 'ep-9');
    assert.equal(ids.tmdbId, '1396');
    assert.equal(ids.tvdbId, '81189');
});

test('hydratePlexLibraryProviderIds fills every missing show, not a 300 cap', async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 350 }, (_, index) => ({
        id: String(index + 1),
        title: `Show ${index + 1}`,
        mediaType: 'show',
    }));
    const deps = plexDeps(async (url) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        const match = String(url).match(/\/library\/metadata\/(\d+)/);
        active -= 1;
        const ratingKey = match?.[1] || '0';
        return jsonResponse({
            MediaContainer: {
                Metadata: [{
                    type: 'show',
                    ratingKey,
                    Guid: [{ id: `tvdb://${10000 + Number(ratingKey)}` }],
                }],
            },
        });
    });

    const hydrated = await hydratePlexLibraryProviderIds(
        { plexToken: 'token' },
        deps,
        items,
        { concurrency: 8, onlyMissingBoth: true },
    );
    assert.equal(hydrated.length, 350);
    assert.equal(hydrated.filter((row) => row.tvdbId).length, 350);
    assert.equal(hydrated[349].tvdbId, String(10000 + 350));
    assert.ok(maxActive <= 8, `expected <=8 concurrent Plex lookups, got ${maxActive}`);
});

test('hydratePlexLibraryProviderIds leaves TVDB-only rows alone when onlyMissingBoth', async () => {
    const calls = [];
    const deps = plexDeps(async (url) => {
        calls.push(String(url));
        return jsonResponse({ MediaContainer: { Metadata: [] } });
    });
    const hydrated = await hydratePlexLibraryProviderIds(
        { plexToken: 'token' },
        deps,
        [
            { id: '1', title: 'Has TVDB', mediaType: 'show', tvdbId: '81189' },
            { id: '2', title: 'Needs ids', mediaType: 'show' },
        ],
        { onlyMissingBoth: true },
    );
    assert.equal(hydrated[0].tvdbId, '81189');
    assert.equal(calls.length, 1);
    assert.match(calls[0], /\/library\/metadata\/2/);
});
