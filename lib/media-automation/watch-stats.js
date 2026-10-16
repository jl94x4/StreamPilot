import fs from 'fs/promises';
import path from 'path';

const normalizePathKey = (value) => String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .toLowerCase();

/**
 * Cheap watch-stats lookup from the existing maintenance media index
 * (path → watchCount / lastViewedAt). No live Plex/Jellyfin API calls.
 */
export const createWatchStatsLookup = ({
    indexPath,
    ttlMs = 5 * 60_000,
    logger = console,
} = {}) => {
    if (!indexPath) throw new Error('indexPath is required');
    let cache = {
        loadedAt: 0,
        mtimeMs: 0,
        byPath: new Map(),
    };

    const extractItems = (raw) => {
        if (!raw || typeof raw !== 'object') return [];
        if (Array.isArray(raw.items)) return raw.items;
        if (Array.isArray(raw.media)) return raw.media;
        if (Array.isArray(raw)) return raw;
        return [];
    };

    const rebuild = async () => {
        let stat;
        try {
            stat = await fs.stat(indexPath);
        } catch {
            cache = { loadedAt: Date.now(), mtimeMs: 0, byPath: new Map() };
            return cache;
        }
        if (cache.byPath.size && cache.mtimeMs === stat.mtimeMs && (Date.now() - cache.loadedAt) < ttlMs) {
            return cache;
        }
        let raw;
        try {
            raw = JSON.parse(await fs.readFile(indexPath, 'utf8'));
        } catch (error) {
            logger.warn?.(`[media-automation] watch-stats index read failed: ${error.message}`);
            cache = { loadedAt: Date.now(), mtimeMs: stat.mtimeMs, byPath: new Map() };
            return cache;
        }
        const byPath = new Map();
        for (const item of extractItems(raw)) {
            const filePath = String(item?.filePath || item?.path || '').trim();
            if (!filePath) continue;
            const key = normalizePathKey(path.resolve(filePath));
            const viewCount = Number(item.watchCount ?? item.viewCount ?? 0) || 0;
            const lastViewedAt = item.lastViewedAt
                ? (typeof item.lastViewedAt === 'number'
                    ? new Date(item.lastViewedAt > 1e12 ? item.lastViewedAt : item.lastViewedAt * 1000).toISOString()
                    : String(item.lastViewedAt))
                : null;
            // Prefer higher watch counts if duplicates collide.
            const existing = byPath.get(key);
            if (!existing || viewCount >= Number(existing.viewCount || 0)) {
                byPath.set(key, { viewCount, lastViewedAt });
            }
        }
        cache = { loadedAt: Date.now(), mtimeMs: stat.mtimeMs, byPath };
        return cache;
    };

    const getWatchStats = async (filePath) => {
        const target = normalizePathKey(path.resolve(String(filePath || '')));
        if (!target) return null;
        const { byPath } = await rebuild();
        if (byPath.has(target)) return byPath.get(target);

        // Suffix match for mount-path drift (/mnt/user/media/... vs /media/...).
        let best = null;
        let bestLen = 0;
        for (const [key, stats] of byPath.entries()) {
            if (target.endsWith(key) || key.endsWith(target)) {
                const len = Math.min(target.length, key.length);
                if (len > bestLen) {
                    best = stats;
                    bestLen = len;
                }
            }
        }
        // Require a meaningful shared suffix (not just ".mkv").
        if (best && bestLen >= 24) return best;
        return null;
    };

    return { getWatchStats, rebuild };
};

export default createWatchStatsLookup;
