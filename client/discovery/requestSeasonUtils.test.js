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

test('getRequestButtonState still offers missing seasons when earlier seasons are available', () => {
    const { buildSeasonStatusFromDetails, getRequestButtonState } = loadRequestSeasonUtils();
    const details = {
        name: 'Example',
        status: 'Returning Series',
        inProduction: true,
        firstAirDate: '2020-01-01',
        lastEpisodeToAir: { seasonNumber: 3, episodeNumber: 8 },
        seasons: [
            { seasonNumber: 1, episodeCount: 10 },
            { seasonNumber: 2, episodeCount: 10 },
            { seasonNumber: 3, episodeCount: 8 },
        ],
        sonarrLibraryStatus: {
            matched: true,
            nextAiring: '2026-11-01T00:00:00Z',
            seasons: [
                { seasonNumber: 1, airedTotal: 10, airedWithFile: 10, complete: true, withFile: 10, total: 10 },
            ],
        },
        mediaInfo: {
            id: 9,
            status: 4,
            seasons: [{ seasonNumber: 1, status: 5 }],
        },
    };
    const rows = buildSeasonStatusFromDetails(details);
    const byNum = Object.fromEntries(rows.map((row) => [row.seasonNumber, row]));
    assert.equal(byNum[1].requestable, false);
    assert.equal(byNum[2].requestable, true);
    assert.equal(byNum[3].requestable, true);
    const button = getRequestButtonState('tv', 4, rows, details.mediaInfo, details);
    assert.equal(button.label, 'Request Seasons');
    assert.equal(button.disabled, false);
    assert.equal(button.hide, undefined);
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
