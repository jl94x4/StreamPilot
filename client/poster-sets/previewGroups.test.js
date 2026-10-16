import test from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from 'esbuild';
import fs from 'node:fs';
import vm from 'node:vm';

const load = () => {
    const source = fs.readFileSync(new URL('./previewGroups.ts', import.meta.url), 'utf8');
    const code = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2020' }).code;
    const sandbox = { module: { exports: {} } };
    vm.runInNewContext(`(function(module){${code}\n})(module)`, sandbox);
    return sandbox.module.exports;
};

const asset = (overrides) => ({
    id: 'id',
    kind: 'show',
    title: 'Trigger Point',
    label: 'Poster',
    thumbUrl: 'https://cdn.example/a.jpg',
    matched: true,
    ...overrides,
});

test('mixed MediUX preview thumbs split posters from title cards', () => {
    const { inspectorThumbsFromAssets, groupInspectorThumbs } = load();
    const thumbs = inspectorThumbsFromAssets([
        asset({ id: 'poster', season: 'Cover', fileType: 'show_cover', label: 'Cover' }),
        asset({ id: 'season', season: 1, episode: 'Cover', fileType: 'season_cover', label: 'Season 1' }),
        asset({ id: 'card', season: 1, episode: 1, fileType: 'title_card', label: 'S01E01' }),
        asset({ id: 'backdrop', season: 'Backdrop', fileType: 'backdrop', label: 'Backdrop' }),
    ], (url) => url || '');
    const groups = groupInspectorThumbs(thumbs, 'poster');
    const ids = (list) => [...list].map((item) => String(item));
    assert.equal(ids(groups.map((group) => group.id)).join(','), 'posters,backdrops,title_cards');
    assert.equal(groups.find((group) => group.id === 'posters').layout, 'poster');
    assert.equal(ids(groups.find((group) => group.id === 'posters').thumbs.map((thumb) => thumb.id)).join(','), 'poster,season');
    assert.equal(groups.find((group) => group.id === 'title_cards').layout, 'landscape');
    assert.equal(ids(groups.find((group) => group.id === 'title_cards').thumbs.map((thumb) => thumb.id)).join(','), 'card');
    assert.equal(ids(groups.find((group) => group.id === 'backdrops').thumbs.map((thumb) => thumb.id)).join(','), 'backdrop');
});
