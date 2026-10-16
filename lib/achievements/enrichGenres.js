/**
 * Best-effort: attach Genre tags to history rows missing them via Plex metadata lookups.
 * Uses a disk cache so warm runs need far fewer live metadata hits.
 */

import {
    itemNeedsGenreEnrichment,
    mergeGenreTagsOntoItem,
    ratingKeyFromHistoryItem,
} from './genres.js';
import {
    getCachedGenreTags,
    ingestGenreTagMap,
    setCachedGenreTags,
    shouldWarmLibraryGenres,
} from './genreCache.js';

export const ratingKeyFromItem = ratingKeyFromHistoryItem;

const prefetchedTagsForKey = (prefetched, key) => {
    if (!prefetched || !key) return null;
    if (prefetched instanceof Map) {
        const hit = prefetched.get(key);
        return Array.isArray(hit) && hit.length ? hit : null;
    }
    const hit = prefetched[key];
    return Array.isArray(hit) && hit.length ? hit : null;
};

/**
 * Mutates items in place, adding `Genre: [{ tag }]` when resolvable.
 * Cache hits and `opts.prefetched` apply even when `maxLookups` is 0.
 * @param {object[]} items
 * @param {(ratingKey: string) => Promise<string[]>} fetchGenreTags
 * @param {{ maxLookups?: number, skipCache?: boolean, prefetched?: object|Map }} [opts]
 */
export const enrichHistoryGenres = async (items, fetchGenreTags, opts = {}) => {
    if (!Array.isArray(items)) return items;
    const maxLookups = opts.maxLookups == null ? 400 : Math.max(0, Number(opts.maxLookups) || 0);
    const skipCache = opts.skipCache === true;
    const prefetched = opts.prefetched || null;
    const canFetch = typeof fetchGenreTags === 'function';

    const needKeys = [];
    const seen = new Set();
    const resolved = new Map();

    for (const item of items) {
        if (!itemNeedsGenreEnrichment(item)) continue;
        const key = ratingKeyFromHistoryItem(item);
        if (!key || seen.has(key)) continue;
        seen.add(key);

        const fromPrefetch = prefetchedTagsForKey(prefetched, key);
        if (fromPrefetch) {
            resolved.set(key, fromPrefetch);
            continue;
        }

        if (!skipCache) {
            // eslint-disable-next-line no-await-in-loop
            const cached = await getCachedGenreTags(key);
            if (cached) {
                if (cached.length) resolved.set(key, cached);
                continue;
            }
        }

        if (canFetch && needKeys.length < maxLookups) needKeys.push(key);
    }

    const live = new Map();
    if (needKeys.length && canFetch) {
        const concurrency = 6;
        let cursor = 0;
        const workers = Array.from({ length: concurrency }, async () => {
            while (cursor < needKeys.length) {
                const idx = cursor;
                cursor += 1;
                const key = needKeys[idx];
                try {
                    const tags = await fetchGenreTags(key);
                    const clean = Array.isArray(tags) ? tags.filter(Boolean) : [];
                    live.set(key, clean);
                    if (!skipCache) await setCachedGenreTags(key, clean);
                } catch {
                    live.set(key, []);
                    if (!skipCache) await setCachedGenreTags(key, []);
                }
            }
        });
        await Promise.all(workers);
    }

    for (const item of items) {
        if (!itemNeedsGenreEnrichment(item)) continue;
        const key = ratingKeyFromHistoryItem(item);
        if (!key) continue;
        const tags = resolved.get(key) || live.get(key);
        if (!tags?.length) continue;
        mergeGenreTagsOntoItem(item, tags);
    }

    return items;
};

export const warmLibraryGenreCache = async (fetchLibraryMap, { force = false } = {}) => {
    if (typeof fetchLibraryMap !== 'function') return null;
    if (!force && !(await shouldWarmLibraryGenres())) return null;
    const map = await fetchLibraryMap();
    if (!map || typeof map !== 'object') return null;
    await ingestGenreTagMap(map);
    return map;
};
