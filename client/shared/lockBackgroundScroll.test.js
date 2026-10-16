import test from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from 'esbuild';
import fs from 'node:fs';
import vm from 'node:vm';

const load = () => {
    const source = fs.readFileSync(new URL('./lockBackgroundScroll.ts', import.meta.url), 'utf8');
    const code = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2020' }).code;
    const module = { exports: {} };
    vm.runInNewContext(`(function(module){${code}\n})(module)`, { module });
    return module.exports;
};

const box = (partial) => ({
    id: '',
    nodeName: 'DIV',
    scrollTop: 0,
    clientHeight: 100,
    scrollHeight: 100,
    parentElement: null,
    hasAttribute: () => false,
    ...partial,
});

test('elementCanScroll is false when content fits', () => {
    const { elementCanScroll } = load();
    assert.equal(elementCanScroll(box({ scrollHeight: 80 }), 10), false);
});

test('elementCanScroll allows downward pan only before the bottom', () => {
    const { elementCanScroll } = load();
    const el = box({ scrollTop: 0, scrollHeight: 400 });
    assert.equal(elementCanScroll(el, 12), true);
    el.scrollTop = 300;
    assert.equal(elementCanScroll(el, 12), false);
    assert.equal(elementCanScroll(el, -12), true);
});

test('elementCanScroll allows upward pan only after the top', () => {
    const { elementCanScroll } = load();
    const el = box({ scrollTop: 0, scrollHeight: 400 });
    assert.equal(elementCanScroll(el, -8), false);
    el.scrollTop = 40;
    assert.equal(elementCanScroll(el, -8), true);
});

test('page background scrollers are never treated as modal layers', () => {
    const { isPageBackgroundScroller, isAllowedModalScroller } = load();
    assert.equal(isPageBackgroundScroller(box({ nodeName: 'BODY' })), true);
    assert.equal(isPageBackgroundScroller(box({ id: 'main-scroll-container' })), true);
    assert.equal(isAllowedModalScroller(box({ id: 'main-scroll-container', hasAttribute: () => true })), false);
});

test('shouldPreventBackgroundTouch lets an inner modal scroller pan', () => {
    const { shouldPreventBackgroundTouch, MODAL_SCROLL_ATTR } = load();
    const scroller = box({
        scrollHeight: 500,
        hasAttribute: (name) => name === MODAL_SCROLL_ATTR,
    });
    const child = box({ parentElement: scroller, scrollHeight: 40, clientHeight: 40 });
    assert.equal(shouldPreventBackgroundTouch(child, 20), false);
});

test('shouldPreventBackgroundTouch blocks when the modal scroller is at the end', () => {
    const { shouldPreventBackgroundTouch, MODAL_SCROLL_ATTR } = load();
    const scroller = box({
        scrollTop: 400,
        clientHeight: 100,
        scrollHeight: 500,
        hasAttribute: (name) => name === MODAL_SCROLL_ATTR,
    });
    assert.equal(shouldPreventBackgroundTouch(scroller, 20), true);
    assert.equal(shouldPreventBackgroundTouch(scroller, -20), false);
});

test('shouldPreventBackgroundTouch blocks page-only pans', () => {
    const { shouldPreventBackgroundTouch } = load();
    const page = box({ nodeName: 'BODY', scrollHeight: 2000, clientHeight: 800 });
    const child = box({ parentElement: page, scrollHeight: 40, clientHeight: 40 });
    assert.equal(shouldPreventBackgroundTouch(child, 20), true);
});

test('overflow auto layers are allowed without the data attribute', () => {
    const { shouldPreventBackgroundTouch } = load();
    const dropdown = box({ scrollHeight: 320, clientHeight: 160 });
    assert.equal(shouldPreventBackgroundTouch(dropdown, 10, () => 'auto'), false);
    assert.equal(shouldPreventBackgroundTouch(dropdown, 10, () => 'visible'), true);
});
