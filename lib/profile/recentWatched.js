/**
 * Recently Watched should only list movies/episodes that were actually watched,
 * not 30-second previews. Music tracks stay unfiltered.
 */

export const RECENT_WATCHED_MIN_PERCENT = 75;

const asNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

/** Plex/Tautulli duration is usually ms; Jellyfin mapped duration is seconds. */
const toSeconds = (value) => {
    const n = asNumber(value);
    if (n == null || n <= 0) return 0;
    return n > 100000 ? n / 1000 : n;
};

/**
 * 0–100 watch progress, or null when there is no completion signal.
 * Tautulli percent_complete is an integer 0–100; values in (0, 1) are treated as a fraction.
 */
export const historyItemWatchPercent = (item = {}) => {
    const raw = asNumber(item?.percentComplete);
    if (raw != null && raw >= 0) {
        if (raw > 0 && raw < 1) return raw * 100;
        return Math.min(100, raw);
    }
    const durationSec = toSeconds(item?.duration);
    if (durationSec > 0) {
        const offsetSec = toSeconds(item?.viewOffset);
        if (offsetSec > 0) return Math.min(100, (offsetSec / durationSec) * 100);
        const playSec = toSeconds(item?.playDuration);
        if (playSec > 0) return Math.min(100, (playSec / durationSec) * 100);
    }
    return null;
};

export const historyItemCountsAsRecentlyWatched = (item = {}, minPercent = RECENT_WATCHED_MIN_PERCENT) => {
    const type = String(item?.type || '').toLowerCase();
    if (type === 'track' || type === 'music') return true;

    const pct = historyItemWatchPercent(item);
    if (pct != null) return pct >= minPercent;

    const watched = asNumber(item?.watchedStatus);
    if (watched != null) return watched >= 1;

    return false;
};

export const filterRecentlyWatchedHistory = (items = [], { minPercent = RECENT_WATCHED_MIN_PERCENT, limit } = {}) => {
    const filtered = (Array.isArray(items) ? items : []).filter((item) => (
        historyItemCountsAsRecentlyWatched(item, minPercent)
    ));
    if (Number.isFinite(limit) && limit >= 0) return filtered.slice(0, limit);
    return filtered;
};
