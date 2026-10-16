/**
 * JSON RequestStore under config/requests/ (Phase 5).
 * Interface stays stable for a later SQLite backend.
 */

import fs from 'fs/promises';
import path from 'path';

const INDEX_FILE = 'index.json';

const defaultIndex = () => ({
    version: 1,
    nextId: 1,
    ids: [],
});

/**
 * @param {object} [options]
 * @param {string} options.dataDir Absolute path to config/requests
 */
export const createJsonRequestStore = (options = {}) => {
    const dataDir = String(options.dataDir || '').trim();
    if (!dataDir) {
        throw new Error('[portal-request/requestStore] dataDir is required');
    }

    let chain = Promise.resolve();
    const withLock = (fn) => {
        const run = chain.then(fn, fn);
        chain = run.catch(() => {});
        return run;
    };

    const indexPath = () => path.join(dataDir, INDEX_FILE);
    const recordPath = (id) => path.join(dataDir, `${id}.json`);

    const ensureDir = async () => {
        await fs.mkdir(dataDir, { recursive: true });
    };

    const readJson = async (filePath, fallback) => {
        try {
            const raw = await fs.readFile(filePath, 'utf8');
            return JSON.parse(raw);
        } catch (error) {
            if (error?.code === 'ENOENT') return fallback;
            throw error;
        }
    };

    const writeJsonAtomic = async (filePath, value) => {
        await ensureDir();
        const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        const payload = `${JSON.stringify(value, null, 2)}\n`;
        await fs.writeFile(tmp, payload, 'utf8');
        await fs.rename(tmp, filePath);
    };

    const loadIndex = async () => {
        await ensureDir();
        const index = await readJson(indexPath(), defaultIndex());
        if (!index || typeof index !== 'object') return defaultIndex();
        return {
            version: Number(index.version) || 1,
            nextId: Math.max(1, Number(index.nextId) || 1),
            ids: Array.isArray(index.ids) ? index.ids.map(String) : [],
        };
    };

    const saveIndex = async (index) => writeJsonAtomic(indexPath(), index);

    const readRecord = async (id) => {
        const record = await readJson(recordPath(id), null);
        return record && typeof record === 'object' ? record : null;
    };

    let listCache = { at: 0, all: null };
    const LIST_CACHE_MS = 2500;
    const invalidateListCache = () => {
        listCache = { at: 0, all: null };
    };

    const readAllRecords = async () => {
        const now = Date.now();
        if (listCache.all && now - listCache.at < LIST_CACHE_MS) {
            return listCache.all;
        }
        const index = await loadIndex();
        const loaded = await Promise.all(index.ids.map((id) => readRecord(id)));
        const all = loaded.filter(Boolean);
        all.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        listCache = { at: now, all };
        return all;
    };

    const list = async (opts = {}) => withLock(async () => {
        const all = await readAllRecords();
        if (
            opts.userId == null
            && opts.status == null
            && !opts.mediaType
            && opts.tmdbId == null
            && !Array.isArray(opts.userIds)
        ) {
            return all.slice();
        }

        const userIds = Array.isArray(opts.userIds)
            ? new Set(opts.userIds.map((id) => String(id)))
            : null;
        const userId = opts.userId != null ? String(opts.userId) : null;

        return all.filter((record) => {
            if (userIds) {
                if (!userIds.has(String(record.userId))) return false;
            } else if (userId != null && String(record.userId) !== userId) {
                return false;
            }
            if (opts.status != null && Number(record.status) !== Number(opts.status)) return false;
            if (opts.mediaType && String(record.mediaType) !== String(opts.mediaType)) return false;
            if (opts.tmdbId != null && Number(record.tmdbId) !== Number(opts.tmdbId)) return false;
            if (opts.mbid != null && String(record.mbid || '') !== String(opts.mbid)) return false;
            return true;
        });
    });

    const get = async (id) => withLock(async () => {
        const key = String(id || '').trim();
        if (!key) return null;
        return readRecord(key);
    });

    const create = async (partial = {}) => withLock(async () => {
        const index = await loadIndex();
        const id = String(index.nextId);
        const now = new Date().toISOString();
        const record = {
            id,
            userId: String(partial.userId || ''),
            mediaType: partial.mediaType === 'tv'
                ? 'tv'
                : (partial.mediaType === 'music' ? 'music' : 'movie'),
            tmdbId: Number(partial.tmdbId) || 0,
            mbid: partial.mbid != null ? String(partial.mbid).trim() : null,
            albumMbid: partial.albumMbid != null ? (String(partial.albumMbid).trim() || null) : null,
            albumTitle: partial.albumTitle != null ? (String(partial.albumTitle).trim() || null) : null,
            title: String(partial.title || 'Unknown title'),
            year: partial.year != null ? String(partial.year).slice(0, 4) : null,
            overview: String(partial.overview || ''),
            posterPath: partial.posterPath || null,
            backdropPath: partial.backdropPath || null,
            is4k: !!partial.is4k,
            seasons: Array.isArray(partial.seasons)
                ? partial.seasons.map((n) => Number(n)).filter((n) => Number.isFinite(n))
                : (partial.seasons === 'all' ? 'all' : []),
            rootFolder: partial.rootFolder != null ? String(partial.rootFolder) : null,
            qualityProfile: partial.qualityProfile != null ? Number(partial.qualityProfile) : null,
            profileId: partial.profileId != null ? Number(partial.profileId) : (
                partial.qualityProfile != null ? Number(partial.qualityProfile) : null
            ),
            serverId: partial.serverId != null ? Number(partial.serverId) : null,
            arrInstanceId: partial.arrInstanceId != null ? String(partial.arrInstanceId) : null,
            languageProfileId: partial.languageProfileId != null ? Number(partial.languageProfileId) : null,
            tags: Array.isArray(partial.tags)
                ? partial.tags.map((t) => Number(t)).filter((n) => Number.isFinite(n))
                : [],
            status: Number.isFinite(Number(partial.status)) ? Number(partial.status) : 1,
            createdAt: (() => {
                const raw = partial.createdAt;
                if (raw && !Number.isNaN(Date.parse(String(raw)))) return new Date(raw).toISOString();
                return now;
            })(),
            updatedAt: (() => {
                const raw = partial.updatedAt;
                if (raw && !Number.isNaN(Date.parse(String(raw)))) return new Date(raw).toISOString();
                return now;
            })(),
            meta: partial.meta && typeof partial.meta === 'object' ? partial.meta : {},
        };

        if (!record.userId) {
            const err = new Error('userId is required');
            err.status = 400;
            throw err;
        }
        if (record.mediaType === 'music') {
            if (!record.mbid) {
                const err = new Error('mbid is required for music requests');
                err.status = 400;
                throw err;
            }
        } else if (!Number.isFinite(record.tmdbId) || record.tmdbId <= 0) {
            const err = new Error('tmdbId is required');
            err.status = 400;
            throw err;
        }

        await writeJsonAtomic(recordPath(id), record);
        index.ids.push(id);
        index.nextId = Number(id) + 1;
        await saveIndex(index);
        invalidateListCache();
        return record;
    });

    const update = async (id, patch = {}) => withLock(async () => {
        const key = String(id || '').trim();
        const existing = await readRecord(key);
        if (!existing) return null;
        const resolvedPatch = typeof patch === 'function' ? patch(existing) : patch;
        if (resolvedPatch == null) return existing;
        const next = {
            ...existing,
            ...resolvedPatch,
            id: existing.id,
            userId: resolvedPatch.userId != null && String(resolvedPatch.userId).trim()
                ? String(resolvedPatch.userId)
                : existing.userId,
            updatedAt: new Date().toISOString(),
        };
        await writeJsonAtomic(recordPath(key), next);
        invalidateListCache();
        return next;
    });

    /**
     * Atomic compare-and-set: apply patch only when predicate(existing) is true.
     * Returns { ok: true, record } on write, { ok: false, record } when skipped, null if missing.
     */
    const updateIf = async (id, predicate, patch = {}) => withLock(async () => {
        const key = String(id || '').trim();
        const existing = await readRecord(key);
        if (!existing) return null;
        if (typeof predicate === 'function' && !predicate(existing)) {
            return { ok: false, record: existing };
        }
        const resolvedPatch = typeof patch === 'function' ? patch(existing) : patch;
        if (resolvedPatch == null) return { ok: false, record: existing };
        const next = {
            ...existing,
            ...resolvedPatch,
            id: existing.id,
            userId: resolvedPatch.userId != null && String(resolvedPatch.userId).trim()
                ? String(resolvedPatch.userId)
                : existing.userId,
            updatedAt: new Date().toISOString(),
        };
        await writeJsonAtomic(recordPath(key), next);
        invalidateListCache();
        return { ok: true, record: next };
    });

    const remove = async (id) => withLock(async () => {
        const key = String(id || '').trim();
        const index = await loadIndex();
        if (!index.ids.includes(key)) return false;
        try {
            await fs.unlink(recordPath(key));
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
        }
        index.ids = index.ids.filter((entry) => entry !== key);
        await saveIndex(index);
        invalidateListCache();
        return true;
    });

    return {
        list,
        get,
        create,
        update,
        updateIf,
        remove,
        dataDir,
        invalidateListCache,
    };
};

/** @deprecated Alias — default store is JSON until a SqliteRequestStore exists. */
export const createRequestStore = createJsonRequestStore;

export default createJsonRequestStore;
