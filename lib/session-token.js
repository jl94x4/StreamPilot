const BEARER_RE = /^Bearer\s+(\S+)$/i;

export const readBearerToken = (req) => {
    const header = String(req?.get?.('authorization') || req?.headers?.authorization || '');
    const match = BEARER_RE.exec(header);
    return match ? String(match[1] || '').trim() : '';
};

export const isMediaPlayerStreamPath = (req) => {
    const url = String(req?.originalUrl || req?.url || req?.path || '').split('?')[0];
    return /\/api\/media-player\/(file|hls|proxy)(\/|$)/.test(url);
};

/** GET assets that <img>/ExoPlayer can authorize via ?access_token= (no Authorization header). */
export const isMediaPlayerAssetPath = (req) => {
    const url = String(req?.originalUrl || req?.url || req?.path || '').split('?')[0];
    return isMediaPlayerStreamPath(req)
        || /\/api\/media-player\/theme(\/|$)/.test(url)
        || /\/api\/plex\/image(\/|$)/.test(url);
};

export const readSessionToken = (req) => {
    const cookie = String(req?.cookies?.session || '').trim();
    if (cookie) return cookie;
    const bearer = readBearerToken(req);
    if (bearer) return bearer;
    if (String(req?.method || 'GET').toUpperCase() !== 'GET' || !isMediaPlayerAssetPath(req)) return '';
    return String(req?.query?.access_token || '').trim();
};

/** Sessions renew once they are this old, while the person keeps using the portal. */
export const SESSION_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

/** True when a verified cookie session is old enough to be renewed for another full term. */
export const sessionNeedsRefresh = (decoded, now = Date.now(), afterMs = SESSION_REFRESH_AFTER_MS) => {
    const issuedAtMs = Number(decoded?.iat) * 1000;
    if (!Number.isFinite(issuedAtMs) || issuedAtMs <= 0) return false;
    return now - issuedAtMs >= afterMs;
};

/** The claims to sign into the renewed token: everything but the old timing fields. */
export const refreshableSessionClaims = (decoded) => {
    if (!decoded || typeof decoded !== 'object') return null;
    const { iat, exp, nbf, ...claims } = decoded;
    return claims;
};

export const isBearerOnlyRequest = (req) => (
    !String(req?.cookies?.session || '').trim() && !!readBearerToken(req)
);
