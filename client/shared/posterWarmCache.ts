/**
 * In-memory poster warm cache. Keyed by full URL. Plex `/thumb/<updatedAt>`
 * stamps change when cover art changes, so new art misses and loads immediately.
 */
const POSTER_WARM_TTL_MS = 24 * 60 * 60 * 1000;
const POSTER_WARM_CAP = 800;
const POSTER_WARM_SLOTS = 8;

type WarmPosterEntry = { at: number; img: HTMLImageElement };
const warmPosters = new Map<string, WarmPosterEntry>();
const posterWarmWait: string[] = [];
const posterWarmQueued = new Set<string>();
let posterWarmBusy = 0;

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

const pumpPosterWarm = () => {
    pruneWarmPosters();
    while (posterWarmBusy < POSTER_WARM_SLOTS && posterWarmWait.length) {
        const key = posterWarmWait.shift();
        if (!key) continue;
        posterWarmQueued.delete(key);
        if (warmPosters.has(key)) continue;
        startPosterWarm(key);
    }
};

const startPosterWarm = (key: string) => {
    posterWarmBusy += 1;
    const img = new Image();
    img.decoding = 'async';
    const finish = () => {
        posterWarmBusy = Math.max(0, posterWarmBusy - 1);
        pumpPosterWarm();
    };
    img.onload = () => {
        warmPosters.set(key, { at: Date.now(), img });
        pruneWarmPosters();
        finish();
    };
    img.onerror = finish;
    img.src = key;
};

/** Keep a decoded Image alive so remounted rails paint from memory. */
export const warmPosterUrl = (url: string | null | undefined, priority = false) => {
    const key = String(url || '').trim();
    if (!key || typeof window === 'undefined') return;
    const now = Date.now();
    const existing = warmPosters.get(key);
    if (existing) {
        existing.at = now;
        return;
    }
    if (posterWarmQueued.has(key)) {
        if (priority) {
            const idx = posterWarmWait.indexOf(key);
            if (idx > 0) {
                posterWarmWait.splice(idx, 1);
                posterWarmWait.unshift(key);
            }
        }
        return;
    }
    posterWarmQueued.add(key);
    if (priority) posterWarmWait.unshift(key);
    else posterWarmWait.push(key);
    pumpPosterWarm();
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
    posterWarmWait.length = 0;
    posterWarmQueued.clear();
};

export const forgetWarmPosterUrl = (url: string | null | undefined) => {
    const key = String(url || '').trim();
    if (key) warmPosters.delete(key);
};
