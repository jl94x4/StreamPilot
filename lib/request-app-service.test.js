import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestAppService, mapSeerrClientError } from './request-app-service.js';

const seerrConfig = {
    requestAppType: 'jellyseerr',
    requestAppUrl: 'http://seerr.local',
    requestAppApiKey: 'ADMIN-KEY',
};

const jsonResponse = (status, data, { setCookie = [] } = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: {
        getSetCookie: () => setCookie,
        get: (name) => (
            String(name).toLowerCase() === 'set-cookie' ? setCookie[0] || null : null
        ),
    },
    json: async () => data,
});

const createService = ({ fetchWithTimeout, resolveMemberPlexToken }) => createRequestAppService({
    fetchWithTimeout,
    resolveIntegrationUrlForFetch: (url) => url,
    resolveMemberPlexToken,
});

test('mapSeerrClientError keeps the Plex session message', () => {
    const mapped = mapSeerrClientError(
        'Sign in with Plex to submit requests. Seerr needs your Plex session so the request stays pending for approval.',
        403,
    );
    assert.equal(mapped.status, 403);
    assert.match(mapped.error, /Sign in with Plex/);
});

test('submitMemberRequest posts with the member cookie and never the admin API key', async () => {
    const calls = [];
    const service = createService({
        resolveMemberPlexToken: async () => 'member-plex-token',
        fetchWithTimeout: async (url, options = {}) => {
            calls.push({ url: String(url), options });
            if (String(url).endsWith('/api/v1/auth/plex')) {
                return jsonResponse(200, { id: 5, displayName: 'Member' }, {
                    setCookie: ['connect.sid=s%3Amember; Path=/; HttpOnly'],
                });
            }
            if (String(url).endsWith('/api/v1/request')) {
                return jsonResponse(201, {
                    id: 44,
                    status: 1,
                    media: { tmdbId: 99, title: 'Dune', posterPath: '/dune.jpg' },
                });
            }
            throw new Error(`unexpected ${url}`);
        },
    });

    const result = await service.submitMemberRequest(seerrConfig, { id: 'u1' }, {
        mediaType: 'movie',
        mediaId: 99,
    });
    assert.equal(result.id, 44);
    assert.equal(result.status, 1);

    const login = calls.find((call) => call.url.endsWith('/api/v1/auth/plex'));
    assert.equal(login.options.redirect, 'manual');
    assert.match(String(login.options.body), /member-plex-token/);

    const request = calls.find((call) => call.url.endsWith('/api/v1/request'));
    assert.equal(request.options.headers['X-Api-Key'], undefined);
    assert.equal(request.options.headers.Cookie, 'connect.sid=s%3Amember');
    assert.equal(
        calls.some((call) => call.url.endsWith('/api/v1/request') && call.options?.headers?.['X-Api-Key']),
        false,
    );
});

test('submitMemberRequest does not fall back to the admin API key without a Plex token', async () => {
    const calls = [];
    const service = createService({
        resolveMemberPlexToken: async () => null,
        fetchWithTimeout: async (url, options = {}) => {
            calls.push({ url: String(url), options });
            throw new Error(`unexpected ${url}`);
        },
    });

    await assert.rejects(
        () => service.submitMemberRequest(seerrConfig, { id: 'u1' }, { mediaType: 'movie', mediaId: 1 }),
        /Sign in with Plex/,
    );
    assert.equal(calls.length, 0);
});

test('submitMemberRequest does not fall back to the admin API key when Seerr login has no cookie', async () => {
    const calls = [];
    const service = createService({
        resolveMemberPlexToken: async () => 'member-plex-token',
        fetchWithTimeout: async (url, options = {}) => {
            calls.push({ url: String(url), options });
            if (String(url).endsWith('/api/v1/auth/plex')) {
                return jsonResponse(200, { id: 5 });
            }
            throw new Error(`unexpected ${url}`);
        },
    });

    await assert.rejects(
        () => service.submitMemberRequest(seerrConfig, { id: 'u1' }, { mediaType: 'movie', mediaId: 1 }),
        /Could not open a Seerr session/,
    );
    assert.equal(calls.some((call) => call.url.endsWith('/api/v1/request')), false);
});

test('submitMemberRequest uses Set-Cookie from a 302 Seerr login', async () => {
    const calls = [];
    const service = createService({
        resolveMemberPlexToken: async () => 'member-plex-token',
        fetchWithTimeout: async (url, options = {}) => {
            calls.push({ url: String(url), options });
            if (String(url).endsWith('/api/v1/auth/plex')) {
                return jsonResponse(302, null, {
                    setCookie: ['connect.sid=s%3Aredirect; Path=/'],
                });
            }
            if (String(url).endsWith('/api/v1/request')) {
                return jsonResponse(201, { id: 3, status: 1, media: { tmdbId: 1, posterPath: '/a.jpg', title: 'A' } });
            }
            return jsonResponse(200, {});
        },
    });

    const result = await service.submitMemberRequest(seerrConfig, { id: 'u1' }, {
        mediaType: 'movie',
        mediaId: 1,
    });
    assert.equal(result.id, 3);
    const request = calls.find((call) => call.url.endsWith('/api/v1/request'));
    assert.equal(request.options.headers.Cookie, 'connect.sid=s%3Aredirect');
    assert.equal(request.options.headers['X-Api-Key'], undefined);
});

test('submitMemberRequest enriches a missing poster from Seerr media details', async () => {
    const service = createService({
        resolveMemberPlexToken: async () => 'member-plex-token',
        fetchWithTimeout: async (url) => {
            if (String(url).endsWith('/api/v1/auth/plex')) {
                return jsonResponse(200, { id: 5 }, {
                    setCookie: ['connect.sid=s%3Amember; Path=/'],
                });
            }
            if (String(url).endsWith('/api/v1/request')) {
                return jsonResponse(201, {
                    id: 8,
                    status: 1,
                    media: { tmdbId: 77 },
                });
            }
            if (String(url).endsWith('/api/v1/movie/77')) {
                return jsonResponse(200, { posterPath: '/from-details.jpg', title: 'Poster Title' });
            }
            throw new Error(`unexpected ${url}`);
        },
    });

    const result = await service.submitMemberRequest(seerrConfig, { id: 'u1' }, {
        mediaType: 'movie',
        mediaId: 77,
    });
    assert.equal(result.media.posterPath, '/from-details.jpg');
});

const memberRequestOptionsFetch = async (url) => {
    const path = String(url);
    if (path.includes('/api/v1/movie/')) {
        return jsonResponse(200, { title: 'Dune', overview: '', mediaInfo: { status: 1 }, posterPath: '/dune.jpg' });
    }
    if (path.includes('/api/v1/user?')) {
        return jsonResponse(200, {
            results: [{ id: 5, email: 'rink@example.com', username: 'rink', plexId: '123' }],
        });
    }
    if (path.includes('/api/v1/service/radarr')) {
        return jsonResponse(200, [{ id: 1, name: 'Radarr', isDefault: true, is4k: false }]);
    }
    if (path.includes('/api/v1/user/5/quota')) {
        return jsonResponse(200, {});
    }
    if (path.includes('/api/v1/user/5')) {
        return jsonResponse(200, { id: 5, permissions: 2, displayName: 'rink' });
    }
    throw new Error(`unexpected ${url}`);
};

test('getMemberRequestOptions hides advanced routing when StreamPilot disables it', async () => {
    const service = createService({
        resolveMemberPlexToken: async () => 'member-plex-token',
        fetchWithTimeout: memberRequestOptionsFetch,
    });
    const sessionUser = { id: '123', plexId: '123', email: 'rink@example.com', username: 'rink' };

    const enabled = await service.getMemberRequestOptions({
        ...seerrConfig,
        requestAppUrl: 'http://seerr-advanced-on.local',
        portalAllowAdvancedRequests: true,
    }, sessionUser, { mediaType: 'movie', mediaId: 99 });
    assert.equal(enabled.canRequestAdvanced, true);
    assert.equal(enabled.canRequestTags, true);

    const disabled = await service.getMemberRequestOptions({
        ...seerrConfig,
        requestAppUrl: 'http://seerr-advanced-off.local',
        portalAllowAdvancedRequests: false,
    }, sessionUser, { mediaType: 'movie', mediaId: 99 });
    assert.equal(disabled.canRequestAdvanced, false);
    assert.equal(disabled.canRequestTags, false);
    assert.equal(disabled.permissions.requestAdvanced, false);
});

test('getMemberDiscoveryProfile respects StreamPilot advanced request toggle', async () => {
    const service = createService({
        resolveMemberPlexToken: async () => 'member-plex-token',
        fetchWithTimeout: memberRequestOptionsFetch,
    });
    const sessionUser = { id: '123', plexId: '123', email: 'rink@example.com', username: 'rink' };

    const enabled = await service.getMemberDiscoveryProfile({
        ...seerrConfig,
        requestAppUrl: 'http://seerr-profile-on.local',
        portalAllowAdvancedRequests: true,
    }, sessionUser);
    assert.equal(enabled.permissions.requestAdvanced, true);

    const disabled = await service.getMemberDiscoveryProfile({
        ...seerrConfig,
        requestAppUrl: 'http://seerr-profile-off.local',
        portalAllowAdvancedRequests: false,
    }, sessionUser);
    assert.equal(disabled.permissions.requestAdvanced, false);
    assert.equal(disabled.permissions.requestTags, false);
});

test('listRequests skips TMDB enrichment when enrich is false', async () => {
    const calls = [];
    const service = createService({
        resolveMemberPlexToken: async () => null,
        fetchWithTimeout: async (url) => {
            calls.push(String(url));
            if (String(url).includes('/api/v1/request?')) {
                return jsonResponse(200, {
                    results: [{
                        id: 1,
                        status: 2,
                        media: { tmdbId: 99, status: 5 },
                        requestedBy: { displayName: 'A' },
                    }],
                    pageInfo: { pages: 1, results: 1, page: 1 },
                });
            }
            throw new Error(`unexpected ${url}`);
        },
    });
    const payload = await service.listRequests(seerrConfig, { filter: 'available', take: 20, enrich: false });
    assert.equal(payload.results[0].id, 1);
    assert.equal(calls.some((url) => /\/api\/v1\/(movie|tv)\//.test(url)), false);
});

test('getRequestCounts skips the failed list crawl when includeFailed is false', async () => {
    const calls = [];
    const service = createService({
        resolveMemberPlexToken: async () => null,
        fetchWithTimeout: async (url) => {
            calls.push(String(url));
            if (String(url).endsWith('/api/v1/request/count')) {
                return jsonResponse(200, { pending: 1, approved: 2 });
            }
            throw new Error(`unexpected ${url}`);
        },
    });
    const counts = await service.getRequestCounts(seerrConfig, { includeFailed: false });
    assert.equal(counts.pending, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls.some((url) => String(url).includes('filter=failed')), false);
});

const memberSession = { id: '123', plexId: '123', email: 'vik@example.com', username: 'vik' };

const memberSeerrUserPage = jsonResponse(200, {
    results: [{ id: 5, displayName: 'vik', email: 'vik@example.com', plexId: '123' }],
});

const movieRequest = (id, status, mediaStatus, tmdbId = id) => ({
    id,
    status,
    requestedBy: { id: 5, displayName: 'vik' },
    media: {
        tmdbId,
        mediaType: 'movie',
        title: `Title ${id}`,
        status: mediaStatus,
        posterPath: '/p.jpg',
        backdropPath: '/b.jpg',
        genres: ['Comedy'],
        originalLanguage: 'en',
    },
});

test('listMemberRequests returns tab counts and keeps paging past a bogus pageInfo total', async () => {
    const calls = [];
    const pageOne = Array.from({ length: 50 }, (_, i) => movieRequest(i + 1, 2, 5, 1000 + i));
    const pageTwo = [
        movieRequest(51, 1, 2, 2051),
        movieRequest(52, 2, 3, 2052),
    ];
    const service = createService({
        resolveMemberPlexToken: async () => null,
        fetchWithTimeout: async (url) => {
            const href = String(url);
            calls.push(href);
            if (href.includes('/api/v1/user?')) return memberSeerrUserPage;
            if (href.includes('/api/v1/request?')) {
                const parsed = new URL(href);
                const skip = Number(parsed.searchParams.get('skip') || 0);
                const requestedBy = parsed.searchParams.get('requestedBy');
                assert.equal(requestedBy, '5');
                if (skip === 0) {
                    return jsonResponse(200, {
                        results: pageOne,
                        pageInfo: { page: 1, pages: 1, results: 50 },
                    });
                }
                if (skip === 50) {
                    return jsonResponse(200, {
                        results: pageTwo,
                        pageInfo: { page: 2, pages: 2, results: 52 },
                    });
                }
                return jsonResponse(200, { results: [], pageInfo: { page: 3, pages: 2, results: 52 } });
            }
            throw new Error(`unexpected ${url}`);
        },
    });

    const config = { ...seerrConfig, requestAppUrl: 'http://seerr-my-requests.local' };
    const payload = await service.listMemberRequests(config, memberSession, {
        filter: 'pending',
        take: 40,
        skip: 0,
    });

    assert.equal(payload.userMapped, true);
    assert.equal(payload.counts.total, 52);
    assert.equal(payload.counts.pending, 1);
    assert.equal(payload.counts.available, 50);
    assert.equal(payload.counts.approved, 1);
    assert.equal(payload.pageInfo.total, 1);
    assert.equal(payload.results.length, 1);
    assert.equal(payload.results[0].id, 51);
    assert.equal(payload.results[0].status, 1);
    assert.equal(calls.filter((url) => url.includes('/api/v1/request?')).length >= 2, true);
});

test('listMemberRequests approved tab includes processing Requested titles', async () => {
    const service = createService({
        resolveMemberPlexToken: async () => null,
        fetchWithTimeout: async (url) => {
            const href = String(url);
            if (href.includes('/api/v1/user?')) return memberSeerrUserPage;
            if (href.includes('/api/v1/request?')) {
                return jsonResponse(200, {
                    results: [
                        movieRequest(1, 2, 3, 11),
                        movieRequest(2, 2, 5, 12),
                    ],
                    pageInfo: { page: 1, pages: 1, results: 2 },
                });
            }
            throw new Error(`unexpected ${url}`);
        },
    });

    const config = { ...seerrConfig, requestAppUrl: 'http://seerr-my-requests-approved.local' };
    const payload = await service.listMemberRequests(config, memberSession, {
        filter: 'approved',
        take: 40,
        skip: 0,
    });
    assert.equal(payload.counts.approved, 1);
    assert.equal(payload.counts.available, 1);
    assert.equal(payload.counts.pending, 0);
    assert.equal(payload.results.length, 1);
    assert.equal(payload.results[0].id, 1);
});

