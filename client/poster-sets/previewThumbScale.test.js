import test from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from 'esbuild';
import fs from 'node:fs';
import vm from 'node:vm';

const load = () => {
    const source = fs.readFileSync(new URL('./previewThumbScale.ts', import.meta.url), 'utf8');
    const code = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2020' }).code;
    const sandbox = { module: { exports: {} } };
    vm.runInNewContext(`(function(module){${code}\n})(module)`, sandbox);
    return sandbox.module.exports;
};

test('preview thumb scale clamps and sizes posters vs title cards', () => {
    const {
        clampPreviewThumbScale,
        previewThumbWidthPx,
        PREVIEW_THUMB_SCALE_DEFAULT,
        PREVIEW_THUMB_POSTER_BASE_PX,
        PREVIEW_THUMB_LANDSCAPE_BASE_PX,
    } = load();
    assert.equal(clampPreviewThumbScale('nope'), PREVIEW_THUMB_SCALE_DEFAULT);
    assert.equal(clampPreviewThumbScale(10), 80);
    assert.equal(clampPreviewThumbScale(400), 220);
    assert.equal(previewThumbWidthPx('poster', 100), PREVIEW_THUMB_POSTER_BASE_PX);
    assert.equal(previewThumbWidthPx('landscape', 100), PREVIEW_THUMB_LANDSCAPE_BASE_PX);
    assert.ok(previewThumbWidthPx('landscape', 140) > previewThumbWidthPx('landscape', 100));
});
