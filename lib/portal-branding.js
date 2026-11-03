import fs from 'fs/promises';
import path from 'path';
import {
    parseBrandingPublicPath,
    readBrandingAssetByPublicPath,
} from './branding-storage.js';
import { createHash } from 'crypto';
import {
    makeHomeScreenIconPng,
    makeIosLauncherIconPng,
} from './circular-icon.js';

/** Server-logo PWA launcher padding (~20% smaller than legacy 0.78 / 0.88). */
export const SERVER_PWA_ICON_BADGE_SCALE = 0.62;
export const SERVER_PWA_MASKABLE_BADGE_SCALE = 0.70;
/** Application / stacked logo-app.png: inset so STREAM/PILOT aren't clipped by launchers. */
export const APP_PWA_ICON_LOGO_SCALE = 0.86;
export const APP_PWA_MASKABLE_LOGO_SCALE = 0.72;
/**
 * Bust apple-touch / PWA caches. iOS Safari often ignores ?query on apple-touch-icon
 * and keys the home-screen bitmap by path — bump this string (and the stamped filename)
 * whenever the stacked launcher mark changes.
 */
export const HOME_SCREEN_ICON_REV = 'hs13-ios-centered';

/** Path-safe rev used in /static/apple-touch-{rev}.png for iOS cache busting. */
export const homeScreenIconFileRev = () => String(HOME_SCREEN_ICON_REV).replace(/[^a-zA-Z0-9_-]/g, '');

export const getPortalBrandingIconCacheKey = (config = {}, profile = {}) => createHash('sha1')
    .update([
        String(config.pwaIconSource || 'application'),
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

/** Filenames written by PWA icon sync (served via stamped /static/*-v<key>.png aliases). */
export const PWA_ICON_OUTPUT_FILES = Object.freeze([
    'pwa-icon-192.png',
    'pwa-icon-512.png',
    'pwa-icon-maskable-512.png',
    'apple-touch-icon.png',
    'apple-touch-icon-precomposed.png',
    'apple-touch-icon-180x180.png',
    'apple-touch-icon-192.png',
]);

/** Persistent override dir under config/branding — survives image redeploys that restore packaged StreamPilot static/. */
export const portalPwaIconDir = (brandingDir = '') => (
    brandingDir ? path.join(String(brandingDir), 'pwa') : ''
);

export const writePwaStaticIconFiles = async (sourceBuffer, staticDir = path.join(process.cwd(), 'static'), { mode = 'server', brandingDir = '' } = {}) => {
    if (!Buffer.isBuffer(sourceBuffer) || !sourceBuffer.length) {
        throw new Error('Missing source image for PWA icon sync');
    }
    const isServer = mode === 'server';
    // Always opaque — iOS Add to Home Screen rejects near-transparent circular wordmarks.
    // Application mode uses the same trim + letterbox/contain path so stacked
    // logo-app.png isn't circle-cropped or shrunk by its transparent square margins.
    const scales = {
        badgeScale: isServer ? SERVER_PWA_ICON_BADGE_SCALE : APP_PWA_ICON_LOGO_SCALE,
        wideLogoScale: APP_PWA_ICON_LOGO_SCALE,
        plateLogoScale: APP_PWA_ICON_LOGO_SCALE,
    };
    const maskScales = {
        badgeScale: isServer ? SERVER_PWA_MASKABLE_BADGE_SCALE : APP_PWA_MASKABLE_LOGO_SCALE,
        wideLogoScale: APP_PWA_MASKABLE_LOGO_SCALE,
        plateLogoScale: APP_PWA_MASKABLE_LOGO_SCALE,
    };
    // Tab favicon keeps the previous plate. The iOS / install icon is a separate
    // sharper bitmap: optically centered and inset so the squircle does not crop it.
    const favicon180 = makeHomeScreenIconPng(sourceBuffer, 180, scales);
    const favicon32 = makeHomeScreenIconPng(sourceBuffer, 32, scales);
    const plate = (px, scaleSet = scales) => makeHomeScreenIconPng(sourceBuffer, px, scaleSet);
    const ios = (px, margin) => makeIosLauncherIconPng(sourceBuffer, px, margin ? { margin } : {});
    const icon192 = isServer ? plate(192) : ios(192);
    const icon512 = isServer ? plate(512) : ios(512);
    const maskable = isServer ? plate(512, maskScales) : ios(512, 0.2);
    const touch180 = isServer ? plate(180) : ios(180);
    const touch192 = isServer ? plate(192) : ios(192);
    const touch512 = icon512;
    const revName = `apple-touch-${homeScreenIconFileRev()}.png`;
    const payloads = {
        'pwa-icon-192.png': icon192,
        'pwa-icon-512.png': icon512,
        'pwa-icon-maskable-512.png': maskable,
        'apple-touch-icon.png': touch180,
        'apple-touch-icon-precomposed.png': touch180,
        'apple-touch-icon-180x180.png': touch180,
        'apple-touch-icon-192.png': touch192,
        // iOS Add to Home Screen upscales a 180px icon. Ship 512 so the mark stays sharp.
        [revName]: touch512,
        'favicon-32.png': favicon32,
        'favicon-180.png': favicon180,
    };
    const outputDirs = [staticDir];
    const persistentDir = portalPwaIconDir(brandingDir);
    if (persistentDir) outputDirs.push(persistentDir);
    for (const dir of outputDirs) {
        await fs.mkdir(dir, { recursive: true });
        await Promise.all(
            Object.entries(payloads).map(([name, buffer]) => fs.writeFile(path.join(dir, name), buffer)),
        );
    }
    return { revName, touch180, outputDirs };
};

/**
 * Install icons are addressed by *filename-stamped* paths with NO query string:
 *   /static/pwa-icon-192-v<cacheKey>.png, /static/apple-touch-<rev>-v<cacheKey>.png
 * iOS 26+ "Open as Web App" reads icons from the manifest / apple-touch-icon at
 * add-time via Safari's own loader, and every ?v= URL we shipped produced a letter
 * glyph even though the same URL loaded fine for Favourites. Textbook manifests
 * (bare /icon-512.png) work, so the stamp lives in the filename instead.
 * index.js maps the stamped name back to the base file.
 */
export const PWA_STAMPED_ICON_BASES = Object.freeze([
    'pwa-icon-192',
    'pwa-icon-512',
    'pwa-icon-maskable-512',
]);

export const appleTouchIconBaseName = () => `apple-touch-${homeScreenIconFileRev()}`;

export const stampedPwaIconFileName = (baseName, cacheKey) => (
    `${baseName}-v${String(cacheKey || '').replace(/[^0-9a-f]/gi, '').slice(0, 40) || '0'}.png`
);

/** Returns the base file name ("pwa-icon-192.png") for a stamped request, or null. */
export const parseStampedPwaIconFileName = (fileName = '') => {
    const match = /^([a-z0-9][a-z0-9_-]*?)-v[0-9a-f]{1,40}\.png$/i.exec(String(fileName || '').trim());
    if (!match) return null;
    const base = match[1];
    if (PWA_STAMPED_ICON_BASES.includes(base) || base === appleTouchIconBaseName()) {
        return `${base}.png`;
    }
    return null;
};

/** Same-origin href for <link rel="apple-touch-icon"> (rev + cache key in the filename, no query). */
export const resolveAppleTouchIconHref = (
    config = {},
    profile = {},
    resolvePublicAssetHref = (href) => href,
) => {
    const cacheKey = getPortalBrandingIconCacheKey(config, profile);
    return resolvePublicAssetHref(`/static/${stampedPwaIconFileName(appleTouchIconBaseName(), cacheKey)}`);
};

export const syncPortalPwaStaticIcons = async (config = {}, profile = {}, deps = {}, options = {}) => {
    const { normalizePwaIconSource, log = () => {} } = deps;
    const staticDir = options.staticDir || path.join(process.cwd(), 'static');
    let mode = normalizePwaIconSource(config.pwaIconSource) === 'application' ? 'application' : 'server';
    try {
        let sourceBuffer = mode === 'application'
            ? await readApplicationLogoBuffer(staticDir, { preferAppIcon: true })
            : await fetchPortalBrandingRasterBuffer(config, profile, deps, {
                staticDir,
                brandingDir: options.brandingDir || '',
                timeoutMs: options.timeoutMs || 5000,
            });
        // Never leave iOS without a real PNG — fall back to stacked logo-app.png.
        if (!sourceBuffer) {
            sourceBuffer = await readApplicationLogoBuffer(staticDir, { preferAppIcon: true });
            if (sourceBuffer) {
                log('[Branding] PWA icon sync: source missing — using stacked application logo');
                mode = 'application';
            }
        }
        if (!sourceBuffer) {
            log('[Branding] PWA icon sync skipped: no source image available');
            return { synced: false, cacheKey: getPortalBrandingIconCacheKey(config, profile) };
        }
        await writePwaStaticIconFiles(sourceBuffer, staticDir, {
            mode,
            brandingDir: options.brandingDir || '',
        });
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
    // No query string — see resolveAppleTouchIconHref.
    const baseName = maskable
        ? 'pwa-icon-maskable-512'
        : `pwa-icon-${size >= 512 ? 512 : 192}`;
    return resolvePublicAssetHref(`/static/${stampedPwaIconFileName(baseName, cacheKey)}`);
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
