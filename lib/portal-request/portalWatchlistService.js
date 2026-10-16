/**
 * Portal-native watchlist (Phase 9).
 * Live Plex Discover fetch + JSON cache under config/watchlist.
 */

import { normalizeWatchlistTarget } from '../request-app-service.js';
import { createTmdbClient } from './tmdbClient.js';
import { createJsonWatchlistStore } from './watchlistStore.js';
import { fetchPlexWatchlist } from './plexWatchlist.js';
import { getPortalRequestDefaults } from './portalRequestDefaults.js';

const SEERR_MEDIA_AVAILABLE = 5;

/**
 * Skip watchlist auto-request when the title is already in the library,
 * already requested (including failed/declined), or only a 4K upgrade remains.
 * Auto-request always files HD.
 */
const WATCHLIST_BLOCKING_REQUEST_STATUSES = new Set([1, 2, 3, 4]); // pending, approved, declined, failed

export const shouldSkipWatchlistRequest = (options, { mediaType, is4k = false } = {}) => {
    if (!options?.canRequest) return true;
    if (Number(options.mediaStatus) === SEERR_MEDIA_AVAILABLE) return true;
    const existingStatus = Number(options.existingRequestStatus);
    if (WATCHLIST_BLOCKING_REQUEST_STATUSES.has(existingStatus)) return true;
    const type = String(mediaType || '').toLowerCase() === 'tv' ? 'tv' : 'movie';
    if (type === 'movie') {
        const qualities = options.libraryQualities || {};
        if (!is4k && qualities.hd) return true;
        if (is4k && (qualities['4k'] || qualities.fourK)) return true;
    }
    return false;
};

const recordToDiscoveryItem = (record) => ({
    id: Number(record.tmdbId),
    tmdbId: Number(record.tmdbId),
    mediaType: record.mediaType === 'tv' ? 'tv' : 'movie',
    type: record.mediaType === 'tv' ? 'tv' : 'movie',
    title: record.title,
    name: record.title,
    year: record.year,
    overview: record.overview || '',
    posterPath: record.posterPath || null,
    backdropPath: record.backdropPath || null,
    releaseDate: record.mediaType === 'movie' && record.year ? `${record.year}-01-01` : null,
    firstAirDate: record.mediaType === 'tv' && record.year ? `${record.year}-01-01` : null,
    plexGuid: record.plexGuid || null,
    plexRatingKey: record.plexRatingKey || null,
    source: record.source || 'cache',
});

/**
 * @param {object} options
 * @param {string} options.dataDir
 * @param {object} options.config
 * @param {(url: string) => string} [options.resolveUrl]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(token?: string, extra?: object) => object} [options.plexHeaders]
 * @param {(sessionUser: object) => Promise<string|null>} [options.resolvePlexToken]
 * @param {object} [options.requestService] portal request service instance
 */
export const createPortalWatchlistService = ({
    dataDir,
    config,
    resolveUrl = (url) => url,
    fetchImpl = fetch,
    plexHeaders = () => ({}),
    resolvePlexToken = async () => null,
    requestService = null,
} = {}) => {
    const store = createJsonWatchlistStore({ dataDir });

    const enrichSparsePosters = async (items = []) => {
        const apiKey = String(config?.tmdbApiKey || '').trim();
        if (!apiKey || !items.length) return items;
        const client = createTmdbClient({ tmdbApiKey: apiKey, language: 'en' });
        const out = [];
        const limit = Math.min(items.length, 40);
        for (let i = 0; i < items.length; i += 1) {
            const item = items[i];
            if (i >= limit || item.posterPath) {
                out.push(item);
                continue;
            }
            try {
                const details = item.mediaType === 'tv'
                    ? await client.tv(item.tmdbId, { language: 'en' })
                    : await client.movie(item.tmdbId, { language: 'en' });
                out.push({
                    ...item,
                    title: details?.title || details?.name || item.title,
                    overview: details?.overview || item.overview || '',
                    posterPath: details?.posterPath || null,
                    backdropPath: details?.backdropPath || null,
                    releaseDate: details?.releaseDate || item.releaseDate || null,
                    firstAirDate: details?.firstAirDate || item.firstAirDate || null,
                    year: (details?.releaseDate || details?.firstAirDate || item.year || '')
                        ? String(details?.releaseDate || details?.firstAirDate || item.year).slice(0, 4)
                        : item.year,
                });
            } catch {
                out.push(item);
            }
        }
        return out;
    };

    const autoRequestWatchlistItems = async (sessionUser, items, defaults) => {
        if (!requestService?.createMemberRequest) return;
        for (const item of Array.isArray(items) ? items : []) {
            const target = normalizeWatchlistTarget(item);
            if (!target?.mediaId) continue;
            const isTv = target.mediaType === 'tv';
            if (isTv && !defaults.autoRequestTv) continue;
            if (!isTv && !defaults.autoRequestMovies) continue;
            try {
                if (requestService.getMemberRequestOptions) {
                    const options = await requestService.getMemberRequestOptions(sessionUser, {
                        mediaType: target.mediaType,
                        mediaId: target.mediaId,
                    });
                    if (shouldSkipWatchlistRequest(options, { mediaType: target.mediaType, is4k: false })) continue;
                }
                await requestService.createMemberRequest(sessionUser, {
                    mediaType: target.mediaType,
                    mediaId: target.mediaId,
                    is4k: false,
                    seasons: isTv ? 'all' : undefined,
                    meta: { autoRequestedFromWatchlist: true },
                });
            } catch {
                // Duplicate / permission / quota — skip quietly.
            }
        }
    };

    const getMemberWatchlist = async (sessionUser) => {
        const userId = String(sessionUser?.id || sessionUser?.plexId || '').trim();
        const plexToken = await resolvePlexToken(sessionUser).catch(() => null);

        if (plexToken) {
            try {
                const live = await fetchPlexWatchlist({
                    plexToken,
                    fetchImpl,
                    plexHeaders,
                });
                let results = await enrichSparsePosters(live.results || []);
                if (userId && results.length) {
                    await store.replaceUserItems(userId, results.map((item) => ({
                        userId,
                        tmdbId: item.tmdbId,
                        mediaType: item.mediaType,
                        title: item.title,
                        year: item.year,
                        overview: item.overview,
                        posterPath: item.posterPath,
                        backdropPath: item.backdropPath,
                        plexGuid: item.plexGuid,
                        plexRatingKey: item.plexRatingKey,
                        source: 'plex',
                    }))).catch(() => null);
                }

                // Background auto-request for new watchlist titles (Seerr parity).
                const defaults = getPortalRequestDefaults(config);
                if (
                    requestService?.createMemberRequest
                    && (defaults.autoRequestMovies || defaults.autoRequestTv)
                    && results.length
                ) {
                    void autoRequestWatchlistItems(sessionUser, results, defaults).catch(() => null);
                }

                return { results, source: 'plex' };
            } catch (error) {
                // Fall through to cache.
                if (!userId) return { results: [], source: 'error', error: error.message };
            }
        }

        if (!userId) return { results: [], source: 'none' };
        const cached = await store.list({ userId });
        return {
            results: cached.map(recordToDiscoveryItem),
            source: plexToken ? 'cache-fallback' : 'cache',
        };
    };

    const requestMemberWatchlist = async (sessionUser, { all = false, items = [], is4k = false } = {}) => {
        if (!requestService?.createMemberRequest) {
            const err = new Error('Portal request service is not available.');
            err.status = 500;
            throw err;
        }

        let targets = [];
        if (all) {
            const watchlist = await getMemberWatchlist(sessionUser);
            targets = (watchlist.results || [])
                .map((item) => normalizeWatchlistTarget(item))
                .filter(Boolean);
        } else {
            targets = (Array.isArray(items) ? items : [])
                .map((item) => normalizeWatchlistTarget(item))
                .filter(Boolean);
        }

        const summary = {
            submitted: 0,
            skipped: 0,
            failed: 0,
            results: [],
        };

        for (const target of targets) {
            try {
                if (requestService.getMemberRequestOptions) {
                    const options = await requestService.getMemberRequestOptions(sessionUser, {
                        mediaType: target.mediaType,
                        mediaId: target.mediaId,
                    });
                    if (!options?.canRequest) {
                        summary.skipped += 1;
                        summary.results.push({
                            ...target,
                            status: 'skipped',
                            reason: options?.blockReason || 'Not requestable',
                        });
                        continue;
                    }
                    if (shouldSkipWatchlistRequest(options, { mediaType: target.mediaType, is4k: !!is4k })) {
                        summary.skipped += 1;
                        summary.results.push({
                            ...target,
                            status: 'skipped',
                            reason: options?.blockReason || 'Already available',
                        });
                        continue;
                    }
                }

                await requestService.createMemberRequest(sessionUser, {
                    mediaType: target.mediaType,
                    mediaId: target.mediaId,
                    is4k: !!is4k,
                    seasons: target.mediaType === 'tv' ? 'all' : undefined,
                });
                summary.submitted += 1;
                summary.results.push({ ...target, status: 'submitted' });
            } catch (error) {
                summary.failed += 1;
                summary.results.push({
                    ...target,
                    status: 'failed',
                    error: error?.message || 'Request failed',
                });
            }
        }

        return summary;
    };

    return {
        store,
        getMemberWatchlist,
        requestMemberWatchlist,
    };
};

export default createPortalWatchlistService;
