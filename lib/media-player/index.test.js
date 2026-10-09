import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMediaPlayerRouter } from './index.js';

const oakStreetMeta = {
    MediaContainer: {
        Metadata: [{
            ratingKey: '637418',
            title: 'The End of Oak Street',
            type: 'movie',
            duration: 6000000,
            Media: [
                {
                    videoResolution: '4k',
                    height: 2160,
                    videoCodec: 'hevc',
                    audioCodec: 'eac3',
                    container: 'mkv',
                    Part: [{
                        id: 101,
                        container: 'mkv',
                        Stream: [
                            { id: 10, streamType: 1, codec: 'hevc', profile: 'main 10', height: 2160 },
                            { id: 20, streamType: 2, codec: 'eac3', selected: true, channels: 6, language: 'English' },
                        ],
                    }],
                },
                {
                    title: '1080p · H264 · MKV',
                    videoResolution: '1080',
                    height: 1080,
                    videoCodec: 'h264',
                    audioCodec: 'aac',
                    container: 'mkv',
                    Part: [{
                        id: 102,
                        container: 'mkv',
                        Stream: [
                            { id: 30, streamType: 1, codec: 'h264', height: 1080 },
                            { id: 40, streamType: 2, codec: 'aac', selected: true, channels: 2, language: 'English' },
                        ],
                    }],
                },
            ],
        }],
    },
};

const listen = (app) => new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
});

const createApp = ({ fetchImpl, resolveMemberPlexToken, resolveMemberAccountId, user, config } = {}) => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = user || { id: 'member-1', plexAccountId: 'acct-99', isAdmin: false };
        next();
    });
    app.use('/api/media-player', createMediaPlayerRouter({
        Router: express.Router,
        requireAuth: (_req, _res, next) => next(),
        requireMember: (_req, _res, next) => next(),
        loadPortalConfig: async () => ({
            mediaServerType: 'plex',
            plexToken: 'server-token',
            serverIdentifier: 'abc',
            ...(config || {}),
        }),
        getPlexConnectionUri: async () => 'http://127.0.0.1:32400',
        plexClientHeaders: (token) => ({
            Accept: 'application/json',
            'X-Plex-Token': token,
            'X-Plex-Client-Identifier': 'test',
        }),
        resolveMemberPlexToken: resolveMemberPlexToken || (async () => 'member-token'),
        resolveMemberAccountId: resolveMemberAccountId || (async () => null),
        fetchImpl: fetchImpl || (async (url) => {
            if (String(url).includes('/library/metadata/637418')) {
                return { ok: true, json: async () => oakStreetMeta };
            }
            throw new Error(`unexpected ${url}`);
        }),
    }));
    return app;
};

test('POST /play returns an HLS session for a 4K title with an H264 version', async () => {
    const app = createApp();
    const server = await listen(app);
    try {
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}/api/media-player/play/637418`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client: 'web',
                mediaIndex: 1,
                qualityId: '1080-12',
                canPlayHevc: false,
                canPlayAc3: false,
                canPlayNativeHls: false,
            }),
        });
        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.item.ratingKey, '637418');
        assert.equal(body.item.title, 'The End of Oak Street');
        assert.equal(body.mediaIndex, 1);
        assert.equal(body.qualityId, '1080-12');
        assert.match(String(body.src), /\/api\/media-player\/hls\/637418\/master\.m3u8/);
        assert.match(String(body.src), /quality=1080-12/);
        assert.equal(JSON.stringify(body).includes('/library/parts'), false);
        assert.equal(body.versions.length, 2);
        assert.equal(body.versions[1].label, '1080p · H264 · MKV');
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('POST /play falls back to the server token when the member token cannot load metadata', async () => {
    const app = createApp({
        fetchImpl: async (url) => {
            const href = String(url);
            if (href.includes('X-Plex-Token=member-token')) {
                return { ok: false, status: 401, json: async () => ({}) };
            }
            if (href.includes('/library/metadata/637418')) {
                return { ok: true, json: async () => oakStreetMeta };
            }
            throw new Error(`unexpected ${url}`);
        },
    });
    const server = await listen(app);
    try {
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}/api/media-player/play/637418`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client: 'web' }),
        });
        const body = await res.json();
        assert.equal(res.status, 200, body.error);
        assert.match(String(body.src), /\/api\/media-player\/hls\/637418\/master\.m3u8/);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('GET /play starts a session without a POST body', async () => {
    const app = createApp();
    const server = await listen(app);
    try {
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}/api/media-player/play/637418?client=web&mediaIndex=1&qualityId=1080-12`);
        const body = await res.json();
        assert.equal(res.status, 200, body.error);
        assert.equal(body.mediaIndex, 1);
        assert.equal(body.qualityId, '1080-12');
        assert.match(String(body.src), /\/api\/media-player\/hls\/637418\/master\.m3u8/);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('POST /play returns JSON when Plex metadata fails', async () => {
    const app = createApp({
        resolveMemberPlexToken: async () => null,
        fetchImpl: async () => {
            throw new Error('Plex is unreachable');
        },
    });
    const server = await listen(app);
    try {
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}/api/media-player/play/637418`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client: 'web' }),
        });
        const body = await res.json();
        assert.equal(res.status, 500);
        assert.equal(body.error, 'Plex is unreachable');
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('HLS start uses the member token so Plex can show who is watching', async () => {
    const seen = [];
    const app = createApp({
        user: { id: 'member-1', plexAccountId: 'acct-99', username: 'jason', isAdmin: false },
        fetchImpl: async (url, opts) => {
            const href = String(url);
            seen.push({
                href,
                token: opts?.headers?.['X-Plex-Token'],
                client: opts?.headers?.['X-Plex-Client-Identifier'],
                device: opts?.headers?.['X-Plex-Device-Name'],
            });
            if (href.includes('/library/metadata/637418')) {
                return { ok: true, json: async () => oakStreetMeta };
            }
            if (href.includes('/video/:/transcode/universal/start.m3u8')) {
                return {
                    ok: true,
                    url: href,
                    headers: { get: () => 'application/vnd.apple.mpegurl' },
                    text: async () => '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nmedia.m3u8\n',
                };
            }
            throw new Error(`unexpected ${url}`);
        },
    });
    const server = await listen(app);
    try {
        const port = server.address().port;
        const playRes = await fetch(`http://127.0.0.1:${port}/api/media-player/play/637418?client=web`);
        const playBody = await playRes.json();
        assert.equal(playRes.status, 200, playBody.error);
        const src = new URL(String(playBody.src), `http://127.0.0.1:${port}`);
        const hlsRes = await fetch(src);
        assert.equal(hlsRes.status, 200, await hlsRes.text().catch(() => ''));
        const start = seen.find((row) => row.href.includes('/video/:/transcode/universal/start.m3u8'));
        assert.ok(start, 'expected a Plex HLS start request');
        assert.equal(start.token, 'member-token');
        assert.equal(start.client, 'test-mp-acct99');
        assert.equal(start.device, 'Portal (jason)');
        assert.match(start.href, /subtitleStreamID=0/);
        assert.match(start.href, /subtitles=none/);
        assert.match(start.href, /directPlay=0/);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('HLS start falls back to the server token when the member token is rejected', async () => {
    const seen = [];
    const app = createApp({
        fetchImpl: async (url, opts) => {
            const href = String(url);
            const token = opts?.headers?.['X-Plex-Token'];
            seen.push({
                href,
                token,
                client: opts?.headers?.['X-Plex-Client-Identifier'],
            });
            if (href.includes('/library/metadata/637418')) {
                return { ok: true, json: async () => oakStreetMeta };
            }
            if (href.includes('/video/:/transcode/universal/start.m3u8')) {
                if (token === 'member-token') {
                    return { ok: false, status: 401, text: async () => 'Unauthorized' };
                }
                return {
                    ok: true,
                    url: href,
                    headers: { get: () => 'application/vnd.apple.mpegurl' },
                    text: async () => '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nmedia.m3u8\n',
                };
            }
            throw new Error(`unexpected ${url}`);
        },
    });
    const server = await listen(app);
    try {
        const port = server.address().port;
        const playRes = await fetch(`http://127.0.0.1:${port}/api/media-player/play/637418?client=web`);
        const playBody = await playRes.json();
        assert.equal(playRes.status, 200, playBody.error);
        const src = new URL(String(playBody.src), `http://127.0.0.1:${port}`);
        const hlsRes = await fetch(src);
        assert.equal(hlsRes.status, 200, await hlsRes.text().catch(() => ''));
        const starts = seen.filter((row) => row.href.includes('/video/:/transcode/universal/start.m3u8'));
        assert.equal(starts[0]?.token, 'member-token');
        const fallback = starts.find((row) => row.token === 'server-token');
        assert.ok(fallback, 'expected a server-token HLS fallback');
        assert.equal(fallback.client, 'test-mp-player');
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('timeline reports with the member token so Now Playing shows the watcher', async () => {
    const seen = [];
    const app = createApp({
        user: { id: 'member-1', plexAccountId: 'acct-99', username: 'jason', isAdmin: false },
        fetchImpl: async (url, opts) => {
            const href = String(url);
            seen.push({
                href,
                token: opts?.headers?.['X-Plex-Token'],
                client: opts?.headers?.['X-Plex-Client-Identifier'],
            });
            if (href.includes('/:/timeline')) {
                return { ok: true, status: 200, text: async () => '' };
            }
            throw new Error(`unexpected ${url}`);
        },
    });
    const server = await listen(app);
    try {
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}/api/media-player/timeline`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ratingKey: '637418',
                sessionId: '11111111-1111-4111-8111-111111111111',
                state: 'playing',
                timeMs: 30000,
                durationMs: 1200000,
            }),
        });
        assert.equal(res.status, 204);
        const ping = seen.find((row) => row.href.includes('/:/timeline'));
        assert.ok(ping, 'expected a Plex timeline request');
        assert.equal(ping.token, 'member-token');
        assert.equal(ping.client, 'test-mp-acct99');
        assert.match(ping.href, /11111111-1111-4111-8111-111111111111/);
        assert.match(ping.href, /subtitleStreamID=0/);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('timeline does not fall back to the owner token when the member token is refused', async () => {
    const seen = [];
    const app = createApp({
        user: { id: 'member-1', plexAccountId: 'acct-99', username: 'jason', isAdmin: false },
        fetchImpl: async (url, opts) => {
            const href = String(url);
            seen.push({
                href,
                token: opts?.headers?.['X-Plex-Token'],
            });
            if (href.includes('/:/timeline')) {
                return { ok: false, status: 401, text: async () => 'unauthorized' };
            }
            throw new Error(`unexpected ${url}`);
        },
    });
    const server = await listen(app);
    try {
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}/api/media-player/timeline`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ratingKey: '637418',
                sessionId: '11111111-1111-4111-8111-111111111111',
                state: 'playing',
                timeMs: 30000,
                durationMs: 1200000,
            }),
        });
        assert.equal(res.status, 204);
        const timelineHits = seen.filter((row) => row.href.includes('/:/timeline'));
        assert.equal(timelineHits.length, 1);
        assert.equal(timelineHits[0].token, 'member-token');
        assert.equal(timelineHits.some((row) => row.token === 'server-token'), false);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('GET /theme proxies Plex theme audio without exposing a token', async () => {
    const seen = [];
    const app = createApp({
        fetchImpl: async (url, opts) => {
            const href = String(url);
            seen.push({ href, token: opts?.headers?.['X-Plex-Token'] });
            if (href.includes('/library/metadata/99') && !href.includes('/theme')) {
                return {
                    ok: true,
                    json: async () => ({
                        MediaContainer: {
                            Metadata: [{
                                ratingKey: '99',
                                title: 'The Wire',
                                type: 'show',
                                theme: '/library/metadata/99/theme?t=123&X-Plex-Token=secret',
                            }],
                        },
                    }),
                };
            }
            if (href.includes('/library/metadata/99/theme')) {
                return {
                    ok: true,
                    status: 200,
                    headers: { get: (name) => (name === 'content-type' ? 'audio/mpeg' : null) },
                    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
                };
            }
            throw new Error(`unexpected ${url}`);
        },
    });
    const server = await listen(app);
    try {
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}/api/media-player/theme/99`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-type'), 'audio/mpeg');
        assert.deepEqual([...Buffer.from(await res.arrayBuffer())], [1, 2, 3, 4]);
        const themeReq = seen.find((row) => row.href.includes('/library/metadata/99/theme'));
        assert.ok(themeReq, 'expected a Plex theme request');
        assert.match(themeReq.href, /X-Plex-Token=member-token/);
        assert.equal(themeReq.href.includes('secret'), false);
        assert.equal(JSON.stringify(seen).includes('secret'), false);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('GET /theme 404s when the title has no theme music', async () => {
    const app = createApp();
    const server = await listen(app);
    try {
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}/api/media-player/theme/637418`);
        const body = await res.json();
        assert.equal(res.status, 404);
        assert.equal(body.error, 'No theme music.');
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('GET /home uses Plex promoted hubs in server pin order', async () => {
    let promotedHits = 0;
    const app = createApp({
        fetchImpl: async (url) => {
            const href = String(url);
            if (href.includes('/library/sections')) {
                return {
                    ok: true,
                    json: async () => ({
                        MediaContainer: {
                            Directory: [{ key: '1', title: 'Movies', type: 'movie' }],
                        },
                    }),
                };
            }
            if (href.includes('/hubs/promoted')) {
                promotedHits += 1;
                return {
                    ok: true,
                    json: async () => ({
                        MediaContainer: {
                            Hub: [
                                {
                                    title: 'Trending Movies',
                                    hubIdentifier: 'movie.collection.831577',
                                    key: '/library/collections/831577/children',
                                    Metadata: [{ ratingKey: '12', title: 'Heat', type: 'movie' }],
                                },
                                {
                                    title: 'Recently Added Movies',
                                    hubIdentifier: 'movie.recentlyadded',
                                    Metadata: [{ ratingKey: '13', title: 'New Film', type: 'movie' }],
                                },
                            ],
                        },
                    }),
                };
            }
            if (href.includes('/library/onDeck')) {
                return { ok: true, json: async () => ({ MediaContainer: { Metadata: [] } }) };
            }
            if (href.includes('/hubs/home')) {
                return { ok: true, json: async () => ({ MediaContainer: { Hub: [] } }) };
            }
            throw new Error(`unexpected ${url}`);
        },
    });
    const server = await listen(app);
    try {
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}/api/media-player/home`);
        const body = await res.json();
        assert.equal(res.status, 200, body.error);
        assert.equal(body.hubs[0].title, 'Trending Movies');
        assert.equal(body.hubs[0].collectionRatingKey, '831577');
        assert.equal(body.hubs[0].items[0].title, 'Heat');
        assert.equal(body.hubs[1].title, 'Recently Added Movies');
        assert.equal(body.recentByLibrary.length, 0);
        const cached = await fetch(`http://127.0.0.1:${port}/api/media-player/home`);
        assert.equal(cached.status, 200);
        assert.equal(promotedHits, 2);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});


test('GET /home keeps every promoted hub and appends extra home hubs', async () => {
    const app = createApp({
        fetchImpl: async (url) => {
            const href = String(url);
            if (href.includes('/library/sections')) {
                return {
                    ok: true,
                    json: async () => ({
                        MediaContainer: {
                            Directory: [{ key: '1', title: 'Movies', type: 'movie' }],
                        },
                    }),
                };
            }
            if (href.includes('/hubs/promoted')) {
                return {
                    ok: true,
                    json: async () => ({
                        MediaContainer: {
                            Hub: Array.from({ length: 15 }, (_, index) => ({
                                title: `Pinned ${index + 1}`,
                                hubIdentifier: `movie.pin.${index + 1}`,
                                Metadata: [{ ratingKey: String(100 + index), title: `Title ${index + 1}`, type: 'movie' }],
                            })),
                        },
                    }),
                };
            }
            if (href.includes('/library/onDeck')) {
                return { ok: true, json: async () => ({ MediaContainer: { Metadata: [] } }) };
            }
            if (href.includes('/hubs/home')) {
                return {
                    ok: true,
                    json: async () => ({
                        MediaContainer: {
                            Hub: [
                                {
                                    title: 'Pinned 1',
                                    hubIdentifier: 'movie.pin.1',
                                    Metadata: [{ ratingKey: '100', title: 'Title 1', type: 'movie' }],
                                },
                                {
                                    title: 'Recently Added TV',
                                    hubIdentifier: 'show.recentlyadded',
                                    Metadata: [{ ratingKey: '200', title: 'New Show', type: 'show' }],
                                },
                            ],
                        },
                    }),
                };
            }
            throw new Error(`unexpected ${url}`);
        },
    });
    const server = await listen(app);
    try {
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}/api/media-player/home`);
        const body = await res.json();
        assert.equal(res.status, 200, body.error);
        assert.equal(body.hubs.length, 16);
        assert.equal(body.hubs[0].title, 'Pinned 1');
        assert.equal(body.hubs[14].title, 'Pinned 15');
        assert.equal(body.hubs[15].title, 'Recently Added TV');
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
test('GET /home Continue Watching uses the member On Deck not the admin hub', async () => {
    const onDeckUrls = [];
    const app = createApp({
        fetchImpl: async (url) => {
            const href = String(url);
            if (href.includes('/library/sections') && !href.includes('onDeck')) {
                return {
                    ok: true,
                    json: async () => ({
                        MediaContainer: {
                            Directory: [{ key: '1', title: 'Movies', type: 'movie' }],
                        },
                    }),
                };
            }
            if (href.includes('/hubs/promoted')) {
                if (href.includes('member-token')) {
                    return { ok: false, status: 401 };
                }
                return {
                    ok: true,
                    json: async () => ({
                        MediaContainer: {
                            Hub: [
                                {
                                    title: 'Continue Watching',
                                    hubIdentifier: 'home.continueWatching',
                                    Metadata: [{ ratingKey: 'admin-1', title: 'Admin Movie', type: 'movie' }],
                                },
                                {
                                    title: 'Top Movies Of The Week',
                                    hubIdentifier: 'movie.top',
                                    Metadata: [{ ratingKey: '12', title: 'Heat', type: 'movie' }],
                                },
                            ],
                        },
                    }),
                };
            }
            if (href.includes('/library/onDeck')) {
                onDeckUrls.push(href);
                if (!href.includes('member-token') || href.includes('server-token')) {
                    throw new Error(`onDeck used the wrong token: ${href}`);
                }
                return {
                    ok: true,
                    json: async () => ({
                        MediaContainer: {
                            Metadata: [{
                                ratingKey: 'vik-1',
                                title: 'Tripping',
                                type: 'episode',
                                grandparentTitle: "Clarkson's Farm",
                                grandparentThumb: '/library/metadata/9/thumb',
                            }],
                        },
                    }),
                };
            }
            if (href.includes('/hubs/home') || href.includes('/hubs?')) {
                if (href.includes('member-token')) return { ok: false, status: 401 };
                return { ok: true, json: async () => ({ MediaContainer: { Hub: [] } }) };
            }
            throw new Error(`unexpected ${url}`);
        },
    });
    const server = await listen(app);
    try {
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}/api/media-player/home`);
        const body = await res.json();
        assert.equal(res.status, 200, body.error);
        const continueHub = (body.hubs || []).find((hub) => /continue/i.test(`${hub.title} ${hub.identifier}`));
        assert.ok(continueHub, 'expected a Continue Watching hub');
        assert.equal(continueHub.items[0].title, "Clarkson's Farm");
        assert.equal(continueHub.items.some((row) => row.title === 'Admin Movie'), false);
        assert.equal(body.continueWatching[0].title, "Clarkson's Farm");
        assert.equal(onDeckUrls.length > 0, true);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('GET /home keeps the member Continue Watching hub when On Deck is empty', async () => {
    const app = createApp({
        fetchImpl: async (url) => {
            const href = String(url);
            if (href.includes('/library/sections') && !href.includes('onDeck')) {
                return {
                    ok: true,
                    json: async () => ({
                        MediaContainer: {
                            Directory: [{ key: '1', title: 'Movies', type: 'movie' }],
                        },
                    }),
                };
            }
            if (href.includes('/hubs/promoted')) {
                if (!href.includes('member-token')) throw new Error(`promoted used the server token: ${href}`);
                return {
                    ok: true,
                    json: async () => ({
                        MediaContainer: {
                            Hub: [
                                {
                                    title: 'Continue Watching',
                                    hubIdentifier: 'home.continueWatching',
                                    Metadata: [{
                                        ratingKey: 'vik-2',
                                        title: 'Tripping',
                                        type: 'episode',
                                        grandparentTitle: "Clarkson's Farm",
                                        grandparentThumb: '/library/metadata/9/thumb',
                                    }],
                                },
                                {
                                    title: 'Top Movies Of The Week',
                                    hubIdentifier: 'movie.top',
                                    Metadata: [{ ratingKey: '12', title: 'Heat', type: 'movie' }],
                                },
                            ],
                        },
                    }),
                };
            }
            if (href.includes('/library/onDeck') || href.includes('/hubs/home')) {
                return { ok: true, json: async () => ({ MediaContainer: { Metadata: [], Hub: [] } }) };
            }
            throw new Error(`unexpected ${url}`);
        },
    });
    const server = await listen(app);
    try {
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}/api/media-player/home`);
        const body = await res.json();
        assert.equal(res.status, 200, body.error);
        const continueHub = (body.hubs || []).find((hub) => /continue/i.test(`${hub.title} ${hub.identifier}`));
        assert.ok(continueHub, 'expected a Continue Watching hub');
        assert.equal(continueHub.items[0].title, "Clarkson's Farm");
        assert.equal(body.continueWatching[0].title, "Clarkson's Farm");
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('GET /me returns a username and strips tokens from avatars', async () => {
    const app = createApp({
        user: {
            id: 'member-1',
            plexAccountId: 'acct-99',
            username: 'Jason',
            thumb: 'https://plex.tv/users/abc/avatar?X-Plex-Token=secret',
            isAdmin: false,
        },
    });
    const server = await listen(app);
    try {
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}/api/media-player/me`);
        const body = await res.json();
        assert.equal(res.status, 200, body.error);
        assert.equal(body.username, 'Jason');
        assert.match(String(body.thumb), /^https:\/\/plex\.tv\//);
        assert.equal(String(body.thumb).includes('secret'), false);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('GET /search includes actors from People hubs', async () => {
    const app = createApp({
        fetchImpl: async (url) => {
            const href = String(url);
            if (href.includes('/hubs/search')) {
                return {
                    ok: true,
                    json: async () => ({
                        MediaContainer: {
                            Hub: [
                                {
                                    title: 'People',
                                    hubIdentifier: 'actor',
                                    Directory: [{
                                        id: '55',
                                        tag: 'Damian Lewis',
                                        type: 'actor',
                                        thumb: '/library/metadata/55/thumb',
                                    }],
                                },
                                {
                                    title: 'Movies',
                                    Metadata: [{ ratingKey: 'm1', title: 'Band of Brothers', type: 'movie' }],
                                },
                            ],
                        },
                    }),
                };
            }
            throw new Error(`unexpected ${url}`);
        },
    });
    const server = await listen(app);
    try {
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}/api/media-player/search?q=damian`);
        const body = await res.json();
        assert.equal(res.status, 200, body.error);
        const person = (body.results || []).find((row) => row.type === 'person');
        assert.ok(person, 'expected a person search hit');
        assert.equal(person.title, 'Damian Lewis');
        assert.equal(person.personId, '55');
        assert.equal(person.canPlay, false);
        assert.equal((body.results || []).some((row) => row.type === 'movie'), true);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('GET /search keeps shows, movies, and episodes instead of flattening to one cap', async () => {
    const app = createApp({
        fetchImpl: async (url) => {
            const href = String(url);
            if (href.includes('/hubs/search')) {
                return {
                    ok: true,
                    json: async () => ({
                        MediaContainer: {
                            Hub: [
                                {
                                    title: 'Episodes',
                                    Metadata: Array.from({ length: 20 }, (_, i) => ({
                                        ratingKey: `e${i}`,
                                        title: `Episode ${i}`,
                                        type: 'episode',
                                        grandparentTitle: 'Clarkson\'s Farm',
                                        parentIndex: 1,
                                        index: i + 1,
                                        thumb: `/library/metadata/e${i}/thumb`,
                                    })),
                                },
                                {
                                    title: 'Shows',
                                    Metadata: [{ ratingKey: 's1', title: 'Clarkson\'s Farm', type: 'show' }],
                                },
                                {
                                    title: 'Movies',
                                    Metadata: [{ ratingKey: 'm1', title: 'Clarkson', type: 'movie' }],
                                },
                            ],
                        },
                    }),
                };
            }
            throw new Error(`unexpected ${url}`);
        },
    });
    const server = await listen(app);
    try {
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}/api/media-player/search?q=clarkson`);
        const body = await res.json();
        assert.equal(res.status, 200, body.error);
        const types = (body.results || []).map((row) => row.type);
        assert.equal(types.includes('show'), true);
        assert.equal(types.includes('movie'), true);
        assert.equal(types.includes('episode'), true);
        assert.equal(types.filter((type) => type === 'show')[0] ? body.results.find((row) => row.type === 'show').title : '', 'Clarkson\'s Farm');
        assert.ok(types.filter((type) => type === 'episode').length <= 16);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('GET /home Continue Watching for shared friends uses their PMS history', async () => {
    const historyUrls = [];
    const app = createApp({
        resolveMemberPlexToken: async () => null,
        resolveMemberAccountId: async () => '42',
        fetchImpl: async (url) => {
            const href = String(url);
            if (href.includes('/library/sections') && !href.includes('onDeck')) {
                return {
                    ok: true,
                    json: async () => ({
                        MediaContainer: {
                            Directory: [{ key: '1', title: 'Movies', type: 'movie' }],
                        },
                    }),
                };
            }
            if (href.includes('/hubs/promoted') || href.includes('/hubs/home') || href.includes('/hubs?')) {
                return {
                    ok: true,
                    json: async () => ({
                        MediaContainer: {
                            Hub: [
                                {
                                    title: 'Continue Watching',
                                    hubIdentifier: 'home.continueWatching',
                                    Metadata: [{ ratingKey: 'admin-1', title: 'Admin Movie', type: 'movie' }],
                                },
                                {
                                    title: 'Top Movies Of The Week',
                                    hubIdentifier: 'movie.top',
                                    Metadata: [{ ratingKey: '12', title: 'Heat', type: 'movie' }],
                                },
                            ],
                        },
                    }),
                };
            }
            if (href.includes('/library/onDeck')) {
                return { ok: true, json: async () => ({ MediaContainer: { Metadata: [] } }) };
            }
            if (href.includes('/status/sessions/history/all')) {
                historyUrls.push(href);
                if (!href.includes('accountID=42') || !href.includes('server-token')) {
                    throw new Error(`history used the wrong identity: ${href}`);
                }
                return {
                    ok: true,
                    json: async () => ({
                        MediaContainer: {
                            Metadata: [{
                                ratingKey: 'friend-1',
                                title: 'Tripping',
                                type: 'episode',
                                grandparentTitle: "Clarkson's Farm",
                                grandparentThumb: '/library/metadata/9/thumb',
                                percentComplete: 40,
                            }],
                        },
                    }),
                };
            }
            throw new Error(`unexpected ${url}`);
        },
    });
    const server = await listen(app);
    try {
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}/api/media-player/home`);
        const body = await res.json();
        assert.equal(res.status, 200, body.error);
        const continueHub = (body.hubs || []).find((hub) => /continue/i.test(`${hub.title} ${hub.identifier}`));
        assert.ok(continueHub, 'expected a Continue Watching hub');
        assert.equal(continueHub.items[0].title, "Clarkson's Farm");
        assert.equal(continueHub.items.some((row) => row.title === 'Admin Movie'), false);
        assert.equal(body.continueWatching[0].title, "Clarkson's Farm");
        assert.equal(historyUrls.length > 0, true);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('GET /collection resolves overview tag ids via section filter when metadata 404s', async () => {
    const seen = [];
    const app = createApp({
        fetchImpl: async (url) => {
            const href = String(url);
            seen.push(href);
            if (href.includes('/library/metadata/2120140')) {
                return { ok: false, status: 404, json: async () => ({}) };
            }
            if (href.includes('/library/collections/2120140')) {
                return { ok: false, status: 404, json: async () => ({}) };
            }
            if (href.includes('/library/sections/1/collections')) {
                return { ok: true, json: async () => ({ MediaContainer: { Metadata: [] } }) };
            }
            if (href.includes('/library/sections/1/all') && href.includes('collection=2120140')) {
                return {
                    ok: true,
                    json: async () => ({
                        MediaContainer: {
                            totalSize: 1,
                            Metadata: [{ ratingKey: '12', title: 'Shrek 2', type: 'movie' }],
                        },
                    }),
                };
            }
            if (href.includes('/library/sections?')) {
                return {
                    ok: true,
                    json: async () => ({
                        MediaContainer: {
                            Directory: [{ key: '1', title: 'Movies', type: 'movie' }],
                        },
                    }),
                };
            }
            throw new Error(`unexpected ${url}`);
        },
    });
    const server = await listen(app);
    try {
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}/api/media-player/collection/2120140?section=1`);
        const body = await res.json();
        assert.equal(res.status, 200, body.error);
        assert.equal(body.children[0].title, 'Shrek 2');
        assert.equal(seen.some((href) => href.includes('/library/sections/1/all') && href.includes('collection=2120140')), true);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('GET /file skips a second metadata fetch after Android Direct Play /play', async () => {
    let metaCalls = 0;
    let partCalls = 0;
    const app = createApp({
        fetchImpl: async (url) => {
            const href = String(url);
            if (href.includes('/library/metadata/637418')) {
                metaCalls += 1;
                return { ok: true, json: async () => oakStreetMeta };
            }
            if (href.includes('/library/parts/101/file')) {
                partCalls += 1;
                return {
                    ok: true,
                    status: 200,
                    headers: { get: (name) => (name === 'content-type' ? 'video/x-matroska' : null) },
                    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
                };
            }
            throw new Error(`unexpected ${url}`);
        },
    });
    const server = await listen(app);
    try {
        const port = server.address().port;
        const playRes = await fetch(`http://127.0.0.1:${port}/api/media-player/play/637418?client=android&hevc=1&ac3=1&textSubs=1`);
        const playBody = await playRes.json();
        assert.equal(playRes.status, 200, playBody.error);
        assert.match(String(playBody.src), /\/api\/media-player\/file\/637418/);
        const src = new URL(String(playBody.src), `http://127.0.0.1:${port}`);
        const fileRes = await fetch(src);
        assert.equal(fileRes.status, 200);
        assert.equal(metaCalls, 1);
        assert.equal(partCalls, 1);
        assert.equal(Buffer.from(await fileRes.arrayBuffer()).length, 4);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('GET /play on Android Direct Plays even when the title has forced PGS', async () => {
    const meta = {
        MediaContainer: {
            Metadata: [{
                ratingKey: '637418',
                title: 'The End of Oak Street',
                type: 'movie',
                duration: 6000000,
                Media: [{
                    videoResolution: '4k',
                    height: 2160,
                    videoCodec: 'hevc',
                    audioCodec: 'eac3',
                    container: 'mkv',
                    Part: [{
                        id: 101,
                        container: 'mkv',
                        Stream: [
                            { id: 10, streamType: 1, codec: 'hevc', height: 2160 },
                            { id: 20, streamType: 2, codec: 'eac3', selected: true, channels: 6 },
                            { id: 50, streamType: 3, codec: 'pgs', forced: true, language: 'English' },
                        ],
                    }],
                }],
            }],
        },
    };
    const app = createApp({
        fetchImpl: async (url) => {
            if (String(url).includes('/library/metadata/637418')) {
                return { ok: true, json: async () => meta };
            }
            throw new Error(`unexpected ${url}`);
        },
    });
    const server = await listen(app);
    try {
        const port = server.address().port;
        const playRes = await fetch(`http://127.0.0.1:${port}/api/media-player/play/637418?client=android&hevc=1&ac3=1&textSubs=1`);
        const playBody = await playRes.json();
        assert.equal(playRes.status, 200, playBody.error);
        assert.match(String(playBody.src), /\/api\/media-player\/file\/637418/);
        assert.equal(playBody.playbackMode, 'directPlay');
        assert.equal(playBody.subtitleStreamId == null || playBody.subtitleStreamId === '', true);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('GET /person returns on-server titles and a TMDB biography profile', async () => {
    const app = createApp({
        config: { tmdbApiKey: 'test-key' },
        fetchImpl: async (url) => {
            const href = String(url);
            if (href.includes('/library/sections?')) {
                return {
                    ok: true,
                    json: async () => ({
                        MediaContainer: {
                            Directory: [{ key: '1', type: 'movie', title: 'Movies' }],
                        },
                    }),
                };
            }
            if (href.includes('/library/sections/1/all') && href.includes('actor=')) {
                return {
                    ok: true,
                    json: async () => ({
                        MediaContainer: {
                            Metadata: [{
                                ratingKey: '88',
                                title: 'Band of Brothers',
                                type: 'show',
                                thumb: '/library/metadata/88/thumb',
                                Role: [{ id: '55', tag: 'Damian Lewis', thumb: '/library/metadata/55/thumb' }],
                            }],
                        },
                    }),
                };
            }
            if (href.includes('api.themoviedb.org') && href.includes('/search/person')) {
                return {
                    ok: true,
                    json: async () => ({
                        results: [{
                            id: 11962,
                            name: 'Damian Lewis',
                            popularity: 20,
                            profile_path: '/p.jpg',
                            known_for: [{ title: 'Band of Brothers', media_type: 'tv' }],
                        }],
                    }),
                };
            }
            if (href.includes('api.themoviedb.org') && href.includes('/person/11962')) {
                return {
                    ok: true,
                    json: async () => ({
                        id: 11962,
                        name: 'Damian Lewis',
                        biography: 'English actor known for Band of Brothers.',
                        birthday: '1971-02-11',
                        deathday: null,
                        known_for_department: 'Acting',
                        place_of_birth: 'London, England',
                        profile_path: '/p.jpg',
                    }),
                };
            }
            if (href.includes('/photo/:/transcode')) {
                return { ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer, headers: { get: () => 'image/jpeg' } };
            }
            throw new Error(`unexpected ${url}`);
        },
    });
    const server = await listen(app);
    try {
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}/api/media-player/person/55?name=Damian%20Lewis`);
        const body = await res.json();
        assert.equal(res.status, 200, body.error);
        assert.equal(body.person.name, 'Damian Lewis');
        assert.equal(body.items.length, 1);
        assert.equal(body.items[0].title, 'Band of Brothers');
        assert.equal(body.profile.birthday, '1971-02-11');
        assert.equal(body.profile.placeOfBirth, 'London, England');
        assert.match(String(body.profile.biography), /English actor/);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('GET /item lists album tracks and shuffle queue returns those tracks', async () => {
    const albumMeta = {
        MediaContainer: {
            Metadata: [{
                ratingKey: '81',
                title: 'OK Computer',
                type: 'album',
                parentTitle: 'Radiohead',
                parentRatingKey: '80',
            }],
        },
    };
    const tracksMeta = {
        MediaContainer: {
            Metadata: [
                { ratingKey: '82', title: 'Airbag', type: 'track', index: 1, duration: 284000, parentRatingKey: '81' },
                { ratingKey: '83', title: 'Paranoid Android', type: 'track', index: 2, duration: 383000, parentRatingKey: '81' },
            ],
        },
    };
    const app = createApp({
        fetchImpl: async (url) => {
            const href = String(url);
            if (href.includes('/library/metadata/81/children')) {
                return { ok: true, json: async () => tracksMeta };
            }
            if (href.includes('/library/metadata/81')) {
                return { ok: true, json: async () => albumMeta };
            }
            if (href.includes('/library/metadata/81/extras') || href.includes('/hubs/metadata/81/related')) {
                return { ok: true, json: async () => ({ MediaContainer: {} }) };
            }
            return { ok: true, json: async () => ({ MediaContainer: {} }) };
        },
    });
    const server = await listen(app);
    try {
        const port = server.address().port;
        const itemRes = await fetch(`http://127.0.0.1:${port}/api/media-player/item/81`);
        const itemBody = await itemRes.json();
        assert.equal(itemRes.status, 200, itemBody.error);
        assert.equal(itemBody.item.type, 'album');
        assert.equal(itemBody.children.length, 2);
        assert.equal(itemBody.children[0].type, 'track');
        assert.equal(itemBody.children[1].title, 'Paranoid Android');
        const queueRes = await fetch(`http://127.0.0.1:${port}/api/media-player/queue/from/81`);
        const queueBody = await queueRes.json();
        assert.equal(queueRes.status, 200, queueBody.error);
        assert.equal(queueBody.items.length, 2);
        assert.equal(queueBody.items[0].type, 'track');
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

