import fs from 'fs/promises';
import path from 'path';
import {
    readBrandingAssetByPublicPath,
} from './branding-storage.js';
import { createHash } from 'crypto';
import {
    makeHomeScreenIconPng,
    makeSquarePaddedPwaIconPng,
} from './circular-icon.js';

/** Server-logo PWA launcher padding (~20% smaller than legacy 0.78 / 0.88). */
export const SERVER_PWA_ICON_BADGE_SCALE = 0.62;
export const SERVER_PWA_MASKABLE_BADGE_SCALE = 0.70;
/** Bust apple-touch / PWA caches after brand logo refresh. */
export const HOME_SCREEN_ICON_REV = 'hs4-brand';

export const getPortalBrandingIconCacheKey = (config = {}, profile = {}) => createHash('sha1')
    .update([
        String(config.pwaIconSource || 'server'),
        String(config.customLogoUrl || ''),
        String(config.customBadgeUrl || ''),
        String(config.mediaServerType || ''),
        String(profile.thumb || ''),
        String(profile.serverName || ''),
        String(SERVER_PWA_ICON_BADGE_SCALE),
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
    if (localPath.startsWith('/static/') && brandingDir) {
        const persisted = await readBrandingAssetByPublicPath(localPath, brandingDir);
        if (persisted) return persisted;
    }
    if (!localPath.startsWith('/static/')) return null;
    const fileName = path.basename(localPath);
    if (!fileName || fileName.includes('..')) return null;
    try {
        return await fs.readFile(path.join(staticDir, fileName));
    } catch {
        return null;
    }
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

    const custom = String(normalizeBrandingAssetForMediaServer(config.customLogoUrl, config.mediaServerType) || '').trim();
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
    // Application `logo-app.png` is already a padded square mark — don't upscale-crop it.
    const icon192 = isServer
        ? makeHomeScreenIconPng(sourceBuffer, 192, { badgeScale: SERVER_PWA_ICON_BADGE_SCALE })
        : makeSquarePaddedPwaIconPng(sourceBuffer, 192, { logoScale: 1 });
    const icon512 = isServer
        ? makeHomeScreenIconPng(sourceBuffer, 512, { badgeScale: SERVER_PWA_ICON_BADGE_SCALE })
        : makeSquarePaddedPwaIconPng(sourceBuffer, 512, { logoScale: 1 });
    const maskable = isServer
        ? makeHomeScreenIconPng(sourceBuffer, 512, { badgeScale: SERVER_PWA_MASKABLE_BADGE_SCALE, wideLogoScale: 0.88 })
        : makeSquarePaddedPwaIconPng(sourceBuffer, 512, { logoScale: 0.88 });
    await Promise.all([
        fs.writeFile(path.join(staticDir, 'pwa-icon-192.png'), icon192),
        fs.writeFile(path.join(staticDir, 'pwa-icon-512.png'), icon512),
        fs.writeFile(path.join(staticDir, 'pwa-icon-maskable-512.png'), maskable),
    ]);
};

export const syncPortalPwaStaticIcons = async (config = {}, profile = {}, deps = {}, options = {}) => {
    const { normalizePwaIconSource, log = () => {} } = deps;
    const staticDir = options.staticDir || path.join(process.cwd(), 'static');
    const mode = normalizePwaIconSource(config.pwaIconSource) === 'application' ? 'application' : 'server';
    try {
        const sourceBuffer = mode === 'application'
            ? await readApplicationLogoBuffer(staticDir, { preferAppIcon: true })
            : await fetchPortalBrandingRasterBuffer(config, profile, deps, { staticDir, timeoutMs: options.timeoutMs || 5000 });
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
    const mode = String(config.pwaIconSource || 'server').trim().toLowerCase();
    if (mode === 'application') {
        const fileName = maskable ? 'pwa-icon-maskable-512.png' : `pwa-icon-${size >= 512 ? 512 : 192}.png`;
        return `${resolvePublicAssetHref(`/static/${fileName}`)}?v=${cacheKey}`;
    }
    const params = new URLSearchParams({
        size: String(size >= 512 ? 512 : 192),
        v: cacheKey,
    });
    if (maskable) params.set('maskable', '1');
    return `${resolvePublicAssetHref('/api/public/pwa-icon')}?${params.toString()}`;
};

export const resolvePortalPushIconUrl = (config = {}, profile = {}, publicBase = '') => {
    const base = String(publicBase || '').replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) return '';
    const cacheKey = getPortalBrandingIconCacheKey(config, profile);
    return `${base}/api/public/pwa-icon?size=192&v=${encodeURIComponent(cacheKey)}`;
};

export const resolvePortalPushBadgeUrl = (config = {}, profile = {}, publicBase = '') => {
    const base = String(publicBase || '').replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) return '';
    const cacheKey = getPortalBrandingIconCacheKey(config, profile);
    return `${base}/api/public/pwa-badge?size=96&m=sz3&v=${encodeURIComponent(cacheKey)}`;
};

export const fetchPortalEmailLogoBuffer = async (config = {}, profile = {}, deps = {}) => {
    const { normalizePwaIconSource } = deps;
    const mode = normalizePwaIconSource(config.pwaIconSource);
    if (mode === 'application') {
        // Email header keeps the horizontal wordmark when present.
        return readApplicationLogoBuffer(undefined, { preferAppIcon: false });
    }
    return fetchPortalBrandingRasterBuffer(config, profile, deps, { timeoutMs: 8000 });
};
