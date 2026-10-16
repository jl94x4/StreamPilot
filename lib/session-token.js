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

export const isBearerOnlyRequest = (req) => (
    !String(req?.cookies?.session || '').trim() && !!readBearerToken(req)
);
