import assert from 'node:assert/strict';
import test from 'node:test';
import {
    resolveDailyRefreshSkipMs,
    titleCacheNeedsRevalidate,
    TPDB_REVALIDATE_MS,
} from './tpdbCache.js';

test('resolveDailyRefreshSkipMs uses 85% of multi-hour interval', () => {
    assert.equal(resolveDailyRefreshSkipMs(0), TPDB_REVALIDATE_MS);
    assert.equal(resolveDailyRefreshSkipMs(24), TPDB_REVALIDATE_MS);
    assert.equal(resolveDailyRefreshSkipMs(6), Math.floor(6 * 3600_000 * 0.85));
    assert.equal(resolveDailyRefreshSkipMs(1), Math.floor(1 * 3600_000 * 0.85));
});

test('titleCacheNeedsRevalidate respects custom interval', () => {
    const now = Date.now();
    const fresh = {
        lastRevalidatedAt: new Date(now - 60_000).toISOString(),
    };
    const stale = {
        lastRevalidatedAt: new Date(now - 10 * 3600_000).toISOString(),
    };
    assert.equal(titleCacheNeedsRevalidate(fresh, 6 * 3600_000), false);
    assert.equal(titleCacheNeedsRevalidate(stale, 6 * 3600_000), true);
    assert.equal(titleCacheNeedsRevalidate(null), true);
    assert.equal(titleCacheNeedsRevalidate({}), true);
});
