import assert from 'node:assert/strict';
import test from 'node:test';
import {
    isBearerOnlyRequest,
    isMediaPlayerStreamPath,
    readBearerToken,
    readSessionToken,
} from './session-token.js';

const req = (overrides = {}) => ({
    method: 'GET',
    cookies: {},
    headers: {},
    query: {},
    path: '/',
    originalUrl: '/',
    get(name) {
        if (String(name).toLowerCase() === 'authorization') return this.headers.authorization;
        return '';
    },
    ...overrides,
});

test('session token prefers the cookie, then Bearer, then stream/image query', () => {
    assert.equal(readSessionToken(req()), '');
    assert.equal(readBearerToken(req({ headers: { authorization: 'Bearer abc.def' } })), 'abc.def');
    assert.equal(readSessionToken(req({
        cookies: { session: 'cookie-jwt' },
        headers: { authorization: 'Bearer header-jwt' },
    })), 'cookie-jwt');
    assert.equal(readSessionToken(req({
        headers: { authorization: 'Bearer header-jwt' },
    })), 'header-jwt');
    assert.equal(isBearerOnlyRequest(req({ headers: { authorization: 'Bearer header-jwt' } })), true);
    assert.equal(isBearerOnlyRequest(req({
        cookies: { session: 'cookie-jwt' },
        headers: { authorization: 'Bearer header-jwt' },
    })), false);
    assert.equal(isMediaPlayerStreamPath(req({ originalUrl: '/api/media-player/file/12?hevc=1' })), true);
    assert.equal(isMediaPlayerStreamPath(req({ originalUrl: '/api/media-player/play/12' })), false);
    assert.equal(readSessionToken(req({
        originalUrl: '/api/media-player/hls/12/master.m3u8',
        query: { access_token: 'query-jwt' },
    })), 'query-jwt');
    assert.equal(readSessionToken(req({
        originalUrl: '/api/plex/image?path=%2Flibrary%2Fmetadata%2F1%2Fthumb',
        query: { access_token: 'image-jwt' },
    })), 'image-jwt');
    assert.equal(readSessionToken(req({
        method: 'POST',
        originalUrl: '/api/media-player/play/12',
        query: { access_token: 'query-jwt' },
    })), '');
});
