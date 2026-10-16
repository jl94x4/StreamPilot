import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheExplicitTpdbUrl } from './tpdbCache.js';

test('cacheExplicitTpdbUrl ignores non-ThePosterDB links', async () => {
    const result = await cacheExplicitTpdbUrl('https://mediux.pro/sets/1');
    assert.deepEqual(result, { saved: false, queued: 0 });
});

test('cacheExplicitTpdbUrl ignores empty and unrelated URLs', async () => {
    assert.deepEqual(await cacheExplicitTpdbUrl(''), { saved: false, queued: 0 });
    assert.deepEqual(await cacheExplicitTpdbUrl('https://example.com/set/1'), { saved: false, queued: 0 });
});
