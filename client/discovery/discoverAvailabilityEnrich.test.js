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

const loadDiscoverAvailabilityEnrich = async () => {
    if (cachedExports) return cachedExports;
    const result = await build({
        entryPoints: [path.join(__dirname, 'discoverAvailabilityEnrich.ts')],
        bundle: true,
        format: 'cjs',
        platform: 'node',
        write: false,
        plugins: [{
            name: 'mock-api-fetch',
            setup(buildApi) {
                buildApi.onResolve({ filter: /\.\.\/shared\/api$/ }, () => ({
                    path: 'mock-api',
                    namespace: 'discover-test',
                }));
                buildApi.onLoad({ filter: /.*/, namespace: 'discover-test' }, () => ({
                    contents: 'exports.apiFetch = (...args) => globalThis.__testApiFetch(...args);',
                    loader: 'js',
                }));
            },
        }],
    });
    const module = { exports: {} };
    vm.runInNewContext(result.outputFiles[0].text, {
        module,
        exports: module.exports,
        require,
        globalThis,
    });
    cachedExports = module.exports;
    return cachedExports;
};

test('enrichDiscoverBrowseRows skips availability-batch when every item already resolves', async () => {
    let apiCalls = 0;
    globalThis.__testApiFetch = async () => {
        apiCalls += 1;
        return { results: [] };
    };

    const { enrichDiscoverBrowseRows } = await loadDiscoverAvailabilityEnrich();
    const items = [{
        mediaType: 'movie',
        tmdbId: 1,
        id: 1,
        mediaInfo: { status: 5 },
    }];
    const result = await enrichDiscoverBrowseRows(items);

    assert.equal(apiCalls, 0);
    assert.equal(result, items);
});

test('enrichDiscoverBrowseRows live-checks titles the disk cache missed', async () => {
    let payloadItems = null;
    globalThis.__testApiFetch = async (_url, options) => {
        payloadItems = JSON.parse(String(options?.body || '{}'))?.items;
        return {
            results: [{
                mediaType: 'movie',
                tmdbId: 1294189,
                mediaInfo: { status: 5 },
                radarrLibraryStatus: { matched: true, hasFile: true, downloading: false },
            }],
        };
    };

    const { enrichDiscoverBrowseRows } = await loadDiscoverAvailabilityEnrich();
    const items = [{
        mediaType: 'movie',
        tmdbId: 1294189,
        id: 1294189,
        title: 'The Mongoose',
    }];
    const result = await enrichDiscoverBrowseRows(items);

    assert.ok(Array.isArray(payloadItems));
    assert.equal(payloadItems.length, 1);
    assert.equal(payloadItems[0].tmdbId, 1294189);
    assert.equal(result[0].mediaInfo.status, 5);
    assert.equal(result[0].radarrLibraryStatus.hasFile, true);
});

test('mergeAvailabilityOntoItems lets continuing Sonarr files win over PROCESSING requests', async () => {
    const { mergeAvailabilityOntoItems } = await loadDiscoverAvailabilityEnrich();
    const result = mergeAvailabilityOntoItems(
        [{
            mediaType: 'tv',
            tmdbId: 194583,
            mediaInfo: {
                status: 3,
                requests: [{ id: 9, status: 2 }],
            },
        }],
        {
            'tv:194583': {
                mediaInfo: { status: 3 },
                sonarrLibraryStatus: {
                    matched: true,
                    showComplete: false,
                    hasActiveDownloads: false,
                    nextAiring: '2026-09-13T00:00:00Z',
                    fileCount: 22,
                },
            },
        },
    );
    assert.equal(result[0].mediaInfo.status, 4);
    assert.equal(result[0].sonarrLibraryStatus.fileCount, 22);
});
