import test from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from 'esbuild';
import fs from 'node:fs';
import vm from 'node:vm';

const loadStacks = () => {
    const source = fs.readFileSync(new URL('./notificationStacks.ts', import.meta.url), 'utf8');
    const code = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2020' }).code;
    const module = { exports: {} };
    vm.runInNewContext(`(function(module){${code}\n})(module)`, { module });
    return module.exports;
};

test('stackInAppNotifications groups by type and keeps newest-first order', () => {
    const { stackInAppNotifications } = loadStacks();
    const stacks = stackInAppNotifications([
        { id: 'a1', type: 'request_available' },
        { id: 'p1', type: 'admin_pending' },
        { id: 'a2', type: 'request_available' },
        { id: 'a3', type: 'request_available' },
        { id: 'p2', type: 'admin_pending' },
    ]);
    assert.equal(stacks.length, 2);
    assert.equal(stacks[0].items.map((item) => item.id).join(','), 'a1,a2,a3');
    assert.equal(stacks[1].items.map((item) => item.id).join(','), 'p1,p2');
});

test('stackInAppNotifications leaves unique types ungrouped', () => {
    const { stackInAppNotifications } = loadStacks();
    const stacks = stackInAppNotifications([
        { id: 'a', type: 'request_available' },
        { id: 'b', type: 'status_down' },
    ]);
    assert.equal(stacks.length, 2);
    assert.equal(stacks[0].items.length, 1);
    assert.equal(stacks[1].items.length, 1);
});
