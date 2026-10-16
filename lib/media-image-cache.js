/**
 * Durable cache for proxied Plex/Jellyfin covers.
 * Successful images are stored on disk so the home dashboard (and other
 * poster rows) survive Plex/Jellyfin timeouts on later visits.
 * Failures and empty bodies are never stored.
 */
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { MEDIA_IMAGE_CACHE_DIR } from './data-paths.js';
import { createTtlLruCache } from './memory-cache.js';

export const MEDIA_IMAGE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MEDIA_IMAGE_CACHE_MAX_FILES = 800;
export const MEDIA_IMAGE_CACHE_MAX_BYTES = 250 * 1024 * 1024;
export const MEDIA_IMAGE_CACHE_MAX_ITEM_BYTES = 4 * 1024 * 1024;
export const MEDIA_IMAGE_UPSTREAM_CONCURRENCY = 12;
export const DASHBOARD_POSTER_WIDTH = 300;
export const DASHBOARD_POSTER_HEIGHT = 450;
export const DASHBOARD_MUSIC_SIZE = 300;

const MEMORY_MAX_ENTRIES = 400;
const MEMORY_MAX_ITEM_BYTES = 700 * 1024;
const MEMORY_TTL_MS = 60 * 60 * 1000;
const PRUNE_EVERY_WRITES = 25;

const memoryCache = createTtlLruCache({
    maxEntries: MEMORY_MAX_ENTRIES,
    defaultTtlMs: MEMORY_TTL_MS,
    name: 'media-image',
});

const inflight = new Map();
let upstreamActive = 0;
/** @type {Array<() => void>} */
const liveWaiters = [];
/** @type {Array<() => void>} */
const warmWaiters = [];
let writesSincePrune = 0;
let warming = false;
let pruneScheduled = false;

const binPathFor = (cacheDir, key) => path.join(cacheDir, `${key}.bin`);
const metaPathFor = (cacheDir, key) => path.join(cacheDir, `${key}.json`);

export const mediaImageCacheKey = ({ source, id, width, height } = {}) => {
    const raw = `${String(source || '')}|${String(id || '')}|${Number(width) || 0}|${Number(height) || 0}`;
    return crypto.createHash('sha1').update(raw).digest('hex');
};

export const collectDashboardImageJobs = ({
    source,
    recentMovies = [],
    recentShows = [],
    recentMusic = [],
} = {}) => {
    const jobs = [];
    const seen = new Set();
    const add = (item, width, height) => {
        const id = String(item?.thumb || '').trim();
        if (!id) return;
        const job = { source, id, width, height };
        const key = mediaImageCacheKey(job);
        if (seen.has(key)) return;
        seen.add(key);
        jobs.push(job);
    };
    for (const item of recentMovies) add(item, DASHBOARD_POSTER_WIDTH, DASHBOARD_POSTER_HEIGHT);
    for (const item of recentShows) add(item, DASHBOARD_POSTER_WIDTH, DASHBOARD_POSTER_HEIGHT);
    for (const item of recentMusic) add(item, DASHBOARD_MUSIC_SIZE, DASHBOARD_MUSIC_SIZE);
    return jobs;
};

const putMemory = (key, entry, createdAt = Date.now()) => {
    if (!entry?.body?.length || entry.body.length > MEMORY_MAX_ITEM_BYTES) return;
    memoryCache.set(key, {
        contentType: entry.contentType,
        body: entry.body,
        createdAt: Number(createdAt) || Date.now(),
    });
};

export const getCachedMediaImage = async (key, {
    cacheDir = MEDIA_IMAGE_CACHE_DIR,
    now = Date.now(),
    ttlMs = MEDIA_IMAGE_CACHE_TTL_MS,
} = {}) => {
    const mem = memoryCache.get(key);
    if (mem?.body?.length) {
        if (now - Number(mem.createdAt || 0) > ttlMs) memoryCache.delete(key);
        else return { contentType: mem.contentType, body: mem.body };
    }

    try {
        const [body, metaRaw] = await Promise.all([
            fs.readFile(binPathFor(cacheDir, key)),
            fs.readFile(metaPathFor(cacheDir, key), 'utf8'),
        ]);
        const meta = JSON.parse(metaRaw);
        const createdAt = Number(meta?.createdAt);
        if (!body?.length || !createdAt) return null;
        if (now - createdAt > ttlMs) return null;
        const entry = {
            contentType: String(meta.contentType || 'image/jpeg'),
            body,
        };
        putMemory(key, entry, createdAt);
        fs.utimes(binPathFor(cacheDir, key), new Date(now), new Date(now)).catch(() => {});
        return entry;
    } catch {
        return null;
    }
};

const unlinkQuiet = async (filePath) => {
    try {
        await fs.unlink(filePath);
    } catch {
        // already gone
    }
};

export const putCachedMediaImage = async (key, { contentType, body } = {}, {
    cacheDir = MEDIA_IMAGE_CACHE_DIR,
    now = Date.now(),
    maxItemBytes = MEDIA_IMAGE_CACHE_MAX_ITEM_BYTES,
} = {}) => {
    if (!key || !body?.length || body.length > maxItemBytes) return false;
    const type = String(contentType || 'image/jpeg');
    if (!type.startsWith('image/') && !type.startsWith('application/octet-stream')) return false;

    await fs.mkdir(cacheDir, { recursive: true });
    const binPath = binPathFor(cacheDir, key);
    const tmpPath = `${binPath}.${process.pid}.tmp`;
    await fs.writeFile(tmpPath, body);
    await fs.writeFile(metaPathFor(cacheDir, key), JSON.stringify({
        contentType: type,
        createdAt: now,
        bytes: body.length,
    }));
    await unlinkQuiet(binPath);
    await fs.rename(tmpPath, binPath);
    putMemory(key, { contentType: type, body }, now);

    writesSincePrune += 1;
    if (writesSincePrune >= PRUNE_EVERY_WRITES) {
        writesSincePrune = 0;
        schedulePrune(cacheDir);
    }
    return true;
};

export const pruneMediaImageCache = async ({
    cacheDir = MEDIA_IMAGE_CACHE_DIR,
    now = Date.now(),
    ttlMs = MEDIA_IMAGE_CACHE_TTL_MS,
    maxFiles = MEDIA_IMAGE_CACHE_MAX_FILES,
    maxBytes = MEDIA_IMAGE_CACHE_MAX_BYTES,
} = {}) => {
    let entries = [];
    try {
        const names = await fs.readdir(cacheDir);
        entries = names.filter((name) => name.endsWith('.bin'));
    } catch {
        return { removed: 0 };
    }

    const files = [];
    for (const name of entries) {
        const key = name.slice(0, -4);
        const binPath = path.join(cacheDir, name);
        const metaPath = metaPathFor(cacheDir, key);
        try {
            const [stat, metaRaw] = await Promise.all([
                fs.stat(binPath),
                fs.readFile(metaPath, 'utf8').catch(() => '{}'),
            ]);
            const meta = JSON.parse(metaRaw);
            const createdAt = Number(meta?.createdAt) || stat.mtimeMs;
            files.push({
                key,
                binPath,
                metaPath,
                bytes: Number(stat.size) || 0,
                mtimeMs: Number(stat.mtimeMs) || createdAt,
                createdAt,
            });
        } catch {
            await unlinkQuiet(binPath);
            await unlinkQuiet(metaPath);
        }
    }

    let removed = 0;
    const keep = [];
    for (const file of files) {
        if (now - file.createdAt > ttlMs) {
            await unlinkQuiet(file.binPath);
            await unlinkQuiet(file.metaPath);
            memoryCache.delete(file.key);
            removed += 1;
            continue;
        }
        keep.push(file);
    }

    keep.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let totalBytes = keep.reduce((sum, file) => sum + file.bytes, 0);
    while (keep.length > maxFiles || totalBytes > maxBytes) {
        const oldest = keep.shift();
        if (!oldest) break;
        await unlinkQuiet(oldest.binPath);
        await unlinkQuiet(oldest.metaPath);
        memoryCache.delete(oldest.key);
        totalBytes -= oldest.bytes;
        removed += 1;
    }
    return { removed };
};

const schedulePrune = (cacheDir) => {
    if (pruneScheduled) return;
    pruneScheduled = true;
    setImmediate(() => {
        pruneMediaImageCache({ cacheDir })
            .catch(() => {})
            .finally(() => {
                pruneScheduled = false;
            });
    });
};

export const withMediaImageInflight = (key, fn) => {
    if (inflight.has(key)) return inflight.get(key);
    const pending = Promise.resolve()
        .then(fn)
        .finally(() => {
            inflight.delete(key);
        });
    inflight.set(key, pending);
    return pending;
};

const pumpMediaImageUpstream = (max = MEDIA_IMAGE_UPSTREAM_CONCURRENCY) => {
    while (upstreamActive < max) {
        const next = liveWaiters.shift() || warmWaiters.shift();
        if (!next) return;
        next();
    }
};

export const withMediaImageUpstreamSlot = (fn, {
    max = MEDIA_IMAGE_UPSTREAM_CONCURRENCY,
    priority = 'live',
} = {}) => (
    new Promise((resolve, reject) => {
        const run = () => {
            upstreamActive += 1;
            Promise.resolve()
                .then(fn)
                .then(resolve, reject)
                .finally(() => {
                    upstreamActive -= 1;
                    pumpMediaImageUpstream(max);
                });
        };
        if (priority === 'low') warmWaiters.push(run);
        else liveWaiters.push(run);
        pumpMediaImageUpstream(max);
    })
);

export const getOrFetchMediaImage = async (key, fetchBuffer, {
    cacheDir = MEDIA_IMAGE_CACHE_DIR,
    priority = 'live',
} = {}) => {
    // Register before the first await so a page build can start the transcode
    // and the TV's follow-up request joins that same fetch.
    const existing = inflight.get(key);
    if (existing) return existing;
    return withMediaImageInflight(key, async () => {
        const cached = await getCachedMediaImage(key, { cacheDir });
        if (cached) return { ...cached, cacheStatus: 'hit' };
        return withMediaImageUpstreamSlot(async () => {
            const fetched = await fetchBuffer();
            if (!fetched?.body?.length) return null;
            await putCachedMediaImage(key, fetched, { cacheDir });
            return { contentType: fetched.contentType, body: fetched.body, cacheStatus: 'miss' };
        }, { priority });
    });
};

export const runWithConcurrency = async (items, limit, worker) => {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return;
    const n = Math.max(1, Number(limit) || 1);
    let index = 0;
    const runners = Array.from({ length: Math.min(n, list.length) }, async () => {
        while (index < list.length) {
            const current = list[index];
            index += 1;
            await worker(current);
        }
    });
    await Promise.all(runners);
};

export const warmMediaImageJobs = async (jobs, fetchForJob, {
    cacheDir = MEDIA_IMAGE_CACHE_DIR,
    concurrency = 2,
} = {}) => {
    await runWithConcurrency(jobs || [], concurrency, async (job) => {
        const key = mediaImageCacheKey(job);
        if (await getCachedMediaImage(key, { cacheDir })) return;
        await getOrFetchMediaImage(key, () => fetchForJob(job), { cacheDir, priority: 'low' }).catch(() => null);
    });
};

export const scheduleDashboardImageWarm = (jobs, fetchForJob, options = {}) => {
    if (warming || !Array.isArray(jobs) || !jobs.length) return false;
    warming = true;
    setImmediate(() => {
        warmMediaImageJobs(jobs, fetchForJob, options)
            .catch(() => {})
            .finally(() => {
                warming = false;
            });
    });
    return true;
};

export const resetMediaImageCacheStateForTests = () => {
    memoryCache.clear();
    inflight.clear();
    liveWaiters.length = 0;
    warmWaiters.length = 0;
    upstreamActive = 0;
    writesSincePrune = 0;
    warming = false;
    pruneScheduled = false;
};
