import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let cachedExports = null;

const loadDiscoverAvailability = async () => {
    if (cachedExports) return cachedExports;
    const result = await build({
        entryPoints: [path.join(__dirname, 'discoverAvailability.ts')],
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
    });
    cachedExports = module.exports;
    return cachedExports;
};

test('formatSeasonNumberRange renders first-last season span', async () => {
    const { formatSeasonNumberRange } = await loadDiscoverAvailability();
    assert.equal(formatSeasonNumberRange([3, 0, 2, 1]), '0-3');
    assert.equal(formatSeasonNumberRange([2]), '2');
});

test('formatFulfilledSeasonDetail merges available and up-to-date seasons into one range', async () => {
    const { formatFulfilledSeasonDetail } = await loadDiscoverAvailability();
    const detail = formatFulfilledSeasonDetail([
        { seasonNumber: 0, statusLabel: 'Up to date', requestable: false },
        { seasonNumber: 1, statusLabel: 'Available', requestable: false },
        { seasonNumber: 2, statusLabel: 'Available', requestable: false },
        { seasonNumber: 3, statusLabel: 'Up to date', requestable: false },
    ]);
    assert.equal(detail, 'Seasons 0-3 up to date');
});

test('resolveMediaAvailabilityState treats approved requests as up to date when Sonarr caught up', async () => {
    const { resolveMediaAvailabilityState } = await loadDiscoverAvailability();
    const state = resolveMediaAvailabilityState({
        mediaType: 'tv',
        tmdbId: 194583,
        status: 'Returning Series',
        inProduction: true,
        lastEpisodeToAir: { seasonNumber: 3, episodeNumber: 8 },
        mediaInfo: {
            status: 4,
            requests: [{ id: 9, status: 2 }],
            seasons: [
                { seasonNumber: 0, status: 5 },
                { seasonNumber: 1, status: 5 },
                { seasonNumber: 2, status: 5 },
                { seasonNumber: 3, status: 5 },
            ],
        },
        sonarrLibraryStatus: {
            matched: true,
            showComplete: false,
            hasActiveDownloads: false,
            nextAiring: '2099-01-01T00:00:00Z',
            seasons: [
                { seasonNumber: 1, airedTotal: 6, airedWithFile: 6, complete: true },
                { seasonNumber: 2, airedTotal: 8, airedWithFile: 8, complete: true },
                { seasonNumber: 3, airedTotal: 8, airedWithFile: 8, complete: true },
            ],
        },
    });
    assert.equal(state.kind, 'available');
    assert.equal(state.label, 'Up to date');
    assert.match(String(state.detail || ''), /up to date$/);
});

test('resolveMediaAvailabilityState does not keep Requested on a still-airing show with files', async () => {
    const { resolveMediaAvailabilityState } = await loadDiscoverAvailability();
    const state = resolveMediaAvailabilityState({
        mediaType: 'tv',
        tmdbId: 194583,
        firstAirDate: '2023-06-18',
        mediaInfo: {
            status: 3,
            requests: [{ id: 9, status: 2 }],
        },
        sonarrLibraryStatus: {
            matched: true,
            showComplete: false,
            hasActiveDownloads: false,
            nextAiring: '2026-09-13T00:00:00Z',
            seriesStatus: 'continuing',
            fileCount: 22,
            episodeFileCount: 22,
        },
    });
    assert.notEqual(state.kind, 'requested');
    assert.notEqual(state.kind, 'processing');
    assert.equal(state.kind, 'partial');
});

test('resolveMediaAvailabilityState treats PROCESSING stamps as up to date when Sonarr is caught up', async () => {
    const { resolveMediaAvailabilityState } = await loadDiscoverAvailability();
    const state = resolveMediaAvailabilityState({
        mediaType: 'tv',
        tmdbId: 194583,
        firstAirDate: '2023-06-18',
        mediaInfo: {
            status: 3,
            requests: [{ id: 9, status: 2 }],
        },
        sonarrLibraryStatus: {
            matched: true,
            showComplete: false,
            hasActiveDownloads: false,
            nextAiring: '2099-01-01T00:00:00Z',
            seriesStatus: 'continuing',
            fileCount: 22,
            seasons: [
                { seasonNumber: 1, airedTotal: 6, airedWithFile: 6, complete: true },
                { seasonNumber: 2, airedTotal: 8, airedWithFile: 8, complete: true },
                { seasonNumber: 3, airedTotal: 8, airedWithFile: 8, complete: true },
            ],
        },
    });
    assert.equal(state.kind, 'available');
    assert.equal(state.label, 'Up to date');
});
