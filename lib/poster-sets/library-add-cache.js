import {
    loadPosterSetsConfig,
    savePosterSetsConfig,
    warmMediaAllows,
    isPosterSetsTpdbEnabled,
} from './config.js';
import {
    enqueueTpdbLibraryTitleHydrate,
    enqueueTpdbLibraryWarm,
    logTpdbCacheActivity,
    priorityEnsureTpdbTitleCached,
    setTpdbWarmFetchTitleSets,
} from './tpdbCache.js';
import {
    fetchPlexItemProviderIds,
    fetchPlexLibraryRecent,
} from '../media-server-library.js';

const FIRST_RUN_PER_TYPE = 20;
const WEBHOOK_DEBOUNCE_MS = 2 * 60 * 1000;

/** @type {Map<string, number>} */
const recentLibraryAddKeys = new Map();
let firstRunInFlight = null;

const pruneDebounceKeys = () => {
    const now = Date.now();
    for (const [key, exp] of recentLibraryAddKeys) {
        if (exp <= now) recentLibraryAddKeys.delete(key);
    }
};

/**
 * Extract movie/show target from a Plex library.new webhook payload.
 * Episodes/seasons map to the parent show ratingKey.
 */
export const posterSetsWebhookLibraryKey = (data) => {
    const event = data?.event;
    const md = data?.Metadata || {};
    const itemType = String(md?.type || '').toLowerCase();
    if (event !== 'library.new') return null;

    if (itemType === 'movie') {
        const ratingKey = md.ratingKey != null ? String(md.ratingKey).trim() : '';
        if (!ratingKey) return null;
        return {
            ratingKey,
            mediaType: 'movie',
            title: String(md.title || '').trim() || null,
            year: Number(md.year) || null,
            metadata: md,
        };
    }

    if (itemType === 'show') {
        const ratingKey = md.ratingKey != null ? String(md.ratingKey).trim() : '';
        if (!ratingKey) return null;
        return {
            ratingKey,
            mediaType: 'show',
            title: String(md.title || '').trim() || null,
            year: Number(md.year) || null,
            metadata: md,
        };
    }

    if (itemType === 'episode' || itemType === 'season') {
        const ratingKey = String(md.grandparentRatingKey || (itemType === 'season' ? md.parentRatingKey : '') || '').trim();
        if (!ratingKey) return null;
        return {
            ratingKey,
            mediaType: 'show',
            title: String(md.grandparentTitle || md.parentTitle || '').trim() || null,
            year: Number(md.grandparentYear || md.parentYear || md.year) || null,
            metadata: md,
        };
    }

    return null;
};

const normalizeWarmItem = (row = {}) => {
    const tmdbId = String(row?.tmdbId || '').trim();
    const tvdbId = String(row?.tvdbId || '').trim();
    const hasTmdb = /^\d+$/.test(tmdbId);
    const hasTvdb = /^\d+$/.test(tvdbId);
    if (!hasTmdb && !hasTvdb) return null;
    const mediaType = String(row?.mediaType || 'movie').toLowerCase() === 'show' ? 'show' : 'movie';
    const addedAt = Number(row?.addedAt) || 0;
    return {
        ...(hasTmdb ? { tmdbId } : {}),
        ...(hasTvdb ? { tvdbId } : {}),
        title: String(row?.title || '').trim() || '',
        year: row?.year ?? null,
        mediaType,
        titleUrl: row?.titleUrl || null,
        ...(addedAt > 0 ? { addedAt } : {}),
    };
};

const hydrateCachedTitle = async (item, cached) => {
    const sets = Array.isArray(cached?.sets) ? cached.sets : [];
    if (!sets.length) return { queued: 0 };
    const tmdbId = /^\d+$/.test(String(item?.tmdbId || '').trim()) ? String(item.tmdbId) : null;
    const tvdbId = /^\d+$/.test(String(item?.tvdbId || '').trim()) ? String(item.tvdbId) : null;
    return enqueueTpdbLibraryTitleHydrate(sets, {
        force: true,
        libraryScoped: true,
        tmdbId,
        tvdbId,
        titleKey: cached.key || null,
    });
};

/**
 * Resolve TPDB set list for a library title and download all set posters/images.
 */
export const cachePosterSetsForLibraryTitle = async (item = {}, { fetchTitleSets = null } = {}) => {
    const config = await loadPosterSetsConfig();
    if (config.tpdbLocalCacheEnabled !== true) {
        return { ok: false, reason: 'cache_disabled' };
    }
    const normalized = normalizeWarmItem(item);
    if (!normalized) return { ok: false, reason: 'missing_ids' };

    if (typeof fetchTitleSets === 'function') {
        setTpdbWarmFetchTitleSets(fetchTitleSets);
    }

    const label = normalized.title
        ? `${normalized.title}${normalized.year ? ` (${normalized.year})` : ''}`
        : (normalized.tmdbId ? `tmdb ${normalized.tmdbId}` : `tvdb ${normalized.tvdbId}`);

    logTpdbCacheActivity(`Library add: caching ${label}`, {
        kind: 'cache',
        detail: normalized.tmdbId || normalized.tvdbId || null,
    });

    const cached = await priorityEnsureTpdbTitleCached(normalized);
    if (!cached?.sets?.length) {
        return { ok: true, sets: 0, hydrated: 0, title: normalized.title };
    }
    const hydrated = await hydrateCachedTitle(normalized, cached);
    return {
        ok: true,
        sets: cached.sets.length,
        hydrated: hydrated?.queued || 0,
        title: normalized.title,
    };
};

/**
 * Handle a Plex library.new event: resolve IDs from Plex, then cache + hydrate.
 */
export const handlePosterSetsLibraryAdd = async ({
    ratingKey,
    mediaType = 'movie',
    title = null,
    year = null,
    loadPortalConfig,
    mediaLibraryDeps,
    fetchTitleSets = null,
} = {}) => {
    const config = await loadPosterSetsConfig();
    if (!isPosterSetsTpdbEnabled(config) || config.tpdbLocalCacheEnabled !== true || config.tpdbCacheOnLibraryAdd !== true) {
        return { ok: false, reason: 'disabled' };
    }
    const resolvedType = mediaType === 'show' ? 'show' : 'movie';
    if (!warmMediaAllows(config.tpdbCacheWarmMedia, resolvedType)) {
        logTpdbCacheActivity(
            `Library add: skip ${title || ratingKey} — cache media is ${config.tpdbCacheWarmMedia === 'show' ? 'TV only' : 'movies only'}`,
            { kind: 'cache', detail: resolvedType },
        );
        return { ok: true, skipped: true, reason: 'media_filter' };
    }

    const key = String(ratingKey || '').trim();
    if (!key) return { ok: false, reason: 'missing_rating_key' };

    pruneDebounceKeys();
    const now = Date.now();
    if (recentLibraryAddKeys.has(key) && recentLibraryAddKeys.get(key) > now) {
        return { ok: true, duplicate: true };
    }
    recentLibraryAddKeys.set(key, now + WEBHOOK_DEBOUNCE_MS);

    const portal = typeof loadPortalConfig === 'function' ? await loadPortalConfig() : null;
    if (!portal?.plexToken) return { ok: false, reason: 'no_plex' };

    const ids = await fetchPlexItemProviderIds(portal, mediaLibraryDeps, key);
    const item = normalizeWarmItem({
        tmdbId: ids?.tmdbId,
        tvdbId: ids?.tvdbId,
        title,
        year,
        mediaType: mediaType === 'show' ? 'show' : 'movie',
    });
    if (!item) {
        logTpdbCacheActivity(
            `Library add: no TMDB/TVDB for ${title || key} — skip TPDB cache`,
            { level: 'warn', kind: 'cache', detail: key },
        );
        return { ok: false, reason: 'missing_ids', ratingKey: key };
    }

    const result = await cachePosterSetsForLibraryTitle(item, { fetchTitleSets });
    return { ...result, ratingKey: key };
};

/**
 * One-shot: warm + hydrate the last 20 movies and last 20 shows from Plex.
 */
export const maybePosterSetsFirstRunBackfill = async ({
    loadPortalConfig,
    mediaLibraryDeps,
    fetchTitleSets,
} = {}) => {
    if (firstRunInFlight) return firstRunInFlight;

    firstRunInFlight = (async () => {
        const config = await loadPosterSetsConfig();
        if (!isPosterSetsTpdbEnabled(config) || config.tpdbLocalCacheEnabled !== true) {
            return { ok: false, reason: 'cache_disabled' };
        }
        if (config.tpdbFirstRunBackfillDone === true) {
            return { ok: true, skipped: true };
        }
        if (typeof fetchTitleSets !== 'function') {
            return { ok: false, reason: 'no_fetch' };
        }
        if (!mediaLibraryDeps || typeof loadPortalConfig !== 'function') {
            return { ok: false, reason: 'no_deps' };
        }

        const portal = await loadPortalConfig();
        if (String(portal?.mediaServerType || 'plex').toLowerCase() !== 'plex') {
            await savePosterSetsConfig({ ...config, tpdbFirstRunBackfillDone: true });
            return { ok: true, skipped: true, reason: 'not_plex' };
        }
        if (!portal?.plexToken) {
            return { ok: false, reason: 'no_plex' };
        }

        const includeMovies = warmMediaAllows(config.tpdbCacheWarmMedia, 'movie');
        const includeShows = warmMediaAllows(config.tpdbCacheWarmMedia, 'show');
        logTpdbCacheActivity(
            includeMovies && includeShows
                ? `First-run backfill: last ${FIRST_RUN_PER_TYPE} movies + ${FIRST_RUN_PER_TYPE} shows`
                : includeShows
                    ? `First-run backfill: last ${FIRST_RUN_PER_TYPE} TV shows`
                    : `First-run backfill: last ${FIRST_RUN_PER_TYPE} movies`,
            { kind: 'cache' },
        );

        const recent = await fetchPlexLibraryRecent(portal, mediaLibraryDeps, {
            limit: FIRST_RUN_PER_TYPE,
        }).catch((error) => {
            logTpdbCacheActivity(
                `First-run backfill: Plex recent failed (${error?.message || error})`,
                { level: 'warn', kind: 'cache' },
            );
            return null;
        });

        const movies = includeMovies
            ? (recent?.movies || [])
                .map((row) => normalizeWarmItem({ ...row, mediaType: 'movie' }))
                .filter(Boolean)
                .slice(0, FIRST_RUN_PER_TYPE)
            : [];
        const shows = includeShows
            ? (recent?.shows || [])
                .map((row) => normalizeWarmItem({ ...row, mediaType: 'show' }))
                .filter(Boolean)
                .slice(0, FIRST_RUN_PER_TYPE)
            : [];
        const items = [...movies, ...shows];

        // Mark done before enqueue so a crash mid-warm does not re-queue forever.
        await savePosterSetsConfig({ ...config, tpdbFirstRunBackfillDone: true });

        if (!items.length) {
            logTpdbCacheActivity('First-run backfill: no recent titles with TMDB/TVDB ids', {
                level: 'warn',
                kind: 'cache',
            });
            return { ok: true, queued: 0, movies: 0, shows: 0 };
        }

        const queued = await enqueueTpdbLibraryWarm(items, fetchTitleSets, {
            force: false,
            forceHydrate: true,
            priority: true,
            autoContinue: false,
            followedCreatorsOnly: config.tpdbCacheFollowedCreatorsOnly === true,
        });

        logTpdbCacheActivity(
            `First-run backfill queued ${queued?.queued || 0} title(s)`
            + ` (${movies.length} movies, ${shows.length} shows)`
            + (queued?.skippedCached ? `, ${queued.skippedCached} already cached` : ''),
            { kind: 'cache' },
        );

        return {
            ok: true,
            queued: queued?.queued || 0,
            skippedCached: queued?.skippedCached || 0,
            movies: movies.length,
            shows: shows.length,
        };
    })().finally(() => {
        firstRunInFlight = null;
    });

    return firstRunInFlight;
};

/** Test helper — clears debounce + in-flight latch. */
export const _resetPosterSetsLibraryAddStateForTests = () => {
    recentLibraryAddKeys.clear();
    firstRunInFlight = null;
};
