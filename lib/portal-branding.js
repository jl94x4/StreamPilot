import fs from 'fs/promises';
import path from 'path';
import {
    parseBrandingPublicPath,
    readBrandingAssetByPublicPath,
} from './branding-storage.js';
import { createHash } from 'crypto';
import {
    makeHomeScreenIconPng,
} from './circular-icon.js';

/** Server-logo PWA launcher padding (~20% smaller than legacy 0.78 / 0.88). */
export const SERVER_PWA_ICON_BADGE_SCALE = 0.62;
export const SERVER_PWA_MASKABLE_BADGE_SCALE = 0.70;
/** Application / stacked logo-app.png: inset so STREAM/PILOT aren't clipped by launchers. */
export const APP_PWA_ICON_LOGO_SCALE = 0.86;
export const APP_PWA_MASKABLE_LOGO_SCALE = 0.72;
/** Bust apple-touch / PWA caches after launcher padding + static manifest touch icon. */
export const HOME_SCREEN_ICON_REV = 'hs11-trim-stacked-app';

export const getPortalBrandingIconCacheKey = (config = {}, profile = {}) => createHash('sha1')
    .update([
        String(config.pwaIconSource || 'server'),
        String(config.customLogoUrl || ''),
        String(config.customFaviconUrl || ''),
        String(config.customBadgeUrl || ''),
        String(config.mediaServerType || ''),
        String(profile.thumb || ''),
        String(profile.serverName || ''),
        String(SERVER_PWA_ICON_BADGE_SCALE),
        String(APP_PWA_ICON_LOGO_SCALE),
        HOME_SCREEN_ICON_REV,
    ].join('|'))
    .digest('hex')
    .slice(0, 12);

const parsePlexImageProxyPath = (value = '') => {
    const trimmed = String(value || '').trim();
    if (!trimmed.includes('/api/plex/image')) return '';
    try {
        const query = trimmed.includes('?') ? trimmed.split('?').slice(1).join('?') : '';
        const params = new URLSearchParams(query);
        return String(params.get('path') || '').trim();
    } catch {
        return '';
    }
};

const JELLYFIN_BRANDING_ICON_PATHS = new Set([
    '/api/jellyfin/branding/icon',
    '/api/jellyfin/branding/favicon',
]);

const resolveInternalBrandingPath = (value = '', stripBasePathFromUrl = (path) => path) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    const withoutQuery = trimmed.split('?')[0];
    const normalized = stripBasePathFromUrl(withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`);
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
};

const readLocalStaticAsset = async (custom, staticDir, stripBasePathFromUrl, brandingDir = '') => {
    const localPath = stripBasePathFromUrl(custom.startsWith('/') ? custom : `/${custom}`).split('?')[0];
    if (!localPath.startsWith('/static/')) return null;
    if (brandingDir) {
        const persisted = await readBrandingAssetByPublicPath(localPath, brandingDir);
        if (persisted) return persisted;
    }
    // Uploaded branding lives under config/branding/ and is only served as /static/logo.png
    // (etc.) via the branding route. Never fall through to the packaged StreamPilot logo.
    if (parseBrandingPublicPath(localPath)) return null;
    const fileName = path.basename(localPath);
    if (!fileName || fileName.includes('..')) return null;
    try {
        return await fs.readFile(path.join(staticDir, fileName));
    } catch {
        return null;
    }
};

const resolveServerBrandingCustomUrl = (config = {}, deps = {}) => {
    const { normalizeBrandingAssetForMediaServer } = deps;
    const mediaType = config.mediaServerType;
    const favicon = String(
        normalizeBrandingAssetForMediaServer?.(config.customFaviconUrl, mediaType)
        || config.customFaviconUrl
        || '',
    ).trim();
    if (favicon) return favicon;
    return String(
        normalizeBrandingAssetForMediaServer?.(config.customLogoUrl, mediaType)
        || config.customLogoUrl
        || '',
    ).trim();
};

const fetchRemoteImage = async (url, deps, timeoutMs = 2500) => {
    const { fetchWithTimeout, isBlockedHostName } = deps;
    try {
        const parsed = new URL(url);
        if (isBlockedHostName(parsed.hostname)) return null;
        const response = await fetchWithTimeout(url, { redirect: 'follow' }, timeoutMs).catch(() => null);
        if (!response?.ok) return null;
        const buffer = Buffer.from(await response.arrayBuffer());
        return buffer.length ? buffer : null;
    } catch {
        return null;
    }
};

const fetchPlexThumbBuffer = async (thumbPath, config, deps, { width = 512, height = 512, timeoutMs = 2500 } = {}) => {
    const { getPlexConnectionUri, isSafePlexMediaPath, plexClientHeaders, fetchWithTimeout } = deps;
    if (!thumbPath || !isSafePlexMediaPath(thumbPath) || !config.plexToken) return null;
    const uri = await getPlexConnectionUri(config);
    if (!uri) return null;
    const url = `${uri}/photo/:/transcode?url=${encodeURIComponent(thumbPath)}&width=${width}&height=${height}&minSize=1&X-Plex-Token=${config.plexToken}`;
    const response = await fetchWithTimeout(url, { headers: plexClientHeaders(config.plexToken) }, timeoutMs).catch(() => null);
    if (!response?.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length ? buffer : null;
};

const fetchJellyfinBrandingBuffer = async (config, deps, timeoutMs = 2500) => {
    const { isJellyfinConfigured, resolveIntegrationUrlForFetch, jellyfinHeaders, fetchWithTimeout } = deps;
    if (!isJellyfinConfigured(config)) return null;
    try {
        const baseUrl = resolveIntegrationUrlForFetch(config.jellyfinUrl);
        for (const assetPath of ['/web/icon-transparent.png', '/web/assets/img/icon-transparent.png']) {
            const response = await fetchWithTimeout(`${baseUrl}${assetPath}`, {
                headers: jellyfinHeaders(config.jellyfinApiKey, { Accept: 'image/*,*/*;q=0.8' }),
            }, timeoutMs).catch(() => null);
            if (!response?.ok) continue;
            const buffer = Buffer.from(await response.arrayBuffer());
            if (buffer.length) return buffer;
        }
    } catch {
        // fall through
    }
    return null;
};

/**
 * Resolve the raster used for server branding (custom logo, Jellyfin icon, Plex admin thumb).
 */
export const fetchPortalBrandingRasterBuffer = async (config = {}, profile = {}, deps = {}, options = {}) => {
    const {
        normalizeBrandingAssetForMediaServer,
        stripBasePathFromUrl,
        normalizePwaIconSource,
    } = deps;
    const staticDir = options.staticDir || path.join(process.cwd(), 'static');
    const brandingDir = options.brandingDir || '';
    const timeoutMs = Number(options.timeoutMs) || 2500;

    if (normalizePwaIconSource(config.pwaIconSource) === 'application') {
        return readApplicationLogoBuffer(staticDir, { preferAppIcon: true });
    }

    // Prefer favicon upload when present — Settings label is "Server logo (favicon)".
    const custom = resolveServerBrandingCustomUrl(config, { normalizeBrandingAssetForMediaServer });
    if (custom) {
        if (custom.startsWith('http://') || custom.startsWith('https://')) {
            const remote = await fetchRemoteImage(custom, deps, timeoutMs);
            if (remote) return remote;
        } else {
            const local = await readLocalStaticAsset(custom, staticDir, stripBasePathFromUrl, brandingDir);
            if (local) return local;
            const internalPath = resolveInternalBrandingPath(custom, stripBasePathFromUrl);
            if (JELLYFIN_BRANDING_ICON_PATHS.has(internalPath)) {
                const jellyfinIcon = await fetchJellyfinBrandingBuffer(config, deps, timeoutMs);
                if (jellyfinIcon) return jellyfinIcon;
            }
            const proxyPath = parsePlexImageProxyPath(custom);
            if (proxyPath) {
                const proxied = await fetchPlexThumbBuffer(proxyPath, config, deps, { timeoutMs });
                if (proxied) return proxied;
            }
            if (deps.isSafePlexMediaPath?.(custom)) {
                const plexPath = await fetchPlexThumbBuffer(custom, config, deps, { timeoutMs });
                if (plexPath) return plexPath;
            }
        }
    }

    const jellyfin = await fetchJellyfinBrandingBuffer(config, deps, timeoutMs);
    if (jellyfin) return jellyfin;

    const thumb = String(profile.thumb || '').trim();
    if (thumb.startsWith('http://') || thumb.startsWith('https://')) {
        const remote = await fetchRemoteImage(thumb, deps, timeoutMs);
        if (remote) return remote;
    } else if (thumb) {
        const plexThumb = await fetchPlexThumbBuffer(thumb, config, deps, { timeoutMs });
        if (plexThumb) return plexThumb;
    }

    return null;
};

/**
 * Horizontal wordmark for UI / README (`logo.png`).
 * Prefer `logo-app.png` (stacked Stream / Pilot) for home-screen & PWA launchers.
 */
export const readApplicationLogoBuffer = async (
    staticDir = path.join(process.cwd(), 'static'),
    { preferAppIcon = false } = {},
) => {
    const files = preferAppIcon
        ? ['logo-app.png', 'logo-app.jpg', 'logo.png', 'logo.jpg', 'logo.jpeg', 'logo.webp']
        : ['logo.png', 'logo.jpg', 'logo.jpeg', 'logo.webp', 'logo-app.png'];
    for (const fileName of files) {
        try {
            const buffer = await fs.readFile(path.join(staticDir, fileName));
            if (buffer.length) return buffer;
        } catch {
            // try next extension
        }
    }
    return null;
};

export const writePwaStaticIconFiles = async (sourceBuffer, staticDir = path.join(process.cwd(), 'static'), { mode = 'server' } = {}) => {
    if (!Buffer.isBuffer(sourceBuffer) || !sourceBuffer.length) {
        throw new Error('Missing source image for PWA icon sync');
    }
    await fs.mkdir(staticDir, { recursive: true });
    const isServer = mode === 'server';
    // Always opaque — iOS Add to Home Screen rejects near-transparent circular wordmarks.
    // Application mode uses the same trim + letterbox/contain path so stacked
    // logo-app.png isn't circle-cropped or shrunk by its transparent square margins.
    const icon192 = makeHomeScreenIconPng(sourceBuffer, 192, {
        badgeScale: isServer ? SERVER_PWA_ICON_BADGE_SCALE : APP_PWA_ICON_LOGO_SCALE,
        wideLogoScale: APP_PWA_ICON_LOGO_SCALE,
        plateLogoScale: APP_PWA_ICON_LOGO_SCALE,
    });
    const icon512 = makeHomeScreenIconPng(sourceBuffer, 512, {
        badgeScale: isServer ? SERVER_PWA_ICON_BADGE_SCALE : APP_PWA_ICON_LOGO_SCALE,
        wideLogoScale: APP_PWA_ICON_LOGO_SCALE,
        plateLogoScale: APP_PWA_ICON_LOGO_SCALE,
    });
    const maskable = makeHomeScreenIconPng(sourceBuffer, 512, {
        badgeScale: isServer ? SERVER_PWA_MASKABLE_BADGE_SCALE : APP_PWA_MASKABLE_LOGO_SCALE,
        wideLogoScale: APP_PWA_MASKABLE_LOGO_SCALE,
        plateLogoScale: APP_PWA_MASKABLE_LOGO_SCALE,
    });
    const touch180 = makeHomeScreenIconPng(sourceBuffer, 180, {
        badgeScale: isServer ? SERVER_PWA_ICON_BADGE_SCALE : APP_PWA_ICON_LOGO_SCALE,
        wideLogoScale: APP_PWA_ICON_LOGO_SCALE,
        plateLogoScale: APP_PWA_ICON_LOGO_SCALE,
    });
    await Promise.all([
        fs.writeFile(path.join(staticDir, 'pwa-icon-192.png'), icon192),
        fs.writeFile(path.join(staticDir, 'pwa-icon-512.png'), icon512),
        fs.writeFile(path.join(staticDir, 'pwa-icon-maskable-512.png'), maskable),
        fs.writeFile(path.join(staticDir, 'apple-touch-icon.png'), touch180),
        fs.writeFile(path.join(staticDir, 'apple-touch-icon-precomposed.png'), touch180),
    ]);
};

export const syncPortalPwaStaticIcons = async (config = {}, profile = {}, deps = {}, options = {}) => {
    const { normalizePwaIconSource, log = () => {} } = deps;
    const staticDir = options.staticDir || path.join(process.cwd(), 'static');
    const mode = normalizePwaIconSource(config.pwaIconSource) === 'application' ? 'application' : 'server';
    try {
        const sourceBuffer = mode === 'application'
            ? await readApplicationLogoBuffer(staticDir, { preferAppIcon: true })
            : await fetchPortalBrandingRasterBuffer(config, profile, deps, {
                staticDir,
                brandingDir: options.brandingDir || '',
                timeoutMs: options.timeoutMs || 5000,
            });
        if (!sourceBuffer) {
            log('[Branding] PWA icon sync skipped: no source image available');
            return { synced: false, cacheKey: getPortalBrandingIconCacheKey(config, profile) };
        }
        await writePwaStaticIconFiles(sourceBuffer, staticDir, { mode });
        return { synced: true, cacheKey: getPortalBrandingIconCacheKey(config, profile), mode };
    } catch (error) {
        log(`[Branding] PWA icon sync failed: ${error.message}`);
        return { synced: false, cacheKey: getPortalBrandingIconCacheKey(config, profile), error: error.message };
    }
};

export const resolvePortalPwaManifestIconHref = (
    config = {},
    profile = {},
    resolvePublicAssetHref = (href) => href,
    { size = 192, maskable = false } = {},
) => {
    const cacheKey = getPortalBrandingIconCacheKey(config, profile);
    // Always serve install icons from static files. Live /api/public/pwa-icon can
    // 502 behind Cloudflare when Plex branding is slow, and iOS "Open as Web App"
    // then falls back to a letter glyph even if apple-touch-icon.png is fine.
    const fileName = maskable
        ? 'pwa-icon-maskable-512.png'
        : `pwa-icon-${size >= 512 ? 512 : 192}.png`;
    return `${resolvePublicAssetHref(`/static/${fileName}`)}?v=${cacheKey}`;
};

export const resolvePortalPushIconUrl = (config = {}, profile = {}, publicBase = '') => {
    const base = String(publicBase || '').replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) return '';
    const cacheKey = getPortalBrandingIconCacheKey(config, profile);
    return `${base}/static/pwa-icon-192.png?v=${encodeURIComponent(cacheKey)}`;
};

export const resolvePortalPushBadgeUrl = (config = {}, profile = {}, publicBase = '') => {
    const base = String(publicBase || '').replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) return '';
    const cacheKey = getPortalBrandingIconCacheKey(config, profile);
    return `${base}/api/public/pwa-badge?size=96&m=sz3&v=${encodeURIComponent(cacheKey)}`;
};

export const fetchPortalEmailLogoBuffer = async (config = {}, profile = {}, deps = {}, options = {}) => {
    const { normalizePwaIconSource } = deps;
    const mode = normalizePwaIconSource(config.pwaIconSource);
    if (mode === 'application') {
        // Email header keeps the horizontal wordmark when present.
        return readApplicationLogoBuffer(undefined, { preferAppIcon: false });
    }
    return fetchPortalBrandingRasterBuffer(config, profile, deps, {
        timeoutMs: 8000,
        brandingDir: options.brandingDir || '',
        staticDir: options.staticDir,
    });
};
