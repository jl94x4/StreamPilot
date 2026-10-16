import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const loadRequestSeasonUtils = () => {
    const source = fs.readFileSync(new URL('./requestSeasonUtils.ts', import.meta.url), 'utf8');
    const code = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2020' }).code;
    const module = { exports: {} };
    vm.runInNewContext(`(function(module){${code}\n})(module)`, { module });
    return module.exports;
};

test('hasSeasonAired does not crash when lastEpisodeToAir is missing', () => {
    const { hasSeasonAired } = loadRequestSeasonUtils();
    const details = {
        firstAirDate: '2020-01-01',
        sonarrLibraryStatus: {
            matched: true,
            seasons: [{ seasonNumber: 1, airedTotal: 8, complete: false }],
        },
        mediaInfo: {
            seasons: [{ seasonNumber: 1, status: 4 }],
        },
    };
    assert.equal(hasSeasonAired(details, 1), true);
    assert.equal(hasSeasonAired(details, 2), false);
});

test('buildSeasonStatusFromCatalogCache handles partial seasons without lastEpisodeToAir', () => {
    const { buildSeasonStatusFromCatalogCache } = loadRequestSeasonUtils();
    const details = {
        firstAirDate: '2020-01-01',
        sonarrLibraryStatus: {
            matched: true,
            seasons: [{ seasonNumber: 1, airedTotal: 6, complete: false }],
        },
        mediaInfo: {
            seasons: [{ seasonNumber: 1, status: 4 }],
        },
    };
    const rows = buildSeasonStatusFromCatalogCache(details);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].seasonNumber, 1);
    assert.ok(rows[0].statusLabel);
});

test('getRequestButtonState keeps Request Series when TMDB has no seasons yet', () => {
    const { getRequestButtonState } = loadRequestSeasonUtils();
    const button = getRequestButtonState('tv', 1, [], { status: 1 }, {
        name: 'The Librarians: The Next Chapter',
        firstAirDate: '2025-05-24',
        status: 'Returning Series',
    });
    assert.equal(button.label, 'Request Series');
    assert.equal(button.disabled, false);
});
