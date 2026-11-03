/**
 * Durable Poster Sets watch list (AURA-simple).
 * Tracks set URLs + known asset fingerprints for periodic re-apply of new art.
 */
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { ensurePosterSetsDir, POSTER_SETS_DIR, DEFAULT_POSTER_SETS_CONFIG, readPosterSetsJson } from './config.js';
import {
    findOverlappingTitleWatches,
    filtersWithoutSlots,
    setKindFromFilters,
    watchArtSlots,
} from './watchTitle.js';

export const POSTER_SETS_WATCHES_PATH = path.join(POSTER_SETS_DIR, 'watches.json');

/** Hard ceiling so watches.json and Check-all passes stay bounded. 200 was far too low for a full library. */
export const MAX_WATCHES = 2000;
const ALLOWED_FILTERS = new Set(['title_card', 'background', 'season_cover', 'show_cover']);

const emptyState = () => ({ version: 1, watches: [] });

const asFilterList = (value) => {
    const list = Array.isArray(value)
        ? value.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
    const filtered = list.filter((item) => ALLOWED_FILTERS.has(item));
    return filtered.length ? filtered : [...DEFAULT_POSTER_SETS_CONFIG.mediux_filters];
};

const detectProvider = (url) => {
    try {
        const raw = String(url || '').trim();
        const host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase();
        if (host === 'mediux.pro' || host.endsWith('.mediux.pro')) return 'mediux';
        if (host === 'theposterdb.com' || host.endsWith('.theposterdb.com')) return 'posterdb';
    } catch {
        // fall through
    }
    return 'mediux';
};

const parseSetId = (url) => {
    const raw = String(url || '');
    const mediux = raw.match(/\/sets\/(\d+)/i);
    if (mediux) return mediux[1];
    const tpdb = raw.match(/\/set\/(\d+)/i);
    if (tpdb) return tpdb[1];
    return null;
};

const asExternalId = (value) => {
    if (value == null || value === false) return null;
    const text = String(value).trim();
    if (!text || text === '0' || text.toLowerCase() === 'null' || text.toLowerCase() === 'none') return null;
    return text;
};

const sanitizeLibraryHints = (value) => {
    if (!Array.isArray(value)) return [];
    const out = [];
    const seen = new Set();
    for (const row of value.slice(0, 80)) {
        const title = String(row?.title || '').trim() || null;
        const ratingKey = String(row?.ratingKey || row?.rating_key || '').trim() || null;
        const tmdbId = asExternalId(row?.tmdbId ?? row?.tmdb_id);
        const mediaType = String(row?.mediaType || '').trim().toLowerCase();
        if (!title && !ratingKey && !tmdbId) continue;
        const key = `${ratingKey || ''}|${tmdbId || ''}|${(title || '').toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
            ratingKey,
            title,
            tmdbId,
            mediaType: mediaType === 'movie' || mediaType === 'show' ? mediaType : null,
        });
    }
    return out;
};

export const mergeLibraryHints = (current, extra) => sanitizeLibraryHints([
    ...(Array.isArray(current) ? current : []),
    ...(Array.isArray(extra) ? extra : []),
]);

export const serializeWatch = (watch) => ({
    id: String(watch.id),
    enabled: watch.enabled !== false,
    provider: watch.provider === 'posterdb' ? 'posterdb' : 'mediux',
    url: String(watch.url || '').trim(),
    setId: watch.setId != null ? String(watch.setId) : null,
    title: String(watch.title || '').trim() || null,
    user: String(watch.user || '').trim().replace(/^@/, '') || null,
    tmdbId: asExternalId(watch.tmdbId ?? watch.tmdb_id),
    tvdbId: asExternalId(watch.tvdbId ?? watch.tvdb_id),
    thumbUrl: String(watch.thumbUrl || ''),
    setKind: String(watch.setKind || '').trim() || null,
    mediuxFilters: asFilterList(watch.mediuxFilters),
    knownAssetIds: Array.isArray(watch.knownAssetIds)
        ? [...new Set(watch.knownAssetIds.map((id) => String(id || '').trim()).filter(Boolean))]
        : [],
    // Successfully uploaded to the media server — distinct from "seen on the set".
    appliedAssetIds: Array.isArray(watch.appliedAssetIds)
        ? [...new Set(watch.appliedAssetIds.map((id) => String(id || '').trim()).filter(Boolean))]
        : [],
    // Library-matched asset IDs as of the last watch check (season-later detection).
    lastMatchedAssetIds: Array.isArray(watch.lastMatchedAssetIds)
        ? [...new Set(watch.lastMatchedAssetIds.map((id) => String(id || '').trim()).filter(Boolean))]
        : [],
    // 3+ = lastMatched-based season-later tracking (no mass re-queue heals).
    assetTrackingVersion: Number.isFinite(Number(watch.assetTrackingVersion))
        ? Number(watch.assetTrackingVersion)
        : 1,
    lastCheckedAt: watch.lastCheckedAt || null,
    lastAppliedAt: watch.lastAppliedAt || null,
    lastError: watch.lastError || null,
    lastNewCount: Number.isFinite(Number(watch.lastNewCount)) ? Number(watch.lastNewCount) : 0,
    plexHint: watch.plexHint && typeof watch.plexHint === 'object' ? watch.plexHint : null,
    libraryHints: sanitizeLibraryHints(watch.libraryHints),
    createdAt: watch.createdAt || null,
    updatedAt: watch.updatedAt || null,
});

let writeChain = Promise.resolve();
const withWatchLock = (fn) => {
    const run = writeChain.then(fn, fn);
    writeChain = run.catch(() => undefined);
    return run;
};

export const loadPosterSetsWatches = async () => {
    await ensurePosterSetsDir();
    const parsed = await readPosterSetsJson(POSTER_SETS_WATCHES_PATH, 'watches');
    if (!parsed) return emptyState();
    const watches = Array.isArray(parsed?.watches)
        ? parsed.watches.map(serializeWatch).filter((w) => w.id && w.url)
        : [];
    return { version: 1, watches: watches.slice(0, MAX_WATCHES) };
};

export const savePosterSetsWatches = async (state) => {
    await ensurePosterSetsDir();
    const next = {
        version: 1,
        watches: (Array.isArray(state?.watches) ? state.watches : [])
            .map(serializeWatch)
            .filter((w) => w.id && w.url)
            .slice(0, MAX_WATCHES),
    };
    const body = `${JSON.stringify(next)}\n`;
    const tmp = `${POSTER_SETS_WATCHES_PATH}.${process.pid}.tmp`;
    await fs.writeFile(tmp, body, 'utf8');
    try {
        await fs.rename(tmp, POSTER_SETS_WATCHES_PATH);
    } catch {
        await fs.writeFile(POSTER_SETS_WATCHES_PATH, body, 'utf8');
        await fs.unlink(tmp).catch(() => {});
    }
    return next;
};

export const updatePosterSetsWatches = async (mutator) => withWatchLock(async () => {
    const current = await loadPosterSetsWatches();
    const next = await mutator({ ...current, watches: [...current.watches] }) || current;
    return savePosterSetsWatches(next);
});

export const listPosterSetsWatches = async () => (await loadPosterSetsWatches()).watches;

export const getPosterSetsWatch = async (id) => {
    const watches = await listPosterSetsWatches();
    return watches.find((watch) => watch.id === String(id)) || null;
};

export const upsertPosterSetsWatch = async (input = {}) => {
    const url = String(input.url || '').trim();
    if (!url) {
        const error = new Error('url is required');
        error.status = 400;
        throw error;
    }
    const now = new Date().toISOString();
    let saved = null;
    await updatePosterSetsWatches((state) => {
        const existing = state.watches.find((watch) => (
            watch.url === url || (input.id && watch.id === String(input.id))
        ));
        if (existing) {
            saved = serializeWatch({
                ...existing,
                ...input,
                id: existing.id,
                url,
                provider: input.provider || existing.provider || detectProvider(url),
                setId: input.setId ?? existing.setId ?? parseSetId(url),
                mediuxFilters: input.mediuxFilters !== undefined
                    ? asFilterList(input.mediuxFilters)
                    : existing.mediuxFilters,
                knownAssetIds: input.knownAssetIds !== undefined
                    ? input.knownAssetIds
                    : existing.knownAssetIds,
                appliedAssetIds: input.appliedAssetIds !== undefined
                    ? input.appliedAssetIds
                    : existing.appliedAssetIds,
                lastMatchedAssetIds: input.lastMatchedAssetIds !== undefined
                    ? input.lastMatchedAssetIds
                    : existing.lastMatchedAssetIds,
                libraryHints: mergeLibraryHints(existing.libraryHints, input.libraryHints),
                assetTrackingVersion: input.assetTrackingVersion !== undefined
                    ? input.assetTrackingVersion
                    : existing.assetTrackingVersion,
                updatedAt: now,
                createdAt: existing.createdAt || now,
            });
            state.watches = state.watches.map((watch) => (watch.id === existing.id ? saved : watch));
            return state;
        }
        if (state.watches.length >= MAX_WATCHES) {
            const error = new Error(`Watching is capped at ${MAX_WATCHES} sets. Remove some before pinning more.`);
            error.status = 400;
            throw error;
        }
        saved = serializeWatch({
            id: crypto.randomUUID(),
            enabled: input.enabled !== false,
            provider: input.provider || detectProvider(url),
            url,
            setId: input.setId ?? parseSetId(url),
            title: input.title || null,
            user: input.user || null,
            tmdbId: input.tmdbId ?? input.tmdb_id ?? null,
            tvdbId: input.tvdbId ?? input.tvdb_id ?? null,
            thumbUrl: input.thumbUrl || '',
            setKind: input.setKind || null,
            mediuxFilters: input.mediuxFilters,
            knownAssetIds: input.knownAssetIds || [],
            appliedAssetIds: input.appliedAssetIds || [],
            lastMatchedAssetIds: input.lastMatchedAssetIds || [],
            assetTrackingVersion: input.assetTrackingVersion ?? 3,
            lastCheckedAt: null,
            lastAppliedAt: null,
            lastError: null,
            lastNewCount: 0,
            plexHint: input.plexHint || null,
            libraryHints: input.libraryHints || [],
            createdAt: now,
            updatedAt: now,
        });
        state.watches = [saved, ...state.watches];
        return state;
    });
    return saved;
};

export const patchPosterSetsWatch = async (id, patch = {}) => {
    let updated = null;
    await updatePosterSetsWatches((state) => {
        state.watches = state.watches.map((watch) => {
            if (watch.id !== String(id)) return watch;
            updated = serializeWatch({
                ...watch,
                ...patch,
                id: watch.id,
                updatedAt: new Date().toISOString(),
            });
            return updated;
        });
        return state;
    });
    return updated;
};

export const deletePosterSetsWatch = async (id) => {
    let removed = null;
    await updatePosterSetsWatches((state) => {
        const next = [];
        for (const watch of state.watches) {
            if (watch.id === String(id)) removed = watch;
            else next.push(watch);
        }
        state.watches = next;
        return state;
    });
    return removed;
};

/** Claim overlapping art-type slots on the same show/movie, keeping `keepWatch`.
 *  Complementary pins (title cards vs posters) stay; only the colliding slot is replaced. */
export const replaceSameTitleWatches = async (keepWatch) => {
    if (!keepWatch) return [];
    const all = await listPosterSetsWatches();
    const claimed = watchArtSlots(keepWatch);
    const conflicts = findOverlappingTitleWatches(all, keepWatch);
    const removed = [];
    for (const conflict of conflicts) {
        const remaining = filtersWithoutSlots(conflict.mediuxFilters, claimed);
        if (!remaining.length) {
            const deleted = await deletePosterSetsWatch(conflict.id);
            if (deleted) removed.push(deleted);
            continue;
        }
        await patchPosterSetsWatch(conflict.id, {
            mediuxFilters: remaining,
            setKind: setKindFromFilters(remaining),
        });
    }
    return removed;
};

export const clearPosterSetsWatchErrors = async () => {
    let cleared = 0;
    const state = await updatePosterSetsWatches((current) => {
        current.watches = current.watches.map((watch) => {
            if (!watch.lastError) return watch;
            cleared += 1;
            return serializeWatch({
                ...watch,
                lastError: null,
                updatedAt: new Date().toISOString(),
            });
        });
        return current;
    });
    return { cleared, watches: state.watches };
};

/** Lean watch payload for list/delete APIs — skip fingerprint arrays that can be tens of thousands of ids. */
export const summarizeWatchForApi = (watch) => {
    if (!watch) return null;
    const knownCount = Array.isArray(watch.knownAssetIds) ? watch.knownAssetIds.length : 0;
    return {
        id: watch.id,
        enabled: watch.enabled !== false,
        provider: watch.provider,
        url: watch.url,
        setId: watch.setId ?? null,
        title: watch.title,
        user: watch.user,
        tmdbId: watch.tmdbId ?? null,
        tvdbId: watch.tvdbId ?? null,
        thumbUrl: watch.thumbUrl,
        setKind: watch.setKind,
        mediuxFilters: watch.mediuxFilters,
        knownAssetCount: knownCount,
        lastCheckedAt: watch.lastCheckedAt,
        lastAppliedAt: watch.lastAppliedAt,
        lastError: watch.lastError,
        lastNewCount: watch.lastNewCount,
        plexHint: watch.plexHint,
        createdAt: watch.createdAt,
        updatedAt: watch.updatedAt,
    };
};

const isLibraryPendingWatchError = (message) => {
    const text = String(message || '').toLowerCase();
    return text.includes('waiting for title in library')
        || text.includes('will auto-apply when');
};

export const watchStats = (watches = []) => {
    const list = Array.isArray(watches) ? watches : [];
    return {
        total: list.length,
        enabled: list.filter((w) => w.enabled).length,
        errored: list.filter((w) => w.lastError && !isLibraryPendingWatchError(w.lastError)).length,
        max: MAX_WATCHES,
    };
};
