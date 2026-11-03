import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlexMetadataClient } from './plexWrite.js';

const PNG_BYTES = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d,
]);

test('selectClearLogo builds PUT .../clearLogo?url= and unlocks first', async () => {
    const calls = [];
    const fetchImpl = async (url, opts = {}) => {
        calls.push({ url: String(url), method: String(opts.method || 'GET') });
        return {
            ok: true,
            status: 200,
            text: async () => '',
            json: async () => ({}),
        };
    };
    const client = createPlexMetadataClient({
        baseUrl: 'http://plex.local:32400',
        token: 'tok',
        fetchImpl,
    });
    await client.selectClearLogo('12345', 'metadata://agent/logo-1', { type: 'movie', unlock: true });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, 'PUT');
    assert.match(calls[0].url, /\/library\/metadata\/12345\?/);
    assert.match(calls[0].url, /clearLogo\.locked=0/);
    assert.equal(calls[1].method, 'PUT');
    assert.match(calls[1].url, /\/library\/metadata\/12345\/clearLogo\?url=/);
    assert.match(calls[1].url, /url=metadata%3A%2F%2Fagent%2Flogo-1/);
});

test('listClearLogos hits GET .../clearLogos', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
        calls.push(String(url));
        return {
            ok: true,
            status: 200,
            json: async () => ({
                MediaContainer: {
                    Metadata: [
                        { ratingKey: 'metadata://a', provider: 'com.plexapp.agents.themoviedb', selected: false },
                    ],
                },
            }),
            text: async () => '',
        };
    };
    const client = createPlexMetadataClient({
        baseUrl: 'http://plex.local:32400',
        token: 'tok',
        fetchImpl,
    });
    const rows = await client.listClearLogos('99');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ratingKey, 'metadata://a');
    assert.match(calls[0], /\/library\/metadata\/99\/clearLogos/);
});

test('uploadClearLogo unlocks then POSTs PNG then selects uploaded', async () => {
    const calls = [];
    const fetchImpl = async (url, opts = {}) => {
        calls.push({
            url: String(url),
            method: String(opts.method || 'GET'),
            type: opts.headers?.['Content-Type'] || '',
            body: opts.body,
        });
        if (String(url).includes('/clearLogos')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    MediaContainer: {
                        Metadata: [
                            { ratingKey: 'upload://clearLogo/1', provider: 'com.plexapp.agents.none', selected: false },
                        ],
                    },
                }),
                text: async () => '',
            };
        }
        return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
    };
    const client = createPlexMetadataClient({
        baseUrl: 'http://plex.local:32400',
        token: 'tok',
        fetchImpl,
    });
    const result = await client.uploadClearLogo('55', {
        buffer: PNG_BYTES,
        contentType: 'image/png',
        type: 'movie',
        unlock: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.logoRatingKey, 'upload://clearLogo/1');
    assert.equal(calls[0].method, 'PUT');
    assert.match(calls[0].url, /clearLogo\.locked=0/);
    assert.equal(calls[1].method, 'POST');
    assert.match(calls[1].url, /\/library\/metadata\/55\/clearLogo$/);
    assert.equal(calls[1].type, 'image/png');
    assert.ok(Buffer.isBuffer(calls[1].body));
    assert.equal(calls[2].method, 'GET');
    assert.match(calls[2].url, /\/clearLogos/);
    assert.equal(calls[3].method, 'PUT');
    assert.match(calls[3].url, /clearLogo\?url=/);
});

test('applyClearLogoWithExternal prefers Plex candidate over TMDB', async () => {
    const posts = [];
    const fetchImpl = async (url, opts = {}) => {
        const method = String(opts.method || 'GET');
        posts.push({ url: String(url), method });
        if (String(url).includes('/clearLogos')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    MediaContainer: {
                        Metadata: [
                            {
                                ratingKey: 'metadata://agent/logo',
                                provider: 'com.plexapp.agents.themoviedb',
                                selected: false,
                            },
                        ],
                    },
                }),
                text: async () => '',
            };
        }
        if (String(url).includes('/library/metadata/77') && method === 'GET' && !String(url).includes('clearLogo')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    MediaContainer: {
                        Metadata: [{
                            ratingKey: '77',
                            type: 'movie',
                            title: 'Demo',
                            Guid: [{ id: 'tmdb://1' }],
                        }],
                    },
                }),
                text: async () => '',
            };
        }
        return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
    };
    const client = createPlexMetadataClient({
        baseUrl: 'http://plex.local:32400',
        token: 'tok',
        fetchImpl,
    });
    const result = await client.applyClearLogoWithExternal('77', {
        type: 'movie',
        dryRun: false,
        tmdbApiKey: 'key',
    });
    assert.equal(result.status, 'applied');
    assert.equal(result.source, 'plex');
    assert.ok(posts.some((c) => c.method === 'PUT' && /clearLogo\?url=/.test(c.url)));
    assert.ok(!posts.some((c) => c.method === 'POST' && /\/clearLogo$/.test(c.url)));
});

test('applyClearLogoWithExternal dry-run reports external when none in Plex', async () => {
    const fetchImpl = async (url, opts = {}) => {
        const u = String(url);
        if (u.includes('/clearLogos')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({ MediaContainer: { Metadata: [] } }),
                text: async () => '',
            };
        }
        if (u.includes('api.themoviedb.org') && u.includes('/images')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    logos: [{ file_path: '/logo.png', iso_639_1: 'en', vote_average: 1 }],
                }),
                text: async () => '',
            };
        }
        if (u.includes('/library/metadata/88') && String(opts.method || 'GET') === 'GET') {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    MediaContainer: {
                        Metadata: [{
                            ratingKey: '88',
                            type: 'show',
                            title: 'Show',
                            Guid: [{ id: 'tmdb://88' }],
                        }],
                    },
                }),
                text: async () => '',
            };
        }
        return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
    };
    const client = createPlexMetadataClient({
        baseUrl: 'http://plex.local:32400',
        token: 'tok',
        fetchImpl,
    });
    const result = await client.applyClearLogoWithExternal('88', {
        type: 'show',
        dryRun: true,
        tmdbApiKey: 'key',
        fetchImpl,
    });
    assert.equal(result.status, 'external');
    assert.equal(result.source, 'tmdb');
    assert.match(String(result.external?.url || ''), /\.png$/i);
});

test('searchMoviesAndShows returns movie and show hits', async () => {
    const client = createPlexMetadataClient({
        baseUrl: 'http://plex.local:32400',
        token: 'tok',
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                MediaContainer: {
                    Hub: [
                        {
                            Metadata: [
                                { ratingKey: '1', type: 'movie', title: 'Movie A', year: 2020 },
                                { ratingKey: '2', type: 'show', title: 'Show B', year: 2021 },
                                { ratingKey: '3', type: 'episode', title: 'Ep' },
                            ],
                        },
                    ],
                },
            }),
            text: async () => '',
        }),
    });
    const items = await client.searchMoviesAndShows('a', { limit: 10 });
    assert.equal(items.length, 2);
    assert.equal(items[0].type, 'movie');
    assert.equal(items[1].type, 'show');
});
