import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeProfileWrapUp, trimWrapUpForProfile, wrapUpFromHistoryItems, wrapUpDelta, summarizeWrapUpHistoryWindow, buildWrapUpCompare, formatWrapUpNewsletterHtml, historyViewedAtSeconds, filterHistoryByUnixWindow } from './wrapUp.js';

test('trimWrapUpForProfile keeps titles but strips peer history and obfuscates neighbours', () => {
    const trimmed = trimWrapUpForProfile({
        totalPlays: 40,
        topMovie: { title: 'Heat', plays: 8, thumbUrl: '/p/heat', plexAuthToken: 'secret' },
        recentHistory: [
            { title: 'Heat', viewedAt: 1, thumbUrl: '/p/heat' },
            { title: 'Heat', viewedAt: 2, episodeTitle: 'Again' },
            { title: 'The Bear', viewedAt: 3 },
            { title: 'Secret late night', viewedAt: 4 },
            { title: 'Dune', viewedAt: 5 },
            { title: 'Extra', viewedAt: 6 },
        ],
        heatmapData: { '2026-01-01': 9 },
        leaderboardNeighbourhood: [
            { rank: 2, username: 'Sam', accountId: '12', isMe: false, plays: 10 },
            { rank: 3, username: 'Jay', accountId: '42', isMe: true, plays: 8 },
        ],
        hourDistribution: new Array(24).fill(1),
        allLibraries: [{ title: 'Hidden', plays: 9 }],
    }, { isSelf: false, viewerIsAdmin: false, obfuscate: true });

    assert.equal(trimmed.topMovie.title, 'Heat');
    assert.equal(trimmed.topMovie.plexAuthToken, undefined);
    assert.deepEqual(trimmed.recentHistory.map((row) => row.title), ['Heat', 'The Bear', 'Secret late night', 'Dune']);
    assert.equal(trimmed.heatmapData, null);
    assert.equal(trimmed.allLibraries, undefined);
    assert.equal(trimmed.leaderboardNeighbourhood[0].username, 'Viewer 2');
    assert.equal(trimmed.leaderboardNeighbourhood[0].accountId, undefined);
    assert.equal(trimmed.leaderboardNeighbourhood[1].username, 'Jay');
    assert.equal(trimmed.leaderboardNeighbourhood[1].accountId, '42');
});

test('trimWrapUpForProfile keeps full history for self', () => {
    const trimmed = trimWrapUpForProfile({
        recentHistory: [{ title: 'A' }, { title: 'B' }, { title: 'C' }],
        heatmapData: { '2026-01-01': 2 },
    }, { isSelf: true, obfuscate: false });
    assert.equal(trimmed.recentHistory.length, 3);
    assert.deepEqual(trimmed.heatmapData, { '2026-01-01': 2 });
});

test('mergeProfileWrapUp prefers personal titles and snapshot XP rank', () => {
    const merged = mergeProfileWrapUp(
        { totalPlays: 4, hoursWatched: 9, leaderboardRank: 2, leaderboardSource: 'achievements' },
        { totalPlays: 40, topMovie: { title: 'Heat' }, hoursWatched: 0 },
        8400,
    );
    assert.equal(merged.totalPlays, 40);
    assert.equal(merged.hoursWatched, 9);
    assert.equal(merged.topMovie.title, 'Heat');
    assert.equal(merged.leaderboardRank, 2);
    assert.equal(merged.myXp, 8400);
});

test('wrapUpFromHistoryItems is subject-scoped from played items', () => {
    const now = Math.floor(Date.now() / 1000);
    const wrap = wrapUpFromHistoryItems([
        { type: 'movie', title: 'Heat', viewedAt: now - 100, ratingKey: 'm1', percentComplete: 100 },
        { type: 'movie', title: 'Heat', viewedAt: now - 50, ratingKey: 'm1', percentComplete: 100 },
        { type: 'episode', title: 'Pilot', grandparentTitle: 'The Bear', grandparentKey: 's1', viewedAt: now - 10, ratingKey: 'e1', percentComplete: 100 },
    ]);
    assert.equal(wrap.totalPlays, 3);
    assert.equal(wrap.moviesCount, 2);
    assert.equal(wrap.showsCount, 1);
    assert.equal(wrap.topMovie.title, 'Heat');
    assert.equal(wrap.topBinge.title, 'The Bear');
    assert.equal(wrap.recentHistory[0].title, 'The Bear');
    assert.equal(wrap.period, 'last365');
});

test('wrapUpDelta reports percent vs the previous window', () => {
    assert.deepEqual(wrapUpDelta(120, 100), { current: 120, previous: 100, absolute: 20, percent: 20 });
    assert.equal(wrapUpDelta(10, 0).percent, null);
    assert.equal(wrapUpDelta(10, 0).absolute, 10);
});

test('summarizeWrapUpHistoryWindow counts titles in a slice', () => {
    const summary = summarizeWrapUpHistoryWindow([
        { type: 'movie', title: 'Heat', ratingKey: 'm1' },
        { type: 'movie', title: 'Heat', ratingKey: 'm1' },
        { type: 'episode', grandparentTitle: 'The Bear', grandparentKey: 's1' },
    ]);
    assert.equal(summary.totalPlays, 3);
    assert.equal(summary.moviesCount, 2);
    assert.equal(summary.topMovie.title, 'Heat');
    assert.equal(summary.topBinge.title, 'The Bear');
});

test('buildWrapUpCompare attaches previous-period deltas', () => {
    const compare = buildWrapUpCompare(
        { totalPlays: 40, uniqueTitles: 12, moviesCount: 10, showsCount: 30, musicCount: 0, topMovie: { title: 'Heat', plays: 8 } },
        { totalPlays: 20, uniqueTitles: 8, moviesCount: 4, showsCount: 16, musicCount: 0, topMovie: { title: 'Dune', plays: 5 } },
        30,
    );
    assert.equal(compare.previousPeriodDays, '30');
    assert.equal(compare.totalPlays.absolute, 20);
    assert.equal(compare.totalPlays.percent, 100);
    assert.equal(compare.previous.topMovie.title, 'Dune');
});

test('wrapUpFromHistoryItems compares the prior year when history reaches back', () => {
    const now = Math.floor(Date.now() / 1000);
    const wrap = wrapUpFromHistoryItems([
        { type: 'movie', title: 'Heat', viewedAt: now - 100, ratingKey: 'm1' },
        { type: 'movie', title: 'Dune', viewedAt: now - (400 * 24 * 60 * 60), ratingKey: 'm2' },
        { type: 'movie', title: 'Dune', viewedAt: now - (410 * 24 * 60 * 60), ratingKey: 'm2' },
    ]);
    assert.equal(wrap.totalPlays, 1);
    assert.equal(wrap.compare.previous.totalPlays, 2);
    assert.equal(wrap.compare.totalPlays.absolute, -1);
});

test('trimWrapUpForProfile keeps compare totals', () => {
    const trimmed = trimWrapUpForProfile({
        compare: { previousPeriodDays: '30', totalPlays: { current: 10, previous: 8, absolute: 2, percent: 25 } },
    }, { isSelf: true });
    assert.equal(trimmed.compare.previousPeriodDays, '30');
    assert.equal(trimmed.compare.totalPlays.absolute, 2);
});

test('buildWrapUpCompare records title swaps and firsts from history items', () => {
    const currentItems = [
        { type: 'movie', title: 'Heat', ratingKey: 'm1', viewedAt: 1_700_000_000, duration: 7200, videoResolution: '4k', Genre: [{ tag: 'Crime' }] },
        { type: 'movie', title: 'Heat', ratingKey: 'm1', viewedAt: 1_700_010_000, duration: 7200, videoResolution: '4k' },
        { type: 'episode', grandparentTitle: 'The Bear', grandparentKey: 's1', viewedAt: 1_700_020_000, duration: 1800 },
        { type: 'episode', grandparentTitle: 'The Bear', grandparentKey: 's1', viewedAt: 1_700_020_100, duration: 1800 },
        { type: 'episode', grandparentTitle: 'The Bear', grandparentKey: 's1', viewedAt: 1_700_020_200, duration: 1800 },
        { type: 'episode', grandparentTitle: 'The Bear', grandparentKey: 's1', viewedAt: 1_700_020_300, duration: 1800 },
    ];
    const previousItems = [
        { type: 'movie', title: 'Dune', ratingKey: 'm2', viewedAt: 1_690_000_000, duration: 9000, videoResolution: '1080' },
        { type: 'episode', grandparentTitle: 'Severance', grandparentKey: 's0', viewedAt: 1_690_000_100, duration: 1800 },
    ];
    const compare = buildWrapUpCompare(
        summarizeWrapUpHistoryWindow(currentItems),
        summarizeWrapUpHistoryWindow(previousItems),
        30,
        { currentItems, previousItems, dayOfWeekCounts: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 8, 5: 0, 6: 0 } },
    );
    assert.equal(compare.swaps.topMovie.from.title, 'Dune');
    assert.equal(compare.swaps.topMovie.to.title, 'Heat');
    assert.equal(compare.swaps.topBinge.from.title, 'Severance');
    assert.equal(compare.highlights.newTitles, 2);
    assert.equal(compare.highlights.first4k, true);
    assert.equal(compare.highlights.newGenre, 'Crime');
    assert.ok(compare.highlights.longestNight.plays >= 4);
    assert.equal(compare.highlights.dominantDay.day, 'Thursday');
});

test('formatWrapUpNewsletterHtml includes the month blurb and previous binge', () => {
    const html = formatWrapUpNewsletterHtml({
        totalPlays: 40,
        topBinge: { title: 'The Bear' },
        topMovie: { title: 'Heat' },
        compare: {
            totalPlays: { current: 40, previous: 20, absolute: 20, percent: 100 },
            swaps: { topBinge: { from: { title: 'Severance' }, to: { title: 'The Bear' } } },
        },
    });
    assert.match(html, /Your month/);
    assert.match(html, /The Bear/);
    assert.match(html, /was Severance/);
    assert.match(html, /\+100% vs last month/);
});

test('trimWrapUpForProfile keeps compare swaps', () => {
    const trimmed = trimWrapUpForProfile({
        compare: {
            previousPeriodDays: '30',
            totalPlays: { current: 10, previous: 8, absolute: 2, percent: 25 },
            swaps: { topMovie: { from: { title: 'Dune' }, to: { title: 'Heat' } } },
        },
    }, { isSelf: true });
    assert.equal(trimmed.compare.swaps.topMovie.from.title, 'Dune');
});

test('historyViewedAtSeconds normalizes millisecond timestamps', () => {
    assert.equal(historyViewedAtSeconds(1_700_000_000), 1_700_000_000);
    assert.equal(historyViewedAtSeconds(1_700_000_000_000), 1_700_000_000);
    assert.equal(historyViewedAtSeconds('1700000000000'), 1_700_000_000);
});

test('filterHistoryByUnixWindow slices periods from one history blob', () => {
    const now = Math.floor(Date.now() / 1000);
    const items = [
        { viewedAt: now - (2 * 86400) },
        { viewedAt: now - (20 * 86400) },
        { viewedAt: now - (200 * 86400) },
        { viewedAt: (now - (3 * 86400)) * 1000 },
    ];
    assert.equal(filterHistoryByUnixWindow(items, { startSec: now - (7 * 86400) }).length, 2);
    assert.equal(filterHistoryByUnixWindow(items, { startSec: now - (30 * 86400) }).length, 3);
    assert.equal(filterHistoryByUnixWindow(items, { startSec: now - (365 * 86400) }).length, 4);
});

test('wrapUpFromHistoryItems ignores plays outside the last year when timestamps are ms', () => {
    const nowMs = Date.now();
    const wrap = wrapUpFromHistoryItems([
        { type: 'movie', title: 'Heat', viewedAt: nowMs, ratingKey: 'm1' },
        { type: 'movie', title: 'Old', viewedAt: nowMs - (800 * 24 * 60 * 60 * 1000), ratingKey: 'm2' },
    ]);
    assert.equal(wrap.totalPlays, 1);
    assert.equal(wrap.topMovie.title, 'Heat');
});
