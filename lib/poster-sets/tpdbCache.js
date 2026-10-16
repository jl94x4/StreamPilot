/**
 * Durable ThePosterDB title/set/image cache — a permanent local poster database for
 * library titles (until Clear or image disk-budget eviction). Open-title serves disk
 * first; live TPDB is only for cache miss or an optional quiet refresh for new sets.
 */
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { POSTER_SETS_DIR, ensurePosterSetsDir, loadPosterSetsConfig, warmMediaAllows, isPosterSetsTpdbEnabled } from './config.js';
import { killActivePosterSetsWorker, runPosterSetsCli } from './runner.js';
import { normalizeCreatorHandle, excludeBlockedCreators, keepFollowedCreatorsOnly, prioritizeSetsByFollowedCreators } from './searchMerge.js';
import {
    coverageKeysForLibraryItem,
    coverageKeysFromTitleCacheEntry,
} from './tpdbCacheBrowse.js';
import { summarizeTpdbDiskAudit } from './tpdbCacheAudit.js';

export const TPDB_TITLE_CACHE_DIR = path.join(POSTER_SETS_DIR, 'tpdb-title-cache');
export const TPDB_SET_CACHE_DIR = path.join(POSTER_SETS_DIR, 'tpdb-set-cache');
export const TPDB_IMAGE_CACHE_DIR = path.join(POSTER_SETS_DIR, 'tpdb-image-cache');
const TPDB_WARM_PROGRESS_PATH = path.join(POSTER_SETS_DIR, 'tpdb-warm-progress.json');
const TPDB_DISK_STATS_PATH = path.join(POSTER_SETS_DIR, 'tpdb-disk-stats.json');

/**
 * Quiet background refresh for *new* sets — normally handled by the 3AM daily job.
 * Kept for explicit refresh paths; open-title does not age-out the local database.
 */
export const TPDB_REVALIDATE_MS = 24 * 60 * 60_000;
/** Reserved — cache entries are not expired by age. */
export const TPDB_SOFT_TTL_MS = Number.POSITIVE_INFINITY;
/** Default local hour for the first “new sets” refresh (overridden by config). */
export const TPDB_DAILY_REFRESH_HOUR = 3;
export const DEFAULT_TPDB_CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
/** One set HTML preview at a time — parallel HTML races TPDB's session/limiter. */
const HYDRATE_CONCURRENCY = 1;
/** CDN image downloads are safer to parallelize than HTML scrapes. */
const IMAGE_DOWNLOAD_CONCURRENCY = 6;
/**
 * ThePosterDB enforces spacing between HTML/API scrapes.
 * Image CDN fetches use a concurrency pool (no 7s HTML gate).
 */
export const TPDB_REQUEST_GAP_MS = 1_500;
/** @deprecated kept for status/docs; image pool no longer uses a fixed gap. */
export const TPDB_IMAGE_GAP_MS = 0;
/** Extra pause after finishing a hydrated set before the next set starts. */
const BETWEEN_SETS_GAP_MS = 1_500;
/** Titles per warm CLI process (one login, then serial resolves). */
const WARM_BATCH_SIZE = 50;
/** Max library titles accepted into a single Warm enqueue call. */
const WARM_QUEUE_MAX = 2000;
/** Uncached titles pulled per background catch-up pass. */
const WARM_CONTINUE_BATCH = 400;
/** Parallel Warm CLI workers when settings toggle is on. */
const WARM_PARALLEL_WORKERS = 5;
/** Hard-error retries before a title is left for a later explicit Build. */
const MAX_WARM_ATTEMPTS = 3;
/** Kill a silent Warm CLI before the 3.6h hard timeout. */
const WARM_STALL_MS = 10 * 60_000;
/** How often idle catch-up looks for more uncached library titles. */
const LIBRARY_CONTINUE_INTERVAL_MS = 12 * 60_000;
const MAX_IMAGE_ITEM_BYTES = 8 * 1024 * 1024;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const nowMs = () => Date.now();

let lastTpdbRequestAt = 0;
let tpdbGate = Promise.resolve();
let rateLimitCooldownUntil = 0;
let imageInFlight = 0;
/** @type {Array<() => void>} */
const imageWaiters = [];

const acquireTpdbImageSlot = () => new Promise((resolve) => {
    if (imageInFlight < IMAGE_DOWNLOAD_CONCURRENCY) {
        imageInFlight += 1;
        resolve();
        return;
    }
    imageWaiters.push(resolve);
});

const releaseTpdbImageSlot = () => {
    const next = imageWaiters.shift();
    if (next) {
        next();
        return;
    }
    imageInFlight = Math.max(0, imageInFlight - 1);
};

const ACTIVITY_LOG_MAX = 100;
/** @type {Array<{ at: number, level: string, kind: string, message: string, detail?: string | null }>} */
const activityLog = [];
/** Short “what’s happening now” line for Settings. */
let hydrateCurrent = null;

/** @type {{ total: number, completed: number, skippedCached: number, failed: number, startedAt: number | null, finishedAt: number | null, sampleMs: number[] }} */
let warmProgress = {
    total: 0,
    completed: 0,
    skippedCached: 0,
    failed: 0,
    startedAt: null,
    finishedAt: null,
    sampleMs: [],
};
/** @type {{ total: number, completed: number, startedAt: number | null, finishedAt: number | null, sampleMs: number[] }} */
let hydrateProgress = {
    total: 0,
    completed: 0,
    startedAt: null,
    finishedAt: null,
    sampleMs: [],
};
let cacheWorkPaused = false;
/** Stop drops the queue and cancels the in-flight CLI; Build/resume clears this. */
let cacheWorkStopped = false;
/** When true, this warm session forces followed-creator sets to the front of Prefetch (not exclusive). */
let hydrateFollowedOnlySession = false;
/** When true, this warm session only prefetches Creators you follow. */
let hydrateFollowedExclusiveSession = false;
/** When true, hydrate set pages/images even if Prefetch is off (library-add / first-run). */
let hydrateForceSession = false;
let exclusiveEmptyFollowWarned = false;
let warmChunkStartedAt = 0;
let hydrateItemStartedAt = 0;
/** Catch up uncached library titles without waiting for another Build click. */
let libraryContinueEnabled = false;
let libraryContinueBusy = false;
let libraryContinueTimer = null;
/** @type {(() => Promise<{ queued?: number } | null>) | null} */
let libraryContinueFn = null;
/** Titles with no TPDB page / exhausted retries — skip until an explicit Build. */
const exhaustedCoverageKeys = new Set();
let cachedCoverageMemo = { at: 0, keys: new Set() };

const resetWarmProgress = () => {
    warmProgress = {
        total: 0,
        completed: 0,
        skippedCached: 0,
        failed: 0,
        startedAt: null,
        finishedAt: null,
        sampleMs: [],
    };
};

const resetHydrateProgress = () => {
    hydrateProgress = {
        total: 0,
        completed: 0,
        startedAt: null,
        finishedAt: null,
        sampleMs: [],
    };
};

const pushSample = (samples, value, max = 40) => {
    if (!Number.isFinite(value) || value < 0) return;
    samples.push(value);
    while (samples.length > max) samples.shift();
};

const progressEtaMs = (progress) => {
    const remaining = Math.max(0, Number(progress.total || 0) - Number(progress.completed || 0));
    if (!remaining || !progress.sampleMs?.length) return null;
    const avg = progress.sampleMs.reduce((sum, ms) => sum + ms, 0) / progress.sampleMs.length;
    if (!Number.isFinite(avg) || avg <= 0) return null;
    return Math.round(avg * remaining);
};

const progressPercent = (progress) => {
    const total = Number(progress.total || 0);
    if (total <= 0) return null;
    return Math.min(100, Math.round((100 * Number(progress.completed || 0)) / total));
};

const summarizeProgress = (progress) => ({
    total: Number(progress.total || 0),
    completed: Number(progress.completed || 0),
    skippedCached: Number(progress.skippedCached || 0),
    failed: Number(progress.failed || 0),
    startedAt: progress.startedAt || null,
    finishedAt: progress.finishedAt || null,
    percent: progressPercent(progress),
    etaMs: progressEtaMs(progress),
    elapsedMs: progress.startedAt ? Math.max(0, nowMs() - progress.startedAt) : null,
});

const inferActivityKind = (message, level) => {
    const text = String(message || '').toLowerCase();
    if (level === 'error' || text.includes('error') || text.includes('failed')) return 'error';
    if (text.includes('followed') || text.includes('creators you follow')) return 'followed';
    if (
        text.includes('prefetch')
        || text.includes('hydrat')
        || text.includes('asset ')
        || text.includes('image cache')
        || text.includes('downloading image')
        || text.includes('cached image')
    ) return 'prefetch';
    return 'cache';
};

const shortUrl = (url, max = 72) => {
    const value = String(url || '').trim();
    if (!value) return '';
    if (value.length <= max) return value;
    return `${value.slice(0, max - 1)}…`;
};

/**
 * Ring-buffer activity for Settings UI (+ console). Safe to call from search routes.
 * @param {string} message
 * @param {{ level?: 'info'|'warn'|'error', kind?: string, detail?: string|null, current?: boolean|string }} [options]
 */
export const logTpdbCacheActivity = (message, options = {}) => {
    const level = options.level || 'info';
    const detail = options.detail != null ? String(options.detail) : null;
    const text = String(message || '').trim();
    if (!text) return;
    const kind = options.kind || inferActivityKind(text, level);
    const entry = { at: nowMs(), level, kind, message: text, detail };
    activityLog.push(entry);
    while (activityLog.length > ACTIVITY_LOG_MAX) activityLog.shift();
    if (options.current === true) hydrateCurrent = text;
    else if (typeof options.current === 'string') hydrateCurrent = options.current;
    else if (options.current === false) hydrateCurrent = null;
    const suffix = detail ? ` — ${detail}` : '';
    console.log(`[poster-sets/tpdb] ${text}${suffix}`);
};

/**
 * Global polite gate for ThePosterDB HTML hydrate scrapes.
 * Enforces spacing and any cooldown after HTTP 429.
 */
export const waitForTpdbRequestSlot = async () => {
    const run = tpdbGate.then(async () => {
        let announcedWait = false;
        for (;;) {
            const now = nowMs();
            if (rateLimitCooldownUntil > now) {
                const waitMs = rateLimitCooldownUntil - now;
                if (!announcedWait && waitMs > 400) {
                    announcedWait = true;
                    logTpdbCacheActivity(
                        `Waiting ${Math.ceil(waitMs / 1000)}s (TPDB 429 cooldown)…`,
                        { level: 'warn', current: true },
                    );
                }
                await sleep(waitMs);
                continue;
            }
            const sinceLast = now - lastTpdbRequestAt;
            if (lastTpdbRequestAt && sinceLast < TPDB_REQUEST_GAP_MS) {
                const waitMs = TPDB_REQUEST_GAP_MS - sinceLast;
                if (!announcedWait && waitMs > 400) {
                    announcedWait = true;
                    logTpdbCacheActivity(
                        `Waiting ${Math.ceil(waitMs / 1000)}s for ThePosterDB HTML spacing…`,
                        { current: true },
                    );
                }
                await sleep(waitMs);
                continue;
            }
            lastTpdbRequestAt = nowMs();
            return;
        }
    });
    tpdbGate = run.catch(() => {});
    await run;
};

/** @deprecated use waitForTpdbRequestSlot */
export const waitForTpdbAssetSlot = waitForTpdbRequestSlot;

/** Wait out a 429 cooldown before starting another CDN image download. */
export const waitForTpdbImageSlot = async () => {
    while (rateLimitCooldownUntil > nowMs()) {
        await sleep(rateLimitCooldownUntil - nowMs());
    }
};

const noteTpdbRateLimit = (retryAfterHeader = null) => {
    const retryAfterSec = Number(retryAfterHeader);
    // At least one full 7s gap; prefer Retry-After when TPDB sends it.
    const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? Math.min(180_000, Math.max(TPDB_REQUEST_GAP_MS, retryAfterSec * 1000))
        : Math.max(TPDB_REQUEST_GAP_MS * 2, 15_000);
    rateLimitCooldownUntil = Math.max(rateLimitCooldownUntil, nowMs() + waitMs);
    logTpdbCacheActivity(
        `ThePosterDB rate limited (429); cooling down ${Math.round(waitMs / 1000)}s`,
        { level: 'warn', current: true },
    );
};

const safeKeyPart = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .slice(0, 120);

export const tpdbImageCacheKey = (url) => crypto.createHash('sha1').update(String(url || '')).digest('hex');

export const buildTpdbTitleCacheKey = ({
    tmdbId = null,
    tvdbId = null,
    mediaType = 'movie',
    titleUrl = '',
    titleHint = '',
    yearHint = null,
} = {}) => {
    const tmdb = String(tmdbId || '').trim();
    const media = String(mediaType || 'movie').toLowerCase() === 'show' ? 'show' : 'movie';
    if (/^\d+$/.test(tmdb)) return `tmdb_${media}_${safeKeyPart(tmdb)}`;

    const tvdb = String(tvdbId || '').trim();
    if (/^\d+$/.test(tvdb)) return `tvdb_${media}_${safeKeyPart(tvdb)}`;

    const url = String(titleUrl || '').trim();
    const postersMatch = url.match(/theposterdb\.com\/posters\/(\d+)/i);
    if (postersMatch) return `url_posters_${postersMatch[1]}`;

    const hint = String(titleHint || '').trim();
    if (hint) {
        const year = yearHint != null && Number.isFinite(Number(yearHint)) ? String(Number(yearHint)) : 'x';
        return `hint_${media}_${safeKeyPart(hint)}_${year}`;
    }
    return null;
};

/** All warm-queue identities for an item (TMDB and/or TVDB). */
export const warmLibraryItemKeys = (item = {}) => {
    const keys = [];
    const tmdbId = String(item?.tmdbId || item?.libraryTmdbId || '').trim();
    if (/^\d+$/.test(tmdbId)) keys.push(`tmdb:${tmdbId}`);
    const tvdbId = String(item?.tvdbId || '').trim();
    if (/^\d+$/.test(tvdbId)) keys.push(`tvdb:${tvdbId}`);
    return keys;
};

/** Stable warm-queue identity: prefer TMDB, else TVDB (never Plex rating keys). */
export const warmLibraryItemKey = (item = {}) => warmLibraryItemKeys(item)[0] || '';

/** Library-scoped = TMDB/TVDB pin (library open) or warm job — never Browse/creator crawls. */
export const isLibraryScopedTpdbSearch = ({ tmdbId = null, tvdbId = null, libraryScoped = false } = {}) => (
    Boolean(libraryScoped)
    || Boolean(String(tmdbId || '').trim())
    || Boolean(String(tvdbId || '').trim())
);

const ensureDirs = async () => {
    await ensurePosterSetsDir();
    await Promise.all([
        fs.mkdir(TPDB_TITLE_CACHE_DIR, { recursive: true }),
        fs.mkdir(TPDB_SET_CACHE_DIR, { recursive: true }),
        fs.mkdir(TPDB_IMAGE_CACHE_DIR, { recursive: true }),
    ]);
};

const readJsonFile = async (filePath) => {
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
};

const writeJsonFile = async (filePath, data) => {
    await ensureDirs();
    await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};

const fileExists = async (filePath) => {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
};

const countJsonFiles = async (dir) => {
    try {
        const names = await fs.readdir(dir);
        return names.filter((name) => name.endsWith('.json')).length;
    } catch {
        return 0;
    }
};

const emptyDiskMemo = () => ({
    titles: 0,
    sets: 0,
    images: 0,
    imageBytes: 0,
    at: 0,
    scanned: false,
    scanning: false,
});
let diskMemo = emptyDiskMemo();
let persistDiskStatsTimer = null;

const persistDiskStatsSoon = () => {
    if (!diskMemo.scanned) return;
    if (persistDiskStatsTimer) return;
    persistDiskStatsTimer = setTimeout(() => {
        persistDiskStatsTimer = null;
        void writeJsonFile(TPDB_DISK_STATS_PATH, {
            titles: diskMemo.titles,
            sets: diskMemo.sets,
            images: diskMemo.images,
            imageBytes: diskMemo.imageBytes,
            updatedAt: new Date().toISOString(),
        }).catch(() => {});
    }, 1500);
};

const bumpDiskCount = (field, delta, byteDelta = 0) => {
    if (!delta && !byteDelta) return;
    if (field === 'titles') diskMemo.titles = Math.max(0, diskMemo.titles + delta);
    if (field === 'sets') diskMemo.sets = Math.max(0, diskMemo.sets + delta);
    if (field === 'images') diskMemo.images = Math.max(0, diskMemo.images + delta);
    if (byteDelta) diskMemo.imageBytes = Math.max(0, diskMemo.imageBytes + byteDelta);
    diskMemo.at = nowMs();
    persistDiskStatsSoon();
};

const loadPersistedDiskStats = async () => {
    if (diskMemo.scanned || diskMemo.scanning) return;
    const stored = await readJsonFile(TPDB_DISK_STATS_PATH);
    if (!stored || typeof stored !== 'object') return;
    const titles = Number(stored.titles);
    const sets = Number(stored.sets);
    const images = Number(stored.images);
    const imageBytes = Number(stored.imageBytes);
    if (![titles, sets, images, imageBytes].every((n) => Number.isFinite(n) && n >= 0)) return;
    diskMemo = {
        titles,
        sets,
        images,
        imageBytes,
        at: nowMs(),
        scanned: true,
        scanning: false,
    };
};

const scanImageCacheStats = async () => {
    let names = [];
    try {
        names = await fs.readdir(TPDB_IMAGE_CACHE_DIR);
    } catch {
        return { entries: 0, bytes: 0 };
    }
    const bins = names.filter((name) => name.endsWith('.bin'));
    let bytes = 0;
    const concurrency = 48;
    for (let i = 0; i < bins.length; i += concurrency) {
        const sizes = await Promise.all(bins.slice(i, i + concurrency).map(async (name) => {
            try {
                const st = await fs.stat(path.join(TPDB_IMAGE_CACHE_DIR, name));
                return Number(st.size) || 0;
            } catch {
                return 0;
            }
        }));
        bytes += sizes.reduce((sum, size) => sum + size, 0);
    }
    return { entries: bins.length, bytes };
};

const refreshDiskMemo = async ({ force = false } = {}) => {
    const now = nowMs();
    if (diskMemo.scanning) return diskMemo;
    if (!force && diskMemo.scanned && (now - diskMemo.at) < 45_000) return diskMemo;
    diskMemo.scanning = true;
    try {
        await ensureDirs();
        const [titles, sets, imageStats] = await Promise.all([
            countJsonFiles(TPDB_TITLE_CACHE_DIR),
            countJsonFiles(TPDB_SET_CACHE_DIR),
            scanImageCacheStats(),
        ]);
        diskMemo = {
            titles,
            sets,
            images: imageStats.entries,
            imageBytes: imageStats.bytes,
            at: nowMs(),
            scanned: true,
            scanning: false,
        };
        persistDiskStatsSoon();
    } catch {
        diskMemo.scanning = false;
    }
    return diskMemo;
};

const scheduleDiskMemoRefresh = ({ force = false } = {}) => {
    if (diskMemo.scanning) return;
    void refreshDiskMemo({ force });
};

const titleCachePath = (key) => path.join(TPDB_TITLE_CACHE_DIR, `${safeKeyPart(key)}.json`);
const setCachePath = (setId) => path.join(TPDB_SET_CACHE_DIR, `${safeKeyPart(setId)}.json`);

export const loadTpdbTitleCache = async (key) => {
    if (!key) return null;
    const entry = await readJsonFile(titleCachePath(key));
    if (!entry || !Array.isArray(entry.sets) || !entry.sets.length) return null;
    const config = await loadPosterSetsConfig();
    const sets = excludeBlockedCreators(entry.sets, config.creatorBlocklist);
    if (!sets.length) return null;
    if (sets.length !== entry.sets.length) entry.sets = sets;
    return entry;
};

export const saveTpdbTitleCache = async (key, payload = {}) => {
    if (!key) return null;
    const config = await loadPosterSetsConfig();
    const sets = excludeBlockedCreators(
        Array.isArray(payload.sets) ? payload.sets : [],
        config.creatorBlocklist,
    );
    if (!sets.length) return null;
    logTpdbCacheActivity(
        `Saved title cache “${payload.title || key}” (${sets.length} sets)`,
        { detail: key, current: `Cached title · ${payload.title || key}` },
    );
    cachedCoverageMemo = { at: 0, keys: new Set() };
    const filePath = titleCachePath(key);
    const isNew = !(await fileExists(filePath));
    const entry = {
        key,
        savedAt: payload.savedAt || new Date().toISOString(),
        lastRevalidatedAt: payload.lastRevalidatedAt || new Date().toISOString(),
        titleUrl: payload.titleUrl || null,
        title: payload.title || null,
        tmdbId: payload.tmdbId != null ? String(payload.tmdbId) : null,
        tvdbId: payload.tvdbId != null ? String(payload.tvdbId) : null,
        mediaType: payload.mediaType || null,
        sets,
        libraryScoped: true,
    };
    await writeJsonFile(filePath, entry);
    if (isNew) bumpDiskCount('titles', 1);

    // Alias under the other provider id so Plex TVDB-only browse matches TMDB-keyed files.
    const aliasKeys = titleCacheAliasKeys(entry).filter((alias) => alias && alias !== key);
    for (const alias of aliasKeys) {
        const aliasPath = titleCachePath(alias);
        if (await fileExists(aliasPath)) continue;
        await writeJsonFile(aliasPath, { ...entry, key: alias });
        bumpDiskCount('titles', 1);
    }
    return entry;
};

/** Extra title-cache filenames for the same entry (TMDB ↔ TVDB). */
export const titleCacheAliasKeys = (entry = {}) => {
    const media = String(entry?.mediaType || 'movie').toLowerCase() === 'show' ? 'show' : 'movie';
    const keys = [];
    const tmdb = String(entry?.tmdbId || '').trim();
    const tvdb = String(entry?.tvdbId || '').trim();
    if (/^\d+$/.test(tmdb)) keys.push(`tmdb_${media}_${safeKeyPart(tmdb)}`);
    if (/^\d+$/.test(tvdb)) keys.push(`tvdb_${media}_${safeKeyPart(tvdb)}`);
    return keys;
};

/** Load title cache trying TMDB then TVDB keys for a library row. */
export const loadTpdbTitleCacheForLibraryItem = async (item = {}) => {
    const mediaType = String(item?.mediaType || 'movie').toLowerCase() === 'show' ? 'show' : 'movie';
    const tmdbId = /^\d+$/.test(String(item?.tmdbId || '').trim()) ? String(item.tmdbId).trim() : null;
    const tvdbId = /^\d+$/.test(String(item?.tvdbId || '').trim()) ? String(item.tvdbId).trim() : null;
    const keys = [
        buildTpdbTitleCacheKey({
            tmdbId,
            tvdbId,
            mediaType,
            titleHint: item?.title,
            yearHint: item?.year,
            titleUrl: item?.titleUrl,
        }),
        ...(tmdbId ? [`tmdb_${mediaType}_${safeKeyPart(tmdbId)}`] : []),
        ...(tvdbId ? [`tvdb_${mediaType}_${safeKeyPart(tvdbId)}`] : []),
        // Older files were keyed by title hint before TMDB/TVDB ids existed.
        ...(item?.title ? [buildTpdbTitleCacheKey({
            mediaType,
            titleHint: item.title,
            yearHint: item.year,
        })] : []),
    ].filter(Boolean);
    const tried = new Set();
    for (const key of keys) {
        if (tried.has(key)) continue;
        tried.add(key);
        const entry = await loadTpdbTitleCache(key);
        if (entry?.sets?.length) return entry;
    }
    return null;
};

export const touchTpdbTitleRevalidated = async (key) => {
    const entry = await loadTpdbTitleCache(key);
    if (!entry) return null;
    entry.lastRevalidatedAt = new Date().toISOString();
    await writeJsonFile(titleCachePath(key), entry);
    return entry;
};

export const titleCacheNeedsRevalidate = (entry, intervalMs = TPDB_REVALIDATE_MS) => {
    // Age gate for optional quiet / daily refresh only — never means "cache is invalid".
    if (!entry) return true;
    const windowMs = Number(intervalMs);
    const threshold = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : TPDB_REVALIDATE_MS;
    const last = Date.parse(entry.lastRevalidatedAt || entry.savedAt || '') || 0;
    return !last || (nowMs() - last) >= threshold;
};

/** Interval used to skip fresh titles during a scheduled refresh pass. */
export const resolveDailyRefreshSkipMs = (intervalHours = 0) => {
    const hours = Math.max(0, Math.min(24, Math.round(Number(intervalHours) || 0)));
    if (hours > 0 && hours < 24) {
        // Slightly under the slot spacing so multi-hour schedules don't re-scrape the same titles.
        return Math.max(60_000, Math.floor(hours * 3600_000 * 0.85));
    }
    return TPDB_REVALIDATE_MS;
};

export const loadTpdbSetCache = async (setIdOrUrl) => {
    const setId = extractTpdbSetId(setIdOrUrl);
    if (!setId) return null;
    const entry = await readJsonFile(setCachePath(setId));
    if (!entry || !Array.isArray(entry.assets) || !entry.assets.length) return null;
    return entry;
};

export const saveTpdbSetCache = async (payload = {}) => {
    const setId = extractTpdbSetId(payload.setId || payload.url || payload.setMeta?.setId);
    if (!setId) return null;
    const assets = Array.isArray(payload.assets) ? payload.assets : [];
    if (!assets.length) return null;
    const entry = {
        setId: String(setId),
        url: payload.url || payload.setMeta?.url || null,
        savedAt: new Date().toISOString(),
        setMeta: payload.setMeta || null,
        assets,
        matched: payload.matched ?? null,
        unmatched: payload.unmatched ?? null,
        total: payload.total ?? assets.length,
        title: payload.title || payload.setMeta?.title || null,
    };
    const filePath = setCachePath(setId);
    const isNew = !(await fileExists(filePath));
    await writeJsonFile(filePath, entry);
    if (isNew) bumpDiskCount('sets', 1);
    return entry;
};

export const extractTpdbSetId = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (/^\d+$/.test(raw)) return raw;
    const setMatch = raw.match(/theposterdb\.com\/set\/(\d+)/i);
    if (setMatch) return setMatch[1];
    const posterMatch = raw.match(/theposterdb\.com\/poster\/(\d+)/i);
    if (posterMatch) return posterMatch[1];
    return safeKeyPart(raw).slice(0, 64) || null;
};

export const isTpdbUrl = (url) => /theposterdb\.com/i.test(String(url || ''));

export const loadTpdbCachedImage = async (url) => {
    const key = tpdbImageCacheKey(url);
    const binPath = path.join(TPDB_IMAGE_CACHE_DIR, `${key}.bin`);
    const metaPath = path.join(TPDB_IMAGE_CACHE_DIR, `${key}.json`);
    try {
        const [buf, metaRaw] = await Promise.all([
            fs.readFile(binPath),
            fs.readFile(metaPath, 'utf8'),
        ]);
        const meta = JSON.parse(metaRaw);
        if (!buf.length) return null;
        // Touch access time for LRU (best-effort).
        try {
            await fs.writeFile(metaPath, `${JSON.stringify({
                ...meta,
                at: meta.at || new Date().toISOString(),
                accessedAt: new Date().toISOString(),
                bytes: meta.bytes || buf.length,
            }, null, 2)}\n`, 'utf8');
        } catch { /* ignore */ }
        return {
            buf,
            contentType: String(meta?.contentType || 'image/jpeg'),
            path: binPath,
            key,
        };
    } catch {
        return null;
    }
};

export const storeTpdbCachedImage = async (url, buf, contentType) => {
    if (!buf?.length || buf.length > MAX_IMAGE_ITEM_BYTES) return null;
    await ensureDirs();
    const key = tpdbImageCacheKey(url);
    const binPath = path.join(TPDB_IMAGE_CACHE_DIR, `${key}.bin`);
    const metaPath = path.join(TPDB_IMAGE_CACHE_DIR, `${key}.json`);
    const prev = await readJsonFile(metaPath);
    const prevBytes = Number(prev?.bytes) || 0;
    const existed = prev != null;
    await Promise.all([
        fs.writeFile(binPath, buf),
        fs.writeFile(metaPath, `${JSON.stringify({
            contentType: contentType || 'image/jpeg',
            url: String(url || ''),
            at: new Date().toISOString(),
            accessedAt: new Date().toISOString(),
            bytes: buf.length,
        }, null, 2)}\n`, 'utf8'),
    ]);
    if (existed) bumpDiskCount('images', 0, buf.length - prevBytes);
    else bumpDiskCount('images', 1, buf.length);
    return { key, path: binPath };
};

export const resolveTpdbImageLocalPath = async (url) => {
    const cached = await loadTpdbCachedImage(url);
    return cached?.path || null;
};

const listImageMetaEntries = async () => {
    await ensureDirs();
    let names = [];
    try {
        names = await fs.readdir(TPDB_IMAGE_CACHE_DIR);
    } catch {
        return [];
    }
    const metas = [];
    const jsonNames = names.filter((name) => name.endsWith('.json'));
    const concurrency = 32;
    for (let i = 0; i < jsonNames.length; i += concurrency) {
        const chunk = await Promise.all(jsonNames.slice(i, i + concurrency).map(async (name) => {
            const key = name.slice(0, -5);
            const meta = await readJsonFile(path.join(TPDB_IMAGE_CACHE_DIR, name));
            if (!meta) return null;
            const at = Date.parse(meta.accessedAt || meta.at || '') || 0;
            const bytes = Number(meta.bytes) || 0;
            return { key, at, bytes };
        }));
        for (const item of chunk) {
            if (item) metas.push(item);
        }
    }
    return metas;
};

export const getTpdbImageCacheStats = async ({ force = false } = {}) => {
    await loadPersistedDiskStats();
    if (force) await refreshDiskMemo({ force: true });
    else scheduleDiskMemoRefresh();
    return {
        entries: diskMemo.images,
        bytes: diskMemo.imageBytes,
        scanning: diskMemo.scanning && !diskMemo.scanned,
    };
};

/**
 * Force-recount title/set/image dirs and report orphans / alias extras.
 * Updates the live CACHE ON DISK counters to match filesystem file counts.
 */
export const auditTpdbCacheDisk = async () => {
    await ensureDirs();
    const startedAt = nowMs();
    const memo = await refreshDiskMemo({ force: true });

    let titleNames = [];
    let setNames = [];
    let imageNames = [];
    try {
        titleNames = await fs.readdir(TPDB_TITLE_CACHE_DIR);
    } catch { /* empty */ }
    try {
        setNames = await fs.readdir(TPDB_SET_CACHE_DIR);
    } catch { /* empty */ }
    try {
        imageNames = await fs.readdir(TPDB_IMAGE_CACHE_DIR);
    } catch { /* empty */ }

    const titleJson = titleNames.filter((name) => name.endsWith('.json'));
    const setJson = setNames.filter((name) => name.endsWith('.json'));
    const imageBins = imageNames.filter((name) => name.endsWith('.bin'));
    const imageKeysOnDisk = imageBins.map((name) => name.slice(0, -4));

    /** @type {Array<object>} */
    const titleEntries = [];
    const referencedImageKeys = new Set();
    const concurrency = 24;

    for (let i = 0; i < titleJson.length; i += concurrency) {
        const chunk = titleJson.slice(i, i + concurrency);
        const rows = await Promise.all(chunk.map(async (name) => {
            const entry = await readJsonFile(path.join(TPDB_TITLE_CACHE_DIR, name));
            const sets = Array.isArray(entry?.sets) ? entry.sets : [];
            const valid = Boolean(entry && sets.length);
            const setIds = [];
            for (const set of sets) {
                const setId = extractTpdbSetId(set?.setId || set?.url);
                if (setId) setIds.push(setId);
                for (const url of [
                    set?.thumbUrl,
                    set?.url,
                    set?.posterUrl,
                    set?.imageUrl,
                ]) {
                    const raw = String(url || '').trim();
                    if (raw) referencedImageKeys.add(tpdbImageCacheKey(raw));
                }
            }
            return {
                fileName: name,
                key: entry?.key || name.slice(0, -5),
                tmdbId: entry?.tmdbId ?? null,
                tvdbId: entry?.tvdbId ?? null,
                mediaType: entry?.mediaType || null,
                setIds,
                valid,
            };
        }));
        titleEntries.push(...rows);
    }

    const setIdsOnDisk = setJson.map((name) => name.slice(0, -5));
    for (let i = 0; i < setJson.length; i += concurrency) {
        const chunk = setJson.slice(i, i + concurrency);
        await Promise.all(chunk.map(async (name) => {
            const entry = await readJsonFile(path.join(TPDB_SET_CACHE_DIR, name));
            const assets = Array.isArray(entry?.assets) ? entry.assets : [];
            for (const asset of assets) {
                for (const url of [
                    asset?.url,
                    asset?.thumbUrl,
                    asset?.src,
                    entry?.setMeta?.thumbUrl,
                ]) {
                    const raw = String(url || '').trim();
                    if (raw) referencedImageKeys.add(tpdbImageCacheKey(raw));
                }
            }
        }));
    }

    const summary = summarizeTpdbDiskAudit({
        titleEntries,
        setIdsOnDisk,
        imageKeysOnDisk,
        referencedImageKeys: [...referencedImageKeys],
    });

    let proxyImageCacheBytes = 0;
    let proxyImageCacheFiles = 0;
    const proxyDir = path.join(POSTER_SETS_DIR, 'image-cache');
    try {
        const proxyNames = await fs.readdir(proxyDir);
        proxyImageCacheFiles = proxyNames.length;
        const bins = proxyNames.filter((name) => !name.startsWith('.'));
        for (let i = 0; i < bins.length; i += 48) {
            const sizes = await Promise.all(bins.slice(i, i + 48).map(async (name) => {
                try {
                    const st = await fs.stat(path.join(proxyDir, name));
                    return Number(st.size) || 0;
                } catch {
                    return 0;
                }
            }));
            proxyImageCacheBytes += sizes.reduce((sum, size) => sum + size, 0);
        }
    } catch { /* optional */ }

    const audit = {
        scannedAt: new Date().toISOString(),
        elapsedMs: Math.max(0, nowMs() - startedAt),
        counts: {
            titles: memo.titles,
            sets: memo.sets,
            images: memo.images,
            imageBytes: memo.imageBytes,
        },
        folders: {
            titles: 'tpdb-title-cache/',
            sets: 'tpdb-set-cache/',
            images: 'tpdb-image-cache/',
            proxyThumbs: 'image-cache/',
        },
        ...summary,
        proxyThumbs: {
            files: proxyImageCacheFiles,
            bytes: proxyImageCacheBytes,
            note: 'UI thumb proxy — not included in Title/Set/Image stats',
        },
    };

    logTpdbCacheActivity(
        `Disk audit: ${summary.titles.files} title file(s) (${summary.titles.unique} unique)`
        + `, ${summary.sets.orphan} orphan set(s), ${summary.images.orphan} orphan image(s)`,
        { kind: 'cache', detail: `scan ${audit.elapsedMs}ms` },
    );

    return audit;
};

export const evictTpdbImageCacheIfNeeded = async (maxBytes = DEFAULT_TPDB_CACHE_MAX_BYTES) => {
    const limit = Number.isFinite(Number(maxBytes)) && Number(maxBytes) > 0
        ? Number(maxBytes)
        : DEFAULT_TPDB_CACHE_MAX_BYTES;
    let metas = await listImageMetaEntries();
    let total = metas.reduce((sum, item) => sum + (item.bytes || 0), 0);
    if (total <= limit) return { evicted: 0, bytes: total };

    metas.sort((a, b) => a.at - b.at);
    let evicted = 0;
    for (const item of metas) {
        if (total <= limit) break;
        try {
            await Promise.all([
                fs.unlink(path.join(TPDB_IMAGE_CACHE_DIR, `${item.key}.bin`)).catch(() => {}),
                fs.unlink(path.join(TPDB_IMAGE_CACHE_DIR, `${item.key}.json`)).catch(() => {}),
            ]);
            total -= item.bytes || 0;
            evicted += 1;
            bumpDiskCount('images', -1, -(item.bytes || 0));
        } catch {
            /* ignore */
        }
    }
    return { evicted, bytes: Math.max(0, total) };
};

const removeDirContents = async (dir) => {
    let names = [];
    try {
        names = await fs.readdir(dir);
    } catch (error) {
        if (error?.code === 'ENOENT') return 0;
        throw error;
    }
    let removed = 0;
    for (const name of names) {
        try {
            await fs.unlink(path.join(dir, name));
            removed += 1;
        } catch {
            /* ignore */
        }
    }
    return removed;
};

export const clearTpdbLocalCache = async () => {
    await ensureDirs();
    logTpdbCacheActivity('Clearing TPDB local cache (titles, sets, images)…', { current: true });
    warmTitleQueue.length = 0;
    warmTitleActive = 0;
    hydrateQueue.length = 0;
    hydrateQueued.clear();
    hydrateActive = 0;
    cacheWorkPaused = false;
    cacheWorkStopped = false;
    hydrateFollowedOnlySession = false;
    hydrateFollowedExclusiveSession = false;
    hydrateForceSession = false;
    libraryContinueEnabled = false;
    exhaustedCoverageKeys.clear();
    resetWarmProgress();
    resetHydrateProgress();
    const [titles, sets, images] = await Promise.all([
        removeDirContents(TPDB_TITLE_CACHE_DIR),
        removeDirContents(TPDB_SET_CACHE_DIR),
        removeDirContents(TPDB_IMAGE_CACHE_DIR),
    ]);
    try {
        await fs.unlink(TPDB_WARM_PROGRESS_PATH);
    } catch {
        /* ignore */
    }
    try {
        await fs.unlink(TPDB_DISK_STATS_PATH);
    } catch {
        /* ignore */
    }
    diskMemo = emptyDiskMemo();
    diskMemo.scanned = true;
    persistDiskStatsSoon();
    hydrateCurrent = null;
    logTpdbCacheActivity(
        `Cleared cache — ${titles} titles, ${sets} sets, ${images} images`,
        { current: false },
    );
    return { titles, sets, images };
};

export const pauseTpdbCacheWork = () => {
    cacheWorkPaused = true;
    logTpdbCacheActivity('Cache paused — finish current title/set, then wait', {
        kind: 'cache',
        current: 'Paused',
    });
    return { paused: true };
};

export const resumeTpdbCacheWork = () => {
    cacheWorkStopped = false;
    cacheWorkPaused = false;
    logTpdbCacheActivity('Cache resumed', { kind: 'cache', current: true });
    void pumpWarmTitleQueue();
    void pumpHydrateQueue();
    return { paused: false };
};

export const stopTpdbCacheWork = async () => {
    cacheWorkStopped = true;
    const droppedTitles = warmTitleQueue.length;
    const droppedSets = hydrateQueue.length;
    warmTitleQueue.length = 0;
    hydrateQueue.length = 0;
    hydrateQueued.clear();
    cacheWorkPaused = false;
    hydrateFollowedOnlySession = false;
    hydrateFollowedExclusiveSession = false;
    hydrateForceSession = false;
    libraryContinueEnabled = false;
    warmProgress.finishedAt = nowMs();
    hydrateProgress.finishedAt = nowMs();
    killActivePosterSetsWorker();
    await persistWarmQueueSnapshot({
        pending: [],
        pendingCount: 0,
        hydratePending: [],
        active: false,
        activeItem: null,
        autoContinue: false,
        stoppedAt: new Date().toISOString(),
    });
    hydrateCurrent = null;
    logTpdbCacheActivity(
        `Cache stopped — dropped ${droppedTitles} title(s) and ${droppedSets} set(s) from the queue`,
        { kind: 'cache', current: false },
    );
    return { stopped: true, droppedTitles, droppedSets };
};

/**
 * Fast per-title coverage for library badges.
 * levels: none | title | sets | images
 */
export const resolveTpdbTitleCoverage = async (items = []) => {
    const list = Array.isArray(items) ? items.slice(0, 240) : [];
    /** @type {Record<string, { level: string, setCount: number }>} */
    const coverage = {};

    const resolveOne = async (item) => {
        const mediaType = String(item?.mediaType || 'movie').toLowerCase() === 'show' ? 'show' : 'movie';
        const tmdbId = String(item?.tmdbId || '').trim();
        const tvdbId = String(item?.tvdbId || '').trim();
        const covKeys = coverageKeysForLibraryItem({ tmdbId, tvdbId, mediaType });
        if (!covKeys.length) return;
        const title = await loadTpdbTitleCacheForLibraryItem({
            tmdbId: /^\d+$/.test(tmdbId) ? tmdbId : null,
            tvdbId: /^\d+$/.test(tvdbId) ? tvdbId : null,
            mediaType,
            title: item?.title,
            year: item?.year,
        });
        if (!title?.sets?.length) {
            for (const covKey of covKeys) {
                coverage[covKey] = { level: 'none', setCount: 0 };
            }
            return;
        }
        let hasSet = false;
        let hasImage = false;
        for (const set of title.sets.slice(0, 4)) {
            const setId = extractTpdbSetId(set?.setId || set?.url);
            if (!setId) continue;
            try {
                await fs.access(setCachePath(setId));
                hasSet = true;
            } catch {
                continue;
            }
            const setEntry = await loadTpdbSetCache(setId);
            const assetUrl = String(
                setEntry?.assets?.[0]?.url
                || setEntry?.assets?.[0]?.thumbUrl
                || set?.thumbUrl
                || set?.url
                || '',
            ).trim();
            if (assetUrl) {
                const cachedImage = await loadTpdbCachedImage(assetUrl);
                if (cachedImage?.buf?.length) {
                    hasImage = true;
                    break;
                }
            }
        }
        const payload = {
            level: hasImage ? 'images' : hasSet ? 'sets' : 'title',
            setCount: title.sets.length,
        };
        for (const covKey of covKeys) {
            coverage[covKey] = payload;
        }
    };

    const concurrency = 16;
    for (let i = 0; i < list.length; i += concurrency) {
        await Promise.all(list.slice(i, i + concurrency).map((item) => resolveOne(item)));
    }
    return coverage;
};

export const listTpdbCachedCoverageKeys = async ({ force = false } = {}) => {
    const now = nowMs();
    if (!force && cachedCoverageMemo.keys && (now - cachedCoverageMemo.at) < 15_000) {
        return cachedCoverageMemo.keys;
    }
    await ensureDirs();
    let names = [];
    try {
        names = await fs.readdir(TPDB_TITLE_CACHE_DIR);
    } catch {
        cachedCoverageMemo = { at: now, keys: new Set() };
        return cachedCoverageMemo.keys;
    }
    const keys = new Set();
    await Promise.all(names.map(async (name) => {
        if (!name.endsWith('.json')) return;
        const entry = await readJsonFile(path.join(TPDB_TITLE_CACHE_DIR, name));
        if (!entry || !Array.isArray(entry.sets) || !entry.sets.length) return;
        for (const key of coverageKeysFromTitleCacheEntry(entry, name)) {
            keys.add(key);
        }
        // Heal older TMDB-only files so TVDB-only Plex browse can match without a rebuild.
        for (const alias of titleCacheAliasKeys(entry)) {
            const aliasPath = titleCachePath(alias);
            if (await fileExists(aliasPath)) continue;
            try {
                await writeJsonFile(aliasPath, { ...entry, key: alias });
                bumpDiskCount('titles', 1);
                for (const key of coverageKeysFromTitleCacheEntry({ ...entry, key: alias }, `${alias}.json`)) {
                    keys.add(key);
                }
            } catch {
                // best-effort alias
            }
        }
    }));
    cachedCoverageMemo = { at: now, keys };
    return keys;
};

const rememberExhaustedCoverageKey = (item) => {
    for (const key of coverageKeysForLibraryItem(item)) {
        exhaustedCoverageKeys.add(key);
    }
};

const forgetExhaustedCoverageKey = (item) => {
    for (const key of coverageKeysForLibraryItem(item)) {
        exhaustedCoverageKeys.delete(key);
    }
};

export const getTpdbCacheStatus = async () => {
    await ensureDirs();
    await loadPersistedDiskStats();
    scheduleDiskMemoRefresh();
    const config = await loadPosterSetsConfig();
    const relativeRoot = path.relative(process.cwd(), POSTER_SETS_DIR) || 'config/poster-sets';
    const warmBusy = warmTitleActive > 0 || warmTitleQueue.length > 0;
    const hydrateBusy = hydrateActive > 0 || hydrateQueue.length > 0;
    return {
        cacheEnabled: config.tpdbLocalCacheEnabled === true,
        prefetchEnabled: config.tpdbAggressivePrefetch === true,
        prioritizeFollowedCreators: config.tpdbPrioritizeFollowedCreators !== false,
        paused: cacheWorkPaused,
        followedPrefetchOnly: hydrateFollowedOnlySession,
        titles: diskMemo.titles,
        sets: diskMemo.sets,
        images: diskMemo.images,
        imageBytes: diskMemo.imageBytes,
        diskScanning: diskMemo.scanning && !diskMemo.scanned,
        rootDir: POSTER_SETS_DIR,
        relativeRoot: relativeRoot.replace(/\\/g, '/'),
        folders: {
            titles: 'tpdb-title-cache/',
            sets: 'tpdb-set-cache/',
            images: 'tpdb-image-cache/',
        },
        current: hydrateCurrent,
        activity: activityLog.slice(-60).reverse(),
        progress: {
            warm: summarizeProgress(warmProgress),
            hydrate: summarizeProgress(hydrateProgress),
            busy: warmBusy || hydrateBusy || cacheWorkPaused,
        },
        hydrate: {
            queue: hydrateQueue.length,
            active: hydrateActive,
            lastError: hydrateLastError,
            rateLimit: {
                gapMs: TPDB_REQUEST_GAP_MS,
                msSinceLastRequest: lastTpdbRequestAt ? Math.max(0, nowMs() - lastTpdbRequestAt) : null,
                cooldownMs: Math.max(0, rateLimitCooldownUntil - nowMs()),
            },
            warmQueue: warmTitleQueue.length,
            warmActive: warmTitleActive,
        },
        libraryContinue: {
            enabled: libraryContinueEnabled,
            busy: libraryContinueBusy,
            exhausted: exhaustedCoverageKeys.size,
        },
        dailyRefresh: getTpdbDailyRefreshStatus(),
    };
};

/** @type {Array<{ setUrl: string, setId?: string, titleKey?: string }>} */
const hydrateQueue = [];
const hydrateQueued = new Set();
let hydrateActive = 0;
let hydrateLastError = null;

/** Serial library warm (title resolves) — one at a time with spacing. */
/** @type {Array<object>} */
const warmTitleQueue = [];
let warmTitleActive = 0;
const BETWEEN_WARM_TITLES_MS = 2_000;
/** @type {null | ((item: object) => Promise<object>)} */
let warmFetchTitleSetsFn = null;
/** @type {null | ((items: object[], options?: object) => Promise<object[]>)} */
let warmBatchRunnerFn = null;
/**
 * Dedicated new-sets refresh worker (isolated TPDB session).
 * Only rechecks titles already on disk — independent of library warm/build.
 */
/** @type {null | ((item: object) => Promise<object>)} */
let refreshFetchTitleSetsFn = null;
const BETWEEN_REFRESH_TITLES_MS = 2_500;

export const setTpdbWarmFetchTitleSets = (fn) => {
    warmFetchTitleSetsFn = typeof fn === 'function' ? fn : null;
};

/** Prefer batch warm (one Python process / one login) over per-title CLI spawns. */
export const setTpdbWarmBatchRunner = (fn) => {
    warmBatchRunnerFn = typeof fn === 'function' ? fn : null;
};

export const setTpdbRefreshFetchTitleSets = (fn) => {
    refreshFetchTitleSetsFn = typeof fn === 'function' ? fn : null;
};

export const setTpdbLibraryContinueFn = (fn) => {
    libraryContinueFn = typeof fn === 'function' ? fn : null;
};

export const setTpdbLibraryAutoContinue = (enabled) => {
    libraryContinueEnabled = enabled === true;
};

/**
 * Resolve one library title through the same cache warm pipeline (priority).
 * Used when opening an uncached title — write disk first, then serve like a cache hit.
 * Prefers the dedicated refresh worker session so it can run while a library build is active.
 */
export const priorityEnsureTpdbTitleCached = async (item = {}, options = {}) => {
    const config = await loadPosterSetsConfig();
    if (!isPosterSetsTpdbEnabled(config) || config.tpdbLocalCacheEnabled !== true) return null;

    const tmdbId = String(item?.tmdbId || '').trim();
    const tvdbId = String(item?.tvdbId || '').trim();
    const hasTmdb = /^\d+$/.test(tmdbId);
    const hasTvdb = /^\d+$/.test(tvdbId);
    if (!hasTmdb && !hasTvdb) return null;
    const mediaType = String(item?.mediaType || 'movie').toLowerCase() === 'show' ? 'show' : 'movie';
    const titleKey = buildTpdbTitleCacheKey({
        tmdbId: hasTmdb ? tmdbId : null,
        tvdbId: hasTvdb ? tvdbId : null,
        mediaType,
        titleHint: item?.title,
        yearHint: item?.year,
        titleUrl: item?.titleUrl,
    });
    if (!titleKey) return null;

    if (options.force !== true) {
        const existing = await loadTpdbTitleCacheForLibraryItem({
            tmdbId: hasTmdb ? tmdbId : null,
            tvdbId: hasTvdb ? tvdbId : null,
            mediaType,
            title: item?.title,
            year: item?.year,
            titleUrl: item?.titleUrl,
        });
        if (existing?.sets?.length) return existing;
    }

    const fetchFn = (typeof refreshFetchTitleSetsFn === 'function'
        ? refreshFetchTitleSetsFn
        : warmFetchTitleSetsFn);
    if (typeof fetchFn !== 'function') return null;

    const titleLabel = item?.title
        ? `${item.title}${item?.year ? ` (${item.year})` : ''}`
        : (hasTmdb ? `tmdb ${tmdbId}` : `tvdb ${tvdbId}`);
    const queueItem = {
        ...(hasTmdb ? { tmdbId } : {}),
        ...(hasTvdb ? { tvdbId } : {}),
        title: item?.title || '',
        year: item?.year ?? null,
        mediaType,
        titleUrl: item?.titleUrl || null,
    };

    const matchesQueueItem = (entry) => {
        const row = entry?.item || {};
        const rowMedia = String(row?.mediaType || 'movie').toLowerCase() === 'show' ? 'show' : 'movie';
        if (rowMedia !== mediaType) return false;
        if (hasTmdb) return String(row?.tmdbId || '').trim() === tmdbId;
        return String(row?.tvdbId || '').trim() === tvdbId;
    };

    // If already queued behind other warm titles, pull it to the front for after we finish.
    const existingIdx = warmTitleQueue.findIndex(matchesQueueItem);
    if (existingIdx > 0) {
        const [entry] = warmTitleQueue.splice(existingIdx, 1);
        warmTitleQueue.unshift(entry);
        void persistWarmQueueSnapshot({ lastPriorityAt: new Date().toISOString() });
    }

    logTpdbCacheActivity(`Priority cache: resolving ${titleLabel}`, {
        kind: 'cache',
        detail: titleKey,
        current: `Priority cache · ${titleLabel}`,
    });

    const dropFromWarmQueue = () => {
        for (let i = warmTitleQueue.length - 1; i >= 0; i -= 1) {
            if (!matchesQueueItem(warmTitleQueue[i])) continue;
            warmTitleQueue.splice(i, 1);
            if (warmProgress.total > warmProgress.completed) warmProgress.completed += 1;
        }
        void persistWarmQueueSnapshot({});
    };

    try {
        await waitForTpdbRequestSlot();
        const result = await fetchFn(queueItem);
        await applyTpdbWarmTitleResult(queueItem, result);
        dropFromWarmQueue();
        const cached = await loadTpdbTitleCache(titleKey);
        if (cached?.sets?.length) {
            logTpdbCacheActivity(
                `Priority cache: ${titleLabel} ready (${cached.sets.length} sets)`,
                { kind: 'cache', detail: titleKey },
            );
            return cached;
        }
        // Soft miss — leave/place at front of warm queue for a later retry with the build worker.
        if (existingIdx < 0 && typeof warmFetchTitleSetsFn === 'function') {
            warmTitleQueue.unshift({ item: queueItem, fetchTitleSets: warmFetchTitleSetsFn });
            warmProgress.total += 1;
            if (!warmProgress.startedAt) warmProgress.startedAt = nowMs();
            warmProgress.finishedAt = null;
            void persistWarmQueueSnapshot({ lastPriorityAt: new Date().toISOString() });
            void pumpWarmTitleQueue();
        }
        return null;
    } catch (error) {
        logTpdbCacheActivity(
            `Priority cache failed for ${titleLabel}: ${error?.message || error}`,
            { level: 'warn', kind: 'error', detail: titleKey },
        );
        if (existingIdx < 0 && typeof warmFetchTitleSetsFn === 'function') {
            warmTitleQueue.unshift({ item: queueItem, fetchTitleSets: warmFetchTitleSetsFn });
            warmProgress.total += 1;
            if (!warmProgress.startedAt) warmProgress.startedAt = nowMs();
            warmProgress.finishedAt = null;
            void persistWarmQueueSnapshot({ lastPriorityAt: new Date().toISOString() });
            void pumpWarmTitleQueue();
        }
        return null;
    }
};

const loadWarmProgress = async () => {
    const data = await readJsonFile(TPDB_WARM_PROGRESS_PATH);
    if (!data || typeof data !== 'object') return null;
    return data;
};

const saveWarmProgress = async (patch = {}) => {
    await ensureDirs();
    const prev = (await loadWarmProgress()) || {};
    const next = {
        ...prev,
        ...patch,
        updatedAt: new Date().toISOString(),
    };
    await writeJsonFile(TPDB_WARM_PROGRESS_PATH, next);
    return next;
};

const snapshotHydratePending = () => hydrateQueue.map((item) => ({
    setUrl: item.setUrl,
    setId: item.setId || null,
    titleKey: item.titleKey || null,
    user: item.user || null,
    preferred: item.preferred === true,
    thumbUrl: item.thumbUrl || '',
    posterCount: item.posterCount ?? null,
    assetCount: item.assetCount ?? null,
    bypassFollowedOnly: item.bypassFollowedOnly === true,
}));

const persistWarmQueueSnapshot = async (extra = {}) => {
    let pending = warmTitleQueue.map((entry) => entry.item).filter(Boolean);
    // Keep the in-flight title in the snapshot so a restart retries it instead of skipping it.
    const activeItem = Object.prototype.hasOwnProperty.call(extra, 'activeItem')
        ? (extra.activeItem || null)
        : null;
    if (activeItem) {
        pending = [activeItem, ...pending];
    }
    const {
        activeItem: _activeItem,
        pending: _pending,
        hydratePending: extraHydrate,
        autoContinue: extraContinue,
        exhaustedKeys: extraExhausted,
        ...rest
    } = extra;
    await saveWarmProgress({
        pending,
        pendingCount: pending.length,
        hydratePending: extraHydrate !== undefined ? extraHydrate : snapshotHydratePending(),
        autoContinue: extraContinue !== undefined ? extraContinue : libraryContinueEnabled,
        exhaustedKeys: extraExhausted !== undefined ? extraExhausted : [...exhaustedCoverageKeys],
        active: Boolean(warmTitleActive || rest.active),
        activeItem,
        ...rest,
    });
};

let persistHydrateTimer = null;
const persistHydrateSoon = () => {
    if (persistHydrateTimer) return;
    persistHydrateTimer = setTimeout(() => {
        persistHydrateTimer = null;
        void persistWarmQueueSnapshot({});
    }, 1_000);
    persistHydrateTimer.unref?.();
};

/** @type {(url: string, buf: Buffer, contentType: string) => Promise<unknown>} */
let storeImageFn = storeTpdbCachedImage;

export const setTpdbCacheImageStore = (fn) => {
    if (typeof fn === 'function') storeImageFn = fn;
};

const downloadImageToCache = async (url) => {
    const target = String(url || '').trim();
    if (!target || !isTpdbUrl(target)) return false;
    const existing = await loadTpdbCachedImage(target);
    if (existing) return 'cached';

    logTpdbCacheActivity(`Downloading image ${shortUrl(target)}`, {
        current: `Downloading image · ${shortUrl(target, 48)}`,
    });
    const referer = 'https://theposterdb.com/';
    let response = null;
    await acquireTpdbImageSlot();
    try {
        for (let attempt = 0; attempt < 4; attempt += 1) {
            await waitForTpdbImageSlot();
            try {
                response = await fetch(target, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                        Accept: 'image/jpeg,image/png,image/webp;q=0.9,image/*;q=0.8,*/*;q=0.7',
                        Referer: referer,
                    },
                    redirect: 'follow',
                    signal: AbortSignal.timeout(30_000),
                });
                if (response.ok) break;
                if (response.status === 429) {
                    noteTpdbRateLimit(response.headers.get('retry-after'));
                    hydrateLastError = `ThePosterDB rate limited (429); cooling down ${Math.round(Math.max(0, rateLimitCooldownUntil - nowMs()) / 1000)}s`;
                    continue;
                }
                if (response.status >= 500) {
                    await sleep(800 + attempt * 600);
                    continue;
                }
                break;
            } catch {
                response = null;
                await sleep(800 + attempt * 600);
            }
        }
        if (!response?.ok) {
            logTpdbCacheActivity(`Image download failed ${shortUrl(target)}`, {
                level: 'warn',
                detail: response ? `HTTP ${response.status}` : 'network error',
            });
            return false;
        }
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        if (!String(contentType).toLowerCase().startsWith('image/')) return false;
        const buf = Buffer.from(await response.arrayBuffer());
        if (!buf.length || buf.length > MAX_IMAGE_ITEM_BYTES) return false;
        await storeImageFn(target, buf, contentType);
        logTpdbCacheActivity(`Cached image (${Math.round(buf.length / 1024)} KB)`, {
            detail: shortUrl(target),
        });
        return true;
    } finally {
        releaseTpdbImageSlot();
    }
};

/**
 * Ensure TPDB asset URLs are on disk before apply.
 * Title/set metadata cache can be hot while image bins are still cold — apply needs bytes.
 */
export const ensureTpdbImagesCached = async (urls = [], { onProgress = null } = {}) => {
    const unique = [];
    const seen = new Set();
    for (const raw of urls || []) {
        const url = String(raw || '').trim();
        if (!url || !isTpdbUrl(url) || seen.has(url)) continue;
        seen.add(url);
        unique.push(url);
    }
    if (!unique.length) {
        return { total: 0, cached: 0, downloaded: 0, failed: 0, failedUrls: [] };
    }

    let cached = 0;
    let downloaded = 0;
    const failedUrls = [];
    const report = (message) => {
        if (typeof onProgress === 'function') onProgress(message);
    };

    report(`Ensuring ${unique.length} ThePosterDB image(s) are cached for apply…`);
    for (let i = 0; i < unique.length; i += IMAGE_DOWNLOAD_CONCURRENCY) {
        const chunk = unique.slice(i, i + IMAGE_DOWNLOAD_CONCURRENCY);
        const results = await Promise.all(chunk.map(async (url) => {
            const result = await downloadImageToCache(url);
            return { url, result };
        }));
        for (const item of results) {
            if (item.result === 'cached') cached += 1;
            else if (item.result === true) downloaded += 1;
            else failedUrls.push(item.url);
        }
        if (unique.length > 1) {
            report(
                `Image cache ${Math.min(i + chunk.length, unique.length)}/${unique.length}`
                + ` (cached ${cached}, downloaded ${downloaded}`
                + `${failedUrls.length ? `, failed ${failedUrls.length}` : ''})`,
            );
        }
    }

    if (failedUrls.length) {
        report(`Warning: ${failedUrls.length}/${unique.length} ThePosterDB image(s) could not be cached before apply.`);
    } else if (downloaded) {
        report(`Cached ${downloaded} fresh ThePosterDB image(s) for apply (${cached} already local).`);
    } else {
        report(`All ${cached} ThePosterDB image(s) already local — applying from cache.`);
    }

    return {
        total: unique.length,
        cached,
        downloaded,
        failed: failedUrls.length,
        failedUrls,
    };
};

const hydrateOneSet = async (item) => {
    const setUrl = String(item?.setUrl || '').trim();
    if (!setUrl || !isTpdbUrl(setUrl)) return;

    const config = await loadPosterSetsConfig();
    if (config.tpdbLocalCacheEnabled !== true) return;
    const blocked = Array.isArray(config.creatorBlocklist) ? config.creatorBlocklist : [];
    const bypassFollowedOnly = item?.bypassFollowedOnly === true || item?.explicit === true;
    if (!bypassFollowedOnly && item?.user && blocked.some((name) => normalizeCreatorHandle(name) === normalizeCreatorHandle(item.user))) {
        return;
    }
    const exclusive = !bypassFollowedOnly && (
        hydrateFollowedExclusiveSession || config.tpdbCacheFollowedCreatorsOnly === true
    );
    if (exclusive) {
        const followed = new Set(
            (Array.isArray(config.creatorWhitelist) ? config.creatorWhitelist : [])
                .map((name) => normalizeCreatorHandle(name))
                .filter(Boolean),
        );
        if (!followed.size || !followed.has(normalizeCreatorHandle(item?.user))) return;
    }

    const label = item.setId ? `set ${item.setId}` : shortUrl(setUrl, 56);
    const creatorLabel = item.user ? `@${String(item.user).replace(/^@+/, '')}` : null;
    logTpdbCacheActivity(`Hydrating ${label}${creatorLabel ? ` · ${creatorLabel}` : ''}${item.preferred ? ' (followed)' : ''}`, {
        detail: setUrl,
        current: `Hydrating · ${label}${creatorLabel ? ` · ${creatorLabel}` : ''}`,
    });

    const maxBytes = Number(config.tpdbCacheMaxBytes) || DEFAULT_TPDB_CACHE_MAX_BYTES;
    const stats = await getTpdbImageCacheStats();
    if (stats.bytes >= maxBytes) {
        await evictTpdbImageCacheIfNeeded(maxBytes);
        const again = await getTpdbImageCacheStats();
        if (again.bytes >= maxBytes) {
            logTpdbCacheActivity('Disk budget full — skipping further image hydrate', {
                level: 'warn',
                current: false,
            });
            return;
        }
    }

    // Honor any outstanding 429 cooldown before scraping HTML/API again.
    if (rateLimitCooldownUntil > nowMs()) {
        const waitMs = rateLimitCooldownUntil - nowMs();
        logTpdbCacheActivity(`Waiting ${Math.ceil(waitMs / 1000)}s (429 cooldown) before set scrape…`, {
            level: 'warn',
            current: true,
        });
        await sleep(waitMs);
    }

    const existing = await loadTpdbSetCache(item.setId || setUrl);
    let assets = existing?.assets || [];
    let setMeta = existing?.setMeta || null;
    const expectedTotal = Number(
        existing?.total
        ?? existing?.setMeta?.assetCount
        ?? existing?.setMeta?.total
        ?? item.posterCount
        ?? item.assetCount
        ?? 0,
    );
    const assetsWithFullUrl = assets.filter((asset) => String(asset?.url || '').trim()).length;
    // Partial set pages (e.g. 1 of N) used to stick forever — Prefetch never re-scraped.
    const incompleteCached = assets.length > 0 && (
        (Number.isFinite(expectedTotal) && expectedTotal > assets.length)
        || (assets.length <= 2 && assetsWithFullUrl === 0)
    );
    const needsScrape = !assets.length || incompleteCached || item.forceRefresh === true;

    if (needsScrape) {
        logTpdbCacheActivity(
            incompleteCached
                ? `Re-scraping incomplete set ${label} (${assets.length}/${expectedTotal} assets cached)`
                : `Scraping set HTML/preview ${label}`,
            {
                detail: setUrl,
                current: `Scraping set · ${label}`,
            },
        );
        await waitForTpdbRequestSlot();
        const run = await runPosterSetsCli('preview', {
            config,
            url: setUrl,
        }, { timeoutMs: 180_000 });
        if (run.ok && Array.isArray(run.result?.assets) && run.result.assets.length) {
            // Prefer the larger asset list so a flaky scrape cannot shrink a good cache.
            if (!assets.length || run.result.assets.length >= assets.length) {
                assets = run.result.assets;
                setMeta = run.result.setMeta || setMeta;
                await saveTpdbSetCache({
                    url: setUrl,
                    setId: setMeta?.setId || item.setId,
                    setMeta,
                    assets,
                    matched: run.result.matched,
                    unmatched: run.result.unmatched,
                    total: run.result.total ?? run.result.assets.length,
                    title: run.result.title || setMeta?.title,
                });
            }
            logTpdbCacheActivity(
                `Set scrape OK — ${run.result.assets.length} asset(s)${run.result.title ? ` · ${run.result.title}` : ''}`,
                { detail: shortUrl(setUrl) },
            );
        } else {
            logTpdbCacheActivity(`Set scrape failed or empty for ${label}`, {
                level: 'warn',
                detail: run.error || shortUrl(setUrl),
            });
        }
        // Preview scrape counts as a TPDB request — wait a full gap before assets.
        await waitForTpdbRequestSlot();
    } else {
        logTpdbCacheActivity(`Using cached set metadata (${assets.length} assets) for ${label}`);
    }

    let downloaded = 0;
    let alreadyCached = 0;
    let failed = 0;
    const imageUrls = [];
    for (const asset of assets) {
        const imageUrl = String(asset?.url || asset?.thumbUrl || '').trim();
        if (imageUrl) imageUrls.push(imageUrl);
    }
    if (item.thumbUrl) {
        const thumb = String(item.thumbUrl).trim();
        if (thumb) imageUrls.push(thumb);
    }

    let cursor = 0;
    const workers = Array.from(
        { length: Math.min(IMAGE_DOWNLOAD_CONCURRENCY, Math.max(1, imageUrls.length)) },
        async () => {
            for (;;) {
                const index = cursor;
                cursor += 1;
                if (index >= imageUrls.length) return;
                const imageUrl = imageUrls[index];
                logTpdbCacheActivity(
                    `Asset ${index + 1}/${imageUrls.length} for ${label}`,
                    { current: `Asset ${index + 1}/${imageUrls.length} · ${label}` },
                );
                const result = await downloadImageToCache(imageUrl);
                if (result === true) downloaded += 1;
                else if (result === 'cached') alreadyCached += 1;
                else failed += 1;
                const after = await getTpdbImageCacheStats();
                if (after.bytes >= maxBytes) {
                    await evictTpdbImageCacheIfNeeded(maxBytes);
                    cursor = imageUrls.length;
                }
            }
        },
    );
    await Promise.all(workers);

    if (downloaded === 0 && alreadyCached > 0 && failed === 0) {
        logTpdbCacheActivity(
            `Finished ${label} — all ${alreadyCached} image(s) already on disk (nothing new)`,
            { current: hydrateQueue.length ? `Queued sets remaining: ${hydrateQueue.length}` : false },
        );
    } else {
        logTpdbCacheActivity(
            `Finished ${label} — downloaded ${downloaded}, already cached ${alreadyCached}${failed ? `, failed ${failed}` : ''}`,
            { current: hydrateQueue.length ? `Queued sets remaining: ${hydrateQueue.length}` : false },
        );
    }

    await sleep(BETWEEN_SETS_GAP_MS);
};

const pumpHydrateQueue = async () => {
    if (hydrateActive >= HYDRATE_CONCURRENCY) return;
    if (cacheWorkStopped) {
        hydrateQueue.length = 0;
        hydrateQueued.clear();
        return;
    }
    if (cacheWorkPaused) {
        if (hydrateCurrent == null || hydrateCurrent === 'Paused') {
            hydrateCurrent = 'Paused';
        }
        return;
    }
    const next = hydrateQueue.shift();
    if (!next) {
        if (hydrateActive === 0 && warmTitleActive === 0) {
            if (!cacheWorkPaused) hydrateCurrent = null;
            if (hydrateProgress.total > 0 && hydrateProgress.completed >= hydrateProgress.total) {
                hydrateProgress.finishedAt = nowMs();
            }
        }
        return;
    }
    hydrateActive += 1;
    const queueKey = next.queueKey;
    hydrateItemStartedAt = nowMs();
    try {
        await hydrateOneSet(next);
        hydrateProgress.completed += 1;
        pushSample(hydrateProgress.sampleMs, nowMs() - hydrateItemStartedAt);
    } catch (error) {
        hydrateProgress.completed += 1;
        hydrateLastError = error?.message || String(error);
        logTpdbCacheActivity(`Hydrate error: ${hydrateLastError}`, {
            level: 'error',
            kind: 'error',
            current: false,
        });
    } finally {
        hydrateActive -= 1;
        if (queueKey) hydrateQueued.delete(queueKey);
        persistHydrateSoon();
        void pumpHydrateQueue();
    }
};

/**
 * User-pasted / applied TPDB URLs should land in the local cache immediately —
 * not only when aggressive prefetch is on, and not only for followed creators.
 */
export const cacheExplicitTpdbUrl = async (url, extras = {}) => {
    const setUrl = String(url || extras.setMeta?.url || '').trim();
    if (!isTpdbUrl(setUrl)) return { saved: false, queued: 0 };
    try {
        const config = await loadPosterSetsConfig();
        if (config.tpdbLocalCacheEnabled !== true) return { saved: false, queued: 0 };
        let saved = null;
        if (Array.isArray(extras.assets) && extras.assets.length) {
            saved = await saveTpdbSetCache({
                url: setUrl,
                setId: extras.setId || extras.setMeta?.setId,
                setMeta: extras.setMeta || null,
                assets: extras.assets,
                matched: extras.matched,
                unmatched: extras.unmatched,
                total: extras.total,
                title: extras.title || extras.setMeta?.title,
            });
        }
        const hydrate = await enqueueTpdbLibraryTitleHydrate([{
            url: setUrl,
            provider: 'posterdb',
            setId: extras.setId || extras.setMeta?.setId,
            thumbUrl: extras.thumbUrl || extras.setMeta?.thumbUrl,
            user: extras.user || extras.setMeta?.user,
            posterCount: extras.total ?? extras.assets?.length,
            assetCount: extras.total ?? extras.assets?.length,
            explicit: true,
        }], {
            libraryScoped: true,
            force: true,
            followedCreatorsOnly: false,
            bypassFollowedOnly: true,
        });
        logTpdbCacheActivity(
            `Cached pasted/applied set${saved?.title ? ` · ${saved.title}` : ''} for later`,
            { kind: 'cache', detail: shortUrl(setUrl) },
        );
        return { saved: !!saved, queued: Number(hydrate?.queued) || 0 };
    } catch {
        return { saved: false, queued: 0 };
    }
};

/**
 * After a library title's set list is known, aggressively hydrate set previews + images.
 * Only call for library-scoped titles (TMDB / warm).
 */
export const enqueueTpdbLibraryTitleHydrate = async (sets = [], options = {}) => {
    const config = await loadPosterSetsConfig();
    if (config.tpdbLocalCacheEnabled !== true) return { queued: 0 };
    if (config.tpdbAggressivePrefetch !== true && !options.force) return { queued: 0 };
    if (!options.libraryScoped && !options.tmdbId && !options.tvdbId && !options.collectionSets) return { queued: 0 };

    const whitelist = Array.isArray(config.creatorWhitelist) ? config.creatorWhitelist : [];
    const blocklist = Array.isArray(config.creatorBlocklist) ? config.creatorBlocklist : [];
    const blockedKeys = new Set(
        blocklist.map((name) => normalizeCreatorHandle(name)).filter(Boolean),
    );
    const exclusive = options.followedCreatorsOnly === true
        || options.collectionSets === true
        || (options.followedCreatorsOnly !== false && (
            hydrateFollowedExclusiveSession || config.tpdbCacheFollowedCreatorsOnly === true
        ));
    // Build-scope "followed first" forces prioritize for this warm even if the saved setting is off.
    const forcePrioritizeSession = exclusive
        || options.followedOnly === true
        || hydrateFollowedOnlySession === true;
    const prioritizeFollowed = (
        (config.tpdbPrioritizeFollowedCreators !== false || forcePrioritizeSession)
        && whitelist.length > 0
    );
    let list = Array.isArray(sets) ? [...sets] : [];
    if (exclusive) {
        if (!whitelist.length) {
            if (!exclusiveEmptyFollowWarned) {
                exclusiveEmptyFollowWarned = true;
                logTpdbCacheActivity(
                    'Only cache followed creators is on, but Creators you follow is empty — skipping image prefetch.',
                    { level: 'warn', kind: 'followed' },
                );
            }
            return { queued: 0, preferredQueued: 0 };
        }
        list = keepFollowedCreatorsOnly(list, whitelist);
    }
    if (prioritizeFollowed) {
        list = prioritizeSetsByFollowedCreators(list, whitelist);
    }

    const followedKeys = new Set(
        whitelist.map((name) => normalizeCreatorHandle(name)).filter(Boolean),
    );
    const preferredItems = [];
    const otherItems = [];
    let queued = 0;
    let preferredQueued = 0;

    for (const set of list) {
        const provider = String(set?.provider || '').toLowerCase();
        if (provider && provider !== 'posterdb') continue;
        const setUrl = String(set?.url || '').trim();
        if (!setUrl || !isTpdbUrl(setUrl)) continue;
        const setId = extractTpdbSetId(set.setId || setUrl);
        const queueKey = setId || setUrl;
        if (hydrateQueued.has(queueKey)) continue;
        const user = String(set?.user || '').trim().replace(/^@+/, '') || null;
        if (user && blockedKeys.has(normalizeCreatorHandle(user))) continue;
        const preferred = prioritizeFollowed && user
            ? followedKeys.has(normalizeCreatorHandle(user))
            : false;
        hydrateQueued.add(queueKey);
        const item = {
            queueKey,
            setUrl,
            setId,
            thumbUrl: set.thumbUrl || '',
            titleKey: options.titleKey || null,
            user,
            preferred,
            posterCount: set.posterCount ?? set.assetCount ?? null,
            assetCount: set.assetCount ?? set.posterCount ?? null,
            bypassFollowedOnly: options.bypassFollowedOnly === true || set.explicit === true,
        };
        if (item.preferred) {
            preferredItems.push(item);
            preferredQueued += 1;
        } else {
            otherItems.push(item);
        }
        queued += 1;
    }

    if (preferredItems.length) {
        for (let i = preferredItems.length - 1; i >= 0; i -= 1) {
            hydrateQueue.unshift(preferredItems[i]);
        }
    }
    if (otherItems.length) {
        hydrateQueue.push(...otherItems);
    }

    if (queued > 0) {
        if (!hydrateProgress.startedAt || hydrateProgress.finishedAt) {
            if (hydrateProgress.finishedAt || hydrateActive === 0 && hydrateQueue.length === queued) {
                // Keep cumulative totals across a warm run unless fully finished.
                if (hydrateProgress.finishedAt) resetHydrateProgress();
            }
            if (!hydrateProgress.startedAt) hydrateProgress.startedAt = nowMs();
            hydrateProgress.finishedAt = null;
        }
        hydrateProgress.total += queued;
        logTpdbCacheActivity(
            options.collectionSets === true
                ? `Queued ${queued} followed collection set(s) for cache`
                : exclusive && preferredQueued > 0
                    ? `Queued ${queued} set(s) for prefetch (followed creators only)`
                    : preferredQueued > 0
                        ? `Queued ${queued} set(s) for prefetch (${preferredQueued} from Creators you follow first)`
                        : `Queued ${queued} set(s) for image/prefetch hydrate`,
            {
                kind: preferredQueued || options.collectionSets ? 'followed' : 'prefetch',
                detail: options.collectionSets
                    ? 'collection sets'
                    : (options.tmdbId ? `tmdb ${options.tmdbId}` : options.titleKey || null),
                current: `Prefetch queue · ${hydrateQueue.length} set(s)`,
            },
        );
    }
    void pumpHydrateQueue();
    persistHydrateSoon();
    return { queued, preferredQueued };
};

/**
 * Queue library titles for TPDB resolve (metadata-only Warm).
 * Already-cached titles are skipped so Warm resumes after restart instead of redoing work.
 * `fetchTitleSets(item)` should return `{ sets, title, titleUrl? }` for that library row.
 */
export const enqueueTpdbLibraryWarm = async (items = [], fetchTitleSets, options = {}) => {
    if (typeof fetchTitleSets !== 'function') return { queued: 0, skippedCached: 0 };
    const config = await loadPosterSetsConfig();
    if (!isPosterSetsTpdbEnabled(config) || config.tpdbLocalCacheEnabled !== true) return { queued: 0, skippedCached: 0 };

    warmFetchTitleSetsFn = fetchTitleSets;
    if (options.followedPrefetchOnly === true) hydrateFollowedOnlySession = true;
    else if (options.followedPrefetchOnly === false) hydrateFollowedOnlySession = false;
    if (options.followedCreatorsOnly === true) {
        hydrateFollowedExclusiveSession = true;
        exclusiveEmptyFollowWarned = false;
    } else if (options.followedCreatorsOnly === false) {
        hydrateFollowedExclusiveSession = false;
    }
    if (options.forceHydrate === true) hydrateForceSession = true;
    else if (options.forceHydrate === false) hydrateForceSession = false;
    if (options.autoContinue === true) {
        libraryContinueEnabled = true;
        cacheWorkStopped = false;
    }
    if (options.resetExhausted === true) exhaustedCoverageKeys.clear();

    let queued = 0;
    let skippedCached = 0;
    const force = options.force === true;
    const prioritize = options.priority === true;
    const alreadyQueued = new Set(
        warmTitleQueue.map((entry) => {
            const row = entry?.item || {};
            const tmdbId = String(row?.tmdbId || '').trim();
            const tvdbId = String(row?.tvdbId || '').trim();
            const mediaType = String(row?.mediaType || 'movie').toLowerCase() === 'show' ? 'show' : 'movie';
            return buildTpdbTitleCacheKey({
                tmdbId: /^\d+$/.test(tmdbId) ? tmdbId : null,
                tvdbId: /^\d+$/.test(tvdbId) ? tvdbId : null,
                mediaType,
                titleHint: row?.title,
                yearHint: row?.year,
            });
        }).filter(Boolean),
    );

    const startingFresh = warmTitleActive === 0 && warmTitleQueue.length === 0;
    if (startingFresh && (warmProgress.finishedAt || warmProgress.completed >= warmProgress.total)) {
        resetWarmProgress();
    }

    let incoming = Array.isArray(items) ? [...items] : [];
    if (options.media === 'movie' || options.media === 'show') {
        incoming = incoming.filter((item) => warmMediaAllows(options.media, item?.mediaType));
    }
    if (prioritize) {
        // Newest library adds first so they stay ahead of deep full-library backfill.
        incoming.sort((a, b) => (Number(b?.addedAt) || 0) - (Number(a?.addedAt) || 0));
    }

    /** @type {Array<{ item: object, fetchTitleSets: Function }>} */
    const toEnqueue = [];
    for (const item of incoming.slice(0, WARM_QUEUE_MAX)) {
        const tmdbId = String(item?.tmdbId || '').trim();
        const tvdbId = String(item?.tvdbId || '').trim();
        const hasTmdb = /^\d+$/.test(tmdbId);
        const hasTvdb = /^\d+$/.test(tvdbId);
        if (!hasTmdb && !hasTvdb) continue;
        const mediaType = String(item?.mediaType || 'movie').toLowerCase() === 'show' ? 'show' : 'movie';
        const titleKey = buildTpdbTitleCacheKey({
            tmdbId: hasTmdb ? tmdbId : null,
            tvdbId: hasTvdb ? tvdbId : null,
            mediaType,
            titleHint: item?.title,
            yearHint: item?.year,
        });
        if (titleKey && alreadyQueued.has(titleKey)) continue;
        const exhausted = coverageKeysForLibraryItem({
            tmdbId: hasTmdb ? tmdbId : null,
            tvdbId: hasTvdb ? tvdbId : null,
            mediaType,
        }).some((key) => exhaustedCoverageKeys.has(key));
        if (!force && exhausted) continue;
        if (!force) {
            const cached = await loadTpdbTitleCacheForLibraryItem({
                tmdbId: hasTmdb ? tmdbId : null,
                tvdbId: hasTvdb ? tvdbId : null,
                mediaType,
                title: item?.title,
                year: item?.year,
            });
            if (cached?.sets?.length) {
                skippedCached += 1;
                if (config.tpdbAggressivePrefetch === true || hydrateForceSession) {
                    void enqueueTpdbLibraryTitleHydrate(cached.sets, {
                        force: hydrateForceSession,
                        libraryScoped: true,
                        tmdbId: hasTmdb ? tmdbId : null,
                        tvdbId: hasTvdb ? tvdbId : null,
                        titleKey: cached.key || titleKey,
                        followedOnly: hydrateFollowedOnlySession,
                    });
                }
                continue;
            }
        }
        toEnqueue.push({ item, fetchTitleSets });
        if (titleKey) alreadyQueued.add(titleKey);
        queued += 1;
    }

    if (queued > 0) cacheWorkStopped = false;

    if (prioritize && toEnqueue.length) {
        for (let i = toEnqueue.length - 1; i >= 0; i -= 1) {
            warmTitleQueue.unshift(toEnqueue[i]);
        }
    } else if (toEnqueue.length) {
        warmTitleQueue.push(...toEnqueue);
    }

    if (queued > 0 || skippedCached > 0) {
        if (!warmProgress.startedAt) warmProgress.startedAt = nowMs();
        warmProgress.finishedAt = null;
        warmProgress.total += queued;
        warmProgress.skippedCached += skippedCached;
        logTpdbCacheActivity(
            `Cache queued ${queued} library title(s)`
            + (prioritize ? ' (priority / recent first)' : '')
            + (skippedCached ? ` (skipped ${skippedCached} already cached)` : ''),
            {
                kind: 'cache',
                current: queued
                    ? `Cache queue · ${warmTitleQueue.length} title(s)`
                    : (skippedCached ? 'Cache · all selected titles already cached' : false),
            },
        );
    }
    await persistWarmQueueSnapshot({
        lastEnqueueAt: new Date().toISOString(),
        lastSkippedCached: skippedCached,
        lastQueued: queued,
    });
    void pumpWarmTitleQueue();
    return { queued, skippedCached };
};

/**
 * After a process restart, continue any pending Warm titles and prefetch sets saved to disk.
 */
export const resumeTpdbWarmQueueFromDisk = async () => {
    const config = await loadPosterSetsConfig();
    if (config.tpdbLocalCacheEnabled !== true) return { resumed: 0 };

    const progress = await loadWarmProgress();
    // Soft-skip storms (bad ids / public search) used to persist exhausted keys across
    // restarts and permanently burn good titles until an explicit Build. Start clean.
    exhaustedCoverageKeys.clear();
    if (progress?.autoContinue === false || progress?.stoppedAt) libraryContinueEnabled = false;
    else libraryContinueEnabled = true;

    const hydrateResumed = restoreHydrateFromProgress(progress);

    if (typeof warmBatchRunnerFn !== 'function' && typeof warmFetchTitleSetsFn !== 'function') {
        return { resumed: 0, hydrateResumed };
    }
    if (warmTitleActive > 0 || warmTitleQueue.length > 0) {
        return { resumed: 0, hydrateResumed };
    }

    const pending = Array.isArray(progress?.pending) ? progress.pending : [];
    if (pending.length) {
        logTpdbCacheActivity(
            `Cache: resuming ${pending.length} title(s) left from before restart`,
            { current: `Cache resume · ${pending.length} title(s)` },
        );
        const result = await enqueueTpdbLibraryWarm(pending, warmFetchTitleSetsFn || (async () => ({ sets: [] })), {
            force: false,
            autoContinue: libraryContinueEnabled,
        });
        return {
            resumed: result.queued || 0,
            skippedCached: result.skippedCached || 0,
            hydrateResumed,
        };
    }

    if (libraryContinueEnabled) void maybeContinueLibraryWarm();
    return { resumed: 0, hydrateResumed };
};

const restoreHydrateFromProgress = (progress) => {
    const pending = Array.isArray(progress?.hydratePending) ? progress.hydratePending : [];
    if (!pending.length || hydrateQueue.length) return 0;
    let restored = 0;
    for (const item of pending) {
        const setUrl = String(item?.setUrl || '').trim();
        if (!setUrl) continue;
        const queueKey = item.setId || setUrl;
        if (hydrateQueued.has(queueKey)) continue;
        hydrateQueued.add(queueKey);
        hydrateQueue.push({
            queueKey,
            setUrl,
            setId: item.setId || null,
            thumbUrl: item.thumbUrl || '',
            titleKey: item.titleKey || null,
            user: item.user || null,
            preferred: item.preferred === true,
            posterCount: item.posterCount ?? null,
            assetCount: item.assetCount ?? null,
            bypassFollowedOnly: item.bypassFollowedOnly === true,
        });
        restored += 1;
    }
    if (restored) {
        if (!hydrateProgress.startedAt) hydrateProgress.startedAt = nowMs();
        hydrateProgress.finishedAt = null;
        hydrateProgress.total = Math.max(Number(hydrateProgress.total) || 0, hydrateQueue.length);
        logTpdbCacheActivity(
            `Cache: resuming ${restored} prefetch set(s) from before restart`,
            { current: `Prefetch queue · ${hydrateQueue.length} set(s)` },
        );
        void pumpHydrateQueue();
    }
    return restored;
};

const requeueUnappliedChunk = (chunkEntries, appliedKeys, reason) => {
    const retry = [];
    let dropped = 0;
    for (const entry of chunkEntries) {
        const item = entry?.item;
        const keys = warmLibraryItemKeys(item);
        if (keys.some((key) => appliedKeys.has(key))) continue;
        const attempts = (Number(entry?.attempts) || 0) + 1;
        if (attempts >= MAX_WARM_ATTEMPTS) {
            rememberExhaustedCoverageKey(item);
            dropped += 1;
            continue;
        }
        retry.push({ ...entry, attempts });
    }
    if (retry.length) {
        warmTitleQueue.push(...retry);
        logTpdbCacheActivity(
            `Cache: re-queued ${retry.length} title(s) after ${reason}`,
            { level: 'warn', kind: 'cache' },
        );
    }
    if (dropped) {
        warmProgress.completed += dropped;
        warmProgress.failed += dropped;
        logTpdbCacheActivity(
            `Cache: gave up on ${dropped} title(s) after ${MAX_WARM_ATTEMPTS} attempts (${reason})`,
            { level: 'warn', kind: 'cache' },
        );
    }
    return retry.length;
};

const maybeContinueLibraryWarm = async () => {
    if (!libraryContinueEnabled || cacheWorkPaused || cacheWorkStopped || libraryContinueBusy) return { queued: 0 };
    if (warmTitleActive > 0 || warmTitleQueue.length > 0) return { queued: 0 };
    if (typeof libraryContinueFn !== 'function') return { queued: 0 };
    const config = await loadPosterSetsConfig().catch(() => null);
    if (config?.tpdbLocalCacheEnabled !== true) return { queued: 0 };
    libraryContinueBusy = true;
    try {
        const result = await libraryContinueFn({
            limit: WARM_CONTINUE_BATCH,
            exhaustedKeys: [...exhaustedCoverageKeys],
        });
        const queued = Number(result?.queued) || 0;
        if (queued > 0) {
            logTpdbCacheActivity(
                `Cache: background catch-up queued ${queued} more uncached library title(s)`,
                {
                    kind: 'cache',
                    current: `Cache queue · ${warmTitleQueue.length} title(s)`,
                },
            );
        }
        return { queued };
    } catch (error) {
        logTpdbCacheActivity(`Cache catch-up failed: ${error?.message || error}`, {
            level: 'warn',
            kind: 'error',
        });
        return { queued: 0 };
    } finally {
        libraryContinueBusy = false;
    }
};

/** Persist one Warm title as soon as the CLI finishes it (so disk counts move live). */
export const applyTpdbWarmTitleResult = async (item, result) => {
    const titleLabel = item?.title
        ? `${item.title}${item?.year ? ` (${item.year})` : ''}`
        : (item?.tmdbId
            ? `tmdb ${item.tmdbId}`
            : `tvdb ${item?.tvdbId || '?'}`);
    const config = await loadPosterSetsConfig();
    const sets = excludeBlockedCreators(result?.sets || [], config.creatorBlocklist);
    if (result?.softSkip) {
        const hasTmdb = /^\d+$/.test(String(item?.tmdbId || '').trim());
        const hasTvdb = /^\d+$/.test(String(item?.tvdbId || '').trim());
        // Mapped TVDB→TMDB already searches TVDB-only; don't loop another soft-skip retry.
        if (
            hasTmdb
            && hasTvdb
            && item?._tvdbOnlyRetry !== true
            && item?._tmdbMappedFromTvdb !== true
        ) {
            logTpdbCacheActivity(
                `Cache: soft-skip ${titleLabel} — retrying with TVDB only`,
                {
                    level: 'warn',
                    detail: `tmdb ${item.tmdbId} → tvdb ${item.tvdbId}`,
                },
            );
            return { retryTvdbOnly: true };
        }
        const softError = String(result.softError || '');
        const transient = /cache batch failed|worker timed out|rate limit|429|cooling down/i.test(softError);
        if (!transient) rememberExhaustedCoverageKey(item);
        logTpdbCacheActivity(
            `Cache: skipped ${titleLabel} — ${result.softError || 'no TPDB title page'}`,
            {
                level: 'warn',
                detail: item?.tmdbId
                    ? `tmdb ${item.tmdbId}`
                    : (item?.tvdbId ? `tvdb ${item.tvdbId}` : null),
            },
        );
        return null;
    }
    if (sets.length) {
        forgetExhaustedCoverageKey(item);
        logTpdbCacheActivity(`Cache: ${titleLabel} → ${sets.length} set(s)`, {
            detail: result?.titleUrl || null,
        });
        const tmdbId = /^\d+$/.test(String(item?.tmdbId || '').trim()) ? String(item.tmdbId) : null;
        const tvdbId = /^\d+$/.test(String(item?.tvdbId || '').trim()) ? String(item.tvdbId) : null;
        const mediaType = item?.mediaType;
        const titleKey = buildTpdbTitleCacheKey({
            tmdbId,
            tvdbId,
            mediaType,
            titleHint: item?.title,
            yearHint: item?.year,
            titleUrl: result?.titleUrl,
        });
        const saved = await rememberPosterdbSearchResult({ ...result, sets }, {
            libraryScoped: true,
            tmdbId,
            tvdbId,
            mediaType,
            titleHint: item?.title,
            yearHint: item?.year,
            titleUrl: result?.titleUrl,
        });
        if (!saved) {
            logTpdbCacheActivity(
                `Cache: could not write title page for ${titleLabel} (missing TMDB/TVDB key or all sets blocked)`,
                { level: 'warn', detail: titleKey || warmLibraryItemKey(item) || null },
            );
            return null;
        }
        // When Prefetch is on (or first-run / library-add forceHydrate), hydrate set
        // pages + images as titles resolve so disk counts move live alongside title pages.
        if (config.tpdbAggressivePrefetch === true || hydrateForceSession) {
            void enqueueTpdbLibraryTitleHydrate(sets, {
                force: hydrateForceSession,
                libraryScoped: true,
                tmdbId,
                tvdbId,
                titleKey: saved.key || titleKey,
                followedOnly: hydrateFollowedOnlySession,
            });
        }
        return saved;
    }
    if (result?.sets?.length) {
        rememberExhaustedCoverageKey(item);
        logTpdbCacheActivity(
            `Cache: skipped blocked creator set(s) for ${titleLabel}`,
            { level: 'warn' },
        );
        return null;
    }
    logTpdbCacheActivity(`Cache: no TPDB sets for ${titleLabel}`, { level: 'warn' });
    return null;
};

const pumpWarmTitleQueue = async () => {
    if (warmTitleActive > 0) return;
    if (cacheWorkStopped) {
        warmTitleQueue.length = 0;
        hydrateCurrent = null;
        return;
    }
    if (cacheWorkPaused) {
        hydrateCurrent = 'Paused';
        return;
    }
    if (!warmTitleQueue.length) {
        // First-run / library-add forceHydrate must not leak into later library continue.
        hydrateForceSession = false;
        await persistWarmQueueSnapshot({
            pending: [],
            pendingCount: 0,
            active: false,
            completedAt: new Date().toISOString(),
        });
        const continued = await maybeContinueLibraryWarm();
        if ((continued?.queued || 0) === 0 && warmProgress.total > 0) {
            warmProgress.finishedAt = nowMs();
            const pct = progressPercent(warmProgress);
            logTpdbCacheActivity(
                `Cache batch finished — ${warmProgress.completed}/${warmProgress.total} title(s)`
                + (pct != null ? ` (${pct}%)` : '')
                + (warmProgress.skippedCached ? `, skipped ${warmProgress.skippedCached} cached` : ''),
                { kind: 'cache', current: hydrateActive > 0 || hydrateQueue.length ? true : false },
            );
        }
        if (hydrateActive === 0 && !cacheWorkPaused) hydrateCurrent = null;
        return;
    }

    warmTitleActive = 1;
    warmChunkStartedAt = nowMs();
    const config = await loadPosterSetsConfig();
    const parallelOn = config.tpdbWarmParallelWorkers === true;
    const useBatch = typeof warmBatchRunnerFn === 'function';
    const peekItems = useBatch
        ? warmTitleQueue.slice(0, WARM_BATCH_SIZE * WARM_PARALLEL_WORKERS).map((entry) => entry?.item)
        : [warmTitleQueue[0]?.item].filter(Boolean);
    const showHeavy = peekItems.length > 0
        && peekItems.filter((item) => String(item?.mediaType || '').toLowerCase() === 'show').length
            >= Math.ceil(peekItems.length / 2);
    // TV resolves need login + more TPDB probes than movies. 5 parallel workers
    // 429 the catalog; webhook (one title) succeeds. Keep TV serial in one CLI.
    const workerCount = parallelOn && !showHeavy ? WARM_PARALLEL_WORKERS : 1;
    const chunkEntries = useBatch
        ? warmTitleQueue.splice(0, WARM_BATCH_SIZE * workerCount)
        : [warmTitleQueue.shift()].filter(Boolean);
    const chunkItems = chunkEntries.map((entry) => entry.item).filter(Boolean);
    /** @type {Set<string>} */
    const appliedKeys = new Set();

    await persistWarmQueueSnapshot({
        activeItem: chunkItems[0] || null,
        active: true,
        batchSize: chunkItems.length,
        workers: workerCount,
    });

    try {
        if (rateLimitCooldownUntil > nowMs()) {
            await sleep(rateLimitCooldownUntil - nowMs());
        }

        if (useBatch && chunkItems.length) {
            let results = [];
            const onTitleResult = async (item, result) => {
                if (cacheWorkStopped) return;
                const keys = warmLibraryItemKeys(item);
                if (keys.some((key) => appliedKeys.has(key))) return;
                const outcome = await applyTpdbWarmTitleResult(item, result);
                if (outcome?.retryTvdbOnly) {
                    // Mark applied so the batch fallback does not re-run softSkip → double-queue.
                    for (const key of keys) appliedKeys.add(key);
                    warmTitleQueue.unshift({
                        item: {
                            ...item,
                            tmdbId: null,
                            libraryTmdbId: null,
                            _tmdbMappedFromTvdb: false,
                            _tvdbOnlyRetry: true,
                        },
                        fetchTitleSets: warmFetchTitleSetsFn,
                    });
                    await persistWarmQueueSnapshot({ activeItem: item });
                    return;
                }
                for (const key of keys) appliedKeys.add(key);
                warmProgress.completed += 1;
                if (result?.softSkip) warmProgress.failed += 1;
                await persistWarmQueueSnapshot({ activeItem: item });
            };
            if (workerCount <= 1) {
                logTpdbCacheActivity(
                    showHeavy && parallelOn
                        ? `Cache batch: resolving ${chunkItems.length} TV title(s) serially (parallel workers skip TV to avoid TPDB rate limits)`
                        : `Cache batch: resolving ${chunkItems.length} title(s) (metadata only)`,
                    { kind: 'cache', current: `Cache batch · ${chunkItems.length} title(s)` },
                );
                results = await warmBatchRunnerFn(chunkItems, {
                    onTitleResult,
                    stallTimeoutMs: WARM_STALL_MS,
                });
            } else {
                const shards = Array.from({ length: workerCount }, () => []);
                chunkItems.forEach((item, index) => {
                    shards[index % workerCount].push(item);
                });
                const activeShards = shards
                    .map((shard, workerId) => ({ shard, workerId }))
                    .filter((entry) => entry.shard.length > 0);
                logTpdbCacheActivity(
                    `Cache parallel: ${chunkItems.length} title(s) across ${activeShards.length} workers (metadata only)`,
                    { kind: 'cache', current: `Cache ×${activeShards.length} · ${chunkItems.length} title(s)` },
                );
                const nested = await Promise.all(
                    activeShards.map(({ shard, workerId }) => warmBatchRunnerFn(shard, {
                        workerId,
                        isolateSession: true,
                        onTitleResult,
                        stallTimeoutMs: WARM_STALL_MS,
                    })),
                );
                results = nested.flat();
            }
            const byKey = new Map();
            for (const row of (Array.isArray(results) ? results : [])) {
                for (const key of warmLibraryItemKeys(row)) {
                    byKey.set(key, row);
                }
            }
            const missingEntries = [];
            for (const entry of chunkEntries) {
                const item = entry.item;
                const keys = warmLibraryItemKeys(item);
                if (keys.some((key) => appliedKeys.has(key))) continue;
                const result = keys.map((key) => byKey.get(key)).find(Boolean) || null;
                if (result) {
                    await onTitleResult(item, result);
                    continue;
                }
                missingEntries.push(entry);
            }
            if (missingEntries.length) {
                requeueUnappliedChunk(missingEntries, appliedKeys, 'incomplete batch');
            }
            pushSample(warmProgress.sampleMs, (nowMs() - warmChunkStartedAt) / Math.max(1, chunkItems.length));
        } else {
            for (const entry of chunkEntries) {
                if (cacheWorkStopped) break;
                const { item, fetchTitleSets } = entry;
                const titleLabel = item?.title
                    ? `${item.title}${item?.year ? ` (${item.year})` : ''}`
                    : (warmLibraryItemKey(item) || 'library title');
                const titleStarted = nowMs();
                logTpdbCacheActivity(`Cache: resolving TPDB sets for ${titleLabel}`, {
                    kind: 'cache',
                    detail: warmLibraryItemKey(item) || null,
                    current: `Cache · ${titleLabel}`,
                });
                const result = await fetchTitleSets(item);
                const outcome = await applyTpdbWarmTitleResult(item, result);
                if (outcome?.retryTvdbOnly) {
                    warmTitleQueue.unshift({
                        item: {
                            ...item,
                            tmdbId: null,
                            libraryTmdbId: null,
                            _tmdbMappedFromTvdb: false,
                            _tvdbOnlyRetry: true,
                        },
                        fetchTitleSets,
                    });
                    await sleep(BETWEEN_WARM_TITLES_MS);
                    continue;
                }
                for (const key of warmLibraryItemKeys(item)) appliedKeys.add(key);
                warmProgress.completed += 1;
                if (result?.softSkip) warmProgress.failed += 1;
                pushSample(warmProgress.sampleMs, nowMs() - titleStarted);
                await sleep(BETWEEN_WARM_TITLES_MS);
            }
        }
    } catch (error) {
        const message = error?.message || String(error);
        const loginBroken = /login failed/i.test(message);
        if (/title url is required|could not (resolve|find).*title page|found no \/posters|needs a \/posters|login failed/i.test(message)) {
            logTpdbCacheActivity(`Cache: skipped — ${message}`, { level: 'warn', kind: 'cache' });
        } else {
            hydrateLastError = message;
            logTpdbCacheActivity(`Cache error: ${hydrateLastError}`, {
                level: 'error',
                kind: 'error',
                current: false,
            });
        }
        if (cacheWorkStopped) {
            warmTitleQueue.length = 0;
        } else if (loginBroken) {
            for (const entry of chunkEntries) {
                const keys = warmLibraryItemKeys(entry?.item);
                if (keys.some((key) => appliedKeys.has(key))) continue;
                rememberExhaustedCoverageKey(entry.item);
                warmProgress.completed += 1;
                warmProgress.failed += 1;
            }
        } else {
            requeueUnappliedChunk(chunkEntries, appliedKeys, message);
        }
    } finally {
        warmTitleActive = 0;
        await persistWarmQueueSnapshot({ active: false, activeItem: null });
        if (!cacheWorkStopped) void pumpWarmTitleQueue();
    }
};

/**
 * Search helpers: try cache first, optionally kick SWR refresh via caller.
 */
export const buildCachedSearchResponse = (entry, { partialErrors = [] } = {}) => {
    if (!entry) return null;
    const errors = [...(partialErrors || [])].filter(Boolean);
    return {
        ok: true,
        provider: 'posterdb',
        phase: 'sets',
        fromCache: true,
        // Local cache is the permanent store — never mark a successful disk hit as stale.
        stale: false,
        title: entry.title || null,
        titleUrl: entry.titleUrl || null,
        titles: [],
        sets: entry.sets || [],
        partialErrors: errors.length ? errors : undefined,
    };
};

export const rememberPosterdbSearchResult = async (result, meta = {}) => {
    if (meta.libraryScoped === false) return null;
    if (!meta.libraryScoped && !meta.tmdbId) return null;
    const sets = excludeBlockedCreators(
        (result?.sets || []).filter((set) => {
            const provider = String(set?.provider || 'posterdb').toLowerCase();
            return provider === 'posterdb';
        }),
        (await loadPosterSetsConfig()).creatorBlocklist,
    );
    if (!sets.length) return null;
    const key = buildTpdbTitleCacheKey({
        tmdbId: meta.tmdbId || result?.tmdbId,
        tvdbId: meta.tvdbId || result?.tvdbId,
        mediaType: meta.mediaType,
        titleUrl: meta.titleUrl || result?.titleUrl,
        titleHint: meta.titleHint || result?.title,
        yearHint: meta.yearHint,
    });
    if (!key) return null;
    const existing = await loadTpdbTitleCache(key);
    const merged = mergeTpdbTitleSets(existing?.sets || [], sets);
    return saveTpdbTitleCache(key, {
        sets: merged,
        titleUrl: meta.titleUrl || result?.titleUrl || existing?.titleUrl || null,
        title: result?.title || meta.titleHint || existing?.title || null,
        tmdbId: meta.tmdbId || existing?.tmdbId || null,
        tvdbId: meta.tvdbId || existing?.tvdbId || null,
        mediaType: meta.mediaType || existing?.mediaType || null,
    });
};

/** Union title-set lists by TPDB set id / URL (permanent local DB — never drop known unblocked sets). */
export const mergeTpdbTitleSets = (existing = [], incoming = []) => {
    const map = new Map();
    for (const set of [...(existing || []), ...(incoming || [])]) {
        const provider = String(set?.provider || 'posterdb').toLowerCase();
        if (provider && provider !== 'posterdb') continue;
        const key = extractTpdbSetId(set?.setId || set?.url) || String(set?.url || '').trim();
        if (!key) continue;
        if (!map.has(key)) map.set(key, set);
    }
    return [...map.values()];
};

export const listTpdbTitleCacheEntries = async () => {
    await ensureDirs();
    let names = [];
    try {
        names = await fs.readdir(TPDB_TITLE_CACHE_DIR);
    } catch {
        return [];
    }
    const entries = [];
    for (const name of names) {
        if (!name.endsWith('.json')) continue;
        const entry = await readJsonFile(path.join(TPDB_TITLE_CACHE_DIR, name));
        if (entry && Array.isArray(entry.sets) && entry.sets.length) entries.push(entry);
    }
    return entries;
};

const setKeyForSet = (set) => extractTpdbSetId(set?.setId || set?.url) || String(set?.url || '').trim();

const yearFromCachedTitle = (title) => {
    const match = String(title || '').match(/\((\d{4})\)\s*$/);
    return match ? Number(match[1]) : null;
};

const bareTitleFromCached = (title) => String(title || '').replace(/\s*\(\d{4}\)\s*$/, '').trim();

/** @type {ReturnType<typeof createDailyRefreshStatus>} */
let dailyRefreshStatus = createDailyRefreshStatus();
let dailyRefreshTimer = null;
let dailyRefreshBusy = false;

function createDailyRefreshStatus() {
    return {
        hourLocal: TPDB_DAILY_REFRESH_HOUR,
        intervalHours: 0,
        running: false,
        lastRunAt: null,
        nextRunAt: null,
        lastResult: null,
    };
}

export const getTpdbDailyRefreshStatus = () => ({
    ...dailyRefreshStatus,
    busy: dailyRefreshBusy,
});

const formatLocalHourLabel = (hour) => `${String(Math.max(0, Math.min(23, hour))).padStart(2, '0')}:00`;

/** Clock-aligned slots: start at `hour`, then every `intervalHours` (0/24 = once daily). */
export const listTpdbRefreshHours = (hour = TPDB_DAILY_REFRESH_HOUR, intervalHours = 0) => {
    const start = Math.max(0, Math.min(23, Math.round(Number(hour) || 0)));
    const interval = Math.max(0, Math.min(24, Math.round(Number(intervalHours) || 0)));
    if (!interval || interval >= 24) return [start];
    const slots = new Set();
    for (let t = start; t < start + 24; t += interval) {
        slots.add(((t % 24) + 24) % 24);
    }
    return [...slots].sort((a, b) => a - b);
};

const resolveRefreshSchedule = async () => {
    const config = await loadPosterSetsConfig().catch(() => null);
    const hour = Math.max(
        0,
        Math.min(23, Math.round(Number(config?.tpdbCacheRefreshHour ?? TPDB_DAILY_REFRESH_HOUR) || 0)),
    );
    const intervalHours = Math.max(
        0,
        Math.min(24, Math.round(Number(config?.tpdbCacheRefreshIntervalHours ?? 0) || 0)),
    );
    return { hour, intervalHours, hours: listTpdbRefreshHours(hour, intervalHours) };
};

const msUntilNextRefreshSlot = (hour, intervalHours) => {
    const now = new Date();
    const hours = listTpdbRefreshHours(hour, intervalHours);
    for (const h of hours) {
        const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, 0, 0, 0);
        if (candidate.getTime() > now.getTime() + 4_000) {
            return Math.max(5_000, candidate.getTime() - now.getTime());
        }
    }
    const first = hours[0] ?? hour;
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, first, 0, 0, 0);
    return Math.max(5_000, tomorrow.getTime() - now.getTime());
};

const applyDailyRefreshTitleResult = async (item, result) => {
    const config = await loadPosterSetsConfig();
    const existingSets = excludeBlockedCreators(
        Array.isArray(item.existingSets)
            ? item.existingSets
            : ((await loadTpdbTitleCache(item.cacheKey))?.sets || []),
        config.creatorBlocklist,
    );
    if (result?.softSkip || !(result?.sets || []).length) {
        if (item.cacheKey) await touchTpdbTitleRevalidated(item.cacheKey).catch(() => null);
        return { added: 0, refreshed: false };
    }
    const existingKeys = new Set(existingSets.map(setKeyForSet).filter(Boolean));
    const incoming = excludeBlockedCreators(
        (result.sets || []).filter((set) => {
            const provider = String(set?.provider || 'posterdb').toLowerCase();
            return !provider || provider === 'posterdb';
        }),
        config.creatorBlocklist,
    );
    const newSets = incoming.filter((set) => {
        const key = setKeyForSet(set);
        return key && !existingKeys.has(key);
    });
    const merged = mergeTpdbTitleSets(existingSets, incoming);
    const tmdbId = /^\d+$/.test(String(item.tmdbId || '').trim()) ? String(item.tmdbId) : null;
    const tvdbId = /^\d+$/.test(String(item.tvdbId || '').trim()) ? String(item.tvdbId) : null;
    const key = item.cacheKey || buildTpdbTitleCacheKey({
        tmdbId,
        tvdbId,
        mediaType: item.mediaType,
        titleHint: item.title,
        yearHint: item.year,
        titleUrl: result.titleUrl || item.titleUrl,
    });
    await saveTpdbTitleCache(key, {
        sets: merged,
        titleUrl: result.titleUrl || item.titleUrl || null,
        title: result.title || item.title || null,
        tmdbId,
        tvdbId,
        mediaType: item.mediaType,
    });
    // Always hydrate newly discovered sets so overnight refresh fills images without Prefetch.
    if (newSets.length) {
        void enqueueTpdbLibraryTitleHydrate(newSets, {
            force: true,
            libraryScoped: true,
            tmdbId,
            tvdbId,
            titleKey: key,
        });
    }
    return { added: newSets.length, refreshed: true };
};

/**
 * Dedicated worker: re-check every *existing* title-cache file for new TPDB sets.
 * Runs independently of library warm/build (own session + busy flag).
 * Does not discover new library titles — only merges into on-disk cache entries.
 */
export const runTpdbCacheDailyRefreshPass = async () => {
    const config = await loadPosterSetsConfig();
    if (!isPosterSetsTpdbEnabled(config) || config.tpdbLocalCacheEnabled !== true) {
        return { skipped: true, reason: 'cache-disabled' };
    }
    if (dailyRefreshBusy) {
        return { skipped: true, reason: 'busy' };
    }
    if (typeof refreshFetchTitleSetsFn !== 'function' && typeof warmFetchTitleSetsFn !== 'function') {
        return { skipped: true, reason: 'not-ready' };
    }

    dailyRefreshBusy = true;
    dailyRefreshStatus.running = true;
    dailyRefreshStatus.lastRunAt = new Date().toISOString();
    const alongsideWarm = warmTitleActive > 0 || warmTitleQueue.length > 0;
    logTpdbCacheActivity(
        alongsideWarm
            ? 'New-sets refresh worker: checking existing cache files (library build still running — using separate session)…'
            : 'New-sets refresh worker: checking existing cache files for new poster sets…',
        {
            kind: 'cache',
            current: 'New-sets refresh worker…',
        },
    );

    let refreshed = 0;
    let addedSets = 0;
    let failed = 0;
    let skippedFresh = 0;
    let titles = 0;
    const fetchTitle = refreshFetchTitleSetsFn || warmFetchTitleSetsFn;
    const schedule = await resolveRefreshSchedule();
    const skipIfFresherThanMs = resolveDailyRefreshSkipMs(schedule.intervalHours);

    try {
        const entries = await listTpdbTitleCacheEntries();
        const items = [];
        const seen = new Set();
        for (const entry of entries) {
            const tmdbId = String(entry.tmdbId || '').trim();
            const tvdbId = String(entry.tvdbId || '').trim();
            const hasTmdb = /^\d+$/.test(tmdbId);
            const hasTvdb = /^\d+$/.test(tvdbId);
            if (!hasTmdb && !hasTvdb) continue;
            const mediaType = String(entry.mediaType || 'movie').toLowerCase() === 'show' ? 'show' : 'movie';
            const identities = [
                ...(hasTmdb ? [`tmdb:${mediaType}:${tmdbId}`] : []),
                ...(hasTvdb ? [`tvdb:${mediaType}:${tvdbId}`] : []),
            ];
            if (identities.some((id) => seen.has(id))) continue;
            for (const id of identities) seen.add(id);

            if (!titleCacheNeedsRevalidate(entry, skipIfFresherThanMs)) {
                skippedFresh += 1;
                continue;
            }

            const year = yearFromCachedTitle(entry.title);
            items.push({
                ...(hasTmdb ? { tmdbId } : {}),
                ...(hasTvdb ? { tvdbId } : {}),
                title: bareTitleFromCached(entry.title) || entry.title
                    || (hasTmdb ? `tmdb ${tmdbId}` : `tvdb ${tvdbId}`),
                year,
                mediaType,
                cacheKey: entry.key,
                existingSets: entry.sets || [],
                titleUrl: entry.titleUrl || null,
            });
        }
        titles = items.length;
        if (!titles) {
            const empty = {
                refreshed: 0,
                addedSets: 0,
                failed: 0,
                titles: 0,
                skippedFresh,
            };
            dailyRefreshStatus.lastResult = empty;
            logTpdbCacheActivity(
                skippedFresh
                    ? `New-sets refresh worker: skipped ${skippedFresh} fresh title(s); nothing left to check`
                    : 'New-sets refresh worker: no cached titles on disk yet',
                {
                    kind: 'cache',
                    current: false,
                },
            );
            return empty;
        }

        for (const item of items) {
            if (cacheWorkPaused) {
                logTpdbCacheActivity('New-sets refresh worker paused — remaining titles left for next run', {
                    level: 'warn',
                    kind: 'cache',
                });
                break;
            }
            const idLabel = item.tmdbId ? `tmdb ${item.tmdbId}` : `tvdb ${item.tvdbId}`;
            try {
                await waitForTpdbRequestSlot();
                const result = await fetchTitle(item);
                const outcome = await applyDailyRefreshTitleResult(item, result);
                if (outcome.refreshed) refreshed += 1;
                addedSets += outcome.added;
                if (outcome.added > 0) {
                    logTpdbCacheActivity(
                        `New-sets refresh: ${item.title} +${outcome.added} new set(s)`,
                        { kind: 'cache', detail: idLabel },
                    );
                }
            } catch (error) {
                failed += 1;
                logTpdbCacheActivity(
                    `New-sets refresh failed for ${item.title}: ${error?.message || error}`,
                    { level: 'warn', kind: 'error', detail: idLabel },
                );
            }
            await sleep(BETWEEN_REFRESH_TITLES_MS);
        }

        const summary = {
            refreshed,
            addedSets,
            failed,
            titles,
            skippedFresh,
            alongsideWarm,
        };
        dailyRefreshStatus.lastResult = summary;
        logTpdbCacheActivity(
            `New-sets refresh done — ${refreshed}/${titles} cached titles checked`
            + (skippedFresh ? `, skipped ${skippedFresh} fresh` : '')
            + `, +${addedSets} new set(s)${failed ? `, ${failed} error(s)` : ''}`,
            { kind: 'cache', current: false },
        );
        return summary;
    } catch (error) {
        const message = error?.message || String(error);
        dailyRefreshStatus.lastResult = {
            error: message,
            refreshed,
            addedSets,
            failed,
            titles,
            skippedFresh,
        };
        logTpdbCacheActivity(`New-sets refresh aborted: ${message}`, {
            level: 'error',
            kind: 'error',
            current: false,
        });
        return dailyRefreshStatus.lastResult;
    } finally {
        dailyRefreshBusy = false;
        dailyRefreshStatus.running = false;
    }
};

const armTpdbDailyRefreshTimer = async () => {
    if (dailyRefreshTimer) {
        clearTimeout(dailyRefreshTimer);
        dailyRefreshTimer = null;
    }
    const schedule = await resolveRefreshSchedule();
    dailyRefreshStatus.hourLocal = schedule.hour;
    dailyRefreshStatus.intervalHours = schedule.intervalHours;
    const waitMs = msUntilNextRefreshSlot(schedule.hour, schedule.intervalHours);
    dailyRefreshStatus.nextRunAt = new Date(Date.now() + waitMs).toISOString();
    dailyRefreshTimer = setTimeout(() => {
        void (async () => {
            try {
                await runTpdbCacheDailyRefreshPass();
            } catch {
                /* keep schedule alive */
            }
            void armTpdbDailyRefreshTimer();
        })();
    }, waitMs);
    dailyRefreshTimer.unref?.();
};

export const startTpdbCacheDailyRefresh = () => {
    void armTpdbDailyRefreshTimer().then(() => {
        const hours = listTpdbRefreshHours(dailyRefreshStatus.hourLocal, dailyRefreshStatus.intervalHours);
        const slotLabel = hours.map(formatLocalHourLabel).join(', ');
        logTpdbCacheActivity(
            dailyRefreshStatus.intervalHours > 0 && dailyRefreshStatus.intervalHours < 24
                ? `Cache refresh scheduled at ${slotLabel} server local (every ${dailyRefreshStatus.intervalHours}h from ${formatLocalHourLabel(dailyRefreshStatus.hourLocal)}; next ${dailyRefreshStatus.nextRunAt})`
                : `Cache refresh scheduled daily at ${formatLocalHourLabel(dailyRefreshStatus.hourLocal)} server local (next ${dailyRefreshStatus.nextRunAt})`,
            { kind: 'cache' },
        );
    });
    startTpdbCacheLibraryContinue();
    return getTpdbDailyRefreshStatus();
};

export const startTpdbCacheLibraryContinue = () => {
    if (libraryContinueTimer) {
        clearInterval(libraryContinueTimer);
        libraryContinueTimer = null;
    }
    libraryContinueTimer = setInterval(() => {
        if (!libraryContinueEnabled || cacheWorkPaused || cacheWorkStopped || libraryContinueBusy) return;
        if (warmTitleActive > 0 || warmTitleQueue.length > 0) return;
        void (async () => {
            const config = await loadPosterSetsConfig().catch(() => null);
            if (config?.tpdbLocalCacheEnabled !== true) return;
            void maybeContinueLibraryWarm();
        })();
    }, LIBRARY_CONTINUE_INTERVAL_MS);
    libraryContinueTimer.unref?.();
    return { intervalMs: LIBRARY_CONTINUE_INTERVAL_MS };
};

/** Re-read config and re-arm the timer (call after Settings save). */
export const rescheduleTpdbCacheDailyRefresh = () => {
    void armTpdbDailyRefreshTimer().then(() => {
        logTpdbCacheActivity(
            `Cache refresh schedule updated — next ${dailyRefreshStatus.nextRunAt}`,
            { kind: 'cache' },
        );
    });
    return getTpdbDailyRefreshStatus();
};

export const stopTpdbCacheDailyRefresh = () => {
    if (dailyRefreshTimer) {
        clearTimeout(dailyRefreshTimer);
        dailyRefreshTimer = null;
    }
    dailyRefreshStatus.nextRunAt = null;
};

export const previewFromTpdbSetCache = async (url) => {
    if (!isTpdbUrl(url)) return null;
    const entry = await loadTpdbSetCache(url);
    if (!entry) return null;
    return {
        ok: true,
        fromCache: true,
        url: entry.url || url,
        assets: entry.assets,
        setMeta: entry.setMeta || {
            provider: 'posterdb',
            setId: entry.setId,
            url: entry.url || url,
            title: entry.title,
        },
        matched: entry.matched,
        unmatched: entry.unmatched,
        total: entry.total ?? entry.assets.length,
        title: entry.title,
    };
};
