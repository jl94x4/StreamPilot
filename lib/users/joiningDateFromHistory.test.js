import test from 'node:test';
import assert from 'node:assert/strict';
import {
    earliestViewedAtUnix,
    isoFromUnixSeconds,
    shouldReplaceJoiningDate,
    resolvePlexHistoryAccountId,
} from './joiningDateFromHistory.js';

test('earliestViewedAtUnix picks the oldest play', () => {
    assert.equal(earliestViewedAtUnix([
        { viewedAt: 1700000100 },
        { viewedAt: 1600000000 },
        { viewedAt: 1650000000 },
    ]), 1600000000);
});

test('shouldReplaceJoiningDate only moves earlier', () => {
    assert.equal(shouldReplaceJoiningDate(null, '2020-01-01T00:00:00.000Z'), true);
    assert.equal(
        shouldReplaceJoiningDate('2024-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z'),
        true,
    );
    assert.equal(
        shouldReplaceJoiningDate('2020-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z'),
        false,
    );
    assert.equal(shouldReplaceJoiningDate('2020-01-01T00:00:00.000Z', null), false);
});

test('isoFromUnixSeconds converts seconds', () => {
    assert.equal(isoFromUnixSeconds(1600000000), new Date(1600000000 * 1000).toISOString());
});

test('resolvePlexHistoryAccountId prefers plexAccountId then name match', () => {
    assert.equal(
        resolvePlexHistoryAccountId({ plexAccountId: '42', username: 'x' }, []),
        '42',
    );
    assert.equal(
        resolvePlexHistoryAccountId(
            { username: 'dan', email: 'dan@x.com' },
            [{ id: 9, name: 'dan' }],
        ),
        '9',
    );
});
