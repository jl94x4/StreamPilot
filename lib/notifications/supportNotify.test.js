import assert from 'node:assert/strict';
import test from 'node:test';
import { absolutePortalHref, notifySupportAdmins } from './supportNotify.js';

test('absolutePortalHref joins public origin with ticket path', () => {
    assert.equal(
        absolutePortalHref('https://portal.example/portal', '/support?ticket=abc'),
        'https://portal.example/portal/support?ticket=abc',
    );
    assert.equal(
        absolutePortalHref('https://portal.example/portal/', 'https://other.example/x'),
        'https://other.example/x',
    );
    assert.equal(absolutePortalHref('', '/support?ticket=1'), '/support?ticket=1');
});

test('notifySupportAdmins skips members, the actor, and opted-out admins', async () => {
    const created = [];
    const result = await notifySupportAdmins({
        event: 'support_ticket',
        config: { ntfyEnabled: false, webhookEnabled: false, webPushEnabled: false },
        title: 'Plex buffering',
        href: '/support?ticket=t1',
        excludeUserId: 'actor',
        meta: { ticketId: 't1', username: 'Jay' },
        loadUsers: async () => [
            { id: 'member', isAdmin: false },
            { id: 'actor', isAdmin: true },
            { id: 'opted-out', isAdmin: true, notifySupportTicket: false },
            { id: 'admin', isAdmin: true },
        ],
        createInApp: async (payload) => {
            created.push(payload);
            return payload;
        },
    });
    assert.equal(result.notified, true);
    assert.equal(created.length, 1);
    assert.equal(created[0].userId, 'admin');
    assert.equal(created[0].type, 'support_ticket');
    assert.equal(created[0].href, '/support?ticket=t1');
    assert.equal(created[0].meta.skipWebPush, true);
    assert.equal(created[0].meta.supportEvent, 'support_ticket');
    assert.equal(created[0].title, 'New support ticket');
    assert.equal(created[0].body, 'Jay: Plex buffering');
});

test('notifySupportAdmins ignores leftover isAdmin on non-owner members', async () => {
    const created = [];
    const result = await notifySupportAdmins({
        event: 'support_reply',
        config: {
            mediaServerType: 'plex',
            adminPlexId: '999',
            ntfyEnabled: false,
            webhookEnabled: false,
            webPushEnabled: false,
        },
        title: 'Plex buffering',
        href: '/support?ticket=t2',
        meta: { ticketId: 't2', username: 'Jay' },
        loadUsers: async () => [
            { id: 'stamped-member', plexId: '111', isAdmin: true },
            { id: '999', plexId: '999', isAdmin: true },
        ],
        createInApp: async (payload) => {
            created.push(payload);
            return payload;
        },
    });
    assert.equal(result.notified, true);
    assert.equal(created.length, 1);
    assert.equal(created[0].userId, '999');
    assert.equal(created[0].type, 'support_reply');
    assert.equal(created[0].meta.supportEvent, 'support_reply');
});

test('notifySupportAdmins respects Gotify alert rules and media-issue prefs', async () => {
    const gotify = [];
    const created = [];
    const allowed = await notifySupportAdmins({
        event: 'support_media_issue',
        config: { ntfyEnabled: false, webhookEnabled: false, webPushEnabled: false },
        title: 'Missing subtitles',
        href: '/support?ticket=t3',
        meta: { ticketId: 't3', username: 'Alex', linkedIssueId: 9 },
        loadUsers: async () => [
            { id: 'a1', isAdmin: true },
            { id: 'a2', isAdmin: true, notifySupportMediaIssue: false },
        ],
        createInApp: async (payload) => {
            created.push(payload);
            return payload;
        },
        sendGotifyAlert: async (_config, title, body) => {
            gotify.push({ title, body });
            return true;
        },
        alertRuleEnabled: (_config, rule) => rule === 'supportMediaIssue',
        resolvePublicBaseUrl: () => 'https://portal.example',
    });
    assert.equal(created.length, 1);
    assert.equal(created[0].userId, 'a1');
    assert.equal(created[0].href, '/support?ticket=t3');
    assert.equal(gotify.length, 1);
    assert.equal(gotify[0].title, 'New media issue ticket');
    assert.match(gotify[0].body, /https:\/\/portal\.example\/support\?ticket=t3/);
    assert.equal(allowed.gotifySent, true);

    const blocked = await notifySupportAdmins({
        event: 'support_media_issue',
        config: {},
        title: 'Missing subtitles',
        href: '/support?ticket=t3',
        loadUsers: async () => [],
        createInApp: async () => null,
        sendGotifyAlert: async () => true,
        alertRuleEnabled: () => false,
    });
    assert.equal(blocked.gotifySent, false);
});

test('notifySupportAdmins returns unknown-event for other keys', async () => {
    const result = await notifySupportAdmins({ event: 'admin_pending', loadUsers: async () => [] });
    assert.equal(result.skipped, 'unknown-event');
});
