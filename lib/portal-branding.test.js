import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PNG } from 'pngjs';
import {
    fetchPortalBrandingRasterBuffer,
    getPortalBrandingIconCacheKey,
    readApplicationLogoBuffer,
    resolvePortalPwaManifestIconHref,
    resolvePortalPushIconUrl,
    resolvePortalPushBadgeUrl,
    syncPortalPwaStaticIcons,
    writePwaStaticIconFiles,
} from './portal-branding.js';
import { makeMaskablePwaIconPng } from './circular-icon.js';

const solidPng = (width, height, r, g, b, a = 255) => {
    const png = new PNG({ width, height });
    for (let i = 0; i < width * height; i += 1) {
        png.data[i * 4] = r;
        png.data[i * 4 + 1] = g;
        png.data[i * 4 + 2] = b;
        png.data[i * 4 + 3] = a;
    }
    return PNG.sync.write(png);
};

test('cache key changes when branding source changes', () => {
    const base = { pwaIconSource: 'server', customLogoUrl: '', mediaServerType: 'plex' };
    const profile = { thumb: '/library/metadata/1', serverName: 'Home' };
    const serverKey = getPortalBrandingIconCacheKey(base, profile);
    const appKey = getPortalBrandingIconCacheKey({ ...base, pwaIconSource: 'application' }, profile);
    assert.notEqual(serverKey, appKey);
});

test('resolvePortalPushIconUrl requires https public base', () => {
    const config = { pwaIconSource: 'server' };
    const profile = { thumb: 'https://plex.tv/avatar.png' };
    assert.equal(resolvePortalPushIconUrl(config, profile, ''), '');
    const url = resolvePortalPushIconUrl(config, profile, 'https://portal.example.com');
    assert.match(url, /^https:\/\/portal\.example\.com\/static\/pwa-icon-192\.png\?v=/);
    const badge = resolvePortalPushBadgeUrl(config, profile, 'https://portal.example.com');
    assert.match(badge, /^https:\/\/portal\.example\.com\/api\/public\/pwa-badge\?size=96&m=sz3&v=/);
});

test('resolvePortalPwaManifestIconHref always uses static files, stamped in the filename, no query', () => {
    const config = { pwaIconSource: 'server', customLogoUrl: '/api/jellyfin/branding/icon' };
    const profile = { serverName: 'Home' };
    const key = getPortalBrandingIconCacheKey(config, profile);
    const href = resolvePortalPwaManifestIconHref(config, profile, (path) => `https://portal.example.com${path}`, { size: 192 });
    assert.equal(href, `https://portal.example.com/static/pwa-icon-192-v${key}.png`);
    const appConfig = { ...config, pwaIconSource: 'application' };
    const appHref = resolvePortalPwaManifestIconHref(appConfig, profile, (path) => `https://portal.example.com${path}`, { size: 192 });
    assert.equal(appHref, `https://portal.example.com/static/pwa-icon-192-v${getPortalBrandingIconCacheKey(appConfig, profile)}.png`);
    assert.notEqual(appHref, href);
    const maskable = resolvePortalPwaManifestIconHref(config, profile, (path) => path, { size: 512, maskable: true });
    assert.equal(maskable, `/static/pwa-icon-maskable-512-v${key}.png`);
    for (const value of [href, appHref, maskable]) {
        assert.ok(!value.includes('?'), `install icon URLs must not carry a query string: ${value}`);
    }
});

test('stamped install icon names round-trip to their base static file', async () => {
    const {
        appleTouchIconBaseName,
        parseStampedPwaIconFileName,
        stampedPwaIconFileName,
    } = await import('./portal-branding.js');
    assert.equal(parseStampedPwaIconFileName(stampedPwaIconFileName('pwa-icon-192', 'a382a262fcbb')), 'pwa-icon-192.png');
    assert.equal(parseStampedPwaIconFileName('pwa-icon-512-vdeadbeef0001.png'), 'pwa-icon-512.png');
    assert.equal(parseStampedPwaIconFileName('pwa-icon-maskable-512-v0.png'), 'pwa-icon-maskable-512.png');
    assert.equal(
        parseStampedPwaIconFileName(stampedPwaIconFileName(appleTouchIconBaseName(), 'ABCDEF')),
        `${appleTouchIconBaseName()}.png`,
    );
    // Unknown bases, plain files, traversal and non-png must not map to anything.
    for (const bad of [
        'pwa-icon-192.png',
        'tailwind-vabc.png',
        'pwa-icon-192-vabc.svg',
        '../pwa-icon-192-vabc.png',
        'pwa-icon-192-v.png',
        'pwa-icon-192-vzz.png',
        '',
    ]) {
        assert.equal(parseStampedPwaIconFileName(bad), null, bad);
    }
});

test('fetchPortalBrandingRasterBuffer does not fall back to application logo in server mode', async () => {
    const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pwa-branding-'));
    await fs.writeFile(path.join(staticDir, 'logo.png'), solidPng(64, 64, 255, 0, 0));
    const config = { pwaIconSource: 'server', customLogoUrl: '', mediaServerType: 'plex' };
    const profile = { thumb: '' };
    const buffer = await fetchPortalBrandingRasterBuffer(config, profile, {
        normalizeBrandingAssetForMediaServer: (value) => value,
        stripBasePathFromUrl: (value) => value,
        normalizePwaIconSource: (value) => (value === 'application' ? 'application' : 'server'),
        isJellyfinConfigured: () => false,
    }, { staticDir });
    assert.equal(buffer, null);
});

test('fetchPortalBrandingRasterBuffer resolves jellyfin branding proxy path', async () => {
    const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pwa-jf-'));
    const jellyfinPng = solidPng(48, 48, 10, 200, 30);
    const config = { pwaIconSource: 'server', customLogoUrl: '/api/jellyfin/branding/icon', mediaServerType: 'jellyfin' };
    const profile = { thumb: '' };
    const buffer = await fetchPortalBrandingRasterBuffer(config, profile, {
        normalizeBrandingAssetForMediaServer: (value) => value,
        stripBasePathFromUrl: (value) => value,
        normalizePwaIconSource: (value) => (value === 'application' ? 'application' : 'server'),
        isJellyfinConfigured: () => true,
        resolveIntegrationUrlForFetch: (url) => url,
        jellyfinHeaders: () => ({}),
        fetchWithTimeout: async () => ({
            ok: true,
            arrayBuffer: async () => jellyfinPng,
        }),
    }, { staticDir });
    assert.ok(Buffer.isBuffer(buffer));
    assert.ok(buffer.length > 0);
});

test('writePwaStaticIconFiles writes install icon sizes', async () => {
    const { homeScreenIconFileRev, resolveAppleTouchIconHref } = await import('./portal-branding.js');
    const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pwa-icons-'));
    const source = solidPng(96, 96, 30, 144, 255);
    await writePwaStaticIconFiles(source, staticDir, { mode: 'application' });
    for (const fileName of [
        'pwa-icon-192.png',
        'pwa-icon-512.png',
        'pwa-icon-maskable-512.png',
        'apple-touch-icon.png',
        'apple-touch-icon-precomposed.png',
        'apple-touch-icon-180x180.png',
        `apple-touch-${homeScreenIconFileRev()}.png`,
    ]) {
        const stat = await fs.stat(path.join(staticDir, fileName));
        assert.ok(stat.size > 100, fileName);
    }
    const touchHref = resolveAppleTouchIconHref({ pwaIconSource: 'application' }, {}, (href) => href);
    assert.equal(
        touchHref,
        `/static/apple-touch-${homeScreenIconFileRev()}-v${getPortalBrandingIconCacheKey({ pwaIconSource: 'application' }, {})}.png`,
    );
    assert.ok(!touchHref.includes('?'), 'apple-touch-icon href must not carry a query string');
});

test('syncPortalPwaStaticIcons uses application logo in application mode', async () => {
    const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pwa-sync-'));
    await fs.writeFile(path.join(staticDir, 'logo.png'), solidPng(64, 64, 255, 0, 0));
    const config = { pwaIconSource: 'application' };
    const result = await syncPortalPwaStaticIcons(config, {}, {
        normalizePwaIconSource: (value) => (value === 'application' ? 'application' : 'server'),
        log: () => {},
    }, { staticDir });
    assert.equal(result.synced, true);
    assert.equal(result.mode, 'application');
    const icon192 = PNG.sync.read(await fs.readFile(path.join(staticDir, 'pwa-icon-192.png')));
    assert.equal(icon192.width, 192);
});

test('syncPortalPwaStaticIcons also writes persistent branding/pwa copies', async () => {
    const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pwa-static-persist-'));
    const brandingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pwa-brand-persist-'));
    await fs.writeFile(path.join(staticDir, 'logo-app.png'), solidPng(64, 64, 10, 20, 30));
    const result = await syncPortalPwaStaticIcons({ pwaIconSource: 'application' }, {}, {
        normalizePwaIconSource: (value) => (value === 'application' ? 'application' : 'server'),
        log: () => {},
    }, { staticDir, brandingDir });
    assert.equal(result.synced, true);
    const persistent = path.join(brandingDir, 'pwa', 'pwa-icon-192.png');
    const buf = await fs.readFile(persistent);
    assert.ok(buf.length > 0);
    assert.deepEqual(buf, await fs.readFile(path.join(staticDir, 'pwa-icon-192.png')));
});

test('syncPortalPwaStaticIcons reads uploaded branding from brandingDir, not packaged static/logo.png', async () => {
    const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pwa-static-'));
    const brandingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pwa-branding-'));
    // Packaged StreamPilot mark (should NOT be used).
    await fs.writeFile(path.join(staticDir, 'logo.png'), solidPng(64, 64, 255, 0, 0));
    // Uploaded server logo / favicon under config/branding.
    await fs.writeFile(path.join(brandingDir, 'logo.png'), solidPng(64, 64, 0, 255, 0));
    const config = {
        pwaIconSource: 'server',
        customLogoUrl: '/static/logo.png',
        mediaServerType: 'plex',
    };
    const result = await syncPortalPwaStaticIcons(config, {}, {
        normalizePwaIconSource: (value) => (value === 'application' ? 'application' : 'server'),
        normalizeBrandingAssetForMediaServer: (value) => value,
        stripBasePathFromUrl: (value) => value,
        isJellyfinConfigured: () => false,
        log: () => {},
    }, { staticDir, brandingDir });
    assert.equal(result.synced, true);
    // Without brandingDir the sync used to bake the red packaged logo; green means brandingDir won.
    const source = await fetchPortalBrandingRasterBuffer(config, {}, {
        normalizePwaIconSource: (value) => (value === 'application' ? 'application' : 'server'),
        normalizeBrandingAssetForMediaServer: (value) => value,
        stripBasePathFromUrl: (value) => value,
        isJellyfinConfigured: () => false,
    }, { staticDir, brandingDir });
    assert.ok(Buffer.isBuffer(source));
    assert.notDeepEqual(source, await fs.readFile(path.join(staticDir, 'logo.png')));
});

test('server mode prefers customFaviconUrl over customLogoUrl', async () => {
    const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pwa-fav-'));
    const brandingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pwa-fav-brand-'));
    await fs.writeFile(path.join(brandingDir, 'logo.png'), solidPng(32, 32, 255, 0, 0));
    await fs.writeFile(path.join(brandingDir, 'favicon.png'), solidPng(32, 32, 0, 0, 255));
    const buffer = await fetchPortalBrandingRasterBuffer({
        pwaIconSource: 'server',
        customLogoUrl: '/static/logo.png',
        customFaviconUrl: '/static/favicon.png',
        mediaServerType: 'plex',
    }, {}, {
        normalizePwaIconSource: (value) => (value === 'application' ? 'application' : 'server'),
        normalizeBrandingAssetForMediaServer: (value) => value,
        stripBasePathFromUrl: (value) => value,
        isJellyfinConfigured: () => false,
    }, { staticDir, brandingDir });
    assert.ok(Buffer.isBuffer(buffer));
    assert.deepEqual(buffer, await fs.readFile(path.join(brandingDir, 'favicon.png')));
});

test('application home-screen icons prefer stacked logo-app.png', async () => {
    const { readApplicationLogoBuffer } = await import('./portal-branding.js');
    const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pwa-app-'));
    await fs.writeFile(path.join(staticDir, 'logo.png'), solidPng(120, 40, 10, 10, 10));
    await fs.writeFile(path.join(staticDir, 'logo-app.png'), solidPng(64, 64, 255, 80, 20));
    const appIcon = await readApplicationLogoBuffer(staticDir, { preferAppIcon: true });
    const wordmark = await readApplicationLogoBuffer(staticDir, { preferAppIcon: false });
    assert.ok(Buffer.isBuffer(appIcon));
    assert.ok(Buffer.isBuffer(wordmark));
    assert.notDeepEqual(appIcon, wordmark);
});

test('maskable icon uses opaque background', () => {
    const out = makeMaskablePwaIconPng(solidPng(80, 80, 220, 40, 40), 64, { badgeScale: 0.88 });
    const png = PNG.sync.read(out);
    assert.equal(png.data[3], 255);
    assert.equal(png.data[(63 * 64 + 63) * 4 + 3], 255);
});
