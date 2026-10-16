/**
 * Route Seerr-shaped Discover proxy paths through the direct TMDB client.
 */

import { createTmdbClient } from './tmdbClient.js';

const emptyPage = () => ({
    page: 1,
    totalPages: 1,
    totalResults: 0,
    results: [],
});

/**
 * @param {object} config Portal config
 * @param {object} [options]
 * @param {string} [options.language] Metadata language (TMDB locale)
 * @param {string} [options.region] Discover region
 * @param {string} [options.originalLanguage] Prefs original-language filter (discover lists)
 */
export const createTmdbDiscoverRouter = (config = {}, options = {}) => {
    const timeoutForPath = typeof options.timeoutMsForPath === 'function'
        ? options.timeoutMsForPath
        : () => (Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 20_000);

    const client = createTmdbClient({
        tmdbApiKey: config.tmdbApiKey,
        language: options.language || 'en',
        region: options.region || '',
        discoverRegion: options.region || '',
        tmdbLanguage: options.language || 'en',
        fetchImpl: options.fetchImpl,
        resolveTimeoutMs: timeoutForPath,
    });

    const metadataLanguage = options.language || 'en';
    const originalLanguagePref = options.originalLanguage || '';

    /**
     * @param {string} path Normalized path (e.g. /discover/movies)
     * @param {URLSearchParams|object|string} query
     */
    const fetchPath = async (path, query = {}) => {
        const params = query instanceof URLSearchParams
            ? Object.fromEntries(query.entries())
            : { ...(query || {}) };

        const listOpts = {
            ...params,
            metadataLanguage,
            region: options.region || '',
            // Mirror Seerr: on discover movie/TV lists, `language` query = original-language filter.
            originalLanguageFromLanguageQuery: true,
            // Prefer explicit pref when query lacks language filter.
            originalLanguage: params.language || originalLanguagePref || undefined,
        };

        if (path === '/discover/trending') {
            // TMDB trending has no with_original_language — proxy post-filters by Discover Language.
            const mediaType = ['movie', 'tv', 'person'].includes(String(params.mediaType || ''))
                ? params.mediaType
                : 'all';
            return client.trending({
                page: params.page || 1,
                language: metadataLanguage,
                mediaType,
            });
        }

        if (path === '/discover/movies/upcoming') {
            return client.upcomingMovies({
                page: params.page || 1,
                language: metadataLanguage,
                region: options.region || '',
                sortBy: params.sortBy,
                originalLanguage: params.language || originalLanguagePref || undefined,
            });
        }

        if (path === '/discover/tv/upcoming') {
            return client.upcomingTv({
                page: params.page || 1,
                language: metadataLanguage,
                sortBy: params.sortBy,
                originalLanguage: params.language || originalLanguagePref || undefined,
            });
        }

        const movieStudioMatch = path.match(/^\/discover\/movies\/studio\/(\d+)$/i);
        if (movieStudioMatch) {
            return client.discoverMovies({
                ...listOpts,
                studio: movieStudioMatch[1],
                originalLanguageFromLanguageQuery: Boolean(params.language || originalLanguagePref),
            });
        }

        const tvNetworkMatch = path.match(/^\/discover\/tv\/network\/(\d+)$/i);
        if (tvNetworkMatch) {
            return client.discoverTv({
                ...listOpts,
                network: tvNetworkMatch[1],
                originalLanguageFromLanguageQuery: Boolean(params.language || originalLanguagePref),
            });
        }

        if (path === '/discover/movies' || /^\/discover\/movies\//i.test(path)) {
            // language/* and other nested routes fall through to discover with filters.
            if (/^\/discover\/movies\/language\//i.test(path)) {
                const lang = path.split('/').pop();
                return client.discoverMovies({
                    ...listOpts,
                    language: lang,
                    originalLanguageFromLanguageQuery: true,
                    metadataLanguage,
                });
            }
            return client.discoverMovies(listOpts);
        }

        if (path === '/discover/tv' || /^\/discover\/tv\//i.test(path)) {
            if (/^\/discover\/tv\/language\//i.test(path)) {
                const lang = path.split('/').pop();
                return client.discoverTv({
                    ...listOpts,
                    language: lang,
                    originalLanguageFromLanguageQuery: true,
                    metadataLanguage,
                });
            }
            return client.discoverTv(listOpts);
        }

        if (path === '/discover/genreslider/movie') {
            return client.genreSlider('movie', { language: metadataLanguage });
        }
        if (path === '/discover/genreslider/tv') {
            return client.genreSlider('tv', { language: metadataLanguage });
        }

        const movieMatch = path.match(/^\/movie\/(\d+)$/i);
        if (movieMatch) {
            return client.movie(movieMatch[1], { language: metadataLanguage });
        }
        const movieRecMatch = path.match(/^\/movie\/(\d+)\/recommendations$/i);
        if (movieRecMatch) {
            return client.movieRecommendations(movieRecMatch[1], {
                language: metadataLanguage,
                page: params.page || 1,
            });
        }

        const tvMatch = path.match(/^\/tv\/(\d+)$/i);
        if (tvMatch) {
            return client.tv(tvMatch[1], { language: metadataLanguage });
        }
        const tvRecMatch = path.match(/^\/tv\/(\d+)\/recommendations$/i);
        if (tvRecMatch) {
            return client.tvRecommendations(tvRecMatch[1], {
                language: metadataLanguage,
                page: params.page || 1,
            });
        }
        const tvSeasonMatch = path.match(/^\/tv\/(\d+)\/season\/(\d+)$/i);
        if (tvSeasonMatch) {
            return client.tvSeason(tvSeasonMatch[1], tvSeasonMatch[2], {
                language: metadataLanguage,
            });
        }

        const personMatch = path.match(/^\/person\/(\d+)$/i);
        if (personMatch) {
            return client.person(personMatch[1], { language: metadataLanguage });
        }
        const personCreditsMatch = path.match(/^\/person\/(\d+)\/combined_credits$/i);
        if (personCreditsMatch) {
            return client.personCombinedCredits(personCreditsMatch[1], {
                language: metadataLanguage,
            });
        }

        if (path === '/search') {
            return client.search(params.query || '', {
                page: params.page || 1,
                language: metadataLanguage,
            });
        }
        if (path === '/search/keyword') {
            return client.searchKeyword(params.query || '', { page: params.page || 1 });
        }
        if (path === '/search/company') {
            return client.searchCompany(params.query || '', { page: params.page || 1 });
        }

        if (path === '/watchproviders/movies') {
            return client.watchProviders('movie', {
                language: metadataLanguage,
                watchRegion: params.watchRegion || options.region || '',
            });
        }
        if (path === '/watchproviders/tv') {
            return client.watchProviders('tv', {
                language: metadataLanguage,
                watchRegion: params.watchRegion || options.region || '',
            });
        }

        // Library shelf is Seerr/Plex-backed — empty until Phase 3.
        if (path === '/media' || /^\/media\//i.test(path)) {
            return emptyPage();
        }

        const err = new Error(`TMDB discover router does not support path: ${path}`);
        err.code = 'TMDB_PATH_UNSUPPORTED';
        err.status = 404;
        throw err;
    };

    return { client, fetchPath };
};

export default createTmdbDiscoverRouter;
