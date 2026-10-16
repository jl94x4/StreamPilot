import test from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from 'esbuild';
import fs from 'node:fs';
import vm from 'node:vm';

const load = () => {
    const source = fs.readFileSync(new URL('./posterSetsDashboardUtils.ts', import.meta.url), 'utf8');
    const code = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2020' }).code;
    const sandbox = { module: { exports: {} } };
    vm.runInNewContext(`(function(module){${code}\n})(module)`, sandbox);
    return sandbox.module.exports;
};

test('Discover Search hides leftover TPDB recently-added catalogs', () => {
    const { shouldShowSearchSetGrid, isTpdbDiscoverCatalogContext } = load();
    assert.equal(isTpdbDiscoverCatalogContext('ThePosterDB · Recently added'), true);
    assert.equal(isTpdbDiscoverCatalogContext('ThePosterDB · Following'), true);
    assert.equal(isTpdbDiscoverCatalogContext('ted lasso'), false);

    assert.equal(shouldShowSearchSetGrid({
        searchMode: 'title',
        setCount: 12,
        searchContext: 'ThePosterDB · Recently added',
    }), false);
    assert.equal(shouldShowSearchSetGrid({
        searchMode: 'recent',
        setCount: 12,
        searchContext: 'ThePosterDB · Recently added',
    }), false);
    assert.equal(shouldShowSearchSetGrid({
        searchMode: 'title',
        setCount: 8,
        searchContext: 'ted lasso',
    }), true);
    assert.equal(shouldShowSearchSetGrid({
        searchMode: 'creator',
        setCount: 4,
        searchContext: '@kaster',
    }), true);
    assert.equal(shouldShowSearchSetGrid({
        searchMode: 'title',
        setCount: 0,
        searchContext: 'ted lasso',
    }), false);
});
