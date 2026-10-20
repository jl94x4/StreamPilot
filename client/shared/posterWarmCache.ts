/**
 * Short-lived in-memory image warm cache (Home posters, episode stills, CW
 * backdrops). Keyed by full URL. Plex `/thumb/<updatedAt>` stamps change when
 * cover art changes, so new art misses the cache and loads immediately.
 */
const POSTER_WARM_TTL_MS = 180_000;
const POSTER_WARM_CAP = 320;

type WarmPosterEntry = { at: number; img: HTMLImageElement };
const warmPosters = new Map<string, WarmPosterEntry>();

const pruneWarmPosters = (now = Date.now()) => {
    for (const [key, entry] of warmPosters) {
        if (now - entry.at > POSTER_WARM_TTL_MS) warmPosters.delete(key);
    }
    while (warmPosters.size > POSTER_WARM_CAP) {
        const oldest = warmPosters.keys().next().value;
        if (!oldest) break;
        warmPosters.delete(oldest);
    }
};

/** Keep a decoded Image alive briefly so remounted rails paint from memory. */
export const warmPosterUrl = (url: string | null | undefined) => {
    const key = String(url || '').trim();
    if (!key || typeof window === 'undefined') return;
    const now = Date.now();
    const existing = warmPosters.get(key);
    if (existing && now - existing.at <= POSTER_WARM_TTL_MS) {
        existing.at = now;
        return;
    }
    pruneWarmPosters(now);
    const img = new Image();
    img.decoding = 'async';
    img.src = key;
    warmPosters.set(key, { at: now, img });
};

export const isPosterUrlWarm = (url: string | null | undefined) => {
    const key = String(url || '').trim();
    if (!key) return false;
    const entry = warmPosters.get(key);
    if (!entry) return false;
    if (Date.now() - entry.at > POSTER_WARM_TTL_MS) {
        warmPosters.delete(key);
        return false;
    }
    return entry.img.complete && entry.img.naturalWidth > 0;
};

export const clearWarmPosterUrls = () => {
    warmPosters.clear();
};

export const forgetWarmPosterUrl = (url: string | null | undefined) => {
    const key = String(url || '').trim();
    if (key) warmPosters.delete(key);
};
