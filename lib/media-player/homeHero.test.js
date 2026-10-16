import assert from 'node:assert/strict';
import test from 'node:test';
import {
    aggregateServerMostWatched,
    buildMediaPlayerHomeHero,
    clearMediaPlayerHomeHeroCache,
    easterSundayUtc,
    isMediaPlayerHomeHeroEnabled,
    isSeasonalHeroInWindow,
    normalizeMediaPlayerHomeHeroMode,
    resolveEffectiveHeroMode,
} from './homeHero.js';

test('aggregateServerMostWatched counts plays across users and rolls episodes into shows', () => {
    const ranked = aggregateServerMostWatched([
        { type: 'movie', ratingKey: '10', title: 'Movie A' },
        { type: 'movie', ratingKey: '10', title: 'Movie A' },
        { type: 'episode', ratingKey: '99', grandparentRatingKey: '20', grandparentTitle: 'Show B' },
        { type: 'episode', ratingKey: '98', grandparentRatingKey: '20', grandparentTitle: 'Show B' },
        { type: 'episode', ratingKey: '97', grandparentRatingKey: '20', grandparentTitle: 'Show B' },
        { type: 'movie', ratingKey: '11', title: 'Movie C' },
        { type: 'track', ratingKey: '55', title: 'Song' },
    ], { limit: 5 });
    assert.equal(ranked.length, 3);
    assert.equal(ranked[0].ratingKey, '20');
    assert.equal(ranked[0].type, 'show');
    assert.equal(ranked[0].plays, 3);
    assert.equal(ranked[1].ratingKey, '10');
    assert.equal(ranked[1].plays, 2);
    assert.equal(ranked[2].ratingKey, '11');
    assert.equal(ranked[2].plays, 1);
});

test('buildMediaPlayerHomeHero most_watched uses server history not library viewCount', async () => {
    clearMediaPlayerHomeHeroCache();
    let librarySorted = false;
    const fetchImpl = async (url) => {
        const href = String(url);
        if (href.includes('/images?')) {
            return { ok: true, json: async () => ({ backdrops: [{ file_path: '/mw.jpg', width: 3840 }] }) };
        }
        if (href.includes('api.themoviedb.org')) {
            return { ok: true, json: async () => ({ results: [] }) };
        }
        throw new Error(`unexpected ${href}`);
    };
    const plexJson = async (_fetch, url) => {
        const href = String(url);
        if (href.includes('/status/sessions/history/all')) {
            return {
                MediaContainer: {
                    totalSize: 3,
                    Metadata: [
                        { type: 'movie', ratingKey: '77', title: 'Popular Everywhere', Guid: [{ id: 'tmdb://77' }] },
                        { type: 'movie', ratingKey: '77', title: 'Popular Everywhere' },
                        { type: 'episode', ratingKey: '1', grandparentRatingKey: '88', grandparentTitle: 'Hit Show' },
                    ],
                },
            };
        }
        if (href.includes('/library/metadata/77')) {
            return {
                MediaContainer: {
                    Metadata: [{
                        ratingKey: '77',
                        title: 'Popular Everywhere',
                        type: 'movie',
                        year: 2020,
                        art: '/library/metadata/77/art',
                        Guid: [{ id: 'tmdb://77' }],
                    }],
                },
            };
        }
        if (href.includes('/library/metadata/88')) {
            return {
                MediaContainer: {
                    Metadata: [{
                        ratingKey: '88',
                        title: 'Hit Show',
                        type: 'show',
                        year: 2019,
                        art: '/library/metadata/88/art',
                    }],
                },
            };
        }
        if (href.includes('sort=viewCount')) {
            librarySorted = true;
            return { MediaContainer: { Metadata: [] } };
        }
        if (href.includes('/library/sections?')) {
            return { MediaContainer: { Directory: [{ key: '1', type: 'movie' }] } };
        }
        return { MediaContainer: { Metadata: [] } };
    };
    const payload = await buildMediaPlayerHomeHero({
        config: {
            mediaPlayerHomeHeroMode: 'most_watched',
            tmdbApiKey: 'key',
            serverIdentifier: 'mw-test',
        },
        uri: 'http://plex.local',
        token: 'tok',
        headers: {},
        fetchImpl,
        plexJson,
        mapPlayerItem: (meta) => ({
            ratingKey: String(meta.ratingKey),
            title: meta.title,
            type: meta.type,
            year: meta.year,
            art: meta.art,
            tmdbId: meta.Guid?.[0]?.id?.includes('77') ? 77 : null,
            canPlay: true,
        }),
    });
    assert.equal(payload.effectiveMode, 'most_watched');
    assert.equal(librarySorted, false);
    assert.ok(payload.items.length >= 1);
    assert.equal(payload.items[0].ratingKey, '77');
    clearMediaPlayerHomeHeroCache();
});

test('isMediaPlayerHomeHeroEnabled defaults on', () => {
    assert.equal(isMediaPlayerHomeHeroEnabled({}), true);
    assert.equal(isMediaPlayerHomeHeroEnabled({ mediaPlayerHomeHeroEnabled: true }), true);
    assert.equal(isMediaPlayerHomeHeroEnabled({ mediaPlayerHomeHeroEnabled: false }), false);
});

test('normalizeMediaPlayerHomeHeroMode reads mode and legacy enabled flag', () => {
    assert.equal(normalizeMediaPlayerHomeHeroMode({}), 'trending_week');
    assert.equal(normalizeMediaPlayerHomeHeroMode({ mediaPlayerHomeHeroEnabled: false }), 'off');
    assert.equal(
        normalizeMediaPlayerHomeHeroMode({
            mediaPlayerHomeHeroEnabled: false,
            mediaPlayerHomeHeroMode: 'seasonal_halloween',
        }),
        'seasonal_halloween',
    );
    assert.equal(normalizeMediaPlayerHomeHeroMode({ mediaPlayerHomeHeroMode: 'continue_watching' }), 'continue_watching');
    assert.equal(normalizeMediaPlayerHomeHeroMode({ mediaPlayerHomeHeroMode: 'nope' }), 'trending_week');
});

test('isSeasonalHeroInWindow covers fixed holiday ranges', () => {
    assert.equal(isSeasonalHeroInWindow('seasonal_halloween', new Date(Date.UTC(2026, 9, 15))), true);
    assert.equal(isSeasonalHeroInWindow('seasonal_halloween', new Date(Date.UTC(2026, 8, 30))), false);
    assert.equal(isSeasonalHeroInWindow('seasonal_christmas', new Date(Date.UTC(2026, 10, 20))), true);
    assert.equal(isSeasonalHeroInWindow('seasonal_christmas', new Date(Date.UTC(2026, 11, 27))), false);
    assert.equal(isSeasonalHeroInWindow('seasonal_nye', new Date(Date.UTC(2026, 11, 30))), true);
    assert.equal(isSeasonalHeroInWindow('seasonal_nye', new Date(Date.UTC(2026, 11, 26))), true);
    assert.equal(isSeasonalHeroInWindow('seasonal_nye', new Date(Date.UTC(2027, 0, 4))), true);
    assert.equal(isSeasonalHeroInWindow('seasonal_nye', new Date(Date.UTC(2027, 0, 5))), false);
    assert.equal(isSeasonalHeroInWindow('seasonal_nye', new Date(Date.UTC(2026, 11, 20))), false);
    assert.equal(isSeasonalHeroInWindow('seasonal_thanksgiving', new Date(Date.UTC(2026, 10, 20))), true);
    assert.equal(isSeasonalHeroInWindow('seasonal_thanksgiving', new Date(Date.UTC(2026, 10, 10))), false);
});

test('isSeasonalHeroInWindow uses Western Easter window', () => {
    const easter2026 = easterSundayUtc(2026);
    assert.equal(easter2026.toISOString().slice(0, 10), '2026-04-05');
    assert.equal(isSeasonalHeroInWindow('seasonal_easter', easter2026), true);
    assert.equal(isSeasonalHeroInWindow('seasonal_easter', new Date(easter2026.getTime() - 14 * 86400000)), true);
    assert.equal(isSeasonalHeroInWindow('seasonal_easter', new Date(easter2026.getTime() + 7 * 86400000)), true);
    assert.equal(isSeasonalHeroInWindow('seasonal_easter', new Date(easter2026.getTime() - 15 * 86400000)), false);
    assert.equal(isSeasonalHeroInWindow('seasonal_easter', new Date(easter2026.getTime() + 8 * 86400000)), false);
});

test('resolveEffectiveHeroMode falls back to trending_week outside seasonal window when limited', () => {
    const july = new Date(Date.UTC(2026, 6, 1));
    assert.equal(
        resolveEffectiveHeroMode({
            mediaPlayerHomeHeroMode: 'seasonal_halloween',
            mediaPlayerHomeHeroSeasonalInWindowOnly: true,
        }, july),
        'trending_week',
    );
    assert.equal(
        resolveEffectiveHeroMode({
            mediaPlayerHomeHeroMode: 'seasonal_halloween',
            mediaPlayerHomeHeroSeasonalInWindowOnly: false,
        }, july),
        'seasonal_halloween',
    );
    assert.equal(
        resolveEffectiveHeroMode({
            mediaPlayerHomeHeroMode: 'seasonal_halloween',
            mediaPlayerHomeHeroSeasonalInWindowOnly: true,
        }, new Date(Date.UTC(2026, 9, 20))),
        'seasonal_halloween',
    );
    assert.equal(
        resolveEffectiveHeroMode({ mediaPlayerHomeHeroMode: 'off' }, july),
        'off',
    );
});

test('buildMediaPlayerHomeHero returns disabled payload when toggled off', async () => {
    clearMediaPlayerHomeHeroCache();
    const payload = await buildMediaPlayerHomeHero({
        config: { mediaPlayerHomeHeroEnabled: false, tmdbApiKey: 'x' },
    });
    assert.equal(payload.enabled, false);
    assert.equal(payload.mode, 'off');
    assert.equal(payload.effectiveMode, 'off');
    assert.deepEqual(payload.items, []);
});

test('buildMediaPlayerHomeHero continue_watching maps viewer items and skips cache', async () => {
    clearMediaPlayerHomeHeroCache();
    const mapPlayerItem = (meta) => ({
        ratingKey: String(meta.ratingKey),
        title: meta.title,
        type: meta.type,
        year: meta.year,
        art: meta.art,
        thumb: meta.thumb,
        canPlay: true,
    });
    const first = await buildMediaPlayerHomeHero({
        config: { mediaPlayerHomeHeroMode: 'continue_watching' },
        mapPlayerItem,
        continueWatchingItems: [
            {
                ratingKey: 'cw-1',
                title: 'Almost Finished',
                type: 'movie',
                year: 2020,
                art: '/library/metadata/cw-1/art',
                summary: 'Keep going',
            },
        ],
    });
    assert.equal(first.enabled, true);
    assert.equal(first.effectiveMode, 'continue_watching');
    assert.equal(first.items.length, 1);
    assert.equal(first.items[0].ratingKey, 'cw-1');
    assert.equal(first.items[0].title, 'Almost Finished');

    const second = await buildMediaPlayerHomeHero({
        config: { mediaPlayerHomeHeroMode: 'continue_watching' },
        mapPlayerItem,
        continueWatchingItems: [
            {
                ratingKey: 'cw-2',
                title: 'Different Viewer',
                type: 'show',
                year: 2021,
                art: '/library/metadata/cw-2/art',
            },
        ],
    });
    assert.equal(second.items[0].ratingKey, 'cw-2');

    const episodeHero = await buildMediaPlayerHomeHero({
        config: { mediaPlayerHomeHeroMode: 'continue_watching' },
        mapPlayerItem,
        continueWatchingItems: [
            {
                ratingKey: 'ep-1',
                title: "BBC Dragons' Den",
                type: 'episode',
                year: 2026,
                art: '/library/metadata/ep-1/art',
                showTitle: "BBC Dragons' Den",
                summary: 'The business ideas seeking investment in this episode…',
            },
        ],
    });
    assert.equal(episodeHero.items[0].type, 'episode');
    assert.equal(episodeHero.items[0].title, "BBC Dragons' Den");
    clearMediaPlayerHomeHeroCache();
});

test('buildMediaPlayerHomeHero matches TMDB trending via GUID and caches', async () => {
    clearMediaPlayerHomeHeroCache();
    let tmdbHits = 0;
    const fetchImpl = async (url) => {
        const href = String(url);
        if (href.includes('/images?')) {
            return {
                ok: true,
                json: async () => ({
                    backdrops: [
                        { file_path: href.includes('1396') ? '/bb-hi.jpg' : '/fight-hi.jpg', width: 3840, vote_average: 8 },
                        { file_path: href.includes('1396') ? '/bb.jpg' : '/fight.jpg', width: 1280, vote_average: 5 },
                    ],
                }),
            };
        }
        if (href.includes('api.themoviedb.org')) {
            tmdbHits += 1;
            return {
                ok: true,
                json: async () => ({
                    results: [
                        {
                            id: 550,
                            media_type: 'movie',
                            title: 'Fight Club',
                            overview: 'Soap',
                            backdrop_path: '/fight.jpg',
                            poster_path: '/fight-poster.jpg',
                            release_date: '1999-10-15',
                        },
                        {
                            id: 1396,
                            media_type: 'tv',
                            name: 'Breaking Bad',
                            overview: 'Chemistry',
                            backdrop_path: '/bb.jpg',
                            first_air_date: '2008-01-20',
                        },
                    ],
                }),
            };
        }
        throw new Error(`unexpected ${href}`);
    };
    const plexJson = async (_fetch, url) => {
        const href = String(url);
        if (href.includes('/library/sections?')) {
            return {
                MediaContainer: {
                    Directory: [
                        { key: '1', type: 'movie', title: 'Movies' },
                        { key: '2', type: 'show', title: 'TV' },
                    ],
                },
            };
        }
        if (href.includes('tmdb%3A%2F%2F550') || href.includes('guid=tmdb')) {
            if (href.includes('550')) {
                return {
                    MediaContainer: {
                        Metadata: [{
                            ratingKey: '12',
                            title: 'Fight Club',
                            type: 'movie',
                            year: 1999,
                            Guid: [{ id: 'tmdb://550' }],
                        }],
                    },
                };
            }
        }
        if (href.includes('1396')) {
            return {
                MediaContainer: {
                    Metadata: [{
                        ratingKey: '44',
                        title: 'Breaking Bad',
                        type: 'show',
                        year: 2008,
                        Guid: [{ id: 'tmdb://1396' }],
                    }],
                },
            };
        }
        return { MediaContainer: { Metadata: [] } };
    };
    const mapPlayerItem = (meta) => ({
        ratingKey: String(meta.ratingKey),
        title: meta.title,
        type: meta.type,
        year: meta.year,
        logo: `/library/metadata/${meta.ratingKey}/clearLogo`,
        canPlay: true,
    });

    const first = await buildMediaPlayerHomeHero({
        config: {
            mediaPlayerHomeHeroEnabled: true,
            tmdbApiKey: 'test-key',
            serverIdentifier: 'server-1',
        },
        uri: 'http://plex.local',
        token: 'tok',
        headers: {},
        fetchImpl,
        plexJson,
        mapPlayerItem,
    });
    assert.equal(first.enabled, true);
    assert.equal(first.effectiveMode, 'trending_week');
    assert.equal(first.items.length, 2);
    assert.equal(first.items[0].title, 'Fight Club');
    assert.equal(first.items[0].ratingKey, '12');
    assert.ok(first.items[0].backdropUrl.includes('/original/fight-hi.jpg'));
    assert.equal(first.items[0].logo, '/library/metadata/12/clearLogo');
    assert.equal(first.items[1].title, 'Breaking Bad');
    assert.equal(first.reason, 'ok');

    const cached = await buildMediaPlayerHomeHero({
        config: {
            mediaPlayerHomeHeroEnabled: true,
            tmdbApiKey: 'test-key',
            serverIdentifier: 'server-1',
        },
        uri: 'http://plex.local',
        token: 'tok',
        headers: {},
        fetchImpl,
        plexJson,
        mapPlayerItem,
    });
    assert.equal(tmdbHits, 1);
    assert.equal(cached.items.length, 2);
    assert.ok(cached.items[0].backdropUrl.includes('/original/fight-hi.jpg'));
    clearMediaPlayerHomeHeroCache();
});

test('buildMediaPlayerHomeHero falls back to Plex title search', async () => {
    clearMediaPlayerHomeHeroCache();
    const fetchImpl = async (url) => {
        const href = String(url);
        if (href.includes('/images?')) {
            return {
                ok: true,
                json: async () => ({
                    backdrops: [{ file_path: '/inception-hi.jpg', width: 3840, vote_average: 9 }],
                }),
            };
        }
        if (href.includes('api.themoviedb.org')) {
            return {
                ok: true,
                json: async () => ({
                    results: [{
                        id: 27205,
                        media_type: 'movie',
                        title: 'Inception',
                        overview: 'Dreams',
                        backdrop_path: '/inception.jpg',
                        release_date: '2010-07-16',
                    }],
                }),
            };
        }
        throw new Error(`unexpected ${url}`);
    };
    const plexJson = async (_fetch, url) => {
        const href = String(url);
        if (href.includes('/library/sections?')) {
            return { MediaContainer: { Directory: [{ key: '1', type: 'movie' }] } };
        }
        if (href.includes('/hubs/search')) {
            return {
                MediaContainer: {
                    Hub: [{
                        Metadata: [{
                            ratingKey: '99',
                            title: 'Inception',
                            type: 'movie',
                            year: 2010,
                            Guid: [{ id: 'imdb://tt1375666' }],
                        }],
                    }],
                },
            };
        }
        return { MediaContainer: { Metadata: [] } };
    };
    const payload = await buildMediaPlayerHomeHero({
        config: { tmdbApiKey: 'key', serverIdentifier: 's2' },
        uri: 'http://plex.local',
        token: 'tok',
        headers: {},
        fetchImpl,
        plexJson,
        mapPlayerItem: (meta) => ({
            ratingKey: String(meta.ratingKey),
            title: meta.title,
            type: meta.type,
            year: meta.year,
            canPlay: true,
        }),
    });
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].ratingKey, '99');
    assert.ok(payload.items[0].backdropUrl.includes('/original/inception-hi.jpg'));
    clearMediaPlayerHomeHeroCache();
});

test('buildMediaPlayerHomeHero seasonal falls back to Plex search for NYE/Easter', async () => {
    clearMediaPlayerHomeHeroCache();
    const fetchImpl = async (url) => {
        const href = String(url);
        if (href.includes('/movie/55499')) {
            return {
                ok: true,
                json: async () => ({
                    id: 55499,
                    title: "New Year's Eve",
                    overview: 'Ensemble',
                    backdrop_path: '/nye.jpg',
                    poster_path: '/nye-p.jpg',
                    release_date: '2011-12-09',
                }),
            };
        }
        if (href.includes('api.themoviedb.org')) {
            return { ok: true, json: async () => ({ results: [] }) };
        }
        throw new Error(`unexpected ${href}`);
    };
    const plexJson = async (_fetch, url) => {
        const href = String(url);
        if (href.includes('/library/sections?')) {
            return { MediaContainer: { Directory: [{ key: '1', type: 'movie' }] } };
        }
        if (href.includes('/library/all?') || href.includes('guid=')) {
            return { MediaContainer: { Metadata: [] } };
        }
        if (href.includes('/hubs/search')) {
            return {
                MediaContainer: {
                    Hub: [{
                        Metadata: [{
                            ratingKey: 'nye-1',
                            title: "New Year's Eve",
                            type: 'movie',
                            year: 2011,
                            art: '/library/metadata/nye-1/art',
                            thumb: '/library/metadata/nye-1/thumb',
                        }],
                    }],
                },
            };
        }
        if (href.includes('/library/metadata/nye-1')) {
            return {
                MediaContainer: {
                    Metadata: [{
                        ratingKey: 'nye-1',
                        title: "New Year's Eve",
                        type: 'movie',
                        year: 2011,
                        art: '/library/metadata/nye-1/art',
                        thumb: '/library/metadata/nye-1/thumb',
                        summary: 'Countdown',
                    }],
                },
            };
        }
        return { MediaContainer: { Metadata: [] } };
    };
    const payload = await buildMediaPlayerHomeHero({
        config: {
            mediaPlayerHomeHeroMode: 'seasonal_nye',
            mediaPlayerHomeHeroSeasonalInWindowOnly: false,
            tmdbApiKey: 'key',
            serverIdentifier: 'nye-test',
        },
        uri: 'http://plex.local',
        token: 'tok',
        headers: {},
        fetchImpl,
        plexJson,
        mapPlayerItem: (meta) => ({
            ratingKey: String(meta.ratingKey),
            title: meta.title,
            type: meta.type,
            year: meta.year,
            art: meta.art,
            thumb: meta.thumb,
            summary: meta.summary,
            canPlay: true,
        }),
        now: new Date(Date.UTC(2026, 8, 17)),
    });
    assert.equal(payload.effectiveMode, 'seasonal_nye');
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].ratingKey, 'nye-1');
    assert.ok(payload.items[0].backdropUrl);
    clearMediaPlayerHomeHeroCache();
});
