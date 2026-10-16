import assert from 'node:assert/strict';
import test from 'node:test';
import { qbitLogin, sessionCookieHeader } from './qbittorrentAuth.js';

const headerBag = (setCookies = []) => ({
    getSetCookie: () => setCookies,
    get: (name) => (String(name).toLowerCase() === 'set-cookie' ? setCookies[0] || null : null),
});

const mockFetch = (response) => async (url, options) => {
    mockFetch.last = { url, options };
    return response;
};

test('sessionCookieHeader keeps QBT_SID name=value and drops cookie attributes', () => {
    const cookie = sessionCookieHeader([
        'other=1; Path=/',
        'QBT_SID_8080=abc123; Path=/; HttpOnly',
    ]);
    assert.equal(cookie, 'QBT_SID_8080=abc123');
});

test('qbitLogin accepts qBittorrent 5.2 empty 204 and QBT_SID cookie', async () => {
    const fetchImpl = mockFetch({
        ok: true,
        status: 204,
        text: async () => '',
        headers: headerBag(['QBT_SID_8080=token-value; Path=/; HttpOnly']),
    });
    const session = await qbitLogin({
        fetchImpl,
        baseUrl: 'http://qbt-gluetun:8080/',
        username: 'plex-qbittorrent',
        password: 'secret',
    });
    assert.equal(session.cookie, 'QBT_SID_8080=token-value');
    assert.equal(session.headers.Cookie, 'QBT_SID_8080=token-value');
    assert.equal(session.headers.Origin, 'http://qbt-gluetun:8080');
    assert.equal(session.headers.Referer, 'http://qbt-gluetun:8080/');
    assert.equal(mockFetch.last.url, 'http://qbt-gluetun:8080/api/v2/auth/login');
    assert.equal(mockFetch.last.options.headers.Origin, 'http://qbt-gluetun:8080');
    assert.equal(mockFetch.last.options.headers.Referer, 'http://qbt-gluetun:8080/');
    assert.match(mockFetch.last.options.body, /username=plex-qbittorrent/);
    assert.match(mockFetch.last.options.body, /password=secret/);
});

test('qbitLogin accepts legacy SID cookie and Ok. body', async () => {
    const fetchImpl = mockFetch({
        ok: true,
        status: 200,
        text: async () => 'Ok.',
        headers: headerBag(['SID=legacy-sid; path=/']),
    });
    const session = await qbitLogin({
        fetchImpl,
        baseUrl: 'http://127.0.0.1:8080',
        username: 'admin',
        password: 'adminadmin',
    });
    assert.equal(session.cookie, 'SID=legacy-sid');
});

test('qbitLogin reports credential failure for Fails. and HTTP 401', async () => {
    await assert.rejects(
        () => qbitLogin({
            fetchImpl: mockFetch({
                ok: true,
                status: 200,
                text: async () => 'Fails.',
                headers: headerBag([]),
            }),
            baseUrl: 'http://qbt.example:8080',
            username: 'plex-qbittorrent',
            password: 'wrong',
        }),
        /login HTTP 401/,
    );
    await assert.rejects(
        () => qbitLogin({
            fetchImpl: mockFetch({
                ok: false,
                status: 401,
                text: async () => '',
                headers: headerBag([]),
            }),
            baseUrl: 'http://qbt.example:8080',
            username: 'plex-qbittorrent',
            password: 'secret',
        }),
        /login HTTP 401/,
    );
});

test('qbitLogin reads node-fetch raw set-cookie headers', async () => {
    const fetchImpl = mockFetch({
        ok: true,
        status: 204,
        text: async () => '',
        headers: {
            raw: () => ({ 'set-cookie': ['QBT_SID_8080=from-raw; Path=/; HttpOnly'] }),
            get: () => 'QBT_SID_8080=from-raw; Path=/; HttpOnly',
        },
    });
    const session = await qbitLogin({
        fetchImpl,
        baseUrl: 'http://qbt-gluetun:8080',
        username: 'user',
        password: 'pass',
    });
    assert.equal(session.cookie, 'QBT_SID_8080=from-raw');
});
