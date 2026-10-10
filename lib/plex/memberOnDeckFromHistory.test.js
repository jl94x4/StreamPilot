import assert from 'node:assert/strict';
import test from 'node:test';
import {
    continueWatchingHistoryKey,
    fetchMemberOnDeckFromHistory,
    filterWithinOnDeckWindow,
    historyItemIsContinueWatching,
    isWithinOnDeckWindow,
    parseOnDeckWindowWeeks,
    pickContinueWatchingFromHistory,
} from './memberOnDeckFromHistory.js';

test('historyItemIsContinueWatching keeps mid-progress movies and episodes', () => {
    assert.equal(historyItemIsContinueWatching({
        type: 'movie',
        ratingKey: '1',
        duration: 100000,
        viewOffset: 40000,
    }), true);
    assert.equal(historyItemIsContinueWatching({
        type: 'episode',
        ratingKey: '2',
        percentComplete: 55,
    }), true);
    assert.equal(historyItemIsContinueWatching({
        type: 'movie',
        ratingKey: '3',
        percentComplete: 100,
    }), false);
    assert.equal(historyItemIsContinueWatching({
        type: 'show',
        ratingKey: '4',
    }), false);
});

test('parseOnDeckWindowWeeks reads Plex OnDeckWindow prefs', () => {
    assert.equal(parseOnDeckWindowWeeks({
        MediaContainer: { Setting: [{ id: 'OnDeckWindow', value: '36' }] },
    }), 36);
    assert.equal(parseOnDeckWindowWeeks({
        MediaContainer: { Setting: { id: 'ondeckwindow', value: '8' } },
    }), 8);
    assert.equal(parseOnDeckWindowWeeks({ MediaContainer: { Setting: [] } }), 16);
});

test('isWithinOnDeckWindow matches Plex weeks cutoff', () => {
    const now = 1_700_000_000;
    const week = 7 * 24 * 60 * 60;
    assert.equal(isWithinOnDeckWindow({ lastViewedAt: now - (35 * week) }, 36, now), true);
    assert.equal(isWithinOnDeckWindow({ viewedAt: now - (37 * week) }, 36, now), false);
    assert.equal(isWithinOnDeckWindow({ ratingKey: '1' }, 36, now), true);
});

test('pickContinueWatchingFromHistory drops titles older than OnDeckWindow', () => {
    const now = 1_700_000_000;
    const week = 7 * 24 * 60 * 60;
    const picked = pickContinueWatchingFromHistory([
        {
            type: 'movie',
            ratingKey: 'fresh',
            percentComplete: 40,
            viewedAt: now - (2 * week),
        },
        {
            type: 'movie',
            ratingKey: 'stale',
            percentComplete: 40,
            viewedAt: now - (40 * week),
        },
    ], { onDeckWindowWeeks: 36, nowSec: now });
    assert.deepEqual(picked.map((row) => row.ratingKey), ['fresh']);
});

test('filterWithinOnDeckWindow keeps mapped player items by lastViewedAt', () => {
    const now = 1_700_000_000;
    const week = 7 * 24 * 60 * 60;
    const filtered = filterWithinOnDeckWindow([
        { ratingKey: 'a', lastViewedAt: now - week },
        { ratingKey: 'b', lastViewedAt: now - (50 * week) },
    ], 36, now);
    assert.deepEqual(filtered.map((row) => row.ratingKey), ['a']);
});

test('filterWithinOnDeckWindow drops fully watched progress bars', () => {
    const now = 1_700_000_000;
    const filtered = filterWithinOnDeckWindow([
        { ratingKey: 'mid', lastViewedAt: now, durationMs: 1_500_000, viewOffsetMs: 400_000 },
        { ratingKey: 'full', lastViewedAt: now, durationMs: 1_500_000, viewOffsetMs: 1_490_000 },
        { ratingKey: 'ninety', lastViewedAt: now, durationMs: 1_000_000, viewOffsetMs: 910_000 },
        { ratingKey: 'next-up', lastViewedAt: now, durationMs: 1_500_000, viewOffsetMs: 0 },
    ], 36, now);
    assert.deepEqual(filtered.map((row) => row.ratingKey), ['mid', 'next-up']);
});

test('pickContinueWatchingFromHistory keeps one card per show and skips finished titles', () => {
    const picked = pickContinueWatchingFromHistory([
        {
            type: 'episode',
            ratingKey: 'ep-new',
            grandparentRatingKey: 'show-1',
            grandparentTitle: "Clarkson's Farm",
            percentComplete: 100,
            viewedAt: 200,
        },
        {
            type: 'episode',
            ratingKey: 'ep-old',
            grandparentRatingKey: 'show-1',
            grandparentTitle: "Clarkson's Farm",
            percentComplete: 40,
            viewedAt: 100,
        },
        {
            type: 'movie',
            ratingKey: 'movie-1',
            title: 'Heat',
            percentComplete: 30,
        },
        {
            type: 'movie',
            ratingKey: 'movie-2',
            title: 'Done',
            percentComplete: 98,
        },
    ]);
    assert.deepEqual(picked.map((row) => row.ratingKey), ['movie-1']);
});

test('pickContinueWatchingFromHistory can filter by library section', () => {
    const picked = pickContinueWatchingFromHistory([
        { type: 'movie', ratingKey: 'm1', librarySectionID: '2', percentComplete: 40 },
        { type: 'movie', ratingKey: 'm2', librarySectionID: '5', percentComplete: 40 },
        { type: 'movie', ratingKey: 'm3', percentComplete: 40 },
    ], { sectionKey: '5' });
    assert.deepEqual(picked.map((row) => row.ratingKey), ['m2', 'm3']);
});

test('continueWatchingHistoryKey groups episodes by show', () => {
    assert.equal(continueWatchingHistoryKey({
        type: 'episode',
        ratingKey: '9',
        grandparentRatingKey: 'show-1',
    }), 'show:show-1');
    assert.equal(continueWatchingHistoryKey({
        type: 'movie',
        ratingKey: '12',
    }), 'item:12');
});

test('fetchMemberOnDeckFromHistory reads the friend account and ignores the owner account', async () => {
    const urls = [];
    const friend = await fetchMemberOnDeckFromHistory({
        uri: 'http://127.0.0.1:32400',
        token: 'server-token',
        accountID: '42',
        fetchImpl: async (url) => {
            urls.push(String(url));
            return {
                ok: true,
                json: async () => ({
                    MediaContainer: {
                        Metadata: [{
                            type: 'movie',
                            ratingKey: '77',
                            title: 'Heat',
                            percentComplete: 40,
                        }],
                    },
                }),
            };
        },
    });
    assert.equal(friend[0].ratingKey, '77');
    assert.match(urls[0], /accountID=42/);
    assert.match(urls[0], /server-token/);

    const owner = await fetchMemberOnDeckFromHistory({
        uri: 'http://127.0.0.1:32400',
        token: 'server-token',
        accountID: '1',
        fetchImpl: async () => {
            throw new Error('owner history must not be fetched');
        },
    });
    assert.deepEqual(owner, []);
});
