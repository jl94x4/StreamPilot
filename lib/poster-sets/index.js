import {
    loadPosterSetsConfig,
    maskPosterSetsConfig,
    savePosterSetsConfig,
    resolveBulkFilePath,
    POSTER_SETS_DIR,
    ensurePosterSetsDir,
    warmMediaAllows,
    isPosterSetsTpdbEnabled,
    isPosterSetsTpdbSearchEnabled,
    isPosterSetsMediuxEnabled,
    resolvePosterSetsSearchProvider,
} from './config.js';
import {
    handlePosterSetsLibraryAdd,
    maybePosterSetsFirstRunBackfill,
    posterSetsWebhookLibraryKey,
} from './library-add-cache.js';
import {
    extractPosterSetsWebhookToken,
    posterSetsWebhookTokenMatches,
} from './webhook-auth.js';
import { resolvePlexWebhookPayload } from '../editions/plexWebhook.js';
import { loadPosterSetsHistory, upsertPosterSetsHistory, clearFailedPosterSetsHistory } from './history.js';
import { posterSetsWorkerReady, runPosterSetsCli, killActivePosterSetsWorker, POSTER_SETS_APP_DIR } from './runner.js';
import { OVERLAYS_DIR } from '../data-paths.js';
import {
    libraryItemToSearchTitle,
    mergePosterSearchSets,
    mergeTitleSearchWithLibrary,
    normalizeDupePreference,
    resolvePosterSetsMediaType,
    excludeBlockedHandles,
} from './searchMerge.js';
import { getBrowseRailsSnapshot, dropBrowseSetsForProvider } from './browse.js';
import { getCollectionSetsSnapshot, ensureFollowedCollectionSetsCached, dropCollectionSetsForProvider } from './collectionSets.js';
import {
    cancelPosterSetsQueueJob,
    claimNextPosterSetsJob,
    clearPosterSetsFinishedQueue,
    clearPosterSetsFailedQueue,
    clearPosterSetsQueuedJobs,
    dismissPosterSetsQueueJob,
    enqueuePosterSetsJob,
    getPosterSetsQueueJob,
    loadPosterSetsQueue,
    patchPosterSetsQueueJob,
    queueStats,
    recoverPosterSetsQueue,
    retryPosterSetsQueueJob,
    setPosterSetsQueuePaused,
    stopPosterSetsRunningJob,
} from './queue.js';
import {
    deletePosterSetsWatch,
    getPosterSetsWatch,
    listPosterSetsWatches,
    patchPosterSetsWatch,
    clearPosterSetsWatchErrors,
    replaceSameTitleWatches,
    summarizeWatchForApi,
    upsertPosterSetsWatch,
    watchStats,
} from './watches.js';
import {
    appendPosterSetsAudit,
    auditEntryFromJob,
    clearFailedPosterSetsAudit,
    finalizeRunningWatchCheckAudits,
    listPosterSetsAudit,
    patchPosterSetsAudit,
} from './audit.js';
import { explainPosterSetsPageError } from './upstreamErrors.js';
import { findOverlappingTitleWatches, formatWatchArtSlots, watchArtSlots } from './watchTitle.js';
import { buildTpdbImportUserscript } from './tpdbImportTools.js';
import { buildPosterSetsWatchingIndex, resolvePosterSetsTitleStatus } from './title-status.js';
import { togglePosterSetsTitleWatch } from './title-watch.js';
import { applyPosterSetToJellyfinLike } from './jellyfin-apply.js';
import {
    autoWatchFromApply,
    autoWatchFromBulkJob,
    autoWatchFromMissingLibrary,
    checkPosterSetsWatch,
    checkPosterSetsWatchesForSeries,
    clearStalePosterSetsWatcherIfNeeded,
    getPosterSetsWatcherPassStatus,
    isMissingLibraryApplyResult,
    missingLibraryApplyAdvice,
    isPosterSetsWatcherBusy,
    markWatchAssetsApplied,
    reapplyPosterSetsWatch,
    resetPosterSetsWatcherBusy,
    resolveAppliedAssetIdsFromResult,
    runPosterSetsWatcherPass,
    setPosterSetsEnqueueApply,
    setPosterSetsNotifyDigest,
    startPosterSetsWatcher,
} from './watcher.js';
import { runPosterSetsArrHookNow, schedulePosterSetsArrHook } from './arr-hook.js';
import {
    TPDB_IMAGE_CACHE_DIR,
    buildCachedSearchResponse,
    buildTpdbTitleCacheKey,
    clearTpdbLocalCache,
    enqueueTpdbLibraryTitleHydrate,
    enqueueTpdbLibraryWarm,
    ensureTpdbImagesCached,
    getTpdbCacheStatus,
    auditTpdbCacheDisk,
    isLibraryScopedTpdbSearch,
    isTpdbUrl,
    listTpdbCachedCoverageKeys,
    loadTpdbCachedImage,
    loadTpdbTitleCache,
    loadTpdbTitleCacheForLibraryItem,
    logTpdbCacheActivity,
    pauseTpdbCacheWork,
    previewFromTpdbSetCache,
    priorityEnsureTpdbTitleCached,
    rememberPosterdbSearchResult,
    cacheExplicitTpdbUrl,
    resolveTpdbTitleCoverage,
    resumeTpdbCacheWork,
    resumeTpdbWarmQueueFromDisk,
    saveTpdbSetCache,
    setTpdbWarmBatchRunner,
    setTpdbWarmFetchTitleSets,
    setTpdbRefreshFetchTitleSets,
    setTpdbLibraryContinueFn,
    stopTpdbCacheWork,
    storeTpdbCachedImage,
    titleCacheNeedsRevalidate,
    touchTpdbTitleRevalidated,
    startTpdbCacheDailyRefresh,
    stopTpdbCacheDailyRefresh,
    rescheduleTpdbCacheDailyRefresh,
    runTpdbCacheDailyRefreshPass,
    getTpdbDailyRefreshStatus,
    waitForTpdbRequestSlot,
} from './tpdbCache.js';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import {
    fetchJellyfinLibraryRecent,
    fetchJellyfinLibrarySections,
    fetchPlexLibraryRecent,
    fetchPlexLibrarySections,
    hydratePlexLibraryProviderIds,
    listAllJellyfinLibraryBrowseItems,
    listAllPlexLibraryBrowseItems,
    searchJellyfinLibraryMedia,
    searchPlexLibraryMedia,
} from '../media-server-library.js';
import { resolveTmdbIdFromTvdb } from '../portal-request/sonarrSeriesMatch.js';
import { coverageKeyForLibraryItem, itemIsTpdbCached } from './tpdbCacheBrowse.js';

export {
    startPosterSetsWatcher,
    setPosterSetsNotifyDigest,
    schedulePosterSetsArrHook,
    startTpdbCacheDailyRefresh,
    stopTpdbCacheDailyRefresh,
    rescheduleTpdbCacheDailyRefresh,
    runTpdbCacheDailyRefreshPass,
    maybePosterSetsFirstRunBackfill,
};

const jobs = new Map();
let queueWorkerBusy = false;
let queueTickTimer = null;
/** Job id currently executing in runQueuedJob (for stop / stale kill). */
let activeQueueJobId = null;
/** Prevents overlapping Check-all HTTP kicks before the watcher busy flag is set. */
let watchPassKickInFlight = false;

const STALE_PROGRESS_MS = 15 * 60 * 1000;
const MAX_RUNNING_MS = 50 * 60 * 1000;
const QUEUE_PROGRESS_DEBOUNCE_MS = 2000;

const applyTimeoutMs = (payload = {}) => {
    const count = Array.isArray(payload.selectedIds) && payload.selectedIds.length
        ? payload.selectedIds.length
        : (Array.isArray(payload.selectedAssets) && payload.selectedAssets.length
            ? payload.selectedAssets.length
            : 0);
    if (!count) return 45 * 60_000;
    return Math.min(45 * 60_000, Math.max(5 * 60_000, 90_000 + count * 30_000));
};

/**
 * TPDB rate-limits requests (~7s between calls, especially /api/assets).
 * Cache thumbs so grids don't re-hit upstream.
 * Keep concurrency low to avoid burning the remaining quota on cold loads.
 */
const IMAGE_PROXY_CONCURRENCY = 4;
let imageProxyActive = 0;
/** @type {Array<() => void>} */
const imageProxyWaiters = [];
const IMAGE_CACHE_DIR = path.join(POSTER_SETS_DIR, 'image-cache');
const IMAGE_CACHE_MAX_ENTRIES = 240;
const IMAGE_CACHE_MAX_BYTES = 120 * 1024 * 1024;
const IMAGE_CACHE_MAX_ITEM_BYTES = 6 * 1024 * 1024;
/** @type {Map<string, { buf: Buffer, contentType: string }>} */
const imageMemoryCache = new Map();
let imageMemoryBytes = 0;

const withImageProxySlot = async (fn) => {
    if (imageProxyActive >= IMAGE_PROXY_CONCURRENCY) {
        await new Promise((resolve) => {
            imageProxyWaiters.push(resolve);
        });
    }
    imageProxyActive += 1;
    try {
        return await fn();
    } finally {
        imageProxyActive -= 1;
        const next = imageProxyWaiters.shift();
        if (next) next();
    }
};

const imageCacheKey = (url) => crypto.createHash('sha1').update(String(url)).digest('hex');

const touchMemoryCache = (key, entry) => {
    imageMemoryCache.delete(key);
    imageMemoryCache.set(key, entry);
};

const putMemoryCache = (key, buf, contentType) => {
    if (!buf?.length || buf.length > IMAGE_CACHE_MAX_ITEM_BYTES) return;
    const existing = imageMemoryCache.get(key);
    if (existing) {
        imageMemoryBytes -= existing.buf.length;
        imageMemoryCache.delete(key);
    }
    while (
        imageMemoryCache.size
        && (
            imageMemoryCache.size >= IMAGE_CACHE_MAX_ENTRIES
            || imageMemoryBytes + buf.length > IMAGE_CACHE_MAX_BYTES
        )
    ) {
        const oldestKey = imageMemoryCache.keys().next().value;
        const oldest = imageMemoryCache.get(oldestKey);
        imageMemoryCache.delete(oldestKey);
        if (oldest) imageMemoryBytes -= oldest.buf.length;
    }
    const entry = { buf, contentType };
    imageMemoryCache.set(key, entry);
    imageMemoryBytes += buf.length;
};

const readDiskCache = async (key) => {
    const binPath = path.join(IMAGE_CACHE_DIR, `${key}.bin`);
    const metaPath = path.join(IMAGE_CACHE_DIR, `${key}.json`);
    try {
        const [buf, metaRaw] = await Promise.all([
            fs.readFile(binPath),
            fs.readFile(metaPath, 'utf8'),
        ]);
        const meta = JSON.parse(metaRaw);
        const contentType = String(meta?.contentType || 'image/jpeg');
        if (!buf.length) return null;
        return { buf, contentType };
    } catch {
        return null;
    }
};

const writeDiskCache = async (key, buf, contentType, sourceUrl) => {
    if (!buf?.length || buf.length > IMAGE_CACHE_MAX_ITEM_BYTES) return;
    try {
        await ensurePosterSetsDir();
        await fs.mkdir(IMAGE_CACHE_DIR, { recursive: true });
        await Promise.all([
            fs.writeFile(path.join(IMAGE_CACHE_DIR, `${key}.bin`), buf),
            fs.writeFile(
                path.join(IMAGE_CACHE_DIR, `${key}.json`),
                JSON.stringify({
                    contentType,
                    url: sourceUrl,
                    at: new Date().toISOString(),
                    bytes: buf.length,
                }),
            ),
        ]);
    } catch {
        // cache is best-effort
    }
};

const loadCachedImage = async (url) => {
    const key = imageCacheKey(url);
    const mem = imageMemoryCache.get(key);
    if (mem) {
        touchMemoryCache(key, mem);
        return mem;
    }
    if (isTpdbUrl(url)) {
        const tpdb = await loadTpdbCachedImage(url);
        if (tpdb) {
            putMemoryCache(key, tpdb.buf, tpdb.contentType);
            return { buf: tpdb.buf, contentType: tpdb.contentType };
        }
    }
    const disk = await readDiskCache(key);
    if (disk) {
        putMemoryCache(key, disk.buf, disk.contentType);
        return disk;
    }
    return null;
};

const storeCachedImage = async (url, buf, contentType) => {
    const key = imageCacheKey(url);
    putMemoryCache(key, buf, contentType);
    await writeDiskCache(key, buf, contentType, url);
    if (isTpdbUrl(url)) {
        await storeTpdbCachedImage(url, buf, contentType).catch(() => {});
    }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getJob = async (id) => {
    const live = jobs.get(String(id));
    if (live) return live;
    return getPosterSetsQueueJob(id);
};

const mirrorJob = (job) => {
    if (!job?.id) return;
    jobs.set(String(job.id), job);
    if (jobs.size > 80) {
        const oldest = [...jobs.keys()].slice(0, jobs.size - 80);
        oldest.forEach((key) => jobs.delete(key));
    }
};

const listJobsSorted = async () => {
    const history = await loadPosterSetsHistory();
    const queue = await loadPosterSetsQueue();
    const byId = new Map(history.map((entry) => [entry.id, entry]));
    for (const job of queue.jobs) byId.set(job.id, job);
    for (const live of jobs.values()) byId.set(live.id, live);
    return [...byId.values()].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
};

const pickSetMeta = (job) => {
    const fromInput = job?.input?.setMeta && typeof job.input.setMeta === 'object'
        ? job.input.setMeta
        : null;
    const fromResult = job?.result?.setMeta && typeof job.result.setMeta === 'object'
        ? job.result.setMeta
        : null;
    if (!fromInput && !fromResult) return null;
    // Prefer scraped show/movie name + creator from the apply/inspect result over search card labels
    // like "Season 3".
    return {
        provider: fromResult?.provider || fromInput?.provider || null,
        setId: (fromResult?.setId ?? fromInput?.setId) != null
            ? String(fromResult?.setId ?? fromInput?.setId)
            : null,
        url: fromResult?.url || fromInput?.url || job?.input?.url || null,
        title: fromResult?.title || fromInput?.title || null,
        user: fromResult?.user || fromInput?.user || null,
        tmdbId: fromResult?.tmdbId || fromInput?.tmdbId || null,
        tvdbId: fromResult?.tvdbId || fromInput?.tvdbId || null,
        thumbUrl: fromResult?.thumbUrl || fromInput?.thumbUrl || '',
        assetCount: Number.isFinite(Number(fromResult?.assetCount ?? fromInput?.assetCount))
            ? Number(fromResult?.assetCount ?? fromInput?.assetCount)
            : null,
    };
};

const missingLibraryWatchNote = (watch, input) => {
    const label = String(watch?.title || input?.setMeta?.title || input?.url || 'Set').trim();
    return `Pinned on Watching (“${label}”) — will auto-apply when this title is in your library.`;
};

const needsPlexPosterSetsConfig = (config, jobType = 'apply') => {
    const dest = String(config?.applyDestination || 'plex').toLowerCase();
    if (jobType === 'apply' && (dest === 'jellyfin' || dest === 'emby')) return false;
    return true;
};

const fetchTmdbExternalIds = async (tmdbId, mediaType, loadPortalConfig) => {
    const id = String(tmdbId || '').trim();
    if (!/^\d+$/.test(id)) return { imdbId: null, tvdbId: null };
    try {
        const portal = typeof loadPortalConfig === 'function' ? await loadPortalConfig() : {};
        const apiKey = String(portal?.tmdbApiKey || '').trim();
        if (!apiKey) return { imdbId: null, tvdbId: null };
        const { createTmdbClient } = await import('../portal-request/tmdbClient.js');
        const client = createTmdbClient({ tmdbApiKey: apiKey, language: 'en' });
        const kind = resolvePosterSetsMediaType(mediaType, 'movie');
        const details = kind === 'show'
            ? await client.tv(Number(id), { appendToResponse: 'external_ids' })
            : await client.movie(Number(id), { appendToResponse: 'external_ids' });
        const external = details?.externalIds || details?.external_ids || {};
        const imdbRaw = external.imdb_id || external.imdbId || null;
        const tvdbRaw = external.tvdb_id || external.tvdbId || null;
        return {
            imdbId: imdbRaw ? String(imdbRaw).trim() : null,
            tvdbId: tvdbRaw != null && Number.isFinite(Number(tvdbRaw)) ? String(Number(tvdbRaw)) : null,
        };
    } catch {
        return { imdbId: null, tvdbId: null };
    }
};

const cliConfigPayload = (config, mediuxFilters) => {
    const dest = String(config?.applyDestination || 'plex').toLowerCase();
    const next = Array.isArray(mediuxFilters) && mediuxFilters.length
        ? { ...config, mediux_filters: mediuxFilters }
        : { ...config };
    next.apply_destination = dest;
    next.tpdb_image_cache_dir = TPDB_IMAGE_CACHE_DIR;
    next.tpdb_session_path = path.join(POSTER_SETS_DIR, 'tpdb-session.json');
    next.image_cache_dir = path.join(POSTER_SETS_DIR, 'image-cache');
    next.overlays_data_dir = OVERLAYS_DIR;
    return next;
};

/** Collect TPDB asset image URLs from an apply payload (selectedAssets and/or set cache rows). */
const collectTpdbApplyImageUrls = (payload = {}) => {
    const urls = [];
    const seen = new Set();
    const push = (raw) => {
        const url = String(raw || '').trim();
        if (!url || !isTpdbUrl(url) || seen.has(url)) return;
        seen.add(url);
        urls.push(url);
    };
    for (const asset of Array.isArray(payload.selectedAssets) ? payload.selectedAssets : []) {
        push(asset?.url || asset?.thumbUrl);
    }
    return urls;
};

const hasTpdbCredentials = (config) => {
    const user = String(config?.tpdb_username || config?.tpdb_login || '').trim();
    const password = String(config?.tpdb_password || '').trim();
    return Boolean(user && password && password !== '********');
};

const resolveTmdbIdForHint = async (tmdbId, titleHint, yearHint, mediaType, loadPortalConfig) => {
    const hint = String(titleHint || '').trim();
    const pinned = String(tmdbId || '').trim();
    // Library / MediUX pins are canonical — never overwrite a known TMDB id.
    if (pinned) return pinned;
    if (!hint) return null;
    try {
        const portal = typeof loadPortalConfig === 'function' ? await loadPortalConfig() : {};
        const apiKey = String(portal?.tmdbApiKey || '').trim();
        if (!apiKey) return null;
        const { createTmdbClient } = await import('../portal-request/tmdbClient.js');
        const client = createTmdbClient({ tmdbApiKey: apiKey, language: 'en' });
        const kind = resolvePosterSetsMediaType(mediaType, 'movie');
        const yearNum = yearHint != null && Number.isFinite(Number(yearHint)) ? Number(yearHint) : null;
        const queries = yearNum != null ? [`${hint} ${yearNum}`, hint] : [hint];
        for (const q of queries) {
            const page = await client.search(q, { page: 1 });
            const results = (page?.results || []).filter((item) => (
                kind === 'show' ? item.mediaType === 'tv' : item.mediaType === 'movie'
            ));
            if (!results.length) continue;
            const hintLower = hint.toLowerCase();
            const exact = results.find((item) => String(item.title || item.name || '').trim().toLowerCase() === hintLower);
            const pick = exact || results[0];
            const id = String(pick?.id || '').trim();
            if (id) return id;
        }
    } catch {
        // TMDB hint resolve is optional.
    }
    return null;
};

const jobErrorUrl = (job) => (
    job?.input?.url
    || job?.input?.setMeta?.url
    || job?.setMeta?.url
    || (Array.isArray(job?.input?.urls) ? job.input.urls[0] : null)
    || ''
);

const withExplainedJobError = (job) => {
    if (!job) return job;
    const explained = explainPosterSetsPageError(job.error, jobErrorUrl(job));
    if (!explained || explained === job.error) return job;
    return { ...job, error: explained };
};

const summarizeWatch = (watch) => {
    const summary = summarizeWatchForApi(watch);
    if (!summary) return summary;
    const explained = explainPosterSetsPageError(summary.lastError, summary.url);
    return explained && explained !== summary.lastError
        ? { ...summary, lastError: explained }
        : summary;
};

const summarizeJob = (job) => {
    const explained = withExplainedJobError(job);
    return {
        id: explained.id,
        type: explained.type,
        state: explained.state,
        createdAt: explained.createdAt,
        finishedAt: explained.finishedAt,
        error: explained.error,
        uploaded: explained.result?.uploaded ?? null,
        attempted: explained.result?.attempted ?? null,
        input: explained.input || null,
        setMeta: pickSetMeta(explained),
    };
};

export const createPosterSetsRouter = ({
    Router,
    requireAdmin,
    requirePosterSets,
    loadPortalConfig,
    importFromPortalPlex,
    mediaLibraryDeps = null,
    resetLibraryArtwork = null,
    basePath = '',
}) => {
    const router = Router();

    const webhookHealth = async (_req, res) => {
        try {
            const portal = await loadPortalConfig();
            if (!portal.posterSetsEnabled) {
                return res.status(503).json({
                    ok: false,
                    error: 'Poster Sets is disabled',
                    method: 'POST',
                    event: 'library.new',
                });
            }
            return res.json({
                ok: true,
                method: 'POST',
                event: 'library.new',
                hint: 'Plex POSTs multipart library.new events here. This GET is only a health check.',
            });
        } catch (error) {
            return res.status(500).json({ ok: false, error: error.message });
        }
    };

    // Public webhook + health (no admin session). POST requires ?token= or X-Poster-Sets-Webhook-Token.
    router.get('/webhook/healthz', webhookHealth);
    router.get('/webhook', webhookHealth);

    router.post('/webhook', async (req, res) => {
        try {
            const portal = await loadPortalConfig();
            const cfg = await loadPosterSetsConfig();
            if (!portal.posterSetsEnabled) {
                return res.status(503).json({ error: 'Poster Sets is disabled' });
            }
            if (!cfg.webhookToken || !posterSetsWebhookTokenMatches(extractPosterSetsWebhookToken(req), cfg.webhookToken)) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            let data;
            try {
                data = await resolvePlexWebhookPayload(req);
            } catch (error) {
                if (error?.status === 413) return res.status(413).json({ error: 'payload too large' });
                return res.status(400).json({ error: 'invalid json' });
            }
            if (!data) return res.status(400).json({ error: 'missing payload' });

            const target = posterSetsWebhookLibraryKey(data);
            if (!target) {
                return res.status(202).json({ ignored: true });
            }

            // Respond immediately; cache/watch work can take minutes.
            setImmediate(() => {
                if (cfg.watchersEnabled !== false) {
                    void checkPosterSetsWatchesForSeries({
                        title: target.title,
                        year: target.year,
                    }).catch((error) => {
                        logTpdbCacheActivity(
                            `Library add watch check failed: ${error?.message || error}`,
                            { level: 'warn', kind: 'watch', detail: target.ratingKey },
                        );
                    });
                }
                if (cfg.tpdbLocalCacheEnabled === true && cfg.tpdbCacheOnLibraryAdd === true) {
                    void handlePosterSetsLibraryAdd({
                        ratingKey: target.ratingKey,
                        mediaType: target.mediaType,
                        title: target.title,
                        year: target.year,
                        loadPortalConfig,
                        mediaLibraryDeps,
                        fetchTitleSets: warmFetchTitleSets,
                    }).catch((error) => {
                        logTpdbCacheActivity(
                            `Library add webhook failed: ${error?.message || error}`,
                            { level: 'warn', kind: 'cache', detail: target.ratingKey },
                        );
                    });
                }
            });

            return res.status(202).json({
                queued: true,
                ratingKey: target.ratingKey,
                mediaType: target.mediaType,
            });
        } catch (error) {
            return res.status(500).json({ error: error.message || 'Webhook failed' });
        }
    });

    router.use(requireAdmin, requirePosterSets);

    router.get('/tpdb-import.user.js', (req, res) => {
        const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim() || 'https';
        const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
        const prefix = String(basePath || '').replace(/\/+$/, '');
        const portalRoot = host ? `${proto}://${host}${prefix}` : prefix;
        const scriptUrl = `${portalRoot}/api/poster-sets/tpdb-import.user.js`;
        const script = buildTpdbImportUserscript({ portalRoot, scriptUrl, apply: false });
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.setHeader('Content-Disposition', 'inline; filename="smp-tpdb-import.user.js"');
        res.send(script);
    });

    /** When true, Warm CLI skips TPDB login and uses public text search only. */
    let warmForcePublicSearch = false;

    /** Shared Warm resolve — also used to resume a queue after process restart. */
    const warmFetchTitleSets = async (item) => {
        const config = await loadPosterSetsConfig();
        const cliConfig = cliConfigPayload(config);
        if (warmForcePublicSearch || config.tpdbUseLogin === false) {
            cliConfig.tpdbUseLogin = false;
        }
        await waitForTpdbRequestSlot();
        let imdbId = null;
        let tvdbId = String(item?.tvdbId || item?.tvdb_id || '').trim() || null;
        if (!/^\d+$/.test(String(tvdbId || ''))) tvdbId = null;
        // Mapped TVDB→TMDB must not drive TPDB search (wrong singleton /posters/ pages).
        const tmdbForSearch = (item?._tmdbMappedFromTvdb === true || item?._tvdbOnlyRetry === true)
            ? null
            : (String(item?.tmdbId || '').trim() || null);
        const tmdbSearchId = /^\d+$/.test(String(tmdbForSearch || '')) ? tmdbForSearch : null;
        if (!(warmForcePublicSearch || config.tpdbUseLogin === false) && tmdbSearchId) {
            try {
                const ext = await fetchTmdbExternalIds(tmdbSearchId, item.mediaType, loadPortalConfig);
                imdbId = ext.imdbId;
                if (!tvdbId && ext.tvdbId) tvdbId = ext.tvdbId;
            } catch {
                // Optional enrichment — title+year search may still resolve.
            }
        }

        const live = await runPosterSetsCli('search', {
            provider: 'posterdb',
            tmdbId: tmdbSearchId,
            imdbId,
            tvdbId,
            mediaType: item.mediaType,
            titleHint: item.title || null,
            yearHint: item.year,
            mode: 'title',
            limit: 48,
            config: cliConfig,
        }, { timeoutMs: 120_000 });

        if (!live.ok) {
            const errMsg = String(live.error || 'ThePosterDB search failed');
            const logHint = (Array.isArray(live.logs) ? live.logs : [])
                .map((line) => String(line || '').trim())
                .filter((line) => (
                    /login failed|credentials|redirected to login|session expired|lack Pro|no \/posters|<id> hits|advanced search found no|set load failed|skipping slow public/i.test(line)
                    && !/^Searching ThePosterDB/i.test(line)
                ))
                .slice(-2)
                .join(' | ');
            if (/title url is required|could not (resolve|find).*title page|found no \/posters|needs a \/posters|worker timed out|login failed|skipping slow public/i.test(errMsg)) {
                return {
                    sets: [],
                    softSkip: true,
                    softError: logHint ? `${errMsg} ${logHint}` : errMsg,
                    title: item.title,
                    logs: live.logs,
                };
            }
            throw new Error(errMsg);
        }

        const result = live.result || { sets: [] };
        if (!(result.sets || []).length) {
            return {
                ...result,
                softSkip: true,
                softError: 'No ThePosterDB sets found for this title',
            };
        }
        return result;
    };

    /** Isolated session for scheduled/open new-sets refresh — runs alongside library warm. */
    const refreshFetchTitleSets = async (item) => {
        const config = await loadPosterSetsConfig();
        const cliConfig = cliConfigPayload(config);
        cliConfig.tpdb_session_path = path.join(POSTER_SETS_DIR, 'tpdb-session-refresh.json');
        if (config.tpdbUseLogin === false) {
            cliConfig.tpdbUseLogin = false;
        }
        await waitForTpdbRequestSlot();
        let imdbId = null;
        let tvdbId = String(item?.tvdbId || item?.tvdb_id || '').trim() || null;
        if (!/^\d+$/.test(String(tvdbId || ''))) tvdbId = null;
        if (config.tpdbUseLogin !== false) {
            try {
                if (item.tmdbId) {
                    const ext = await fetchTmdbExternalIds(item.tmdbId, item.mediaType, loadPortalConfig);
                    imdbId = ext.imdbId;
                    if (!tvdbId && ext.tvdbId) tvdbId = ext.tvdbId;
                }
            } catch {
                // Optional enrichment.
            }
        }

        const live = await runPosterSetsCli('search', {
            provider: 'posterdb',
            tmdbId: item.tmdbId || null,
            imdbId,
            tvdbId,
            mediaType: item.mediaType,
            titleHint: item.title || null,
            yearHint: item.year,
            titleUrl: item.titleUrl || null,
            mode: 'title',
            limit: 48,
            config: cliConfig,
        }, { timeoutMs: 120_000 });

        if (!live.ok) {
            const errMsg = String(live.error || 'ThePosterDB search failed');
            if (/title url is required|could not (resolve|find).*title page|found no \/posters|needs a \/posters|worker timed out|login failed|skipping slow public/i.test(errMsg)) {
                return {
                    sets: [],
                    softSkip: true,
                    softError: errMsg,
                    title: item.title,
                    logs: live.logs,
                };
            }
            throw new Error(errMsg);
        }

        const result = live.result || { sets: [] };
        if (!(result.sets || []).length) {
            return {
                ...result,
                softSkip: true,
                softError: 'No ThePosterDB sets found for this title',
            };
        }
        return result;
    };

    /** One Python process for a chunk of library titles (login optional). */
    const warmBatchRunner = async (items = [], options = {}) => {
        const config = await loadPosterSetsConfig();
        const forcePublic = warmForcePublicSearch || config.tpdbUseLogin === false;
        const enriched = [];
        for (const item of items) {
            let imdbId = null;
            let tvdbId = String(item?.tvdbId || item?.tvdb_id || '').trim() || null;
            if (!/^\d+$/.test(String(tvdbId || ''))) tvdbId = null;
            const libraryTmdbId = /^\d+$/.test(String(item?.tmdbId || '').trim())
                ? String(item.tmdbId).trim()
                : null;
            const tmdbForSearch = (item?._tmdbMappedFromTvdb === true || item?._tvdbOnlyRetry === true)
                ? null
                : libraryTmdbId;
            if (!forcePublic && tmdbForSearch) {
                try {
                    const ext = await fetchTmdbExternalIds(tmdbForSearch, item.mediaType, loadPortalConfig);
                    imdbId = ext.imdbId;
                    if (!tvdbId && ext.tvdbId) tvdbId = ext.tvdbId;
                } catch {
                    // Optional.
                }
            }
            enriched.push({
                // CLI / Python search id (omit mapped TMDB).
                tmdbId: tmdbForSearch,
                // Preserve library TMDB for title-cache aliases after a TVDB resolve.
                libraryTmdbId,
                title: item.title || '',
                year: item.year ?? null,
                mediaType: item.mediaType || 'movie',
                imdbId,
                tvdbId,
                _tmdbMappedFromTvdb: item?._tmdbMappedFromTvdb === true,
                _tvdbOnlyRetry: item?._tvdbOnlyRetry === true,
            });
        }

        const workerId = Number.isFinite(Number(options.workerId)) ? Number(options.workerId) : 0;
        const isolateSession = options.isolateSession === true;
        const cliConfig = cliConfigPayload(config);
        if (forcePublic) {
            cliConfig.tpdbUseLogin = false;
        }
        if (isolateSession && !forcePublic) {
            cliConfig.tpdb_session_path = path.join(POSTER_SETS_DIR, `tpdb-session-w${workerId}.json`);
        }

        /** @type {Array<Promise<unknown>>} */
        const pendingTitleWrites = [];
        const onTitleResult = typeof options.onTitleResult === 'function'
            ? options.onTitleResult
            : null;

        const live = await runPosterSetsCli('warm', {
            items: enriched.map((row) => ({
                tmdbId: row.tmdbId,
                tvdbId: row.tvdbId,
                title: row.title,
                year: row.year,
                mediaType: row.mediaType,
                imdbId: row.imdbId,
            })),
            config: cliConfig,
        }, {
            timeoutMs: Math.min(3_600_000, Math.max(180_000, enriched.length * 90_000)),
            stallTimeoutMs: Math.max(120_000, Number(options.stallTimeoutMs) || 10 * 60_000),
            onProgress: (message) => {
                const text = String(message || '').trim();
                if (!text) return;
                const prefix = isolateSession ? `W${workerId} ` : '';
                logTpdbCacheActivity(`${prefix}${text}`, {
                    current: text.length > 96 ? `${text.slice(0, 95)}…` : text,
                    level: /login failed|aborted|stopped early/i.test(text) ? 'warn' : 'info',
                });
            },
            onBatch: (event) => {
                if (!onTitleResult) return;
                if (String(event?.phase || '') !== 'warm-title') return;
                const tmdbId = String(event?.tmdbId || event?.tmdb_id || '').trim();
                const tvdbId = String(event?.tvdbId || event?.tvdb_id || '').trim();
                const hasTmdb = /^\d+$/.test(tmdbId);
                const hasTvdb = /^\d+$/.test(tvdbId);
                if (!hasTmdb && !hasTvdb) return;
                const item = enriched.find((row) => (
                    (hasTmdb && (
                        String(row?.tmdbId || '').trim() === tmdbId
                        || String(row?.libraryTmdbId || '').trim() === tmdbId
                    ))
                    || (hasTvdb && String(row?.tvdbId || '').trim() === tvdbId)
                )) || {
                    ...(hasTmdb ? { tmdbId } : {}),
                    ...(hasTvdb ? { tvdbId } : {}),
                    title: event?.title || '',
                    year: event?.year ?? null,
                    mediaType: event?.mediaType || 'movie',
                };
                const applyItem = {
                    ...item,
                    tmdbId: item.libraryTmdbId || item.tmdbId || (hasTmdb ? tmdbId : null),
                };
                const idLabel = hasTmdb ? `tmdb ${tmdbId}` : `tvdb ${tvdbId}`;
                pendingTitleWrites.push(Promise.resolve(onTitleResult(applyItem, {
                    ok: event?.ok === true,
                    tmdbId: hasTmdb ? tmdbId : null,
                    tvdbId: hasTvdb ? tvdbId : (applyItem.tvdbId || null),
                    title: event?.title || applyItem.title,
                    year: event?.year ?? applyItem.year,
                    mediaType: event?.mediaType || applyItem.mediaType,
                    sets: Array.isArray(event?.sets) ? event.sets : [],
                    titleUrl: event?.titleUrl || event?.title_url || null,
                    softSkip: event?.softSkip === true || event?.soft_skip === true,
                    softError: event?.softError || event?.soft_error || null,
                })).catch((error) => {
                    logTpdbCacheActivity(
                        `Cache: failed to save title cache — ${error?.message || error}`,
                        { level: 'warn', detail: idLabel },
                    );
                }));
            },
        });

        if (pendingTitleWrites.length) {
            await Promise.all(pendingTitleWrites);
        }

        if (!live.ok && !(live.result?.results || []).length) {
            const errMsg = String(live.error || 'Cache batch failed');
            logTpdbCacheActivity(`Cache batch failed: ${errMsg}`, { level: 'error', current: false });
            return enriched.map((item) => ({
                tmdbId: item.tmdbId,
                tvdbId: item.tvdbId || null,
                title: item.title,
                year: item.year,
                mediaType: item.mediaType,
                sets: [],
                softSkip: true,
                softError: errMsg,
            }));
        }

        return Array.isArray(live.result?.results) ? live.result.results : [];
    };

    setTpdbWarmFetchTitleSets(warmFetchTitleSets);
    setTpdbWarmBatchRunner(warmBatchRunner);
    setTpdbRefreshFetchTitleSets(refreshFetchTitleSets);

    const isJellyfinLikePortal = (config = {}) => (
        ['jellyfin', 'emby'].includes(String(config?.mediaServerType || '').toLowerCase())
    );

    /** Fast Discover picker boost — Plex/Jellyfin titles that already have a TMDB id. */
    const searchLibraryTitles = async (q, limit = 12) => {
        if (!mediaLibraryDeps || typeof loadPortalConfig !== 'function') return [];
        const query = String(q || '').trim();
        if (!query) return [];
        try {
            const portal = await loadPortalConfig();
            if (!portal) return [];
            const rows = isJellyfinLikePortal(portal)
                ? await searchJellyfinLibraryMedia(portal, mediaLibraryDeps, { query, limit })
                : await searchPlexLibraryMedia(portal, mediaLibraryDeps, { query, limit });
            return (Array.isArray(rows) ? rows : [])
                .map((row) => libraryItemToSearchTitle(row))
                .filter(Boolean)
                .slice(0, limit);
        } catch {
            return [];
        }
    };

    const collectLibraryWarmItems = async ({
        media = 'all',
        source = 'full',
        exhaustedKeys = [],
        skipCached = true,
        limit = 400,
    } = {}) => {
        if (!mediaLibraryDeps || typeof loadPortalConfig !== 'function') return [];
        const portal = await loadPortalConfig().catch(() => null);
        if (!portal) return [];
        const jellyfin = isJellyfinLikePortal(portal);
        const cachedKeys = skipCached ? await listTpdbCachedCoverageKeys() : new Set();
        const exhausted = new Set((exhaustedKeys || []).map((key) => String(key || '').trim()).filter(Boolean));
        const seen = new Set();
        const out = [];
        const mediaRaw = String(media || '').trim().toLowerCase();
        const resolvedWant = mediaRaw === 'movie' || mediaRaw === 'show'
            ? mediaRaw
            : (mediaRaw === 'tv' || mediaRaw === 'series' ? 'show' : '');

        const tryPush = (row) => {
            if (out.length >= limit) return false;
            const tmdbId = String(row?.tmdbId || '').trim();
            const tvdbId = String(row?.tvdbId || '').trim();
            const hasTmdb = /^\d+$/.test(tmdbId);
            const hasTvdb = /^\d+$/.test(tvdbId);
            // Prefer real TMDB; allow TheTVDB-only when TMDB is absent (Plex TV agents).
            if (!hasTmdb && !hasTvdb) return false;
            const mediaType = resolvePosterSetsMediaType(row?.mediaType || row?.type, 'movie');
            if (resolvedWant && mediaType !== resolvedWant) return false;
            const key = coverageKeyForLibraryItem({
                tmdbId: hasTmdb ? tmdbId : null,
                tvdbId: hasTvdb ? tvdbId : null,
                mediaType,
            });
            if (!key || seen.has(key) || exhausted.has(key)) return false;
            if (skipCached && itemIsTpdbCached({
                tmdbId: hasTmdb ? tmdbId : null,
                tvdbId: hasTvdb ? tvdbId : null,
                mediaType,
            }, cachedKeys)) return false;
            seen.add(key);
            const addedAt = Number(row?.addedAt) || 0;
            out.push({
                ...(hasTmdb ? { tmdbId } : {}),
                ...(hasTvdb ? { tvdbId } : {}),
                ...(row?._tmdbMappedFromTvdb === true ? { _tmdbMappedFromTvdb: true } : {}),
                title: String(row?.title || '').trim(),
                year: row?.year ?? null,
                mediaType,
                ...(addedAt > 0 ? { addedAt } : {}),
            });
            return true;
        };

        const resolveIdsForWarmRows = async (rows = []) => {
            const list = Array.isArray(rows) ? rows : [];
            if (!list.length) return list;
            const portalCfg = portal || {};

            // Plex: fill missing TMDB/TVDB from series metadata when browse/recent omitted guids.
            // Webhook always metadata-fetches that one show — Build used to cap this at 300
            // parallel lookups, so most TV /all rows (no Guid on the list) never queued.
            let withProviders = list;
            if (!jellyfin) {
                const needMeta = list.filter((row) => {
                    const mediaType = resolvePosterSetsMediaType(row?.mediaType || row?.type, 'movie');
                    if (resolvedWant && mediaType !== resolvedWant) return false;
                    const hasTmdb = /^\d+$/.test(String(row?.tmdbId || '').trim());
                    const hasTvdb = /^\d+$/.test(String(row?.tvdbId || '').trim());
                    return !hasTmdb && !hasTvdb && String(row?.id || '').trim();
                });
                if (needMeta.length) {
                    withProviders = await hydratePlexLibraryProviderIds(
                        portal,
                        mediaLibraryDeps,
                        list,
                        { onlyMissingBoth: true },
                    );
                }
            }

            // TheTVDB → TMDB (Plex TV libraries often only store TVDB).
            const needTvdbResolve = withProviders.filter((row) => {
                const mediaType = resolvePosterSetsMediaType(row?.mediaType || row?.type, 'movie');
                if (resolvedWant && mediaType !== resolvedWant) return false;
                if (/^\d+$/.test(String(row?.tmdbId || '').trim())) return false;
                return /^\d+$/.test(String(row?.tvdbId || '').trim());
            });
            if (needTvdbResolve.length) {
                const tvdbToTmdb = new Map();
                const uniqueTvdb = [...new Set(needTvdbResolve.map((row) => String(row.tvdbId)))];
                const tvdbConcurrency = 8;
                for (let i = 0; i < uniqueTvdb.length; i += tvdbConcurrency) {
                    const chunk = uniqueTvdb.slice(i, i + tvdbConcurrency);
                    await Promise.all(chunk.map(async (tvdbId) => {
                        try {
                            const tmdbId = await resolveTmdbIdFromTvdb(portalCfg, tvdbId);
                            if (tmdbId) tvdbToTmdb.set(tvdbId, String(tmdbId));
                        } catch {
                            // optional
                        }
                    }));
                }
                if (tvdbToTmdb.size) {
                    withProviders = withProviders.map((row) => {
                        if (/^\d+$/.test(String(row?.tmdbId || '').trim())) return row;
                        const mapped = tvdbToTmdb.get(String(row?.tvdbId || ''));
                        // Keep mapped TMDB for coverage/aliases only — do not send it to
                        // TPDB search (wrong mappings singleton-match the wrong /posters/ page).
                        return mapped
                            ? { ...row, tmdbId: mapped, _tmdbMappedFromTvdb: true }
                            : row;
                    });
                }
            }

            // Last resort: title search on TMDB for movies only. Shows must use Plex
            // TMDB/TVDB (same as webhook) — guessed TMDB fails TPDB page validation.
            const stillMissing = withProviders.filter((row) => {
                const mediaType = resolvePosterSetsMediaType(row?.mediaType || row?.type, 'movie');
                if (mediaType === 'show') return false;
                if (resolvedWant && mediaType !== resolvedWant) return false;
                if (/^\d+$/.test(String(row?.tmdbId || '').trim())) return false;
                if (/^\d+$/.test(String(row?.tvdbId || '').trim())) return false;
                return Boolean(String(row?.title || '').trim());
            }).slice(0, 80);
            if (stillMissing.length) {
                const byKey = new Map();
                await Promise.all(stillMissing.map(async (row) => {
                    const mediaType = resolvePosterSetsMediaType(row?.mediaType || row?.type, 'movie');
                    const key = `${mediaType}:${String(row.title).toLowerCase()}:${row.year || ''}`;
                    try {
                        const tmdbId = await resolveTmdbIdForHint(
                            null,
                            row.title,
                            row.year,
                            mediaType,
                            loadPortalConfig,
                        );
                        if (tmdbId) byKey.set(key, String(tmdbId));
                    } catch {
                        // optional
                    }
                }));
                if (byKey.size) {
                    withProviders = withProviders.map((row) => {
                        if (/^\d+$/.test(String(row?.tmdbId || '').trim())) return row;
                        const mediaType = resolvePosterSetsMediaType(row?.mediaType || row?.type, 'movie');
                        const key = `${mediaType}:${String(row.title || '').toLowerCase()}:${row.year || ''}`;
                        const mapped = byKey.get(key);
                        return mapped ? { ...row, tmdbId: mapped } : row;
                    });
                }
            }

            return withProviders;
        };

        if (source === 'recent' || source === 'full') {
            const recent = jellyfin
                ? await fetchJellyfinLibraryRecent(portal, mediaLibraryDeps, { limit: 200 }).catch(() => null)
                : await fetchPlexLibraryRecent(portal, mediaLibraryDeps, { limit: 200 }).catch(() => null);
            const recentRows = await resolveIdsForWarmRows([
                ...(resolvedWant === 'show' ? [] : (recent?.movies || [])),
                ...(resolvedWant === 'movie' ? [] : (recent?.shows || [])),
                ...((recent?.items || []).filter((row) => (
                    !resolvedWant || warmMediaAllows(resolvedWant, row?.mediaType || row?.type)
                ))),
            ]);
            for (const row of recentRows) {
                tryPush(row);
            }
        }

        if (source === 'full' && out.length < limit) {
            const sections = jellyfin
                ? await fetchJellyfinLibrarySections(portal, mediaLibraryDeps).catch(() => [])
                : await fetchPlexLibrarySections(portal, mediaLibraryDeps).catch(() => []);
            const listAll = jellyfin ? listAllJellyfinLibraryBrowseItems : listAllPlexLibraryBrowseItems;
            for (const section of sections || []) {
                if (out.length >= limit) break;
                const sectionType = resolvePosterSetsMediaType(section.type, 'movie');
                if (sectionType !== 'movie' && sectionType !== 'show') continue;
                if (resolvedWant && sectionType !== resolvedWant) continue;
                const browse = await listAll(portal, mediaLibraryDeps, {
                    sectionKey: section.key,
                    mediaType: sectionType,
                    sort: 'titleAsc',
                }).catch(() => null);
                const browsed = await resolveIdsForWarmRows(browse?.items || []);
                for (const row of browsed) {
                    tryPush(row);
                    if (out.length >= limit) break;
                }
            }
        }

        return out;
    };

    setTpdbLibraryContinueFn(async ({ limit, exhaustedKeys } = {}) => {
        const posterConfig = await loadPosterSetsConfig().catch(() => null);
        const items = await collectLibraryWarmItems({
            media: posterConfig?.tpdbCacheWarmMedia || 'all',
            source: posterConfig?.tpdbCacheWarmSource || 'full',
            skipCached: posterConfig?.tpdbCacheSkipCached !== false,
            exhaustedKeys,
            limit: Math.max(1, Number(limit) || 400),
        });
        if (!items.length) return { queued: 0, skippedCached: 0 };
        return enqueueTpdbLibraryWarm(items, warmFetchTitleSets, {
            force: false,
            autoContinue: true,
            followedCreatorsOnly: posterConfig?.tpdbCacheFollowedCreatorsOnly === true,
            media: posterConfig?.tpdbCacheWarmMedia || 'all',
        });
    });

    void resumeTpdbWarmQueueFromDisk().catch((error) => {
        logTpdbCacheActivity(
            `Cache resume failed: ${error?.message || error}`,
            { level: 'warn' },
        );
    });

    const triggerFirstRunBackfill = () => {
        void maybePosterSetsFirstRunBackfill({
            loadPortalConfig,
            mediaLibraryDeps,
            fetchTitleSets: warmFetchTitleSets,
        }).catch((error) => {
            logTpdbCacheActivity(
                `First-run backfill failed: ${error?.message || error}`,
                { level: 'warn', kind: 'cache' },
            );
        });
    };
    // After a short delay so portal config / Plex are ready.
    setTimeout(triggerFirstRunBackfill, 15_000);

    const portalConfigForMask = async () => (
        typeof loadPortalConfig === 'function'
            ? await loadPortalConfig().catch(() => ({}))
            : {}
    );

    const maskConfigResponse = async (storedOrEffective) => {
        const portal = await portalConfigForMask();
        // Prefer stored-only fields for the form; portal fills empty URL/token at runtime.
        const stored = await loadPosterSetsConfig({ includePortalPlex: false }).catch(() => storedOrEffective);
        return maskPosterSetsConfig(stored, portal);
    };

    router.get('/status', async (_req, res) => {
        try {
            const portalConfig = await portalConfigForMask();
            const stored = await loadPosterSetsConfig({ includePortalPlex: false });
            const masked = maskPosterSetsConfig(stored, portalConfig);
            const recent = (await listJobsSorted()).slice(0, 5).map(summarizeJob);
            const mediaServerType = String(portalConfig?.mediaServerType || 'plex').toLowerCase();
            const mediaServerLabel = mediaServerType === 'jellyfin'
                ? 'Jellyfin'
                : mediaServerType === 'emby'
                    ? 'Emby'
                    : 'Plex';
            res.json({
                ok: true,
                workerReady: posterSetsWorkerReady(),
                appDir: POSTER_SETS_APP_DIR,
                configured: masked.configured,
                mediaServerType,
                mediaServerLabel,
                config: masked,
                recentJobs: recent,
                queue: queueStats(await loadPosterSetsQueue()),
                watches: watchStats(await listPosterSetsWatches()),
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to load Poster Sets status' });
        }
    });

    router.get('/config', async (_req, res) => {
        try {
            res.json({ config: await maskConfigResponse() });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to load config' });
        }
    });

    router.put('/config', async (req, res) => {
        try {
            const body = req.body && typeof req.body === 'object' ? { ...req.body } : {};
            // Plex URL/token come from Settings → Media Player at runtime.
            delete body.effective_base_url;
            delete body.usingPortalPlex;
            delete body.portalPlexAvailable;
            const portal = await portalConfigForMask();
            const linkToMediaPlayer = String(portal?.mediaServerType || 'plex').toLowerCase() === 'plex'
                && Boolean(String(portal?.plexServerUrl || process.env.PLEX_SERVER_URL || '').trim())
                && Boolean(String(portal?.plexToken || '').trim());
            if (!linkToMediaPlayer) {
                delete body.base_url;
                delete body.token;
            }
            const saved = await savePosterSetsConfig(body, {
                clearPlexCredentials: linkToMediaPlayer,
            });
            rescheduleTpdbCacheDailyRefresh();
            ensureFollowedCollectionSetsCached();
            triggerFirstRunBackfill();
            res.json({ ok: true, config: await maskConfigResponse(saved) });
        } catch (error) {
            res.status(400).json({ error: error.message || 'Failed to save config' });
        }
    });

    router.post('/import-portal', async (_req, res) => {
        try {
            if (typeof importFromPortalPlex !== 'function') {
                return res.status(500).json({ error: 'Portal Plex import is not available.' });
            }
            const imported = await importFromPortalPlex();
            if (!imported?.base_url || !imported?.token) {
                return res.status(400).json({
                    error: 'Media Player Plex URL/token are not configured. Set them under Settings → Media Player first.',
                });
            }
            const existing = await loadPosterSetsConfig({ includePortalPlex: false });
            // Libraries only — URL/token resolve from Media Player at runtime.
            const saved = await savePosterSetsConfig({
                ...existing,
                tv_library: imported.tv_library?.length ? imported.tv_library : existing.tv_library,
                movie_library: imported.movie_library?.length ? imported.movie_library : existing.movie_library,
            });
            res.json({
                ok: true,
                config: await maskConfigResponse(saved),
                imported: {
                    base_url: imported.base_url,
                    tv_library: imported.tv_library || [],
                    movie_library: imported.movie_library || [],
                    librarySource: imported.librarySource || 'all',
                },
            });
        } catch (error) {
            res.status(400).json({ error: error.message || 'Failed to import from Media Player settings' });
        }
    });

    router.post('/test', async (req, res) => {
        try {
            let config = await loadPosterSetsConfig();
            if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) {
                const draft = { ...req.body };
                if (!draft.token || draft.token === '********') draft.token = config.token;
                if (!draft.tpdb_password || draft.tpdb_password === '********') {
                    draft.tpdb_password = config.tpdb_password;
                }
                // Prefer Media Player credentials when the draft leaves Plex fields empty.
                config = {
                    ...config,
                    ...draft,
                    base_url: String(draft.base_url || '').trim() || config.base_url,
                    token: draft.token || config.token,
                };
            }
            const run = await runPosterSetsCli('test', { config }, { timeoutMs: 60_000 });
            if (!run.ok) {
                return res.status(400).json({ ok: false, error: run.error || 'Connection test failed', logs: run.logs });
            }
            let tpdb = null;
            if (
                isPosterSetsTpdbEnabled(config)
                && config.tpdb_username
                && config.tpdb_password
                && config.tpdb_password !== '********'
            ) {
                const tpdbRun = await runPosterSetsCli('test-tpdb', { config }, { timeoutMs: 60_000 });
                tpdb = tpdbRun.ok
                    ? (tpdbRun.result || {})
                    : {
                        ok: false,
                        error: tpdbRun.result?.error || tpdbRun.error || 'TPDB login failed',
                        ...(tpdbRun.result && typeof tpdbRun.result === 'object' ? tpdbRun.result : {}),
                    };
            }
            res.json({ ok: true, ...(run.result || {}), tpdb, logs: run.logs });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Connection test failed' });
        }
    });

    router.post('/tpdb-import-cookies', async (req, res) => {
        try {
            let config = await loadPosterSetsConfig();
            if (req.body && typeof req.body === 'object') {
                const draft = { ...req.body };
                if (!draft.tpdb_password || draft.tpdb_password === '********') {
                    draft.tpdb_password = config.tpdb_password;
                }
                if (draft.tpdb_username || draft.tpdb_password) {
                    config = { ...config, ...draft };
                }
            }
            const cookies = req.body?.cookies ?? req.body?.cookieText ?? req.body?.cookie_text ?? '';
            const userAgent = String(req.body?.userAgent || req.body?.user_agent || '').trim();
            const run = await runPosterSetsCli('import-tpdb-cookies', {
                config: {
                    ...cliConfigPayload(config),
                    ...(userAgent ? { tpdb_browser_user_agent: userAgent } : {}),
                },
                cookies,
                userAgent: userAgent || undefined,
            }, { timeoutMs: 90_000 });
            if (!run.ok) {
                return res.status(400).json({
                    ok: false,
                    error: run.result?.error || run.error || 'Cookie import failed',
                    cloudflare: run.result?.cloudflare === true,
                    logs: run.logs,
                });
            }
            res.json({ ok: true, ...(run.result || {}), logs: run.logs });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Cookie import failed' });
        }
    });

    router.post('/preview', async (req, res) => {
        try {
            const url = String(req.body?.url || '').trim();
            if (!url) return res.status(400).json({ error: 'url is required' });
            const config = await loadPosterSetsConfig();
            const filtersRaw = req.body?.mediuxFilters ?? req.body?.mediux_filters;
            const mediuxFilters = Array.isArray(filtersRaw)
                ? filtersRaw.map((item) => String(item || '').trim()).filter(Boolean)
                : [];
            const run = await runPosterSetsCli('preview', {
                config,
                url,
                ...(mediuxFilters.length ? { mediuxFilters } : {}),
            }, { timeoutMs: 180_000 });
            if (run.ok) {
                if (isTpdbUrl(url)) {
                    void cacheExplicitTpdbUrl(url, {
                        setMeta: run.result?.setMeta,
                        assets: run.result?.assets,
                        matched: run.result?.matched,
                        unmatched: run.result?.unmatched,
                        total: run.result?.total,
                        title: run.result?.title,
                    });
                }
                return res.json({ ok: true, ...(run.result || {}), logs: run.logs });
            }

            if (isTpdbUrl(url) && config.tpdbLocalCacheEnabled === true) {
                const cached = await previewFromTpdbSetCache(url);
                if (cached) {
                    return res.json({
                        ...cached,
                        partialErrors: [
                            run.error || 'Live preview failed — serving cached ThePosterDB set.',
                        ],
                        logs: run.logs,
                    });
                }
            }
            return res.status(400).json({ ok: false, error: run.error || 'Preview failed', logs: run.logs });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Preview failed' });
        }
    });

    router.post('/search', async (req, res) => {
        try {
            const providerRaw = String(req.body?.provider || '').trim().toLowerCase();
            const posterSetsConfig = await loadPosterSetsConfig();
            const provider = resolvePosterSetsSearchProvider(
                posterSetsConfig,
                (providerRaw === 'posterdb'
                    || providerRaw === 'tpdb'
                    || providerRaw === 'theposterdb')
                    ? 'posterdb'
                    : providerRaw === 'mediux'
                        ? 'mediux'
                        : (providerRaw === 'both' || providerRaw === 'all' || !providerRaw)
                            ? 'both'
                            : providerRaw,
            );
            if (!provider) {
                return res.status(400).json({
                    error: providerRaw
                        ? 'That source is turned off in Poster Sets settings.'
                        : 'Turn on MediUX and/or ThePosterDB in Poster Sets settings.',
                });
            }

            const query = String(req.body?.query || req.body?.q || '').trim();
            const titleUrl = String(req.body?.titleUrl || req.body?.title_url || '').trim();
            const tmdbId = req.body?.tmdbId ?? req.body?.tmdb_id ?? null;
            const imdbId = req.body?.imdbId ?? req.body?.imdb_id ?? null;
            const mediaType = resolvePosterSetsMediaType(req.body?.mediaType || req.body?.media_type, 'movie');
            const modeRaw = String(req.body?.mode || 'title').trim().toLowerCase();
            const mode = ['creator', 'user', 'author', 'uploader'].includes(modeRaw)
                ? 'creator'
                : ['recent', 'browse', 'recently_added', 'recently-added'].includes(modeRaw)
                    ? 'recent'
                    : ['feed', 'following', 'following_feed', 'follows'].includes(modeRaw)
                        ? 'feed'
                        : 'title';
            // Creator catalogs paginate at the source; 0 = pull a large catalog (server-capped).
            const rawLimit = Number(req.body?.limit);
            // Title-page set scrapes need headroom — popular shows often have 40+ TPDB sets.
            const limit = (mode === 'creator' || mode === 'recent' || mode === 'feed')
                ? (Number.isFinite(rawLimit) && rawLimit >= 0 ? Math.min(rawLimit || 10_000, 10_000) : 10_000)
                : Math.min(500, Math.max(1, rawLimit || 24));
            const savedConfig = await loadPosterSetsConfig().catch(() => ({}));
            const dupePreference = normalizeDupePreference(
                req.body?.dupePreference
                ?? req.body?.dupe_preference
                ?? savedConfig?.dupePreference,
            );

            const batchPages = Math.min(10, Math.max(1, Number(req.body?.batchPages ?? req.body?.batch_pages) || 3));

            const searchMediuxTitles = async () => {
                if (!query) throw Object.assign(new Error('query is required'), { status: 400 });
                const portal = typeof loadPortalConfig === 'function' ? await loadPortalConfig() : {};
                const apiKey = String(portal?.tmdbApiKey || '').trim();
                if (!apiKey) {
                    const err = Object.assign(
                        new Error('Add a TMDB API key in Settings to search MediUX by title (or use Find by ID).'),
                        { status: 400, code: 'TMDB_API_KEY_MISSING' },
                    );
                    throw err;
                }
                const { createTmdbClient } = await import('../portal-request/tmdbClient.js');
                const client = createTmdbClient({ tmdbApiKey: apiKey, language: 'en' });
                const page = await client.search(query, { page: 1 });
                const titles = (page?.results || [])
                    .filter((item) => item && (item.mediaType === 'movie' || item.mediaType === 'tv'))
                    .slice(0, limit)
                    .map((item) => ({
                        id: String(item.id),
                        title: item.title || item.name || 'Untitled',
                        year: item.releaseDate || item.firstAirDate
                            ? Number(String(item.releaseDate || item.firstAirDate).slice(0, 4)) || null
                            : null,
                        url: item.mediaType === 'tv'
                            ? `https://mediux.pro/shows/${item.id}`
                            : `https://mediux.pro/movies/${item.id}`,
                        mediaType: item.mediaType === 'tv' ? 'show' : 'movie',
                        thumbUrl: item.posterPath
                            ? `https://image.tmdb.org/t/p/w185${item.posterPath}`
                            : '',
                        provider: 'mediux',
                    }));
                return {
                    ok: true,
                    provider: 'mediux',
                    phase: 'titles',
                    query,
                    titles,
                    sets: [],
                    logs: [],
                };
            };

            const runCliSearch = async (providerId, extra = {}, { onBatch } = {}) => {
                const resolvedMedia = resolvePosterSetsMediaType(extra.mediaType ?? mediaType, 'movie');
                let linkedTmdb = extra.tmdbId ?? tmdbId;
                if (providerId === 'posterdb' && linkedTmdb) {
                    const titleHintVal = extra.titleHint ?? req.body?.titleHint ?? req.body?.title ?? query ?? null;
                    const yearHintVal = extra.yearHint ?? req.body?.yearHint ?? req.body?.year ?? null;
                    linkedTmdb = await resolveTmdbIdForHint(
                        linkedTmdb,
                        titleHintVal,
                        yearHintVal,
                        resolvedMedia,
                        loadPortalConfig,
                    ) || linkedTmdb;
                }
                let enrichedImdb = extra.imdbId ?? imdbId;
                let enrichedTvdb = extra.tvdbId ?? req.body?.tvdbId ?? req.body?.tvdb_id ?? null;
                if (providerId === 'posterdb' && linkedTmdb && (!enrichedTvdb || !enrichedImdb)) {
                    try {
                        const ext = await fetchTmdbExternalIds(linkedTmdb, resolvedMedia, loadPortalConfig);
                        if (!enrichedTvdb && ext.tvdbId) enrichedTvdb = ext.tvdbId;
                        if (!enrichedImdb && ext.imdbId) enrichedImdb = ext.imdbId;
                    } catch {
                        // TMDB enrichment is optional — title search may still work.
                    }
                }
                const payload = {
                    provider: providerId,
                    query: extra.query ?? query,
                    titleUrl: extra.titleUrl || titleUrl,
                    mediaType: resolvedMedia,
                    tmdbId: linkedTmdb,
                    imdbId: enrichedImdb,
                    tvdbId: enrichedTvdb,
                    titleHint: extra.titleHint ?? req.body?.titleHint ?? req.body?.title ?? query ?? null,
                    yearHint: extra.yearHint ?? req.body?.yearHint ?? req.body?.year ?? null,
                    mode: extra.mode || mode,
                    limit: extra.limit ?? limit,
                    batchPages,
                    streamBatches: Boolean(onBatch),
                    config: cliConfigPayload(posterSetsConfig),
                };
                if (extra.titlesOnly) payload.titlesOnly = true;
                const run = await runPosterSetsCli('search', payload, {
                    timeoutMs: extra.timeoutMs
                        ?? ((mode === 'creator' || mode === 'recent' || mode === 'feed') ? 300_000 : 120_000),
                    onBatch,
                });
                if (!run.ok) {
                    const err = Object.assign(new Error(run.error || `${providerId} search failed`), {
                        status: 400,
                        logs: run.logs,
                    });
                    throw err;
                }
                const out = { ok: true, ...(run.result || {}), logs: run.logs || [] };
                if (Array.isArray(out.partial_errors)) {
                    out.partialErrors = out.partial_errors;
                    delete out.partial_errors;
                }
                if (providerId === 'posterdb' && !(out.sets?.length) && !(out.titles?.length)) {
                    const partial = Array.isArray(out.partialErrors) ? [...out.partialErrors] : [];
                    if (!partial.length && !hasTpdbCredentials(posterSetsConfig)) {
                        partial.push(
                            'ThePosterDB login not configured — many TV titles need TMDB/TVDB advanced search. '
                            + 'Add credentials in Poster Sets → Settings, or paste a set URL in Discover.',
                        );
                    }
                    if (partial.length) out.partialErrors = partial;
                }
                return out;
            };

            const streamCatalogSearch = async (providers, {
                requireQuery = false,
                missingQueryError = 'query is required',
                defaultTitle = '',
                catalogMode = 'creator',
            } = {}) => {
                if (requireQuery && !query) {
                    res.status(400).json({ error: missingQueryError });
                    return;
                }

                res.status(200);
                res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
                res.setHeader('Cache-Control', 'no-cache, no-transform');
                res.setHeader('X-Accel-Buffering', 'no');
                if (typeof res.flushHeaders === 'function') res.flushHeaders();

                const byProvider = new Map();
                let contextTitle = defaultTitle;
                let writeChain = Promise.resolve();
                const logs = [];
                const errors = [];

                const writeLine = (payload) => {
                    writeChain = writeChain.then(() => {
                        if (res.writableEnded) return;
                        try {
                            res.write(`${JSON.stringify(payload)}\n`);
                            if (typeof res.flush === 'function') res.flush();
                        } catch {
                            /* client disconnected */
                        }
                    });
                    return writeChain;
                };

                const publish = (loading, extra = {}) => {
                    // Preferred provider first so Both still surfaces that source's newest-first order.
                    const preferredFirst = dupePreference === 'mediux'
                        ? ['mediux', 'posterdb']
                        : ['posterdb', 'mediux'];
                    const allSets = [];
                    for (const providerId of preferredFirst) {
                        if (byProvider.has(providerId)) allSets.push(...(byProvider.get(providerId) || []));
                    }
                    for (const [providerId, sets] of byProvider.entries()) {
                        if (!preferredFirst.includes(providerId)) allSets.push(...(sets || []));
                    }
                    const merged = mergePosterSearchSets(allSets, dupePreference, {
                        preserveOrder: true,
                        preferredCreators: posterSetsConfig?.creatorWhitelist,
                        blockedCreators: posterSetsConfig?.creatorBlocklist,
                    });
                    return writeLine({
                        type: loading ? 'batch' : 'result',
                        ok: true,
                        provider,
                        phase: 'sets',
                        mode: catalogMode,
                        query,
                        title: contextTitle,
                        titles: [],
                        sets: merged.sets,
                        dupesCollapsed: merged.dupesCollapsed,
                        dupePreference,
                        loading,
                        partialErrors: errors.length ? errors : undefined,
                        ...extra,
                    });
                };

                const ingestProviderSnapshot = (providerId, sets, title) => {
                    byProvider.set(providerId, Array.isArray(sets) ? sets : []);
                    if (title) contextTitle = title;
                };

                await Promise.allSettled(providers.map(async (providerId) => {
                    try {
                        const result = await runCliSearch(providerId, {}, {
                            onBatch: (event) => {
                                const snapshot = Array.isArray(event?.allSets) && event.allSets.length
                                    ? event.allSets
                                    : [
                                        ...(byProvider.get(providerId) || []),
                                        ...(Array.isArray(event?.sets) ? event.sets : []),
                                    ];
                                ingestProviderSnapshot(providerId, snapshot, event?.title);
                                void publish(true);
                            },
                        });
                        logs.push(...(result.logs || []));
                        ingestProviderSnapshot(providerId, result.sets || [], result.title);
                    } catch (error) {
                        errors.push(error?.message || `${providerId} search failed`);
                        if (Array.isArray(error?.logs)) logs.push(...error.logs);
                    }
                }));

                await writeChain;
                const total = [...byProvider.values()].reduce((sum, sets) => sum + (sets?.length || 0), 0);
                if (!total) {
                    await writeLine({
                        type: 'error',
                        ok: false,
                        error: errors[0] || (catalogMode === 'recent'
                            ? 'No recently added sets found on ThePosterDB.'
                            : catalogMode === 'feed'
                                ? 'No sets from creators you follow in Poster Sets settings.'
                                : 'No sets found on MediUX or ThePosterDB for that creator.'),
                        logs,
                    });
                    res.end();
                    return;
                }
                await publish(false, { logs });
                res.end();
            };

            const sortSetsLatestFirst = (sets = []) => [...sets].sort((a, b) => {
                const aId = Number(a?.setId) || 0;
                const bId = Number(b?.setId) || 0;
                if (aId !== bId) return bId - aId;
                return String(b?.url || '').localeCompare(String(a?.url || ''));
            });

            const streamFollowedCreatorCatalog = async (usernames) => {
                res.status(200);
                res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
                res.setHeader('Cache-Control', 'no-cache, no-transform');
                res.setHeader('X-Accel-Buffering', 'no');
                if (typeof res.flushHeaders === 'function') res.flushHeaders();

                const byUser = new Map();
                let writeChain = Promise.resolve();
                const logs = [];
                const errors = [];
                const perCreatorLimit = Math.min(120, Math.max(36, Number(limit) || 80));

                const writeLine = (payload) => {
                    writeChain = writeChain.then(() => {
                        if (res.writableEnded) return;
                        try {
                            res.write(`${JSON.stringify(payload)}\n`);
                            if (typeof res.flush === 'function') res.flush();
                        } catch {
                            /* client disconnected */
                        }
                    });
                    return writeChain;
                };

                const publish = (loading, extra = {}) => {
                    const allSets = [];
                    for (const sets of byUser.values()) allSets.push(...(sets || []));
                    const merged = mergePosterSearchSets(sortSetsLatestFirst(allSets), dupePreference, {
                        preserveOrder: true,
                        preferredCreators: usernames,
                        blockedCreators: posterSetsConfig?.creatorBlocklist,
                    });
                    return writeLine({
                        type: loading ? 'batch' : 'result',
                        ok: true,
                        provider: 'posterdb',
                        phase: 'sets',
                        mode: 'feed',
                        query: 'feed',
                        title: 'ThePosterDB · Following',
                        titles: [],
                        sets: merged.sets,
                        dupesCollapsed: merged.dupesCollapsed,
                        dupePreference,
                        loading,
                        partialErrors: errors.length ? errors : undefined,
                        ...extra,
                    });
                };

                let index = 0;
                const concurrency = Math.min(2, usernames.length);
                await Promise.all(Array.from({ length: concurrency }, async () => {
                    while (index < usernames.length) {
                        const current = index;
                        index += 1;
                        const username = usernames[current];
                        try {
                            const result = await runCliSearch('posterdb', {
                                query: username,
                                mode: 'creator',
                                limit: perCreatorLimit,
                                timeoutMs: 180_000,
                            });
                            logs.push(...(result.logs || []));
                            byUser.set(username, Array.isArray(result.sets) ? result.sets.map((set) => ({
                                ...set,
                                provider: set.provider || 'posterdb',
                                user: set.user || username,
                            })) : []);
                            await publish(true);
                        } catch (error) {
                            errors.push(error?.message || `@${username} failed`);
                            if (Array.isArray(error?.logs)) logs.push(...error.logs);
                            byUser.set(username, byUser.get(username) || []);
                        }
                    }
                }));

                await writeChain;
                const total = [...byUser.values()].reduce((sum, sets) => sum + (sets?.length || 0), 0);
                if (!total) {
                    await writeLine({
                        type: 'error',
                        ok: false,
                        error: errors[0] || 'No sets from creators you follow in Poster Sets settings.',
                        logs,
                    });
                    res.end();
                    return;
                }
                await publish(false, { logs });
                res.end();
            };

            // Optional multi-source set fetch when opening a merged title from "Both".
            const titleSources = Array.isArray(req.body?.titleSources) ? req.body.titleSources : null;
            if (titleSources?.length) {
                const titleHint = String(req.body?.titleHint || req.body?.title || query || '').trim();
                const yearHint = req.body?.yearHint ?? req.body?.year ?? null;
                const linkedTmdb = titleSources.find((source) => (
                    String(source?.provider || '').toLowerCase() === 'mediux' && (source?.id || source?.tmdbId)
                ))?.id || titleSources.find((source) => source?.tmdbId)?.tmdbId
                    || tmdbId
                    || null;
                const sourceProviderOf = (source) => (
                    String(source?.provider || '').toLowerCase() === 'mediux' ? 'mediux' : 'posterdb'
                );
                let sourcesToFetch = titleSources.filter((source) => {
                    const sourceProvider = sourceProviderOf(source);
                    if (provider === 'both') {
                        return sourceProvider === 'mediux'
                            ? isPosterSetsMediuxEnabled(posterSetsConfig)
                            : isPosterSetsTpdbSearchEnabled(posterSetsConfig);
                    }
                    return sourceProvider === provider;
                });
                if (provider === 'posterdb' && !sourcesToFetch.length) {
                    sourcesToFetch = [{
                        provider: 'posterdb',
                        id: '',
                        url: '',
                        tmdbId: linkedTmdb,
                        mediaType,
                        year: yearHint,
                    }];
                }
                if (!sourcesToFetch.length) {
                    return res.json({
                        ok: true,
                        provider,
                        phase: 'sets',
                        query,
                        title: req.body?.title || query || null,
                        titles: [],
                        sets: [],
                        dupesCollapsed: 0,
                        dupePreference,
                    });
                }
                const cacheEnabled = posterSetsConfig.tpdbLocalCacheEnabled === true;
                const requestMedia = resolvePosterSetsMediaType(mediaType, 'movie');
                const requestTvdbId = String(req.body?.tvdbId || req.body?.tvdb_id || '').trim() || null;
                const libraryScoped = isLibraryScopedTpdbSearch({ tmdbId: linkedTmdb, tvdbId: requestTvdbId });
                const titleCacheKey = libraryScoped && cacheEnabled
                    ? buildTpdbTitleCacheKey({
                        tmdbId: linkedTmdb,
                        tvdbId: requestTvdbId,
                        mediaType: requestMedia,
                        titleHint,
                        yearHint,
                    })
                    : null;
                const cachedTitle = cacheEnabled
                    ? await loadTpdbTitleCacheForLibraryItem({
                        tmdbId: linkedTmdb,
                        tvdbId: requestTvdbId,
                        mediaType: requestMedia,
                        title: titleHint,
                        year: yearHint,
                    })
                    : null;

                const externalIdsPromise = linkedTmdb
                    ? fetchTmdbExternalIds(linkedTmdb, mediaType, loadPortalConfig)
                    : Promise.resolve({ imdbId: null, tvdbId: null });
                const settled = await Promise.allSettled(sourcesToFetch.map(async (source) => {
                    const sourceProvider = String(source?.provider || '').toLowerCase() === 'mediux' ? 'mediux' : 'posterdb';
                    const sourceMedia = resolvePosterSetsMediaType(source?.mediaType, requestMedia);
                    if (sourceProvider === 'mediux') {
                        return runCliSearch('mediux', {
                            tmdbId: source?.id || source?.tmdbId || linkedTmdb || null,
                            titleUrl: '',
                            mediaType: sourceMedia,
                        });
                    }
                    // Permanent local DB: serve disk immediately. New sets come from the daily refresh.
                    if (cachedTitle) {
                        logTpdbCacheActivity(
                            `Library title: serving TPDB set list from cache (${cachedTitle.sets?.length || 0} sets)`,
                            { detail: titleCacheKey },
                        );
                        const forceRefresh = req.body?.refresh === true;
                        const runLiveMerge = async () => {
                            const externalIds = await externalIdsPromise;
                            const live = await runCliSearch('posterdb', {
                                tmdbId: linkedTmdb,
                                imdbId: externalIds.imdbId || imdbId || null,
                                tvdbId: externalIds.tvdbId || null,
                                titleHint: titleHint || null,
                                yearHint: source?.year ?? yearHint ?? null,
                                mediaType: sourceMedia,
                            });
                            const beforeKeys = new Set(
                                (cachedTitle.sets || []).map((set) => (
                                    String(set?.setId || set?.id || set?.url || '').trim()
                                )).filter(Boolean),
                            );
                            await rememberPosterdbSearchResult(live, {
                                libraryScoped: true,
                                tmdbId: linkedTmdb,
                                mediaType: sourceMedia,
                                titleHint,
                                yearHint,
                                titleUrl: live.titleUrl || String(source?.url || '').trim() || cachedTitle.titleUrl,
                            });
                            const newSets = (live.sets || []).filter((set) => {
                                const key = String(set?.setId || set?.id || set?.url || '').trim();
                                return key && !beforeKeys.has(key);
                            });
                            if (newSets.length) {
                                logTpdbCacheActivity(
                                    `Library title: +${newSets.length} new TPDB set(s) merged into cache`,
                                    { detail: titleCacheKey, kind: 'cache' },
                                );
                                void enqueueTpdbLibraryTitleHydrate(newSets, {
                                    libraryScoped: true,
                                    tmdbId: linkedTmdb,
                                    titleKey: titleCacheKey,
                                });
                            } else {
                                await touchTpdbTitleRevalidated(titleCacheKey).catch(() => {});
                            }
                            const updated = titleCacheKey ? await loadTpdbTitleCache(titleCacheKey) : null;
                            return {
                                ok: true,
                                sets: updated?.sets || live.sets || cachedTitle.sets,
                                title: updated?.title || live.title || cachedTitle.title,
                                titleUrl: updated?.titleUrl || live.titleUrl || cachedTitle.titleUrl,
                                fromCache: true,
                                stale: false,
                                logs: live.logs || [],
                            };
                        };
                        if (forceRefresh && libraryScoped && cacheEnabled) {
                            try {
                                return await runLiveMerge();
                            } catch (error) {
                                await touchTpdbTitleRevalidated(titleCacheKey).catch(() => {});
                                return {
                                    ok: true,
                                    sets: cachedTitle.sets,
                                    title: cachedTitle.title,
                                    titleUrl: cachedTitle.titleUrl,
                                    fromCache: true,
                                    stale: false,
                                    logs: [],
                                    partialErrors: [error?.message || 'ThePosterDB refresh failed'],
                                };
                            }
                        }
                        void enqueueTpdbLibraryTitleHydrate(cachedTitle.sets || [], {
                            libraryScoped: true,
                            tmdbId: linkedTmdb,
                            titleKey: titleCacheKey,
                        });
                        return {
                            ok: true,
                            sets: cachedTitle.sets,
                            title: cachedTitle.title,
                            titleUrl: cachedTitle.titleUrl,
                            fromCache: true,
                            stale: false,
                            logs: [],
                        };
                    }
                    const externalIds = await externalIdsPromise;
                    const staleTitleUrl = String(source?.url || '').trim();
                    try {
                        // Prefer the solid cache warm pipeline for library titles (priority front-of-queue).
                        if (libraryScoped && cacheEnabled && (linkedTmdb || requestTvdbId)) {
                            logTpdbCacheActivity(
                                `Library title: priority cache resolve${titleHint ? ` for ${titleHint}` : ''}`,
                                {
                                    detail: `tmdb ${linkedTmdb}`,
                                    current: titleHint
                                        ? `Priority cache · ${titleHint}`
                                        : 'Priority cache resolve…',
                                },
                            );
                            const cached = await priorityEnsureTpdbTitleCached({
                                tmdbId: linkedTmdb,
                                tvdbId: requestTvdbId,
                                title: titleHint || null,
                                year: source?.year ?? yearHint ?? null,
                                mediaType: sourceMedia,
                                titleUrl: staleTitleUrl || null,
                            });
                            if (cached?.sets?.length) {
                                return {
                                    ok: true,
                                    sets: cached.sets,
                                    title: cached.title,
                                    titleUrl: cached.titleUrl,
                                    fromCache: true,
                                    stale: false,
                                    logs: [],
                                };
                            }
                        }

                        logTpdbCacheActivity(
                            `Library title: live scraping TPDB set list${titleHint ? ` for ${titleHint}` : ''}`,
                            {
                                detail: linkedTmdb ? `tmdb ${linkedTmdb}` : staleTitleUrl || null,
                                current: titleHint
                                    ? `Scraping title · ${titleHint}`
                                    : 'Scraping TPDB title sets…',
                            },
                        );
                        const live = await runCliSearch('posterdb', {
                            titleUrl: staleTitleUrl,
                            tmdbId: linkedTmdb,
                            imdbId: externalIds.imdbId || imdbId || null,
                            tvdbId: externalIds.tvdbId || null,
                            titleHint: titleHint || null,
                            yearHint: source?.year ?? yearHint ?? null,
                            mediaType: sourceMedia,
                        });
                        if (libraryScoped && cacheEnabled) {
                            await rememberPosterdbSearchResult(live, {
                                libraryScoped: true,
                                tmdbId: linkedTmdb,
                                mediaType: sourceMedia,
                                titleHint,
                                yearHint,
                                titleUrl: live.titleUrl || staleTitleUrl,
                            });
                            void enqueueTpdbLibraryTitleHydrate(live.sets || [], {
                                libraryScoped: true,
                                tmdbId: linkedTmdb,
                                titleKey: titleCacheKey,
                            });
                        }
                        return live;
                    } catch (error) {
                        throw error;
                    }
                }));
                const sets = [];
                const logs = [];
                const errors = [];
                for (const result of settled) {
                    if (result.status === 'fulfilled') {
                        sets.push(...(result.value.sets || []));
                        logs.push(...(result.value.logs || []));
                        if (result.value.partialErrors?.length) {
                            errors.push(...result.value.partialErrors);
                        }
                    } else {
                        errors.push(result.reason?.message || 'Source search failed');
                        if (Array.isArray(result.reason?.logs)) logs.push(...result.reason.logs);
                    }
                }
                if (!sets.length && cachedTitle?.sets?.length) {
                    sets.push(...cachedTitle.sets);
                    // Disk cache is the permanent store — no error toast for a successful local hit.
                }
                if (!sets.length && errors.length) {
                    return res.status(400).json({ ok: false, error: errors[0], logs });
                }
                const merged = mergePosterSearchSets(sets, dupePreference, {
                    preferredCreators: posterSetsConfig?.creatorWhitelist,
                    blockedCreators: posterSetsConfig?.creatorBlocklist,
                });
                if (libraryScoped && cacheEnabled && (merged.sets || []).some((s) => String(s.provider).toLowerCase() === 'posterdb')) {
                    void enqueueTpdbLibraryTitleHydrate(
                        (merged.sets || []).filter((s) => String(s.provider || '').toLowerCase() === 'posterdb'),
                        { libraryScoped: true, tmdbId: linkedTmdb, titleKey: titleCacheKey },
                    );
                }
                return res.json({
                    ok: true,
                    provider,
                    phase: 'sets',
                    query,
                    title: req.body?.title || query || cachedTitle?.title || null,
                    titles: [],
                    sets: provider === 'both'
                        ? merged.sets
                        : (merged.sets || []).filter((set) => {
                            const setProvider = String(set?.provider || '').toLowerCase() === 'mediux'
                                ? 'mediux'
                                : 'posterdb';
                            return setProvider === provider;
                        }),
                    dupesCollapsed: merged.dupesCollapsed,
                    dupePreference,
                    fromCache: Boolean(cachedTitle) && !(settled.some((r) => r.status === 'fulfilled' && !r.value?.fromCache && (r.value?.sets || []).length)),
                    partialErrors: errors,
                    logs,
                });
            }

            // Creator / recent catalogs stream NDJSON batches (first ~3 pages, then more).
            if (mode === 'creator') {
                const providers = provider === 'both' ? ['mediux', 'posterdb'] : [provider];
                await streamCatalogSearch(providers, {
                    requireQuery: true,
                    missingQueryError: 'creator username is required',
                    defaultTitle: `@${String(query || '').replace(/^@/, '')}`,
                    catalogMode: 'creator',
                });
                return;
            }
            if (mode === 'recent' || mode === 'feed') {
                if (!isPosterSetsTpdbSearchEnabled(posterSetsConfig)) {
                    return res.status(400).json({ error: 'ThePosterDB search is turned off in Poster Sets settings.' });
                }
                if (mode === 'feed') {
                    const followed = excludeBlockedHandles(
                        posterSetsConfig?.creatorWhitelist,
                        posterSetsConfig?.creatorBlocklist,
                    );
                    if (!followed.length) {
                        return res.status(400).json({
                            error: 'Add creators under Poster Sets → Settings → Creators you follow. Following uses that list, not your ThePosterDB account follows.',
                        });
                    }
                    await streamFollowedCreatorCatalog(followed);
                    return;
                }
                await streamCatalogSearch(['posterdb'], {
                    requireQuery: false,
                    defaultTitle: 'ThePosterDB · Recently added',
                    catalogMode: 'recent',
                });
                return;
            }

            if (provider === 'both' && isPosterSetsMediuxEnabled(posterSetsConfig)) {
                // Title picker only — library + TMDB/MediUX. TPDB text search is slow and
                // often empty; sets resolve from the TMDB id when the user opens a title.
                if (tmdbId || titleUrl) {
                    return res.status(400).json({
                        error: 'Open a specific title source with provider mediux or posterdb (or pass titleSources).',
                    });
                }
                if (!query) return res.status(400).json({ error: 'query is required' });
                const logs = [];
                const errors = [];
                let tmdbMissing = null;

                const mediuxPromise = searchMediuxTitles().catch((error) => {
                    if (error?.code === 'TMDB_API_KEY_MISSING') {
                        tmdbMissing = error;
                        return { titles: [], logs: [] };
                    }
                    errors.push(error?.message || 'MediUX title search failed');
                    if (Array.isArray(error?.logs)) logs.push(...error.logs);
                    return { titles: [], logs: [] };
                });

                const [mediuxResult, libraryTitles] = await Promise.all([
                    mediuxPromise,
                    searchLibraryTitles(query, 12),
                ]);
                logs.push(...(mediuxResult?.logs || []));
                const merged = mergeTitleSearchWithLibrary(
                    mediuxResult?.titles || [],
                    libraryTitles,
                    dupePreference,
                );
                if (!merged.titles.length) {
                    if (tmdbMissing) {
                        return res.status(400).json({
                            ok: false,
                            error: tmdbMissing.message,
                            code: tmdbMissing.code,
                            logs,
                        });
                    }
                    return res.status(400).json({
                        ok: false,
                        error: errors[0] || 'No matches found.',
                        logs,
                    });
                }
                return res.json({
                    ok: true,
                    provider: 'both',
                    phase: 'titles',
                    query,
                    titles: merged.titles,
                    sets: [],
                    dupesCollapsed: merged.dupesCollapsed,
                    dupePreference,
                    partialErrors: errors,
                    logs,
                });
            }

            // MediUX title search uses portal TMDB key, then scrapes the MediUX title page for sets.
            if (provider === 'mediux' && !tmdbId && !titleUrl) {
                try {
                    const [result, libraryTitles] = await Promise.all([
                        searchMediuxTitles(),
                        searchLibraryTitles(query, 12),
                    ]);
                    const merged = mergeTitleSearchWithLibrary(result.titles || [], libraryTitles, dupePreference);
                    return res.json({
                        ...result,
                        titles: merged.titles,
                        dupesCollapsed: merged.dupesCollapsed,
                        dupePreference,
                    });
                } catch (error) {
                    const libraryTitles = await searchLibraryTitles(query, 12);
                    if (libraryTitles.length) {
                        const merged = mergeTitleSearchWithLibrary([], libraryTitles, dupePreference);
                        return res.json({
                            ok: true,
                            provider: 'mediux',
                            phase: 'titles',
                            query,
                            titles: merged.titles,
                            sets: [],
                            dupesCollapsed: merged.dupesCollapsed,
                            dupePreference,
                            partialErrors: [error.message || 'MediUX title search failed'],
                        });
                    }
                    return res.status(error.status || 500).json({
                        error: error.message || 'Search failed',
                        code: error.code,
                    });
                }
            }

            if (provider === 'posterdb') {
                const titleHint = String(req.body?.titleHint || req.body?.title || query || '').trim();
                const yearHint = req.body?.yearHint ?? req.body?.year ?? null;

                // First picker query: one public search page, no /posters resolve.
                // Library hits (with TMDB ids) let the user open sets even when TPDB text search is empty.
                if (!tmdbId && !titleUrl) {
                    if (!query && !titleHint) {
                        return res.status(400).json({ error: 'query is required' });
                    }
                    const errors = [];
                    const logs = [];
                    const [posterdbResult, libraryTitles] = await Promise.all([
                        runCliSearch('posterdb', {
                            query: query || titleHint,
                            titleHint,
                            yearHint,
                            mediaType,
                            titlesOnly: true,
                            timeoutMs: 15_000,
                        }).catch((error) => {
                            errors.push(error?.message || 'ThePosterDB title search failed');
                            if (Array.isArray(error?.logs)) logs.push(...error.logs);
                            return { titles: [], logs: [] };
                        }),
                        searchLibraryTitles(query || titleHint, 12),
                    ]);
                    logs.push(...(posterdbResult?.logs || []));
                    const merged = mergeTitleSearchWithLibrary(
                        posterdbResult?.titles || [],
                        libraryTitles,
                        dupePreference,
                    );
                    if (!merged.titles.length) {
                        return res.status(400).json({
                            ok: false,
                            error: errors[0] || 'No matches found.',
                            logs,
                        });
                    }
                    return res.json({
                        ok: true,
                        provider: 'posterdb',
                        phase: 'titles',
                        query: query || titleHint,
                        titles: merged.titles,
                        sets: [],
                        dupesCollapsed: merged.dupesCollapsed,
                        dupePreference,
                        partialErrors: errors,
                        logs,
                    });
                }

                const cacheEnabled = posterSetsConfig.tpdbLocalCacheEnabled === true;
                const requestTvdbId = String(req.body?.tvdbId || req.body?.tvdb_id || '').trim() || null;
                const libraryScoped = isLibraryScopedTpdbSearch({ tmdbId, tvdbId: requestTvdbId });
                const titleCacheKey = libraryScoped && cacheEnabled
                    ? buildTpdbTitleCacheKey({
                        tmdbId,
                        tvdbId: requestTvdbId,
                        mediaType,
                        titleUrl,
                        titleHint,
                        yearHint,
                    })
                    : null;
                const cachedTitle = cacheEnabled
                    ? await loadTpdbTitleCacheForLibraryItem({
                        tmdbId,
                        tvdbId: requestTvdbId,
                        mediaType,
                        title: titleHint,
                        year: yearHint,
                        titleUrl,
                    })
                    : null;

                if (cachedTitle) {
                    logTpdbCacheActivity(
                        `Search: serving TPDB sets from cache (${cachedTitle.sets?.length || 0})${titleHint ? ` · ${titleHint}` : ''}`,
                        { detail: titleCacheKey },
                    );
                    const forceRefresh = req.body?.refresh === true;
                    const runLiveMerge = async () => {
                        logTpdbCacheActivity(
                            `Search: ${forceRefresh ? 'refresh' : 'open-title'} scrape${titleHint ? ` for ${titleHint}` : ''}`,
                            { current: titleHint ? `Refreshing · ${titleHint}` : 'Refreshing TPDB title…' },
                        );
                        const live = await runCliSearch('posterdb');
                        const beforeKeys = new Set(
                            (cachedTitle.sets || []).map((set) => (
                                String(set?.setId || set?.id || set?.url || '').trim()
                            )).filter(Boolean),
                        );
                        await rememberPosterdbSearchResult(live, {
                            libraryScoped: true,
                            tmdbId,
                            mediaType,
                            titleHint,
                            yearHint,
                            titleUrl: live.titleUrl || titleUrl,
                        });
                        const newSets = (live.sets || []).filter((set) => {
                            const key = String(set?.setId || set?.id || set?.url || '').trim();
                            return key && !beforeKeys.has(key);
                        });
                        if (newSets.length) {
                            logTpdbCacheActivity(
                                `Search: +${newSets.length} new TPDB set(s) merged into cache`,
                                { detail: titleCacheKey, kind: 'cache' },
                            );
                            void enqueueTpdbLibraryTitleHydrate(newSets, {
                                libraryScoped: true,
                                tmdbId,
                                titleKey: titleCacheKey,
                            });
                        } else {
                            await touchTpdbTitleRevalidated(titleCacheKey).catch(() => {});
                        }
                        const updated = await loadTpdbTitleCache(titleCacheKey);
                        return {
                            ...buildCachedSearchResponse(updated || cachedTitle),
                            logs: live.logs,
                        };
                    };

                    if (forceRefresh) {
                        try {
                            return res.json({
                                ...(await runLiveMerge()),
                                dupePreference,
                            });
                        } catch (error) {
                            await touchTpdbTitleRevalidated(titleCacheKey).catch(() => {});
                            return res.json({
                                ...buildCachedSearchResponse(cachedTitle),
                                dupePreference,
                                logs: error.logs,
                            });
                        }
                    }

                    // Fast path: serve disk now. Scheduled refresh picks up new sets later.
                    void enqueueTpdbLibraryTitleHydrate(cachedTitle.sets || [], {
                        libraryScoped: true,
                        tmdbId,
                        titleKey: titleCacheKey,
                    });
                    return res.json({
                        ...buildCachedSearchResponse(cachedTitle),
                        dupePreference,
                    });
                }

                try {
                    // Library opens with cache on: use priority cache warm (same pipeline as Build cache).
                    if (libraryScoped && cacheEnabled && (tmdbId || requestTvdbId)) {
                        logTpdbCacheActivity(
                            `Search: priority cache resolve${titleHint ? ` for ${titleHint}` : ''}`,
                            {
                                detail: `tmdb ${tmdbId}`,
                                current: titleHint ? `Priority cache · ${titleHint}` : 'Priority cache resolve…',
                            },
                        );
                        const cached = await priorityEnsureTpdbTitleCached({
                            tmdbId,
                            tvdbId: requestTvdbId,
                            title: titleHint || null,
                            year: yearHint,
                            mediaType,
                            titleUrl: titleUrl || null,
                        });
                        if (cached?.sets?.length) {
                            return res.json({
                                ...buildCachedSearchResponse(cached),
                                dupePreference,
                            });
                        }
                    }

                    logTpdbCacheActivity(
                        `Search: live scraping TPDB${titleHint ? ` for ${titleHint}` : ''}`,
                        {
                            detail: tmdbId ? `tmdb ${tmdbId}` : titleUrl || null,
                            current: titleHint ? `Scraping title · ${titleHint}` : 'Scraping TPDB…',
                        },
                    );
                    const result = await runCliSearch('posterdb');
                    if (libraryScoped && cacheEnabled) {
                        await rememberPosterdbSearchResult(result, {
                            libraryScoped: true,
                            tmdbId,
                            mediaType,
                            titleHint,
                            yearHint,
                            titleUrl: result.titleUrl || titleUrl,
                        });
                        void enqueueTpdbLibraryTitleHydrate(result.sets || [], {
                            libraryScoped: true,
                            tmdbId,
                            titleKey: titleCacheKey,
                        });
                    }
                    return res.json({ ok: true, ...result, dupePreference });
                } catch (error) {
                    if (cachedTitle) {
                        return res.json({
                            ...buildCachedSearchResponse(cachedTitle),
                            dupePreference,
                            logs: error.logs,
                        });
                    }
                    throw error;
                }
            }

            const result = await runCliSearch(provider);
            res.json({ ok: true, ...result, dupePreference });
        } catch (error) {
            res.status(error.status || 500).json({
                error: error.message || 'Search failed',
                logs: error.logs,
                code: error.code,
            });
        }
    });

    router.get('/tpdb-cache', async (_req, res) => {
        try {
            const status = await getTpdbCacheStatus();
            res.json({ ok: true, ...status });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to read TPDB cache status' });
        }
    });

    router.post('/tpdb-cache/audit-disk', async (_req, res) => {
        try {
            const audit = await auditTpdbCacheDisk();
            const status = await getTpdbCacheStatus();
            res.json({ ok: true, ...status, audit });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to audit TPDB cache on disk' });
        }
    });

    router.post('/tpdb-cache/clear', async (_req, res) => {
        try {
            const cleared = await clearTpdbLocalCache();
            await dropBrowseSetsForProvider('posterdb').catch(() => ({ removed: 0 }));
            await dropCollectionSetsForProvider('posterdb').catch(() => ({ removed: 0 }));
            res.json({ ok: true, cleared });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to clear TPDB cache' });
        }
    });

    router.post('/mediux-cache/clear', async (_req, res) => {
        try {
            const browse = await dropBrowseSetsForProvider('mediux').catch(() => ({ removed: 0 }));
            const collections = await dropCollectionSetsForProvider('mediux').catch(() => ({ removed: 0 }));
            res.json({
                ok: true,
                cleared: {
                    browse: browse?.removed || 0,
                    collections: collections?.removed || 0,
                },
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to clear MediUX cache' });
        }
    });

    router.post('/tpdb-cache/pause', async (_req, res) => {
        try {
            res.json({ ok: true, ...pauseTpdbCacheWork() });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to pause TPDB cache work' });
        }
    });

    router.post('/tpdb-cache/resume', async (_req, res) => {
        try {
            res.json({ ok: true, ...resumeTpdbCacheWork() });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to resume TPDB cache work' });
        }
    });

    router.post('/tpdb-cache/stop', async (_req, res) => {
        try {
            const result = await stopTpdbCacheWork();
            res.json({ ok: true, ...result });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to stop TPDB cache work' });
        }
    });

    router.post('/tpdb-cache/coverage', async (req, res) => {
        try {
            const items = Array.isArray(req.body?.items) ? req.body.items : [];
            const coverage = await resolveTpdbTitleCoverage(items);
            res.json({ ok: true, coverage });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to resolve TPDB coverage' });
        }
    });

    /**
     * Warm TPDB cache for library titles only (pass items with tmdbId / title / year / mediaType).
     * Titles are resolved one-at-a-time with spacing; set image hydrate stays under the asset rate budget.
     */
    router.post('/tpdb-cache/warm-library', async (req, res) => {
        try {
            const config = await loadPosterSetsConfig();
            if (!isPosterSetsTpdbEnabled(config)) {
                return res.status(400).json({ error: 'ThePosterDB is turned off in Poster Sets settings.' });
            }
            if (config.tpdbLocalCacheEnabled !== true) {
                return res.status(400).json({ error: 'TPDB local cache is disabled in settings.' });
            }
            const fromLibrary = req.body?.fromLibrary === true;
            const items = Array.isArray(req.body?.items) ? req.body.items : [];
            const media = req.body?.media === 'movie' || req.body?.media === 'show'
                || req.body?.media === 'tv' || req.body?.media === 'series'
                ? (req.body.media === 'tv' || req.body.media === 'series' ? 'show' : req.body.media)
                : (config.tpdbCacheWarmMedia === 'movie' || config.tpdbCacheWarmMedia === 'show'
                    ? config.tpdbCacheWarmMedia
                    : 'all');
            const source = req.body?.source === 'recent'
                ? 'recent'
                : (req.body?.source === 'full'
                    ? 'full'
                    : (config.tpdbCacheWarmSource === 'recent' ? 'recent' : 'full'));
            const force = req.body?.force === true
                || req.body?.skipCached === false
                || (req.body?.skipCached == null && req.body?.force == null && config.tpdbCacheSkipCached === false);
            const followedPrefetchOnly = req.body?.followedPrefetchOnly === true;
            const followedCreatorsOnly = req.body?.followedCreatorsOnly === true
                ? true
                : req.body?.followedCreatorsOnly === false
                    ? false
                    : config.tpdbCacheFollowedCreatorsOnly === true;

            if (fromLibrary) {
                const stored = await loadPosterSetsConfig({ includePortalPlex: false });
                await savePosterSetsConfig({
                    ...stored,
                    tpdbCacheWarmMedia: media,
                    tpdbCacheWarmSource: source,
                    tpdbCacheSkipCached: !force,
                    tpdbCacheFollowedCreatorsOnly: followedCreatorsOnly,
                    tpdbPrioritizeFollowedCreators: followedPrefetchOnly
                        ? true
                        : stored.tpdbPrioritizeFollowedCreators,
                });
            }

            let normalized = items.slice(0, 2000).map((item) => {
                const tmdbId = String(item?.tmdbId || '').trim();
                const tvdbId = String(item?.tvdbId || item?.tvdb_id || '').trim();
                const hasTmdb = /^\d+$/.test(tmdbId);
                const hasTvdb = /^\d+$/.test(tvdbId);
                return {
                    ...(hasTmdb ? { tmdbId } : {}),
                    ...(hasTvdb ? { tvdbId } : {}),
                    title: String(item?.title || '').trim(),
                    year: item?.year ?? null,
                    mediaType: resolvePosterSetsMediaType(item?.mediaType, 'movie'),
                };
            }).filter((item) => item.tmdbId || item.tvdbId);
            if (fromLibrary || !normalized.length) {
                if (!fromLibrary && !items.length) {
                    return res.status(400).json({ error: 'items[] of library titles (with tmdbId) is required' });
                }
                if (fromLibrary) {
                    normalized = await collectLibraryWarmItems({
                        media,
                        source,
                        skipCached: !force,
                        exhaustedKeys: [],
                        limit: 400,
                    });
                    if (!normalized.length) {
                        return res.json({
                            ok: true,
                            started: false,
                            titles: 0,
                            skippedCached: 0,
                            message: 'No uncached library titles with TMDB/TVDB ids left to queue. Background catch-up will retry if new titles appear.',
                        });
                    }
                }
            }

            if (media === 'movie' || media === 'show') {
                normalized = normalized.filter((item) => warmMediaAllows(media, item.mediaType));
            }

            if (!normalized.length) {
                if (fromLibrary) {
                    return res.json({
                        ok: true,
                        started: false,
                        titles: 0,
                        skippedCached: 0,
                        message: 'No uncached library titles with TMDB/TVDB ids left to queue. Background catch-up will retry if new titles appear.',
                    });
                }
                return res.status(400).json({ error: 'No library items with numeric TMDB or TVDB ids to warm.' });
            }

            if (!hasTpdbCredentials(config) || config.tpdbUseLogin === false) {
                warmForcePublicSearch = true;
                logTpdbCacheActivity(
                    config.tpdbUseLogin === false
                        ? 'Cache: TPDB login disabled — using public text search (title pages/sets/images need no login).'
                        : 'Cache: TPDB username/password not configured — using public text search.',
                    { level: 'warn', current: true },
                );
            } else {
                warmForcePublicSearch = false;
                logTpdbCacheActivity('Cache: probing TPDB login for advanced TMDB resolve (optional)', {
                    current: true,
                });
                try {
                    const loginProbe = await runPosterSetsCli('test-tpdb', {
                        config: cliConfigPayload(config),
                    }, { timeoutMs: 90_000 });
                    if (!loginProbe.ok) {
                        const probeError = loginProbe.error || 'check username/password / Pro';
                        // Do not force public for the whole Build — webhook still logs in
                        // per title. Public search is too weak for TV (TVDB advanced needs login).
                        logTpdbCacheActivity(
                            `Cache: TPDB login probe failed — ${probeError}. Library cache will still try login per title (same as webhook).`,
                            { level: 'warn', current: true },
                        );
                    } else {
                        logTpdbCacheActivity('Cache: TPDB login probe OK', { current: true });
                    }
                } catch (probeError) {
                    logTpdbCacheActivity(
                        `Cache: TPDB login probe error — ${probeError?.message || probeError}. Library cache will still try login per title (same as webhook).`,
                        { level: 'warn', current: true },
                    );
                }
            }

            let warmSoftSkips = 0;
            let warmSuccesses = 0;

            const queued = await enqueueTpdbLibraryWarm(normalized, async (item) => {
                const result = await warmFetchTitleSets(item);
                if (result?.softSkip) {
                    warmSoftSkips += 1;
                    if (warmSoftSkips === 5 && warmSuccesses === 0) {
                        logTpdbCacheActivity(
                            'Cache: first 5 titles all skipped — check TPDB Pro/login (Settings → Test) and that nightly includes the serial-scrape fix.',
                            { level: 'error', current: true },
                        );
                    }
                    return result;
                }
                if (!(result?.sets || []).length) {
                    warmSoftSkips += 1;
                    if (warmSoftSkips === 5 && warmSuccesses === 0) {
                        logTpdbCacheActivity(
                            'Cache: first 5 titles returned 0 sets — TPDB resolve/login is likely broken on this host.',
                            { level: 'error', current: true },
                        );
                    }
                    return {
                        ...result,
                        softSkip: true,
                        softError: 'No ThePosterDB sets found for this title',
                    };
                }
                warmSuccesses += 1;
                return result;
            }, {
                force,
                followedPrefetchOnly,
                followedCreatorsOnly,
                autoContinue: true,
                resetExhausted: fromLibrary || force,
                priority: source === 'recent',
            });

            ensureFollowedCollectionSetsCached();

            const skipped = Number(queued.skippedCached) || 0;
            const queuedCount = Number(queued.queued) || 0;
            const skipNote = skipped
                ? ` Skipped ${skipped} already cached — continuing where the last cache build left off.`
                : '';
            const continueNote = fromLibrary
                ? ' Continues in the background until the rest of the library is attempted.'
                : '';
            res.json({
                ok: true,
                started: true,
                titles: queuedCount,
                skippedCached: skipped,
                message: warmForcePublicSearch
                    ? `Queued ${queuedCount} library title(s) for public-search cache build (no TPDB login).${skipNote}${continueNote}`
                    : hasTpdbCredentials(config)
                        ? `Queued ${queuedCount} library title(s) for cache build${config.tpdbWarmParallelWorkers === true ? ' (5 parallel workers)' : ''} — set lists only; images hydrate on open.${skipNote}${continueNote}`
                        : `Queued ${queuedCount} title(s).${skipNote}${continueNote}`,
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Cache build failed' });
        }
    });

    router.post('/browse', async (req, res) => {
        try {
            if (!posterSetsWorkerReady()) {
                return res.status(503).json({ error: 'Poster Sets worker is not available in this container.' });
            }
            const refresh = Boolean(req.body?.refresh);
            const snapshot = await getBrowseRailsSnapshot({ refresh });
            res.json(snapshot);
        } catch (error) {
            res.status(error.status || 500).json({
                error: error.message || 'Browse failed',
            });
        }
    });

    router.post('/collections', async (req, res) => {
        try {
            if (!posterSetsWorkerReady()) {
                return res.status(503).json({ error: 'Poster Sets worker is not available in this container.' });
            }
            const refresh = Boolean(req.body?.refresh);
            const snapshot = await getCollectionSetsSnapshot({ refresh });
            res.json(snapshot);
        } catch (error) {
            res.status(error.status || 500).json({
                error: error.message || 'Collection sets failed',
            });
        }
    });

    router.get('/image', async (req, res) => {
        const sendPlaceholder = (status = 404) => {
            if (res.headersSent) return;
            // Prefer 404/plain over 502/JSON so Cloudflare doesn't brand this as Bad Gateway,
            // and <img onError> can swap in a local placeholder.
            res.status(status);
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Cache-Control', 'private, max-age=15');
            res.send('image unavailable');
        };
        const sendImage = (buf, contentType, { cacheHit = false } = {}) => {
            if (res.headersSent || res.writableEnded) return;
            res.status(200);
            res.setHeader('Content-Type', contentType || 'image/jpeg');
            res.setHeader(
                'Cache-Control',
                cacheHit
                    ? 'private, max-age=604800, stale-while-revalidate=604800'
                    : 'private, max-age=86400, stale-while-revalidate=604800',
            );
            res.setHeader('Content-Length', String(buf.length));
            res.setHeader('X-Poster-Sets-Cache', cacheHit ? 'HIT' : 'MISS');
            res.send(buf);
        };
        try {
            const raw = String(req.query?.url || '').trim();
            if (!raw) return sendPlaceholder(400);
            let parsed;
            try {
                parsed = new URL(raw);
            } catch {
                return sendPlaceholder(400);
            }
            const host = parsed.hostname.toLowerCase();
            const allowed = (
                host === 'api.mediux.pro'
                || host === 'mediux.pro'
                || host.endsWith('.mediux.pro')
                || host === 'theposterdb.com'
                || host === 'www.theposterdb.com'
                || host === 'images.theposterdb.com'
                || host.endsWith('.theposterdb.com')
                || host === 'image.tmdb.org'
            );
            if (!allowed) return sendPlaceholder(400);

            const cached = await loadCachedImage(raw);
            if (cached) {
                return sendImage(cached.buf, cached.contentType, { cacheHit: true });
            }

            const referer = host.includes('posterdb')
                ? 'https://theposterdb.com/'
                : host.includes('tmdb')
                    ? 'https://www.themoviedb.org/'
                    : 'https://mediux.pro/';

            await withImageProxySlot(async () => {
                if (res.writableEnded) return;
                // Another request may have filled the cache while we waited for a slot.
                const cachedAfterWait = await loadCachedImage(raw);
                if (cachedAfterWait) {
                    return sendImage(cachedAfterWait.buf, cachedAfterWait.contentType, { cacheHit: true });
                }

                let response = null;
                let lastError = null;
                for (let attempt = 0; attempt < 4; attempt += 1) {
                    try {
                        response = await fetch(raw, {
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                                Accept: 'image/jpeg,image/png,image/webp;q=0.9,image/*;q=0.8,*/*;q=0.7',
                                Referer: referer,
                                'Accept-Language': 'en-US,en;q=0.9',
                            },
                            redirect: 'follow',
                            signal: AbortSignal.timeout(20_000),
                        });
                        if (response.ok) break;
                        lastError = new Error(`Upstream image failed (${response.status})`);
                        if (response.status === 429) {
                            const retryAfterRaw = Number(response.headers.get('retry-after'));
                            const waitMs = Number.isFinite(retryAfterRaw)
                                ? Math.min(8_000, Math.max(1_000, retryAfterRaw * 1000))
                                : 1_500 + attempt * 1_000;
                            await sleep(waitMs);
                            continue;
                        }
                        if (response.status >= 500) {
                            await sleep(300 + attempt * 400);
                            continue;
                        }
                        break;
                    } catch (error) {
                        lastError = error;
                        response = null;
                        await sleep(300 + attempt * 400);
                    }
                }

                if (!response?.ok) {
                    void lastError;
                    return sendPlaceholder(404);
                }
                const contentType = response.headers.get('content-type') || 'image/jpeg';
                if (!String(contentType).toLowerCase().startsWith('image/')) {
                    return sendPlaceholder(404);
                }

                const buf = Buffer.from(await response.arrayBuffer());
                if (!buf.length) return sendPlaceholder(404);
                await storeCachedImage(raw, buf, contentType);
                sendImage(buf, contentType, { cacheHit: false });
            });
        } catch {
            sendPlaceholder(404);
        }
    });

    const recoverStaleRunningJobs = async () => {
        const state = await loadPosterSetsQueue();
        const now = Date.now();
        for (const job of state.jobs || []) {
            if (job.state !== 'running') continue;
            const started = Date.parse(job.startedAt || '') || 0;
            const last = Date.parse(job.lastProgressAt || job.startedAt || '') || started;
            const runningMs = started ? now - started : 0;
            const idleMs = last ? now - last : runningMs;
            const stale = (runningMs > 5 * 60 * 1000 && idleMs > STALE_PROGRESS_MS)
                || (started && runningMs > MAX_RUNNING_MS);
            if (!stale) continue;
            if (activeQueueJobId === job.id) {
                killActivePosterSetsWorker();
                activeQueueJobId = null;
            }
            const failed = await patchPosterSetsQueueJob(job.id, {
                state: 'failed',
                finishedAt: new Date().toISOString(),
                error: 'Job stalled (no progress). Use Retry to re-queue.',
            });
            mirrorJob(failed);
            try { await upsertPosterSetsHistory(failed); } catch { /* ignore */ }
            try { await appendPosterSetsAudit(auditEntryFromJob(failed)); } catch { /* ignore */ }
        }
    };

    const runQueuedJob = async (job) => {
        activeQueueJobId = job.id;
        try {
        mirrorJob(job);
        const config = await loadPosterSetsConfig();
        const applyDest = String(config.applyDestination || 'plex').toLowerCase();
        if (needsPlexPosterSetsConfig(config, job.type) && (!config.base_url || !config.token)) {
            const failed = await patchPosterSetsQueueJob(job.id, {
                state: 'failed',
                finishedAt: new Date().toISOString(),
                error: 'Configure Plex URL and token under Settings → Media Player first.',
            });
            mirrorJob(failed);
            try { await upsertPosterSetsHistory(failed); } catch { /* ignore */ }
            return;
        }

        const input = job.input || {};
        let payload;
        try {
            if (job.type === 'bulk') {
                if (input.fromFile) {
                    const filePath = resolveBulkFilePath(config);
                    const fileText = await fs.readFile(filePath, 'utf8');
                    payload = { config: cliConfigPayload(config), text: fileText };
                } else if (Array.isArray(input.urls) && input.urls.length) {
                    payload = { config: cliConfigPayload(config), urls: input.urls };
                } else if (input.text) {
                    payload = { config: cliConfigPayload(config), text: String(input.text) };
                } else {
                    throw new Error('Bulk queue item is missing urls/text/file');
                }
            } else {
                const url = String(input.url || '').trim();
                if (!url) throw new Error('Queue item is missing set URL');
                const selectedIds = Array.isArray(input.selectedIds)
                    ? input.selectedIds.map((item) => String(item || '').trim()).filter(Boolean)
                    : null;
                const selectedAssets = Array.isArray(input.selectedAssets)
                    ? input.selectedAssets.filter((item) => item && typeof item === 'object')
                    : null;
                payload = {
                    config: cliConfigPayload(config, input.mediuxFilters),
                    url,
                    ...(selectedIds?.length ? { selectedIds } : {}),
                    ...(selectedAssets?.length ? { selectedAssets } : {}),
                    ...(input.plexHint ? { plexHint: input.plexHint } : {}),
                };
            }
        } catch (error) {
            const failed = await patchPosterSetsQueueJob(job.id, {
                state: 'failed',
                finishedAt: new Date().toISOString(),
                error: error?.message || 'Invalid queue item',
            });
            mirrorJob(failed);
            try { await upsertPosterSetsHistory(failed); } catch { /* ignore */ }
            return;
        }

        let progressFlushTimer = null;
        /** @type {string[]} */
        let pendingLogMessages = [];

        const flushProgressLogs = async () => {
            progressFlushTimer = null;
            if (!pendingLogMessages.length) return;
            const batch = pendingLogMessages;
            pendingLogMessages = [];
            const current = await getPosterSetsQueueJob(job.id);
            const logs = [
                ...(Array.isArray(current?.logs) ? current.logs : []),
                ...batch.map((message) => ({ at: new Date().toISOString(), message })),
            ].slice(-500);
            const patched = await patchPosterSetsQueueJob(job.id, {
                logs,
                lastProgressAt: new Date().toISOString(),
            });
            mirrorJob(patched);
        };

        const onProgress = (message) => {
            pendingLogMessages.push(String(message || ''));
            if (!progressFlushTimer) {
                progressFlushTimer = setTimeout(() => { void flushProgressLogs(); }, QUEUE_PROGRESS_DEBOUNCE_MS);
            }
        };

        try {
            let run;
            if (job.type === 'apply' && (applyDest === 'jellyfin' || applyDest === 'emby')) {
                const portalConfig = typeof loadPortalConfig === 'function'
                    ? await loadPortalConfig().catch(() => ({}))
                    : {};
                // Prefetch TPDB bytes into local cache so Jellyfin/Emby apply can reuse them.
                if (isTpdbUrl(payload.url)) {
                    const imageUrls = collectTpdbApplyImageUrls(payload);
                    if (imageUrls.length) {
                        await ensureTpdbImagesCached(imageUrls, { onProgress });
                    }
                }
                const result = await applyPosterSetToJellyfinLike({
                    portalConfig,
                    config,
                    url: payload.url,
                    selectedIds: payload.selectedIds || null,
                    mediuxFilters: input.mediuxFilters || null,
                    destination: applyDest,
                    onProgress: (message) => { onProgress(message); },
                });
                run = { ok: !!result.ok, result, logs: [] };
            } else {
                // Title/set metadata can be cached while image bins are cold — stage images first.
                if (job.type === 'apply' && isTpdbUrl(payload.url)) {
                    let imageUrls = collectTpdbApplyImageUrls(payload);
                    if (!imageUrls.length) {
                        const cachedPreview = await previewFromTpdbSetCache(payload.url);
                        let assets = Array.isArray(cachedPreview?.assets) ? cachedPreview.assets : [];
                        const wanted = Array.isArray(payload.selectedIds) && payload.selectedIds.length
                            ? new Set(payload.selectedIds.map(String))
                            : null;
                        if (wanted) {
                            assets = assets.filter((asset) => wanted.has(String(asset?.id || '')));
                        }
                        imageUrls = collectTpdbApplyImageUrls({
                            ...payload,
                            selectedAssets: assets,
                        });
                    }
                    if (imageUrls.length) {
                        await ensureTpdbImagesCached(imageUrls, { onProgress });
                    }
                }
                run = await runPosterSetsCli(job.type === 'bulk' ? 'bulk' : 'apply', payload, {
                    timeoutMs: applyTimeoutMs(payload),
                    onProgress: (message) => { onProgress(message); },
                });
                // Offline apply: live TPDB scrape/download failed but we have a hydrated set cache + local images.
                if (
                    !run.ok
                    && job.type === 'apply'
                    && isTpdbUrl(payload.url)
                    && config.tpdbLocalCacheEnabled === true
                ) {
                    const cachedPreview = await previewFromTpdbSetCache(payload.url);
                    if (cachedPreview?.assets?.length) {
                        onProgress('Live ThePosterDB apply failed — retrying from local TPDB cache…');
                        let assets = cachedPreview.assets;
                        const wanted = Array.isArray(payload.selectedIds) && payload.selectedIds.length
                            ? new Set(payload.selectedIds.map(String))
                            : null;
                        if (wanted) {
                            assets = assets.filter((asset) => wanted.has(String(asset?.id || '')));
                        }
                        if (assets.length) {
                            const retryUrls = assets
                                .map((asset) => String(asset?.url || asset?.thumbUrl || '').trim())
                                .filter(Boolean);
                            if (retryUrls.length) {
                                await ensureTpdbImagesCached(retryUrls, { onProgress });
                            }
                            const offlinePayload = {
                                ...payload,
                                selectedIds: assets.map((asset) => String(asset.id)).filter(Boolean),
                                selectedAssets: assets,
                            };
                            run = await runPosterSetsCli('apply', offlinePayload, {
                                timeoutMs: applyTimeoutMs(offlinePayload),
                                onProgress: (message) => { onProgress(message); },
                            });
                            if (run.ok) {
                                onProgress(`Applied ${assets.length} asset(s) from local ThePosterDB cache.`);
                            }
                        }
                    }
                }
            }
            if (progressFlushTimer) clearTimeout(progressFlushTimer);
            await flushProgressLogs();
            const currentJob = await getPosterSetsQueueJob(job.id);
            if (currentJob?.state === 'cancelled') return;
            const finishedAt = new Date().toISOString();
            let nextInput = input;
            const setMeta = pickSetMeta({ input, result: run.result });
            if (setMeta) nextInput = { ...input, setMeta };
            const uploadedCount = Number(run.result?.uploaded);
            const attemptedCount = Number(run.result?.attempted);
            const uploadedNothing = Number.isFinite(uploadedCount) && uploadedCount <= 0
                && (
                    job.type === 'apply'
                    || job.type === 'bulk'
                    || (Number.isFinite(attemptedCount) && attemptedCount >= 0)
                );
            const missingLibrary = isMissingLibraryApplyResult(run.result);
            const succeeded = !!run.ok && !uploadedNothing;
            const isWarning = !succeeded && missingLibrary;
            const failError = !succeeded && !isWarning
                ? (
                    run.result?.error
                    || run.error
                    || (uploadedNothing
                        ? `Applied 0 poster(s)${Number.isFinite(attemptedCount) ? ` of ${attemptedCount}` : ''} — nothing changed on the media server.`
                        : 'Apply failed')
                )
                : null;
            const selectedIds = Array.isArray(nextInput.selectedIds)
                ? nextInput.selectedIds.map(String)
                : [];
            let pinnedWatch = null;
            if (job.type === 'apply' && isWarning) {
                try {
                    pinnedWatch = await autoWatchFromMissingLibrary({
                        url: nextInput.url,
                        setMeta: nextInput.setMeta || setMeta,
                        selectedIds: selectedIds.length ? selectedIds : undefined,
                        mediuxFilters: nextInput.mediuxFilters,
                        plexHint: nextInput.plexHint || null,
                    });
                    if (pinnedWatch) {
                        nextInput = { ...nextInput, watchId: pinnedWatch.id };
                    }
                } catch { /* ignore */ }
            }
            let bulkPinned = [];
            if (job.type === 'bulk') {
                try {
                    bulkPinned = await autoWatchFromBulkJob({ input: nextInput, result: run.result }) || [];
                } catch { /* ignore */ }
            }
            const bulkUrlCount = Array.isArray(nextInput.urls)
                ? nextInput.urls.map((item) => String(item || '').trim()).filter(Boolean).length
                : 0;
            const warningTitle = (job.type === 'bulk' && bulkUrlCount > 1)
                ? 'These titles'
                : (setMeta?.title || nextInput.setMeta?.title);
            const warningError = isWarning
                ? missingLibraryApplyAdvice(warningTitle, {
                    pinned: Boolean(pinnedWatch) || bulkPinned.length > 0,
                })
                : null;
            const patched = await patchPosterSetsQueueJob(job.id, {
                state: succeeded ? 'succeeded' : (isWarning ? 'warning' : 'failed'),
                finishedAt,
                error: warningError || failError,
                result: run.result || null,
                input: nextInput,
            });
            mirrorJob(patched);
            try { await upsertPosterSetsHistory(patched); } catch { /* ignore */ }
            try { await appendPosterSetsAudit(auditEntryFromJob(patched)); } catch { /* ignore */ }
            if (job.type === 'apply') {
                if (succeeded) {
                    if (nextInput.watchId && selectedIds.length) {
                        const appliedIds = resolveAppliedAssetIdsFromResult(selectedIds, run.result);
                        if (appliedIds.length) {
                            try { await markWatchAssetsApplied(nextInput.watchId, appliedIds); } catch { /* ignore */ }
                        }
                    }
                    try {
                        await autoWatchFromApply({
                            url: nextInput.url,
                            setMeta: nextInput.setMeta || setMeta,
                            selectedIds: selectedIds.length ? selectedIds : undefined,
                            mediuxFilters: nextInput.mediuxFilters,
                            plexHint: nextInput.plexHint || null,
                        });
                    } catch { /* ignore */ }
                } else if (pinnedWatch) {
                    const note = missingLibraryWatchNote(pinnedWatch, nextInput);
                    const logs = [
                        ...(Array.isArray(patched.logs) ? patched.logs : []),
                        { at: new Date().toISOString(), message: note },
                    ].slice(-500);
                    const withWatch = await patchPosterSetsQueueJob(job.id, { logs });
                    mirrorJob(withWatch);
                }
            }
        } catch (error) {
            if (progressFlushTimer) clearTimeout(progressFlushTimer);
            await flushProgressLogs().catch(() => undefined);
            const currentJob = await getPosterSetsQueueJob(job.id);
            if (currentJob?.state === 'cancelled') return;
            const failed = await patchPosterSetsQueueJob(job.id, {
                state: 'failed',
                finishedAt: new Date().toISOString(),
                error: error?.message || 'Apply failed',
            });
            mirrorJob(failed);
            try { await upsertPosterSetsHistory(failed); } catch { /* ignore */ }
            try { await appendPosterSetsAudit(auditEntryFromJob(failed)); } catch { /* ignore */ }
        }
        } finally {
            activeQueueJobId = null;
        }
    };

    const tickPosterSetsQueue = async () => {
        if (queueWorkerBusy) return;
        queueWorkerBusy = true;
        try {
            await recoverStaleRunningJobs();
            const claimed = await claimNextPosterSetsJob();
            if (claimed) await runQueuedJob(claimed);
        } catch (error) {
            console.error('[poster-sets] queue worker tick failed:', error?.message || error);
        } finally {
            queueWorkerBusy = false;
        }
    };

    const ensureQueueWorker = () => {
        if (queueTickTimer) return;
        void recoverPosterSetsQueue().then(() => tickPosterSetsQueue()).catch(() => undefined);
        queueTickTimer = setInterval(() => { void tickPosterSetsQueue(); }, 1500);
        if (typeof queueTickTimer.unref === 'function') queueTickTimer.unref();
    };

    const enqueueApplyJob = async (type, input) => {
        const config = await loadPosterSetsConfig();
        const dest = String(config.applyDestination || 'plex').toLowerCase();
        if (needsPlexPosterSetsConfig(config, type) && (!config.base_url || !config.token)) {
            const error = new Error('Configure Plex URL and token under Settings → Media Player first.');
            error.status = 400;
            throw error;
        }
        if (type === 'apply' && (dest === 'jellyfin' || dest === 'emby')) {
            const portalConfig = typeof loadPortalConfig === 'function'
                ? await loadPortalConfig().catch(() => ({}))
                : {};
            const url = dest === 'emby'
                ? String(portalConfig.embyUrl || portalConfig.jellyfinUrl || '').trim()
                : String(portalConfig.jellyfinUrl || '').trim();
            const apiKey = dest === 'emby'
                ? String(portalConfig.embyApiKey || portalConfig.jellyfinApiKey || '').trim()
                : String(portalConfig.jellyfinApiKey || '').trim();
            if (!url || !apiKey) {
                const label = dest === 'emby' ? 'Emby' : 'Jellyfin';
                const error = new Error(`${label} URL and API key are required under Settings → Media Player.`);
                error.status = 400;
                throw error;
            }
        }
        const job = await enqueuePosterSetsJob(type, input);
        mirrorJob(job);
        ensureQueueWorker();
        void tickPosterSetsQueue();
        return job;
    };

    setPosterSetsEnqueueApply(enqueueApplyJob);
    ensureQueueWorker();

    router.post('/apply', async (req, res) => {
        try {
            const url = String(req.body?.url || '').trim();
            if (!url) return res.status(400).json({ error: 'url is required' });
            const selectedIds = Array.isArray(req.body?.selectedIds)
                ? req.body.selectedIds.map((item) => String(item || '').trim()).filter(Boolean)
                : null;
            const setMeta = req.body?.setMeta && typeof req.body.setMeta === 'object'
                ? req.body.setMeta
                : null;
            const sourceRaw = String(req.body?.source || '').trim().toLowerCase();
            const source = sourceRaw === 'bulk' || sourceRaw === 'watch' ? sourceRaw : 'manual';
            const mediuxFilters = Array.isArray(req.body?.mediuxFilters)
                ? req.body.mediuxFilters.map((item) => String(item || '').trim()).filter(Boolean)
                : (Array.isArray(req.body?.mediux_filters)
                    ? req.body.mediux_filters.map((item) => String(item || '').trim()).filter(Boolean)
                    : null);
            const plexHint = req.body?.plexHint && typeof req.body.plexHint === 'object'
                ? req.body.plexHint
                : null;
            const selectedAssets = Array.isArray(req.body?.selectedAssets)
                ? req.body.selectedAssets.filter((item) => item && typeof item === 'object')
                : null;
            const job = await enqueueApplyJob('apply', {
                url,
                selectedIds: selectedIds?.length ? selectedIds : null,
                selectedCount: selectedIds?.length || null,
                setMeta,
                source,
                ...(mediuxFilters?.length ? { mediuxFilters } : {}),
                ...(plexHint ? { plexHint } : {}),
                ...(selectedAssets?.length ? { selectedAssets } : {}),
            });
            if (isTpdbUrl(url)) {
                void cacheExplicitTpdbUrl(url, {
                    setMeta,
                    assets: selectedAssets,
                    setId: setMeta?.setId,
                    title: setMeta?.title,
                    user: setMeta?.user,
                    thumbUrl: setMeta?.thumbUrl,
                    total: selectedAssets?.length || selectedIds?.length,
                });
            }
            res.status(202).json({ ok: true, jobId: job.id, job, queued: true });
        } catch (error) {
            res.status(error.status || 500).json({ error: error.message || 'Apply failed' });
        }
    });

    router.post('/bulk', async (req, res) => {
        try {
            const urls = Array.isArray(req.body?.urls) ? req.body.urls : null;
            const text = String(req.body?.text || '');
            const useFile = !!req.body?.fromFile;
            let input = { fromFile: useFile };

            if (useFile) {
                const config = await loadPosterSetsConfig();
                const filePath = resolveBulkFilePath(config);
                try {
                    const fileText = await fs.readFile(filePath, 'utf8');
                    input = {
                        fromFile: true,
                        file: config.bulk_txt,
                        text: fileText,
                        lineCount: fileText.split(/\r?\n/).filter((line) => {
                            const trimmed = line.trim();
                            return trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//');
                        }).length,
                    };
                } catch (error) {
                    if (error?.code === 'ENOENT') {
                        return res.status(400).json({ error: `Bulk file not found: ${config.bulk_txt}` });
                    }
                    throw error;
                }
            } else if (urls?.length) {
                input = { urls, count: urls.length };
            } else if (text.trim()) {
                const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => (
                    line && !line.startsWith('#') && !line.startsWith('//')
                ));
                input = { urls: lines.slice(0, 8), text, count: lines.length };
            } else {
                return res.status(400).json({ error: 'Provide urls, text, or fromFile for bulk apply' });
            }

            const job = await enqueueApplyJob('bulk', input);
            const seedUrls = Array.isArray(input.urls) ? input.urls : [];
            for (const seedUrl of seedUrls) {
                if (isTpdbUrl(seedUrl)) void cacheExplicitTpdbUrl(seedUrl, { force: true });
            }
            res.status(202).json({ ok: true, jobId: job.id, job, queued: true });
        } catch (error) {
            res.status(error.status || 500).json({ error: error.message || 'Bulk apply failed' });
        }
    });

    router.get('/queue', async (_req, res) => {
        try {
            const state = await loadPosterSetsQueue();
            res.json({
                ok: true,
                paused: state.paused,
                stats: queueStats(state),
                jobs: state.jobs.map((job) => ({
                    ...summarizeJob(job),
                    logCount: Array.isArray(job.logs) ? job.logs.length : 0,
                    startedAt: job.startedAt || null,
                })),
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to load queue' });
        }
    });

    router.post('/queue/pause', async (req, res) => {
        try {
            const paused = req.body?.paused !== undefined ? Boolean(req.body.paused) : true;
            const state = await setPosterSetsQueuePaused(paused);
            ensureQueueWorker();
            if (!paused) void tickPosterSetsQueue();
            res.json({ ok: true, paused: state.paused, stats: queueStats(state) });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to update queue pause' });
        }
    });

    router.post('/queue/cancel/:id', async (req, res) => {
        try {
            const cancelled = await cancelPosterSetsQueueJob(req.params.id);
            if (!cancelled) {
                return res.status(404).json({ error: 'Queued job not found (only pending items can be cancelled).' });
            }
            mirrorJob(cancelled);
            try { await upsertPosterSetsHistory(cancelled); } catch { /* ignore */ }
            res.json({ ok: true, job: summarizeJob(cancelled) });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to cancel queue item' });
        }
    });

    router.post('/queue/stop/:id', async (req, res) => {
        try {
            const job = await getPosterSetsQueueJob(req.params.id);
            if (!job || job.state !== 'running') {
                return res.status(404).json({ error: 'Running job not found.' });
            }
            if (activeQueueJobId === job.id) {
                killActivePosterSetsWorker();
                activeQueueJobId = null;
            }
            const stopped = await stopPosterSetsRunningJob(job.id);
            if (!stopped) {
                return res.status(404).json({ error: 'Running job not found.' });
            }
            mirrorJob(stopped);
            try { await upsertPosterSetsHistory(stopped); } catch { /* ignore */ }
            res.json({ ok: true, job: summarizeJob(stopped) });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to stop queue item' });
        }
    });

    router.post('/queue/retry/:id', async (req, res) => {
        try {
            const retried = await retryPosterSetsQueueJob(req.params.id);
            if (!retried) {
                return res.status(404).json({ error: 'Failed or cancelled job not found.' });
            }
            mirrorJob(retried);
            ensureQueueWorker();
            void tickPosterSetsQueue();
            res.status(202).json({ ok: true, job: summarizeJob(retried) });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to retry queue item' });
        }
    });

    router.post('/queue/clear-finished', async (_req, res) => {
        try {
            const state = await clearPosterSetsFinishedQueue();
            res.json({ ok: true, stats: queueStats(state), jobs: state.jobs.map(summarizeJob) });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to clear finished queue items' });
        }
    });

    router.post('/queue/dismiss/:id', async (req, res) => {
        try {
            const { removed, state } = await dismissPosterSetsQueueJob(req.params.id);
            if (!removed) {
                return res.status(404).json({ error: 'Finished queue item not found (queued/running jobs cannot be dismissed).' });
            }
            res.json({ ok: true, job: summarizeJob(removed), stats: queueStats(state), jobs: state.jobs.map(summarizeJob) });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to dismiss queue item' });
        }
    });

    router.post('/queue/clear-queued', async (_req, res) => {
        try {
            const { state, cancelled, cancelledJobs } = await clearPosterSetsQueuedJobs();
            for (const job of cancelledJobs || []) {
                mirrorJob(job);
                try { await upsertPosterSetsHistory(job); } catch { /* ignore */ }
            }
            res.json({ ok: true, cancelled, stats: queueStats(state), jobs: state.jobs.map(summarizeJob) });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to clear queued items' });
        }
    });

    router.get('/watches', async (req, res) => {
        try {
            const watches = await listPosterSetsWatches();
            const urlFilter = String(req.query?.url || '').trim();
            if (urlFilter) {
                const match = watches.find((watch) => watch.url === urlFilter) || null;
                const explained = match
                    ? {
                        ...match,
                        lastError: explainPosterSetsPageError(match.lastError, match.url) || match.lastError,
                    }
                    : null;
                return res.json({ ok: true, watch: explained, watches: explained ? [explained] : [], stats: watchStats(watches) });
            }
            res.json({ ok: true, watches: watches.map(summarizeWatch), stats: watchStats(watches) });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to load watches' });
        }
    });

    router.post('/watches', async (req, res) => {
        try {
            const body = req.body && typeof req.body === 'object' ? req.body : {};
            const url = String(body.url || '').trim();
            const replaceExisting = Boolean(body.replaceExisting);
            const existed = url
                ? Boolean((await listPosterSetsWatches()).find((watch) => watch.url === url))
                : false;
            const watch = await upsertPosterSetsWatch(body);
            // Baseline fingerprints immediately so pinning an existing set doesn't re-apply everything.
            try {
                await checkPosterSetsWatch(watch, { enqueue: false });
            } catch {
                /* keep watch even if baseline scrape fails */
            }
            const refreshed = await getPosterSetsWatch(watch.id) || watch;
            const conflicts = findOverlappingTitleWatches(await listPosterSetsWatches(), refreshed);
            if (conflicts.length && !replaceExisting) {
                if (!existed) {
                    try { await deletePosterSetsWatch(watch.id); } catch { /* ignore */ }
                }
                const title = String(refreshed.title || conflicts[0]?.title || 'this title').trim();
                const slotLabel = formatWatchArtSlots(watchArtSlots(refreshed));
                return res.status(409).json({
                    error: slotLabel === 'this title'
                        ? `Already watching a set for ${title}. Confirm to replace it.`
                        : `Already watching ${slotLabel} for ${title}. Confirm to replace that watch.`,
                    code: 'title_watch_exists',
                    existing: conflicts.map(summarizeWatch),
                    incoming: summarizeWatch(refreshed),
                });
            }
            let replaced = [];
            if (conflicts.length && replaceExisting) {
                replaced = await replaceSameTitleWatches(refreshed);
            }
            res.status(existed ? 200 : 201).json({
                ok: true,
                watch: refreshed,
                replaced: replaced.map(summarizeWatch),
            });
        } catch (error) {
            res.status(error.status || 500).json({ error: error.message || 'Failed to save watch' });
        }
    });

    router.patch('/watches/:id', async (req, res) => {
        try {
            const current = await getPosterSetsWatch(req.params.id);
            if (!current) return res.status(404).json({ error: 'Watch not found' });
            const body = req.body && typeof req.body === 'object' ? req.body : {};
            const patch = {};
            if (body.mediuxFilters !== undefined || body.mediux_filters !== undefined) {
                patch.mediuxFilters = body.mediuxFilters ?? body.mediux_filters;
            }
            if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
            if (body.title !== undefined) patch.title = body.title;
            if (body.user !== undefined) patch.user = body.user;
            if (body.thumbUrl !== undefined) patch.thumbUrl = body.thumbUrl;
            if (body.setKind !== undefined || body.set_kind !== undefined) {
                patch.setKind = body.setKind ?? body.set_kind;
            }
            if (body.lastError === null || body.lastError === '') {
                patch.lastError = null;
            }
            const watch = await patchPosterSetsWatch(current.id, patch);
            res.json({ ok: true, watch: summarizeWatch(watch) });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to update watch' });
        }
    });

    router.post('/watches/:id/toggle', async (req, res) => {
        try {
            const current = await getPosterSetsWatch(req.params.id);
            if (!current) return res.status(404).json({ error: 'Watch not found' });
            const enabled = req.body?.enabled !== undefined ? Boolean(req.body.enabled) : !current.enabled;
            const watch = await patchPosterSetsWatch(current.id, { enabled });
            res.json({ ok: true, watch });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to toggle watch' });
        }
    });

    router.post('/watches/:id/check', async (req, res) => {
        let current = null;
        try {
            current = await getPosterSetsWatch(req.params.id);
            if (!current) return res.status(404).json({ error: 'Watch not found' });
            const result = await checkPosterSetsWatch(current, { enqueue: req.body?.enqueue !== false });
            res.json({ ok: true, ...result });
        } catch (error) {
            const message = explainPosterSetsPageError(error?.message || String(error), current?.url);
            try {
                await patchPosterSetsWatch(req.params.id, {
                    lastCheckedAt: new Date().toISOString(),
                    lastError: message,
                });
            } catch { /* ignore */ }
            res.status(400).json({ error: message || 'Watch check failed' });
        }
    });

    router.post('/watches/:id/reapply', async (req, res) => {
        let current = null;
        try {
            current = await getPosterSetsWatch(req.params.id);
            if (!current) return res.status(404).json({ error: 'Watch not found' });
            const modeRaw = String(req.body?.mode || '').trim().toLowerCase();
            const mode = modeRaw === 'matched' ? 'matched' : (modeRaw === 'entire' ? 'entire' : '');
            if (!mode) {
                return res.status(400).json({ error: 'mode must be "entire" or "matched"' });
            }
            const result = await reapplyPosterSetsWatch(current, { mode });
            res.status(202).json({ ok: true, ...result });
        } catch (error) {
            const message = explainPosterSetsPageError(error?.message || String(error), current?.url);
            try {
                await patchPosterSetsWatch(req.params.id, {
                    lastCheckedAt: new Date().toISOString(),
                    lastError: message,
                });
            } catch { /* ignore */ }
            res.status(error.status || 400).json({ error: message || 'Reapply failed' });
        }
    });

    router.post('/watches/clear-errors', async (_req, res) => {
        try {
            const { cleared, watches } = await clearPosterSetsWatchErrors();
            res.json({
                ok: true,
                cleared,
                watches: watches.map(summarizeWatch),
                stats: watchStats(watches),
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to clear watch errors' });
        }
    });

    router.post('/watches/run', async (_req, res) => {
        // Checking dozens of watches can take many minutes (TPDB/MediUX scrape per pin).
        // Return immediately so reverse proxies don't 502 the long request.
        clearStalePosterSetsWatcherIfNeeded('stale-before-kick');
        if (watchPassKickInFlight && !isPosterSetsWatcherBusy()) {
            // Kick flag left behind without an active pass (crashed async).
            watchPassKickInFlight = false;
        }
        if (watchPassKickInFlight || isPosterSetsWatcherBusy()) {
            const status = getPosterSetsWatcherPassStatus();
            return res.status(409).json({
                ok: false,
                started: false,
                running: true,
                status,
                error: status.stale
                    ? 'A watcher pass looks stuck. Use Unlock check on Logs, then try again.'
                    : status.checked
                        ? `A check is already running (${status.checked}/${status.total || '?'}${status.currentTitle ? `: ${status.currentTitle}` : ''}). Open Logs → Audit log.`
                        : 'A watcher pass is already running. Open Logs → Audit log for progress.',
            });
        }
        watchPassKickInFlight = true;
        // If the background task never sets busy (crash before await), clear kick after 90s.
        const kickWatchdog = setTimeout(() => {
            if (watchPassKickInFlight && !isPosterSetsWatcherBusy()) {
                watchPassKickInFlight = false;
            }
        }, 90_000);
        if (typeof kickWatchdog.unref === 'function') kickWatchdog.unref();

        try {
            await finalizeRunningWatchCheckAudits('Superseded — a newer Check all started.');
        } catch { /* ignore */ }

        let checkAllAuditId = null;
        try {
            const started = await appendPosterSetsAudit({
                action: 'watch_check',
                source: 'watcher',
                title: 'Check all watches',
                state: 'running',
                detail: 'Check all started — scanning pinned sets in the background. Progress appears under Audit log (not Running jobs).',
                at: new Date().toISOString(),
            });
            checkAllAuditId = started?.id || null;
        } catch { /* ignore */ }

        res.json({
            ok: true,
            started: true,
            running: true,
            message: 'Watcher pass started in the background. Open Logs → Audit log for progress.',
        });

        void (async () => {
            const patchCheckAllAudit = async (fields) => {
                if (!checkAllAuditId) {
                    try {
                        const created = await appendPosterSetsAudit({
                            action: 'watch_check',
                            source: 'watcher',
                            title: 'Check all watches',
                            ...fields,
                            at: new Date().toISOString(),
                        });
                        checkAllAuditId = created?.id || null;
                    } catch { /* ignore */ }
                    return;
                }
                try {
                    await patchPosterSetsAudit(checkAllAuditId, {
                        ...fields,
                        at: new Date().toISOString(),
                    });
                } catch { /* ignore */ }
            };

            try {
                const result = await runPosterSetsWatcherPass({
                    forceAll: true,
                    notify: true,
                    onProgress: async (progress) => {
                        if (!progress?.checked) return;
                        await patchCheckAllAudit({
                            checked: progress.checked ?? null,
                            queued: progress.queued ?? null,
                            assetsQueued: progress.assetsQueued ?? null,
                            state: 'running',
                            detail: `Progress ${progress.checked}/${progress.total || '?'}`
                                + (progress.currentTitle ? ` — ${progress.currentTitle}` : '')
                                + `; queued ${progress.queued || 0} watch(es) / ${progress.assetsQueued || 0} asset(s).`,
                        });
                    },
                });
                const errorCount = Array.isArray(result.errors) ? result.errors.length : 0;
                await patchCheckAllAudit({
                    checked: result.checked ?? null,
                    queued: result.queued ?? null,
                    assetsQueued: result.assetsQueued ?? null,
                    state: result.skipped
                        ? 'idle'
                        : errorCount
                            ? 'partial'
                            : (result.queued ? 'queued' : 'idle'),
                    error: errorCount
                        ? `${errorCount} watch check error(s)`
                        : null,
                    detail: result.skipped
                        ? `Skipped: ${result.reason || 'disabled'} (another pass held the lock).`
                        : `Finished — checked ${result.checked || 0}; queued ${result.queued || 0} watch(es) / ${result.assetsQueued || 0} asset(s).`,
                });
            } catch (error) {
                await patchCheckAllAudit({
                    state: 'failed',
                    error: error?.message || 'Watcher pass failed',
                    detail: 'Check all failed in the background.',
                });
            } finally {
                clearTimeout(kickWatchdog);
                watchPassKickInFlight = false;
            }
        })();
    });

    router.get('/watches/run-status', async (_req, res) => {
        clearStalePosterSetsWatcherIfNeeded('stale-status-poll');
        res.json({
            ok: true,
            kickInFlight: watchPassKickInFlight,
            status: getPosterSetsWatcherPassStatus(),
        });
    });

    router.post('/watches/run-unlock', async (_req, res) => {
        watchPassKickInFlight = false;
        const result = resetPosterSetsWatcherBusy('manual-unlock');
        try {
            const finalized = await finalizeRunningWatchCheckAudits(
                result.wasBusy
                    ? 'Watcher lock cleared manually — you can run Check all again.'
                    : 'Unlock requested; no active watcher lock was held.',
            );
            if (!finalized) {
                await appendPosterSetsAudit({
                    action: 'watch_check',
                    source: 'watcher',
                    title: 'Check all watches',
                    state: 'idle',
                    detail: result.wasBusy
                        ? 'Watcher lock cleared manually — you can run Check all again.'
                        : 'Unlock requested; no active watcher lock was held.',
                    at: new Date().toISOString(),
                });
            }
        } catch { /* ignore */ }
        res.json({
            ok: true,
            ...result,
            kickInFlight: watchPassKickInFlight,
        });
    });

    router.post('/watches/hook', async (req, res) => {
        try {
            const result = await runPosterSetsArrHookNow(req.body || {});
            res.json(result);
        } catch (error) {
            res.status(400).json({ error: error.message || 'ARR watch hook failed' });
        }
    });

    const deleteWatch = async (req, res) => {
        try {
            const removed = await deletePosterSetsWatch(req.params.id);
            if (!removed) return res.status(404).json({ error: 'Watch not found' });
            res.json({ ok: true, watch: summarizeWatch(removed) });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to delete watch' });
        }
    };
    router.delete('/watches/:id', deleteWatch);
    // Older clients called the singular path; keep it so proxies don't 404/502 a stray /watch/:id.
    router.delete('/watch/:id', deleteWatch);

    router.get('/audit', async (req, res) => {
        try {
            const limit = Number(req.query?.limit) || 100;
            const entries = await listPosterSetsAudit(limit);
            res.json({
                ok: true,
                entries: entries.map((entry) => {
                    const explained = explainPosterSetsPageError(entry.error, entry.url);
                    return explained && explained !== entry.error
                        ? { ...entry, error: explained }
                        : entry;
                }),
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to load audit log' });
        }
    });

    router.post('/audit/clear-failed', async (_req, res) => {
        try {
            const { removed, entries } = await clearFailedPosterSetsAudit();
            res.json({ ok: true, removed, entries });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to clear failed audit entries' });
        }
    });

    router.get('/title-status', async (req, res) => {
        try {
            const title = String(req.query.title || '').trim();
            if (!title) return res.status(400).json({ error: 'title is required' });
            const status = await resolvePosterSetsTitleStatus({
                title,
                mediaType: String(req.query.mediaType || req.query.media_type || '').trim(),
                ratingKey: String(req.query.ratingKey || req.query.rating_key || '').trim(),
                tmdbId: String(req.query.tmdbId || req.query.tmdb_id || '').trim(),
            });
            res.json({ ok: true, ...status });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to load title status' });
        }
    });

    router.get('/watching-index', async (_req, res) => {
        try {
            const index = await buildPosterSetsWatchingIndex();
            res.json({ ok: true, ...index });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to load watching index' });
        }
    });

    router.post('/title-watch', async (req, res) => {
        try {
            const body = req.body && typeof req.body === 'object' ? req.body : {};
            const title = String(body.title || '').trim();
            if (!title) return res.status(400).json({ error: 'title is required' });
            const status = await resolvePosterSetsTitleStatus({
                title,
                mediaType: String(body.mediaType || body.media_type || '').trim(),
                ratingKey: String(body.ratingKey || body.rating_key || '').trim(),
                tmdbId: String(body.tmdbId || body.tmdb_id || '').trim(),
            });
            const result = await togglePosterSetsTitleWatch({
                ratingKey: String(body.ratingKey || body.rating_key || '').trim(),
                title,
                mediaType: String(body.mediaType || body.media_type || '').trim(),
                setUrl: String(body.setUrl || body.set_url || body.url || '').trim() || null,
                enabled: body.enabled !== undefined ? Boolean(body.enabled) : undefined,
                setMeta: body.setMeta && typeof body.setMeta === 'object' ? body.setMeta : null,
                lastApplyUrl: status.lastApply?.url || null,
            });
            if (result.enabled) {
                try {
                    await checkPosterSetsWatch(result.watch, { enqueue: false });
                } catch {
                    /* baseline optional */
                }
            }
            const refreshed = result.watch?.id
                ? await getPosterSetsWatch(result.watch.id)
                : result.watch;
            res.json({
                ok: true,
                enabled: result.enabled,
                watch: refreshed || result.watch || null,
                titleWatch: result.titleWatch,
            });
        } catch (error) {
            res.status(error.status || 500).json({ error: error.message || 'Failed to update title watch' });
        }
    });

    router.post('/reset-art', async (req, res) => {
        try {
            const ratingKey = String(req.body?.ratingKey || req.body?.rating_key || '').trim();
            const mediaType = String(req.body?.mediaType || req.body?.media_type || '').trim().toLowerCase();
            const scope = String(req.body?.scope || 'poster').trim().toLowerCase();
            if (!ratingKey) return res.status(400).json({ error: 'ratingKey is required' });
            if (!mediaType || !['movie', 'show'].includes(mediaType)) {
                return res.status(400).json({ error: 'mediaType must be movie or show' });
            }
            if (typeof resetLibraryArtwork !== 'function') {
                return res.status(503).json({ error: 'Artwork reset is not configured on this server.' });
            }
            const portalConfig = typeof loadPortalConfig === 'function'
                ? await loadPortalConfig().catch(() => ({}))
                : {};
            const serverType = String(portalConfig?.mediaServerType || 'plex').toLowerCase();
            if (serverType !== 'plex') {
                return res.status(501).json({ error: 'Artwork reset is supported for Plex libraries only.' });
            }
            const result = await resetLibraryArtwork(portalConfig, mediaLibraryDeps, {
                ratingKey,
                mediaType,
                scope,
            });
            res.json({ ok: true, ...result });
        } catch (error) {
            res.status(400).json({ error: error.message || 'Failed to reset artwork' });
        }
    });

    router.get('/jobs', async (_req, res) => {
        try {
            const all = await listJobsSorted();
            res.json({
                ok: true,
                jobs: all.map((job) => ({
                    ...summarizeJob(job),
                    logCount: Array.isArray(job.logs) ? job.logs.length : 0,
                })),
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to list jobs' });
        }
    });

    router.post('/jobs/clear-failed', async (_req, res) => {
        try {
            const history = await clearFailedPosterSetsHistory();
            const queue = await clearPosterSetsFailedQueue();
            const all = await listJobsSorted();
            res.json({
                ok: true,
                removed: (history.removed || 0) + (queue.removed || 0),
                jobs: all.map((job) => ({
                    ...summarizeJob(job),
                    logCount: Array.isArray(job.logs) ? job.logs.length : 0,
                })),
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to clear failed jobs' });
        }
    });

    router.get('/jobs/:id', async (req, res) => {
        const id = String(req.params.id || '');
        let job = await getJob(id);
        if (!job) {
            const history = await loadPosterSetsHistory();
            job = history.find((entry) => entry.id === id) || null;
        }
        if (!job) return res.status(404).json({ error: 'Job not found' });
        res.json({ job: withExplainedJobError(job) });
    });

    // loadPortalConfig reserved for future helpers
    void loadPortalConfig;

    return router;
};
