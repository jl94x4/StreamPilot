declare global {
    interface Window {
        __BASE_PATH__?: string;
        __PLEX_CLIENT__?: {
            portalBaseUrl?: string;
            sessionToken?: string;
            isTv?: boolean;
            nativePlayer?: boolean;
        };
    }
}

export const LOGO_PATH = '/static/logo.png';

/** Official brand marks for auth buttons (not the portal StreamPilot logo). */
export const PLEX_ICON_URL = 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/plex.svg';
export const JELLYFIN_ICON_URL = 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/jellyfin.svg';
export const EMBY_ICON_URL = 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/emby.svg';

const readBasePathFromBaseTag = (): string => {
    const baseEl = document.querySelector('base[href]');
    if (!baseEl) return '';
    const href = baseEl.getAttribute('href') || '/';
    try {
        const path = new URL(href, window.location.origin).pathname.replace(/\/+$/, '');
        return path === '/' ? '' : path;
    } catch {
        return '';
    }
};

export const getBasePath = (): string => {
    if (typeof window === 'undefined') return '';
    if (typeof window.__BASE_PATH__ === 'string' && window.__BASE_PATH__ !== '') {
        const base = window.__BASE_PATH__;
        return base === '/' ? '' : base.replace(/\/+$/, '');
    }
    // Inline bootstrap script may be blocked by CSP; <base href> is always injected in HTML.
    return readBasePathFromBaseTag();
};

const plexClientPortalOrigin = (): string => {
    if (typeof window === 'undefined') return '';
    const raw = String(window.__PLEX_CLIENT__?.portalBaseUrl || '').trim().replace(/\/+$/, '');
    return raw;
};

/**
 * Capacitor <img> / ExoPlayer cannot send Authorization — append access_token for portal API URLs.
 */
const withPlexClientAccessToken = (url: string): string => {
    if (typeof window === 'undefined' || !url) return url;
    let token = String(window.__PLEX_CLIENT__?.sessionToken || '').trim();
    if (!token) {
        try {
            token = String(localStorage.getItem('plexClient.sessionToken') || '').trim();
        } catch {
            token = '';
        }
    }
    const origin = plexClientPortalOrigin();
    if (!token || !origin) return url;
    try {
        const parsed = new URL(url, `${origin}/`);
        if (!parsed.pathname.includes('/api/')) return url;
        const portalOrigin = new URL(origin).origin;
        if (parsed.origin !== portalOrigin) return url;
        if (!parsed.searchParams.get('access_token')) {
            parsed.searchParams.set('access_token', token);
        }
        return parsed.toString();
    } catch {
        return url;
    }
};

const directPlexImageUrl = (path: string): string => {
    if (typeof window === 'undefined' || !window.__PLEX_CLIENT__) return '';
    try {
        const mode = String(localStorage.getItem('plexClient.authMode') || '').trim();
        if (mode === 'portal') return '';
        if (mode !== 'plex' && localStorage.getItem('plexClient.portalBaseUrl')) return '';
    } catch {
        return '';
    }
    const queryAt = path.indexOf('?');
    const pathname = queryAt >= 0 ? path.slice(0, queryAt) : path;
    if (pathname !== '/api/plex/image') return '';
    const params = new URLSearchParams(queryAt >= 0 ? path.slice(queryAt + 1) : '');
    const imagePath = String(params.get('path') || '').trim();
    if (!imagePath) return '';
    let server: { uri?: string; accessToken?: string } | null = null;
    try {
        server = JSON.parse(localStorage.getItem('plexClient.plexServer') || '');
    } catch {
        server = null;
    }
    const uri = String(server?.uri || '').replace(/\/+$/, '');
    const token = String(server?.accessToken || '').trim();
    if (!uri || !token) return '';
    const url = new URL('/photo/:/transcode', `${uri}/`);
    url.searchParams.set('width', params.get('width') || '300');
    url.searchParams.set('height', params.get('height') || '450');
    url.searchParams.set('minSize', '1');
    url.searchParams.set('upscale', '0');
    url.searchParams.set('quality', params.get('quality') || '60');
    url.searchParams.set('url', imagePath.startsWith('/') ? imagePath : `/${imagePath}`);
    url.searchParams.set('X-Plex-Token', token);
    return url.toString();
};

/** High-resolution Plex photo transcode for a library path or a public artwork URL. */
export const directPlexTranscodeUrl = (
    imageUrl: string,
    width: number,
    height: number,
    quality = -1,
    options?: { upscale?: boolean; format?: string },
): string => {
    const source = String(imageUrl || '').trim();
    if (!source || typeof window === 'undefined' || !window.__PLEX_CLIENT__) return '';
    const applySize = (params: URLSearchParams) => {
        params.set('width', String(width));
        params.set('height', String(height));
        params.set('minSize', '1');
        params.set('upscale', options?.upscale ? '1' : '0');
        params.set('quality', String(quality));
        if (options?.format) params.set('format', options.format);
    };
    if (/\/photo\/:\/transcode/i.test(source)) {
        try {
            const parsed = new URL(source);
            applySize(parsed.searchParams);
            return parsed.toString();
        } catch {
            return '';
        }
    }
    try {
        const mode = String(localStorage.getItem('plexClient.authMode') || '').trim();
        if (mode === 'portal') return '';
        if (mode !== 'plex' && localStorage.getItem('plexClient.portalBaseUrl')) return '';
    } catch {
        return '';
    }
    let server: { uri?: string; accessToken?: string } | null = null;
    try {
        server = JSON.parse(localStorage.getItem('plexClient.plexServer') || '');
    } catch {
        server = null;
    }
    const uri = String(server?.uri || '').replace(/\/+$/, '');
    const token = String(server?.accessToken || '').trim();
    if (!uri || !token) return '';
    const url = new URL('/photo/:/transcode', `${uri}/`);
    applySize(url.searchParams);
    url.searchParams.set('url', /^https?:\/\//i.test(source) || source.startsWith('/') ? source : `/${source}`);
    url.searchParams.set('X-Plex-Token', token);
    return url.toString();
};

/** Prefix an app-root path with the configured base path (or absolute portal URL in plex-client). */
export const portalUrl = (path: string): string => {
    if (!path) return path;
    if (path.startsWith('http://') || path.startsWith('https://')) {
        return withPlexClientAccessToken(path);
    }
    const normalized = path.startsWith('/') ? path : `/${path}`;
    const directImage = directPlexImageUrl(normalized);
    if (directImage) return directImage;
    const absoluteOrigin = plexClientPortalOrigin();
    let built = '';
    if (absoluteOrigin) {
        const base = getBasePath();
        if (base && (normalized === base || normalized.startsWith(`${base}/`))) {
            built = `${absoluteOrigin}${normalized}`;
        } else {
            built = `${absoluteOrigin}${base ? `${base}${normalized}` : normalized}`;
        }
    } else {
        const base = getBasePath();
        if (base && (normalized === base || normalized.startsWith(`${base}/`))) built = normalized;
        else built = base ? `${base}${normalized}` : normalized;
    }
    return withPlexClientAccessToken(built);
};

/** Prefix root-relative asset or API paths; leave absolute http(s) URLs unchanged (except plex-client auth). */
export const resolvePortalAssetUrl = (url: string | null | undefined): string => {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) return withPlexClientAccessToken(url);
    return portalUrl(url.startsWith('/') ? url : `/${url}`);
};

/** Strip the configured base path from a pathname for client-side routing. */
export const stripBasePath = (pathname: string): string => {
    const base = getBasePath();
    if (!base) return pathname || '/';
    if (pathname === base || pathname === `${base}/`) return '/';
    if (pathname.startsWith(`${base}/`)) return pathname.slice(base.length) || '/';
    return pathname || '/';
};

/** Public origin including base path — use for shareable links and referrals. */
export const getPublicOrigin = (): string => {
    const absolute = plexClientPortalOrigin();
    if (absolute) return `${absolute}${getBasePath()}`;
    return `${window.location.origin}${getBasePath()}`;
};

export const logoUrl = (): string => portalUrl(LOGO_PATH);
