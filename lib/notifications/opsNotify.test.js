import assert from 'node:assert/strict';
import test from 'node:test';
import {
    applyStatusHealthNotifyState,
    isCollexionsFailureStatus,
    isOpsNotifyRecipient,
    normalizeStatusNotifyDownAfterMinutes,
    notifyOpsAdmins,
    OPS_NOTIFY_EVENTS,
    resetOpsNotifyCooldownsForTests,
    STATUS_NOTIFY_DOWN_DEFAULT_MINUTES,
} from './opsNotify.js';
import { ADMIN_ONLY_IN_APP_TYPES } from './inAppAdminTypes.js';

test('normalizeStatusNotifyDownAfterMinutes clamps to 1–1440 and defaults to 5', () => {
    assert.equal(normalizeStatusNotifyDownAfterMinutes(undefined), STATUS_NOTIFY_DOWN_DEFAULT_MINUTES);
    assert.equal(normalizeStatusNotifyDownAfterMinutes('5'), 5);
    assert.equal(normalizeStatusNotifyDownAfterMinutes(0), 1);
    assert.equal(normalizeStatusNotifyDownAfterMinutes(99999), 1440);
    assert.equal(normalizeStatusNotifyDownAfterMinutes('nope'), 5);
});

test('isCollexionsFailureStatus matches error/crash but not idle/sleeping', () => {
    assert.equal(isCollexionsFailureStatus('Error: Plex Unauthorized'), true);
    assert.equal(isCollexionsFailureStatus('CRASHED (RuntimeError)'), true);
    assert.equal(isCollexionsFailureStatus('FATAL ERROR'), true);
    assert.equal(isCollexionsFailureStatus('Sleeping (30 min)'), false);
    assert.equal(isCollexionsFailureStatus('Processing: Movies'), false);
    assert.equal(isCollexionsFailureStatus('Stopped (Interrupt)'), false);
});

test('applyStatusHealthNotifyState waits for delay then fires recovery', () => {
    const record = { incidents: [] };
    const t0 = 1_000_000;
    assert.deepEqual(applyStatusHealthNotifyState({
        record, previousStatus: 'online', nextStatus: 'offline', now: t0, delayMs: 5 * 60 * 1000,
    }), []);
    assert.equal(record.unhealthySince, t0);

    assert.deepEqual(applyStatusHealthNotifyState({
        record, previousStatus: 'offline', nextStatus: 'offline', now: t0 + 4 * 60 * 1000, delayMs: 5 * 60 * 1000,
    }), []);

    assert.deepEqual(applyStatusHealthNotifyState({
        record, previousStatus: 'offline', nextStatus: 'offline', now: t0 + 5 * 60 * 1000, delayMs: 5 * 60 * 1000,
    }), ['status_down']);
    assert.equal(record.downNotified, true);

    assert.deepEqual(applyStatusHealthNotifyState({
        record, previousStatus: 'offline', nextStatus: 'offline', now: t0 + 6 * 60 * 1000, delayMs: 5 * 60 * 1000,
    }), []);

    assert.deepEqual(applyStatusHealthNotifyState({
        record, previousStatus: 'offline', nextStatus: 'online', now: t0 + 7 * 60 * 1000, delayMs: 5 * 60 * 1000,
    }), ['status_up']);
    assert.equal(record.downNotified, false);
    assert.equal(record.unhealthySince, null);
});

test('notifyOpsAdmins skips members, opted-out admins, unknown events, and cooldown', async () => {
    resetOpsNotifyCooldownsForTests();
    const skippedPrefs = await notifyOpsAdmins({
        event: 'scanner_failed',
        config: { ntfyEnabled: false, webhookEnabled: false, webPushEnabled: false },
        title: 'Scan failed',
        loadUsers: async () => [
            { id: 'm1', isAdmin: false, notifyScannerFailed: true },
            { id: 'a1', isAdmin: true, notifyScannerFailed: false },
        ],
    });
    assert.equal(skippedPrefs.notified, false);
    assert.equal(skippedPrefs.inAppCreated, 0);

    const unknown = await notifyOpsAdmins({ event: 'nope', loadUsers: async () => [] });
    assert.equal(unknown.skipped, 'unknown-event');

    resetOpsNotifyCooldownsForTests();
    await notifyOpsAdmins({
        event: 'scanner_failed',
        config: {},
        title: 'first',
        dedupeKey: 'scanner:folder-a',
        loadUsers: async () => [],
        now: 1000,
    });
    const cooled = await notifyOpsAdmins({
        event: 'scanner_failed',
        config: {},
        title: 'second',
        dedupeKey: 'scanner:folder-a',
        loadUsers: async () => [],
        now: 1000 + 60 * 1000,
    });
    assert.equal(cooled.skipped, 'cooldown');
    resetOpsNotifyCooldownsForTests();
});

test('notifyOpsAdmins attaches poster meta to in-app and push payloads', async () => {
    resetOpsNotifyCooldownsForTests();
    const created = [];
    await notifyOpsAdmins({
        event: 'media_job_completed',
        config: { ntfyEnabled: false, webhookEnabled: false, webPushEnabled: false },
        title: 'Completed The.Office.S03E01.mkv',
        loadUsers: async () => [{ id: 'a1', isAdmin: true, notifyMediaJobCompleted: true }],
        meta: { posterPath: '/office.jpg', tmdbId: 2316, mediaType: 'tv' },
        createInApp: async (payload) => {
            created.push(payload);
            return payload;
        },
    });
    assert.equal(created.length, 1);
    assert.equal(created[0].meta.posterPath, '/office.jpg');
    assert.equal(created[0].meta.posterUrl, 'https://image.tmdb.org/t/p/w185/office.jpg');
    assert.equal(created[0].meta.opsEvent, 'media_job_completed');
    assert.equal(created[0].meta.skipWebPush, true);
});

test('scanner_deleted notifies admins by default when they have not opted out', async () => {
    resetOpsNotifyCooldownsForTests();
    const created = [];
    const result = await notifyOpsAdmins({
        event: 'scanner_deleted',
        config: { ntfyEnabled: false, webhookEnabled: false, webPushEnabled: false },
        title: 'The Office · S01E01',
        loadUsers: async () => [
            { id: 'a1', isAdmin: true },
            { id: 'a2', isAdmin: true, notifyScannerDeleted: false },
        ],
        createInApp: async (payload) => {
            created.push(payload);
            return payload;
        },
    });
    assert.equal(result.inAppCreated, 1);
    assert.equal(created[0].type, 'scanner_deleted');
    assert.equal(created[0].title, 'Scanner Notification [Scanner]');
    assert.equal(created[0].body, 'Deleted: The Office · S01E01');
});

test('scanner_grab body uses the release filename', async () => {
    resetOpsNotifyCooldownsForTests();
    const created = [];
    const result = await notifyOpsAdmins({
        event: 'scanner_grab',
        config: { ntfyEnabled: false, webhookEnabled: false, webPushEnabled: false },
        title: 'The Office · S03E01 - Gay Witch Hunt [WEBDL-1080p]',
        filename: 'The.Office.S03E01.1080p.WEB.x264-GROUP',
        service: 'Sonarr',
        loadUsers: async () => [
            { id: 'a1', isAdmin: true },
            { id: 'a2', isAdmin: true, notifyScannerGrab: false },
        ],
        createInApp: async (payload) => {
            created.push(payload);
            return payload;
        },
    });
    assert.equal(result.inAppCreated, 1);
    assert.equal(created[0].type, 'scanner_grab');
    assert.equal(created[0].title, 'Scanner Notification [Sonarr]');
    assert.equal(created[0].body, '📺 Grabbed: The.Office.S03E01.1080p.WEB.x264-GROUP');
});

test('scanner_update and scanner_interaction notify admins by default', async () => {
    resetOpsNotifyCooldownsForTests();
    const created = [];
    const updated = await notifyOpsAdmins({
        event: 'scanner_update',
        config: { ntfyEnabled: false, webhookEnabled: false, webPushEnabled: false },
        title: 'Sonarr 4.0.14.2938 → 4.0.15.2941',
        loadUsers: async () => [
            { id: 'a1', isAdmin: true },
            { id: 'a2', isAdmin: true, notifyScannerUpdate: false },
        ],
        createInApp: async (payload) => {
            created.push(payload);
            return payload;
        },
    });
    assert.equal(updated.inAppCreated, 1);
    assert.equal(created[0].type, 'scanner_update');
    assert.equal(created[0].body, 'Updated: Sonarr 4.0.14.2938 → 4.0.15.2941');

    resetOpsNotifyCooldownsForTests();
    created.length = 0;
    const interaction = await notifyOpsAdmins({
        event: 'scanner_interaction',
        config: { ntfyEnabled: false, webhookEnabled: false, webPushEnabled: false },
        title: 'Dune (2021)',
        filename: 'Dune.2021.2160p.WEB-GROUP',
        loadUsers: async () => [{ id: 'a1', isAdmin: true }],
        createInApp: async (payload) => {
            created.push(payload);
            return payload;
        },
    });
    assert.equal(interaction.inAppCreated, 1);
    assert.equal(created[0].type, 'scanner_interaction');
    assert.equal(created[0].body, 'Needs attention: Dune.2021.2160p.WEB-GROUP');
});

test('isOpsNotifyRecipient ignores sticky isAdmin on Jellyfin and non-owner Plex members', () => {
    assert.equal(isOpsNotifyRecipient({ id: 'm1', isAdmin: true }, { mediaServerType: 'jellyfin' }), false);
    assert.equal(isOpsNotifyRecipient({ id: 'a1', jellyfinIsAdmin: true }, { mediaServerType: 'jellyfin' }), true);
    assert.equal(isOpsNotifyRecipient(
        { id: 'm1', plexId: '111', isAdmin: true },
        { mediaServerType: 'plex', adminPlexId: '999' },
    ), false);
    assert.equal(isOpsNotifyRecipient(
        { id: '999', plexId: '999', isAdmin: true },
        { mediaServerType: 'plex', adminPlexId: '999' },
    ), true);
    assert.equal(isOpsNotifyRecipient({ id: 'a1', isAdmin: true }, {}), true);
});

test('ops events are treated as admin-only in-app types', () => {
    for (const event of OPS_NOTIFY_EVENTS) {
        assert.equal(ADMIN_ONLY_IN_APP_TYPES.has(event), true, event);
    }
});

test('notifyOpsAdmins skips sticky Jellyfin members and redacts apikeys in copy', async () => {
    resetOpsNotifyCooldownsForTests();
    const created = [];
    const result = await notifyOpsAdmins({
        event: 'scanner_failed',
        config: { mediaServerType: 'jellyfin', ntfyEnabled: false, webhookEnabled: false, webPushEnabled: false },
        title: 'request to http://tautulli:8181/api/v2?apikey=super-secret-key failed',
        loadUsers: async () => [
            { id: 'm1', isAdmin: true, notifyScannerFailed: true },
            { id: 'a1', isAdmin: true, jellyfinIsAdmin: true, notifyScannerFailed: true },
        ],
        createInApp: async (payload) => {
            created.push(payload);
            return payload;
        },
    });
    assert.equal(result.inAppCreated, 1);
    assert.equal(created[0].userId, 'a1');
    assert.equal(String(created[0].body).includes('super-secret-key'), false);
    assert.match(String(created[0].body), /apikey=\*\*\*/i);
});
