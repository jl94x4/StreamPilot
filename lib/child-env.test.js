import assert from 'node:assert/strict';
import test from 'node:test';
import { envWithoutJemalloc } from './child-env.js';

test('envWithoutJemalloc strips jemalloc from LD_PRELOAD', () => {
    const env = envWithoutJemalloc({
        LD_PRELOAD: '/usr/lib/x86_64-linux-gnu/libjemalloc.so.2',
        PATH: '/usr/bin',
        CHROME_BIN: '/usr/bin/chromium',
    });
    assert.equal(env.LD_PRELOAD, undefined);
    assert.equal(env.PATH, '/usr/bin');
    assert.equal(env.CHROME_BIN, '/usr/bin/chromium');
});
