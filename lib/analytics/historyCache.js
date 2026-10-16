/**
 * Incremental Tautulli history for analytics.
 * Scheduled rebuilds page newest-first until they hit the previous watermark
 * instead of re-downloading the 75k-row cap every 30 minutes.
 */

export const ANALYTICS_HISTORY_FULL_REFRESH_MS = 24 * 60 * 60 * 1000;
export const ANALYTICS_HISTORY_CACHE_VERSION = 1;

export const analyticsHistoryItemKey = (item = {}) => {
    if (item?.tautulliId != null && String(item.tautulliId)) return `t:${item.tautulliId}`;
    const viewedAt = Number(item?.viewedAt) || 0;
    const account = String(item?.accountID || '');
    const ratingKey = String(item?.ratingKey || '');
    const title = String(item?.title || '');
    return `f:${viewedAt}:${account}:${ratingKey}:${title}`;
};

export const newestAnalyticsHistoryViewedAt = (items = []) => {
    let newest = 0;
    for (const item of Array.isArray(items) ? items : []) {
        const viewedAt = Number(item?.viewedAt) || 0;
        if (viewedAt > newest) newest = viewedAt;
    }
    return newest;
};

export const mergeAnalyticsHistoryItems = (existing = [], incoming = [], { maxItems = 75000 } = {}) => {
    const seen = new Set();
    const merged = [];
    for (const item of [...(incoming || []), ...(existing || [])]) {
        if (!item) continue;
        const key = analyticsHistoryItemKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(item);
        if (merged.length >= maxItems) break;
    }
    return merged;
};

export const shouldFullRefreshAnalyticsHistory = (cache, {
    now = Date.now(),
    force = false,
    source = 'tautulli',
} = {}) => {
    if (force) return true;
    if (!cache || cache.version !== ANALYTICS_HISTORY_CACHE_VERSION) return true;
    if (String(cache.source || '') !== String(source || '')) return true;
    if (!Array.isArray(cache.items) || cache.items.length === 0) return true;
    const fullFetchedAt = Number(cache.fullFetchedAt) || 0;
    if (fullFetchedAt <= 0) return true;
    return (now - fullFetchedAt) >= ANALYTICS_HISTORY_FULL_REFRESH_MS;
};
