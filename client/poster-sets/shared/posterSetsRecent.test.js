import test from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from 'esbuild';
import fs from 'node:fs';
import vm from 'node:vm';

const load = () => {
    const source = fs.readFileSync(new URL('./posterSetsRecent.ts', import.meta.url), 'utf8');
    const code = transformSync(source, {
        loader: 'ts',
        format: 'cjs',
        target: 'es2020',
        banner: 'const exports = module.exports;',
    }).code;
    const sandbox = {
        module: { exports: {} },
        exports: {},
        require: (id) => {
            if (id === '../previewGroups') {
                return { classifyPreviewAsset: () => 'poster' };
            }
            if (id === '../types' || id === './posterSetsNav' || id === './tpdbUserHandle.js') {
                return {};
            }
            throw new Error(`unexpected require: ${id}`);
        },
    };
    sandbox.exports = sandbox.module.exports;
    vm.runInNewContext(code, sandbox);
    return sandbox.module.exports;
};

test('mixed MediUX title-card listings also appear under Posters with the poster thumb', () => {
    const { partitionSetsByCategory } = load();
    const mixed = {
        title: 'Westworld (2016) Set',
        setKind: 'title_cards',
        thumbUrl: 'https://cdn.example/title-card.jpg',
        landscapeThumbUrl: 'https://cdn.example/title-card.jpg',
        posterThumbUrl: 'https://cdn.example/poster.jpg',
        provider: 'mediux',
    };
    const { titleCards, posters, backgrounds } = partitionSetsByCategory([mixed], { mediaType: 'show' });
    assert.equal(titleCards.length, 1);
    assert.equal(titleCards[0].thumbUrl, mixed.landscapeThumbUrl);
    assert.equal(posters.length, 1);
    assert.equal(posters[0].thumbUrl, mixed.posterThumbUrl);
    assert.equal(backgrounds.length, 0);
});

test('exclusive title-card packs stay out of Posters', () => {
    const { partitionSetsByCategory, isExclusiveTitleCardSet } = load();
    const pack = {
        title: 'Westworld Title Cards',
        setKind: 'title_cards',
        thumbUrl: 'https://cdn.example/card.jpg',
    };
    assert.equal(isExclusiveTitleCardSet(pack, { mediaType: 'show' }), true);
    const { titleCards, posters } = partitionSetsByCategory([pack], { mediaType: 'show' });
    assert.equal(titleCards.length, 1);
    assert.equal(posters.length, 0);
});
