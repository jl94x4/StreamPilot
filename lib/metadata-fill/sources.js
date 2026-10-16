/**
 * Fetch + merge episode metadata from TMDB → TVDB → TVmaze (order configurable).
 */

import { createTmdbClient } from '../portal-request/tmdbClient.js';
import { createTvdbClient } from '../portal-request/tvdbClient.js';
import { createTvmazeClient } from '../portal-request/tvmazeClient.js';
import { resolveTvdbIdFromTmdb } from '../portal-request/sonarrSeriesMatch.js';
import { normalizeMetadataFillSourcePreference } from './settings.js';

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

const hasGaps = (merged = {}) => (
    !merged.title || !merged.summary || !merged.originallyAvailableAt
);

/** Normalize titles for disagreement checks. */
export const normalizeComparableTitle = (value) => String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const titlesDisagree = (a, b) => {
    const left = normalizeComparableTitle(a);
    const right = normalizeComparableTitle(b);
    if (!left || !right) return false;
    return left !== right;
};

const orderedSources = (tmdb, tvdb, tvmaze, prefer) => {
    if (prefer === 'tvdb') return [tvdb, tmdb, tvmaze];
    return [tmdb, tvdb, tvmaze];
};

/**
 * Merge with preferred source first. `prefer: 'auto'|'tmdb'` → TMDB then TVDB then TVmaze.
 * @returns {{ title: string|null, summary: string|null, originallyAvailableAt: string|null, sources: string[], titleConflict: boolean, titles: object }}
 */
export const mergeEpisodeMetadata = (
    tmdb = null,
    tvdb = null,
    tvmaze = null,
    { prefer = 'auto' } = {},
) => {
    const preference = normalizeMetadataFillSourcePreference(prefer);
    const ordered = orderedSources(tmdb, tvdb, tvmaze, preference);
    const sources = [];
    if (tmdb) sources.push('tmdb');
    if (tvdb) sources.push('tvdb');
    if (tvmaze) sources.push('tvmaze');
    const titles = {
        tmdb: tmdb?.title ? String(tmdb.title).trim() : null,
        tvdb: tvdb?.title ? String(tvdb.title).trim() : null,
        tvmaze: tvmaze?.title ? String(tvmaze.title).trim() : null,
    };
    return {
        title: pickText(...ordered.map((row) => row?.title)),
        summary: pickText(...ordered.map((row) => row?.summary)),
        originallyAvailableAt: pickDate(...ordered.map((row) => row?.originallyAvailableAt)),
        sources,
        titleConflict: titlesDisagree(titles.tmdb, titles.tvdb),
        titles,
    };
};

/**
 * @param {object} config portal config
 * @param {{ tmdbId?: string|number|null, tvdbId?: string|number|null, imdbId?: string|null, seasonNumber: number, episodeNumber: number }} ids
 */
export const fetchEpisodeMetadata = async (config, ids, { fetchImpl = fetch } = {}) => {
    const seasonNumber = Number(ids.seasonNumber);
    const episodeNumber = Number(ids.episodeNumber);
    if (!Number.isFinite(seasonNumber) || !Number.isFinite(episodeNumber)) {
        return {
            title: null,
            summary: null,
            originallyAvailableAt: null,
            sources: [],
            titleConflict: false,
            titles: {},
            error: 'bad-episode-index',
        };
    }

    let tmdbId = Number(ids.tmdbId);
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) tmdbId = null;
    let tvdbId = Number(ids.tvdbId);
    if (!Number.isFinite(tvdbId) || tvdbId <= 0) tvdbId = null;
    const imdbId = /^tt\d+$/i.test(String(ids.imdbId || '').trim())
        ? String(ids.imdbId).trim()
        : null;

    const prefer = normalizeMetadataFillSourcePreference(config?.metadataFillSourcePreference);

    let tmdbEp = null;
    let tvdbEp = null;
    let tvmazeEp = null;

    // Always try preferred primary first; still gather both for conflict detection when possible.
    const fetchTmdb = async () => {
        if (!tmdbId || !String(config?.tmdbApiKey || '').trim()) return;
        try {
            const tmdb = createTmdbClient({ tmdbApiKey: config.tmdbApiKey, fetchImpl });
            tmdbEp = await tmdb.tvEpisode(tmdbId, seasonNumber, episodeNumber);
        } catch {
            tmdbEp = null;
        }
    };

    const fetchTvdb = async () => {
        if (!tvdbId && tmdbId) {
            tvdbId = await resolveTvdbIdFromTmdb(config, tmdbId, { fetchImpl }).catch(() => null);
        }
        if (!tvdbId || !String(config?.tvdbApiKey || '').trim()) return;
        try {
            const tvdb = createTvdbClient(config, { fetchImpl });
            if (tvdb.enabled) {
                tvdbEp = await tvdb.getEpisode(tvdbId, seasonNumber, episodeNumber);
            }
        } catch {
            tvdbEp = null;
        }
    };

    if (prefer === 'tvdb') {
        await fetchTvdb();
        let merged = mergeEpisodeMetadata(null, tvdbEp, null, { prefer });
        if (hasGaps(merged) || !tvdbEp) {
            await fetchTmdb();
            merged = mergeEpisodeMetadata(tmdbEp, tvdbEp, null, { prefer });
        } else {
            // Still fetch TMDB when available so title-agreement can compare.
            await fetchTmdb();
            merged = mergeEpisodeMetadata(tmdbEp, tvdbEp, null, { prefer });
        }
        if (hasGaps(merged) && (tvdbId || imdbId)) {
            try {
                const tvmaze = createTvmazeClient({ fetchImpl });
                tvmazeEp = await tvmaze.getEpisode({
                    tvdbId,
                    imdbId,
                    seasonNumber,
                    episodeNumber,
                });
            } catch {
                tvmazeEp = null;
            }
            merged = mergeEpisodeMetadata(tmdbEp, tvdbEp, tvmazeEp, { prefer });
        }
        if (!merged.title && !merged.summary && !merged.originallyAvailableAt) {
            return { ...merged, error: 'no-source-data' };
        }
        return merged;
    }

    await fetchTmdb();
    // Always attempt TVDB when configured so title-agreement can compare.
    await fetchTvdb();
    let merged = mergeEpisodeMetadata(tmdbEp, tvdbEp, null, { prefer });

    if (hasGaps(merged) && (tvdbId || imdbId)) {
        try {
            const tvmaze = createTvmazeClient({ fetchImpl });
            tvmazeEp = await tvmaze.getEpisode({
                tvdbId,
                imdbId,
                seasonNumber,
                episodeNumber,
            });
        } catch {
            tvmazeEp = null;
        }
        merged = mergeEpisodeMetadata(tmdbEp, tvdbEp, tvmazeEp, { prefer });
    }

    if (!merged.title && !merged.summary && !merged.originallyAvailableAt) {
        return { ...merged, error: 'no-source-data' };
    }
    return merged;
};
