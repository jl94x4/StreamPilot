import assert from 'node:assert/strict';
import test from 'node:test';
import {
    editionsWebhookTokenMatches,
    extractEditionsWebhookToken,
    generateEditionsWebhookToken,
} from './webhook-auth.js';
import { normalizeEditionsConfig } from './config.js';

test('editions webhook token is extracted from query or header', () => {
    assert.equal(extractEditionsWebhookToken({ query: { token: 'abc' }, headers: {} }), 'abc');
    assert.equal(extractEditionsWebhookToken({
        query: {},
        headers: { 'x-editions-webhook-token': 'hdr' },
        get: (name) => (name === 'x-editions-webhook-token' ? 'hdr' : ''),
    }), 'hdr');
});

test('editions webhook compare is length-safe', () => {
    const token = generateEditionsWebhookToken();
    assert.equal(editionsWebhookTokenMatches(token, token), true);
    assert.equal(editionsWebhookTokenMatches('nope', token), false);
    assert.equal(editionsWebhookTokenMatches('', token), false);
    assert.equal(editionsWebhookTokenMatches(token, ''), false);
});

test('enabling webhook mints a token', () => {
    const cfg = normalizeEditionsConfig({ webhookEnabled: true });
    assert.equal(cfg.webhookEnabled, true);
    assert.ok(String(cfg.webhookToken).length >= 32);
});
