import test from 'node:test';
import assert from 'node:assert/strict';
import {
    daysUntilExpiry,
    filterExpiringMembersThisWeek,
    isExpiringMemberThisWeek,
} from './expiringMembersThisWeek.js';

const now = new Date(2026, 8, 11);

const isoFromDays = (days) => {
    const date = new Date(2026, 8, 11 + days);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

test('daysUntilExpiry uses local calendar days', () => {
    assert.equal(daysUntilExpiry(isoFromDays(0), now), 0);
    assert.equal(daysUntilExpiry(isoFromDays(7), now), 7);
    assert.equal(daysUntilExpiry(isoFromDays(8), now), 8);
    assert.equal(daysUntilExpiry(null, now), null);
});

test('isExpiringMemberThisWeek includes today through 7 days', () => {
    assert.equal(isExpiringMemberThisWeek({ expiryDate: isoFromDays(0) }, now), true);
    assert.equal(isExpiringMemberThisWeek({ expiryDate: isoFromDays(7) }, now), true);
    assert.equal(isExpiringMemberThisWeek({ expiryDate: isoFromDays(8) }, now), false);
    assert.equal(isExpiringMemberThisWeek({ expiryDate: isoFromDays(-1) }, now), false);
});

test('isExpiringMemberThisWeek skips admins, revoked, and unlimited', () => {
    assert.equal(isExpiringMemberThisWeek({ isAdmin: true, expiryDate: isoFromDays(2) }, now), false);
    assert.equal(isExpiringMemberThisWeek({ plexAccessStatus: 'revoked', expiryDate: isoFromDays(2) }, now), false);
    assert.equal(isExpiringMemberThisWeek({ username: 'vip' }, now), false);
});

test('filterExpiringMembersThisWeek sorts soonest first', () => {
    const rows = filterExpiringMembersThisWeek([
        { username: 'later', expiryDate: isoFromDays(6) },
        { username: 'soon', expiryDate: isoFromDays(1) },
        { username: 'admin', isAdmin: true, expiryDate: isoFromDays(1) },
        { username: 'skip', expiryDate: isoFromDays(20) },
    ], now);
    assert.deepEqual(rows.map((row) => row.username), ['soon', 'later']);
});
