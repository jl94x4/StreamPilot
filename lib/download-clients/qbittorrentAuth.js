/**
 * qBittorrent WebAPI session login.
 *
 * 5.2+ returns HTTP 204 with an empty body and a QBT_SID_<port> cookie.
 * Older releases return HTTP 200, body "Ok.", and a SID cookie. A matching
 * Origin/Referer is required when WebUI CSRF protection is on.
 * https://github.com/jl94x4/StreamPilot/issues/199
 */

export const qbitOriginHeaders = (baseUrl) => {
    const base = String(baseUrl || '').replace(/\/+$/, '');
    if (!base) return {};
    let origin = base;
    try {
        origin = new URL(base).origin;
    } catch {
        origin = base;
    }
    return {
        Origin: origin,
        Referer: `${base}/`,
    };
};

export const qbitApiHeaders = (baseUrl, cookie = '') => ({
    ...qbitOriginHeaders(baseUrl),
    ...(cookie ? { Cookie: cookie } : {}),
});

export const listSetCookies = (headers) => {
    if (!headers) return [];
    if (typeof headers.getSetCookie === 'function') {
        const listed = headers.getSetCookie();
        if (Array.isArray(listed) && listed.length) return listed.map((value) => String(value));
    }
    if (typeof headers.raw === 'function') {
        const raw = headers.raw()?.['set-cookie'];
        if (Array.isArray(raw) && raw.length) return raw.map((value) => String(value));
    }
    const single = typeof headers.get === 'function' ? headers.get('set-cookie') : '';
    return single ? [String(single)] : [];
};

const cookiePair = (setCookie) => {
    const first = String(setCookie || '').split(';')[0].trim();
    const eq = first.indexOf('=');
    if (eq <= 0) return '';
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (!name || !value) return '';
    return `${name}=${value}`;
};

const isSessionCookie = (pair) => /^(QBT_)?SID(_|$)/i.test(String(pair || '').split('=')[0]);

/** Cookie request header: name=value only, preferring SID / QBT_SID_<port>. */
export const sessionCookieHeader = (setCookies = []) => {
    const pairs = (Array.isArray(setCookies) ? setCookies : []).map(cookiePair).filter(Boolean);
    return pairs.find(isSessionCookie) || pairs[0] || '';
};

export const qbitLogin = async ({
    fetchImpl,
    baseUrl,
    username = '',
    password = '',
    timeoutMs = 12000,
} = {}) => {
    const base = String(baseUrl || '').replace(/\/+$/, '');
    const loginRes = await fetchImpl(`${base}/api/v2/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            ...qbitOriginHeaders(base),
        },
        body: new URLSearchParams({
            username: String(username || ''),
            password: String(password || ''),
        }).toString(),
    }, timeoutMs);
    const body = await loginRes.text().catch(() => '');
    if (!loginRes.ok || String(body || '').trim() === 'Fails.') {
        const status = loginRes.ok ? 401 : (loginRes.status || 401);
        throw new Error(`login HTTP ${status}`);
    }
    const cookie = sessionCookieHeader(listSetCookies(loginRes.headers));
    return {
        cookie,
        headers: qbitApiHeaders(base, cookie),
    };
};
