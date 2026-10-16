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

const loadDiscoverFetchUtils = async () => {
    if (cachedExports) return cachedExports;
    const result = await build({
        entryPoints: [path.join(__dirname, 'discoverFetchUtils.ts')],
        bundle: true,
        format: 'cjs',
        platform: 'node',
        write: false,
        external: ['react', 'react-dom', 'react/jsx-runtime', 'lucide-react'],
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
        process,
        Buffer,
        console,
        setTimeout,
        clearTimeout,
    });
    cachedExports = module.exports;
    return cachedExports;
};

const pageFromUrl = (url) => Number(String(url).match(/[?&]page=(\d+)/)?.[1] || 0);

const movie = (id, extra = {}) => ({
    id,
    tmdbId: id,
    mediaType: 'movie',
    title: `Title ${id}`,
    posterPath: `/p${id}.jpg`,
    ...extra,
});

test('home rails keep paging past library-heavy TMDB pages when hide-available is on', async () => {
    const fetchedPages = [];
    globalThis.__testApiFetch = async (url) => {
        const page = pageFromUrl(url);
        fetchedPages.push(page);
        const available = page <= 8;
        return {
            totalPages: 20,
            results: Array.from({ length: 20 }, (_, i) => movie(page * 100 + i, {
                mediaInfo: available ? { status: 5 } : undefined,
            })),
        };
    };

    const { fetchDiscoverHomeRowResults } = await loadDiscoverFetchUtils();
    const items = await fetchDiscoverHomeRowResults(
        (page) => `/api/discovery/proxy/discover/movies?genre=16&page=${page}`,
        true,
        { maxPages: 16, minItems: 20, maxItems: 36, requirePoster: true },
    );

    assert.equal(items.length, 20);
    assert.ok(fetchedPages.includes(9), 'should scan past the in-library pages');
    assert.equal(items[0].tmdbId, 900);
});

test('home rails refill after live enrich drops titles the disk cache missed', async () => {
    const fetchedPages = [];
    globalThis.__testApiFetch = async (url) => {
        const page = pageFromUrl(url);
        fetchedPages.push(page);
        return {
            totalPages: 20,
            results: Array.from({ length: 20 }, (_, i) => movie(page * 100 + i)),
        };
    };

    const { fetchDiscoverHomeRowResults } = await loadDiscoverFetchUtils();
    const items = await fetchDiscoverHomeRowResults(
        (page) => `/api/discovery/proxy/discover/movies?genre=16&page=${page}`,
        true,
        {
            maxPages: 16,
            minItems: 20,
            maxItems: 36,
            requirePoster: true,
            enrich: async (batch) => batch.map((item) => (
                item.tmdbId < 900
                    ? { ...item, mediaInfo: { status: 5 } }
                    : item
            )),
        },
    );

    assert.ok(items.length >= 20);
    assert.ok(items.length <= 36);
    assert.ok(Math.max(...fetchedPages) >= 9);
    assert.ok(items.every((item) => item.tmdbId >= 900));
});
