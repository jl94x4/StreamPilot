import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildStreamingNetworkLogos,
    itemHasBillboardBrandMeta,
    matchDiscoverCompanyByName,
    pickLogoPathFromTmdbCompanies,
    listPreferredServiceLogos,
    pickPreferredServiceLogo,
    pickWatchProvidersForRegion,
    resolvePlayerBrandLogo,
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

test('pickPreferredServiceLogo: movies studio-only, TV network-only', () => {
    assert.equal(pickPreferredServiceLogo({
        streaming: [{ name: 'Netflix', logoPath: '/n.png', key: 'n' }],
        studio: [{ name: 'Marvel Studios', logoPath: '/m.svg', key: 'm' }],
        network: [{ name: 'Channel 4', logoPath: '/c4.png', key: 'c4' }],
    }, [], 'movie')?.name, 'Marvel Studios');
    assert.equal(pickPreferredServiceLogo({
        streaming: [{ name: 'Netflix', logoPath: '/n.png', key: 'n' }],
        studio: [{ name: 'Studio Lambert', logoPath: '/s.png', key: 's' }],
        network: [{ name: 'Channel 4', logoPath: '/c4.png', key: 'c4' }],
    }, [], 'show')?.name, 'Channel 4');
    // Movie ignores network; TV ignores studio when network present.
    assert.equal(pickPreferredServiceLogo({
        streaming: [],
        studio: [],
        network: [{ name: 'BBC', logoPath: '/b.png', key: 'b' }],
    }, [], 'movie'), null);
    assert.equal(pickPreferredServiceLogo({
        streaming: [{ name: 'Netflix', logoPath: '/n.png', key: 'n' }],
        studio: [{ name: 'Marvel Studios', logoPath: '/m.svg', key: 'm' }],
        network: [{ name: 'Channel 4', logoPath: '/c4.png', key: 'c4' }],
    }, [], 'show')?.name, 'Channel 4');
    assert.equal(pickPreferredServiceLogo({}), null);
});

test('pickPreferredServiceLogo falls back to streaming when studio/network empty', () => {
    assert.equal(pickPreferredServiceLogo({
        streaming: [{ name: 'Netflix', logoPath: '/n.png', key: 'n' }],
        studio: [],
        network: [],
    }, [], 'movie')?.name, 'Netflix');
    assert.equal(pickPreferredServiceLogo({
        streaming: [{ name: 'Disney+', logoPath: '/d.png', key: 'd' }],
        studio: [],
        network: [],
    }, [], 'show')?.name, 'Disney+');
    // Streaming must not beat a real network.
    assert.equal(pickPreferredServiceLogo({
        streaming: [{ name: 'Netflix', logoPath: '/n.png', key: 'n' }],
        studio: [],
        network: [{ name: 'Channel 4', logoPath: '/c4.png', key: 'c4' }],
    }, [], 'show')?.name, 'Channel 4');
});

test('pickPreferredServiceLogo uses studio before streaming when a show has no network', () => {
    assert.equal(pickPreferredServiceLogo({
        streaming: [{ name: 'Netflix', logoPath: '/n.png', key: 'n' }],
        studio: [{ name: 'Studio Lambert', logoPath: '/s.png', key: 's' }],
        network: [],
    }, [], 'show')?.name, 'Studio Lambert');
    assert.deepEqual(listPreferredServiceLogos({
        streaming: [{ name: 'Netflix', logoPath: '/n.png', key: 'n' }],
        studio: [],
        network: [],
    }, 'show').map((row) => row.name), ['Netflix']);
});

test('resolvePlayerBrandLogo falls back to a studio catalog logo', () => {
    const hit = resolvePlayerBrandLogo({
        type: 'show',
        networkLabels: [],
        studio: 'Studio Lambert',
        studioLabels: ['Netflix'],
    }, {
        networks: [{ id: 213, name: 'Netflix', logoPath: '/netflix.svg' }],
        studios: [{ id: 88, name: 'Studio Lambert', logoPath: '/lambert.png' }],
    });
    assert.equal(hit?.name, 'Studio Lambert');
});

test('listPreferredServiceLogos is type-scoped', () => {
    assert.deepEqual(listPreferredServiceLogos({
        streaming: [{ name: 'Netflix', logoPath: '/n.png', key: 'n' }],
        studio: [{ name: 'Universal', logoPath: '/u.png', key: 'u' }],
        network: [{ name: 'BBC', logoPath: '/b.png', key: 'b' }],
    }, 'movie').map((row) => row.name), ['Universal']);
    assert.deepEqual(listPreferredServiceLogos({
        streaming: [{ name: 'Netflix', logoPath: '/n.png', key: 'n' }],
        studio: [{ name: 'Marvel Studios', logoPath: '/m.svg', key: 'm' }],
        network: [{ name: 'Channel 4', logoPath: '/c4.svg', key: 'c4' }],
    }, 'show').map((row) => row.name), ['Channel 4']);
});

test('Amazon Studios movie label lands in studio as Prime Video', () => {
    const networks = [{ id: 1024, name: 'Prime Video', logoPath: '/static/logos/prime-video.svg' }];
    const split = splitOverviewServiceLogos({
        plexName: 'Amazon Studios',
        mediaType: 'movie',
        networks,
        studios: [],
        tmdbCompanies: [],
    });
    assert.equal(split.studio[0]?.name, 'Prime Video');
    assert.equal(pickPreferredServiceLogo(split, [], 'movie')?.name, 'Prime Video');
});

test('itemHasBillboardBrandMeta requires Plex Network tags for TV', () => {
    assert.equal(itemHasBillboardBrandMeta({
        type: 'episode',
        tmdbId: 999001,
        studio: '',
        showTmdbId: null,
    }), false);
    assert.equal(itemHasBillboardBrandMeta({
        type: 'episode',
        tmdbId: 999001,
        studio: 'Channel 4',
        showTmdbId: null,
        studioLabels: ['Netflix'],
    }), false);
    assert.equal(itemHasBillboardBrandMeta({
        type: 'episode',
        networkLabels: ['Channel 4'],
        showTmdbId: 42009,
    }), true);
    assert.equal(itemHasBillboardBrandMeta({
        type: 'show',
        studioLabels: ['Netflix'],
        networkLabels: [],
    }), false);
    assert.equal(itemHasBillboardBrandMeta({
        type: 'movie',
        tmdbId: 634649,
        studio: '',
    }), true);
});

test('Gogglebox: Channel 4 network; Netflix flatrate ignored on TV billboard', () => {
    const networks = [
        { id: 26, name: 'Channel 4', logoPath: '/static/logos/channel-4.png' },
        { id: 213, name: 'Netflix', logoPath: '/static/logos/netflix.svg' },
    ];
    const split = splitOverviewServiceLogos({
        plexName: 'Channel 4',
        plexNames: ['Channel 4'],
        mediaType: 'show',
        networks,
        studios: [],
        streamingProviders: [{ name: 'Netflix', logoPath: '/n.png', key: 'n' }],
        tmdbCompanies: [{ name: 'Netflix', logoPath: '/n.png' }],
        tmdbNetworks: [{ name: 'Netflix', logoPath: '/n2.png' }],
    });
    assert.equal(split.network[0]?.name, 'Channel 4');
    assert.ok(split.streaming.some((row) => row.name === 'Netflix'));
    assert.equal(pickPreferredServiceLogo(split, [], 'show')?.name, 'Channel 4');
});

test('Gogglebox: Kometa Netflix Label must not beat Plex Network Channel 4', () => {
    const networks = [
        { id: 26, name: 'Channel 4', logoPath: '/static/logos/channel-4.png' },
        { id: 213, name: 'Netflix', logoPath: '/static/logos/netflix.svg' },
    ];
    // Logo path uses networkLabels only — studioLabels may still contain Netflix Label.
    const split = splitOverviewServiceLogos({
        plexName: 'Channel 4',
        plexNames: ['Channel 4'],
        mediaType: 'show',
        networks,
        studios: [],
        streamingProviders: [{ name: 'Netflix', logoPath: '/n.png', key: 'n' }],
    });
    assert.equal(pickPreferredServiceLogo(split, [], 'show')?.name, 'Channel 4');
});

test('matchDiscoverCompanyByName maps Universal Pictures to Universal', () => {
    const hit = matchDiscoverCompanyByName('Universal Pictures', studios);
    assert.equal(hit?.name, 'Universal');
});

test('matchDiscoverCompanyByName maps Channel 4 Television to Channel 4', () => {
    const uk = [
        { id: 26, name: 'Channel 4', logoPath: '/static/logos/channel-4.png' },
        { id: 213, name: 'Netflix', logoPath: '/wwemzKWzjKYJFfCeiB57q3r4Bcm.png' },
    ];
    assert.equal(matchDiscoverCompanyByName('Channel 4 Television', uk)?.name, 'Channel 4');
    assert.equal(matchDiscoverCompanyByName('Channel 4', uk)?.name, 'Channel 4');
    assert.equal(matchDiscoverCompanyByName('All 4', uk)?.name, 'Channel 4');
    assert.equal(matchDiscoverCompanyByName('Film4', uk)?.name, 'Channel 4');
    assert.equal(resolvePlayerStudioLogo('Netflix', 'show', { networks: uk, studios: [] })?.name, 'Netflix');
});

test('movies prefer TMDB production company logos over Plex studio labels', () => {
    const studios = [
        { id: 420, name: 'Marvel Studios', logoPath: '/static/logos/marvel-studios.png' },
    ];
    const split = splitOverviewServiceLogos({
        plexName: 'Columbia Pictures',
        plexNames: ['Columbia Pictures'],
        mediaType: 'movie',
        networks: [],
        studios,
        tmdbCompanies: [
            { id: 420, name: 'Marvel Studios', logoPath: '/hUzeosd33nzE5MCNsZxCGEKTXaQ.png' },
            { id: 5, name: 'Columbia Pictures', logoPath: '/tiny.png' },
        ],
    });
    assert.equal(split.studio[0]?.name, 'Marvel Studios');
    assert.equal(split.studio[0]?.logoPath, '/static/logos/marvel-studios.png');
});

test('TMDB company with logo_path still shows when not in catalog', () => {
    const split = splitOverviewServiceLogos({
        plexName: '',
        mediaType: 'movie',
        networks: [],
        studios: [],
        tmdbCompanies: [
            { id: 9999, name: 'A24', logoPath: '/a24-tmdb.png' },
        ],
    });
    assert.equal(split.studio[0]?.name, 'A24');
    assert.equal(split.studio[0]?.logoPath, '/a24-tmdb.png');
});

test('resolvePlayerBrandLogo uses networkLabels sync without TMDB', () => {
    const networks = [
        { id: 26, name: 'Channel 4', logoPath: '/static/logos/channel-4.png' },
        { id: 213, name: 'Netflix', logoPath: '/static/logos/netflix.svg' },
    ];
    const hit = resolvePlayerBrandLogo({
        type: 'show',
        networkLabels: ['Channel 4'],
        studioLabels: ['Netflix'],
        studio: 'Netflix',
    }, { networks, studios: [] });
    assert.equal(hit?.name, 'Channel 4');
    assert.equal(hit?.logoPath, '/static/logos/channel-4.png');
});

test('resolvePlayerBrandLogo soft-fills studio when Network tags missing', () => {
    const networks = [
        { id: 26, name: 'Channel 4', logoPath: '/static/logos/channel-4.png' },
        { id: 213, name: 'Netflix', logoPath: '/static/logos/netflix.svg' },
    ];
    const hit = resolvePlayerBrandLogo({
        type: 'episode',
        networkLabels: [],
        studio: 'Channel 4',
        studioLabels: ['Netflix', 'Studio Lambert'],
    }, { networks, studios: [] });
    assert.equal(hit?.name, 'Channel 4');
});

test('splitOverviewServiceLogos prefers catalog network logos over TMDB paths', () => {
    const split = splitOverviewServiceLogos({
        plexName: '',
        mediaType: 'show',
        networks: [{ id: 26, name: 'Channel 4', logoPath: '/static/logos/channel-4.png' }],
        studios: [],
        tmdbNetworks: [{ id: 26, name: 'Channel 4', logoPath: '/tmdb-c4-missing.png' }],
    });
    assert.equal(split.network[0]?.logoPath, '/static/logos/channel-4.png');
});

test('splitOverviewServiceLogos fills catalog logo when TMDB omits logoPath', () => {
    const split = splitOverviewServiceLogos({
        plexName: '',
        mediaType: 'show',
        networks: [{ id: 4000, name: 'BBC', logoPath: '/static/logos/bbc.png' }],
        studios: [],
        tmdbNetworks: [{ id: 4, name: 'BBC One' }],
    });
    assert.equal(split.network[0]?.name, 'BBC');
    assert.equal(split.network[0]?.logoPath, '/static/logos/bbc.png');
});

test('UK and major streamer Plex labels resolve to catalog brands', () => {
    const networks = [
        { id: 4000, name: 'BBC', logoPath: '/static/logos/bbc.png' },
        { id: 5871, name: 'ITVX', logoPath: '/static/logos/itv.svg' },
        { id: 99, name: 'Channel 5', logoPath: '/static/logos/channel-5.png' },
        { id: 166, name: 'CBeebies', logoPath: '/static/logos/cbeebies.png' },
        { id: 9001, name: 'Sky Originals', logoPath: '/static/logos/sky-originals.png' },
        { id: 2739, name: 'Disney+', logoPath: '/disney.png' },
        { id: 1024, name: 'Prime Video', logoPath: '/prime.png' },
        { id: 56, name: 'Cartoon Network', logoPath: '/cn.png' },
        { id: 6, name: 'NBC', logoPath: '/nbc.png' },
        { id: 16, name: 'CBS', logoPath: '/cbs.png' },
        { id: 4330, name: 'Paramount+', logoPath: '/pplus.png' },
        { id: 4353, name: 'Discovery+', logoPath: '/dplus.png' },
    ];
    const studios = [
        { id: 3, name: 'Pixar', logoPath: '/pixar.png' },
        { id: 4, name: 'Paramount', logoPath: '/paramount.png' },
    ];
    assert.equal(resolvePlayerStudioLogo('BBC One', 'show', { networks, studios })?.name, 'BBC');
    assert.equal(resolvePlayerStudioLogo('ITVX', 'show', { networks, studios })?.name, 'ITVX');
    assert.equal(resolvePlayerStudioLogo('ITV', 'show', { networks, studios })?.name, 'ITVX');
    assert.equal(resolvePlayerStudioLogo('Channel 5', 'show', { networks, studios })?.name, 'Channel 5');
    assert.equal(resolvePlayerStudioLogo('CBeebies', 'show', { networks, studios })?.name, 'CBeebies');
    assert.equal(resolvePlayerStudioLogo('Sky Originals', 'show', { networks, studios })?.name, 'Sky Originals');
    assert.equal(resolvePlayerStudioLogo('Disney+', 'show', { networks, studios })?.name, 'Disney+');
    assert.equal(resolvePlayerStudioLogo('Amazon Prime Video', 'movie', { networks, studios })?.name, 'Prime Video');
    assert.equal(resolvePlayerStudioLogo('Cartoon Network', 'show', { networks, studios })?.name, 'Cartoon Network');
    assert.equal(resolvePlayerStudioLogo('NBC', 'show', { networks, studios })?.name, 'NBC');
    assert.equal(resolvePlayerStudioLogo('CBS', 'show', { networks, studios })?.name, 'CBS');
    assert.equal(resolvePlayerStudioLogo('Discovery+', 'show', { networks, studios })?.name, 'Discovery+');
    assert.equal(resolvePlayerStudioLogo('Pixar', 'movie', { networks, studios })?.name, 'Pixar');
});

test('splitOverviewServiceLogos uses all plex studio labels', () => {
    const split = splitOverviewServiceLogos({
        plexName: 'Obscure Finance LLC',
        plexNames: ['Obscure Finance LLC', 'Warner Bros. Pictures'],
        mediaType: 'movie',
        networks: [],
        studios,
        tmdbCompanies: [],
    });
    assert.ok(split.studio.some((row) => row.name === 'Warner Bros. Pictures'));
});

test('splitOverviewServiceLogos ranks catalog studios first', () => {
    const split = splitOverviewServiceLogos({
        plexName: '',
        mediaType: 'movie',
        networks: [],
        studios,
        tmdbCompanies: [
            { id: 999, name: 'Obscure Films', logoPath: '/obscure.png' },
            { id: 33, name: 'Universal Pictures', logoPath: '/tiny.png' },
        ],
    });
    assert.equal(split.studio[0].name, 'Universal');
});

test('splitOverviewServiceLogos uses TMDB production companies as studio fallback', () => {
    const split = splitOverviewServiceLogos({
        plexName: '',
        mediaType: 'movie',
        networks: [],
        studios: [{ id: 33, name: 'Universal', logoPath: '/u.png' }],
        tmdbCompanies: [
            { id: 999, name: 'Obscure Films', logoPath: '/obscure.png' },
            { id: 33, name: 'Universal Pictures', logoPath: '/tiny.png' },
        ],
    });
    // Catalog studios rank ahead of obscure financing companies.
    assert.deepEqual(split.studio.map((row) => row.name), ['Universal', 'Obscure Films']);
    assert.equal(split.studio[0].logoPath, '/u.png');
});
