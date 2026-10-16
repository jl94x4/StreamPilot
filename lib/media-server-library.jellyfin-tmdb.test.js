import assert from 'node:assert/strict';
import test from 'node:test';
import {
    extractTvdbIdFromPlexMeta,
    fetchJellyfinLibraryRecent,
    browseJellyfinLibraryMedia,
} from './media-server-library.js';

const withBasePath = (path) => path;

test('extractTvdbIdFromPlexMeta reads tvdb and thetvdb guids', () => {
    assert.equal(extractTvdbIdFromPlexMeta({
        Guid: [{ id: 'tvdb://78804' }, { id: 'imdb://tt0903747' }],
    }), '78804');
    assert.equal(extractTvdbIdFromPlexMeta({
        guid: 'com.plexapp.agents.thetvdb://121361?lang=en',
    }), '121361');
    assert.equal(extractTvdbIdFromPlexMeta({
        Guid: [{ id: 'tmdb://1396' }],
    }), null);
});

test('fetchJellyfinLibraryRecent prefers Series TMDB over episode rows', async () => {
    const series = [{
        Id: 'series-1',
        Name: 'Sugar',
        ProductionYear: 2024,
        DateCreated: '2024-01-01T00:00:00Z',
        ProviderIds: { Tmdb: '12345', Tvdb: '78804' },
    }];
    const episodes = [{
        Id: 'ep-1',
        SeriesId: 'series-1',
        SeriesName: 'Sugar',
        ProductionYear: 2026,
        DateCreated: '2026-01-01T00:00:00Z',
        ProviderIds: { Tmdb: '999' },
    }];
    const fetchJellyfinItems = async (_config, type) => {
        if (type === 'Movie') return [];
        if (type === 'Series') return series;
        if (type === 'Episode') return episodes;
        return [];
    };
    const result = await fetchJellyfinLibraryRecent({}, { fetchJellyfinItems, withBasePath }, { limit: 20 });
    assert.equal(result.shows.length, 1);
    assert.equal(result.shows[0].mediaType, 'show');
    assert.equal(result.shows[0].tmdbId, '12345');
    assert.equal(result.shows[0].tvdbId, '78804');
    assert.equal(result.shows[0].title, 'Sugar');
});

test('browseJellyfinLibraryMedia requests Series recursively', async () => {
    const calls = [];
    const deps = {
        resolveIntegrationUrlForFetch: () => 'http://jf.test',
        jellyfinHeaders: () => ({}),
        withBasePath,
        fetchWithTimeout: async (url) => {
            calls.push(String(url));
            if (String(url).includes('/Users/Me/Views')) {
                return {
                    ok: true,
                    json: async () => ({
                        Items: [{ Id: 'lib-tv', Name: 'TV', CollectionType: 'tvshows', ChildCount: 0 }],
                    }),
                };
            }
            if (String(url).includes('Limit=0')) {
                return {
                    ok: true,
                    json: async () => ({ Items: [], TotalRecordCount: 2 }),
                };
            }
            return {
                ok: true,
                json: async () => ({
                    Items: [{
                        Id: 'series-9',
                        Name: 'The Bear',
                        ProductionYear: 2022,
                        DateCreated: '2022-06-01T00:00:00Z',
                        ProviderIds: { Tmdb: '97546', Tvdb: '421565' },
                    }],
                    TotalRecordCount: 1,
                }),
            };
        },
    };
    const result = await browseJellyfinLibraryMedia({}, deps, {
        sectionKey: 'lib-tv',
        mediaType: 'show',
        limit: 40,
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].mediaType, 'show');
    assert.equal(result.items[0].tmdbId, '97546');
    assert.equal(result.items[0].tvdbId, '421565');
    const seriesQuery = calls.find((url) => url.includes('IncludeItemTypes=Series') && url.includes('Limit=40'));
    assert.ok(seriesQuery, 'expected Series browse request');
    assert.match(seriesQuery, /Recursive=true/);
});
