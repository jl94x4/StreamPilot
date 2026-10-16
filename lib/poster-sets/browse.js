/**
 * Poster Sets Browse rails: bootstrap first page, then fill up to CAP in the background.
 * In-memory + disk cache so revisiting Browse is instant; only Refresh wipes.
 * Soft revisits merge newest cards on top without discarding what you already loaded.
 */
import fs from 'fs/promises';
import path from 'path';
import { runPosterSetsCli } from './runner.js';
import { loadPosterSetsConfig, POSTER_SETS_DIR, enabledPosterSetsProviders, isPosterSetsTpdbSearchEnabled, isPosterSetsMediuxEnabled } from './config.js';
import { excludeBlockedCreators, excludeBlockedHandles } from './searchMerge.js';

export const BROWSE_RAIL_CAP = 600;
export const BROWSE_PAGE_SIZE = 24;
/** Serve cached rails for a long time; soft-revalidate in the background. */
const BROWSE_CACHE_TTL_MS = 24 * 60 * 60_000;
/** How often a soft revisit may fetch newest pages and merge (without wiping). */
const BROWSE_REVALIDATE_MS = 5 * 60_000;
const FOLLOWING_PER_CREATOR_LIMIT = 36;
const FOLLOWING_CREATOR_CONCURRENCY = 2;
const DISK_CACHE_PATH = path.join(POSTER_SETS_DIR, 'browse-cache.json');

/** @typedef {'posterdb_recent' | 'mediux_recent' | 'mediux_title_cards' | 'following'} BrowseRailId */

const RAIL_DEFS = [
    {
        id: 'posterdb_recent',
        title: 'ThePosterDB · Recently added',
        provider: 'posterdb',
        kind: 'posters',
    },
    {
        id: 'mediux_recent',
        title: 'MediUX · Recently added',
        provider: 'mediux',
        kind: 'posters',
    },
    {
        id: 'mediux_title_cards',
        title: 'MediUX · Title cards',
        provider: 'mediux',
        kind: 'title_cards',
    },
];

const FOLLOWING_DEF = {
    id: 'following',
    title: 'Creators you follow',
    provider: 'both',
    kind: 'following',
};

/** @type {Map<string, object>} */
const railState = new Map();
let diskHydrated = false;
/** @type {Promise<void> | null} */
let diskHydratePromise = null;
let diskSaveTimer = null;

const now = () => Date.now();

const emptyRail = (def) => ({
    id: def.id,
    title: def.title,
    provider: def.provider,
    kind: def.kind,
    sets: [],
    byId: new Map(),
    buffered: 0,
    loadingProgress: 0,
    cap: BROWSE_RAIL_CAP,
    loading: false,
    error: null,
    nextPage: 1,
    hasMore: true,
    updatedAt: 0,
    lastRevalidatedAt: 0,
    generation: 0,
    fillPromise: null,
    usernames: [],
    /** @type {string[] | null} Frozen first-page keys so progressive fills do not reshuffle. */
    frozenHeadKeys: null,
});

const getOrCreate = (def) => {
    let state = railState.get(def.id);
    if (!state) {
        state = emptyRail(def);
        railState.set(def.id, state);
    }
    return state;
};

const whitelistKey = (usernames = []) => [...usernames]
    .map((item) => String(item || '').trim().replace(/^@+/, '').toLowerCase())
    .filter(Boolean)
    .sort()
    .join('|');

/** Newer MediUX / TPDB set ids are higher — use as latest-first proxy (no date on cards). */
const sortSetsLatestFirst = (sets) => {
    const list = Array.isArray(sets) ? sets : [];
    list.sort((a, b) => {
        const aId = Number(a?.setId);
        const bId = Number(b?.setId);
        if (Number.isFinite(aId) && Number.isFinite(bId) && aId !== bId) return bId - aId;
        return String(b?.setId || '').localeCompare(String(a?.setId || ''), undefined, { numeric: true });
    });
    return list;
};

const serializeRail = (state) => ({
    id: state.id,
    title: state.title,
    provider: state.provider,
    kind: state.kind,
    sets: state.sets,
    buffered: Math.max(state.sets.length, Number(state.loadingProgress) || 0),
    cap: state.cap,
    loading: Boolean(state.loading),
    hasMore: Boolean(state.hasMore),
    error: state.error || null,
});

const setKey = (raw, fallbackProvider) => {
    const setId = String(raw?.setId || '').trim();
    if (!setId) return '';
    const provider = String(raw?.provider || fallbackProvider || 'unknown').toLowerCase();
    return `${provider}:${setId}`;
};

/**
 * @param {object} state
 * @param {Array} incoming
 * @param {{ sort?: boolean, prependNew?: boolean }} [options]
 *   sort=true (default for non-following): resort whole list after merge
 *   prependNew=true: only newly seen sets go to the front (keeps existing order stable)
 */
const mergeSets = (state, incoming = [], options = {}) => {
    const prependNew = options.prependNew === true;
    const shouldSort = options.sort === true
        || (options.sort !== false && state.kind !== 'following' && !prependNew);
    let added = 0;
    /** @type {object[]} */
    const fresh = [];
    for (const raw of Array.isArray(incoming) ? incoming : []) {
        if (!raw?.setId || !raw?.url) continue;
        if (state.sets.length + fresh.length >= state.cap) break;
        const key = setKey(raw, state.provider);
        if (!key) continue;
        if (state.byId.has(key)) {
            const existing = state.byId.get(key);
            if (!existing.user && raw.user) existing.user = raw.user;
            if ((!existing.title || String(existing.title).startsWith('Set ')) && raw.title) {
                existing.title = raw.title;
            }
            if (!existing.thumbUrl && raw.thumbUrl) existing.thumbUrl = raw.thumbUrl;
            if (!existing.setKind && raw.setKind) existing.setKind = raw.setKind;
            continue;
        }
        const normalized = {
            setId: String(raw.setId),
            url: String(raw.url),
            title: String(raw.title || `Set ${raw.setId}`),
            user: raw.user || null,
            thumbUrl: raw.thumbUrl || '',
            posterCount: raw.posterCount ?? null,
            provider: raw.provider || state.provider,
            setKind: raw.setKind || (state.kind === 'title_cards' ? 'title_cards' : null),
        };
        state.byId.set(key, normalized);
        if (prependNew) fresh.push(normalized);
        else state.sets.push(normalized);
        added += 1;
    }
    if (prependNew && fresh.length) {
        sortSetsLatestFirst(fresh);
        state.sets = [...fresh, ...state.sets].slice(0, state.cap);
        // Drop overflow from byId when trimmed.
        if (state.sets.length === state.cap) {
            const keep = new Set(state.sets.map((item) => setKey(item, state.provider)));
            for (const key of [...state.byId.keys()]) {
                if (!keep.has(key)) state.byId.delete(key);
            }
        }
    } else if (shouldSort && state.sets.length > 1) {
        sortSetsLatestFirst(state.sets);
    }
    state.buffered = state.sets.length;
    state.updatedAt = now();
    return added;
};

const scheduleDiskCacheSave = ({ immediate = false } = {}) => {
    const write = async () => {
        diskSaveTimer = null;
        try {
            await fs.mkdir(POSTER_SETS_DIR, { recursive: true });
            const rails = [...railState.values()]
                .filter((state) => state.sets.length > 0)
                .map((state) => ({
                    ...serializeRail(state),
                    // Never persist loading=true — remount should show cards, then soft-fill.
                    loading: false,
                    usernames: state.usernames || [],
                    nextPage: state.nextPage,
                    updatedAt: state.updatedAt,
                    lastRevalidatedAt: state.lastRevalidatedAt || state.updatedAt,
                    hasMore: Boolean(state.hasMore) && state.sets.length < state.cap,
                }));
            await fs.writeFile(
                DISK_CACHE_PATH,
                JSON.stringify({ savedAt: now(), rails }),
                'utf8',
            );
        } catch {
            // disk cache is best-effort
        }
    };
    if (immediate) {
        if (diskSaveTimer) {
            clearTimeout(diskSaveTimer);
            diskSaveTimer = null;
        }
        void write();
        return;
    }
    if (diskSaveTimer) return;
    diskSaveTimer = setTimeout(() => { void write(); }, 1200);
};

const hydrateFromDisk = async () => {
    if (diskHydrated) return;
    if (diskHydratePromise) return diskHydratePromise;
    diskHydratePromise = (async () => {
        try {
            const raw = JSON.parse(await fs.readFile(DISK_CACHE_PATH, 'utf8'));
            if (!raw?.savedAt || (now() - Number(raw.savedAt)) > BROWSE_CACHE_TTL_MS) return;
            for (const rail of Array.isArray(raw.rails) ? raw.rails : []) {
                const def = RAIL_DEFS.find((entry) => entry.id === rail.id)
                    || (rail.id === FOLLOWING_DEF.id ? FOLLOWING_DEF : null);
                if (!def) continue;
                const state = getOrCreate(def);
                if (state.sets.length) continue;
                state.sets = [];
                state.byId = new Map();
                mergeSets(state, rail.sets || [], {
                    sort: state.kind === 'following',
                });
                if (state.kind === 'following' && state.sets.length) {
                    state.frozenHeadKeys = state.sets
                        .slice(0, BROWSE_PAGE_SIZE)
                        .map((item) => setKey(item, item.provider));
                }
                state.loading = false;
                state.error = null;
                state.nextPage = Number(rail.nextPage) || 2;
                state.hasMore = Boolean(rail.hasMore) && state.sets.length < state.cap;
                state.updatedAt = Number(rail.updatedAt) || Number(raw.savedAt) || now();
                state.lastRevalidatedAt = Number(rail.lastRevalidatedAt) || state.updatedAt;
                state.usernames = Array.isArray(rail.usernames) ? rail.usernames.map(String) : [];
            }
        } catch {
            // ignore missing/invalid cache
        } finally {
            diskHydrated = true;
            diskHydratePromise = null;
        }
    })();
    return diskHydratePromise;
};

const fetchRecentPage = async (state, page) => {
    const run = await runPosterSetsCli('search', {
        provider: state.provider,
        mode: 'recent',
        kind: state.kind,
        page,
        limit: BROWSE_PAGE_SIZE,
        streamBatches: false,
    }, { timeoutMs: 120_000 });
    if (!run.ok) {
        throw new Error(run.error || `${state.id} scrape failed`);
    }
    const result = run.result || {};
    const sets = Array.isArray(result.sets) ? result.sets : [];
    return {
        sets,
        hasMore: result.hasMore !== false && (result.nextPage != null || sets.length > 0),
        nextPage: result.nextPage != null ? Number(result.nextPage) : page + 1,
    };
};

const fetchCreatorProviderSets = async (username, provider) => {
    const run = await runPosterSetsCli('search', {
        provider,
        mode: 'creator',
        query: username,
        limit: FOLLOWING_PER_CREATOR_LIMIT,
        streamBatches: false,
        batchPages: 2,
    }, { timeoutMs: 180_000 });
    if (!run.ok) {
        return { sets: [], error: run.error || `${provider} @${username} failed` };
    }
    const sets = Array.isArray(run.result?.sets) ? run.result.sets : [];
    return {
        sets: sets.map((item) => ({
            ...item,
            provider: item.provider || provider,
            user: item.user || username,
        })),
        error: null,
    };
};

const mapPool = async (items, concurrency, worker) => {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return;
    let index = 0;
    const runners = Array.from({ length: Math.min(concurrency, list.length) }, async () => {
        while (index < list.length) {
            const current = index;
            index += 1;
            await worker(list[current], current);
        }
    });
    await Promise.all(runners);
};

const fillPosterdbRecentCatalog = async (state) => {
    if (state.fillPromise) return state.fillPromise;
    const generation = state.generation;
    state.loading = true;
    state.error = null;
    state.fillPromise = (async () => {
        try {
            const run = await runPosterSetsCli('search', {
                provider: 'posterdb',
                mode: 'recent',
                query: 'recent',
                limit: state.cap,
                streamBatches: true,
                batchPages: 2,
                maxPages: Math.max(20, Math.ceil(state.cap / 12)),
            }, {
                timeoutMs: 300_000,
                onBatch: (event) => {
                    if (state.generation !== generation) return;
                    const incoming = Array.isArray(event?.sets) ? event.sets : [];
                    if (!incoming.length) return;
                    mergeSets(state, incoming);
                    scheduleDiskCacheSave();
                },
            });
            if (state.generation !== generation) return;
            if (run.ok) {
                const finalSets = Array.isArray(run.result?.sets) ? run.result.sets : [];
                if (finalSets.length) mergeSets(state, finalSets);
                state.hasMore = state.sets.length < state.cap && Boolean(run.result?.hasMore);
                state.nextPage = Number(run.result?.nextPage) || state.nextPage;
                if (!state.hasMore || state.sets.length >= state.cap) {
                    state.hasMore = false;
                }
            } else {
                throw new Error(run.error || 'ThePosterDB recently added scrape failed');
            }
        } catch (error) {
            if (state.generation === generation) {
                state.error = error instanceof Error ? error.message : String(error || 'Browse scrape failed');
                state.hasMore = false;
            }
        } finally {
            if (state.generation === generation) {
                state.loading = false;
                state.fillPromise = null;
                state.updatedAt = now();
                state.lastRevalidatedAt = now();
                scheduleDiskCacheSave({ immediate: true });
            }
        }
    })();
    return state.fillPromise;
};

const fillRailInBackground = async (state) => {
    if (state.provider === 'posterdb') {
        return fillPosterdbRecentCatalog(state);
    }
    if (state.fillPromise) return state.fillPromise;
    const generation = state.generation;
    state.loading = true;
    state.error = null;
    state.fillPromise = (async () => {
        try {
            while (
                state.generation === generation
                && state.sets.length < state.cap
                && state.hasMore
            ) {
                const page = Math.max(1, Number(state.nextPage) || 1);
                const batch = await fetchRecentPage(state, page);
                if (state.generation !== generation) return;
                const added = mergeSets(state, batch.sets);
                scheduleDiskCacheSave();
                if (!batch.sets.length || (!added && !batch.hasMore)) {
                    state.hasMore = false;
                    break;
                }
                state.nextPage = batch.nextPage || page + 1;
                state.hasMore = Boolean(batch.hasMore) && state.sets.length < state.cap;
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        } catch (error) {
            if (state.generation === generation) {
                state.error = error instanceof Error ? error.message : String(error || 'Browse scrape failed');
                state.hasMore = false;
            }
        } finally {
            if (state.generation === generation) {
                state.loading = false;
                state.fillPromise = null;
                state.updatedAt = now();
                state.lastRevalidatedAt = now();
                scheduleDiskCacheSave({ immediate: true });
            }
        }
    })();
    return state.fillPromise;
};

/** Dedupe + latest-first sort for following scrapes (setId is the recency proxy). */
const normalizeFollowingCollected = (collected = []) => {
    const byId = new Map();
    for (const raw of Array.isArray(collected) ? collected : []) {
        if (!raw?.setId || !raw?.url) continue;
        const key = setKey(raw, raw.provider || 'unknown');
        if (!key || byId.has(key)) continue;
        byId.set(key, {
            setId: String(raw.setId),
            url: String(raw.url),
            title: String(raw.title || `Set ${raw.setId}`),
            user: raw.user || null,
            thumbUrl: raw.thumbUrl || '',
            posterCount: raw.posterCount ?? null,
            provider: raw.provider || 'unknown',
            setKind: raw.setKind || null,
        });
    }
    return sortSetsLatestFirst([...byId.values()]);
};

/**
 * Publish following sets latest-first. Once the first page is shown, freeze those
 * keys so later creator batches only extend the tail (no page-1 reshuffle).
 */
const publishFollowingCollected = (state, collected, { finalize = false, replace = false } = {}) => {
    const sorted = normalizeFollowingCollected(collected).slice(0, state.cap);
    if (replace || !state.frozenHeadKeys?.length) {
        state.sets = [];
        state.byId = new Map();
        mergeSets(state, sorted, { sort: true });
        if (finalize || state.sets.length >= BROWSE_PAGE_SIZE) {
            state.frozenHeadKeys = state.sets
                .slice(0, BROWSE_PAGE_SIZE)
                .map((item) => setKey(item, item.provider));
        }
        return;
    }

    const headKeys = state.frozenHeadKeys.filter(Boolean);
    const headSet = new Set(headKeys);
    const allById = new Map(sorted.map((item) => [setKey(item, item.provider), item]));
    const head = [];
    for (const key of headKeys) {
        const item = allById.get(key) || state.byId.get(key);
        if (item) head.push(item);
    }
    const rest = sorted.filter((item) => !headSet.has(setKey(item, item.provider)));
    state.sets = [...head, ...rest].slice(0, state.cap);
    state.byId = new Map(state.sets.map((item) => [setKey(item, item.provider), item]));
    state.buffered = state.sets.length;
    state.updatedAt = now();
};

/** Fetch only the newest creator pages and merge — never clears existing cards. */
const softRevalidateFollowing = async (state, usernames) => {
    if (state.fillPromise) return state.fillPromise;
    const generation = state.generation;
    state.loading = true;
    state.error = null;
    state.fillPromise = (async () => {
        const errors = [];
        /** @type {object[]} */
        const collected = [];
        try {
            await mapPool(usernames, FOLLOWING_CREATOR_CONCURRENCY, async (username) => {
                if (state.generation !== generation) return;
                const providers = enabledPosterSetsProviders(await loadPosterSetsConfig().catch(() => ({})));
                for (const provider of providers) {
                    if (state.generation !== generation) return;
                    if (collected.length >= state.cap) return;
                    const batch = await fetchCreatorProviderSets(username, provider);
                    if (state.generation !== generation) return;
                    if (batch.error) errors.push(batch.error);
                    for (const item of batch.sets || []) {
                        if (collected.length >= state.cap) break;
                        collected.push(item);
                    }
                    state.loadingProgress = Math.max(state.sets.length, collected.length);
                    scheduleDiskCacheSave();
                }
            });
            if (state.generation === generation) {
                // Only prepend brand-new sets so the already-visible first page stays put
                // aside from truly newer uploads landing at the front.
                mergeSets(state, collected, { prependNew: true, sort: false });
                if (state.sets.length) {
                    state.frozenHeadKeys = state.sets
                        .slice(0, BROWSE_PAGE_SIZE)
                        .map((item) => setKey(item, item.provider));
                }
                state.loadingProgress = 0;
                if (!state.sets.length && errors.length) {
                    state.error = errors[0];
                }
            }
        } catch (error) {
            if (state.generation === generation) {
                state.error = error instanceof Error ? error.message : String(error || 'Following scrape failed');
            }
        } finally {
            if (state.generation === generation) {
                state.loading = false;
                state.loadingProgress = 0;
                state.hasMore = false;
                state.fillPromise = null;
                state.updatedAt = now();
                state.lastRevalidatedAt = now();
                scheduleDiskCacheSave({ immediate: true });
            }
        }
    })();
    return state.fillPromise;
};

const fillFollowingInBackground = async (state, usernames, generation) => {
    if (state.fillPromise) return state.fillPromise;
    state.loading = true;
    state.error = null;
    state.loadingProgress = 0;
    state.frozenHeadKeys = null;
    // Keep showing any existing cache until the final sorted publish (avoids empty flash).
    const hadCacheAtStart = state.sets.length > 0;
    state.fillPromise = (async () => {
        const errors = [];
        /** @type {object[]} */
        const collected = [];
        try {
            // Creator profiles are newest-first; we collect across creators, then publish
            // latest-first. Progressive per-creator merges used to re-sort and reshuffle page 1.
            await mapPool(usernames, FOLLOWING_CREATOR_CONCURRENCY, async (username) => {
                if (state.generation !== generation) return;
                const providers = enabledPosterSetsProviders(await loadPosterSetsConfig().catch(() => ({})));
                for (const provider of providers) {
                    if (state.generation !== generation) return;
                    if (collected.length >= state.cap) return;
                    const batch = await fetchCreatorProviderSets(username, provider);
                    if (state.generation !== generation) return;
                    if (batch.error) errors.push(batch.error);
                    for (const item of batch.sets || []) {
                        if (collected.length >= state.cap) break;
                        collected.push(item);
                    }
                    state.loadingProgress = collected.length;
                    // Cold start: show a stable first page as soon as we have enough cards.
                    if (!hadCacheAtStart && state.generation === generation) {
                        publishFollowingCollected(state, collected, { finalize: false });
                    }
                    scheduleDiskCacheSave();
                }
            });
            if (state.generation === generation) {
                publishFollowingCollected(state, collected, {
                    finalize: true,
                    // Cached refresh: one atomic latest-first replace when the scrape finishes.
                    replace: hadCacheAtStart,
                });
                state.loadingProgress = 0;
                if (!state.sets.length && errors.length) {
                    state.error = errors[0];
                }
            }
        } catch (error) {
            if (state.generation === generation) {
                state.error = error instanceof Error ? error.message : String(error || 'Following scrape failed');
            }
        } finally {
            if (state.generation === generation) {
                state.loading = false;
                state.loadingProgress = 0;
                state.hasMore = false;
                state.fillPromise = null;
                state.updatedAt = now();
                state.lastRevalidatedAt = now();
                scheduleDiskCacheSave({ immediate: true });
            }
        }
    })();
    return state.fillPromise;
};

const resetRailContents = (state) => {
    state.sets = [];
    state.byId = new Map();
    state.buffered = 0;
    state.loadingProgress = 0;
    state.frozenHeadKeys = null;
    state.error = null;
    state.nextPage = 1;
    state.hasMore = true;
    state.loading = false;
    state.fillPromise = null;
};

const bootstrapFollowingRail = async (usernames, { refresh = false } = {}) => {
    const state = getOrCreate(FOLLOWING_DEF);
    const key = whitelistKey(usernames);
    const sameUsers = whitelistKey(state.usernames) === key;
    const age = now() - (state.updatedAt || 0);
    const revalidateAge = now() - (state.lastRevalidatedAt || state.updatedAt || 0);
    const hasCache = sameUsers && state.sets.length > 0;

    // Hard refresh or whitelist change — rebuild without flashing empty to concurrent readers.
    if (refresh || (state.usernames?.length && !sameUsers)) {
        state.generation = (state.generation || 0) + 1;
        if (state.fillPromise) {
            try { await state.fillPromise; } catch { /* ignore */ }
        }
        // Whitelist change drops stale creators; plain Refresh keeps cards and merges newest on top.
        if (!sameUsers) resetRailContents(state);
        state.hasMore = false;
        state.loading = true;
        state.error = null;
        state.fillPromise = null;
        state.usernames = [...usernames];
        const generation = state.generation;
        void fillFollowingInBackground(state, usernames, generation);
        return serializeRail(state);
    }

    // First cold start (no memory/disk cache yet).
    if (!hasCache && !state.loading && !state.fillPromise) {
        state.generation = (state.generation || 0) + 1;
        resetRailContents(state);
        state.hasMore = false;
        state.loading = true;
        state.usernames = [...usernames];
        const generation = state.generation;
        void fillFollowingInBackground(state, usernames, generation);
        return serializeRail(state);
    }

    // Always serve whatever we already have (including in-flight progress).
    state.usernames = [...usernames];

    // Still scraping the initial fill — never restart.
    if (state.loading || state.fillPromise) {
        return serializeRail(state);
    }

    // Soft revalidate: pull newest creator pages and merge on top when stale.
    if (hasCache && (age > BROWSE_CACHE_TTL_MS || revalidateAge >= BROWSE_REVALIDATE_MS)) {
        void softRevalidateFollowing(state, usernames);
    }

    return serializeRail(state);
};

const softRevalidateRecent = async (state) => {
    if (state.fillPromise || state.loading) return;
    if (state.provider === 'posterdb') {
        return fillPosterdbRecentCatalog(state);
    }
    const generation = state.generation;
    state.loading = true;
    state.fillPromise = (async () => {
        try {
            const first = await fetchRecentPage(state, 1);
            if (state.generation !== generation) return;
            mergeSets(state, first.sets);
            if (!state.nextPage || state.nextPage < 2) {
                state.nextPage = first.nextPage || 2;
            }
            state.hasMore = state.sets.length < state.cap && (
                Boolean(state.hasMore) || Boolean(first.hasMore)
            );
            scheduleDiskCacheSave();
        } catch (error) {
            if (state.generation === generation && !state.sets.length) {
                state.error = error instanceof Error ? error.message : String(error || 'Browse scrape failed');
            }
        } finally {
            if (state.generation === generation) {
                state.loading = false;
                state.fillPromise = null;
                state.updatedAt = now();
                state.lastRevalidatedAt = now();
                scheduleDiskCacheSave({ immediate: true });
                if (state.hasMore && state.sets.length < state.cap) {
                    void fillRailInBackground(state);
                }
            }
        }
    })();
    return state.fillPromise;
};

const bootstrapRail = async (def, { refresh = false } = {}) => {
    const state = getOrCreate(def);
    const age = now() - (state.updatedAt || 0);
    const revalidateAge = now() - (state.lastRevalidatedAt || state.updatedAt || 0);
    const hasCache = state.sets.length > 0;

    if (refresh) {
        state.generation = (state.generation || 0) + 1;
        if (state.fillPromise) {
            try { await state.fillPromise; } catch { /* ignore */ }
        }
        state.loading = true;
        state.error = null;
        state.fillPromise = null;
        if (def.provider === 'posterdb') {
            void fillPosterdbRecentCatalog(state);
            return serializeRail(state);
        }
        const generation = state.generation;
        try {
            const first = await fetchRecentPage(state, 1);
            if (state.generation !== generation) return serializeRail(state);
            // Replace only after first page arrives so concurrent readers never see empty.
            resetRailContents(state);
            state.loading = true;
            mergeSets(state, first.sets);
            scheduleDiskCacheSave();
            state.nextPage = first.nextPage || 2;
            state.hasMore = Boolean(first.hasMore) && state.sets.length < state.cap;
        } catch (error) {
            if (state.generation === generation) {
                state.error = error instanceof Error ? error.message : String(error || 'Browse scrape failed');
                state.hasMore = false;
                state.loading = false;
            }
            return serializeRail(state);
        }
        if (state.generation === generation && state.hasMore && state.sets.length < state.cap) {
            void fillRailInBackground(state);
        } else if (state.generation === generation) {
            state.loading = false;
            state.lastRevalidatedAt = now();
            scheduleDiskCacheSave({ immediate: true });
        }
        return serializeRail(state);
    }

    // In-flight or warm cache — serve immediately.
    if (hasCache || state.loading || state.fillPromise) {
        if (hasCache && !state.loading && !state.fillPromise) {
            if (state.hasMore && state.sets.length < state.cap) {
                void fillRailInBackground(state);
            } else if (age > BROWSE_CACHE_TTL_MS || revalidateAge >= BROWSE_REVALIDATE_MS) {
                void softRevalidateRecent(state);
            }
        }
        return serializeRail(state);
    }

    // Cold start.
    state.generation = (state.generation || 0) + 1;
    resetRailContents(state);
    state.loading = true;
    if (def.provider === 'posterdb') {
        void fillPosterdbRecentCatalog(state);
        return serializeRail(state);
    }
    const generation = state.generation;

    try {
        const first = await fetchRecentPage(state, 1);
        if (state.generation !== generation) return serializeRail(state);
        mergeSets(state, first.sets);
        scheduleDiskCacheSave();
        state.nextPage = first.nextPage || 2;
        state.hasMore = Boolean(first.hasMore) && state.sets.length < state.cap;
    } catch (error) {
        if (state.generation === generation) {
            state.error = error instanceof Error ? error.message : String(error || 'Browse scrape failed');
            state.hasMore = false;
            state.loading = false;
        }
        return serializeRail(state);
    }

    if (state.generation === generation && state.hasMore && state.sets.length < state.cap) {
        void fillRailInBackground(state);
    } else if (state.generation === generation) {
        state.loading = false;
        state.lastRevalidatedAt = now();
        scheduleDiskCacheSave({ immediate: true });
    }
    return serializeRail(state);
};

export const getBrowseRailsSnapshot = async ({ refresh = false } = {}) => {
    await hydrateFromDisk();
    const config = await loadPosterSetsConfig();
    const whitelist = Array.isArray(config.creatorWhitelist) ? config.creatorWhitelist : [];
    const blocklist = Array.isArray(config.creatorBlocklist) ? config.creatorBlocklist : [];
    const railDefs = RAIL_DEFS.filter((def) => {
        if (def.provider === 'posterdb') return isPosterSetsTpdbSearchEnabled(config);
        if (def.provider === 'mediux') return isPosterSetsMediuxEnabled(config);
        return true;
    });
    const rails = await Promise.all(railDefs.map((def) => bootstrapRail(def, { refresh })));
    const followed = excludeBlockedHandles(whitelist, blocklist);
    if (followed.length) {
        const following = await bootstrapFollowingRail(followed, { refresh });
        if (Array.isArray(following?.sets) && following.sets.length) {
            const allowed = new Set(enabledPosterSetsProviders(config));
            following.sets = following.sets.filter((set) => (
                allowed.has(String(set?.provider || '').toLowerCase() === 'mediux' ? 'mediux' : 'posterdb')
            ));
        }
        rails.unshift(following);
    }
    if (blocklist.length) {
        for (const rail of rails) {
            if (!Array.isArray(rail?.sets)) continue;
            rail.sets = excludeBlockedCreators(rail.sets, blocklist);
        }
    }
    return { ok: true, rails, cap: BROWSE_RAIL_CAP, creatorWhitelist: whitelist };
};

/** Memory/disk snapshot of Browse → Following — no scrape. Used to seed Collection Sets. */
export const peekCachedFollowingSets = async () => {
    await hydrateFromDisk();
    const state = railState.get(FOLLOWING_DEF.id);
    return Array.isArray(state?.sets) ? state.sets : [];
};

/** Drop Browse rails/sets for a disabled provider (optional cache purge). */
export const dropBrowseSetsForProvider = async (provider) => {
    await hydrateFromDisk();
    const key = String(provider || '').toLowerCase() === 'mediux' ? 'mediux' : 'posterdb';
    let removed = 0;
    for (const def of [...RAIL_DEFS, FOLLOWING_DEF]) {
        const state = railState.get(def.id);
        if (!state) continue;
        const before = Array.isArray(state.sets) ? state.sets.length : 0;
        if (def.provider === key) {
            resetRailContents(state);
            removed += before;
            continue;
        }
        const next = (state.sets || []).filter((set) => {
            const setProvider = String(set?.provider || '').toLowerCase() === 'mediux' ? 'mediux' : 'posterdb';
            return setProvider !== key;
        });
        removed += before - next.length;
        state.sets = next;
        state.byId = new Map(next.map((item) => [setKey(item, item.provider), item]));
        state.buffered = next.length;
        state.updatedAt = now();
    }
    scheduleDiskCacheSave({ immediate: true });
    return { removed };
};
