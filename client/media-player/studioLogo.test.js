import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildStreamingNetworkLogos,
    matchDiscoverCompanyByName,
    pickLogoPathFromTmdbCompanies,
    pickWatchProvidersForRegion,
    resolvePlayerStudioLogo,
    splitOverviewServiceLogos,
} from './studioLogo.js';

const networks = [
    { id: 49, name: 'HBO', logoPath: '/tuomPhY2UtuPTqqFnKMVHvSb724.png' },
    { id: 213, name: 'Netflix', logoPath: '/wwemzKWzjKYJFfCeiB57q3r4Bcm.png' },
    { id: 2739, name: 'Disney+', logoPath: '/gJ8VX6JSu3ciXHuC2dDGAo2lvwM.png' },
    { id: 2552, name: 'Apple TV+', logoPath: '/4KAy34EHvRM25Ih8wb82AuGU7zJ.png' },
    { id: 1024, name: 'Prime Video', logoPath: '/ifhbNuuVnlwYy5oXA5VIb2YR8AZ.png' },
];

const studios = [
    { id: 174, name: 'Warner Bros. Pictures', logoPath: '/ky0xOc5OrhzkZ1N6KyUxacfQsCk.png' },
    { id: 33, name: 'Universal', logoPath: '/8lvHyhjr8oUKOOy2dKXoALWKdp0.png' },
];

test('matchDiscoverCompanyByName finds HBO exactly', () => {
    const hit = matchDiscoverCompanyByName('HBO', networks);
    assert.equal(hit?.name, 'HBO');
    assert.ok(hit?.logoPath);
});

test('resolvePlayerStudioLogo matches streaming aliases', () => {
    assert.equal(resolvePlayerStudioLogo('Netflix', 'show', { networks, studios })?.name, 'Netflix');
    assert.equal(resolvePlayerStudioLogo('AppleTV', 'show', { networks, studios })?.name, 'Apple TV+');
    assert.equal(resolvePlayerStudioLogo('Apple TV Plus', 'show', { networks, studios })?.name, 'Apple TV+');
    assert.equal(resolvePlayerStudioLogo('Disney Plus', 'show', { networks, studios })?.name, 'Disney+');
    assert.equal(resolvePlayerStudioLogo('Amazon Prime Video', 'movie', { networks, studios })?.name, 'Prime Video');
});

test('resolvePlayerStudioLogo prefers streamers over studios for Netflix movies', () => {
    const hit = resolvePlayerStudioLogo('Netflix', 'movie', { networks, studios });
    assert.equal(hit?.name, 'Netflix');
});

test('buildStreamingNetworkLogos merges TMDB Netflix with Plex label', () => {
    const logos = buildStreamingNetworkLogos({
        plexName: 'Netflix',
        mediaType: 'show',
        networks,
        studios,
        tmdbNetworks: [{ id: 213, name: 'Netflix', logoPath: '/wwemzKWzjKYJFfCeiB57q3r4Bcm.png' }],
    });
    assert.equal(logos.length, 1);
    assert.equal(logos[0].name, 'Netflix');
    assert.ok(logos[0].logoPath);
});

test('pickWatchProvidersForRegion reads flatrate logos for the region', () => {
    const providers = pickWatchProvidersForRegion([
        {
            iso_3166_1: 'GB',
            flatrate: [{ id: 8, name: 'Netflix', logoPath: '/netflix.png' }],
        },
        {
            iso_3166_1: 'US',
            flatrate: [
                { id: 337, name: 'Disney Plus', logoPath: '/disney.png' },
                { id: 350, name: 'Apple TV Plus', logoPath: '/apple.png' },
            ],
        },
    ], 'US');
    assert.deepEqual(providers.map((row) => row.name), ['Disney Plus', 'Apple TV Plus']);
});

test('pickWatchProvidersForRegion collapses Peacock Premium into Peacock', () => {
    const providers = pickWatchProvidersForRegion([
        {
            iso_3166_1: 'US',
            flatrate: [
                { id: 386, name: 'Peacock', logoPath: '/peacock.png' },
                { id: 387, name: 'Peacock Premium', logoPath: '/peacock-premium.png' },
            ],
        },
    ], 'US');
    assert.deepEqual(providers.map((row) => row.name), ['Peacock']);
});

test('splitOverviewServiceLogos stacks Studio then Streaming separately', () => {
    const networks = [
        { id: 3353, name: 'Peacock', logoPath: '/peacock-wordmark.png' },
        { id: 213, name: 'Netflix', logoPath: '/netflix-wordmark.png' },
    ];
    const studios = [
        { id: 521, name: 'DreamWorks Animation', logoPath: '/dreamworks.png' },
    ];
    const split = splitOverviewServiceLogos({
        plexName: 'DreamWorks Animation',
        mediaType: 'movie',
        networks,
        studios,
        streamingProviders: [
            { name: 'Peacock Premium', logoPath: '/tiny-square.png', key: '386' },
            { name: 'Unknown Streamer', logoPath: '/ugly.png', key: '999' },
        ],
    });
    assert.deepEqual(split.studio.map((row) => row.name), ['DreamWorks Animation']);
    assert.deepEqual(split.network, []);
    assert.deepEqual(split.streaming.map((row) => row.name), ['Peacock', 'Unknown Streamer']);
    assert.equal(split.streaming[0].logoPath, '/peacock-wordmark.png');
    assert.equal(split.streaming[0].wordmark, true);
    assert.equal(split.streaming[1].logoPath, '/ugly.png');
    assert.equal(split.streaming[1].wordmark, false);
});

test('splitOverviewServiceLogos puts TV plex labels under Network', () => {
    const networks = [
        { id: 213, name: 'Netflix', logoPath: '/netflix.png' },
        { id: 2739, name: 'Disney+', logoPath: '/disney.png' },
    ];
    const split = splitOverviewServiceLogos({
        plexName: 'Netflix',
        mediaType: 'show',
        networks,
        studios: [],
        tmdbNetworks: [{ id: 213, name: 'Netflix', logoPath: '/netflix.png' }],
        streamingProviders: [{ name: 'Disney Plus', logoPath: '/tiny.png', key: '337' }],
    });
    assert.deepEqual(split.studio, []);
    assert.deepEqual(split.network.map((row) => row.name), ['Netflix']);
    assert.deepEqual(split.streaming.map((row) => row.name), ['Disney+']);
    assert.equal(split.streaming[0].wordmark, true);
});

test('splitOverviewServiceLogos skips networks without a logo image', () => {
    const split = splitOverviewServiceLogos({
        plexName: 'United Plankton Pictures',
        mediaType: 'show',
        networks: [{ id: 13, name: 'Nickelodeon', logoPath: '/nick.png' }],
        studios: [],
        tmdbNetworks: [
            { id: 13, name: 'Nickelodeon', logoPath: '/nick.png' },
            { id: 999, name: 'United Plankton Pictures' },
        ],
    });
    assert.deepEqual(split.network.map((row) => row.name), ['Nickelodeon']);
    assert.ok(split.network.every((row) => row.logoPath));
});
