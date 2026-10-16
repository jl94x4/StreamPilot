import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ANALYTICS_HISTORY_CACHE_VERSION,
    ANALYTICS_HISTORY_FULL_REFRESH_MS,
    analyticsHistoryItemKey,
    mergeAnalyticsHistoryItems,
    newestAnalyticsHistoryViewedAt,
    shouldFullRefreshAnalyticsHistory,
} from './historyCache.js';

test('analyticsHistoryItemKey prefers tautulliId', () => {
    assert.equal(analyticsHistoryItemKey({ tautulliId: 9, title: 'A' }), 't:9');
    assert.equal(
        analyticsHistoryItemKey({ viewedAt: 10, accountID: '1', ratingKey: '2', title: 'Dune' }),
        'f:10:1:2:Dune',
    );
});

test('mergeAnalyticsHistoryItems prepends newer rows and dedupes', () => {
    const existing = [
        { tautulliId: '1', viewedAt: 100, title: 'Old' },
        { tautulliId: '2', viewedAt: 90, title: 'Older' },
    ];
    const incoming = [
        { tautulliId: '3', viewedAt: 110, title: 'New' },
        { tautulliId: '1', viewedAt: 100, title: 'Old again' },
    ];
    const merged = mergeAnalyticsHistoryItems(existing, incoming, { maxItems: 10 });
    assert.deepEqual(merged.map((item) => item.tautulliId), ['3', '1', '2']);
});

test('mergeAnalyticsHistoryItems respects the safety cap', () => {
    const existing = [{ tautulliId: '1' }, { tautulliId: '2' }, { tautulliId: '3' }];
    const incoming = [{ tautulliId: '4' }];
    const merged = mergeAnalyticsHistoryItems(existing, incoming, { maxItems: 3 });
    assert.equal(merged.length, 3);
    assert.equal(merged[0].tautulliId, '4');
});

test('newestAnalyticsHistoryViewedAt reads the max timestamp', () => {
    assert.equal(newestAnalyticsHistoryViewedAt([{ viewedAt: 5 }, { viewedAt: 12 }, { viewedAt: 8 }]), 12);
    assert.equal(newestAnalyticsHistoryViewedAt([]), 0);
});

test('shouldFullRefreshAnalyticsHistory keeps incremental snapshots for 24h', () => {
    const now = 1_700_000_000_000;
    const cache = {
        version: ANALYTICS_HISTORY_CACHE_VERSION,
        source: 'tautulli',
        fullFetchedAt: now - 60 * 60 * 1000,
        items: [{ tautulliId: '1' }],
    };
    assert.equal(shouldFullRefreshAnalyticsHistory(cache, { now }), false);
    assert.equal(shouldFullRefreshAnalyticsHistory(cache, { now, force: true }), true);
    assert.equal(shouldFullRefreshAnalyticsHistory(cache, { now: now + ANALYTICS_HISTORY_FULL_REFRESH_MS + 1 }), true);
    assert.equal(shouldFullRefreshAnalyticsHistory(null, { now }), true);
});
