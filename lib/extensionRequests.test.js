import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DECLINE_COOLDOWN_MS,
    evaluateExtensionEligibility,
    extendExpiryDate,
    normalizeExtensionSettings,
    pruneExtensionRequests,
} from './extensionRequests.js';

const NOW = new Date(2026, 10, 3, 12, 0, 0).getTime();
const inDays = (n) => {
    const d = new Date(NOW);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T12:00:00.000Z`;
};
const settings = normalizeExtensionSettings({ enabled: true, showWithinDays: 14 });

test('settings: off by default, sane month options', () => {
    assert.equal(normalizeExtensionSettings({}).enabled, false);
    assert.deepEqual(normalizeExtensionSettings({}).monthOptions, [1, 3, 12]);
    assert.deepEqual(normalizeExtensionSettings({ monthOptions: [12, '3', 0, 99, 3] }).monthOptions, [3, 12, 36]);
});

test('eligibility window, unlimited, expired', () => {
    assert.equal(evaluateExtensionEligibility({ user: { id: 'a', expiryDate: inDays(30) }, settings, now: NOW }).reason, 'too_early');
    assert.equal(evaluateExtensionEligibility({ user: { id: 'a', expiryDate: inDays(10) }, settings, now: NOW }).ok, true);
    assert.equal(evaluateExtensionEligibility({ user: { id: 'a', expiryDate: inDays(-40) }, settings, now: NOW }).ok, true);
    assert.equal(evaluateExtensionEligibility({ user: { id: 'a', expiryDate: null }, settings, now: NOW }).reason, 'unlimited');
    assert.equal(evaluateExtensionEligibility({ user: { id: 'a', expiryDate: inDays(3) }, settings: normalizeExtensionSettings({}), now: NOW }).reason, 'disabled');
});

test('one pending request at a time; a day between declines', () => {
    const user = { id: 'a', expiryDate: inDays(5) };
    assert.equal(evaluateExtensionEligibility({ user, settings, now: NOW, requests: [{ userId: 'a', status: 'pending' }] }).reason, 'pending');
    assert.equal(evaluateExtensionEligibility({ user, settings, now: NOW, requests: [{ userId: 'b', status: 'pending' }] }).ok, true);
    const declinedAt = new Date(NOW - 60_000).toISOString();
    assert.equal(evaluateExtensionEligibility({ user, settings, now: NOW, requests: [{ userId: 'a', status: 'declined', decidedAt: declinedAt }] }).reason, 'cooldown');
    assert.equal(evaluateExtensionEligibility({ user, settings, now: NOW + DECLINE_COOLDOWN_MS, requests: [{ userId: 'a', status: 'declined', decidedAt: declinedAt }] }).ok, true);
});

test('extending runs on from the expiry, or from today once lapsed', () => {
    assert.equal(extendExpiryDate('2026-11-20T12:00:00.000Z', 3, Date.UTC(2026, 10, 3)), '2027-02-20T12:00:00.000Z');
    assert.equal(extendExpiryDate('2026-01-01T00:00:00.000Z', 1, Date.UTC(2026, 10, 3, 9)), '2026-12-03T09:00:00.000Z');
    assert.equal(extendExpiryDate('2027-01-31T12:00:00.000Z', 1, Date.UTC(2026, 10, 3)), '2027-02-28T12:00:00.000Z');
});

test('history keeps pending and trims old decisions', () => {
    const rows = [
        { id: 'p', status: 'pending', createdAt: '2026-11-01' },
        ...Array.from({ length: 5 }, (_, i) => ({ id: `d${i}`, status: 'approved', decidedAt: `2026-10-0${i + 1}` })),
    ];
    const kept = pruneExtensionRequests(rows, 2);
    assert.deepEqual(kept.map((row) => row.id), ['p', 'd4', 'd3']);
});
