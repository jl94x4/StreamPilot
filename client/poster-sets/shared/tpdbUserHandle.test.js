import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTpdbUserHandle, isTpdbRecentUrl, isTpdbFeedUrl } from './tpdbUserHandle.js';

test('parseTpdbUserHandle reads TPDB user URLs', () => {
    assert.equal(
        parseTpdbUserHandle('https://theposterdb.com/user/fwlolx'),
        'fwlolx',
    );
    assert.equal(
        parseTpdbUserHandle('https://theposterdb.com/user/fwlolx?section=uploads&page=2'),
        'fwlolx',
    );
    assert.equal(parseTpdbUserHandle('@fwlolx'), 'fwlolx');
    assert.equal(parseTpdbUserHandle('fwlolx'), 'fwlolx');
});

test('parseTpdbUserHandle ignores set URLs and numeric ids', () => {
    assert.equal(parseTpdbUserHandle('https://theposterdb.com/set/362735'), null);
    assert.equal(parseTpdbUserHandle('https://theposterdb.com/poster/1'), null);
    assert.equal(parseTpdbUserHandle('362735'), null);
    assert.equal(parseTpdbUserHandle('https://mediux.pro/sets/24522'), null);
    assert.equal(parseTpdbUserHandle('https://theposterdb.com/recent'), null);
    assert.equal(parseTpdbUserHandle(''), null);
});

test('isTpdbRecentUrl matches TPDB recently-added pages', () => {
    assert.equal(isTpdbRecentUrl('https://theposterdb.com/recent'), true);
    assert.equal(isTpdbRecentUrl('https://theposterdb.com/recent?page=3'), true);
    assert.equal(isTpdbRecentUrl('https://www.theposterdb.com/recent'), true);
    assert.equal(isTpdbRecentUrl('https://theposterdb.com/user/fwlolx'), false);
    assert.equal(isTpdbRecentUrl('https://theposterdb.com/set/1'), false);
    assert.equal(isTpdbRecentUrl('https://theposterdb.com/feed'), false);
    assert.equal(isTpdbRecentUrl('recent'), false);
    assert.equal(isTpdbRecentUrl(''), false);
});

test('isTpdbFeedUrl matches TPDB following-feed pages', () => {
    assert.equal(isTpdbFeedUrl('https://theposterdb.com/feed'), true);
    assert.equal(isTpdbFeedUrl('https://theposterdb.com/feed?page=2'), true);
    assert.equal(isTpdbFeedUrl('https://www.theposterdb.com/feed'), true);
    assert.equal(isTpdbFeedUrl('https://theposterdb.com/recent'), false);
    assert.equal(isTpdbFeedUrl('https://theposterdb.com/user/fwlolx'), false);
    assert.equal(isTpdbFeedUrl('https://theposterdb.com/feedback'), false);
    assert.equal(isTpdbFeedUrl(''), false);
});
