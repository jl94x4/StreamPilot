import test from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from 'esbuild';
import fs from 'node:fs';
import vm from 'node:vm';

const load = () => {
    const source = fs.readFileSync(new URL('./posterSetsScroll.ts', import.meta.url), 'utf8');
    const code = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2020' }).code;
    const sandbox = {
        module: { exports: {} },
        window: undefined,
        document: undefined,
    };
    vm.runInNewContext(`(function(module){${code}\n})(module)`, sandbox);
    return { fns: sandbox.module.exports, sandbox };
};

test('captureElementScroll and restoreElementScroll round-trip', () => {
    const { fns: { captureElementScroll, restoreElementScroll } } = load();
    const el = { scrollTop: 420 };
    assert.equal(captureElementScroll(el), 420);
    restoreElementScroll(el, 88);
    assert.equal(el.scrollTop, 88);
    restoreElementScroll(null, 10);
});

test('capturePortalScroll falls back to window when no main scroller exists', () => {
    const { fns: { capturePortalScroll, restorePortalScroll }, sandbox } = load();
    const scrolls = [];
    sandbox.window = {
        scrollY: 240,
        scrollTo: (x, y) => scrolls.push([x, y]),
        getComputedStyle: () => ({ overflowY: 'visible' }),
        requestAnimationFrame: (fn) => { fn(); return 1; },
        setTimeout: () => 0,
    };
    sandbox.document = {
        documentElement: { scrollTop: 240 },
        getElementById: () => null,
    };
    const snapshot = capturePortalScroll();
    assert.equal(snapshot.top, 240);
    assert.equal(snapshot.mode, 'window');
    restorePortalScroll(snapshot);
    assert.deepEqual(scrolls[0], [0, 240]);
});

test('withPreservedPortalScroll restores after the writer jumps the page', () => {
    const { fns: { withPreservedPortalScroll }, sandbox } = load();
    let scrollY = 640;
    sandbox.window = {
        get scrollY() { return scrollY; },
        scrollTo: (_x, y) => { scrollY = y; },
        getComputedStyle: () => ({ overflowY: 'visible' }),
        requestAnimationFrame: (fn) => { fn(); return 1; },
        setTimeout: (fn) => { fn(); return 0; },
    };
    sandbox.document = {
        documentElement: { get scrollTop() { return scrollY; } },
        getElementById: () => null,
    };
    withPreservedPortalScroll(() => { scrollY = 0; });
    assert.equal(scrollY, 640);
});
