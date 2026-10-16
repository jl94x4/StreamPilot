import assert from 'node:assert/strict';
import test from 'node:test';
import {
    fingerprintSeerrRequestCounts,
    resetSeerrNotifyPollGuardForTests,
    SEERR_NOTIFY_FORCE_LIST_AFTER_MS,
    shouldSkipUnchangedSeerrNotifyList,
} from './seerrNotifyPollGuard.js';

test('fingerprintSeerrRequestCounts ignores unrelated fields', () => {
    assert.equal(
        fingerprintSeerrRequestCounts({ pending: 2, available: 1, failed: 9, extra: true }),
        fingerprintSeerrRequestCounts({ pending: 2, available: 1, processing: 0 }),
    );
    assert.notEqual(
        fingerprintSeerrRequestCounts({ pending: 2 }),
        fingerprintSeerrRequestCounts({ pending: 3 }),
    );
});

test('shouldSkipUnchangedSeerrNotifyList skips after a successful list of the same counts', async () => {
    resetSeerrNotifyPollGuardForTests();
    const getRequestCounts = async () => ({ pending: 1, approved: 4, processing: 2, available: 3 });
    const first = await shouldSkipUnchangedSeerrNotifyList('available', getRequestCounts, {});
    assert.equal(first.skip, false);
    first.markListed();
    const second = await shouldSkipUnchangedSeerrNotifyList('available', getRequestCounts, {});
    assert.equal(second.skip, true);
    const pendingJob = await shouldSkipUnchangedSeerrNotifyList('pending', getRequestCounts, {});
    assert.equal(pendingJob.skip, false);
});

test('shouldSkipUnchangedSeerrNotifyList lists again when counts change', async () => {
    resetSeerrNotifyPollGuardForTests();
    let pending = 1;
    const getRequestCounts = async () => ({ pending, approved: 0, processing: 0, available: 0 });
    const first = await shouldSkipUnchangedSeerrNotifyList('pending', getRequestCounts, {});
    assert.equal(first.skip, false);
    first.markListed();
    pending = 2;
    const changed = await shouldSkipUnchangedSeerrNotifyList('pending', getRequestCounts, {});
    assert.equal(changed.skip, false);
});

test('shouldSkipUnchangedSeerrNotifyList recrawls after the idle window', async () => {
    resetSeerrNotifyPollGuardForTests();
    const getRequestCounts = async () => ({ pending: 1, approved: 0, processing: 0, available: 0 });
    const first = await shouldSkipUnchangedSeerrNotifyList('available', getRequestCounts, {});
    first.markListed();
    const stillIdle = await shouldSkipUnchangedSeerrNotifyList('available', getRequestCounts, {});
    assert.equal(stillIdle.skip, true);
    const stale = await shouldSkipUnchangedSeerrNotifyList(
        'available',
        getRequestCounts,
        {},
        { now: Date.now() + SEERR_NOTIFY_FORCE_LIST_AFTER_MS + 1 },
    );
    assert.equal(stale.skip, false);
});
