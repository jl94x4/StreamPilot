import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildDefaultWebhookPayload,
    normalizeWebhookEvents,
    parseWebhookHeaders,
    sendGenericWebhook,
    shouldSendWebhookEvent,
} from './genericWebhook.js';

test('normalizeWebhookEvents defaults available on and others off', () => {
    const events = normalizeWebhookEvents({});
    assert.equal(events.available, true);
    assert.equal(events.approved, false);
    assert.equal(events.admin_pending, false);
    assert.equal(events.scanner_failed, false);
    assert.equal(events.scanner_deleted, false);
    assert.equal(events.scanner_upgrade, false);
    assert.equal(events.scanner_import, false);
    assert.equal(events.scanner_grab, false);
    assert.equal(events.scanner_update, false);
    assert.equal(events.scanner_interaction, false);
    assert.equal(events.media_job_completed, false);
    assert.equal(events.support_ticket, false);
    assert.equal(events.support_reply, false);
    assert.equal(events.support_media_issue, false);
});

test('parseWebhookHeaders accepts object JSON and rejects arrays', () => {
    assert.deepEqual(parseWebhookHeaders('{"X-Token":"abc"}'), { 'X-Token': 'abc' });
    assert.throws(() => parseWebhookHeaders('[]'), /JSON object/);
    assert.throws(() => parseWebhookHeaders('{bad'), /valid JSON/);
});

test('shouldSendWebhookEvent is opt-in per event after defaults', () => {
    const base = {
        webhookEnabled: true,
        webhookUrl: 'https://hooks.example/ingest',
        webhookEvents: { approved: true },
    };
    assert.equal(shouldSendWebhookEvent(base, 'available'), true);
    assert.equal(shouldSendWebhookEvent(base, 'approved'), true);
    assert.equal(shouldSendWebhookEvent(base, 'declined'), false);
    assert.equal(
        shouldSendWebhookEvent({ ...base, requestAvailableNotifyEnabled: false }, 'available'),
        false,
    );
});

test('buildDefaultWebhookPayload includes event and timestamp', () => {
    const payload = buildDefaultWebhookPayload({
        event: 'approved',
        vars: { title: 'Dune', user: 'jason', portal_url: 'https://portal/' },
        serverName: 'Home',
    });
    assert.equal(payload.event, 'approved');
    assert.equal(payload.title, 'Dune');
    assert.equal(payload.user, 'jason');
    assert.equal(payload.server_name, 'Home');
    assert.ok(typeof payload.timestamp === 'string' && payload.timestamp.includes('T'));
});

test('sendGenericWebhook posts default JSON payload', async () => {
    const calls = [];
    const ok = await sendGenericWebhook({
        config: {
            webhookEnabled: true,
            webhookUrl: 'https://hooks.example/ingest',
            webhookHeadersJson: '{"X-Hook":"1"}',
            webhookEvents: { available: true },
            serverName: 'Portal',
        },
        event: 'available',
        vars: { title: 'Movie', user: 'jay', portal_url: 'https://p/' },
        fetchImpl: async (url, init) => {
            calls.push({ url, init });
            return { ok: true, status: 200, text: async () => '' };
        },
    });
    assert.equal(ok, true);
    assert.equal(calls[0].url, 'https://hooks.example/ingest');
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
    assert.equal(calls[0].init.headers['X-Hook'], '1');
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.event, 'available');
    assert.equal(body.title, 'Movie');
    assert.equal(body.user, 'jay');
});

test('sendGenericWebhook uses rendered JSON template when provided', async () => {
    const calls = [];
    const ok = await sendGenericWebhook({
        config: {
            webhookEnabled: true,
            webhookUrl: 'https://hooks.example/ingest',
            webhookEvents: { approved: true },
        },
        event: 'approved',
        vars: { title: 'Film' },
        renderedBody: '{"type":"approved","name":"Film"}',
        fetchImpl: async (url, init) => {
            calls.push({ url, init });
            return { ok: true, status: 200, text: async () => '' };
        },
    });
    assert.equal(ok, true);
    assert.deepEqual(JSON.parse(calls[0].init.body), { type: 'approved', name: 'Film' });
});

test('sendGenericWebhook rejects invalid template JSON', async () => {
    let called = false;
    const ok = await sendGenericWebhook({
        config: {
            webhookEnabled: true,
            webhookUrl: 'https://hooks.example/ingest',
            webhookEvents: { approved: true },
        },
        event: 'approved',
        renderedBody: '{not-json',
        fetchImpl: async () => {
            called = true;
            return { ok: true, status: 200, text: async () => '' };
        },
        log: () => {},
    });
    assert.equal(ok, false);
    assert.equal(called, false);
});
