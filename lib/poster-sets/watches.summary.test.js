import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_WATCHES, summarizeWatchForApi, watchStats } from './watches.js';

test('Watching cap is large enough for a full library, not a toy list', () => {
    assert.equal(MAX_WATCHES, 2000);
});

test('summarizeWatchForApi keeps list fields and drops fingerprint arrays', () => {
    const summary = summarizeWatchForApi({
        id: 'w1',
        enabled: true,
        provider: 'mediux',
        url: 'https://mediux.pro/sets/1',
        setId: '1',
        title: 'Severance',
        user: 'foo',
        tmdbId: '123',
        tvdbId: null,
        thumbUrl: 'https://example/t.png',
        setKind: 'show',
        mediuxFilters: ['show_cover'],
        knownAssetIds: ['a', 'b', 'c'],
        appliedAssetIds: ['a'],
        lastMatchedAssetIds: ['a', 'b'],
        lastCheckedAt: '2026-01-01T00:00:00.000Z',
        lastError: null,
        lastNewCount: 2,
        plexHint: { ratingKey: '99', title: 'Severance' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
    });
    assert.equal(summary.knownAssetCount, 3);
    assert.equal(summary.title, 'Severance');
    assert.equal(summary.tmdbId, '123');
    assert.equal('knownAssetIds' in summary, false);
    assert.equal('appliedAssetIds' in summary, false);
    assert.equal('lastMatchedAssetIds' in summary, false);
});

test('watchStats reports the current cap', () => {
    const stats = watchStats([
        { id: '1', enabled: true },
        { id: '2', enabled: false, lastError: 'nope' },
        { id: '3', enabled: true, lastError: 'Waiting for title in library — will auto-apply when available.' },
    ]);
    assert.equal(stats.total, 3);
    assert.equal(stats.enabled, 2);
    assert.equal(stats.errored, 1);
    assert.equal(stats.max, MAX_WATCHES);
});
