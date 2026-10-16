/**
 * "Because you watched" Discover rail — Plex watch history seed + TMDB recommendations.
 */

import { createTmdbClient } from './portal-request/tmdbClient.js';

export const extractTmdbIdFromPlexItem = (item = {}) => {
    const type = String(item.type || '').toLowerCase();
    const guids = [];
    const push = (value) => {
        const raw = String(value || '').trim();
        if (raw) guids.push(raw);
    };
    // Episode guids often include the episode TMDB id first; companion/Discover need the series id.
    if (type === 'episode') {
        push(item.grandparentGuid);
        push(item.parentGuid);
    }
    if (Array.isArray(item.Guid)) {
        for (const entry of item.Guid) push(entry?.id || entry);
    }
    push(item.guid);
    if (type !== 'episode') {
        push(item.grandparentGuid);
        push(item.parentGuid);
    }
    for (const raw of guids) {
        const match = raw.match(/(?:tmdb|themoviedb):\/\/(\d+)/i);
        if (match) return Number(match[1]);
    }
    return null;
};

export const resolveMediaTypeFromPlexHistory = (item = {}) => {
    const type = String(item.type || '').toLowerCase();
    if (type === 'episode') return 'tv';
    if (type === 'movie') return 'movie';
    return null;
};

export const pickBecauseYouWatchedSeed = (historyItems = []) => {
    const list = Array.isArray(historyItems) ? historyItems : [];
    for (const item of list) {
        const mediaType = resolveMediaTypeFromPlexHistory(item);
        if (!mediaType) continue;
        const tmdbId = extractTmdbIdFromPlexItem(item);
        if (!Number.isFinite(tmdbId) || tmdbId <= 0) continue;
        const title = mediaType === 'tv'
            ? (item.grandparentTitle || item.parentTitle || item.title)
            : item.title;
        return {
            mediaType,
            tmdbId,
            title: String(title || '').trim() || null,
        };
    }
    return null;
};

const normalizeRecommendation = (entry = {}, mediaType = 'movie') => {
    const id = Number(entry?.id);
    if (!Number.isFinite(id) || id <= 0) return null;
    const title = mediaType === 'tv'
        ? (entry.name || entry.title || '')
        : (entry.title || entry.name || '');
    return {
        id,
        tmdbId: id,
        mediaType,
        type: mediaType,
        title,
        name: title,
        overview: entry.overview || '',
        posterPath: entry.poster_path || entry.posterPath || null,
        backdropPath: entry.backdrop_path || entry.backdropPath || null,
        releaseDate: mediaType === 'movie' ? (entry.release_date || null) : null,
        firstAirDate: mediaType === 'tv' ? (entry.first_air_date || null) : null,
        voteAverage: entry.vote_average ?? null,
    };
};

/**
 * @param {object} config Portal config (needs tmdbApiKey)
 * @param {object} seed { mediaType, tmdbId, title? }
 */
export const fetchBecauseYouWatchedRecommendations = async (config, seed, {
    language = 'en',
    page = 1,
    fetchImpl = fetch,
} = {}) => {
    if (!seed?.mediaType || !Number.isFinite(Number(seed.tmdbId))) {
        return { seed: null, results: [], page: 1, totalPages: 1, totalResults: 0 };
    }
    const apiKey = String(config?.tmdbApiKey || '').trim();
    if (!apiKey) {
        return { seed, results: [], page: 1, totalPages: 1, totalResults: 0, error: 'TMDB not configured' };
    }

    const mediaType = seed.mediaType === 'tv' ? 'tv' : 'movie';
    const tmdbId = Number(seed.tmdbId);
    const client = createTmdbClient({ tmdbApiKey: apiKey, language, fetchImpl });
    const payload = mediaType === 'tv'
        ? await client.tvRecommendations(tmdbId, { language, page }).catch(() => null)
        : await client.movieRecommendations(tmdbId, { language, page }).catch(() => null);

    const raw = Array.isArray(payload?.results) ? payload.results : [];
    const results = raw
        .map((entry) => normalizeRecommendation(entry, mediaType))
        .filter(Boolean);

    return {
        seed: {
            mediaType,
            tmdbId,
            title: seed.title || null,
        },
        results,
        page: Number(payload?.page) || 1,
        totalPages: Number(payload?.total_pages) || 1,
        totalResults: Number(payload?.total_results) || results.length,
    };
};
