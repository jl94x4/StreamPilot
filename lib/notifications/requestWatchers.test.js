import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
    watcherTitleKey,
    notifyEligibility,
    summarizeOtherRequesters,
    isActivePortalRequest,
    createRequestWatcherStore,
} from './requestWatchers.js';

test('watcherTitleKey covers movie, tv, and music albums', () => {
    assert.equal(watcherTitleKey({ mediaType: 'movie', tmdbId: 550 }), 'movie:550');
    assert.equal(watcherTitleKey({ mediaType: 'tv', mediaId: 1396 }), 'tv:1396');
    assert.equal(watcherTitleKey({ mediaType: 'music', mbid: 'artist-1' }), 'music:artist-1');
    assert.equal(
        watcherTitleKey({ mediaType: 'music', mbid: 'artist-1', albumMbid: 'album-9' }),
        'music:artist-1:album:album-9',
    );
});

test('notifyEligibility allows follow when someone else has an active request', () => {
    const records = [
        { id: '1', userId: 'alice', status: 1 },
    ];
    const eligible = notifyEligibility({
        viewerId: 'bob',
        records,
        mediaStatus: 2,
    });
    assert.equal(eligible.canNotify, true);
    assert.equal(eligible.isWatching, false);

    const own = notifyEligibility({
        viewerId: 'alice',
        records,
        mediaStatus: 2,
    });
    assert.equal(own.canNotify, false);

    const available = notifyEligibility({
        viewerId: 'bob',
        records,
        mediaStatus: 5,
    });
    assert.equal(available.canNotify, false);
});

test('summarizeOtherRequesters returns other member display names', () => {
    const summary = summarizeOtherRequesters(
        [
            { userId: 'alice', status: 1, displayName: 'Alice' },
            { userId: 'bob', status: 1, displayName: 'Bob' },
        ],
        'bob',
    );
    assert.equal(summary.requestedByName, 'Alice');
    assert.equal(summary.requestedByCount, 1);
});

test('summarizeOtherRequesters skips emails and uses the users list', () => {
    const summary = summarizeOtherRequesters(
        [{ userId: 'u1', status: 2, meta: { requestedByName: 'hidden@example.com' } }],
        'viewer',
        [{ id: 'u1', username: 'also@example.com', displayName: 'Sam' }],
    );
    assert.equal(summary.requestedByName, 'Sam');
    assert.equal(summary.requestedByCount, 1);
});

test('summarizeOtherRequesters skips the viewer when ids differ', () => {
    const summary = summarizeOtherRequesters(
        [{ userId: 'plex-1', status: 1, displayName: 'Me' }],
        'portal-1',
        [{ id: 'portal-1', plexId: 'plex-1', displayName: 'Me' }],
    );
    assert.equal(summary.requestedByName, null);
    assert.equal(summary.requestedByCount, 0);
});

test('summarizeOtherRequesters anonymizes missing names', () => {
    const summary = summarizeOtherRequesters(
        [{ userId: '__other__', status: 1 }],
        'bob',
    );
    assert.equal(summary.requestedByName, null);
    assert.equal(summary.requestedByCount, 1);
});

test('isActivePortalRequest skips declined and fully available rows', () => {
    assert.equal(isActivePortalRequest({ status: 1 }), true);
    assert.equal(isActivePortalRequest({ status: 3 }), false);
    assert.equal(isActivePortalRequest({ status: 2, meta: { mediaStatus: 5 } }), false);
});

test('createRequestWatcherStore subscribe and unsubscribe', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'smp-watchers-'));
    const store = createRequestWatcherStore(path.join(dir, 'watchers.json'));
    const key = 'movie:550';
    const added = await store.setWatching(key, 'bob', true);
    assert.equal(added.isWatching, true);
    assert.equal(await store.isWatching(key, 'bob'), true);
    const removed = await store.setWatching(key, 'bob', false);
    assert.equal(removed.isWatching, false);
    assert.deepEqual(await store.listWatcherIds(key), []);
});
