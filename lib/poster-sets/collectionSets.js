/**
 * Followed-creator collection / boxset catalog.
 * Disk-cached like Browse → Following; TPDB collection sets are always hydrated.
 */
import fs from 'fs/promises';
import path from 'path';
import { runPosterSetsCli } from './runner.js';
import { loadPosterSetsConfig, POSTER_SETS_DIR, enabledPosterSetsProviders } from './config.js';
import { peekCachedFollowingSets } from './browse.js';
import {
    excludeBlockedCreators,
    excludeBlockedHandles,
    filterCollectionSets,
    isCollectionSet,
    keepFollowedCreatorsOnly,
} from './searchMerge.js';
import { enqueueTpdbLibraryTitleHydrate } from './tpdbCache.js';

/** First pages are enough to paint; Python also stops after 3 empty collection pages. */
const COLLECTIONS_PER_CREATOR_LIMIT = 120;
const COLLECTIONS_MAX_PAGES = 8;
const COLLECTIONS_JOB_CONCURRENCY = 4;
const COLLECTIONS_CACHE_TTL_MS = 24 * 60 * 60_000;
const COLLECTIONS_REVALIDATE_MS = 15 * 60_000;
const DISK_CACHE_PATH = path.join(POSTER_SETS_DIR, 'collections-cache.json');

const now = () => Date.now();

const emptyState = () => ({
    sets: [],
    byId: new Map(),
    loading: false,
    error: null,
    updatedAt: 0,
    lastRevalidatedAt: 0,
    generation: 0,
    fillPromise: null,
    usernames: [],
    hydratedKeys: new Set(),
});

/** @type {ReturnType<typeof emptyState>} */
let catalogState = emptyState();
let diskHydrated = false;
/** @type {Promise<void> | null} */
let diskHydratePromise = null;
let diskSaveTimer = null;

const whitelistKey = (usernames = []) => [...usernames]
    .map((item) => String(item || '').trim().replace(/^@+/, '').toLowerCase())
    .filter(Boolean)
    .sort()
    .join('|');

const setKey = (raw) => {
    const setId = String(raw?.setId || '').trim();
    if (!setId) return '';
    const provider = String(raw?.provider || 'unknown').toLowerCase();
    return `${provider}:${setId}`;
};

const sortSetsLatestFirst = (sets) => {
    const list = Array.isArray(sets) ? [...sets] : [];
    list.sort((a, b) => {
        const aId = Number(a?.setId);
        const bId = Number(b?.setId);
        if (Number.isFinite(aId) && Number.isFinite(bId) && aId !== bId) return bId - aId;
        return String(b?.setId || '').localeCompare(String(a?.setId || ''), undefined, { numeric: true });
    });
    return list;
};

const normalizeSet = (raw, fallbackUser = '') => {
    if (!raw?.setId || !raw?.url) return null;
    return {
        setId: String(raw.setId),
        url: String(raw.url),
        title: String(raw.title || `Set ${raw.setId}`),
        user: raw.user || fallbackUser || null,
        thumbUrl: raw.thumbUrl || '',
        posterCount: raw.posterCount ?? raw.assetCount ?? null,
        provider: raw.provider || 'unknown',
        setKind: raw.setKind
            || (/box\s*sets?/i.test(String(raw.title || '')) ? 'boxset' : null)
            || (isCollectionSet(raw) ? 'collection' : null),
        mediaType: raw.mediaType || null,
    };
};

const groupByCreator = (sets = []) => {
    const groups = new Map();
    for (const set of Array.isArray(sets) ? sets : []) {
        const handle = String(set?.user || '').trim().replace(/^@+/, '') || 'Unknown';
        const key = handle.toLowerCase();
        if (!groups.has(key)) groups.set(key, { user: handle, sets: [] });
        groups.get(key).sets.push(set);
    }
    return [...groups.values()].sort((a, b) => a.user.localeCompare(b.user, undefined, { sensitivity: 'base' }));
};

const serializeCatalog = (state, { usernames = [], blocklist = [], providers = null } = {}) => {
    let sets = excludeBlockedCreators(state.sets, blocklist);
    if (Array.isArray(providers)) {
        const allowed = new Set(providers);
        sets = sets.filter((set) => (
            allowed.has(String(set?.provider || '').toLowerCase() === 'mediux' ? 'mediux' : 'posterdb')
        ));
    }
    return {
        ok: true,
        loading: Boolean(state.loading),
        error: state.error || null,
        sets,
        groups: groupByCreator(sets),
        buffered: sets.length,
        usernames: Array.isArray(usernames) ? usernames : state.usernames,
        updatedAt: state.updatedAt || 0,
    };
};

const publishCollected = (state, collected) => {
    const byId = new Map();
    for (const raw of Array.isArray(collected) ? collected : []) {
        const item = normalizeSet(raw);
        if (!item) continue;
        const key = setKey(item);
        if (!key || byId.has(key)) continue;
        byId.set(key, item);
    }
    state.sets = sortSetsLatestFirst([...byId.values()]);
    state.byId = byId;
    state.updatedAt = now();
};

const scheduleDiskCacheSave = ({ immediate = false } = {}) => {
    if (diskSaveTimer) clearTimeout(diskSaveTimer);
    const save = async () => {
        diskSaveTimer = null;
        try {
            await fs.mkdir(POSTER_SETS_DIR, { recursive: true });
            await fs.writeFile(DISK_CACHE_PATH, JSON.stringify({
                savedAt: now(),
                usernames: catalogState.usernames,
                sets: catalogState.sets,
            }), 'utf8');
        } catch {
            /* ignore disk write failures */
        }
    };
    if (immediate) {
        void save();
        return;
    }
    diskSaveTimer = setTimeout(() => { void save(); }, 1200);
};

const hydrateFromDisk = async () => {
    if (diskHydrated) return;
    if (diskHydratePromise) return diskHydratePromise;
    diskHydratePromise = (async () => {
        try {
            const raw = JSON.parse(await fs.readFile(DISK_CACHE_PATH, 'utf8'));
            const sets = Array.isArray(raw?.sets) ? raw.sets : [];
            if (sets.length) {
                publishCollected(catalogState, sets);
                catalogState.usernames = Array.isArray(raw.usernames) ? raw.usernames : [];
                catalogState.updatedAt = Number(raw.savedAt) || now();
                catalogState.lastRevalidatedAt = catalogState.updatedAt;
            }
        } catch {
            /* missing or invalid cache */
        } finally {
            diskHydrated = true;
            diskHydratePromise = null;
        }
    })();
    return diskHydratePromise;
};

const fetchCreatorCollectionSets = async (username, provider, { onBatch } = {}) => {
    const byId = new Map();
    const ingest = (items) => {
        const mapped = filterCollectionSets(Array.isArray(items) ? items : []).map((item) => ({
            ...item,
            provider: item.provider || provider,
            user: item.user || username,
        }));
        const fresh = [];
        for (const item of mapped) {
            const key = `${String(item.provider || provider).toLowerCase()}:${item.setId}`;
            if (!item.setId || byId.has(key)) continue;
            byId.set(key, item);
            fresh.push(item);
        }
        if (fresh.length) onBatch?.(fresh);
    };
    const run = await runPosterSetsCli('search', {
        provider,
        mode: 'creator',
        query: username,
        kind: 'collections',
        limit: COLLECTIONS_PER_CREATOR_LIMIT,
        maxPages: COLLECTIONS_MAX_PAGES,
        streamBatches: true,
        batchPages: 1,
    }, {
        timeoutMs: 90_000,
        onBatch: (event) => {
            ingest(event?.sets || event?.allSets || []);
        },
    });
    if (!run.ok && !byId.size) {
        return { sets: [], error: run.error || `${provider} @${username} failed` };
    }
    if (Array.isArray(run.result?.sets)) ingest(run.result.sets);
    return { sets: [...byId.values()], error: run.ok ? null : (run.error || null) };
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

const hydrateFollowedCollectionSets = (sets = []) => {
    const tpdbSets = (Array.isArray(sets) ? sets : []).filter((item) => {
        const provider = String(item?.provider || '').toLowerCase();
        return provider === 'posterdb' || provider === 'tpdb' || provider === 'theposterdb';
    });
    if (!tpdbSets.length) return;
    const fresh = [];
    for (const set of tpdbSets) {
        const key = setKey(set);
        if (!key || catalogState.hydratedKeys.has(key)) continue;
        catalogState.hydratedKeys.add(key);
        fresh.push(set);
    }
    if (!fresh.length) return;
    void enqueueTpdbLibraryTitleHydrate(fresh, {
        collectionSets: true,
        force: true,
        followedCreatorsOnly: true,
        titleKey: 'followed-collection-sets',
    });
};

const seedFromFollowing = async (state, usernames) => {
    try {
        const following = await peekCachedFollowingSets();
        const allowed = new Set(
            usernames.map((name) => String(name || '').trim().replace(/^@+/, '').toLowerCase()).filter(Boolean),
        );
        const seeded = filterCollectionSets(following).filter((set) => {
            const user = String(set?.user || '').trim().replace(/^@+/, '').toLowerCase();
            return Boolean(user && allowed.has(user));
        });
        if (!seeded.length) return [];
        const merged = [...state.sets, ...seeded];
        publishCollected(state, merged);
        return seeded;
    } catch {
        return [];
    }
};

const fillCollectionsInBackground = async (state, usernames, generation) => {
    if (state.fillPromise) return state.fillPromise;
    state.loading = true;
    state.error = null;
    state.fillPromise = (async () => {
        const errors = [];
        const collectedById = new Map();
        for (const existing of state.sets) {
            const key = setKey(existing);
            if (key) collectedById.set(key, existing);
        }
        const ingest = (items) => {
            if (state.generation !== generation) return;
            let added = 0;
            for (const raw of Array.isArray(items) ? items : []) {
                const item = normalizeSet(raw);
                if (!item) continue;
                const key = setKey(item);
                if (!key || collectedById.has(key)) continue;
                collectedById.set(key, item);
                added += 1;
            }
            if (!added) return;
            state.sets = sortSetsLatestFirst([...collectedById.values()]);
            state.byId = collectedById;
            state.updatedAt = now();
            scheduleDiskCacheSave();
        };
        try {
            const jobs = [];
            const providers = enabledPosterSetsProviders(await loadPosterSetsConfig().catch(() => ({})));
            for (const username of usernames) {
                for (const provider of providers) {
                    jobs.push({ username, provider });
                }
            }
            await mapPool(jobs, COLLECTIONS_JOB_CONCURRENCY, async (job) => {
                if (state.generation !== generation) return;
                const batch = await fetchCreatorCollectionSets(job.username, job.provider, {
                    onBatch: (sets) => ingest(sets),
                });
                if (state.generation !== generation) return;
                if (batch.error) errors.push(batch.error);
                ingest(batch.sets || []);
            });
            if (state.generation === generation) {
                state.sets = sortSetsLatestFirst([...collectedById.values()]);
                state.byId = collectedById;
                state.updatedAt = now();
                hydrateFollowedCollectionSets([...collectedById.values()]);
                if (!state.sets.length && errors.length) {
                    state.error = errors[0];
                }
            }
        } catch (error) {
            if (state.generation === generation) {
                state.error = error instanceof Error ? error.message : String(error || 'Collection scrape failed');
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

const resetCatalog = () => {
    const generation = catalogState.generation || 0;
    catalogState = emptyState();
    catalogState.generation = generation;
};

export const getCollectionSetsSnapshot = async ({ refresh = false } = {}) => {
    await hydrateFromDisk();
    const config = await loadPosterSetsConfig();
    const providers = enabledPosterSetsProviders(config);
    const whitelist = Array.isArray(config.creatorWhitelist) ? config.creatorWhitelist : [];
    const blocklist = Array.isArray(config.creatorBlocklist) ? config.creatorBlocklist : [];
    const usernames = excludeBlockedHandles(
        whitelist
            .map((item) => String(item || '').trim().replace(/^@+/, ''))
            .filter(Boolean),
        blocklist,
    );
    const key = whitelistKey(usernames);
    const sameUsers = whitelistKey(catalogState.usernames) === key;
    const age = now() - (catalogState.updatedAt || 0);
    const revalidateAge = now() - (catalogState.lastRevalidatedAt || catalogState.updatedAt || 0);
    const hasCache = sameUsers && catalogState.sets.length > 0;

    if (!usernames.length) {
        if (catalogState.usernames.length) resetCatalog();
        return {
            ok: true,
            loading: false,
            error: null,
            sets: [],
            groups: [],
            buffered: 0,
            usernames: [],
            updatedAt: 0,
            needsFollowers: true,
        };
    }

    if (refresh || (catalogState.usernames?.length && !sameUsers)) {
        catalogState.generation = (catalogState.generation || 0) + 1;
        catalogState.fillPromise = null;
        if (!sameUsers) resetCatalog();
        catalogState.loading = true;
        catalogState.error = null;
        catalogState.usernames = [...usernames];
        await seedFromFollowing(catalogState, usernames);
        const generation = catalogState.generation;
        void fillCollectionsInBackground(catalogState, usernames, generation);
        return serializeCatalog(catalogState, { usernames, blocklist, providers });
    }

    if (!hasCache && !catalogState.loading && !catalogState.fillPromise) {
        catalogState.generation = (catalogState.generation || 0) + 1;
        resetCatalog();
        catalogState.loading = true;
        catalogState.usernames = [...usernames];
        await seedFromFollowing(catalogState, usernames);
        const generation = catalogState.generation;
        void fillCollectionsInBackground(catalogState, usernames, generation);
        return serializeCatalog(catalogState, { usernames, blocklist, providers });
    }

    catalogState.usernames = [...usernames];
    if (catalogState.loading || catalogState.fillPromise) {
        return serializeCatalog(catalogState, { usernames, blocklist, providers });
    }

    if (hasCache && (age > COLLECTIONS_CACHE_TTL_MS || revalidateAge >= COLLECTIONS_REVALIDATE_MS)) {
        catalogState.generation = (catalogState.generation || 0) + 1;
        void fillCollectionsInBackground(catalogState, usernames, catalogState.generation);
    } else {
        hydrateFollowedCollectionSets(keepFollowedCreatorsOnly(catalogState.sets, usernames));
    }

    return serializeCatalog(catalogState, { usernames, blocklist, providers });
};

/** Drop cached collection sets for a disabled provider (optional cache purge). */
export const dropCollectionSetsForProvider = async (provider) => {
    await hydrateFromDisk();
    const key = String(provider || '').toLowerCase() === 'mediux' ? 'mediux' : 'posterdb';
    const before = catalogState.sets.length;
    catalogState.sets = catalogState.sets.filter((set) => {
        const setProvider = String(set?.provider || '').toLowerCase() === 'mediux' ? 'mediux' : 'posterdb';
        return setProvider !== key;
    });
    catalogState.byId = new Map(catalogState.sets.map((item) => [setKey(item), item]));
    scheduleDiskCacheSave({ immediate: true });
    return { removed: Math.max(0, before - catalogState.sets.length) };
};

/** Kick a background fill + hydrate without waiting (cache build / settings save). */
export const ensureFollowedCollectionSetsCached = () => {
    void getCollectionSetsSnapshot({ refresh: false });
};
