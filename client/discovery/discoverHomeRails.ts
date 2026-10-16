import type { FilterState } from './FilterDrawer';
import { resolveMediaAvailabilityState } from './discoverAvailability';
import {
    buildMovieFilterPath,
    buildSeriesFilterPath,
    defaultMovieFilters,
} from './discoverUrlUtils';

export type DiscoverPosterRail = {
    id: string;
    titleKey: string;
    titleVars?: Record<string, string>;
    buildUrl: (page: number) => string;
    viewAllPath: () => string;
};

const isoDate = (value: Date) => value.toISOString().slice(0, 10);

export const yearAgoIso = () => {
    const from = new Date();
    from.setFullYear(from.getFullYear() - 1);
    return isoDate(from);
};

const moviePath = (partial: Partial<FilterState>) => (
    buildMovieFilterPath({ ...defaultMovieFilters(), ...partial })
);

const seriesPath = (partial: Partial<FilterState>) => (
    buildSeriesFilterPath({ ...defaultMovieFilters(), ...partial })
);

export const discoverRowPath = (id: string) => `/discovery/row/${id}`;

export const EXTRA_MOVIE_RAILS: DiscoverPosterRail[] = [
    {
        id: 'trending-movies',
        titleKey: 'home.trendingMovies',
        buildUrl: (page) => `/api/discovery/proxy/discover/trending?mediaType=movie&page=${page}`,
        viewAllPath: () => discoverRowPath('trending-movies'),
    },
    {
        id: 'top-rated-movies',
        titleKey: 'home.topRatedMovies',
        buildUrl: (page) => `/api/discovery/proxy/discover/movies?sortBy=vote_average.desc&voteCountGte=300&page=${page}`,
        viewAllPath: () => moviePath({ sort: 'vote_average.desc', voteCountGte: '300' }),
    },
    {
        id: 'hidden-gems-movies',
        titleKey: 'home.hiddenGems',
        buildUrl: (page) => `/api/discovery/proxy/discover/movies?sortBy=vote_average.desc&voteAverageGte=7.5&voteCountGte=50&voteCountLte=1500&page=${page}`,
        viewAllPath: () => moviePath({
            sort: 'vote_average.desc',
            voteAverageGte: '7.5',
            voteCountGte: '50',
            voteCountLte: '1500',
        }),
    },
    {
        id: 'fresh-movies',
        titleKey: 'home.freshReleases',
        buildUrl: (page) => `/api/discovery/proxy/discover/movies?sortBy=primary_release_date.desc&primaryReleaseDateGte=${encodeURIComponent(yearAgoIso())}&page=${page}`,
        viewAllPath: () => moviePath({ sort: 'primary_release_date.desc', dateGte: yearAgoIso() }),
    },
    {
        id: 'action-movies',
        titleKey: 'home.popularGenre',
        titleVars: { name: 'Action' },
        buildUrl: (page) => `/api/discovery/proxy/discover/movies?sortBy=popularity.desc&genre=28&page=${page}`,
        viewAllPath: () => moviePath({ genre: '28' }),
    },
    {
        id: 'horror-movies',
        titleKey: 'home.popularGenre',
        titleVars: { name: 'Horror' },
        buildUrl: (page) => `/api/discovery/proxy/discover/movies?sortBy=popularity.desc&genre=27&page=${page}`,
        viewAllPath: () => moviePath({ genre: '27' }),
    },
    {
        id: 'animation-movies',
        titleKey: 'home.popularGenre',
        titleVars: { name: 'Animation' },
        buildUrl: (page) => `/api/discovery/proxy/discover/movies?sortBy=popularity.desc&genre=16&page=${page}`,
        viewAllPath: () => moviePath({ genre: '16' }),
    },
    {
        id: 'scifi-movies',
        titleKey: 'home.popularGenre',
        titleVars: { name: 'Science Fiction' },
        buildUrl: (page) => `/api/discovery/proxy/discover/movies?sortBy=popularity.desc&genre=878&page=${page}`,
        viewAllPath: () => moviePath({ genre: '878' }),
    },
    {
        id: 'a24-movies',
        titleKey: 'home.studioRow',
        titleVars: { name: 'A24' },
        buildUrl: (page) => `/api/discovery/proxy/discover/movies/studio/41077?page=${page}&sortBy=popularity.desc`,
        viewAllPath: () => '/discovery/movies/studio/41077',
    },
];

export const EXTRA_SERIES_RAILS: DiscoverPosterRail[] = [
    {
        id: 'trending-series',
        titleKey: 'home.trendingSeries',
        buildUrl: (page) => `/api/discovery/proxy/discover/trending?mediaType=tv&page=${page}`,
        viewAllPath: () => discoverRowPath('trending-series'),
    },
    {
        id: 'top-rated-series',
        titleKey: 'home.topRatedSeries',
        buildUrl: (page) => `/api/discovery/proxy/discover/tv?sortBy=vote_average.desc&voteCountGte=300&page=${page}`,
        viewAllPath: () => seriesPath({ sort: 'vote_average.desc', voteCountGte: '300' }),
    },
    {
        id: 'acclaimed-series',
        titleKey: 'home.criticallyAcclaimed',
        buildUrl: (page) => `/api/discovery/proxy/discover/tv?sortBy=vote_average.desc&voteAverageGte=8&voteCountGte=500&page=${page}`,
        viewAllPath: () => seriesPath({
            sort: 'vote_average.desc',
            voteAverageGte: '8',
            voteCountGte: '500',
        }),
    },
    {
        id: 'fresh-series',
        titleKey: 'home.freshPremieres',
        buildUrl: (page) => `/api/discovery/proxy/discover/tv?sortBy=first_air_date.desc&firstAirDateGte=${encodeURIComponent(yearAgoIso())}&page=${page}`,
        viewAllPath: () => seriesPath({ sort: 'first_air_date.desc', dateGte: yearAgoIso() }),
    },
    {
        id: 'airing-series',
        titleKey: 'home.currentlyAiring',
        buildUrl: (page) => `/api/discovery/proxy/discover/tv?sortBy=popularity.desc&status=0&page=${page}`,
        viewAllPath: () => seriesPath({ status: '0' }),
    },
    {
        id: 'drama-series',
        titleKey: 'home.popularGenre',
        titleVars: { name: 'Drama' },
        buildUrl: (page) => `/api/discovery/proxy/discover/tv?sortBy=popularity.desc&genre=18&page=${page}`,
        viewAllPath: () => seriesPath({ genre: '18' }),
    },
    {
        id: 'comedy-series',
        titleKey: 'home.popularGenre',
        titleVars: { name: 'Comedy' },
        buildUrl: (page) => `/api/discovery/proxy/discover/tv?sortBy=popularity.desc&genre=35&page=${page}`,
        viewAllPath: () => seriesPath({ genre: '35' }),
    },
    {
        id: 'scifi-series',
        titleKey: 'home.popularGenre',
        titleVars: { name: 'Sci-Fi & Fantasy' },
        buildUrl: (page) => `/api/discovery/proxy/discover/tv?sortBy=popularity.desc&genre=10765&page=${page}`,
        viewAllPath: () => seriesPath({ genre: '10765' }),
    },
    {
        id: 'animation-series',
        titleKey: 'home.popularGenre',
        titleVars: { name: 'Animation' },
        buildUrl: (page) => `/api/discovery/proxy/discover/tv?sortBy=popularity.desc&genre=16&page=${page}`,
        viewAllPath: () => seriesPath({ genre: '16' }),
    },
    {
        id: 'netflix-series',
        titleKey: 'home.networkRow',
        titleVars: { name: 'Netflix' },
        buildUrl: (page) => `/api/discovery/proxy/discover/tv/network/213?page=${page}&sortBy=popularity.desc`,
        viewAllPath: () => '/discovery/series/network/213',
    },
    {
        id: 'hbo-series',
        titleKey: 'home.networkRow',
        titleVars: { name: 'HBO' },
        buildUrl: (page) => `/api/discovery/proxy/discover/tv/network/49?page=${page}&sortBy=popularity.desc`,
        viewAllPath: () => '/discovery/series/network/49',
    },
    {
        id: 'apple-series',
        titleKey: 'home.networkRow',
        titleVars: { name: 'Apple TV+' },
        buildUrl: (page) => `/api/discovery/proxy/discover/tv/network/2552?page=${page}&sortBy=popularity.desc`,
        viewAllPath: () => '/discovery/series/network/2552',
    },
];

export const SEE_ALL_POSTER_RAILS: Record<string, { titleKey: string; buildUrl: (page: number) => string }> = {
    trending: {
        titleKey: 'home.trending',
        buildUrl: (page) => `/api/discovery/proxy/discover/trending?page=${page}`,
    },
    'trending-movies': {
        titleKey: 'home.trendingMovies',
        buildUrl: (page) => `/api/discovery/proxy/discover/trending?mediaType=movie&page=${page}`,
    },
    'trending-series': {
        titleKey: 'home.trendingSeries',
        buildUrl: (page) => `/api/discovery/proxy/discover/trending?mediaType=tv&page=${page}`,
    },
    'upcoming-movies': {
        titleKey: 'home.upcomingMovies',
        buildUrl: (page) => `/api/discovery/proxy/discover/movies/upcoming?page=${page}`,
    },
    'upcoming-series': {
        titleKey: 'home.upcomingSeries',
        buildUrl: (page) => `/api/discovery/proxy/discover/tv/upcoming?page=${page}`,
    },
    'because-you-watched': {
        titleKey: 'home.becauseYouWatchedFallback',
        buildUrl: (page) => `/api/discovery/because-you-watched?page=${page}`,
    },
};

export const rankContentGapItems = (sources: Array<{ item: any; boost: number }>, limit = 30): any[] => {
    const ranked = new Map<string, { item: any; score: number }>();
    const now = Date.now();
    const futureWindowMs = 21 * 24 * 60 * 60 * 1000;

    for (const entry of sources) {
        const item = entry?.item;
        if (!item) continue;
        const availability = resolveMediaAvailabilityState(item);
        if (!['none', 'pending', 'requested'].includes(availability.kind)) continue;

        const hasPoster = !!(item?.posterPath || item?.posterUrl || item?.poster);
        if (!hasPoster) continue;

        const releaseRaw = String(item?.releaseDate || item?.firstAirDate || '').trim();
        const releaseAt = releaseRaw ? Date.parse(releaseRaw) : Number.NaN;
        if (Number.isFinite(releaseAt) && releaseAt > now + futureWindowMs) continue;

        const vote = Number(item?.voteAverage ?? item?.vote_average ?? 0);
        const popularity = Number(item?.popularity ?? 0);
        const score = entry.boost
            + (Number.isFinite(vote) ? vote * 5 : 0)
            + (Number.isFinite(popularity) ? Math.min(popularity, 120) / 12 : 0);

        const mediaType = String(item?.mediaType || item?.type || (item?.firstAirDate ? 'tv' : 'movie')).toLowerCase();
        const numericId = Number(item?.tmdbId || item?.id || item?.mediaId || 0);
        const fallbackId = String(item?.title || item?.name || '').toLowerCase();
        const key = `${mediaType}:${numericId > 0 ? numericId : fallbackId}`;
        if (!key || key.endsWith(':')) continue;

        const current = ranked.get(key);
        if (!current || score > current.score) ranked.set(key, { item, score });
    }

    return Array.from(ranked.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((entry) => entry.item);
};
