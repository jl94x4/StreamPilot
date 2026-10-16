/**
 * Stale-while-revalidate in-memory cache.
 * Fresh hits return immediately; stale hits return cached value and refresh in background.
 * Entries are bounded (LRU) and pruned after maxStaleMs so keys cannot grow forever.
 */

/**
 * @param {{ name?: string, maxEntries?: number, maxStaleMs?: number }} [opts]
 */
export const createSwrCache = ({
    name = 'swr',
    maxEntries = 64,
    maxStaleMs = 2 * 60 * 60 * 1000,
} = {}) => {
    /** @type {Map<string, { value: any, fetchedAt: number }>} */
    const store = new Map();
    /** @type {Map<string, Promise<any>>} */
    const inflight = new Map();
    const limit = Math.max(1, Number(maxEntries) || 64);
    const staleCapMs = Math.max(1, Number(maxStaleMs) || 2 * 60 * 60 * 1000);

    const pruneStale = (now = Date.now()) => {
        for (const [key, entry] of store.entries()) {
            if (!entry || now - entry.fetchedAt > staleCapMs) store.delete(key);
        }
    };

    const evictOldest = () => {
        while (store.size > limit) {
            const oldest = store.keys().next().value;
            if (oldest === undefined) break;
            store.delete(oldest);
        }
    };

    const touch = (key, entry) => {
        store.delete(key);
        store.set(key, entry);
    };

    const storeValue = (key, value) => {
        if (value === undefined) return;
        const entry = { value, fetchedAt: Date.now() };
        if (store.has(key)) store.delete(key);
        store.set(key, entry);
        pruneStale();
        evictOldest();
    };

    const revalidate = async (key, fetcher) => {
        if (inflight.has(key)) return inflight.get(key);
        const pending = Promise.resolve()
            .then(() => fetcher())
            .then((value) => {
                if (value !== undefined) {
                    storeValue(key, value);
                }
                inflight.delete(key);
                return value;
            })
            .catch((error) => {
                inflight.delete(key);
                throw error;
            });
        inflight.set(key, pending);
        return pending;
    };

    /**
     * @param {string} key
     * @param {() => Promise<any>} fetcher
     * @param {{ freshMs?: number, staleMs?: number }} [opts]
     * @returns {Promise<{ value: any, stale: boolean, ageMs: number }>}
     */
    const get = async (key, fetcher, { freshMs = 8_000, staleMs = 45_000 } = {}) => {
        const now = Date.now();
        pruneStale(now);
        const entry = store.get(key);
        if (entry) {
            touch(key, entry);
            const ageMs = Math.max(0, now - entry.fetchedAt);
            if (ageMs < freshMs) {
                return { value: entry.value, stale: false, ageMs };
            }
            if (ageMs < staleMs) {
                void revalidate(key, fetcher).catch(() => null);
                return { value: entry.value, stale: true, ageMs };
            }
            store.delete(key);
        }

        try {
            const value = await revalidate(key, fetcher);
            return { value, stale: false, ageMs: 0 };
        } catch (error) {
            // Hard miss with a failed refresh — last-known value beats empty if we have one.
            const fallback = store.get(key) || entry;
            if (fallback) {
                return {
                    value: fallback.value,
                    stale: true,
                    ageMs: Math.max(0, now - fallback.fetchedAt),
                };
            }
            throw error;
        }
    };

    const put = (key, value) => {
        if (value === undefined) return false;
        storeValue(key, value);
        return true;
    };

    const peek = (key) => {
        pruneStale();
        const entry = store.get(key);
        return entry || null;
    };

    const del = (key) => {
        store.delete(key);
        inflight.delete(key);
    };

    const clear = () => {
        store.clear();
        inflight.clear();
    };

    const prune = () => {
        pruneStale();
        return store.size;
    };

    const stats = () => ({
        name,
        size: store.size,
        inflight: inflight.size,
        maxEntries: limit,
        maxStaleMs: staleCapMs,
    });

    return {
        get,
        put,
        peek,
        revalidate,
        delete: del,
        clear,
        prune,
        stats,
    };
};

export default createSwrCache;
