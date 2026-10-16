import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildNtfyPublishUrl,
    isNtfyConfigured,
    normalizeNtfyEvents,
    notifyNtfyEvent,
    shouldSendNtfyEvent,
} from './ntfy.js';

test('normalizeNtfyEvents fills defaults and merges overrides', () => {
    const events = normalizeNtfyEvents({ episode: true, approved: false });
    assert.equal(events.available, true);
    assert.equal(events.episode, true);
    assert.equal(events.approved, false);
    assert.equal(normalizeNtfyEvents({}).collexions_failed, true);
    assert.equal(normalizeNtfyEvents({}).scanner_deleted, true);
    assert.equal(normalizeNtfyEvents({}).scanner_upgrade, true);
    assert.equal(normalizeNtfyEvents({}).scanner_import, true);
    assert.equal(normalizeNtfyEvents({}).scanner_grab, true);
    assert.equal(normalizeNtfyEvents({}).scanner_update, true);
    assert.equal(normalizeNtfyEvents({}).scanner_interaction, true);
    assert.equal(normalizeNtfyEvents({}).media_job_completed, false);
    assert.equal(normalizeNtfyEvents({}).support_ticket, true);
    assert.equal(normalizeNtfyEvents({}).support_reply, true);
    assert.equal(normalizeNtfyEvents({}).support_media_issue, true);
});

test('isNtfyConfigured requires enable + server + topic', () => {
    assert.equal(isNtfyConfigured({ ntfyEnabled: true, ntfyServerUrl: 'https://ntfy.sh', ntfyTopic: 'portal' }), true);
    assert.equal(isNtfyConfigured({ ntfyEnabled: true, ntfyServerUrl: 'https://ntfy.sh', ntfyTopic: '' }), false);
    assert.equal(isNtfyConfigured({ ntfyEnabled: false, ntfyServerUrl: 'https://ntfy.sh', ntfyTopic: 'portal' }), false);
});

test('buildNtfyPublishUrl strips trailing slash and topic slashes', () => {
    assert.equal(
        buildNtfyPublishUrl({ ntfyServerUrl: 'https://ntfy.sh/', ntfyTopic: '/alerts/' }),
        'https://ntfy.sh/alerts',
    );
});

test('shouldSendNtfyEvent respects event flags and available master switch', () => {
    const config = {
        ntfyEnabled: true,
        ntfyServerUrl: 'https://ntfy.sh',
        ntfyTopic: 'portal',
        ntfyEvents: { episode: false },
        requestAvailableNotifyEnabled: false,
    };
    assert.equal(shouldSendNtfyEvent(config, 'episode'), false);
    assert.equal(shouldSendNtfyEvent(config, 'available'), false);
    assert.equal(shouldSendNtfyEvent({ ...config, requestAvailableNotifyEnabled: true }, 'available'), true);
});

test('notifyNtfyEvent posts to topic with title/priority headers', async () => {
    const calls = [];
    const ok = await notifyNtfyEvent({
        config: {
            ntfyEnabled: true,
            ntfyServerUrl: 'https://ntfy.example',
            ntfyTopic: 'portal',
            ntfyToken: 'secret-token',
            ntfyPriority: 4,
            ntfyEvents: { available: true },
        },
        event: 'available',
        title: 'Movie ready',
        body: 'Watch now',
        clickUrl: 'https://portal.example/requests',
        attachUrl: 'https://image.tmdb.org/t/p/w185/office.jpg',
        fetchImpl: async (url, init) => {
            calls.push({ url, init });
            return { ok: true, status: 200, text: async () => '' };
        },
    });
    assert.equal(ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://ntfy.example/portal');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.body, 'Watch now');
    assert.equal(calls[0].init.headers.Title, 'Movie ready');
    assert.equal(calls[0].init.headers.Priority, '4');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer secret-token');
    assert.equal(calls[0].init.headers.Click, 'https://portal.example/requests');
    assert.equal(calls[0].init.headers.Attach, 'https://image.tmdb.org/t/p/w185/office.jpg');
    assert.equal(calls[0].init.headers.Icon, 'https://image.tmdb.org/t/p/w185/office.jpg');
});

test('notifyNtfyEvent skips when event disabled', async () => {
    let called = false;
    const ok = await notifyNtfyEvent({
        config: {
            ntfyEnabled: true,
            ntfyServerUrl: 'https://ntfy.example',
            ntfyTopic: 'portal',
            ntfyEvents: { declined: false },
        },
        event: 'declined',
        title: 'Nope',
        body: 'Declined',
        fetchImpl: async () => {
            called = true;
            return { ok: true, status: 200, text: async () => '' };
        },
    });
    assert.equal(ok, false);
    assert.equal(called, false);
});
