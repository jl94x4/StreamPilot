import assert from 'node:assert/strict';
import test from 'node:test';
import { redactInAppNotificationItem, redactSensitiveText } from './sensitiveText.js';

test('redactSensitiveText masks Tautulli apikey query values', () => {
    const raw = 'request to http://tautulli:8181/api/v2?apikey=super-secret-key&cmd=get_history failed, reason: connect ECONNREFUSED';
    const redacted = redactSensitiveText(raw);
    assert.equal(redacted.includes('super-secret-key'), false);
    assert.match(redacted, /apikey=\*\*\*/i);
    assert.match(redacted, /tautulli:8181/);
    assert.match(redacted, /ECONNREFUSED/);
});

test('redactSensitiveText masks userinfo passwords and token pairs', () => {
    assert.equal(
        redactSensitiveText('https://user:hunter2@example.com/api'),
        'https://user:***@example.com/api',
    );
    assert.equal(redactSensitiveText('token=abc.def.ghi').includes('abc.def.ghi'), false);
});

test('redactInAppNotificationItem scrubs title, body, and repeat history', () => {
    const item = redactInAppNotificationItem({
        title: 'Tautulli API failed',
        body: 'request to http://host/api/v2?apikey=leak failed',
        meta: {
            repeatHistory: [{ body: 'request to http://host/api/v2?apikey=old failed', createdAt: 'now' }],
        },
    });
    assert.equal(item.body.includes('leak'), false);
    assert.equal(item.meta.repeatHistory[0].body.includes('old'), false);
    assert.match(item.body, /apikey=\*\*\*/i);
});
