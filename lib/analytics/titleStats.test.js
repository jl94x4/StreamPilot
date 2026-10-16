import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateTitleHistory, rollupTitleChildren, synthesizeTitleChildren } from './titleStats.js';

test('aggregateTitleHistory rolls plays, hours, and unique users', () => {
    const out = aggregateTitleHistory([
        { user: 'Sam', userThumb: '/a', date: 1_700_000_000, duration: 3600 },
        { user: 'sam', userThumb: '/b', date: 1_700_086_400, duration: 1800 },
        { user: 'Frodo', date: 1_699_913_600, duration: 7200 },
    ]);
    assert.equal(out.stats.plays, 3);
    assert.equal(out.stats.uniqueUsers, 2);
    assert.equal(out.stats.totalSeconds, 12600);
    assert.equal(out.stats.lastWatchedAt, 1_700_086_400);
    assert.equal(out.users[0].user, 'sam');
    assert.equal(out.users[0].plays, 2);
    assert.equal(out.users[0].userThumb, '/b');
    assert.equal(out.users[1].user, 'Frodo');
    assert.ok(out.byMonth.length >= 1);
    assert.equal(out.byHour.length, 24);
    assert.deepEqual(out.byPlatform, [{ platform: 'Unknown', plays: 3 }]);
});

test('aggregateTitleHistory groups platform views and buckets the rest as Other', () => {
    const rows = [
        { user: 'A', date: 1, platform: 'tvOS', player: 'Living Room' },
        { user: 'B', date: 1, platform: 'tvOS' },
        { user: 'C', date: 1, platform: 'Android' },
        { user: 'D', date: 1, player: 'Chrome' },
        { user: 'E', date: 1, platform: 'Roku' },
        { user: 'F', date: 1, platform: 'Windows' },
        { user: 'G', date: 1, platform: 'iOS' },
        { user: 'H', date: 1, platform: 'Xbox' },
        { user: 'I', date: 1, platform: 'PlayStation' },
        { user: 'J', date: 1, platform: 'Linux' },
        { user: 'K', date: 1, platform: 'webOS' },
    ];
    const out = aggregateTitleHistory(rows);
    assert.equal(out.byPlatform[0].platform, 'tvOS');
    assert.equal(out.byPlatform[0].plays, 2);
    assert.equal(out.byPlatform.find((row) => row.platform === 'Chrome')?.plays, 1);
    assert.equal(out.byPlatform.at(-1).platform, 'Other');
    assert.equal(out.byPlatform.at(-1).plays, 2);
});

test('aggregateTitleHistory handles empty input', () => {
    const out = aggregateTitleHistory([]);
    assert.equal(out.stats.plays, 0);
    assert.equal(out.stats.uniqueUsers, 0);
    assert.equal(out.stats.lastWatchedAt, null);
    assert.deepEqual(out.users, []);
});

test('rollupTitleChildren counts season plays by parentRatingKey', () => {
    const children = [
        { ratingKey: '10', title: 'Season 1', type: 'season', index: 1, leafCount: 10 },
        { ratingKey: '20', title: 'Season 2', type: 'season', index: 2, leafCount: 10 },
    ];
    const history = [
        { user: 'A', date: 100, parentRatingKey: '10', seasonNumber: 1 },
        { user: 'B', date: 200, parentRatingKey: '10', seasonNumber: 1 },
        { user: 'A', date: 300, parentRatingKey: '20', seasonNumber: 2 },
    ];
    const out = rollupTitleChildren(children, history, { kind: 'season' });
    assert.equal(out[0].ratingKey, '10');
    assert.equal(out[0].plays, 2);
    assert.equal(out[0].uniqueUsers, 2);
    assert.equal(out[0].lastWatchedAt, 200);
    assert.equal(out[1].plays, 1);
    assert.equal(out[1].uniqueUsers, 1);
});

test('rollupTitleChildren counts episode plays by ratingKey', () => {
    const children = [
        { ratingKey: '101', title: 'Pilot', type: 'episode', index: 1, parentIndex: 1 },
        { ratingKey: '102', title: 'Next', type: 'episode', index: 2, parentIndex: 1 },
    ];
    const history = [
        { user: 'A', date: 50, ratingKey: '101', episodeNumber: 1 },
        { user: 'A', date: 60, ratingKey: '101', episodeNumber: 1 },
        { user: 'B', date: 70, ratingKey: '102', episodeNumber: 2 },
    ];
    const out = rollupTitleChildren(children, history, { kind: 'episode' });
    assert.equal(out[0].plays, 2);
    assert.equal(out[1].plays, 1);
    assert.equal(out[1].title, 'Next');
});

test('synthesizeTitleChildren builds seasons from history when Plex children are missing', () => {
    const history = [
        { user: 'A', parentRatingKey: '10', parentTitle: 'Season 1', seasonNumber: 1, date: 1 },
        { user: 'B', parentRatingKey: '20', seasonNumber: 2, date: 2 },
        { user: 'C', parentRatingKey: '10', seasonNumber: 1, date: 3 },
    ];
    const synthesized = synthesizeTitleChildren(history, { kind: 'season' });
    assert.equal(synthesized.length, 2);
    const rolled = rollupTitleChildren(synthesized, history, { kind: 'season' });
    assert.equal(rolled[0].plays, 2);
    assert.equal(rolled[1].title, 'Season 2');
    assert.equal(rolled[1].plays, 1);
});
