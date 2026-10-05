import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const load = async () => {
    const result = await build({
        entryPoints: [path.join(__dirname, 'portalLayout.ts')],
        bundle: true,
        format: 'cjs',
        platform: 'node',
        write: false,
    });
    const module = { exports: {} };
    vm.runInNewContext(result.outputFiles[0].text, {
        module,
        exports: module.exports,
        require,
        console,
    });
    return module.exports;
};

test('parsePosterGridValue maps old presets and numeric storage', async () => {
    const { parsePosterGridValue } = await load();
    assert.equal(parsePosterGridValue('large'), 9.5);
    assert.equal(parsePosterGridValue('small'), 5);
    assert.equal(parsePosterGridValue('8.25'), 8.25);
    assert.equal(parsePosterGridValue(12), 12);
    assert.equal(parsePosterGridValue('list', { allowList: true }), 'list');
    assert.equal(parsePosterGridValue('list'), 9.5);
});

test('clampPosterGridScale snaps to the slider step', async () => {
    const { clampPosterGridScale } = await load();
    assert.equal(clampPosterGridScale(8.13), 8.25);
    assert.equal(clampPosterGridScale(3), 4.5);
    assert.equal(clampPosterGridScale(40), 18);
});

test('posterGridDensityBand and grid style follow the numeric scale', async () => {
    const {
        posterGridDensityBand,
        homeRailPosterDensity,
        posterGridScaleRem,
        upgraderPosterGridStyle,
        POSTER_SETS_GRID_PRESET_SCALE,
        parsePosterGridValue,
    } = await load();
    assert.equal(posterGridDensityBand(5), 'small');
    assert.equal(posterGridDensityBand(9.5), 'large');
    assert.equal(posterGridDensityBand('list'), 'list');
    assert.equal(posterGridScaleRem(10), 10);
    assert.equal(homeRailPosterDensity(9.5), 11);
    assert.equal(homeRailPosterDensity('large'), 11);
    assert.equal(upgraderPosterGridStyle(10).gridTemplateColumns, 'repeat(auto-fill, minmax(10rem, 1fr))');
    assert.equal(JSON.stringify(upgraderPosterGridStyle('list')), '{}');
    assert.equal(parsePosterGridValue('large', { presets: POSTER_SETS_GRID_PRESET_SCALE }), 13);
});
