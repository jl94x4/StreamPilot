import test from 'node:test';
import assert from 'node:assert/strict';
import {
    listNewlyCompletedSeasons,
    shouldNotifyNewEpisode,
    shouldSendLifecycle,
    isPortalAdminUser,
    listPortalAdminUsers,
    notifyAdminPendingRequest,
} from './requestLifecycle.js';

test('listNewlyCompletedSeasons skips already stamped seasons', () => {
    const nums = listNewlyCompletedSeasons(
        {
            mediaType: 'tv',
            seasons: 'all',
            meta: { notifiedSeasonAvailable: { '1': '2026-01-01T00:00:00.000Z' } },
        },
        {
            mediaInfo: {
                seasons: [
                    { seasonNumber: 1, status: 5 },
                    { seasonNumber: 2, status: 5 },
                    { seasonNumber: 3, status: 4 },
                ],
            },
        },
    );
    assert.deepEqual(nums, [2]);
});

test('listNewlyCompletedSeasons respects requested season list', () => {
    const nums = listNewlyCompletedSeasons(
        {
            mediaType: 'tv',
            seasons: [2, 3],
            meta: {},
        },
        {
            mediaInfo: {
                seasons: [
                    { seasonNumber: 1, status: 5 },
                    { seasonNumber: 2, status: 5 },
                ],
            },
        },
    );
    assert.deepEqual(nums, [2]);
});

test('shouldNotifyNewEpisode seeds baseline without notifying', () => {
    const result = shouldNotifyNewEpisode(
        { mediaType: 'tv', meta: { mediaStatus: 4 } },
        { sonarrLibraryStatus: { episodeFileCount: 12 } },
    );
    assert.equal(result.ok, false);
    assert.equal(result.seed, true);
    assert.equal(result.nextCount, 12);
});

test('shouldNotifyNewEpisode fires when count increases', () => {
    const result = shouldNotifyNewEpisode(
        { mediaType: 'tv', meta: { mediaStatus: 4, lastEpisodeFileCount: 10 } },
        { sonarrLibraryStatus: { episodeFileCount: 12 } },
        Date.now(),
    );
    assert.equal(result.ok, true);
    assert.equal(result.added, 2);
});

test('shouldNotifyNewEpisode respects cooldown', () => {
    const now = Date.now();
    const result = shouldNotifyNewEpisode(
        {
            mediaType: 'tv',
            meta: {
                mediaStatus: 4,
                lastEpisodeFileCount: 10,
                lastNewEpisodeNotifyAt: new Date(now - 60_000).toISOString(),
            },
        },
        { sonarrLibraryStatus: { episodeFileCount: 12 } },
        now,
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'cooldown');
});

test('shouldSendLifecycle defaults new episode off and approved on', () => {
    const config = {};
    assert.equal(shouldSendLifecycle(config, {}, 'approved', 'email'), true);
    assert.equal(shouldSendLifecycle(config, {}, 'episode', 'email'), false);
    assert.equal(shouldSendLifecycle(config, { notifyNewEpisodeEmail: true }, 'episode', 'email'), true);
    assert.equal(shouldSendLifecycle(config, { notifyRequestApprovedEmail: false }, 'approved', 'email'), false);
});

test('isPortalAdminUser matches isAdmin and config.adminPlexId', () => {
    assert.equal(isPortalAdminUser({ id: 'm1' }, { adminPlexId: '999' }), false);
    assert.equal(isPortalAdminUser({ id: 'a1', isAdmin: true }, {}), true);
    assert.equal(isPortalAdminUser({ id: '999', plexId: '999' }, { adminPlexId: '999' }), true);
    assert.equal(isPortalAdminUser({ id: 'u1', plexId: '999' }, { adminPlexId: '999' }), true);
    assert.equal(isPortalAdminUser({ id: '999' }, { adminPlexId: '999', mediaServerType: 'jellyfin' }), false);
});

test('listPortalAdminUsers includes the server owner without an isAdmin flag', () => {
    const users = [
        { id: 'm1', username: 'member' },
        { id: '999', plexId: '999', username: 'owner' },
        { id: 'a2', isAdmin: true, username: 'staff' },
    ];
    const admins = listPortalAdminUsers(users, { adminPlexId: '999' });
    assert.deepEqual(admins.map((u) => u.id), ['999', 'a2']);
});

test('notifyAdminPendingRequest sends web push to admins and the server owner', async () => {
    const inApp = [];
    const pushes = [];
    const notified = await notifyAdminPendingRequest({
        config: { webPushEnabled: true, adminPlexId: '999' },
        record: { id: 'r1', title: 'Dune', mediaType: 'movie' },
        loadUsers: async () => [
            { id: 'm1', username: 'member' },
            { id: '999', plexId: '999', username: 'owner' },
            { id: 'a2', isAdmin: true, username: 'staff', notifyWebPush: false },
        ],
        createInApp: async (item) => {
            inApp.push(item);
            return { id: `n-${item.userId}` };
        },
        sendWebPush: async (userId, payload) => {
            pushes.push({ userId, payload });
            return { sent: 1 };
        },
        alertRuleEnabled: () => false,
    });
    assert.equal(notified, true);
    assert.deepEqual(inApp.map((item) => item.userId), ['999', 'a2']);
    assert.equal(inApp[0].type, 'admin_pending');
    assert.equal(inApp[0].meta.skipWebPush, true);
    assert.deepEqual(pushes.map((item) => item.userId), ['999']);
    assert.equal(pushes[0].payload.type, 'admin_pending');
    assert.equal(pushes[0].payload.href, '/requests?review=r1');
});

test('notifyAdminPendingRequest labels TV aliases as a TV show request', async () => {
    const inApp = [];
    await notifyAdminPendingRequest({
        config: { webPushEnabled: false },
        record: { id: 'r-tv', title: 'Electric Bloom', mediaType: 'show' },
        loadUsers: async () => [{ id: 'a1', isAdmin: true, username: 'admin' }],
        createInApp: async (item) => {
            inApp.push(item);
            return { id: 'n1' };
        },
        alertRuleEnabled: () => false,
    });
    assert.match(inApp[0].body, /New TV Show Request: Electric Bloom/);
});

test('notifyAdminPendingRequest skips web push when globally disabled', async () => {
    const pushes = [];
    await notifyAdminPendingRequest({
        config: { webPushEnabled: false },
        record: { id: 'r2', title: 'Arrival', mediaType: 'movie' },
        loadUsers: async () => [{ id: 'a1', isAdmin: true }],
        createInApp: async () => ({ id: 'n1' }),
        sendWebPush: async (userId, payload) => {
            pushes.push({ userId, payload });
            return { sent: 1 };
        },
        alertRuleEnabled: () => false,
    });
    assert.equal(pushes.length, 0);
});

