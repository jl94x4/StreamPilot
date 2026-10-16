/**
 * Bounded in-memory cache with TTL + LRU eviction.
 * Prunes lazily on get/set (no background timer).
 */

/**
 * @param {{ maxEntries?: number, defaultTtlMs?: number, name?: string }} [opts]
 */
export const createTtlLruCache = ({
    maxEntries = 256,
    defaultTtlMs = 60_000,
    name = 'cache',
} = {}) => {
    const store = new Map(); // key -> { value, expiresAt }
    const limit = Math.max(1, Number(maxEntries) || 256);
    const ttlDefault = Math.max(0, Number(defaultTtlMs) || 0);

    const pruneExpired = (now = Date.now()) => {
        for (const [key, entry] of store.entries()) {
            if (!entry || now >= entry.expiresAt) store.delete(key);
        }
    };

    const evictOldest = () => {
        while (store.size >= limit) {
            const oldest = store.keys().next().value;
            if (oldest === undefined) break;
            store.delete(oldest);
        }
    };

    const get = (key) => {
        const entry = store.get(key);
        if (!entry) return undefined;
        if (Date.now() >= entry.expiresAt) {
            store.delete(key);
            return undefined;
        }
        // LRU touch
        store.delete(key);
        store.set(key, entry);
        return entry.value;
    };

    const set = (key, value, ttlMs = ttlDefault) => {
        if (value === null || value === undefined) return false;
        if (store.has(key)) store.delete(key);
        if (store.size >= limit) {
            pruneExpired();
            evictOldest();
        }
        store.set(key, {
            value,
            expiresAt: Date.now() + Math.max(0, Number(ttlMs) || ttlDefault),
        });
        return true;
    };

    const del = (key) => store.delete(key);

    const clear = () => {
        store.clear();
    };

    const has = (key) => get(key) !== undefined;

    const prune = () => {
        pruneExpired();
        return store.size;
    };

    const keys = () => {
        pruneExpired();
        return [...store.keys()];
    };

    const stats = () => ({
        name,
        size: store.size,
        maxEntries: limit,
        defaultTtlMs: ttlDefault,
    });

    return {
        get,
        set,
        delete: del,
        clear,
        has,
        prune,
        keys,
        stats,
        get size() {
            return store.size;
        },
    };
};

export default createTtlLruCache;
