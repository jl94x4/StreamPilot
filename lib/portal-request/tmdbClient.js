/**
 * Direct TMDB API client for Discover metadata (Phase 2).
 * Returns Seerr-shaped camelCase payloads via tmdbMapper.
 */

import {
    mapCombinedCredits,
    mapMovieDetails,
    mapMovieResult,
    mapPaginatedResults,
    mapPersonDetails,
    mapPersonResult,
    mapSearchResult,
    mapSeasonDetails,
    mapTvDetails,
    mapTvResult,
    mapWatchProviderList,
} from './tmdbMapper.js';

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const DETAIL_APPEND = 'credits,external_ids,videos,keywords,watch/providers,release_dates';
const TV_DETAIL_APPEND = 'credits,external_ids,videos,keywords,watch/providers';

const todayIsoDate = () => {
    const now = new Date();
    const offset = now.getTimezoneOffset();
    return new Date(now.getTime() - offset * 60 * 1000).toISOString().split('T')[0];
};

const asParams = (opts = {}) => {
    if (opts instanceof URLSearchParams) return new URLSearchParams(opts);
    if (typeof opts === 'string') return new URLSearchParams(opts);
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(opts || {})) {
        if (value == null || value === '') continue;
        params.set(key, String(value));
    }
    return params;
};

const getParam = (params, ...keys) => {
    for (const key of keys) {
        if (params.has(key)) return params.get(key);
    }
    return '';
};

/** Map Seerr/Overseerr discover query params → TMDB discover query. */
export const buildTmdbDiscoverQuery = (mediaType, opts = {}, defaults = {}) => {
    const input = asParams(opts);
    const params = new URLSearchParams();

    // Metadata locale for translated titles/overviews.
    const metadataLanguage = getParam(input, 'metadataLanguage')
        || defaults.language
        || 'en';
    const page = getParam(input, 'page') || '1';
    params.set('language', metadataLanguage);
    params.set('page', page);

    const sortBy = getParam(input, 'sortBy', 'sort_by') || 'popularity.desc';
    params.set('sort_by', sortBy);

    const region = defaults.region || '';
    if (region) params.set('region', region);

    const genre = getParam(input, 'genre', 'with_genres');
    if (genre) params.set('with_genres', genre);

    const keywords = getParam(input, 'keywords', 'with_keywords');
    if (keywords) params.set('with_keywords', keywords);

    const excludeKeywords = getParam(input, 'excludeKeywords', 'without_keywords');
    if (excludeKeywords) params.set('without_keywords', excludeKeywords);

    // Seerr discover movie/TV lists use query.language as original-language filter.
    let originalLang = '';
    if (defaults.originalLanguageFromLanguageQuery) {
        originalLang = getParam(input, 'language') || defaults.originalLanguage || '';
    } else {
        originalLang = getParam(input, 'originalLanguage') || defaults.originalLanguage || '';
    }
    if (originalLang) params.set('with_original_language', originalLang);

    const runtimeGte = getParam(input, 'withRuntimeGte', 'with_runtime.gte');
    if (runtimeGte) params.set('with_runtime.gte', runtimeGte);
    const runtimeLte = getParam(input, 'withRuntimeLte', 'with_runtime.lte');
    if (runtimeLte) params.set('with_runtime.lte', runtimeLte);

    const voteAverageGte = getParam(input, 'voteAverageGte', 'vote_average.gte');
    if (voteAverageGte) params.set('vote_average.gte', voteAverageGte);
    const voteAverageLte = getParam(input, 'voteAverageLte', 'vote_average.lte');
    if (voteAverageLte) params.set('vote_average.lte', voteAverageLte);
    const voteCountGte = getParam(input, 'voteCountGte', 'vote_count.gte');
    if (voteCountGte) params.set('vote_count.gte', voteCountGte);
    const voteCountLte = getParam(input, 'voteCountLte', 'vote_count.lte');
    if (voteCountLte) params.set('vote_count.lte', voteCountLte);

    const watchProviders = getParam(input, 'watchProviders', 'with_watch_providers');
    if (watchProviders) {
        params.set('with_watch_providers', watchProviders);
        const watchRegion = getParam(input, 'watchRegion', 'watch_region') || region || 'US';
        params.set('watch_region', watchRegion);
    }

    const certification = getParam(input, 'certification');
    if (certification) {
        params.set('certification', certification);
        params.set('certification_country', getParam(input, 'certificationCountry', 'certification_country') || 'US');
    }

    if (mediaType === 'movie') {
        const studio = getParam(input, 'studio', 'with_companies');
        if (studio) params.set('with_companies', studio);
        const dateGte = getParam(input, 'primaryReleaseDateGte', 'dateGte', 'primary_release_date.gte');
        if (dateGte) params.set('primary_release_date.gte', dateGte);
        const dateLte = getParam(input, 'primaryReleaseDateLte', 'dateLte', 'primary_release_date.lte');
        if (dateLte) params.set('primary_release_date.lte', dateLte);
    } else {
        const network = getParam(input, 'network', 'with_networks');
        if (network) params.set('with_networks', network);
        const dateGte = getParam(input, 'firstAirDateGte', 'dateGte', 'first_air_date.gte');
        if (dateGte) params.set('first_air_date.gte', dateGte);
        const dateLte = getParam(input, 'firstAirDateLte', 'dateLte', 'first_air_date.lte');
        if (dateLte) params.set('first_air_date.lte', dateLte);
        const status = getParam(input, 'status', 'with_status');
        if (status) params.set('with_status', status);
    }

    return params;
};

/**
 * @param {object} [config]
 * @param {string} [config.tmdbApiKey]
 * @param {typeof fetch} [config.fetchImpl]
 */
export const createTmdbClient = (config = {}) => {
    const apiKey = String(config.tmdbApiKey || '').trim();
    const fetchImpl = config.fetchImpl || fetch;
    const defaultLanguage = String(config.language || config.tmdbLanguage || 'en').trim() || 'en';
    const defaultRegion = String(config.region || config.discoverRegion || '').trim().toUpperCase();

    if (!apiKey) {
        const err = new Error('TMDB API key is not configured');
        err.code = 'TMDB_API_KEY_MISSING';
        throw err;
    }

    const defaultTimeoutMs = Number(config.timeoutMs) > 0 ? Number(config.timeoutMs) : 20_000;
    const resolveTimeoutMs = typeof config.resolveTimeoutMs === 'function'
        ? config.resolveTimeoutMs
        : () => defaultTimeoutMs;

    const get = async (path, query = {}, { timeoutMs } = {}) => {
        const budgetMs = timeoutMs ?? resolveTimeoutMs(path) ?? defaultTimeoutMs;
        const params = asParams(query);
        params.set('api_key', apiKey);
        const url = `${TMDB_API_BASE}${path.startsWith('/') ? path : `/${path}`}?${params.toString()}`;
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller
            ? setTimeout(() => controller.abort(), budgetMs)
            : null;
        try {
            const response = await fetchImpl(url, {
                method: 'GET',
                headers: { Accept: 'application/json' },
                signal: controller?.signal,
            });
            if (!response.ok) {
                const body = await response.text().catch(() => '');
                const err = new Error(`TMDB ${response.status}: ${body.slice(0, 200) || response.statusText}`);
                err.status = response.status;
                err.code = 'TMDB_HTTP_ERROR';
                throw err;
            }
            return response.json();
        } finally {
            if (timer) clearTimeout(timer);
        }
    };

    const search = async (query, opts = {}) => {
        const raw = await get('/search/multi', {
            query: String(query || '').trim(),
            page: opts.page || 1,
            language: opts.language || defaultLanguage,
            include_adult: opts.includeAdult === true ? 'true' : 'false',
        });
        return mapPaginatedResults(raw, mapSearchResult);
    };

    const searchPeople = async (query, opts = {}) => {
        const raw = await get('/search/person', {
            query: String(query || '').trim(),
            page: opts.page || 1,
            language: opts.language || defaultLanguage,
            include_adult: opts.includeAdult === true ? 'true' : 'false',
        });
        return mapPaginatedResults(raw, mapPersonResult);
    };

    const trending = async (opts = {}) => {
        const window = opts.window === 'day' ? 'day' : 'week';
        const mediaType = opts.mediaType || 'all';
        const raw = await get(`/trending/${mediaType}/${window}`, {
            page: opts.page || 1,
            language: opts.language || defaultLanguage,
        });
        return mapPaginatedResults(raw, (item) => {
            if (item.media_type === 'tv') return mapTvResult(item);
            if (item.media_type === 'person') return mapPersonResultSafe(item);
            return mapMovieResult(item);
        });
    };

    const mapPersonResultSafe = (person) => ({
        id: person.id,
        name: person.name,
        popularity: person.popularity,
        adult: person.adult,
        mediaType: 'person',
        profilePath: person.profile_path,
        knownFor: [],
    });

    const movie = async (tmdbId, opts = {}) => {
        const raw = await get(`/movie/${Number(tmdbId)}`, {
            language: opts.language || defaultLanguage,
            append_to_response: opts.appendToResponse || DETAIL_APPEND,
        });
        return mapMovieDetails(raw);
    };

    const tv = async (tmdbId, opts = {}) => {
        const raw = await get(`/tv/${Number(tmdbId)}`, {
            language: opts.language || defaultLanguage,
            append_to_response: opts.appendToResponse || TV_DETAIL_APPEND,
        });
        return mapTvDetails(raw);
    };

    const movieRecommendations = async (tmdbId, opts = {}) => {
        const raw = await get(`/movie/${Number(tmdbId)}/recommendations`, {
            language: opts.language || defaultLanguage,
            page: opts.page || 1,
        });
        return mapPaginatedResults(raw, (item) => mapMovieResult(item));
    };

    const tvRecommendations = async (tmdbId, opts = {}) => {
        const raw = await get(`/tv/${Number(tmdbId)}/recommendations`, {
            language: opts.language || defaultLanguage,
            page: opts.page || 1,
        });
        return mapPaginatedResults(raw, (item) => mapTvResult(item));
    };

    const tvSeason = async (tmdbId, seasonNumber, opts = {}) => {
        const raw = await get(`/tv/${Number(tmdbId)}/season/${Number(seasonNumber)}`, {
            language: opts.language || defaultLanguage,
        });
        return mapSeasonDetails(raw);
    };

    /** Single TV episode (title / overview / air_date). */
    const tvEpisode = async (tmdbId, seasonNumber, episodeNumber, opts = {}) => {
        const raw = await get(
            `/tv/${Number(tmdbId)}/season/${Number(seasonNumber)}/episode/${Number(episodeNumber)}`,
            { language: opts.language || defaultLanguage },
        );
        return {
            title: String(raw?.name || '').trim() || null,
            summary: String(raw?.overview || '').trim() || null,
            originallyAvailableAt: String(raw?.air_date || '').trim() || null,
            seasonNumber: Number(raw?.season_number ?? seasonNumber),
            episodeNumber: Number(raw?.episode_number ?? episodeNumber),
            source: 'tmdb',
            raw,
        };
    };

    const discoverMovies = async (opts = {}) => {
        const params = buildTmdbDiscoverQuery('movie', opts, {
            language: opts.metadataLanguage || opts.language || defaultLanguage,
            region: opts.region || defaultRegion,
            originalLanguage: opts.originalLanguage,
            originalLanguageFromLanguageQuery: opts.originalLanguageFromLanguageQuery === true,
        });
        const raw = await get('/discover/movie', params);
        return mapPaginatedResults(raw, (item) => mapMovieResult(item));
    };

    const discoverTv = async (opts = {}) => {
        const params = buildTmdbDiscoverQuery('tv', opts, {
            language: opts.metadataLanguage || opts.language || defaultLanguage,
            region: opts.region || defaultRegion,
            originalLanguage: opts.originalLanguage,
            originalLanguageFromLanguageQuery: opts.originalLanguageFromLanguageQuery === true,
        });
        const raw = await get('/discover/tv', params);
        return mapPaginatedResults(raw, (item) => mapTvResult(item));
    };

    const upcomingMovies = async (opts = {}) => discoverMovies({
        ...opts,
        primaryReleaseDateGte: opts.primaryReleaseDateGte || todayIsoDate(),
        sortBy: opts.sortBy || 'popularity.desc',
        // Prefer explicit originalLanguage; do not treat metadata `language` as original filter.
        originalLanguageFromLanguageQuery: false,
        originalLanguage: opts.originalLanguage,
        metadataLanguage: opts.language || opts.metadataLanguage || defaultLanguage,
    });

    const upcomingTv = async (opts = {}) => discoverTv({
        ...opts,
        firstAirDateGte: opts.firstAirDateGte || todayIsoDate(),
        sortBy: opts.sortBy || 'popularity.desc',
        originalLanguageFromLanguageQuery: false,
        originalLanguage: opts.originalLanguage,
        metadataLanguage: opts.language || opts.metadataLanguage || defaultLanguage,
    });

    const person = async (personId, opts = {}) => {
        const raw = await get(`/person/${Number(personId)}`, {
            language: opts.language || defaultLanguage,
            append_to_response: opts.appendToResponse || 'external_ids',
        });
        return mapPersonDetails(raw);
    };

    const personCombinedCredits = async (personId, opts = {}) => {
        const raw = await get(`/person/${Number(personId)}/combined_credits`, {
            language: opts.language || defaultLanguage,
        });
        return mapCombinedCredits(raw);
    };

    const genres = async (mediaType, opts = {}) => {
        const type = mediaType === 'tv' ? 'tv' : 'movie';
        const raw = await get(`/genre/${type}/list`, {
            language: opts.language || defaultLanguage,
        });
        return Array.isArray(raw?.genres) ? raw.genres : [];
    };

    const genreSlider = async (mediaType, opts = {}) => {
        // Return genre names only — backdrop fan-out is too slow for Discover home
        // (Seerr did this server-side and often timed out). Client uses static gradients
        // / optional per-genre preview fetches as fallback.
        const type = mediaType === 'tv' ? 'tv' : 'movie';
        const language = opts.language || defaultLanguage;
        const genreList = await genres(type, { language });
        return genreList
            .map((genre) => ({
                id: genre.id,
                name: genre.name,
                backdrops: [],
            }))
            .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    };

    const searchKeyword = async (query, opts = {}) => {
        const raw = await get('/search/keyword', {
            query: String(query || '').trim(),
            page: opts.page || 1,
        });
        return {
            page: raw.page || 1,
            totalPages: raw.total_pages || 1,
            totalResults: raw.total_results || 0,
            results: (raw.results || []).map((item) => ({ id: item.id, name: item.name })),
        };
    };

    const searchCompany = async (query, opts = {}) => {
        const raw = await get('/search/company', {
            query: String(query || '').trim(),
            page: opts.page || 1,
        });
        return {
            page: raw.page || 1,
            totalPages: raw.total_pages || 1,
            totalResults: raw.total_results || 0,
            results: (raw.results || []).map((item) => ({
                id: item.id,
                name: item.name,
                logoPath: item.logo_path,
                originCountry: item.origin_country,
            })),
        };
    };

    const watchProviders = async (mediaType, opts = {}) => {
        const type = mediaType === 'tv' ? 'tv' : 'movie';
        const raw = await get(`/watch/providers/${type}`, {
            language: opts.language || defaultLanguage,
            watch_region: opts.watchRegion || defaultRegion || undefined,
        });
        return mapWatchProviderList(raw);
    };

    return {
        apiKeyConfigured: true,
        search,
        searchPeople,
        trending,
        movie,
        tv,
        movieRecommendations,
        tvRecommendations,
        tvSeason,
        tvEpisode,
        discoverMovies,
        discoverTv,
        upcomingMovies,
        upcomingTv,
        person,
        personCombinedCredits,
        genres,
        genreSlider,
        searchKeyword,
        searchCompany,
        watchProviders,
        /** Low-level escape hatch for tests / future paths */
        rawGet: get,
    };
};

export default createTmdbClient;
