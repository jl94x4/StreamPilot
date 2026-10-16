import assert from 'node:assert/strict';
import test from 'node:test';
import { resetTautulliExclusiveForTests, withTautulliExclusive } from './exclusiveLock.js';

test('withTautulliExclusive runs tasks one at a time', async () => {
    resetTautulliExclusiveForTests();
    const order = [];
    let startedFirst;
    const firstStarted = new Promise((resolve) => {
        startedFirst = resolve;
    });
    let releaseFirst;
    const first = withTautulliExclusive(async () => {
        order.push('first-start');
        startedFirst();
        await new Promise((resolve) => {
            releaseFirst = resolve;
        });
        order.push('first-end');
        return 1;
    });
    const second = withTautulliExclusive(async () => {
        order.push('second');
        return 2;
    });
    await firstStarted;
    assert.equal(order.includes('second'), false);
    releaseFirst();
    const results = await Promise.all([first, second]);
    assert.deepEqual(results, [1, 2]);
    assert.deepEqual(order, ['first-start', 'first-end', 'second']);
});
