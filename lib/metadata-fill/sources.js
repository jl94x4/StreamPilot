/**
 * Fetch + merge episode metadata from TMDB then TVDB.
 */

import { createTmdbClient } from '../portal-request/tmdbClient.js';
import { createTvdbClient } from '../portal-request/tvdbClient.js';
import { resolveTvdbIdFromTmdb } from '../portal-request/sonarrSeriesMatch.js';

const pickText = (...values) => {
    for (const value of values) {
        const text = String(value || '').trim();
        if (text) return text;
    }
    return null;
};

const pickDate = (...values) => {
    for (const value of values) {
        const day = String(value || '').trim().slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(day) && !day.startsWith('0000')) return day;
    }
    return null;
};

/**
 * Prefer TMDB, fill gaps from TVDB.
 * @returns {{ title: string|null, summary: string|null, originallyAvailableAt: string|null, sources: string[] }}
 */
export const mergeEpisodeMetadata = (tmdb = null, tvdb = null) => {
    const sources = [];
    if (tmdb) sources.push('tmdb');
    if (tvdb) sources.push('tvdb');
    return {
        title: pickText(tmdb?.title, tvdb?.title),
        summary: pickText(tmdb?.summary, tvdb?.summary),
        originallyAvailableAt: pickDate(tmdb?.originallyAvailableAt, tvdb?.originallyAvailableAt),
        sources,
    };
};

/**
 * @param {object} config portal config
 * @param {{ tmdbId?: string|number|null, tvdbId?: string|number|null, seasonNumber: number, episodeNumber: number }} ids
 */
export const fetchEpisodeMetadata = async (config, ids, { fetchImpl = fetch } = {}) => {
    const seasonNumber = Number(ids.seasonNumber);
    const episodeNumber = Number(ids.episodeNumber);
    if (!Number.isFinite(seasonNumber) || !Number.isFinite(episodeNumber)) {
        return { title: null, summary: null, originallyAvailableAt: null, sources: [], error: 'bad-episode-index' };
    }

    let tmdbId = Number(ids.tmdbId);
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) tmdbId = null;
    let tvdbId = Number(ids.tvdbId);
    if (!Number.isFinite(tvdbId) || tvdbId <= 0) tvdbId = null;

    let tmdbEp = null;
    let tvdbEp = null;

    if (tmdbId && String(config?.tmdbApiKey || '').trim()) {
        try {
            const tmdb = createTmdbClient({ tmdbApiKey: config.tmdbApiKey, fetchImpl });
            tmdbEp = await tmdb.tvEpisode(tmdbId, seasonNumber, episodeNumber);
        } catch {
            tmdbEp = null;
        }
    }

    if (!tvdbId && tmdbId) {
        tvdbId = await resolveTvdbIdFromTmdb(config, tmdbId, { fetchImpl }).catch(() => null);
    }

    if (tvdbId && String(config?.tvdbApiKey || '').trim()) {
        try {
            const tvdb = createTvdbClient(config, { fetchImpl });
            if (tvdb.enabled) {
                tvdbEp = await tvdb.getEpisode(tvdbId, seasonNumber, episodeNumber);
            }
        } catch {
            tvdbEp = null;
        }
    }

    const merged = mergeEpisodeMetadata(tmdbEp, tvdbEp);
    if (!merged.title && !merged.summary && !merged.originallyAvailableAt) {
        return { ...merged, error: 'no-source-data' };
    }
    return merged;
};
