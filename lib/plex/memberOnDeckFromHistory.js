/**
 * Continue Watching for shared Plex friends (not Plex Home profiles).
 * The owner token cannot switch into a friend's plex.tv account, but PMS
 * history is stored per local accountID and is readable with the server token.
 */

import { isPlexOwnerLocalAccountId } from './localAccountId.js';
import { historyItemWatchPercent } from '../profile/recentWatched.js';

const CONTINUE_MIN_PERCENT = 5;
const CONTINUE_MAX_PERCENT = 90;
/** Plex default for Settings → Library → Weeks to consider for Continue Watching. */
export const DEFAULT_ON_DECK_WINDOW_WEEKS = 16;

const asList = (value) => {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
};

const asInt = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : null;
};

export const historyItemIsContinueWatching = (item = {}) => {
    const type = String(item?.type || '').toLowerCase();
    if (type !== 'movie' && type !== 'episode') return false;
    const pct = historyItemWatchPercent(item);
    if (pct != null) return pct >= CONTINUE_MIN_PERCENT && pct < CONTINUE_MAX_PERCENT;
    return Number(item?.viewOffset) > 0 && Number(item?.watchedStatus || 0) < 1;
};

export const continueWatchingHistoryKey = (item = {}) => {
    if (String(item?.type || '').toLowerCase() === 'episode') {
        const show = String(item.grandparentRatingKey || item.grandparentTitle || '').trim();
        if (show) return `show:${show}`;
    }
    return `item:${String(item.ratingKey || item.key || item.title || '').trim()}`;
};

/** Normalize Plex OnDeckWindow weeks (same setting as the Plex UI). */
export const normalizeOnDeckWindowWeeks = (value, fallback = DEFAULT_ON_DECK_WINDOW_WEEKS) => {
    const n = asInt(value);
    if (n == null || n < 0) return Math.max(0, asInt(fallback) ?? DEFAULT_ON_DECK_WINDOW_WEEKS);
    // Cap absurd values so a bad prefs row cannot explode history scans.
    return Math.min(5200, n);
};

export const parseOnDeckWindowWeeks = (prefsPayload, fallback = DEFAULT_ON_DECK_WINDOW_WEEKS) => {
    const settings = asList(prefsPayload?.MediaContainer?.Setting);
    const hit = settings.find((row) => String(row?.id || '').toLowerCase() === 'ondeckwindow');
    if (!hit) return normalizeOnDeckWindowWeeks(fallback);
    return normalizeOnDeckWindowWeeks(hit.value ?? hit.default, fallback);
};

/**
 * Keep items watched within Plex's OnDeckWindow (weeks).
 * Missing timestamps are kept — official /onDeck rows are already age-filtered by PMS.
 */
export const isWithinOnDeckWindow = (item = {}, weeks = DEFAULT_ON_DECK_WINDOW_WEEKS, nowSec = Math.floor(Date.now() / 1000)) => {
    const windowWeeks = normalizeOnDeckWindowWeeks(weeks);
    if (windowWeeks <= 0) return true;
    const viewed = asInt(item.lastViewedAt) || asInt(item.viewedAt) || 0;
    if (!viewed) return true;
    const maxAgeSec = windowWeeks * 7 * 24 * 60 * 60;
    return (Math.max(0, asInt(nowSec) || 0) - viewed) <= maxAgeSec;
};

/** True when Plex left a nearly-finished title on On Deck (full bar, not scrobbled). */
export const isOnDeckProgressComplete = (item = {}) => {
    const duration = Number(item.durationMs || item.duration || 0);
    const offset = Number(item.viewOffsetMs || item.viewOffset || 0);
    if (duration <= 0 || offset <= 0) return false;
    if ((offset / duration) * 100 >= CONTINUE_MAX_PERCENT) return true;
    return offset > Math.max(0, duration - 15_000);
};

export const filterWithinOnDeckWindow = (items = [], weeks = DEFAULT_ON_DECK_WINDOW_WEEKS, nowSec) => (
    (Array.isArray(items) ? items : []).filter((row) => (
        isWithinOnDeckWindow(row, weeks, nowSec) && !isOnDeckProgressComplete(row)
    ))
);

export const fetchPlexOnDeckWindowWeeks = async ({
    uri,
    token,
    headers = {},
    fetchImpl = fetch,
    timeoutMs = 5000,
    fallback = DEFAULT_ON_DECK_WINDOW_WEEKS,
} = {}) => {
    const auth = String(token || '').trim();
    const base = String(uri || '').replace(/\/+$/, '');
    if (!auth || !base) return normalizeOnDeckWindowWeeks(fallback);
    const url = `${base}/:/prefs?X-Plex-Token=${encodeURIComponent(auth)}`;
    const extra = {};
    if (Number(timeoutMs) > 0 && typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        extra.signal = AbortSignal.timeout(Math.floor(Number(timeoutMs)));
    }
    try {
        const res = await fetchImpl(url, { headers, ...extra });
        if (!res?.ok) return normalizeOnDeckWindowWeeks(fallback);
        const payload = await res.json().catch(() => null);
        return parseOnDeckWindowWeeks(payload, fallback);
    } catch {
        return normalizeOnDeckWindowWeeks(fallback);
    }
};

export const pickContinueWatchingFromHistory = (items = [], {
    sectionKey,
    limit = 24,
    onDeckWindowWeeks = DEFAULT_ON_DECK_WINDOW_WEEKS,
    nowSec = Math.floor(Date.now() / 1000),
} = {}) => {
    const section = String(sectionKey || '').trim();
    const max = Math.min(24, Math.max(1, Number(limit) || 24));
    const picked = [];
    const seen = new Set();
    for (const item of asList(items)) {
        if (!item?.ratingKey) continue;
        if (section) {
            const sid = String(item.librarySectionID || '').trim();
            if (sid && sid !== section) continue;
        }
        if (!isWithinOnDeckWindow(item, onDeckWindowWeeks, nowSec)) continue;
        const key = continueWatchingHistoryKey(item);
        if (!key || key === 'item:' || seen.has(key)) continue;
        seen.add(key);
        if (!historyItemIsContinueWatching(item)) continue;
        picked.push(item);
        if (picked.length >= max) break;
    }
    return picked;
};

export const fetchMemberOnDeckFromHistory = async ({
    uri,
    token,
    accountID,
    headers = {},
    fetchImpl = fetch,
    timeoutMs = 8000,
    containerSize = 80,
    sectionKey,
    limit = 24,
    onDeckWindowWeeks = DEFAULT_ON_DECK_WINDOW_WEEKS,
} = {}) => {
    const id = String(accountID || '').trim();
    const auth = String(token || '').trim();
    const base = String(uri || '').replace(/\/+$/, '');
    if (!id || !auth || !base || isPlexOwnerLocalAccountId(id)) return [];

    const params = new URLSearchParams({
        accountID: id,
        sort: 'viewedAt:desc',
        includeGuids: '1',
        'X-Plex-Container-Start': '0',
        'X-Plex-Container-Size': String(Math.min(200, Math.max(10, Number(containerSize) || 80))),
        'X-Plex-Token': auth,
    });
    const url = `${base}/status/sessions/history/all?${params.toString()}`;
    const extra = {};
    if (Number(timeoutMs) > 0 && typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        extra.signal = AbortSignal.timeout(Math.floor(Number(timeoutMs)));
    }
    const res = await fetchImpl(url, { headers, ...extra });
    if (!res?.ok) return [];
    const payload = await res.json().catch(() => null);
    return pickContinueWatchingFromHistory(asList(payload?.MediaContainer?.Metadata), {
        sectionKey,
        limit,
        onDeckWindowWeeks,
    });
};
