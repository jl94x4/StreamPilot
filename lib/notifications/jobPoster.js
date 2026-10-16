/**
 * TMDB poster lookup for Media Automation job notifications.
 * Failures / missing keys / timeouts must never block the notify path.
 */

import { createTmdbClient } from '../portal-request/tmdbClient.js';
import { parseMediaTitleFromPath } from '../media-automation/mediaTitleFromPath.js';
import { buildNotificationPosterUrl } from './mediaMeta.js';

const DEFAULT_TIMEOUT_MS = 4000;
const CACHE_LIMIT = 500;
const posterCache = new Map();

const titleOf = (item = {}) => String(item.title || item.name || '').trim().toLowerCase();

const yearOf = (item = {}) => {
    const date = String(item.releaseDate || item.firstAirDate || '').trim();
    return date.slice(0, 4);
};

export const pickTmdbPosterResult = (results = [], { mediaType = '', year = '', title = '' } = {}) => {
    const items = (Array.isArray(results) ? results : []).filter((item) => (
        (item?.mediaType === 'tv' || item?.mediaType === 'movie') && item?.posterPath
    ));
    if (!items.length) return null;

    const typed = mediaType ? items.filter((item) => item.mediaType === mediaType) : items;
    let pool = typed.length ? typed : items;

    const wantedTitle = String(title || '').trim().toLowerCase();
    if (wantedTitle) {
        const exact = pool.filter((item) => titleOf(item) === wantedTitle);
        if (exact.length) pool = exact;
    }

    const wantedYear = String(year || '').trim();
    if (wantedYear) {
        const yeared = pool.filter((item) => yearOf(item) === wantedYear);
        if (yeared.length) return yeared[0];
    }
    return pool[0] || null;
};

const cacheGet = (key) => (posterCache.has(key) ? posterCache.get(key) : undefined);

const cacheSet = (key, value) => {
    if (posterCache.has(key)) posterCache.delete(key);
    posterCache.set(key, value);
    while (posterCache.size > CACHE_LIMIT) {
        const oldest = posterCache.keys().next().value;
        posterCache.delete(oldest);
    }
};

export const resetJobPosterCacheForTests = () => posterCache.clear();

export const lookupJobNotificationPoster = async ({
    sourcePath = '',
    config = {},
    fetchImpl,
    search,
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) => {
    const parsed = parseMediaTitleFromPath(sourcePath);
    const title = String(parsed.title || '').trim();
    if (title.length < 2) return null;

    const cacheKey = `${parsed.mediaType}|${title.toLowerCase()}|${parsed.year || ''}`;
    const cached = cacheGet(cacheKey);
    if (cached !== undefined) return cached;

    const apiKey = String(config?.tmdbApiKey || '').trim();
    if (!apiKey && typeof search !== 'function') return null;

    try {
        const searchFn = typeof search === 'function'
            ? search
            : createTmdbClient({
                tmdbApiKey: apiKey,
                fetchImpl,
                timeoutMs,
            }).search;
        const page = await searchFn(title, { language: 'en' });
        const picked = pickTmdbPosterResult(page?.results, {
            mediaType: parsed.mediaType,
            year: parsed.year,
            title,
        });
        if (!picked?.posterPath) {
            cacheSet(cacheKey, null);
            return null;
        }
        const meta = {
            mediaType: picked.mediaType || parsed.mediaType,
            tmdbId: picked.id || picked.tmdbId || null,
            posterPath: picked.posterPath,
            posterUrl: buildNotificationPosterUrl({ posterPath: picked.posterPath }),
            title: picked.title || picked.name || title,
            sourcePath: String(sourcePath || ''),
        };
        cacheSet(cacheKey, meta);
        return meta;
    } catch {
        return null;
    }
};

export { resolveJobNotifySourcePath } from '../media-automation/mediaTitleFromPath.js';

export default lookupJobNotificationPoster;
