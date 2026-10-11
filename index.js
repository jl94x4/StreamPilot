

import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import fetch, { Blob, FormData } from 'node-fetch';
import { randomUUID, randomBytes, createHash, createCipheriv, createDecipheriv } from 'crypto';
import nodemailer from 'nodemailer';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import http from 'http';
import https from 'https';
import compression from 'compression';
import { execSync } from 'child_process';
import fsSync from 'fs';
import net from 'net';
import dns from 'dns/promises';
import { makeCircularPwaIconPng } from './lib/circular-icon.js';
import { resolvePackageVersion } from './lib/resolve-package-version.js';
import {
    readWildcardPath,
    withWildcard,
} from './lib/express-wildcard.js';
import {
    getDefaultScannerConfig,
    normalizeScannerConfig,
    maskScannerConfigForApi,
    resolveScannerSecrets,
    sanitizeScannerTargetUrls,
    findTriggerByName,
    enqueueScans,
    getQueueStats,
    appendLog,
    listLog,
    processOne,
    startScannerWorker,
    createBasicAuthMiddleware,
    pathsFromSonarrEvent,
    pathsFromRadarrEvent,
    pathsFromLidarrEvent,
    classifyArrEvent,
    buildScansFromPaths,
    parseAutoscanYaml,
    buildTargets,
} from './lib/scanner/index.js';

const resolveAppVersion = () => {
    const pkgVersion = resolvePackageVersion();

    try {
        const stamped = fsSync.readFileSync(path.join(process.cwd(), 'version.txt'), 'utf8').trim();
        // Prefer stamped build when present; strip stale major.minor if package/floor moved on.
        const match = stamped.match(/^v(\d+\.\d+\.\d+)(?:-(.+))?$/i);
        if (match) {
            const stampedPkg = match[1];
            const stampedSha = match[2] || '';
            if (stampedPkg === pkgVersion) return stamped;
            // Rebuild with current package version but keep the build SHA suffix when possible.
            if (stampedSha) return `v${pkgVersion}-${stampedSha}`;
        }
    } catch {
        // version.txt missing — rebuild below
    }

    const isTag = process.env.GITHUB_REF && String(process.env.GITHUB_REF).startsWith('refs/tags/');
    try {
        const gitHash = execSync('git rev-parse --short HEAD', { stdio: 'pipe' }).toString().trim();
        return isTag ? `v${pkgVersion}` : `v${pkgVersion}-${gitHash}`;
    } catch {
        return `v${pkgVersion}`;
    }
};

const appVersion = resolveAppVersion();

/** Plex session bandwidth is usually Kbps, but transcodes can report bps — normalize to Kbps. */
const normalizePlexBandwidthKbps = (raw) => {
    const n = Number(raw) || 0;
    if (!n) return 0;
    // >500 Mbps in Kbps is unrealistic for Plex; treat as bps misreport (e.g. 10_000_000 bps → 10 Mbps).
    if (n > 500_000) return Math.round(n / 1000);
    return Math.round(n);
};

const app = express();
app.use(compression({
    filter: (req, res) => {
        // Speed tests must stay uncompressed — gzip of repetitive payloads skews Mbps badly.
        const url = String(req.originalUrl || req.url || '');
        if (url.includes('/api/speedtest/')) return false;
        return compression.filter(req, res);
    },
}));
const PORT = parseInt(process.env.PORT || '2121', 10);
const BIND_HOST = process.env.BIND_HOST || '0.0.0.0';
const SETUP_TOKEN = process.env.SETUP_TOKEN || '';
const ALLOW_PRIVATE_INTEGRATION_URLS = String(process.env.ALLOW_PRIVATE_INTEGRATION_URLS || '').toLowerCase() === 'true';
const FORCE_SECURE_COOKIES = String(process.env.FORCE_SECURE_COOKIES || '').toLowerCase() === 'true';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || '';

/** Normalize a public portal URL (no trailing slash). Returns '' if invalid/empty. */
const normalizePublicBaseUrl = (raw = '') => {
    const value = String(raw || '').trim().replace(/\/+$/, '');
    if (!value) return '';
    try {
        return new URL(value).toString().replace(/\/+$/, '');
    } catch {
        return '';
    }
};

const getEnvPublicBaseUrl = () => normalizePublicBaseUrl(PUBLIC_BASE_URL);

/**
 * Prefer Portal UI "Public Base URL" (config.publicDomain), then PUBLIC_BASE_URL env.
 * Used for invite emails, newsletter links, OG tags, and CSRF allowed origins.
 */
const resolvePublicBaseUrlFromConfig = (config = {}) => (
    normalizePublicBaseUrl(config?.publicDomain) || getEnvPublicBaseUrl()
);

/** Hot-updated when settings save so CSRF / sync helpers see the UI value. */
let runtimePublicBaseUrl = getEnvPublicBaseUrl();

const refreshRuntimePublicBaseUrl = (config = {}) => {
    runtimePublicBaseUrl = resolvePublicBaseUrlFromConfig(config) || getEnvPublicBaseUrl();
    return runtimePublicBaseUrl;
};

const normalizeBasePath = (raw = '') => {
    const value = String(raw || '').trim();
    if (!value || value === '/') return '';
    const withLeading = value.startsWith('/') ? value : `/${value}`;
    return withLeading.replace(/\/+$/, '');
};

const deriveBasePath = () => {
    if (process.env.BASE_PATH != null && String(process.env.BASE_PATH).trim() !== '') {
        return normalizeBasePath(process.env.BASE_PATH);
    }
    if (PUBLIC_BASE_URL) {
        try {
            return normalizeBasePath(new URL(PUBLIC_BASE_URL).pathname);
        } catch (_) { /* fall through */ }
    }
    return '';
};

const BASE_PATH = deriveBasePath();

const withBasePath = (route = '/') => {
    const path = route.startsWith('/') ? route : `/${route}`;
    return BASE_PATH ? `${BASE_PATH}${path}` : path;
};

const plexImageUrl = (mediaPath) => withBasePath(`/api/plex/image?path=${encodeURIComponent(mediaPath)}`);

const stripBasePathFromUrl = (url = '/') => {
    const [pathname, ...queryParts] = String(url).split('?');
    const query = queryParts.length ? `?${queryParts.join('?')}` : '';
    if (!BASE_PATH) return url;
    if (pathname === BASE_PATH || pathname === `${BASE_PATH}/`) {
        return `/${query}`;
    }
    if (pathname.startsWith(`${BASE_PATH}/`)) {
        const rest = pathname.slice(BASE_PATH.length) || '/';
        return `${rest}${query}`;
    }
    return url;
};

// Sentinel sent to the admin UI in place of stored secrets so raw credentials
// never leave the server. When the UI posts this value back unchanged on save,
// the existing stored secret is preserved instead of being overwritten.
const SECRET_MASK = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';

// --- Security: JWT secret must be explicitly set in the environment ---
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
    console.error('FATAL: JWT_SECRET environment variable must be set and at least 32 characters long.');
    console.error('Set it in a .env file or your process environment before starting the server.');
    process.exit(1);
}

let CLIENT_ID = process.env.CLIENT_ID || 'plex-expiry-manager-client-id'; // Now dynamically generated if missing

// --- Security: HTTP Security Headers ---
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; frame-src 'self' https://www.openstreetmap.org; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'");
    if (req.secure || FORCE_SECURE_COOKIES) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    if (req.path.startsWith('/api/')) {
        res.setHeader('Cache-Control', 'no-store, private');
        res.setHeader('Pragma', 'no-cache');
    }
    next();
});

// --- Security: Rate Limiting for Auth Endpoints ---
// Prefer the TCP peer address so client-supplied X-Forwarded-For cannot bypass limits
// unless TRUST_PROXY is explicitly enabled for a real reverse-proxy deployment.
const TRUST_PROXY_FOR_RATE_LIMIT = ['1', 'true', 'yes'].includes(String(process.env.TRUST_PROXY || '').toLowerCase());
const getSocketPeerIp = (req) => (req.socket && req.socket.remoteAddress) || 'unknown';
const getClientIp = (req) => {
    if (TRUST_PROXY_FOR_RATE_LIMIT) {
        return req.ip || getSocketPeerIp(req) || 'unknown';
    }
    return getSocketPeerIp(req);
};
const createRateLimiter = (windowMs, maxRequests) => {
    const store = new Map();
    // Prune stale IP entries every window to prevent unbounded memory growth under high unique-IP load
    setInterval(() => {
        const now = Date.now();
        store.forEach((record, ip) => { if (now > record.resetAt) store.delete(ip); });
    }, windowMs).unref();
    return (req, res, next) => {
        const ip = getClientIp(req);
        const now = Date.now();
        const record = store.get(ip) || { count: 0, resetAt: now + windowMs };
        if (now > record.resetAt) {
            record.count = 0;
            record.resetAt = now + windowMs;
        }
        record.count++;
        store.set(ip, record);
        if (record.count > maxRequests) {
            return res.status(429).json({ error: 'Too many requests. Please try again later.' });
        }
        next();
    };
};
const authRateLimit = createRateLimiter(15 * 60 * 1000, 10); // Reduced from 20 — tighter brute-force window
const authCallbackRateLimit = createRateLimiter(15 * 60 * 1000, 40);
const jellyfinQuickConnectPollRateLimit = createRateLimiter(5 * 60 * 1000, 140);
const publicReadRateLimit = createRateLimiter(60 * 1000, 120);
const speedtestRateLimit = createRateLimiter(60 * 1000, 80); // parallel duration streams need headroom
const setupRateLimit = createRateLimiter(15 * 60 * 1000, 30);
const scannerTriggerRateLimit = createRateLimiter(15 * 60 * 1000, 60);

/** Strip secrets that must never leave the server in user JSON responses. */
const sanitizeUserForApi = (user) => {
    if (!user || typeof user !== 'object') return user;
    const { plexAuthToken, ...safe } = user;
    return safe;
};
const sanitizeUsersForApi = (users) => (Array.isArray(users) ? users.map(sanitizeUserForApi) : users);

const isLoopbackAddress = (ip = '') => {
    const normalizedIp = String(ip || '').replace('::ffff:', '').toLowerCase();
    return normalizedIp === '127.0.0.1' || normalizedIp === '::1' || normalizedIp === 'localhost';
};

const hasValidSetupToken = (req) => {
    if (!SETUP_TOKEN) return false;
    const provided = req.headers['x-setup-token'] || req.body?.setupToken || req.query?.setupToken;
    return typeof provided === 'string' && provided === SETUP_TOKEN;
};

// Use the raw TCP peer address for setup authorization. req.ip honors the
// client-supplied X-Forwarded-For header (trust proxy is enabled), which an
// attacker could spoof to impersonate localhost during the unconfigured window.
const canRunInitialSetup = (req) => hasValidSetupToken(req) || isLoopbackAddress(getSocketPeerIp(req));

const normalizeHostnameForIpCheck = (hostname = '') => {
    let host = String(hostname || '').trim().toLowerCase();
    if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
    const zone = host.indexOf('%');
    if (zone !== -1) host = host.slice(0, zone);
    return host;
};

const isPrivateIp = (host) => {
    const h = normalizeHostnameForIpCheck(host);
    if (!h) return false;
    if (h === '0.0.0.0' || h === '::' || h === '::0') return true;
    if (h.startsWith('::ffff:')) return isPrivateIp(h.slice('::ffff:'.length));
    if (!net.isIP(h)) return false;
    if (net.isIPv4(h)) {
        if (h === '127.0.0.1' || h.startsWith('127.')) return true;
        if (h.startsWith('10.') || h.startsWith('192.168.') || h.startsWith('169.254.')) return true;
        if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
        return false;
    }
    // IPv6: loopback, ULA (fc00::/7), link-local (fe80::/10)
    if (h === '::1') return true;
    if (/^f[cd]/i.test(h)) return true;
    if (/^fe[89ab]/i.test(h)) return true;
    return false;
};

const isLoopbackHostName = (hostname = '') => {
    const host = normalizeHostnameForIpCheck(hostname);
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.startsWith('127.');
};

const isBlockedHostName = (hostname = '') => {
    const host = normalizeHostnameForIpCheck(hostname);
    if (!host) return true;
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return true;
    if (isPrivateIp(host)) return true;
    return false;
};

/** DNS rebinding guard: require resolved addresses stay non-private when policy forbids LAN. */
const assertResolvedAddressesAllowed = async (hostname, { allowPrivate = false } = {}) => {
    const host = normalizeHostnameForIpCheck(hostname);
    if (!host) throw new Error('Invalid host');
    if (net.isIP(host)) {
        if (!allowPrivate && isPrivateIp(host)) {
            throw new Error('Private or local network hosts are not allowed. Set ALLOW_PRIVATE_INTEGRATION_URLS=true in your environment to allow LAN/private URLs.');
        }
        return;
    }
    let addresses;
    try {
        addresses = await dns.lookup(host, { all: true, verbatim: true });
    } catch {
        throw new Error(`Unable to resolve host: ${host}`);
    }
    if (!Array.isArray(addresses) || !addresses.length) {
        throw new Error(`Unable to resolve host: ${host}`);
    }
    if (allowPrivate) return;
    for (const entry of addresses) {
        const address = entry?.address || entry;
        if (isPrivateIp(address) || isBlockedHostName(address)) {
            throw new Error('Host resolves to a private or local network address. Set ALLOW_PRIVATE_INTEGRATION_URLS=true to allow LAN/private URLs.');
        }
    }
};

const assertHttpUrlAllowed = async (rawUrl, { allowPrivate = false } = {}) => {
    const normalized = normalizeExternalBaseUrl(rawUrl, { allowPrivate, allowHttp: true });
    const parsed = new URL(normalized);
    await assertResolvedAddressesAllowed(parsed.hostname, { allowPrivate });
    return normalized;
};

/** Fetch Arr poster/screenshot remotes without SSRF into private networks. */
const resolveSafeArrRemoteImageUrl = async (remoteUrl, arrBase) => {
    if (!remoteUrl) return null;
    const raw = String(remoteUrl).trim();
    let absolute;
    if (/^https?:\/\//i.test(raw)) {
        absolute = raw;
    } else {
        const base = String(arrBase || '').replace(/\/+$/, '');
        if (!base) return null;
        absolute = `${base}${raw.startsWith('/') ? '' : '/'}${raw}`;
    }
    let parsed;
    try {
        parsed = new URL(absolute);
    } catch {
        return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.hash = '';
    parsed.username = '';
    parsed.password = '';

    let arrHost = '';
    try {
        arrHost = normalizeHostnameForIpCheck(new URL(arrBase).hostname);
    } catch {
        arrHost = '';
    }
    const host = normalizeHostnameForIpCheck(parsed.hostname);
    if (arrHost && host === arrHost) return parsed.toString();

    // Third-party art CDNs must not resolve into RFC1918 / loopback.
    await assertResolvedAddressesAllowed(host, { allowPrivate: false });
    return parsed.toString();
};

const normalizeExternalBaseUrl = (rawUrl, { allowPrivate = false, allowHttp = true } = {}) => {
    if (!rawUrl) return '';
    let parsed;
    try {
        parsed = new URL(String(rawUrl).trim());
    } catch (e) {
        throw new Error('Invalid URL format');
    }
    const isHttps = parsed.protocol === 'https:';
    const isHttp = parsed.protocol === 'http:';
    if (!isHttps && !(allowHttp && isHttp)) {
        throw new Error('URL must use http or https');
    }
    if (!allowPrivate && isBlockedHostName(parsed.hostname)) {
        throw new Error('Private or local network hosts are not allowed. Set ALLOW_PRIVATE_INTEGRATION_URLS=true in your environment to allow LAN/private URLs.');
    }
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/+$/, '');
};

const sanitizeIntegrationUrl = (rawUrl) => {
    if (!rawUrl) return '';
    return normalizeExternalBaseUrl(rawUrl, { allowPrivate: ALLOW_PRIVATE_INTEGRATION_URLS, allowHttp: true });
};

// For server-side calls to an already-configured integration (Tautulli, Sonarr,
// Radarr, request apps), the host is trusted admin input and is typically a LAN
// address. We still validate URL format/scheme but allow private/local hosts so
// homelab setups work regardless of the ALLOW_PRIVATE_INTEGRATION_URLS setting,
// which only governs validation of newly submitted URLs.
const resolveIntegrationUrlForFetch = (rawUrl) => {
    if (!rawUrl) return '';
    return normalizeExternalBaseUrl(rawUrl, { allowPrivate: true, allowHttp: true });
};

const resolveRequestAppFetchUrl = (config = {}) => {
    const override = String(process.env.REQUEST_APP_INTERNAL_URL || config.requestAppFetchUrl || '').trim();
    if (override) return resolveIntegrationUrlForFetch(override);
    return resolveIntegrationUrlForFetch(config.requestAppUrl || '');
};

// Mark cookies Secure on HTTPS requests or when FORCE_SECURE_COOKIES=true.
// Plain HTTP LAN setups remain usable when the request is not secure.
const sessionCookieBase = (req) => ({
    httpOnly: true,
    secure: FORCE_SECURE_COOKIES || !!(req && req.secure),
    sameSite: 'lax',
    path: BASE_PATH || '/',
});

const clearSessionCookie = (req, res) => {
    res.clearCookie('session', sessionCookieBase(req));
};

const setSessionCookie = (req, res, token) => {
    res.cookie('session', token, {
        ...sessionCookieBase(req),
        maxAge: 7 * 24 * 60 * 60 * 1000,
    });
};

app.use(express.json({ limit: '50kb' })); // Middleware to parse JSON bodies (with size limit)
app.use(cookieParser()); // Middleware to parse cookies

// CSRF defense for cookie-authenticated API mutations: require same-origin
// Origin/Referer or the portal's custom X-Requested-With header (sent by apiFetch).
const PORTAL_CSRF_HEADER = 'x-requested-with';
const PORTAL_CSRF_VALUE = 'ServerManagerPortal';
const collectAllowedOrigins = (req) => {
    const allowed = new Set();
    // Prefer Host; only trust X-Forwarded-Host when TRUST_PROXY is explicitly enabled.
    const rawHost = TRUST_PROXY_FOR_RATE_LIMIT
        ? (req.get('x-forwarded-host') || req.get('host') || '')
        : (req.get('host') || '');
    const host = String(rawHost).split(',')[0].trim();
    if (host) {
        allowed.add(`https://${host}`);
        allowed.add(`http://${host}`);
    }
    if (runtimePublicBaseUrl || PUBLIC_BASE_URL) {
        try {
            allowed.add(new URL(runtimePublicBaseUrl || PUBLIC_BASE_URL).origin);
        } catch { /* ignore */ }
    }
    return allowed;
};
const isSameOriginApiRequest = (req) => {
    const allowed = collectAllowedOrigins(req);
    if (!allowed.size) return false;
    const origin = String(req.get('origin') || '').trim();
    if (origin && allowed.has(origin)) return true;
    const referer = String(req.get('referer') || '').trim();
    if (referer) {
        try {
            if (allowed.has(new URL(referer).origin)) return true;
        } catch { /* ignore */ }
    }
    return false;
};
const portalCsrfMiddleware = (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    if (!String(req.path || '').startsWith('/api/')) return next();
    const headerOk = String(req.get(PORTAL_CSRF_HEADER) || '') === PORTAL_CSRF_VALUE;
    if (headerOk || isSameOriginApiRequest(req)) return next();
    return res.status(403).json({ error: 'CSRF validation failed.' });
};

// Trust the first proxy (e.g. Nginx/Caddy) so req.secure reflects HTTPS correctly
app.set('trust proxy', 1);

// Strip BASE_PATH before CSRF so subdirectory deploys still match `/api/...`.
if (BASE_PATH) {
    app.use((req, res, next) => {
        req.url = stripBasePathFromUrl(req.url);
        next();
    });
}
app.use(portalCsrfMiddleware);

// --- In-Memory Cache for Plex Metadata ---
const plexMetadataCache = new Map();

import {
    CONFIG_DIR,
    CONFIG_PATH,
    INVITES_PATH,
    USERS_PATH,
    DELETED_USERS_PATH,
    AUDIT_LOG_PATH,
    EMAIL_LOG_PATH,
    STATUS_CONFIG_PATH,
    HEALTH_PATH,
    TRENDING_CACHE_PATH,
    ANALYTICS_CACHE_PATH,
    KILL_RULES_PATH,
    MAINTENANCE_RULES_PATH,
    MAINTENANCE_MEDIA_INDEX_PATH,
    MAINTENANCE_RUNS_PATH,
    MAINTENANCE_REQUEST_INDEX_PATH,
    MAINTENANCE_PREFS_PATH,
    UPGRADER_AUDIT_PATH,
    UPGRADER_PREFS_PATH,
    UPGRADER_INDEX_PATH,
    PLEX_STATS_CACHE_PATH,
    DISCOVERY_AVAILABILITY_CACHE_PATH,
    REQUESTS_DIR,
    ISSUES_DIR,
    BLOCKLIST_DIR,
    WATCHLIST_DIR,
    migrateConfigFiles,
} from './lib/data-paths.js';
import {
    applyCollexionsBundledDefaults,
    getCollexionsEmbeddedStatus,
    isCollexionsBundledAvailable,
    syncCollexionsEmbeddedWorker,
} from './lib/collexions-embedded.js';
import {
    normalizeArrConfig,
    migrateArrConfig,
    syncLegacyArrFields,
    getArrInstances,
    getArrInstance,
    getDefaultArrInstance,
    getArrCredentials,
    isArrTypeConfigured,
    isArrInstanceReady,
    maskArrInstancesForApi,
    mergeLegacyArrFieldsIntoInstances,
    getArrInstanceCounts,
    fetchArrInstanceCatalogItems,
    buildArrLookupMapsForItems,
    resolveArrEntity,
    resolveSonarrSeriesForShow,
    buildArrDeepUrl,
    fetchArrQualityProfiles,
    updateArrEntityQualityProfile,
    triggerArrEntitySearch,
    fetchSonarrEpisodesForSeries,
    fetchSonarrEpisodeFilesForSeries,
    fetchSonarrAllEpisodeFiles,
    fetchSonarrSeriesById,
    triggerSonarrEpisodeSearch,
    fetchArrQueueSummary,
    fetchArrInstanceJson,
    fetchRadarrMovieReleaseDates,
} from './lib/arr-service.js';
import { getSonarrTrashCatalog, getSonarrTrashCustomFormat } from './lib/trash-guides-catalog.js';
import { createRequestAppService, getRequestAppGate, mapSeerrClientError } from './lib/request-app-service.js';
import {
    applyDiscoveryQueryParams,
    ensureSeerrDiscoverySettings,
    filterDiscoveryPayload,
    getDiscoveryPreferences,
    getDiscoverySource,
    getRequestEngine,
    isPortalRequestNavReady,
    isAllowedDiscoveryProxyPath,
    normalizeDiscoveryProxyPath,
    normalizeDiscoverySource,
    normalizeDiscoverLanguage,
    normalizeDiscoverRegion,
    normalizeRequestEngine,
    resolveDiscoverMetadataLanguage,
} from './lib/discovery-settings.js';
import { buildDiscoveryFacts } from './lib/discovery-facts.js';
import { fetchDiscoveryHeroBackdrops } from './lib/discovery-hero.js';
import { fetchDiscoveryCombinedRatings, fetchImdbRatingsFromRadarr } from './lib/discovery-ratings.js';
import { enrichTvDetailsWithSonarrLibraryStatus, fetchSonarrLibraryStatusForShow } from './lib/sonarr-library-status.js';
import { enrichSessionsWithGeo } from './lib/geoip-lookup.js';
import {
    createTmdbClient,
    createTmdbDiscoverRouter,
    createLibraryAvailability,
    emptyDiscoveryAvailabilityCache,
    normalizeDiscoveryAvailabilityCache,
    getDiscoveryAvailabilityCacheVersion,
    lookupDiscoveryAvailability,
    lookupDiscoveryAvailabilityForItem,
    mergeAvailabilityEntryOntoItem,
    applyDiscoveryAvailabilityCacheToPayload,
    rebuildDiscoveryAvailabilityCache,
    createPortalRequestService,
    createPortalIssueService,
    createPortalBlocklistService,
    enrichDiscoveryPayloadWithTvdbPosters,
    createPortalWatchlistService,
    evaluatePortalMemberQuota,
    shouldPortalAutoApprove,
    getPortalRequestQuotaSettings,
    normalizeRequestQuotaLimit,
    normalizeRequestQuotaDays,
    importSeerrHistoryToPortal,
    resolveMemberRequestPolicy,
    canPolicyRequestMedia,
    normalizeUserRequestOverrides,
    pickPortalRequestDefaultsForSave,
    portalRequestDefaultsForClient,
    getPortalRequestDefaults,
} from './lib/portal-request/index.js';
const PLEX_API = 'https://plex.tv/api';

// --- Status App Global State ---
let statusConfig = {
    services: [],
    groups: [
        { id: 'core', name: 'Core Infrastructure', order: 0 },
        { id: 'media', name: 'Media Stack', order: 1 },
        { id: 'downloads', name: 'Download Clients', order: 2 },
        { id: 'external', name: 'External Services', order: 3 },
    ],
    announcement: null
};

let healthData = {};
const SPEED_TEST_CHUNK_SIZE = 4 * 1024 * 1024;
/** Incompressible chunk so transfer size ≈ measured bytes (also gzip-excluded above). */
const SPEED_TEST_BUFFER = randomBytes(SPEED_TEST_CHUNK_SIZE);
const SPEED_TEST_MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
/** Per-request upload cap for duration tests (client aborts sooner; needs room for multi-gig). */
const SPEED_TEST_MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;

const normalizeJellyfinAnalyticsProvider = (value, config = {}) => {
    const raw = String(value || '').toLowerCase();
    if (raw === 'jellystat' || raw === 'jellyglance') return raw;
    const hasJellystat = !!(config.jellystatUrl && config.jellystatApiKey);
    const hasJellyGlance = !!(config.jellyglanceUrl && config.jellyglanceApiKey);
    return hasJellystat && !hasJellyGlance ? 'jellystat' : 'jellyglance';
};

const createDefaultStatusConfig = (config = {}) => {
    const groups = [
        { id: 'core', name: 'Core Infrastructure', order: 0 },
        { id: 'media', name: 'Media Stack', order: 1 },
        { id: 'downloads', name: 'Download Clients', order: 2 },
        { id: 'external', name: 'External Services', order: 3 },
    ];
    const services = [];
    const addService = (id, name, url, groupId, description = '') => {
        if (!url) return;
        services.push({ id, name, url, type: 'web', groupId, description });
    };

    const publicDomain = resolvePublicBaseUrlFromConfig(config);
    if (publicDomain) addService('portal', 'Server Portal', `${publicDomain}/api/health`, 'core', 'Portal API health');

    const mediaServerType = String(config.mediaServerType || 'plex').toLowerCase();
    if (mediaServerType !== 'plex') {
        const mediaLabel = mediaServerType === 'emby' ? 'Emby' : 'Jellyfin';
        addService(mediaServerType, mediaLabel, config.jellyfinUrl, 'media', `${mediaLabel} media server`);
        if (mediaServerType === 'jellyfin') {
            const analyticsProvider = normalizeJellyfinAnalyticsProvider(config.jellyfinAnalyticsProvider, config);
            addService(
                analyticsProvider,
                analyticsProvider === 'jellyglance' ? 'JellyGlance' : 'Jellystat',
                analyticsProvider === 'jellyglance' ? config.jellyglanceUrl : config.jellystatUrl,
                'media',
                'Jellyfin analytics'
            );
        }
    } else {
        addService('plex', 'Plex', config.plexServerUrl || publicDomain, 'media', 'Plex Media Server');
        addService('tautulli', 'Tautulli', config.tautulliUrl, 'media', 'Plex analytics');
    }

    getArrInstances(config, { enabledOnly: true }).forEach((instance) => {
        if (!instance?.url) return;
        const label = instance.name || ({ radarr: 'Radarr', lidarr: 'Lidarr', bazarr: 'Bazarr', sonarr: 'Sonarr' }[instance.type] || 'Sonarr');
        const description = ({
            radarr: 'Movie automation',
            sonarr: 'TV automation',
            lidarr: 'Music automation',
            bazarr: 'Subtitle automation',
        }[instance.type] || 'Media automation');
        addService(`arr-${instance.id}`, label, instance.url, 'downloads', description);
    });
    (Array.isArray(config.downloadClients) ? config.downloadClients : []).forEach((client) => {
        if (client?.enabled === false || !client?.url) return;
        services.push({
            id: `download-${client.id}`,
            name: client.name || downloadClientLabel(client.type),
            url: client.url,
            type: 'download-client',
            clientType: client.type,
            clientId: client.id,
            groupId: 'downloads',
            description: `${downloadClientLabel(client.type)} download client`,
        });
    });
    if (config.requestAppType && config.requestAppType !== 'none') {
        addService(config.requestAppType, config.requestAppType === 'jellyseerr' ? 'Jellyseerr' : 'Seerr', config.requestAppUrl, 'external', 'Requests portal');
    }

    return { groups, services, announcement: null };
};

const syncIntegrationServicesInStatusConfig = (config = {}) => {
    const arrServices = getArrInstances(config, { enabledOnly: true })
        .filter((instance) => instance?.url)
        .map((instance) => ({
            id: `arr-${instance.id}`,
            name: instance.name || ({ radarr: 'Radarr', lidarr: 'Lidarr', bazarr: 'Bazarr', sonarr: 'Sonarr' }[instance.type] || 'Sonarr'),
            url: instance.url,
            type: 'web',
            groupId: 'downloads',
            description: ({
                radarr: 'Movie automation',
                sonarr: 'TV automation',
                lidarr: 'Music automation',
                bazarr: 'Subtitle automation',
            }[instance.type] || 'Media automation'),
        }));
    const downloadServices = (Array.isArray(config.downloadClients) ? config.downloadClients : [])
        .filter((client) => client?.enabled !== false && client?.url)
        .map((client) => ({
            id: `download-${client.id}`,
            name: client.name || downloadClientLabel(client.type),
            url: client.url,
            type: 'download-client',
            clientType: client.type,
            clientId: client.id,
            groupId: 'downloads',
            description: `${downloadClientLabel(client.type)} download client`,
        }));
    const managedServices = [...arrServices, ...downloadServices];
    const existingById = new Map((statusConfig.services || []).map((service) => [service.id, service]));
    const managedIds = new Set(managedServices.map((service) => service.id));
    const unmanaged = (statusConfig.services || []).filter((service) => {
        const id = String(service.id || '');
        return !managedIds.has(id) && !id.startsWith('arr-') && !id.startsWith('download-');
    });
    const mergedManaged = managedServices.map((service) => {
        const existing = existingById.get(service.id);
        return existing ? {
            ...existing,
            name: service.name,
            url: service.url,
            type: service.type,
            clientType: service.clientType,
            clientId: service.clientId,
            groupId: service.groupId,
            description: service.description,
        } : service;
    });
    statusConfig.services = [...unmanaged, ...mergedManaged];
};

// --- Helper Functions ---
const log = (message) => console.log(`[${new Date().toISOString()}] ${message}`);

const getDaysUntilExpiry = (expiryDate) => {
    if (!expiryDate) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const datePart = expiryDate.split('T')[0];
    const [year, month, day] = datePart.split('-').map(Number);
    const expiry = new Date(year, month - 1, day);
    expiry.setHours(0, 0, 0, 0);

    const diffTime = expiry.getTime() - today.getTime();
    return Math.round(diffTime / (1000 * 60 * 60 * 24));
};

/** Clear stale isTrial when access is unlimited or extended beyond short-term trial. */
const reconcileTrialAccessFlag = (user) => {
    if (!user?.isTrial) return false;
    const days = getDaysUntilExpiry(user.expiryDate);
    if (days === null || days > 3) {
        user.isTrial = false;
        return true;
    }
    return false;
};

const addMonths = (date, months) => {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d;
};

const addYears = (date, years) => {
    const d = new Date(date);
    d.setFullYear(d.getFullYear() + years);
    return d;
};

const addDays = (date, days) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
};

const normalized = (value) => value ? value.toString().trim().toLowerCase() : '';

// --- In-Memory Cache Utility ---
const apiCache = new Map();

/**
 * Wraps an expensive async fetcher function with a TTL cache.
 * @param {string} key Unique cache key
 * @param {number} ttlMs Time to live in milliseconds
 * @param {Function} fetcher Async function returning data to cache
 */
const withCache = async (key, ttlMs, fetcher) => {
    const now = Date.now();
    if (apiCache.has(key)) {
        const entry = apiCache.get(key);
        if (now < entry.expiresAt) {
            return entry.data;
        }
        apiCache.delete(key);
    }

    const data = await fetcher();
    if (data !== null && data !== undefined) {
        apiCache.set(key, { data, expiresAt: now + ttlMs });
    }
    return data;
};

const isDeletedUser = (deletedUsers, user) => {
    const ids = [
        normalized(user.id),
        normalized(user.plexId),
        normalized(user.jellyfinId)
    ].filter(Boolean);
    const email = normalized(user.email);
    const username = normalized(user.username);

    return deletedUsers.some(deletedUser => {
        const deletedIds = [
            normalized(deletedUser.id),
            normalized(deletedUser.plexId),
            normalized(deletedUser.jellyfinId)
        ].filter(Boolean);

        return (
            ids.some(id => deletedIds.includes(id)) ||
            (email && email === normalized(deletedUser.email)) ||
            (username && username === normalized(deletedUser.username))
        );
    });
};

const rememberDeletedUser = async (user, deletedBy) => {
    const deletedUsers = await loadFile(DELETED_USERS_PATH, []);
    if (!isDeletedUser(deletedUsers, user)) {
        deletedUsers.push({
            blockId: randomUUID(),
            id: user.id,
            plexId: user.plexId || user.id,
            jellyfinId: user.jellyfinId || null,
            username: user.username,
            email: user.email,
            deletedAt: new Date().toISOString(),
            deletedBy: deletedBy?.username || deletedBy?.email || 'admin'
        });
        await saveFile(DELETED_USERS_PATH, deletedUsers);
    }
};

const getDeletedUserKey = (deletedUser) => deletedUser.blockId || deletedUser.id || deletedUser.plexId || deletedUser.email || deletedUser.username;

const appendAuditLog = async (event, actor, target = null, details = {}) => {
    try {
        const auditLog = await loadFile(AUDIT_LOG_PATH, []);
        auditLog.unshift({
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            event,
            actor: actor ? {
                id: actor.id || actor.plexId || null,
                plexId: actor.plexId || actor.id || null,
                username: actor.username || null,
                email: actor.email || null,
                isAdmin: !!actor.isAdmin
            } : null,
            target: target ? {
                id: target.id || target.plexId || null,
                plexId: target.plexId || target.id || null,
                username: target.username || null,
                email: target.email || null
            } : null,
            details
        });
        await saveFile(AUDIT_LOG_PATH, auditLog.slice(0, 5000));
    } catch (error) {
        log(`Failed to write audit log: ${error.message}`);
    }
};

// --- Email Logging Helpers ---
const hasEmailBeenSent = async (userId, type, uniqueKey) => {
    try {
        const logs = await loadFile(EMAIL_LOG_PATH, []);
        return logs.some(l => l.userId === String(userId) && l.type === type && l.uniqueKey === String(uniqueKey));
    } catch (e) {
        return false;
    }
};

const logEmailSent = async (userId, type, uniqueKey) => {
    try {
        const logs = await loadFile(EMAIL_LOG_PATH, []);
        logs.push({
            userId: String(userId),
            type,
            uniqueKey: String(uniqueKey),
            timestamp: new Date().toISOString()
        });
        if (logs.length > 5000) logs.splice(0, logs.length - 5000);
        await saveFile(EMAIL_LOG_PATH, logs);
    } catch (e) {
        log(`Failed to write to email log: ${e.message}`);
    }
};

// --- SMTP & Email Alerts ---
const DEFAULT_ALERT_RULES = {
    expiryWarning: true,
    accessRevoked: true,
    newUserSynced: true,
    syncSuccess: false,
    syncFailure: true,
};

const normalizeAlertRules = (rules = {}) => ({
    ...DEFAULT_ALERT_RULES,
    ...(rules && typeof rules === 'object' ? rules : {}),
});

const alertRuleEnabled = (config, rule) => normalizeAlertRules(config?.alertRules)[rule] !== false;

const sendEmail = async (config, to, subject, html, customTransporter = null) => {
    if (!config.smtpHost || !config.smtpUser || !config.smtpPass) {
        log('SMTP is not fully configured. Skipping email send.');
        return false;
    }

    const transporter = customTransporter || nodemailer.createTransport({
        host: config.smtpHost,
        port: parseInt(config.smtpPort, 10) || 587,
        secure: !!config.smtpSecure,
        auth: {
            user: config.smtpUser,
            pass: config.smtpPass,
        },
    });

    const logoPath = path.join(process.cwd(), 'static', 'logo.png');
    let hasLogo = false;
    try {
        await fs.access(logoPath);
        hasLogo = true;
    } catch (e) {
        // Logo doesn't exist
    }

    const mailOptions = {
        from: config.smtpFrom || config.smtpUser,
        to,
        subject,
        html,
        attachments: hasLogo ? [{
            filename: 'logo.png',
            path: logoPath,
            cid: 'logo' // same CID value as in the HTML img src
        }] : []
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        log(`Email sent successfully: ${info.messageId}`);
        const users = await loadFile(USERS_PATH, []);
        const foundUser = users.find(u => u.email === to);
        const targetUsername = foundUser ? foundUser.username : 'Recipient';
        await appendAuditLog('system_email_sent', { username: 'System', email: config.smtpFrom || config.smtpUser }, { username: targetUsername, email: to }, { subject });
        return true;
    } catch (error) {
        log(`Error sending email to ${to}: ${error.message}`);
        throw error;
    }
};

const sendGotifyAlert = async (config, title, message, priority = undefined) => {
    if (!config.gotifyEnabled || !config.gotifyUrl || !config.gotifyToken) {
        return false;
    }
    const baseUrl = String(config.gotifyUrl || '').replace(/\/+$/, '');
    const alertPriority = Math.max(0, Math.min(10, Number(priority ?? config.gotifyPriority ?? 5) || 0));
    try {
        const response = await fetch(`${baseUrl}/message`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Gotify-Key': config.gotifyToken,
            },
            body: JSON.stringify({
                title: String(title || 'Server Manager Portal'),
                message: String(message || ''),
                priority: alertPriority,
            }),
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            throw new Error(`Gotify returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 160)}` : ''}`);
        }
        log(`Gotify alert sent: ${title}`);
        await appendAuditLog('system_gotify_alert_sent', { username: 'System', email: '' }, null, { title });
        return true;
    } catch (error) {
        log(`Error sending Gotify alert: ${error.message}`);
        throw error;
    }
};

const checkAndSendNotifications = async (config) => {
    const hasSmtp = !!(config.smtpHost && config.smtpUser && config.smtpPass);
    const hasGotify = !!(config.gotifyEnabled && config.gotifyUrl && config.gotifyToken);
    if (!hasSmtp && !hasGotify) {
        return;
    }

    log('Checking for users to notify about upcoming expiry...');
    const users = await loadFile(USERS_PATH, []);
    const daysBefore = parseInt(config.emailDaysBefore, 10) || 7;
    let usersModified = false;

    // Check if logo exists to determine if we should reference it in HTML
    const logoPath = path.join(process.cwd(), 'static', 'logo.png');
    let hasLogo = false;
    try {
        await fs.access(logoPath);
        hasLogo = true;
    } catch (e) { }

    for (const user of users) {
        if (!user.expiryDate || user.plexAccessStatus === 'revoked') {
            continue;
        }

        const days = getDaysUntilExpiry(user.expiryDate);
        if (days !== null && days <= daysBefore && days >= 0) {
            const alreadySent = await hasEmailBeenSent(user.id, 'expiry_warning', user.expiryDate);
            if (alreadySent) continue;

            log(`Sending expiry warning to ${user.username} (${user.email}) - ${days} days remaining.`);
            const subject = `[Plex Server] Your shared access expires in ${days} day${days === 1 ? '' : 's'}`;
            const html = `
                <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f6f9; padding: 30px; color: #333333; line-height: 1.6;">
                    <div style="max-width: 600px; margin: auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border-top: 6px solid #e5a00d;">
                        <div style="background-color: #282A2D; padding: 25px; text-align: center;">
                            ${hasLogo ? '<img src="cid:logo" alt="Logo" style="max-height: 100px; display: block; margin: 0 auto 10px auto;" />' : ''}
                            <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase;">PLEX SERVER</h1>
                        </div>
                        <div style="padding: 30px 40px;">
                            <h2 style="color: #282A2D; font-size: 20px; margin-top: 0; font-weight: 600;">Access Expiry Notification</h2>
                            <p>Hello <strong>${user.username}</strong>,</p>
                            <p>This is a notification that your shared access to the Plex media server is coming to an end soon. Below are your account details:</p>
                            
                            <div style="background-color: #fcf8f2; border-left: 4px solid #e5a00d; padding: 20px; margin: 25px 0; border-radius: 6px;">
                                <table style="width: 100%; border-collapse: collapse; font-size: 15px;">
                                    <tr>
                                        <td style="padding: 6px 0; color: #718096; font-weight: 500;">Plex Username:</td>
                                        <td style="padding: 6px 0; color: #2d3748; font-weight: bold; text-align: right;">${user.username}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 6px 0; color: #718096; font-weight: 500;">Expiry Date:</td>
                                        <td style="padding: 6px 0; color: #e5a00d; font-weight: bold; text-align: right;">${new Date(user.expiryDate).toLocaleDateString(undefined, { dateStyle: 'long' })}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 6px 0; color: #718096; font-weight: 500;">Time Remaining:</td>
                                        <td style="padding: 6px 0; color: #e5a00d; font-weight: bold; text-align: right;">${days} day${days === 1 ? '' : 's'}</td>
                                    </tr>
                                </table>
                            </div>

                            <p>To ensure uninterrupted streaming of your favorite movies and shows, please get in touch with the server owner to renew your access before the expiry date.</p>
                            
                            <div style="text-align: center; margin: 35px 0 15px 0;">
                                <a href="${config.contactUrl || 'mailto:' + (config.smtpFrom || config.smtpUser)}" style="background-color: #e5a00d; color: #ffffff; text-decoration: none; padding: 14px 35px; font-weight: bold; border-radius: 6px; display: inline-block; font-size: 16px; box-shadow: 0 4px 6px rgba(229, 160, 13, 0.2);">Request Extension</a>
                            </div>
                        </div>
                        <div style="background-color: #f7fafc; padding: 20px 30px; border-top: 1px solid #edf2f7; text-align: center; font-size: 12px; color: #a0aec0;">
                            <p style="margin: 0 0 5px 0;">Automated alert from the Plex Expiry Service.</p>
                            <p style="margin: 0;">Please contact the administrator for any access queries.</p>
                        </div>
                    </div>
                </div>
            `;

            try {
                const emailSent = user.email && hasSmtp ? await sendEmail(config, user.email, subject, html) : false;
                const gotifySent = hasGotify && alertRuleEnabled(config, 'expiryWarning') ? await sendGotifyAlert(
                    config,
                    'Portal access expiring',
                    `${user.username} expires in ${days} day${days === 1 ? '' : 's'} (${new Date(user.expiryDate).toLocaleDateString()}).`,
                    5,
                ) : false;
                if (emailSent || gotifySent) {
                    await logEmailSent(user.id, 'expiry_warning', user.expiryDate);
                }
            } catch (err) {
                log(`Failed to send expiry alert to ${user.username}: ${err.message}`);
            }
        }
    }
};


// --- File I/O ---
const fileLocks = new Map();

const lockFile = async (path) => {
    while (fileLocks.get(path)) {
        await fileLocks.get(path);
    }
    let resolve;
    const promise = new Promise(r => resolve = r);
    fileLocks.set(path, promise);
    return () => {
        if (fileLocks.get(path) === promise) {
            fileLocks.delete(path);
        }
        resolve();
    };
};

const loadFile = async (path, defaultContent) => {
    const unlock = await lockFile(path);
    try {
        const content = await fs.readFile(path, 'utf-8');
        const data = JSON.parse(content);
        return data === null ? defaultContent : data;
    } catch (error) {
        if (error.code === 'ENOENT') {
            await fs.writeFile(path, JSON.stringify(defaultContent, null, 2));
            return defaultContent;
        }
        throw error;
    } finally {
        unlock();
    }
};

const saveFile = async (path, data) => {
    const unlock = await lockFile(path);
    try {
        const tempPath = `${path}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(data, null, 2));
        await fs.rename(tempPath, path);
    } finally {
        unlock();
    }
};

// --- Plex API Functions (Server-side only) ---
/** Stable identity so Docker hostname (container ID) is never reported as a "new device". */
const plexClientHeaders = (token = '', extra = {}) => ({
    Accept: 'application/json',
    ...(token ? { 'X-Plex-Token': String(token) } : {}),
    'X-Plex-Client-Identifier': CLIENT_ID,
    'X-Plex-Product': 'Server Manager Portal',
    'X-Plex-Device': 'Server',
    'X-Plex-Device-Name': 'Server Manager Portal',
    'X-Plex-Platform': 'Server Manager Portal',
    'X-Plex-Platform-Version': String(appVersion || '1'),
    'X-Plex-Provides': 'controller',
    ...extra,
});

/** Global safety net: bare fetch() to PMS/plex.tv must never omit client identity. */
const _nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init = {}) => {
    const urlStr = typeof input === 'string' ? input : (input?.url || String(input || ''));
    const existing = { ...(init.headers || {}) };
    // Normalize Headers / array form into a plain object
    let headerObj = existing;
    if (typeof Headers !== 'undefined' && init.headers instanceof Headers) {
        headerObj = {};
        init.headers.forEach((v, k) => { headerObj[k] = v; });
    } else if (Array.isArray(init.headers)) {
        headerObj = Object.fromEntries(init.headers);
    }
    const lower = Object.fromEntries(Object.entries(headerObj).map(([k, v]) => [String(k).toLowerCase(), v]));
    const hasPlexId = !!(lower['x-plex-client-identifier']);
    const hasToken = !!(lower['x-plex-token'] || /[?&]X-Plex-Token=/i.test(urlStr));
    const isPlexHost = /(?:^|[/.])plex\.tv(?:[:/]|$)/i.test(urlStr) || /[?&]X-Plex-Token=/i.test(urlStr);
    if (!hasPlexId && (hasToken || isPlexHost)) {
        let token = lower['x-plex-token'] || '';
        if (!token) {
            const match = urlStr.match(/[?&]X-Plex-Token=([^&]+)/i);
            if (match) {
                try { token = decodeURIComponent(match[1]); } catch { token = match[1]; }
            }
        }
        init = { ...init, headers: { ...plexClientHeaders(token), ...headerObj } };
    }
    return _nativeFetch(input, init);
};

const apiFetch = (url, token, options = {}) => {
    const headers = {
        ...plexClientHeaders(token),
        ...(options.headers || {}),
    };
    return fetch(url, { ...options, headers });
};

const jellyfinAuthorizationHeader = (token = '') => {
    const parts = [
        'MediaBrowser Client="Server Manager Portal"',
        'Device="Web"',
        `DeviceId="${CLIENT_ID}"`,
        `Version="${appVersion}"`,
    ];
    if (token) parts.push(`Token="${token}"`);
    return parts.join(', ');
};

const jellyfinHeaders = (token = '', extra = {}) => ({
    Accept: 'application/json',
    'X-Emby-Authorization': jellyfinAuthorizationHeader(token),
    ...(token ? { 'X-Emby-Token': token } : {}),
    ...extra,
});

let cachedAdminId = null;

const syncAdminPlexIdFromConfigToken = async (config, { persist = false } = {}) => {
    if (!config?.plexToken || config.plexToken === SECRET_MASK) return config;
    try {
        const ownerRes = await apiFetch('https://plex.tv/api/v2/user', config.plexToken);
        if (!ownerRes.ok) return config;
        const ownerData = await ownerRes.json();
        const ownerId = ownerData?.id ? String(ownerData.id) : '';
        if (!ownerId) return config;
        if (String(config.adminPlexId || '') !== ownerId) {
            log(`Syncing adminPlexId -> ${ownerId} from configured Plex token (was ${config.adminPlexId || 'unset'})`);
            config.adminPlexId = ownerId;
            cachedAdminId = ownerId;
            if (persist) await saveFile(CONFIG_PATH, config);
        } else {
            cachedAdminId = ownerId;
        }
    } catch (e) {
        log(`Admin Plex ID sync skipped: ${e.message}`);
    }
    return config;
};

const getAdminId = async (config) => {
    if (config?.adminPlexId) return String(config.adminPlexId);
    if (!config || !config.plexToken || config.plexToken === SECRET_MASK) return null;
    try {
        const res = await apiFetch('https://plex.tv/api/v2/user', config.plexToken);
        if (!res.ok) return null;
        const data = await res.json();
        return data?.id ? String(data.id) : null;
    } catch (e) {
        log('Failed to fetch admin info: ' + e.message);
        return null;
    }
};

const findLocalUserForSession = (users, sessionUser) => {
    if (!sessionUser || !Array.isArray(users)) return null;
    if (sessionUser.impersonatingUserId) {
        const byId = users.find((user) => normalized(user.id) === normalized(sessionUser.impersonatingUserId));
        if (byId) return byId;
    }
    const sessionId = normalized(sessionUser.id);
    const sessionPlexId = normalized(sessionUser.plexId);
    const sessionJellyfinId = normalized(sessionUser.jellyfinId);
    const sessionEmail = normalized(sessionUser.email);
    const sessionUsername = normalized(sessionUser.username);
    return users.find((user) => {
        const userId = normalized(user.id);
        const userPlexId = normalized(user.plexId);
        const userJellyfinId = normalized(user.jellyfinId);
        const userEmail = normalized(user.email);
        const userUsername = normalized(user.username);
        return (
            (sessionPlexId && (sessionPlexId === userPlexId || sessionPlexId === userId)) ||
            (sessionJellyfinId && (sessionJellyfinId === userJellyfinId || sessionJellyfinId === userId)) ||
            (sessionId && (sessionId === userId || sessionId === userPlexId)) ||
            (sessionId && (sessionId === userJellyfinId || sessionId === `jellyfin:${userJellyfinId}`)) ||
            (sessionEmail && sessionEmail === userEmail) ||
            (sessionUsername && sessionUsername === userUsername)
        );
    }) || null;
};

/** Record portal last-login using the same identity matching as membership checks. */
const touchUserLastLogin = (users, sessionUser, at = new Date().toISOString(), extras = {}) => {
    const existingUser = findLocalUserForSession(users, sessionUser);
    if (!existingUser) return null;
    existingUser.lastLogin = at;
    if (!existingUser.plexId && sessionUser.plexId) existingUser.plexId = sessionUser.plexId;
    if (!existingUser.jellyfinId && sessionUser.jellyfinId) existingUser.jellyfinId = sessionUser.jellyfinId;
    if (extras.plexAuthToken) existingUser.plexAuthToken = String(extras.plexAuthToken);
    return existingUser;
};

/** Recover missing lastLogin values from successful portal login audit events. */
const backfillLastLoginFromAudit = async (users) => {
    if (!Array.isArray(users) || !users.length) return { users, changed: false };
    const missing = users.filter((user) => !user.lastLogin);
    if (!missing.length) return { users, changed: false };

    const auditLog = await loadFile(AUDIT_LOG_PATH, []);
    const loginEvents = auditLog.filter((entry) => entry?.event === 'user_login' && entry.actor);
    if (!loginEvents.length) return { users, changed: false };

    let changed = false;
    for (const user of missing) {
        const match = loginEvents.find((entry) => findLocalUserForSession([user], entry.actor));
        if (!match?.timestamp) continue;
        user.lastLogin = match.timestamp;
        if (!user.plexId && match.actor?.plexId) user.plexId = match.actor.plexId;
        changed = true;
    }
    return { users, changed };
};

const getSessionActor = (sessionUser) => (
    sessionUser?.actor && sessionUser?.impersonatingUserId ? sessionUser.actor : sessionUser
);

const isImpersonatingSession = (sessionUser) => (
    !!(sessionUser?.actor && sessionUser?.impersonatingUserId)
);

const effectiveViewerIsAdmin = (sessionUser, isRealAdmin) => (
    !!isRealAdmin && !isImpersonatingSession(sessionUser)
);

const shouldObfuscateAnalyticsViewers = (sessionUser, config) => {
    const showUsernames = !!config?.showUsernamesInAnalytics;
    return !sessionUser?.isAdmin && !showUsernames;
};

const obfuscateAnalyticsTopUser = (user, index, shouldObfuscate) => {
    if (!shouldObfuscate) {
        return user;
    }
    return {
        ...user,
        id: `viewer-${index + 1}`,
        username: `Viewer ${index + 1}`,
        thumb: null,
    };
};

const blockIfImpersonating = (req, res) => {
    if (isImpersonatingSession(req.user)) {
        res.status(403).json({ error: 'This action is disabled while viewing as another user.' });
        return true;
    }
    return false;
};

const buildImpersonationSessionUser = (actor, targetUser, config = {}) => {
    const mediaServerType = String(config?.mediaServerType || '').toLowerCase();
    const isEmbyLike = mediaServerType === 'jellyfin' || mediaServerType === 'emby';
    return {
        id: targetUser.id,
        plexId: targetUser.plexId || targetUser.id,
        jellyfinId: targetUser.jellyfinId || null,
        email: targetUser.email || '',
        username: targetUser.username,
        thumb: targetUser.thumb || null,
        authProvider: isEmbyLike ? 'jellyfin' : actor.authProvider,
        isAdmin: false,
        actor: {
            id: actor.id,
            plexId: actor.plexId || null,
            jellyfinId: actor.jellyfinId || null,
            authProvider: actor.authProvider,
            username: actor.username,
            email: actor.email || '',
            thumb: actor.thumb || null,
            jellyfinIsAdmin: actor.jellyfinIsAdmin,
            isAdmin: true,
        },
        impersonatingUserId: targetUser.id,
    };
};

const buildAdminSessionFromActor = (actor) => ({
    id: actor.id,
    plexId: actor.plexId || null,
    jellyfinId: actor.jellyfinId || null,
    authProvider: actor.authProvider,
    username: actor.username,
    email: actor.email || '',
    thumb: actor.thumb || null,
    jellyfinIsAdmin: actor.jellyfinIsAdmin,
    isAdmin: true,
});

const resolveCurrentAdmin = async (sessionUser, config = null) => {
    const loadedConfig = config || await loadFile(CONFIG_PATH, {});
    const mediaServerType = String(loadedConfig?.mediaServerType || '').toLowerCase();
    if (mediaServerType === 'jellyfin' || mediaServerType === 'emby') {
        if (sessionUser?.authProvider !== 'jellyfin' || !sessionUser?.jellyfinId) return false;
        if (loadedConfig?.jellyfinUrl && loadedConfig?.jellyfinApiKey) {
            try {
                const baseUrl = resolveIntegrationUrlForFetch(loadedConfig.jellyfinUrl);
                const userRes = await fetch(`${baseUrl}/Users/${encodeURIComponent(sessionUser.jellyfinId)}`, {
                    headers: jellyfinHeaders(loadedConfig.jellyfinApiKey),
                });
                if (userRes.ok) {
                    const jellyfinUser = await userRes.json();
                    return jellyfinUser?.Policy?.IsAdministrator === true;
                }
                // Fail closed when Jellyfin responds but user lookup fails — do not trust JWT claims.
                log(`Jellyfin admin policy check HTTP ${userRes.status} for ${sessionUser.username || sessionUser.jellyfinId}`);
                return false;
            } catch (e) {
                log(`${mediaServerType === 'emby' ? 'Emby' : 'Jellyfin'} admin policy check failed for ${sessionUser.username || sessionUser.jellyfinId}: ${e.message}`);
                // Fail closed when Jellyfin is unreachable — do not elevate from cookie flags.
                return false;
            }
        }
        return false;
    }
    if (!sessionUser?.plexId) return false;
    const adminId = await getAdminId(loadedConfig);
    return !!(adminId && String(sessionUser.plexId) === String(adminId));
};

const isPlexConfigured = (config = {}) => !!(config && config.plexToken && config.serverIdentifier);
const isEmbyLikeMediaServer = (config = {}) => ['jellyfin', 'emby'].includes(String(config?.mediaServerType || '').toLowerCase());
const isJellyfinConfigured = (config = {}) => (
    isEmbyLikeMediaServer(config)
    && !!(config?.jellyfinUrl && config?.jellyfinApiKey)
);
const isPortalConfigured = (config = {}) => isPlexConfigured(config) || isJellyfinConfigured(config);
const isPublicStatusVisible = (config = {}) => config.showPublicStatusMonitor !== false;
const arePublicLibraryStatsVisible = (config = {}) => config.showPublicLibraryStats !== false;
const normalizePwaIconSource = (value, fallback = 'server') => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'application' || normalized === 'server' ? normalized : fallback;
};
const isJellyfinBrandingAssetPath = (value = '') => (
    ['/api/jellyfin/branding/icon', '/api/jellyfin/branding/splash'].includes(String(value || '').trim())
);
const normalizeBrandingAssetForMediaServer = (value = '', mediaServerType = 'plex') => {
    const normalizedType = String(mediaServerType || 'plex').toLowerCase();
    return normalizedType === 'emby' && isJellyfinBrandingAssetPath(value) ? '' : (value || '');
};

const requireAuth = (req, res, next) => {
    const token = req.cookies.session;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Invalid session' });
    }
};

const requireMember = async (req, res, next) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const actor = getSessionActor(req.user);
        const isRealAdmin = await resolveCurrentAdmin(actor, config);
        req.user.isAdmin = effectiveViewerIsAdmin(req.user, isRealAdmin);
        if (isRealAdmin && !isImpersonatingSession(req.user)) return next();

        const users = await loadFile(USERS_PATH, []);
        const localUser = findLocalUserForSession(users, req.user);
        const deletedUsers = await loadFile(DELETED_USERS_PATH, []);
        if (!localUser || isDeletedUser(deletedUsers, req.user)) {
            await appendAuditLog('session_blocked_non_member', req.user, req.user);
            clearSessionCookie(req, res);
            return res.status(403).json({ error: 'Your account does not have active portal access.' });
        }
        req.localUser = localUser;
        next();
    } catch (e) {
        res.status(500).json({ error: 'Membership verification failed' });
    }
};

const requireAdmin = async (req, res, next) => {
    const token = req.cookies.session;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
    } catch (e) {
        return res.status(401).json({ error: 'Invalid session' });
    }

    if (isImpersonatingSession(req.user)) {
        return res.status(403).json({ error: 'Admin actions are disabled while viewing as another user. Stop impersonation first.' });
    }

    const config = await loadFile(CONFIG_PATH, {});
    if (!isPortalConfigured(config)) {
        return res.status(403).json({ error: 'Forbidden: App not configured' });
    }

    const actor = getSessionActor(req.user);
    const isAdmin = await resolveCurrentAdmin(actor, config);
    if (!isAdmin) {
        return res.status(403).json({ error: 'Forbidden: Admins only' });
    }
    req.user.isAdmin = true;
    next();
};

const syncUsers = async (config) => {
    log('Starting user sync from Plex...');
    let res;
    try {
        res = await apiFetch(
            `${PLEX_API}/users`,
            config.plexToken
        );
    } catch (error) {
        const reason = error?.cause?.message || error?.cause?.code || error?.message || 'network error';
        throw new Error(`request to ${PLEX_API}/users failed, reason: ${reason}`);
    }

    if (!res.ok) {
        const errorText = await res.text();
        log(`Error fetching Plex shared users. Status: ${res.status}. Response: ${errorText}`);
        throw new Error(`Failed to fetch Plex shared users. Status: ${res.status}`);
    }

    const xmlText = await res.text();
    // Use regex to find all <User>...</User> blocks, then filter by server identifier
    const userBlocks = xmlText.match(/<User\b[^>]*>.*?<\/User>/gs) || [];

    const plexUsers = userBlocks
        .filter(block => block.includes(`machineIdentifier="${config.serverIdentifier}"`))
        .map(block => {
            const userTagMatch = block.match(/<User\b[^>]*>/);
            if (!userTagMatch) return null;
            const userTag = userTagMatch[0];
            return {
                id: userTag.match(/id="([^"]+)"/)?.[1],
                username: userTag.match(/title="([^"]+)"/)?.[1],
                email: userTag.match(/email="([^"]+)"/)?.[1],
                thumb: userTag.match(/thumb="([^"]+)"/)?.[1],
            };
        }).filter(user => user && user.id && user.username);


    const localUsers = await loadFile(USERS_PATH, []);
    const deletedUsers = await loadFile(DELETED_USERS_PATH, []);
    const existingUserMap = new Map(localUsers.map(u => [String(u.id), u]));
    const plexIdUserMap = new Map(localUsers.filter(u => u.plexId).map(u => [String(u.plexId), u]));
    const emailUserMap = new Map(localUsers.filter(u => u.email).map(u => [u.email.toLowerCase(), u]));
    const usernameUserMap = new Map(localUsers.filter(u => u.username).map(u => [u.username.toLowerCase(), u]));
    const matchedLocalUserIds = new Set();

    let newUserCount = 0;
    const syncedUsers = plexUsers.map(pUser => {
        if (isDeletedUser(deletedUsers, pUser)) {
            log(`Skipping deleted user during sync: ${pUser.username}`);
            return null;
        }

        const existingUser =
            existingUserMap.get(String(pUser.id)) ||
            plexIdUserMap.get(String(pUser.id)) ||
            (pUser.email ? emailUserMap.get(pUser.email.toLowerCase()) : null) ||
            (pUser.username ? usernameUserMap.get(pUser.username.toLowerCase()) : null);

        if (existingUser) {
            matchedLocalUserIds.add(existingUser.id);
            if (existingUser.plexAccessStatus === 'pending') {
                appendAuditLog('invite_accepted_synced', null, { ...existingUser, id: pUser.id, username: pUser.username, email: pUser.email }).catch(() => { });
            }
            // Update existing user with latest info from Plex, but keep local expiry/trial data.
            return {
                ...existingUser,
                id: pUser.id,
                plexId: existingUser.plexId || pUser.id,
                username: pUser.username,
                email: pUser.email,
                thumb: pUser.thumb,
                plexAccessStatus: 'active',
            };
        }
        log(`New user found: ${pUser.username}. Setting default unlimited expiry.`);
        newUserCount++;
        appendAuditLog('plex_sync_new_user_added', null, pUser).catch(() => { });
        return {
            id: pUser.id,
            plexId: pUser.id,
            username: pUser.username,
            email: pUser.email,
            thumb: pUser.thumb,
            joiningDate: new Date().toISOString(),
            expiryDate: null,
            plexAccessStatus: 'active',
            isTrial: false
        };
    }).filter(Boolean);

    for (const localUser of localUsers) {
        if (!matchedLocalUserIds.has(localUser.id)) {
            if (localUser.plexAccessStatus !== 'pending') {
                // If they are no longer on Plex (e.g., they expired and were removed, or manually removed from Plex), 
                // keep them in the app but mark their access as revoked so they stay visible until manually deleted.
                localUser.plexAccessStatus = 'revoked';
            }
            syncedUsers.push(localUser);
        }
    }

    await saveFile(USERS_PATH, syncedUsers);
    const message = `Sync complete. Synced ${plexUsers.length} users.`;
    log(message);
    return { message, count: plexUsers.length, newUserCount };
};

const syncJellyfinUsers = async (config) => {
    const mediaServerType = String(config?.mediaServerType || 'jellyfin').toLowerCase();
    const providerLabel = mediaServerType === 'emby' ? 'Emby' : 'Jellyfin';
    log(`Starting user sync from ${providerLabel}...`);
    if (!isJellyfinConfigured(config)) {
        throw new Error(`${providerLabel} is not configured.`);
    }

    const baseUrl = resolveIntegrationUrlForFetch(config.jellyfinUrl);
    const response = await fetchWithTimeout(`${baseUrl}/Users`, {
        headers: jellyfinHeaders(config.jellyfinApiKey),
    }, 15000);
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        log(`Error fetching ${providerLabel} users. Status: ${response.status}. Response: ${detail}`);
        throw new Error(`Failed to fetch ${providerLabel} users. Status: ${response.status}`);
    }

    const jellyfinUsers = (await response.json())
        .filter((user) => user?.Id && user?.Name)
        .map((user) => ({
            id: `jellyfin:${user.Id}`,
            jellyfinId: user.Id,
            username: user.Name,
            email: '',
            thumb: user.PrimaryImageTag ? withBasePath(`/api/jellyfin/user-image?userId=${encodeURIComponent(user.Id)}`) : null,
            isDisabled: user.Policy?.IsDisabled === true,
            isAdmin: user.Policy?.IsAdministrator === true,
        }));

    const localUsers = await loadFile(USERS_PATH, []);
    const deletedUsers = await loadFile(DELETED_USERS_PATH, []);
    const existingUserMap = new Map(localUsers.map((user) => [String(user.id), user]));
    const jellyfinIdUserMap = new Map(localUsers.filter((user) => user.jellyfinId).map((user) => [String(user.jellyfinId), user]));
    const usernameUserMap = new Map(localUsers.filter((user) => user.username).map((user) => [user.username.toLowerCase(), user]));
    const matchedLocalUserIds = new Set();

    let newUserCount = 0;
    const syncedUsers = jellyfinUsers.map((jUser) => {
        const deletedLookup = { id: jUser.id, jellyfinId: jUser.jellyfinId, username: jUser.username, email: jUser.email };
        if (isDeletedUser(deletedUsers, deletedLookup)) {
            log(`Skipping deleted ${providerLabel} user during sync: ${jUser.username}`);
            return null;
        }

        const existingUser =
            existingUserMap.get(String(jUser.id)) ||
            jellyfinIdUserMap.get(String(jUser.jellyfinId)) ||
            usernameUserMap.get(jUser.username.toLowerCase());

        const accessStatus = jUser.isDisabled ? 'revoked' : 'active';
        if (existingUser) {
            matchedLocalUserIds.add(existingUser.id);
            return {
                ...existingUser,
                id: jUser.id,
                jellyfinId: jUser.jellyfinId,
                username: jUser.username,
                email: existingUser.email || '',
                thumb: jUser.thumb,
                authProvider: 'jellyfin',
                plexAccessStatus: accessStatus,
            };
        }

        log(`New ${providerLabel} user found: ${jUser.username}. Setting default 1-day expiry.`);
        newUserCount++;
        appendAuditLog('jellyfin_sync_new_user_added', null, jUser).catch(() => { });
        return {
            id: jUser.id,
            jellyfinId: jUser.jellyfinId,
            authProvider: 'jellyfin',
            username: jUser.username,
            email: '',
            thumb: jUser.thumb,
            joiningDate: new Date().toISOString(),
            expiryDate: jUser.isAdmin ? null : addDays(new Date(), 1).toISOString(),
            plexAccessStatus: accessStatus,
            isTrial: false,
        };
    }).filter(Boolean);

    for (const localUser of localUsers) {
        const belongsToJellyfin = localUser.authProvider === 'jellyfin' || localUser.jellyfinId || String(localUser.id || '').startsWith('jellyfin:');
        if (!belongsToJellyfin) {
            syncedUsers.push(localUser);
            continue;
        }
        if (!matchedLocalUserIds.has(localUser.id)) {
            if (localUser.plexAccessStatus !== 'pending') {
                localUser.plexAccessStatus = 'revoked';
            }
            syncedUsers.push(localUser);
        }
    }

    await saveFile(USERS_PATH, syncedUsers);
    const message = `Sync complete. Synced ${jellyfinUsers.length} ${providerLabel} users.`;
    log(message);
    return { message, count: jellyfinUsers.length, newUserCount };
};

const revokePlexAccess = async (user, config) => {
    // The Plex friends list keys users by their Plex account id, which is stored
    // in plexId. Invite/referral users keep a portal UUID in `id`, so always
    // prefer plexId when matching against the Plex API.
    const plexUserId = user.plexId || user.id;
    if (!plexUserId || !config.serverIdentifier) {
        log(`Error: Cannot revoke access for ${user.username} due to missing user ID or server ID.`);
        return false;
    }
    log(`Revoking Plex access for expired user: ${user.username} (ID: ${plexUserId})`);

    try {
        // Step 1: Find the Share ID for the user on the specific server by fetching ALL users
        const usersListRes = await apiFetch(
            `${PLEX_API}/users`,
            config.plexToken
        );

        if (!usersListRes.ok) {
            const errorText = await usersListRes.text();
            log(`Error fetching Plex users list for revocation. Status: ${usersListRes.status}. Response: ${errorText}`);
            return false;
        }

        const xmlText = await usersListRes.text();

        const userBlockRegex = new RegExp(`<User\\b[^>]*id="${plexUserId}"[^>]*>.*?<\\/User>`, 's');
        const userBlockMatch = xmlText.match(userBlockRegex);

        if (!userBlockMatch) {
            log(`User ${user.username} not found in friends list. Assuming already revoked.`);
            return true;
        }

        const serverTagRegex = new RegExp(`<Server\\b[^>]*machineIdentifier="${config.serverIdentifier}"[^>]*>`);
        const serverTagMatch = userBlockMatch[0].match(serverTagRegex);

        if (!serverTagMatch) {
            log(`--- DIAGNOSTIC: User XML Block for ${user.username} ---`);
            log(userBlockMatch[0]);
            log(`--- END DIAGNOSTIC ---`);
            log(`User ${user.username} does not have access to server ${config.serverIdentifier}. Assuming already revoked.`);
            return true;
        }

        const shareIdMatch = serverTagMatch[0].match(/id="([^"]+)"/);
        if (!shareIdMatch || !shareIdMatch[1]) {
            log(`Could not find share ID for user ${user.username} on server ${config.serverIdentifier}.`);
            return false;
        }
        const shareId = shareIdMatch[1];
        log(`Found share ID for ${user.username}: ${shareId}`);

        // Step 2: Delete the share entirely using a DELETE request
        const res = await apiFetch(
            `https://plex.tv/api/servers/${config.serverIdentifier}/shared_servers/${shareId}`,
            config.plexToken,
            {
                method: 'DELETE'
            }
        );

        if (!res.ok) {
            const errorText = await res.text();
            log(`Error: Failed to revoke access for ${user.username}. Status: ${res.status}. Response: ${errorText}`);
            return false;
        }

        log(`Successfully revoked access for ${user.username}.`);
        return true;

    } catch (error) {
        log(`An exception occurred while revoking access for ${user.username}: ${error.message}`);
        return false;
    }
};

const inviteUserToPlex = async (user, config, libraryIds = null) => {
    if (!user.email || !config.serverIdentifier) {
        log(`Error: Cannot invite ${user.username} due to missing email or server ID.`);
        return false;
    }
    log(`Inviting user to Plex: ${user.username} (${user.email})`);
    try {
        const sharedServer = { invited_email: user.email };
        if (libraryIds && Array.isArray(libraryIds) && libraryIds.length > 0) {
            sharedServer.library_section_ids = libraryIds;
        }

        const inviteRes = await apiFetch(`https://plex.tv/api/servers/${config.serverIdentifier}/shared_servers`, config.plexToken, {
            method: 'POST',
            body: JSON.stringify({
                server_id: config.serverIdentifier,
                shared_server: sharedServer
            }),
            headers: { 'Content-Type': 'application/json' }
        });

        if (!inviteRes.ok) {
            const errText = await inviteRes.text();
            log(`Note: Plex API returned an error during invite (${inviteRes.status}): ${errText}`);
            return false;
        }
        return true;
    } catch (error) {
        log(`An exception occurred while inviting user ${user.username}: ${error.message}`);
        return false;
    }
};


const sendExpiryEmail = async (config, user, hasLogo) => {
    if (!user.email) {
        log(`No email address for ${user.username}. Skipping expiry notification.`);
        return false;
    }

    const alreadySent = await hasEmailBeenSent(user.id, 'access_expired', user.expiryDate || 'none');
    if (alreadySent) return true;

    const subject = `[Plex Server] Your shared access has expired`;
    const html = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f6f9; padding: 30px; color: #333333; line-height: 1.6;">
            <div style="max-width: 600px; margin: auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border-top: 6px solid #e53e3e;">
                <div style="background-color: #282A2D; padding: 25px; text-align: center;">
                    ${hasLogo ? '<img src="cid:logo" alt="Logo" style="max-height: 100px; display: block; margin: 0 auto 10px auto;" />' : ''}
                    <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase;">PLEX SERVER</h1>
                </div>
                <div style="padding: 30px 40px;">
                    <h2 style="color: #e53e3e; font-size: 20px; margin-top: 0; font-weight: 600;">Access Expired</h2>
                    <p>Hello <strong>${user.username}</strong>,</p>
                    <p>We're writing to let you know that your shared access to the Plex media server has <strong style="color: #e53e3e;">expired</strong> and your account has been removed from the server.</p>
                    
                    <div style="background-color: #fff5f5; border-left: 4px solid #e53e3e; padding: 20px; margin: 25px 0; border-radius: 6px;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 15px;">
                            <tr>
                                <td style="padding: 6px 0; color: #718096; font-weight: 500;">Plex Username:</td>
                                <td style="padding: 6px 0; color: #2d3748; font-weight: bold; text-align: right;">${user.username}</td>
                            </tr>
                            <tr>
                                <td style="padding: 6px 0; color: #718096; font-weight: 500;">Expiry Date:</td>
                                <td style="padding: 6px 0; color: #e53e3e; font-weight: bold; text-align: right;">${new Date(user.expiryDate).toLocaleDateString(undefined, { dateStyle: 'long' })}</td>
                            </tr>
                            <tr>
                                <td style="padding: 6px 0; color: #718096; font-weight: 500;">Status:</td>
                                <td style="padding: 6px 0; color: #e53e3e; font-weight: bold; text-align: right;">Access Revoked</td>
                            </tr>
                        </table>
                    </div>

                    ${config.contactEmail || config.contactWhatsApp ? `
                    <p style="font-size: 16px; font-weight: 600; color: #282A2D; margin-bottom: 5px;">Want to renew your access?</p>
                    <p>If you'd like to continue enjoying all the content, simply get in touch using any of the methods below and we'll get you set up again:</p>

                    <div style="background-color: #fcf8f2; border-radius: 8px; padding: 20px; margin: 20px 0;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 15px;">
                            ${config.contactEmail ? `<tr>
                                <td style="padding: 10px 0; vertical-align: middle;">
                                    <span style="font-size: 20px; margin-right: 10px;">📧</span>
                                    <strong style="color: #2d3748;">Email:</strong>
                                </td>
                                <td style="padding: 10px 0; text-align: right; vertical-align: middle;">
                                    <a href="mailto:${escapeHtmlAttr(config.contactEmail)}" style="color: #e5a00d; text-decoration: none; font-weight: 600;">${escapeHtmlAttr(config.contactEmail)}</a>
                                </td>
                            </tr>` : ''}
                            ${config.contactWhatsApp ? `<tr>
                                <td style="padding: 10px 0; vertical-align: middle; border-top: 1px solid #edf2f7;">
                                    <span style="font-size: 20px; margin-right: 10px;">💬</span>
                                    <strong style="color: #2d3748;">WhatsApp:</strong>
                                </td>
                                <td style="padding: 10px 0; text-align: right; vertical-align: middle; border-top: 1px solid #edf2f7;">
                                    <a href="https://wa.me/${escapeHtmlAttr(String(config.contactWhatsApp).replace(/\D/g, ''))}" style="color: #25d366; text-decoration: none; font-weight: 600;">${escapeHtmlAttr(config.contactWhatsApp)}</a>
                                </td>
                            </tr>` : ''}
                        </table>
                    </div>

                    <div style="text-align: center; margin: 30px 0 15px 0;">
                        ${config.contactWhatsApp ? `<a href="https://wa.me/${escapeHtmlAttr(String(config.contactWhatsApp).replace(/\D/g, ''))}" style="background-color: #25d366; color: #ffffff; text-decoration: none; padding: 14px 35px; font-weight: bold; border-radius: 6px; display: inline-block; font-size: 16px; box-shadow: 0 4px 6px rgba(37, 211, 102, 0.2); margin-right: 10px;">WhatsApp Me</a>` : ''}
                        ${config.contactEmail ? `<a href="mailto:${escapeHtmlAttr(config.contactEmail)}" style="background-color: #e5a00d; color: #ffffff; text-decoration: none; padding: 14px 35px; font-weight: bold; border-radius: 6px; display: inline-block; font-size: 16px; box-shadow: 0 4px 6px rgba(229, 160, 13, 0.2);">Email Me</a>` : ''}
                    </div>` : ''}
                </div>
                <div style="background-color: #f7fafc; padding: 20px 30px; border-top: 1px solid #edf2f7; text-align: center; font-size: 12px; color: #a0aec0;">
                    <p style="margin: 0 0 5px 0;">Automated notification from the Plex Expiry Service.</p>
                    <p style="margin: 0;">We'd love to have you back — don't hesitate to reach out!</p>
                </div>
            </div>
        </div>
    `;

    try {
        const sent = await sendEmail(config, user.email, subject, html);
        if (sent) {
            log(`Expiry notification email sent to ${user.username} (${user.email}).`);
            await logEmailSent(user.id, 'access_expired', user.expiryDate || 'none');
        }
        return sent;
    } catch (err) {
        log(`Failed to send expiry notification to ${user.username}: ${err.message}`);
        return false;
    }
};

const sendAdjustmentEmail = async (config, user, hasLogo) => {
    if (!user.email) return false;

    const subject = `[Plex Server] Your access has been updated`;
    const days = getDaysUntilExpiry(user.expiryDate);
    const html = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f6f9; padding: 30px; color: #333333; line-height: 1.6;">
            <div style="max-width: 600px; margin: auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border-top: 6px solid #e5a00d;">
                <div style="background-color: #282A2D; padding: 25px; text-align: center;">
                    ${hasLogo ? '<img src="cid:logo" alt="Logo" style="max-height: 100px; display: block; margin: 0 auto 10px auto;" />' : ''}
                    <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase;">PLEX SERVER</h1>
                </div>
                <div style="padding: 30px 40px;">
                    <h2 style="color: #282A2D; font-size: 20px; margin-top: 0; font-weight: 600;">Access Updated</h2>
                    <p>Hello <strong>${user.username}</strong>,</p>
                    <p>Your access to the Plex media server has been successfully updated. Here are your new account details:</p>
                    
                    <div style="background-color: #fcf8f2; border-left: 4px solid #e5a00d; padding: 20px; margin: 25px 0; border-radius: 6px;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 15px;">
                            <tr>
                                <td style="padding: 6px 0; color: #718096; font-weight: 500;">Plex Username:</td>
                                <td style="padding: 6px 0; color: #2d3748; font-weight: bold; text-align: right;">${user.username}</td>
                            </tr>
                            <tr>
                                <td style="padding: 6px 0; color: #718096; font-weight: 500;">New Expiry Date:</td>
                                <td style="padding: 6px 0; color: #e5a00d; font-weight: bold; text-align: right;">${user.expiryDate ? new Date(user.expiryDate).toLocaleDateString(undefined, { dateStyle: 'long' }) : 'Unlimited'}</td>
                            </tr>
                            ${days !== null ? `
                            <tr>
                                <td style="padding: 6px 0; color: #718096; font-weight: 500;">Time Remaining:</td>
                                <td style="padding: 6px 0; color: #e5a00d; font-weight: bold; text-align: right;">${days} day${days === 1 ? '' : 's'}</td>
                            </tr>` : ''}
                        </table>
                    </div>

                    <p>Thank you for continuing to be a part of our community!</p>
                </div>
                <div style="background-color: #f7fafc; padding: 20px 30px; border-top: 1px solid #edf2f7; text-align: center; font-size: 12px; color: #a0aec0;">
                    <p style="margin: 0 0 5px 0;">Automated notification from the Plex Expiry Service.</p>
                </div>
            </div>
        </div>
    `;


    try {
        const sent = await sendEmail(config, user.email, subject, html);
        if (sent) {
            log(`Expiry notification email sent to ${user.username} (${user.email}).`);
        }
        return sent;
    } catch (err) {
        log(`Failed to send expiry notification to ${user.username}: ${err.message}`);
        return false;
    }
};

const checkAndRevoke = async (config) => {
    log('Running periodic check for expired users...');
    const users = await loadFile(USERS_PATH, []);
    const expiredUsers = users.filter(u => {
        const days = getDaysUntilExpiry(u.expiryDate);
        return u.plexAccessStatus !== 'revoked' && days !== null && days < 0;
    });

    if (expiredUsers.length === 0) {
        log('No expired users found.');
        return;
    }

    // Check if logo exists for email template
    const logoPath = path.join(process.cwd(), 'static', 'logo.png');
    let hasLogo = false;
    try {
        await fs.access(logoPath);
        hasLogo = true;
    } catch (e) { }

    log(`Found ${expiredUsers.length} expired user(s).`);
    let usersModified = false;
    for (const user of expiredUsers) {
        const revoked = await revokePlexAccess(user, config);
        if (revoked) {
            const userInList = users.find(u => u.id === user.id);
            if (userInList) {
                userInList.plexAccessStatus = 'revoked';
                usersModified = true;
                if (alertRuleEnabled(config, 'accessRevoked')) await sendGotifyAlert(
                    config,
                    'Portal access revoked',
                    `${userInList.username || user.username} was revoked after expiry.`,
                    8,
                ).catch((e) => log(`Failed to send Gotify revocation alert: ${e.message}`));

                // Send expiry notification email if not already sent
                if (!userInList.expiryEmailSent) {
                    const emailSent = await sendExpiryEmail(config, userInList, hasLogo);
                    if (emailSent) {
                        userInList.expiryEmailSent = true;
                    }
                }
            }
        }
    }

    if (usersModified) {
        await saveFile(USERS_PATH, users);
        log('Updated local user file with revocation status.');
    }
};

// --- Security: Sanitise admin-authored HTML before broadcast email delivery ---
// Strips dangerous scripting/injection vectors while preserving safe formatting tags.
const sanitizeBroadcastHtml = (html) => {
    if (!html || typeof html !== 'string') return '';
    return html
        .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
        .replace(/<iframe\b[\s\S]*?<\/iframe\s*>/gi, '')
        .replace(/<object\b[\s\S]*?<\/object\s*>/gi, '')
        .replace(/<embed\b[^>]*>/gi, '')
        .replace(/<form\b[\s\S]*?<\/form\s*>/gi, '')
        .replace(/<(input|textarea|button|select)\b[^>]*>/gi, '')
        .replace(/<link\b[^>]*>/gi, '')
        .replace(/<meta\b[^>]*>/gi, '')
        .replace(/<base\b[^>]*>/gi, '')
        .replace(/<(svg|math)\b[\s\S]*?<\/\1\s*>/gi, '')
        .replace(/<(svg|math)\b[^>]*\/?>/gi, '')
        // Event handlers including compact forms like <svg/onload=...>
        .replace(/\bon\w+\s*=/gi, ' data-removed=')
        .replace(/(href|src|xlink:href|action|formaction)\s*=\s*(["']?)\s*(javascript|vbscript|data)\s*:/gi, ' $1=$2#');
};

// --- API Routes ---

app.post('/api/users/broadcast', requireAdmin, async (req, res) => {
    const { subject, body, recipientFilter, selectedUserIds } = req.body;
    if (!subject || !body) return res.status(400).json({ error: 'Subject and body are required.' });

    try {
        const users = await loadFile(USERS_PATH, []);
        let targetUsers = [];
        const now = new Date();

        for (const user of users) {
            let include = false;
            if (recipientFilter === 'all') {
                include = true;
            } else if (recipientFilter === 'selected') {
                include = selectedUserIds && selectedUserIds.includes(user.id);
            } else if (recipientFilter === 'active') {
                include = user.plexAccessStatus === 'active';
            } else if (recipientFilter === 'trial') {
                include = user.isTrial;
            } else if (recipientFilter === 'expiring') {
                if (user.expiryDate && new Date(user.expiryDate) > now) {
                    const diffTime = Math.abs(new Date(user.expiryDate) - now);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    include = diffDays <= 7;
                }
            } else if (recipientFilter === 'expired') {
                include = user.expiryDate && new Date(user.expiryDate) < now;
            }

            if (include && user.email) {
                targetUsers.push(user);
            }
        }

        if (targetUsers.length === 0) {
            return res.status(400).json({ error: 'No users found matching the selected criteria (with valid emails).' });
        }

        res.json({ message: `Broadcast started for ${targetUsers.length} users.`, count: targetUsers.length });

        (async () => {
            const config = await loadFile(CONFIG_PATH, null);

            // Create a single pooled connection to avoid rate limits
            const bulkTransporter = nodemailer.createTransport({
                pool: true,
                host: config.smtpHost,
                port: parseInt(config.smtpPort, 10) || 587,
                secure: !!config.smtpSecure,
                auth: {
                    user: config.smtpUser,
                    pass: config.smtpPass,
                },
                maxConnections: 1,
                maxMessages: 100
            });

            for (const user of targetUsers) {
                try {
                    await sendEmail(config, user.email, subject, sanitizeBroadcastHtml(body), bulkTransporter);
                    // Add a tiny throttle so it doesn't look like a burst attack
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } catch (e) {
                    log(`Broadcast failed to ${user.email}: ${e.message}`);
                }
            }
            log(`Broadcast completed for ${targetUsers.length} users.`);
            bulkTransporter.close(); // Clean up the connection pool
        })();
    } catch (error) {
        log(`Error sending broadcast: ${error.message}`);
        res.status(500).json({ error: 'Failed to initiate broadcast' });
    }
});

app.post('/api/users/broadcast/test', requireAdmin, async (req, res) => {
    const { subject, body } = req.body;
    if (!subject || !body) return res.status(400).json({ error: 'Subject and body are required.' });

    try {
        const config = await loadFile(CONFIG_PATH, null);
        if (!config || !config.smtpHost || !config.smtpUser) {
            return res.status(400).json({ error: 'SMTP settings are not configured.' });
        }
        const adminEmail = req.user.email;

        if (!adminEmail) {
            return res.status(400).json({ error: 'Admin email not found in session.' });
        }

        log(`Sending test broadcast email to ${adminEmail}...`);
        await sendEmail(config, adminEmail, subject, sanitizeBroadcastHtml(body));
        res.json({ message: `Test email sent successfully to ${adminEmail}` });
    } catch (error) {
        log(`Error sending test broadcast: ${error.message}`);
        res.status(500).json({ error: `Failed to send test broadcast: ${error.message}` });
    }
});

// Auth endpoints
app.post('/api/auth/plex/login', authRateLimit, async (req, res) => {
    try {
        const response = await fetch('https://plex.tv/api/v2/pins?strong=true', {
            method: 'POST',
            headers: plexClientHeaders('', {
                'X-Plex-Product': 'Server Manager Portal',
            }),
        });
        if (!response.ok) throw new Error('Failed to generate Plex PIN');
        const data = await response.json();
        res.json({ ...data, clientIdentifier: CLIENT_ID });
    } catch (err) {
        log('Error in plex login: ' + err.message);
        res.status(500).json({ error: 'Failed to initiate login' });
    }
});

const jellyfinQuickConnectSessions = new Map();

const pruneJellyfinQuickConnectSessions = () => {
    const now = Date.now();
    jellyfinQuickConnectSessions.forEach((session, id) => {
        if (!session?.expiresAt || session.expiresAt <= now) {
            jellyfinQuickConnectSessions.delete(id);
        }
    });
};

const completeJellyfinPortalLogin = async (req, res, config, authData, source = 'password') => {
    const jellyfinUser = authData?.User || authData?.user || {};
    const accessToken = authData?.AccessToken || authData?.accessToken || '';
    const userId = jellyfinUser.Id || jellyfinUser.Id || jellyfinUser.id || '';
    const username = jellyfinUser.Name || jellyfinUser.name || 'Jellyfin User';
    const isAdmin = jellyfinUser?.Policy?.IsAdministrator === true || jellyfinUser?.policy?.isAdministrator === true;
    const sessionUser = {
        id: userId ? `jellyfin:${userId}` : `jellyfin:${username}`,
        jellyfinId: userId,
        authProvider: 'jellyfin',
        username,
        email: '',
        thumb: userId ? withBasePath(`/api/jellyfin/user-image?userId=${encodeURIComponent(userId)}`) : null,
        jellyfinIsAdmin: isAdmin,
        isAdmin,
    };

    const deletedUsers = await loadFile(DELETED_USERS_PATH, []);
    if (!isAdmin && isDeletedUser(deletedUsers, sessionUser)) {
        await appendAuditLog('login_blocked_deleted_user', sessionUser, sessionUser);
        clearSessionCookie(req, res);
        return res.status(403).json({ error: 'Your portal session has expired. Please contact the admin for access.' });
    }

    const users = await loadFile(USERS_PATH, []);
    const knownUser = findLocalUserForSession(users, sessionUser);
    if (!isAdmin && !knownUser) {
        await appendAuditLog('login_blocked_non_member', sessionUser, sessionUser);
        clearSessionCookie(req, res);
        log(`Jellyfin ${source} login blocked for ${sessionUser.username}: not a portal member`);
        return res.status(403).json({ error: 'Your account is not registered for this portal.' });
    }

    if (!isAdmin && touchUserLastLogin(users, sessionUser)) {
        await saveFile(USERS_PATH, users);
    }

    const token = jwt.sign(sessionUser, JWT_SECRET, { expiresIn: '7d' });
    setSessionCookie(req, res, token);
    await appendAuditLog('user_login', sessionUser, sessionUser);
    log(`Jellyfin ${source} login success for ${sessionUser.username} (admin=${isAdmin}, secureCookie=${FORCE_SECURE_COOKIES}, token=${accessToken ? 'received' : 'missing'})`);
    return res.json({ success: true, user: { username: sessionUser.username, jellyfinId: sessionUser.jellyfinId, isAdmin } });
};

app.post('/api/auth/jellyfin/login', authRateLimit, async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    try {
        const config = await loadFile(CONFIG_PATH, {});
        const mediaServerLabel = String(config.mediaServerType || '').toLowerCase() === 'emby' ? 'Emby' : 'Jellyfin';
        if (!isJellyfinConfigured(config)) {
            return res.status(400).json({ error: `${mediaServerLabel} authentication is not configured` });
        }

        const baseUrl = resolveIntegrationUrlForFetch(config.jellyfinUrl);
        const response = await fetch(`${baseUrl}/Users/AuthenticateByName`, {
            method: 'POST',
            headers: jellyfinHeaders('', { 'Content-Type': 'application/json' }),
            body: JSON.stringify({ Username: username, Pw: password }),
        });

        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            log(`${mediaServerLabel} login failed for ${username}: ${response.status} ${detail.slice(0, 120)}`);
            return res.status(401).json({ error: `Invalid ${mediaServerLabel} username or password` });
        }

        return completeJellyfinPortalLogin(req, res, config, await response.json(), 'password');
    } catch (err) {
        log('Error in media server login: ' + err.message);
        res.status(500).json({ error: 'Failed to authenticate with media server' });
    }
});

app.post('/api/auth/jellyfin/quick-connect/initiate', authRateLimit, async (req, res) => {
    try {
        pruneJellyfinQuickConnectSessions();
        const config = await loadFile(CONFIG_PATH, {});
        if (!isJellyfinConfigured(config)) {
            return res.status(400).json({ error: 'Jellyfin authentication is not configured' });
        }

        const baseUrl = resolveIntegrationUrlForFetch(config.jellyfinUrl);
        const enabledRes = await fetch(`${baseUrl}/QuickConnect/Enabled`, {
            headers: jellyfinHeaders(''),
        });
        if (enabledRes.ok) {
            const enabledText = await enabledRes.text();
            if (String(enabledText).trim().toLowerCase() === 'false') {
                return res.status(400).json({ error: 'Quick Connect is disabled on your Jellyfin server.' });
            }
        }

        const initiateRes = await fetch(`${baseUrl}/QuickConnect/Initiate`, {
            method: 'POST',
            headers: jellyfinHeaders(''),
        });
        if (!initiateRes.ok) {
            const detail = await initiateRes.text().catch(() => '');
            log(`Jellyfin Quick Connect initiate failed: ${initiateRes.status} ${detail.slice(0, 160)}`);
            return res.status(502).json({ error: 'Failed to start Jellyfin Quick Connect.' });
        }

        const state = await initiateRes.json();
        const secret = state.Secret || state.secret;
        const code = state.Code || state.code;
        if (!secret || !code) {
            return res.status(502).json({ error: 'Jellyfin did not return a Quick Connect code.' });
        }

        const sessionId = randomUUID();
        jellyfinQuickConnectSessions.set(sessionId, {
            secret,
            baseUrl,
            expiresAt: Date.now() + 5 * 60 * 1000,
        });
        res.json({ sessionId, code, jellyfinUrl: config.jellyfinUrl });
    } catch (err) {
        log('Error starting jellyfin quick connect: ' + err.message);
        res.status(500).json({ error: 'Failed to start Jellyfin Quick Connect' });
    }
});

app.post('/api/auth/jellyfin/quick-connect/poll', jellyfinQuickConnectPollRateLimit, async (req, res) => {
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    try {
        pruneJellyfinQuickConnectSessions();
        const quickSession = jellyfinQuickConnectSessions.get(sessionId);
        if (!quickSession) {
            return res.status(404).json({ error: 'Quick Connect session expired. Please try again.' });
        }

        const config = await loadFile(CONFIG_PATH, {});
        if (!isJellyfinConfigured(config)) {
            return res.status(400).json({ error: 'Jellyfin authentication is not configured' });
        }

        const stateRes = await fetch(`${quickSession.baseUrl}/QuickConnect/Connect?secret=${encodeURIComponent(quickSession.secret)}`, {
            headers: jellyfinHeaders(''),
        });
        if (!stateRes.ok) {
            const detail = await stateRes.text().catch(() => '');
            log(`Jellyfin Quick Connect poll failed: ${stateRes.status} ${detail.slice(0, 160)}`);
            return res.status(502).json({ error: 'Failed to check Jellyfin Quick Connect status.' });
        }
        const state = await stateRes.json();
        const authenticated = state.Authenticated === true || state.authenticated === true;
        if (!authenticated) {
            return res.json({ authenticated: false });
        }

        const authRes = await fetch(`${quickSession.baseUrl}/Users/AuthenticateWithQuickConnect`, {
            method: 'POST',
            headers: jellyfinHeaders('', { 'Content-Type': 'application/json' }),
            body: JSON.stringify({ Secret: quickSession.secret }),
        });
        if (!authRes.ok) {
            const detail = await authRes.text().catch(() => '');
            log(`Jellyfin Quick Connect token exchange failed: ${authRes.status} ${detail.slice(0, 160)}`);
            return res.status(502).json({ error: 'Jellyfin approved the code, but token exchange failed.' });
        }

        jellyfinQuickConnectSessions.delete(sessionId);
        return completeJellyfinPortalLogin(req, res, config, await authRes.json(), 'quick-connect');
    } catch (err) {
        log('Error polling jellyfin quick connect: ' + err.message);
        res.status(500).json({ error: 'Failed to finish Jellyfin Quick Connect' });
    }
});

const fetchPlexPinAuthToken = async (pinId, { attempts = 10, delayMs = 800 } = {}) => {
    let lastData = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        const pinRes = await fetch(`https://plex.tv/api/v2/pins/${pinId}`, {
            headers: plexClientHeaders(),
        });
        lastData = await pinRes.json();
        if (lastData?.authToken) {
            if (attempt > 1) log(`Plex pin ${pinId} authenticated after ${attempt} attempts`);
            return lastData;
        }
        if (attempt < attempts) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
    log(`Plex pin ${pinId} missing authToken after ${attempts} attempts`);
    return lastData || {};
};

const handlePlexPinLogin = async (req, res, pinId, ref, { redirectOnSuccess = false } = {}) => {
    const pinData = await fetchPlexPinAuthToken(pinId);

    if (!pinData.authToken) {
        const message = 'Plex sign-in did not complete in time — please try again';
        log(`Plex login failed for pin ${pinId}: authToken not ready`);
        if (redirectOnSuccess) {
            return res.redirect(withBasePath('/?loginError=' + encodeURIComponent(message)));
        }
        return res.status(400).json({ error: message });
    }

    const userRes = await apiFetch('https://plex.tv/api/v2/user', pinData.authToken);
    if (!userRes.ok) throw new Error('Failed to fetch user info');
    const userData = await userRes.json();

    const config = await loadFile(CONFIG_PATH, {});
    await syncAdminPlexIdFromConfigToken(config);
    const adminId = await getAdminId(config);
    const isAdmin = !!(adminId && String(userData.id) === String(adminId));

    const deletedUsers = await loadFile(DELETED_USERS_PATH, []);
    const sessionUser = {
        id: userData.uuid,
        plexId: userData.id,
        email: userData.email,
        username: userData.username,
        thumb: userData.thumb || null,
        isAdmin,
    };

    if (!isAdmin && isDeletedUser(deletedUsers, sessionUser)) {
        await appendAuditLog('login_blocked_deleted_user', sessionUser, sessionUser);
        clearSessionCookie(req, res);
        const message = 'Your portal session has expired. Please contact the admin for access.';
        if (redirectOnSuccess) {
            return res.redirect(withBasePath('/?loginError=' + encodeURIComponent(message)));
        }
        return res.status(403).json({ error: message });
    }

    if (!isAdmin) {
        const users = await loadFile(USERS_PATH, []);
        const knownUser = findLocalUserForSession(users, sessionUser);
        const canSelfRegister = !!config.allowTemporaryAccess || (!!config.referralEnabled && !!ref);
        if (!knownUser && !canSelfRegister) {
            await appendAuditLog('login_blocked_non_member', sessionUser, sessionUser);
            clearSessionCookie(req, res);
            log(`Plex login blocked for ${sessionUser.username}: not a portal member (admin=${isAdmin}, adminPlexId=${config.adminPlexId || 'unset'})`);
            const message = 'Your account is not registered for this portal.';
            if (redirectOnSuccess) {
                return res.redirect(withBasePath('/?loginError=' + encodeURIComponent(message)));
            }
            return res.status(403).json({ error: message });
        }
    }

    if (!isAdmin && config.referralEnabled && ref) {
        const users = await loadFile(USERS_PATH, []);
        const isNewUser = !users.find(u => u.id === sessionUser.id || u.plexId === sessionUser.plexId);

        if (isNewUser) {
            const referrer = users.find(u => u.id === ref || u.plexId === ref);
            if (referrer && referrer.plexAccessStatus === 'active') {
                const trialDays = config.referralTrialDays || 3;
                const rewardDays = config.referralRewardDays || 7;
                const newUserObj = {
                    id: sessionUser.id,
                    plexId: sessionUser.plexId,
                    username: sessionUser.username,
                    email: sessionUser.email,
                    joiningDate: new Date().toISOString(),
                    expiryDate: addDays(new Date(), trialDays).toISOString(),
                    plexAccessStatus: 'pending',
                    isTrial: true,
                };
                users.push(newUserObj);
                if (referrer.expiryDate) {
                    referrer.expiryDate = addDays(new Date(referrer.expiryDate), rewardDays).toISOString();
                }
                await saveFile(USERS_PATH, users);
                await appendAuditLog('referral_claimed', sessionUser, referrer, { trialDays, rewardDays });
                if (config.serverIdentifier && config.plexToken) {
                    inviteUserToPlex(newUserObj, config).catch(e => log('Failed to invite referral: ' + e.message));
                }
            }
        }
    }

    const token = jwt.sign(sessionUser, JWT_SECRET, { expiresIn: '7d' });
    setSessionCookie(req, res, token);

    if (!isAdmin) {
        const users = await loadFile(USERS_PATH, []);
        if (touchUserLastLogin(users, sessionUser, new Date().toISOString(), {
            plexAuthToken: pinData.authToken,
        })) {
            await saveFile(USERS_PATH, users);
        }
    }
    await appendAuditLog('user_login', sessionUser, sessionUser);

    log(`Plex login success for ${sessionUser.username} (admin=${isAdmin}, secureCookie=${FORCE_SECURE_COOKIES})`);

    if (redirectOnSuccess) {
        return res.redirect(withBasePath('/portal'));
    }
    return res.json({ message: 'Logged in successfully', user: sessionUser });
};

app.get('/api/auth/diagnostics', publicReadRateLimit, async (req, res) => {
    const config = await loadFile(CONFIG_PATH, {});
    res.json({
        appVersion,
        forceSecureCookies: FORCE_SECURE_COOKIES,
        configured: isPortalConfigured(config),
        hasAdminPlexId: !!config?.adminPlexId,
        plexServerUrlConfigured: !!resolveConfiguredPlexServerUrl(config),
        dockerRuntime: fsSync.existsSync('/.dockerenv'),
        clientId: CLIENT_ID ? `${String(CLIENT_ID).slice(0, 8)}…` : null,
    });
});

app.get('/api/auth/session', publicReadRateLimit, async (req, res) => {
    const token = req.cookies?.session;
    if (!token) return res.json({ authenticated: false });
    try {
        const user = jwt.verify(token, JWT_SECRET);
        const config = await loadFile(CONFIG_PATH, {});
        const isAdmin = await resolveCurrentAdmin(user, config);
        return res.json({
            authenticated: true,
            user: {
                username: user.username,
                plexId: user.plexId,
                jellyfinId: user.jellyfinId,
                authProvider: user.authProvider || 'plex',
                isAdmin,
            },
        });
    } catch {
        return res.json({ authenticated: false, reason: 'invalid_token' });
    }
});

app.post('/api/auth/plex/callback', authCallbackRateLimit, async (req, res) => {
    const { pinId, ref } = req.body;
    if (!pinId) return res.status(400).json({ error: 'pinId is required' });

    try {
        await handlePlexPinLogin(req, res, pinId, ref);
    } catch (err) {
        log('Error in plex callback: ' + err.message);
        res.status(500).json({ error: 'Failed to verify login' });
    }
});

app.get('/api/auth/plex/callback', authCallbackRateLimit, async (req, res) => {
    const { pinId, ref } = req.query;
    if (!pinId) return res.redirect(withBasePath('/?loginError=' + encodeURIComponent('Missing pin ID')));

    try {
        await handlePlexPinLogin(req, res, String(pinId), ref, { redirectOnSuccess: true });
    } catch (err) {
        log('Error in plex GET callback: ' + err.message);
        clearSessionCookie(req, res);
        res.redirect(withBasePath('/?loginError=' + encodeURIComponent('Login failed. Please try again.')));
    }
});

const assertInitialSetupAccess = async (req, res, options = {}) => {
    const existingConfig = await loadFile(CONFIG_PATH, {});
    const isConfigured = isPortalConfigured(existingConfig);
    if (isConfigured) {
        res.status(403).json({ error: 'Portal is already configured.' });
        return false;
    }
    // Only localhost / SETUP_TOKEN — do not accept an arbitrary valid JWT while unconfigured.
    if (canRunInitialSetup(req)) return true;
    res.status(403).json({ error: 'Initial setup denied: localhost or valid setup token required.' });
    return false;
};

app.post('/api/setup/plex/callback', setupRateLimit, authRateLimit, async (req, res) => {
    // Require localhost or SETUP_TOKEN — never return a Plex owner token on an open unconfigured portal.
    if (!(await assertInitialSetupAccess(req, res))) return;
    const { pinId } = req.body;
    if (!pinId) return res.status(400).json({ error: 'pinId is required' });

    try {
        const pinData = await fetchPlexPinAuthToken(pinId);
        if (!pinData.authToken) {
            return res.status(400).json({ error: 'Plex sign-in not completed yet. Please try again.' });
        }

        const userRes = await apiFetch('https://plex.tv/api/v2/user', pinData.authToken);
        if (!userRes.ok) throw new Error('Failed to fetch Plex user info');
        const userData = await userRes.json();

        const servers = await fetchOwnedPlexServers(pinData.authToken);
        if (!servers.length) {
            return res.status(400).json({ error: 'No owned Plex servers found for this account. You must sign in as the server owner.' });
        }

        res.json({
            token: pinData.authToken,
            servers,
            username: userData.username || userData.title || userData.email || 'Plex User',
            email: userData.email || '',
        });
    } catch (err) {
        log(`Setup Plex callback error: ${err.message}`);
        res.status(500).json({ error: err.message || 'Failed to complete Plex sign-in' });
    }
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
    clearSessionCookie(req, res);
    res.json({ message: 'Logged out' });
});

app.post('/api/users/preferences', requireAuth, requireMember, async (req, res) => {
    if (blockIfImpersonating(req, res)) return;
    try {
        const { optOutNewsletter } = req.body;
        const users = await loadFile(USERS_PATH, []);
        const localUser = findLocalUserForSession(users, req.user);
        const userIndex = localUser ? users.findIndex(u => normalized(u.id) === normalized(localUser.id)) : -1;

        if (userIndex === -1) {
            return res.status(404).json({ error: 'User not found' });
        }

        const oldPref = !!users[userIndex].optOutNewsletter;
        users[userIndex].optOutNewsletter = !!optOutNewsletter;
        await saveFile(USERS_PATH, users);

        if (oldPref !== !!optOutNewsletter) {
            await appendAuditLog(optOutNewsletter ? 'newsletter_opt_out' : 'newsletter_opt_in', req.user, req.user);
        }

        res.json({ success: true, user: sanitizeUserForApi(users[userIndex]) });
    } catch (e) {
        log(`Error updating preferences: ${e.message}`);
        res.status(500).json({ error: 'Failed to update preferences' });
    }
});

app.get('/api/users/me', requireAuth, async (req, res) => {
    const users = await loadFile(USERS_PATH, []);
    const localUser = findLocalUserForSession(users, req.user);
    const deletedUsers = await loadFile(DELETED_USERS_PATH, []);
    const config = await loadFile(CONFIG_PATH, {});
    const impersonating = isImpersonatingSession(req.user);
    const actor = getSessionActor(req.user);
    const realIsAdmin = await resolveCurrentAdmin(actor, config);
    const isAdmin = impersonating ? false : realIsAdmin;
    req.user.isAdmin = isAdmin;

    if (!localUser && !realIsAdmin && isDeletedUser(deletedUsers, req.user)) {
        await appendAuditLog('session_blocked_deleted_user', req.user, req.user);
        clearSessionCookie(req, res);
        return res.status(403).json({ error: 'Your portal session has expired. Please contact the admin for access.' });
    }

    const mediaServerType = String(config?.mediaServerType || 'plex').toLowerCase();
    const mediaServerLabel = mediaServerType === 'emby' ? 'Emby' : mediaServerType === 'jellyfin' ? 'Jellyfin' : 'Plex';
    const isJellyfinPortal = ['jellyfin', 'emby'].includes(mediaServerType);
    let serverName = isJellyfinPortal ? `${mediaServerLabel} Server` : 'Plex Server';
    let adminThumb = null;
    let sessionThumb = req.user.thumb || null;
    let requestUrl = config.requestUrl || 'https://yourdomain.com';
    if ((requestUrl === 'https://yourdomain.com' || !requestUrl) && config.requestAppUrl) {
        requestUrl = config.requestAppUrl;
    }
    let navOrder = Array.isArray(config.navOrder) && config.navOrder.length
        ? [...config.navOrder]
        : ['home', 'discover', 'request', 'analytics', 'users', 'downloads', 'upgrader', 'collexions', 'mediastack', 'requests', 'status', 'maintenance', 'about', 'settings', 'logout'];
    // Migrate known legacy stock defaults to the current default without clobbering custom orders
    const legacyNavOrders = [
        ['home', 'discover', 'users', 'status', 'analytics', 'downloads', 'mediastack', 'maintenance', 'request', 'about', 'settings', 'logout'],
        ['home', 'discover', 'users', 'analytics', 'downloads', 'mediastack', 'upgrader', 'requests', 'status', 'maintenance', 'request', 'about', 'logs', 'settings', 'logout'],
        ['home', 'discover', 'status', 'analytics', 'request', 'users', 'downloads', 'mediastack', 'maintenance', 'about', 'settings', 'logout'],
        ['home', 'discover', 'request', 'analytics', 'users', 'downloads', 'upgrader', 'mediastack', 'requests', 'status', 'maintenance', 'about', 'settings', 'logout'],
    ];
    if (legacyNavOrders.some((legacy) => legacy.length === navOrder.length && legacy.every((key, i) => key === navOrder[i]))) {
        navOrder = ['home', 'discover', 'request', 'analytics', 'users', 'downloads', 'upgrader', 'collexions', 'mediastack', 'requests', 'status', 'maintenance', 'about', 'settings', 'logout'];
    }
    // Ensure newly added stock items appear for custom orders too.
    if (!navOrder.includes('collexions')) {
        const upgraderIdx = navOrder.indexOf('upgrader');
        if (upgraderIdx >= 0) navOrder.splice(upgraderIdx + 1, 0, 'collexions');
        else {
            const downloadsIdx = navOrder.indexOf('downloads');
            if (downloadsIdx >= 0) navOrder.splice(downloadsIdx + 1, 0, 'collexions');
            else navOrder.splice(Math.max(0, navOrder.length - 2), 0, 'collexions');
        }
    }
    try {
        if (isJellyfinPortal && config?.jellyfinUrl && config?.jellyfinApiKey) {
            const profile = await getAdminProfile(config);
            serverName = profile.serverName || `${mediaServerLabel} Server`;
        } else if (config && config.plexToken && config.serverIdentifier) {
            const profile = await getAdminProfile(config);
            serverName = profile.serverName || 'Plex Server';
            adminThumb = profile.thumb;

            if (!sessionThumb) {
                const uri = await getPlexConnectionUri(config);
                if (uri) {
                    const accountId = await resolveLocalPlexAccountId(config, uri, req.user);
                    const { map } = await fetchPlexServerAccounts(uri, config);
                    if (accountId && map[accountId]?.thumb) {
                        sessionThumb = map[accountId].thumb;
                    }
                }
            }
        }
    } catch (e) { }

    if (impersonating && localUser?.thumb) {
        sessionThumb = localUser.thumb;
    }

    if (localUser && reconcileTrialAccessFlag(localUser)) {
        await saveFile(USERS_PATH, users);
    }

    const { actor: _actor, impersonatingUserId, ...sessionPublic } = req.user;

    const requestAppType = config.requestAppType === 'overseerr' ? 'seerr' : (config.requestAppType || 'none');
    const resolvedRequestUrl = requestUrl;
    const isPlexMediaServer = String(config.mediaServerType || 'plex').toLowerCase() === 'plex';
    const portalRequestNav = isPortalRequestNavReady(config);
    const seerrRequestNav = !!(
        requestAppType
        && requestAppType !== 'none'
        && resolvedRequestUrl
        && resolvedRequestUrl !== 'https://yourdomain.com'
    );
    const navFeatures = {
        maintenance: !!config.maintenanceExperimentalEnabled,
        upgrader: !!config.upgraderEnabled,
        // Collexions is Plex-only — hide for Jellyfin/Emby even if the flag is on.
        collexions: !!config.collexionsEnabled && isPlexMediaServer,
        scanner: !!config.scannerEnabled,
        scannerHomeWidget: !!config.scannerEnabled && !!config.scannerHomeWidgetEnabled,
        // Portal engine unlocks Discover; Seerr URL still works when using Seerr as engine.
        request: portalRequestNav || seerrRequestNav,
        requestsQueue: portalRequestNav || requestAppService.isRequestAppConfigured(config),
        downloads: config.downloadsVisibleToMembers !== false,
    };

    res.json({
        session: { ...sessionPublic, thumb: sessionThumb, isAdmin },
        account: localUser ? sanitizeUserForApi(localUser) : null,
        serverName,
        adminThumb,
        mediaServerType: config.mediaServerType || 'plex',
        requestUrl,
        navOrder,
        navHiddenKeys: Array.isArray(config.navHiddenKeys)
            ? config.navHiddenKeys.filter((key) => typeof key === 'string' && key && key !== 'home' && key !== 'settings' && key !== 'logout')
            : [],
        navFeatures,
        impersonation: impersonating ? {
            active: true,
            targetUserId: impersonatingUserId,
            targetUsername: localUser?.username || req.user.username,
            adminUsername: actor?.username || null,
        } : { active: false },
    });
});

app.post('/api/admin/impersonate/:userId', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const actor = getSessionActor(req.user);
        const users = await loadFile(USERS_PATH, []);
        const deletedUsers = await loadFile(DELETED_USERS_PATH, []);
        const targetUser = users.find((user) => normalized(user.id) === normalized(req.params.userId));

        if (!targetUser) {
            return res.status(404).json({ error: 'User not found.' });
        }
        if (isDeletedUser(deletedUsers, targetUser)) {
            return res.status(400).json({ error: 'Cannot view portal as a removed user.' });
        }

        const targetIsAdmin = await resolveCurrentAdmin({
            plexId: targetUser.plexId || targetUser.id,
            jellyfinId: targetUser.jellyfinId,
            authProvider: ['jellyfin', 'emby'].includes(String(config?.mediaServerType || '').toLowerCase()) ? 'jellyfin' : undefined,
            username: targetUser.username,
        }, config);
        if (targetIsAdmin) {
            return res.status(403).json({ error: 'Cannot impersonate an administrator account.' });
        }

        const sessionUser = buildImpersonationSessionUser(actor, targetUser, config);
        const token = jwt.sign(sessionUser, JWT_SECRET, { expiresIn: '7d' });
        setSessionCookie(req, res, token);
        await appendAuditLog('impersonation_start', actor, targetUser);
        res.json({
            success: true,
            impersonation: {
                active: true,
                targetUserId: targetUser.id,
                targetUsername: targetUser.username,
                adminUsername: actor.username,
            },
        });
    } catch (e) {
        log(`Impersonation start failed: ${e.message}`);
        res.status(500).json({ error: 'Failed to start impersonation.' });
    }
});

app.post('/api/admin/stop-impersonation', requireAuth, async (req, res) => {
    try {
        if (!isImpersonatingSession(req.user)) {
            return res.json({ success: true, alreadyStopped: true });
        }

        const actor = req.user.actor;
        const target = { id: req.user.impersonatingUserId, username: req.user.username };
        const adminSession = buildAdminSessionFromActor(actor);
        const token = jwt.sign(adminSession, JWT_SECRET, { expiresIn: '7d' });
        setSessionCookie(req, res, token);
        await appendAuditLog('impersonation_stop', actor, target);
        res.json({ success: true });
    } catch (e) {
        log(`Impersonation stop failed: ${e.message}`);
        res.status(500).json({ error: 'Failed to stop impersonation.' });
    }
});

const DEFAULT_DASHBOARD_LAYOUT = {
    version: 1,
    sections: ['wrapUp', 'mainGrid', 'pendingRequests', 'watchRow', 'scanner', 'recentlyAdded', 'bazarrTools'],
    mainGridOrder: [
        'adminBadge', 'quickActions', 'accessStatus', 'announcement', 'referral',
        'newsletterPrefs', 'support', 'libraryStats', 'collexions', 'analytics'
    ],
    recentlyAddedOrder: ['recentMovies', 'recentShows', 'recentMusic'],
    hiddenSections: [],
    hiddenWidgets: [],
    widgetSizes: {},
    widgetColumns: {},
    recentHistoryRows: 4,
    topWatchedRows: 1
};

const DASHBOARD_SECTIONS = ['wrapUp', 'mainGrid', 'pendingRequests', 'watchRow', 'scanner', 'recentlyAdded', 'bazarrTools'];
const DASHBOARD_MAIN_GRID_WIDGETS = [
    'adminBadge', 'accessStatus', 'tempAccessSetup', 'quickActions', 'announcement',
    'referral', 'newsletterPrefs', 'support', 'libraryStats', 'collexions', 'analytics'
];
const DASHBOARD_RECENTLY_ADDED_WIDGETS = ['recentMovies', 'recentShows', 'recentMusic'];
const DASHBOARD_WIDGETS = [...DASHBOARD_MAIN_GRID_WIDGETS, ...DASHBOARD_RECENTLY_ADDED_WIDGETS];
const DASHBOARD_WIDGET_SIZES = ['compact', 'normal', 'wide', 'full'];

const DOWNLOAD_CLIENT_TYPES = ['qbittorrent', 'transmission', 'bittorrent', 'deluge', 'sabnzbd', 'nzbget'];
const downloadClientLabel = (type) => ({
    qbittorrent: 'qBittorrent',
    transmission: 'Transmission',
    bittorrent: 'BitTorrent',
    deluge: 'Deluge',
    sabnzbd: 'SABnzbd',
    nzbget: 'NZBGet',
}[type] || 'Download Client');

const normalizeDownloadClients = (incoming, existing = [], { resolveSecret = (v) => v, resolveConfigIntegrationUrl = (v) => String(v || '').trim(), secretMask = SECRET_MASK } = {}) => {
    if (!Array.isArray(incoming)) return Array.isArray(existing) ? existing : [];
    const existingById = new Map((Array.isArray(existing) ? existing : []).map((entry) => [String(entry.id), entry]));
    return incoming.slice(0, 20).map((raw, index) => {
        const type = DOWNLOAD_CLIENT_TYPES.includes(String(raw?.type || '').toLowerCase()) ? String(raw.type).toLowerCase() : 'qbittorrent';
        const id = String(raw?.id || `${type}-${Date.now()}-${index}`);
        const previous = existingById.get(id) || {};
        const safeUrl = resolveConfigIntegrationUrl(raw?.url, previous.url || '');
        const password = resolveSecret(raw?.password, previous.password || '');
        return {
            id,
            type,
            name: String(raw?.name || previous.name || downloadClientLabel(type)).trim() || downloadClientLabel(type),
            url: safeUrl,
            username: String(raw?.username ?? previous.username ?? ''),
            password: password === secretMask ? (previous.password || '') : String(password || ''),
            enabled: raw?.enabled !== false,
        };
    }).filter((entry) => entry.url || entry.username || entry.password || entry.name);
};

const maskDownloadClientsForApi = (clients = [], secretMask = SECRET_MASK) => (
    (Array.isArray(clients) ? clients : []).map((entry) => ({
        id: entry.id,
        type: entry.type,
        name: entry.name || downloadClientLabel(entry.type),
        url: entry.url || '',
        username: entry.username || '',
        password: entry.password ? secretMask : '',
        enabled: entry.enabled !== false,
    }))
);

const migrateDashboardSections = (sections) => {
    const next = sections.filter((id, index) => id !== 'pendingRequests' || sections.indexOf('pendingRequests') === index);
    const mainGridIndex = next.indexOf('mainGrid');
    if (!next.includes('pendingRequests') && mainGridIndex >= 0) {
        next.splice(mainGridIndex + 1, 0, 'pendingRequests');
    } else if (!next.includes('pendingRequests')) {
        next.push('pendingRequests');
    }
    const placeScannerBeforeRecentlyAdded = () => {
        const existing = next.indexOf('scanner');
        if (existing >= 0) next.splice(existing, 1);
        const ra = next.indexOf('recentlyAdded');
        if (ra >= 0) next.splice(ra, 0, 'scanner');
        else next.push('scanner');
    };
    if (!next.includes('scanner')) placeScannerBeforeRecentlyAdded();
    else {
        const si = next.indexOf('scanner');
        const ra = next.indexOf('recentlyAdded');
        if (si >= 0 && ra >= 0 && si > ra) placeScannerBeforeRecentlyAdded();
    }
    if (!next.includes('bazarrTools')) next.push('bazarrTools');
    return next;
};

const normalizeDashboardLayout = (raw) => {
    const uniqueValid = (values, allowed, fallback, fillMissing = true) => {
        if (!Array.isArray(values)) return [...fallback];
        const seen = new Set();
        const result = [];
        values.forEach((value) => {
            if (typeof value !== 'string' || !allowed.includes(value) || seen.has(value)) return;
            seen.add(value);
            result.push(value);
        });
        if (fillMissing) {
            allowed.forEach((id) => { if (!seen.has(id)) result.push(id); });
        }
        return result;
    };
    const normalizeWidgetSizes = (values) => {
        if (!values || typeof values !== 'object') return {};
        return Object.entries(values).reduce((result, [key, value]) => {
            if (DASHBOARD_WIDGETS.includes(key) && DASHBOARD_WIDGET_SIZES.includes(value) && value !== 'normal') {
                result[key] = value;
            }
            return result;
        }, {});
    };
    const normalizeWidgetColumns = (values) => {
        if (!values || typeof values !== 'object') return {};
        return Object.entries(values).reduce((result, [key, value]) => {
            if (!DASHBOARD_WIDGETS.includes(key)) return result;
            const column = Math.max(1, Math.min(12, Math.floor(Number(value))));
            if (Number.isFinite(column)) result[key] = column;
            return result;
        }, {});
    };
    const input = raw && typeof raw === 'object' ? raw : {};
    return {
        version: 1,
        sections: migrateDashboardSections(uniqueValid(input.sections, DASHBOARD_SECTIONS, DEFAULT_DASHBOARD_LAYOUT.sections)),
        mainGridOrder: uniqueValid(input.mainGridOrder, DASHBOARD_MAIN_GRID_WIDGETS, DEFAULT_DASHBOARD_LAYOUT.mainGridOrder),
        recentlyAddedOrder: uniqueValid(input.recentlyAddedOrder, DASHBOARD_RECENTLY_ADDED_WIDGETS, DEFAULT_DASHBOARD_LAYOUT.recentlyAddedOrder),
        hiddenSections: uniqueValid(input.hiddenSections, DASHBOARD_SECTIONS, [], false),
        hiddenWidgets: uniqueValid(input.hiddenWidgets, DASHBOARD_WIDGETS, [], false),
        widgetSizes: normalizeWidgetSizes(input.widgetSizes),
        widgetColumns: normalizeWidgetColumns(input.widgetColumns),
        recentHistoryRows: typeof input.recentHistoryRows === 'number' ? input.recentHistoryRows : DEFAULT_DASHBOARD_LAYOUT.recentHistoryRows,
        topWatchedRows: typeof input.topWatchedRows === 'number' ? input.topWatchedRows : DEFAULT_DASHBOARD_LAYOUT.topWatchedRows
    };
};

const normalizeSectionLayout = (raw) => {
    const normalized = normalizeDashboardLayout(raw);
    const input = raw && typeof raw === 'object' ? raw : null;
    if (!input || !Array.isArray(input.hiddenSections)) {
        return { ...normalized, hiddenSections: [] };
    }
    if (normalized.hiddenSections.length >= DEFAULT_DASHBOARD_LAYOUT.sections.length) {
        return { ...normalized, hiddenSections: [] };
    }
    if (normalized.hiddenWidgets.length >= DASHBOARD_WIDGETS.length) {
        return { ...normalized, hiddenWidgets: [] };
    }
    return normalized;
};

// Config endpoints
app.post('/api/config/dashboard-layout', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const dashboardLayout = normalizeSectionLayout(req.body?.dashboardLayout || req.body || {});
        const nextConfig = { ...config, dashboardLayout };
        await saveFile(CONFIG_PATH, nextConfig);
        res.json({ success: true, dashboardLayout });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save dashboard layout.' });
    }
});

app.get('/api/config', requireAdmin, async (req, res) => {
    const config = normalizeArrConfig(await loadFile(CONFIG_PATH, {}));
    const isConfigured = isPortalConfigured(config);
        const contactWhatsApp = config.contactWhatsApp || '';
        const contactEmail = config.contactEmail || '';

    if (isConfigured) {
        res.json({
            configured: true,
            settings: {
                token: config.plexToken ? SECRET_MASK : '',
                mediaServerType: config.mediaServerType || 'plex',
                serverIdentifier: config.serverIdentifier,
                plexServerUrl: config.plexServerUrl || '',
                jellyfinUrl: config.jellyfinUrl || '',
                jellyfinApiKey: config.jellyfinApiKey ? SECRET_MASK : '',
                checkIntervalMinutes: config.checkIntervalMinutes || 60,
                smtpHost: config.smtpHost || '',
                smtpPort: config.smtpPort || 587,
                smtpUser: config.smtpUser || '',
                smtpPass: config.smtpPass ? SECRET_MASK : '',
                smtpFrom: config.smtpFrom || '',
                smtpSecure: !!config.smtpSecure,
                emailDaysBefore: config.emailDaysBefore || 7,
                gotifyEnabled: !!config.gotifyEnabled,
                gotifyUrl: config.gotifyUrl || '',
                gotifyToken: config.gotifyToken ? SECRET_MASK : '',
                gotifyPriority: config.gotifyPriority ?? 5,
                alertRules: normalizeAlertRules(config.alertRules),
                newsletterFrequency: config.newsletterFrequency || 'disabled',
                newsletterDay: config.newsletterDay || 0,
                inactiveCleanupEnabled: !!config.inactiveCleanupEnabled,
                inactiveCleanupDays: config.inactiveCleanupDays || 90,
                publicDomain: resolvePublicBaseUrlFromConfig(config) || '',
                requestUrl: config.requestUrl || 'https://yourdomain.com',
                contactUrl: config.contactUrl || '',
                contactWhatsApp,
                contactEmail,
                sonarrUrl: config.sonarrUrl || '',
                sonarrApiKey: config.sonarrApiKey ? SECRET_MASK : '',
                radarrUrl: config.radarrUrl || '',
                radarrApiKey: config.radarrApiKey ? SECRET_MASK : '',
                arrInstances: maskArrInstancesForApi(config.arrInstances, SECRET_MASK),
                downloadClients: maskDownloadClientsForApi(config.downloadClients, SECRET_MASK),
                tautulliUrl: config.tautulliUrl || '',
                tautulliApiKey: config.tautulliApiKey ? SECRET_MASK : '',
                jellyfinAnalyticsProvider: normalizeJellyfinAnalyticsProvider(config.jellyfinAnalyticsProvider, config),
                jellystatUrl: config.jellystatUrl || '',
                jellystatApiKey: config.jellystatApiKey ? SECRET_MASK : '',
                jellyglanceUrl: config.jellyglanceUrl || '',
                jellyglanceApiKey: config.jellyglanceApiKey ? SECRET_MASK : '',
                requestAppType: config.requestAppType === 'overseerr' ? 'seerr' : (config.requestAppType || 'none'),
                requestAppUrl: config.requestAppUrl || '',
                requestAppFetchUrl: config.requestAppFetchUrl || '',
                requestAppApiKey: config.requestAppApiKey ? SECRET_MASK : '',
                requestDiscoverRegion: config.requestDiscoverRegion || '',
                requestDiscoverLanguage: config.requestDiscoverLanguage || '',
                requestHideAvailableMedia: !!config.requestHideAvailableMedia,
                discoverySource: getDiscoverySource(config),
                requestEngine: getRequestEngine(config),
                requestQuotaLimit: Number(config.requestQuotaLimit) || 0,
                requestQuotaDays: Number(config.requestQuotaDays) || 7,
                requestQuotaLimit4k: Number(config.requestQuotaLimit4k) || 0,
                autoApproveMovies: !!config.autoApproveMovies,
                autoApproveTv: !!config.autoApproveTv,
                ...portalRequestDefaultsForClient(config, { secretMask: SECRET_MASK }),
                primaryColor: config.primaryColor || '#F7C600',
                customLogoUrl: normalizeBrandingAssetForMediaServer(config.customLogoUrl, config.mediaServerType),
                brandingTheme: config.brandingTheme || 'plex',
                sidebarIdentityPosition: ['top', 'bottom'].includes(String(config.sidebarIdentityPosition || '').toLowerCase()) ? String(config.sidebarIdentityPosition).toLowerCase() : 'bottom',
                pwaIconSource: normalizePwaIconSource(config.pwaIconSource),
                backgroundImageUrl: normalizeBrandingAssetForMediaServer(config.backgroundImageUrl, config.mediaServerType),
                useScrollRevealAnimations: !!config.useScrollRevealAnimations,
                useCinematicLoading: !!config.useCinematicLoading,
                useBrandedSkeleton: config.useBrandedSkeleton !== false,
                useTrendingSlideshow: !!config.useTrendingSlideshow,
                trendingSlideshowInterval: config.trendingSlideshowInterval || 30,
                tmdbApiKey: config.tmdbApiKey ? SECRET_MASK : '',
                referralEnabled: !!config.referralEnabled,
                referralTrialDays: config.referralTrialDays || 3,
                referralRewardDays: config.referralRewardDays || 7,
                announcement: config.announcement || '',
                hideStreamUsers: config.hideStreamUsers === true ? 'anonymous' : (config.hideStreamUsers || 'false'),
                navOrder: config.navOrder || ['home', 'discover', 'request', 'analytics', 'users', 'downloads', 'upgrader', 'collexions', 'mediastack', 'requests', 'status', 'maintenance', 'about', 'settings', 'logout'],
                navHiddenKeys: Array.isArray(config.navHiddenKeys) ? config.navHiddenKeys : [],
                downloadsVisibleToMembers: config.downloadsVisibleToMembers !== false,
                defaultLibraryIds: config.defaultLibraryIds || null,
                use24HourClock: !!config.use24HourClock,
                allowTemporaryAccess: !!config.allowTemporaryAccess,
                showPosterQualityBadges: config.showPosterQualityBadges !== false,
                showDashboardWatchingBadge: !!config.showDashboardWatchingBadge,
                dashboardWatchingBadgePollSeconds: Math.min(15, Math.max(1, parseInt(config.dashboardWatchingBadgePollSeconds, 10) || 15)),
                showPublicStatusMonitor: isPublicStatusVisible(config),
                showPublicLibraryStats: arePublicLibraryStatsVisible(config),
                autoBackupEnabled: !!config.autoBackupEnabled,
                autoBackupIntervalDays: Number(config.autoBackupIntervalDays) > 0 ? Number(config.autoBackupIntervalDays) : 2,
                autoBackupRetentionCount: Number(config.autoBackupRetentionCount) > 0 ? Number(config.autoBackupRetentionCount) : 10,
                maintenanceExperimentalEnabled: !!config.maintenanceExperimentalEnabled,
                upgraderEnabled: !!config.upgraderEnabled,
                collexionsEnabled: !!config.collexionsEnabled,
                scannerEnabled: !!config.scannerEnabled,
                scannerHomeWidgetEnabled: !!config.scannerHomeWidgetEnabled,
                scannerWebhooksVisible: config.scannerWebhooksVisible !== false,
                scannerManualPathVisible: config.scannerManualPathVisible !== false,
                scanner: maskScannerConfigForApi(
                    normalizeScannerConfig(config.scanner, getDefaultScannerConfig()),
                    SECRET_MASK
                ),
                collexionsAutostart: !!config.collexionsAutostart,
                collexionsInternalUrl: config.collexionsInternalUrl || '',
                collexionsServiceKey: config.collexionsServiceKey ? '********' : '',
                collexionsBundled: isCollexionsBundledAvailable(),
                collexionsEmbedded: getCollexionsEmbeddedStatus(),
                upgraderDefaultPreset: config.upgraderDefaultPreset || 'non_hevc',
                upgraderMinSizeGB: Number(config.upgraderMinSizeGB) > 0 ? Number(config.upgraderMinSizeGB) : 5,
                upgraderAutomationEnabled: !!config.upgraderAutomationEnabled,
                upgraderProfileMap: config.upgraderProfileMap && typeof config.upgraderProfileMap === 'object' ? config.upgraderProfileMap : {},
                upgraderMaxActionsPerHour: Math.max(1, Number(config.upgraderMaxActionsPerHour) || 25),
                upgraderDefaultSort: config.upgraderDefaultSort || 'sizeGB',
                upgraderDrawerPosition: config.upgraderDrawerPosition || 'sidebar',
                dashboardLayout: normalizeSectionLayout(config.dashboardLayout),
                showUsernamesInAnalytics: !!config.showUsernamesInAnalytics,
                useTrendingSlideshowOnLogin: config.useTrendingSlideshowOnLogin !== false
            },
        });
    } else {
        res.json({
            configured: false,
            settings: {
                token: '',
                mediaServerType: 'plex',
                serverIdentifier: '',
                plexServerUrl: '',
                jellyfinUrl: '',
                jellyfinApiKey: '',
                checkIntervalMinutes: 60,
                smtpHost: '',
                smtpPort: 587,
                smtpUser: '',
                smtpPass: '',
                smtpFrom: '',
                smtpSecure: false,
                emailDaysBefore: 7,
                gotifyEnabled: false,
                gotifyUrl: '',
                gotifyToken: '',
                gotifyPriority: 5,
                alertRules: DEFAULT_ALERT_RULES,
                newsletterFrequency: 'disabled',
                newsletterDay: 0,
                inactiveCleanupEnabled: false,
                inactiveCleanupDays: 90,
                publicDomain: '',
                requestUrl: 'https://yourdomain.com',
                contactUrl: '',
                sonarrUrl: '',
                sonarrApiKey: '',
                radarrUrl: '',
                radarrApiKey: '',
                arrInstances: [],
                downloadClients: [],
                tautulliUrl: '',
                tautulliApiKey: '',
                jellyfinAnalyticsProvider: 'jellyglance',
                jellystatUrl: '',
                jellystatApiKey: '',
                jellyglanceUrl: '',
                jellyglanceApiKey: '',
                requestAppType: 'none',
                requestAppUrl: '',
                requestAppApiKey: '',
                requestDiscoverRegion: '',
                requestDiscoverLanguage: '',
                requestHideAvailableMedia: false,
                discoverySource: 'tmdb',
                requestEngine: 'portal',
                requestQuotaLimit: 0,
                requestQuotaDays: 7,
                requestQuotaLimit4k: 0,
                autoApproveMovies: false,
                autoApproveTv: false,
                ...portalRequestDefaultsForClient({}),
                primaryColor: '#F7C600',
                customLogoUrl: '',
                brandingTheme: 'plex',
                sidebarIdentityPosition: 'bottom',
                pwaIconSource: 'server',
                backgroundImageUrl: '',
                useScrollRevealAnimations: false,
                useCinematicLoading: false,
                useBrandedSkeleton: true,
                useTrendingSlideshow: false,
                trendingSlideshowInterval: 30,
                tmdbApiKey: '',
                referralEnabled: false,
                referralTrialDays: 3,
                referralRewardDays: 7,
                announcement: '',
                hideStreamUsers: 'false',
                navOrder: ['home', 'discover', 'request', 'analytics', 'users', 'downloads', 'upgrader', 'collexions', 'mediastack', 'requests', 'status', 'maintenance', 'about', 'settings', 'logout'],
                navHiddenKeys: [],
                downloadsVisibleToMembers: true,
                defaultLibraryIds: null,
                use24HourClock: false,
                allowTemporaryAccess: false,
                showPosterQualityBadges: true,
                showDashboardWatchingBadge: false,
                dashboardWatchingBadgePollSeconds: 15,
                showPublicStatusMonitor: true,
                showPublicLibraryStats: true,
                autoBackupEnabled: false,
                autoBackupIntervalDays: 2,
                autoBackupRetentionCount: 10,
                maintenanceExperimentalEnabled: false,
                upgraderEnabled: false,
                collexionsEnabled: false,
                scannerEnabled: false,
                scannerHomeWidgetEnabled: false,
                scannerWebhooksVisible: true,
                scannerManualPathVisible: true,
                scanner: maskScannerConfigForApi(getDefaultScannerConfig(), SECRET_MASK),
                collexionsAutostart: false,
                collexionsInternalUrl: '',
                collexionsServiceKey: '',
                collexionsBundled: isCollexionsBundledAvailable(),
                collexionsEmbedded: getCollexionsEmbeddedStatus(),
                upgraderDefaultPreset: 'non_hevc',
                upgraderMinSizeGB: 5,
                upgraderAutomationEnabled: false,
                upgraderProfileMap: {},
                upgraderMaxActionsPerHour: 25,
                upgraderDefaultSort: 'sizeGB',
                upgraderDrawerPosition: 'sidebar',
                dashboardLayout: DEFAULT_DASHBOARD_LAYOUT
            },
        });
    }
});

app.post('/api/config', setupRateLimit, async (req, res) => {
    const {
        token, mediaServerType, serverIdentifier, checkIntervalMinutes,
        plexServerUrl: plexServerUrlFromBody, jellyfinUrl, jellyfinApiKey,
        smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom, smtpSecure, emailDaysBefore,
        gotifyEnabled, gotifyUrl, gotifyToken, gotifyPriority, alertRules,
        newsletterFrequency, newsletterDay, publicDomain, requestUrl, contactUrl, contactWhatsApp, contactEmail,
        sonarrUrl, sonarrApiKey, radarrUrl, radarrApiKey, arrInstances, downloadClients, tautulliUrl, tautulliApiKey, jellyfinAnalyticsProvider, jellystatUrl, jellystatApiKey, jellyglanceUrl, jellyglanceApiKey,
        requestAppType, requestAppUrl, requestAppFetchUrl, requestAppApiKey,
        requestDiscoverRegion, requestDiscoverLanguage, requestHideAvailableMedia, discoverySource, requestEngine,
        requestQuotaLimit, requestQuotaDays, requestQuotaLimit4k, autoApproveMovies, autoApproveTv,
        portalAllowRequestMovies, portalAllowRequestTv, portalAllowRequest4kMovies, portalAllowRequest4kTv,
        portalAllowAdvancedRequests, portalShowRecentlyAdded, portalShowWatchlist,
        autoApproveMovies4k, autoApproveTv4k, portalAutoRequestMovies, portalAutoRequestTv,
        seriesMetadataProvider, animeMetadataProvider, tvdbApiKey,
        inactiveCleanupEnabled, inactiveCleanupDays,
        primaryColor, customLogoUrl, brandingTheme, sidebarIdentityPosition, pwaIconSource, backgroundImageUrl, useScrollRevealAnimations, useCinematicLoading, useBrandedSkeleton, useTrendingSlideshow, trendingSlideshowInterval, tmdbApiKey, referralEnabled, referralTrialDays, referralRewardDays, announcement, navOrder, navHiddenKeys, hideStreamUsers, defaultLibraryIds, use24HourClock, allowTemporaryAccess, showPosterQualityBadges, showDashboardWatchingBadge, dashboardWatchingBadgePollSeconds,
        showPublicStatusMonitor, showPublicLibraryStats,
        autoBackupEnabled, autoBackupIntervalDays, autoBackupRetentionCount, maintenanceExperimentalEnabled, upgraderEnabled, collexionsEnabled, scannerEnabled, scannerHomeWidgetEnabled, scannerWebhooksVisible, scannerManualPathVisible, scanner, collexionsAutostart, collexionsInternalUrl, collexionsServiceKey, upgraderDefaultPreset, upgraderMinSizeGB, upgraderAutomationEnabled, upgraderProfileMap, upgraderMaxActionsPerHour, upgraderDefaultSort, upgraderDrawerPosition, dashboardLayout,
        showUsernamesInAnalytics, useTrendingSlideshowOnLogin, downloadsVisibleToMembers
    } = req.body;

    const existingConfig = await loadFile(CONFIG_PATH, {});
    const normalizedMediaServerType = ['plex', 'jellyfin', 'emby'].includes(String(mediaServerType || '').toLowerCase())
        ? String(mediaServerType || '').toLowerCase()
        : (existingConfig.mediaServerType || 'plex');
    const normalizedToken = normalizePlexToken(token);
    const normalizedServerIdentifier = String(serverIdentifier).trim();
    const isConfigured = isPortalConfigured(existingConfig);
    const wasMaintenanceEnabled = !!existingConfig.maintenanceExperimentalEnabled;
    const wasUpgraderEnabled = !!existingConfig.upgraderEnabled;

    if (normalizedMediaServerType === 'plex' && (!normalizedToken || !normalizedServerIdentifier)) {
        return res.status(400).json({ error: 'Plex token and serverIdentifier are required.' });
    }
    if (normalizedMediaServerType !== 'plex' && (!jellyfinUrl || !jellyfinApiKey)) {
        return res.status(400).json({ error: 'Jellyfin URL and API key are required.' });
    }

    if (isConfigured) {
        const sessionToken = req.cookies && req.cookies.session;
        if (!sessionToken) {
            return res.status(403).json({ error: 'Forbidden: App is already configured. Please log in as admin to modify settings.' });
        }
        try {
            const decoded = jwt.verify(sessionToken, JWT_SECRET);
            const isAdmin = await resolveCurrentAdmin(decoded, existingConfig);
            if (!isAdmin) {
                return res.status(403).json({ error: 'Forbidden: Admins only.' });
            }
            req.user = decoded;
        } catch (e) {
            return res.status(403).json({ error: 'Forbidden: Invalid or expired session. Please log in again.' });
        }
    } else if (!canRunInitialSetup(req)) {
        if (normalizedMediaServerType !== 'plex') {
            return res.status(403).json({ error: 'Initial setup is restricted. Configure SETUP_TOKEN or run setup from localhost.' });
        }
        const candidatePlexServerUrl = (plexServerUrlFromBody !== undefined
            ? String(plexServerUrlFromBody || '').trim()
            : String(existingConfig.plexServerUrl || '').trim()) || resolveConfiguredPlexServerUrl(existingConfig);
        const verifiedPlexOwner = await verifyInitialSetupPlexOwner(normalizedToken, normalizedServerIdentifier, candidatePlexServerUrl);
        if (!verifiedPlexOwner) {
            if (!SETUP_TOKEN) {
                return res.status(403).json({ error: 'Initial setup is restricted. Sign in with the Plex server owner account, configure SETUP_TOKEN, or run setup from localhost.' });
            }
            return res.status(403).json({ error: 'Initial setup denied: invalid setup token or Plex server owner verification failed.' });
        }
    }
    const interval = parseInt(checkIntervalMinutes, 10);
    let safeSonarrUrl = '';
    let safeRadarrUrl = '';
    let safeTautulliUrl = '';
    let safeJellystatUrl = '';
    let safeJellyglanceUrl = '';
    let safeRequestAppUrl = '';
    let safeRequestAppFetchUrl = '';
    let safeJellyfinUrl = '';
    let safeGotifyUrl = '';
    const newlySubmittedIntegrationUrls = [];
    const resolveConfigIntegrationUrl = (incoming, existing) => {
        const existingValue = typeof existing === 'string' ? existing : '';
        // Keep existing URL as-is when caller did not change the value.
        // This prevents unrelated settings edits from failing on legacy private URLs.
        if (incoming === undefined || incoming === null) return existingValue;
        const incomingValue = String(incoming).trim();
        if (incomingValue === String(existingValue || '').trim()) return existingValue;
        const normalized = sanitizeIntegrationUrl(incomingValue);
        if (normalized) newlySubmittedIntegrationUrls.push(normalized);
        return normalized;
    };
    try {
        safeSonarrUrl = resolveConfigIntegrationUrl(sonarrUrl, existingConfig.sonarrUrl || '');
        safeRadarrUrl = resolveConfigIntegrationUrl(radarrUrl, existingConfig.radarrUrl || '');
        safeTautulliUrl = resolveConfigIntegrationUrl(tautulliUrl, existingConfig.tautulliUrl || '');
        safeJellystatUrl = resolveConfigIntegrationUrl(jellystatUrl, existingConfig.jellystatUrl || '');
        safeJellyglanceUrl = resolveConfigIntegrationUrl(jellyglanceUrl, existingConfig.jellyglanceUrl || '');
        safeRequestAppUrl = resolveConfigIntegrationUrl(requestAppUrl, existingConfig.requestAppUrl || '');
        safeRequestAppFetchUrl = resolveConfigIntegrationUrl(requestAppFetchUrl, existingConfig.requestAppFetchUrl || '');
        safeJellyfinUrl = resolveConfigIntegrationUrl(jellyfinUrl, existingConfig.jellyfinUrl || '');
        safeGotifyUrl = resolveConfigIntegrationUrl(gotifyUrl, existingConfig.gotifyUrl || '');
    } catch (e) {
        return res.status(400).json({ error: `Invalid integration URL: ${e.message}` });
    }

    // Secrets are returned to the UI as SECRET_MASK. If the UI sends the mask
    // back unchanged, or clears the field (blank), keep the existing stored value.
    const resolveSecret = (incoming, existing) => {
        if (incoming === undefined || incoming === null) return existing || '';
        if (incoming === SECRET_MASK) return existing || '';
        if (incoming === '' && existing) return existing;
        return String(incoming);
    };

    let nextArrInstances;
    try {
        nextArrInstances = mergeLegacyArrFieldsIntoInstances(
            { arrInstances, sonarrUrl: safeSonarrUrl, sonarrApiKey, radarrUrl: safeRadarrUrl, radarrApiKey },
            existingConfig,
            { resolveSecret, resolveConfigIntegrationUrl, secretMask: SECRET_MASK }
        );
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }

    let nextDownloadClients;
    try {
        nextDownloadClients = normalizeDownloadClients(downloadClients, existingConfig.downloadClients, {
            resolveSecret,
            resolveConfigIntegrationUrl,
            secretMask: SECRET_MASK,
        });
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }

    let nextScannerConfig = resolveScannerSecrets(
        scanner !== undefined ? scanner : existingConfig.scanner,
        existingConfig.scanner || getDefaultScannerConfig(),
        SECRET_MASK
    );
    try {
        nextScannerConfig = sanitizeScannerTargetUrls(
            nextScannerConfig,
            (raw) => {
                const normalized = sanitizeIntegrationUrl(raw);
                if (normalized) newlySubmittedIntegrationUrls.push(normalized);
                return normalized;
            },
            existingConfig.scanner || getDefaultScannerConfig()
        );
    } catch (e) {
        return res.status(400).json({ error: `Invalid scanner target URL: ${e.message}` });
    }

    let nextCollexionsInternalUrl = existingConfig.collexionsInternalUrl || '';
    if (collexionsInternalUrl !== undefined) {
        const incoming = String(collexionsInternalUrl || '').trim();
        if (!incoming) {
            nextCollexionsInternalUrl = '';
        } else {
            try {
                const normalized = normalizeExternalBaseUrl(incoming, { allowPrivate: true, allowHttp: true });
                const host = new URL(normalized).hostname;
                if (!isLoopbackHostName(host) && !ALLOW_PRIVATE_INTEGRATION_URLS) {
                    nextCollexionsInternalUrl = existingConfig.collexionsInternalUrl || '';
                } else {
                    nextCollexionsInternalUrl = normalized;
                    if (!isLoopbackHostName(host) && incoming !== String(existingConfig.collexionsInternalUrl || '').trim()) {
                        newlySubmittedIntegrationUrls.push(normalized);
                    }
                }
            } catch {
                nextCollexionsInternalUrl = existingConfig.collexionsInternalUrl || '';
            }
        }
    }

    try {
        for (const url of newlySubmittedIntegrationUrls) {
            await assertResolvedAddressesAllowed(new URL(url).hostname, {
                allowPrivate: ALLOW_PRIVATE_INTEGRATION_URLS,
            });
        }
    } catch (e) {
        return res.status(400).json({ error: `Invalid integration URL: ${e.message}` });
    }

    const configDraft = {
        ...existingConfig,
        mediaServerType: normalizedMediaServerType,
        plexToken: normalizedMediaServerType !== 'plex' ? resolveSecret(token, existingConfig.plexToken) : resolveSecret(normalizedToken, existingConfig.plexToken),
        serverIdentifier: normalizedMediaServerType !== 'plex' ? (normalizedServerIdentifier || existingConfig.serverIdentifier || '') : normalizedServerIdentifier,
        plexServerUrl: (plexServerUrlFromBody !== undefined ? String(plexServerUrlFromBody || '').trim() : existingConfig.plexServerUrl) || '',
        jellyfinUrl: safeJellyfinUrl,
        jellyfinApiKey: resolveSecret(jellyfinApiKey, existingConfig.jellyfinApiKey),
        checkIntervalMinutes: (interval > 0 ? interval : 60),
        smtpHost: smtpHost || '',
        smtpPort: parseInt(smtpPort, 10) || 587,
        smtpUser: smtpUser || '',
        smtpPass: resolveSecret(smtpPass, existingConfig.smtpPass),
        smtpFrom: smtpFrom || '',
        smtpSecure: !!smtpSecure,
        emailDaysBefore: parseInt(emailDaysBefore, 10) || 7,
        gotifyEnabled: !!gotifyEnabled,
        gotifyUrl: safeGotifyUrl,
        gotifyToken: resolveSecret(gotifyToken, existingConfig.gotifyToken),
        gotifyPriority: Math.max(0, Math.min(10, Number(gotifyPriority ?? existingConfig.gotifyPriority ?? 5) || 0)),
        alertRules: normalizeAlertRules(alertRules ?? existingConfig.alertRules),
        newsletterFrequency: newsletterFrequency || 'disabled',
        newsletterDay: parseInt(newsletterDay, 10) || 0,
        inactiveCleanupEnabled: !!inactiveCleanupEnabled,
        inactiveCleanupDays: parseInt(inactiveCleanupDays, 10) || 90,
        publicDomain: normalizePublicBaseUrl(publicDomain)
            || normalizePublicBaseUrl(existingConfig.publicDomain)
            || getEnvPublicBaseUrl()
            || '',
        requestUrl: requestUrl || 'https://yourdomain.com',
        contactUrl: contactUrl || '',
        contactWhatsApp: contactWhatsApp || '',
        contactEmail: contactEmail || '',
        arrInstances: nextArrInstances,
        downloadClients: nextDownloadClients,
        tautulliUrl: safeTautulliUrl,
        tautulliApiKey: resolveSecret(tautulliApiKey, existingConfig.tautulliApiKey),
        jellyfinAnalyticsProvider: normalizeJellyfinAnalyticsProvider(jellyfinAnalyticsProvider || existingConfig.jellyfinAnalyticsProvider, existingConfig),
        jellystatUrl: safeJellystatUrl,
        jellystatApiKey: resolveSecret(jellystatApiKey, existingConfig.jellystatApiKey),
        jellyglanceUrl: safeJellyglanceUrl,
        jellyglanceApiKey: resolveSecret(jellyglanceApiKey, existingConfig.jellyglanceApiKey),
        requestAppType: ['none', 'seerr', 'overseerr', 'jellyseerr', 'ombi'].includes(String(requestAppType || '').toLowerCase()) ? (String(requestAppType).toLowerCase() === 'overseerr' ? 'seerr' : String(requestAppType).toLowerCase()) : (existingConfig.requestAppType || 'none'),
        requestAppUrl: safeRequestAppUrl,
        requestAppFetchUrl: safeRequestAppFetchUrl,
        requestAppApiKey: resolveSecret(requestAppApiKey, existingConfig.requestAppApiKey),
        requestDiscoverRegion: normalizeDiscoverRegion(
            requestDiscoverRegion !== undefined ? requestDiscoverRegion : existingConfig.requestDiscoverRegion
        ),
        requestDiscoverLanguage: normalizeDiscoverLanguage(
            requestDiscoverLanguage !== undefined ? requestDiscoverLanguage : existingConfig.requestDiscoverLanguage
        ),
        requestHideAvailableMedia: requestHideAvailableMedia !== undefined
            ? !!requestHideAvailableMedia
            : !!existingConfig.requestHideAvailableMedia,
        discoverySource: normalizeDiscoverySource(
            discoverySource !== undefined ? discoverySource : existingConfig.discoverySource
        ),
        requestEngine: normalizeRequestEngine(
            requestEngine !== undefined ? requestEngine : existingConfig.requestEngine
        ),
        requestQuotaLimit: normalizeRequestQuotaLimit(
            requestQuotaLimit !== undefined ? requestQuotaLimit : existingConfig.requestQuotaLimit
        ),
        requestQuotaDays: normalizeRequestQuotaDays(
            requestQuotaDays !== undefined ? requestQuotaDays : existingConfig.requestQuotaDays
        ),
        requestQuotaLimit4k: normalizeRequestQuotaLimit(
            requestQuotaLimit4k !== undefined ? requestQuotaLimit4k : existingConfig.requestQuotaLimit4k
        ),
        autoApproveMovies: autoApproveMovies !== undefined
            ? !!autoApproveMovies
            : !!existingConfig.autoApproveMovies,
        autoApproveTv: autoApproveTv !== undefined
            ? !!autoApproveTv
            : !!existingConfig.autoApproveTv,
        ...pickPortalRequestDefaultsForSave({
            portalAllowRequestMovies,
            portalAllowRequestTv,
            portalAllowRequest4kMovies,
            portalAllowRequest4kTv,
            portalAllowAdvancedRequests,
            portalShowRecentlyAdded,
            portalShowWatchlist,
            autoApproveMovies4k,
            autoApproveTv4k,
            portalAutoRequestMovies,
            portalAutoRequestTv,
            seriesMetadataProvider,
            animeMetadataProvider,
        }, existingConfig),
        tvdbApiKey: resolveSecret(tvdbApiKey, existingConfig.tvdbApiKey),
        primaryColor: primaryColor || '#F7C600',
        customLogoUrl: normalizeBrandingAssetForMediaServer(customLogoUrl, normalizedMediaServerType),
        brandingTheme: ['dynamic', 'plex', 'slate', 'nordic', 'jellyfin', 'emby', 'emerald', 'midnight', 'crimson', 'amethyst', 'sunset', 'ocean', 'rose', 'royal', 'graphite', 'cyberlime', 'aurora'].includes(String(brandingTheme || '').toLowerCase()) ? String(brandingTheme).toLowerCase() : (existingConfig.brandingTheme || 'plex'),
        sidebarIdentityPosition: ['top', 'bottom'].includes(String(sidebarIdentityPosition || '').toLowerCase()) ? String(sidebarIdentityPosition).toLowerCase() : (existingConfig.sidebarIdentityPosition || 'bottom'),
        pwaIconSource: normalizePwaIconSource(pwaIconSource, normalizePwaIconSource(existingConfig.pwaIconSource)),
        backgroundImageUrl: normalizeBrandingAssetForMediaServer(backgroundImageUrl, normalizedMediaServerType),
        useScrollRevealAnimations: !!useScrollRevealAnimations,
        useCinematicLoading: !!useCinematicLoading,
        useBrandedSkeleton: useBrandedSkeleton !== false,
        useTrendingSlideshow: !!useTrendingSlideshow,
        trendingSlideshowInterval: parseInt(trendingSlideshowInterval, 10) || 30,
        tmdbApiKey: resolveSecret(tmdbApiKey, existingConfig.tmdbApiKey),
        referralEnabled: !!referralEnabled,
        referralTrialDays: parseInt(referralTrialDays, 10) || 3,
        referralRewardDays: parseInt(referralRewardDays, 10) || 7,
        announcement: announcement || '',
        hideStreamUsers: hideStreamUsers === true ? 'anonymous' : (hideStreamUsers === false ? 'false' : (hideStreamUsers || 'false')),
        navOrder: Array.isArray(navOrder) ? navOrder : existingConfig.navOrder || ['home', 'discover', 'request', 'analytics', 'users', 'downloads', 'upgrader', 'collexions', 'mediastack', 'requests', 'status', 'maintenance', 'about', 'settings', 'logout'],
        navHiddenKeys: (() => {
            const ALWAYS = new Set(['home', 'settings', 'logout']);
            const incoming = Array.isArray(navHiddenKeys) ? navHiddenKeys : existingConfig.navHiddenKeys;
            if (!Array.isArray(incoming)) return [];
            const seen = new Set();
            const result = [];
            for (const raw of incoming) {
                const key = String(raw || '').trim();
                if (!key || ALWAYS.has(key) || seen.has(key)) continue;
                seen.add(key);
                result.push(key);
            }
            return result;
        })(),
        downloadsVisibleToMembers: downloadsVisibleToMembers !== undefined
            ? !!downloadsVisibleToMembers
            : (existingConfig.downloadsVisibleToMembers !== false),
        defaultLibraryIds: Array.isArray(defaultLibraryIds) ? defaultLibraryIds : null,
        use24HourClock: !!use24HourClock,
        allowTemporaryAccess: !!allowTemporaryAccess,
        showPosterQualityBadges: showPosterQualityBadges !== false,
        showDashboardWatchingBadge: !!showDashboardWatchingBadge,
        dashboardWatchingBadgePollSeconds: Math.min(15, Math.max(1, parseInt(dashboardWatchingBadgePollSeconds, 10) || 15)),
        showPublicStatusMonitor: showPublicStatusMonitor !== undefined ? !!showPublicStatusMonitor : isPublicStatusVisible(existingConfig),
        showPublicLibraryStats: showPublicLibraryStats !== undefined ? !!showPublicLibraryStats : arePublicLibraryStatsVisible(existingConfig),
        autoBackupEnabled: !!autoBackupEnabled,
        autoBackupIntervalDays: Math.max(1, parseInt(autoBackupIntervalDays, 10) || 2),
        autoBackupRetentionCount: Math.max(1, parseInt(autoBackupRetentionCount, 10) || 10),
        maintenanceExperimentalEnabled: maintenanceExperimentalEnabled !== undefined ? !!maintenanceExperimentalEnabled : !!existingConfig.maintenanceExperimentalEnabled,
        upgraderEnabled: upgraderEnabled !== undefined ? !!upgraderEnabled : !!existingConfig.upgraderEnabled,
        scannerEnabled: scannerEnabled !== undefined ? !!scannerEnabled : !!existingConfig.scannerEnabled,
        scannerHomeWidgetEnabled: (() => {
            const scannerOn = scannerEnabled !== undefined ? !!scannerEnabled : !!existingConfig.scannerEnabled;
            if (!scannerOn) return false;
            return scannerHomeWidgetEnabled !== undefined
                ? !!scannerHomeWidgetEnabled
                : !!existingConfig.scannerHomeWidgetEnabled;
        })(),
        scannerWebhooksVisible: scannerWebhooksVisible !== undefined
            ? !!scannerWebhooksVisible
            : (existingConfig.scannerWebhooksVisible !== false),
        scannerManualPathVisible: scannerManualPathVisible !== undefined
            ? !!scannerManualPathVisible
            : (existingConfig.scannerManualPathVisible !== false),
        scanner: nextScannerConfig,
        collexionsEnabled: (() => {
            // Plex-only integration — never leave enabled for Jellyfin/Emby.
            if (normalizedMediaServerType !== 'plex') return false;
            return collexionsEnabled !== undefined ? !!collexionsEnabled : !!existingConfig.collexionsEnabled;
        })(),
        collexionsAutostart: (() => {
            if (normalizedMediaServerType !== 'plex') return false;
            const enabled = collexionsEnabled !== undefined ? !!collexionsEnabled : !!existingConfig.collexionsEnabled;
            if (!enabled) return false;
            return collexionsAutostart !== undefined ? !!collexionsAutostart : !!existingConfig.collexionsAutostart;
        })(),
        collexionsInternalUrl: nextCollexionsInternalUrl,
        collexionsServiceKey: (() => {
            if (collexionsServiceKey === undefined) return existingConfig.collexionsServiceKey || '';
            const incoming = String(collexionsServiceKey || '').trim();
            if (!incoming || incoming === '********') return existingConfig.collexionsServiceKey || '';
            return incoming;
        })(),
        upgraderDefaultPreset: upgraderDefaultPreset || existingConfig.upgraderDefaultPreset || 'non_hevc',
        upgraderMinSizeGB: Math.max(0, Number(upgraderMinSizeGB ?? existingConfig.upgraderMinSizeGB ?? 5) || 5),
        upgraderAutomationEnabled: upgraderAutomationEnabled !== undefined ? !!upgraderAutomationEnabled : !!existingConfig.upgraderAutomationEnabled,
        upgraderProfileMap: (upgraderProfileMap && typeof upgraderProfileMap === 'object')
            ? upgraderProfileMap
            : (existingConfig.upgraderProfileMap && typeof existingConfig.upgraderProfileMap === 'object' ? existingConfig.upgraderProfileMap : {}),
        upgraderMaxActionsPerHour: Math.max(1, Number(upgraderMaxActionsPerHour ?? existingConfig.upgraderMaxActionsPerHour ?? 25) || 25),
        upgraderDefaultSort: ['title', 'sizeGB', 'watchCount', 'addedAt'].includes(String(upgraderDefaultSort || existingConfig.upgraderDefaultSort || 'sizeGB'))
            ? String(upgraderDefaultSort || existingConfig.upgraderDefaultSort || 'sizeGB')
            : 'sizeGB',
        upgraderDrawerPosition: ['sidebar', 'modal'].includes(String(upgraderDrawerPosition || existingConfig.upgraderDrawerPosition || 'sidebar'))
            ? String(upgraderDrawerPosition || existingConfig.upgraderDrawerPosition || 'sidebar')
            : 'sidebar',
        showUsernamesInAnalytics: showUsernamesInAnalytics !== undefined ? !!showUsernamesInAnalytics : !!existingConfig.showUsernamesInAnalytics,
        useTrendingSlideshowOnLogin: useTrendingSlideshowOnLogin !== undefined ? !!useTrendingSlideshowOnLogin : (existingConfig.useTrendingSlideshowOnLogin !== false),
        dashboardLayout: ('dashboardLayout' in req.body)
            ? normalizeSectionLayout(req.body.dashboardLayout)
            : normalizeSectionLayout(existingConfig.dashboardLayout)
    };
    const config = migrateArrConfig(configDraft);
    const { config: collexionsConfig, changed: collexionsDefaultsChanged } = applyCollexionsBundledDefaults(config, {
        configDir: CONFIG_DIR,
        log,
    });
    await saveFile(CONFIG_PATH, collexionsConfig);
    refreshRuntimePublicBaseUrl(collexionsConfig);
    syncIntegrationServicesInStatusConfig(collexionsConfig);
    try {
        await saveFile(STATUS_CONFIG_PATH, statusConfig);
    } catch (e) {
        log(`Failed to sync integration services into status config: ${e.message}`);
    }
    await syncAdminPlexIdFromConfigToken(collexionsConfig, { persist: true });
    // Invalidate caches tied to the Plex token/server so changes take effect immediately.
    cachedPlexConnectionUri = null;
    lastPlexConnectionUriFetch = 0;
    cachedPlexAccounts = null;
    cachedPlexAccountsAt = 0;
    cachedAdminProfile = null;
    lastAdminProfileFetch = 0;
    cachedArrCatalog = null;
    cachedArrCatalogAt = 0;
    systemJobs.autoBackup.nextRun = collexionsConfig.autoBackupEnabled ? computeNextBackupRun(collexionsConfig) : null;
    log('Configuration saved successfully.');
    if (collexionsDefaultsChanged) {
        log('[collexions] Applied bundled worker defaults (internal URL / service key).');
    }
    try {
        await syncCollexionsEmbeddedWorker(collexionsConfig, { configDir: CONFIG_DIR, log });
    } catch (e) {
        log(`[collexions] Embedded worker sync failed: ${e.message}`);
    }
    let seerrDiscoverySync = { ok: true, skipped: true, reason: 'portal_owned' };
    // Phase 4: Discover Language/Region are portal-owned — do not sync to Seerr.
    startBackgroundService(); // (Re)start service with new config
    const becameConfigured = !isConfigured && isPortalConfigured(collexionsConfig);
    const maintenanceJustEnabled = !wasMaintenanceEnabled && !!collexionsConfig.maintenanceExperimentalEnabled;
    const upgraderJustEnabled = !wasUpgraderEnabled && !!collexionsConfig.upgraderEnabled;
    const upgraderJustDisabled = wasUpgraderEnabled && !collexionsConfig.upgraderEnabled;
    if (upgraderJustDisabled) {
        idleUpgraderIndexJob('Library Upgrader disabled in settings');
    } else if (upgraderJustEnabled) {
        clearUpgraderIndexDisabledError();
        scheduleUpgraderIndexRebuild(0);
    }
    if ((becameConfigured || maintenanceJustEnabled || upgraderJustEnabled) && isMediaQualityIndexEnabled(collexionsConfig)) {
        // Kick an immediate index build after setup/enablement so rules/upgrader are usable right away.
        setTimeout(async () => {
            try {
                await buildMaintenanceMediaIndex({ actor: req.user || { username: 'System', email: 'system@local' }, force: true });
                log('Media quality index rebuilt after setup/config enablement.');
            } catch (e) {
                log(`Post-setup media quality index rebuild failed: ${e.message}`);
            }
        }, 1000);
    }
    res.json({ message: 'Configuration saved.', seerrDiscoverySync });
});

let tmdbCache = { data: null, lastFetch: 0 };
async function fetchTmdbTrendingBackgrounds(apiKey) {
    if (!apiKey) return [];
    if (tmdbCache.data && Date.now() - tmdbCache.lastFetch < 12 * 60 * 60 * 1000) {
        return tmdbCache.data;
    }
    try {
        let allResults = [];
        for (let page = 1; page <= 10; page++) {
            const res = await fetch(`https://api.themoviedb.org/3/trending/all/week?api_key=${apiKey}&page=${page}`);
            if (!res.ok) continue;
            const json = await res.json();
            if (json && json.results) {
                allResults = allResults.concat(json.results);
            }
        }
        if (allResults.length > 0) {
            const bgs = allResults
                .filter(i => i.backdrop_path)
                .map(i => `https://image.tmdb.org/t/p/original${i.backdrop_path}`);
            tmdbCache.data = [...new Set(bgs)].slice(0, 100);
            tmdbCache.lastFetch = Date.now();
            return tmdbCache.data;
        }
    } catch (e) {
        log(`Failed to fetch TMDB trending: ${e.message}`);
    }
    return tmdbCache.data || [];
}

app.get('/api/config/public', async (req, res) => {
    try {
        const config = (await loadFile(CONFIG_PATH, {})) || {};
        res.json({
            mediaServerType: config.mediaServerType || 'plex',
            jellyfinAnalyticsProvider: normalizeJellyfinAnalyticsProvider(config.jellyfinAnalyticsProvider, config),
            primaryColor: config.primaryColor || '#F7C600',
            customLogoUrl: normalizeBrandingAssetForMediaServer(config.customLogoUrl, config.mediaServerType),
            brandingTheme: config.brandingTheme || 'plex',
            sidebarIdentityPosition: ['top', 'bottom'].includes(String(config.sidebarIdentityPosition || '').toLowerCase()) ? String(config.sidebarIdentityPosition).toLowerCase() : 'bottom',
            pwaIconSource: normalizePwaIconSource(config.pwaIconSource),
            backgroundImageUrl: normalizeBrandingAssetForMediaServer(config.backgroundImageUrl, config.mediaServerType),
            useScrollRevealAnimations: !!config.useScrollRevealAnimations,
            useCinematicLoading: !!config.useCinematicLoading,
            useBrandedSkeleton: config.useBrandedSkeleton !== false,
            useTrendingSlideshow: !!config.useTrendingSlideshow,
            useTrendingSlideshowOnLogin: config.useTrendingSlideshowOnLogin !== false,
            trendingSlideshowInterval: parseInt(config.trendingSlideshowInterval, 10) || 30,
            trendingBackgrounds: (!!config.useTrendingSlideshow || config.useTrendingSlideshowOnLogin !== false) ? await fetchTmdbTrendingBackgrounds(config.tmdbApiKey) : [],
            announcement: config.announcement || '',
            referralEnabled: !!config.referralEnabled,
            publicBaseUrl: resolvePublicBaseUrlFromConfig(config) || '',
            appVersion: appVersion,
            use24HourClock: !!config.use24HourClock,
            allowTemporaryAccess: !!config.allowTemporaryAccess,
            showPosterQualityBadges: config.showPosterQualityBadges !== false,
            showDashboardWatchingBadge: !!config.showDashboardWatchingBadge,
            dashboardWatchingBadgePollSeconds: Math.min(15, Math.max(1, parseInt(config.dashboardWatchingBadgePollSeconds, 10) || 15)),
            showPublicStatusMonitor: isPublicStatusVisible(config),
            showPublicLibraryStats: arePublicLibraryStatsVisible(config),
            dashboardLayout: normalizeSectionLayout(config.dashboardLayout),
            basePath: BASE_PATH,
        });
    } catch (error) {
        res.json({
            mediaServerType: 'plex',
            primaryColor: '#F7C600',
            customLogoUrl: '',
            brandingTheme: 'plex',
            sidebarIdentityPosition: 'bottom',
            pwaIconSource: 'server',
            backgroundImageUrl: '',
            useScrollRevealAnimations: false,
            useCinematicLoading: false,
            useBrandedSkeleton: true,
            useTrendingSlideshow: false,
            trendingSlideshowInterval: 30,
            trendingBackgrounds: [],
            announcement: '',
            referralEnabled: false,
            appVersion: appVersion,
            use24HourClock: false,
            allowTemporaryAccess: false,
            showPosterQualityBadges: true,
            showDashboardWatchingBadge: false,
            dashboardWatchingBadgePollSeconds: 15,
            showPublicStatusMonitor: true,
            showPublicLibraryStats: true,
            dashboardLayout: DEFAULT_DASHBOARD_LAYOUT,
            basePath: BASE_PATH,
        });
    }
});

const EMPTY_RELEASE_NOTES = {
    version: null,
    date: null,
    title: "What's new",
    sections: [],
    changelogUrl: 'https://github.com/jl94x4/Server-Manager-Portal/blob/main/CHANGELOG.md',
};

app.get('/api/release-notes', async (req, res) => {
    try {
        const notesPath = path.join(process.cwd(), 'static', 'release-notes.json');
        const raw = await fs.readFile(notesPath, 'utf8');
        res.json(JSON.parse(raw));
    } catch (e) {
        res.json(EMPTY_RELEASE_NOTES);
    }
});

const requireLogoUploadAccess = async (req, res, next) => {
    const config = await loadFile(CONFIG_PATH, {});
    if (!isPortalConfigured(config) && canRunInitialSetup(req)) {
        return next();
    }
    return requireAdmin(req, res, next);
};

const saveUploadedBrandingImage = async (req, res, assetName, responseKey) => {
    try {
        const buf = req.body;
        if (!Buffer.isBuffer(buf) || buf.length < 4) {
            return res.status(400).json({ error: 'Invalid image file.' });
        }
        // Verify PNG, JPEG, or WebP magic bytes — Content-Type header and file extension are spoofable.
        const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
        const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
        const isWebp = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
            && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
        if (!isPng && !isJpeg && !isWebp) {
            const signature = buf.subarray(0, 12).toString('hex').match(/.{1,2}/g)?.join(' ') || 'unknown';
            log(`Rejected ${assetName} upload: unsupported image signature ${signature}`);
            return res.status(400).json({ error: 'Invalid image format. Only PNG, JPEG, and WebP files are accepted.' });
        }
        const assetDir = path.join(process.cwd(), 'static');
        await fs.mkdir(assetDir, { recursive: true });
        const extension = isWebp ? 'webp' : (isJpeg ? 'jpg' : 'png');
        await Promise.all(['png', 'jpg', 'jpeg', 'webp']
            .filter((ext) => ext !== extension)
            .map((ext) => fs.unlink(path.join(assetDir, `${assetName}.${ext}`)).catch(() => null)));
        const assetPath = path.join(assetDir, `${assetName}.${extension}`);
        await fs.writeFile(assetPath, buf);
        res.json({ message: `${assetName === 'logo' ? 'Logo' : 'Background'} uploaded successfully.`, [responseKey]: `/static/${assetName}.${extension}` });
    } catch (e) {
        log(`Failed to upload ${assetName}: ${e.message}`);
        res.status(500).json({ error: `Failed to upload ${assetName}.` });
    }
};

app.post('/api/config/logo', requireLogoUploadAccess, express.raw({ type: ['image/*', 'application/octet-stream'], limit: '5mb' }), async (req, res) => {
    await saveUploadedBrandingImage(req, res, 'logo', 'logoUrl');
});

app.post('/api/config/background', requireLogoUploadAccess, express.raw({ type: ['image/*', 'application/octet-stream'], limit: '10mb' }), async (req, res) => {
    await saveUploadedBrandingImage(req, res, 'background', 'backgroundImageUrl');
});

app.post('/api/config/test-email', requireAdmin, async (req, res) => {
    const { smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom, smtpSecure, testRecipient } = req.body;

    if (!smtpHost || !smtpUser || !smtpPass || !testRecipient) {
        return res.status(400).json({ error: 'Host, user, password, and test recipient are required.' });
    }

    // The UI shows the stored password as SECRET_MASK; resolve it back to the
    // real stored value so the test uses actual credentials.
    let effectiveSmtpPass = smtpPass;
    if (smtpPass === SECRET_MASK) {
        const storedConfig = await loadFile(CONFIG_PATH, {});
        effectiveSmtpPass = storedConfig.smtpPass || '';
    }

    const config = {
        smtpHost,
        smtpPort: parseInt(smtpPort, 10) || 587,
        smtpUser,
        smtpPass: effectiveSmtpPass,
        smtpFrom,
        smtpSecure: !!smtpSecure,
    };

    // Check if logo exists to determine if we should reference it in HTML
    const logoPath = path.join(process.cwd(), 'static', 'logo.png');
    let hasLogo = false;
    try {
        await fs.access(logoPath);
        hasLogo = true;
    } catch (e) { }

    try {
        log(`Sending test email to ${testRecipient}...`);
        await sendEmail(
            config,
            testRecipient,
            '[Plex Server] Test Email Connection',
            `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f6f9; padding: 30px; color: #333333; line-height: 1.6;">
                <div style="max-width: 600px; margin: auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border-top: 6px solid #e5a00d;">
                    <div style="background-color: #282A2D; padding: 25px; text-align: center;">
                        ${hasLogo ? '<img src="cid:logo" alt="Logo" style="max-height: 100px; display: block; margin: 0 auto 10px auto;" />' : ''}
                        <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase;">PLEX SERVER</h1>
                    </div>
                    <div style="padding: 30px 40px;">
                        <h2 style="color: #282A2D; font-size: 20px; margin-top: 0; font-weight: 600; text-align: center;">SMTP Test Successful</h2>
                        <p>This is a test notification confirming that the Plex SMTP server parameters are active and communicating successfully.</p>
                        <p>Automated expiry notifications will use this template design to contact shared members before access revocation.</p>
                    </div>
                    <div style="background-color: #f7fafc; padding: 20px 30px; border-top: 1px solid #edf2f7; text-align: center; font-size: 12px; color: #a0aec0;">
                        <p style="margin: 0;">Automated alert from the Plex Expiry Service.</p>
                    </div>
                </div>
            </div>
            `
        );
        res.json({ message: 'Test email sent successfully!' });
    } catch (error) {
        log(`Failed to send test email: ${error.message}`);
        res.status(500).json({ error: `SMTP test failed: ${error.message}` });
    }
});

app.post('/api/config/test-gotify', requireAdmin, async (req, res) => {
    const { gotifyUrl, gotifyToken, gotifyPriority } = req.body || {};
    if (!gotifyUrl || !gotifyToken) {
        return res.status(400).json({ error: 'Gotify URL and application token are required.' });
    }

    const storedConfig = await loadFile(CONFIG_PATH, {});
    let safeGotifyUrl = '';
    try {
        const incomingUrl = String(gotifyUrl || '').trim();
        safeGotifyUrl = incomingUrl === String(storedConfig.gotifyUrl || '').trim()
            ? resolveIntegrationUrlForFetch(storedConfig.gotifyUrl || incomingUrl)
            : sanitizeIntegrationUrl(incomingUrl);
    } catch (e) {
        return res.status(400).json({ error: `Invalid Gotify URL: ${e.message}` });
    }

    const effectiveGotifyToken = gotifyToken === SECRET_MASK
        ? storedConfig.gotifyToken || ''
        : String(gotifyToken || '');

    try {
        await sendGotifyAlert(
            {
                gotifyEnabled: true,
                gotifyUrl: safeGotifyUrl,
                gotifyToken: effectiveGotifyToken,
                gotifyPriority: Math.max(0, Math.min(10, Number(gotifyPriority ?? 5) || 0)),
            },
            'Server Manager Portal test',
            'Gotify alerts are connected and ready.',
        );
        res.json({ message: 'Gotify test alert sent successfully!' });
    } catch (error) {
        res.status(502).json({ error: `Gotify test failed: ${error.message}` });
    }
});

const resolveTestCredential = (incoming, existing) => {
    if (incoming === undefined || incoming === null || incoming === '') return existing || '';
    if (incoming === SECRET_MASK) return existing || '';
    return String(incoming);
};

const resolveIntegrationUrlForTest = (incoming, existing) => {
    const url = resolveTestCredential(incoming, existing);
    if (!url) return '';
    const trimmedIncoming = typeof incoming === 'string' ? incoming.trim() : '';
    const trimmedExisting = typeof existing === 'string' ? existing.trim() : '';
    if (trimmedIncoming !== '' && trimmedIncoming !== trimmedExisting) {
        return sanitizeIntegrationUrl(trimmedIncoming);
    }
    return resolveIntegrationUrlForFetch(url);
};

const isSeerrFamilyRequestApp = (type) => {
    const lower = String(type || '').toLowerCase();
    return lower === 'seerr' || lower === 'overseerr' || lower === 'jellyseerr';
};

const testSeerrFamilyConnection = async (baseUrl, apiKey) => {
    const headers = { Accept: 'application/json', 'X-Api-Key': apiKey };
    const statusRes = await fetchWithTimeout(`${baseUrl}/api/v1/status`, { headers }, 12000);
    if (!statusRes.ok) throw new Error(`Seerr returned HTTP ${statusRes.status} at /api/v1/status`);
    const data = await statusRes.json().catch(() => ({}));
    const authRes = await fetchWithTimeout(`${baseUrl}/api/v1/request/count`, { headers }, 12000);
    if (!authRes.ok) throw new Error(`Seerr API key rejected (HTTP ${authRes.status})`);
    const version = data.version || data.commitTag || '?';
    return { version, message: `Seerr v${version} connected` };
};

const UNCONFIGURED_SETUP_ACCESS_DENIED = 'Initial setup access denied. Use localhost, configure SETUP_TOKEN, or provide a valid Plex server owner token.';

const verifyPlexOwnerTokenForSetup = async (plexToken, plexServerUrl = '') => {
    const token = normalizePlexToken(plexToken);
    if (!token || token === SECRET_MASK) return false;
    try {
        const servers = await fetchOwnedPlexServers(token);
        if (servers.length > 0) return true;
    } catch (e) {
        log(`Plex owner token verification via Plex.tv failed: ${e.message}`);
    }
    const directUrl = String(plexServerUrl || '').trim();
    if (directUrl) {
        return validatePlexServerAdminToken(token, directUrl);
    }
    return false;
};

const assertUnconfiguredSensitiveSetupAccess = async (req, res, { plexToken, plexServerUrl, integrationType, serverIdentifier } = {}) => {
    if (canRunInitialSetup(req)) return true;
    const token = plexToken ?? req.body?.token;
    const directUrl = plexServerUrl ?? req.body?.plexServerUrl;
    const type = integrationType ?? req.body?.type;
    const identifier = serverIdentifier ?? req.body?.serverIdentifier;
    if (type === 'plex' && identifier) {
        const stored = await loadFile(CONFIG_PATH, {});
        if (await verifyInitialSetupPlexOwner(token, identifier, directUrl, stored)) {
            return true;
        }
    }
    if (await verifyPlexOwnerTokenForSetup(token, directUrl)) {
        return true;
    }
    res.status(403).json({ error: UNCONFIGURED_SETUP_ACCESS_DENIED });
    return false;
};

const assertIntegrationTestAccess = async (req, res) => {
    const stored = await loadFile(CONFIG_PATH, {});
    const isConfigured = isPortalConfigured(stored);
    if (isConfigured) {
        const sessionToken = req.cookies && req.cookies.session;
        if (!sessionToken) {
            res.status(403).json({ error: 'Forbidden: admin login required.' });
            return false;
        }
        try {
            const decoded = jwt.verify(sessionToken, JWT_SECRET);
            const isAdmin = await resolveCurrentAdmin(decoded, stored);
            if (!isAdmin) {
                res.status(403).json({ error: 'Forbidden: admins only.' });
                return false;
            }
            req.user = decoded;
        } catch (e) {
            res.status(403).json({ error: 'Forbidden: invalid session.' });
            return false;
        }
        return true;
    }
    return assertUnconfiguredSensitiveSetupAccess(req, res);
};

app.post('/api/integrations/tvdb/test', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const rawKey = String(req.body?.apiKey || '').trim();
        const apiKey = (rawKey && rawKey !== SECRET_MASK)
            ? rawKey
            : String(config.tvdbApiKey || '').trim();
        if (!apiKey) {
            // Matching still works via TMDB external_ids without a dedicated TVDB key.
            return res.json({
                ok: true,
                message: 'No TVDB API key set — Sonarr matching still uses TMDB → TVDB external ids.',
            });
        }
        const loginRes = await fetchWithTimeout('https://api4.thetvdb.com/v4/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ apikey: apiKey }),
        }, 12000);
        if (!loginRes.ok) {
            return res.status(502).json({ ok: false, message: `TVDB login failed (HTTP ${loginRes.status})` });
        }
        return res.json({ ok: true, message: 'TVDB API key accepted.' });
    } catch (error) {
        res.status(502).json({ ok: false, message: error.message || 'TVDB test failed' });
    }
});

app.post('/api/config/test-integration', setupRateLimit, async (req, res) => {
    if (!(await assertIntegrationTestAccess(req, res))) return;

    const {
        type,
        token, serverIdentifier, plexServerUrl,
        jellyfinUrl, jellyfinApiKey,
        sonarrUrl, sonarrApiKey,
        radarrUrl, radarrApiKey,
        lidarrUrl, lidarrApiKey,
        bazarrUrl, bazarrApiKey,
        downloadClientId, downloadClientType, downloadClientUrl, downloadClientUsername, downloadClientPassword,
        tautulliUrl, tautulliApiKey,
        jellystatUrl, jellystatApiKey, jellyglanceUrl, jellyglanceApiKey,
        requestAppType, requestAppUrl, requestAppFetchUrl, requestAppApiKey,
        tmdbApiKey,
    } = req.body || {};

    const stored = await loadFile(CONFIG_PATH, {});

    try {
        if (type === 'plex') {
            const plexToken = resolveTestCredential(token, stored.plexToken);
            const serverId = resolveTestCredential(serverIdentifier, stored.serverIdentifier);
            if (!plexToken || !serverId) return res.status(400).json({ error: 'Plex token and server identifier are required.' });
            cachedPlexConnectionUri = null;
            lastPlexConnectionUriFetch = 0;
            const directUrl = resolveTestCredential(plexServerUrl, stored.plexServerUrl);
            const testConfig = { ...stored, plexToken, serverIdentifier: serverId, ...(directUrl ? { plexServerUrl: directUrl } : {}) };
            const uri = await getPlexConnectionUri(testConfig);
            const identityRes = await fetchWithTimeout(`${uri}/identity?X-Plex-Token=${encodeURIComponent(plexToken)}`, {
                headers: plexClientHeaders(plexToken),
            }, 12000);
            if (!identityRes.ok) throw new Error(`Plex server returned HTTP ${identityRes.status}`);
            const identity = await identityRes.json().catch(() => ({}));
            const container = identity.MediaContainer || identity;
            const version = container.version || container.Version || '';
            const message = version
                ? `Connected to Plex Media Server (v${version})`
                : 'Connected to Plex Media Server';
            return res.json({ ok: true, message, details: { version: version || null, machineIdentifier: container.machineIdentifier || serverId, uri } });
        }

        if (type === 'jellyfin' || type === 'emby') {
            const label = type === 'emby' ? 'Emby' : 'Jellyfin';
            const url = resolveIntegrationUrlForTest(jellyfinUrl, stored.jellyfinUrl);
            const apiKey = resolveTestCredential(jellyfinApiKey, stored.jellyfinApiKey);
            if (!url || !apiKey) return res.status(400).json({ error: `${label} URL and API key are required.` });
            const infoRes = await fetchWithTimeout(`${url}/System/Info`, {
                headers: { Accept: 'application/json', 'X-Emby-Token': apiKey },
            }, 12000);
            if (!infoRes.ok) throw new Error(`${label} returned HTTP ${infoRes.status}`);
            const data = await infoRes.json().catch(() => ({}));
            const version = data.Version || data.version || '?';
            return res.json({ ok: true, message: `${label} v${version} connected`, details: { version, serverName: data.ServerName || data.LocalAddress || null } });
        }

        if (['sonarr', 'radarr', 'lidarr', 'bazarr'].includes(String(type || '').toLowerCase())) {
            const arrType = String(type || '').toLowerCase();
            const normalized = normalizeArrConfig(stored);
            const instanceFromId = req.body?.instanceId ? getArrInstance(normalized, req.body.instanceId) : null;
            const defaultInstance = getDefaultArrInstance(normalized, arrType);
            const legacyUrl = ({ sonarr: sonarrUrl, radarr: radarrUrl, lidarr: lidarrUrl, bazarr: bazarrUrl })[arrType];
            const legacyKey = ({ sonarr: sonarrApiKey, radarr: radarrApiKey, lidarr: lidarrApiKey, bazarr: bazarrApiKey })[arrType];
            const storedUrl = arrType === 'sonarr' ? stored.sonarrUrl : arrType === 'radarr' ? stored.radarrUrl : '';
            const storedKey = arrType === 'sonarr' ? stored.sonarrApiKey : arrType === 'radarr' ? stored.radarrApiKey : '';
            const labelBase = ({ sonarr: 'Sonarr', radarr: 'Radarr', lidarr: 'Lidarr', bazarr: 'Bazarr' })[arrType] || 'ARR';
            const url = resolveIntegrationUrlForTest(
                legacyUrl || instanceFromId?.url,
                instanceFromId?.url || defaultInstance?.url || storedUrl
            );
            const apiKey = resolveTestCredential(
                legacyKey || instanceFromId?.apiKey,
                instanceFromId?.apiKey || defaultInstance?.apiKey || storedKey
            );
            if (!url || !apiKey) return res.status(400).json({ error: `${labelBase} URL and API key are required.` });
            const statusPath = arrType === 'bazarr'
                ? `/api/system/status?apikey=${encodeURIComponent(apiKey)}`
                : arrType === 'lidarr'
                    ? '/api/v1/system/status'
                    : '/api/v3/system/status';
            const statusRes = await fetchWithTimeout(`${url}${statusPath}`, {
                headers: { 'X-Api-Key': apiKey, 'X-API-KEY': apiKey, Accept: 'application/json' },
            }, 12000);
            if (!statusRes.ok) throw new Error(`${labelBase} returned HTTP ${statusRes.status}`);
            const data = await statusRes.json().catch(() => ({}));
            const version = arrType === 'bazarr'
                ? (data?.data?.bazarr_version || data?.data?.package_version || data?.bazarr_version || data?.package_version || data?.version)
                : data.version;
            const label = instanceFromId?.name || defaultInstance?.name || labelBase;
            return res.json({ ok: true, message: `${label} v${version || '?'} connected`, details: { version: version || null, appName: data.appName || data?.data?.appName || null, instanceId: instanceFromId?.id || defaultInstance?.id || null } });
        }

        if (type === 'downloadClient') {
            const existing = downloadClientId
                ? (Array.isArray(stored.downloadClients) ? stored.downloadClients : []).find((entry) => String(entry.id) === String(downloadClientId))
                : null;
            const clientType = DOWNLOAD_CLIENT_TYPES.includes(String(downloadClientType || existing?.type || '').toLowerCase())
                ? String(downloadClientType || existing?.type).toLowerCase()
                : 'qbittorrent';
            const client = {
                id: String(downloadClientId || existing?.id || 'test'),
                type: clientType,
                name: existing?.name || downloadClientLabel(clientType),
                url: resolveIntegrationUrlForTest(downloadClientUrl, existing?.url),
                username: String(downloadClientUsername ?? existing?.username ?? ''),
                password: resolveTestCredential(downloadClientPassword, existing?.password || ''),
                enabled: true,
            };
            if (!client.url) return res.status(400).json({ error: `${downloadClientLabel(clientType)} URL is required.` });
            const downloads = await fetchDownloadClientTorrents(client);
            return res.json({
                ok: true,
                message: `${downloadClientLabel(client.type)} connected (${Array.isArray(downloads) ? downloads.length : 0} downloads)`,
                details: { downloadCount: Array.isArray(downloads) ? downloads.length : 0, clientType: client.type },
            });
        }

        if (type === 'tautulli') {
            const url = resolveIntegrationUrlForTest(tautulliUrl, stored.tautulliUrl);
            const apiKey = resolveTestCredential(tautulliApiKey, stored.tautulliApiKey);
            if (!url || !apiKey) return res.status(400).json({ error: 'Tautulli URL and API key are required.' });
            const infoRes = await fetchWithTimeout(`${url}/api/v2?apikey=${encodeURIComponent(apiKey)}&cmd=get_server_info`, {
                headers: { Accept: 'application/json' },
            }, 12000);
            if (!infoRes.ok) throw new Error(`Tautulli returned HTTP ${infoRes.status}`);
            const payload = await infoRes.json();
            if (payload?.response?.result !== 'success') throw new Error(payload?.response?.message || 'Tautulli API error');
            const info = payload.response.data || {};
            return res.json({ ok: true, message: `Tautulli connected (${info.pms_name || 'Plex'})`, details: { pmsVersion: info.pms_version, pmsPlatform: info.pms_platform } });
        }

        if (type === 'jellystat') {
            const url = resolveIntegrationUrlForTest(jellystatUrl, stored.jellystatUrl);
            const apiKey = resolveTestCredential(jellystatApiKey, stored.jellystatApiKey);
            if (!url || !apiKey) return res.status(400).json({ error: 'Jellystat URL and API key are required.' });
            const statsRes = await fetchWithTimeout(`${url}/stats/getViewsByLibraryType?days=30`, {
                headers: { Accept: 'application/json', 'x-api-token': apiKey },
            }, 12000);
            if (!statsRes.ok) throw new Error(`Jellystat returned HTTP ${statsRes.status}`);
            const data = await statsRes.json().catch(() => null);
            return res.json({ ok: true, message: 'Jellystat connected', details: { sample: data ? true : false } });
        }

        if (type === 'jellyglance') {
            const url = resolveIntegrationUrlForTest(jellyglanceUrl, stored.jellyglanceUrl);
            const apiKey = resolveTestCredential(jellyglanceApiKey, stored.jellyglanceApiKey);
            if (!url || !apiKey) return res.status(400).json({ error: 'JellyGlance URL and API key are required.' });
            const statsRes = await fetchWithTimeout(`${url}/stats/getViewsByLibraryType?days=30`, {
                headers: { Accept: 'application/json', 'x-api-token': apiKey },
            }, 12000);
            if (!statsRes.ok) throw new Error(`JellyGlance returned HTTP ${statsRes.status}`);
            const data = await statsRes.json().catch(() => null);
            return res.json({ ok: true, message: 'JellyGlance connected', details: { sample: data ? true : false } });
        }

        if (type === 'requestApp') {
            const appType = String(resolveTestCredential(requestAppType, stored.requestAppType) || 'none').toLowerCase();
            const publicUrl = resolveIntegrationUrlForTest(requestAppUrl, stored.requestAppUrl);
            const fetchUrlInput = resolveTestCredential(requestAppFetchUrl, stored.requestAppFetchUrl);
            const fetchUrl = fetchUrlInput
                ? sanitizeIntegrationUrl(String(fetchUrlInput).trim())
                : (process.env.REQUEST_APP_INTERNAL_URL
                    ? resolveIntegrationUrlForFetch(process.env.REQUEST_APP_INTERNAL_URL)
                    : publicUrl);
            const apiKey = resolveTestCredential(requestAppApiKey, stored.requestAppApiKey);
            if (appType === 'none') return res.status(400).json({ error: 'Request app type must be selected.' });
            if (!publicUrl || !apiKey) return res.status(400).json({ error: 'Request app URL and API key are required.' });
            if (isSeerrFamilyRequestApp(appType)) {
                const result = await testSeerrFamilyConnection(fetchUrl, apiKey);
                const via = fetchUrl !== publicUrl ? ` (via internal fetch URL)` : '';
                return res.json({ ok: true, message: `${result.message}${via}`, details: { version: result.version, fetchUrl } });
            }
            if (appType === 'ombi') {
                const headers = { Accept: 'application/json', 'X-Api-Key': apiKey };
                const aboutRes = await fetchWithTimeout(`${fetchUrl}/api/v1/Settings/about`, { headers }, 12000);
                if (!aboutRes.ok) throw new Error(`Ombi returned HTTP ${aboutRes.status}`);
                const data = await aboutRes.json().catch(() => ({}));
                return res.json({ ok: true, message: `Ombi v${data.version || data.applicationVersion || '?'} connected`, details: { version: data.version || data.applicationVersion } });
            }
            return res.status(400).json({ error: 'Unsupported request app type.' });
        }

        if (type === 'tmdb') {
            const apiKey = resolveTestCredential(tmdbApiKey, stored.tmdbApiKey);
            if (!apiKey) return res.status(400).json({ error: 'TMDB API key is required.' });
            const configRes = await fetchWithTimeout(
                `https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(apiKey)}`,
                { headers: { Accept: 'application/json' } },
                12000,
            );
            if (!configRes.ok) {
                if (configRes.status === 401) throw new Error('TMDB rejected the API key (unauthorized).');
                throw new Error(`TMDB returned HTTP ${configRes.status}`);
            }
            return res.json({ ok: true, message: 'TMDB API key accepted.' });
        }

        return res.status(400).json({ error: 'Unknown integration type.' });
    } catch (e) {
        log(`Integration test failed (${type}): ${e.message}`);
        res.status(500).json({ error: e.message || 'Connection test failed.' });
    }
});

let cachedPlexConnectionUri = null;
let lastPlexConnectionUriFetch = 0;

const isLoopbackPlexUri = (uri = '') => {
    try {
        const { hostname } = new URL(uri);
        return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    } catch (e) {
        return false;
    }
};

const shouldPreferRemotePlexConnection = () => {
    const override = String(process.env.PLEX_PREFER_REMOTE_CONNECTION || '').toLowerCase();
    if (override === 'true') return true;
    if (override === 'false') return false;
    // Inside Docker, Plex "local" URLs usually mean the container loopback — not the host.
    return fsSync.existsSync('/.dockerenv');
};

const pickPlexConnection = (connections = []) => {
    if (!Array.isArray(connections) || connections.length === 0) return null;
    if (shouldPreferRemotePlexConnection()) {
        const remote = connections.find(c => !c.local && !isLoopbackPlexUri(c.uri));
        if (remote) return remote;
        const nonLoopback = connections.find(c => !isLoopbackPlexUri(c.uri));
        if (nonLoopback) return nonLoopback;
    }
    return connections.find(c => c.local) || connections[0];
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = 15000) => {
    // Callers (e.g. fetchArrInstance) may own AbortSignal + timeoutMs — don't double-abort.
    const { timeoutMs: optTimeout, signal: outerSignal, ...rest } = options;
    const ms = Number(optTimeout) > 0 ? Number(optTimeout) : timeoutMs;
    const controller = outerSignal ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), ms) : null;
    try {
        const urlStr = String(url || '');
        const existing = rest.headers || {};
        const hasPlexId = !!(existing['X-Plex-Client-Identifier'] || existing['x-plex-client-identifier']);
        // Safety net: any tokenised PMS/plex.tv URL must carry our stable device identity
        // (otherwise Plex names the device after the Docker container hostname).
        const needsPlexIdentity = !hasPlexId && (
            urlStr.includes('X-Plex-Token=')
            || urlStr.includes('plex.tv/')
            || (existing['X-Plex-Token'] || existing['x-plex-token'])
        );
        let headers = existing;
        if (needsPlexIdentity) {
            let token = existing['X-Plex-Token'] || existing['x-plex-token'] || '';
            if (!token) {
                const match = urlStr.match(/[?&]X-Plex-Token=([^&]+)/i);
                if (match) {
                    try { token = decodeURIComponent(match[1]); } catch { token = match[1]; }
                }
            }
            headers = { ...plexClientHeaders(token), ...existing };
        }
        return await fetch(url, {
            ...rest,
            headers,
            signal: outerSignal || controller.signal,
        });
    } finally {
        if (timer) clearTimeout(timer);
    }
};

const requestAppService = createRequestAppService({ fetchWithTimeout, resolveIntegrationUrlForFetch, resolveRequestAppFetchUrl });

const normalizePlexToken = (token) => {
    if (token === undefined || token === null || token === SECRET_MASK) return token;
    return String(token).trim();
};

const resolveConfiguredPlexServerUrl = (config = {}) => {
    const fromConfig = String(config.plexServerUrl || '').trim().replace(/\/+$/, '');
    const fromEnv = String(process.env.PLEX_SERVER_URL || '').trim().replace(/\/+$/, '');
    return fromConfig || fromEnv;
};

const resolvePlexServerUrlForVerification = async (plexToken, config = {}, serverIdentifier = '') => {
    const configured = resolveConfiguredPlexServerUrl(config);
    if (configured && !(isLoopbackPlexUri(configured) && shouldPreferRemotePlexConnection())) {
        return configured;
    }

    const sid = String(serverIdentifier || config.serverIdentifier || '').trim();
    const token = normalizePlexToken(plexToken);
    if (!token || !sid || token === SECRET_MASK) return configured;

    try {
        const response = await fetchWithTimeout('https://plex.tv/api/v2/resources?includeHttps=1', {
            headers: plexClientHeaders(token),
        }, 10000);
        if (!response.ok) return configured;
        const resources = await response.json();
        const server = resources.find((r) => r.clientIdentifier === sid);
        const conn = pickPlexConnection(server?.connections || []);
        if (conn?.uri) {
            const discovered = String(conn.uri).replace(/\/+$/, '');
            log(`Discovered Plex server URL for verification: ${discovered}`);
            return discovered;
        }
    } catch (e) {
        log(`Plex server URL discovery failed: ${e.message}`);
    }

    return configured;
};

const fetchOwnedPlexServers = async (plexToken) => {
    const response = await fetch('https://plex.tv/pms/servers', {
        headers: plexClientHeaders(plexToken, { Accept: 'application/xml' }),
    });
    if (!response.ok) {
        const errorText = await response.text();
        log(`Error fetching Plex servers (XML). Status: ${response.status}. Response: ${errorText}`);
        throw new Error('Failed to fetch servers from Plex. Please double-check your Plex account.');
    }
    const xmlText = await response.text();
    const serverTags = xmlText.match(/<Server\b[^>]*\/?>/g) || [];
    return serverTags.map((tag) => {
        const nameMatch = tag.match(/name="([^"]+)"/);
        const idMatch = tag.match(/machineIdentifier="([^"]+)"/);
        if (idMatch) {
            return { name: nameMatch ? nameMatch[1] : 'Unknown', identifier: idMatch[1] };
        }
        return null;
    }).filter(Boolean);
};

const validatePlexServerAdminToken = async (plexToken, plexServerUrl) => {
    const token = normalizePlexToken(plexToken);
    const directUrl = resolveIntegrationUrlForFetch(plexServerUrl);
    if (!token || !directUrl) return false;
    try {
        const res = await fetchWithTimeout(`${directUrl}/library/sections?X-Plex-Container-Size=1`, {
            headers: plexClientHeaders(token),
        }, 6000);
        return res.ok;
    } catch {
        return false;
    }
};

const verifyInitialSetupPlexOwner = async (plexToken, serverIdentifier, plexServerUrl = '', config = null) => {
    const token = normalizePlexToken(plexToken);
    if (!token || !serverIdentifier || token === SECRET_MASK) return false;
    try {
        const servers = await fetchOwnedPlexServers(token);
        if (servers.some(server => String(server.identifier) === String(serverIdentifier))) {
            return true;
        }
    } catch (e) {
        log(`Initial setup Plex owner verification via Plex.tv failed: ${e.message}`);
    }

    const cfg = config || {};
    let directUrl = String(plexServerUrl || '').trim() || resolveConfiguredPlexServerUrl(cfg);
    if (!directUrl || (isLoopbackPlexUri(directUrl) && shouldPreferRemotePlexConnection())) {
        directUrl = await resolvePlexServerUrlForVerification(token, cfg, serverIdentifier);
    }
    if (directUrl) {
        try {
            const baseUrl = resolveIntegrationUrlForFetch(directUrl);
            const identityRes = await fetchWithTimeout(`${baseUrl}/identity`, {
                headers: plexClientHeaders(token),
            }, 6000);
            if (!identityRes.ok) return false;

            const identityText = await identityRes.text();
            let machineIdentifier = '';
            try {
                const parsed = JSON.parse(identityText);
                const container = parsed?.MediaContainer || parsed || {};
                machineIdentifier = String(container.machineIdentifier || '');
            } catch {
                const machineMatch = identityText.match(/machineIdentifier="([^"]+)"/i)
                    || identityText.match(/<machineIdentifier>([^<]+)<\/machineIdentifier>/i);
                machineIdentifier = machineMatch ? String(machineMatch[1]) : '';
            }

            if (machineIdentifier && String(machineIdentifier) === String(serverIdentifier)) {
                return validatePlexServerAdminToken(token, directUrl);
            }
        } catch (e) {
            log(`Initial setup Plex owner verification via direct URL failed: ${e.message}`);
        }
    }

    return false;
};

// Plex interaction helpers
let cachedPlexAccounts = null;
let cachedPlexAccountsAt = 0;

const fetchPlexServerAccounts = async (uri, config) => {
    if (cachedPlexAccounts && (Date.now() - cachedPlexAccountsAt < 5 * 60 * 1000)) {
        return cachedPlexAccounts;
    }
    const accountsRes = await fetchWithTimeout(`${uri}/accounts?X-Plex-Token=${config.plexToken}`, {
        headers: plexClientHeaders(config.plexToken),
    }, 8000).then(r => r.json()).catch(() => null);

    const accounts = accountsRes?.MediaContainer?.Account || [];
    const map = {};
    accounts.forEach((acc) => {
        map[String(acc.id)] = {
            id: String(acc.id),
            name: acc.name || '',
            thumb: acc.thumb || null,
        };
    });
    cachedPlexAccounts = { list: accounts, map };
    cachedPlexAccountsAt = Date.now();
    return cachedPlexAccounts;
};

const resolveLocalPlexAccountId = async (config, uri, sessionUser) => {
    const norm = (v) => String(v || '').trim().toLowerCase();
    const users = await loadFile(USERS_PATH, []);
    const portalUser = findLocalUserForSession(users, sessionUser);
    if (portalUser?.plexAccountId) return String(portalUser.plexAccountId);

    const { list: accounts } = await fetchPlexServerAccounts(uri, config);
    if (!accounts.length) {
        return sessionUser?.plexId ? String(sessionUser.plexId) : null;
    }

    const byName = accounts.find((a) => norm(a.name) === norm(sessionUser?.username));
    if (byName) return String(byName.id);

    if (sessionUser?.email) {
        const byEmail = accounts.find((a) =>
            norm(a.name) === norm(sessionUser.email) || norm(a.email) === norm(sessionUser.email),
        );
        if (byEmail) return String(byEmail.id);
    }

    if (sessionUser?.plexId) {
        const byPlexId = accounts.find((a) => String(a.id) === String(sessionUser.plexId));
        if (byPlexId) return String(byPlexId.id);
    }

    // Home admin is usually local account 1, but only as a last resort for admins.
    if (sessionUser?.isAdmin) {
        const home = accounts.find((a) => String(a.id) === '1') || accounts[0];
        if (home) return String(home.id);
    }

    return null;
};

const getPlexConnectionUri = async (config) => {
    if (cachedPlexConnectionUri && (Date.now() - lastPlexConnectionUriFetch < 60 * 60 * 1000)) {
        return cachedPlexConnectionUri;
    }

    let directUrl = resolveConfiguredPlexServerUrl(config);
    if (!directUrl || (isLoopbackPlexUri(directUrl) && shouldPreferRemotePlexConnection())) {
        directUrl = await resolvePlexServerUrlForVerification(config.plexToken, config, config.serverIdentifier);
    }
    if (directUrl) {
        const normalized = resolveIntegrationUrlForFetch(directUrl);
        if (normalized) {
            try {
                const probe = await fetchWithTimeout(`${normalized}/identity`, {
                    headers: plexClientHeaders(config.plexToken),
                }, 4000);
                if (probe.ok) {
                    cachedPlexConnectionUri = normalized;
                    lastPlexConnectionUriFetch = Date.now();
                    log(`Using direct Plex server URL: ${cachedPlexConnectionUri}`);
                    return cachedPlexConnectionUri;
                }
            } catch (e) {
                log(`Direct Plex URL probe failed (${directUrl}): ${e.message}`);
            }
        }
    }

    const response = await fetchWithTimeout('https://plex.tv/api/v2/resources?includeHttps=1', {
        headers: plexClientHeaders(config.plexToken)
    }, 20000);
    if (!response.ok) throw new Error('Failed to fetch resources from Plex.tv');
    const resources = await response.json();
    const server = resources.find(r => r.clientIdentifier === config.serverIdentifier);
    if (!server || !server.connections || server.connections.length === 0) throw new Error('Server not found');
    const connection = pickPlexConnection(server.connections);
    if (!connection?.uri) throw new Error('No usable Plex connection found');
    cachedPlexConnectionUri = connection.uri;
    lastPlexConnectionUriFetch = Date.now();
    if (shouldPreferRemotePlexConnection()) {
        log(`Using Plex connection URI for container runtime: ${cachedPlexConnectionUri}`);
    }
    return cachedPlexConnectionUri;
};

const listPlexLibrariesForConfig = async (config) => {
    const uri = await getPlexConnectionUri(config);
    if (!uri) throw new Error('Cannot connect to Plex');
    const token = normalizePlexToken(config.plexToken);
    if (!token) throw new Error('Plex token is required');

    const sectionsRes = await fetchWithTimeout(
        `${uri}/library/sections?X-Plex-Token=${encodeURIComponent(token)}`,
        { headers: plexClientHeaders(config.plexToken) },
        15000,
    ).then((r) => r.json()).catch(() => null);

    const directories = sectionsRes?.MediaContainer?.Directory;
    if (!Array.isArray(directories)) return [];
    return directories.map((section) => ({
        id: section.key,
        title: section.title,
        type: section.type,
    }));
};

const isSafePlexMediaPath = (rawPath) => {
    const thumbPath = String(rawPath || '');
    if (!thumbPath.startsWith('/') || thumbPath.startsWith('//')) return false;
    if (thumbPath.includes('://') || thumbPath.includes('\\')) return false;
    if (thumbPath.includes('..')) return false;
    // Disallow control chars / whitespace that can confuse upstream URL parsers
    if (/[\s\x00-\x1f\x7f]/.test(thumbPath)) return false;
    return true;
};

app.get('/api/plex/image', requireAuth, requireMember, async (req, res) => {
    const { path: thumbPath, width, height } = req.query;
    if (!thumbPath) return res.status(400).send('path required');
    // Security: only allow relative Plex paths — block protocol-relative and absolute URLs
    if (!isSafePlexMediaPath(thumbPath)) {
        return res.status(400).send('Invalid path');
    }
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const uri = await getPlexConnectionUri(config);

        let url;
        if (width && height) {
            url = `${uri}/photo/:/transcode?url=${encodeURIComponent(thumbPath)}&width=${encodeURIComponent(width)}&height=${encodeURIComponent(height)}&minSize=1&X-Plex-Token=${config.plexToken}`;
        } else {
            url = `${uri}${thumbPath}?X-Plex-Token=${config.plexToken}`;
        }

        const response = await fetchWithTimeout(url, { headers: plexClientHeaders(config.plexToken) }, 15000);
        if (!response.ok) throw new Error('fetch failed');
        const buffer = Buffer.from(await response.arrayBuffer());
        res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(buffer);
    } catch (e) {
        res.status(500).send('');
    }
});

// ─── Plex Library Size Background Task ───────────────────────────────────────
// The library sizes are computed once every 24 hours in the background.
// The /api/plex/stats endpoint ONLY reads from the cache file — it never
// triggers a Plex fetch itself.

let cachedPlexStats = null;          // in-memory mirror of the cache file
let isBuildingPlexStats = false;

/**
 * Reads the cached stats from disk into memory.
 * Returns the stats object, or null if no valid cache exists yet.
 */
const loadPlexStatsFromDisk = async () => {
    try {
        const raw = await fs.readFile(PLEX_STATS_CACHE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.moviesBytes !== undefined) {
            cachedPlexStats = parsed;
            return parsed;
        }
    } catch (e) {
        // file doesn't exist yet — fine
    }
    return null;
};

/**
 * Crawls Plex for library sizes (paginated, 1 000 items per request).
 * Writes results to plex-stats.json and updates the in-memory cache.
 * Never throws — errors are logged and the function returns null.
 */
const buildPlexStatsCache = async () => {
    if (isBuildingPlexStats) {
        log('[PlexStats] Build already in progress, skipping.');
        return;
    }
    const config = await loadFile(CONFIG_PATH, null);
    if (!config || !config.plexToken || !config.serverIdentifier) {
        log('[PlexStats] Not configured yet — skipping build.');
        return;
    }
    isBuildingPlexStats = true;
    markTaskStart(systemJobs.plexStats);
    log('[PlexStats] Starting background library size build...');
    try {
        const uri = await getPlexConnectionUri(config);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 600000); // 10 min hard cap

        const sectionsRes = await fetch(`${uri}/library/sections`, {
            headers: plexClientHeaders(config.plexToken),
            signal: controller.signal
        });
        if (!sectionsRes.ok) throw new Error(`Sections request failed: ${sectionsRes.status}`);
        const { MediaContainer: { Directory: directories = [] } } = await sectionsRes.json();

        let totalMoviesCount = 0, totalShowsCount = 0, totalMusicCount = 0;
        let totalEpisodesCount = 0, totalArtistsCount = 0, totalAlbumsCount = 0, totalTracksCount = 0;
        let totalMoviesBytes = 0, totalShowsBytes = 0, totalMusicBytes = 0;
        let total4kMovies = 0;
        const fourKShows = new Set();

        const resolutions = { '4K': 0, '1080p': 0, '720p': 0, 'SD': 0, 'Other': 0 };
        const codecs = { 'H.265 / HEVC': 0, 'H.264 / AVC': 0, 'AV1': 0, 'Other': 0 };
        const fileSizes = {
            '0 - 500 MB': { movies: 0, shows: 0 },
            '500 MB - 1.5 GB': { movies: 0, shows: 0 },
            '1.5 GB - 5 GB': { movies: 0, shows: 0 },
            '5 GB - 10 GB': { movies: 0, shows: 0 },
            '10 GB+': { movies: 0, shows: 0 }
        };

        for (const dir of directories) {
            try {
                // ── Item count (single zero-size request) ──
                const countRes = await fetch(
                    `${uri}/library/sections/${dir.key}/all?X-Plex-Container-Start=0&X-Plex-Container-Size=0`,
                    { headers: plexClientHeaders(config.plexToken), signal: controller.signal }
                );
                if (countRes.ok) {
                    const { MediaContainer: mc } = await countRes.json();
                    const count = mc.totalSize || mc.size || 0;
                    if (dir.type === 'movie') {
                        totalMoviesCount += count;
                    } else if (dir.type === 'show') {
                        totalShowsCount += count;
                    } else if (dir.type === 'artist') {
                        totalMusicCount += count;
                        totalArtistsCount += count;
                        // Also fetch album count (type 9)
                        const albCountRes = await fetch(
                            `${uri}/library/sections/${dir.key}/all?type=9&X-Plex-Container-Start=0&X-Plex-Container-Size=1`,
                            { headers: plexClientHeaders(config.plexToken), signal: controller.signal }
                        );
                        if (albCountRes.ok) {
                            const { MediaContainer: albMc } = await albCountRes.json();
                            totalAlbumsCount += albMc.totalSize || albMc.size || 0;
                        }
                    }
                }

                // ── Bytes (paginated) ──
                const typeParam = dir.type === 'movie' ? '?type=1' : dir.type === 'show' ? '?type=4' : dir.type === 'artist' ? '?type=10' : '';
                if (!typeParam) continue;

                let start = 0, bytes = 0;
                const PAGE = 1000;
                while (true) {
                    const pageRes = await fetch(
                        `${uri}/library/sections/${dir.key}/all${typeParam}&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${PAGE}`,
                        { headers: plexClientHeaders(config.plexToken), signal: controller.signal }
                    );
                    if (!pageRes.ok) break;
                    const { MediaContainer: { Metadata: items = [] } } = await pageRes.json();
                    if (items.length === 0) break;
                    
                    if (dir.type === 'show') totalEpisodesCount += items.length;
                    else if (dir.type === 'artist') totalTracksCount += items.length;

                    for (const item of items) {
                        let is4k = false;
                        for (const media of item.Media || []) {
                            if (media.videoResolution === '4k') is4k = true;

                            if (dir.type === 'movie' || dir.type === 'show') {
                                const res = String(media.videoResolution || '').toLowerCase();
                                if (res === '4k' || res === '2160') resolutions['4K']++;
                                else if (res === '1080') resolutions['1080p']++;
                                else if (res === '720') resolutions['720p']++;
                                else if (res === '576' || res === '480' || res === 'sd') resolutions['SD']++;
                                else resolutions['Other']++;

                                const codec = String(media.videoCodec || '').toLowerCase();
                                if (codec === 'hevc' || codec === 'h265') codecs['H.265 / HEVC']++;
                                else if (codec === 'h264' || codec === 'avc') codecs['H.264 / AVC']++;
                                else if (codec === 'av1') codecs['AV1']++;
                                else codecs['Other']++;
                            }

                            for (const part of media.Part || []) {
                                if (part.size) {
                                    const partSize = parseInt(part.size);
                                    bytes += partSize;

                                    if (dir.type === 'movie') {
                                        const sizeMB = partSize / (1024 * 1024);
                                        if (sizeMB < 500) fileSizes['0 - 500 MB'].movies++;
                                        else if (sizeMB < 1500) fileSizes['500 MB - 1.5 GB'].movies++;
                                        else if (sizeMB < 5000) fileSizes['1.5 GB - 5 GB'].movies++;
                                        else if (sizeMB < 10000) fileSizes['5 GB - 10 GB'].movies++;
                                        else fileSizes['10 GB+'].movies++;
                                    } else if (dir.type === 'show') {
                                        const sizeMB = partSize / (1024 * 1024);
                                        if (sizeMB < 500) fileSizes['0 - 500 MB'].shows++;
                                        else if (sizeMB < 1500) fileSizes['500 MB - 1.5 GB'].shows++;
                                        else if (sizeMB < 5000) fileSizes['1.5 GB - 5 GB'].shows++;
                                        else if (sizeMB < 10000) fileSizes['5 GB - 10 GB'].shows++;
                                        else fileSizes['10 GB+'].shows++;
                                    }
                                }
                            }
                        }
                        if (is4k) {
                            if (dir.type === 'movie') total4kMovies++;
                            else if (dir.type === 'show') fourKShows.add(item.grandparentRatingKey || item.parentRatingKey || item.title);
                        }
                    }
                    start += PAGE;
                }
                if (dir.type === 'movie') totalMoviesBytes += bytes;
                else if (dir.type === 'show') totalShowsBytes += bytes;
                else if (dir.type === 'artist') totalMusicBytes += bytes;
            } catch (e) {
                log(`[PlexStats] Failed to fetch section "${dir.title}": ${e.message}`);
            }
        }
        clearTimeout(timer);

        const totalVideoTitles = totalMoviesCount + totalShowsCount;
        const total4kTitles = total4kMovies + fourKShows.size;
        const existingStats = await loadFile(PLEX_STATS_CACHE_PATH, {});

        const deltas = existingStats.deltas || {};
        if (existingStats.movies !== undefined) {
            deltas.movies = totalMoviesCount - (existingStats.movies || 0);
            deltas.shows = totalShowsCount - (existingStats.shows || 0);
            deltas.episodes = totalEpisodesCount - (existingStats.episodes || 0);
            deltas.artists = totalArtistsCount - (existingStats.artists || 0);
            deltas.albums = totalAlbumsCount - (existingStats.albums || 0);
            deltas.tracks = totalTracksCount - (existingStats.tracks || 0);
        }

        const stats = {
            movies: totalMoviesCount, shows: totalShowsCount, music: totalMusicCount,
            episodes: totalEpisodesCount, artists: totalArtistsCount, albums: totalAlbumsCount, tracks: totalTracksCount,
            moviesBytes: totalMoviesBytes, showsBytes: totalShowsBytes, musicBytes: totalMusicBytes,
            fourKPercent: totalVideoTitles > 0 ? Math.round((total4kTitles / totalVideoTitles) * 100) : 0,
            maxConcurrentStreams: existingStats.maxConcurrentStreams || 0,
            maxDirectPlays: existingStats.maxDirectPlays || 0,
            maxTranscodes: existingStats.maxTranscodes || 0,
            deltas,
            resolutions,
            codecs,
            fileSizes,
            generatedAt: Date.now()
        };
        cachedPlexStats = stats;
        await fs.writeFile(PLEX_STATS_CACHE_PATH, JSON.stringify(stats, null, 2));
        log(`[PlexStats] Cache built and saved — movies: ${totalMoviesCount}, shows: ${totalShowsCount}, music: ${totalMusicCount}, episodes: ${totalEpisodesCount}, artists: ${totalArtistsCount}, albums: ${totalAlbumsCount}, tracks: ${totalTracksCount}`);
        markTaskEnd(systemJobs.plexStats, null);
    } catch (e) {
        log(`[PlexStats] Build failed: ${e.message}`);
        markTaskEnd(systemJobs.plexStats, e);
    } finally {
        isBuildingPlexStats = false;
    }
};

/**
 * Called once at startup.
 * 1. Loads existing cache from disk immediately (so the API responds instantly).
 * 2. If cache is older than 24 h (or missing), kicks off a fresh build.
 * 3. Schedules a rebuild every 24 hours.
 */
const startPlexStatsBackgroundTask = async () => {
    const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

    const existing = await loadPlexStatsFromDisk();
    if (existing) {
        const ageMs = Date.now() - (existing.generatedAt || 0);
        const remainingMs = Math.max(0, INTERVAL_MS - ageMs);
        systemJobs.plexStats.nextRun = new Date(Date.now() + (ageMs >= INTERVAL_MS ? 0 : remainingMs)).toISOString();
        log(`[PlexStats] Loaded existing cache (age: ${Math.round(ageMs / 60000)} min).`);
        if (ageMs >= INTERVAL_MS) {
            log('[PlexStats] Cache is stale — triggering immediate rebuild.');
            buildPlexStatsCache(); // async, don't await
        }
    } else {
        systemJobs.plexStats.nextRun = new Date(Date.now() + INTERVAL_MS).toISOString();
        log('[PlexStats] No cache found — triggering initial build.');
        buildPlexStatsCache(); // async, don't await
    }

    // Schedule recurring rebuild every 24 hours
    setInterval(() => {
        log('[PlexStats] Scheduled 24-hour rebuild starting...');
        systemJobs.plexStats.nextRun = new Date(Date.now() + INTERVAL_MS).toISOString();
        buildPlexStatsCache();
    }, INTERVAL_MS);
};

// ── API endpoint — read-only, never triggers a Plex fetch ──
app.get('/api/plex/stats', requireAuth, requireMember, async (req, res) => {
    if (cachedPlexStats) {
        return res.json(cachedPlexStats);
    }
    // Cache not ready yet — try disk one more time
    const disk = await loadPlexStatsFromDisk();
    if (disk) return res.json(disk);
    // Still nothing — build is running in background
    return res.json({
        movies: 0, shows: 0, music: 0,
        moviesBytes: 0, showsBytes: 0, musicBytes: 0,
        isBuilding: true
    });
});

// Admin-only: manually trigger a library size rebuild
app.post('/api/plex/stats/rebuild', requireAdmin, async (req, res) => {
    if (isBuildingPlexStats) {
        return res.json({ status: 'already_running', message: 'A rebuild is already in progress.' });
    }
    // Fire async — don't block the response
    buildPlexStatsCache();
    return res.json({ status: 'started', message: 'Library size rebuild started in the background.' });
});

// Admin-only: get the current build status and last generated timestamp
app.get('/api/plex/stats/status', requireAdmin, async (req, res) => {
    const stats = cachedPlexStats || await loadPlexStatsFromDisk();
    return res.json({
        isBuilding: isBuildingPlexStats,
        lastGeneratedAt: stats?.generatedAt || null,
        hasCache: !!stats
    });
});

const calculateUptime30Days = (healthDataObj) => {
    if (!healthDataObj) return 100;

    let totalUp = 0;
    let totalChecks = 0;

    for (const [key, service] of Object.entries(healthDataObj)) {
        if (key === '_meta' || !service.dailyHistory) continue;

        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        for (const [dateStr, stat] of Object.entries(service.dailyHistory)) {
            if (new Date(dateStr).getTime() >= thirtyDaysAgo) {
                totalUp += stat.up || 0;
                totalChecks += stat.total || 0;
            }
        }
    }

    if (totalChecks === 0) return 100;
    return (totalUp / totalChecks) * 100;
};

const fetchImageBuffer = async (config, thumbPath) => {
    if (!thumbPath) return null;
    try {
        const uri = await getPlexConnectionUri(config);
        const transcodeUrl = `/photo/:/transcode?width=150&height=225&minSize=1&upscale=1&url=${encodeURIComponent(thumbPath)}`;
        const url = `${uri}${transcodeUrl}&X-Plex-Token=${config.plexToken}`;
        const res = await fetch(url, { headers: plexClientHeaders(config.plexToken) });
        if (res.ok) {
            return Buffer.from(await res.arrayBuffer());
        }
    } catch (e) { }
    return null;
};

const uniqueTruthy = (values = []) => [...new Set(values.flat().filter(Boolean).map((value) => String(value)))];

const fetchJellyfinImageBufferForNewsletter = async (config, itemIds, { width = 150, height = 225 } = {}) => {
    const candidates = uniqueTruthy(Array.isArray(itemIds) ? itemIds : [itemIds]);
    if (candidates.length === 0) return null;
    const imageTypes = ['Primary', 'Thumb', 'Backdrop'];

    try {
        const baseUrl = resolveIntegrationUrlForFetch(config.jellyfinUrl);
        for (const candidate of candidates) {
            const [itemId, imageTag = ''] = candidate.split('|');
            if (!itemId) continue;
            for (const imageType of imageTypes) {
                try {
                    const params = new URLSearchParams({
                        fillWidth: String(width),
                        fillHeight: String(height),
                        quality: '90',
                    });
                    if (imageTag) params.set('tag', imageTag);
                    const imageUrl = `${baseUrl}/Items/${encodeURIComponent(itemId)}/Images/${imageType}?${params.toString()}`;
                    const response = await fetchWithTimeout(imageUrl, {
                        headers: jellyfinHeaders(config.jellyfinApiKey, { Accept: 'image/*,*/*;q=0.8' }),
                    }, 10000);
                    const contentType = response.headers.get('content-type') || '';
                    if (response.ok && contentType.startsWith('image/')) {
                        return Buffer.from(await response.arrayBuffer());
                    }
                } catch (e) { }
            }
        }
    } catch (e) { }
    return null;
};

const jellyfinImageCandidate = (itemId, tag) => itemId ? `${itemId}${tag ? `|${tag}` : ''}` : '';

const newsletterPlaceholderDataUrl = (width, height, label = 'No Image') => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#111827"/><rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="6" fill="none" stroke="#374151"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#eab308" font-family="Arial, sans-serif" font-size="13" font-weight="700">${escapeHtmlAttr(label)}</text></svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
};

const fetchJellyfinLibraryStatsForNewsletter = async (config) => {
    const fallback = { movies: 0, shows: 0, music: 0 };
    try {
        const baseUrl = resolveIntegrationUrlForFetch(config.jellyfinUrl);
        const fetchCount = async (types) => {
            const params = new URLSearchParams({
                Recursive: 'true',
                IncludeItemTypes: types,
                Limit: '0',
            });
            const response = await fetchWithTimeout(`${baseUrl}/Items?${params.toString()}`, {
                headers: jellyfinHeaders(config.jellyfinApiKey),
            }, 15000);
            if (!response.ok) return 0;
            const data = await response.json().catch(() => ({}));
            return Number(data.TotalRecordCount || 0) || 0;
        };
        const [movies, shows, music] = await Promise.all([
            fetchCount('Movie'),
            fetchCount('Series'),
            fetchCount('MusicAlbum,Audio'),
        ]);
        return {
            movies,
            shows,
            music,
        };
    } catch (e) {
        log(`Jellyfin newsletter library stats failed: ${e.message}`);
        return fallback;
    }
};

const fetchJellyfinServerNameForNewsletter = async (config, providerLabel) => {
    try {
        const baseUrl = resolveIntegrationUrlForFetch(config.jellyfinUrl);
        const response = await fetchWithTimeout(`${baseUrl}/System/Info/Public`, {
            headers: jellyfinHeaders(config.jellyfinApiKey),
        }, 10000);
        const data = response.ok ? await response.json().catch(() => ({})) : {};
        return data.ServerName || data.LocalAddress || `${providerLabel} Server`;
    } catch {
        return `${providerLabel} Server`;
    }
};

const getNewsletterProviderLabel = (config = {}) => {
    const type = String(config?.mediaServerType || 'plex').toLowerCase();
    if (type === 'emby') return 'Emby';
    if (type === 'jellyfin') return 'Jellyfin';
    return 'Plex';
};

const resolveNewsletterTestRecipient = async (config, actor = {}) => {
    if (actor?.email) return actor.email;
    if (String(config?.mediaServerType || 'plex').toLowerCase() !== 'plex') return '';
    try {
        const userRes = await fetch('https://plex.tv/api/v2/user', {
            headers: plexClientHeaders(config.plexToken)
        });
        if (userRes.ok) {
            const userData = await userRes.json();
            return userData.email || '';
        }
    } catch (e) {
        log('Error fetching admin email: ' + e.message);
    }
    return '';
};

const generateNewsletterHtml = async (config, options = {}) => {
    const embedImages = Boolean(options.embedImages);
    const mediaServerType = String(config?.mediaServerType || 'plex').toLowerCase();
    const isJellyfinLike = isEmbyLikeMediaServer(config);
    const providerLabel = getNewsletterProviderLabel(config);
    const stats = isJellyfinLike
        ? await fetchJellyfinLibraryStatsForNewsletter(config)
        : (cachedPlexStats || await loadPlexStatsFromDisk() || { movies: 0, shows: 0, music: 0 });
    let recentHtml = '';
    let serverName = isJellyfinLike ? `${providerLabel} Server` : 'our Plex Server';
    const attachments = [];
    let cidCounter = 1;

    try {
        const logoPath = path.join(process.cwd(), 'static', 'logo.png');
        const logoBuf = await fs.readFile(logoPath).catch(() => null);
        if (logoBuf) {
            attachments.push({ filename: 'logo.png', content: logoBuf, cid: 'logo' });
        }
    } catch (e) { }

    try {
        const uri = isJellyfinLike ? '' : await getPlexConnectionUri(config);

        // serverName is declared at function scope above
        if (isJellyfinLike) {
            serverName = await fetchJellyfinServerNameForNewsletter(config, providerLabel);
        } else {
            try {
            const serverRes = await fetch(`${uri}/?X-Plex-Token=${config.plexToken}`, {
                headers: plexClientHeaders(config.plexToken)
            });
            const serverData = await serverRes.json();
            if (serverData?.MediaContainer?.friendlyName) {
                serverName = serverData.MediaContainer.friendlyName;
            }
            } catch (e) { }
        }

        const movies = [];
        const tvShowsMap = new Map();
        const music = [];

        if (isJellyfinLike) {
            const [recentMovies, recentEpisodes, recentMusic] = await Promise.all([
                fetchJellyfinItems(config, 'Movie', 100).catch((e) => { log(`Jellyfin newsletter movies failed: ${e.message}`); return []; }),
                fetchJellyfinItems(config, 'Episode', 100).catch((e) => { log(`Jellyfin newsletter episodes failed: ${e.message}`); return []; }),
                fetchJellyfinItems(config, 'MusicAlbum,Audio', 100).catch((e) => { log(`Jellyfin newsletter music failed: ${e.message}`); return []; }),
            ]);
            recentMovies.forEach((item) => movies.push({
                ratingKey: item.Id,
                title: item.Name,
                thumb: item.Id,
                imageCandidates: [
                    jellyfinImageCandidate(item.PrimaryImageItemId, item.ImageTags?.Primary),
                    jellyfinImageCandidate(item.Id, item.ImageTags?.Primary),
                ],
                itemUrl: jellyfinItemUrl(config, item.Id),
            }));
            recentEpisodes.forEach((item) => {
                const showKey = item.SeriesId || item.ParentId || item.Id;
                if (!tvShowsMap.has(showKey)) {
                    tvShowsMap.set(showKey, {
                        ratingKey: showKey,
                        title: item.SeriesName || item.Name,
                        thumb: item.SeriesId || item.ParentId || item.Id,
                        imageCandidates: [
                            jellyfinImageCandidate(item.SeriesId),
                            jellyfinImageCandidate(item.ParentThumbItemId),
                            jellyfinImageCandidate(item.PrimaryImageItemId, item.ImageTags?.Primary),
                            jellyfinImageCandidate(item.ParentId),
                            jellyfinImageCandidate(item.Id, item.ImageTags?.Primary),
                        ],
                        itemUrl: jellyfinItemUrl(config, item.Id),
                    });
                }
            });
            recentMusic.forEach((item) => music.push({
                ratingKey: item.Id,
                title: item.Album || item.Name,
                thumb: item.Id,
                imageCandidates: [
                    jellyfinImageCandidate(item.PrimaryImageItemId, item.ImageTags?.Primary),
                    jellyfinImageCandidate(item.AlbumId),
                    jellyfinImageCandidate(item.Id, item.ImageTags?.Primary),
                ],
                itemUrl: jellyfinItemUrl(config, item.Id),
            }));
        } else {
            const recentRes = await fetch(`${uri}/library/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=100`, {
                headers: plexClientHeaders(config.plexToken)
            });
            const recentData = await recentRes.json();
            const items = recentData.MediaContainer.Metadata || [];
            items.forEach(item => {
                if (item.type === 'movie') {
                    movies.push(item);
                } else if (item.type === 'season' || item.type === 'episode') {
                    const showKey = item.grandparentRatingKey || item.parentRatingKey || item.ratingKey;
                    if (!tvShowsMap.has(showKey)) {
                        tvShowsMap.set(showKey, {
                            ratingKey: showKey,
                            title: item.grandparentTitle || item.parentTitle || item.title,
                            type: 'TV Show',
                            thumb: item.grandparentThumb || item.parentThumb || item.thumb
                        });
                    }
                } else if (item.type === 'album' || item.type === 'track') {
                    music.push(item);
                }
            });
        }

        const tvShows = Array.from(tvShowsMap.values());

        const renderGrid = async (categoryItems, categoryTitle, isSquare = false) => {
            if (!categoryItems || categoryItems.length === 0) return '';
            const itemsToRender = categoryItems.slice(0, 8);
            const imgWidth = 115;
            const imgHeight = isSquare ? 115 : 173;

            let cols = '';
            for (let i = 0; i < itemsToRender.length; i++) {
                if (i % 4 === 0) cols += '<tr>';

                const item = itemsToRender[i];
                let thumbPath = item.thumb;
                let imageUrl = '';
                const imageCandidates = isJellyfinLike
                    ? uniqueTruthy([item.imageCandidates, thumbPath])
                    : [thumbPath];

                if (imageCandidates.length > 0) {
                    const buf = isJellyfinLike
                        ? await fetchJellyfinImageBufferForNewsletter(config, imageCandidates, { width: imgWidth, height: imgHeight })
                        : await fetchImageBuffer(config, thumbPath);
                    if (buf) {
                        if (embedImages) {
                            imageUrl = `data:image/jpeg;base64,${Buffer.from(buf).toString('base64')}`;
                        } else {
                            const cid = `poster-${cidCounter++}`;
                            attachments.push({ filename: `${cid}.jpg`, content: buf, cid: cid });
                            imageUrl = `cid:${cid}`;
                        }
                    }
                }
                if (!imageUrl) {
                    imageUrl = newsletterPlaceholderDataUrl(imgWidth, imgHeight);
                }

                const itemUrl = item.itemUrl || `https://app.plex.tv/desktop/#!/server/${config.serverIdentifier}/details?key=%2Flibrary%2Fmetadata%2F${item.ratingKey}`;
                cols += `
                    <td width="25%" align="center" valign="top" style="padding: 10px 5px;">
                        <a href="${itemUrl}" style="text-decoration: none; display: block;" target="_blank">
                            <img src="${imageUrl}" width="${imgWidth}" height="${imgHeight}" style="width: ${imgWidth}px; height: ${imgHeight}px; object-fit: cover; border-radius: 6px; border: 1px solid #374151; display: block; margin-bottom: 8px;" alt="Poster" />
                            <h4 style="margin: 0; color: #ffffff; font-size: 12px; font-family: Helvetica, Arial, sans-serif; line-height: 1.3; text-align: center; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">${item.title || item.parentTitle || item.grandparentTitle || 'Unknown'}</h4>
                        </a>
                    </td>
                `;

                if (i % 4 === 3 || i === itemsToRender.length - 1) {
                    if (i === itemsToRender.length - 1) {
                        const remaining = 3 - (i % 4);
                        for (let j = 0; j < remaining; j++) {
                            cols += '<td width="25%"></td>';
                        }
                    }
                    cols += '</tr>';
                }
            }

            return `
                <div style="margin-bottom: 30px;">
                    <h3 style="color: #eab308; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 16px; margin: 0 0 15px 0; padding-left: 10px; border-left: 3px solid #eab308;">${categoryTitle}</h3>
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout: fixed;">
                        ${cols}
                    </table>
                </div>
            `;
        };

        const moviesHtml = await renderGrid(movies, 'Recently Added Movies', false);
        const tvHtml = await renderGrid(tvShows, 'Recently Added TV', false);
        const musicHtml = await renderGrid(music, 'Recently Added Music', true);

        recentHtml = moviesHtml + tvHtml + musicHtml;

    } catch (e) {
        recentHtml = '<p style="color:#a0aec0; text-align:center;">Failed to load recently added content.</p>';
    }

    const uptimeStr = `${calculateUptime30Days(healthData).toFixed(2)}%`;

    const htmlContent = `
                        <!-- Header -->
                        <tr>
                            <td align="center" style="padding: 40px 30px; background-color: #0b0f19; border-bottom: 1px solid #1f2937;">
                                <img src="cid:logo" alt="Server Portal" style="max-width: 280px; height: auto; display: block; margin: 0 auto 10px auto;" />
                                <p style="color: #9ca3af; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 16px; margin: 0;">Here is what's happening on the server</p>
                            </td>
                        </tr>
                        
                        <!-- Stats Row -->
                        <tr>
                            <td style="padding: 30px;">
                                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                                    <tr>
                                        <!-- Uptime -->
                                        <td width="48%" align="center" style="padding: 20px; background-color: rgba(31, 41, 55, 0.6); border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.05); box-shadow: 0 4px 15px rgba(0,0,0,0.3);">
                                            <p style="margin: 0; color: #9ca3af; font-family: Helvetica, Arial, sans-serif; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">30-Day Uptime</p>
                                            <h2 style="margin: 8px 0 0 0; color: #22c55e; font-family: Helvetica, Arial, sans-serif; font-size: 26px;">${uptimeStr}</h2>
                                        </td>
                                        <td width="4%" style="font-size: 0; line-height: 0;">&nbsp;</td>
                                        <!-- Library -->
                                        <td width="48%" align="center" style="padding: 20px; background-color: rgba(31, 41, 55, 0.6); border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.05); box-shadow: 0 4px 15px rgba(0,0,0,0.3);">
                                            <p style="margin: 0; color: #9ca3af; font-family: Helvetica, Arial, sans-serif; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Library Size</p>
                                            <p style="margin: 8px 0 4px 0; color: #ffffff; font-family: Helvetica, Arial, sans-serif; font-size: 15px;"><strong>${stats.movies}</strong> Movies</p>
                                            <p style="margin: 0; color: #ffffff; font-family: Helvetica, Arial, sans-serif; font-size: 15px;"><strong>${stats.shows}</strong> TV Shows</p>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>

                        <!-- Greeting -->
                        <tr>
                            <td style="padding: 0 30px 20px 30px; text-align: center;">
                                <p style="margin: 0; color: #9ca3af; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5;">
                                    <strong>{{USERNAME}}</strong>, you are receiving this newsletter as you are a member of <strong>{{SERVER_NAME}}</strong>.
                                </p>
                            </td>
                        </tr>

                        <!-- Recently Added -->
                        <tr>
                            <td style="padding: 0 30px 30px 30px;">
                                ${recentHtml}
                            </td>
                        </tr>

                        <!-- Footer -->
                        <tr>
                            <td align="center" style="padding: 30px; background-color: #0b0f19; border-top: 1px solid #1f2937;">
                                <p style="margin: 0 0 10px 0; color: #6b7280; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 12px;">This is an automated message from Server Portal Manager.</p>
                                <p style="margin: 0; color: #6b7280; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 12px;">To opt out of these newsletters, please visit your <a href="${resolvePublicBaseUrlFromConfig(config) || config.publicDomain || '#'}" style="color: #eab308; text-decoration: none;">User Portal</a>.</p>
                            </td>
                        </tr>
                    `;

    const finalHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${providerLabel} Server Automated Newsletter</title>
            </head>
            <body style="margin: 0; padding: 0; background-color: #000000; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #000000;">
                    <tr>
                        <td align="center" style="padding: 20px 0;">
                            <table width="600" cellpadding="0" cellspacing="0" border="0" style="background-color: #0b0f19; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.5);">
                                ${htmlContent}
                            </table>
                        </td>
                    </tr>
                </table>
            </body>
            </html>
    `.replace(/{{SERVER_NAME}}/g, serverName);

    return { html: finalHtml, attachments };
};

const renderNewsletterHtmlForBrowser = (html, attachments = [], username = 'Preview User') => {
    let output = String(html || '').replace(/{{USERNAME}}/g, escapeHtmlAttr(username));
    for (const attachment of attachments || []) {
        if (!attachment?.cid || !attachment?.content) continue;
        const ext = String(attachment.filename || '').split('.').pop()?.toLowerCase();
        const mime = ext === 'png'
            ? 'image/png'
            : ext === 'webp'
                ? 'image/webp'
                : 'image/jpeg';
        const dataUrl = `data:${mime};base64,${Buffer.from(attachment.content).toString('base64')}`;
        output = output.replace(new RegExp(`cid:${attachment.cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), dataUrl);
    }
    return output;
};

app.get('/api/newsletter/preview', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const { html, attachments } = await generateNewsletterHtml(config, { embedImages: true });
        const previewHtml = renderNewsletterHtmlForBrowser(html, attachments, req.user?.username || 'Preview User');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        return res.send(previewHtml);
    } catch (e) {
        log(`Newsletter preview error: ${e.message}`);
        return res.status(500).send(`<p>Failed to generate newsletter preview: ${escapeHtmlAttr(e.message)}</p>`);
    }
});

app.get('/api/newsletter/download', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const { html, attachments } = await generateNewsletterHtml(config, { embedImages: true });
        const downloadHtml = renderNewsletterHtmlForBrowser(html, attachments, req.user?.username || 'Preview User');
        const stamp = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="server-portal-newsletter-${stamp}.html"`);
        res.setHeader('Cache-Control', 'no-store');
        return res.send(downloadHtml);
    } catch (e) {
        log(`Newsletter download error: ${e.message}`);
        return res.status(500).json({ error: 'Failed to generate newsletter download' });
    }
});

app.post('/api/newsletter/test', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        if (!config.smtpHost || !config.smtpUser) return res.status(400).json({ error: 'SMTP not configured' });

        const adminEmail = await resolveNewsletterTestRecipient(config, req.user);

        if (!adminEmail) return res.status(400).json({ error: 'Could not determine an admin email address for the test newsletter.' });

        const { html, attachments } = await generateNewsletterHtml(config);
        const providerLabel = getNewsletterProviderLabel(config);
        const transporter = nodemailer.createTransport({
            host: config.smtpHost,
            port: config.smtpPort,
            secure: config.smtpSecure,
            auth: { user: config.smtpUser, pass: config.smtpPass }
        });

        const personalizedHtml = html.replace(/{{USERNAME}}/g, 'Admin');

        await transporter.sendMail({
            from: config.smtpFrom || config.smtpUser,
            to: adminEmail,
            subject: `${providerLabel} Server Automated Newsletter (Test)`,
            html: personalizedHtml,
            attachments: attachments
        });
        res.json({ success: true });
    } catch (e) {
        log(`Newsletter test error: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/newsletter/send-now', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        if (!config.smtpHost || !config.smtpUser) return res.status(400).json({ error: 'SMTP not configured' });

        const users = await loadFile(USERS_PATH, []);
        const validUsers = users.filter(u => u.email);
        if (validUsers.length === 0) return res.status(400).json({ error: 'No users with email addresses found.' });

        const { html, attachments } = await generateNewsletterHtml(config);
        const providerLabel = getNewsletterProviderLabel(config);
        const transporter = nodemailer.createTransport({
            host: config.smtpHost,
            port: config.smtpPort,
            secure: config.smtpSecure,
            auth: { user: config.smtpUser, pass: config.smtpPass }
        });

        // Respond immediately, process in background
        res.json({ success: true, message: `Sending to ${validUsers.length} users...` });

        log(`Manual newsletter trigger initiated for ${validUsers.length} users.`);
        for (const user of validUsers) {
            try {
                const personalizedHtml = html.replace(/{{USERNAME}}/g, escapeHtmlAttr(user.username || user.name || 'User'));
                await transporter.sendMail({
                    from: config.smtpFrom || config.smtpUser,
                    to: user.email,
                    subject: `${providerLabel} Server Automated Newsletter`,
                    html: personalizedHtml,
                    attachments: attachments
                });
                await new Promise(resolve => setTimeout(resolve, 15000)); // 15s delay to avoid Gmail rate limits
            } catch (e) {
                log(`Failed to send manual newsletter to ${user.email}: ${e.message}`);
            }
        }
        log(`Manual newsletter dispatch completed.`);
        config.lastNewsletterSent = new Date().toISOString().split('T')[0];
        await saveFile(CONFIG_PATH, config);
    } catch (e) {
        log(`Newsletter send-now error: ${e.message}`);
        if (!res.headersSent) res.status(500).json({ error: e.message });
    }
});

app.post('/api/plex/servers', setupRateLimit, async (req, res) => {
    const { token, plexServerUrl } = req.body;
    const normalizedToken = normalizePlexToken(token);
    if (!normalizedToken) return res.status(400).json({ error: 'Plex token is required.' });

    try {
        const existingConfig = await loadFile(CONFIG_PATH, {});
        const isConfigured = isPortalConfigured(existingConfig);
        if (isConfigured) {
            const sessionToken = req.cookies && req.cookies.session;
            if (!sessionToken) {
                return res.status(403).json({ error: 'Forbidden: Admin session required.' });
            }
            let decoded;
            try {
                decoded = jwt.verify(sessionToken, JWT_SECRET);
            } catch (e) {
                return res.status(403).json({ error: 'Forbidden: Invalid admin session.' });
            }
            const isAdmin = await resolveCurrentAdmin(decoded, existingConfig);
            if (!isAdmin) {
                return res.status(403).json({ error: 'Forbidden: Admins only.' });
            }
        } else if (!(await assertUnconfiguredSensitiveSetupAccess(req, res, { plexToken: normalizedToken, plexServerUrl }))) {
            return;
        }

        log('Fetching Plex servers using /pms/servers XML API...');
        let servers = [];
        try {
            servers = await fetchOwnedPlexServers(normalizedToken);
        } catch (e) {
            log(`Owned Plex server discovery failed: ${e.message}`);
        }

        const directUrl = String(plexServerUrl || '').trim() || resolveConfiguredPlexServerUrl(existingConfig);
        if (servers.length === 0 && directUrl) {
            try {
                const baseUrl = resolveIntegrationUrlForFetch(directUrl);
                const identityRes = await fetchWithTimeout(`${baseUrl}/identity`, {
                    headers: plexClientHeaders(normalizedToken),
                }, 6000);
                if (identityRes.ok) {
                    const identityText = await identityRes.text();
                    let machineIdentifier = '';
                    let friendlyName = '';
                    try {
                        const parsed = JSON.parse(identityText);
                        const container = parsed?.MediaContainer || parsed || {};
                        machineIdentifier = String(container.machineIdentifier || '');
                        friendlyName = String(container.friendlyName || container.name || 'Plex Server');
                    } catch {
                        const machineMatch = identityText.match(/machineIdentifier="([^"]+)"/i)
                            || identityText.match(/<machineIdentifier>([^<]+)<\/machineIdentifier>/i);
                        machineIdentifier = machineMatch ? String(machineMatch[1]) : '';
                        const nameMatch = identityText.match(/friendlyName="([^"]+)"/i)
                            || identityText.match(/<friendlyName>([^<]+)<\/friendlyName>/i);
                        friendlyName = nameMatch ? String(nameMatch[1]) : 'Plex Server';
                    }
                    if (machineIdentifier) {
                        servers = [{ name: friendlyName || 'Plex Server', identifier: machineIdentifier }];
                    }
                }
            } catch (e) {
                log(`Direct Plex URL identity fallback failed: ${e.message}`);
            }
        }

        if (servers.length === 0) {
            log('No owned servers found via Plex.tv or direct URL.');
        } else {
            log(`Found ${servers.length} server(s).`);
        }

        res.json(servers);
    } catch (error) {
        log(`An exception occurred in /api/plex/servers: ${error.message}`);
        res.status(500).json({ error: error.message || 'An unexpected error occurred while fetching servers.' });
    }
});


app.post('/api/sync', requireAdmin, async (req, res) => {
    const config = await loadFile(CONFIG_PATH, null);
    if (!config) return res.status(400).json({ error: 'App not configured.' });
    const mediaServerType = String(config.mediaServerType || 'plex').toLowerCase();
    const isJellyfinPortal = mediaServerType === 'jellyfin' || mediaServerType === 'emby';
    const providerLabel = mediaServerType === 'emby' ? 'Emby' : mediaServerType === 'jellyfin' ? 'Jellyfin' : 'Plex';
    try {
        const result = isJellyfinPortal ? await syncJellyfinUsers(config) : await syncUsers(config);
        await appendAuditLog(isJellyfinPortal ? 'jellyfin_sync_completed' : 'plex_sync_completed', req.user || null, null, { count: result.count });
        if (result.newUserCount > 0 && alertRuleEnabled(config, 'newUserSynced')) {
            await sendGotifyAlert(
                config,
                `${providerLabel} sync found new users`,
                `${result.newUserCount} new user${result.newUserCount === 1 ? '' : 's'} added during sync.`,
                5,
            ).catch((e) => log(`Failed to send Gotify new-user sync alert: ${e.message}`));
        }
        if (alertRuleEnabled(config, 'syncSuccess')) {
            await sendGotifyAlert(
                config,
                `${providerLabel} sync completed`,
                result.message || `Synced ${result.count} users.`,
                2,
            ).catch((e) => log(`Failed to send Gotify sync success alert: ${e.message}`));
        }
        res.json(result);
    } catch (error) {
        await appendAuditLog(isJellyfinPortal ? 'jellyfin_sync_failed' : 'plex_sync_failed', req.user || null, null, { error: error.message });
        if (alertRuleEnabled(config, 'syncFailure')) {
            await sendGotifyAlert(
                config,
                `${providerLabel} sync failed`,
                error.message || 'Sync failed.',
                8,
            ).catch((e) => log(`Failed to send Gotify sync failure alert: ${e.message}`));
        }
        res.status(500).json({ error: error.message });
    }
});

// --- Invites Endpoints ---
app.get('/api/invites', requireAdmin, async (req, res) => {
    const invites = await loadFile(INVITES_PATH, []);
    res.json(invites);
});

app.post('/api/invites', requireAdmin, async (req, res) => {
    const { durationDays, maxUses, libraryIds } = req.body;
    const invites = await loadFile(INVITES_PATH, []);

    const code = randomBytes(6).toString('hex');
    const newInvite = {
        code,
        durationDays: parseInt(durationDays, 10) || 30,
        maxUses: maxUses === 'unlimited' ? 'unlimited' : (parseInt(maxUses, 10) || 1),
        currentUses: 0,
        libraryIds: Array.isArray(libraryIds) && libraryIds.length > 0 ? libraryIds : null,
        createdBy: req.user.username || 'admin',
        createdAt: new Date().toISOString()
    };

    invites.push(newInvite);
    await saveFile(INVITES_PATH, invites);
    res.json(newInvite);
});

app.post('/api/invites/email', requireAdmin, async (req, res) => {
    const { email, durationDays, libraryIds } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const config = await loadFile(CONFIG_PATH, {});
    if (!config.smtpHost || !config.smtpUser) {
        return res.status(400).json({ error: 'SMTP settings are not configured. Cannot send email.' });
    }

    const invites = await loadFile(INVITES_PATH, []);
    const code = randomBytes(6).toString('hex');
    const newInvite = {
        code,
        durationDays: parseInt(durationDays, 10) || 30,
        maxUses: 1,
        currentUses: 0,
        libraryIds: Array.isArray(libraryIds) && libraryIds.length > 0 ? libraryIds : null,
        createdBy: req.user.username || 'admin',
        createdAt: new Date().toISOString(),
        sentTo: email
    };

    try {
        const publicDomain = resolvePublicBaseUrlFromConfig(config);
        if (!publicDomain) {
            return res.status(400).json({
                error: 'Set Public Base URL in Settings → Portal UI before sending invite emails.',
            });
        }
        const inviteUrl = `${publicDomain}/invite/${code}`;
        const adminProfile = await getAdminProfile(config);
        const serverName = adminProfile ? adminProfile.serverName : 'Our Plex Server';

        const logoPath = path.join(process.cwd(), 'static', 'logo.png');
        let hasLogo = false;
        try { await fs.access(logoPath); hasLogo = true; } catch (e) { }

        const subject = `You've been invited to ${serverName}!`;
        const html = `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f6f9; padding: 30px; color: #333333; line-height: 1.6;">
                <div style="max-width: 600px; margin: auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border-top: 6px solid #e5a00d;">
                    <div style="background-color: #282A2D; padding: 25px; text-align: center;">
                        ${hasLogo ? '<img src="cid:logo" alt="Logo" style="max-height: 100px; display: block; margin: 0 auto 10px auto;" />' : ''}
                        <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase;">${serverName}</h1>
                    </div>
                    <div style="padding: 30px 40px;">
                        <h2 style="color: #e5a00d; font-size: 20px; margin-top: 0; font-weight: 600; text-align: center;">Welcome to the Server!</h2>
                        <p style="text-align: center; font-size: 16px;">You have been invited to join our private media server.</p>
                        
                        <div style="text-align: center; margin: 35px 0;">
                            <a href="${inviteUrl}" style="background-color: #e5a00d; color: #ffffff; text-decoration: none; padding: 14px 35px; font-weight: bold; border-radius: 6px; display: inline-block; font-size: 16px; box-shadow: 0 4px 6px rgba(229, 160, 13, 0.2);">Claim Your Access</a>
                        </div>
                        
                        <div style="background-color: #fcf8f2; border-left: 4px solid #e5a00d; padding: 20px; margin: 25px 0 0 0; border-radius: 6px;">
                            <p style="margin: 0; font-size: 14px; color: #718096; text-align: center;">This invite link is for single use only. It will grant you access for <strong>${newInvite.durationDays} days</strong>.</p>
                        </div>
                    </div>
                    <div style="background-color: #f7fafc; padding: 20px 30px; border-top: 1px solid #edf2f7; text-align: center; font-size: 12px; color: #a0aec0;">
                        <p style="margin: 0 0 5px 0;">Automated notification from the Server Manager Portal.</p>
                        <p style="margin: 0;">We hope you enjoy the server!</p>
                    </div>
                </div>
            </div>
        `;

        await sendEmail(config, email, subject, html);
        invites.push(newInvite);
        await saveFile(INVITES_PATH, invites);
        res.json({ message: 'Invite sent successfully', invite: newInvite });
    } catch (err) {
        log('Failed to send email invite: ' + err.message);
        res.status(500).json({ error: 'Failed to send email. Please check your SMTP settings.' });
    }
});

app.delete('/api/invites/:code', requireAdmin, async (req, res) => {
    let invites = await loadFile(INVITES_PATH, []);
    invites = invites.filter(i => i.code !== req.params.code);
    await saveFile(INVITES_PATH, invites);
    res.json({ success: true });
});

const REQUEST_LIST_FILTERS = new Set(['pending', 'approved', 'declined', 'processing', 'available', 'failed']);

const emptyRequestCounts = () => ({
    pending: 0, approved: 0, declined: 0, processing: 0, available: 0, failed: 0, completed: 0, total: 0,
});

const buildRequestAppStatusPayload = (config) => {
    const gate = getRequestAppGate(config);
    return {
        configured: gate.configured,
        supported: gate.supported,
        connected: false,
        ...emptyRequestCounts(),
        error: gate.error,
    };
};

app.get('/api/discovery/preferences', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        res.json(getDiscoveryPreferences(config));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const createDiscoveryLibraryAvailability = (config, extras = {}) => createLibraryAvailability(config, {
    resolveUrl: resolveIntegrationUrlForFetch,
    fetchImpl: fetch,
    upgraderItems: [],
    catalogTimeoutMs: 8000,
    ...extras,
});

let discoveryAvailabilityCacheMemo = null;
let discoveryAvailabilityCacheMemoAt = 0;
const DISCOVERY_AVAILABILITY_MEMO_TTL_MS = 5 * 60 * 1000;

const loadDiscoveryAvailabilityCacheFile = async ({ force = false } = {}) => {
    if (
        !force
        && discoveryAvailabilityCacheMemo
        && (Date.now() - discoveryAvailabilityCacheMemoAt) < DISCOVERY_AVAILABILITY_MEMO_TTL_MS
    ) {
        return discoveryAvailabilityCacheMemo;
    }
    discoveryAvailabilityCacheMemo = normalizeDiscoveryAvailabilityCache(
        await loadFile(DISCOVERY_AVAILABILITY_CACHE_PATH, emptyDiscoveryAvailabilityCache()),
    );
    discoveryAvailabilityCacheMemoAt = Date.now();
    return discoveryAvailabilityCacheMemo;
};

const invalidateDiscoveryAvailabilityCacheMemo = () => {
    discoveryAvailabilityCacheMemo = null;
    discoveryAvailabilityCacheMemoAt = 0;
};

/** Overlay the current member's active portal requests onto discover items (Requested badges). */
const memberActiveRequestsOverlayCache = new Map(); // userKey → { at, byKey: Map }
const MEMBER_ACTIVE_REQUESTS_OVERLAY_TTL_MS = 20 * 1000;

const overlayPortalPendingRequestsOntoItems = async (config, sessionUser, items = []) => {
    if (getRequestEngine(config) !== 'portal' || !sessionUser || !Array.isArray(items) || !items.length) {
        return items;
    }
    try {
        const userKey = String(sessionUser?.id || sessionUser?.plexId || '');
        let activeByKey = null;
        const cached = userKey ? memberActiveRequestsOverlayCache.get(userKey) : null;
        if (cached && (Date.now() - cached.at) < MEMBER_ACTIVE_REQUESTS_OVERLAY_TTL_MS) {
            activeByKey = cached.byKey;
        } else {
            const portalRequests = getPortalRequestService(config);
            // Include pending + approved — auto-approve clears "pending" immediately and was
            // leaving detail pages stuck on "Request Movie".
            const listed = await portalRequests.listMemberRequests(sessionUser, {
                filter: 'all',
                take: 200,
                skip: 0,
            });
            activeByKey = new Map();
            for (const row of listed.results || []) {
                const status = Number(row?.status);
                // Skip terminal states; library cache still owns Available/Partial.
                if (status === 3 || status === 4) continue; // declined / failed
                const mediaType = row?.type === 'tv' ? 'tv' : 'movie';
                const tmdbId = Number(row?.tmdbId);
                if (!Number.isFinite(tmdbId) || tmdbId <= 0) continue;
                const key = `${mediaType}:${tmdbId}`;
                const existing = activeByKey.get(key);
                // Prefer pending over approved when both exist (HD + later update).
                if (!existing || (status === 1 && Number(existing.status) !== 1)) {
                    activeByKey.set(key, row);
                }
            }
            if (userKey) {
                memberActiveRequestsOverlayCache.set(userKey, { at: Date.now(), byKey: activeByKey });
            }
        }
        if (!activeByKey.size) return items;
        return items.map((item) => {
            const mediaType = item?.mediaType === 'tv' || item?.mediaType === 2 || item?.mediaType === '2'
                ? 'tv'
                : 'movie';
            const tmdbId = Number(item?.tmdbId ?? item?.id);
            const active = activeByKey.get(`${mediaType}:${tmdbId}`);
            if (!active) return item;
            const mediaInfo = { ...(item?.mediaInfo || {}) };
            const requestStatus = Number(active.status) || 1;
            mediaInfo.requests = [
                {
                    id: active.id,
                    status: requestStatus,
                    is4k: !!active.is4k,
                    createdAt: active.createdAt,
                },
                ...(Array.isArray(mediaInfo.requests) ? mediaInfo.requests : []),
            ];
            const currentStatus = Number(mediaInfo.status);
            // Don't clobber library available/partial — only fill unknown/empty.
            if (!Number.isFinite(currentStatus) || currentStatus === 1) {
                // MEDIA_STATUS: pending=2, processing=3 (approved / sent to *arr).
                mediaInfo.status = requestStatus === 1 ? 2 : 3;
            }
            return { ...item, mediaInfo };
        });
    } catch (error) {
        log(`Discovery request overlay skipped: ${error.message}`);
        return items;
    }
};

const attachDiscoveryAvailabilityCacheToPayload = async (config, sessionUser, data) => {
    if (!data || typeof data !== 'object') return data;
    const cache = await loadDiscoveryAvailabilityCacheFile();
    // Deployed hosts may keep a v1 snapshot until reboot — kick a v2 rebuild on first browse.
    const cacheVersion = Number(cache?.version) || 0;
    if (
        cacheVersion < getDiscoveryAvailabilityCacheVersion()
        && !systemJobs.discoveryAvailabilityCache.running
    ) {
        setImmediate(() => {
            runDiscoveryAvailabilityCacheRebuild('upgrade').catch(() => {});
        });
    }
    let next = applyDiscoveryAvailabilityCacheToPayload(data, cache);

    // Disk cache is the Seerr-style Media DB join for list paths.
    // Do NOT warm-stamp / kick *arr catalog downloads on the request path — that
    // saturated Node (JSON-parsing huge Sonarr/Radarr catalogs) and froze Settings,
    // session, and every other route including /api/config.

    if (Array.isArray(next?.results)) {
        const overlaid = await Promise.race([
            overlayPortalPendingRequestsOntoItems(config, sessionUser, next.results),
            new Promise((resolve) => setTimeout(() => resolve(next.results), 400)),
        ]);
        next = {
            ...next,
            results: overlaid,
        };
        return next;
    }
    // Detail pages: disk cache + pending overlay only.
    if (!Array.isArray(next) && (next?.mediaType === 'movie' || next?.mediaType === 'tv' || next?.id)) {
        const overlaid = await Promise.race([
            overlayPortalPendingRequestsOntoItems(config, sessionUser, [next]),
            new Promise((resolve) => setTimeout(() => resolve([next]), 400)),
        ]);
        const [detailed] = Array.isArray(overlaid) ? overlaid : [next];
        return detailed || next;
    }
    return next;
};

const getPortalBlocklistService = (config) => createPortalBlocklistService({
    dataDir: BLOCKLIST_DIR,
    config,
    resolveUser: async (userId) => {
        const users = await loadFile(USERS_PATH, []);
        const key = String(userId || '');
        return users.find((user) => String(user?.id) === key || String(user?.plexId) === key) || null;
    },
});

const getPortalRequestService = (config) => createPortalRequestService({
    dataDir: REQUESTS_DIR,
    config,
    resolveUrl: resolveIntegrationUrlForFetch,
    fetchImpl: fetchWithTimeout,
    listUsers: async () => loadFile(USERS_PATH, []),
    resolveUser: async (userId) => {
        const users = await loadFile(USERS_PATH, []);
        const key = String(userId || '');
        return users.find((user) => String(user?.id) === key || String(user?.plexId) === key) || null;
    },
    isBlocked: async (mediaType, tmdbId) => {
        const blocklist = getPortalBlocklistService(config);
        return blocklist.isBlocked(mediaType, tmdbId);
    },
});

const getPortalWatchlistService = (config) => createPortalWatchlistService({
    dataDir: WATCHLIST_DIR,
    config,
    resolveUrl: resolveIntegrationUrlForFetch,
    fetchImpl: fetchWithTimeout,
    plexHeaders: plexClientHeaders,
    resolvePlexToken: async (sessionUser) => {
        if (sessionUser?.isAdmin && config?.plexToken && config.plexToken !== SECRET_MASK) {
            return String(config.plexToken);
        }
        const users = await loadFile(USERS_PATH, []);
        const key = String(sessionUser?.id || '');
        const plexId = String(sessionUser?.plexId || '');
        const local = users.find((user) => (
            String(user?.id) === key || String(user?.plexId) === plexId
        ));
        if (local?.plexAuthToken) return String(local.plexAuthToken);
        // Admin token as last resort only for admin sessions.
        if (sessionUser?.isAdmin && config?.plexToken && config.plexToken !== SECRET_MASK) {
            return String(config.plexToken);
        }
        return null;
    },
    requestService: getPortalRequestService(config),
});

const getPortalIssueService = (config) => createPortalIssueService({
    dataDir: ISSUES_DIR,
    config,
    resolveUser: async (userId) => {
        const users = await loadFile(USERS_PATH, []);
        const key = String(userId || '');
        return users.find((user) => String(user?.id) === key || String(user?.plexId) === key) || null;
    },
});

/** Batch library (+ optional portal request) availability for Discover card badges. */
app.post('/api/discovery/availability-batch', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const incoming = Array.isArray(req.body?.items) ? req.body.items : [];
        const items = incoming
            .map((entry) => {
                const mediaType = entry?.mediaType === 'tv' ? 'tv' : (entry?.mediaType === 'movie' ? 'movie' : null);
                const tmdbId = Number(entry?.tmdbId ?? entry?.id);
                if (!mediaType || !Number.isFinite(tmdbId) || tmdbId <= 0) return null;
                const year = Number(entry?.year);
                const tvdbId = Number(entry?.tvdbId);
                return {
                    mediaType,
                    tmdbId,
                    id: tmdbId,
                    title: String(entry?.title || entry?.name || '').trim(),
                    year: Number.isFinite(year) && year > 1900 ? year : null,
                    tvdbId: Number.isFinite(tvdbId) && tvdbId > 0 ? tvdbId : null,
                    firstAirDate: entry?.firstAirDate || null,
                    releaseDate: entry?.releaseDate || null,
                };
            })
            .filter(Boolean)
            .slice(0, 120);

        if (!items.length) return res.json({ results: [] });

        const cache = await loadDiscoveryAvailabilityCacheFile();
        const cachedHits = [];
        const misses = [];
        for (const item of items) {
            const hit = lookupDiscoveryAvailabilityForItem(cache, item);
            if (hit?.mediaInfo) {
                cachedHits.push(mergeAvailabilityEntryOntoItem(item, hit));
            } else {
                misses.push(item);
            }
        }

        let liveEnriched = [];
        if (misses.length) {
            const library = createDiscoveryLibraryAvailability(config);
            try {
                const blocked = library.enrichItems(misses, { blockForCatalog: true });
                const timedOut = await Promise.race([
                    blocked.then(() => false),
                    new Promise((resolve) => setTimeout(() => resolve(true), 3000)),
                ]);
                liveEnriched = timedOut
                    ? await library.enrichItems(misses, { blockForCatalog: false })
                    : await blocked;
            } catch (enrichError) {
                log(`Discovery availability-batch enrich skipped: ${enrichError.message}`);
                liveEnriched = misses;
            }
        }

        const enrichedByKey = new Map();
        for (const item of [...cachedHits, ...(Array.isArray(liveEnriched) ? liveEnriched : [])]) {
            const mediaType = item?.mediaType === 'tv' ? 'tv' : 'movie';
            const tmdbId = Number(item?.tmdbId ?? item?.id);
            if (!Number.isFinite(tmdbId) || tmdbId <= 0) continue;
            enrichedByKey.set(`${mediaType}:${tmdbId}`, item);
        }

        const withPending = await overlayPortalPendingRequestsOntoItems(
            config,
            req.user,
            items.map((item) => enrichedByKey.get(`${item.mediaType}:${item.tmdbId}`) || item),
        );

        const results = withPending.map((item) => {
            const mediaType = item?.mediaType === 'tv' ? 'tv' : 'movie';
            const tmdbId = Number(item?.tmdbId ?? item?.id);
            const mediaInfo = item?.mediaInfo && typeof item.mediaInfo === 'object' ? item.mediaInfo : null;
            return {
                mediaType,
                tmdbId,
                mediaInfo: mediaInfo && Object.keys(mediaInfo).length ? mediaInfo : null,
                sonarrLibraryStatus: item?.sonarrLibraryStatus || null,
                radarrLibraryStatus: item?.radarrLibraryStatus || null,
            };
        });

        res.json({
            results,
            cache: {
                generatedAt: cache.generatedAt,
                itemCount: cache.itemCount,
                hits: cachedHits.length,
                misses: misses.length,
            },
        });
    } catch (e) {
        log(`Discovery availability-batch error: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/discovery/search', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const discoverySource = getDiscoverySource(config);
        const query = String(req.query.query || '').trim();
        if (query.length < 2) return res.json({ results: [] });

        const metadataLanguage = resolveDiscoverMetadataLanguage(req);
        const resultCount = (payload) => (Array.isArray(payload?.results) ? payload.results.length : -1);

        if (discoverySource === 'tmdb') {
            if (!String(config.tmdbApiKey || '').trim()) {
                return res.status(400).json({ error: 'TMDB API key is required when Discover source is TMDB' });
            }
            const client = createTmdbClient({
                tmdbApiKey: config.tmdbApiKey,
                language: metadataLanguage,
            });
            let data = await client.search(query, { language: metadataLanguage, page: 1 }).catch((err) => {
                log(`Discovery TMDB search attempt failed: ${err.message}`);
                return null;
            });
            if (!data || resultCount(data) === 0) {
                await new Promise((resolve) => setTimeout(resolve, 250));
                data = await client.search(query, { language: metadataLanguage, page: 1 }).catch((err) => {
                    log(`Discovery TMDB search retry failed: ${err.message}`);
                    return data;
                });
            }
            if (data && resultCount(data) === 0 && metadataLanguage !== 'en') {
                const fallback = await client.search(query, { language: 'en', page: 1 }).catch(() => null);
                if (fallback && resultCount(fallback) > 0) data = fallback;
            }
            if (!data) {
                return res.status(502).json({ error: 'Search temporarily unavailable. Try again.' });
            }
            let results = Array.isArray(data.results) ? data.results : [];
            try {
                const library = createDiscoveryLibraryAvailability(config);
                results = await library.enrichItems(results);
            } catch (enrichError) {
                log(`Discovery TMDB search library enrich skipped: ${enrichError.message}`);
            }
            return res.json({
                page: data.page || 1,
                totalPages: data.totalPages || 1,
                totalResults: data.totalResults || resultCount(data) || 0,
                results,
            });
        }

        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });

        const searchPath = (language) => (
            `/api/v1/search?query=${encodeURIComponent(query)}&page=1&language=${encodeURIComponent(language)}`
        );
        const runSearch = (language) => requestAppService.rawFetch(
            config,
            searchPath(language),
            { headers: { 'Accept-Language': language }, timeoutMs: 20000 },
        );

        // Seerr/TMDB often soft-fail to `{ results: [] }` on transient errors.
        // Retry once (and once without an explicit language) before returning empty.
        let data = await runSearch(metadataLanguage).catch((err) => {
            log(`Discovery search attempt failed: ${err.message}`);
            return null;
        });
        if (!data || resultCount(data) === 0) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            data = await runSearch(metadataLanguage).catch((err) => {
                log(`Discovery search retry failed: ${err.message}`);
                return data;
            });
        }
        if (data && resultCount(data) === 0 && metadataLanguage !== 'en') {
            const fallback = await runSearch('en').catch(() => null);
            if (fallback && resultCount(fallback) > 0) data = fallback;
        }
        if (!data) {
            return res.status(502).json({ error: 'Search temporarily unavailable. Try again.' });
        }
        res.json({
            page: data.page || 1,
            totalPages: data.totalPages || data.total_pages || 1,
            totalResults: data.totalResults || data.total_results || resultCount(data) || 0,
            results: Array.isArray(data.results) ? data.results : [],
        });
    } catch (e) {
        log(`Discovery search error: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/discovery/trending', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const prefs = getDiscoveryPreferences(config);
        const metadataLanguage = resolveDiscoverMetadataLanguage(req);

        if (prefs.discoverySource === 'tmdb') {
            if (!String(config.tmdbApiKey || '').trim()) {
                return res.status(400).json({ error: 'TMDB API key is required when Discover source is TMDB' });
            }
            const client = createTmdbClient({
                tmdbApiKey: config.tmdbApiKey,
                language: metadataLanguage,
                region: prefs.discoverRegion,
            });
            let data = await client.trending({ language: metadataLanguage, page: 1 });
            try {
                const library = createDiscoveryLibraryAvailability(config);
                data = {
                    ...data,
                    results: await library.enrichItems(Array.isArray(data?.results) ? data.results : []),
                };
            } catch (enrichError) {
                log(`Discovery TMDB trending library enrich skipped: ${enrichError.message}`);
            }
            return res.json(filterDiscoveryPayload(data, '/discover/trending', prefs.hideAvailableMedia, prefs.discoverLanguage));
        }

        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });

        await ensureSeerrDiscoverySettings(config, requestAppService.rawFetch);
        const data = await requestAppService.rawFetch(
            config,
            `/api/v1/discover/trending?language=${encodeURIComponent(metadataLanguage)}`,
            { headers: { 'Accept-Language': metadataLanguage } },
        );
        res.json(filterDiscoveryPayload(data, '/discover/trending', prefs.hideAvailableMedia, prefs.discoverLanguage));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

let discoveryHeroCache = { data: null, lastFetch: 0 };

const DYNAMIC_THEME_IMAGE_HOSTS = new Set([
    'image.tmdb.org',
    'metadata.provider.plex.tv',
    'plex.tv',
]);

app.get('/api/dynamic-theme/sample-image', requireAuth, requireMember, async (req, res) => {
    const rawUrl = String(req.query.url || '').trim();
    if (!rawUrl) return res.status(400).send('url required');

    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return res.status(400).send('invalid url');
    }

    if (parsed.protocol !== 'https:' || !DYNAMIC_THEME_IMAGE_HOSTS.has(parsed.hostname)) {
        return res.status(400).send('host not allowed');
    }

    try {
        // Do not follow redirects — an allowlisted host could otherwise bounce to an internal URL.
        const response = await fetchWithTimeout(rawUrl, { redirect: 'manual' }, 15000);
        if (response.status >= 300 && response.status < 400) {
            return res.status(400).send('redirects not allowed');
        }
        if (!response.ok) throw new Error('fetch failed');
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        if (!contentType.startsWith('image/')) return res.status(400).send('not an image');
        const buffer = Buffer.from(await response.arrayBuffer());
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(buffer);
    } catch (e) {
        log(`Dynamic theme sample-image error: ${e.message}`);
        res.status(502).send('image fetch failed');
    }
});

app.get('/api/discovery/hero-backdrops', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const discoverySource = getDiscoverySource(config);

        if (discoverySource === 'tmdb') {
            if (!String(config.tmdbApiKey || '').trim()) {
                return res.status(400).json({ error: 'TMDB API key is required when Discover source is TMDB' });
            }
        } else {
            const gate = getRequestAppGate(config);
            if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });
        }

        if (discoveryHeroCache.data && Date.now() - discoveryHeroCache.lastFetch < 6 * 60 * 60 * 1000) {
            return res.json(discoveryHeroCache.data);
        }

        const payload = await fetchDiscoveryHeroBackdrops({
            config,
            // When source is TMDB, skip Seerr top-up so Discover can run without Seerr.
            rawFetch: discoverySource === 'tmdb'
                ? null
                : (path) => requestAppService.rawFetch(config, path),
        });
        discoveryHeroCache = { data: payload, lastFetch: Date.now() };
        res.json(payload);
    } catch (e) {
        log(`Discovery hero backdrops error: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/discovery/request-options', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const mediaType = String(req.query.mediaType || '').toLowerCase();
        const mediaId = Number(req.query.mediaId);
        if ((mediaType !== 'movie' && mediaType !== 'tv') || !Number.isFinite(mediaId)) {
            return res.status(400).json({ error: 'Invalid mediaType or mediaId' });
        }

        if (getRequestEngine(config) === 'portal') {
            const portalRequests = getPortalRequestService(config);
            const payload = await portalRequests.getMemberRequestOptions(req.user, {
                mediaType,
                mediaId,
            });
            return res.json(payload);
        }

        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });

        const payload = await requestAppService.getMemberRequestOptions(config, req.user, {
            mediaType,
            mediaId,
        });
        res.json(payload);
    } catch (e) {
        log(`Discovery request-options error: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/discovery/me', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        if (getRequestEngine(config) === 'portal') {
            const portalRequests = getPortalRequestService(config);
            const users = await loadFile(USERS_PATH, []);
            const key = String(req.user?.id || req.user?.plexId || '');
            const portalUser = users.find((u) => String(u?.id) === key || String(u?.plexId) === key) || req.user;
            const records = await portalRequests.store.list({ userId: String(portalUser?.id || req.user?.id || '') });
            const policy = resolveMemberRequestPolicy(config, portalUser);
            const quotaEval = evaluatePortalMemberQuota(config, records, { policy });
            const settings = getPortalRequestQuotaSettings(config);
            const defaults = getPortalRequestDefaults(config);
            return res.json({
                configured: true,
                engine: 'portal',
                userMapped: true,
                permissions: {
                    request: policy.allowRequestMovies || policy.allowRequestTv,
                    requestMovie: policy.allowRequestMovies,
                    requestTv: policy.allowRequestTv,
                    request4k: policy.allowRequest4kMovies || policy.allowRequest4kTv,
                    request4kMovie: policy.allowRequest4kMovies,
                    request4kTv: policy.allowRequest4kTv,
                    requestAdvanced: policy.allowAdvancedRequests,
                    createIssues: true,
                    viewIssues: true,
                },
                quota: {
                    movie: quotaEval.quota,
                    tv: quotaEval.quota,
                },
                autoApprove: {
                    requests: settings.autoApproveMovies || settings.autoApproveTv,
                    movies: settings.autoApproveMovies,
                    tv: settings.autoApproveTv,
                    requests4k: settings.autoApproveMovies4k || settings.autoApproveTv4k,
                    movies4k: settings.autoApproveMovies4k,
                    tv4k: settings.autoApproveTv4k,
                },
                discovery: {
                    showRecentlyAdded: defaults.showRecentlyAdded,
                    showWatchlist: defaults.showWatchlist,
                },
            });
        }

        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });

        const profile = await requestAppService.getMemberDiscoveryProfile(config, req.user);
        res.json({ configured: true, ...profile });
    } catch (e) {
        const mapped = mapSeerrClientError(e.message, e.status);
        log(`Discovery me error: ${e.message}`);
        res.status(mapped.status || 500).json({ error: mapped.error || e.message });
    }
});

app.get('/api/discovery/request-services/:type/:serverId', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const type = String(req.params.type || '').toLowerCase();
        const serverId = String(req.params.serverId || '').trim();
        if ((type !== 'radarr' && type !== 'sonarr') || !serverId) {
            return res.status(400).json({ error: 'Invalid service type or server id' });
        }

        if (getRequestEngine(config) === 'portal') {
            const portalRequests = getPortalRequestService(config);
            const data = await portalRequests.getPortalArrServiceOptions(type, serverId);
            return res.json(data);
        }

        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });

        const numericId = Number(serverId);
        if (!Number.isFinite(numericId)) {
            return res.status(400).json({ error: 'Invalid service type or server id' });
        }

        const data = await requestAppService.getServiceOptions(config, type, numericId);
        res.json(data);
    } catch (e) {
        log(`Discovery request services error: ${e.message}`);
        res.status(502).json({ error: e.message });
    }
});

app.post('/api/discovery/request-tags', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const { mediaType, label, serverName, serverId } = req.body || {};
        const type = mediaType === 'tv' ? 'tv' : (mediaType === 'movie' ? 'movie' : '');
        if (!type || !label) return res.status(400).json({ error: 'Missing mediaType or label' });

        if (getRequestEngine(config) === 'portal') {
            const users = await loadFile(USERS_PATH, []);
            const key = String(req.user?.id || req.user?.plexId || '');
            const portalUser = users.find((u) => String(u?.id) === key || String(u?.plexId) === key) || req.user;
            const policy = resolveMemberRequestPolicy(config, portalUser);
            if (!policy.allowAdvancedRequests) {
                return res.status(403).json({ error: 'Advanced request options are disabled.' });
            }
            const portalRequests = getPortalRequestService(config);
            const tag = await portalRequests.createPortalTag({
                mediaType: type,
                label,
                serverName: serverName || '',
                serverId: serverId ?? null,
            });
            return res.status(201).json(tag);
        }

        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });

        const tag = await requestAppService.createMemberRequestTag(config, req.user, {
            mediaType: type,
            label,
            serverName: serverName || '',
        });
        res.status(201).json(tag);
    } catch (e) {
        log(`Discovery request-tags error: ${e.message}`);
        res.status(e.status || 500).json({ error: e.message });
    }
});

app.post('/api/discovery/request-override-defaults', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        if (getRequestEngine(config) === 'portal') {
            // Portal uses *arr defaults from request-services — Seerr override rules do not apply.
            return res.json({});
        }
        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });

        const { mediaType, tmdbId, is4k } = req.body || {};
        if (!mediaType || !tmdbId) return res.status(400).json({ error: 'Missing mediaType or tmdbId' });

        // Always bind to the session's Seerr user — ignore client-supplied userId (IDOR).
        const users = await requestAppService.listRequestUsers(config);
        const resolvedUserId = requestAppService.resolveSeerrRequestUserId(req.user, users);
        if (!resolvedUserId) {
            return res.status(403).json({ error: 'Your portal account is not linked to a Seerr user.' });
        }

        const defaults = await requestAppService.getAdvancedRequestDefaults(config, {
            mediaType,
            tmdbId: Number(tmdbId),
            userId: resolvedUserId,
            is4k: !!is4k,
        });
        res.json(defaults || {});
    } catch (e) {
        log(`Discovery request override defaults error: ${e.message}`);
        res.status(502).json({ error: e.message });
    }
});

app.get('/api/discovery/my-requests/count', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        if (getRequestEngine(config) === 'portal') {
            const portalRequests = getPortalRequestService(config);
            const counts = await portalRequests.getMemberRequestCounts(req.user);
            return res.json({ configured: true, ...counts });
        }

        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });

        const counts = await requestAppService.getMemberRequestCounts(config, req.user);
        res.json({ configured: true, ...counts });
    } catch (e) {
        log(`Discovery my-requests count error: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/discovery/my-requests', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const filter = String(req.query.filter || 'all').toLowerCase();
        const take = Math.min(50, Math.max(1, Number(req.query.take) || 20));
        const skip = Math.max(0, Number(req.query.skip) || 0);

        if (getRequestEngine(config) === 'portal') {
            const portalRequests = getPortalRequestService(config);
            const payload = await portalRequests.listMemberRequests(req.user, { filter, take, skip });
            return res.json({
                configured: true,
                ...payload,
                // Counts come from the same store read — clients should not also hit /count.
                pending: payload.counts?.pending,
                approved: payload.counts?.approved,
                available: payload.counts?.available,
                declined: payload.counts?.declined,
                failed: payload.counts?.failed,
                total: payload.counts?.total,
            });
        }

        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });

        const payload = await requestAppService.listMemberRequests(config, req.user, { filter, take, skip });
        res.json({ configured: true, ...payload });
    } catch (e) {
        log(`Discovery my-requests error: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/discovery/my-requests/:id', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const requestId = String(req.params.id || '').trim();
        if (!requestId) return res.status(400).json({ error: 'Request ID is required' });

        if (getRequestEngine(config) === 'portal') {
            const portalRequests = getPortalRequestService(config);
            await portalRequests.cancelMemberRequest(req.user, requestId);
            return res.json({ success: true, message: 'Request cancelled.' });
        }

        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });

        await requestAppService.cancelMemberRequest(config, req.user, requestId);
        res.json({ success: true, message: 'Request cancelled.' });
    } catch (e) {
        log(`Discovery cancel request error: ${e.message}`);
        const status = e.status
            || (e.message?.includes('not linked') || e.message?.includes('only manage') ? 403 : 502);
        res.status(status).json({ error: e.message });
    }
});

app.post('/api/discovery/my-requests/:id/retry', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const requestId = String(req.params.id || '').trim();
        if (!requestId) return res.status(400).json({ error: 'Request ID is required' });

        if (getRequestEngine(config) === 'portal') {
            const portalRequests = getPortalRequestService(config);
            await portalRequests.retryMemberRequest(req.user, requestId);
            return res.json({ success: true, message: 'Request retry submitted.' });
        }

        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });

        await requestAppService.retryMemberRequest(config, req.user, requestId);
        res.json({ success: true, message: 'Request retry submitted.' });
    } catch (e) {
        log(`Discovery retry request error: ${e.message}`);
        res.status(e.status || (e.message?.includes('not linked') || e.message?.includes('only manage') ? 403 : 502)).json({ error: e.message });
    }
});

app.get('/api/discovery/my-issues/count', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        if (getRequestEngine(config) === 'portal') {
            const portalIssues = getPortalIssueService(config);
            const counts = await portalIssues.getMemberIssueCounts(req.user);
            return res.json({ configured: true, engine: 'portal', ...counts });
        }
        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });
        const counts = await requestAppService.getMemberIssueCounts(config, req.user);
        res.json({ configured: true, ...counts });
    } catch (e) {
        log(`Discovery my-issues count error: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/discovery/my-issues', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const filter = String(req.query.filter || 'all').toLowerCase();
        const take = Math.min(50, Math.max(1, Number(req.query.take) || 20));
        const skip = Math.max(0, Number(req.query.skip) || 0);
        if (getRequestEngine(config) === 'portal') {
            const portalIssues = getPortalIssueService(config);
            const payload = await portalIssues.listMemberIssues(req.user, { filter, take, skip });
            return res.json({ configured: true, engine: 'portal', ...payload });
        }
        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });
        const payload = await requestAppService.listMemberIssues(config, req.user, { filter, take, skip });
        res.json({ configured: true, ...payload });
    } catch (e) {
        log(`Discovery my-issues error: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/discovery/issues', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const { mediaId, tmdbId, mediaType, issueType, message, problemSeason, problemEpisode } = req.body || {};
        if (getRequestEngine(config) === 'portal') {
            const portalIssues = getPortalIssueService(config);
            const issue = await portalIssues.createIssue(req.user, {
                tmdbId: tmdbId ?? mediaId,
                mediaType: mediaType === 'tv' ? 'tv' : 'movie',
                issueType,
                message,
                problemSeason,
                problemEpisode,
            });
            return res.status(201).json({ success: true, issue });
        }
        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });
        const profile = await requestAppService.getMemberDiscoveryProfile(config, req.user);
        if (!profile.permissions?.createIssues) {
            return res.status(403).json({ error: 'You do not have permission to report issues.' });
        }
        const issue = await requestAppService.createIssue(config, req.user, {
            mediaId,
            issueType,
            message,
            problemSeason,
            problemEpisode,
        });
        res.status(201).json({ success: true, issue });
    } catch (e) {
        const mapped = mapSeerrClientError(e.message, e.status);
        log(`Discovery create issue error: ${e.message}`);
        res.status(mapped.status || e.status || (e.message?.includes('not linked') ? 403 : 502)).json({ error: mapped.error || e.message });
    }
});

app.post('/api/discovery/my-issues/:id/comment', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const issueId = String(req.params.id || '').trim();
        if (!issueId) return res.status(400).json({ error: 'Issue ID is required' });
        if (getRequestEngine(config) === 'portal') {
            const portalIssues = getPortalIssueService(config);
            await portalIssues.assertMemberOwnsIssue(req.user, issueId);
            await portalIssues.addIssueComment(issueId, req.body?.message, req.user);
            return res.json({ success: true, message: 'Comment added.' });
        }
        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });
        await requestAppService.assertMemberOwnsIssue(config, req.user, issueId);
        await requestAppService.addIssueComment(config, issueId, req.body?.message);
        res.json({ success: true, message: 'Comment added.' });
    } catch (e) {
        log(`Discovery issue comment error: ${e.message}`);
        res.status(e.status || (e.message?.includes('not linked') || e.message?.includes('only manage') ? 403 : 502)).json({ error: e.message });
    }
});

app.post('/api/discovery/my-issues/:id/:status', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const issueId = String(req.params.id || '').trim();
        const status = String(req.params.status || '').toLowerCase();
        if (!issueId) return res.status(400).json({ error: 'Issue ID is required' });
        if (status !== 'open' && status !== 'resolved') {
            return res.status(400).json({ error: 'Status must be open or resolved' });
        }
        if (getRequestEngine(config) === 'portal') {
            const portalIssues = getPortalIssueService(config);
            await portalIssues.assertMemberOwnsIssue(req.user, issueId);
            await portalIssues.updateIssueStatus(issueId, status, req.user);
            return res.json({ success: true, message: status === 'resolved' ? 'Issue marked resolved.' : 'Issue reopened.' });
        }
        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });
        await requestAppService.assertMemberOwnsIssue(config, req.user, issueId);
        await requestAppService.updateIssueStatus(config, issueId, status);
        res.json({ success: true, message: status === 'resolved' ? 'Issue marked resolved.' : 'Issue reopened.' });
    } catch (e) {
        log(`Discovery issue status error: ${e.message}`);
        res.status(e.status || (e.message?.includes('not linked') || e.message?.includes('only manage') ? 403 : 502)).json({ error: e.message });
    }
});

app.delete('/api/discovery/my-issues/:id', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const issueId = String(req.params.id || '').trim();
        if (!issueId) return res.status(400).json({ error: 'Issue ID is required' });
        if (getRequestEngine(config) === 'portal') {
            const portalIssues = getPortalIssueService(config);
            const { issue } = await portalIssues.assertMemberOwnsIssue(req.user, issueId);
            if ((issue?.commentCount || 0) > 1) {
                return res.status(403).json({ error: 'Issues with replies cannot be deleted.' });
            }
            await portalIssues.deleteIssue(issueId);
            return res.json({ success: true, message: 'Issue deleted.' });
        }
        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });
        const { issue } = await requestAppService.assertMemberOwnsIssue(config, req.user, issueId);
        if ((issue?.commentCount || 0) > 1) {
            return res.status(403).json({ error: 'Issues with replies cannot be deleted.' });
        }
        await requestAppService.deleteIssue(config, issueId);
        res.json({ success: true, message: 'Issue deleted.' });
    } catch (e) {
        log(`Discovery delete issue error: ${e.message}`);
        res.status(e.status || (e.message?.includes('not linked') || e.message?.includes('only manage') ? 403 : 502)).json({ error: e.message });
    }
});

app.get('/api/issues/count', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        if (getRequestEngine(config) === 'portal') {
            const portalIssues = getPortalIssueService(config);
            const counts = await portalIssues.getIssueCounts();
            return res.json({ configured: true, supported: true, connected: true, engine: 'portal', ...counts });
        }
        const gate = getRequestAppGate(config);
        if (!gate.ready) {
            return res.json(buildRequestAppStatusPayload(config));
        }
        try {
            const counts = await requestAppService.getIssueCounts(config);
            res.json({ configured: true, supported: true, connected: true, ...counts });
        } catch (error) {
            res.json({
                ...buildRequestAppStatusPayload(config),
                configured: true,
                supported: true,
                connected: false,
                error: error.message || 'Failed to connect to request app',
            });
        }
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to fetch issue counts' });
    }
});

app.get('/api/issues', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const filter = String(req.query.filter || 'open').toLowerCase();
        const take = Math.min(50, Math.max(1, Number(req.query.take) || 30));
        const skip = Math.max(0, Number(req.query.skip) || 0);
        if (getRequestEngine(config) === 'portal') {
            const portalIssues = getPortalIssueService(config);
            const payload = await portalIssues.listIssues({ filter, take, skip });
            return res.json({ configured: true, supported: true, connected: true, engine: 'portal', ...payload });
        }
        const gate = getRequestAppGate(config);
        if (!gate.ready) {
            return res.json({ ...buildRequestAppStatusPayload(config), results: [] });
        }
        try {
            const payload = await requestAppService.listIssues(config, { filter, take, skip });
            res.json({ configured: true, supported: true, connected: true, ...payload });
        } catch (error) {
            res.json({
                ...buildRequestAppStatusPayload(config),
                configured: true,
                supported: true,
                connected: false,
                error: error.message || 'Failed to connect to request app',
                results: [],
            });
        }
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to fetch issues' });
    }
});

app.get('/api/issues/:id', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const issueId = String(req.params.id || '').trim();
        if (!issueId) return res.status(400).json({ error: 'Issue ID is required' });
        if (getRequestEngine(config) === 'portal') {
            const portalIssues = getPortalIssueService(config);
            const issue = await portalIssues.getIssue(issueId);
            return res.json({ configured: true, engine: 'portal', issue });
        }
        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });
        const issue = await requestAppService.getIssue(config, issueId);
        res.json({ configured: true, issue });
    } catch (error) {
        res.status(error.status || 502).json({ error: error.message || 'Failed to fetch issue' });
    }
});

app.post('/api/issues/:id/comment', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const issueId = String(req.params.id || '').trim();
        if (!issueId) return res.status(400).json({ error: 'Issue ID is required' });
        if (getRequestEngine(config) === 'portal') {
            const portalIssues = getPortalIssueService(config);
            await portalIssues.addIssueComment(issueId, req.body?.message, req.user);
            return res.json({ success: true, message: 'Comment added.' });
        }
        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });
        await requestAppService.addIssueComment(config, issueId, req.body?.message);
        res.json({ success: true, message: 'Comment added.' });
    } catch (error) {
        res.status(error.status || 502).json({ error: error.message || 'Failed to add comment' });
    }
});

app.post('/api/issues/:id/:status', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const issueId = String(req.params.id || '').trim();
        const status = String(req.params.status || '').toLowerCase();
        if (!issueId) return res.status(400).json({ error: 'Issue ID is required' });
        if (status !== 'open' && status !== 'resolved') {
            return res.status(400).json({ error: 'Status must be open or resolved' });
        }
        if (getRequestEngine(config) === 'portal') {
            const portalIssues = getPortalIssueService(config);
            await portalIssues.updateIssueStatus(issueId, status, req.user);
            const title = String(req.body?.title || '').trim();
            await appendAuditLog(
                status === 'resolved' ? 'issue_resolved' : 'issue_reopened',
                req.user,
                null,
                { issueId, title: title || null, engine: 'portal' },
            );
            return res.json({ success: true, message: status === 'resolved' ? 'Issue resolved.' : 'Issue reopened.' });
        }
        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });
        await requestAppService.updateIssueStatus(config, issueId, status);
        const title = String(req.body?.title || '').trim();
        await appendAuditLog(
            status === 'resolved' ? 'issue_resolved' : 'issue_reopened',
            req.user,
            null,
            { issueId, title: title || null },
        );
        res.json({ success: true, message: status === 'resolved' ? 'Issue resolved.' : 'Issue reopened.' });
    } catch (error) {
        res.status(error.status || 502).json({ error: error.message || 'Failed to update issue' });
    }
});

app.delete('/api/issues/:id', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const issueId = String(req.params.id || '').trim();
        if (!issueId) return res.status(400).json({ error: 'Issue ID is required' });
        if (getRequestEngine(config) === 'portal') {
            const portalIssues = getPortalIssueService(config);
            await portalIssues.deleteIssue(issueId);
            await appendAuditLog('issue_deleted', req.user, null, { issueId, engine: 'portal' });
            return res.json({ success: true, message: 'Issue deleted.' });
        }
        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });
        await requestAppService.deleteIssue(config, issueId);
        await appendAuditLog('issue_deleted', req.user, null, { issueId });
        res.json({ success: true, message: 'Issue deleted.' });
    } catch (error) {
        res.status(error.status || 502).json({ error: error.message || 'Failed to delete issue' });
    }
});

app.get('/api/blocklist/count', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        if (getRequestEngine(config) === 'portal') {
            const portalBlocklist = getPortalBlocklistService(config);
            const total = await portalBlocklist.getBlocklistCount();
            return res.json({ configured: true, supported: true, connected: true, engine: 'portal', total });
        }
        const gate = getRequestAppGate(config);
        if (!gate.ready) {
            return res.json(buildRequestAppStatusPayload(config));
        }
        try {
            const total = await requestAppService.getBlocklistCount(config);
            res.json({ configured: true, supported: true, connected: true, total });
        } catch (error) {
            res.json({
                ...buildRequestAppStatusPayload(config),
                configured: true,
                supported: true,
                connected: false,
                error: error.message || 'Failed to connect to request app',
                total: 0,
            });
        }
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to fetch blocklist count' });
    }
});

app.get('/api/blocklist/search', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const query = String(req.query.query || '').trim();
        if (getRequestEngine(config) === 'portal') {
            const portalBlocklist = getPortalBlocklistService(config);
            const results = await portalBlocklist.searchBlocklistCandidates(query);
            return res.json({ configured: true, engine: 'portal', results });
        }
        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });

        const results = await requestAppService.searchBlocklistCandidates(config, query);
        res.json({ configured: true, results });
    } catch (error) {
        res.status(error.status || 502).json({ error: error.message || 'Failed to search titles' });
    }
});

app.get('/api/blocklist', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const take = Math.min(50, Math.max(1, Number(req.query.take) || 30));
        const skip = Math.max(0, Number(req.query.skip) || 0);
        const search = String(req.query.search || '').trim();
        const filter = String(req.query.filter || 'manual').toLowerCase();

        if (getRequestEngine(config) === 'portal') {
            const portalBlocklist = getPortalBlocklistService(config);
            const payload = await portalBlocklist.listBlocklist({ take, skip, search, filter });
            return res.json({ configured: true, supported: true, connected: true, engine: 'portal', ...payload });
        }

        const gate = getRequestAppGate(config);
        if (!gate.ready) {
            return res.json({ ...buildRequestAppStatusPayload(config), results: [] });
        }

        try {
            const payload = await requestAppService.listBlocklist(config, { take, skip, search, filter });
            res.json({ configured: true, supported: true, connected: true, ...payload });
        } catch (error) {
            res.json({
                ...buildRequestAppStatusPayload(config),
                configured: true,
                supported: true,
                connected: false,
                error: error.message || 'Failed to connect to request app',
                results: [],
            });
        }
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to fetch blocklist' });
    }
});

app.post('/api/blocklist', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const { tmdbId, mediaType, title } = req.body || {};
        if (getRequestEngine(config) === 'portal') {
            const portalBlocklist = getPortalBlocklistService(config);
            const item = await portalBlocklist.addToBlocklist(req.user, { tmdbId, mediaType, title });
            await appendAuditLog('blocklist_added', req.user, null, {
                tmdbId,
                mediaType,
                title: title || item?.title || null,
                engine: 'portal',
            });
            return res.status(201).json({ success: true, item });
        }
        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });

        const item = await requestAppService.addToBlocklist(config, req.user, { tmdbId, mediaType, title });
        await appendAuditLog('blocklist_added', req.user, null, { tmdbId, mediaType, title: title || item?.title || null });
        res.status(201).json({ success: true, item });
    } catch (error) {
        const status = /already blocklisted/i.test(error.message || '') ? 409 : (error.status || 502);
        res.status(status).json({ error: error.message || 'Failed to blocklist title' });
    }
});

app.delete('/api/blocklist/:tmdbId', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const tmdbId = String(req.params.tmdbId || '').trim();
        const mediaType = String(req.query.mediaType || '').toLowerCase();
        if (!tmdbId) return res.status(400).json({ error: 'TMDB ID is required' });
        if (mediaType !== 'movie' && mediaType !== 'tv') {
            return res.status(400).json({ error: 'mediaType must be movie or tv' });
        }

        if (getRequestEngine(config) === 'portal') {
            const portalBlocklist = getPortalBlocklistService(config);
            await portalBlocklist.removeFromBlocklist(tmdbId, mediaType);
            await appendAuditLog('blocklist_removed', req.user, null, { tmdbId, mediaType, engine: 'portal' });
            return res.json({ success: true, message: 'Title removed from blocklist.' });
        }

        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });

        await requestAppService.removeFromBlocklist(config, tmdbId, mediaType);
        await appendAuditLog('blocklist_removed', req.user, null, { tmdbId, mediaType });
        res.json({ success: true, message: 'Title removed from blocklist.' });
    } catch (error) {
        res.status(error.status || 502).json({ error: error.message || 'Failed to remove blocklist entry' });
    }
});

app.get('/api/discovery/watchlist', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        if (getRequestEngine(config) === 'portal') {
            const portalWatchlist = getPortalWatchlistService(config);
            const payload = await portalWatchlist.getMemberWatchlist(req.user);
            return res.json(await attachDiscoveryAvailabilityCacheToPayload(config, req.user, payload));
        }
        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });

        const payload = await requestAppService.getMemberWatchlist(config, req.user);
        res.json(await attachDiscoveryAvailabilityCacheToPayload(config, req.user, payload));
    } catch (e) {
        log(`Discovery watchlist error: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/discovery/watchlist/request', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const { all, items, is4k } = req.body || {};
        if (getRequestEngine(config) === 'portal') {
            const portalWatchlist = getPortalWatchlistService(config);
            const summary = await portalWatchlist.requestMemberWatchlist(req.user, {
                all: !!all,
                items: Array.isArray(items) ? items : [],
                is4k: !!is4k,
            });
            return res.status(summary.submitted > 0 ? 201 : 200).json(summary);
        }
        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });

        const summary = await requestAppService.requestMemberWatchlist(config, req.user, {
            all: !!all,
            items: Array.isArray(items) ? items : [],
            is4k: !!is4k,
        });
        res.status(summary.submitted > 0 ? 201 : 200).json(summary);
    } catch (e) {
        log(`Discovery watchlist request error: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/discovery/request', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const {
            mediaType,
            mediaId,
            is4k,
            seasons,
            serverId,
            profileId,
            rootFolder,
            languageProfileId,
            tags,
        } = req.body || {};
        if (!mediaType || !mediaId) return res.status(400).json({ error: 'Missing media details' });

        const type = mediaType === 'tv' ? 'tv' : 'movie';
        const tmdbId = Number(mediaId);

        // Phase 5–8: portal engine — JSON store + portal quotas + optional auto-approve.
        if (getRequestEngine(config) === 'portal') {
            const portalRequests = getPortalRequestService(config);
            const users = await loadFile(USERS_PATH, []);
            const key = String(req.user?.id || req.user?.plexId || '');
            const portalUser = users.find((u) => String(u?.id) === key || String(u?.plexId) === key) || req.user;
            const records = await portalRequests.store.list({ userId: String(portalUser?.id || req.user?.id || '') });
            const policy = resolveMemberRequestPolicy(config, portalUser);
            const perm = canPolicyRequestMedia(policy, type, { is4k: !!is4k });
            if (!perm.ok) {
                return res.status(403).json({ error: perm.reason || 'You cannot request this title.' });
            }
            const quotaEval = evaluatePortalMemberQuota(config, records, {
                is4k: !!is4k,
                policy,
                mediaType: type,
            });
            if (quotaEval.blocked) {
                const bucket = is4k ? quotaEval.quota.fourK : quotaEval.quota.standard;
                return res.status(429).json({
                    error: bucket.limit
                        ? `You have used all ${bucket.limit} ${is4k ? '4K ' : ''}requests for this period.`
                        : 'You have reached your request quota for this period.',
                });
            }

            const created = await portalRequests.createMemberRequest(req.user, {
                mediaType: type,
                mediaId: tmdbId,
                is4k: !!is4k,
                seasons,
                serverId,
                profileId,
                rootFolder,
                languageProfileId,
                tags,
            });

            if (shouldPortalAutoApprove(config, type, { is4k: !!is4k })) {
                try {
                    const approved = await portalRequests.approveAdminRequest(created.id, null, req.user);
                    return res.status(201).json(approved);
                } catch (approveError) {
                    log(`Portal auto-approve failed for request ${created.id}: ${approveError.message}`);
                    return res.status(201).json({
                        ...created,
                        autoApproveError: approveError.message,
                    });
                }
            }

            return res.status(201).json(created);
        }

        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });

        const options = await requestAppService.getMemberRequestOptions(config, req.user, {
            mediaType: type,
            mediaId: tmdbId,
        });

        if (!options.canRequest) {
            return res.status(403).json({ error: options.blockReason || 'You cannot request this title.' });
        }
        if (is4k && !options.canRequest4k) {
            return res.status(403).json({ error: 'You do not have permission to request 4K media.' });
        }
        if (is4k) {
            const fourKQuota = options.quota?.fourK;
            if (fourKQuota?.limit > 0 && fourKQuota.remaining === 0) {
                return res.status(429).json({ error: `You have used all ${fourKQuota.limit} 4K requests for this period.` });
            }
        } else if (options.standardQuotaBlocked) {
            const limit = options.quota?.standard?.limit;
            return res.status(429).json({
                error: limit
                    ? `You have used all ${limit} requests for this period.`
                    : 'You have reached your request quota for this period.',
            });
        }

        const body = { mediaType: type, mediaId: tmdbId };
        if (is4k) body.is4k = true;
        if (type === 'tv') {
            const requestableSeasonIds = new Set(
                (options.seasons || [])
                    .filter((season) => season.requestable)
                    .map((season) => Number(season.seasonNumber))
                    .filter((n) => Number.isFinite(n)),
            );
            if (seasons === 'all') {
                body.seasons = 'all';
            } else if (Array.isArray(seasons) && seasons.length > 0) {
                const nextSeasons = seasons.map((season) => Number(season)).filter((season) => Number.isFinite(season));
                if (requestableSeasonIds.size && nextSeasons.some((id) => !requestableSeasonIds.has(id))) {
                    return res.status(403).json({ error: 'One or more selected seasons are not requestable.' });
                }
                body.seasons = nextSeasons;
            } else {
                body.seasons = 'all';
            }
        }

        if (options.canRequestAdvanced) {
            const hasRouting =
                serverId != null
                || profileId != null
                || rootFolder
                || languageProfileId != null
                || Array.isArray(tags);
            if (hasRouting) {
                try {
                    const routing = await requestAppService.validateMemberRequestRouting(config, {
                        mediaType: type,
                        is4k: !!is4k,
                        servers: options.servers,
                        serverId,
                        profileId,
                        rootFolder,
                        languageProfileId,
                        tags,
                    });
                    Object.assign(body, routing);
                } catch (routingErr) {
                    return res.status(routingErr.status || 400).json({
                        error: routingErr.message || 'Invalid request routing options.',
                    });
                }
            }
        }

        if (options.seerrUserId) body.userId = options.seerrUserId;

        const data = await requestAppService.rawFetch(config, '/api/v1/request', {
            method: 'POST',
            body,
        });
        res.status(201).json(data);
    } catch (e) {
        const mapped = mapSeerrClientError(e.message, e.status);
        log(`Discovery request error: ${e.message}`);
        res.status(e.status || mapped.status || 500).json({ error: mapped.error || e.message });
    }
});

app.get('/api/discovery/fact', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const mediaType = String(req.query.mediaType || '').toLowerCase();
        const mediaId = Number(req.query.mediaId);
        if ((mediaType !== 'movie' && mediaType !== 'tv') || !Number.isFinite(mediaId)) {
            return res.status(400).json({ error: 'Invalid mediaType or mediaId' });
        }

        let details = null;
        const discoverySource = getDiscoverySource(config);
        if (discoverySource === 'tmdb') {
            if (!String(config.tmdbApiKey || '').trim()) {
                return res.status(400).json({ error: 'TMDB API key is required when Discover source is TMDB' });
            }
            const client = createTmdbClient({
                tmdbApiKey: config.tmdbApiKey,
                language: resolveDiscoverMetadataLanguage(req),
            });
            details = mediaType === 'tv'
                ? await client.tv(mediaId, { language: resolveDiscoverMetadataLanguage(req) })
                : await client.movie(mediaId, { language: resolveDiscoverMetadataLanguage(req) });
        } else {
            const gate = getRequestAppGate(config);
            if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });
            details = await requestAppService.rawFetch(config, `/api/v1/${mediaType}/${mediaId}`);
        }

        const wikiFetch = (url, opts = {}) => fetchWithTimeout(
            url,
            {
                ...opts,
                headers: {
                    'User-Agent': 'PlexifiedPortal/1.0 (discovery-facts)',
                    ...(opts.headers || {}),
                },
            },
            opts.timeout || 8000,
        );

        const payload = await buildDiscoveryFacts({ details, mediaType, fetchFn: wikiFetch });
        res.json(payload);
    } catch (e) {
        log(`Discovery fact error: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/discovery/radarr-releases', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const tmdbId = Number(req.query.tmdbId || req.query.mediaId);
        if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
            return res.status(400).json({ error: 'Invalid tmdbId' });
        }
        if (!isArrTypeConfigured(config, 'radarr')) {
            return res.json({ configured: false, releases: null });
        }
        const releases = await fetchRadarrMovieReleaseDates(config, tmdbId, {
            resolveUrl: resolveIntegrationUrlForFetch,
            fetchImpl: fetch,
        });
        res.json({ configured: true, releases });
    } catch (e) {
        log(`Discovery Radarr releases error: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/arr/deep-link', requireAuth, requireAdmin, async (req, res) => {
    try {
        const mediaTypeRaw = String(req.query.mediaType || req.query.type || '').trim().toLowerCase();
        const mediaType = mediaTypeRaw === 'tv' || mediaTypeRaw === 'show' || mediaTypeRaw === 'series'
            ? 'tv'
            : (mediaTypeRaw === 'movie' ? 'movie' : '');
        const tmdbId = Number(req.query.tmdbId);
        const title = String(req.query.title || '').trim();
        const yearRaw = Number(req.query.year);
        const year = Number.isFinite(yearRaw) && yearRaw > 0 ? yearRaw : null;
        const is4k = req.query.is4k === '1' || String(req.query.is4k || '').toLowerCase() === 'true';

        if (mediaType !== 'movie' && mediaType !== 'tv') {
            return res.status(400).json({ error: 'mediaType must be movie or tv' });
        }
        if ((!Number.isFinite(tmdbId) || tmdbId <= 0) && !title) {
            return res.status(400).json({ error: 'tmdbId or title is required' });
        }

        const config = await loadFile(CONFIG_PATH, {});
        const normalized = normalizeArrConfig(config);
        const arrType = mediaType === 'movie' ? 'radarr' : 'sonarr';
        const enabled = getArrInstances(normalized, { type: arrType, enabledOnly: true }).filter(isArrInstanceReady);
        if (!enabled.length) {
            return res.status(404).json({ error: `${arrType === 'radarr' ? 'Radarr' : 'Sonarr'} is not configured` });
        }

        let preferred = null;
        if (is4k) {
            preferred = enabled.find((entry) => /4k|uhd/i.test(String(entry.name || ''))) || null;
        }
        if (!preferred) preferred = getDefaultArrInstance(normalized, arrType);
        if (!isArrInstanceReady(preferred)) {
            return res.status(404).json({ error: `${arrType === 'radarr' ? 'Radarr' : 'Sonarr'} is not configured` });
        }

        const lookupItem = {
            mediaType,
            tmdbId: Number.isFinite(tmdbId) && tmdbId > 0 ? tmdbId : null,
            title,
            year,
        };

        // Movies can deep-link by TMDB id without scanning the full Arr catalog.
        if (arrType === 'radarr' && lookupItem.tmdbId) {
            const url = buildArrDeepUrl(preferred, { tmdbId: lookupItem.tmdbId, title: lookupItem.title }, 'radarr');
            if (url) {
                return res.json({
                    url,
                    arrType,
                    label: 'Open in Radarr',
                    instanceName: preferred.name || 'Radarr',
                });
            }
        }

        const catalog = await getArrCatalog(normalized);
        const resolved = resolveArrEntity(lookupItem, catalog, normalized);
        let instance = resolved.instanceId ? getArrInstance(normalized, resolved.instanceId) : preferred;
        if (!isArrInstanceReady(instance)) instance = preferred;
        let entity = resolved.entity || null;

        if (!entity && arrType === 'radarr' && lookupItem.tmdbId) {
            entity = { tmdbId: lookupItem.tmdbId, title: lookupItem.title };
        }

        if (!entity && arrType === 'sonarr' && instance) {
            const terms = [];
            if (lookupItem.tmdbId) terms.push(`tmdb:${lookupItem.tmdbId}`);
            if (lookupItem.title) terms.push(lookupItem.title);
            for (const term of terms) {
                const payload = await fetchArrInstanceJson(instance, `/api/v3/series/lookup?term=${encodeURIComponent(term)}`, {
                    resolveUrl: resolveIntegrationUrlForFetch,
                    fetchImpl: fetch,
                }).catch(() => null);
                const records = Array.isArray(payload) ? payload : [];
                const match = lookupItem.tmdbId
                    ? (records.find((entry) => Number(entry?.tmdbId) === lookupItem.tmdbId) || records[0])
                    : records[0];
                if (match) {
                    entity = match;
                    break;
                }
            }
            if (!entity && lookupItem.title) {
                entity = { title: lookupItem.title };
            }
        }

        const url = buildArrDeepUrl(instance, entity, arrType);
        if (!url) {
            return res.status(404).json({ error: 'Unable to build Arr deep link' });
        }

        res.json({
            url,
            arrType,
            label: arrType === 'radarr' ? 'Open in Radarr' : 'Open in Sonarr',
            instanceName: instance.name || (arrType === 'radarr' ? 'Radarr' : 'Sonarr'),
        });
    } catch (e) {
        log(`Arr deep-link error: ${e.message}`);
        res.status(500).json({ error: e.message || 'Failed to resolve Arr deep link' });
    }
});

app.get('/api/discovery/ratings/:mediaType/:mediaId', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const mediaType = String(req.params.mediaType || '').toLowerCase();
        const mediaId = Number(req.params.mediaId);
        if (!['movie', 'tv'].includes(mediaType)) {
            return res.status(400).json({ error: 'Invalid media type' });
        }
        if (!Number.isFinite(mediaId) || mediaId <= 0) {
            return res.status(400).json({ error: 'Invalid media id' });
        }

        const discoverySource = getDiscoverySource(config);
        const gate = getRequestAppGate(config);
        let ratings = null;

        if (discoverySource === 'seerr' && gate.ready) {
            ratings = await fetchDiscoveryCombinedRatings({
                config,
                rawFetchOptional: requestAppService.rawFetchOptional,
                fetchImpl: fetchWithTimeout,
                mediaType,
                mediaId,
            });
        } else {
            // Phase 4: TMDB + Radarr IMDb path (Rotten Tomatoes still needs Seerr when available).
            if (!String(config.tmdbApiKey || '').trim()) {
                return res.status(400).json({ error: 'TMDB API key is required when Discover source is TMDB' });
            }
            const language = resolveDiscoverMetadataLanguage(req);
            const client = createTmdbClient({ tmdbApiKey: config.tmdbApiKey, language });
            const details = mediaType === 'tv'
                ? await client.tv(mediaId, { language })
                : await client.movie(mediaId, { language });
            const imdbId = details?.imdbId
                || details?.externalIds?.imdbId
                || null;
            const imdb = await fetchImdbRatingsFromRadarr(imdbId, fetchWithTimeout);
            ratings = imdb ? { imdb } : {};
        }

        if (ratings == null) {
            return res.status(502).json({ error: 'Unable to retrieve ratings.' });
        }
        if (!ratings.rt && !ratings.imdb) {
            return res.status(404).json({ message: 'No ratings found.' });
        }
        return res.json(ratings);
    } catch (e) {
        log(`Discovery ratings error: ${e.message}`);
        return res.status(500).json({ error: e.message });
    }
});

app.get('/api/discovery/tv/:tmdbId/library-status', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const tmdbId = Number(req.params.tmdbId);
        if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
            return res.status(400).json({ error: 'Invalid tmdbId' });
        }

        const upgraderIndex = await loadUpgraderIndex();
        const statusPromise = fetchSonarrLibraryStatusForShow(config, tmdbId, {
            resolveUrl: resolveIntegrationUrlForFetch,
            fetchImpl: fetch,
            upgraderItems: upgraderIndex?.items || [],
        });
        const timeoutMs = 8000;
        const sonarrLibraryStatus = await Promise.race([
            statusPromise,
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Sonarr library check timed out')), timeoutMs);
            }),
        ]);

        res.json({ sonarrLibraryStatus });
    } catch (e) {
        log(`Discovery library-status error: ${e.message}`);
        res.json({ sonarrLibraryStatus: { matched: false, error: e.message } });
    }
});

app.get('/api/discovery/library-link', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const mediaTypeRaw = String(req.query.mediaType || req.query.type || '').trim().toLowerCase();
        const mediaType = mediaTypeRaw === 'tv' || mediaTypeRaw === 'show' || mediaTypeRaw === 'series'
            ? 'tv'
            : (mediaTypeRaw === 'movie' ? 'movie' : '');
        const tmdbId = Number(req.query.tmdbId);
        const ratingKeyHint = String(req.query.ratingKey || '').replace(/^\/library\/metadata\//, '').trim();
        const title = String(req.query.title || '').trim();
        const yearRaw = Number(req.query.year);
        const year = Number.isFinite(yearRaw) && yearRaw > 0 ? yearRaw : null;

        if (mediaType !== 'movie' && mediaType !== 'tv') {
            return res.status(400).json({ error: 'mediaType must be movie or tv' });
        }
        if ((!Number.isFinite(tmdbId) || tmdbId <= 0) && !ratingKeyHint && !title) {
            return res.status(400).json({ error: 'tmdbId, ratingKey, or title is required' });
        }

        const mediaServerType = String(config.mediaServerType || 'plex').toLowerCase();
        const providerLabel = mediaServerType === 'jellyfin' ? 'Jellyfin' : (mediaServerType === 'emby' ? 'Emby' : 'Plex');
        const toPlexWebUrl = (key) => {
            const clean = String(key || '').replace(/^\/library\/metadata\//, '').trim();
            if (!config.serverIdentifier || !clean) return null;
            return `https://app.plex.tv/desktop#!/server/${config.serverIdentifier}/details?key=${encodeURIComponent(`/library/metadata/${clean}`)}`;
        };

        if (mediaServerType === 'jellyfin' || mediaServerType === 'emby') {
            if (!isJellyfinConfigured(config)) {
                return res.status(404).json({ error: `${providerLabel} is not configured` });
            }
            let itemId = ratingKeyHint;
            if (!itemId && Number.isFinite(tmdbId) && tmdbId > 0) {
                const baseUrl = resolveIntegrationUrlForFetch(config.jellyfinUrl);
                const includeType = mediaType === 'movie' ? 'Movie' : 'Series';
                const lookupUrl = `${baseUrl}/Items?Recursive=true&IncludeItemTypes=${encodeURIComponent(includeType)}&AnyProviderIdEquals=${encodeURIComponent(`Tmdb=${tmdbId}`)}&Limit=1&fields=ProviderIds`;
                const response = await fetchWithTimeout(lookupUrl, {
                    headers: jellyfinHeaders(config.jellyfinApiKey),
                }, 12000).catch(() => null);
                if (response?.ok) {
                    const payload = await response.json().catch(() => null);
                    const items = Array.isArray(payload?.Items) ? payload.Items : [];
                    itemId = String(items[0]?.Id || '').trim();
                }
            }
            const url = jellyfinItemUrl(config, itemId);
            if (!url || !itemId) {
                return res.status(404).json({ error: `Title not found in ${providerLabel}` });
            }
            return res.json({ url, label: `Open in ${providerLabel}`, provider: mediaServerType });
        }

        if (!isPlexConfigured(config)) {
            return res.status(404).json({ error: 'Plex is not configured' });
        }

        // Fast path: Seerr/Overseerr already knows the Plex rating key
        if (ratingKeyHint) {
            const url = toPlexWebUrl(ratingKeyHint);
            if (url) {
                return res.json({ url, label: 'Open in Plex', provider: 'plex', ratingKey: ratingKeyHint });
            }
        }

        const uri = await getPlexConnectionUri(config);
        if (!uri) {
            return res.status(503).json({ error: 'Unable to reach Plex server' });
        }

        const plexType = mediaType === 'movie' ? 1 : 2;
        const guidCandidates = Number.isFinite(tmdbId) && tmdbId > 0
            ? [
                `tmdb://${tmdbId}`,
                `com.plexapp.agents.themoviedb://${tmdbId}?lang=en`,
                `tmdb://${tmdbId}?lang=en`,
            ]
            : [];

        const metaMatchesTmdb = (meta) => {
            if (!Number.isFinite(tmdbId) || tmdbId <= 0 || !meta) return false;
            const needle = String(tmdbId);
            const guidBlob = [
                meta.guid,
                ...(Array.isArray(meta.Guid) ? meta.Guid.map((g) => g?.id || g) : []),
            ].map((v) => String(v || '')).join(' ').toLowerCase();
            return guidBlob.includes(`tmdb://${needle}`)
                || guidBlob.includes(`themoviedb://${needle}`)
                || guidBlob.includes(`tmdb:${needle}`);
        };

        let ratingKey = '';

        for (const guid of guidCandidates) {
            const lookupUrl = `${uri}/library/all?type=${plexType}&guid=${encodeURIComponent(guid)}&includeGuids=1&X-Plex-Token=${encodeURIComponent(config.plexToken)}`;
            const response = await fetchWithTimeout(lookupUrl, { headers: plexClientHeaders(config.plexToken) }, 12000).catch(() => null);
            if (!response?.ok) continue;
            const payload = await response.json().catch(() => null);
            const meta = payload?.MediaContainer?.Metadata?.[0];
            if (meta?.ratingKey) {
                ratingKey = String(meta.ratingKey);
                break;
            }
        }

        if (!ratingKey) {
            const sectionsRes = await fetchWithTimeout(
                `${uri}/library/sections?X-Plex-Token=${encodeURIComponent(config.plexToken)}`,
                { headers: plexClientHeaders(config.plexToken) },
                12000,
            ).catch(() => null);
            const sections = sectionsRes?.ok ? (await sectionsRes.json().catch(() => null))?.MediaContainer?.Directory || [] : [];
            const wantedType = mediaType === 'movie' ? 'movie' : 'show';
            for (const section of sections) {
                if (String(section?.type || '') !== wantedType) continue;
                for (const guid of guidCandidates) {
                    const sectionLookup = `${uri}/library/sections/${encodeURIComponent(section.key)}/all?type=${plexType}&guid=${encodeURIComponent(guid)}&includeGuids=1&X-Plex-Token=${encodeURIComponent(config.plexToken)}`;
                    const response = await fetchWithTimeout(sectionLookup, { headers: plexClientHeaders(config.plexToken) }, 12000).catch(() => null);
                    if (!response?.ok) continue;
                    const payload = await response.json().catch(() => null);
                    const meta = payload?.MediaContainer?.Metadata?.[0];
                    if (meta?.ratingKey) {
                        ratingKey = String(meta.ratingKey);
                        break;
                    }
                }
                if (ratingKey) break;
            }
        }

        // Title search fallback (availability can come from Sonarr before Seerr has a ratingKey)
        if (!ratingKey && title) {
            const searchUrl = `${uri}/hubs/search?query=${encodeURIComponent(title)}&limit=30&includeGuids=1&X-Plex-Token=${encodeURIComponent(config.plexToken)}`;
            const searchRes = await fetchWithTimeout(searchUrl, { headers: plexClientHeaders(config.plexToken) }, 15000).catch(() => null);
            const hubs = searchRes?.ok
                ? ((await searchRes.json().catch(() => null))?.MediaContainer?.Hub || [])
                : [];
            const wantedHubTypes = mediaType === 'movie' ? new Set(['movie']) : new Set(['show']);
            const candidates = [];
            for (const hub of hubs) {
                if (hub?.type && !wantedHubTypes.has(String(hub.type))) continue;
                for (const meta of (Array.isArray(hub?.Metadata) ? hub.Metadata : [])) {
                    if (!meta?.ratingKey) continue;
                    candidates.push(meta);
                }
            }

            const tmdbHit = candidates.find(metaMatchesTmdb);
            if (tmdbHit?.ratingKey) {
                ratingKey = String(tmdbHit.ratingKey);
            } else {
                const titleKey = title.trim().toLowerCase();
                const exact = candidates.find((meta) => {
                    const metaTitle = String(meta.title || meta.grandparentTitle || '').trim().toLowerCase();
                    if (metaTitle !== titleKey) return false;
                    if (year && Number(meta.year) && Number(meta.year) !== year) return false;
                    return true;
                });
                if (exact?.ratingKey) ratingKey = String(exact.ratingKey);
            }
        }

        const url = toPlexWebUrl(ratingKey);
        if (!url) {
            return res.status(404).json({ error: 'Title not found in Plex' });
        }
        return res.json({ url, label: 'Open in Plex', provider: 'plex', ratingKey });
    } catch (e) {
        log(`Discovery library-link error: ${e.message}`);
        res.status(500).json({ error: e.message || 'Failed to resolve library link' });
    }
});

app.get(withWildcard('/api/discovery/proxy'), requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const prefs = getDiscoveryPreferences(config);
        const metadataLanguage = resolveDiscoverMetadataLanguage(req);

        const path = normalizeDiscoveryProxyPath('/' + readWildcardPath(req));
        if (!path || !isAllowedDiscoveryProxyPath(path)) {
            return res.status(403).json({ error: 'Discovery proxy path is not allowed.' });
        }

        const params = applyDiscoveryQueryParams(new URLSearchParams(req.query), path, prefs, metadataLanguage);
        // Optional escape hatch only — Discover home no longer sends this (Seerr language parity).
        const allLanguages = String(req.query.allLanguages || '') === '1';
        const discoverLanguage = allLanguages ? '' : prefs.discoverLanguage;

        let data;
        if (prefs.discoverySource === 'tmdb') {
            if (!String(config.tmdbApiKey || '').trim()) {
                return res.status(400).json({ error: 'TMDB API key is required when Discover source is TMDB' });
            }
            const router = createTmdbDiscoverRouter(config, {
                language: metadataLanguage,
                region: prefs.discoverRegion,
                originalLanguage: discoverLanguage,
            });
            data = await router.fetchPath(path, params);
            // Detail *arr enrich is deferred — cache + client library-status/availability-batch
            // fill badges after first paint (blocking enrich made movie/TV pages feel stuck).
        } else {
            const gate = getRequestAppGate(config);
            if (!gate.ready) return res.status(400).json({ error: 'Request app not configured' });

            await ensureSeerrDiscoverySettings(config, requestAppService.rawFetch);
            const qs = params.toString();
            const fullPath = qs ? `${path}?${qs}` : path;
            data = await requestAppService.rawFetch(config, '/api/v1' + fullPath, {
                // Genre slider fans out many TMDB calls inside Seerr — needs a longer budget.
                timeoutMs: /^\/discover\/genreslider\//i.test(path) ? 90000 : 15000,
                // Seerr uses Accept-Language / req.locale for TMDB metadata on discover browse
                // (query.language there is the original-language filter, not title translation).
                headers: { 'Accept-Language': metadataLanguage },
            });
        }

        const tvDetailMatch = path.match(/^\/tv\/(\d+)$/);
        const shouldLibraryCheck = String(req.query.libraryCheck || req.query.sonarrCheck || '') === '1';
        // Seerr path still uses optional Sonarr enrich; TMDB path already enriched via libraryAvailability.
        if (
            prefs.discoverySource !== 'tmdb'
            && tvDetailMatch
            && shouldLibraryCheck
            && data
            && typeof data === 'object'
            && !Array.isArray(data)
        ) {
            try {
                const upgraderIndex = await loadUpgraderIndex();
                const enrichPromise = enrichTvDetailsWithSonarrLibraryStatus(config, data, {
                    resolveUrl: resolveIntegrationUrlForFetch,
                    fetchImpl: fetch,
                    upgraderItems: upgraderIndex?.items || [],
                });
                const timeoutMs = 8000;
                data = await Promise.race([
                    enrichPromise,
                    new Promise((_, reject) => {
                        setTimeout(() => reject(new Error('Sonarr library check timed out')), timeoutMs);
                    }),
                ]);
            } catch (sonarrError) {
                log(`Discovery Sonarr library check skipped for tv/${tvDetailMatch[1]}: ${sonarrError.message}`);
            }
        }
        data = await attachDiscoveryAvailabilityCacheToPayload(config, req.user, data);
        // Do not strip available titles here — client hide+backfill needs full pages so home/browse
        // can refill after filtering. Cache still attaches badges for first paint.
        // Post-filter by Discover Language (needed for trending / any list TMDB can't filter server-side).
        data = filterDiscoveryPayload(
            data,
            path,
            false,
            discoverLanguage,
        );
        // TMDB-missing TV posters → TheTVDB (requires tvdbApiKey; soft-timeout so browse stays snappy).
        data = await enrichDiscoveryPayloadWithTvdbPosters(config, data, {
            fetchImpl: fetch,
            timeoutMs: 2800,
            concurrency: 4,
        });
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/requests/pending', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const take = Math.min(10, Math.max(1, Number(req.query.take) || 5));

        if (getRequestEngine(config) === 'portal') {
            try {
                const portalRequests = getPortalRequestService(config);
                const [counts, list] = await Promise.all([
                    portalRequests.getAdminRequestCounts(),
                    portalRequests.listAdminRequests({ filter: 'pending', take, skip: 0 }),
                ]);
                const pendingFromList = list.results.length;
                const pending = Math.max(counts.pending, pendingFromList);
                return res.json({
                    configured: true,
                    supported: true,
                    connected: true,
                    engine: 'portal',
                    pending,
                    approved: counts.approved,
                    declined: counts.declined,
                    total: counts.total,
                    results: list.results,
                });
            } catch (error) {
                return res.json({
                    configured: true,
                    supported: true,
                    connected: false,
                    engine: 'portal',
                    ...emptyRequestCounts(),
                    error: error.message || 'Failed to load portal requests',
                    results: [],
                });
            }
        }

        const gate = getRequestAppGate(config);
        if (!gate.ready) {
            return res.json({ ...buildRequestAppStatusPayload(config), results: [] });
        }
        try {
            const [counts, list] = await Promise.all([
                requestAppService.getRequestCounts(config),
                requestAppService.listRequests(config, { filter: 'pending', take, skip: 0 }),
            ]);
            const pendingFromList = list.results.length;
            const pending = Math.max(counts.pending, pendingFromList);
            res.json({
                configured: true,
                supported: true,
                connected: true,
                pending,
                approved: counts.approved,
                declined: counts.declined,
                total: counts.total,
                results: list.results,
            });
        } catch (error) {
            res.json({
                ...buildRequestAppStatusPayload(config),
                configured: true,
                supported: true,
                connected: false,
                error: error.message || 'Failed to connect to request app',
                results: [],
            });
        }
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to fetch pending requests' });
    }
});

app.get('/api/requests/count', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        if (getRequestEngine(config) === 'portal') {
            try {
                const portalRequests = getPortalRequestService(config);
                const counts = await portalRequests.getAdminRequestCounts();
                return res.json({ configured: true, supported: true, connected: true, engine: 'portal', ...counts });
            } catch (error) {
                return res.json({
                    configured: true,
                    supported: true,
                    connected: false,
                    engine: 'portal',
                    ...emptyRequestCounts(),
                    error: error.message || 'Failed to load portal request counts',
                });
            }
        }

        const gate = getRequestAppGate(config);
        if (!gate.ready) {
            return res.json(buildRequestAppStatusPayload(config));
        }
        try {
            const counts = await requestAppService.getRequestCounts(config);
            res.json({ configured: true, supported: true, connected: true, ...counts });
        } catch (error) {
            res.json({
                ...buildRequestAppStatusPayload(config),
                configured: true,
                supported: true,
                connected: false,
                error: error.message || 'Failed to connect to request app',
            });
        }
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to fetch request counts' });
    }
});

app.get('/api/requests', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const filter = REQUEST_LIST_FILTERS.has(String(req.query.filter || '')) ? String(req.query.filter) : 'pending';
        const take = Math.min(50, Math.max(1, Number(req.query.take) || 20));
        const skip = Math.max(0, Number(req.query.skip) || 0);

        if (getRequestEngine(config) === 'portal') {
            try {
                const portalRequests = getPortalRequestService(config);
                const payload = await portalRequests.listAdminRequests({ filter, take, skip });
                return res.json({ configured: true, supported: true, connected: true, engine: 'portal', ...payload });
            } catch (error) {
                return res.json({
                    configured: true,
                    supported: true,
                    connected: false,
                    engine: 'portal',
                    error: error.message || 'Failed to load portal requests',
                    results: [],
                    pageInfo: { pages: 1, results: 0, page: 1 },
                });
            }
        }

        const gate = getRequestAppGate(config);
        if (!gate.ready) {
            return res.json({
                ...buildRequestAppStatusPayload(config),
                results: [],
                pageInfo: { pages: 1, results: 0, page: 1 },
            });
        }
        try {
            const payload = await requestAppService.listRequests(config, { filter, take, skip });
            res.json({ configured: true, supported: true, connected: true, ...payload });
        } catch (error) {
            res.json({
                ...buildRequestAppStatusPayload(config),
                configured: true,
                supported: true,
                connected: false,
                error: error.message || 'Failed to connect to request app',
                results: [],
                pageInfo: { pages: 1, results: 0, page: 1 },
            });
        }
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to fetch requests' });
    }
});

app.post('/api/requests/import-from-seerr', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const gate = getRequestAppGate(config);
        if (!gate.ready) {
            return res.status(400).json({ error: gate.error || 'Request app not configured' });
        }
        const portalUsers = await loadFile(USERS_PATH, []);
        const includeIssues = req.body?.includeIssues !== false;
        const includeBlocklist = req.body?.includeBlocklist !== false;
        const fallbackUserId = String(req.body?.fallbackUserId || req.user?.id || req.user?.plexId || '').trim() || null;
        const summary = await importSeerrHistoryToPortal({
            config,
            fetchSeerrJson: requestAppService.rawFetch,
            requestsDir: REQUESTS_DIR,
            issuesDir: ISSUES_DIR,
            blocklistDir: BLOCKLIST_DIR,
            portalUsers,
            includeIssues,
            includeBlocklist,
            fallbackUserId,
        });
        log(`[SeerrImport] requests imported=${summary.requests.imported} skippedExisting=${summary.requests.skippedExisting} unmapped=${summary.requests.skippedUnmapped}; issues imported=${summary.issues.imported}; blocklist imported=${summary.blocklist.imported}`);
        res.json({ ok: true, ...summary });
    } catch (error) {
        log(`[SeerrImport] failed: ${error.message}`);
        res.status(502).json({ error: error.message || 'Failed to import Seerr history' });
    }
});

/** One-shot Seerr → portal import during initial setup (before admin session exists). */
app.post('/api/setup/import-seerr', setupRateLimit, async (req, res) => {
    try {
        if (!(await assertInitialSetupAccess(req, res))) return;

        const body = req.body || {};
        const appType = String(body.requestAppType || 'seerr').toLowerCase() === 'jellyseerr'
            ? 'jellyseerr'
            : 'seerr';
        const requestAppUrl = String(body.requestAppUrl || '').trim();
        const requestAppApiKey = String(body.requestAppApiKey || '').trim();
        if (!requestAppUrl || !requestAppApiKey) {
            return res.status(400).json({ error: 'Seerr URL and API key are required to import.' });
        }

        const existingConfig = await loadFile(CONFIG_PATH, {});
        const importConfig = {
            ...existingConfig,
            requestAppType: appType,
            requestAppUrl,
            requestAppApiKey,
            requestAppFetchUrl: String(body.requestAppFetchUrl || '').trim() || undefined,
        };

        let fallbackUserId = String(body.fallbackUserId || '').trim() || null;
        const plexToken = String(body.plexToken || body.token || '').trim();
        if (!fallbackUserId && plexToken) {
            try {
                const account = await fetchWithTimeout('https://plex.tv/api/v2/user', {
                    headers: {
                        Accept: 'application/json',
                        'X-Plex-Token': plexToken,
                        'X-Plex-Product': 'Server Manager Portal',
                        'X-Plex-Client-Identifier': process.env.CLIENT_ID || 'server-manager-portal',
                    },
                }, 10000).then((r) => (r.ok ? r.json() : null)).catch(() => null);
                if (account?.id != null) fallbackUserId = String(account.id);
            } catch {
                // Import can still proceed; unmapped rows stay skipped without a fallback.
            }
        }

        const portalUsers = await loadFile(USERS_PATH, []);
        const summary = await importSeerrHistoryToPortal({
            config: importConfig,
            fetchSeerrJson: requestAppService.rawFetch,
            requestsDir: REQUESTS_DIR,
            issuesDir: ISSUES_DIR,
            blocklistDir: BLOCKLIST_DIR,
            portalUsers,
            includeIssues: body.includeIssues !== false,
            includeBlocklist: body.includeBlocklist !== false,
            fallbackUserId,
        });
        log(`[SeerrImport/setup] requests imported=${summary.requests.imported} fallback=${summary.requests.importedWithFallback || 0}`);
        res.json({ ok: true, ...summary });
    } catch (error) {
        log(`[SeerrImport/setup] failed: ${error.message}`);
        res.status(502).json({ error: error.message || 'Failed to import Seerr history' });
    }
});

app.post('/api/requests/override-defaults', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        if (getRequestEngine(config) === 'portal') {
            // Seerr override rules are unavailable; portal approve uses *arr defaults.
            return res.json({});
        }
        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: gate.error || 'Request app not configured' });
        const defaults = await requestAppService.getAdvancedRequestDefaults(config, {
            mediaType: req.body?.mediaType,
            tmdbId: req.body?.tmdbId,
            userId: req.body?.userId,
            is4k: req.body?.is4k,
        });
        if (!defaults) return res.json({});
        res.json(defaults);
    } catch (error) {
        res.status(502).json({ error: error.message || 'Failed to fetch override defaults' });
    }
});

app.get('/api/requests/users', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        if (getRequestEngine(config) === 'portal') {
            const portalRequests = getPortalRequestService(config);
            const users = await portalRequests.listPortalRequestUsers();
            return res.json({ users });
        }
        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: gate.error || 'Request app not configured' });
        const users = await requestAppService.listRequestUsers(config);
        res.json({ users });
    } catch (error) {
        res.status(502).json({ error: error.message || 'Failed to fetch request users' });
    }
});

app.get('/api/requests/services/:type', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const type = String(req.params.type || '').toLowerCase() === 'radarr' ? 'movie' : 'tv';
        if (getRequestEngine(config) === 'portal') {
            const portalRequests = getPortalRequestService(config);
            return res.json({ servers: portalRequests.listPortalArrServers(type) });
        }
        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: gate.error || 'Request app not configured' });
        const servers = await requestAppService.listServiceServers(config, type);
        res.json({ servers });
    } catch (error) {
        res.status(502).json({ error: error.message || 'Failed to fetch service servers' });
    }
});

app.get('/api/requests/services/:type/:serverId', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const type = String(req.params.type || '').toLowerCase() === 'radarr' ? 'movie' : 'tv';
        const serverId = String(req.params.serverId || '').trim();
        if (!serverId) return res.status(400).json({ error: 'Server ID is required' });
        if (getRequestEngine(config) === 'portal') {
            const portalRequests = getPortalRequestService(config);
            const options = await portalRequests.getPortalArrServiceOptions(type, serverId);
            return res.json(options);
        }
        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: gate.error || 'Request app not configured' });
        const options = await requestAppService.getServiceOptions(config, type, serverId);
        res.json(options);
    } catch (error) {
        res.status(502).json({ error: error.message || 'Failed to fetch service options' });
    }
});

app.get('/api/requests/:id', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const requestId = String(req.params.id || '').trim();
        if (!requestId) return res.status(400).json({ error: 'Request ID is required' });
        if (getRequestEngine(config) === 'portal') {
            const portalRequests = getPortalRequestService(config);
            const detail = await portalRequests.getAdminRequest(requestId);
            return res.json({ configured: true, connected: true, engine: 'portal', ...detail });
        }
        const gate = getRequestAppGate(config);
        if (!gate.ready) return res.status(400).json({ error: gate.error || 'Request app not configured' });
        const detail = await requestAppService.getRequest(config, requestId);
        res.json({ configured: true, connected: true, ...detail });
    } catch (error) {
        res.status(error.status || 502).json({ error: error.message || 'Failed to fetch request' });
    }
});

app.put('/api/requests/:id', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const requestId = String(req.params.id || '').trim();
        if (!requestId) return res.status(400).json({ error: 'Request ID is required' });
        const overrides = req.body?.overrides || req.body || {};
        if (getRequestEngine(config) === 'portal') {
            const portalRequests = getPortalRequestService(config);
            const result = await portalRequests.updateAdminRequest(requestId, overrides, req.user);
            const title = result?.title || overrides?.title || `Request #${requestId}`;
            await appendAuditLog('request_updated', req.user, null, { requestId, title, overrides, engine: 'portal' });
            return res.json({ success: true, title });
        }
        const result = await requestAppService.updateRequest(config, requestId, overrides);
        const title = result?.media?.title || result?.media?.name || overrides?.title || `Request #${requestId}`;
        await appendAuditLog('request_updated', req.user, null, { requestId, title, overrides });
        res.json({ success: true, title });
    } catch (error) {
        res.status(error.status || 502).json({ error: error.message || 'Failed to update request' });
    }
});

app.delete('/api/requests/:id', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const requestId = String(req.params.id || '').trim();
        if (!requestId) return res.status(400).json({ error: 'Request ID is required' });
        if (getRequestEngine(config) === 'portal') {
            const portalRequests = getPortalRequestService(config);
            await portalRequests.deleteAdminRequest(requestId);
            const title = String(req.body?.title || req.query?.title || `Request #${requestId}`);
            await appendAuditLog('request_deleted', req.user, null, { requestId, title, engine: 'portal' });
            return res.json({ success: true, title });
        }
        await requestAppService.deleteRequest(config, requestId);
        const title = String(req.body?.title || req.query?.title || `Request #${requestId}`);
        await appendAuditLog('request_deleted', req.user, null, { requestId, title });
        res.json({ success: true, title });
    } catch (error) {
        res.status(error.status || 502).json({ error: error.message || 'Failed to delete request' });
    }
});

app.post('/api/requests/:id/retry', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const requestId = String(req.params.id || '').trim();
        if (!requestId) return res.status(400).json({ error: 'Request ID is required' });
        if (getRequestEngine(config) === 'portal') {
            const portalRequests = getPortalRequestService(config);
            const result = await portalRequests.retryAdminRequest(requestId, req.user);
            const title = result?.title || req.body?.title || `Request #${requestId}`;
            await appendAuditLog('request_retried', req.user, null, { requestId, title, engine: 'portal' });
            return res.json({ success: true, title });
        }
        const result = await requestAppService.retryRequest(config, requestId);
        const title = result?.media?.title || result?.media?.name || req.body?.title || `Request #${requestId}`;
        await appendAuditLog('request_retried', req.user, null, { requestId, title });
        res.json({ success: true, title });
    } catch (error) {
        res.status(error.status || 502).json({ error: error.message || 'Failed to retry request' });
    }
});

app.post('/api/requests/:id/approve', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const requestId = String(req.params.id || '').trim();
        if (!requestId) return res.status(400).json({ error: 'Request ID is required' });
        const overrides = req.body?.overrides || null;
        if (getRequestEngine(config) === 'portal') {
            const portalRequests = getPortalRequestService(config);
            const result = await portalRequests.approveAdminRequest(requestId, overrides, req.user);
            const title = result?.title || req.body?.title || `Request #${requestId}`;
            await appendAuditLog('request_approved', req.user, null, {
                requestId,
                title,
                overrides: overrides || null,
                engine: 'portal',
                arrInstanceId: result?.arrInstanceId || null,
            });
            return res.json({ success: true, title, engine: 'portal' });
        }
        const result = overrides
            ? await requestAppService.approveRequestWithOptions(config, requestId, overrides)
            : await requestAppService.approveRequest(config, requestId);
        const title = result?.media?.title || result?.media?.name || req.body?.title || `Request #${requestId}`;
        await appendAuditLog('request_approved', req.user, null, { requestId, title, overrides: overrides || null });
        res.json({ success: true, title });
    } catch (error) {
        res.status(error.status || 502).json({ error: error.message || 'Failed to approve request' });
    }
});

app.post('/api/requests/:id/decline', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const requestId = String(req.params.id || '').trim();
        if (!requestId) return res.status(400).json({ error: 'Request ID is required' });
        const reason = String(req.body?.reason || '').trim();
        if (getRequestEngine(config) === 'portal') {
            const portalRequests = getPortalRequestService(config);
            const result = await portalRequests.declineAdminRequest(requestId, reason, req.user);
            const title = result?.title || req.body?.title || `Request #${requestId}`;
            await appendAuditLog('request_declined', req.user, null, {
                requestId,
                title,
                reason: reason || null,
                engine: 'portal',
            });

            let blacklisted = false;
            if (req.body?.blacklist) {
                const tmdbId = Number(req.body?.tmdbId ?? result?.tmdbId);
                const mediaType = String(req.body?.mediaType || result?.type || '').toLowerCase();
                if (Number.isFinite(tmdbId) && tmdbId > 0 && (mediaType === 'movie' || mediaType === 'tv')) {
                    try {
                        const portalBlocklist = getPortalBlocklistService(config);
                        await portalBlocklist.addToBlocklist(req.user, {
                            tmdbId,
                            mediaType,
                            title,
                            source: 'decline',
                        });
                        blacklisted = true;
                        await appendAuditLog('blocklist_added', req.user, null, {
                            tmdbId,
                            mediaType,
                            title,
                            source: 'decline_request',
                            requestId,
                            engine: 'portal',
                        });
                    } catch (blockError) {
                        if (!/already blocklisted/i.test(blockError?.message || '')) {
                            return res.status(502).json({
                                error: `Request declined, but blocklisting failed: ${blockError.message}`,
                            });
                        }
                        blacklisted = true;
                    }
                }
            }
            return res.json({ success: true, title, blacklisted });
        }
        const result = await requestAppService.declineRequest(config, requestId, reason);
        const title = result?.media?.title || result?.media?.name || req.body?.title || `Request #${requestId}`;
        await appendAuditLog('request_declined', req.user, null, { requestId, title, reason: reason || null });

        if (req.body?.blacklist) {
            const tmdbId = Number(req.body?.tmdbId);
            const mediaType = String(req.body?.mediaType || '').toLowerCase();
            if (Number.isFinite(tmdbId) && tmdbId > 0 && (mediaType === 'movie' || mediaType === 'tv')) {
                try {
                    await requestAppService.addToBlocklist(config, req.user, { tmdbId, mediaType, title });
                    await appendAuditLog('blocklist_added', req.user, null, {
                        tmdbId,
                        mediaType,
                        title,
                        source: 'decline_request',
                        requestId,
                    });
                } catch (blockError) {
                    if (!/already blocklisted/i.test(blockError?.message || '')) {
                        return res.status(502).json({
                            error: `Request declined, but blocklisting failed: ${blockError.message}`,
                        });
                    }
                }
            }
        }

        res.json({ success: true, title, blacklisted: !!req.body?.blacklist });
    } catch (error) {
        res.status(error.status || 502).json({ error: error.message || 'Failed to decline request' });
    }
});

app.get('/api/invites/:code/info', publicReadRateLimit, async (req, res) => {
    const invites = await loadFile(INVITES_PATH, []);
    const invite = invites.find(i => i.code === req.params.code);
    if (!invite) return res.status(404).json({ error: 'Invite code not found or revoked.' });
    if (invite.maxUses !== 'unlimited' && invite.currentUses >= invite.maxUses) {
        return res.status(400).json({ error: 'Invite code has reached its maximum usage limit.' });
    }
    const config = await loadFile(CONFIG_PATH, {});
    const adminProfile = await getAdminProfile(config);
    res.json({
        durationDays: invite.durationDays,
        serverName: adminProfile.serverName || 'Our Server',
        customLogoUrl: normalizeBrandingAssetForMediaServer(config.customLogoUrl, config.mediaServerType),
        thumb: adminProfile.thumb,
        showPublicLibraryStats: arePublicLibraryStatsVisible(config)
    });
});

app.post('/api/invites/:code/claim', authRateLimit, async (req, res) => {
    const { pinId } = req.body;
    if (!pinId) return res.status(400).json({ error: 'PIN ID is required' });

    let invites = await loadFile(INVITES_PATH, []);
    const inviteIndex = invites.findIndex(i => i.code === req.params.code);
    if (inviteIndex === -1) return res.status(404).json({ error: 'Invite code not found or revoked.' });

    const invite = invites[inviteIndex];
    if (invite.maxUses !== 'unlimited' && invite.currentUses >= invite.maxUses) {
        return res.status(400).json({ error: 'Invite code has reached its maximum usage limit.' });
    }

    try {
        const pinRes = await fetch(`https://plex.tv/api/v2/pins/${pinId}`, {
            headers: plexClientHeaders()
        });
        const pinData = await pinRes.json();

        if (!pinData.authToken) {
            return res.status(400).json({ error: 'Not authenticated with Plex yet. Please try again.' });
        }

        const config = await loadFile(CONFIG_PATH, {});
        // Validate user with Plex
        const plexRes = await fetch('https://plex.tv/api/v2/user', {
            headers: plexClientHeaders(pinData.authToken)
        });
        if (!plexRes.ok) return res.status(401).json({ error: 'Invalid Plex token' });

        const plexUser = await plexRes.json();
        const users = await loadFile(USERS_PATH, []);

        // Check if user already exists
        if (users.find(u => String(u.plexId) === String(plexUser.id) || u.email === plexUser.email)) {
            return res.status(400).json({ error: 'You are already a member of this server.' });
        }

        // Calculate expiry date
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        today.setDate(today.getDate() + invite.durationDays);
        const expiryDate = today.toISOString();

        const newUser = {
            id: randomUUID(),
            plexId: plexUser.id,
            username: plexUser.username,
            email: plexUser.email,
            thumb: plexUser.thumb,
            expiryDate: expiryDate,
            joiningDate: new Date().toISOString(),
            plexAccessStatus: 'pending',
            isTrial: false
        };

        users.push(newUser);
        await saveFile(USERS_PATH, users);

        // Send actual Plex invite
        await inviteUserToPlex(newUser, config, invite.libraryIds).catch(e => log('Failed to invite claimed user: ' + e.message));

        // Update invite usage
        // Re-read to prevent race condition during long Plex API calls
        let freshInvites = await loadFile(INVITES_PATH, []);
        const freshIndex = freshInvites.findIndex(i => i.code === req.params.code);
        if (freshIndex !== -1) {
            freshInvites[freshIndex].currentUses = (freshInvites[freshIndex].currentUses || 0) + 1;
            if (!freshInvites[freshIndex].usedBy) freshInvites[freshIndex].usedBy = [];
            freshInvites[freshIndex].usedBy.push({
                username: plexUser.username,
                email: plexUser.email,
                date: new Date().toISOString()
            });
            await saveFile(INVITES_PATH, freshInvites);
        }

        await appendAuditLog('invite_claimed', { username: plexUser.username, id: plexUser.id }, newUser, { code: invite.code });

        // Log user in
        const adminId = await getAdminId(config);
        const isAdmin = !!(adminId && String(plexUser.id) === String(adminId));
        const sessionUser = {
            id: plexUser.uuid || plexUser.id,
            plexId: plexUser.id,
            email: plexUser.email,
            username: plexUser.username,
            isAdmin
        };
        const token = jwt.sign(sessionUser, JWT_SECRET, { expiresIn: '7d' });
        setSessionCookie(req, res, token);

        res.json({ success: true, user: sanitizeUserForApi(newUser) });
    } catch (e) {
        log(`Error claiming invite: ${e.message}`);
        res.status(500).json({ error: 'Failed to claim invite. Please try again later.' });
    }
});

// User data endpoints
app.get('/api/users', requireAdmin, async (req, res) => {
    const users = await loadFile(USERS_PATH, []);
    const { users: withLastLogin, changed } = await backfillLastLoginFromAudit(users);
    if (changed) {
        await saveFile(USERS_PATH, withLastLogin);
    }
    res.json(sanitizeUsersForApi(withLastLogin));
});

app.get('/api/deleted-users', requireAdmin, async (req, res) => {
    const deletedUsers = await loadFile(DELETED_USERS_PATH, []);
    res.json(deletedUsers.map(user => ({ ...user, blockId: getDeletedUserKey(user) })));
});

const decorateTaskForConfig = (task, config = {}) => {
    const mediaServerType = String(config.mediaServerType || 'plex').toLowerCase();
    const next = { ...task };
    if (next.id === 'syncPlexUsers') {
        if (mediaServerType !== 'plex') {
            const mediaLabel = mediaServerType === 'emby' ? 'Emby' : 'Jellyfin';
            next.name = `Sync ${mediaLabel} Users`;
            next.description = `Fetches latest user data and profile images from ${mediaLabel}.`;
        } else {
            next.name = 'Sync Plex Users';
            next.description = 'Fetches latest user data from Plex.';
        }
    }
    if (next.id === 'checkAndRevoke') {
        next.description = mediaServerType !== 'plex'
            ? 'Revokes expired portal access for Jellyfin users.'
            : 'Removes Plex access for expired users.';
    }
    if (next.id === 'checkAndCleanupInactive') {
        next.description = mediaServerType !== 'plex'
            ? 'Revokes portal access for Jellyfin users who have not watched anything recently.'
            : 'Revokes access for users who have not watched anything recently.';
    }
    return next;
};

const getTasksSnapshot = (config = {}) => {
    const mediaServerType = String(config.mediaServerType || 'plex').toLowerCase();
    const systemJobList = Object.values(systemJobs)
        .filter(job => !(mediaServerType !== 'plex' && job.id === 'plexStats'))
        // Hide Upgrader Index entirely while the feature is off — idle, not failing.
        .filter(job => !(job.id === 'upgraderIndex' && !config.upgraderEnabled));
    return [
        ...tasksInfo.map(task => decorateTaskForConfig(task, config)),
        ...systemJobList.map(job => ({ ...job }))
    ];
};

/** Clear "already running" after this long so a hung *arr download can be retried. */
const DISCOVERY_AVAILABILITY_STUCK_MS = 10 * 60 * 1000;

const findRunnableTask = (taskId) => {
    const scheduled = tasksInfo.find(t => t.id === taskId);
    if (scheduled) return { task: scheduled, kind: 'scheduled' };
    const systemJob = systemJobs[taskId] || Object.values(systemJobs).find(j => j.id === taskId);
    if (systemJob) return { task: systemJob, kind: 'system' };
    return null;
};

app.get('/api/tasks', requireAdmin, async (req, res) => {
    const config = await loadFile(CONFIG_PATH, {});
    res.json(getTasksSnapshot(config));
});

app.post('/api/tasks/run/:taskId', requireAdmin, async (req, res) => {
    const { taskId } = req.params;
    const match = findRunnableTask(taskId);
    if (!match) return res.status(404).json({ error: 'Task not found' });

    const { task, kind } = match;

    if (task.running) {
        // Allow retry when Discovery Availability Cache is stuck mid-download.
        const startedAt = Number(task._startedAt) || 0;
        const stuck = startedAt > 0 && (Date.now() - startedAt) > DISCOVERY_AVAILABILITY_STUCK_MS;
        if (!(taskId === 'discoveryAvailabilityCache' && stuck)) {
            return res.status(400).json({ error: `Task "${task.name}" is already running.` });
        }
        markTaskEnd(task, new Error('Cleared stuck run before manual retry'));
    }

    // Mark running before responding so Tasks UI shows Running on the first refresh.
    if (kind === 'scheduled' || taskId === 'discoveryAvailabilityCache') {
        markTaskStart(task);
    }

    res.json({ message: `Task "${task.name}" started in the background.`, task: { ...task } });

    // Execute the task in the background
    (async () => {
        try {
            const currentConfig = await loadFile(CONFIG_PATH, {});

            if (kind === 'scheduled') {
                try {
                    switch (taskId) {
                        case 'syncPlexUsers': {
                            const mediaServerType = String(currentConfig.mediaServerType || 'plex').toLowerCase();
                            await (mediaServerType === 'jellyfin' || mediaServerType === 'emby' ? syncJellyfinUsers(currentConfig) : syncUsers(currentConfig));
                            break;
                        }
                        case 'checkAndSendNotifications': await checkAndSendNotifications(currentConfig); break;
                        case 'checkAndRevoke': await checkAndRevoke(currentConfig); break;
                        case 'checkAndSendNewsletter': await checkAndSendNewsletter(currentConfig, true); break;
                        case 'checkAndCleanupInactive': await checkAndCleanupInactive(currentConfig); break;
                        case 'maintenanceRuleRun':
                            if (!isMaintenanceExperimentalEnabled(currentConfig)) {
                                throw new Error('Maintenance module is disabled. Enable it in Settings → System first.');
                            }
                            await executeMaintenanceRunBatch({ actor: req.user, dryRun: true });
                            break;
                        default:
                            markTaskEnd(task, new Error('Invalid task'));
                            return;
                    }
                    markTaskEnd(task, null);
                } catch (e) {
                    markTaskEnd(task, e);
                    log(`[Tasks] Scheduled task "${task.name}" failed: ${e.message}`);
                }
            } else {
                // system jobs handle their own markTaskStart / markTaskEnd inside their functions
                switch (taskId) {
                    case 'analyticsCache': await calculateAnalyticsStats(); break;
                    case 'trendingCache': await calculateTrendingStats(); break;
                    case 'plexStats': await buildPlexStatsCache(); break;
                    case 'autoBackup': await runAutoBackupCycle('manual', { force: true }); break;
                    case 'maintenanceIndex': await buildMaintenanceMediaIndex({ actor: req.user, force: true }); break;
                    case 'requestStatusSync': await runPortalRequestStatusSync('manual'); break;
                    case 'discoveryAvailabilityCache':
                        await runDiscoveryAvailabilityCacheRebuild('manual', { alreadyStarted: true });
                        break;
                    case 'seerrHistoryImport': await runSeerrHistoryImport('manual'); break;
                    default:
                        markTaskEnd(task, new Error('Invalid system task'));
                }
            }
        } catch (e) {
            markTaskEnd(task, e);
            log(`[Tasks] Fatal error in background task execution wrapper for "${task.name}": ${e.message}`);
        }
    })();
});

app.get('/api/admin/diagnostics', requireAdmin, async (req, res) => {
    try {
        const config = normalizeArrConfig(await loadFile(CONFIG_PATH, {}));
        const now = Date.now();
        const statFile = async (filePath) => {
            try {
                const stat = await fs.stat(filePath);
                return { exists: true, size: stat.size, modifiedAt: stat.mtime.toISOString() };
            } catch (e) {
                return { exists: false, size: 0, modifiedAt: null };
            }
        };

        const [analyticsFile, trendingFile, plexStatsFile, maintenanceIndexFile, maintenanceRulesFile, maintenanceRunsFile, requestIndexFile, maintenancePrefsFile, usersFile, configFile, backups] = await Promise.all([
            statFile(ANALYTICS_CACHE_PATH),
            statFile(TRENDING_CACHE_PATH),
            statFile(PLEX_STATS_CACHE_PATH),
            statFile(MAINTENANCE_MEDIA_INDEX_PATH),
            statFile(MAINTENANCE_RULES_PATH),
            statFile(MAINTENANCE_RUNS_PATH),
            statFile(MAINTENANCE_REQUEST_INDEX_PATH),
            statFile(MAINTENANCE_PREFS_PATH),
            statFile(USERS_PATH),
            statFile(CONFIG_PATH),
            listBackupFiles().catch(() => [])
        ]);

        res.json({
            app: {
                version: appVersion,
                uptimeSeconds: Math.floor(process.uptime()),
                nodeVersion: process.version,
                memoryRssMB: Math.round(process.memoryUsage().rss / (1024 * 1024)),
                configDataDir: CONFIG_DIR
            },
            integrations: {
                mediaServerType: config.mediaServerType || 'plex',
                plexConfigured: !!(config.plexToken && config.serverIdentifier),
                jellyfinConfigured: !!(config.jellyfinUrl && config.jellyfinApiKey),
                smtpConfigured: !!(config.smtpHost && config.smtpUser && config.smtpPass),
                gotifyConfigured: !!(config.gotifyEnabled && config.gotifyUrl && config.gotifyToken),
                sonarrConfigured: getArrInstanceCounts(config).sonarr.ready > 0,
                radarrConfigured: getArrInstanceCounts(config).radarr.ready > 0,
                lidarrConfigured: getArrInstanceCounts(config).lidarr.ready > 0,
                bazarrConfigured: getArrInstanceCounts(config).bazarr.ready > 0,
                arrInstanceCounts: getArrInstanceCounts(config),
                tautulliConfigured: !!(config.tautulliUrl && config.tautulliApiKey),
                jellystatConfigured: !!(config.jellystatUrl && config.jellystatApiKey),
                jellyglanceConfigured: !!(config.jellyglanceUrl && config.jellyglanceApiKey),
                jellyfinAnalyticsProvider: normalizeJellyfinAnalyticsProvider(config.jellyfinAnalyticsProvider, config),
                jellyfinAnalyticsConfigured: normalizeJellyfinAnalyticsProvider(config.jellyfinAnalyticsProvider, config) === 'jellystat'
                    ? !!(config.jellystatUrl && config.jellystatApiKey)
                    : !!(config.jellyglanceUrl && config.jellyglanceApiKey),
                requestAppEnabled: !!(config.requestAppType && config.requestAppType !== 'none'),
                requestAppConfigured: !!(config.requestAppType && config.requestAppType !== 'none' && config.requestAppUrl && config.requestAppApiKey)
            },
            caches: {
                analytics: analyticsFile,
                trending: trendingFile,
                plexStats: plexStatsFile,
                maintenanceIndex: maintenanceIndexFile,
                maintenanceRules: maintenanceRulesFile,
                maintenanceRuns: maintenanceRunsFile,
                maintenanceRequestIndex: requestIndexFile,
                maintenancePreferences: maintenancePrefsFile
            },
            files: {
                users: usersFile,
                config: configFile
            },
            backup: {
                enabled: !!config.autoBackupEnabled,
                intervalDays: Math.max(1, Number(config.autoBackupIntervalDays) || 2),
                retentionCount: Math.max(1, Number(config.autoBackupRetentionCount) || 10),
                lastRunAt: config.autoBackupLastRunAt || null,
                availableBackups: backups.length
            },
            jobs: getTasksSnapshot(config),
            checkedAt: new Date(now).toISOString()
        });
    } catch (e) {
        res.status(500).json({ error: `Failed to load diagnostics: ${e.message}` });
    }
});

const BACKUP_SCHEMA_VERSION = 1;
const BACKUP_DIR = path.join(process.cwd(), 'backup');
const BACKUP_TARGETS = [
    { key: 'config', path: CONFIG_PATH },
    { key: 'users', path: USERS_PATH },
    { key: 'invites', path: INVITES_PATH },
    { key: 'deletedUsers', path: DELETED_USERS_PATH },
    { key: 'auditLog', path: AUDIT_LOG_PATH },
    { key: 'emailLog', path: EMAIL_LOG_PATH },
    { key: 'statusConfig', path: STATUS_CONFIG_PATH },
    { key: 'health', path: HEALTH_PATH },
    { key: 'trendingCache', path: TRENDING_CACHE_PATH },
    { key: 'analyticsCache', path: ANALYTICS_CACHE_PATH },
    { key: 'killRules', path: KILL_RULES_PATH },
    { key: 'plexStats', path: PLEX_STATS_CACHE_PATH },
    { key: 'maintenanceRules', path: MAINTENANCE_RULES_PATH },
    { key: 'maintenanceMediaIndex', path: MAINTENANCE_MEDIA_INDEX_PATH },
    { key: 'maintenanceRuns', path: MAINTENANCE_RUNS_PATH },
    { key: 'maintenanceRequestIndex', path: MAINTENANCE_REQUEST_INDEX_PATH },
    { key: 'maintenancePreferences', path: MAINTENANCE_PREFS_PATH }
];

const getBackupEncryptionKey = () => createHash('sha256').update(String(JWT_SECRET)).digest();

const encryptBackupObject = (backup) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', getBackupEncryptionKey(), iv);
    const plaintext = Buffer.from(JSON.stringify(backup), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
        schemaVersion: BACKUP_SCHEMA_VERSION,
        encrypted: true,
        alg: 'aes-256-gcm',
        createdAt: backup.createdAt || new Date().toISOString(),
        createdBy: backup.createdBy || 'system',
        reason: backup.reason || 'manual',
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        ciphertext: ciphertext.toString('base64'),
    };
};

const decryptBackupObject = (payload) => {
    if (!payload || typeof payload !== 'object') {
        throw new Error('Invalid backup payload.');
    }
    // Reject legacy plaintext backups — secrets must only restore from AES-GCM sealed exports.
    if (!payload.encrypted) {
        throw new Error('Only encrypted backups can be restored. Create a new backup from this portal version.');
    }
    if (payload.alg !== 'aes-256-gcm' || !payload.iv || !payload.tag || !payload.ciphertext) {
        throw new Error('Encrypted backup is missing required fields.');
    }
    const decipher = createDecipheriv(
        'aes-256-gcm',
        getBackupEncryptionKey(),
        Buffer.from(String(payload.iv), 'base64'),
    );
    decipher.setAuthTag(Buffer.from(String(payload.tag), 'base64'));
    const plain = Buffer.concat([
        decipher.update(Buffer.from(String(payload.ciphertext), 'base64')),
        decipher.final(),
    ]);
    return JSON.parse(plain.toString('utf8'));
};

const readBackupPayload = async () => {
    const payload = {};
    for (const target of BACKUP_TARGETS) {
        payload[target.key] = await loadFile(target.path, null);
    }
    try {
        const logoPath = path.join(process.cwd(), 'static', 'logo.png');
        const logoBuffer = await fs.readFile(logoPath);
        payload.logoPngBase64 = logoBuffer.toString('base64');
    } catch (e) {
        payload.logoPngBase64 = null;
    }
    return payload;
};

const ensureBackupDir = async () => {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
};

const createBackupObject = async (createdBy = 'system', reason = 'manual') => ({
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    createdBy,
    reason,
    data: await readBackupPayload()
});

const getBackupFilename = (backup) => {
    const stamp = (backup.createdAt || new Date().toISOString()).replace(/[:.]/g, '-');
    return `portal-backup-${stamp}.json`;
};

const listBackupFiles = async () => {
    await ensureBackupDir();
    const entries = await fs.readdir(BACKUP_DIR).catch(() => []);
    const jsonFiles = entries.filter(name => name.toLowerCase().endsWith('.json'));
    const backups = await Promise.all(jsonFiles.map(async (filename) => {
        const filePath = path.join(BACKUP_DIR, filename);
        try {
            const stat = await fs.stat(filePath);
            return {
                filename,
                filePath,
                size: stat.size,
                createdAt: stat.mtime.toISOString()
            };
        } catch (e) {
            return null;
        }
    }));
    return backups.filter(Boolean).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
};

const enforceBackupRetention = async (keepCount) => {
    const backups = await listBackupFiles();
    const toDelete = backups.slice(Math.max(0, keepCount));
    for (const backup of toDelete) {
        await fs.unlink(backup.filePath).catch(() => { });
    }
};

const applyBackupPayload = async (backup) => {
    if (!backup || backup.schemaVersion !== BACKUP_SCHEMA_VERSION || !backup.data) {
        throw new Error('Unsupported backup schema.');
    }
    for (const target of BACKUP_TARGETS) {
        if (backup.data[target.key] !== undefined) {
            await saveFile(target.path, backup.data[target.key]);
        }
    }
    if (backup.data.logoPngBase64 && typeof backup.data.logoPngBase64 === 'string') {
        const logoPath = path.join(process.cwd(), 'static', 'logo.png');
        await fs.writeFile(logoPath, Buffer.from(backup.data.logoPngBase64, 'base64'));
    }
};

const writeBackupToFolder = async (backup) => {
    await ensureBackupDir();
    const filename = getBackupFilename(backup);
    const filePath = path.join(BACKUP_DIR, filename);
    const sealed = encryptBackupObject(backup);
    await fs.writeFile(filePath, JSON.stringify(sealed, null, 2), 'utf8');
    return { filename, filePath };
};

app.get('/api/admin/backup', requireAdmin, async (req, res) => {
    try {
        const backup = await createBackupObject(req.user?.username || req.user?.email || 'admin', 'manual-download');
        await appendAuditLog('backup_exported', req.user, null, { schemaVersion: BACKUP_SCHEMA_VERSION, encrypted: true });
        const sealed = encryptBackupObject(backup);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=\"portal-backup-${Date.now()}.json\"`);
        res.send(JSON.stringify(sealed, null, 2));
    } catch (e) {
        res.status(500).json({ error: `Failed to create backup: ${e.message}` });
    }
});

app.get('/api/admin/backups', requireAdmin, async (req, res) => {
    try {
        const backups = await listBackupFiles();
        res.json(backups.map(({ filename, size, createdAt }) => ({ filename, size, createdAt })));
    } catch (e) {
        res.status(500).json({ error: `Failed to list backups: ${e.message}` });
    }
});

app.post('/api/admin/backups/create', requireAdmin, async (req, res) => {
    try {
        const backup = await createBackupObject(req.user?.username || req.user?.email || 'admin', 'manual-create');
        const result = await writeBackupToFolder(backup);
        const config = await loadFile(CONFIG_PATH, {});
        await enforceBackupRetention(Math.max(1, Number(config.autoBackupRetentionCount) || 10));
        await appendAuditLog('backup_created', req.user, null, { filename: result.filename });
        res.json({ success: true, filename: result.filename });
    } catch (e) {
        res.status(500).json({ error: `Failed to create backup file: ${e.message}` });
    }
});

app.post('/api/admin/backup/restore', requireAdmin, express.text({ type: '*/*', limit: '25mb' }), async (req, res) => {
    try {
        const rawBody = typeof req.body === 'string' ? req.body : '';
        if (!rawBody) return res.status(400).json({ error: 'Missing backup payload.' });

        let backup;
        try {
            backup = decryptBackupObject(JSON.parse(rawBody));
        } catch (e) {
            return res.status(400).json({ error: e.message || 'Backup payload is not valid JSON.' });
        }

        const confirmRestore = req.query.confirm === 'true' || req.headers['x-confirm-restore'] === 'true';
        if (!confirmRestore) {
            return res.status(400).json({ error: 'Restore requires explicit confirmation.' });
        }
        await applyBackupPayload(backup);

        await appendAuditLog('backup_restored', req.user, null, {
            schemaVersion: backup.schemaVersion,
            createdAt: backup.createdAt || null
        });
        res.json({ success: true, message: 'Backup restored successfully.' });
    } catch (e) {
        res.status(500).json({ error: `Failed to restore backup: ${e.message}` });
    }
});

app.post('/api/admin/backups/restore-file', requireAdmin, async (req, res) => {
    try {
        const { filename, confirm } = req.body || {};
        if (!confirm) return res.status(400).json({ error: 'Restore requires explicit confirmation.' });
        if (!filename || typeof filename !== 'string') return res.status(400).json({ error: 'Backup filename is required.' });
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).json({ error: 'Invalid backup filename.' });
        }
        const filePath = path.join(BACKUP_DIR, filename);
        const raw = await fs.readFile(filePath, 'utf8');
        const backup = decryptBackupObject(JSON.parse(raw));
        await applyBackupPayload(backup);
        await appendAuditLog('backup_restored_file', req.user, null, {
            filename,
            schemaVersion: backup.schemaVersion || null,
            createdAt: backup.createdAt || null
        });
        res.json({ success: true, message: 'Backup restored from file successfully.' });
    } catch (e) {
        res.status(500).json({ error: `Failed to restore backup file: ${e.message}` });
    }
});

app.delete('/api/deleted-users/:blockId', requireAdmin, async (req, res) => {
    const { blockId } = req.params;
    const deletedUsers = await loadFile(DELETED_USERS_PATH, []);
    const deletedUser = deletedUsers.find(user => getDeletedUserKey(user) === blockId);
    if (!deletedUser) return res.status(404).json({ error: 'Deleted user record not found.' });

    await saveFile(DELETED_USERS_PATH, deletedUsers.filter(user => getDeletedUserKey(user) !== blockId));
    await appendAuditLog('deleted_user_unblocked', req.user, deletedUser);
    res.status(204).send();
});

app.get('/api/audit-log', requireAdmin, async (req, res) => {
    const auditLog = await loadFile(AUDIT_LOG_PATH, []);
    res.json(auditLog.slice(0, 200));
});

app.put('/api/users/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { expiryDate, exemptFromCleanup, optOutNewsletter, requestOverrides } = req.body;
    let users = await loadFile(USERS_PATH, []);
    const userIndex = users.findIndex(u => u.id === id);
    if (userIndex === -1) return res.status(404).json({ error: 'User not found.' });

    const previousExpiryDate = users[userIndex].expiryDate;

    if (expiryDate !== undefined) {
        users[userIndex].expiryDate = expiryDate;
    }
    if (exemptFromCleanup !== undefined) {
        users[userIndex].exemptFromCleanup = !!exemptFromCleanup;
    }
    if (optOutNewsletter !== undefined) {
        users[userIndex].optOutNewsletter = !!optOutNewsletter;
    }
    if (requestOverrides !== undefined) {
        users[userIndex].requestOverrides = normalizeUserRequestOverrides(requestOverrides);
    }

    reconcileTrialAccessFlag(users[userIndex]);

    await saveFile(USERS_PATH, users);

    if (expiryDate !== undefined && expiryDate !== previousExpiryDate) {
        await appendAuditLog('user_expiry_updated', req.user, users[userIndex], { previousExpiryDate, expiryDate });
        // Send adjustment email
        const config = await loadFile(CONFIG_PATH, {});
        const logoPath = path.join(process.cwd(), 'static', 'logo.png');
        let hasLogo = false;
        try { await fs.access(logoPath); hasLogo = true; } catch (e) { }
        await sendAdjustmentEmail(config, users[userIndex], hasLogo);

        // Auto re-invite if revoked and new date is in the future
        if (users[userIndex].plexAccessStatus === 'revoked') {
            const days = getDaysUntilExpiry(users[userIndex].expiryDate);
            if (days === null || days >= 0) {
                const invited = await inviteUserToPlex(users[userIndex], config, config.defaultLibraryIds);
                if (invited) {
                    users[userIndex].plexAccessStatus = 'pending';
                    await saveFile(USERS_PATH, users);
                    await appendAuditLog('relink_invite_sent', req.user, users[userIndex]);
                }
            }
        }
    }

    res.json(sanitizeUserForApi(users[userIndex]));
});

const applyBulkAction = (user, action, customDate) => {
    const baseDate = user.expiryDate ? new Date(user.expiryDate) : new Date();

    switch (action) {
        case 'addMonth':
            user.expiryDate = addMonths(baseDate, 1).toISOString();
            break;
        case 'addYear':
            user.expiryDate = addYears(baseDate, 1).toISOString();
            break;
        case 'unlimited':
            user.expiryDate = null;
            break;
        case 'custom':
            user.expiryDate = customDate ? new Date(customDate).toISOString() : null;
            break;
    }
    reconcileTrialAccessFlag(user);
};

app.post('/api/users/bulk-update', requireAdmin, async (req, res) => {
    const { userIds, action, customDate } = req.body;
    if (!Array.isArray(userIds) || userIds.length === 0 || !['addMonth', 'addYear', 'unlimited', 'custom'].includes(action)) {
        return res.status(400).json({ error: 'Invalid request body.' });
    }
    if (action === 'custom' && !customDate) {
        return res.status(400).json({ error: 'customDate is required for custom action.' });
    }

    try {
        let users = await loadFile(USERS_PATH, []);
        let updatedCount = 0;
        const config = await loadFile(CONFIG_PATH, {});
        const logoPath = path.join(process.cwd(), 'static', 'logo.png');
        let hasLogo = false;
        try { await fs.access(logoPath); hasLogo = true; } catch (e) { }

        for (const user of users) {
            if (userIds.includes(user.id)) {
                applyBulkAction(user, action, customDate);
                updatedCount++;
                await appendAuditLog('user_bulk_updated', req.user, user, { action, customDate: customDate || null });
                await sendAdjustmentEmail(config, user, hasLogo);

                // Auto re-invite if revoked and new date is in the future
                if (user.plexAccessStatus === 'revoked') {
                    const days = getDaysUntilExpiry(user.expiryDate);
                    if (days === null || days >= 0) {
                        const invited = await inviteUserToPlex(user, config, config.defaultLibraryIds);
                        if (invited) {
                            user.plexAccessStatus = 'pending';
                            await appendAuditLog('relink_invite_sent', req.user, user);
                        }
                    }
                }
            }
        }

        await saveFile(USERS_PATH, users);
        log(`Bulk updated ${updatedCount} users with action: ${action}`);
        res.json({ message: `Successfully updated ${updatedCount} users.` });
    } catch (error) {
        res.status(500).json({ error: 'Failed to process bulk update.' });
    }
});

app.delete('/api/users/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const config = await loadFile(CONFIG_PATH, null);
    let users = await loadFile(USERS_PATH, []);
    const user = users.find(u => u.id === id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    if (config && config.serverIdentifier && config.plexToken) {
        const revoked = await revokePlexAccess(user, config);
        if (!revoked) {
            return res.status(500).json({ error: 'Failed to revoke Plex access before deleting user.' });
        }
    }

    await rememberDeletedUser(user, req.user);
    await saveFile(USERS_PATH, users.filter(u => u.id !== id));
    await appendAuditLog('user_deleted_blocked', req.user, user, { plexAccessRevoked: !!(config && config.serverIdentifier && config.plexToken) });
    res.status(204).send();
});

app.post('/api/users/:id/revoke', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const config = await loadFile(CONFIG_PATH, null);
    if (!config) return res.status(400).json({ error: 'App not configured.' });
    let users = await loadFile(USERS_PATH, []);
    const user = users.find(u => u.id === id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const revoked = await revokePlexAccess(user, config);
    if (revoked) {
        user.plexAccessStatus = 'revoked';
        await saveFile(USERS_PATH, users);
        await appendAuditLog('plex_access_revoked', req.user, user);
        res.json(sanitizeUserForApi(user));
    } else {
        res.status(500).json({ error: 'Failed to revoke access via Plex API.' });
    }
});

app.post('/api/users/request-invite', requireAuth, async (req, res) => {
    if (blockIfImpersonating(req, res)) return;
    const config = await loadFile(CONFIG_PATH, null);
    if (!config || !config.serverIdentifier) return res.status(400).json({ error: 'App not configured.' });
    req.user.isAdmin = await resolveCurrentAdmin(getSessionActor(req.user), config);

    if (!config.allowTemporaryAccess) {
        return res.status(403).json({ error: 'New registrations are currently disabled.' });
    }

    let users = await loadFile(USERS_PATH, []);
    const existingUser = users.find(u => u.email === req.user.email || u.username === req.user.username);
    const deletedUsers = await loadFile(DELETED_USERS_PATH, []);

    if (existingUser) {
        await appendAuditLog('trial_request_blocked_existing_user', req.user, existingUser);
        return res.status(400).json({ error: 'You are already registered.' });
    }
    if (!req.user.isAdmin && isDeletedUser(deletedUsers, req.user)) {
        await appendAuditLog('trial_request_blocked_deleted_user', req.user, req.user);
        clearSessionCookie(req, res);
        return res.status(403).json({ error: 'Your portal session has expired. Please contact the admin for access.' });
    }

    const expiryDate = addDays(new Date(), 3);

    const newUser = {
        id: req.user.plexId.toString(),
        username: req.user.username,
        email: req.user.email,
        joiningDate: new Date().toISOString(),
        expiryDate: expiryDate.toISOString(),
        plexAccessStatus: 'pending',
        isTrial: true
    };

    try {
        const staleAccessRevoked = await revokePlexAccess(newUser, config);
        if (!staleAccessRevoked) {
            await appendAuditLog('trial_request_failed_stale_access', req.user, newUser);
            return res.status(500).json({ error: 'Failed to clear existing Plex access before sending invite.' });
        }

        log(`Inviting new user ${newUser.username} to server...`);
        await inviteUserToPlex(newUser, config, config.defaultLibraryIds).catch(e => log('Failed to invite trial user: ' + e.message));

        users.push(newUser);
        await saveFile(USERS_PATH, users);
        await appendAuditLog('trial_invite_sent', req.user, newUser, { expiryDate: newUser.expiryDate });

        // Optional: send welcome email here

        res.json({ message: 'Invite sent successfully', user: sanitizeUserForApi(newUser) });
    } catch (e) {
        log('Error requesting invite: ' + e.message);
        res.status(500).json({ error: 'Failed to request invite.' });
    }
});

app.post('/api/users/relink', requireAuth, requireMember, async (req, res) => {
    if (blockIfImpersonating(req, res)) return;
    const config = await loadFile(CONFIG_PATH, null);
    if (!config || !config.serverIdentifier) return res.status(400).json({ error: 'App not configured.' });

    let users = await loadFile(USERS_PATH, []);
    const user = users.find(u => u.email === req.user.email || u.username === req.user.username);
    const deletedUsers = await loadFile(DELETED_USERS_PATH, []);

    if (!user && !req.user.isAdmin && isDeletedUser(deletedUsers, req.user)) {
        await appendAuditLog('relink_blocked_deleted_user', req.user, req.user);
        clearSessionCookie(req, res);
        return res.status(403).json({ error: 'Your portal session has expired. Please contact the admin for access.' });
    }
    if (!user) {
        await appendAuditLog('relink_failed_user_not_found', req.user, req.user);
        return res.status(404).json({ error: 'User not found.' });
    }

    const days = getDaysUntilExpiry(user.expiryDate);
    if (days === null || days < 0) {
        await appendAuditLog('relink_blocked_expired', req.user, user, { days });
        return res.status(400).json({ error: 'Your access has expired.' });
    }

    try {
        log(`Re-linking user ${user.username}...`);
        await inviteUserToPlex(user, config, config.defaultLibraryIds).catch(e => log('Failed to re-link user: ' + e.message));

        user.plexAccessStatus = 'pending';
        await saveFile(USERS_PATH, users);
        await appendAuditLog('relink_invite_sent', req.user, user);

        res.json({ message: 'Account re-linked successfully.', user: sanitizeUserForApi(user) });
    } catch (e) {
        log('Error re-linking account: ' + e.message);
        res.status(500).json({ error: 'Failed to re-link account.' });
    }
});

// --- Public & Status API Endpoints ---
let cachedAdminProfile = null;
let lastAdminProfileFetch = 0;

async function getAdminProfile(config) {
    const mediaServerType = String(config?.mediaServerType || '').toLowerCase();
    if (mediaServerType === 'jellyfin' || mediaServerType === 'emby') {
        const mediaLabel = mediaServerType === 'emby' ? 'Emby' : 'Jellyfin';
        let serverName = `${mediaLabel} Server`;
        try {
            if (config?.jellyfinUrl && config?.jellyfinApiKey) {
                const baseUrl = resolveIntegrationUrlForFetch(config.jellyfinUrl);
                const infoRes = await fetch(`${baseUrl}/System/Info`, {
                    headers: jellyfinHeaders(config.jellyfinApiKey),
                });
                if (infoRes.ok) {
                    const info = await infoRes.json();
                    serverName = info.ServerName || info.LocalAddress || serverName;
                }
            }
        } catch (e) {
            log(`Failed to fetch ${mediaLabel} server info: ${e.message}`);
        }
        return { thumb: null, serverName };
    }

    if (!config || !config.plexToken) return { thumb: null, serverName: 'Server Portal' };

    if (cachedAdminProfile && Date.now() - lastAdminProfileFetch < 3600000) {
        return cachedAdminProfile;
    }

    try {
        const userRes = await fetch('https://plex.tv/api/v2/user', { headers: plexClientHeaders(config.plexToken) }).then(r => r.json());

        let serverName = 'Server Portal';
        const uri = await getPlexConnectionUri(config);
        if (uri) {
            const serverRes = await fetch(`${uri}/?X-Plex-Token=${config.plexToken}`, { headers: plexClientHeaders(config.plexToken) }).then(r => r.json()).catch(() => null);
            if (serverRes && serverRes.MediaContainer && serverRes.MediaContainer.friendlyName) {
                serverName = serverRes.MediaContainer.friendlyName;
            }
        }

        cachedAdminProfile = { thumb: userRes.thumb || null, serverName };
        lastAdminProfileFetch = Date.now();
        return cachedAdminProfile;
    } catch (e) {
        return { thumb: null, serverName: 'Server Portal' };
    }
}

/** Prefer custom logo, then Jellyfin branding, then Plex/admin thumb — same order as the in-app nav icon. */
const getPortalBrandingIconCacheKey = (config = {}, profile = {}) => createHash('sha1')
    .update([
        String(config.pwaIconSource || 'server'),
        String(config.customLogoUrl || ''),
        String(config.mediaServerType || ''),
        String(profile.thumb || ''),
        String(profile.serverName || ''),
    ].join('|'))
    .digest('hex')
    .slice(0, 12);

const sendStaticLogoFallback = async (res) => {
    const logoPath = path.join(process.cwd(), 'static', 'logo.png');
    try {
        await fs.access(logoPath);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.sendFile(logoPath);
    } catch {
        return res.status(404).send('');
    }
};

const sendPwaSizedIconFile = async (res, size = 192) => {
    const normalized = Number(size) >= 512 ? 512 : 192;
    const iconPath = path.join(process.cwd(), 'static', `pwa-icon-${normalized}.png`);
    try {
        await fs.access(iconPath);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.sendFile(iconPath);
    } catch {
        return sendStaticLogoFallback(res);
    }
};

/** Detect raster type from magic bytes — Firefox A2HS fails on ICO/SVG/HTML icon bodies. */
const detectRasterImageType = (buffer) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    if (buffer.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
    return null;
};

/** Cover-crop + circular mask — matches login/hero `rounded-full object-cover` treatment. */
const sendCircularPwaIcon = async (res, buffer, size = 192) => {
    try {
        if (!detectRasterImageType(buffer)) {
            return sendPwaSizedIconFile(res, size);
        }
        const png = makeCircularPwaIconPng(buffer, size);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.send(png);
    } catch (e) {
        log(`Circular PWA icon failed: ${e.message}`);
        return sendPwaSizedIconFile(res, size);
    }
};

const sendBrandingImageBuffer = async (res, buffer, contentTypeHint = '', pwaSize = 0) => {
    if (pwaSize) {
        return sendCircularPwaIcon(res, buffer, pwaSize);
    }
    const detected = detectRasterImageType(buffer);
    if (!detected) {
        return sendStaticLogoFallback(res);
    }
    const hint = String(contentTypeHint || '').split(';')[0].trim().toLowerCase();
    const type = detected || (hint.startsWith('image/') && hint !== 'image/svg+xml' ? hint : 'image/png');
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(buffer);
};

/**
 * Dedicated PWA icon route — always returns a valid raster quickly.
 * Firefox aborts Install if the first manifest icon fails/times out; never point the
 * manifest at slow/unreliable branding URLs without this guarantee.
 */
app.get('/api/public/pwa-icon', publicReadRateLimit, async (req, res) => {
    const size = Number(req.query.size) >= 512 ? 512 : 192;
    try {
        const config = await loadFile(CONFIG_PATH, {});
        if (normalizePwaIconSource(config.pwaIconSource) === 'application') {
            return sendPwaSizedIconFile(res, size);
        }

        const profile = await getAdminProfile(config);
        const custom = String(config.customLogoUrl || '').trim();
        const iconTimeoutMs = 2500;

        if (custom) {
            if (custom.startsWith('http://') || custom.startsWith('https://')) {
                try {
                    const parsed = new URL(custom);
                    if (!isBlockedHostName(parsed.hostname)) {
                        const response = await fetchWithTimeout(custom, { redirect: 'follow' }, iconTimeoutMs).catch(() => null);
                        if (response?.ok) {
                            const buffer = Buffer.from(await response.arrayBuffer());
                            if (buffer.length) {
                                return sendBrandingImageBuffer(res, buffer, response.headers.get('content-type') || '', size);
                            }
                        }
                    }
                } catch {
                    // fall through
                }
            } else {
                const localPath = stripBasePathFromUrl(custom.startsWith('/') ? custom : `/${custom}`).split('?')[0];
                if (localPath.startsWith('/static/')) {
                    const fileName = path.basename(localPath);
                    if (fileName && !fileName.includes('..')) {
                        const assetPath = path.join(process.cwd(), 'static', fileName);
                        try {
                            const buffer = await fs.readFile(assetPath);
                            return sendBrandingImageBuffer(res, buffer, '', size);
                        } catch {
                            // fall through
                        }
                    }
                }
            }
        }

        if (String(config.mediaServerType || '').toLowerCase() === 'jellyfin' && isJellyfinConfigured(config)) {
            try {
                const baseUrl = resolveIntegrationUrlForFetch(config.jellyfinUrl);
                for (const assetPath of ['/web/icon-transparent.png', '/web/assets/img/icon-transparent.png']) {
                    const response = await fetchWithTimeout(`${baseUrl}${assetPath}`, {
                        headers: jellyfinHeaders(config.jellyfinApiKey, { Accept: 'image/*,*/*;q=0.8' }),
                    }, iconTimeoutMs).catch(() => null);
                    if (!response?.ok) continue;
                    const buffer = Buffer.from(await response.arrayBuffer());
                    if (buffer.length) {
                        return sendCircularPwaIcon(res, buffer, size);
                    }
                }
            } catch {
                // fall through
            }
        }

        const thumb = String(profile.thumb || '').trim();
        if (thumb.startsWith('http://') || thumb.startsWith('https://')) {
            try {
                const parsed = new URL(thumb);
                if (!isBlockedHostName(parsed.hostname)) {
                    const response = await fetchWithTimeout(thumb, { redirect: 'follow' }, iconTimeoutMs).catch(() => null);
                    if (response?.ok) {
                        const buffer = Buffer.from(await response.arrayBuffer());
                        if (buffer.length) {
                            return sendBrandingImageBuffer(res, buffer, response.headers.get('content-type') || '', size);
                        }
                    }
                }
            } catch {
                // fall through
            }
        } else if (thumb && isSafePlexMediaPath(thumb) && config.plexToken) {
            const uri = await getPlexConnectionUri(config);
            if (uri) {
                const url = `${uri}/photo/:/transcode?url=${encodeURIComponent(thumb)}&width=${size}&height=${size}&minSize=1&X-Plex-Token=${config.plexToken}`;
                const response = await fetchWithTimeout(url, { headers: plexClientHeaders(config.plexToken) }, iconTimeoutMs).catch(() => null);
                if (response?.ok) {
                    const buffer = Buffer.from(await response.arrayBuffer());
                    if (buffer.length) {
                        return sendBrandingImageBuffer(res, buffer, response.headers.get('content-type') || 'image/jpeg', size);
                    }
                }
            }
        }

        return sendPwaSizedIconFile(res, size);
    } catch (e) {
        log(`PWA icon failed: ${e.message}`);
        return sendPwaSizedIconFile(res, size);
    }
});

app.get('/api/public/branding-icon', publicReadRateLimit, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        if (normalizePwaIconSource(config.pwaIconSource) === 'application') {
            return sendStaticLogoFallback(res);
        }
        const profile = await getAdminProfile(config);
        const custom = String(config.customLogoUrl || '').trim();

        if (custom) {
            if (custom.startsWith('http://') || custom.startsWith('https://')) {
                try {
                    const parsed = new URL(custom);
                    if (!isBlockedHostName(parsed.hostname)) {
                        const response = await fetchWithTimeout(custom, { redirect: 'follow' }, 15000).catch(() => null);
                        if (response?.ok) {
                            const buffer = Buffer.from(await response.arrayBuffer());
                            if (buffer.length) {
                                return sendBrandingImageBuffer(res, buffer, response.headers.get('content-type') || '');
                            }
                        }
                    }
                } catch {
                    // fall through to other sources
                }
            } else {
                const localPath = stripBasePathFromUrl(custom.startsWith('/') ? custom : `/${custom}`).split('?')[0];
                if (localPath.startsWith('/static/')) {
                    const fileName = path.basename(localPath);
                    if (!fileName || fileName.includes('..')) return sendStaticLogoFallback(res);
                    const assetPath = path.join(process.cwd(), 'static', fileName);
                    try {
                        await fs.access(assetPath);
                        const buffer = await fs.readFile(assetPath);
                        return sendBrandingImageBuffer(res, buffer);
                    } catch {
                        return sendStaticLogoFallback(res);
                    }
                }
            }
        }

        if (String(config.mediaServerType || '').toLowerCase() === 'jellyfin' && isJellyfinConfigured(config)) {
            return proxyJellyfinBrandingAsset(res, ['/web/icon-transparent.png', '/web/assets/img/icon-transparent.png'], 'image/png');
        }

        const thumb = String(profile.thumb || '').trim();
        if (thumb.startsWith('http://') || thumb.startsWith('https://')) {
            try {
                const parsed = new URL(thumb);
                if (!isBlockedHostName(parsed.hostname)) {
                    const response = await fetchWithTimeout(thumb, { redirect: 'follow' }, 15000).catch(() => null);
                    if (response?.ok) {
                        const buffer = Buffer.from(await response.arrayBuffer());
                        if (buffer.length) {
                            return sendBrandingImageBuffer(res, buffer, response.headers.get('content-type') || '');
                        }
                    }
                }
            } catch {
                // fall through
            }
        } else if (thumb && isSafePlexMediaPath(thumb) && config.plexToken) {
            const uri = await getPlexConnectionUri(config);
            if (uri) {
                const width = Math.min(Math.max(parseInt(req.query.width, 10) || 180, 32), 1024);
                const height = Math.min(Math.max(parseInt(req.query.height, 10) || 180, 32), 1024);
                const url = `${uri}/photo/:/transcode?url=${encodeURIComponent(thumb)}&width=${width}&height=${height}&minSize=1&X-Plex-Token=${config.plexToken}`;
                const response = await fetchWithTimeout(url, { headers: plexClientHeaders(config.plexToken) }, 15000).catch(() => null);
                if (response?.ok) {
                    const buffer = Buffer.from(await response.arrayBuffer());
                    if (buffer.length) {
                        return sendBrandingImageBuffer(res, buffer, response.headers.get('content-type') || 'image/jpeg');
                    }
                }
            }
        }

        return sendStaticLogoFallback(res);
    } catch (e) {
        log(`Branding icon failed: ${e.message}`);
        return sendStaticLogoFallback(res);
    }
});

app.get('/api/public/info', publicReadRateLimit, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const profile = await getAdminProfile(config);
        const isConfigured = isPortalConfigured(config);
        const contactWhatsApp = config.contactWhatsApp || '';
        const contactEmail = config.contactEmail || '';
        let requestUrl = config.requestUrl || 'https://yourdomain.com';
        if ((requestUrl === 'https://yourdomain.com' || !requestUrl) && config.requestAppUrl) {
            requestUrl = config.requestAppUrl;
        }
        res.json({ ...profile, customLogoUrl: normalizeBrandingAssetForMediaServer(config.customLogoUrl, config.mediaServerType), isConfigured, mediaServerType: config.mediaServerType || 'plex', requestUrl, contactWhatsApp, contactEmail });
    } catch (e) {
        try {
            const config = await loadFile(CONFIG_PATH, {});
            const isConfigured = isPortalConfigured(config);
            let requestUrl = config.requestUrl || 'https://yourdomain.com';
            if ((requestUrl === 'https://yourdomain.com' || !requestUrl) && config.requestAppUrl) {
                requestUrl = config.requestAppUrl;
            }
            return res.json({
                thumb: null,
                customLogoUrl: normalizeBrandingAssetForMediaServer(config.customLogoUrl, config.mediaServerType),
                serverName: 'Server Portal',
                isConfigured,
                mediaServerType: config.mediaServerType || 'plex',
                requestUrl,
                contactWhatsApp: config.contactWhatsApp || '',
                contactEmail: config.contactEmail || '',
            });
        } catch {
            res.json({ thumb: null, customLogoUrl: '', serverName: 'Server Portal', isConfigured: false, mediaServerType: 'plex', requestUrl: 'https://yourdomain.com' });
        }
    }
});

app.get('/api/public/plex/stats', publicReadRateLimit, async (req, res) => {
    const config = await loadFile(CONFIG_PATH, {});
    if (!arePublicLibraryStatsVisible(config)) {
        return res.status(403).json({ error: 'Public library stats are disabled.' });
    }
    if (cachedPlexStats) {
        return res.json(cachedPlexStats);
    }
    const disk = await loadPlexStatsFromDisk();
    if (disk) return res.json(disk);
    return res.json({
        movies: 0, shows: 0, music: 0,
        moviesBytes: 0, showsBytes: 0, musicBytes: 0,
        fourKPercent: 0,
        isBuilding: true
    });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
app.get('/api/status', publicReadRateLimit, async (req, res) => {
    const config = await loadFile(CONFIG_PATH, {});
    if (!isPublicStatusVisible(config)) {
        const token = req.cookies.session;
        if (!token) return res.status(401).json({ error: 'Status monitor requires login.' });
        try {
            req.user = jwt.verify(token, JWT_SECRET);
        } catch (e) {
            return res.status(401).json({ error: 'Status monitor requires login.' });
        }
    }
    const publicServices = (statusConfig.services || []).map(service => ({
        id: service.id,
        name: service.name,
        groupId: service.groupId,
        type: service.type || 'web',
        clientType: service.clientType || null,
        description: service.description || ''
    }));
    const groups = (statusConfig.groups || []).map(group => ({ id: group.id, name: group.name, order: group.order }));

    // Downsample recentChecks for the public payload (keep full resolution on disk).
    const slimHealth = {};
    for (const [key, record] of Object.entries(healthData || {})) {
        if (key === '_meta') {
            slimHealth[key] = record;
            continue;
        }
        if (!record || typeof record !== 'object') continue;
        const recent = Array.isArray(record.recentChecks) ? record.recentChecks : [];
        const bucketMs = 5 * 60 * 1000;
        const buckets = new Map();
        for (const sample of recent) {
            if (!sample || !sample.t) continue;
            const slot = Math.floor(sample.t / bucketMs) * bucketMs;
            if (!buckets.has(slot)) buckets.set(slot, []);
            buckets.get(slot).push(sample);
        }
        const downsampled = [];
        for (const [slot, samples] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
            const online = samples.filter((s) => s.status === 'online');
            const latencies = online.map((s) => Number(s.latency)).filter((n) => Number.isFinite(n) && n > 0);
            downsampled.push({
                t: slot,
                status: online.length >= samples.length / 2 ? 'online' : (samples[samples.length - 1]?.status || 'offline'),
                latency: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
                _n: samples.length,
                _up: online.length,
            });
        }
        slimHealth[key] = {
            ...record,
            recentChecks: downsampled,
        };
    }

    res.json({
        config: {
            services: publicServices,
            groups,
            announcement: statusConfig.announcement || null
        },
        healthData: slimHealth
    });
});
app.get('/api/status/config', requireAuth, requireAdmin, (req, res) => res.json(statusConfig));
app.post('/api/status/config', requireAuth, requireAdmin, async (req, res) => {
    try {
        // Security: validate body schema before writing to disk
        const { services, groups, announcement } = req.body;
        if (!Array.isArray(services) || !Array.isArray(groups)) {
            return res.status(400).json({ error: 'Invalid config structure: services and groups must be arrays.' });
        }
        const sanitizedServices = [];
        for (const service of services) {
            if (!service || typeof service !== 'object') continue;
            let normalizedUrl = '';
            if (service.url) {
                try {
                    normalizedUrl = normalizeExternalBaseUrl(service.url, {
                        allowPrivate: ALLOW_PRIVATE_INTEGRATION_URLS,
                        allowHttp: true,
                    });
                    await assertResolvedAddressesAllowed(new URL(normalizedUrl).hostname, {
                        allowPrivate: ALLOW_PRIVATE_INTEGRATION_URLS,
                    });
                } catch (e) {
                    return res.status(400).json({ error: `Invalid service URL for "${service.name || service.id || 'unknown'}": ${e.message}` });
                }
            }
            sanitizedServices.push({
                id: String(service.id || randomUUID()),
                name: String(service.name || 'Service'),
                url: normalizedUrl,
                port: Number.isFinite(Number(service.port)) ? Number(service.port) : undefined,
                type: String(service.type || 'web'),
                clientType: service.clientType ? String(service.clientType) : undefined,
                clientId: service.clientId ? String(service.clientId) : undefined,
                groupId: String(service.groupId || 'core'),
                description: String(service.description || '')
            });
        }
        statusConfig = { services: sanitizedServices, groups, announcement: announcement || null };
        await saveFile(STATUS_CONFIG_PATH, statusConfig);
        res.json({ success: true, message: 'Status configuration updated successfully.' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update status configuration' });
    }
});

app.post('/api/status/reset', requireAuth, requireAdmin, async (req, res) => {
    try {
        healthData = {};
        await saveHealthData();
        res.json({ success: true, message: 'Status statistics reset successfully.' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to reset status statistics' });
    }
});

// --- Plex Dashboard & Image Proxy ---

app.get('/api/plex/item/:ratingKey', requireAuth, requireMember, async (req, res) => {
    try {
        const ratingKey = String(req.params.ratingKey || '').trim();
        if (!ratingKey) return res.status(400).json({ error: 'ratingKey required' });
        const config = await loadFile(CONFIG_PATH, null);
        if (!config || !config.plexToken || !config.serverIdentifier) return res.status(503).json({ error: 'Plex not configured' });
        const uri = await getPlexConnectionUri(config);
        if (!uri) return res.status(503).json({ error: 'Cannot connect to Plex' });

        const metaRes = await fetch(`${uri}/library/metadata/${encodeURIComponent(ratingKey)}?X-Plex-Token=${config.plexToken}`, { headers: plexClientHeaders(config.plexToken) }).then(r => r.json()).catch(() => null);
        
        if (!metaRes || !metaRes.MediaContainer || !metaRes.MediaContainer.Metadata || !metaRes.MediaContainer.Metadata[0]) {
            return res.status(404).json({ error: 'Item not found' });
        }
        
        const item = metaRes.MediaContainer.Metadata[0];
        res.json({
            title: item.title,
            originalTitle: item.originalTitle,
            summary: item.summary,
            duration: item.duration,
            viewOffset: item.viewOffset,
            viewCount: item.viewCount,
            year: item.year,
            type: item.type,
            art: item.art,
            thumb: item.thumb,
            grandparentTitle: item.grandparentTitle,
            parentTitle: item.parentTitle
        });
    } catch (e) {
        log(`Error fetching Plex item: ${e.message}`);
        res.status(500).json({ error: 'Failed to fetch item' });
    }
});


app.get('/api/plex/libraries', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, null);
        if (!config || !config.plexToken || !config.serverIdentifier) {
            return res.status(503).json({ error: 'Plex not configured' });
        }
        const libraries = await listPlexLibrariesForConfig(config);
        res.json(libraries);
    } catch (e) {
        log(`Error fetching Plex libraries: ${e.message}`);
        res.status(500).json({ error: e.message || 'Failed to fetch libraries' });
    }
});

/** Setup / admin: list Plex libraries using saved config and/or credentials from the body. */
app.post('/api/plex/libraries', setupRateLimit, async (req, res) => {
    if (!req.body || typeof req.body !== 'object') req.body = {};
    if (!req.body.type) req.body.type = 'plex';
    if (!(await assertIntegrationTestAccess(req, res))) return;

    try {
        const stored = await loadFile(CONFIG_PATH, {});
        const plexToken = resolveTestCredential(req.body.token, stored.plexToken);
        const serverId = resolveTestCredential(req.body.serverIdentifier, stored.serverIdentifier);
        const directUrl = resolveTestCredential(req.body.plexServerUrl, stored.plexServerUrl);
        if (!plexToken || !serverId) {
            return res.status(400).json({ error: 'Plex token and server identifier are required.' });
        }
        const testConfig = {
            ...stored,
            plexToken,
            serverIdentifier: serverId,
            ...(directUrl ? { plexServerUrl: directUrl } : {}),
        };
        const libraries = await listPlexLibrariesForConfig(testConfig);
        res.json(libraries);
    } catch (e) {
        log(`Error fetching Plex libraries (setup): ${e.message}`);
        res.status(500).json({ error: e.message || 'Failed to fetch libraries' });
    }
});

// Note: Duplicate route /api/plex/image handler removed. The primary handler is defined above.

const normalizeVideoCodecLabel = (mediaInfo = {}, streams = []) => {
    const videoStreams = streams.filter((s) => Number(s.streamType) === 1);
    const parts = [
        ...videoStreams.flatMap((s) => [s.codec, s.displayTitle, s.extendedTitle, s.format]),
        mediaInfo.videoCodec,
        mediaInfo.videoProfile
    ];
    const hay = parts.filter(Boolean).join(' ').toLowerCase();
    if (!hay) return null;
    // Stream codec is more reliable than Media.videoCodec (AV1 is sometimes misreported as hevc).
    if (/\bav1\b|av01|dav1|\.av1\b/.test(hay)) return 'AV1';
    if (/hevc|h265|x265|hev1|h\.265/.test(hay)) return 'HEVC';
    if (/h264|x264|avc1|avc|h\.264/.test(hay)) return 'H.264';
    if (/vp9|vp09/.test(hay)) return 'VP9';
    if (/mpeg2|mpeg-2/.test(hay)) return 'MPEG-2';
    if (/mpeg4|xvid|divx/.test(hay)) return 'MPEG-4';
    const raw = String(mediaInfo.videoCodec || '').trim();
    return raw ? raw.toUpperCase() : null;
};

const extractMediaDisplayTags = (metadata = {}) => {
    const mediaInfo = metadata?.Media?.[0] || {};
    const part = mediaInfo?.Part?.[0] || {};
    const streams = Array.isArray(part.Stream) ? part.Stream : [];
    const tags = [];

    const resolution = String(mediaInfo.videoResolution || '').toLowerCase();
    if (resolution.includes('4k') || resolution.includes('2160')) tags.push('4K');
    else if (resolution.includes('1080')) tags.push('1080p');
    else if (resolution.includes('720')) tags.push('720p');

    const codecLabel = normalizeVideoCodecLabel(mediaInfo, streams);
    if (codecLabel) tags.push(codecLabel);

    const videoStreams = streams.filter((s) => Number(s.streamType) === 1);
    const audioStreams = streams.filter((s) => Number(s.streamType) === 2);
    const streamText = streams.map((s) => `${s.displayTitle || ''} ${s.extendedTitle || ''} ${s.colorTrc || ''} ${s.codec || ''}`).join(' ').toLowerCase();

    if (/dolby vision|\bdv\b|dvhe|dvav/.test(streamText)) tags.push('DV');
    else if (/hdr10\+|hdr10|hdr|hlg|smpte2084|bt2020/.test(streamText)) tags.push('HDR');

    if (audioStreams.some((s) => /atmos/i.test(`${s.displayTitle || ''} ${s.extendedTitle || ''}`))) tags.push('Atmos');
    else if (audioStreams.some((s) => /truehd|true-hd/i.test(`${s.codec || ''} ${s.displayTitle || ''}`))) tags.push('TrueHD');
    else if (audioStreams.some((s) => /dts.?x|dtsx/i.test(`${s.displayTitle || ''} ${s.codec || ''}`))) tags.push('DTS-X');

    return [...new Set(tags)];
};

const fetchPlexMetadataMap = async (uri, config, ratingKeys = []) => {
    const unique = [...new Set(ratingKeys.map((k) => String(k || '')).filter(Boolean))];
    const map = new Map();
    if (!unique.length) return map;

    const chunkSize = 25;
    for (let i = 0; i < unique.length; i += chunkSize) {
        const chunk = unique.slice(i, i + chunkSize);
        const res = await fetch(`${uri}/library/metadata/${chunk.join(',')}?X-Plex-Token=${config.plexToken}`, {
            headers: plexClientHeaders(config.plexToken)
        }).then((r) => r.json()).catch(() => null);
        const metas = res?.MediaContainer?.Metadata || [];
        for (const meta of metas) {
            map.set(String(meta.ratingKey), meta);
        }
    }
    return map;
};

const enrichRecentItemsWithMediaTags = async (uri, config, items = []) => {
    if (!items.length) return items;

    const keysToFetch = [];
    for (const item of items) {
        if (item.ratingKey) keysToFetch.push(item.ratingKey);
        if (item.sourceRatingKey && item.sourceRatingKey !== item.ratingKey) keysToFetch.push(item.sourceRatingKey);
    }
    const metaMap = await fetchPlexMetadataMap(uri, config, keysToFetch);

    return items.map((item) => {
        const primaryMeta = item.ratingKey ? metaMap.get(String(item.ratingKey)) : null;
        const sourceMeta = item.sourceRatingKey && item.sourceRatingKey !== item.ratingKey
            ? metaMap.get(String(item.sourceRatingKey))
            : null;

        const primaryTags = primaryMeta ? extractMediaDisplayTags(primaryMeta) : [...(item.tags || [])];
        const sourceTags = sourceMeta ? extractMediaDisplayTags(sourceMeta) : [];
        const tags = new Set([...primaryTags, ...sourceTags]);
        if (tags.has('AV1')) tags.delete('HEVC');

        return { ...item, tags: [...tags] };
    });
};

app.get('/api/plex/dashboard', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, null);
        if (!config || !config.plexToken || !config.serverIdentifier) {
            return res.status(503).json({ error: 'Plex not configured' });
        }

        const uri = await getPlexConnectionUri(config);
        if (!uri) return res.status(503).json({ error: 'Cannot connect to Plex' });

        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 250);

        const cacheKey = `plex_dashboard_data_${limit}`;
        const cachedData = await withCache(cacheKey, 800, async () => {
            const sessionsPromise = fetch(`${uri}/status/sessions?X-Plex-Token=${config.plexToken}`, { headers: plexClientHeaders(config.plexToken) }).then(r => r.json()).catch(() => null);
            const sectionsPromise = fetch(`${uri}/library/sections?X-Plex-Token=${config.plexToken}`, { headers: plexClientHeaders(config.plexToken) }).then(r => r.json()).catch(() => null);
            const [sessionsData, sectionsData] = await Promise.all([sessionsPromise, sectionsPromise]);
            return { sessionsData, sectionsData };
        });
        const { sessionsData, sectionsData } = cachedData;

        let activeSessions = [];
        if (sessionsData && sessionsData.MediaContainer && sessionsData.MediaContainer.Metadata) {
            activeSessions = sessionsData.MediaContainer.Metadata.map(m => {
                const isTranscoding = m.TranscodeSession || (m.Media && m.Media[0] && m.Media[0].Part && m.Media[0].Part[0] && m.Media[0].Part[0].Stream && m.Media[0].Part[0].Stream.some(s => s.decision === 'transcode'));
                const player = m.Player || {};
                const session = m.Session || {};
                const duration = m.duration || 0;
                const viewOffset = m.viewOffset || 0;
                const progress = duration > 0 ? (viewOffset / duration) * 100 : 0;
                const plexUrl = `https://app.plex.tv/desktop/#!/server/${config.serverIdentifier}/details?key=${encodeURIComponent(m.key)}`;

                const hideConfig = config.hideStreamUsers === true ? 'anonymous' : (config.hideStreamUsers || 'false');
                const isHidden = !req.user.isAdmin && (hideConfig === 'anonymous' || hideConfig === 'hidden');

                return {
                    sessionId: session.id || m.sessionKey,
                    title: m.title,
                    type: m.type,
                    grandparentTitle: m.grandparentTitle,
                    year: m.year,
                    thumb: m.grandparentThumb || m.parentThumb || m.thumb,
                    user: (isHidden && hideConfig === 'hidden') ? null : (isHidden ? 'Anonymous' : (m.User ? m.User.title : 'Unknown User')),
                    userThumb: isHidden ? null : (m.User ? m.User.thumb : null),
                    playerProduct: player.product || 'Unknown Device',
                    playerTitle: player.title || 'Unknown Player',
                    playerAddress: req.user.isAdmin ? (player.address || 'Unknown IP') : null,
                    sessionLocation: session.location || 'Unknown',
                    state: player.state || 'playing',
                    isTranscoding: !!isTranscoding,
                    videoCodec: m.Media && m.Media[0] ? m.Media[0].videoCodec : null,
                    audioCodec: m.Media && m.Media[0] ? m.Media[0].audioCodec : null,
                    audioChannels: m.Media && m.Media[0] ? m.Media[0].audioChannels : null,
                    container: m.Media && m.Media[0] ? m.Media[0].container : null,
                    videoProfile: m.Media && m.Media[0] ? m.Media[0].videoProfile : null,
                    transcodeVideoDecision: m.TranscodeSession ? m.TranscodeSession.videoDecision : null,
                    transcodeAudioDecision: m.TranscodeSession ? m.TranscodeSession.audioDecision : null,
                    resolution: (m.Media && m.Media[0] && m.Media[0].videoResolution) ? m.Media[0].videoResolution : null,
                    season: m.parentIndex,
                    episode: m.index,
                    progress: progress,
                    timeRemaining: Math.max(0, duration - viewOffset),
                    bandwidth: normalizePlexBandwidthKbps((session && session.bandwidth) || (m.Media && m.Media[0] && m.Media[0].bitrate) || 0),
                    plexUrl: plexUrl,
                    geo: null,
                };
            });
            await enrichSessionsWithGeo(config, activeSessions, {
                isAdmin: !!req.user.isAdmin,
                fetchImpl: fetchWithTimeout,
                resolveUrl: resolveIntegrationUrlForFetch,
            });
        }

        let recentMovies = [];
        let recentShows = [];
        let recentMusic = [];

        if (sectionsData && sectionsData.MediaContainer && sectionsData.MediaContainer.Directory) {
            const sections = sectionsData.MediaContainer.Directory;
            const sectionPromises = sections.map(section =>
                fetch(`${uri}/library/sections/${section.key}/recentlyAdded?X-Plex-Token=${config.plexToken}&X-Plex-Container-Start=0&X-Plex-Container-Size=${limit}`, { headers: plexClientHeaders(config.plexToken) })
                    .then(r => r.json())
                    .then(data => ({ sectionType: section.type, data }))
                    .catch(() => ({ sectionType: section.type, data: null }))
            );

            const results = await Promise.all(sectionPromises);

            results.forEach(({ sectionType, data }) => {
                if (data && data.MediaContainer && data.MediaContainer.Metadata) {
                    data.MediaContainer.Metadata.forEach(m => {
                        const ratingKey = String(m.grandparentRatingKey || m.parentRatingKey || m.ratingKey || '');
                        const isMusic = sectionType === 'artist';
                        const item = {
                            ratingKey,
                            sourceRatingKey: String(m.ratingKey || ''),
                            title: isMusic ? (m.title || m.parentTitle || m.grandparentTitle) : (m.grandparentTitle || m.parentTitle || m.title),
                            parentTitle: isMusic ? (m.parentTitle || m.grandparentTitle || null) : undefined,
                            type: m.type,
                            year: m.year,
                            thumb: m.grandparentThumb || m.parentThumb || m.thumb,
                            addedAt: m.addedAt,
                            tags: extractMediaDisplayTags(m),
                            plexUrl: `https://app.plex.tv/desktop/#!/server/${config.serverIdentifier}/details?key=${encodeURIComponent(m.key)}`
                        };

                        if (sectionType === 'movie') recentMovies.push(item);
                        else if (sectionType === 'show') recentShows.push(item);
                        else if (sectionType === 'artist') recentMusic.push(item);
                    });
                }
            });

            const processList = (list) => {
                const unique = [];
                const seen = new Set();
                list.sort((a, b) => b.addedAt - a.addedAt);
                for (const item of list) {
                    const dedupeKey = item.ratingKey || item.title;
                    if (!seen.has(dedupeKey)) {
                        seen.add(dedupeKey);
                        unique.push(item);
                        if (unique.length >= limit) break;
                    }
                }
                return unique;
            };

            recentMovies = processList(recentMovies);
            recentShows = processList(recentShows);
            recentMusic = processList(recentMusic);

            [recentMovies, recentShows] = await Promise.all([
                enrichRecentItemsWithMediaTags(uri, config, recentMovies),
                enrichRecentItemsWithMediaTags(uri, config, recentShows)
            ]);
        }

        res.json({ activeSessions, recentMovies, recentShows, recentMusic });
    } catch (e) {
        log(`Error fetching Plex dashboard: ${e.message}`);
        res.status(500).json({ error: 'Failed to fetch dashboard data' });
    }
});

app.get('/api/plex/discover-search', requireAuth, requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, null);
        if (!config || !config.plexToken || !config.serverIdentifier) {
            return res.status(503).json({ error: 'Plex not configured' });
        }

        const uri = await getPlexConnectionUri(config);
        if (!uri) return res.status(503).json({ error: 'Cannot connect to Plex' });

        const query = String(req.query.query || '').trim();
        if (!query) return res.json({ results: [] });

        // Search Plex Hubs
        const searchRes = await fetch(`${uri}/hubs/search?query=${encodeURIComponent(query)}&limit=20&X-Plex-Token=${config.plexToken}`, { headers: plexClientHeaders(config.plexToken) }).then(r => r.json());
        
        let searchResults = [];
        if (searchRes && searchRes.MediaContainer && searchRes.MediaContainer.Hub) {
            searchRes.MediaContainer.Hub.forEach(hub => {
                if (hub.type === 'movie' || hub.type === 'show') {
                    if (hub.Metadata) {
                        hub.Metadata.forEach(m => {
                            searchResults.push({
                                ratingKey: m.ratingKey,
                                title: m.title,
                                type: m.type,
                                year: m.year,
                                thumb: m.thumb,
                                plexUrl: `https://app.plex.tv/desktop/#!/server/${config.serverIdentifier}/details?key=${encodeURIComponent(m.key)}`
                            });
                        });
                    }
                }
            });
        }

        // Limit to top 8 results to prevent heavy network usage
        searchResults = searchResults.slice(0, 8);

        // Fetch Watch History in parallel
        await Promise.all(searchResults.map(async (item) => {
            item.history = [];
            try {
                if (config.tautulliUrl && config.tautulliApiKey) {
                    const tSearch = encodeURIComponent(item.title);
                    const fetchUrl = `${config.tautulliUrl.replace(/\/+$/, '')}/api/v2?apikey=${config.tautulliApiKey}&cmd=get_history&search=${tSearch}&length=50`;
                    const resData = await fetch(fetchUrl, { headers: { 'Accept': 'application/json' } }).then(r => r.json());
                    if (resData && resData.response && resData.response.data && resData.response.data.data) {
                        const historyData = resData.response.data.data;
                        item.history = historyData
                            .filter(h => String(h.rating_key) === String(item.ratingKey) || String(h.grandparent_rating_key) === String(item.ratingKey))
                            .map(h => ({
                                user: h.user,
                                userThumb: h.user_thumb || null,
                                date: h.date,
                                duration: h.duration,
                                player: h.player,
                                title: h.full_title || h.title,
                                source: 'Tautulli'
                            }));
                    }
                } else {
                    const filterKey = item.type === 'show' ? 'grandparentID' : 'metadataItemID';
                    const fetchUrl = `${uri}/status/sessions/history/all?sort=viewedAt%3Adesc&${filterKey}=${item.ratingKey}&X-Plex-Token=${config.plexToken}`;
                    const resData = await fetch(fetchUrl, { headers: plexClientHeaders(config.plexToken) }).then(r => r.json());
                    if (resData && resData.MediaContainer && resData.MediaContainer.Metadata) {
                        item.history = resData.MediaContainer.Metadata.map(h => ({
                            user: (h.User && h.User.title) ? h.User.title : 'Unknown User',
                            userThumb: (h.User && h.User.thumb) ? h.User.thumb : null,
                            date: h.viewedAt, // Unix timestamp in seconds
                            duration: h.duration ? Math.round(h.duration / 1000) : 0, // Convert ms to seconds
                            player: (h.Player && h.Player.title) ? h.Player.title : 'Unknown Player',
                            title: h.title,
                            source: 'Plex'
                        }));
                    }
                }
            } catch (e) {
                log(`Error fetching history for ${item.title}: ${e.message}`);
            }
        }));

        res.json({ results: searchResults });
    } catch (e) {
        log(`Error fetching discover search: ${e.message}`);
        res.status(500).json({ error: 'Failed to fetch search results' });
    }
});

const jellyfinItemUrl = (config, itemId) => {
    const baseUrl = String(config?.jellyfinUrl || '').replace(/\/+$/, '');
    return baseUrl && itemId ? `${baseUrl}/web/#/details?id=${encodeURIComponent(itemId)}` : baseUrl;
};

const hasJellyfinPrimaryImage = (item = {}) => !!(
    item?.ImageTags?.Primary
    || item?.PrimaryImageTag
    || item?.PrimaryImageItemId
);

const jellyfinImageUrlForItem = (itemId, width = 300, height = 450) => (
    itemId ? withBasePath(`/api/jellyfin/image?itemId=${encodeURIComponent(itemId)}&width=${width}&height=${height}`) : ''
);

const mapJellyfinItemForDiscover = (config, item = {}, type = '') => {
    const id = item.Id || '';
    const isEpisode = String(type || item.Type || '').toLowerCase() === 'episode';
    const canUsePrimaryImage = hasJellyfinPrimaryImage(item);
    const posterId = canUsePrimaryImage ? (isEpisode ? (item.PrimaryImageItemId || item.SeriesId || item.ParentId || id) : (item.PrimaryImageItemId || id)) : '';
    const title = type === 'episode'
        ? (item.SeriesName ? `${item.SeriesName} - ${item.Name}` : item.Name)
        : (item.Name || 'Untitled');
    const tags = [];
    const width = Number(item.Width || item.MediaStreams?.find?.((s) => s.Type === 'Video')?.Width || 0);
    const height = Number(item.Height || item.MediaStreams?.find?.((s) => s.Type === 'Video')?.Height || 0);
    if (width >= 3800 || height >= 2000) tags.push('4K');
    else if (height >= 1000) tags.push('1080p');
    else if (height >= 700) tags.push('720p');
    const videoCodec = item.MediaStreams?.find?.((s) => s.Type === 'Video')?.Codec || item.MediaSources?.[0]?.VideoCodec;
    if (videoCodec) tags.push(String(videoCodec).toUpperCase());

    return {
        ratingKey: id,
        sourceRatingKey: id,
        title,
        parentTitle: item.Album || item.SeriesName || null,
        type: item.Type,
        year: item.ProductionYear,
        thumb: posterId,
        thumbUrl: posterId ? jellyfinImageUrlForItem(posterId, 300, type === 'music' ? 300 : 450) : '',
        posterFallbackUrl: isEpisode && canUsePrimaryImage && id && id !== posterId ? jellyfinImageUrlForItem(id, 300, 450) : '',
        addedAt: item.DateCreated ? Date.parse(item.DateCreated) / 1000 : 0,
        tags: [...new Set(tags)].slice(0, 4),
        plexUrl: jellyfinItemUrl(config, id),
    };
};

const fetchJellyfinItems = async (config, includeItemTypes, limit) => {
    const baseUrl = resolveIntegrationUrlForFetch(config.jellyfinUrl);
    const params = new URLSearchParams({
        Recursive: 'true',
        IncludeItemTypes: includeItemTypes,
        SortBy: 'DateCreated',
        SortOrder: 'Descending',
        Limit: String(limit),
        Fields: 'DateCreated,PrimaryImageAspectRatio,ProductionYear,SeriesName,Album,ParentId,SeriesId,AlbumId,ImageTags,BackdropImageTags,ParentThumbItemId,PrimaryImageItemId,MediaSources,MediaStreams',
        ImageTypeLimit: '1',
        EnableImageTypes: 'Primary,Thumb,Backdrop',
    });
    const response = await fetchWithTimeout(`${baseUrl}/Items?${params.toString()}`, {
        headers: jellyfinHeaders(config.jellyfinApiKey),
    }, 15000);
    if (!response.ok) throw new Error(`Jellyfin Items returned HTTP ${response.status}`);
    const data = await response.json();
    return Array.isArray(data.Items) ? data.Items : [];
};

app.get('/api/jellyfin/image', requireAuth, requireMember, async (req, res) => {
    const itemId = String(req.query.itemId || '').trim();
    const width = Math.min(Math.max(parseInt(req.query.width, 10) || 300, 64), 1200);
    const height = Math.min(Math.max(parseInt(req.query.height, 10) || 450, 64), 1600);
    if (!itemId || !/^[A-Za-z0-9_-]+$/.test(itemId)) return res.status(400).send('Invalid itemId');
    try {
        const config = await loadFile(CONFIG_PATH, {});
        if (!isJellyfinConfigured(config)) return res.status(503).send('');
        const baseUrl = resolveIntegrationUrlForFetch(config.jellyfinUrl);
        const imageUrl = `${baseUrl}/Items/${encodeURIComponent(itemId)}/Images/Primary?fillWidth=${width}&fillHeight=${height}&quality=90`;
        const response = await fetchWithTimeout(imageUrl, {
            headers: jellyfinHeaders(config.jellyfinApiKey),
        }, 15000);
        if (!response.ok) {
            log(`Jellyfin image ${itemId} returned HTTP ${response.status}`);
            return res.status(404).send('');
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(buffer);
    } catch (e) {
        res.status(500).send('');
    }
});

app.get('/api/jellyfin/user-image', requireAuth, requireMember, async (req, res) => {
    const userId = String(req.query.userId || '').trim();
    if (!userId || !/^[A-Za-z0-9_-]+$/.test(userId)) return res.status(400).send('Invalid userId');
    try {
        const config = await loadFile(CONFIG_PATH, {});
        if (!isJellyfinConfigured(config)) return res.status(503).send('');
        const baseUrl = resolveIntegrationUrlForFetch(config.jellyfinUrl);
        const imageUrl = `${baseUrl}/Users/${encodeURIComponent(userId)}/Images/Primary?fillWidth=128&fillHeight=128&quality=90`;
        const response = await fetchWithTimeout(imageUrl, {
            headers: jellyfinHeaders(config.jellyfinApiKey),
        }, 15000);
        if (!response.ok) return res.status(404).send('');
        const buffer = Buffer.from(await response.arrayBuffer());
        res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(buffer);
    } catch (e) {
        res.status(500).send('');
    }
});

const proxyJellyfinBrandingAsset = async (res, paths, fallbackContentType = 'image/png') => {
    const config = await loadFile(CONFIG_PATH, {});
    if (!isJellyfinConfigured(config)) return res.status(503).send('');
    const baseUrl = resolveIntegrationUrlForFetch(config.jellyfinUrl);
    for (const path of paths) {
        const response = await fetchWithTimeout(`${baseUrl}${path}`, {
            headers: jellyfinHeaders(config.jellyfinApiKey, { Accept: 'image/*,*/*;q=0.8' }),
        }, 15000).catch(() => null);
        if (!response || !response.ok) continue;
        const buffer = Buffer.from(await response.arrayBuffer());
        if (!buffer.length) continue;
        res.setHeader('Content-Type', response.headers.get('content-type') || fallbackContentType);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.send(buffer);
    }
    return res.status(404).send('');
};

app.get('/api/jellyfin/branding/splash', publicReadRateLimit, async (req, res) => {
    try {
        await proxyJellyfinBrandingAsset(res, ['/Branding/Splashscreen'], 'image/jpeg');
    } catch (e) {
        res.status(500).send('');
    }
});

app.get('/api/jellyfin/branding/icon', publicReadRateLimit, async (req, res) => {
    try {
        await proxyJellyfinBrandingAsset(res, ['/web/icon-transparent.png', '/web/assets/img/icon-transparent.png', '/web/favicon.ico'], 'image/png');
    } catch (e) {
        res.status(500).send('');
    }
});

app.get('/api/jellyfin/branding/favicon', publicReadRateLimit, async (req, res) => {
    try {
        await proxyJellyfinBrandingAsset(res, ['/web/favicon.ico', '/web/icon-transparent.png', '/web/assets/img/icon-transparent.png'], 'image/x-icon');
    } catch (e) {
        res.status(500).send('');
    }
});

app.get('/api/jellyfin/dashboard', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        if (!isJellyfinConfigured(config)) {
            return res.status(503).json({ error: 'Jellyfin not configured' });
        }

        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 250);
        const baseUrl = resolveIntegrationUrlForFetch(config.jellyfinUrl);
        const [sessions, movies, episodes, music] = await Promise.all([
            fetchWithTimeout(`${baseUrl}/Sessions`, { headers: jellyfinHeaders(config.jellyfinApiKey) }, 15000).then((r) => r.ok ? r.json() : []).catch(() => []),
            fetchJellyfinItems(config, 'Movie', limit).catch((e) => { log(`Jellyfin movies fetch failed: ${e.message}`); return []; }),
            fetchJellyfinItems(config, 'Episode', limit).catch((e) => { log(`Jellyfin episodes fetch failed: ${e.message}`); return []; }),
            fetchJellyfinItems(config, 'MusicAlbum,Audio', limit).catch((e) => { log(`Jellyfin music fetch failed: ${e.message}`); return []; }),
        ]);

        const hideConfig = config.hideStreamUsers === true ? 'anonymous' : (config.hideStreamUsers || 'false');
        const activeSessions = (Array.isArray(sessions) ? sessions : [])
            .filter((session) => session.NowPlayingItem)
            .map((session) => {
                const item = session.NowPlayingItem || {};
                const playState = session.PlayState || {};
                const runtime = Number(item.RunTimeTicks || 0) / 10000;
                const position = Number(playState.PositionTicks || 0) / 10000;
                const streamBitrate = (Array.isArray(item.MediaStreams) ? item.MediaStreams : [])
                    .filter((stream) => stream.Type === 'Video' || stream.Type === 'Audio')
                    .reduce((total, stream) => total + Number(stream.BitRate || stream.Bitrate || 0), 0);
                const mediaSourceBitrate = (Array.isArray(item.MediaSources) ? item.MediaSources : [])
                    .reduce((max, source) => Math.max(max, Number(source.Bitrate || source.VideoBitrate || 0) + Number(source.AudioBitrate || 0)), 0);
                const reportedBitrate = Number(session.TranscodingInfo?.Bitrate || item.Bitrate || streamBitrate || mediaSourceBitrate || 0);
                const isHidden = !req.user.isAdmin && (hideConfig === 'anonymous' || hideConfig === 'hidden');
                return {
                    sessionId: session.Id,
                    title: item.Name,
                    type: item.Type,
                    grandparentTitle: item.SeriesName || item.Album || null,
                    year: item.ProductionYear,
                    thumb: hasJellyfinPrimaryImage(item) ? (item.Type === 'Episode' ? (item.PrimaryImageItemId || item.SeriesId || item.ParentId || item.Id) : (item.PrimaryImageItemId || item.Id)) : '',
                    thumbUrl: hasJellyfinPrimaryImage(item)
                        ? jellyfinImageUrlForItem(item.Type === 'Episode' ? (item.PrimaryImageItemId || item.SeriesId || item.ParentId || item.Id) : (item.PrimaryImageItemId || item.Id), 300, 450)
                        : '',
                    posterFallbackUrl: item.Type === 'Episode' && hasJellyfinPrimaryImage(item) && item.Id ? jellyfinImageUrlForItem(item.Id, 300, 450) : '',
                    user: (isHidden && hideConfig === 'hidden') ? null : (isHidden ? 'Anonymous' : (session.UserName || 'Unknown User')),
                    userThumb: (!isHidden && session.UserId) ? withBasePath(`/api/jellyfin/user-image?userId=${encodeURIComponent(session.UserId)}`) : null,
                    playerProduct: session.Client || 'Jellyfin',
                    playerTitle: session.DeviceName || session.Client || 'Jellyfin Player',
                    playerAddress: req.user.isAdmin ? (session.RemoteEndPoint || 'Unknown IP') : null,
                    sessionLocation: 'remote',
                    state: playState.IsPaused ? 'paused' : 'playing',
                    isTranscoding: !!session.TranscodingInfo,
                    videoCodec: session.TranscodingInfo?.VideoCodec || null,
                    audioCodec: session.TranscodingInfo?.AudioCodec || null,
                    resolution: item.Height ? `${item.Height}p` : null,
                    progress: runtime > 0 ? Math.min(100, Math.max(0, (position / runtime) * 100)) : 0,
                    timeRemaining: Math.max(0, runtime - position),
                    bandwidth: Math.round(reportedBitrate / 1000),
                    plexUrl: jellyfinItemUrl(config, item.Id),
                    geo: null,
                };
            });

        await enrichSessionsWithGeo(config, activeSessions, {
            isAdmin: !!req.user.isAdmin,
            fetchImpl: fetchWithTimeout,
            resolveUrl: resolveIntegrationUrlForFetch,
        });

        res.json({
            activeSessions,
            recentMovies: movies.map((item) => mapJellyfinItemForDiscover(config, item, 'movie')),
            recentShows: episodes.map((item) => mapJellyfinItemForDiscover(config, item, 'episode')),
            recentMusic: music.map((item) => mapJellyfinItemForDiscover(config, item, 'music')),
        });
    } catch (e) {
        log(`Error fetching Jellyfin dashboard: ${e.message}`);
        res.status(500).json({ error: 'Failed to fetch Jellyfin dashboard data' });
    }
});

app.get('/api/streams/watching-count', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const mediaServerType = config.mediaServerType || 'plex';

        if (isEmbyLikeMediaServer(config)) {
            if (!isJellyfinConfigured(config)) {
                return res.json({ count: 0, available: false });
            }
            const count = await withCache(`${mediaServerType}_watching_count`, 8000, async () => {
                const baseUrl = resolveIntegrationUrlForFetch(config.jellyfinUrl);
                const sessions = await fetchWithTimeout(`${baseUrl}/Sessions`, { headers: jellyfinHeaders(config.jellyfinApiKey) }, 15000)
                    .then((r) => (r.ok ? r.json() : []))
                    .catch(() => []);
                const activeSessions = (Array.isArray(sessions) ? sessions : [])
                    .filter((session) => session?.NowPlayingItem);
                return activeSessions.length;
            });
            return res.json({ count, available: true });
        }

        if (!config.plexToken || !config.serverIdentifier) {
            return res.json({ count: 0, available: false });
        }

        const uri = await getPlexConnectionUri(config);
        if (!uri) return res.json({ count: 0, available: false });

        const count = await withCache('plex_watching_count', 8000, async () => {
            const sessionsData = await fetch(`${uri}/status/sessions?X-Plex-Token=${config.plexToken}`, { headers: plexClientHeaders(config.plexToken) })
                .then((r) => r.json())
                .catch(() => null);
            const activeSessions = Array.isArray(sessionsData?.MediaContainer?.Metadata)
                ? sessionsData.MediaContainer.Metadata
                : [];
            return activeSessions.length;
        });

        res.json({ count, available: true });
    } catch (e) {
        log(`Watching count error: ${e.message}`);
        res.json({ count: 0, available: false, error: e.message });
    }
});

app.post('/api/streams/kill', requireAdmin, async (req, res) => {
    const { sessionId, reason } = req.body;
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const uri = await getPlexConnectionUri(config);
        if (!uri) return res.status(503).json({ error: 'Cannot connect to Plex' });

        const response = await fetch(`${uri}/status/sessions/terminate?sessionId=${encodeURIComponent(sessionId)}&reason=${encodeURIComponent(reason || 'Admin terminated session')}&X-Plex-Token=${config.plexToken}`, {
            method: 'GET',
            headers: plexClientHeaders(config.plexToken)
        });

        if (response.ok) {
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Failed to terminate session' });
        }
    } catch (e) {
        console.error('Error terminating stream:', e);
        res.status(500).json({ error: 'Failed to communicate with Plex' });
    }
});

app.post('/api/announcements/push', requireAdmin, async (req, res) => {
    const { text, sendEmail: shouldSendEmail } = req.body;

    try {
        const config = await loadFile(CONFIG_PATH, {});
        config.announcement = text || '';
        await saveFile(CONFIG_PATH, config);

        if (shouldSendEmail && text) {
            const users = await loadFile(USERS_PATH, []);
            const activeUsers = users.filter(u => u.plexAccessStatus === 'active' && u.email);
            if (activeUsers.length > 0) {
                // Email sending staggered over half an hour
                const totalDuration = 30 * 60 * 1000; // 30 minutes in ms
                const delayPerUser = Math.floor(totalDuration / activeUsers.length);

                // Background task
                (async () => {
                    log(`Starting staggered announcement email push to ${activeUsers.length} users over 30 minutes.`);
                    let sentCount = 0;
                    for (let i = 0; i < activeUsers.length; i++) {
                        const user = activeUsers[i];
                        const escapedAnnouncement = escapeHtmlAttr(String(text || ''));
                        const escapedServerId = escapeHtmlAttr(String(config.serverIdentifier || 'our Plex Server'));
                        const html = `
                            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #1a1b26; color: #a9b1d6; padding: 20px; border-radius: 10px;">
                                <h2 style="color: #E5A00D; text-align: center; text-transform: uppercase; letter-spacing: 2px;">Server Announcement</h2>
                                <div style="background-color: #24283b; padding: 20px; border-radius: 8px; margin-top: 20px; border-left: 4px solid #E5A00D;">
                                    <p style="white-space: pre-wrap; font-size: 16px; line-height: 1.6; color: #c0caf5; margin: 0;">${escapedAnnouncement}</p>
                                </div>
                                <p style="text-align: center; margin-top: 30px; font-size: 12px; color: #565f89;">
                                    You are receiving this message because you are an active user on ${escapedServerId}.
                                </p>
                            </div>
                        `;
                        try {
                            await sendEmail(config, user.email, `Server Announcement - ${config.serverIdentifier || 'Plex'}`, html);
                            sentCount++;
                        } catch (emailErr) {
                            log(`Failed to send announcement email to ${user.email}`);
                        }

                        if (i < activeUsers.length - 1) {
                            await new Promise(resolve => setTimeout(resolve, delayPerUser));
                        }
                    }
                    log(`Completed staggered announcement email push. Sent ${sentCount} emails.`);
                })();
            }
        }
        res.json({ success: true, message: 'Announcement updated' });
    } catch (e) {
        log(`Error pushing announcement: ${e.message}`);
        res.status(500).json({ error: 'Failed to update announcement' });
    }
});

const TAUTULLI_HISTORY_PAGE_SIZE = 500;
let cachedTautulliUsers = null;
let cachedTautulliUsersAt = 0;
let cachedTautulliTimezone = null;
let cachedTautulliTimezoneAt = 0;

const getHourInTimezone = (unixSec, timeZone) => {
    try {
        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: timeZone || 'UTC',
            hour: 'numeric',
            hour12: false,
        }).formatToParts(new Date(unixSec * 1000));
        const hourPart = parts.find((p) => p.type === 'hour');
        if (hourPart) return Number(hourPart.value);
    } catch (e) {
        log(`Invalid timezone "${timeZone}" for hour stats: ${e.message}`);
    }
    return new Date(unixSec * 1000).getUTCHours();
};

const getWeekdayInTimezone = (unixSec, timeZone) => {
    try {
        const weekday = new Intl.DateTimeFormat('en-GB', {
            timeZone: timeZone || 'UTC',
            weekday: 'short',
        }).format(new Date(unixSec * 1000));
        const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        if (map[weekday] != null) return map[weekday];
    } catch (e) {
        log(`Invalid timezone "${timeZone}" for weekday stats: ${e.message}`);
    }
    return new Date(unixSec * 1000).getUTCDay();
};

const buildHourStatsFromUnixTimestamps = (timestamps, timeZone) => {
    const hourDistribution = new Array(24).fill(0);
    let totalHourOfDay = 0;
    for (const ts of timestamps) {
        const hour = getHourInTimezone(ts, timeZone);
        totalHourOfDay += hour;
        hourDistribution[hour]++;
    }
    return {
        totalHourOfDay,
        hourCount: timestamps.length,
        hourDistribution,
    };
};

const resolvePeakHour = (hourDistribution) => {
    if (!Array.isArray(hourDistribution) || hourDistribution.length === 0) return null;
    let peakHour = 0;
    let peakCount = 0;
    for (let h = 0; h < hourDistribution.length; h++) {
        if (hourDistribution[h] > peakCount) {
            peakCount = hourDistribution[h];
            peakHour = h;
        }
    }
    return peakCount > 0 ? peakHour : null;
};

const resolveTimeOfDayPersona = (hour) => {
    if (hour == null) return 'Night Owl';
    if (hour >= 5 && hour < 12) return 'Early Bird';
    if (hour >= 12 && hour < 18) return 'Afternoon Watcher';
    if (hour >= 18) return 'Evening Streamer';
    return 'Night Owl';
};

const fetchTautulliUsers = async (config) => {
    if (!config?.tautulliUrl || !config?.tautulliApiKey) return [];
    if (cachedTautulliUsers && (Date.now() - cachedTautulliUsersAt < 15 * 60 * 1000)) {
        return cachedTautulliUsers;
    }
    const tUrl = resolveIntegrationUrlForFetch(config.tautulliUrl);
    if (!tUrl) return [];
    const response = await fetch(`${tUrl}/api/v2?apikey=${encodeURIComponent(config.tautulliApiKey)}&cmd=get_users`, {
        headers: { Accept: 'application/json' },
    }).then((r) => r.json()).catch(() => null);
    const users = Array.isArray(response?.response?.data) ? response.response.data : [];
    cachedTautulliUsers = users;
    cachedTautulliUsersAt = Date.now();
    return users;
};

const resolveTautulliUserId = (users, { username, email, plexAccountName }) => {
    const norm = (v) => String(v || '').trim().toLowerCase();
    if (!Array.isArray(users) || users.length === 0) return null;

    const candidates = [username, plexAccountName, email].filter(Boolean).map(norm);
    for (const candidate of candidates) {
        const match = users.find((u) =>
            norm(u.username) === candidate
            || norm(u.friendly_name) === candidate
            || norm(u.email) === candidate,
        );
        if (match?.user_id != null && match.user_id !== '') return String(match.user_id);
    }
    return null;
};

const fetchTautulliTimezone = async (config) => {
    if (!config?.tautulliUrl || !config?.tautulliApiKey) {
        return process.env.PORTAL_TIMEZONE || process.env.TZ || 'UTC';
    }
    if (cachedTautulliTimezone && (Date.now() - cachedTautulliTimezoneAt < 60 * 60 * 1000)) {
        return cachedTautulliTimezone;
    }
    const tUrl = resolveIntegrationUrlForFetch(config.tautulliUrl);
    if (!tUrl) return process.env.PORTAL_TIMEZONE || process.env.TZ || 'UTC';

    const response = await fetch(`${tUrl}/api/v2?apikey=${encodeURIComponent(config.tautulliApiKey)}&cmd=get_settings`, {
        headers: { Accept: 'application/json' },
    }).then((r) => r.json()).catch(() => null);
    const settings = response?.response?.data || {};
    const timezone = settings?.timezone
        || settings?.General?.timezone
        || settings?.General?.TIMEZONE
        || process.env.PORTAL_TIMEZONE
        || process.env.TZ
        || 'UTC';
    cachedTautulliTimezone = timezone;
    cachedTautulliTimezoneAt = Date.now();
    return timezone;
};

const fetchTautulliPlaysByHourOfDay = async (config, tUrl, tautulliUserId, timeRangeDays) => {
    const timeRange = timeRangeDays === 'all' ? 'all' : String(timeRangeDays || 30);
    const params = new URLSearchParams({
        apikey: config.tautulliApiKey,
        cmd: 'get_plays_by_hourofday',
        time_range: timeRange,
        y_axis: 'plays',
        user_id: String(tautulliUserId),
        grouping: '0',
    });
    const response = await fetch(`${tUrl}/api/v2?${params.toString()}`, {
        headers: { Accept: 'application/json' },
    }).then((r) => r.json()).catch(() => null);
    const data = response?.response?.data;
    if (!data?.series || !Array.isArray(data.series)) return null;

    const hourDistribution = new Array(24).fill(0);
    for (const series of data.series) {
        if (!Array.isArray(series.data)) continue;
        series.data.forEach((count, idx) => {
            if (idx < 24) hourDistribution[idx] += Number(count) || 0;
        });
    }
    const hourCount = hourDistribution.reduce((sum, count) => sum + count, 0);
    if (hourCount === 0) return null;

    let totalHourOfDay = 0;
    for (let h = 0; h < 24; h++) totalHourOfDay += h * hourDistribution[h];
    return { totalHourOfDay, hourCount, hourDistribution };
};

const fetchTautulliUserHistoryStarts = async (config, tUrl, tautulliUserId, { afterUnixSec = 0, maxItems = 5000 } = {}) => {
    const startedTimestamps = [];
    let offset = 0;
    let done = false;

    while (!done && startedTimestamps.length < maxItems) {
        const length = Math.min(TAUTULLI_HISTORY_PAGE_SIZE, maxItems - startedTimestamps.length);
        const params = new URLSearchParams({
            apikey: config.tautulliApiKey,
            cmd: 'get_history',
            order_column: 'started',
            order_dir: 'desc',
            start: String(offset),
            length: String(length),
            user_id: String(tautulliUserId),
            grouping: '0',
        });

        const response = await fetch(`${tUrl}/api/v2?${params.toString()}`, { headers: { Accept: 'application/json' } })
            .then((r) => r.json())
            .catch(() => null);

        const rows = response?.response?.data?.data;
        if (!Array.isArray(rows) || rows.length === 0) break;

        for (const row of rows) {
            const started = Number(row.started || row.date || 0);
            if (!started) continue;
            if (afterUnixSec > 0 && started < afterUnixSec) {
                done = true;
                break;
            }
            startedTimestamps.push(started);
            if (startedTimestamps.length >= maxItems) {
                done = true;
                break;
            }
        }

        if (rows.length < length) break;
        offset += rows.length;
    }

    return startedTimestamps;
};

const tautulliHourStatsMatchPlexPlays = (tautulliCount, plexCount) => {
    if (!tautulliCount || !plexCount) return false;
    if (tautulliCount === plexCount) return true;
    const tolerance = Math.max(2, Math.ceil(plexCount * 0.25));
    return Math.abs(tautulliCount - plexCount) <= tolerance;
};

const resolveTautulliHourStats = async (config, { username, email, plexAccountName, days, afterUnixSec, maxItems = 5000, plexPlayCount = 0 }) => {
    if (!config?.tautulliUrl || !config?.tautulliApiKey) return null;
    const tUrl = resolveIntegrationUrlForFetch(config.tautulliUrl);
    if (!tUrl) return null;

    const users = await fetchTautulliUsers(config);
    const tautulliUserId = resolveTautulliUserId(users, { username, email, plexAccountName });
    if (!tautulliUserId) {
        log(`Tautulli hour stats: no matching user for "${username || plexAccountName || email || 'unknown'}".`);
        return null;
    }

    const timeRangeDays = days === 'all' ? 'all' : (parseInt(days, 10) || 30);
    let stats = await fetchTautulliPlaysByHourOfDay(config, tUrl, tautulliUserId, timeRangeDays);
    if (!stats) {
        const timezone = await fetchTautulliTimezone(config);
        const starts = await fetchTautulliUserHistoryStarts(config, tUrl, tautulliUserId, { afterUnixSec, maxItems });
        if (starts.length > 0) stats = buildHourStatsFromUnixTimestamps(starts, timezone);
    }

    if (!stats?.hourCount) return null;
    if (plexPlayCount > 0 && !tautulliHourStatsMatchPlexPlays(stats.hourCount, plexPlayCount)) {
        log(`Tautulli hour stats count (${stats.hourCount}) mismatches Plex plays (${plexPlayCount}) for user ${tautulliUserId}; ignoring Tautulli hours.`);
        return null;
    }
    return stats;
};

app.get('/api/tautulli/stats', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, null);
        if (!config || !config.tautulliUrl || !config.tautulliApiKey) {
            return res.status(404).json({ error: 'Tautulli is not configured.' });
        }
        const tUrl = resolveIntegrationUrlForFetch(config.tautulliUrl);
        const response = await fetch(`${tUrl}/api/v2?apikey=${config.tautulliApiKey}&cmd=get_home_stats`, { headers: { 'Accept': 'application/json' } }).then(r => r.json());

        if (response && response.response && response.response.data) {
            const stats = response.response.data;
            let streamsRecord = 0;
            let totalPlays = 0;
            let totalTimeStr = '';

            let tvPlays = 0;
            let moviePlays = 0;
            let musicPlays = 0;
            let totalDurationSec = 0;

            let transcodeRecord = 0;
            let directPlayRecord = 0;
            let directStreamRecord = 0;

            const concurrent = stats.find(s => s.stat_id === 'most_concurrent');
            if (concurrent && concurrent.rows) {
                const c = concurrent.rows.find(r => r.title === 'Concurrent Streams');
                if (c) streamsRecord = c.count;

                const tr = concurrent.rows.find(r => r.title === 'Concurrent Transcodes');
                if (tr) transcodeRecord = tr.count;

                const dp = concurrent.rows.find(r => r.title === 'Concurrent Direct Plays');
                if (dp) directPlayRecord = dp.count;

                const ds = concurrent.rows.find(r => r.title === 'Concurrent Direct Streams');
                if (ds) directStreamRecord = ds.count;
            }

            const libraries = stats.find(s => s.stat_id === 'top_libraries');
            if (libraries && libraries.rows) {
                libraries.rows.forEach(lib => {
                    totalPlays += lib.total_plays || 0;
                    totalDurationSec += lib.total_duration || 0;

                    if (lib.section_type === 'show') tvPlays += lib.total_plays || 0;
                    else if (lib.section_type === 'movie') moviePlays += lib.total_plays || 0;
                    else if (lib.section_type === 'artist') musicPlays += lib.total_plays || 0;
                });
            }

            if (totalDurationSec > 0) {
                const days = Math.floor(totalDurationSec / 86400);
                const hrs = Math.floor((totalDurationSec % 86400) / 3600);
                if (days > 0) totalTimeStr = `${days} days, ${hrs} hrs`;
                else totalTimeStr = `${hrs} hrs`;
            }

            return res.json({ streamsRecord, transcodeRecord, directPlayRecord, directStreamRecord, totalPlays, tvPlays, moviePlays, musicPlays, totalTimeStr });
        }
        res.status(500).json({ error: 'Invalid response from Tautulli' });
    } catch (e) {
        log(`Tautulli Error: ${e.message}`);
        res.status(500).json({ error: 'Failed to connect to Tautulli' });
    }
});

app.get('/api/tautulli/graphs', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, null);
        if (!config || !config.tautulliUrl || !config.tautulliApiKey) {
            return res.status(404).json({ error: 'Tautulli is not configured.' });
        }
        const tUrl = resolveIntegrationUrlForFetch(config.tautulliUrl);
        const days = req.query.days || 30;
        const yAxis = req.query.y_axis || 'plays';

        const endpoints = [
            'get_plays_by_date',
            'get_plays_by_dayofweek',
            'get_plays_by_hourofday',
            'get_plays_by_stream_type',
            'get_plays_by_stream_resolution',
            'get_plays_by_top_10_platforms',
            'get_concurrent_streams_by_stream_type',
            'get_plays_by_source_resolution',
            'get_plays_by_top_10_users'
        ];
        const results = await Promise.all(
            endpoints.map(cmd => {
                let url = `${tUrl}/api/v2?apikey=${config.tautulliApiKey}&cmd=${cmd}&time_range=${days}`;
                if (cmd !== 'get_concurrent_streams_by_stream_type') {
                    url += `&y_axis=${yAxis}`;
                }
                return fetch(url, { headers: { 'Accept': 'application/json' } })
                    .then(r => r.json())
                    .then(j => ({ cmd, data: j?.response?.data || {} }))
                    .catch(e => ({ cmd, data: {} }));
            })
        );

        const payload = {};
        results.forEach(r => {
            payload[r.cmd] = r.data;
        });
        const shouldObfuscateUsernames = shouldObfuscateAnalyticsViewers(req.user, config);
        if (shouldObfuscateUsernames && payload.get_plays_by_top_10_users && Array.isArray(payload.get_plays_by_top_10_users.series)) {
            payload.get_plays_by_top_10_users.series = payload.get_plays_by_top_10_users.series.map((series, index) => ({
                ...series,
                name: `Viewer ${index + 1}`
            }));
        }

        return res.json(payload);
    } catch (e) {
        log(`Tautulli Graphs Error: ${e.message}`);
        res.status(500).json({ error: 'Failed to fetch graphs from Tautulli' });
    }
});

const toNumber = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

const calculateDelta = (current, previous) => {
    const currentVal = toNumber(current, 0);
    const previousVal = Math.max(0, toNumber(previous, 0));
    const absolute = currentVal - previousVal;
    const percent = previousVal > 0 ? Number(((absolute / previousVal) * 100).toFixed(1)) : null;
    return { current: currentVal, previous: previousVal, absolute, percent };
};

const sumLibraryPlays = (libraries = []) => (libraries || []).reduce((sum, lib) => sum + toNumber(lib.plays, 0), 0);

const normalizeAnalyticsDaysForJellystat = (days) => {
    if (String(days) === 'all') return 36500;
    return Math.min(Math.max(parseInt(days, 10) || 30, 1), 36500);
};

const jellyfinAnalyticsProviderLabel = (provider) => (
    String(provider || '').toLowerCase() === 'jellyglance' ? 'JellyGlance' : 'Jellystat'
);

const resolveJellyfinAnalyticsProviderConfig = (config = {}) => {
    const provider = normalizeJellyfinAnalyticsProvider(config.jellyfinAnalyticsProvider, config);
    return {
        provider,
        label: jellyfinAnalyticsProviderLabel(provider),
        url: provider === 'jellyglance' ? config.jellyglanceUrl : config.jellystatUrl,
        apiKey: provider === 'jellyglance' ? config.jellyglanceApiKey : config.jellystatApiKey,
    };
};

const jellystatHeaders = (apiKey) => ({
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'x-api-token': apiKey,
});

const fetchJellystatJson = async (config, endpoint, { method = 'GET', body = null, query = null } = {}) => {
    const analytics = resolveJellyfinAnalyticsProviderConfig(config);
    if (!analytics.url || !analytics.apiKey) {
        throw new Error(`${analytics.label} is not configured`);
    }
    const baseUrl = resolveIntegrationUrlForFetch(analytics.url);
    const params = query ? `?${new URLSearchParams(query).toString()}` : '';
    const response = await fetchWithTimeout(`${baseUrl}${endpoint}${params}`, {
        method,
        headers: jellystatHeaders(analytics.apiKey),
        ...(body ? { body: JSON.stringify(body) } : {}),
    }, 15000);
    if (!response.ok) throw new Error(`${analytics.label} returned HTTP ${response.status} for ${endpoint}`);
    return response.json().catch(() => null);
};

const sumJellystatRowCounts = (row = {}) => Object.entries(row)
    .filter(([key]) => key !== 'Key')
    .reduce((sum, [, value]) => sum + toNumber(value?.count, 0), 0);

const normalizeJellystatDateKey = (value) => {
    if (!value) return null;
    const raw = String(value);
    const direct = raw.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (direct) return direct;
    const date = new Date(`${raw} 00:00:00`);
    if (Number.isNaN(date.getTime())) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const buildJellystatHeatmap = (rows = []) => {
    const heatmap = {};
    (Array.isArray(rows) ? rows : rows?.stats || []).forEach((row) => {
        const date = normalizeJellystatDateKey(row?.Key || row?.Date || row?.date || row?.day || row?.Day);
        if (!date) return;
        const count = toNumber(row?.Count ?? row?.count ?? row?.Plays ?? row?.plays, sumJellystatRowCounts(row));
        if (count > 0) heatmap[date] = (heatmap[date] || 0) + count;
    });
    return heatmap;
};

const buildJellystatLibraryHealth = (topLibraries = [], overview = [], metadata = [], libraryTypeTotals = {}) => {
    const metadataById = new Map((Array.isArray(metadata) ? metadata : []).map((item) => [String(item.Id), item]));
    const libraries = Array.isArray(overview) ? overview : [];
    const totalCatalogBytes = libraries.reduce((sum, lib) => sum + toNumber(metadataById.get(String(lib.Id))?.Size, 0), 0);
    const movies = libraries
        .filter((lib) => String(lib.CollectionType || '').toLowerCase() === 'movies')
        .reduce((sum, lib) => sum + toNumber(lib.Library_Count, 0), 0);
    const shows = libraries
        .filter((lib) => String(lib.CollectionType || '').toLowerCase() === 'tvshows')
        .reduce((sum, lib) => sum + toNumber(lib.Library_Count, 0), 0);
    const episodes = libraries.reduce((sum, lib) => sum + toNumber(lib.Episode_Count, 0), 0);
    const libraryPlays = sumLibraryPlays(topLibraries);
    const leadingLibraryPlays = toNumber(topLibraries?.[0]?.plays, 0);
    const concentrationPct = libraryPlays > 0 ? Number(((leadingLibraryPlays / libraryPlays) * 100).toFixed(1)) : 0;
    const activeLibraries = topLibraries.filter((lib) => toNumber(lib.plays, 0) > 0).length;
    const watchedItemsEstimate = toNumber(libraryTypeTotals.Movie, 0) + toNumber(libraryTypeTotals.Series, 0) + toNumber(libraryTypeTotals.Audio, 0);
    const totalPlayableItems = movies + episodes;
    const catalogWatchedPct = totalPlayableItems > 0 ? Number(((watchedItemsEstimate / totalPlayableItems) * 100).toFixed(1)) : 0;
    let healthLabel = 'Concentrated';
    if (activeLibraries >= 5 && concentrationPct <= 55) healthLabel = 'Balanced';
    if (activeLibraries >= 8 && concentrationPct <= 40) healthLabel = 'Excellent';

    return {
        activeLibraries,
        concentrationPct,
        totalCatalogItems: movies + shows,
        totalCatalogBytes,
        sizeGB: Number((totalCatalogBytes / (1024 * 1024 * 1024)).toFixed(1)),
        fourKPercent: 0,
        healthLabel,
        catalogWatchedPct,
        movies,
        shows,
        episodes,
        artists: 0,
        albums: 0,
        tracks: 0,
    };
};

const mapJellystatContent = (config, items = [], type = 'movie') => (Array.isArray(items) ? items : []).slice(0, 10).map((item) => ({
    key: item.Id || item.Name,
    title: item.Name || 'Untitled',
    type,
    thumb: hasJellyfinPrimaryImage(item) ? (item.PrimaryImageItemId || item.Id || null) : null,
    thumbUrl: hasJellyfinPrimaryImage(item) && item.Id ? jellyfinImageUrlForItem(item.PrimaryImageItemId || item.Id, 300, 450) : '',
    plays: toNumber(item.Plays ?? item.times_played ?? item.unique_viewers, 0),
    plexUrl: jellyfinItemUrl(config, item.Id),
}));

const aggregateAnalyticsWindow = (historyItems, { afterTs = 0, beforeTs = null }, ctx, { includePortalUsers = false } = {}) => {
    const { accountsMap, sectionsMap, devicesMap, users, config } = ctx;
    const userCounts = {};
    const libraryCounts = {};
    const contentCountsMovies = {};
    const contentCountsShows = {};
    const contentCountsMusic = {};
    const deviceCounts = {};
    const peakHours = new Array(24).fill(0);
    let totalPlaybacks = 0;

    historyItems.forEach(item => {
        if (afterTs > 0 && item.viewedAt != null && item.viewedAt < afterTs) return;
        if (beforeTs != null && item.viewedAt != null && item.viewedAt >= beforeTs) return;
        if (afterTs > 0 && item.viewedAt == null) return;

        totalPlaybacks++;

        if (item.viewedAt) {
            const hour = new Date(item.viewedAt * 1000).getHours();
            peakHours[hour]++;
        }

        let deviceName = 'Unknown Platform';
        if (item.deviceID && devicesMap[item.deviceID]) deviceName = devicesMap[item.deviceID];
        else if (item.Player && item.Player.product) deviceName = item.Player.product;
        else if (item.client) deviceName = item.client;

        if (!deviceCounts[deviceName]) deviceCounts[deviceName] = { name: deviceName, plays: 0 };
        deviceCounts[deviceName].plays++;

        if (item.accountID) {
            const userFromDb = users.find(u => u.id === String(item.accountID));
            const accountFromPlex = accountsMap[item.accountID];
            let username = `User ${item.accountID}`;
            let thumb = null;

            if (userFromDb) {
                username = userFromDb.username;
                thumb = userFromDb.thumb;
            } else if (accountFromPlex) {
                username = accountFromPlex.name;
                thumb = accountFromPlex.thumb;
            }

            if (!userCounts[item.accountID]) userCounts[item.accountID] = { id: item.accountID, username, thumb, plays: 0 };
            userCounts[item.accountID].plays++;
        }

        if (item.librarySectionID) {
            const libTitle = sectionsMap[item.librarySectionID] || `Library ${item.librarySectionID}`;
            if (!libraryCounts[item.librarySectionID]) libraryCounts[item.librarySectionID] = { id: item.librarySectionID, title: libTitle, plays: 0 };
            libraryCounts[item.librarySectionID].plays++;
        }

        const contentKey = item.type === 'episode' ? (item.grandparentKey || item.parentKey || item.ratingKey) : item.type === 'track' ? (item.parentKey || item.grandparentKey || item.ratingKey) : item.ratingKey;
        const contentTitle = item.type === 'episode' ? (item.grandparentTitle || item.parentTitle || item.title) : item.type === 'track' ? (item.parentTitle || item.grandparentTitle || item.title) : item.title;
        const contentThumb = item.type === 'episode' ? (item.grandparentThumb || item.parentThumb || item.thumb) : item.type === 'track' ? (item.parentThumb || item.grandparentThumb || item.thumb) : item.thumb;
        if (contentKey) {
            let targetDict = null;
            if (item.type === 'movie') targetDict = contentCountsMovies;
            else if (item.type === 'episode') targetDict = contentCountsShows;
            else if (item.type === 'track') targetDict = contentCountsMusic;
            else targetDict = contentCountsMovies;

            if (!targetDict[contentKey]) {
                targetDict[contentKey] = {
                    key: contentKey,
                    title: contentTitle,
                    type: item.type === 'episode' ? 'show' : item.type === 'track' ? 'track' : item.type,
                    thumb: contentThumb,
                    plays: 0,
                    viewers: {},
                    plexUrl: `https://app.plex.tv/desktop/#!/server/${config.serverIdentifier}/details?key=${encodeURIComponent('/library/metadata/' + contentKey.split('/').pop())}`
                };
            }
            targetDict[contentKey].plays++;
            
            if (item.accountID && userCounts[item.accountID]) {
                const u = userCounts[item.accountID];
                if (!targetDict[contentKey].viewers[item.accountID]) {
                    targetDict[contentKey].viewers[item.accountID] = {
                        username: u.username,
                        thumb: u.thumb,
                        plays: 0
                    };
                }
                targetDict[contentKey].viewers[item.accountID].plays++;
            }
        }
    });

    if (includePortalUsers) {
        users.forEach((u) => {
            if (!u || !u.id) return;
            if (!userCounts[u.id]) {
                userCounts[u.id] = {
                    id: String(u.id),
                    username: u.username || `User ${u.id}`,
                    thumb: u.thumb || null,
                    plays: 0
                };
            }
        });
    }

    return {
        totalPlaybacks,
        peakHours,
        topUsers: Object.values(userCounts).sort((a, b) => b.plays - a.plays),
        topLibraries: Object.values(libraryCounts).sort((a, b) => b.plays - a.plays).slice(0, 10),
        topDevices: Object.values(deviceCounts).sort((a, b) => b.plays - a.plays).slice(0, 10),
        contentCountsMovies,
        contentCountsShows,
        contentCountsMusic
    };
};

const summarizeLibraryHealth = (topLibraries = [], stats = {}, cachedData = {}) => {
    const libraryPlays = (topLibraries || []).reduce((sum, lib) => sum + toNumber(lib.plays, 0), 0);
    const leadingLibraryPlays = toNumber(topLibraries?.[0]?.plays, 0);
    const concentrationPct = libraryPlays > 0 ? Number(((leadingLibraryPlays / libraryPlays) * 100).toFixed(1)) : 0;
    const activeLibraries = (topLibraries || []).filter(lib => toNumber(lib.plays, 0) > 0).length;
    const totalCatalogItems = toNumber(stats.movies) + toNumber(stats.shows) + toNumber(stats.music);
    const totalCatalogBytes = toNumber(stats.moviesBytes) + toNumber(stats.showsBytes) + toNumber(stats.musicBytes);
    const sizeGB = Number((totalCatalogBytes / (1024 * 1024 * 1024)).toFixed(1));
    const fourKPercent = toNumber(stats.fourKPercent, 0);

    const uniqueWatchedItems = Object.keys(cachedData.contentCountsMovies || {}).length + 
                               Object.keys(cachedData.contentCountsShows || {}).length + 
                               Object.keys(cachedData.contentCountsMusic || {}).length;
    const totalPlayableItems = toNumber(stats.movies) + toNumber(stats.episodes) + toNumber(stats.tracks);
    const catalogWatchedPct = totalPlayableItems > 0 ? Number(((uniqueWatchedItems / totalPlayableItems) * 100).toFixed(1)) : 0;

    let healthLabel = 'Concentrated';
    if (activeLibraries >= 5 && concentrationPct <= 55 && fourKPercent >= 20) {
        healthLabel = 'Excellent';
    } else if (activeLibraries >= 3 && concentrationPct <= 70) {
        healthLabel = 'Balanced';
    }

    return {
        activeLibraries,
        concentrationPct,
        totalCatalogItems,
        totalCatalogBytes,
        sizeGB,
        fourKPercent,
        healthLabel,
        catalogWatchedPct,
        movies: toNumber(stats.movies, 0),
        shows: toNumber(stats.shows, 0),
        episodes: toNumber(stats.episodes, 0),
        artists: toNumber(stats.artists || stats.music, 0),
        albums: toNumber(stats.albums, 0),
        tracks: toNumber(stats.tracks, 0),
        deltas: stats.deltas || {},
        resolutions: stats.resolutions || null,
        codecs: stats.codecs || null,
        fileSizes: stats.fileSizes || null
    };
};

const getUniqueActiveViewers = (users = []) => (users || []).filter(u => toNumber(u.plays, 0) > 0).length;

const buildDayOfWeekCountsFromHeatmap = (heatmapData = {}) => {
    const counts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    Object.entries(heatmapData || {}).forEach(([dateKey, count]) => {
        const date = new Date(`${dateKey}T00:00:00`);
        if (Number.isNaN(date.getTime())) return;
        counts[date.getDay()] += toNumber(count, 0);
    });
    return counts;
};

const buildJellyfinLeaderboardContext = (topUsers = [], sessionUser = {}, shouldObfuscate = false) => {
    const normalizedJellyfinId = normalized(sessionUser?.jellyfinId);
    const normalizedSessionId = normalized(String(sessionUser?.id || '').replace(/^jellyfin:/i, ''));
    const normalizedUsername = normalized(sessionUser?.username);
    const sortedUsers = (Array.isArray(topUsers) ? topUsers : [])
        .filter((user) => toNumber(user?.plays, 0) > 0)
        .sort((a, b) => toNumber(b.plays, 0) - toNumber(a.plays, 0));
    const userIndex = sortedUsers.findIndex((user) => {
        const candidateId = normalized(String(user?.id || '').replace(/^jellyfin:/i, ''));
        const candidateName = normalized(user?.username);
        return (normalizedJellyfinId && candidateId === normalizedJellyfinId)
            || (normalizedSessionId && candidateId === normalizedSessionId)
            || (normalizedUsername && candidateName === normalizedUsername);
    });

    const leaderboardRank = userIndex >= 0 ? userIndex + 1 : null;
    const userEntry = leaderboardRank ? sortedUsers[userIndex] : null;
    const start = leaderboardRank ? Math.max(0, userIndex - 2) : 0;
    const end = leaderboardRank ? Math.min(sortedUsers.length - 1, userIndex + 2) : -1;
    const leaderboardNeighbourhood = leaderboardRank
        ? sortedUsers.slice(start, end + 1).map((user, index) => {
            const rank = start + index + 1;
            const isMe = rank === leaderboardRank;
            return {
                rank,
                plays: toNumber(user.plays, 0),
                isMe,
                username: shouldObfuscate && !isMe ? `Viewer ${rank}` : (isMe ? 'You' : (user.username || `User ${rank}`)),
            };
        })
        : [];

    return {
        leaderboardRank,
        totalActiveUsers: sortedUsers.length,
        myPlaysOnLeaderboard: userEntry ? toNumber(userEntry.plays, 0) : null,
        leaderboardNeighbourhood,
    };
};

app.get('/api/jellystat/analytics', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        if (!isJellyfinConfigured(config)) {
            return res.status(503).json({ error: 'Jellyfin not configured' });
        }
        const analyticsProvider = resolveJellyfinAnalyticsProviderConfig(config);
        if (!analyticsProvider.url || !analyticsProvider.apiKey) {
            return res.status(503).json({ error: `${analyticsProvider.label} is not configured` });
        }

        const requestedDays = req.query.days || 30;
        const days = normalizeAnalyticsDaysForJellystat(requestedDays);
        const postBody = { days };
        const [
            libraryTypeTotals,
            viewsByHour,
            libraryOverview,
            libraryMetadata,
            mostViewedLibraries,
            mostActiveUsers,
            mostUsedClients,
            mostViewedMovies,
            mostViewedShows,
            mostViewedMusic,
            playbackMethods,
            dailyViews,
        ] = await Promise.all([
            fetchJellystatJson(config, '/stats/getViewsByLibraryType', { query: { days } }).catch((e) => { log(e.message); return {}; }),
            fetchJellystatJson(config, '/stats/getViewsByHour', { query: { days } }).catch((e) => { log(e.message); return {}; }),
            fetchJellystatJson(config, '/stats/getLibraryOverview', { query: { days } }).catch((e) => { log(e.message); return []; }),
            fetchJellystatJson(config, '/stats/getLibraryMetadata').catch((e) => { log(e.message); return []; }),
            fetchJellystatJson(config, '/stats/getMostViewedLibraries', { method: 'POST', body: postBody }).catch((e) => { log(e.message); return []; }),
            fetchJellystatJson(config, '/stats/getMostActiveUsers', { method: 'POST', body: postBody }).catch((e) => { log(e.message); return []; }),
            fetchJellystatJson(config, '/stats/getMostUsedClient', { method: 'POST', body: postBody }).catch((e) => { log(e.message); return []; }),
            fetchJellystatJson(config, '/stats/getMostViewedByType', { method: 'POST', body: { ...postBody, type: 'Movie' } }).catch((e) => { log(e.message); return []; }),
            fetchJellystatJson(config, '/stats/getMostViewedByType', { method: 'POST', body: { ...postBody, type: 'Series' } }).catch((e) => { log(e.message); return []; }),
            fetchJellystatJson(config, '/stats/getMostViewedByType', { method: 'POST', body: { ...postBody, type: 'Audio' } }).catch((e) => { log(e.message); return []; }),
            fetchJellystatJson(config, '/stats/getPlaybackMethodStats', { method: 'POST', body: postBody }).catch((e) => { log(e.message); return []; }),
            fetchJellystatJson(config, '/stats/getViewsOverTime', { query: { days: Math.min(days, 365) } }).catch((e) => { log(e.message); return []; }),
        ]);

        const peakHours = new Array(24).fill(0);
        if (Array.isArray(viewsByHour?.stats)) {
            viewsByHour.stats.forEach((row) => {
                const hour = parseInt(row.Key, 10);
                if (hour >= 0 && hour < 24) peakHours[hour] = sumJellystatRowCounts(row);
            });
        }

        const shouldObfuscateUsernames = shouldObfuscateAnalyticsViewers(req.user, config);
        const rawTopUsers = (Array.isArray(mostActiveUsers) ? mostActiveUsers : []).map((user, index) => ({
            id: user.UserId || user.Id || user.Name || `user-${index}`,
            username: user.Name || user.UserName || `User ${index + 1}`,
            thumb: user.UserId ? withBasePath(`/api/jellyfin/user-image?userId=${encodeURIComponent(user.UserId)}`) : null,
            plays: toNumber(user.Plays ?? user.TotalPlays, 0),
        })).sort((a, b) => b.plays - a.plays);
        const topUsers = rawTopUsers.map((user, index) => obfuscateAnalyticsTopUser(user, index, shouldObfuscateUsernames));
        const leaderboardContext = buildJellyfinLeaderboardContext(rawTopUsers, req.user, shouldObfuscateUsernames);

        const topLibraries = (Array.isArray(mostViewedLibraries) ? mostViewedLibraries : []).map((library, index) => ({
            id: library.Id || library.Name || `library-${index}`,
            title: library.Name || `Library ${index + 1}`,
            plays: toNumber(library.Plays ?? library.Count, 0),
        })).sort((a, b) => b.plays - a.plays).slice(0, 10);

        const topDevices = (Array.isArray(mostUsedClients) ? mostUsedClients : []).map((device, index) => ({
            name: device.Client || device.Name || `Client ${index + 1}`,
            plays: toNumber(device.Plays ?? device.Count, 0),
        })).sort((a, b) => b.plays - a.plays).slice(0, 10);

        const playbackCounts = {};
        (Array.isArray(playbackMethods) ? playbackMethods : []).forEach((method) => {
            playbackCounts[String(method.Name || '').toLowerCase()] = Math.max(playbackCounts[String(method.Name || '').toLowerCase()] || 0, toNumber(method.Count, 0));
        });
        const activeStreams = await (async () => {
            try {
                const baseUrl = resolveIntegrationUrlForFetch(config.jellyfinUrl);
                const sessions = await fetchWithTimeout(`${baseUrl}/Sessions`, { headers: jellyfinHeaders(config.jellyfinApiKey) }, 10000)
                    .then((r) => (r.ok ? r.json() : []))
                    .catch(() => []);
                return (Array.isArray(sessions) ? sessions : []).filter((session) => session?.NowPlayingItem).length;
            } catch {
                return 0;
            }
        })();

        const libraryTypePlayTotal = Object.values(libraryTypeTotals || {}).reduce((sum, value) => sum + toNumber(value, 0), 0);
        const contentTypePlayTotal = ['Series', 'Movie', 'Audio'].reduce((sum, key) => sum + toNumber(libraryTypeTotals?.[key], 0), 0);
        const totalPlaybacks = libraryTypePlayTotal || contentTypePlayTotal || sumLibraryPlays(topLibraries);
        const libraryHealth = buildJellystatLibraryHealth(topLibraries, libraryOverview, libraryMetadata, libraryTypeTotals);
        const heatmapData = buildJellystatHeatmap(dailyViews);

        res.json({
            topUsers,
            topLibraries,
            topMovies: mapJellystatContent(config, mostViewedMovies, 'movie'),
            topShows: mapJellystatContent(config, mostViewedShows, 'show'),
            topMusic: mapJellystatContent(config, mostViewedMusic, 'track'),
            topDevices,
            peakHours,
            totalPlaybacks,
            maxConcurrentStreams: 0,
            maxDirectPlays: toNumber(playbackCounts.directplay, 0),
            maxTranscodes: toNumber(playbackCounts.transcode, 0),
            compare: null,
            libraryHealth,
            heatmapData,
            dayOfWeekCounts: buildDayOfWeekCountsFromHeatmap(heatmapData),
            ...leaderboardContext,
            requestedPeriodDays: requestedDays,
            cachePeriodDays: requestedDays,
            cacheFallback: false,
            source: analyticsProvider.provider,
            jellystatInsights: {
                activeStreams,
                streamsRecord: null,
                transcodeRecord: toNumber(playbackCounts.transcode, 0),
                directPlayRecord: toNumber(playbackCounts.directplay, 0),
                directStreamRecord: toNumber(playbackCounts.directstream, 0),
                playbackMethodStatsAreTotals: true,
                totalPlays: totalPlaybacks,
                tvPlays: toNumber(libraryTypeTotals.Series, 0),
                moviePlays: toNumber(libraryTypeTotals.Movie, 0),
                musicPlays: toNumber(libraryTypeTotals.Audio, 0),
                totalTimeStr: '',
            },
        });
    } catch (e) {
        log(`Jellyfin analytics error: ${e.message}`);
        res.status(500).json({ error: 'Failed to fetch Jellyfin analytics' });
    }
});

/** Normalize Plex history keys so `/library/metadata/123` and `123` count as the same title. */
const normalizePlexHistoryContentKey = (rawKey) => {
    if (rawKey == null || rawKey === '') return null;
    const value = String(rawKey).trim();
    if (!value) return null;
    if (value.startsWith('/library/metadata/')) return value;
    const tail = value.includes('/') ? value.split('/').pop() : value;
    if (tail && /^\d+$/.test(tail)) return `/library/metadata/${tail}`;
    return value;
};

const fetchPlexAccountHistory = async (uri, config, accountID, { maxItems = 250000 } = {}) => {
    const pageSize = 5000;
    let historyItems = [];
    let start = 0;

    while (start < maxItems) {
        const pageRes = await fetch(
            `${uri}/status/sessions/history/all?accountID=${accountID}&X-Plex-Token=${config.plexToken}&sort=viewedAt:desc&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${pageSize}`,
            { headers: plexClientHeaders(config.plexToken) },
        ).then((r) => r.json()).catch(() => null);

        const pageContainer = pageRes?.MediaContainer;
        const pageItems = Array.isArray(pageContainer?.Metadata) ? pageContainer.Metadata : [];
        if (pageItems.length === 0) break;

        historyItems = historyItems.concat(pageItems);
        start += pageItems.length;

        const totalSize = Number(pageContainer.totalSize || 0);
        if ((totalSize > 0 && start >= totalSize) || pageItems.length < pageSize) break;
    }

    if (historyItems.length >= maxItems) {
        log(`Personal analytics history fetch reached safety cap (${maxItems}) for account ${accountID}.`);
    }

    return historyItems;
};

app.get('/api/plex/analytics', requireAuth, requireMember, async (req, res) => {
    try {
        const statsData = await loadFile(ANALYTICS_CACHE_PATH, {});
        const reqDays = req.query.days || 30;
        const hasRequestedPeriod = statsData[reqDays] != null;
        const cachedPeriod = hasRequestedPeriod ? reqDays : (statsData[30] != null ? 30 : null);
        const cachedData = statsData[reqDays] || statsData[30] || { topUsers: [], topLibraries: [], topMovies: [], topShows: [], topMusic: [], topDevices: [], peakHours: new Array(24).fill(0), totalPlaybacks: 0 };
        
        const config = await loadFile(CONFIG_PATH, {});
        const shouldObfuscateUsernames = shouldObfuscateAnalyticsViewers(req.user, config);
        const topUsers = (cachedData.topUsers || []).map((user, index) => obfuscateAnalyticsTopUser({
            ...user,
            username: user.username || `User ${index + 1}`,
        }, index, shouldObfuscateUsernames));
        const data = {
            ...cachedData,
            topUsers,
            requestedPeriodDays: reqDays,
            cachePeriodDays: cachedPeriod,
            cacheFallback: cachedPeriod != null && String(cachedPeriod) !== String(reqDays),
        };
        
        // attach max stats dynamically
        const stats = await loadFile(PLEX_STATS_CACHE_PATH, {});
        if (stats.episodes === undefined || stats.resolutions === undefined) {
            buildPlexStatsCache().catch(() => {});
        }
        data.maxConcurrentStreams = stats.maxConcurrentStreams || 0;
        data.maxDirectPlays = stats.maxDirectPlays || 0;
        data.maxTranscodes = stats.maxTranscodes || 0;
        data.libraryHealth = summarizeLibraryHealth(data.topLibraries || [], stats, cachedData);

        const priorPeriod = cachedData.priorPeriod;
        if (priorPeriod && reqDays !== 'all') {
            const currentUniqueViewers = getUniqueActiveViewers(cachedData.topUsers || []);
            const priorUniqueViewers = getUniqueActiveViewers(priorPeriod.topUsers || []);
            const currentLibraryPlays = sumLibraryPlays(cachedData.topLibraries);
            const priorLibraryPlays = sumLibraryPlays(priorPeriod.topLibraries);

            data.compare = {
                previousPeriodDays: String(reqDays),
                totalPlaybacks: calculateDelta(toNumber(data.totalPlaybacks, 0), priorPeriod.totalPlaybacks),
                uniqueViewers: calculateDelta(currentUniqueViewers, priorUniqueViewers),
                libraryPlays: calculateDelta(currentLibraryPlays, priorLibraryPlays)
            };
        } else {
            data.compare = null;
        }

        res.json(data);
    } catch (e) {
        log(`Error fetching analytics: ${e.message}`);
        res.status(500).json({ error: 'Analytics error' });
    }
});

app.get('/api/plex/analytics/day', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const dateStr = req.query.date; // format YYYY-MM-DD
        if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            return res.status(400).json({ error: 'Valid date (YYYY-MM-DD) is required' });
        }

        const mediaServerType = String(config.mediaServerType || 'plex').toLowerCase();

        if (mediaServerType !== 'plex') {
            return res.status(501).json({ error: 'Specific date views are currently only supported for Plex/Tautulli' });
        } else {
            if (!config.tautulliUrl || !config.tautulliApiKey) {
                return res.status(503).json({ error: 'Tautulli not configured' });
            }
            const tUrl = resolveIntegrationUrlForFetch(config.tautulliUrl);
            const cmdUrl = `${tUrl}/api/v2?apikey=${config.tautulliApiKey}&cmd=get_history&start_date=${dateStr}&length=100000`;
            const resp = await fetch(cmdUrl, { headers: { 'Accept': 'application/json' }});
            const json = await resp.json();
            const items = json?.response?.data?.data || [];
            
            const hours = new Array(24).fill(0);
            items.forEach(item => {
                const ts = item.started * 1000;
                const d = new Date(ts);
                const yyyy = d.getFullYear();
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                if (`${yyyy}-${mm}-${dd}` === dateStr) {
                    hours[d.getHours()]++;
                }
            });
            return res.json(hours);
        }
    } catch (e) {
        log(`Error fetching daily analytics: ${e.message}`);
        res.status(500).json({ error: 'Analytics error' });
    }
});

app.get('/api/plex/analytics/me', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, null);
        if (!config || !config.plexToken || !config.serverIdentifier) return res.status(503).json({ error: 'Plex not configured' });

        const uri = await getPlexConnectionUri(config);
        if (!uri) return res.status(503).json({ error: 'Cannot connect to Plex' });

        req.user.isAdmin = await resolveCurrentAdmin(req.user, config);
        const accountID = await resolveLocalPlexAccountId(config, uri, req.user);

        if (!accountID) {
            return res.json({ totalPlays: 0, topLibraries: [], topWatched: [], topMusic: [], recentHistory: [] });
        }

        const historyItems = await fetchPlexAccountHistory(uri, config, accountID);
        const sectionsRes = await fetch(`${uri}/library/sections?X-Plex-Token=${config.plexToken}`, { headers: plexClientHeaders(config.plexToken) }).then(r => r.json()).catch(() => null);

        if (!historyItems.length) {
            return res.json({ totalPlays: 0, topLibraries: [], topWatched: [], topMusic: [], recentHistory: [] });
        }

        const sectionsMap = {};
        if (sectionsRes && sectionsRes.MediaContainer && sectionsRes.MediaContainer.Directory) {
            sectionsRes.MediaContainer.Directory.forEach(s => sectionsMap[s.key] = s.title);
        }

        let cutoffDate = 0;
        if (req.query.days && req.query.days !== 'all') {
            const days = parseInt(req.query.days, 10) || 30;
            cutoffDate = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);
        } else if (!req.query.days) {
            cutoffDate = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
        }

        let totalPlays = 0;
        const libraryCounts = {};
        const contentCounts = {};

        const mapHistoryToRecent = (item) => ({
            title: item.type === 'episode' ? (item.grandparentTitle || item.parentTitle || item.title) : item.type === 'track' ? (item.parentTitle || item.grandparentTitle || item.title) : item.title,
            episodeTitle: item.type === 'episode' || item.type === 'track' ? item.title : null,
            viewedAt: item.viewedAt,
            thumb: item.type === 'episode' ? (item.grandparentThumb || item.parentThumb || item.thumb) : item.type === 'track' ? (item.parentThumb || item.grandparentThumb || item.thumb) : item.thumb,
            type: item.type,
            plexUrl: `https://app.plex.tv/desktop/#!/server/${config.serverIdentifier}/details?key=${encodeURIComponent(item.key)}`
        });
        const recentHistory = historyItems.slice(0, 50).map(mapHistoryToRecent);

        let plexTotalHourOfDay = 0;
        let plexHourCount = 0;
        const plexHourDistribution = new Array(24).fill(0);
        let totalHourOfDay = 0;
        let hourCount = 0;
        const hourDistribution = new Array(24).fill(0);

        const dayOfWeekCounts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
        let moviesCount = 0;
        let showsCount = 0;
        let musicCount = 0;

        const statsTimezone = await fetchTautulliTimezone(config);
        const { list: plexAccounts } = await fetchPlexServerAccounts(uri, config);
        const plexAccountName = plexAccounts.find((a) => String(a.id) === String(accountID))?.name || null;

        const heatmapData = {};
        const yearAgo = Math.floor(Date.now() / 1000) - (365 * 24 * 60 * 60);

        historyItems.forEach(item => {
            if (item.viewedAt >= yearAgo) {
                const dateStr = new Date(item.viewedAt * 1000).toISOString().split('T')[0];
                heatmapData[dateStr] = (heatmapData[dateStr] || 0) + 1;
            }

            if (cutoffDate > 0 && item.viewedAt < cutoffDate) return;
            totalPlays++;

            const hour = getHourInTimezone(item.viewedAt, statsTimezone);
            plexTotalHourOfDay += hour;
            plexHourCount++;
            plexHourDistribution[hour]++;
            dayOfWeekCounts[getWeekdayInTimezone(item.viewedAt, statsTimezone)]++;

            if (item.type === 'movie') moviesCount++;
            else if (item.type === 'episode') showsCount++;
            else if (item.type === 'track') musicCount++;

            if (item.librarySectionID) {
                const libTitle = sectionsMap[item.librarySectionID] || `Library ${item.librarySectionID}`;
                if (!libraryCounts[item.librarySectionID]) libraryCounts[item.librarySectionID] = { id: item.librarySectionID, title: libTitle, plays: 0 };
                libraryCounts[item.librarySectionID].plays++;
            }

            const rawContentKey = item.type === 'episode'
                ? (item.grandparentKey || item.grandparentRatingKey || item.parentKey || item.ratingKey)
                : item.type === 'track'
                    ? (item.parentKey || item.grandparentKey || item.ratingKey)
                    : (item.ratingKey || item.key);
            const contentKey = normalizePlexHistoryContentKey(rawContentKey);
            const contentTitle = item.type === 'episode' ? (item.grandparentTitle || item.parentTitle || item.title) : item.type === 'track' ? (item.parentTitle || item.grandparentTitle || item.title) : item.title;
            const contentThumb = item.type === 'episode' ? (item.grandparentThumb || item.parentThumb || item.thumb) : item.type === 'track' ? (item.parentThumb || item.grandparentThumb || item.thumb) : item.thumb;
            const contentArt = item.type === 'episode' ? (item.grandparentArt || item.parentArt || item.art) : item.type === 'track' ? (item.parentArt || item.grandparentArt || item.art) : item.art;

            if (contentKey) {
                if (!contentCounts[contentKey]) {
                    contentCounts[contentKey] = {
                        key: contentKey,
                        title: contentTitle,
                        type: item.type === 'episode' ? 'show' : item.type === 'track' ? 'track' : item.type,
                        thumb: contentThumb,
                        art: contentArt,
                        plays: 0,
                        lastViewedAt: 0,
                        plexUrl: `https://app.plex.tv/desktop/#!/server/${config.serverIdentifier}/details?key=${encodeURIComponent(contentKey)}`
                    };
                }
                contentCounts[contentKey].plays++;
                const viewedAt = Number(item.viewedAt) || 0;
                if (viewedAt >= (contentCounts[contentKey].lastViewedAt || 0)) {
                    contentCounts[contentKey].lastViewedAt = viewedAt;
                    // Keep title/artwork aligned with the most recent play of this title.
                    if (contentTitle) contentCounts[contentKey].title = contentTitle;
                    if (contentThumb) contentCounts[contentKey].thumb = contentThumb;
                    if (contentArt) contentCounts[contentKey].art = contentArt;
                }
            }
        });

        const allUsersMap = await loadFile(USERS_PATH, []);
        const targetDbUser = allUsersMap.find(u => String(u.plexAccountId) === String(accountID));

        const tautulliHourStats = await resolveTautulliHourStats(config, {
            username: targetDbUser?.username,
            email: targetDbUser?.email,
            plexAccountName,
            days: req.query.days || 30,
            afterUnixSec: cutoffDate,
            maxItems: historyItems.length,
            plexPlayCount: totalPlays,
        });
        if (tautulliHourStats?.hourCount > 0) {
            totalHourOfDay = tautulliHourStats.totalHourOfDay;
            hourCount = tautulliHourStats.hourCount;
            hourDistribution.splice(0, 24, ...tautulliHourStats.hourDistribution);
        } else {
            totalHourOfDay = plexTotalHourOfDay;
            hourCount = plexHourCount;
            hourDistribution.splice(0, 24, ...plexHourDistribution);
        }

        const sortByPlaysThenRecent = (a, b) => (b.plays - a.plays) || ((b.lastViewedAt || 0) - (a.lastViewedAt || 0));
        const allLibraries = Object.values(libraryCounts).sort((a, b) => b.plays - a.plays);
        const topLibraries = allLibraries.slice(0, 5);
        const topWatched = Object.values(contentCounts).filter(c => c.type !== 'track').sort(sortByPlaysThenRecent).slice(0, 30).map(c => {
            if (c.thumb) c.thumbUrl = plexImageUrl(c.thumb);
            return c;
        });
        const topMusic = Object.values(contentCounts).filter(c => c.type === 'track').sort(sortByPlaysThenRecent).slice(0, 30).map(c => {
            if (c.thumb) c.thumbUrl = plexImageUrl(c.thumb);
            return c;
        });

        const avgHour = hourCount > 0 ? (totalHourOfDay / hourCount) : null;
        const peakHour = resolvePeakHour(hourDistribution);
        const timeOfDay = resolveTimeOfDayPersona(peakHour);

        const allShowsList = Object.values(contentCounts).filter(c => c.type === 'show').sort(sortByPlaysThenRecent);
        let topShowsRaw = allShowsList.slice(0, 5);
        await Promise.all(topShowsRaw.map(async (s, i) => {
            if (!s.art || i === 0) {
                const metaPath = s.key.startsWith('/library/metadata/') ? s.key : `/library/metadata/${s.key}`;

                let data = plexMetadataCache.get(metaPath);
                if (!data) {
                    const metaRes = await fetch(`${uri}${metaPath}?X-Plex-Token=${config.plexToken}`, { headers: plexClientHeaders(config.plexToken) }).then(r => r.json()).catch(() => null);
                    if (metaRes && metaRes.MediaContainer && metaRes.MediaContainer.Metadata && metaRes.MediaContainer.Metadata[0]) {
                        data = metaRes.MediaContainer.Metadata[0];
                        plexMetadataCache.set(metaPath, data);
                    }
                }

                if (data) {
                    s.art = data.art || data.grandparentArt || data.parentArt || s.art;
                    if (i === 0) {
                        s.summary = data.summary || data.parentSummary || data.grandparentSummary;
                        s.year = data.year || data.parentYear || data.grandparentYear;
                    }
                }
            }
        }));
        const topShows = topShowsRaw.map(s => ({
            ...s,
            artUrl: s.art ? plexImageUrl(s.art) : (s.thumb ? plexImageUrl(s.thumb) : null),
            thumbUrl: s.thumb ? plexImageUrl(s.thumb) : null,
        }));
        const topBinge = topShows.length > 0 ? topShows[0] : null;

        const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        let maxDayIndex = 0;
        let maxDayCount = 0;
        for (let i = 0; i < 7; i++) {
            if (dayOfWeekCounts[i] > maxDayCount) {
                maxDayCount = dayOfWeekCounts[i];
                maxDayIndex = i;
            }
        }
        const popularDay = maxDayCount > 0 ? daysOfWeek[maxDayIndex] : 'Unknown';

        const favoriteLibrary = topLibraries.length > 0 ? topLibraries[0].title : 'None';

        let mediaPreference = 'Mixed Bag';
        const totalPrefCount = moviesCount + showsCount + musicCount;
        if (totalPrefCount > 0) {
            if (moviesCount / totalPrefCount >= 0.6) mediaPreference = 'Movie Buff';
            else if (showsCount / totalPrefCount >= 0.6) mediaPreference = 'TV Show Binger';
            else if (musicCount / totalPrefCount >= 0.6) mediaPreference = 'Music Lover';
        }

        const allMoviesList = Object.values(contentCounts).filter(c => c.type === 'movie').sort(sortByPlaysThenRecent);
        let topMoviesRaw = allMoviesList.slice(0, 5);
        await Promise.all(topMoviesRaw.map(async (m, i) => {
            if (!m.art || i === 0) {
                const metaPath = m.key.startsWith('/library/metadata/') ? m.key : `/library/metadata/${m.key}`;

                let data = plexMetadataCache.get(metaPath);
                if (!data) {
                    const metaRes = await fetch(`${uri}${metaPath}?X-Plex-Token=${config.plexToken}`, { headers: plexClientHeaders(config.plexToken) }).then(r => r.json()).catch(() => null);
                    if (metaRes && metaRes.MediaContainer && metaRes.MediaContainer.Metadata && metaRes.MediaContainer.Metadata[0]) {
                        data = metaRes.MediaContainer.Metadata[0];
                        plexMetadataCache.set(metaPath, data);
                    }
                }

                if (data) {
                    m.art = data.art || data.grandparentArt || data.parentArt || m.art;
                    if (!m.thumb) m.thumb = data.thumb || m.thumb;
                    if (i === 0) {
                        m.summary = data.summary;
                        m.year = data.year;
                        m.tagline = data.tagline;
                    }
                }
            }
        }));
        const topMovies = topMoviesRaw.map(m => ({
            ...m,
            artUrl: m.art ? plexImageUrl(m.art) : (m.thumb ? plexImageUrl(m.thumb) : null),
            thumbUrl: m.thumb ? plexImageUrl(m.thumb) : null,
        }));
        const topMovie = topMovies.length > 0 ? topMovies[0] : null;

        let watchStyle = 'Explorer';
        const uniqueTitles = Object.keys(contentCounts).length;
        if (totalPlays > 0) {
            if (totalPlays / uniqueTitles > 3) watchStyle = 'Comfort Binger';
            else if (totalPlays / uniqueTitles > 1.5) watchStyle = 'Loyal Fan';
        }

        let streamingHabit = 'Balanced Streamer';
        const weekendPlays = dayOfWeekCounts[0] + dayOfWeekCounts[6];
        const weekdayPlays = totalPlays - weekendPlays;
        if (totalPlays > 0) {
            if (weekendPlays / totalPlays >= 0.5) streamingHabit = 'Weekend Warrior';
            else if (weekdayPlays / totalPlays >= 0.8) streamingHabit = 'Weekday Streamer';
        }

        const trendingStats = await loadFile(TRENDING_CACHE_PATH, {});

        let periodKey = '30';
        if (req.query.days === 'all') periodKey = 'all';
        else if (req.query.days) periodKey = req.query.days;

        const userEntry = trendingStats.leaderboards && trendingStats.leaderboards[periodKey] && accountID
            ? trendingStats.leaderboards[periodKey][accountID]
            : null;
        const leaderboardRank = userEntry ? (typeof userEntry === 'object' ? userEntry.rank : userEntry) : null;
        const myPlaysOnLeaderboard = userEntry ? (typeof userEntry === 'object' ? userEntry.plays : null) : null;
        const totalActiveUsers = trendingStats.totalActiveUsers && trendingStats.totalActiveUsers[periodKey]
            ? trendingStats.totalActiveUsers[periodKey]
            : 0;

        // Build a neighbourhood snapshot: the 2 users above and 2 below
        const users = await loadFile(USERS_PATH, []);
        const usernameMap = {};
        // Prefer live Plex account names so admins see real usernames even when
        // a viewer is not in the portal users file.
        (plexAccounts || []).forEach((account) => {
            if (account?.id == null) return;
            const name = String(account.name || '').trim();
            if (name) usernameMap[String(account.id)] = name;
        });
        users.forEach((u) => {
            if (!u.plexAccountId) return;
            const key = String(u.plexAccountId);
            usernameMap[key] = u.username || u.email || usernameMap[key] || 'Unknown';
        });

        const shouldObfuscateUsernames = shouldObfuscateAnalyticsViewers(req.user, config);
        let leaderboardNeighbourhood = [];
        const sortedBoard = trendingStats.leaderboardsSorted && trendingStats.leaderboardsSorted[periodKey] ? trendingStats.leaderboardsSorted[periodKey] : [];
        if (leaderboardRank && sortedBoard.length > 0) {
            const myIdx = leaderboardRank - 1;
            const start = Math.max(0, myIdx - 2);
            const end = Math.min(sortedBoard.length - 1, myIdx + 2);
            leaderboardNeighbourhood = sortedBoard.slice(start, end + 1).map((entry) => {
                const isMe = String(entry.accountId) === String(accountID);
                const realName = usernameMap[String(entry.accountId)] || `User ${entry.rank}`;
                return {
                    rank: entry.rank,
                    plays: entry.plays,
                    isMe,
                    username: shouldObfuscateUsernames && !isMe ? `Viewer ${entry.rank}` : realName,
                };
            });
        }

        res.json({
            totalPlays,
            topLibraries,
            topWatched,
            topMusic,
            topBinge,
            topMovie,
            topShows,
            topMovies,
            timeOfDay,
            popularDay,
            favoriteLibrary,
            mediaPreference,
            watchStyle,
            streamingHabit,
            leaderboardRank,
            totalActiveUsers,
            myPlaysOnLeaderboard,
            leaderboardNeighbourhood,
            moviesCount,
            showsCount,
            musicCount,
            weekendPlays,
            weekdayPlays,
            uniqueTitles,
            avgHour,
            peakHour,
            dayOfWeekCounts,
            hourDistribution,
            allLibraries,
            heatmapData,
            topShows,
            topMovies,
            recentHistory: recentHistory.map(h => {
                if (h.thumb) h.thumbUrl = plexImageUrl(h.thumb);
                return h;
            })
        });
    } catch (e) {
        log(`Error fetching personal analytics: ${e.message}`);
        res.status(500).json({ error: 'Analytics error' });
    }
});

app.get('/api/plex/analytics/user/:id/history', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, null);
        if (!config || !config.plexToken || !config.serverIdentifier) return res.status(503).json({ error: 'Plex not configured' });

        const uri = await getPlexConnectionUri(config);
        if (!uri) return res.status(503).json({ error: 'Cannot connect to Plex' });

        const accountID = req.params.id;
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 15;
        const search = (req.query.search || '').trim().toLowerCase();

        let historyData = [];
        let totalRecords = 0;

        let usedTautulli = false;
        if (config.tautulliUrl && config.tautulliApiKey) {
            const tUrl = resolveIntegrationUrlForFetch(config.tautulliUrl);
            const { list: plexAccounts } = await fetchPlexServerAccounts(uri, config);
            const plexAccountName = plexAccounts.find((a) => String(a.id) === String(accountID))?.name || null;
            
            const users = await loadFile(USERS_PATH, []);
            const targetUser = users.find(u => String(u.plexAccountId) === String(accountID));
            const tUsers = await fetchTautulliUsers(config);
            const tautulliUserId = resolveTautulliUserId(tUsers, { username: targetUser?.username, email: targetUser?.email, plexAccountName });

            if (tautulliUserId) {
                const params = new URLSearchParams({
                    apikey: config.tautulliApiKey,
                    cmd: 'get_history',
                    order_column: 'date',
                    order_dir: 'desc',
                    start: String((page - 1) * limit),
                    length: String(limit),
                    user_id: String(tautulliUserId),
                    search: search
                });
                const tRes = await fetch(`${tUrl}/api/v2?${params.toString()}`, { headers: { Accept: 'application/json' } })
                    .then(r => r.json()).catch(() => null);
                
                if (tRes && tRes.response && tRes.response.data && tRes.response.data.data) {
                    totalRecords = tRes.response.data.recordsFiltered;
                    historyData = tRes.response.data.data.map(item => ({
                        title: item.title,
                        parentTitle: item.grandparent_title || item.parent_title,
                        type: item.media_type,
                        viewedAt: item.date,
                        thumbUrl: item.thumb ? plexImageUrl(item.thumb) : null,
                        duration: item.duration,
                        percentComplete: item.percent_complete
                    }));
                    usedTautulli = true;
                }
            }
        }

        if (!usedTautulli) {
            const allHistory = await fetchPlexAccountHistory(uri, config, accountID, { maxItems: 10000 });
            
            const mapHistoryToRecent = (item) => ({
                title: item.type === 'episode' ? (item.grandparentTitle || item.parentTitle || item.title) : item.type === 'track' ? (item.parentTitle || item.grandparentTitle || item.title) : item.title,
                episodeTitle: item.type === 'episode' || item.type === 'track' ? item.title : null,
                viewedAt: item.viewedAt,
                type: item.type,
                thumbUrl: item.thumb ? plexImageUrl(item.thumb) : null
            });

            let filtered = allHistory.map(mapHistoryToRecent);
            if (search) {
                filtered = filtered.filter(item => 
                    (item.title && item.title.toLowerCase().includes(search)) || 
                    (item.episodeTitle && item.episodeTitle.toLowerCase().includes(search))
                );
            }
            
            totalRecords = filtered.length;
            historyData = filtered.slice((page - 1) * limit, page * limit);
        }

        res.json({
            data: historyData,
            total: totalRecords,
            page,
            limit,
            source: usedTautulli ? 'tautulli' : 'plex'
        });
    } catch (e) {
        log(`Error fetching user history API: ${e.message}`);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

app.post('/api/plex/report-issue', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, null);
        if (!config || !config.smtpUser) return res.status(503).json({ error: 'SMTP not configured' });

        const { title, key, issue } = req.body;
        if (!title || !issue) return res.status(400).json({ error: 'Missing title or issue' });

        const safeTitle = escapeHtmlAttr(String(title || ''));
        const safeKey = key ? escapeHtmlAttr(String(key)) : '';
        const safeUsername = escapeHtmlAttr(String(req.user.username || 'Unknown'));
        const safeIssue = escapeHtmlAttr(String(issue || '')).replace(/\n/g, '<br/>');
        const subject = `Plex Issue Report: ${String(title || '').slice(0, 120)}`;
        const html = `
            <h2>Issue Reported by ${safeUsername}</h2>
            <p><strong>Media:</strong> ${safeTitle}</p>
            ${safeKey ? `<p><strong>Key:</strong> ${safeKey}</p>` : ''}
            <p><strong>User's Note:</strong></p>
            <blockquote style="background: #f9f9f9; padding: 10px; border-left: 5px solid #E5A00D;">
                ${safeIssue}
            </blockquote>
        `;

        await sendEmail(config, config.smtpUser, subject, html);
        res.json({ success: true });
    } catch (e) {
        log(`Error reporting issue: ${e.message}`);
        res.status(500).json({ error: 'Failed to report issue' });
    }
});

app.get('/api/plex/analytics/user/:id', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, null);
        if (!config || !config.plexToken || !config.serverIdentifier) return res.status(503).json({ error: 'Plex not configured' });

        const uri = await getPlexConnectionUri(config);
        if (!uri) return res.status(503).json({ error: 'Cannot connect to Plex' });

        const accountID = req.params.id;
        const limit = req.query.days === 'all' ? 999999 : 5000;

        const historyRes = await fetch(`${uri}/status/sessions/history/all?accountID=${accountID}&X-Plex-Token=${config.plexToken}&sort=viewedAt:desc&limit=${limit}`, { headers: plexClientHeaders(config.plexToken) }).then(r => r.json()).catch(() => null);
        const sectionsRes = await fetch(`${uri}/library/sections?X-Plex-Token=${config.plexToken}`, { headers: plexClientHeaders(config.plexToken) }).then(r => r.json()).catch(() => null);

        if (!historyRes || !historyRes.MediaContainer || !historyRes.MediaContainer.Metadata) {
            return res.json({ totalPlays: 0, topLibraries: [], topWatched: [], topMusic: [], recentHistory: [] });
        }

        const sectionsMap = {};
        if (sectionsRes && sectionsRes.MediaContainer && sectionsRes.MediaContainer.Directory) {
            sectionsRes.MediaContainer.Directory.forEach(s => sectionsMap[s.key] = s.title);
        }

        let cutoffDate = 0;
        if (req.query.days && req.query.days !== 'all') {
            const days = parseInt(req.query.days, 10) || 30;
            cutoffDate = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);
        } else if (!req.query.days) {
            cutoffDate = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
        }

        let totalPlays = 0;
        const libraryCounts = {};
        const contentCounts = {};
        const recentHistory = [];

        const dayOfWeekCounts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
        const hourDistribution = new Array(24).fill(0);
        const statsTimezone = await fetchTautulliTimezone(config);

        historyRes.MediaContainer.Metadata.forEach(item => {
            if (cutoffDate > 0 && item.viewedAt < cutoffDate) return;
            totalPlays++;

            const hour = getHourInTimezone(item.viewedAt, statsTimezone);
            hourDistribution[hour]++;

            const day = getWeekdayInTimezone(item.viewedAt, statsTimezone);
            if (day >= 0 && day <= 6) dayOfWeekCounts[day]++;

            // Recent history
            if (recentHistory.length < 50) {
                recentHistory.push({
                    title: item.type === 'episode' ? (item.grandparentTitle || item.parentTitle || item.title) : item.type === 'track' ? (item.parentTitle || item.grandparentTitle || item.title) : item.title,
                    episodeTitle: item.type === 'episode' || item.type === 'track' ? item.title : null,
                    viewedAt: item.viewedAt,
                    thumb: item.type === 'episode' ? (item.grandparentThumb || item.parentThumb || item.thumb) : item.type === 'track' ? (item.parentThumb || item.grandparentThumb || item.thumb) : item.thumb,
                    type: item.type,
                    plexUrl: `https://app.plex.tv/desktop/#!/server/${config.serverIdentifier}/details?key=${encodeURIComponent(item.key)}`
                });
            }

            // Library aggregation
            if (item.librarySectionID) {
                const libTitle = sectionsMap[item.librarySectionID] || `Library ${item.librarySectionID}`;
                if (!libraryCounts[item.librarySectionID]) libraryCounts[item.librarySectionID] = { id: item.librarySectionID, title: libTitle, plays: 0 };
                libraryCounts[item.librarySectionID].plays++;
            }

            // Content aggregation
            const contentKey = item.type === 'episode' ? (item.grandparentKey || item.parentKey || item.ratingKey) : item.type === 'track' ? (item.parentKey || item.grandparentKey || item.ratingKey) : item.ratingKey;
                const contentTitle = item.type === 'episode' ? (item.grandparentTitle || item.parentTitle || item.title) : item.type === 'track' ? (item.parentTitle || item.grandparentTitle || item.title) : item.title;
                const contentThumb = item.type === 'episode' ? (item.grandparentThumb || item.parentThumb || item.thumb) : item.type === 'track' ? (item.parentThumb || item.grandparentThumb || item.thumb) : item.thumb;
                const contentArt = item.type === 'episode' ? (item.grandparentArt || item.parentArt || item.art) : item.type === 'track' ? (item.parentArt || item.grandparentArt || item.art) : item.art;

            if (contentKey) {
                if (!contentCounts[contentKey]) {
                    contentCounts[contentKey] = {
                        key: contentKey,
                        title: contentTitle,
                        type: item.type === 'episode' ? 'show' : item.type === 'track' ? 'track' : item.type,
                        thumb: contentThumb,
                        art: contentArt,
                        plays: 0,
                        plexUrl: `https://app.plex.tv/desktop/#!/server/${config.serverIdentifier}/details?key=${encodeURIComponent('/library/metadata/' + contentKey.split('/').pop())}`
                    };
                }
                contentCounts[contentKey].plays++;
            }
        });

        const topLibraries = Object.values(libraryCounts).sort((a, b) => b.plays - a.plays).slice(0, 5);
        const topMovies = Object.values(contentCounts).filter(c => c.type === 'movie').sort((a, b) => b.plays - a.plays).slice(0, 6).map(c => {
            if (c.thumb) c.thumbUrl = plexImageUrl(c.thumb);
            if (c.art) c.artUrl = plexImageUrl(c.art);
            return c;
        });
        const topShows = Object.values(contentCounts).filter(c => c.type === 'show').sort((a, b) => b.plays - a.plays).slice(0, 6).map(c => {
            if (c.thumb) c.thumbUrl = plexImageUrl(c.thumb);
            if (c.art) c.artUrl = plexImageUrl(c.art);
            return c;
        });
        const topMusic = Object.values(contentCounts).filter(c => c.type === 'track').sort((a, b) => b.plays - a.plays).slice(0, 6).map(c => {
            if (c.thumb) c.thumbUrl = plexImageUrl(c.thumb);
            if (c.art) c.artUrl = plexImageUrl(c.art);
            return c;
        });

        res.json({
            totalPlays,
            topLibraries,
            topMovies,
            topShows,
            topMusic,
            dayOfWeekCounts,
            hourDistribution,
            recentHistory: recentHistory.map(h => {
                if (h.thumb) h.thumbUrl = plexImageUrl(h.thumb);
                return h;
            })
        });
    } catch (e) {
        log(`Error fetching user analytics: ${e.message}`);
        res.status(500).json({ error: 'Analytics error' });
    }
});

app.get('/api/speedtest/ping', requireAuth, requireMember, speedtestRateLimit, (req, res) => { res.set('Cache-Control', 'no-store'); res.send('pong'); });
app.get('/api/speedtest/download', requireAuth, requireMember, speedtestRateLimit, (req, res) => {
    const streamForever = String(req.query.stream || '') === '1';
    const parsedBytes = parseInt(req.query.bytes, 10);
    const bytes = streamForever
        ? null
        : Math.max(1, Math.min(Number.isFinite(parsedBytes) ? parsedBytes : SPEED_TEST_CHUNK_SIZE, SPEED_TEST_MAX_DOWNLOAD_BYTES));

    res.set('Content-Type', 'application/octet-stream');
    res.set('Cache-Control', 'no-store, no-transform');
    res.set('Content-Encoding', 'identity');
    res.set('X-Content-Type-Options', 'nosniff');
    if (bytes != null) res.set('Content-Length', String(bytes));

    let destroyed = false;
    let sent = 0;
    const cleanup = () => { destroyed = true; };
    req.on('close', cleanup);
    res.on('close', cleanup);

    // Tight write loop — avoid setImmediate between every chunk so Node can push multi-gig.
    const pump = () => {
        if (destroyed || res.writableEnded) return;
        let ok = true;
        while (ok && !destroyed && !res.writableEnded) {
            if (bytes != null && sent >= bytes) {
                res.end();
                return;
            }
            const chunk = (bytes != null && (bytes - sent) < SPEED_TEST_CHUNK_SIZE)
                ? SPEED_TEST_BUFFER.subarray(0, bytes - sent)
                : SPEED_TEST_BUFFER;
            ok = res.write(chunk);
            sent += chunk.length;
        }
        if (!destroyed && !res.writableEnded) res.once('drain', pump);
    };

    pump();
});
/** Streaming upload sink — discard body without buffering (supports long duration tests). */
app.post('/api/speedtest/upload', requireAuth, requireMember, speedtestRateLimit, (req, res) => {
    res.set('Cache-Control', 'no-store');
    let received = 0;
    const maxBytes = SPEED_TEST_MAX_UPLOAD_BYTES;
    req.on('data', (chunk) => {
        received += chunk.length;
        if (received > maxBytes) {
            req.destroy();
            if (!res.headersSent) res.status(413).end();
        }
    });
    req.on('end', () => {
        if (!res.headersSent) res.sendStatus(200);
    });
    req.on('error', () => {
        if (!res.headersSent) res.sendStatus(499);
    });
});

// --- Static File Serving ---
const staticDir = path.join(process.cwd(), 'static');
const PORTAL_REQUIRED_STATIC_ASSETS = ['tailwind.css', 'index.js'];

const arePortalFrontendAssetsReady = () => (
    PORTAL_REQUIRED_STATIC_ASSETS.every((file) => fsSync.existsSync(path.join(staticDir, file)))
);

const buildMissingFrontendAssetsHtml = () => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Portal build required</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; background: #0b0f19; color: #e5e7eb; margin: 0; padding: 2rem; }
    main { max-width: 42rem; margin: 4rem auto; line-height: 1.6; }
    h1 { color: #f7c600; margin-bottom: 0.75rem; }
    code { background: #111827; padding: 0.15rem 0.4rem; border-radius: 0.35rem; }
    ol { padding-left: 1.25rem; }
    li { margin: 0.5rem 0; }
  </style>
</head>
<body>
  <main>
    <h1>Frontend build assets are missing</h1>
    <p>The portal UI files <code>static/tailwind.css</code> and <code>static/index.js</code> are not on disk. This usually happens after a git pull removed generated build files without rebuilding.</p>
    <ol>
      <li><strong>Docker:</strong> pull the latest image tag for your branch (for example <code>ghcr.io/jl94x4/server-manager-portal:beta</code>) and restart the container.</li>
      <li><strong>Bare metal:</strong> run <code>npm run build</code> in the app directory, then restart the service.</li>
      <li><strong>Volume mounts:</strong> mount only <code>/app/config</code>, not the whole <code>/app</code> folder, unless you rebuild after every update.</li>
    </ol>
  </main>
</body>
</html>`;

const staticAssetOptions = {
    setHeaders: (res, filePath) => {
        if (/\.(js|css|html)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
        }
    },
};
app.use('/static', express.static(staticDir, staticAssetOptions));
if (BASE_PATH) {
    app.use(`${BASE_PATH}/static`, express.static(staticDir, staticAssetOptions));
}

const buildPwaManifest = async () => {
    const config = await loadFile(CONFIG_PATH, {});
    const profile = await getAdminProfile(config);
    const serverName = profile.serverName || 'Server Portal';
    // App home is /portal when BASE_PATH is empty — matches login redirect + client router.
    const startUrl = BASE_PATH ? `${BASE_PATH}/` : '/portal';
    const scope = BASE_PATH ? `${BASE_PATH}/` : '/';
    // ALWAYS use exact-size static PNGs for installability.
    // Dynamic /api/public/pwa-icon branding (even "fast") makes Chrome Android fall back to
    // Create shortcut only (WebAPK minting times out / rejects), and Firefox aborts Install entirely.
    // Server branding still applies to in-app favicon via branding-icon.
    const iconVer = '4';
    const icon192 = `${resolvePublicAssetHref('/static/pwa-icon-192.png')}?v=${iconVer}`;
    const icon512 = `${resolvePublicAssetHref('/static/pwa-icon-512.png')}?v=${iconVer}`;
    const iconMaskable = `${resolvePublicAssetHref('/static/pwa-icon-maskable-512.png')}?v=${iconVer}`;
    return {
        id: startUrl,
        name: `${serverName} Portal`,
        short_name: serverName.length > 12 ? 'Portal' : serverName,
        description: `Install ${serverName} Portal for quick access.`,
        start_url: startUrl,
        scope,
        display: 'standalone',
        background_color: '#0b0f19',
        theme_color: '#0b0f19',
        icons: [
            { src: icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: icon512, sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: iconMaskable, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
    };
};

const sendPwaManifest = async (_req, res) => {
    try {
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.json(await buildPwaManifest());
    } catch (e) {
        res.status(500).json({ error: 'Failed to build web app manifest.' });
    }
};

app.get(['/manifest.webmanifest', '/manifest.json', '/site.webmanifest'], sendPwaManifest);
if (BASE_PATH) {
    app.get([
        `${BASE_PATH}/manifest.webmanifest`,
        `${BASE_PATH}/manifest.json`,
        `${BASE_PATH}/site.webmanifest`
    ], sendPwaManifest);
}

// Chromium Android uses this for WebAPK installability. Firefox deliberately does not
// register it (a bad SW makes Firefox Install silently no-op).
const serviceWorkerScript = `/* portal-sw v6 */
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Presence-only fetch listener — required for Chrome Android Install.
// Do NOT event.respondWith(fetch(...)): proxying every request breaks
// cross-origin posters (TMDB), fonts (Google), and Plex/user thumbs.
self.addEventListener('fetch', () => {});
`;

const sendServiceWorker = (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Service-Worker-Allowed', BASE_PATH ? `${BASE_PATH}/` : '/');
    res.send(serviceWorkerScript);
};

app.get('/service-worker.js', sendServiceWorker);
if (BASE_PATH) {
    app.get(`${BASE_PATH}/service-worker.js`, sendServiceWorker);
}

// Serve optional legacy stylesheet from the root directory
app.get('/style.css', (req, res) => {
    const cssPath = path.join(process.cwd(), 'style.css');
    res.sendFile(cssPath, (err) => {
        if (err) res.type('text/css').send('/* style.css not found */');
    });
});

const escapeHtmlAttr = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const getRequestBaseUrl = (req, config = null) => {
    const configured = config
        ? resolvePublicBaseUrlFromConfig(config)
        : (runtimePublicBaseUrl || getEnvPublicBaseUrl());
    if (configured) return configured;
    const host = req.get('host') || `localhost:${PORT}`;
    const normalizedHost = host.split(',')[0].trim();
    if (isBlockedHostName(normalizedHost.split(':')[0])) {
        return `${req.secure ? 'https' : 'http'}://localhost:${PORT}`;
    }
    const proto = req.secure ? 'https' : 'http';
    return `${proto}://${normalizedHost}${BASE_PATH}`;
};

const resolvePublicAssetHref = (url = '/static/logo.png') => {
    const trimmed = String(url || '').trim() || '/static/logo.png';
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
    const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return withBasePath(stripBasePathFromUrl(path));
};

const resolvePortalBrandingIconHref = (config = {}, profile = {}) => {
    const href = resolvePublicAssetHref('/api/public/branding-icon');
    return `${href}?v=${getPortalBrandingIconCacheKey(config, profile)}`;
};

const injectAppIconLinks = (html, iconHref) => {
    const safeHref = escapeHtmlAttr(iconHref || resolvePublicAssetHref('/static/logo.png'));
    const manifestHref = escapeHtmlAttr(withBasePath('/manifest.webmanifest'));
    const manifestTag = `<link rel="manifest" href="${manifestHref}" />`;
    const iconLinks = [
        `<link rel="icon" type="image/png" href="${safeHref}" />`,
        `<link rel="apple-touch-icon" sizes="180x180" href="${safeHref}" />`
    ].join('\n    ');
    let updated = html
        .replace(/<link\b(?=[^>]*\brel=["'][^"']*manifest[^"']*["'])[^>]*>\s*/gi, '')
        .replace(/<link\b(?=[^>]*\brel=["'][^"']*(?:apple-touch-icon|icon)[^"']*["'])[^>]*>\s*/gi, '');
    // Firefox discovers the manifest from the initial HTML head — keep it near the top.
    if (/<base\b[^>]*>/i.test(updated)) {
        updated = updated.replace(/(<base\b[^>]*>)/i, `$1\n    ${manifestTag}`);
    } else {
        updated = updated.replace(/<head([^>]*)>/i, `<head$1>\n    ${manifestTag}`);
    }
    return updated.replace('</head>', `    ${iconLinks}\n</head>`);
};

const injectBasePathHtml = (html) => {
    const baseHref = BASE_PATH ? `${BASE_PATH}/` : '/';
    const baseTag = `<base href="${escapeHtmlAttr(baseHref)}">`;
    let updated = html.includes('<base ')
        ? html
        : html.replace(/<head([^>]*)>/i, `<head$1>\n    ${baseTag}`);
    if (BASE_PATH) {
        updated = updated
            .replace(/href="\/static\//g, `href="${BASE_PATH}/static/`)
            .replace(/src="\/static\//g, `src="${BASE_PATH}/static/`);
    }
    return updated;
};

const buildSocialMetaTags = async (req) => {
    const config = await loadFile(CONFIG_PATH, {});
    const profile = await getAdminProfile(config);
    const baseUrl = getRequestBaseUrl(req, config);
    const pageUrl = `${baseUrl}${stripBasePathFromUrl(req.originalUrl || '/')}`;
    const serverName = profile.serverName || 'Server Portal';
    const mediaServerType = String(config.mediaServerType || 'plex').toLowerCase();
    const mediaLabel = mediaServerType === 'jellyfin' ? 'Jellyfin' : mediaServerType === 'emby' ? 'Emby' : 'Plex';
    const requestAppType = config.requestAppType === 'overseerr' ? 'seerr' : (config.requestAppType || 'none');
    const hasRequests = !!(requestAppType && requestAppType !== 'none' && (config.requestAppUrl || config.requestUrl));

    const highlights = [
        'see what\'s playing',
        'browse your library',
        'check watch history',
    ];
    if (hasRequests) highlights.push('discover & request movies and TV');
    else highlights.push('discover new movies and TV');

    const description = `Your private ${mediaLabel} portal for ${serverName}. Sign in to ${highlights.slice(0, -1).join(', ')}, and ${highlights[highlights.length - 1]}.`;
    const title = `${serverName} Portal`;

    let imageUrl = '';
    const configuredImage = config.customLogoUrl || profile.thumb || '';
    if (configuredImage) {
        imageUrl = configuredImage.startsWith('http')
            ? configuredImage
            : `${baseUrl}/api/plex/image?path=${encodeURIComponent(configuredImage)}&width=1200&height=630`;
    }

    const tags = [
        `<meta property="og:type" content="website" />`,
        `<meta property="og:site_name" content="${escapeHtmlAttr(serverName)}" />`,
        `<meta property="og:title" content="${escapeHtmlAttr(title)}" />`,
        `<meta property="og:description" content="${escapeHtmlAttr(description)}" />`,
        `<meta property="og:url" content="${escapeHtmlAttr(pageUrl)}" />`,
        ...(imageUrl ? [`<meta property="og:image" content="${escapeHtmlAttr(imageUrl)}" />`] : []),
        `<meta name="twitter:card" content="${imageUrl ? 'summary_large_image' : 'summary'}" />`,
        `<meta name="twitter:title" content="${escapeHtmlAttr(title)}" />`,
        `<meta name="twitter:description" content="${escapeHtmlAttr(description)}" />`,
        ...(imageUrl ? [`<meta name="twitter:image" content="${escapeHtmlAttr(imageUrl)}" />`] : []),
        `<meta name="description" content="${escapeHtmlAttr(description)}" />`
    ].join('\n    ');

    return { title, tags, iconHref: resolvePortalBrandingIconHref(config, profile) };
};

// Serve the main index.html for SPA routes (after base-path strip, paths are root-relative)
app.get(/^\/(?!api\/|static\/|manifest\.(?:webmanifest|json)|site\.webmanifest|service-worker\.js).*$/, async (req, res) => {
    if (!arePortalFrontendAssetsReady()) {
        res.status(503);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        return res.send(buildMissingFrontendAssetsHtml());
    }
    try {
        const indexPath = path.join(process.cwd(), 'index.html');
        const html = await fs.readFile(indexPath, 'utf8');
        const socialMeta = await buildSocialMetaTags(req);
        const updatedHtml = injectBasePathHtml(injectAppIconLinks(html
            .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtmlAttr(socialMeta.title)}</title>`)
            .replace('</head>', `    ${socialMeta.tags}\n</head>`), socialMeta.iconHref));
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(updatedHtml);
    } catch (e) {
        try {
            const indexPath = path.join(process.cwd(), 'index.html');
            const html = await fs.readFile(indexPath, 'utf8');
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(injectBasePathHtml(html));
        } catch {
            res.status(500).send('Failed to load application shell.');
        }
    }
});


// --- API Routes ---Service ---
let serviceIntervalId = null;

const checkAndSendNewsletter = async (config, force = false) => {
    if (!config.newsletterFrequency || config.newsletterFrequency === 'disabled') return;
    if (!config.smtpHost || !config.smtpUser) return;

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];

    if (!force) {
        const dayOfWeek = now.getDay();
        const dayOfMonth = now.getDate();

        let shouldSend = false;
        if (config.newsletterFrequency === 'weekly' && dayOfWeek === Number(config.newsletterDay)) {
            shouldSend = true;
        } else if (config.newsletterFrequency === 'monthly' && dayOfMonth === Number(config.newsletterDay)) {
            shouldSend = true;
        }

        if (!shouldSend) return;
        if (config.lastNewsletterSent === dateStr) return;
    }

    try {
        log('Generating and sending automated newsletters...');
        const { html, attachments } = await generateNewsletterHtml(config);
        const providerLabel = getNewsletterProviderLabel(config);
        const transporter = nodemailer.createTransport({
            host: config.smtpHost,
            port: config.smtpPort,
            secure: config.smtpSecure,
            auth: { user: config.smtpUser, pass: config.smtpPass }
        });

        const users = await loadFile(USERS_PATH, []);
        const recipients = users.filter(user => user.email && !user.optOutNewsletter);

        if (recipients.length === 0) return;

        // Mark as sent immediately to prevent re-sending if the server restarts during the 30-minute window
        config.lastNewsletterSent = dateStr;
        await saveFile(CONFIG_PATH, config);

        // Spread the sending out over a 30-minute period (1,800,000 ms) to avoid Gmail rate limits
        const totalDurationMs = 30 * 60 * 1000;
        const delayPerEmailMs = Math.floor(totalDurationMs / recipients.length);

        let sentCount = 0;
        for (const user of recipients) {
            const personalizedHtml = html.replace(/{{USERNAME}}/g, escapeHtmlAttr(user.username || 'User'));

            try {
                await transporter.sendMail({
                    from: config.smtpFrom || config.smtpUser,
                    to: user.email,
                    subject: `${providerLabel} Server Automated Newsletter`,
                    html: personalizedHtml,
                    attachments: attachments
                });
                sentCount++;
                await new Promise(resolve => setTimeout(resolve, delayPerEmailMs));
            } catch (e) {
                log(`Failed to send newsletter to ${user.email}: ${e.message}`);
            }
        }

        log(`Newsletter sent to ${sentCount} users.`);
    } catch (e) {
        log(`Failed to generate/send newsletter: ${e.message}`);
    }
};

const checkAndCleanupInactive = async (config) => {
    if (!config.inactiveCleanupEnabled) return;

    const thresholdDays = parseInt(config.inactiveCleanupDays) || 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - thresholdDays);
    const cutoffMs = cutoffDate.getTime();

    log(`Running automated inactive cleanup check (threshold: ${thresholdDays} days)...`);

    let users = await loadFile(USERS_PATH, []);
    let usersUpdated = false;

    const uri = await getPlexConnectionUri(config);
    if (!uri) return;

    // History queries need the *local* Plex account id, not plex.tv user id.
    const { list: plexAccounts } = await fetchPlexServerAccounts(uri, config);
    const norm = (v) => String(v || '').trim().toLowerCase();
    const resolveHistoryAccountId = (user) => {
        if (user?.plexAccountId) return String(user.plexAccountId);
        const byName = plexAccounts.find((a) => norm(a.name) === norm(user?.username));
        if (byName) return String(byName.id);
        if (user?.email) {
            const byEmail = plexAccounts.find((a) => (
                norm(a.name) === norm(user.email) || norm(a.email) === norm(user.email)
            ));
            if (byEmail) return String(byEmail.id);
        }
        return null;
    };

    const logoPath = path.join(process.cwd(), 'static', 'logo.png');
    let hasLogo = false;
    try {
        await fs.access(logoPath);
        hasLogo = true;
    } catch (e) { /* optional logo */ }

    for (const user of users) {
        if (user.isAdmin || user.exemptFromCleanup) continue;
        // Only consider users with active access; pending/revoked users aren't relevant.
        if (user.plexAccessStatus !== 'active') continue;

        const accountId = resolveHistoryAccountId(user);
        if (!accountId) {
            log(`[INACTIVE CLEANUP] Skipping ${user.email || user.username}: no local Plex account id for history lookup.`);
            continue;
        }

        try {
            // Get last session from Plex directly
            const historyRes = await fetch(`${uri}/status/sessions/history/all?X-Plex-Token=${config.plexToken}&accountID=${accountId}&sort=viewedAt:desc&limit=1`, { headers: plexClientHeaders(config.plexToken) }).then(r => r.json()).catch(() => null);

            let lastWatchedMs = 0;
            if (historyRes && historyRes.MediaContainer && historyRes.MediaContainer.Metadata && historyRes.MediaContainer.Metadata.length > 0) {
                const session = historyRes.MediaContainer.Metadata[0];
                lastWatchedMs = session.viewedAt * 1000;
            }

            // Only act if we know they have a lastWatched date AND it's older than cutoff
            // (If they've literally never watched anything ever, lastWatchedMs is 0. We'll count that as inactive too if they've been on the server long enough)
            const joinedAtMs = new Date(user.joiningDate || user.linkedAt || user.createdAt || Date.now()).getTime();

            if ((lastWatchedMs > 0 && lastWatchedMs < cutoffMs) || (lastWatchedMs === 0 && joinedAtMs < cutoffMs)) {
                log(`[INACTIVE CLEANUP] User ${user.email} last watched: ${lastWatchedMs > 0 ? new Date(lastWatchedMs).toISOString() : 'Never'}. Removing access.`);

                // Revoke immediately. Previously we stamped expiryDate=now and relied on
                // checkAndRevoke (days < 0 only, and it runs *before* this job), which left
                // users active forever while the displayed expiry rolled forward each day.
                const revoked = await revokePlexAccess(user, config);
                if (!revoked) {
                    log(`[INACTIVE CLEANUP] Failed to revoke Plex access for ${user.email || user.username}; will retry next run.`);
                    continue;
                }

                user.plexAccessStatus = 'revoked';
                // Show as expired in the Users list without re-stamping every run.
                const days = getDaysUntilExpiry(user.expiryDate);
                if (days === null || days >= 0) {
                    const past = new Date();
                    past.setHours(0, 0, 0, 0);
                    past.setDate(past.getDate() - 1);
                    const y = past.getFullYear();
                    const m = String(past.getMonth() + 1).padStart(2, '0');
                    const d = String(past.getDate()).padStart(2, '0');
                    user.expiryDate = `${y}-${m}-${d}T12:00:00.000Z`;
                }
                usersUpdated = true;

                await appendAuditLog('user_inactive_cleanup', { username: 'System', email: 'system@local' }, user, {
                    reason: `Inactive for > ${thresholdDays} days`,
                    lastWatched: lastWatchedMs > 0 ? new Date(lastWatchedMs).toISOString() : 'Never',
                    accountId,
                });

                if (alertRuleEnabled(config, 'accessRevoked')) {
                    await sendGotifyAlert(
                        config,
                        'Portal access revoked',
                        `${user.username || user.email} was revoked after inactive cleanup.`,
                        8,
                    ).catch((e) => log(`Failed to send Gotify inactive-cleanup alert: ${e.message}`));
                }

                if (!user.expiryEmailSent) {
                    const emailSent = await sendExpiryEmail(config, user, hasLogo);
                    if (emailSent) user.expiryEmailSent = true;
                }
            }
        } catch (e) {
            log(`Failed to check history for user ${user.email}: ${e.message}`);
        }
    }

    if (usersUpdated) {
        await saveFile(USERS_PATH, users);
    }
};

let tasksInfo = [
    { id: 'syncPlexUsers', name: 'Sync Plex Users', description: 'Fetches latest user data from Plex.', lastRun: null, nextRun: null, running: false, lastDurationMs: null, lastError: null },
    { id: 'checkAndSendNotifications', name: 'Expiry Notifications', description: 'Sends warning emails to users nearing expiry.', lastRun: null, nextRun: null, running: false, lastDurationMs: null, lastError: null },
    { id: 'checkAndRevoke', name: 'Revoke Access', description: 'Removes Plex access for expired users.', lastRun: null, nextRun: null, running: false, lastDurationMs: null, lastError: null },
    { id: 'checkAndSendNewsletter', name: 'Send Newsletter', description: 'Generates and sends automated newsletters.', lastRun: null, nextRun: null, running: false, lastDurationMs: null, lastError: null },
    { id: 'checkAndCleanupInactive', name: 'Inactive Cleanup', description: 'Revokes access for users who have not watched anything recently.', lastRun: null, nextRun: null, running: false, lastDurationMs: null, lastError: null },
    { id: 'maintenanceRuleRun', name: 'Maintenance Rule Run', description: 'Evaluates maintenance rules and executes eligible actions.', lastRun: null, nextRun: null, running: false, lastDurationMs: null, lastError: null }
];

const systemJobs = {
    analyticsCache: { id: 'analyticsCache', name: 'Analytics Cache Builder', description: 'Rebuilds server analytics cache snapshots every 30 minutes.', lastRun: null, nextRun: null, running: false, lastDurationMs: null, lastError: null },
    trendingCache: { id: 'trendingCache', name: 'Trending Cache Builder', description: 'Rebuilds trending and leaderboard data every 12 hours.', lastRun: null, nextRun: null, running: false, lastDurationMs: null, lastError: null },
    plexStats: { id: 'plexStats', name: 'Plex Stats Builder', description: 'Rebuilds cached library size and usage totals every 24 hours.', lastRun: null, nextRun: null, running: false, lastDurationMs: null, lastError: null },
    autoBackup: { id: 'autoBackup', name: 'Auto Rolling Backup', description: 'Creates rolling backup snapshots on configured interval.', lastRun: null, nextRun: null, running: false, lastDurationMs: null, lastError: null },
    maintenanceIndex: { id: 'maintenanceIndex', name: 'Media Quality Index', description: 'Builds per-item media quality index for Cleaner and Upgrader.', lastRun: null, nextRun: null, running: false, lastDurationMs: null, lastError: null },
    upgraderIndex: { id: 'upgraderIndex', name: 'Upgrader Index', description: 'Rebuilds Sonarr/Radarr library index for Upgrader browse.', lastRun: null, nextRun: null, running: false, lastDurationMs: null, lastError: null },
    requestStatusSync: {
        id: 'requestStatusSync',
        name: 'Portal Request Status Sync',
        description: 'Updates portal request downloading/available status from Sonarr/Radarr (requestEngine=portal).',
        lastRun: null,
        nextRun: null,
        running: false,
        lastDurationMs: null,
        lastError: null,
    },
    discoveryAvailabilityCache: {
        id: 'discoveryAvailabilityCache',
        name: 'Discovery Availability Cache',
        description: 'Scans Sonarr/Radarr every 12 hours into an on-disk badge cache; Discover reads the cache (no live *arr on browse).',
        lastRun: null,
        nextRun: null,
        running: false,
        lastDurationMs: null,
        lastError: null,
    },
    seerrHistoryImport: {
        id: 'seerrHistoryImport',
        name: 'Import Seerr History',
        description: 'Copies Seerr/Overseerr request, issue, and blocklist history into portal JSON stores (idempotent).',
        lastRun: null,
        nextRun: null,
        running: false,
        lastDurationMs: null,
        lastError: null,
    },
};

const markTaskStart = (task) => {
    task.running = true;
    task.lastError = null;
    task._startedAt = Date.now();
    task.lastRun = new Date(task._startedAt).toISOString();
};

const markTaskEnd = (task, error = null) => {
    task.running = false;
    if (task._startedAt) {
        task.lastDurationMs = Date.now() - task._startedAt;
        delete task._startedAt;
    }
    task.lastError = error ? (error.message || String(error)) : null;
};

const REQUEST_STATUS_SYNC_INTERVAL_MS = 60 * 1000;
/** Sonarr/Radarr library badge snapshot — Discover serves from disk; rescans infrequently. */
const DISCOVERY_AVAILABILITY_CACHE_INTERVAL_MS = 12 * 60 * 60 * 1000;
/** Full Sonarr/Radarr JSON downloads need far longer than Discover browse (8s). */
const DISCOVERY_AVAILABILITY_CATALOG_TIMEOUT_MS = 3 * 60 * 1000;

const runDiscoveryAvailabilityCacheRebuild = async (reason = 'scheduled', { alreadyStarted = false } = {}) => {
    const job = systemJobs.discoveryAvailabilityCache;
    if (job.running && !alreadyStarted) {
        const startedAt = Number(job._startedAt) || 0;
        if (startedAt > 0 && (Date.now() - startedAt) > DISCOVERY_AVAILABILITY_STUCK_MS) {
            log('[DiscoveryAvailabilityCache] clearing stuck running flag before retry');
            markTaskEnd(job, new Error('Cleared stuck run after 10 minutes'));
        } else {
            return null;
        }
    }
    if (!alreadyStarted) markTaskStart(job);
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const summary = await rebuildDiscoveryAvailabilityCache({
            config,
            createLibraryAvailability: (cfg, extras = {}) => createDiscoveryLibraryAvailability(cfg, {
                ...extras,
                warmOnCreate: false,
                forceCatalogRefresh: true,
                catalogTimeoutMs: DISCOVERY_AVAILABILITY_CATALOG_TIMEOUT_MS,
            }),
            saveFile,
            cachePath: DISCOVERY_AVAILABILITY_CACHE_PATH,
        });
        invalidateDiscoveryAvailabilityCacheMemo();
        job.nextRun = new Date(Date.now() + DISCOVERY_AVAILABILITY_CACHE_INTERVAL_MS).toISOString();
        markTaskEnd(job, null);
        log(`[DiscoveryAvailabilityCache] ${reason}: items=${summary.itemCount} movies=${summary.movieCount} tv=${summary.tvCount}`);
        return summary;
    } catch (error) {
        job.nextRun = new Date(Date.now() + DISCOVERY_AVAILABILITY_CACHE_INTERVAL_MS).toISOString();
        markTaskEnd(job, error);
        log(`[DiscoveryAvailabilityCache] failed (${reason}): ${error.message}`);
        return null;
    }
};

const runPortalRequestStatusSync = async (reason = 'scheduled') => {
    const job = systemJobs.requestStatusSync;
    if (job.running) return null;
    markTaskStart(job);
    try {
        const config = await loadFile(CONFIG_PATH, {});
        if (getRequestEngine(config) !== 'portal') {
            job.nextRun = null;
            markTaskEnd(job, null);
            return { skipped: true, reason: 'requestEngine is not portal' };
        }
        const portalRequests = getPortalRequestService(config);
        const summary = await portalRequests.syncRequestStatuses();
        job.nextRun = new Date(Date.now() + REQUEST_STATUS_SYNC_INTERVAL_MS).toISOString();
        markTaskEnd(job, null);
        if (summary?.updated > 0 || reason === 'manual') {
            log(`[RequestStatusSync] ${reason}: checked=${summary.checked} updated=${summary.updated} available=${summary.available} downloading=${summary.downloading} errors=${summary.errors}`);
        }
        return summary;
    } catch (error) {
        markTaskEnd(job, error);
        log(`[RequestStatusSync] failed: ${error.message}`);
        job.nextRun = new Date(Date.now() + REQUEST_STATUS_SYNC_INTERVAL_MS).toISOString();
        return null;
    }
};

const runSeerrHistoryImport = async (reason = 'manual') => {
    const job = systemJobs.seerrHistoryImport;
    if (job.running) return null;
    markTaskStart(job);
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const gate = getRequestAppGate(config);
        if (!gate.ready) {
            markTaskEnd(job, new Error(gate.error || 'Request app not configured'));
            return { skipped: true, reason: gate.error || 'Request app not configured' };
        }
        const portalUsers = await loadFile(USERS_PATH, []);
        const summary = await importSeerrHistoryToPortal({
            config,
            fetchSeerrJson: requestAppService.rawFetch,
            requestsDir: REQUESTS_DIR,
            issuesDir: ISSUES_DIR,
            blocklistDir: BLOCKLIST_DIR,
            portalUsers,
            includeIssues: true,
            includeBlocklist: true,
        });
        markTaskEnd(job, null);
        log(`[SeerrImport] ${reason}: requests imported=${summary.requests.imported} issues imported=${summary.issues.imported} blocklist imported=${summary.blocklist.imported} unmapped=${summary.requests.skippedUnmapped}`);
        return summary;
    } catch (error) {
        markTaskEnd(job, error);
        log(`[SeerrImport] failed: ${error.message}`);
        return null;
    }
};

const startPortalRequestStatusSyncBackgroundTask = () => {
    systemJobs.requestStatusSync.nextRun = new Date(Date.now() + 15 * 1000).toISOString();
    setTimeout(() => {
        runPortalRequestStatusSync('startup').catch(() => {});
    }, 15 * 1000);
    setInterval(() => {
        runPortalRequestStatusSync('scheduled').catch(() => {});
    }, REQUEST_STATUS_SYNC_INTERVAL_MS);
};

const startDiscoveryAvailabilityCacheBackgroundTask = () => {
    // Serving Discover is always instant from the on-disk cache (loaded below).
    // Background *arr scan is separate and must never block boot / Settings.
    void (async () => {
        try {
            const existing = await loadDiscoveryAvailabilityCacheFile({ force: true });
            const itemCount = Number(existing?.itemCount) || Object.keys(existing?.byKey || {}).length || 0;
            const cacheVersion = Number(existing?.version) || 0;
            const currentVersion = Number(getDiscoveryAvailabilityCacheVersion()) || 2;
            // v2+ stamps continuing/nextAiring shows as Partial + title keys — force rescan when stale.
            const needsRebuild = itemCount <= 0 || cacheVersion < currentVersion;
            if (!needsRebuild) {
                log(`[DiscoveryAvailabilityCache] ready (v${cacheVersion}, ${itemCount} items); next *arr scan in 12h`);
                systemJobs.discoveryAvailabilityCache.nextRun = new Date(
                    Date.now() + DISCOVERY_AVAILABILITY_CACHE_INTERVAL_MS,
                ).toISOString();
                return;
            }
            log(`[DiscoveryAvailabilityCache] ${itemCount <= 0 ? 'empty' : `v${cacheVersion} stale`} — scanning *arr in background`);
            systemJobs.discoveryAvailabilityCache.nextRun = new Date().toISOString();
            setImmediate(() => {
                runDiscoveryAvailabilityCacheRebuild('startup').catch(() => {});
            });
        } catch (error) {
            log(`[DiscoveryAvailabilityCache] boot load failed: ${error.message}`);
            setImmediate(() => {
                runDiscoveryAvailabilityCacheRebuild('startup').catch(() => {});
            });
        }
    })();

    setInterval(() => {
        runDiscoveryAvailabilityCacheRebuild('scheduled').catch(() => {});
    }, DISCOVERY_AVAILABILITY_CACHE_INTERVAL_MS);
};

const computeNextBackupRun = (config) => {
    const days = Math.max(1, Number(config?.autoBackupIntervalDays) || 2);
    const intervalMs = days * 24 * 60 * 60 * 1000;
    const last = config?.autoBackupLastRunAt ? Date.parse(config.autoBackupLastRunAt) : null;
    const base = Number.isFinite(last) ? last : Date.now();
    return new Date(base + intervalMs).toISOString();
};

const runAutoBackupCycle = async (reason = 'auto', { force = false } = {}) => {
    const job = systemJobs.autoBackup;
    markTaskStart(job);
    try {
        const config = await loadFile(CONFIG_PATH, {});
        if (!config.autoBackupEnabled && !force) {
            job.nextRun = null;
            markTaskEnd(job, null);
            return;
        }
        const backup = await createBackupObject('system', reason);
        const result = await writeBackupToFolder(backup);
        config.autoBackupLastRunAt = backup.createdAt;
        await saveFile(CONFIG_PATH, config);
        await enforceBackupRetention(Math.max(1, Number(config.autoBackupRetentionCount) || 10));
        job.nextRun = computeNextBackupRun(config);
        markTaskEnd(job, null);
        await appendAuditLog('backup_auto_created', null, null, { filename: result.filename, reason });
    } catch (e) {
        markTaskEnd(job, e);
        log(`Auto backup failed: ${e.message}`);
    }
};

const startBackgroundService = async () => {
    if (serviceIntervalId) clearInterval(serviceIntervalId);

    const config = await loadFile(CONFIG_PATH, null);
    if (!config || !config.plexToken || !config.serverIdentifier) {
        log('Plex is not configured. Background service will not start.');
        return;
    }

    const intervalMinutes = config.checkIntervalMinutes || 60;
    const intervalMs = intervalMinutes * 60 * 1000;

    const updateNextRun = (currentConfig) => {
        const nextRun = new Date(Date.now() + intervalMs).toISOString();
        tasksInfo.forEach(t => {
            if (t.id === 'checkAndSendNewsletter') {
                if (!currentConfig.newsletterFrequency || currentConfig.newsletterFrequency === 'disabled') {
                    t.nextRun = null;
                } else {
                    const now = new Date();
                    let nextDate = new Date(now);
                    const todayStr = now.toISOString().split('T')[0];

                    if (currentConfig.newsletterFrequency === 'weekly') {
                        const targetDay = Number(currentConfig.newsletterDay);
                        const currentDay = now.getDay();
                        let daysUntil = targetDay - currentDay;
                        if (daysUntil < 0 || (daysUntil === 0 && currentConfig.lastNewsletterSent === todayStr)) {
                            daysUntil += 7;
                        }
                        nextDate.setDate(now.getDate() + daysUntil);
                    } else if (currentConfig.newsletterFrequency === 'monthly') {
                        const targetDay = Number(currentConfig.newsletterDay);
                        const currentDay = now.getDate();
                        if (currentDay > targetDay || (currentDay === targetDay && currentConfig.lastNewsletterSent === todayStr)) {
                            nextDate.setMonth(now.getMonth() + 1);
                        }
                        // Handle end of month edge cases
                        const daysInMonth = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, 0).getDate();
                        nextDate.setDate(Math.min(targetDay, daysInMonth));
                    }
                    t.nextRun = nextDate.toISOString();
                }
            } else if (t.id === 'checkAndCleanupInactive' && !currentConfig.inactiveCleanupEnabled) {
                t.nextRun = null;
            } else if (t.id === 'checkAndSendNotifications' && (!currentConfig.smtpHost || !currentConfig.smtpUser || !currentConfig.smtpPass)) {
                t.nextRun = null;
            } else if (t.id === 'maintenanceRuleRun') {
                t.nextRun = isMaintenanceExperimentalEnabled(currentConfig) ? nextRun : null;
            } else {
                t.nextRun = nextRun;
            }
        });
    };

    let batchRunning = false;
    const runBatch = async (currentConfig) => {
        if (batchRunning) {
            log('Skipping scheduled check: a previous run is still in progress.');
            return;
        }
        batchRunning = true;
        try {
        const runManagedTask = async (taskId, runner, logPrefix) => {
            const task = tasksInfo.find(t => t.id === taskId);
            if (!task) return;
            markTaskStart(task);
            try {
                await runner();
                markTaskEnd(task, null);
            } catch (e) {
                markTaskEnd(task, e);
                log(`Error during ${logPrefix}: ${e.message}`);
            }
        };

        await runManagedTask('syncPlexUsers', () => {
            const mediaServerType = String(currentConfig.mediaServerType || 'plex').toLowerCase();
            return mediaServerType === 'jellyfin' || mediaServerType === 'emby'
                ? syncJellyfinUsers(currentConfig)
                : syncUsers(currentConfig);
        }, 'sync');
        await runManagedTask('checkAndSendNotifications', () => checkAndSendNotifications(currentConfig), 'notifications');
        await runManagedTask('checkAndRevoke', () => checkAndRevoke(currentConfig), 'revoke');
        await runManagedTask('checkAndSendNewsletter', () => checkAndSendNewsletter(currentConfig), 'newsletter');
        await runManagedTask('checkAndCleanupInactive', () => checkAndCleanupInactive(currentConfig), 'inactive cleanup');
        if (isMaintenanceExperimentalEnabled(currentConfig)) {
            await runManagedTask('maintenanceRuleRun', async () => {
                const rules = await loadFile(MAINTENANCE_RULES_PATH, []);
                const hasEnabledRules = Array.isArray(rules) && rules.some(r => r.enabled !== false);
                if (!hasEnabledRules) return;
                await executeMaintenanceRunBatch({ actor: { username: 'System', email: 'system@local' }, dryRun: true });
            }, 'maintenance rules');
        }

        updateNextRun(currentConfig);
        } finally {
            batchRunning = false;
        }
    };

    log(`Service started successfully. Checks will run every ${intervalMinutes} minute(s).`);

    // Initial run
    await runBatch(config);

    serviceIntervalId = setInterval(async () => {
        try {
            const currentConfig = await loadFile(CONFIG_PATH, config);
            await runBatch(currentConfig);
        } catch (e) {
            log(`Error during hourly check: ${e.message}`);
        }
    }, intervalMs);
};

// --- Status App Functions ---
async function loadStatusState() {
    let appConfig = null;
    try {
        const configData = await fs.readFile(STATUS_CONFIG_PATH, 'utf-8');
        statusConfig = JSON.parse(configData);
    } catch (e) {
        appConfig = await loadFile(CONFIG_PATH, {});
        statusConfig = createDefaultStatusConfig(appConfig);
        await saveFile(STATUS_CONFIG_PATH, statusConfig);
    }

    if (!Array.isArray(statusConfig.services) || statusConfig.services.length === 0) {
        appConfig = appConfig || await loadFile(CONFIG_PATH, {});
        statusConfig = createDefaultStatusConfig(appConfig);
        await saveFile(STATUS_CONFIG_PATH, statusConfig);
    }

    try {
        appConfig = appConfig || await loadFile(CONFIG_PATH, {});
        syncIntegrationServicesInStatusConfig(appConfig);
        await saveFile(STATUS_CONFIG_PATH, statusConfig);
    } catch (e) {
        log(`Failed to sync integration services during status load: ${e.message}`);
    }

    try {
        const healthRaw = await fs.readFile(HEALTH_PATH, 'utf-8');
        healthData = JSON.parse(healthRaw) || {};
    } catch (e) {
        healthData = {};
    }
}

async function saveHealthData() {
    try {
        await saveFile(HEALTH_PATH, healthData);
    } catch (e) { }
}

async function performDownloadClientProbe(service) {
    const config = await loadFile(CONFIG_PATH, {});
    const clientId = String(service.clientId || '').trim();
    const client = (Array.isArray(config.downloadClients) ? config.downloadClients : [])
        .find((entry) => String(entry.id || '') === clientId);
    if (!client || client.enabled === false || !client.url) {
        return { status: 'offline', latency: 0, httpCode: 0 };
    }
    const start = Date.now();
    try {
        const torrents = await fetchDownloadClientTorrents(client);
        return {
            status: 'online',
            latency: Math.round(Date.now() - start),
            httpCode: 200,
            details: { torrents: Array.isArray(torrents) ? torrents.length : 0 },
        };
    } catch (error) {
        return { status: 'offline', latency: Math.round(Date.now() - start), httpCode: 0 };
    }
}

async function performSingleProbe(service) {
    if (service?.type === 'download-client') {
        return performDownloadClientProbe(service);
    }

    // Plex status checks must use our stable client identity — a bare HTTP GET is
    // reported as "<container-id> (Linux)" and triggers "new device" pushes on restart.
    const isPlexService = String(service?.id || '') === 'plex'
        || String(service?.name || '').toLowerCase() === 'plex';
    if (isPlexService) {
        const start = Date.now();
        try {
            const config = await loadFile(CONFIG_PATH, {});
            if (!config?.plexToken || config.plexToken === SECRET_MASK) {
                // Fall through to generic URL probe without a token.
            } else {
                let uri = '';
                try {
                    uri = await getPlexConnectionUri(config);
                } catch {
                    uri = String(service.url || config.plexServerUrl || '').replace(/\/+$/, '');
                }
                if (uri) {
                    const res = await fetchWithTimeout(`${uri}/identity`, {
                        headers: plexClientHeaders(config.plexToken),
                    }, 8000);
                    const latency = Math.round(Date.now() - start);
                    const code = res.status || 0;
                    const status = (code >= 200 && code < 400) || code === 401 || code === 403
                        ? 'online'
                        : (code >= 500 ? 'degraded' : 'offline');
                    return { status, latency, httpCode: code };
                }
            }
        } catch {
            return { status: 'offline', latency: Math.round(Date.now() - start), httpCode: 0 };
        }
    }

    return new Promise(async (resolve) => {
        const rawUrl = service.url;
        if (!rawUrl) return resolve({ status: 'offline', latency: 0, httpCode: 0 });

        let targetUrl = rawUrl;
        try {
            // Already-configured status targets are trusted admin input (often LAN).
            targetUrl = normalizeExternalBaseUrl(rawUrl, { allowPrivate: true, allowHttp: true });
            const host = new URL(targetUrl).hostname;
            const normalizedHost = normalizeHostnameForIpCheck(host);
            // DNS rebinding guard: public DNS names must not resolve into private/LAN space.
            if (!net.isIP(normalizedHost) && !isLoopbackHostName(host) && !isBlockedHostName(host)) {
                await assertResolvedAddressesAllowed(host, { allowPrivate: false });
            }
        } catch (e) {
            return resolve({ status: 'offline', latency: 0, httpCode: 0 });
        }
        if (service.port) {
            try {
                const u = new URL(targetUrl);
                u.port = service.port;
                targetUrl = u.toString();
            } catch (e) { }
        }

        let parsedUrl;
        try {
            parsedUrl = new URL(targetUrl);
        } catch (e) {
            return resolve({ status: 'offline', latency: 0, httpCode: 0 });
        }

        const lib = parsedUrl.protocol === 'https:' ? https : http;
        const start = Date.now();
        const urlHasPlexToken = /[?&]X-Plex-Token=/i.test(targetUrl);
        const probeHeaders = urlHasPlexToken
            ? {
                ...plexClientHeaders((() => {
                    try {
                        return decodeURIComponent((targetUrl.match(/[?&]X-Plex-Token=([^&]+)/i) || [])[1] || '');
                    } catch {
                        return '';
                    }
                })()),
                'User-Agent': 'Server Manager Portal',
                'Cache-Control': 'no-cache',
                Connection: 'close',
            }
            : { 'User-Agent': 'Server Manager Portal', 'Cache-Control': 'no-cache', Connection: 'close' };

        const request = lib.get(targetUrl, {
            headers: probeHeaders,
            timeout: 8000,
            rejectUnauthorized: true
        }, (response) => {
            response.resume();
            const latency = Math.round(Date.now() - start);
            const code = response.statusCode || 0;
            let status = (code >= 200 && code < 400) || code === 401 || code === 403 ? 'online' : (code >= 500 ? 'degraded' : 'offline');
            resolve({ status, latency, httpCode: code });
        });

        request.on('error', () => resolve({ status: 'offline', latency: 0, httpCode: 0 }));
        request.on('timeout', () => { request.destroy(); resolve({ status: 'offline', latency: 0, httpCode: 408 }); });
    });
}

const STATUS_RECENT_CHECKS_MAX = 5760; // ~24h at 15s
const STATUS_HOURLY_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const STATUS_DAILY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const STATUS_INCIDENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const STATUS_INCIDENTS_MAX = 200;

const statusHourKey = (ts) => {
    const d = new Date(ts);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const h = String(d.getUTCHours()).padStart(2, '0');
    return `${y}-${m}-${day}T${h}`;
};

const ensureHealthRecord = (serviceId) => {
    if (!healthData[serviceId]) {
        healthData[serviceId] = {
            serviceId,
            currentStatus: 'unknown',
            lastCheck: 0,
            dailyHistory: {},
            hourlyHistory: {},
            recentChecks: [],
            incidents: [],
            uptimePercentage: 100,
            lastLatency: null,
            lastHttpCode: null,
        };
    }
    const record = healthData[serviceId];
    if (!record.dailyHistory) record.dailyHistory = {};
    if (!record.hourlyHistory) record.hourlyHistory = {};
    if (!Array.isArray(record.recentChecks)) record.recentChecks = [];
    if (!Array.isArray(record.incidents)) record.incidents = [];
    return record;
};

const bumpHourlyBucket = (record, hourKey, { up = 0, down = 0, latency = null } = {}) => {
    if (!record.hourlyHistory[hourKey]) {
        record.hourlyHistory[hourKey] = { up: 0, down: 0, total: 0, latencySum: 0, latencyCount: 0 };
    }
    const bucket = record.hourlyHistory[hourKey];
    bucket.up += up;
    bucket.down += down;
    bucket.total += up + down;
    if (latency != null && Number.isFinite(latency) && latency > 0) {
        bucket.latencySum += latency;
        bucket.latencyCount += 1;
    }
};

const isUnhealthyStatus = (status) => status === 'offline' || status === 'degraded';

const recordStatusIncident = (record, previousStatus, nextStatus, now) => {
    if (!previousStatus || previousStatus === 'unknown' || previousStatus === nextStatus) return;

    const wasUnhealthy = isUnhealthyStatus(previousStatus);
    const isUnhealthy = isUnhealthyStatus(nextStatus);

    if (!wasUnhealthy && isUnhealthy) {
        record.incidents.push({
            id: `inc-${now}-${Math.random().toString(36).slice(2, 8)}`,
            from: previousStatus,
            to: nextStatus,
            startedAt: now,
            endedAt: null,
            durationMs: null,
        });
        if (record.incidents.length > STATUS_INCIDENTS_MAX) {
            record.incidents = record.incidents.slice(-STATUS_INCIDENTS_MAX);
        }
        return;
    }

    if (wasUnhealthy && !isUnhealthy) {
        for (let i = record.incidents.length - 1; i >= 0; i -= 1) {
            const incident = record.incidents[i];
            if (incident && incident.endedAt == null) {
                incident.endedAt = now;
                incident.durationMs = Math.max(0, now - (incident.startedAt || now));
                break;
            }
        }
        return;
    }

    if (wasUnhealthy && isUnhealthy && previousStatus !== nextStatus) {
        for (let i = record.incidents.length - 1; i >= 0; i -= 1) {
            const incident = record.incidents[i];
            if (incident && incident.endedAt == null) {
                incident.to = nextStatus;
                break;
            }
        }
    }
};

const pruneHealthRecord = (record, now) => {
    const dailyCutoff = now - STATUS_DAILY_RETENTION_MS;
    for (const dateStr of Object.keys(record.dailyHistory || {})) {
        if (new Date(`${dateStr}T00:00:00.000Z`).getTime() < dailyCutoff) {
            delete record.dailyHistory[dateStr];
        }
    }

    const hourlyCutoff = now - STATUS_HOURLY_RETENTION_MS;
    for (const hourKey of Object.keys(record.hourlyHistory || {})) {
        const hourTs = new Date(`${hourKey}:00:00.000Z`).getTime();
        if (!Number.isFinite(hourTs) || hourTs < hourlyCutoff) {
            delete record.hourlyHistory[hourKey];
        }
    }

    const recentCutoff = now - (24 * 60 * 60 * 1000);
    record.recentChecks = (record.recentChecks || []).filter((sample) => sample && sample.t >= recentCutoff);
    if (record.recentChecks.length > STATUS_RECENT_CHECKS_MAX) {
        record.recentChecks = record.recentChecks.slice(-STATUS_RECENT_CHECKS_MAX);
    }

    const incidentCutoff = now - STATUS_INCIDENT_RETENTION_MS;
    record.incidents = (record.incidents || []).filter((incident) => {
        if (!incident) return false;
        const end = incident.endedAt != null ? incident.endedAt : now;
        return end >= incidentCutoff;
    });
    if (record.incidents.length > STATUS_INCIDENTS_MAX) {
        record.incidents = record.incidents.slice(-STATUS_INCIDENTS_MAX);
    }
};

async function runMonitorCycle() {
    if (!statusConfig.services || statusConfig.services.length === 0) return;

    const now = Date.now();
    const todayStr = new Date(now).toISOString().split('T')[0];
    const hourKey = statusHourKey(now);

    if (!healthData._meta) {
        healthData._meta = { lastCheck: now };
    }

    const gapMs = now - healthData._meta.lastCheck;
    const cycleMs = 15000;

    if (gapMs > 120000) {
        const missedChecks = Math.floor(gapMs / cycleMs);

        for (const service of statusConfig.services) {
            const record = ensureHealthRecord(service.id);
            if (!record.dailyHistory[todayStr]) record.dailyHistory[todayStr] = { up: 0, down: 0, total: 0 };

            record.dailyHistory[todayStr].down += missedChecks;
            record.dailyHistory[todayStr].total += missedChecks;
            bumpHourlyBucket(record, hourKey, { down: missedChecks });
        }
    }

    for (const service of statusConfig.services) {
        const result = await performSingleProbe(service);
        const record = ensureHealthRecord(service.id);
        if (!record.dailyHistory[todayStr]) record.dailyHistory[todayStr] = { up: 0, down: 0, total: 0 };

        const previousStatus = record.currentStatus;
        record.currentStatus = result.status;
        record.lastCheck = now;
        record.lastLatency = Number.isFinite(result.latency) ? result.latency : null;
        record.lastHttpCode = Number.isFinite(result.httpCode) ? result.httpCode : null;

        const isOnline = result.status === 'online';
        if (isOnline) {
            record.dailyHistory[todayStr].up += 1;
            bumpHourlyBucket(record, hourKey, { up: 1, latency: result.latency });
        } else {
            record.dailyHistory[todayStr].down += 1;
            bumpHourlyBucket(record, hourKey, { down: 1 });
        }
        record.dailyHistory[todayStr].total += 1;

        record.recentChecks.push({
            t: now,
            status: result.status,
            latency: Number.isFinite(result.latency) ? result.latency : 0,
        });
        if (record.recentChecks.length > STATUS_RECENT_CHECKS_MAX) {
            record.recentChecks = record.recentChecks.slice(-STATUS_RECENT_CHECKS_MAX);
        }

        recordStatusIncident(record, previousStatus, result.status, now);
        pruneHealthRecord(record, now);

        let totalUp = 0;
        let totalChecks = 0;
        for (const stat of Object.values(record.dailyHistory)) {
            totalUp += stat.up || 0;
            totalChecks += stat.total || 0;
        }
        record.uptimePercentage = totalChecks > 0 ? Math.round((totalUp / totalChecks) * 100) : 100;
    }

    healthData._meta.lastCheck = now;
    saveHealthData();
}

const buildMediaStackMonthRange = (monthOffset = 0) => {
    const targetDate = new Date();
    targetDate.setMonth(targetDate.getMonth() + monthOffset);
    const firstDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
    const lastDay = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0);
    const toLocalYmd = (date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };
    const start = toLocalYmd(firstDay);
    const end = toLocalYmd(lastDay);
    const inTargetMonthRange = (dateValue) => {
        if (!dateValue) return false;
        const parsed = new Date(dateValue);
        if (Number.isNaN(parsed.getTime())) return false;
        const monthStart = new Date(firstDay);
        monthStart.setHours(0, 0, 0, 0);
        const monthEnd = new Date(lastDay);
        monthEnd.setHours(23, 59, 59, 999);
        return parsed >= monthStart && parsed <= monthEnd;
    };
    return { start, end, inTargetMonthRange };
};

const buildMediaStackInstanceSummary = async (instance, monthOffset = 0) => {
    if (!['sonarr', 'radarr'].includes(instance?.type)) {
        return {
            id: instance?.id || '',
            type: instance?.type || 'sonarr',
            name: instance?.name || 'ARR',
            isDefault: !!instance?.isDefault,
            configured: false,
            instanceName: instance?.name || 'ARR',
            status: null,
            queue: null,
            history: null,
            disk: null,
            calendar: [],
        };
    }
    const { start, end, inTargetMonthRange } = buildMediaStackMonthRange(monthOffset);
    const fetchArr = async (url, key, endpoint) => {
        if (!url || !key) return null;
        try {
            const safeBaseUrl = normalizeExternalBaseUrl(url, { allowPrivate: true, allowHttp: true });
            const u = new URL(endpoint, safeBaseUrl);
            const response = await fetch(u.toString(), {
                headers: { 'X-Api-Key': key }
            });
            if (!response.ok) return null;
            return await response.json();
        } catch {
            return null;
        }
    };

    const ready = isArrInstanceReady(instance);
    const type = instance?.type === 'radarr' ? 'radarr' : 'sonarr';
    if (!ready) {
        return {
            id: instance?.id || '',
            type,
            name: instance?.name || (type === 'radarr' ? 'Radarr' : 'Sonarr'),
            isDefault: !!instance?.isDefault,
            configured: false,
            instanceName: instance?.name || (type === 'radarr' ? 'Radarr' : 'Sonarr'),
            status: null,
            queue: null,
            history: null,
            disk: null,
            calendar: [],
        };
    }

    const calendarEndpoint = type === 'sonarr'
        ? `/api/v3/calendar?start=${start}&end=${end}&includeSeries=true&includeEpisode=true&unmonitored=true`
        : `/api/v3/calendar?start=${start}&end=${end}&unmonitored=true`;
    const historyEndpoint = type === 'sonarr'
        ? '/api/v3/history?page=1&pageSize=10&includeSeries=true&includeEpisode=true'
        : '/api/v3/history?page=1&pageSize=10&includeMovie=true';

    const [status, queue, history, disk, calendarRaw] = await Promise.all([
        fetchArr(instance.url, instance.apiKey, '/api/v3/system/status'),
        fetchArr(instance.url, instance.apiKey, '/api/v3/queue'),
        fetchArr(instance.url, instance.apiKey, historyEndpoint),
        fetchArr(instance.url, instance.apiKey, '/api/v3/diskspace'),
        fetchArr(instance.url, instance.apiKey, calendarEndpoint),
    ]);

    let calendar = Array.isArray(calendarRaw)
        ? calendarRaw
        : (Array.isArray(calendarRaw?.records) ? calendarRaw.records : []);

    if (calendar.length === 0) {
        if (type === 'sonarr') {
            const sonarrSeries = await fetchArr(instance.url, instance.apiKey, '/api/v3/series');
            if (Array.isArray(sonarrSeries)) {
                calendar = sonarrSeries
                    .filter((series) => inTargetMonthRange(series?.nextAiring))
                    .map((series) => ({
                        id: `fallback-sonarr-${instance.id}-${series.id}`,
                        title: 'Upcoming Episode',
                        airDateUtc: series.nextAiring,
                        airDate: series.nextAiring,
                        monitored: series.monitored !== false,
                        hasFile: false,
                        seasonNumber: 0,
                        episodeNumber: 0,
                        series: {
                            title: series.title || 'Unknown Series',
                            network: series.network || '',
                            images: Array.isArray(series.images) ? series.images : []
                        }
                    }));
            }
        } else {
            const radarrMovies = await fetchArr(instance.url, instance.apiKey, '/api/v3/movie');
            if (Array.isArray(radarrMovies)) {
                calendar = radarrMovies
                    .map((movie) => {
                        const releaseDate = movie.digitalRelease || movie.physicalRelease || movie.inCinemas || movie.added || null;
                        return { ...movie, _releaseDate: releaseDate };
                    })
                    .filter((movie) => inTargetMonthRange(movie._releaseDate));
            }
        }
    }

    return {
        id: instance.id,
        type,
        name: instance.name || (type === 'radarr' ? 'Radarr' : 'Sonarr'),
        isDefault: !!instance.isDefault,
        configured: true,
        instanceName: instance.name || (type === 'radarr' ? 'Radarr' : 'Sonarr'),
        status,
        queue,
        history,
        disk,
        calendar,
    };
};

const buildMediaStackToolSummary = async (instance) => {
    const type = ['lidarr', 'bazarr'].includes(instance?.type) ? instance.type : 'lidarr';
    const label = instance?.name || (type === 'bazarr' ? 'Bazarr' : 'Lidarr');
    const ready = isArrInstanceReady(instance);
    if (!ready) {
        return {
            id: instance?.id || '',
            type,
            name: label,
            url: instance?.url || '',
            externalUrl: instance?.externalUrl || instance?.url || '',
            configured: false,
            status: null,
            version: null,
        };
    }

    try {
        const safeBaseUrl = normalizeExternalBaseUrl(instance.url, { allowPrivate: true, allowHttp: true }).replace(/\/+$/, '');
        const statusPath = type === 'bazarr'
            ? `/api/system/status?apikey=${encodeURIComponent(instance.apiKey)}`
            : '/api/v1/system/status';
        const response = await fetchWithTimeout(`${safeBaseUrl}${statusPath}`, {
            headers: {
                'X-Api-Key': instance.apiKey,
                'X-API-KEY': instance.apiKey,
                Accept: 'application/json',
            },
        }, 12000);
        if (!response.ok) {
            return {
                id: instance.id,
                type,
                name: label,
                url: instance.url,
                externalUrl: instance.externalUrl || instance.url,
                configured: true,
                status: null,
                version: null,
                error: `HTTP ${response.status}`,
            };
        }
        const data = await response.json().catch(() => ({}));
        const version = type === 'bazarr'
            ? (data?.data?.bazarr_version || data?.data?.package_version || data?.bazarr_version || data?.package_version || data?.version || null)
            : (data?.version || data?.data?.version || null);
        return {
            id: instance.id,
            type,
            name: label,
            url: instance.url,
            externalUrl: instance.externalUrl || instance.url,
            configured: true,
            status: data,
            version,
            error: null,
        };
    } catch (error) {
        return {
            id: instance.id,
            type,
            name: label,
            url: instance.url,
            externalUrl: instance.externalUrl || instance.url,
            configured: true,
            status: null,
            version: null,
            error: error.message || 'Unavailable',
        };
    }
};

const buildMediaStackAggregates = (instances = []) => {
    const aggregateForType = (type) => {
        const typed = instances.filter((entry) => entry.type === type);
        const queueCount = typed.reduce((sum, entry) => sum + (Array.isArray(entry?.queue?.records) ? entry.queue.records.length : 0), 0);
        const onlineCount = typed.filter((entry) => !!entry?.status).length;
        return {
            instanceCount: typed.length,
            configuredCount: typed.filter((entry) => entry.configured).length,
            onlineCount,
            queueCount,
        };
    };
    return {
        sonarr: aggregateForType('sonarr'),
        radarr: aggregateForType('radarr'),
    };
};

app.get('/api/media-stack/summary', requireAuth, requireMember, async (req, res) => {
    try {
        const monthOffset = parseInt(req.query.monthOffset) || 0;
        const instanceId = String(req.query.instanceId || '').trim();
        const cacheKey = instanceId
            ? `media-stack-summary-${instanceId}-offset-${monthOffset}`
            : `media-stack-summary-offset-${monthOffset}`;
        const data = await withCache(cacheKey, 60000, async () => {
            const config = normalizeArrConfig(await loadFile(CONFIG_PATH, {}));
            const allEnabledInstances = getArrInstances(config, { enabledOnly: true });
            const enabledInstances = allEnabledInstances
                .filter((entry) => entry.type === 'sonarr' || entry.type === 'radarr');
            const toolInstances = allEnabledInstances
                .filter((entry) => entry.type === 'lidarr' || entry.type === 'bazarr');

            if (instanceId) {
                const selected = getArrInstance(config, instanceId);
                if (!selected || !['sonarr', 'radarr'].includes(selected.type)) {
                    return { error: 'ARR instance not found.' };
                }
                const summary = await buildMediaStackInstanceSummary(selected, monthOffset);
                return {
                    sonarr: summary.type === 'sonarr' ? summary : { configured: false, calendar: [] },
                    radarr: summary.type === 'radarr' ? summary : { configured: false, calendar: [] },
                    instances: [summary],
                    aggregates: buildMediaStackAggregates([summary]),
                    tools: await Promise.all(toolInstances.map(buildMediaStackToolSummary)),
                };
            }

            const [instanceSummaries, toolSummaries] = await Promise.all([
                Promise.all(enabledInstances.map((instance) => buildMediaStackInstanceSummary(instance, monthOffset))),
                Promise.all(toolInstances.map(buildMediaStackToolSummary)),
            ]);
            const defaultSonarr = instanceSummaries.find((entry) => entry.type === 'sonarr' && entry.isDefault)
                || instanceSummaries.find((entry) => entry.type === 'sonarr')
                || { configured: false, calendar: [], instanceName: 'Sonarr' };
            const defaultRadarr = instanceSummaries.find((entry) => entry.type === 'radarr' && entry.isDefault)
                || instanceSummaries.find((entry) => entry.type === 'radarr')
                || { configured: false, calendar: [], instanceName: 'Radarr' };

            return {
                sonarr: defaultSonarr,
                radarr: defaultRadarr,
                instances: instanceSummaries,
                aggregates: buildMediaStackAggregates(instanceSummaries),
                tools: toolSummaries,
            };
        });
        if (data?.error) {
            return res.status(404).json({ error: data.error });
        }
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch media stack summary' });
    }
});

app.get('/api/media-stack/trending', requireAuth, requireMember, async (req, res) => {
    const stats = await loadFile(TRENDING_CACHE_PATH, { movies: 0, series: 0 });
    res.json(stats);
});

const fetchBazarrJson = async (instance, endpoint) => {
    if (!isArrInstanceReady(instance)) return null;
    const safeBaseUrl = normalizeExternalBaseUrl(instance.url, { allowPrivate: true, allowHttp: true }).replace(/\/+$/, '');
    const joiner = endpoint.includes('?') ? '&' : '?';
    const response = await fetchWithTimeout(`${safeBaseUrl}${endpoint}${joiner}apikey=${encodeURIComponent(instance.apiKey)}`, {
        headers: {
            'X-Api-Key': instance.apiKey,
            'X-API-KEY': instance.apiKey,
            Accept: 'application/json',
        },
    }, 12000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json().catch(() => null);
};

app.get('/api/bazarr/widgets', requireAuth, requireMember, async (req, res) => {
    try {
        const config = normalizeArrConfig(await loadFile(CONFIG_PATH, {}));
        const instances = getArrInstances(config, { type: 'bazarr', enabledOnly: true }).filter(isArrInstanceReady);
        const summaries = await Promise.all(instances.map(async (instance) => {
            const name = instance.name || 'Bazarr';
            try {
                const [statusPayload, badgesPayload] = await Promise.all([
                    fetchBazarrJson(instance, '/api/system/status').catch((error) => ({ error: error.message })),
                    fetchBazarrJson(instance, '/api/badges').catch((error) => ({ error: error.message })),
                ]);
                const version = statusPayload?.data?.bazarr_version
                    || statusPayload?.data?.package_version
                    || statusPayload?.bazarr_version
                    || statusPayload?.package_version
                    || statusPayload?.version
                    || null;
                return {
                    id: instance.id,
                    name,
                    url: instance.externalUrl || instance.url,
                    configured: true,
                    online: !statusPayload?.error && !badgesPayload?.error,
                    version,
                    wantedEpisodes: Number(badgesPayload?.episodes) || 0,
                    wantedMovies: Number(badgesPayload?.movies) || 0,
                    providers: Number(badgesPayload?.providers) || 0,
                    statusCount: Number(badgesPayload?.status) || 0,
                    sonarrSignalr: badgesPayload?.sonarr_signalr || null,
                    radarrSignalr: badgesPayload?.radarr_signalr || null,
                    announcements: Number(badgesPayload?.announcements) || 0,
                    error: statusPayload?.error || badgesPayload?.error || null,
                };
            } catch (error) {
                return {
                    id: instance.id,
                    name,
                    url: instance.externalUrl || instance.url,
                    configured: true,
                    online: false,
                    version: null,
                    wantedEpisodes: 0,
                    wantedMovies: 0,
                    providers: 0,
                    statusCount: 0,
                    sonarrSignalr: null,
                    radarrSignalr: null,
                    announcements: 0,
                    error: error.message || 'Unavailable',
                };
            }
        }));
        const totals = summaries.reduce((acc, entry) => {
            acc.wantedEpisodes += Number(entry.wantedEpisodes) || 0;
            acc.wantedMovies += Number(entry.wantedMovies) || 0;
            acc.providers += Number(entry.providers) || 0;
            acc.announcements += Number(entry.announcements) || 0;
            acc.online += entry.online ? 1 : 0;
            return acc;
        }, { wantedEpisodes: 0, wantedMovies: 0, providers: 0, announcements: 0, online: 0 });
        res.json({ configured: summaries.length > 0, instances: summaries, totals });
    } catch (e) {
        res.status(500).json({ error: `Failed to load Bazarr widgets: ${e.message}` });
    }
});

const normalizeDownloadMatchKey = (value = '') => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^urn:btih:/, '');

const normalizeDownloadTitleKey = (value = '') => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\([^)]*\b(?:1080p|720p|2160p|480p|x264|x265|h\.?264|h\.?265|hevc|web[- .]?dl|bluray|webrip)\b[^)]*\)/gi, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:1080p|720p|2160p|480p|x264|x265|h264|h265|hevc|web|dl|webdl|bluray|webrip|proper|repack|extended)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const classifyDownloadSource = (torrent = {}) => {
    const haystack = [
        torrent.category,
        torrent.label,
        torrent.tags,
        torrent.savePath,
        torrent.downloadDir,
        torrent.contentPath,
        torrent.name,
        torrent.tracker,
    ].map((v) => String(v || '').toLowerCase()).join(' ');
    if (/\b(lidarr|music|albums?)\b/.test(haystack) || /[\\/](music|albums?)([\\/]|$)/.test(haystack)) return 'lidarr';
    if (/\b(radarr|movies?|films?)\b/.test(haystack) || /[\\/](movies?|films?)([\\/]|$)/.test(haystack)) return 'radarr';
    if (/\b(sonarr|tv|shows?|series)\b/.test(haystack) || /[\\/](tv|shows?|series)([\\/]|$)/.test(haystack)) return 'sonarr';
    return 'unknown';
};

const buildDownloadArrMatcher = async (config = {}) => {
    const instances = getArrInstances(config, { enabledOnly: true })
        .filter((instance) => ['sonarr', 'radarr', 'lidarr'].includes(instance.type))
        .filter(isArrInstanceReady);
    if (!instances.length) return null;

    const byId = new Map();
    const byTitle = new Map();
    const queueResults = await Promise.all(instances.map(async (instance) => {
        try {
            const summary = await fetchArrQueueSummary(instance, { resolveUrl: resolveIntegrationUrlForFetch, fetchImpl: fetch });
            return { instance, records: Array.isArray(summary.records) ? summary.records : [] };
        } catch (error) {
            log(`Download status ${instance.name || instance.type} queue match failed: ${error.message}`);
            return { instance, records: [] };
        }
    }));

    queueResults.forEach(({ instance, records }) => {
        records.forEach((record) => {
            const source = instance.type;
            const metadata = {
                source,
                arrInstanceId: instance.id,
                arrInstanceName: instance.name || downloadClientLabel(source),
                arrTitle: record.title || record.sourceTitle || record.movie?.title || record.series?.title || record.artist?.artistName || null,
                sourceReason: 'arr_queue',
            };
            [
                record.downloadId,
                record.downloadClientId,
                record.downloadClientItemId,
                record.hash,
                record.infoHash,
                record.trackedDownload?.downloadId,
                record.trackedDownload?.downloadClientId,
            ].forEach((value) => {
                const key = normalizeDownloadMatchKey(value);
                if (key) byId.set(key, metadata);
            });
            [
                record.title,
                record.sourceTitle,
                record.trackedDownload?.title,
            ].forEach((value) => {
                const key = normalizeDownloadTitleKey(value);
                if (key) byTitle.set(key, metadata);
            });
        });
    });

    return (torrent = {}) => {
        const idKeys = [
            torrent.id,
            torrent.hash,
            torrent.infoHash,
            torrent.downloadId,
        ].map(normalizeDownloadMatchKey).filter(Boolean);
        for (const key of idKeys) {
            if (byId.has(key)) return byId.get(key);
        }

        const titleKey = normalizeDownloadTitleKey(torrent.name);
        if (titleKey && byTitle.has(titleKey)) return byTitle.get(titleKey);
        return null;
    };
};

const normalizeTorrentItem = (client, raw = {}) => {
    const size = Number(raw.size ?? raw.totalSize ?? raw.total_size ?? raw.length ?? 0) || 0;
    const downloaded = Number(raw.downloaded ?? raw.downloadedEver ?? raw.completed ?? 0) || 0;
    const progressRaw = raw.progress ?? raw.percentDone ?? (size > 0 ? downloaded / size : 0);
    const progress = Math.max(0, Math.min(100, Number(progressRaw) <= 1 ? Number(progressRaw || 0) * 100 : Number(progressRaw || 0)));
    const item = {
        id: String(raw.hash || raw.hashString || raw.id || raw.infoHash || raw.downloadId || raw.name || Math.random()),
        hash: raw.hash || raw.hashString || raw.infoHash || '',
        infoHash: raw.infoHash || raw.hashString || raw.hash || '',
        downloadId: raw.downloadId || raw.downloadClientId || raw.downloadClientItemId || '',
        clientId: client.id,
        clientName: client.name || downloadClientLabel(client.type),
        clientType: client.type,
        name: raw.name || raw.title || 'Unknown download',
        state: raw.state || raw.status || raw.statusText || '',
        progress,
        size,
        downloaded,
        downloadSpeed: Number(raw.dlspeed ?? raw.rateDownload ?? raw.downloadSpeed ?? 0) || 0,
        uploadSpeed: Number(raw.upspeed ?? raw.rateUpload ?? raw.uploadSpeed ?? 0) || 0,
        eta: Number(raw.eta ?? raw.etaTime ?? raw.secondsDownloading ?? -1) || -1,
        category: raw.category || raw.label || '',
        tags: raw.tags || '',
        savePath: raw.save_path || raw.savePath || raw.downloadDir || '',
        contentPath: raw.content_path || raw.contentPath || raw.path || '',
        addedOn: raw.added_on || raw.addedDate || raw.dateAdded || null,
    };
    return { ...item, source: classifyDownloadSource(item), sourceReason: 'client_metadata' };
};

const fetchQbitTorrents = async (client) => {
    const base = resolveIntegrationUrlForFetch(client.url).replace(/\/+$/, '');
    const loginRes = await fetchWithTimeout(`${base}/api/v2/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: client.username || '', password: client.password || '' }).toString(),
    }, 12000);
    if (!loginRes.ok) throw new Error(`login HTTP ${loginRes.status}`);
    const cookie = loginRes.headers.get('set-cookie') || '';
    const torrentsRes = await fetchWithTimeout(`${base}/api/v2/torrents/info`, {
        headers: { Cookie: cookie, Accept: 'application/json' },
    }, 12000);
    if (!torrentsRes.ok) throw new Error(`torrents HTTP ${torrentsRes.status}`);
    return (await torrentsRes.json()).map((entry) => normalizeTorrentItem(client, entry));
};

const qbitCookie = async (client) => {
    const base = resolveIntegrationUrlForFetch(client.url).replace(/\/+$/, '');
    const loginRes = await fetchWithTimeout(`${base}/api/v2/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: client.username || '', password: client.password || '' }).toString(),
    }, 12000);
    if (!loginRes.ok) throw new Error(`login HTTP ${loginRes.status}`);
    return loginRes.headers.get('set-cookie') || '';
};

const controlQbitTorrent = async (client, action, id) => {
    const base = resolveIntegrationUrlForFetch(client.url).replace(/\/+$/, '');
    const cookie = await qbitCookie(client);
    const endpoints = action === 'pause'
        ? ['pause', 'stop']
        : action === 'resume'
            ? ['resume', 'start']
            : ['delete'];
    const body = action === 'remove'
        ? new URLSearchParams({ hashes: id, deleteFiles: 'false' })
        : new URLSearchParams({ hashes: id });
    let lastStatus = 0;
    for (const endpoint of endpoints) {
        const response = await fetchWithTimeout(`${base}/api/v2/torrents/${endpoint}`, {
            method: 'POST',
            headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        }, 12000);
        if (response.ok) return;
        lastStatus = response.status;
        if (response.status !== 404) break;
    }
    throw new Error(`qBittorrent ${action} HTTP ${lastStatus}`);
};

const normalizeDownloadCategory = (value) => String(value || '').trim().slice(0, 80);

const arrDownloadClientCategoryValue = (client = {}) => {
    const direct = [
        client.category,
        client.tvCategory,
        client.movieCategory,
    ].map(normalizeDownloadCategory).find(Boolean);
    if (direct) return direct;

    const fields = Array.isArray(client.fields) ? client.fields : [];
    const categoryField = fields.find((field) => {
        const key = String(field?.name || field?.label || '').toLowerCase();
        return key.includes('category') && !key.includes('priority');
    });
    return normalizeDownloadCategory(categoryField?.value);
};

const fetchArrDownloadCategoryOptions = async (config = {}) => {
    const instances = getArrInstances(config, { enabledOnly: true })
        .filter((instance) => ['sonarr', 'radarr', 'lidarr'].includes(instance.type))
        .filter(isArrInstanceReady);
    if (!instances.length) return [];

    const results = await Promise.all(instances.map(async (instance) => {
        try {
            const clients = await fetchArrInstanceJson(instance, '/api/v3/downloadclient', {
                resolveUrl: resolveIntegrationUrlForFetch,
                fetchImpl: fetch,
            });
            return (Array.isArray(clients) ? clients : []).map((downloadClient) => {
                const value = arrDownloadClientCategoryValue(downloadClient);
                if (!value) return null;
                const arrLabel = instance.name || downloadClientLabel(instance.type);
                const clientName = downloadClient.name || downloadClient.implementationName || downloadClient.implementation || 'Download client';
                return { value, source: `${arrLabel} / ${clientName}` };
            }).filter(Boolean);
        } catch (error) {
            log(`Download category fetch failed for ${instance.name || instance.type}: ${error.message}`);
            return [];
        }
    }));

    const byValue = new Map();
    results.flat().forEach((entry) => {
        if (!byValue.has(entry.value)) byValue.set(entry.value, new Set());
        byValue.get(entry.value).add(entry.source);
    });
    return [...byValue.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([value, sources]) => {
            const sourceList = [...sources];
            return {
                value,
                label: sourceList.length ? `${value} (${sourceList.join(', ')})` : value,
                sources: sourceList,
            };
        });
};

const addQbitTorrentDownload = async (client, { url = '', fileBuffer = null, filename = 'upload.torrent', category = '' } = {}) => {
    const base = resolveIntegrationUrlForFetch(client.url).replace(/\/+$/, '');
    const cookie = await qbitCookie(client);
    const form = new FormData();
    const normalizedCategory = normalizeDownloadCategory(category);
    if (url) {
        form.append('urls', url);
    } else if (fileBuffer?.length) {
        form.append('torrents', new Blob([fileBuffer], { type: 'application/x-bittorrent' }), filename || 'upload.torrent');
    } else {
        throw new Error('Torrent URL or file is required');
    }
    if (normalizedCategory) form.append('category', normalizedCategory);
    const response = await fetchWithTimeout(`${base}/api/v2/torrents/add`, {
        method: 'POST',
        headers: { Cookie: cookie },
        body: form,
    }, 12000);
    if (!response.ok) throw new Error(`qBittorrent add HTTP ${response.status}`);
};

const transmissionRpc = async (client, body, sessionId = '') => {
    const base = resolveIntegrationUrlForFetch(client.url).replace(/\/+$/, '');
    const auth = client.username || client.password ? `Basic ${Buffer.from(`${client.username || ''}:${client.password || ''}`).toString('base64')}` : '';
    const response = await fetchWithTimeout(`${base}/transmission/rpc`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(auth ? { Authorization: auth } : {}),
            ...(sessionId ? { 'X-Transmission-Session-Id': sessionId } : {}),
        },
        body: JSON.stringify(body),
    }, 12000);
    if (response.status === 409 && !sessionId) {
        return transmissionRpc(client, body, response.headers.get('x-transmission-session-id') || '');
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
};

const fetchTransmissionTorrents = async (client) => {
    const payload = await transmissionRpc(client, {
        method: 'torrent-get',
        arguments: {
            fields: ['id', 'hashString', 'name', 'totalSize', 'percentDone', 'status', 'rateDownload', 'rateUpload', 'eta', 'downloadDir', 'labels', 'trackers', 'addedDate'],
        },
    });
    return (payload?.arguments?.torrents || []).map((entry) => normalizeTorrentItem(client, {
        ...entry,
        label: Array.isArray(entry.labels) ? entry.labels.join(',') : '',
        tracker: Array.isArray(entry.trackers) ? entry.trackers.map((t) => t.announce).join(' ') : '',
    }));
};

const controlTransmissionTorrent = async (client, action, id) => {
    const method = action === 'pause' ? 'torrent-stop' : action === 'resume' ? 'torrent-start' : 'torrent-remove';
    const args = { ids: [Number.isFinite(Number(id)) ? Number(id) : String(id)] };
    if (action === 'remove') args['delete-local-data'] = false;
    const payload = await transmissionRpc(client, { method, arguments: args });
    if (payload?.result && payload.result !== 'success') throw new Error(payload.result);
};

const addTransmissionDownload = async (client, { url = '', fileBuffer = null, category = '' } = {}) => {
    const argumentsPayload = url
        ? { filename: url }
        : { metainfo: Buffer.from(fileBuffer || Buffer.alloc(0)).toString('base64') };
    if (!url && !fileBuffer?.length) throw new Error('Torrent URL or file is required');
    const normalizedCategory = normalizeDownloadCategory(category);
    if (normalizedCategory) argumentsPayload.labels = [normalizedCategory];
    const payload = await transmissionRpc(client, { method: 'torrent-add', arguments: argumentsPayload });
    if (payload?.result && payload.result !== 'success') throw new Error(payload.result);
};

const fetchBitTorrentTorrents = async (client) => {
    const base = resolveIntegrationUrlForFetch(client.url).replace(/\/+$/, '');
    const auth = client.username || client.password ? `Basic ${Buffer.from(`${client.username || ''}:${client.password || ''}`).toString('base64')}` : '';
    const response = await fetchWithTimeout(`${base}/gui/?action=get`, {
        headers: { ...(auth ? { Authorization: auth } : {}), Accept: 'application/json' },
    }, 12000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return (data?.torrents || []).map((row) => normalizeTorrentItem(client, {
        hash: row[0],
        name: row[2],
        size: row[3],
        progress: Number(row[4] || 0) / 10,
        downloaded: row[5],
        uploadSpeed: row[8],
        downloadSpeed: row[9],
        eta: row[10],
        label: row[11],
    }));
};

const controlBitTorrent = async (client, action, id) => {
    const base = resolveIntegrationUrlForFetch(client.url).replace(/\/+$/, '');
    const auth = client.username || client.password ? `Basic ${Buffer.from(`${client.username || ''}:${client.password || ''}`).toString('base64')}` : '';
    const command = action === 'pause' ? 'pause' : action === 'resume' ? 'start' : 'remove';
    const response = await fetchWithTimeout(`${base}/gui/?action=${command}&hash=${encodeURIComponent(id)}`, {
        headers: { ...(auth ? { Authorization: auth } : {}), Accept: 'application/json' },
    }, 12000);
    if (!response.ok) throw new Error(`BitTorrent ${action} HTTP ${response.status}`);
};

const addBitTorrentDownload = async (client, { url = '', fileBuffer = null, category = '' } = {}) => {
    if (fileBuffer?.length) throw new Error('BitTorrent file upload is not supported by this API. Use a torrent URL or magnet link.');
    if (!url) throw new Error('Torrent URL is required');
    const base = resolveIntegrationUrlForFetch(client.url).replace(/\/+$/, '');
    const auth = client.username || client.password ? `Basic ${Buffer.from(`${client.username || ''}:${client.password || ''}`).toString('base64')}` : '';
    const params = new URLSearchParams({ action: 'add-url', s: url });
    const normalizedCategory = normalizeDownloadCategory(category);
    if (normalizedCategory) params.set('label', normalizedCategory);
    const response = await fetchWithTimeout(`${base}/gui/?${params.toString()}`, {
        headers: { ...(auth ? { Authorization: auth } : {}), Accept: 'application/json' },
    }, 12000);
    if (!response.ok) throw new Error(`BitTorrent add HTTP ${response.status}`);
};

const delugeRpc = async (client, method, params = [], cookie = '') => {
    const base = resolveIntegrationUrlForFetch(client.url).replace(/\/+$/, '');
    const response = await fetchWithTimeout(`${base}/json`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify({
            id: Date.now(),
            method,
            params,
        }),
    }, 12000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json().catch(() => ({}));
    if (data?.error) throw new Error(data.error.message || data.error || 'Deluge API error');
    return { data, cookie: response.headers.get('set-cookie') || cookie };
};

const fetchDelugeTorrents = async (client) => {
    const password = client.password || client.username || '';
    const login = await delugeRpc(client, 'auth.login', [password]);
    if (login.data?.result !== true) throw new Error('login failed');
    const fields = [
        'name',
        'total_size',
        'total_done',
        'progress',
        'download_payload_rate',
        'upload_payload_rate',
        'eta',
        'state',
        'label',
        'save_path',
        'time_added',
    ];
    const torrents = await delugeRpc(client, 'core.get_torrents_status', [{}, fields], login.cookie);
    return Object.entries(torrents.data?.result || {}).map(([hash, entry]) => normalizeTorrentItem(client, {
        hash,
        name: entry.name,
        size: entry.total_size,
        downloaded: entry.total_done,
        progress: entry.progress,
        downloadSpeed: entry.download_payload_rate,
        uploadSpeed: entry.upload_payload_rate,
        eta: entry.eta,
        state: entry.state,
        label: entry.label,
        savePath: entry.save_path,
        addedDate: entry.time_added,
    }));
};

const delugeLogin = async (client) => {
    const password = client.password || client.username || '';
    const login = await delugeRpc(client, 'auth.login', [password]);
    if (login.data?.result !== true) throw new Error('login failed');
    return login.cookie;
};

const isDelugeMissingTorrentError = (error) => {
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('invalidtorrenterror') || message.includes('not in session');
};

const controlDelugeTorrent = async (client, action, id) => {
    const cookie = await delugeLogin(client);
    const method = action === 'pause' ? 'core.pause_torrent' : action === 'resume' ? 'core.resume_torrent' : 'core.remove_torrent';
    const params = action === 'remove' ? [id, false] : [[id]];
    try {
        await delugeRpc(client, method, params, cookie);
    } catch (error) {
        if (isDelugeMissingTorrentError(error)) return;
        throw error;
    }
};

const addDelugeDownload = async (client, { url = '', fileBuffer = null, filename = 'upload.torrent', category = '' } = {}) => {
    const cookie = await delugeLogin(client);
    const normalizedCategory = normalizeDownloadCategory(category);
    const applyLabel = async (torrentId) => {
        if (!normalizedCategory || !torrentId) return;
        try {
            await delugeRpc(client, 'label.add', [normalizedCategory], cookie);
        } catch (error) {
            // Label may already exist or the plugin may not expose add; setting it below is the real check.
        }
        try {
            await delugeRpc(client, 'label.set_torrent', [torrentId, normalizedCategory], cookie);
        } catch (error) {
            log(`Deluge label assignment skipped: ${error.message}`);
        }
    };
    if (url) {
        const result = await delugeRpc(client, 'core.add_torrent_url', [url, {}], cookie);
        await applyLabel(result.data?.result);
        return;
    }
    if (!fileBuffer?.length) throw new Error('Torrent URL or file is required');
    const result = await delugeRpc(client, 'core.add_torrent_file', [filename || 'upload.torrent', Buffer.from(fileBuffer).toString('base64'), {}], cookie);
    await applyLabel(result.data?.result);
};

const parseSabSize = (value) => {
    if (typeof value === 'number') return value;
    const match = String(value || '').trim().match(/^([\d.]+)\s*([kmgtp]?b)?$/i);
    if (!match) return 0;
    const amount = Number(match[1]) || 0;
    const unit = String(match[2] || 'b').toLowerCase();
    const multiplier = {
        b: 1,
        kb: 1024,
        mb: 1024 ** 2,
        gb: 1024 ** 3,
        tb: 1024 ** 4,
        pb: 1024 ** 5,
    }[unit] || 1;
    return amount * multiplier;
};

const parseSabSpeed = (value) => {
    const text = String(value || '').trim().replace(/\/s$/i, '');
    return parseSabSize(text);
};

const parseSabMegabytes = (value) => {
    if (value == null || value === '') return 0;
    const text = String(value).trim();
    if (/[kmgtp]?b/i.test(text)) return parseSabSize(text);
    return (Number(text) || 0) * 1024 * 1024;
};

const fetchSabnzbdDownloads = async (client) => {
    const base = resolveIntegrationUrlForFetch(client.url).replace(/\/+$/, '');
    const apiKey = String(client.password || '').trim();
    const params = new URLSearchParams({ mode: 'queue', output: 'json' });
    if (apiKey) params.set('apikey', apiKey);
    const auth = client.username ? `Basic ${Buffer.from(`${client.username}:${client.password || ''}`).toString('base64')}` : '';
    const response = await fetchWithTimeout(`${base}/api?${params.toString()}`, {
        headers: { Accept: 'application/json', ...(auth ? { Authorization: auth } : {}) },
    }, 12000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json().catch(() => ({}));
    const queue = data?.queue || {};
    return (Array.isArray(queue.slots) ? queue.slots : []).map((entry) => {
        const size = entry.mb != null ? parseSabMegabytes(entry.mb) : parseSabSize(entry.size || entry.sizeleft);
        const remaining = entry.mbleft != null ? parseSabMegabytes(entry.mbleft) : parseSabSize(entry.sizeleft);
        const downloaded = Math.max(0, size - remaining);
        const progress = Number(entry.percentage ?? entry.progress ?? (size > 0 ? (downloaded / size) * 100 : 0)) || 0;
        return normalizeTorrentItem(client, {
            id: entry.nzo_id || entry.nzbid || entry.id || entry.filename,
            downloadId: entry.nzo_id || entry.nzbid || entry.id || '',
            name: entry.filename || entry.name || 'Unknown NZB',
            size,
            downloaded,
            progress,
            downloadSpeed: parseSabSpeed(queue.speed || entry.speed),
            eta: Number(entry.timeleft || entry.eta || -1) || -1,
            status: entry.status || queue.status || '',
            category: entry.cat || entry.category || '',
            savePath: entry.storage || '',
            addedDate: entry.avg_age || null,
        });
    });
};

const sabnzbdApiUrl = (client, params) => {
    const base = resolveIntegrationUrlForFetch(client.url).replace(/\/+$/, '');
    const apiKey = String(client.password || '').trim();
    const query = new URLSearchParams({ output: 'json', ...params });
    if (apiKey) query.set('apikey', apiKey);
    return `${base}/api?${query.toString()}`;
};

const sabnzbdAuthHeaders = (client) => {
    const auth = client.username ? `Basic ${Buffer.from(`${client.username}:${client.password || ''}`).toString('base64')}` : '';
    return { Accept: 'application/json', ...(auth ? { Authorization: auth } : {}) };
};

const controlSabnzbdDownload = async (client, action, id) => {
    const name = action === 'pause' ? 'pause' : action === 'resume' ? 'resume' : 'delete';
    const response = await fetchWithTimeout(sabnzbdApiUrl(client, { mode: 'queue', name, value: id }), {
        headers: sabnzbdAuthHeaders(client),
    }, 12000);
    if (!response.ok) throw new Error(`SABnzbd ${action} HTTP ${response.status}`);
    const data = await response.json().catch(() => ({}));
    if (data?.status === false) throw new Error(`SABnzbd ${action} failed`);
};

const nzbgetAuthHeaders = (client) => {
    const username = String(client.username || '').trim();
    const password = String(client.password || '');
    const auth = username ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` : '';
    return { Accept: 'application/json', 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) };
};

const nzbgetRpc = async (client, method, params = []) => {
    const base = resolveIntegrationUrlForFetch(client.url).replace(/\/+$/, '');
    const response = await fetchWithTimeout(`${base}/jsonrpc`, {
        method: 'POST',
        headers: nzbgetAuthHeaders(client),
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    }, 12000);
    if (!response.ok) throw new Error(`NZBGet ${method} HTTP ${response.status}`);
    const data = await response.json().catch(() => ({}));
    if (data?.error) {
        const message = data.error.message || data.error.code || 'RPC error';
        throw new Error(`NZBGet ${method} failed: ${message}`);
    }
    return data?.result;
};

const nzbgetMbToBytes = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number * 1024 * 1024 : 0;
};

const fetchNzbgetDownloads = async (client) => {
    const [groups, status] = await Promise.all([
        nzbgetRpc(client, 'listgroups', [0]),
        nzbgetRpc(client, 'status', []).catch(() => ({})),
    ]);
    const downloadRate = Number(status?.DownloadRate || status?.DownloadLimit || 0) || 0;
    return (Array.isArray(groups) ? groups : []).map((entry) => {
        const size = nzbgetMbToBytes(entry.FileSizeMB);
        const remaining = nzbgetMbToBytes(entry.RemainingSizeMB);
        const downloaded = Math.max(0, size - remaining);
        const progress = size > 0 ? (downloaded / size) * 100 : Number(entry.Progress || 0);
        const statusText = String(entry.Status || '').toLowerCase();
        return normalizeTorrentItem(client, {
            id: entry.NZBID,
            downloadId: entry.NZBID,
            name: entry.NZBName || entry.NZBFilename || `NZB ${entry.NZBID}`,
            size,
            downloaded,
            progress,
            downloadSpeed: statusText === 'downloading' ? downloadRate : 0,
            eta: Number(entry.RemainingTimeSec ?? entry.DownloadTimeSec ?? -1) || -1,
            status: entry.Status || '',
            category: entry.Category || '',
            savePath: entry.DestDir || entry.FinalDir || '',
            addedDate: entry.MinPostTime || null,
        });
    });
};

const controlNzbgetDownload = async (client, action, id) => {
    const nzbId = Number(id);
    if (!Number.isFinite(nzbId) || nzbId <= 0) throw new Error('NZBGet download id must be a positive number');
    const command = action === 'pause'
        ? 'GroupPause'
        : action === 'resume'
            ? 'GroupResume'
            : 'GroupDelete';
    const result = await nzbgetRpc(client, 'editqueue', [command, '', [nzbId]]);
    if (result !== true) throw new Error(`NZBGet ${action} failed`);
};

const addNzbgetDownload = async (client, { url = '', fileBuffer = null, filename = 'upload.nzb', category = '' } = {}) => {
    const normalizedCategory = normalizeDownloadCategory(category);
    const content = fileBuffer ? Buffer.from(fileBuffer).toString('base64') : String(url || '').trim();
    const nzbFilename = fileBuffer ? (filename || 'upload.nzb') : '';
    if (!content) throw new Error('NZB URL or NZB file is required.');
    const result = await nzbgetRpc(client, 'append', [
        nzbFilename,
        content,
        normalizedCategory,
        0,
        false,
        false,
        '',
        0,
        'SCORE',
        true,
        [],
    ]);
    if (!(Number(result) > 0)) throw new Error('NZBGet append failed');
};

const fetchDownloadClientTorrents = async (client) => {
    if (client.type === 'sabnzbd') return fetchSabnzbdDownloads(client);
    if (client.type === 'nzbget') return fetchNzbgetDownloads(client);
    if (client.type === 'transmission') return fetchTransmissionTorrents(client);
    if (client.type === 'bittorrent') return fetchBitTorrentTorrents(client);
    if (client.type === 'deluge') return fetchDelugeTorrents(client);
    return fetchQbitTorrents(client);
};

const controlDownloadClientItem = async (client, action, id) => {
    if (!['pause', 'resume', 'remove'].includes(action)) throw new Error('Unsupported download action');
    const downloadId = String(id || '').trim();
    if (!downloadId) throw new Error('Download id is required');
    if (client.type === 'sabnzbd') return controlSabnzbdDownload(client, action, downloadId);
    if (client.type === 'nzbget') return controlNzbgetDownload(client, action, downloadId);
    if (client.type === 'transmission') return controlTransmissionTorrent(client, action, downloadId);
    if (client.type === 'bittorrent') return controlBitTorrent(client, action, downloadId);
    if (client.type === 'deluge') return controlDelugeTorrent(client, action, downloadId);
    return controlQbitTorrent(client, action, downloadId);
};

const addDownloadClientItem = async (client, payload = {}) => {
    if (client.type === 'sabnzbd') throw new Error('SABnzbd accepts NZB files, not torrent uploads.');
    if (client.type === 'nzbget') return addNzbgetDownload(client, payload);
    if (client.type === 'transmission') return addTransmissionDownload(client, payload);
    if (client.type === 'bittorrent') return addBitTorrentDownload(client, payload);
    if (client.type === 'deluge') return addDelugeDownload(client, payload);
    return addQbitTorrentDownload(client, payload);
};

const getConfiguredDownloadClient = async (clientId) => {
    const config = await loadFile(CONFIG_PATH, {});
    return (Array.isArray(config.downloadClients) ? config.downloadClients : [])
        .find((entry) => String(entry.id || '') === String(clientId || '') && entry.enabled !== false && entry.url);
};

app.post('/api/downloads/add-url', requireAdmin, async (req, res) => {
    try {
        const { clientId, url, category } = req.body || {};
        const downloadUrl = String(url || '').trim();
        if (!downloadUrl) return res.status(400).json({ error: 'Download URL or magnet link is required.' });
        const client = await getConfiguredDownloadClient(clientId);
        if (!client) return res.status(404).json({ error: 'Download client not found.' });
        await addDownloadClientItem(client, { url: downloadUrl, category });
        return res.json({ ok: true, message: `Sent download URL to ${client.name || downloadClientLabel(client.type)}.` });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Failed to add download URL.' });
    }
});

app.post('/api/downloads/add-file', requireAdmin, express.raw({ type: ['application/x-bittorrent', 'application/x-nzb', 'application/octet-stream'], limit: '5mb' }), async (req, res) => {
    try {
        const clientId = req.query.clientId || req.headers['x-download-client-id'];
        const filename = String(req.query.filename || req.headers['x-filename'] || 'upload.download').replace(/[^\w.\- ()]/g, '').slice(0, 180) || 'upload.download';
        const category = req.query.category || req.headers['x-download-category'] || '';
        const fileBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
        if (!fileBuffer.length) return res.status(400).json({ error: 'Download file is required.' });
        const client = await getConfiguredDownloadClient(clientId);
        if (!client) return res.status(404).json({ error: 'Download client not found.' });
        await addDownloadClientItem(client, { fileBuffer, filename, category });
        return res.json({ ok: true, message: `Sent download file to ${client.name || downloadClientLabel(client.type)}.` });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Failed to add download file.' });
    }
});

app.post('/api/downloads/control', requireAdmin, async (req, res) => {
    try {
        const { clientId, downloadId, action } = req.body || {};
        const client = await getConfiguredDownloadClient(clientId);
        if (!client) return res.status(404).json({ error: 'Download client not found.' });
        await controlDownloadClientItem(client, String(action || '').toLowerCase(), downloadId);
        return res.json({ ok: true, message: `${downloadClientLabel(client.type)} ${action} command sent.` });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Failed to control download.' });
    }
});

app.get('/api/downloads/status', requireAuth, requireMember, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const actor = getSessionActor(req.user);
        const viewerIsAdmin = await resolveCurrentAdmin(actor, config);
        if (!viewerIsAdmin && config.downloadsVisibleToMembers === false) {
            return res.status(403).json({ error: 'Downloads are not available for members.' });
        }
        const clients = (Array.isArray(config.downloadClients) ? config.downloadClients : []).filter((client) => client.enabled !== false && client.url);
        const [arrMatcher, downloadCategoryOptions] = await Promise.all([
            buildDownloadArrMatcher(config),
            viewerIsAdmin ? fetchArrDownloadCategoryOptions(config) : Promise.resolve([]),
        ]);
        const results = await Promise.all(clients.map(async (client) => {
            try {
                const torrents = await fetchDownloadClientTorrents(client);
                return { client: { id: client.id, name: client.name, type: client.type }, online: true, torrents, error: null };
            } catch (error) {
                return { client: { id: client.id, name: client.name, type: client.type }, online: false, torrents: [], error: error.message || 'Unavailable' };
            }
        }));
        const downloads = results.flatMap((entry) => entry.torrents).map((torrent) => {
            const arrMatch = arrMatcher ? arrMatcher(torrent) : null;
            const merged = arrMatch ? { ...torrent, ...arrMatch } : torrent;
            if (viewerIsAdmin) return merged;
            // Members may see progress for the badge/UI, but not release names/hashes/paths/magnets.
            const source = merged.source || 'unknown';
            const sourceLabel = source === 'unknown' ? 'Download' : `${source.charAt(0).toUpperCase()}${source.slice(1)} download`;
            return {
                id: merged.id,
                name: sourceLabel,
                state: merged.state,
                progress: merged.progress,
                size: merged.size,
                dlspeed: merged.dlspeed,
                upspeed: merged.upspeed,
                eta: merged.eta,
                source,
                clientId: merged.clientId,
                clientName: merged.clientName,
            };
        });
        res.json({
            clients: results.map(({ torrents, ...entry }) => ({ ...entry, count: torrents.length })),
            downloadCategoryOptions,
            downloads,
            counts: {
                total: downloads.length,
                sonarr: downloads.filter((entry) => entry.source === 'sonarr').length,
                radarr: downloads.filter((entry) => entry.source === 'radarr').length,
                lidarr: downloads.filter((entry) => entry.source === 'lidarr').length,
                unknown: downloads.filter((entry) => entry.source === 'unknown').length,
            },
        });
    } catch (e) {
        res.status(500).json({ error: `Failed to load download status: ${e.message}` });
    }
});

// (Endpoints moved up before wildcard route)

let isBuildingAnalyticsStats = false;
let isBuildingTrendingStats = false;

async function calculateAnalyticsStats() {
    if (isBuildingAnalyticsStats) {
        log('[AnalyticsStats] Build already in progress, skipping.');
        return;
    }
    isBuildingAnalyticsStats = true;
    try {
        markTaskStart(systemJobs.analyticsCache);
        const config = await loadFile(CONFIG_PATH, null);
        if (!config || !config.plexToken || !config.serverIdentifier) {
            markTaskEnd(systemJobs.analyticsCache, null);
            return;
        }
        
        const uri = await getPlexConnectionUri(config);
        if (!uri) {
            markTaskEnd(systemJobs.analyticsCache, null);
            return;
        }

        log('Starting background calculation of Plex Analytics Stats...');

        const pageSize = 5000;
        const maxHistoryItems = 250000;
        let historyItems = [];
        let start = 0;

        while (start < maxHistoryItems) {
            const pageRes = await fetch(
                `${uri}/status/sessions/history/all?X-Plex-Token=${config.plexToken}&sort=viewedAt:desc&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${pageSize}`,
                { headers: plexClientHeaders(config.plexToken) }
            ).then(r => r.json()).catch(() => null);

            const pageContainer = pageRes && pageRes.MediaContainer ? pageRes.MediaContainer : null;
            const pageItems = pageContainer && Array.isArray(pageContainer.Metadata) ? pageContainer.Metadata : [];
            if (pageItems.length === 0) break;

            historyItems = historyItems.concat(pageItems);
            start += pageItems.length;

            const totalSize = Number(pageContainer.totalSize || 0);
            if ((totalSize > 0 && start >= totalSize) || pageItems.length < pageSize) break;
        }

        if (historyItems.length >= maxHistoryItems) {
            log(`Analytics history fetch reached safety cap (${maxHistoryItems}). Results may be truncated.`);
        }

        const sectionsRes = await fetch(`${uri}/library/sections?X-Plex-Token=${config.plexToken}`, { headers: plexClientHeaders(config.plexToken) }).then(r => r.json()).catch(() => null);
        const accountsRes = await fetch(`${uri}/accounts?X-Plex-Token=${config.plexToken}`, { headers: plexClientHeaders(config.plexToken) }).then(r => r.json()).catch(() => null);
        const devicesRes = await fetch(`${uri}/devices?X-Plex-Token=${config.plexToken}`, { headers: plexClientHeaders(config.plexToken) }).then(r => r.json()).catch(() => null);
        const users = await loadFile(USERS_PATH, []);

        if (!Array.isArray(historyItems) || historyItems.length === 0) {
            markTaskEnd(systemJobs.analyticsCache, null);
            return;
        }

        const accountsMap = {};
        if (accountsRes && accountsRes.MediaContainer && accountsRes.MediaContainer.Account) {
            accountsRes.MediaContainer.Account.forEach(acc => accountsMap[acc.id] = { name: acc.name, thumb: acc.thumb });
        }

        const sectionsMap = {};
        if (sectionsRes && sectionsRes.MediaContainer && sectionsRes.MediaContainer.Directory) {
            sectionsRes.MediaContainer.Directory.forEach(s => sectionsMap[s.key] = s.title);
        }

        const devicesMap = {};
        if (devicesRes && devicesRes.MediaContainer && devicesRes.MediaContainer.Device) {
            devicesRes.MediaContainer.Device.forEach(d => devicesMap[d.id] = d.name || d.platform || 'Unknown Device');
        }

        const fetchRichMetadata = async (c) => {
            if (c.thumb) c.thumbUrl = plexImageUrl(c.thumb);
            try {
                const metadataId = c.key.split('/').pop();
                const metaRes = await fetch(`${uri}/library/metadata/${metadataId}?X-Plex-Token=${config.plexToken}`, { headers: plexClientHeaders(config.plexToken) }).then(r => r.json()).catch(() => null);
                if (metaRes && metaRes.MediaContainer && metaRes.MediaContainer.Metadata && metaRes.MediaContainer.Metadata.length > 0) {
                    const meta = metaRes.MediaContainer.Metadata[0];
                    c.summary = meta.summary || '';
                    c.year = meta.year || '';
                    c.rating = meta.rating || meta.audienceRating || '';
                    c.contentRating = meta.contentRating || '';
                    c.duration = meta.duration || 0;
                    c.genres = meta.Genre ? meta.Genre.map(g => g.tag) : [];
                }
            } catch (e) {}
            return c;
        };

        const timeframes = [1, 7, 30, 60, 90, 180, 365, 1825, 'all'];
        const statsData = {};
        const nowSec = Math.floor(Date.now() / 1000);
        const aggCtx = { accountsMap, sectionsMap, devicesMap, users, config };

        for (const days of timeframes) {
            const afterTs = days === 'all' ? 0 : nowSec - (days * 24 * 60 * 60);
            const windowStats = aggregateAnalyticsWindow(historyItems, { afterTs, beforeTs: null }, aggCtx, { includePortalUsers: true });

            const topMovies = await Promise.all(Object.values(windowStats.contentCountsMovies).sort((a, b) => b.plays - a.plays).slice(0, 10).map(fetchRichMetadata));
            const topShows = await Promise.all(Object.values(windowStats.contentCountsShows).sort((a, b) => b.plays - a.plays).slice(0, 10).map(fetchRichMetadata));
            const topMusic = await Promise.all(Object.values(windowStats.contentCountsMusic).sort((a, b) => b.plays - a.plays).slice(0, 10).map(fetchRichMetadata));

            const entry = {
                topUsers: windowStats.topUsers,
                topLibraries: windowStats.topLibraries,
                topMovies,
                topShows,
                topMusic,
                topDevices: windowStats.topDevices,
                peakHours: windowStats.peakHours,
                totalPlaybacks: windowStats.totalPlaybacks
            };

            if (days !== 'all') {
                const daySeconds = Number(days) * 24 * 60 * 60;
                const priorStats = aggregateAnalyticsWindow(
                    historyItems,
                    { afterTs: nowSec - daySeconds * 2, beforeTs: nowSec - daySeconds },
                    aggCtx,
                    { includePortalUsers: false }
                );
                entry.priorPeriod = {
                    totalPlaybacks: priorStats.totalPlaybacks,
                    topUsers: priorStats.topUsers,
                    topLibraries: priorStats.topLibraries
                };
            }

            statsData[days] = entry;
        }

        statsData.lastUpdated = Date.now();
        await saveFile(ANALYTICS_CACHE_PATH, statsData);
        log('Successfully calculated and cached Plex Analytics Stats.');
        markTaskEnd(systemJobs.analyticsCache, null);

    } catch (e) {
        log(`Error calculating analytics stats: ${e.message}`);
        markTaskEnd(systemJobs.analyticsCache, e);
    } finally {
        isBuildingAnalyticsStats = false;
    }
}

async function calculateTrendingStats() {
    if (isBuildingTrendingStats) {
        log('[TrendingStats] Build already in progress, skipping.');
        return;
    }
    isBuildingTrendingStats = true;
    try {
        markTaskStart(systemJobs.trendingCache);
        const config = await loadFile(CONFIG_PATH, null);
        if (!config || !config.plexToken || !config.serverIdentifier) {
            markTaskEnd(systemJobs.trendingCache, null);
            return;
        }

        const uri = await getPlexConnectionUri(config);
        if (!uri) {
            markTaskEnd(systemJobs.trendingCache, null);
            return;
        }

        log('Starting background calculation of Plex Trending Stats...');

        // Fetch up to 10,000 most recent history items
        const response = await fetch(`${uri}/status/sessions/history/all?sort=viewedAt%3Adesc&limit=10000&X-Plex-Token=${config.plexToken}`, { headers: plexClientHeaders(config.plexToken) }).catch(() => null);
        if (!response) {
            markTaskEnd(systemJobs.trendingCache, null);
            return;
        }
        const historyRes = await response.json().catch(() => null);
        if (!historyRes || !historyRes.MediaContainer || !historyRes.MediaContainer.Metadata) {
            log('No history found or failed to parse history JSON.');
            markTaskEnd(systemJobs.trendingCache, null);
            return;
        }

        const history = historyRes.MediaContainer.Metadata;

        const now = Date.now() / 1000;
        const days7 = now - (7 * 24 * 60 * 60);
        const days30 = now - (30 * 24 * 60 * 60);
        const days60 = now - (60 * 24 * 60 * 60);
        const days90 = now - (90 * 24 * 60 * 60);
        const days180 = now - (180 * 24 * 60 * 60);
        const days365 = now - (365 * 24 * 60 * 60);

        const counts = {
            trending7Days: {},
            movies30Days: {},
            shows30Days: {},
            top365Days: {},
            allTime: {},
            weekendWarriors: {},
            nightOwls: {},
            retroHits: {},
            cultClassics: {}
        };
        const userPlays = {
            '7': {},
            '30': {},
            '60': {},
            '90': {},
            '180': {},
            '365': {},
            'all': {}
        };

        history.forEach(item => {
            const viewedAt = item.viewedAt;
            const isMovie = item.type === 'movie';
            const isEpisode = item.type === 'episode';

            if (!isMovie && !isEpisode) return;

            const groupKey = isMovie ? item.ratingKey : item.grandparentKey;

            const metaId = String(groupKey).split('/').pop();
            const baseItem = {
                ratingKey: metaId,
                title: isMovie ? item.title : item.grandparentTitle,
                thumb: isMovie ? item.thumb : (item.grandparentThumb || item.parentThumb || item.thumb),
                type: isMovie ? 'movie' : 'show',
                plexUrl: `https://app.plex.tv/desktop/#!/server/${config.serverIdentifier}/details?key=${encodeURIComponent('/library/metadata/' + metaId)}`
            };

            const increment = (obj) => {
                if (!obj[groupKey]) {
                    obj[groupKey] = { ...baseItem, views: 0, users: new Set() };
                }
                obj[groupKey].views++;
                obj[groupKey].users.add(item.accountID);
            };

            increment(counts.allTime); // All time gets incremented for every view
            userPlays['all'][item.accountID] = (userPlays['all'][item.accountID] || 0) + 1;

            // Time-based stats
            if (viewedAt >= days7) {
                increment(counts.trending7Days);
                userPlays['7'][item.accountID] = (userPlays['7'][item.accountID] || 0) + 1;
            }
            if (viewedAt >= days30) userPlays['30'][item.accountID] = (userPlays['30'][item.accountID] || 0) + 1;
            if (viewedAt >= days60) userPlays['60'][item.accountID] = (userPlays['60'][item.accountID] || 0) + 1;
            if (viewedAt >= days90) userPlays['90'][item.accountID] = (userPlays['90'][item.accountID] || 0) + 1;
            if (viewedAt >= days180) userPlays['180'][item.accountID] = (userPlays['180'][item.accountID] || 0) + 1;
            if (viewedAt >= days365) {
                increment(counts.top365Days);
                userPlays['365'][item.accountID] = (userPlays['365'][item.accountID] || 0) + 1;
            }

            // Movie / Show 30 days
            if (viewedAt >= days30) {
                if (item.type === 'movie') increment(counts.movies30Days);
                if (item.type === 'episode') increment(counts.shows30Days);
            }

            // Wacky Stats Logic
            const date = new Date(viewedAt * 1000);
            const dayOfWeek = date.getDay(); // 0 is Sunday, 5 is Friday, 6 is Saturday
            const hourOfDay = date.getHours(); // 0 to 23

            // Weekend Warriors (Friday, Saturday, Sunday)
            if (dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6) {
                increment(counts.weekendWarriors);
            }

            // Night Owl Club (Midnight to 5am)
            if (hourOfDay >= 0 && hourOfDay < 5) {
                increment(counts.nightOwls);
            }

            // Blast from the Past (Retro Hits - released before 2000)
            if (item.originallyAvailableAt && item.originallyAvailableAt.startsWith('19')) {
                increment(counts.retroHits);
            }

            // Cult Classics (Track all-time for density later)
            increment(counts.cultClassics);
        });

        const excludedKeys = new Set();

        const getTopUnique = (obj, limit = 20) => {
            const sorted = Object.values(obj).sort((a, b) => b.views - a.views);
            const result = [];
            for (const item of sorted) {
                if (result.length >= limit) break;
                if (!excludedKeys.has(item.ratingKey)) {
                    result.push(item);
                    excludedKeys.add(item.ratingKey);
                }
            }
            return result;
        };

        const getCultClassicsUnique = (obj) => {
            const sorted = Object.values(obj)
                .filter(a => a.views > 10 && a.users.size <= 2)
                .sort((a, b) => (b.views / b.users.size) - (a.views / a.users.size));

            const result = [];
            for (const item of sorted) {
                if (result.length >= 20) break;
                if (!excludedKeys.has(item.ratingKey)) {
                    result.push(item);
                    excludedKeys.add(item.ratingKey);
                }
            }
            return result;
        };

        const leaderboards = {};
        const leaderboardsSorted = {};
        const totalActiveUsers = {};
        Object.keys(userPlays).forEach(period => {
            const sortedUsers = Object.entries(userPlays[period]).sort((a, b) => b[1] - a[1]);
            leaderboards[period] = {};
            leaderboardsSorted[period] = sortedUsers.map(([accountId, plays], index) => ({ accountId, plays, rank: index + 1 }));
            sortedUsers.forEach(([accountId, plays], index) => {
                leaderboards[period][accountId] = { rank: index + 1, plays };
            });
            totalActiveUsers[period] = sortedUsers.length;
        });

        // Replace the in-memory `users` Set with a serializable count, since a Set
        // becomes {} under JSON.stringify and loses its size on reload.
        const stripUsers = (arr) => arr.map(({ users, ...rest }) => ({
            ...rest,
            userCount: users instanceof Set ? users.size : (rest.userCount || 0)
        }));

        const trendingLists = await Promise.all([
            enrichRecentItemsWithMediaTags(uri, config, stripUsers(getTopUnique(counts.trending7Days))),
            enrichRecentItemsWithMediaTags(uri, config, stripUsers(getTopUnique(counts.movies30Days))),
            enrichRecentItemsWithMediaTags(uri, config, stripUsers(getTopUnique(counts.shows30Days))),
            enrichRecentItemsWithMediaTags(uri, config, stripUsers(getTopUnique(counts.top365Days))),
            enrichRecentItemsWithMediaTags(uri, config, stripUsers(getTopUnique(counts.allTime))),
            enrichRecentItemsWithMediaTags(uri, config, stripUsers(getTopUnique(counts.weekendWarriors))),
            enrichRecentItemsWithMediaTags(uri, config, stripUsers(getTopUnique(counts.nightOwls))),
            enrichRecentItemsWithMediaTags(uri, config, stripUsers(getTopUnique(counts.retroHits))),
            enrichRecentItemsWithMediaTags(uri, config, stripUsers(getCultClassicsUnique(counts.cultClassics)))
        ]);
        const [
            trending7Days,
            movies30Days,
            shows30Days,
            top365Days,
            allTime,
            weekendWarriors,
            nightOwls,
            retroHits,
            cultClassics
        ] = trendingLists;

        const stats = {
            trending7Days,
            movies30Days,
            shows30Days,
            top365Days,
            allTime,
            weekendWarriors,
            nightOwls,
            retroHits,
            cultClassics,
            leaderboards,
            leaderboardsSorted,
            totalActiveUsers,
            lastUpdated: Date.now()
        };

        await saveFile(TRENDING_CACHE_PATH, stats);
        log('Successfully calculated and cached Plex Trending Stats.');
        markTaskEnd(systemJobs.trendingCache, null);
    } catch (e) {
        log(`Error calculating trending stats: ${e.message}`);
        markTaskEnd(systemJobs.trendingCache, e);
    } finally {
        isBuildingTrendingStats = false;
    }
}

const TRENDING_CACHE_INTERVAL_MS = 12 * 60 * 60 * 1000;
const ANALYTICS_CACHE_INTERVAL_MS = 30 * 60 * 1000;
const INITIAL_CACHE_BUILD_DELAY_MS = 10 * 1000;

let trendingRebuildTimer = null;
let analyticsRebuildTimer = null;

const getCacheAgeMs = async (filePath, parsed, timestampFields = ['lastUpdated', 'generatedAt']) => {
    for (const field of timestampFields) {
        const value = parsed?.[field];
        if (value) return Date.now() - Number(value);
    }
    try {
        const stat = await fs.stat(filePath);
        return Date.now() - stat.mtimeMs;
    } catch {
        return null;
    }
};

const isValidTrendingCache = (data) => (
    data && typeof data === 'object' && !!data.lastUpdated && Array.isArray(data.trending7Days)
);

const isValidAnalyticsCache = (data) => {
    if (!data || typeof data !== 'object') return false;
    return data.all !== undefined || data['7'] !== undefined || data['30'] !== undefined || data[7] !== undefined || data[30] !== undefined;
};

const scheduleTrendingRebuild = (delayMs) => {
    if (trendingRebuildTimer) clearTimeout(trendingRebuildTimer);
    const safeDelay = Math.max(0, delayMs);
    systemJobs.trendingCache.nextRun = new Date(Date.now() + safeDelay).toISOString();
    trendingRebuildTimer = setTimeout(async () => {
        await calculateTrendingStats();
        scheduleTrendingRebuild(TRENDING_CACHE_INTERVAL_MS);
    }, safeDelay);
};

const scheduleAnalyticsRebuild = (delayMs) => {
    if (analyticsRebuildTimer) clearTimeout(analyticsRebuildTimer);
    const safeDelay = Math.max(0, delayMs);
    systemJobs.analyticsCache.nextRun = new Date(Date.now() + safeDelay).toISOString();
    analyticsRebuildTimer = setTimeout(async () => {
        await calculateAnalyticsStats();
        scheduleAnalyticsRebuild(ANALYTICS_CACHE_INTERVAL_MS);
    }, safeDelay);
};

const startTrendingStatsBackgroundTask = async () => {
    let existing = null;
    try {
        const loaded = await loadFile(TRENDING_CACHE_PATH, null);
        if (isValidTrendingCache(loaded)) existing = loaded;
    } catch { /* no cache yet */ }

    if (existing) {
        const ageMs = await getCacheAgeMs(TRENDING_CACHE_PATH, existing);
        if (ageMs == null) {
            log('[TrendingStats] Loaded existing cache.');
            scheduleTrendingRebuild(TRENDING_CACHE_INTERVAL_MS);
            return;
        }
        const remainingMs = Math.max(0, TRENDING_CACHE_INTERVAL_MS - ageMs);
        log(`[TrendingStats] Loaded existing cache (age: ${Math.round(ageMs / 60000)} min). Next rebuild in ${Math.round(remainingMs / 60000)} min.`);
        if (ageMs >= TRENDING_CACHE_INTERVAL_MS) {
            log('[TrendingStats] Cache is stale — triggering immediate rebuild.');
            scheduleTrendingRebuild(0);
        } else {
            scheduleTrendingRebuild(remainingMs);
        }
        return;
    }

    log('[TrendingStats] No cache found — triggering initial build.');
    scheduleTrendingRebuild(INITIAL_CACHE_BUILD_DELAY_MS);
};

const startAnalyticsStatsBackgroundTask = async () => {
    let existing = null;
    try {
        const loaded = await loadFile(ANALYTICS_CACHE_PATH, null);
        if (isValidAnalyticsCache(loaded)) existing = loaded;
    } catch { /* no cache yet */ }

    if (existing) {
        const ageMs = await getCacheAgeMs(ANALYTICS_CACHE_PATH, existing);
        if (ageMs == null) {
            log('[AnalyticsStats] Loaded existing cache.');
            scheduleAnalyticsRebuild(ANALYTICS_CACHE_INTERVAL_MS);
            return;
        }
        const remainingMs = Math.max(0, ANALYTICS_CACHE_INTERVAL_MS - ageMs);
        log(`[AnalyticsStats] Loaded existing cache (age: ${Math.round(ageMs / 60000)} min). Next rebuild in ${Math.round(remainingMs / 60000)} min.`);
        if (ageMs >= ANALYTICS_CACHE_INTERVAL_MS) {
            log('[AnalyticsStats] Cache is stale — triggering immediate rebuild.');
            scheduleAnalyticsRebuild(0);
        } else {
            scheduleAnalyticsRebuild(remainingMs);
        }
        return;
    }

    log('[AnalyticsStats] No cache found — triggering initial build.');
    scheduleAnalyticsRebuild(INITIAL_CACHE_BUILD_DELAY_MS + 5000);
};

const isUpgraderEnabled = (config) => !!config?.upgraderEnabled;

const UPGRADER_INDEX_INTERVAL_MS = 4 * 60 * 60 * 1000;
let upgraderIndexTimer = null;

const clearUpgraderIndexDisabledError = () => {
    const err = String(systemJobs.upgraderIndex.lastError || '');
    if (!err || /upgrader is disabled/i.test(err)) {
        systemJobs.upgraderIndex.lastError = null;
    }
};

const idleUpgraderIndexJob = (reason = 'Library Upgrader is disabled') => {
    systemJobs.upgraderIndex.running = false;
    systemJobs.upgraderIndex.nextRun = null;
    clearUpgraderIndexDisabledError();
    if (systemJobs.upgraderIndex._startedAt) {
        delete systemJobs.upgraderIndex._startedAt;
    }
    log(`[UpgraderIndex] Idle — ${reason}.`);
};

const scheduleUpgraderIndexRebuild = (delayMs) => {
    if (upgraderIndexTimer) clearTimeout(upgraderIndexTimer);
    const safeDelay = Math.max(0, delayMs);
    systemJobs.upgraderIndex.nextRun = new Date(Date.now() + safeDelay).toISOString();
    upgraderIndexTimer = setTimeout(async () => {
        try {
            const config = await loadFile(CONFIG_PATH, {});
            if (!isUpgraderEnabled(config)) {
                // Feature off is not a failure — keep the job idle and re-check later.
                idleUpgraderIndexJob();
            } else {
                await buildUpgraderArrIndex(config, { actor: { username: 'System', email: 'system@local' } });
            }
        } catch (e) {
            log(`[UpgraderIndex] Scheduled rebuild failed: ${e.message}`);
        }
        scheduleUpgraderIndexRebuild(UPGRADER_INDEX_INTERVAL_MS);
    }, safeDelay);
};

const startUpgraderIndexBackgroundTask = async () => {
    let config = {};
    try {
        config = await loadFile(CONFIG_PATH, {});
    } catch { /* defaults */ }

    if (!isUpgraderEnabled(config)) {
        idleUpgraderIndexJob();
        // Quiet re-check so enabling Upgrader without a full restart still wakes the job.
        scheduleUpgraderIndexRebuild(UPGRADER_INDEX_INTERVAL_MS);
        return;
    }

    let existing = null;
    try {
        const loaded = await loadFile(UPGRADER_INDEX_PATH, null);
        if (loaded && loaded.generatedAt) existing = loaded;
    } catch { /* no cache yet */ }

    if (existing) {
        systemJobs.upgraderIndex.lastRun = existing.generatedAt;
        const ageMs = Date.now() - new Date(existing.generatedAt).getTime();
        const remainingMs = Math.max(0, UPGRADER_INDEX_INTERVAL_MS - ageMs);
        log(`[UpgraderIndex] Loaded existing index (age: ${Math.round(ageMs / 60000)} min). Next rebuild in ${Math.round(remainingMs / 60000)} min.`);
        if (ageMs >= UPGRADER_INDEX_INTERVAL_MS) {
            scheduleUpgraderIndexRebuild(0);
        } else {
            scheduleUpgraderIndexRebuild(remainingMs);
        }
        return;
    }

    log('[UpgraderIndex] No cache found — scheduling first build shortly.');
    scheduleUpgraderIndexRebuild(INITIAL_CACHE_BUILD_DELAY_MS + 10000);
};

app.get('/api/plex/stats/trending', requireAuth, requireMember, async (req, res) => {
    try {
        const stats = await loadFile(TRENDING_CACHE_PATH, {
            trending7Days: [],
            movies30Days: [],
            shows30Days: [],
            top365Days: [],
            allTime: [],
            weekendWarriors: [],
            nightOwls: [],
            retroHits: [],
            cultClassics: []
        });
        res.json(stats);
    } catch (e) {
        res.status(500).json({ error: 'Failed to load trending stats' });
    }
});

// --- Library Maintenance (Maintainerr-style) ---
const MAINTENANCE_DEFAULTS = {
    enabled: false,
    dryRunByDefault: true,
    maxActionsPerRun: 25,
    requireConfirmForDestructive: true
};
const isMaintenanceExperimentalEnabled = (config) => !!config?.maintenanceExperimentalEnabled;
const isMediaQualityIndexEnabled = (config) => isMaintenanceExperimentalEnabled(config) || isUpgraderEnabled(config);

const isHevcVideoCodec = (codec = '') => /hevc|h265|x265/.test(String(codec || '').toLowerCase());

/** Collapse Sonarr/Radarr codec aliases (x264≡h264, x265≡hevc, etc.) into stable family keys. */
const normalizeArrVideoCodecKey = (codec = '') => {
    const c = String(codec || '').toLowerCase().trim();
    if (!c) return '';
    if (/\bav1\b|av01/.test(c)) return 'av1';
    if (/hevc|h\.?265|x265|hev1/.test(c)) return 'hevc';
    if (/h\.?264|x264|\bavc\b|avc1/.test(c)) return 'h264';
    if (/vp9|vp09/.test(c)) return 'vp9';
    if (/mpeg-?2|mp2v/.test(c)) return 'mpeg2';
    if (/mpeg-?4|xvid|divx/.test(c)) return 'mpeg4';
    return c;
};

const mergeUpgraderCodecMaps = (codecMap = {}) => {
    const merged = {};
    Object.entries(codecMap || {}).forEach(([raw, value]) => {
        const key = normalizeArrVideoCodecKey(raw);
        if (!key) return;
        merged[key] = (merged[key] || 0) + Number(value || 0);
    });
    return merged;
};

const buildPlexWebDetailUrl = (config, ratingKey) => {
    if (!config?.serverIdentifier || !ratingKey) return null;
    const key = String(ratingKey).replace(/^\/library\/metadata\//, '').trim();
    if (!key) return null;
    // Match Overseerr / Plex Web format (desktop#!/server/...)
    return `https://app.plex.tv/desktop#!/server/${config.serverIdentifier}/details?key=${encodeURIComponent(`/library/metadata/${key}`)}`;
};

const deriveQualityFieldsFromTags = (displayTags = [], videoCodec = '') => {
    const tags = Array.isArray(displayTags) ? displayTags : [];
    const isHevc = tags.includes('HEVC') || isHevcVideoCodec(videoCodec);
    const hasDolbyVision = tags.includes('DV');
    const hasHdr = tags.includes('HDR') || hasDolbyVision;
    return { displayTags: tags, isHevc, hasHdr, hasDolbyVision };
};

const enrichMaintenanceItemsWithQuality = async (uri, config, items = []) => {
    if (!items.length) return items;
    const metaMap = await fetchPlexMetadataMap(uri, config, items.map((item) => item.ratingKey));
    return items.map((item) => {
        const meta = metaMap.get(String(item.ratingKey));
        const displayTags = meta
            ? extractMediaDisplayTags(meta)
            : extractMediaDisplayTags({ Media: [{ videoResolution: item.videoResolution, videoCodec: item.videoCodec }] });
        const quality = deriveQualityFieldsFromTags(displayTags, item.videoCodec);
        return {
            ...item,
            ...quality,
            plexUrl: buildPlexWebDetailUrl(config, item.ratingKey),
        };
    });
};

const isUpgraderCandidate = (item = {}) => {
    if (item.mediaType === 'show') {
        const totalEpisodes = Number(item.totalEpisodeCount || 0);
        const nonHevcEpisodes = Number(item.nonHevcEpisodeCount || 0);
        if (totalEpisodes > 0) return nonHevcEpisodes > 0;
        return !item.isHevc;
    }
    return !item.isHevc;
};

const buildJellyfinDisplayTags = (videoCodec = '', width = 0, height = 0) => {
    const tags = [];
    if (width >= 3800 || height >= 2000) tags.push('4K');
    else if (height >= 1000) tags.push('1080p');
    else if (height >= 700) tags.push('720p');
    const codecLabel = normalizeVideoCodecLabel({ videoCodec }, []);
    if (codecLabel) tags.push(codecLabel);
    return [...new Set(tags)];
};

const enrichJellyfinItemsWithQuality = (config, items = []) => items.map((item) => {
    const width = Number(item.videoWidth || 0);
    const height = Number(item.videoHeight || 0);
    const displayTags = buildJellyfinDisplayTags(item.videoCodec, width, height);
    const quality = deriveQualityFieldsFromTags(displayTags, item.videoCodec);
    return {
        ...item,
        ...quality,
        displayTags,
        plexUrl: jellyfinItemUrl(config, item.ratingKey),
    };
});

const enrichShowItemsWithEpisodeStats = async (uri, config, items = []) => {
    const shows = items.filter((item) => item.mediaType === 'show');
    if (!shows.length) return items;

    for (const show of shows) {
        try {
            const res = await fetch(`${uri}/library/metadata/${show.ratingKey}/allLeaves?X-Plex-Token=${config.plexToken}`, {
                headers: plexClientHeaders(config.plexToken),
            }).then((r) => r.json()).catch(() => null);
            const leaves = res?.MediaContainer?.Metadata || [];
            let nonHevc = 0;
            let totalSize = 0;
            for (const leaf of leaves) {
                const mediaInfo = leaf?.Media?.[0] || {};
                const part = mediaInfo?.Part?.[0] || {};
                const codec = String(mediaInfo.videoCodec || '').toLowerCase();
                const tags = extractMediaDisplayTags(leaf);
                const isHevc = tags.includes('HEVC') || isHevcVideoCodec(codec);
                if (!isHevc) nonHevc += 1;
                totalSize += Number(part.size || 0);
            }
            show.totalEpisodeCount = leaves.length;
            show.nonHevcEpisodeCount = nonHevc;
            show.nonHevcEpisodeSizeGB = Math.round((totalSize / (1024 ** 3)) * 100) / 100;
            if (leaves.length > 0) show.isHevc = nonHevc === 0;
        } catch {
            show.totalEpisodeCount = Number(show.totalEpisodeCount || 0);
            show.nonHevcEpisodeCount = Number(show.nonHevcEpisodeCount || 0);
            show.nonHevcEpisodeSizeGB = Number(show.nonHevcEpisodeSizeGB || 0);
        }
    }
    return items;
};

const enrichJellyfinShowItemsWithEpisodeStats = async (config, items = []) => {
    const baseUrl = resolveIntegrationUrlForFetch(config.jellyfinUrl);
    const shows = items.filter((item) => item.mediaType === 'show');
    for (const show of shows) {
        try {
            const params = new URLSearchParams({
                ParentId: show.ratingKey,
                IncludeItemTypes: 'Episode',
                Recursive: 'true',
                Fields: 'MediaSources,MediaStreams,Size',
            });
            const response = await fetchWithTimeout(`${baseUrl}/Items?${params.toString()}`, {
                headers: jellyfinHeaders(config.jellyfinApiKey),
            }, 30000);
            const data = response.ok ? await response.json() : { Items: [] };
            const episodes = Array.isArray(data.Items) ? data.Items : [];
            let nonHevc = 0;
            let totalSize = 0;
            for (const ep of episodes) {
                const videoStream = (ep.MediaStreams || []).find((s) => s.Type === 'Video') || {};
                const codec = String(videoStream.Codec || '').toLowerCase();
                const isHevc = isHevcVideoCodec(codec);
                if (!isHevc) nonHevc += 1;
                totalSize += Number((ep.MediaSources || [])[0]?.Size || ep.Size || 0);
            }
            show.totalEpisodeCount = episodes.length;
            show.nonHevcEpisodeCount = nonHevc;
            show.nonHevcEpisodeSizeGB = Math.round((totalSize / (1024 ** 3)) * 100) / 100;
            if (episodes.length > 0) show.isHevc = nonHevc === 0;
        } catch {
            show.totalEpisodeCount = Number(show.totalEpisodeCount || 0);
            show.nonHevcEpisodeCount = Number(show.nonHevcEpisodeCount || 0);
            show.nonHevcEpisodeSizeGB = Number(show.nonHevcEpisodeSizeGB || 0);
        }
    }
    return items;
};

const mapJellyfinEntryToMaintenanceItem = (config, entry = {}, mediaType = 'movie') => {
    const videoStream = (entry.MediaStreams || []).find((s) => s.Type === 'Video') || {};
    const mediaSource = (entry.MediaSources || [])[0] || {};
    const sizeBytes = Number(mediaSource.Size || entry.Size || 0);
    const width = Number(videoStream.Width || 0);
    const height = Number(videoStream.Height || 0);
    const videoCodec = String(videoStream.Codec || mediaSource.VideoCodec || '').toLowerCase();
    const videoResolution = width >= 3800 || height >= 2000 ? '4k' : height >= 1000 ? '1080' : height >= 700 ? '720' : 'sd';
    const providerIds = entry.ProviderIds || {};
    const addedAtMs = entry.DateCreated ? Date.parse(entry.DateCreated) : null;
    const itemId = String(entry.Id || '');

    return {
        ratingKey: itemId,
        title: entry.Name || 'Unknown',
        thumb: hasJellyfinPrimaryImage(entry) ? (entry.PrimaryImageItemId || itemId) : '',
        thumbUrl: hasJellyfinPrimaryImage(entry) ? jellyfinImageUrlForItem(entry.PrimaryImageItemId || itemId, 300, 450) : '',
        mediaType,
        libraryId: 'jellyfin',
        libraryTitle: 'Jellyfin Library',
        year: entry.ProductionYear || null,
        watchCount: 0,
        watchedEver: false,
        addedAt: addedAtMs ? new Date(addedAtMs).toISOString() : null,
        lastViewedAt: null,
        daysSinceAdded: addedAtMs ? Math.floor((Date.now() - addedAtMs) / (24 * 60 * 60 * 1000)) : null,
        daysSinceLastWatch: null,
        durationMinutes: entry.RunTimeTicks ? Math.round(Number(entry.RunTimeTicks) / 600000000) : null,
        bitrateKbps: 0,
        videoResolution,
        videoCodec,
        videoWidth: width,
        videoHeight: height,
        audioCodec: String((entry.MediaStreams || []).find((s) => s.Type === 'Audio')?.Codec || '').toLowerCase(),
        sizeBytes,
        sizeGB: sizeBytes ? Math.round((sizeBytes / (1024 ** 3)) * 100) / 100 : 0,
        filePath: mediaSource.Path || entry.Path || '',
        genres: [],
        collections: [],
        labels: [],
        studio: '',
        contentRating: entry.OfficialRating || '',
        tmdbRating: null,
        rtCriticRating: null,
        rtAudienceRating: null,
        traktRating: null,
        imdbId: providerIds.Imdb || providerIds.imdb || null,
        tmdbId: providerIds.Tmdb || providerIds.tmdb || null,
        tvdbId: providerIds.Tvdb || providerIds.tvdb || null,
        arrType: mediaType === 'movie' ? 'radarr' : 'sonarr',
        arrMapped: false,
        arrInstanceId: null,
        arrInstanceName: null,
        arrAmbiguous: false,
        hasExternalIds: !!(providerIds.Tmdb || providerIds.Tvdb || providerIds.Imdb),
        request: null,
        is4k: width >= 3800 || height >= 2000,
        totalEpisodeCount: 0,
        nonHevcEpisodeCount: 0,
        nonHevcEpisodeSizeGB: 0,
    };
};

const fetchJellyfinLibraryItemsForMaintenance = async (config) => {
    const baseUrl = resolveIntegrationUrlForFetch(config.jellyfinUrl);
    const items = [];
    const pageSize = 200;

    for (const includeItemTypes of ['Movie', 'Series']) {
        const mediaType = includeItemTypes === 'Movie' ? 'movie' : 'show';
        let startIndex = 0;
        while (true) {
            const params = new URLSearchParams({
                Recursive: 'true',
                IncludeItemTypes: includeItemTypes,
                StartIndex: String(startIndex),
                Limit: String(pageSize),
                Fields: 'Path,Size,DateCreated,MediaSources,MediaStreams,ProviderIds,ProductionYear,RunTimeTicks,OfficialRating',
            });
            const response = await fetchWithTimeout(`${baseUrl}/Items?${params.toString()}`, {
                headers: jellyfinHeaders(config.jellyfinApiKey),
            }, 30000);
            if (!response.ok) break;
            const data = await response.json();
            const page = Array.isArray(data.Items) ? data.Items : [];
            page.forEach((entry) => items.push(mapJellyfinEntryToMaintenanceItem(config, entry, mediaType)));
            startIndex += page.length;
            if (page.length < pageSize) break;
        }
    }
    return items;
};

const mapPlexEpisodeLeaf = (config, leaf = {}, showTitle = '') => {
    const mediaInfo = leaf?.Media?.[0] || {};
    const part = mediaInfo?.Part?.[0] || {};
    const displayTags = extractMediaDisplayTags(leaf);
    const quality = deriveQualityFieldsFromTags(displayTags, mediaInfo.videoCodec);
    const seasonNumber = leaf.parentIndex != null ? Number(leaf.parentIndex) : (leaf.parentIndex === 0 ? 0 : null);
    const episodeNumber = leaf.index != null ? Number(leaf.index) : null;
    return {
        ratingKey: String(leaf.ratingKey || ''),
        title: leaf.title || `${showTitle} Episode`,
        showTitle,
        seasonNumber,
        episodeNumber,
        thumb: leaf.thumb || '',
        mediaType: 'episode',
        videoCodec: String(mediaInfo.videoCodec || '').toLowerCase(),
        videoResolution: String(mediaInfo.videoResolution || '').toLowerCase(),
        sizeGB: part.size ? Math.round((Number(part.size) / (1024 ** 3)) * 100) / 100 : 0,
        displayTags: quality.displayTags,
        isHevc: quality.isHevc,
        hasHdr: quality.hasHdr,
        hasDolbyVision: quality.hasDolbyVision,
        plexUrl: buildPlexWebDetailUrl(config, leaf.ratingKey),
    };
};

const fetchPlexShowEpisodes = async (config, uri, showItem = {}) => {
    const response = await fetchWithTimeout(
        `${uri}/library/metadata/${showItem.ratingKey}/allLeaves?X-Plex-Token=${config.plexToken}`,
        { headers: plexClientHeaders(config.plexToken) },
        20000,
    ).catch(() => null);
    const res = response?.ok ? await response.json().catch(() => null) : null;
    const leaves = res?.MediaContainer?.Metadata || [];
    return leaves.map((leaf) => mapPlexEpisodeLeaf(config, leaf, showItem.title));
};

const fetchJellyfinShowEpisodes = async (config, showItem = {}) => {
    const baseUrl = resolveIntegrationUrlForFetch(config.jellyfinUrl);
    const params = new URLSearchParams({
        ParentId: showItem.ratingKey,
        IncludeItemTypes: 'Episode',
        Recursive: 'true',
        Fields: 'MediaSources,MediaStreams,Size,ParentIndexNumber,IndexNumber,ProductionYear',
    });
    const response = await fetchWithTimeout(`${baseUrl}/Items?${params.toString()}`, {
        headers: jellyfinHeaders(config.jellyfinApiKey),
    }, 30000);
    const data = response.ok ? await response.json() : { Items: [] };
    const episodes = Array.isArray(data.Items) ? data.Items : [];
    return episodes.map((entry) => {
        const videoStream = (entry.MediaStreams || []).find((s) => s.Type === 'Video') || {};
        const mediaSource = (entry.MediaSources || [])[0] || {};
        const sizeBytes = Number(mediaSource.Size || entry.Size || 0);
        const width = Number(videoStream.Width || 0);
        const height = Number(videoStream.Height || 0);
        const videoCodec = String(videoStream.Codec || '').toLowerCase();
        const displayTags = buildJellyfinDisplayTags(videoCodec, width, height);
        const quality = deriveQualityFieldsFromTags(displayTags, videoCodec);
        return {
            ratingKey: String(entry.Id || ''),
            title: entry.Name || 'Episode',
            showTitle: showItem.title || entry.SeriesName || '',
            seasonNumber: entry.ParentIndexNumber != null ? Number(entry.ParentIndexNumber) : null,
            episodeNumber: entry.IndexNumber != null ? Number(entry.IndexNumber) : null,
            thumb: hasJellyfinPrimaryImage(entry) ? String(entry.PrimaryImageItemId || entry.Id || '') : '',
            thumbUrl: hasJellyfinPrimaryImage(entry) ? jellyfinImageUrlForItem(entry.PrimaryImageItemId || entry.Id, 300, 200) : '',
            mediaType: 'episode',
            videoCodec,
            videoResolution: width >= 3800 || height >= 2000 ? '4k' : height >= 1000 ? '1080' : '720',
            sizeGB: sizeBytes ? Math.round((sizeBytes / (1024 ** 3)) * 100) / 100 : 0,
            displayTags: quality.displayTags,
            isHevc: quality.isHevc,
            hasHdr: quality.hasHdr,
            hasDolbyVision: quality.hasDolbyVision,
            plexUrl: jellyfinItemUrl(config, entry.Id),
        };
    });
};

const getUpgraderCodecFamily = (item = {}) => {
    const tags = item.displayTags || [];
    const codec = String(item.videoCodec || '').toLowerCase();
    if (tags.includes('AV1') || normalizeArrVideoCodecKey(codec) === 'av1') return 'av1';
    if (item.isHevc || tags.includes('HEVC') || normalizeArrVideoCodecKey(codec) === 'hevc') return 'hevc';
    if (tags.includes('H.264') || normalizeArrVideoCodecKey(codec) === 'h264') return 'h264';
    if (normalizeArrVideoCodecKey(codec) === 'vp9') return 'vp9';
    return 'other';
};

const getUpgraderResolutionBucket = (item = {}) => {
    const tags = item.displayTags || [];
    const tagHaystack = tags.join(' ').toLowerCase();
    if (item.is4k || tags.includes('4K') || /2160|4k/u.test(tagHaystack)) return '4k';
    const res = String(item.videoResolution || '').toLowerCase();
    const haystack = `${res} ${tagHaystack}`;
    if (res.includes('1080') || tags.includes('1080p') || /1080/u.test(haystack)) return '1080p';
    if (res.includes('720') || tags.includes('720p') || /720/u.test(haystack)) return '720p';
    if (res.includes('576') || res.includes('480') || res.includes('sd') || tags.includes('480p') || /\bsd\b|576p|480p/u.test(haystack)) return 'sd';
    return 'other';
};

const applyUpgraderMultiFilter = (item, codecs = [], resolutions = [], features = [], qualities = [], minSizeGB = 5) => {
    if (codecs.length > 0) {
        let itemCodec = getUpgraderCodecFamily(item);
        if (!codecs.includes(itemCodec)) {
            let matched = false;
            if (item.mediaType === 'show') {
                if (item.codecCounts) {
                    for (const reqCodec of codecs) {
                        for (const [actualCodec, count] of Object.entries(item.codecCounts)) {
                            const family = getUpgraderCodecFamily({ videoCodec: actualCodec });
                            if (family === reqCodec && count > 0) {
                                matched = true;
                                break;
                            }
                        }
                        if (matched) break;
                    }
                } else {
                    const total = Number(item.totalEpisodeCount || 0);
                    const nonHevc = Number(item.nonHevcEpisodeCount || 0);
                    if (codecs.includes('h264') && nonHevc > 0) matched = true;
                    if ((codecs.includes('hevc') || codecs.includes('h265')) && (total - nonHevc) > 0) matched = true;
                }
            }
            if (!matched) return false;
        }
    }
    
    if (resolutions.length > 0) {
        const itemRes = getUpgraderResolutionBucket(item);
        if (!resolutions.includes(itemRes)) return false;
    }
    
    if (features.length > 0) {
        const hasFeature = features.some(feat => {
            if (feat === 'non_hevc') return isUpgraderCandidate(item);
            if (feat === 'hdr') return !!item.hasHdr || (item.displayTags || []).includes('HDR') || (item.displayTags || []).includes('DV');
            if (feat === 'dolby_vision') return !!item.hasDolbyVision || (item.displayTags || []).includes('DV');
            if (feat === 'large') return Number(item.sizeGB || 0) >= minSizeGB;
            if (feat === 'zero_size') return Number(item.zeroSizeCount || 0) > 0;
            return false;
        });
        if (!hasFeature) return false;
    }

    if (qualities.length > 0) {
        const hasQuality = qualities.some(qual => {
            const tags = (item.displayTags || []).map(t => String(t).toLowerCase());
            return tags.some(t => t.includes(qual));
        });
        if (!hasQuality) return false;
    }
    
    return true;
};

const applyUpgraderMultiFilterEpisode = (episode, codecs = [], resolutions = [], features = [], qualities = [], minSizeGB = 5) => {
    const pseudoItem = {
        mediaType: 'movie',
        isHevc: !!episode.isHevc,
        videoCodec: episode.videoCodec || '',
        videoResolution: episode.videoResolution || '',
        displayTags: Array.isArray(episode.displayTags) ? episode.displayTags : [],
        sizeGB: Number(episode.sizeGB || 0),
        hasHdr: !!episode.hasHdr,
        hasDolbyVision: !!episode.hasDolbyVision,
        is4k: (episode.displayTags || []).includes('4K')
            || /2160|4k/.test(String(episode.videoResolution || '').toLowerCase()),
        nonHevcEpisodeCount: episode.isHevc ? 0 : 1,
        totalEpisodeCount: 1,
        zeroSizeCount: Number(episode.sizeGB || 0) === 0 ? 1 : 0,
    };
    return applyUpgraderMultiFilter(pseudoItem, codecs, resolutions, features, qualities, minSizeGB);
};

const getSonarrEpisodeQualityLabel = (episodeFile = null) => {
    if (!episodeFile) return null;
    const qualityName = episodeFile?.quality?.quality?.name
        || episodeFile?.quality?.quality?.resolution
        || null;
    if (qualityName) return String(qualityName);
    const codec = episodeFile?.mediaInfo?.videoCodec || episodeFile?.mediaInfo?.videoFormat || '';
    return codec ? String(codec) : null;
};

const buildUpgraderItemKey = (arrType, instanceId, entityId) => `${arrType}:${instanceId}:${Number(entityId)}`;

const parseUpgraderItemKey = (rawKey = '') => {
    const match = String(rawKey || '').trim().match(/^(sonarr|radarr):([^:]+):(\d+)$/);
    if (!match) return null;
    return { type: match[1], instanceId: match[2], entityId: Number(match[3]) };
};

const analyzeSonarrEpisodeFile = (file = null) => mapSonarrFileToEpisodeQuality(file);

const sonarrEpisodeFileHasVideoCodec = (file = null) => {
    const mediaInfo = file?.mediaInfo || {};
    return !!(mediaInfo.videoCodec || mediaInfo.videoFormat);
};

const parseSeasonEpisodeFromSonarrFile = (file = null) => {
    if (!file) return null;
    if (file.seasonNumber != null && (file.episodeNumber != null || file.episodeNumbers?.[0] != null)) {
        return {
            season: Number(file.seasonNumber),
            episode: Number(file.episodeNumber ?? file.episodeNumbers[0]),
        };
    }
    const path = String(file.relativePath || file.path || '');
    const match = path.match(/[Ss](\d+)[Ee](\d+)/);
    if (!match) return null;
    return { season: Number(match[1]), episode: Number(match[2]) };
};

const buildPlexEpisodeCodecLookup = (plexEpisodes = []) => {
    const map = new Map();
    (Array.isArray(plexEpisodes) ? plexEpisodes : []).forEach((ep) => {
        if (ep?.seasonNumber == null || ep?.episodeNumber == null) return;
        const codec = normalizeArrVideoCodecKey(ep.videoCodec);
        if (!codec) return;
        map.set(`${ep.seasonNumber}-${ep.episodeNumber}`, {
            videoCodec: codec,
            videoResolution: String(ep.videoResolution || '').toLowerCase(),
            displayTags: Array.isArray(ep.displayTags) ? ep.displayTags : [],
            isHevc: !!ep.isHevc,
            hasHdr: !!ep.hasHdr,
            hasDolbyVision: !!ep.hasDolbyVision,
        });
    });
    return map;
};

/** When Sonarr mediaInfo is empty, fill codec fields from a matched Plex episode (same SxxExx). */
const applyPlexCodecFallbackToSonarrFile = (file, plexCodecLookup) => {
    if (!file || sonarrEpisodeFileHasVideoCodec(file) || !plexCodecLookup?.size) return file;
    const se = parseSeasonEpisodeFromSonarrFile(file);
    if (!se) return file;
    const plex = plexCodecLookup.get(`${se.season}-${se.episode}`);
    if (!plex?.videoCodec) return file;
    const heightHint = plex.videoResolution === '4k' || plex.videoResolution === '2160'
        ? 2160
        : plex.videoResolution.includes('1080')
            ? 1080
            : plex.videoResolution.includes('720')
                ? 720
                : 0;
    return {
        ...file,
        mediaInfo: {
            ...(file.mediaInfo || {}),
            videoCodec: plex.videoCodec,
            ...(heightHint ? { height: heightHint } : {}),
        },
        _codecSource: 'plex',
    };
};

const enrichSonarrFilesWithPlexCodecFallback = async (config, seriesFiles = [], posterMeta = {}, plexLookup = null) => {
    const files = Array.isArray(seriesFiles) ? seriesFiles : [];
    if (!files.length || !files.some((file) => !sonarrEpisodeFileHasVideoCodec(file))) return files;
    if (!isPlexConfigured(config) || !plexLookup) return files;

    const plexItem = findPlexPosterItem(plexLookup, posterMeta);
    if (!plexItem?.ratingKey) return files;

    const uri = await getPlexConnectionUri(config).catch(() => config.plexUrl || null);
    if (!uri) return files;

    const plexEpisodes = await fetchPlexShowEpisodes(config, uri, {
        ratingKey: plexItem.ratingKey,
        title: posterMeta.title || plexItem.title,
    }).catch(() => []);
    if (!plexEpisodes.length) return files;

    const codecLookup = buildPlexEpisodeCodecLookup(plexEpisodes);
    if (!codecLookup.size) return files;
    return files.map((file) => applyPlexCodecFallbackToSonarrFile(file, codecLookup));
};

const aggregateSonarrSeriesFileStats = (files = []) => {
    if (!files.length) {
        return {
            totalFiles: 0,
            nonHevcCount: 0,
            nonHevcSizeGB: 0,
            totalSizeGB: 0,
            videoCodec: '',
            videoResolution: '',
            displayTags: [],
            isHevc: false,
            hasHdr: false,
            hasDolbyVision: false,
            is4k: false,
        };
    }
    let nonHevcCount = 0;
    let nonHevcSizeGB = 0;
    let totalSizeGB = 0;
    let displayFileStats = null;
    let unknownCodecCount = 0;
    const codecCounts = {};
    const codecSizesGB = {};
    const resCounts = {};
    files.forEach((file) => {
        const stats = analyzeSonarrEpisodeFile(file);
        totalSizeGB += stats.sizeGB;
        if (!displayFileStats || stats.sizeGB > displayFileStats.sizeGB) {
            displayFileStats = stats;
        }
        // Tally codec and resolution occurrences (family-normalized: x264≡h264, x265≡hevc)
        const codecKey = normalizeArrVideoCodecKey(stats.videoCodec);
        if (codecKey) {
            codecCounts[codecKey] = (codecCounts[codecKey] || 0) + 1;
            codecSizesGB[codecKey] = (codecSizesGB[codecKey] || 0) + stats.sizeGB;
            // Only score HEVC/non-HEVC when Sonarr actually provided mediaInfo
            if (!stats.isHevc) {
                nonHevcCount += 1;
                nonHevcSizeGB += stats.sizeGB;
            }
        } else {
            unknownCodecCount += 1;
        }
        if (stats.videoResolution) resCounts[stats.videoResolution] = (resCounts[stats.videoResolution] || 0) + 1;
    });
    if (!displayFileStats) {
        return {
            totalFiles: 0,
            nonHevcCount: 0,
            nonHevcSizeGB: 0,
            totalSizeGB: 0,
            videoCodec: '',
            videoResolution: '',
            displayTags: [],
            isHevc: false,
            hasHdr: false,
            hasDolbyVision: false,
            is4k: false,
            unknownCodecCount: 0,
        };
    }
    // Use the most common codec and resolution, not just the largest file's
    const dominantCodec = Object.entries(codecCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
        || normalizeArrVideoCodecKey(displayFileStats.videoCodec)
        || '';
    const dominantRes = Object.entries(resCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || displayFileStats.videoResolution || '';
    // Round codecSizesGB
    Object.keys(codecSizesGB).forEach(k => {
        codecSizesGB[k] = Math.round(codecSizesGB[k] * 100) / 100;
    });
    const knownCodecFiles = Object.values(codecCounts).reduce((sum, n) => sum + Number(n || 0), 0);

    return {
        totalFiles: files.length,
        nonHevcCount,
        nonHevcSizeGB: Math.round(nonHevcSizeGB * 100) / 100,
        totalSizeGB: Math.round(totalSizeGB * 100) / 100,
        videoCodec: dominantCodec,
        videoResolution: dominantRes,
        codecCounts,
        codecSizesGB,
        resCounts,
        displayTags: displayFileStats.displayTags || [],
        // All *known* codecs are HEVC (ignore files missing mediaInfo)
        isHevc: knownCodecFiles > 0 && nonHevcCount === 0,
        hasHdr: !!displayFileStats.hasHdr,
        hasDolbyVision: !!displayFileStats.hasDolbyVision,
        is4k: (displayFileStats.displayTags || []).includes('4K'),
        zeroSizeCount: Object.values(codecSizesGB).reduce((a, b) => a + b, 0) === 0 ? files.length : files.filter(f => !f.size || f.size === 0).length,
        unknownCodecCount,
    };
};

const analyzeRadarrMovieFile = (movie = null) => {
    const file = movie?.movieFile || null;
    if (!file) {
        return {
            sizeGB: 0,
            videoCodec: '',
            videoResolution: '',
            displayTags: [],
            isHevc: false,
            hasHdr: false,
            hasDolbyVision: false,
            is4k: false,
            zeroSizeCount: 0,
        };
    }
    const mediaInfo = file.mediaInfo || {};
    const codec = normalizeArrVideoCodecKey(mediaInfo.videoCodec || mediaInfo.videoFormat || '');
    const width = Number(mediaInfo.width || 0);
    const height = Number(mediaInfo.height || 0);
    const qualityLabel = file?.quality?.quality?.name || null;
    const tags = [];
    if (qualityLabel) tags.push(String(qualityLabel));
    if (width >= 3800 || height >= 2000) tags.push('4K');
    else if (height >= 1000) tags.push('1080p');
    else if (height >= 700) tags.push('720p');
    const derived = deriveQualityFieldsFromTags(tags, codec);
    const sizeBytes = Number(file.size || mediaInfo.size || 0);
    return {
        sizeGB: sizeBytes ? Math.round((sizeBytes / (1024 ** 3)) * 100) / 100 : 0,
        videoCodec: codec,
        videoResolution: width >= 3800 || height >= 2000 ? '4k' : height >= 1000 ? '1080' : height >= 700 ? '720' : '',
        displayTags: derived.displayTags.length ? derived.displayTags : tags,
        isHevc: derived.isHevc,
        hasHdr: derived.hasHdr,
        hasDolbyVision: derived.hasDolbyVision,
        is4k: tags.includes('4K'),
        zeroSizeCount: (file && (!file.size || file.size === 0)) ? 1 : 0,
    };
};

const buildUpgraderCoverUrl = (arrType, instanceId, entityId) =>
    withBasePath(`/api/upgrader/arr-cover?type=${encodeURIComponent(arrType)}&instanceId=${encodeURIComponent(instanceId)}&entityId=${encodeURIComponent(entityId)}`);

const upgraderPlexPosterUrl = (thumbPath) =>
    withBasePath(`/api/plex/image?path=${encodeURIComponent(thumbPath)}&width=600&height=900`);

const buildPlexPosterLookup = (items = []) => {
    const lookup = {
        byTvdb: new Map(),
        byTmdb: new Map(),
        byImdb: new Map(),
        byTitleYear: new Map(),
    };
    (Array.isArray(items) ? items : []).forEach((item) => {
        if (!item?.thumb) return;
        const mediaType = item.mediaType === 'show' ? 'show' : 'movie';
        if (item.tvdbId) lookup.byTvdb.set(`${mediaType}:${item.tvdbId}`, item);
        if (item.tmdbId) lookup.byTmdb.set(`${mediaType}:${item.tmdbId}`, item);
        if (item.imdbId) lookup.byImdb.set(String(item.imdbId).toLowerCase(), item);
        const titleKey = `${normalized(item.title)}|${Number(item.year) || ''}`;
        if (!lookup.byTitleYear.has(titleKey)) lookup.byTitleYear.set(titleKey, item);
    });
    return lookup;
};

const findPlexPosterItem = (lookup, { mediaType = 'show', title, year, tvdbId, tmdbId, imdbId } = {}) => {
    if (!lookup) return null;
    const type = mediaType === 'show' ? 'show' : 'movie';
    if (tvdbId != null && lookup.byTvdb.get(`${type}:${String(tvdbId)}`)) return lookup.byTvdb.get(`${type}:${String(tvdbId)}`);
    if (tmdbId != null && lookup.byTmdb.get(`${type}:${String(tmdbId)}`)) return lookup.byTmdb.get(`${type}:${String(tmdbId)}`);
    if (imdbId && lookup.byImdb.get(String(imdbId).toLowerCase())) return lookup.byImdb.get(String(imdbId).toLowerCase());
    const titleKey = `${normalized(title)}|${Number(year) || ''}`;
    const match = lookup.byTitleYear.get(titleKey);
    if (match && (match.mediaType === type || !match.mediaType)) return match;
    return null;
};

const applyUpgraderPosterFields = (item, { arrType, instanceId, entityId, mediaType, title, year, tvdbId, tmdbId, imdbId }, plexLookup) => {
    const arrCoverUrl = buildUpgraderCoverUrl(arrType, instanceId, entityId);
    const plexItem = findPlexPosterItem(plexLookup, { mediaType, title, year, tvdbId, tmdbId, imdbId });
    const plexThumb = plexItem?.thumb || '';
    return {
        ...item,
        thumb: plexThumb,
        thumbUrl: plexThumb ? upgraderPlexPosterUrl(plexThumb) : arrCoverUrl,
        posterFallbackUrl: arrCoverUrl,
        posterSource: plexThumb ? 'plex' : arrType,
    };
};

const enrichUpgraderItemPosters = (item, plexLookup) => {
    if (!item?.arrEntityId || !item?.arrInstanceId || !item?.arrType) return item;
    return applyUpgraderPosterFields(item, {
        arrType: item.arrType,
        instanceId: item.arrInstanceId,
        entityId: item.arrEntityId,
        mediaType: item.mediaType === 'show' ? 'show' : 'movie',
        title: item.title,
        year: item.year,
        tvdbId: item.tvdbId,
        tmdbId: item.tmdbId,
        imdbId: item.imdbId,
    }, plexLookup);
};

const mapSonarrSeriesToUpgraderItem = (series, instance, fileStats = {}, episodeCount = 0, plexItem = null) => {
    const instanceName = instance.name || 'Sonarr';
    const entityId = Number(series.id);
    const ratingKey = buildUpgraderItemKey('sonarr', instance.id, entityId);
    const stats = series.statistics || {};
    const totalEpisodeCount = Number(stats.episodeCount || episodeCount || fileStats.totalFiles || 0);
    const deepUrl = buildArrDeepUrl(instance, series, 'sonarr');
    const arrCoverUrl = buildUpgraderCoverUrl('sonarr', instance.id, entityId);
    const plexThumb = plexItem?.thumb || '';
    return {
        ratingKey,
        title: series.title || 'Unknown',
        overview: series.overview || '',
        year: series.year != null ? Number(series.year) : null,
        thumb: plexThumb,
        thumbUrl: plexThumb ? upgraderPlexPosterUrl(plexThumb) : arrCoverUrl,
        posterFallbackUrl: arrCoverUrl,
        posterSource: plexThumb ? 'plex' : 'sonarr',
        mediaType: 'show',
        libraryTitle: instanceName,
        libraryId: String(instance.id),
        videoCodec: fileStats.videoCodec || '',
        videoResolution: fileStats.videoResolution || '',
        displayTags: fileStats.displayTags || [],
        sizeGB: fileStats.totalSizeGB || (stats.sizeOnDisk ? Math.round((Number(stats.sizeOnDisk) / (1024 ** 3)) * 100) / 100 : 0),
        watchCount: 0,
        addedAt: series.added || null,
        daysSinceAdded: series.added ? Math.floor((Date.now() - Date.parse(series.added)) / (24 * 60 * 60 * 1000)) : null,
        isHevc: !!fileStats.isHevc,
        hasHdr: !!fileStats.hasHdr,
        hasDolbyVision: !!fileStats.hasDolbyVision,
        is4k: !!fileStats.is4k,
        codecCounts: fileStats.codecCounts || {},
        codecSizesGB: fileStats.codecSizesGB || {},
        resCounts: fileStats.resCounts || {},
        totalEpisodeCount,
        nonHevcEpisodeCount: Number(fileStats.nonHevcCount || 0),
        nonHevcEpisodeSizeGB: Number(fileStats.nonHevcSizeGB || 0),
        zeroSizeCount: Number(fileStats.zeroSizeCount || 0),
        onDiskFileCount: Number(fileStats.totalFiles || 0),
        unknownCodecCount: Number(fileStats.unknownCodecCount || 0),
        tvdbId: series.tvdbId,
        tmdbId: series.tmdbId,
        imdbId: series.imdbId,
        plexUrl: null,
        arrMapped: true,
        arrType: 'sonarr',
        arrInstanceName: instanceName,
        arrInstanceId: instance.id,
        arrEntityId: entityId,
        arrDeepUrl: deepUrl,
        arrQualityProfileId: series.qualityProfileId != null ? Number(series.qualityProfileId) : null,
        dataSource: 'sonarr',
    };
};

const mapRadarrMovieToUpgraderItem = (movie, instance, plexItem = null) => {
    const fileStats = analyzeRadarrMovieFile(movie);
    const instanceName = instance.name || 'Radarr';
    const entityId = Number(movie.id);
    const ratingKey = buildUpgraderItemKey('radarr', instance.id, entityId);
    const arrCoverUrl = buildUpgraderCoverUrl('radarr', instance.id, entityId);
    const plexThumb = plexItem?.thumb || '';
    return {
        ratingKey,
        title: movie.title || 'Unknown',
        overview: movie.overview || '',
        year: movie.year != null ? Number(movie.year) : null,
        thumb: plexThumb,
        thumbUrl: plexThumb ? upgraderPlexPosterUrl(plexThumb) : arrCoverUrl,
        posterFallbackUrl: arrCoverUrl,
        posterSource: plexThumb ? 'plex' : 'radarr',
        mediaType: 'movie',
        libraryTitle: instanceName,
        libraryId: String(instance.id),
        videoCodec: fileStats.videoCodec,
        videoResolution: fileStats.videoResolution,
        displayTags: fileStats.displayTags,
        sizeGB: fileStats.sizeGB,
        watchCount: 0,
        addedAt: movie.added || null,
        daysSinceAdded: movie.added ? Math.floor((Date.now() - Date.parse(movie.added)) / (24 * 60 * 60 * 1000)) : null,
        isHevc: fileStats.isHevc,
        hasHdr: fileStats.hasHdr,
        hasDolbyVision: fileStats.hasDolbyVision,
        is4k: fileStats.is4k,
        zeroSizeCount: fileStats.zeroSizeCount,
        onDiskFileCount: movie?.movieFile ? 1 : 0,
        tvdbId: movie.tvdbId,
        tmdbId: movie.tmdbId,
        imdbId: movie.imdbId,
        plexUrl: null,
        arrMapped: true,
        arrType: 'radarr',
        arrInstanceName: instanceName,
        arrInstanceId: instance.id,
        arrEntityId: entityId,
        arrDeepUrl: buildArrDeepUrl(instance, movie, 'radarr'),
        arrQualityProfileId: movie.qualityProfileId != null ? Number(movie.qualityProfileId) : null,
        dataSource: 'radarr',
    };
};

const buildSonarrSeriesFingerprint = (series, files = []) => {
    const stats = series?.statistics || {};
    const filePart = files.length
        ? files.map((file) => `${file.id}:${file.size || 0}:${file.mediaInfo?.videoCodec || ''}:${file.mediaInfo?.height || 0}`).sort().join(',')
        : 'none';
    // v4: Plex codec fallback when Sonarr mediaInfo is empty.
    return `v4:${series?.qualityProfileId || 0}:${stats.episodeFileCount || 0}:${stats.sizeOnDisk || 0}:${filePart}`;
};

const buildRadarrMovieFingerprint = (movie) => {
    const file = movie?.movieFile;
    if (!file) return `v4:empty:${movie?.qualityProfileId || 0}`;
    const mediaInfo = file.mediaInfo || {};
    return `v4:${movie?.qualityProfileId || 0}:${file.id}:${file.size || 0}:${mediaInfo.videoCodec || ''}:${mediaInfo.height || 0}`;
};

const loadUpgraderPlexPosterLookup = async (config) => {
    if (!isPlexConfigured(config)) return null;
    const maintenancePayload = await loadFile(MAINTENANCE_MEDIA_INDEX_PATH, { items: [] });
    const maintenanceItems = Array.isArray(maintenancePayload.items) ? maintenancePayload.items : [];
    if (!maintenanceItems.length) {
        log('Upgrader index: no Plex maintenance index — posters will use Sonarr/Radarr covers until maintenance index is built');
        return null;
    }
    return buildPlexPosterLookup(maintenanceItems);
};

const buildUpgraderItemsForArrInstance = async (instance, { config, plexLookup, resolveUrl, prevByKey } = {}) => {
    const items = [];
    let reused = 0;
    const instanceLabel = instance.name || instance.id;

    if (instance.type === 'sonarr') {
        const fetchStarted = Date.now();
        const seriesList = await fetchArrInstanceCatalogItems(instance, { resolveUrl, fetchImpl: fetch });
        const seriesIdsWithFiles = seriesList.filter((series) => {
            const stats = series?.statistics || {};
            return Number(stats.episodeFileCount || 0) > 0 || Number(stats.sizeOnDisk || 0) > 0;
        }).length;
        const filesStarted = Date.now();
        const allFiles = await fetchSonarrAllEpisodeFiles(instance, {
            resolveUrl,
            fetchImpl: fetch,
            seriesList,
        });
        if (seriesIdsWithFiles > 0 && allFiles.length === 0) {
            log(`Upgrader index: Sonarr "${instanceLabel}" warning — ${seriesIdsWithFiles} series report files on disk but 0 episode files were returned`);
        } else if (allFiles.length > 0) {
            log(`Upgrader index: Sonarr "${instanceLabel}" loaded ${allFiles.length} episode files in ${Date.now() - filesStarted}ms (${seriesIdsWithFiles} series with files on disk)`);
        }
        log(`Upgrader index: Sonarr "${instanceLabel}" fetched in ${Date.now() - fetchStarted}ms (${seriesList.length} series, ${allFiles.length} episode files)`);

        const filesBySeries = allFiles.reduce((acc, file) => {
            const seriesId = Number(file.seriesId || 0);
            if (!seriesId) return acc;
            if (!acc[seriesId]) acc[seriesId] = [];
            acc[seriesId].push(file);
            return acc;
        }, {});

        for (const series of seriesList) {
            const seriesId = Number(series.id || 0);
            if (!seriesId) continue;
            let seriesFiles = filesBySeries[seriesId] || [];
            const fingerprint = buildSonarrSeriesFingerprint(series, seriesFiles);
            const ratingKey = buildUpgraderItemKey('sonarr', instance.id, seriesId);
            const posterMeta = {
                arrType: 'sonarr',
                instanceId: instance.id,
                entityId: seriesId,
                mediaType: 'show',
                title: series.title,
                year: series.year,
                tvdbId: series.tvdbId,
                tmdbId: series.tmdbId,
                imdbId: series.imdbId,
            };
            const prev = prevByKey.get(ratingKey);
            const missingSonarrCodec = seriesFiles.some((file) => !sonarrEpisodeFileHasVideoCodec(file));
            // Skip reuse when codecs are missing — we may fill them from Plex.
            if (prev?.arrFileFingerprint === fingerprint && prev.zeroSizeCount != null && !missingSonarrCodec && !(Number(prev.unknownCodecCount || 0) > 0)) {
                prev.overview = series.overview || '';
                items.push(applyUpgraderPosterFields(prev, posterMeta, plexLookup));
                reused += 1;
                continue;
            }
            if (missingSonarrCodec) {
                seriesFiles = await enrichSonarrFilesWithPlexCodecFallback(config, seriesFiles, posterMeta, plexLookup);
            }
            const fileStats = aggregateSonarrSeriesFileStats(seriesFiles);
            const plexItem = findPlexPosterItem(plexLookup, posterMeta);
            const item = mapSonarrSeriesToUpgraderItem(
                series,
                instance,
                fileStats,
                Number(series.statistics?.episodeCount || 0),
                plexItem,
            );
            item.arrFileFingerprint = fingerprint;
            items.push(item);
        }
    } else if (instance.type === 'radarr') {
        const fetchStarted = Date.now();
        const movies = await fetchArrInstanceCatalogItems(instance, { resolveUrl, fetchImpl: fetch });
        log(`Upgrader index: Radarr "${instanceLabel}" fetched in ${Date.now() - fetchStarted}ms (${movies.length} movies)`);

        movies.forEach((movie) => {
            if (!movie?.id) return;
            const fingerprint = buildRadarrMovieFingerprint(movie);
            const ratingKey = buildUpgraderItemKey('radarr', instance.id, movie.id);
            const posterMeta = {
                arrType: 'radarr',
                instanceId: instance.id,
                entityId: movie.id,
                mediaType: 'movie',
                title: movie.title,
                year: movie.year,
                tvdbId: movie.tvdbId,
                tmdbId: movie.tmdbId,
                imdbId: movie.imdbId,
            };
            const prev = prevByKey.get(ratingKey);
            if (prev?.arrFileFingerprint === fingerprint && prev.zeroSizeCount != null) {
                prev.overview = movie.overview || '';
                items.push(applyUpgraderPosterFields(prev, posterMeta, plexLookup));
                reused += 1;
                return;
            }
            const plexItem = findPlexPosterItem(plexLookup, posterMeta);
            const item = mapRadarrMovieToUpgraderItem(movie, instance, plexItem);
            item.arrFileFingerprint = fingerprint;
            items.push(item);
        });
    }

    return { items, reused };
};

const buildUpgraderArrIndex = async (config, { actor = null } = {}) => {
    markTaskStart(systemJobs.upgraderIndex);
    const buildStarted = Date.now();
    try {
        const instances = getArrInstances(config, { enabledOnly: true })
            .filter((entry) => entry.type === 'sonarr' || entry.type === 'radarr')
            .filter(isArrInstanceReady);
        if (!instances.length) {
            throw new Error('No ready Sonarr or Radarr instances configured.');
        }

        const resolveUrl = resolveIntegrationUrlForFetch;
        const [plexLookup, prevPayload] = await Promise.all([
            loadUpgraderPlexPosterLookup(config),
            loadUpgraderIndex(),
        ]);
        const prevByKey = new Map((Array.isArray(prevPayload.items) ? prevPayload.items : []).map((item) => [item.ratingKey, item]));

        const instanceResults = await Promise.all(
            instances.map((instance) => buildUpgraderItemsForArrInstance(instance, { config, plexLookup, resolveUrl, prevByKey })),
        );
        const items = instanceResults.flatMap((result) => result.items);
        const reusedCount = instanceResults.reduce((sum, result) => sum + result.reused, 0);
        log(`Upgrader index: ${items.length} items (${reusedCount} unchanged, ${items.length - reusedCount} rebuilt) in ${Date.now() - buildStarted}ms`);

        const payload = {
            generatedAt: new Date().toISOString(),
            itemCount: items.length,
            dataSource: 'arr',
            items,
        };
        await saveFile(UPGRADER_INDEX_PATH, payload);
        markTaskEnd(systemJobs.upgraderIndex, null);
        await appendAuditLog('upgrader_index_rebuilt', actor, null, {
            itemCount: items.length,
            reusedCount,
            durationMs: Date.now() - buildStarted,
            sonarrSeries: items.filter((item) => item.mediaType === 'show').length,
            radarrMovies: items.filter((item) => item.mediaType === 'movie').length,
        });
        return payload;
    } catch (error) {
        markTaskEnd(systemJobs.upgraderIndex, error);
        throw error;
    }
};

const loadUpgraderIndex = async () => loadFile(UPGRADER_INDEX_PATH, { generatedAt: null, itemCount: 0, items: [] });

const mapSonarrFileToEpisodeQuality = (file = null) => {
    const qualityLabel = getSonarrEpisodeQualityLabel(file);
    const mediaInfo = file?.mediaInfo || {};
    const codec = normalizeArrVideoCodecKey(mediaInfo.videoCodec || mediaInfo.videoFormat || '');
    const width = Number(mediaInfo.width || 0);
    const height = Number(mediaInfo.height || 0);
    const tags = [];
    if (qualityLabel) tags.push(qualityLabel);
    if (width >= 3800 || height >= 2000) tags.push('4K');
    else if (height >= 1000) tags.push('1080p');
    else if (height >= 700) tags.push('720p');
    const derived = deriveQualityFieldsFromTags(tags, codec);
    const sizeBytes = Number(file?.size || mediaInfo.size || 0);
    return {
        videoCodec: codec,
        videoResolution: width >= 3800 || height >= 2000 ? '4k' : height >= 1000 ? '1080' : height >= 700 ? '720' : '',
        displayTags: derived.displayTags.length ? derived.displayTags : (qualityLabel ? [qualityLabel] : []),
        isHevc: derived.isHevc,
        hasHdr: derived.hasHdr,
        hasDolbyVision: derived.hasDolbyVision,
        sizeGB: sizeBytes ? Math.round((sizeBytes / (1024 ** 3)) * 100) / 100 : 0,
    };
};

const buildUpgraderEpisodesFromSonarr = (sonarrEpisodes, sonarrFiles, showTitle, codecs, resolutions, features, qualities, minSizeGB, plexEpisodes = [], arrInstanceId = null) => {
    const fileById = new Map(
        sonarrFiles.map((file) => [Number(file.id), file]),
    );

    const plexEpMap = new Map();
    plexEpisodes.forEach(ep => {
        if (ep.seasonNumber != null && ep.episodeNumber != null) {
            plexEpMap.set(`${ep.seasonNumber}-${ep.episodeNumber}`, ep);
        }
    });

    return sonarrEpisodes.map((sonarrEpisode) => {
        const seasonNumber = sonarrEpisode.seasonNumber != null ? Number(sonarrEpisode.seasonNumber) : null;
        const episodeNumber = sonarrEpisode.episodeNumber != null ? Number(sonarrEpisode.episodeNumber) : null;
        const sonarrFile = sonarrEpisode?.episodeFileId ? fileById.get(Number(sonarrEpisode.episodeFileId)) : null;
        let sonarrQuality = mapSonarrFileToEpisodeQuality(sonarrFile);
        
        const plexEp = plexEpMap.get(`${seasonNumber}-${episodeNumber}`);
        // Prefer Sonarr mediaInfo; if empty, use Plex codec for the same episode.
        if ((!sonarrQuality.videoCodec || !sonarrQuality.videoResolution) && plexEp) {
            const plexCodec = normalizeArrVideoCodecKey(plexEp.videoCodec);
            if (plexCodec && !sonarrQuality.videoCodec) {
                sonarrQuality = {
                    ...sonarrQuality,
                    videoCodec: plexCodec,
                    isHevc: !!plexEp.isHevc || isHevcVideoCodec(plexCodec),
                    hasHdr: sonarrQuality.hasHdr || !!plexEp.hasHdr,
                    hasDolbyVision: sonarrQuality.hasDolbyVision || !!plexEp.hasDolbyVision,
                    displayTags: (sonarrQuality.displayTags || []).length
                        ? sonarrQuality.displayTags
                        : (plexEp.displayTags || []),
                };
            }
            if (!sonarrQuality.videoResolution && plexEp.videoResolution) {
                const res = String(plexEp.videoResolution).toLowerCase();
                sonarrQuality = {
                    ...sonarrQuality,
                    videoResolution: res.includes('4k') || res.includes('2160')
                        ? '4k'
                        : res.includes('1080')
                            ? '1080'
                            : res.includes('720')
                                ? '720'
                                : res,
                };
            }
        }
        
        let thumbUrl = plexEp?.thumb ? `/api/plex/image?path=${encodeURIComponent(plexEp.thumb)}&width=400&height=225` : null;
        // Always provide an episode image URL when we have instance+episode data — the endpoint handles fallbacks
        if (!thumbUrl && arrInstanceId && sonarrEpisode.id) {
            thumbUrl = `/api/upgrader/arr-episode-image?instanceId=${arrInstanceId}&episodeId=${sonarrEpisode.id}`;
        }

        const episode = {
            ratingKey: `sonarr-ep-${sonarrEpisode.id}`,
            title: sonarrEpisode.title || `Episode ${episodeNumber ?? '?'}`,
            overview: sonarrEpisode.overview || '',
            airDateUtc: sonarrEpisode.airDateUtc || null,
            showTitle,
            seasonNumber,
            episodeNumber,
            thumb: plexEp?.thumb || '',
            thumbUrl,
            mediaType: 'episode',
            videoCodec: sonarrQuality.videoCodec,
            videoResolution: sonarrQuality.videoResolution,
            sizeGB: sonarrQuality.sizeGB,
            displayTags: sonarrQuality.displayTags,
            isHevc: sonarrQuality.isHevc,
            hasHdr: sonarrQuality.hasHdr,
            hasDolbyVision: sonarrQuality.hasDolbyVision,
            plexUrl: plexEp?.plexUrl || null,
            arrEpisodeId: sonarrEpisode?.id != null ? Number(sonarrEpisode.id) : null,
            arrHasFile: !!(sonarrEpisode?.hasFile || sonarrFile),
            arrQualityLabel: getSonarrEpisodeQualityLabel(sonarrFile),
            arrReleaseGroup: sonarrFile?.releaseGroup || null,
            arrCustomFormats: Array.isArray(sonarrFile?.customFormats) ? sonarrFile.customFormats.map(cf => cf.name) : [],
            arrMonitored: sonarrEpisode?.monitored ?? null,
            dataSource: 'sonarr',
        };
        episode.matchesPreset = applyUpgraderMultiFilterEpisode(episode, codecs, resolutions, features, qualities, minSizeGB);
        return episode;
    });
};

const buildUpgraderShowDetail = async (config, showItem, codecs = [], resolutions = [], features = [], qualities = [], minSizeGB = 5) => {
    const parsed = parseUpgraderItemKey(showItem.ratingKey);
    if (!parsed || parsed.type !== 'sonarr') {
        throw new Error('Show detail is only available for Sonarr series in the Upgrader index.');
    }

    const instance = getArrInstance(config, parsed.instanceId);
    if (!instance || !isArrInstanceReady(instance)) {
        throw new Error('Sonarr instance is not ready.');
    }

    const resolveUrl = resolveIntegrationUrlForFetch;
    const [series, sonarrEpisodes, sonarrFiles, profiles, plexLookup] = await Promise.all([
        fetchSonarrSeriesById(instance, parsed.entityId, { resolveUrl, fetchImpl: fetch }),
        fetchSonarrEpisodesForSeries(instance, parsed.entityId, { resolveUrl, fetchImpl: fetch }),
        fetchSonarrEpisodeFilesForSeries(instance, parsed.entityId, { resolveUrl, fetchImpl: fetch }),
        fetchArrQualityProfiles(instance, { resolveUrl, fetchImpl: fetch }),
        loadUpgraderPlexPosterLookup(config),
    ]);

    if (!series?.id) {
        throw new Error('Series not found in Sonarr.');
    }

    const plexItem = findPlexPosterItem(plexLookup, { 
        mediaType: 'show', 
        title: series.title || showItem.title, 
        year: series.year || showItem.year, 
        tvdbId: series.tvdbId || showItem.tvdbId, 
        tmdbId: series.tmdbId || showItem.tmdbId, 
        imdbId: series.imdbId || showItem.imdbId 
    });

    let plexEpisodes = [];
    if (plexItem?.ratingKey && isPlexConfigured(config)) {
        plexEpisodes = await fetchPlexShowEpisodes(config, config.plexUrl, { ratingKey: plexItem.ratingKey }).catch(() => []);
    }

    const enrichedEpisodes = buildUpgraderEpisodesFromSonarr(
        sonarrEpisodes,
        sonarrFiles,
        series.title || showItem.title,
        codecs,
        resolutions,
        features,
        qualities,
        minSizeGB,
        plexEpisodes,
        instance.id
    );

    const currentProfileId = Number(series.qualityProfileId || showItem.arrQualityProfileId || 0) || null;
    const currentProfileName = getProfileNameById(profiles, currentProfileId);
    const targetProfileId = resolveUpgraderTargetProfileId(config, instance.id, 0) || null;
    const targetProfileName = getProfileNameById(profiles, targetProfileId);

    const seasonMap = new Map();
    enrichedEpisodes.forEach((episode) => {
        const seasonNumber = episode.seasonNumber != null ? Number(episode.seasonNumber) : -1;
        if (!seasonMap.has(seasonNumber)) {
            seasonMap.set(seasonNumber, { seasonNumber, episodes: [], matchedCount: 0 });
        }
        const bucket = seasonMap.get(seasonNumber);
        bucket.episodes.push(episode);
        if (episode.matchesPreset) bucket.matchedCount += 1;
    });

    const seasons = Array.from(seasonMap.values())
        .sort((a, b) => a.seasonNumber - b.seasonNumber)
        .map((season) => ({
            seasonNumber: season.seasonNumber,
            episodeCount: season.episodes.length,
            matchedCount: season.matchedCount,
            episodes: season.episodes.sort((a, b) => Number(a.episodeNumber || 0) - Number(b.episodeNumber || 0)),
        }));

    const matchedCount = enrichedEpisodes.filter((episode) => episode.matchesPreset).length;
    const deepUrl = buildArrDeepUrl(instance, series, 'sonarr');

    return {
        show: {
            ratingKey: showItem.ratingKey,
            title: series.title || showItem.title || 'Unknown',
            year: series.year != null ? Number(series.year) : (showItem.year ?? null),
            thumb: showItem.thumb || '',
            thumbUrl: showItem.thumbUrl || buildUpgraderCoverUrl('sonarr', instance.id, series.id),
            mediaType: 'show',
            libraryTitle: instance.name || 'Sonarr',
            totalEpisodeCount: sonarrEpisodes.length,
            nonHevcEpisodeCount: enrichedEpisodes.filter((e) => !e.isHevc).length,
            plexUrl: null,
            arrMapped: true,
            arrType: 'sonarr',
            arrInstanceId: instance.id,
            arrInstanceName: instance.name || 'Sonarr',
            arrDeepUrl: deepUrl,
            arrQualityProfileId: currentProfileId,
            arrQualityProfileName: currentProfileName,
            targetQualityProfileId: targetProfileId,
            targetQualityProfileName: targetProfileName,
        },
        codecs,
        resolutions,
        features,
        episodeSource: 'sonarr',
        stats: {
            total: enrichedEpisodes.length,
            matched: matchedCount,
            sonarrEpisodes: sonarrEpisodes.length,
            plexEpisodes: 0,
        },
        arr: {
            mapped: true,
            seriesId: Number(series.id),
            instanceId: instance.id,
            instanceName: instance.name || 'Sonarr',
            monitored: series.monitored ?? null,
            currentProfileId,
            currentProfileName,
            targetProfileId,
            targetProfileName,
            deepUrl,
        },
        seasons,
        episodes: enrichedEpisodes,
        total: enrichedEpisodes.length,
    };
};

const UPGRADER_PREFS_DEFAULTS = {
    exclusions: {
        ratingKeys: [],
        episodeKeys: [],
        titles: [],
        libraries: [],
    },
    snoozed: [],
};

const loadUpgraderPreferences = async () => {
    const raw = await loadFile(UPGRADER_PREFS_PATH, UPGRADER_PREFS_DEFAULTS);
    return {
        exclusions: {
            ratingKeys: Array.isArray(raw?.exclusions?.ratingKeys) ? raw.exclusions.ratingKeys.map(String) : [],
            episodeKeys: Array.isArray(raw?.exclusions?.episodeKeys) ? raw.exclusions.episodeKeys.map(String) : [],
            titles: Array.isArray(raw?.exclusions?.titles) ? raw.exclusions.titles.map(String) : [],
            libraries: Array.isArray(raw?.exclusions?.libraries) ? raw.exclusions.libraries.map(String) : [],
        },
        snoozed: Array.isArray(raw?.snoozed) ? raw.snoozed.map((entry) => ({
            ratingKey: String(entry?.ratingKey || ''),
            until: entry?.until || null,
            reason: entry?.reason || null,
        })).filter((entry) => entry.ratingKey) : [],
    };
};

const saveUpgraderPreferences = async (prefs = UPGRADER_PREFS_DEFAULTS) => {
    const normalized = {
        exclusions: {
            ratingKeys: Array.isArray(prefs?.exclusions?.ratingKeys) ? prefs.exclusions.ratingKeys.map(String) : [],
            episodeKeys: Array.isArray(prefs?.exclusions?.episodeKeys) ? prefs.exclusions.episodeKeys.map(String) : [],
            titles: Array.isArray(prefs?.exclusions?.titles) ? prefs.exclusions.titles.map(String) : [],
            libraries: Array.isArray(prefs?.exclusions?.libraries) ? prefs.exclusions.libraries.map(String) : [],
        },
        snoozed: Array.isArray(prefs?.snoozed) ? prefs.snoozed.map((entry) => ({
            ratingKey: String(entry?.ratingKey || ''),
            until: entry?.until || null,
            reason: entry?.reason || null,
        })).filter((entry) => entry.ratingKey) : [],
    };
    await saveFile(UPGRADER_PREFS_PATH, normalized);
    return normalized;
};

const isUpgraderSnoozed = (item, upgraderPrefs = UPGRADER_PREFS_DEFAULTS) => {
    const match = (upgraderPrefs.snoozed || []).find((entry) => String(entry.ratingKey) === String(item.ratingKey || ''));
    if (!match?.until) return false;
    return Date.parse(match.until) > Date.now();
};

const buildUpgraderExclusionSets = (maintenancePrefs, upgraderPrefs) => ({
    ratingKeys: new Set([
        ...(maintenancePrefs?.exclusions?.ratingKeys || []).map(String),
        ...(upgraderPrefs?.exclusions?.ratingKeys || []).map(String),
    ]),
    titles: new Set([
        ...(maintenancePrefs?.exclusions?.titles || []).map((v) => normalized(v)),
        ...(upgraderPrefs?.exclusions?.titles || []).map((v) => normalized(v)),
    ]),
    libraries: new Set([
        ...(maintenancePrefs?.exclusions?.libraries || []).map((v) => normalized(v)),
        ...(upgraderPrefs?.exclusions?.libraries || []).map((v) => normalized(v)),
    ]),
    snoozedRatingKeys: new Set(
        (upgraderPrefs?.snoozed || [])
            .filter((entry) => entry?.until && Date.parse(entry.until) > Date.now())
            .map((entry) => String(entry.ratingKey)),
    ),
});

const mapUpgraderApiItem = (item, exclusions = { ratingKeys: new Set(), titles: new Set(), libraries: new Set(), snoozedRatingKeys: new Set() }) => {
    const excluded = exclusions.ratingKeys.has(String(item.ratingKey || ''))
        || exclusions.titles.has(normalized(item.title))
        || exclusions.libraries.has(normalized(item.libraryTitle))
        || exclusions.snoozedRatingKeys.has(String(item.ratingKey || ''));
    const snoozed = exclusions.snoozedRatingKeys.has(String(item.ratingKey || ''));
    const codecCounts = mergeUpgraderCodecMaps(item.codecCounts);
    const codecSizesGBRaw = mergeUpgraderCodecMaps(item.codecSizesGB);
    const codecSizesGB = {};
    Object.entries(codecSizesGBRaw).forEach(([key, size]) => {
        codecSizesGB[key] = Math.round(Number(size || 0) * 100) / 100;
    });
    const dominantCodec = Object.entries(codecCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
        || normalizeArrVideoCodecKey(item.videoCodec)
        || '';
    const onDiskFileCount = Number(item.onDiskFileCount || 0)
        || Object.values(codecCounts).reduce((sum, count) => sum + Number(count || 0), 0);
    const knownCodecFileCount = Object.values(codecCounts).reduce((sum, count) => sum + Number(count || 0), 0);
    const unknownCodecCount = Number(item.unknownCodecCount || 0)
        || Math.max(0, onDiskFileCount - knownCodecFileCount);
    return {
        ratingKey: String(item.ratingKey || ''),
        title: item.title || 'Unknown',
        overview: item.overview || '',
        year: item.year || null,
        codecCounts: Object.keys(codecCounts).length ? codecCounts : undefined,
        codecSizesGB: Object.keys(codecSizesGB).length ? codecSizesGB : undefined,
        resCounts: item.resCounts || undefined,
        thumb: item.thumb || '',
        thumbUrl: item.thumbUrl || null,
        posterFallbackUrl: item.posterFallbackUrl || null,
        mediaType: item.mediaType || 'movie',
        libraryTitle: item.libraryTitle || 'Library',
        libraryId: String(item.libraryId || ''),
        videoCodec: dominantCodec || normalizeArrVideoCodecKey(item.videoCodec) || item.videoCodec || '',
        videoResolution: item.videoResolution || '',
        displayTags: Array.isArray(item.displayTags) ? item.displayTags : [],
        sizeGB: Number(item.sizeGB || 0),
        watchCount: Number(item.watchCount || 0),
        addedAt: item.addedAt || null,
        daysSinceAdded: item.daysSinceAdded != null ? Number(item.daysSinceAdded) : null,
        isHevc: !!item.isHevc,
        hasHdr: !!item.hasHdr,
        hasDolbyVision: !!item.hasDolbyVision,
        totalEpisodeCount: Number(item.totalEpisodeCount || 0),
        nonHevcEpisodeCount: Number(item.nonHevcEpisodeCount || 0),
        nonHevcEpisodeSizeGB: Number(item.nonHevcEpisodeSizeGB || 0),
        onDiskFileCount,
        knownCodecFileCount,
        unknownCodecCount,
        plexUrl: item.plexUrl || null,
        arrMapped: !!item.arrMapped,
        arrType: item.arrType || 'none',
        arrInstanceName: item.arrInstanceName || null,
        arrInstanceId: item.arrInstanceId || null,
        arrEntityId: item.arrEntityId != null ? Number(item.arrEntityId) : null,
        arrDeepUrl: item.arrDeepUrl || null,
        tvdbId: item.tvdbId ?? null,
        tmdbId: item.tmdbId ?? null,
        imdbId: item.imdbId ?? null,
        arrQualityProfileId: item.arrQualityProfileId != null ? Number(item.arrQualityProfileId) : null,
        excluded,
        snoozed,
    };
};

const UPGRADER_SORT_IDS = new Set(['title', 'sizeGB', 'watchCount', 'addedAt', 'daysSinceAdded', 'staleAdded', 'hevcFirst', 'h264First', 'av1First']);
const upgraderUpgradeState = { running: false };

const normalizeUpgraderProfileMap = (raw = {}) => {
    const source = raw && typeof raw === 'object' ? raw : {};
    const next = {};
    Object.entries(source).forEach(([instanceId, entry]) => {
        const hevcProfileId = Number(entry?.hevcProfileId || 0);
        const fallbackProfileId = Number(entry?.fallbackProfileId || 0);
        if (!instanceId || !hevcProfileId) return;
        next[String(instanceId)] = {
            hevcProfileId,
            ...(fallbackProfileId > 0 ? { fallbackProfileId } : {}),
        };
    });
    return next;
};

const loadUpgraderAuditEntries = async () => {
    const raw = await loadFile(UPGRADER_AUDIT_PATH, []);
    return Array.isArray(raw) ? raw : [];
};

const appendUpgraderAuditEntry = async (entry = {}) => {
    const existing = await loadUpgraderAuditEntries();
    const record = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        ...entry,
    };
    await saveFile(UPGRADER_AUDIT_PATH, [record, ...existing].slice(0, 500));
    return record;
};

const countRecentUpgraderActions = async (hours = 1) => {
    const cutoff = Date.now() - (Math.max(1, Number(hours) || 1) * 60 * 60 * 1000);
    const entries = await loadUpgraderAuditEntries();
    return entries.filter((entry) => !entry?.dryRun && Date.parse(entry?.timestamp || 0) >= cutoff).length;
};

const resolveUpgraderTargetProfileId = (config, instanceId, overrideProfileId = 0) => {
    const override = Number(overrideProfileId || 0);
    if (override > 0) return override;
    const map = normalizeUpgraderProfileMap(config?.upgraderProfileMap);
    return Number(map[String(instanceId || '')]?.hevcProfileId || 0);
};

const getProfileNameById = (profiles = [], profileId) => {
    const match = profiles.find((entry) => Number(entry.id) === Number(profileId));
    return match?.name || (profileId ? `Profile ${profileId}` : null);
};

const buildUpgraderProfilesPayload = async (config) => {
    const instances = getArrInstances(config, { enabledOnly: true })
        .filter((entry) => entry.type === 'sonarr' || entry.type === 'radarr')
        .filter(isArrInstanceReady);
    const resolveUrl = resolveIntegrationUrlForFetch;
    const results = await Promise.all(instances.map(async (instance) => {
        const profiles = await fetchArrQualityProfiles(instance, { resolveUrl, fetchImpl: fetch });
        const map = normalizeUpgraderProfileMap(config?.upgraderProfileMap);
        const mapped = map[instance.id] || {};
        return {
            id: instance.id,
            name: instance.name || (instance.type === 'radarr' ? 'Radarr' : 'Sonarr'),
            type: instance.type,
            profiles,
            hevcProfileId: Number(mapped.hevcProfileId || 0) || null,
            fallbackProfileId: Number(mapped.fallbackProfileId || 0) || null,
        };
    }));
    return results;
};

const executeUpgraderUpgradeBatch = async ({
    config,
    ratingKeys = [],
    dryRun = true,
    qualityProfileId = 0,
    triggerSearch = true,
    profileChangeOnly = false,
    actor = null,
} = {}) => {
    if (!Array.isArray(ratingKeys) || ratingKeys.length === 0) {
        throw new Error('At least one ratingKey is required.');
    }
    if (ratingKeys.length > 50) {
        throw new Error('Maximum 50 titles per upgrade batch.');
    }
    if (!dryRun && !config?.upgraderAutomationEnabled) {
        throw new Error('Upgrader automation is disabled. Enable it in Settings first.');
    }

    const maxPerHour = Math.max(1, Number(config?.upgraderMaxActionsPerHour) || 25);
    if (!dryRun) {
        const recentCount = await countRecentUpgraderActions(1);
        if (recentCount + ratingKeys.length > maxPerHour) {
            throw new Error(`Rate limit exceeded (${maxPerHour}/hour). ${recentCount} upgrades already ran in the last hour.`);
        }
    }

    const payload = await loadUpgraderIndex();
    const allItems = Array.isArray(payload.items) ? payload.items : [];
    const itemMap = new Map(allItems.map((item) => [String(item.ratingKey || ''), item]));
    const profileCache = new Map();
    const results = [];

    for (const rawKey of ratingKeys) {
        const ratingKey = String(rawKey || '').trim();
        const item = itemMap.get(ratingKey);
        if (!item) {
            results.push({ ratingKey, success: false, reason: 'Title not found in Upgrader index. Rebuild the index first.' });
            continue;
        }
        if (!profileChangeOnly) {
            if (item.isHevc && item.mediaType !== 'show') {
                results.push({ ratingKey, title: item.title, success: false, reason: 'Already HEVC in Sonarr/Radarr.' });
                continue;
            }
            if (item.mediaType === 'show' && Number(item.nonHevcEpisodeCount || 0) === 0 && item.isHevc) {
                results.push({ ratingKey, title: item.title, success: false, reason: 'All indexed episodes are already HEVC.' });
                continue;
            }
            if (!isUpgraderCandidate(item) && item.mediaType !== 'show') {
                results.push({ ratingKey, title: item.title, success: false, reason: 'Already HEVC in Sonarr/Radarr.' });
                continue;
            }
        }

        const instance = item.arrInstanceId ? getArrInstance(config, item.arrInstanceId) : null;
        if (!instance || !isArrInstanceReady(instance)) {
            results.push({ ratingKey, title: item.title, success: false, reason: 'ARR instance is not ready.' });
            continue;
        }

        const resolveUrl = resolveIntegrationUrlForFetch;
        let entity = null;
        let arrType = item.arrType || instance.type;
        if (arrType === 'sonarr') {
            entity = await fetchSonarrSeriesById(instance, item.arrEntityId, { resolveUrl, fetchImpl: fetch });
        } else {
            entity = await fetchArrInstanceJson(instance, `/api/v3/movie/${item.arrEntityId}`, { resolveUrl, fetchImpl: fetch });
        }
        if (!entity?.id) {
            results.push({ ratingKey, title: item.title, success: false, reason: 'Could not load title from Sonarr/Radarr.' });
            continue;
        }

        const resolved = {
            type: arrType,
            entity,
            instanceId: instance.id,
            instanceName: item.arrInstanceName || instance.name,
        };

        const targetProfileId = profileChangeOnly
            ? Number(qualityProfileId || 0)
            : resolveUpgraderTargetProfileId(config, resolved.instanceId, qualityProfileId);
        if (!targetProfileId) {
            results.push({
                ratingKey,
                title: item.title,
                success: false,
                reason: profileChangeOnly
                    ? 'Select a quality profile to apply.'
                    : `No HEVC quality profile configured for ${resolved.instanceName || instance.name}.`,
            });
            continue;
        }

        if (!profileCache.has(instance.id)) {
            const profiles = await fetchArrQualityProfiles(instance, { resolveUrl: resolveIntegrationUrlForFetch, fetchImpl: fetch });
            profileCache.set(instance.id, profiles);
        }
        const profiles = profileCache.get(instance.id) || [];
        const currentProfileId = Number(resolved.entity.qualityProfileId || item.arrQualityProfileId || 0) || null;

        if (profileChangeOnly && currentProfileId === targetProfileId) {
            results.push({
                ratingKey,
                title: item.title,
                mediaType: item.mediaType,
                arrType: resolved.type,
                arrInstanceId: resolved.instanceId,
                arrInstanceName: resolved.instanceName || instance.name,
                currentProfileId,
                currentProfileName: getProfileNameById(profiles, currentProfileId),
                targetProfileId,
                targetProfileName: getProfileNameById(profiles, targetProfileId),
                dryRun: !!dryRun,
                success: true,
                skipped: true,
                reason: 'Already on this profile.',
            });
            continue;
        }

        const preview = {
            ratingKey,
            title: item.title,
            mediaType: item.mediaType,
            arrType: resolved.type,
            arrInstanceId: resolved.instanceId,
            arrInstanceName: resolved.instanceName || instance.name,
            currentProfileId,
            currentProfileName: getProfileNameById(profiles, currentProfileId),
            targetProfileId,
            targetProfileName: getProfileNameById(profiles, targetProfileId),
            videoCodec: item.videoCodec,
            displayTags: item.displayTags || [],
            dryRun: !!dryRun,
        };

        if (dryRun) {
            results.push({ ...preview, success: true });
            continue;
        }

        const updateResult = await updateArrEntityQualityProfile(instance, resolved.entity, resolved.type, targetProfileId, {
            resolveUrl: resolveIntegrationUrlForFetch,
            fetchImpl: fetch,
        });
        if (!updateResult.ok) {
            results.push({ ...preview, success: false, reason: updateResult.reason || 'Profile update failed.' });
            continue;
        }

        let searchResult = null;
        if (triggerSearch) {
            searchResult = await triggerArrEntitySearch(instance, updateResult.entity || resolved.entity, resolved.type, {
                resolveUrl: resolveIntegrationUrlForFetch,
                fetchImpl: fetch,
            });
            if (!searchResult.ok) {
                results.push({
                    ...preview,
                    success: false,
                    reason: searchResult.reason || 'Search trigger failed after profile change.',
                    profileUpdated: true,
                });
                continue;
            }
        }

        const auditEntry = await appendUpgraderAuditEntry({
            action: profileChangeOnly ? 'profile_change' : 'upgrade',
            success: true,
            ratingKey,
            title: item.title,
            arrInstanceId: resolved.instanceId,
            arrInstanceName: resolved.instanceName || instance.name,
            arrType: resolved.type,
            currentProfileId,
            currentProfileName: getProfileNameById(profiles, currentProfileId),
            targetProfileId,
            targetProfileName: getProfileNameById(profiles, targetProfileId),
            triggerSearch: !!triggerSearch,
            commandId: searchResult?.commandId || null,
            actor: actor ? { username: actor.username || null, email: actor.email || null } : null,
            dryRun: false,
        });
        await appendAuditLog('upgrader_upgrade', actor, null, {
            ratingKey,
            title: item.title,
            arrInstanceName: resolved.instanceName || instance.name,
            targetProfileId,
            triggerSearch: !!triggerSearch,
            auditId: auditEntry.id,
        });
        results.push({
            ...preview,
            success: true,
            profileUpdated: true,
            searchTriggered: !!triggerSearch,
            commandId: searchResult?.commandId || null,
        });
    }

    const totals = results.reduce((acc, entry) => {
        if (entry.success) acc.succeeded += 1;
        else acc.failed += 1;
        return acc;
    }, { succeeded: 0, failed: 0 });

    return { dryRun: !!dryRun, results, totals };
};
const MAINTENANCE_PREFS_DEFAULTS = {
    global: {
        dryRunByDefault: true,
        maxActionsPerRun: 25,
        requireConfirmForDestructive: true
    },
    exclusions: {
        ratingKeys: [],
        titles: [],
        libraries: []
    }
};

const MAINTENANCE_FILTER_CATALOG = [
    { field: 'mediaType', label: 'Media Type', type: 'select', options: ['movie', 'show'], operators: ['equals', 'not_equals', 'in', 'not_in'] },
    { field: 'libraryTitle', label: 'Library', type: 'text', operators: ['equals', 'not_equals', 'contains', 'not_contains', 'in', 'not_in'] },
    { field: 'title', label: 'Title', type: 'text', operators: ['contains', 'not_contains', 'equals', 'not_equals', 'regex'] },
    { field: 'year', label: 'Year', type: 'number', operators: ['equals', 'not_equals', 'greater_than', 'less_than', 'between'] },
    { field: 'watchCount', label: 'Watch Count', type: 'number', operators: ['equals', 'not_equals', 'greater_than', 'less_than', 'between'] },
    { field: 'watchedEver', label: 'Watched Ever', type: 'boolean', operators: ['equals'] },
    { field: 'daysSinceLastWatch', label: 'Days Since Last Watch', type: 'number', operators: ['greater_than', 'less_than', 'between'] },
    { field: 'daysSinceAdded', label: 'Days Since Added', type: 'number', operators: ['greater_than', 'less_than', 'between'] },
    { field: 'durationMinutes', label: 'Duration (minutes)', type: 'number', operators: ['greater_than', 'less_than', 'between'] },
    { field: 'sizeGB', label: 'File Size (GB)', type: 'number', operators: ['greater_than', 'less_than', 'between'] },
    { field: 'videoResolution', label: 'Resolution', type: 'select', options: ['4k', '2160', '1440', '1080', '720', '576', '480', 'sd'], operators: ['equals', 'not_equals', 'in', 'not_in', 'contains'] },
    { field: 'videoCodec', label: 'Video Codec', type: 'text', operators: ['equals', 'not_equals', 'contains', 'not_contains'] },
    { field: 'audioCodec', label: 'Audio Codec', type: 'text', operators: ['equals', 'not_equals', 'contains', 'not_contains'] },
    { field: 'bitrateKbps', label: 'Bitrate (Kbps)', type: 'number', operators: ['greater_than', 'less_than', 'between'] },
    { field: 'genres', label: 'Genres', type: 'array', operators: ['contains', 'not_contains', 'in', 'not_in', 'is_empty', 'not_empty'] },
    { field: 'collections', label: 'Collections', type: 'array', operators: ['contains', 'not_contains', 'in', 'not_in', 'is_empty', 'not_empty'] },
    { field: 'labels', label: 'Labels', type: 'array', operators: ['contains', 'not_contains', 'in', 'not_in', 'is_empty', 'not_empty'] },
    { field: 'studio', label: 'Studio/Network', type: 'text', operators: ['contains', 'not_contains', 'equals', 'not_equals'] },
    { field: 'contentRating', label: 'Content Rating', type: 'text', operators: ['equals', 'not_equals', 'contains', 'not_contains'] },
    { field: 'tmdbRating', label: 'TMDB Rating', type: 'number', operators: ['equals', 'not_equals', 'greater_than', 'less_than', 'between'] },
    { field: 'rtCriticRating', label: 'Rotten Tomatoes Critic', type: 'number', operators: ['equals', 'not_equals', 'greater_than', 'less_than', 'between'] },
    { field: 'rtAudienceRating', label: 'Rotten Tomatoes Audience', type: 'number', operators: ['equals', 'not_equals', 'greater_than', 'less_than', 'between'] },
    { field: 'traktRating', label: 'Trakt Rating', type: 'number', operators: ['equals', 'not_equals', 'greater_than', 'less_than', 'between'] },
    { field: 'arrType', label: 'ARR Mapping Type', type: 'select', options: ['radarr', 'sonarr', 'none'], operators: ['equals', 'not_equals'] },
    { field: 'arrMapped', label: 'In Sonarr/Radarr', type: 'boolean', operators: ['equals'] },
    { field: 'arrInstanceName', label: 'ARR Instance', type: 'select', options: [], operators: ['equals', 'not_equals', 'in', 'not_in', 'contains'] },
    { field: 'arrInstanceId', label: 'ARR Instance ID', type: 'select', options: [], operators: ['equals', 'not_equals', 'in', 'not_in'] },
    { field: 'requestStatus', label: 'Request Status', type: 'text', operators: ['equals', 'not_equals', 'contains', 'not_contains', 'is_empty', 'not_empty'] },
    { field: 'requestType', label: 'Request Type', type: 'text', operators: ['equals', 'not_equals'] },
    { field: 'daysSinceRequested', label: 'Days Since Requested', type: 'number', operators: ['greater_than', 'less_than', 'between'] },
    { field: 'requestedBy', label: 'Requested By', type: 'text', operators: ['contains', 'not_contains', 'equals', 'not_equals'] },
    { field: 'is4k', label: '4K Item', type: 'boolean', operators: ['equals'] }
];

const maintenanceRunState = { running: false, lastRunAt: null, lastError: null };
const mToLower = (value) => String(value ?? '').toLowerCase();
const mAsArray = (value) => Array.isArray(value) ? value : (value === undefined || value === null ? [] : [value]);
const mToNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};
const daysSince = (timestamp) => {
    if (!timestamp) return null;
    const t = Date.parse(timestamp);
    if (!Number.isFinite(t)) return null;
    return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
};

const loadMaintenancePreferences = async () => {
    const raw = await loadFile(MAINTENANCE_PREFS_PATH, MAINTENANCE_PREFS_DEFAULTS);
    return {
        global: {
            ...MAINTENANCE_PREFS_DEFAULTS.global,
            ...(raw?.global || {})
        },
        exclusions: {
            ratingKeys: Array.isArray(raw?.exclusions?.ratingKeys) ? raw.exclusions.ratingKeys.map(v => String(v)) : [],
            titles: Array.isArray(raw?.exclusions?.titles) ? raw.exclusions.titles.map(v => String(v)) : [],
            libraries: Array.isArray(raw?.exclusions?.libraries) ? raw.exclusions.libraries.map(v => String(v)) : []
        }
    };
};

const applyMaintenanceExclusions = (items = [], preferences = MAINTENANCE_PREFS_DEFAULTS) => {
    const excludedKeys = new Set((preferences?.exclusions?.ratingKeys || []).map(v => String(v)));
    const excludedTitles = new Set((preferences?.exclusions?.titles || []).map(v => normalized(v)));
    const excludedLibraries = new Set((preferences?.exclusions?.libraries || []).map(v => normalized(v)));
    return (items || []).filter((item) => {
        if (!item) return false;
        if (excludedKeys.has(String(item.ratingKey || ''))) return false;
        if (excludedTitles.has(normalized(item.title))) return false;
        if (excludedLibraries.has(normalized(item.libraryTitle))) return false;
        return true;
    });
};

const parsePlexGuidIds = (guids = []) => {
    const parsed = { imdb: null, tmdb: null, tvdb: null };
    for (const g of guids) {
        const id = String(g?.id || '');
        if (!id) continue;
        const match = id.match(/^([a-z0-9]+):\/\/(.+)$/i);
        if (!match) continue;
        const kind = mToLower(match[1]);
        const raw = match[2];
        if (kind === 'imdb' && !parsed.imdb) parsed.imdb = raw;
        if (kind === 'tmdb' && !parsed.tmdb) parsed.tmdb = raw;
        if (kind === 'tvdb' && !parsed.tvdb) parsed.tvdb = raw;
    }
    return parsed;
};

const normalizeRequestItem = (input = {}) => ({
    id: input.id || input.requestId || input.mediaRequestId || null,
    status: input.status || input.requestStatus || input.state || '',
    type: input.type || input.mediaType || '',
    requestedBy: input.requestedBy || input.requestedByUsername || input.username || input.requestedByEmail || '',
    requestedAt: input.requestedAt || input.createdAt || input.requestDate || null,
    fulfilledAt: input.fulfilledAt || input.updatedAt || null,
    imdbId: input.imdbId || null,
    tmdbId: input.tmdbId ? String(input.tmdbId) : null,
    tvdbId: input.tvdbId ? String(input.tvdbId) : null
});

const getMaintenanceSettings = (rule) => ({
    ...MAINTENANCE_DEFAULTS,
    ...(rule?.settings || {})
});

const computeRuleGraceRemainingDays = (rule) => {
    const minGrace = Math.max(0, Number(rule?.graceDays || 0));
    const createdAtMs = Date.parse(String(rule?.createdAt || ''));
    const hasRuleCreatedAt = Number.isFinite(createdAtMs);
    const daysSinceRuleCreated = hasRuleCreatedAt
        ? Math.max(0, Math.floor((Date.now() - createdAtMs) / (24 * 60 * 60 * 1000)))
        : minGrace;
    return Math.max(0, minGrace - daysSinceRuleCreated);
};

const resolveMaintenanceMaxActions = (rule, preferences) => {
    const ruleMax = Number(rule?.settings?.maxActionsPerRun);
    if (Number.isFinite(ruleMax) && ruleMax > 0) return Math.max(1, Math.floor(ruleMax));
    const globalMax = Number(preferences?.global?.maxActionsPerRun);
    if (Number.isFinite(globalMax) && globalMax > 0) return Math.max(1, Math.floor(globalMax));
    return MAINTENANCE_DEFAULTS.maxActionsPerRun;
};

const sanitizeMaintenanceRuleForPersist = (rule) => {
    if (!rule || typeof rule !== 'object') return rule;
    const { overlay, _resetGrace, ...rest } = rule;
    return rest;
};

const validateMaintenanceDestructivePreflight = async (config, rule, catalog) => {
    const errors = [];
    const warnings = [];
    const indexPayload = await loadFile(MAINTENANCE_MEDIA_INDEX_PATH, { items: [], generatedAt: null });
    if (!indexPayload.generatedAt || !Array.isArray(indexPayload.items) || indexPayload.items.length === 0) {
        errors.push('Maintenance media index is empty. Rebuild the index before running destructive actions.');
    }
    const wantsDelete = rule?.actions?.deleteFromArr !== false;
    const wantsUnmonitor = !!rule?.actions?.unmonitor;
    const wantsQuality = Number(rule?.actions?.qualityProfileId || 0) > 0;
    if (wantsDelete || wantsUnmonitor || wantsQuality) {
        const radarrReady = (catalog?.counts?.radarr?.ready ?? getArrInstanceCounts(config).radarr.ready) > 0;
        const sonarrReady = (catalog?.counts?.sonarr?.ready ?? getArrInstanceCounts(config).sonarr.ready) > 0;
        const instanceCounts = catalog?.counts || getArrInstanceCounts(config);
        if (wantsDelete) {
            if (!radarrReady) warnings.push('Radarr is not configured — matched movies cannot be deleted.');
            if (!sonarrReady) warnings.push('Sonarr is not configured — matched shows cannot be deleted.');
            if (!radarrReady && !sonarrReady) {
                errors.push('Neither Radarr nor Sonarr is configured. Configure at least one integration before destructive delete.');
            }
        }
        if ((wantsDelete || wantsUnmonitor || wantsQuality) && radarrReady) {
            const radarrInstances = Object.values(catalog?.instances || {}).filter((entry) => entry.type === 'radarr');
            if (radarrInstances.length > 0 && radarrInstances.every((entry) => (entry.itemCount || 0) === 0)) {
                warnings.push('Radarr catalog is empty or unreachable — movie matches may be unactionable.');
            }
        }
        if ((wantsDelete || wantsUnmonitor || wantsQuality) && sonarrReady) {
            const sonarrInstances = Object.values(catalog?.instances || {}).filter((entry) => entry.type === 'sonarr');
            if (sonarrInstances.length > 0 && sonarrInstances.every((entry) => (entry.itemCount || 0) === 0)) {
                warnings.push('Sonarr catalog is empty or unreachable — show matches may be unactionable.');
            }
        }
        const readyInstances = Object.values(catalog?.instances || {}).filter((entry) => {
            const instance = getArrInstance(config, entry.id);
            return isArrInstanceReady(instance);
        });
        const notReady = Object.values(catalog?.instances || {}).filter((entry) => {
            const instance = getArrInstance(config, entry.id);
            return instance && !isArrInstanceReady(instance);
        });
        if (notReady.length > 0) {
            warnings.push(`Some ARR instances are not ready: ${notReady.map((entry) => entry.name || entry.id).join(', ')}.`);
        }
        if ((instanceCounts?.sonarr?.total || 0) > 1 || (instanceCounts?.radarr?.total || 0) > 1) {
            warnings.push('Multiple ARR instances are configured. Map Plex libraries to instances in Settings for accurate routing.');
        }
        if (readyInstances.length > 1) {
            warnings.push(`${readyInstances.length} ARR instances are reachable. Items mapped to multiple instances may route to the library-mapped or default instance.`);
        }
    }
    return { ok: errors.length === 0, errors, warnings };
};

const buildMaintenancePreviewForRule = (rule, allItems, preferences, catalog = null, config = {}, options = {}) => {
    const { limit = 300, includeAll = false } = options;
    const matches = applyMaintenanceExclusions(allItems.filter(item => evaluateMaintenanceRule(item, rule)), preferences);
    const graceRemainingDays = computeRuleGraceRemainingDays(rule);
    const maxActions = resolveMaintenanceMaxActions(rule, preferences);
    let actionableCount = 0;
    let unactionableCount = 0;
    let ambiguousCount = 0;
    const instanceBreakdown = {};

    if (catalog && graceRemainingDays <= 0) {
        for (const item of matches) {
            const resolved = resolveArrEntity(item, catalog, config);
            if (resolved.entity) {
                actionableCount += 1;
                if (resolved.instanceId) {
                    instanceBreakdown[resolved.instanceId] = (instanceBreakdown[resolved.instanceId] || 0) + 1;
                }
                if (resolved.ambiguous) ambiguousCount += 1;
            } else {
                unactionableCount += 1;
            }
        }
    }

    const sampleSource = includeAll ? matches : matches.slice(0, Math.max(1, Number(limit)));
    const sample = sampleSource.map((item) => {
        const resolved = catalog ? resolveArrEntity(item, catalog, config) : { type: 'none', entity: null, instanceId: null, instanceName: null, ambiguous: false, warning: null };
        return {
            ...item,
            graceRemainingDays,
            eligible: graceRemainingDays <= 0,
            arrResolvable: !!resolved.entity,
            arrType: resolved.type,
            arrInstanceId: resolved.instanceId || null,
            arrInstanceName: resolved.instanceName || null,
            arrAmbiguous: !!resolved.ambiguous,
            arrWarning: resolved.warning || null,
        };
    });

    const eligibleCount = graceRemainingDays <= 0 ? matches.length : 0;
    return {
        ruleId: rule.id,
        ruleName: rule.name,
        totalMatches: matches.length,
        graceRemainingDays,
        inGraceCount: graceRemainingDays > 0 ? matches.length : 0,
        eligibleCount,
        actionableCount,
        unactionableCount,
        ambiguousCount,
        instanceBreakdown,
        maxActionsPerRun: maxActions,
        wouldProcessCount: Math.min(maxActions, eligibleCount),
        sample
    };
};

const maintenanceValueMap = (item, field) => {
    switch (field) {
        case 'mediaType': return item.mediaType || '';
        case 'libraryTitle': return item.libraryTitle || '';
        case 'title': return item.title || '';
        case 'year': return item.year ?? null;
        case 'watchCount': return item.watchCount ?? 0;
        case 'watchedEver': return !!item.watchedEver;
        case 'daysSinceLastWatch': return item.daysSinceLastWatch ?? null;
        case 'daysSinceAdded': return item.daysSinceAdded ?? null;
        case 'durationMinutes': return item.durationMinutes ?? null;
        case 'sizeGB': return item.sizeGB ?? null;
        case 'videoResolution': return item.videoResolution || '';
        case 'videoCodec': return item.videoCodec || '';
        case 'audioCodec': return item.audioCodec || '';
        case 'bitrateKbps': return item.bitrateKbps ?? null;
        case 'genres': return item.genres || [];
        case 'collections': return item.collections || [];
        case 'labels': return item.labels || [];
        case 'studio': return item.studio || '';
        case 'contentRating': return item.contentRating || '';
        case 'tmdbRating': return item.tmdbRating ?? null;
        case 'rtCriticRating': return item.rtCriticRating ?? null;
        case 'rtAudienceRating': return item.rtAudienceRating ?? null;
        case 'traktRating': return item.traktRating ?? null;
        case 'arrType': return item.arrType || 'none';
        case 'arrMapped': return !!item.arrMapped;
        case 'arrInstanceName': return item.arrInstanceName || '';
        case 'arrInstanceId': return item.arrInstanceId || '';
        case 'requestStatus': return item.request?.status || '';
        case 'requestType': return item.request?.type || '';
        case 'daysSinceRequested': return item.request?.daysSinceRequested ?? null;
        case 'requestedBy': return item.request?.requestedBy || '';
        case 'is4k': return !!item.is4k;
        default: return null;
    }
};

const compareMaintenanceValue = (itemValue, operator, expectedValue) => {
    if (operator === 'is_empty') return mAsArray(itemValue).filter(Boolean).length === 0 || itemValue === '' || itemValue === null;
    if (operator === 'not_empty') return !(mAsArray(itemValue).filter(Boolean).length === 0 || itemValue === '' || itemValue === null);
    if (operator === 'equals') return mToLower(itemValue) === mToLower(expectedValue);
    if (operator === 'not_equals') return mToLower(itemValue) !== mToLower(expectedValue);
    if (operator === 'contains') {
        if (Array.isArray(itemValue)) return itemValue.map(v => mToLower(v)).includes(mToLower(expectedValue));
        return mToLower(itemValue).includes(mToLower(expectedValue));
    }
    if (operator === 'not_contains') {
        if (Array.isArray(itemValue)) return !itemValue.map(v => mToLower(v)).includes(mToLower(expectedValue));
        return !mToLower(itemValue).includes(mToLower(expectedValue));
    }
    if (operator === 'in') {
        const expectedList = mAsArray(expectedValue).map(v => mToLower(v));
        if (Array.isArray(itemValue)) return itemValue.some(v => expectedList.includes(mToLower(v)));
        return expectedList.includes(mToLower(itemValue));
    }
    if (operator === 'not_in') {
        const expectedList = mAsArray(expectedValue).map(v => mToLower(v));
        if (Array.isArray(itemValue)) return !itemValue.some(v => expectedList.includes(mToLower(v)));
        return !expectedList.includes(mToLower(itemValue));
    }
    if (operator === 'regex') {
        try {
            const patternStr = String(expectedValue || '');
            // Guard against ReDoS: reject overly-long or structurally catastrophic patterns
            if (patternStr.length > 250) return false;
            if (/\(.*[+*]\).*[+*]|\(.*[+*]\)\{/.test(patternStr)) return false; // catastrophic backtracking heuristic
            const re = new RegExp(patternStr, 'i');
            // Limit input string length to cap worst-case backtracking
            return re.test(String(itemValue || '').slice(0, 1000));
        } catch (e) {
            return false;
        }
    }
    const left = mToNumber(itemValue);
    if (operator === 'greater_than') return left !== null && left > Number(expectedValue);
    if (operator === 'less_than') return left !== null && left < Number(expectedValue);
    if (operator === 'between') {
        const expected = mAsArray(expectedValue);
        const low = Number(expected[0]);
        const high = Number(expected[1]);
        return left !== null && Number.isFinite(low) && Number.isFinite(high) && left >= low && left <= high;
    }
    return false;
};

const evaluateMaintenanceFilterNode = (item, node) => {
    if (!node) return true;
    if (Array.isArray(node.conditions)) {
        const logic = String(node.logic || 'AND').toUpperCase();
        const outcomes = node.conditions.map((child) => evaluateMaintenanceFilterNode(item, child));
        if (logic === 'OR') return outcomes.some(Boolean);
        if (logic === 'NOT') return !outcomes.some(Boolean);
        return outcomes.every(Boolean);
    }
    const field = node.field;
    const operator = node.operator || 'equals';
    const value = node.value;
    const itemValue = maintenanceValueMap(item, field);
    return compareMaintenanceValue(itemValue, operator, value);
};

const evaluateMaintenanceRule = (item, rule) => {
    if (!rule || rule.enabled === false) return false;
    const root = rule.filterTree || rule.filter || null;
    if (!root) return false;
    return evaluateMaintenanceFilterNode(item, root);
};

const normalizePlexRatingKey = (input) => {
    const raw = String(input || '').trim();
    if (!raw) return '';
    const parts = raw.split('/');
    return String(parts[parts.length - 1] || '').trim();
};

const fetchMaintenanceWatchStats = async (config, uri) => {
    const pageSize = 5000;
    const maxHistoryItems = 250000;
    let start = 0;
    const map = new Map();

    while (start < maxHistoryItems) {
        const pageRes = await fetch(
            `${uri}/status/sessions/history/all?X-Plex-Token=${config.plexToken}&sort=viewedAt:desc&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${pageSize}`,
            { headers: plexClientHeaders(config.plexToken) }
        ).then(r => r.json()).catch(() => null);

        const pageContainer = pageRes?.MediaContainer || {};
        const pageItems = Array.isArray(pageContainer.Metadata) ? pageContainer.Metadata : [];
        if (!pageItems.length) break;

        for (const item of pageItems) {
            // For episodes, map plays to the show (grandparent) so show-level rules are accurate.
            const rawKey = item.type === 'episode'
                ? (item.grandparentRatingKey || item.grandparentKey || item.parentRatingKey || item.parentKey || item.ratingKey)
                : (item.ratingKey);
            const key = normalizePlexRatingKey(rawKey);
            if (!key) continue;
            const viewedAt = Number(item.viewedAt || 0);
            const existing = map.get(key) || { watchCount: 0, lastViewedAt: null };
            existing.watchCount += 1;
            if (viewedAt > Number(existing.lastViewedAt || 0)) existing.lastViewedAt = viewedAt;
            map.set(key, existing);
        }

        start += pageItems.length;
        const totalSize = Number(pageContainer.totalSize || 0);
        if ((totalSize > 0 && start >= totalSize) || pageItems.length < pageSize) break;
    }

    if (start >= maxHistoryItems) {
        log(`Maintenance watch history fetch reached cap (${maxHistoryItems}). Watch counts may be truncated.`);
    }

    return map;
};

const extractMaintenanceRatings = (media = {}) => {
    const ratings = {
        tmdbRating: null,
        rtCriticRating: null,
        rtAudienceRating: null,
        traktRating: null
    };
    const asNum = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    };

    const rawRatings = Array.isArray(media?.Rating) ? media.Rating : [];
    rawRatings.forEach((entry) => {
        const source = `${entry?.type || ''} ${entry?.image || ''} ${entry?.id || ''} ${entry?.source || ''}`.toLowerCase();
        const value = asNum(entry?.value ?? entry?.rating ?? entry?.score);
        if (value === null) return;
        if (source.includes('themoviedb') || source.includes('tmdb')) {
            ratings.tmdbRating = ratings.tmdbRating ?? value;
        } else if (source.includes('rottentomatoes') || source.includes('rotten')) {
            // Plex can expose critic/audience RT entries; infer using label hints.
            if (source.includes('audience')) ratings.rtAudienceRating = ratings.rtAudienceRating ?? value;
            else ratings.rtCriticRating = ratings.rtCriticRating ?? value;
        } else if (source.includes('trakt')) {
            ratings.traktRating = ratings.traktRating ?? value;
        }
    });

    // Fallback to generic Plex rating fields when source-specific values are not present.
    if (ratings.tmdbRating === null && asNum(media?.rating) !== null) ratings.tmdbRating = asNum(media.rating);
    if (ratings.rtCriticRating === null && asNum(media?.audienceRating) !== null) ratings.rtCriticRating = asNum(media.audienceRating);
    if (ratings.rtAudienceRating === null && asNum(media?.audienceRating) !== null) ratings.rtAudienceRating = asNum(media.audienceRating);
    if (ratings.traktRating === null && asNum(media?.rating) !== null) ratings.traktRating = asNum(media.rating);

    return ratings;
};

const fetchPlexLibraryItemsForMaintenance = async (config, uri) => {
    const watchStats = await fetchMaintenanceWatchStats(config, uri);
    const sectionsRes = await fetch(`${uri}/library/sections?X-Plex-Token=${config.plexToken}`, { headers: plexClientHeaders(config.plexToken) })
        .then(r => r.json())
        .catch(() => null);
    const sections = sectionsRes?.MediaContainer?.Directory || [];
    const includeTypes = new Set(['movie', 'show']);
    const items = [];

    for (const section of sections) {
        if (!includeTypes.has(String(section.type || ''))) continue;
        const sectionKey = section.key;
        let start = 0;
        const pageSize = 200;
        let total = Infinity;
        while (start < total) {
            const listRes = await fetch(`${uri}/library/sections/${sectionKey}/all?X-Plex-Token=${config.plexToken}&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${pageSize}`, {
                headers: plexClientHeaders(config.plexToken)
            }).then(r => r.json()).catch(() => null);
            const container = listRes?.MediaContainer || {};
            const page = container.Metadata || [];
            total = Number(container.totalSize || page.length || 0);
            if (!Array.isArray(page) || page.length === 0) break;
            for (const media of page) {
                const guids = media.Guid || [];
                const ids = parsePlexGuidIds(guids);
                const part = media?.Media?.[0]?.Part?.[0] || {};
                const mediaInfo = media?.Media?.[0] || {};
                const ratings = extractMaintenanceRatings(media);
                const mediaType = media.type || section.type || 'movie';
                // For TV shows, Plex exposes episode-level progress via viewedLeafCount.
                // viewCount on shows is often null/0 even when episodes were watched.
                const resolvedWatchCount = mediaType === 'show'
                    ? Number(media.viewedLeafCount || 0)
                    : Number(media.viewCount || 0);
                const normalizedRatingKey = normalizePlexRatingKey(media.ratingKey);
                const aggregatedWatch = watchStats.get(normalizedRatingKey) || null;
                const finalWatchCount = Number(aggregatedWatch?.watchCount ?? resolvedWatchCount ?? 0);
                const finalLastViewedAtUnix = Number(aggregatedWatch?.lastViewedAt || media.lastViewedAt || 0);
                const item = {
                    ratingKey: String(media.ratingKey || ''),
                    title: media.title || media.grandparentTitle || media.originalTitle || 'Unknown',
                    thumb: media.thumb || media.grandparentThumb || '',
                    mediaType,
                    libraryId: String(sectionKey),
                    libraryTitle: section.title || 'Library',
                    year: media.year || null,
                    watchCount: finalWatchCount,
                    watchedEver: finalWatchCount > 0,
                    addedAt: media.addedAt ? new Date(media.addedAt * 1000).toISOString() : null,
                    lastViewedAt: finalLastViewedAtUnix ? new Date(finalLastViewedAtUnix * 1000).toISOString() : null,
                    daysSinceAdded: media.addedAt ? Math.floor((Date.now() - (media.addedAt * 1000)) / (24 * 60 * 60 * 1000)) : null,
                    daysSinceLastWatch: finalLastViewedAtUnix ? Math.floor((Date.now() - (finalLastViewedAtUnix * 1000)) / (24 * 60 * 60 * 1000)) : null,
                    durationMinutes: media.duration ? Math.round(media.duration / 60000) : null,
                    bitrateKbps: Number(mediaInfo.bitrate || 0),
                    videoResolution: String(mediaInfo.videoResolution || '').toLowerCase(),
                    videoCodec: String(mediaInfo.videoCodec || '').toLowerCase(),
                    audioCodec: String(mediaInfo.audioCodec || '').toLowerCase(),
                    sizeBytes: Number(part.size || 0),
                    sizeGB: part.size ? Math.round((Number(part.size) / (1024 * 1024 * 1024)) * 100) / 100 : 0,
                    filePath: part.file || '',
                    genres: (media.Genre || []).map(g => g.tag).filter(Boolean),
                    collections: (media.Collection || []).map(c => c.tag).filter(Boolean),
                    labels: (media.Label || []).map(l => l.tag).filter(Boolean),
                    studio: media.studio || '',
                    contentRating: media.contentRating || '',
                    tmdbRating: ratings.tmdbRating,
                    rtCriticRating: ratings.rtCriticRating,
                    rtAudienceRating: ratings.rtAudienceRating,
                    traktRating: ratings.traktRating,
                    imdbId: ids.imdb,
                    tmdbId: ids.tmdb,
                    tvdbId: ids.tvdb,
                    arrType: section.type === 'movie' ? 'radarr' : 'sonarr',
                    arrMapped: false,
                    arrInstanceId: null,
                    arrInstanceName: null,
                    arrAmbiguous: false,
                    hasExternalIds: !!(ids.tmdb || ids.tvdb || ids.imdb),
                    request: null,
                    is4k: String(mediaInfo.videoResolution || '').toLowerCase().includes('4k') || String(mediaInfo.videoResolution || '').toLowerCase().includes('2160')
                };
                items.push(item);
            }
            start += page.length;
            if (page.length < pageSize) break;
        }
    }
    return items;
};

const fetchRequestIndex = async (config) => {
    const requestAppType = String(config.requestAppType || 'none').toLowerCase();
    const baseUrlRaw = config.requestAppUrl || '';
    const apiKey = config.requestAppApiKey || '';
    if (!baseUrlRaw || !apiKey || requestAppType === 'none') {
        return { generatedAt: new Date().toISOString(), type: requestAppType, items: [] };
    }
    const baseUrl = resolveIntegrationUrlForFetch(baseUrlRaw);
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Api-Key': apiKey };
    const items = [];

    if (requestAppType === 'seerr' || requestAppType === 'overseerr' || requestAppType === 'jellyseerr') {
        let page = 1;
        let totalPages = 1;
        while (page <= totalPages && page <= 20) {
            const take = 50;
            const skip = (page - 1) * take;
            const payload = await fetch(`${baseUrl}/api/v1/request?take=${take}&skip=${skip}`, { headers }).then(r => r.json()).catch(() => null);
            const results = payload?.results || [];
            const pageInfo = payload?.pageInfo || {};
            totalPages = Math.max(1, Math.ceil(Number(pageInfo.results || results.length || 0) / take));
            results.forEach((reqItem) => {
                const media = reqItem?.media || {};
                const requestedBy = reqItem?.requestedBy?.displayName || reqItem?.requestedBy?.username || reqItem?.requestedBy?.email || '';
                items.push(normalizeRequestItem({
                    id: reqItem?.id,
                    status: reqItem?.status || '',
                    type: reqItem?.type || media?.mediaType || '',
                    requestedBy,
                    requestedAt: reqItem?.createdAt || reqItem?.createdAtUtc || null,
                    fulfilledAt: reqItem?.updatedAt || null,
                    imdbId: media?.imdbId || null,
                    tmdbId: media?.tmdbId || null,
                    tvdbId: media?.tvdbId || null
                }));
            });
            page += 1;
            if (!results.length) break;
        }
    } else if (requestAppType === 'ombi') {
        const [movieReqs, tvReqs] = await Promise.all([
            fetch(`${baseUrl}/api/v1/Request/movie`, { headers }).then(r => r.json()).catch(() => []),
            fetch(`${baseUrl}/api/v1/Request/tv`, { headers }).then(r => r.json()).catch(() => [])
        ]);
        for (const reqItem of [...(Array.isArray(movieReqs) ? movieReqs : []), ...(Array.isArray(tvReqs) ? tvReqs : [])]) {
            const requester = reqItem?.requestedUserName || reqItem?.requestedByAlias || reqItem?.requestedBy || '';
            items.push(normalizeRequestItem({
                id: reqItem?.id || reqItem?.requestId,
                status: reqItem?.status || reqItem?.requestStatus || '',
                type: reqItem?.requestType || (reqItem?.theMovieDbId ? 'movie' : 'tv'),
                requestedBy: requester,
                requestedAt: reqItem?.requestedDate || reqItem?.createdAt || null,
                fulfilledAt: reqItem?.availableDate || null,
                imdbId: reqItem?.imdbId || null,
                tmdbId: reqItem?.theMovieDbId || null,
                tvdbId: reqItem?.tvDbId || null
            }));
        }
    }
    return { generatedAt: new Date().toISOString(), type: requestAppType, items };
};

const attachRequestsToMediaIndex = (mediaItems, requestIndex) => {
    const map = new Map();
    for (const reqItem of requestIndex.items || []) {
        const keys = [reqItem.tmdbId ? `tmdb:${reqItem.tmdbId}` : null, reqItem.tvdbId ? `tvdb:${reqItem.tvdbId}` : null, reqItem.imdbId ? `imdb:${reqItem.imdbId}` : null].filter(Boolean);
        keys.forEach((key) => map.set(key, reqItem));
    }
    return mediaItems.map((item) => {
        const req =
            (item.tmdbId && map.get(`tmdb:${item.tmdbId}`)) ||
            (item.tvdbId && map.get(`tvdb:${item.tvdbId}`)) ||
            (item.imdbId && map.get(`imdb:${item.imdbId}`)) ||
            null;
        return {
            ...item,
            request: req ? {
                ...req,
                daysSinceRequested: daysSince(req.requestedAt),
                daysSinceFulfilled: daysSince(req.fulfilledAt)
            } : null
        };
    });
};

const enrichMediaItemsWithArrResolution = async (config, items = []) => {
    const normalized = normalizeArrConfig(config);
    const hasArr = getArrInstances(normalized, { enabledOnly: true })
        .filter((entry) => entry.type === 'sonarr' || entry.type === 'radarr')
        .some(isArrInstanceReady);
    if (!hasArr || !Array.isArray(items) || items.length === 0) return items;

    const catalog = await getArrCatalog(normalized, { force: true });
    return items.map((item) => {
        const resolved = resolveArrEntity(item, catalog, normalized);
        const instance = resolved.instanceId ? getArrInstance(normalized, resolved.instanceId) : null;
        const arrDeepUrl = resolved.entity && instance ? buildArrDeepUrl(instance, resolved.entity, resolved.type) : null;
        return {
            ...item,
            arrType: resolved.type === 'none' ? (item.arrType || 'none') : resolved.type,
            arrMapped: !!resolved.entity,
            arrInstanceId: resolved.instanceId || null,
            arrInstanceName: resolved.instanceName || null,
            arrAmbiguous: !!resolved.ambiguous,
            arrDeepUrl,
            arrQualityProfileId: resolved.entity?.qualityProfileId != null ? Number(resolved.entity.qualityProfileId) : null,
        };
    });
};

const buildMaintenanceMediaIndex = async ({ actor = null, force = false } = {}) => {
    markTaskStart(systemJobs.maintenanceIndex);
    try {
        const config = await loadFile(CONFIG_PATH, {});
        if (!isMediaQualityIndexEnabled(config)) {
            const payload = {
                generatedAt: null,
                itemCount: 0,
                requestItemCount: 0,
                force: !!force,
                items: []
            };
            markTaskEnd(systemJobs.maintenanceIndex, null);
            return payload;
        }

        const mediaServerType = config.mediaServerType || 'plex';
        const requestIndex = await fetchRequestIndex(config);
        let enriched = [];

        if (mediaServerType !== 'plex') {
            if (!isJellyfinConfigured(config)) {
                throw new Error('Jellyfin integration is not configured.');
            }
            const rawMedia = await fetchJellyfinLibraryItemsForMaintenance(config);
            const merged = attachRequestsToMediaIndex(rawMedia, requestIndex);
            const arrEnriched = await enrichMediaItemsWithArrResolution(config, merged);
            enriched = enrichJellyfinItemsWithQuality(config, arrEnriched);
            if (isUpgraderEnabled(config)) {
                enriched = await enrichJellyfinShowItemsWithEpisodeStats(config, enriched);
            }
        } else {
            if (!isPlexConfigured(config)) {
                throw new Error('Plex integration is not configured.');
            }
            const uri = await getPlexConnectionUri(config);
            if (!uri) throw new Error('Unable to resolve Plex server URI.');
            const rawMedia = await fetchPlexLibraryItemsForMaintenance(config, uri);
            const merged = attachRequestsToMediaIndex(rawMedia, requestIndex);
            const arrEnriched = await enrichMediaItemsWithArrResolution(config, merged);
            enriched = await enrichMaintenanceItemsWithQuality(uri, config, arrEnriched);
            if (isUpgraderEnabled(config)) {
                enriched = await enrichShowItemsWithEpisodeStats(uri, config, enriched);
            }
        }

        const payload = {
            generatedAt: new Date().toISOString(),
            itemCount: enriched.length,
            requestItemCount: (requestIndex.items || []).length,
            force: !!force,
            mediaServerType,
            items: enriched
        };
        await saveFile(MAINTENANCE_MEDIA_INDEX_PATH, payload);
        await saveFile(MAINTENANCE_REQUEST_INDEX_PATH, requestIndex);
        markTaskEnd(systemJobs.maintenanceIndex, null);
        await appendAuditLog('maintenance_index_rebuilt', actor, null, { itemCount: enriched.length, requestItemCount: requestIndex.items?.length || 0, mediaServerType });
        return payload;
    } catch (error) {
        markTaskEnd(systemJobs.maintenanceIndex, error);
        throw error;
    }
};

let cachedArrCatalog = null;
let cachedArrCatalogAt = 0;
const ARR_CATALOG_CACHE_MS = 5 * 60 * 1000;

const buildArrLookupMaps = (radarrItems = [], sonarrItems = []) => ({
    radarr: buildArrLookupMapsForItems(radarrItems),
    sonarr: buildArrLookupMapsForItems(sonarrItems),
});

const getArrCatalog = async (config, { force = false } = {}) => {
    if (!force && cachedArrCatalog && (Date.now() - cachedArrCatalogAt) < ARR_CATALOG_CACHE_MS) {
        return cachedArrCatalog;
    }
    const normalized = normalizeArrConfig(config);
    const instances = getArrInstances(normalized, { enabledOnly: true })
        .filter((entry) => entry.type === 'sonarr' || entry.type === 'radarr');
    const catalogResults = await Promise.all(
        instances.map(async (instance) => ({
            instance,
            items: await fetchArrInstanceCatalogItems(instance, { resolveUrl: resolveIntegrationUrlForFetch, fetchImpl: fetch }),
        }))
    );

    const instancesById = {};
    const lookupByInstance = {};
    const radarr = [];
    const sonarr = [];

    catalogResults.forEach(({ instance, items }) => {
        instancesById[instance.id] = {
            id: instance.id,
            type: instance.type,
            name: instance.name || (instance.type === 'radarr' ? 'Radarr' : 'Sonarr'),
            isDefault: !!instance.isDefault,
            itemCount: items.length,
            items,
        };
        lookupByInstance[instance.id] = buildArrLookupMapsForItems(items);
        if (instance.type === 'radarr') radarr.push(...items);
        else sonarr.push(...items);
    });

    cachedArrCatalog = {
        instances: instancesById,
        lookupByInstance,
        radarr,
        sonarr,
        lookup: buildArrLookupMaps(radarr, sonarr),
        counts: getArrInstanceCounts(normalized),
        catalogCounts: {
            sonarr: sonarr.length,
            radarr: radarr.length,
        },
    };
    cachedArrCatalogAt = Date.now();
    return cachedArrCatalog;
};

const applyArrActions = async (config, resolved, actions = {}) => {
    if (!resolved?.entity || !resolved?.type || resolved.type === 'none') {
        return { success: false, reason: 'No Sonarr/Radarr mapping found' };
    }
    const deleteFiles = actions.deleteFiles !== false;
    const shouldDelete = actions.deleteFromArr !== false;
    const shouldUnmonitor = !!actions.unmonitor;
    const qualityProfileId = Number(actions.qualityProfileId || 0);

    const creds = getArrCredentials(config, resolved.type, resolved.instanceId);
    if (!creds.url || !creds.apiKey) {
        const label = resolved.instanceName || (resolved.type === 'radarr' ? 'Radarr' : 'Sonarr');
        return { success: false, reason: `No ready ${label} instance configured` };
    }
    const baseUrl = resolveIntegrationUrlForFetch(creds.url);
    const apiKey = creds.apiKey;
    const headers = { 'X-Api-Key': apiKey, Accept: 'application/json', 'Content-Type': 'application/json' };
    const id = resolved.entity.id;

    if (qualityProfileId > 0) {
        const putRes = await fetch(`${baseUrl}/api/v3/${resolved.type === 'radarr' ? 'movie' : 'series'}/${id}`, { method: 'PUT', headers, body: JSON.stringify({ ...resolved.entity, qualityProfileId }) });
        if (!putRes.ok) return { success: false, reason: `ARR quality profile update failed (${putRes.status})` };
    }
    if (shouldUnmonitor) {
        const putRes = await fetch(`${baseUrl}/api/v3/${resolved.type === 'radarr' ? 'movie' : 'series'}/${id}`, { method: 'PUT', headers, body: JSON.stringify({ ...resolved.entity, monitored: false }) });
        if (!putRes.ok) return { success: false, reason: `ARR unmonitor failed (${putRes.status})` };
    }
    if (shouldDelete) {
        const deletePath = resolved.type === 'radarr'
            ? `/api/v3/movie/${id}?deleteFiles=${deleteFiles ? 'true' : 'false'}&addImportExclusion=false`
            : `/api/v3/series/${id}?deleteFiles=${deleteFiles ? 'true' : 'false'}&addImportListExclusion=false`;
        const delRes = await fetch(`${baseUrl}${deletePath}`, { method: 'DELETE', headers });
        if (!delRes.ok && delRes.status !== 404) {
            return { success: false, reason: `ARR delete failed (${delRes.status})` };
        }
    }
    return {
        success: true,
        instanceId: resolved.instanceId || creds.instance?.id || null,
        instanceName: resolved.instanceName || creds.instance?.name || null,
    };
};

const resolveCollectionRatingKey = async (config, uri, libraryId, title) => {
    try {
        const payload = await fetch(`${uri}/library/sections/${encodeURIComponent(libraryId)}/collections?X-Plex-Token=${encodeURIComponent(config.plexToken)}`, {
            headers: plexClientHeaders(config.plexToken)
        }).then(r => r.json()).catch(() => null);
        const collections = Array.isArray(payload?.MediaContainer?.Metadata) ? payload.MediaContainer.Metadata : [];
        const needle = String(title || '').trim().toLowerCase();
        const exact = collections.find((c) => String(c?.title || '').trim().toLowerCase() === needle);
        const candidate = exact || collections.find((c) => String(c?.title || '').toLowerCase().includes(needle));
        return candidate?.ratingKey ? String(candidate.ratingKey) : null;
    } catch (e) {
        return null;
    }
};

const pinCollectionToHome = async (config, uri, libraryId, collectionRatingKey, pinToHomeForAllUsers) => {
    if (!pinToHomeForAllUsers || !libraryId || !collectionRatingKey) return { pinned: false };
    try {
        const hubManageUrl = `${uri}/hubs/sections/${encodeURIComponent(libraryId)}/manage?metadataItemId=${encodeURIComponent(collectionRatingKey)}&promotedToRecommended=1&promotedToOwnHome=1&promotedToSharedHome=1&X-Plex-Token=${encodeURIComponent(config.plexToken)}`;
        const res = await fetch(hubManageUrl, { method: 'PUT', headers: plexClientHeaders(config.plexToken) }).catch(() => null);
        return { pinned: !!(res && res.ok), status: res?.status || null };
    } catch (e) {
        return { pinned: false, error: e.message };
    }
};

const syncRulePlexCollection = async (config, uri, rule, items, options = {}) => {
    const collectionSettings = rule?.collection || {};
    if (!collectionSettings.enabled || !items.length) return { success: true, updated: false };
    const pinToHomeForAllUsers = !!options.pinToHomeForAllUsers;

    const sectionGroups = new Map();
    items.forEach((item) => {
        if (!item.libraryId || !item.ratingKey) return;
        const key = `${item.libraryId}:${item.mediaType === 'movie' ? 1 : 2}`;
        if (!sectionGroups.has(key)) sectionGroups.set(key, []);
        sectionGroups.get(key).push(item.ratingKey);
    });

    let updated = 0;
    let pinned = 0;
    for (const [sectionKey, ratingKeys] of sectionGroups.entries()) {
        const [libraryId, typeId] = sectionKey.split(':');
        const nameTemplate = collectionSettings.nameTemplate || 'Maintenance - {{ruleName}}';
        const title = String(nameTemplate).replace('{{ruleName}}', rule.name || 'Rule').replace('{{date}}', new Date().toISOString().split('T')[0]);
        const uniqueKeys = [...new Set(ratingKeys)].slice(0, 500);
        if (!uniqueKeys.length) continue;
        const sourceUri = `server://${config.serverIdentifier}/com.plexapp.plugins.library/library/metadata/${uniqueKeys.join(',')}`;
        const targetUrl = `${uri}/library/collections?title=${encodeURIComponent(title)}&type=${typeId}&smart=0&sectionId=${encodeURIComponent(libraryId)}&uri=${encodeURIComponent(sourceUri)}&X-Plex-Token=${encodeURIComponent(config.plexToken)}`;
        const createRes = await fetch(targetUrl, { method: 'POST', headers: plexClientHeaders(config.plexToken) }).catch(() => null);
        if (createRes && (createRes.ok || createRes.status === 201 || createRes.status === 200)) {
            updated += 1;
            if (pinToHomeForAllUsers) {
                const collectionRatingKey = await resolveCollectionRatingKey(config, uri, libraryId, title);
                const pinResult = await pinCollectionToHome(config, uri, libraryId, collectionRatingKey, true);
                if (pinResult.pinned) pinned += 1;
            }
        }
    }
    return { success: true, updated: updated > 0, updatedCollections: updated, pinRequested: pinToHomeForAllUsers, pinnedCollections: pinned };
};

const createRunRecord = (rule, dryRun, actor) => ({
    id: randomUUID(),
    ruleId: rule.id,
    ruleName: rule.name || 'Unnamed Rule',
    dryRun,
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: 'running',
    actor: actor ? { id: actor.id || null, username: actor.username || null, email: actor.email || null } : null,
    totals: { matched: 0, processed: 0, deleted: 0, skipped: 0, failed: 0 },
    outcomes: [],
    errors: []
});

const runMaintenanceRule = async ({ rule, dryRun, actor, confirmToken, runOptions = {} }) => {
    const config = await loadFile(CONFIG_PATH, {});
    const indexPayload = await loadFile(MAINTENANCE_MEDIA_INDEX_PATH, { items: [] });
    const preferences = await loadMaintenancePreferences();
    const items = Array.isArray(indexPayload.items) ? indexPayload.items : [];
    const settings = getMaintenanceSettings(rule);
    const effectiveDryRun = dryRun !== undefined && dryRun !== null
        ? !!dryRun
        : (settings.dryRunByDefault ?? preferences.global?.dryRunByDefault ?? MAINTENANCE_DEFAULTS.dryRunByDefault);
    const destructive = !effectiveDryRun && (rule?.actions?.deleteFromArr !== false || !!rule?.actions?.unmonitor || Number(rule?.actions?.qualityProfileId || 0) > 0);
    const confirmRequired = settings.requireConfirmForDestructive ?? preferences.global?.requireConfirmForDestructive ?? MAINTENANCE_DEFAULTS.requireConfirmForDestructive;
    if (destructive && confirmRequired && String(confirmToken || '') !== 'CONFIRM_MAINTENANCE_DELETE') {
        throw new Error('Destructive run requires confirm token.');
    }

    const matched = applyMaintenanceExclusions(items.filter(item => evaluateMaintenanceRule(item, rule)), preferences);
    const run = createRunRecord(rule, effectiveDryRun, actor);
    run.totals.matched = matched.length;

    const maxActions = resolveMaintenanceMaxActions(rule, preferences);
    const candidates = matched.slice(0, maxActions);
    const catalog = (!effectiveDryRun && destructive) ? await getArrCatalog(config) : { radarr: [], sonarr: [] };
    const dryRunCatalog = effectiveDryRun ? await getArrCatalog(config) : catalog;

    if (destructive) {
        const preflight = await validateMaintenanceDestructivePreflight(config, rule, catalog);
        run.preflight = { warnings: preflight.warnings };
        if (!preflight.ok) {
            throw new Error(preflight.errors.join(' '));
        }
    }

    const createAndPinCollection = !!runOptions.createAndPinCollection;
    const shouldCollectionSync = !effectiveDryRun && (rule?.collection?.enabled || createAndPinCollection);
    const uri = shouldCollectionSync ? await getPlexConnectionUri(config) : null;

    if (!effectiveDryRun && uri && shouldCollectionSync) {
        const ruleWithCollection = createAndPinCollection
            ? { ...rule, collection: { ...(rule?.collection || {}), enabled: true } }
            : rule;
        const collectionResult = await syncRulePlexCollection(config, uri, ruleWithCollection, candidates, { pinToHomeForAllUsers: createAndPinCollection });
        run.outcomes.push({ type: 'collection_sync', success: !!collectionResult.success, details: collectionResult });
    }

    const graceRemainingDays = computeRuleGraceRemainingDays(rule);

    for (const item of candidates) {
        if (graceRemainingDays > 0) {
            run.totals.skipped += 1;
            run.outcomes.push({
                ratingKey: item.ratingKey,
                title: item.title,
                status: 'skipped',
                reason: `Rule grace period active (${graceRemainingDays} day(s) remaining)`
            });
            continue;
        }
        if (effectiveDryRun) {
            run.totals.processed += 1;
            const resolved = resolveArrEntity(item, dryRunCatalog, config);
            run.outcomes.push({
                ratingKey: item.ratingKey,
                title: item.title,
                status: 'dry_run',
                arrResolvable: !!resolved.entity,
                arrType: resolved.type,
                arrInstanceId: resolved.instanceId || null,
                arrInstanceName: resolved.instanceName || null,
                arrAmbiguous: !!resolved.ambiguous,
                arrWarning: resolved.warning || null,
                proposedActions: rule.actions || {}
            });
            continue;
        }

        const resolved = resolveArrEntity(item, catalog, config);
        if (!resolved.entity) {
            run.totals.skipped += 1;
            run.outcomes.push({ ratingKey: item.ratingKey, title: item.title, status: 'unactionable', reason: 'No Sonarr/Radarr mapping available' });
            continue;
        }

        const actionResult = await applyArrActions(config, resolved, rule.actions || {});
        run.totals.processed += 1;
        if (actionResult.success) {
            run.totals.deleted += 1;
            run.outcomes.push({
                ratingKey: item.ratingKey,
                title: item.title,
                status: 'deleted',
                arrType: resolved.type,
                arrInstanceId: actionResult.instanceId || resolved.instanceId || null,
                arrInstanceName: actionResult.instanceName || resolved.instanceName || null,
                arrAmbiguous: !!resolved.ambiguous,
                arrId: resolved.entity.id,
            });
            await appendAuditLog('maintenance_item_actioned', actor, null, {
                ruleId: rule.id,
                ruleName: rule.name,
                ratingKey: item.ratingKey,
                title: item.title,
                arrType: resolved.type,
                arrInstanceId: actionResult.instanceId || resolved.instanceId || null,
                arrInstanceName: actionResult.instanceName || resolved.instanceName || null,
                arrId: resolved.entity.id,
                actions: rule.actions || {}
            });
        } else {
            run.totals.failed += 1;
            run.outcomes.push({ ratingKey: item.ratingKey, title: item.title, status: 'failed', reason: actionResult.reason || 'ARR action failed' });
        }
    }

    run.completedAt = new Date().toISOString();
    run.status = run.totals.failed > 0 ? 'completed_with_errors' : 'completed';
    return run;
};

const requireMaintenanceExperimental = async (req, res, next) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        if (!isMaintenanceExperimentalEnabled(config)) {
            return res.status(403).json({ error: 'Maintenance Experimental Mode is disabled. Enable it in Settings first.' });
        }
        return next();
    } catch (e) {
        return res.status(500).json({ error: 'Failed to check Maintenance feature flag.' });
    }
};

app.use('/api/maintenance', requireAdmin, requireMaintenanceExperimental);

app.get('/api/maintenance/filter-options', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const instances = getArrInstances(config);
        const instanceNames = [...new Set(instances.map((entry) => entry.name).filter(Boolean))];
        const instanceIds = instances.map((entry) => entry.id);
        const fields = MAINTENANCE_FILTER_CATALOG.map((field) => {
            if (field.field === 'arrInstanceName') return { ...field, options: instanceNames };
            if (field.field === 'arrInstanceId') return { ...field, options: instanceIds };
            return field;
        });
        res.json({
            fields,
            operators: ['equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than', 'between', 'in', 'not_in', 'is_empty', 'not_empty', 'regex'],
            groupLogic: ['AND', 'OR', 'NOT']
        });
    } catch (e) {
        res.status(500).json({ error: `Failed to load maintenance filter options: ${e.message}` });
    }
});

app.get('/api/maintenance/rules', requireAdmin, async (req, res) => {
    try {
        const rules = await loadFile(MAINTENANCE_RULES_PATH, []);
        const source = Array.isArray(rules) ? rules : [];
        let changed = false;
        const normalized = source.map((rule) => {
            const graceDays = Math.max(0, Number(rule?.graceDays || 0));
            const createdAt = rule?.createdAt || new Date().toISOString();
            if (graceDays !== Number(rule?.graceDays || 0) || !rule?.createdAt) changed = true;
            return {
                ...sanitizeMaintenanceRuleForPersist(rule),
                graceDays,
                createdAt
            };
        });
        if (changed) await saveFile(MAINTENANCE_RULES_PATH, normalized);
        res.json(normalized);
    } catch (e) {
        res.status(500).json({ error: `Failed to load maintenance rules: ${e.message}` });
    }
});

app.post('/api/maintenance/rules', requireAdmin, async (req, res) => {
    try {
        const rules = req.body;
        if (!Array.isArray(rules)) return res.status(400).json({ error: 'Rules must be an array.' });
        const existingRules = await loadFile(MAINTENANCE_RULES_PATH, []);
        const existingById = new Map((Array.isArray(existingRules) ? existingRules : []).map((rule) => [String(rule?.id || ''), rule]));
        const normalized = rules.map((rule) => {
            const cleaned = sanitizeMaintenanceRuleForPersist(rule);
            const currentId = String(cleaned?.id || '');
            const prev = existingById.get(currentId);
            const resetGrace = !!rule?._resetGrace;
            return {
                ...cleaned,
                id: cleaned.id || randomUUID(),
                name: cleaned.name || 'Unnamed Rule',
                enabled: cleaned.enabled !== false,
                graceDays: Math.max(0, Number(cleaned?.graceDays || 0)),
                createdAt: resetGrace
                    ? new Date().toISOString()
                    : (prev?.createdAt || cleaned?.createdAt || new Date().toISOString()),
                updatedAt: new Date().toISOString(),
                settings: getMaintenanceSettings(cleaned)
            };
        });
        await saveFile(MAINTENANCE_RULES_PATH, normalized);
        await appendAuditLog('maintenance_rules_updated', req.user, null, { count: normalized.length });
        res.json({ success: true, rules: normalized });
    } catch (e) {
        res.status(500).json({ error: `Failed to save maintenance rules: ${e.message}` });
    }
});

app.post('/api/maintenance/rules/reset-grace', requireAdmin, async (req, res) => {
    try {
        const ruleId = String(req.body?.ruleId || '').trim();
        if (!ruleId) return res.status(400).json({ error: 'ruleId is required.' });
        const rules = await loadFile(MAINTENANCE_RULES_PATH, []);
        const source = Array.isArray(rules) ? rules : [];
        let found = false;
        const resetAt = new Date().toISOString();
        const updated = source.map((rule) => {
            if (String(rule?.id || '') !== ruleId) return sanitizeMaintenanceRuleForPersist(rule);
            found = true;
            return {
                ...sanitizeMaintenanceRuleForPersist(rule),
                createdAt: resetAt,
                updatedAt: resetAt
            };
        });
        if (!found) return res.status(404).json({ error: 'Maintenance rule not found.' });
        await saveFile(MAINTENANCE_RULES_PATH, updated);
        await appendAuditLog('maintenance_grace_reset', req.user, null, { ruleId, resetAt });
        res.json({ success: true, ruleId, createdAt: resetAt });
    } catch (e) {
        res.status(500).json({ error: `Failed to reset maintenance grace timer: ${e.message}` });
    }
});

app.post('/api/maintenance/index/rebuild', requireAdmin, async (req, res) => {
    try {
        const payload = await buildMaintenanceMediaIndex({ actor: req.user, force: true });
        res.json({ success: true, generatedAt: payload.generatedAt, itemCount: payload.itemCount, requestItemCount: payload.requestItemCount });
    } catch (e) {
        res.status(500).json({ error: `Failed to rebuild maintenance index: ${e.message}` });
    }
});

app.get('/api/maintenance/index', requireAdmin, async (req, res) => {
    try {
        const payload = await loadFile(MAINTENANCE_MEDIA_INDEX_PATH, { generatedAt: null, itemCount: 0, items: [] });
        const requestIndex = await loadFile(MAINTENANCE_REQUEST_INDEX_PATH, { generatedAt: null, items: [] });
        res.json({
            generatedAt: payload.generatedAt || null,
            itemCount: payload.itemCount || 0,
            requestGeneratedAt: requestIndex.generatedAt || null,
            requestItemCount: Array.isArray(requestIndex.items) ? requestIndex.items.length : 0
        });
    } catch (e) {
        res.status(500).json({ error: `Failed to load maintenance index: ${e.message}` });
    }
});

app.get('/api/maintenance/library-items', requireAdmin, async (req, res) => {
    try {
        const payload = await loadFile(MAINTENANCE_MEDIA_INDEX_PATH, { generatedAt: null, items: [] });
        const preferences = await loadMaintenancePreferences();
        const allItems = Array.isArray(payload.items) ? payload.items : [];
        const libraryId = String(req.query.libraryId || 'all');
        const search = normalized(String(req.query.search || ''));
        const page = Math.max(1, Number(req.query.page || 1));
        const limit = Math.min(120, Math.max(12, Number(req.query.limit || 48)));
        const includeExcluded = String(req.query.includeExcluded || 'true') !== 'false';

        const excludedKeys = new Set((preferences?.exclusions?.ratingKeys || []).map(v => String(v)));
        const excludedTitles = new Set((preferences?.exclusions?.titles || []).map(v => normalized(v)));
        const excludedLibraries = new Set((preferences?.exclusions?.libraries || []).map(v => normalized(v)));

        const librariesMap = allItems.reduce((acc, item) => {
            const key = String(item?.libraryId || '');
            if (!key) return acc;
            if (!acc[key]) {
                acc[key] = { id: key, title: item?.libraryTitle || `Library ${key}`, count: 0 };
            }
            acc[key].count += 1;
            return acc;
        }, {});

        const filtered = allItems
            .filter((item) => {
                if (!item) return false;
                if (libraryId !== 'all' && String(item.libraryId || '') !== libraryId) return false;
                if (search && !normalized(item.title).includes(search)) return false;
                return true;
            })
            .map((item) => {
                const excluded = excludedKeys.has(String(item.ratingKey || ''))
                    || excludedTitles.has(normalized(item.title))
                    || excludedLibraries.has(normalized(item.libraryTitle));
                return {
                    ratingKey: String(item.ratingKey || ''),
                    title: item.title || 'Unknown',
                    thumb: item.thumb || '',
                    year: item.year || null,
                    libraryId: String(item.libraryId || ''),
                    libraryTitle: item.libraryTitle || 'Library',
                    watchCount: Number(item.watchCount || 0),
                    sizeGB: Number(item.sizeGB || 0),
                    lastViewedAt: item.lastViewedAt || null,
                    excluded
                };
            })
            .filter(item => includeExcluded ? true : !item.excluded)
            .sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' }));

        const start = (page - 1) * limit;
        const pageItems = filtered.slice(start, start + limit);
        res.json({
            generatedAt: payload.generatedAt || null,
            total: filtered.length,
            page,
            limit,
            libraries: Object.values(librariesMap).sort((a, b) => String(a.title).localeCompare(String(b.title), undefined, { sensitivity: 'base' })),
            items: pageItems
        });
    } catch (e) {
        res.status(500).json({ error: `Failed to load maintenance library items: ${e.message}` });
    }
});

const isCollexionsEnabled = (config) => (
    !!config?.collexionsEnabled
    && String(config?.mediaServerType || 'plex').toLowerCase() === 'plex'
    && !!String(config?.collexionsInternalUrl || '').trim()
);

const requireCollexions = async (req, res, next) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        if (String(config?.mediaServerType || 'plex').toLowerCase() !== 'plex') {
            return res.status(403).json({ error: 'Collexions is a Plex-only integration. Switch Media Server Type to Plex in Settings.' });
        }
        if (!isCollexionsEnabled(config)) {
            return res.status(403).json({ error: 'Collexions is disabled. Enable it and set the internal URL in Settings first.' });
        }
        req.collexionsConfig = config;
        return next();
    } catch (e) {
        return res.status(500).json({ error: 'Failed to check Collexions feature flag.' });
    }
};

const sanitizeCollexionsProxyBase = (rawUrl) => {
    const normalized = normalizeExternalBaseUrl(rawUrl, { allowPrivate: true, allowHttp: true });
    const host = new URL(normalized).hostname;
    if (!isLoopbackHostName(host) && !ALLOW_PRIVATE_INTEGRATION_URLS) {
        throw new Error('Collexions internal URL must be loopback unless ALLOW_PRIVATE_INTEGRATION_URLS=true');
    }
    return normalized.replace(/\/+$/, '');
};

/** Portal-side Collexions health (works even when worker is down). Before catch-all proxy. */
app.get('/api/collexions/health', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const enabled = !!config.collexionsEnabled;
        const autostart = !!config.collexionsAutostart;
        const embedded = getCollexionsEmbeddedStatus();
        let base = '';
        try {
            base = config.collexionsInternalUrl ? sanitizeCollexionsProxyBase(config.collexionsInternalUrl) : '';
        } catch {
            base = '';
        }
        const serviceKey = String(config.collexionsServiceKey || process.env.COLLEXIONS_SERVICE_KEY || '').trim();
        const issues = [];

        if (String(config.mediaServerType || 'plex').toLowerCase() !== 'plex') {
            issues.push('Collexions requires Media Server Type = Plex.');
        }
        if (!enabled) issues.push('Collexions is disabled in Settings.');
        if (enabled && !base) issues.push('Internal URL is not configured.');
        if (enabled && !serviceKey) issues.push('Service key is missing.');
        if (enabled && config.collexionsInternalUrl && !base) {
            issues.push('Internal URL is blocked (non-loopback requires ALLOW_PRIVATE_INTEGRATION_URLS=true).');
        }

        let worker = { ok: false, reachable: false, error: null, detail: null };
        if (enabled && base && serviceKey) {
            try {
                const upstream = await fetchWithTimeout(
                    `${base}/api/health`,
                    { headers: { Accept: 'application/json', 'X-Collexions-Service-Key': serviceKey } },
                    6000,
                );
                if (upstream.ok) {
                    const detail = await upstream.json().catch(() => null);
                    worker = { ok: !!(detail && detail.ok), reachable: true, error: null, detail };
                    if (detail && Array.isArray(detail.issues)) issues.push(...detail.issues);
                } else {
                    worker = { ok: false, reachable: false, error: `Worker HTTP ${upstream.status}`, detail: null };
                    issues.push(`Collexions worker returned HTTP ${upstream.status}.`);
                }
            } catch (e) {
                const timedOut = e?.name === 'AbortError' || /aborted/i.test(String(e?.message || ''));
                worker = {
                    ok: false,
                    reachable: false,
                    error: timedOut ? 'Worker timed out' : (e.message || 'Unreachable'),
                    detail: null,
                };
                issues.push(timedOut
                    ? 'Collexions worker did not respond in time.'
                    : `Cannot reach Collexions worker: ${e.message}`);
            }
        }

        const uniqueIssues = [...new Set(issues.filter(Boolean))];
        return res.json({
            ok: enabled && worker.reachable && worker.ok,
            enabled,
            autostart,
            embedded,
            worker,
            issues: uniqueIssues,
        });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'Failed to check Collexions health.' });
    }
});

/** Seed Collexions forms from portal-stored Plex/TMDB credentials (admin only). Must be registered before the catch-all proxy. */
app.get('/api/collexions/portal-defaults', requireAdmin, requireCollexions, async (req, res) => {
    try {
        const config = req.collexionsConfig || await loadFile(CONFIG_PATH, {});
        const plexUrl = resolveConfiguredPlexServerUrl(config);
        const plexToken = String(config.plexToken || '').trim();
        const tmdbApiKey = String(config.tmdbApiKey || '').trim();
        const mediaServerType = String(config.mediaServerType || 'plex').toLowerCase();
        return res.json({
            plex_url: plexUrl || '',
            plex_token: plexToken || '',
            tmdb_api_key: tmdbApiKey || '',
            mediaServerType,
            sources: {
                plex: !!(plexUrl && plexToken && mediaServerType === 'plex'),
                tmdb: !!tmdbApiKey,
                trakt: false,
                mdblist: false,
            },
        });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'Failed to load portal defaults.' });
    }
});

/** Proxy /api/collexions/* → Collexions Flask sidecar with portal admin SSO. */
app.all(withWildcard('/api/collexions'), requireAdmin, requireCollexions, async (req, res) => {
    try {
        const config = req.collexionsConfig || await loadFile(CONFIG_PATH, {});
        let base = '';
        try {
            base = sanitizeCollexionsProxyBase(config.collexionsInternalUrl || '');
        } catch (e) {
            return res.status(503).json({ error: e.message || 'Collexions internal URL is not allowed.' });
        }
        const serviceKey = String(config.collexionsServiceKey || process.env.COLLEXIONS_SERVICE_KEY || '').trim();
        if (!base) {
            return res.status(503).json({ error: 'Collexions internal URL is not configured.' });
        }
        if (!serviceKey) {
            return res.status(503).json({ error: 'Collexions service key is not configured. Set it in Settings (shared with the sidecar COLLEXIONS_SERVICE_KEY).' });
        }

        const suffix = readWildcardPath(req);
        const targetUrl = new URL(`${base}/api/${suffix}`);
        for (const [key, value] of Object.entries(req.query || {})) {
            if (value == null) continue;
            if (Array.isArray(value)) value.forEach((v) => targetUrl.searchParams.append(key, String(v)));
            else targetUrl.searchParams.set(key, String(value));
        }

        const headers = {
            Accept: req.headers.accept || 'application/json',
            'X-Collexions-Service-Key': serviceKey,
            'X-Portal-Admin': '1',
        };
        if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];

        const method = String(req.method || 'GET').toUpperCase();
        const init = { method, headers };
        if (method !== 'GET' && method !== 'HEAD') {
            if (Buffer.isBuffer(req.body)) init.body = req.body;
            else if (typeof req.body === 'string') init.body = req.body;
            else if (req.body != null) {
                headers['Content-Type'] = headers['Content-Type'] || 'application/json';
                init.body = JSON.stringify(req.body);
            }
        }

        // Gallery / create / template jobs / large Trakt lists / poster mosaics can take a while.
        const longSuffix =
            suffix === 'collections'
            || suffix.startsWith('collections?')
            || suffix === 'collections/create'
            || suffix === 'collections/create-from-external'
            || suffix === 'collections/fix-art'
            || suffix === 'templates/create'
            || suffix.startsWith('templates/franchise-search')
            || suffix === 'trending'
            || suffix === 'trakt/list'
            || suffix.startsWith('trakt/list?');
        const timeoutMs = longSuffix ? 180000 : 20000;
        const upstream = await fetchWithTimeout(targetUrl.toString(), init, timeoutMs);
        const contentType = upstream.headers.get('content-type') || '';
        res.status(upstream.status);
        if (contentType) res.setHeader('Content-Type', contentType);
        const cacheControl = upstream.headers.get('cache-control');
        if (cacheControl) res.setHeader('Cache-Control', cacheControl);

        if (contentType.includes('application/json')) {
            const data = await upstream.json().catch(() => null);
            return res.send(data == null ? '' : data);
        }
        const buf = Buffer.from(await upstream.arrayBuffer());
        return res.send(buf);
    } catch (e) {
        const timedOut = e?.name === 'AbortError' || /aborted/i.test(String(e?.message || ''));
        log(`Collexions proxy error: ${e.message}`);
        return res.status(timedOut ? 504 : 502).json({
            error: timedOut
                ? 'Collexions worker timed out.'
                : `Cannot reach Collexions sidecar: ${e.message}`,
        });
    }
});

const requireUpgrader = async (req, res, next) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        if (!isUpgraderEnabled(config)) {
            return res.status(403).json({ error: 'Library Upgrader is disabled. Enable it in Settings first.' });
        }
        const arrCounts = getArrInstanceCounts(config);
        if (arrCounts.sonarr.ready === 0 && arrCounts.radarr.ready === 0) {
            return res.status(503).json({ error: 'Configure a ready Sonarr or Radarr instance first.' });
        }
        return next();
    } catch (e) {
        return res.status(500).json({ error: 'Failed to check Upgrader feature flag.' });
    }
};

const requireScanner = async (req, res, next) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        if (!config.scannerEnabled) {
            return res.status(403).json({ error: 'Scanner is disabled. Enable it in Settings first.' });
        }
        return next();
    } catch (e) {
        return res.status(500).json({ error: 'Failed to check Scanner feature flag.' });
    }
};

/** Ensure Scanner can reach Plex using the same URL/token as Settings → Plex. */
const scannerPortalConfig = (config = {}) => ({
    ...config,
    plexServerUrl: String(config.plexServerUrl || '').trim() || resolveConfiguredPlexServerUrl(config),
});

const scannerTriggerAuth = createBasicAuthMiddleware({
    getCredentials: () => {
        // Sync read via cached promise is awkward; middleware loads async below.
        return scannerAuthCache;
    },
    realm: 'Scanner',
});

let scannerAuthCache = { username: '', password: '' };
const refreshScannerAuthCache = async () => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const scanner = normalizeScannerConfig(config.scanner, getDefaultScannerConfig());
        scannerAuthCache = {
            username: scanner.authUsername || '',
            password: scanner.authPassword || '',
        };
    } catch {
        scannerAuthCache = { username: '', password: '' };
    }
};

const requireScannerEnabledForTriggers = async (req, res, next) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        if (!config.scannerEnabled) {
            log('[scanner] Webhook rejected — Scanner is disabled');
            return res.status(503).json({ error: 'Scanner is disabled' });
        }
        await refreshScannerAuthCache();
        return next();
    } catch (e) {
        return res.status(500).json({ error: 'Scanner unavailable' });
    }
};

const handleArrTrigger = async (req, res, kind) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const scanner = normalizeScannerConfig(config.scanner, getDefaultScannerConfig());
        const triggerName = String(req.params.name || kind).toLowerCase();
        const trigger = findTriggerByName(scanner, triggerName);
        if (!trigger || trigger.kind !== kind) {
            log(`[scanner] Unknown ${kind} trigger "${triggerName}"`);
            return res.status(404).json({ error: `Unknown ${kind} trigger "${triggerName}"` });
        }

        const event = req.body || {};
        const eventType = String(event.eventType || event.EventType || '');
        if (/^test$/i.test(eventType)) {
            log(`[scanner] ${kind} test webhook OK`);
            await appendLog({
                ok: true,
                folder: 'Webhook authenticated — no scan queued',
                source: `${kind}:${trigger.name}`,
                eventType: 'Test',
                action: 'test',
                reason: 'Connection test',
                title: `${kind.charAt(0).toUpperCase()}${kind.slice(1)} webhook test`,
            }, { countProcessed: false });
            return res.status(200).json({ ok: true, test: true });
        }

        let paths = [];
        if (kind === 'sonarr') paths = pathsFromSonarrEvent(event);
        else if (kind === 'radarr') paths = pathsFromRadarrEvent(event);
        else if (kind === 'lidarr') paths = pathsFromLidarrEvent(event);

        if (!paths.length) {
            log(`[scanner] ${kind} ${eventType || 'event'} produced no paths`);
            const meta = classifyArrEvent(kind, event);
            await appendLog({
                ok: false,
                folder: 'Webhook received — no scan queued',
                source: `${kind}:${trigger.name}`,
                eventType: eventType || 'Unknown',
                action: meta.action || 'ignored',
                reason: 'No media paths',
                title: meta.title || `${kind.charAt(0).toUpperCase()}${kind.slice(1)} webhook`,
                error: `${eventType || 'Unknown'} webhook contained no usable media paths.`,
            }, { countProcessed: false });
            return res.status(200).json({ ok: true, queued: 0 });
        }

        const scans = buildScansFromPaths(paths, {
            priority: trigger.priority,
            source: `${kind}:${trigger.name}`,
            rewrite: trigger.rewrite,
            ...classifyArrEvent(kind, event),
        });
        await enqueueScans(scans);
        log(`[scanner] Queued ${scans.length} from ${kind}:${trigger.name} (${eventType}${scans[0]?.reason ? ` · ${scans[0].reason}` : ''}): ${scans.map((s) => s.folder).join(' | ')}`);
        return res.status(200).json({ ok: true, queued: scans.length, folders: scans.map((s) => s.folder) });
    } catch (e) {
        log(`[scanner] ${kind} trigger failed: ${e?.message || e}`);
        const failedEvent = req.body || {};
        const failedEventType = String(failedEvent.eventType || failedEvent.EventType || 'Unknown');
        await appendLog({
            ok: false,
            folder: 'Webhook received — parser failed',
            source: `${kind}:${String(req.params.name || kind).toLowerCase()}`,
            eventType: failedEventType,
            action: 'error',
            reason: 'Webhook rejected',
            title: `${kind.charAt(0).toUpperCase()}${kind.slice(1)} webhook`,
            error: e?.message || String(e),
        }, { countProcessed: false }).catch(() => {});
        const status = e?.status || 500;
        return res.status(status).json({ error: e?.message || 'Trigger failed' });
    }
};

// Autoscan-compatible webhook endpoints (Basic Auth — not portal JWT).
app.post('/triggers/manual', requireScannerEnabledForTriggers, scannerTriggerRateLimit, scannerTriggerAuth, async (req, res) => {
    try {
        const dirs = []
            .concat(req.query.dir || [])
            .concat(req.body?.dir || [])
            .concat(req.body?.path ? [req.body.path] : [])
            .flat()
            .map((d) => String(d || '').trim())
            .filter(Boolean);
        if (!dirs.length) {
            return res.status(400).json({ error: 'Provide dir query/body path(s) to scan' });
        }
        const config = await loadFile(CONFIG_PATH, {});
        const scanner = normalizeScannerConfig(config.scanner, getDefaultScannerConfig());
        const scans = buildScansFromPaths(dirs, {
            priority: 5,
            source: 'manual',
            rewrite: [],
            eventType: 'Manual',
            action: 'manual',
            reason: 'Manual scan',
        });
        await enqueueScans(scans);
        // Optional: process immediately when minimum-age is 0
        void processOne(scannerPortalConfig(config), scanner);
        return res.status(200).json({ ok: true, queued: scans.length, folders: scans.map((s) => s.folder) });
    } catch (e) {
        return res.status(500).json({ error: e?.message || 'Manual trigger failed' });
    }
});

app.get('/triggers/manual', requireScannerEnabledForTriggers, scannerTriggerRateLimit, scannerTriggerAuth, (req, res) => {
    // Browser-friendly hint; primary UI is /scanner in the portal.
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>Scanner manual trigger</title></head>
<body style="font-family:system-ui;max-width:40rem;margin:2rem auto;padding:0 1rem">
<h1>Scanner</h1>
<p>Use the portal <strong>Scanner</strong> page to submit paths, or POST <code>/triggers/manual?dir=/path</code> with Basic Auth.</p>
</body></html>`);
});

app.post('/triggers/sonarr', requireScannerEnabledForTriggers, scannerTriggerRateLimit, scannerTriggerAuth, (req, res) => handleArrTrigger(req, res, 'sonarr'));
app.post('/triggers/radarr', requireScannerEnabledForTriggers, scannerTriggerRateLimit, scannerTriggerAuth, (req, res) => handleArrTrigger(req, res, 'radarr'));
app.post('/triggers/lidarr', requireScannerEnabledForTriggers, scannerTriggerRateLimit, scannerTriggerAuth, (req, res) => handleArrTrigger(req, res, 'lidarr'));
app.post('/triggers/:name', requireScannerEnabledForTriggers, scannerTriggerRateLimit, scannerTriggerAuth, async (req, res) => {
    const config = await loadFile(CONFIG_PATH, {});
    const scanner = normalizeScannerConfig(config.scanner, getDefaultScannerConfig());
    const trigger = findTriggerByName(scanner, req.params.name);
    if (!trigger) return res.status(404).json({ error: 'Unknown trigger' });
    return handleArrTrigger(req, res, trigger.kind);
});

app.get('/api/scanner/status', requireAdmin, requireScanner, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const scanner = normalizeScannerConfig(config.scanner, getDefaultScannerConfig());
        const stats = await getQueueStats();
        const logPayload = await listLog(1);
        const last = Array.isArray(logPayload.entries) && logPayload.entries[0] ? logPayload.entries[0] : null;
        const targets = buildTargets(scannerPortalConfig(config), scanner);
        const configuredSources = [...new Set(
            getArrInstances(config, { enabledOnly: true })
                .filter(isArrInstanceReady)
                .map((instance) => String(instance.type || '').toLowerCase())
                .filter((type) => ['sonarr', 'radarr', 'lidarr'].includes(type))
        )];
        res.json({
            enabled: true,
            minimumAge: scanner.minimumAge,
            remaining: stats.remaining,
            processed: stats.processed,
            targetCount: targets.length,
            configuredSources,
            showWebhooks: config.scannerWebhooksVisible !== false,
            showManualPath: config.scannerManualPathVisible !== false,
            lastActivity: last
                ? {
                    at: last.at,
                    ok: !!last.ok,
                    folder: last.folder || '',
                    source: last.source || '',
                    error: last.error || undefined,
                    eventType: last.eventType || undefined,
                    action: last.action || undefined,
                    reason: last.reason || undefined,
                    title: last.title || undefined,
                    quality: last.quality || undefined,
                    isUpgrade: !!last.isUpgrade || undefined,
                }
                : null,
            triggers: {
                sonarr: (scanner.triggers.sonarr || []).map((t) => t.name),
                radarr: (scanner.triggers.radarr || []).map((t) => t.name),
                lidarr: (scanner.triggers.lidarr || []).map((t) => t.name),
            },
            webhookPaths: {
                manual: '/triggers/manual',
                sonarr: (scanner.triggers.sonarr || []).map((t) => `/triggers/${t.name}`),
                radarr: (scanner.triggers.radarr || []).map((t) => `/triggers/${t.name}`),
                lidarr: (scanner.triggers.lidarr || []).map((t) => `/triggers/${t.name}`),
            },
        });
    } catch (e) {
        res.status(500).json({ error: e?.message || 'Failed to load scanner status' });
    }
});

app.get('/api/scanner/queue', requireAdmin, async (req, res) => {
    try {
        const stats = await getQueueStats();
        res.json(stats);
    } catch (e) {
        res.status(500).json({ error: e?.message || 'Failed to load queue' });
    }
});

app.get('/api/scanner/log', requireAdmin, async (req, res) => {
    try {
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const config = await loadFile(CONFIG_PATH, {});
        const payload = await listLog(limit);
        res.json({
            ...payload,
            scannerEnabled: !!config.scannerEnabled,
        });
    } catch (e) {
        res.status(500).json({ error: e?.message || 'Failed to load log' });
    }
});

app.post('/api/scanner/manual', requireAdmin, requireScanner, async (req, res) => {
    try {
        const pathValue = String(req.body?.path || req.body?.dir || '').trim();
        if (!pathValue) return res.status(400).json({ error: 'Path is required' });
        const config = await loadFile(CONFIG_PATH, {});
        const scanner = normalizeScannerConfig(config.scanner, getDefaultScannerConfig());
        const scans = buildScansFromPaths([pathValue], {
            priority: 5,
            source: 'manual-ui',
            rewrite: [],
            eventType: 'Manual',
            action: 'manual',
            reason: 'Manual scan',
        });
        await enqueueScans(scans);
        void processOne(scannerPortalConfig(config), scanner);
        res.json({ ok: true, queued: scans.length, folder: scans[0]?.folder });
    } catch (e) {
        res.status(500).json({ error: e?.message || 'Failed to enqueue scan' });
    }
});

app.post('/api/scanner/process', requireAdmin, requireScanner, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const scanner = normalizeScannerConfig(config.scanner, getDefaultScannerConfig());
        const result = await processOne(scannerPortalConfig(config), scanner);
        res.json({ ok: true, ...result });
    } catch (e) {
        res.status(500).json({ error: e?.message || 'Process failed' });
    }
});

app.post('/api/scanner/test-targets', requireAdmin, requireScanner, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const scanner = normalizeScannerConfig(config.scanner, getDefaultScannerConfig());
        const targets = buildTargets(scannerPortalConfig(config), scanner);
        const results = [];
        for (const target of targets) {
            try {
                await target.available();
                results.push({ type: target.type, ok: true });
            } catch (e) {
                results.push({ type: target.type, ok: false, error: e?.message || String(e) });
            }
        }
        res.json({ targets: results });
    } catch (e) {
        res.status(500).json({ error: e?.message || 'Target test failed' });
    }
});

app.post('/api/scanner/test-trigger', requireAdmin, requireScanner, async (req, res) => {
    try {
        const kind = String(req.body?.kind || '').toLowerCase();
        const name = String(req.body?.name || kind).trim().toLowerCase();
        if (!['sonarr', 'radarr', 'lidarr'].includes(kind)) {
            return res.status(400).json({ error: 'Invalid trigger type' });
        }

        const config = await loadFile(CONFIG_PATH, {});
        const scanner = normalizeScannerConfig(config.scanner, getDefaultScannerConfig());
        const trigger = findTriggerByName(scanner, name);
        if (!trigger || trigger.kind !== kind) {
            return res.status(400).json({ error: `Save the ${kind} trigger before testing it.` });
        }

        // Use the first rewrite source as a realistic synthetic Arr path when it
        // is a plain path; otherwise fall back to a harmless fixture path.
        const firstFrom = String(trigger.rewrite?.[0]?.from || '');
        const plainRewriteRoot = firstFrom
            .replace(/^\^/, '')
            .replace(/\$$/, '')
            .replace(/\\\//g, '/');
        const sourceRoot = /^[a-zA-Z]:[\\/]|^\//.test(plainRewriteRoot)
            && !/[\[\]()+*?{}|]/.test(plainRewriteRoot)
            ? plainRewriteRoot.replace(/\/+$/, '')
            : `/scanner-test/${kind}`;

        const event = kind === 'sonarr'
            ? {
                eventType: 'Download',
                series: { title: 'Scanner Test Series', path: sourceRoot },
                episodeFile: { relativePath: 'Season 01/Scanner Test.mkv' },
            }
            : kind === 'radarr'
                ? {
                    eventType: 'Download',
                    movie: { title: 'Scanner Test Movie', folderPath: sourceRoot },
                    movieFile: { relativePath: 'Scanner Test.mkv' },
                }
                : {
                    eventType: 'Download',
                    artist: { name: 'Scanner Test Artist', path: sourceRoot },
                    album: { title: 'Scanner Test Album' },
                    trackFiles: [{ path: `${sourceRoot}/Scanner Test Album/01 - Scanner Test.flac`, quality: 'FLAC' }],
                };

        const paths = kind === 'sonarr'
            ? pathsFromSonarrEvent(event)
            : kind === 'radarr'
                ? pathsFromRadarrEvent(event)
                : pathsFromLidarrEvent(event);
        const scans = buildScansFromPaths(paths, {
            priority: trigger.priority,
            source: `${kind}:${trigger.name}`,
            rewrite: trigger.rewrite,
            ...classifyArrEvent(kind, event),
        });
        if (!scans.length) {
            return res.status(400).json({ error: 'Synthetic event produced no scan paths.' });
        }

        const targets = buildTargets(scannerPortalConfig(config), scanner);
        const targetResults = [];
        for (const target of targets) {
            try {
                await target.available();
                targetResults.push({ type: target.type, ok: true });
            } catch (e) {
                targetResults.push({ type: target.type, ok: false, error: e?.message || String(e) });
            }
        }

        const failedTargets = targetResults.filter((target) => !target.ok);
        res.json({
            ok: failedTargets.length === 0 && targetResults.length > 0,
            trigger: { kind, name: trigger.name, parsedPaths: paths, rewrittenPaths: scans.map((scan) => scan.folder) },
            targets: targetResults,
            queued: false,
        });
    } catch (e) {
        res.status(500).json({ error: e?.message || 'Trigger test failed' });
    }
});

app.post('/api/scanner/import-yaml', requireAdmin, async (req, res) => {
    try {
        const yaml = String(req.body?.yaml || '');
        if (!yaml.trim()) return res.status(400).json({ error: 'yaml is required' });
        const imported = parseAutoscanYaml(yaml);
        res.json({
            scanner: maskScannerConfigForApi(normalizeScannerConfig(imported, getDefaultScannerConfig()), SECRET_MASK),
            // Return unmasked imported secrets only to admin for one-shot apply in Settings UI
            imported,
        });
    } catch (e) {
        res.status(400).json({ error: e?.message || 'Failed to parse Autoscan YAML' });
    }
});

app.use('/api/upgrader', requireAdmin, requireUpgrader);

app.get('/api/upgrader/status', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const payload = await loadUpgraderIndex();
        const arrCounts = getArrInstanceCounts(config);
        const arrReady = arrCounts.radarr.ready > 0 || arrCounts.sonarr.ready > 0;
        res.json({
            enabled: isUpgraderEnabled(config),
            generatedAt: payload.generatedAt || null,
            itemCount: payload.itemCount || (Array.isArray(payload.items) ? payload.items.length : 0),
            rebuildInProgress: !!systemJobs.upgraderIndex.running,
            dataSource: payload.dataSource || 'arr',
            mediaServerType: 'arr',
            plexConfigured: !!(config.plexToken && config.serverIdentifier),
            arrConfigured: arrReady,
            automationEnabled: !!config.upgraderAutomationEnabled,
            profileMapConfigured: Object.keys(normalizeUpgraderProfileMap(config.upgraderProfileMap)).length > 0,
            maxActionsPerHour: Math.max(1, Number(config.upgraderMaxActionsPerHour) || 25),
            recentUpgradeCount: await countRecentUpgraderActions(1),
            defaultPreset: config.upgraderDefaultPreset || 'non_hevc',
            defaultSort: UPGRADER_SORT_IDS.has(String(config.upgraderDefaultSort || '')) ? config.upgraderDefaultSort : 'sizeGB',
            minSizeGB: Number(config.upgraderMinSizeGB) > 0 ? Number(config.upgraderMinSizeGB) : 5,
        });
    } catch (e) {
        res.status(500).json({ error: `Failed to load upgrader status: ${e.message}` });
    }
});

app.get('/api/upgrader/summary', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const payload = await loadUpgraderIndex();
        const allItems = Array.isArray(payload.items) ? payload.items : [];
        const minSizeGB = Number(config.upgraderMinSizeGB) > 0 ? Number(config.upgraderMinSizeGB) : 5;
        const nonHevc = allItems.filter((item) => isUpgraderCandidate(item));
        const nonHevcSizeGB = nonHevc.reduce((sum, item) => {
            if (item.mediaType === 'show' && Number(item.nonHevcEpisodeSizeGB || 0) > 0) {
                return sum + Number(item.nonHevcEpisodeSizeGB || 0);
            }
            return sum + Number(item.sizeGB || 0);
        }, 0);
        res.json({
            generatedAt: payload.generatedAt || null,
            totalItems: allItems.length,
            nonHevcCount: nonHevc.length,
            hevcCount: allItems.length - nonHevc.length,
            nonHevc4kCount: nonHevc.filter((item) => !!item.is4k || (item.displayTags || []).includes('4K')).length,
            nonHevcHdrCount: nonHevc.filter((item) => !!item.hasHdr || (item.displayTags || []).includes('HDR') || (item.displayTags || []).includes('DV')).length,
            arrMappedCount: allItems.length,
            arrUnmappedCount: 0,
            estimatedReclaimableGB: Math.round(nonHevcSizeGB * 0.4 * 100) / 100,
            minSizeGB,
        });
    } catch (e) {
        res.status(500).json({ error: `Failed to load upgrader summary: ${e.message}` });
    }
});

app.get('/api/upgrader/items', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const payload = await loadUpgraderIndex();
        const preferences = await loadMaintenancePreferences();
        const upgraderPrefs = await loadUpgraderPreferences();
        const plexLookup = await loadUpgraderPlexPosterLookup(config);
        const allItems = Array.isArray(payload.items) ? payload.items : [];
        const codecs = String(req.query.codecs || '').toLowerCase().split(',').filter(Boolean);
        const resolutions = String(req.query.resolutions || '').toLowerCase().split(',').filter(Boolean);
        const features = String(req.query.features || '').toLowerCase().split(',').filter(Boolean);
        const qualities = String(req.query.qualities || '').toLowerCase().split(',').filter(Boolean);
        const libraryId = String(req.query.libraryId || 'all');
        const mediaType = String(req.query.mediaType || 'all').toLowerCase();
        const search = normalized(String(req.query.search || ''));
        const sort = UPGRADER_SORT_IDS.has(String(req.query.sort || ''))
            ? String(req.query.sort)
            : (UPGRADER_SORT_IDS.has(String(config.upgraderDefaultSort || '')) ? config.upgraderDefaultSort : 'sizeGB');
        const page = Math.max(1, Number(req.query.page || 1));
        const limit = Math.min(120, Math.max(12, Number(req.query.limit || 48)));
        const minSizeGB = Number(req.query.minSizeGB) > 0 ? Number(req.query.minSizeGB) : (Number(config.upgraderMinSizeGB) > 0 ? Number(config.upgraderMinSizeGB) : 5);
        const codec = String(req.query.codec || '').trim().toLowerCase();
        const includeExcluded = String(req.query.includeExcluded || 'true') !== 'false';
        const includeSnoozed = String(req.query.includeSnoozed || 'false') === 'true';
        const exclusions = buildUpgraderExclusionSets(preferences, upgraderPrefs);

        const librariesMap = allItems.reduce((acc, item) => {
            const key = String(item?.libraryId || item?.arrInstanceId || '');
            if (!key) return acc;
            if (!acc[key]) {
                acc[key] = { id: key, title: item?.libraryTitle || item?.arrInstanceName || `Instance ${key}`, count: 0 };
            }
            acc[key].count += 1;
            return acc;
        }, {});

        const filtered = allItems
            .filter((item) => {
                if (!item) return false;
                if (!applyUpgraderMultiFilter(item, codecs, resolutions, features, qualities, minSizeGB)) return false;
                if (libraryId !== 'all' && String(item.libraryId || item.arrInstanceId || '') !== libraryId) return false;
                if (mediaType !== 'all' && String(item.mediaType || '') !== mediaType) return false;
                if (search && !normalized(item.title).includes(search)) return false;
                return true;
            })
            .map((item) => {
                const mapped = mapUpgraderApiItem(item, exclusions);
                // Compute accurate matched episode count for shows based on active filters
                if (mapped.mediaType === 'show') {
                    const total = Number(item.totalEpisodeCount || 0);
                    const nonHevc = Number(item.nonHevcEpisodeCount || 0);
                    const hevcCount = total - nonHevc;
                    if (codecs.length > 0) {
                        if (item.codecCounts) {
                            let matchedEps = 0;
                            let dominantMatchedFamily = '';
                            let maxCount = -1;
                            for (const [actualCodec, count] of Object.entries(item.codecCounts)) {
                                const family = getUpgraderCodecFamily({ videoCodec: actualCodec });
                                if (codecs.includes(family)) {
                                    matchedEps += count;
                                    if (count > maxCount) {
                                        maxCount = count;
                                        dominantMatchedFamily = family;
                                    }
                                }
                            }
                            mapped.matchedEpisodeCount = matchedEps;
                            if (dominantMatchedFamily) {
                                mapped.videoCodec = dominantMatchedFamily;
                            }
                        } else {
                            const wantsHevc = codecs.includes('hevc') || codecs.includes('h265');
                            const wantsH264 = codecs.includes('h264');
                            if (wantsHevc && !wantsH264) {
                                mapped.matchedEpisodeCount = hevcCount;
                                mapped.videoCodec = 'hevc';
                            } else if (wantsH264 && !wantsHevc) {
                                mapped.matchedEpisodeCount = nonHevc;
                                mapped.videoCodec = 'h264';
                            } else {
                                mapped.matchedEpisodeCount = total;
                            }
                        }
                    } else if (features.includes('non_hevc')) {
                        mapped.matchedEpisodeCount = nonHevc;
                        mapped.videoCodec = 'h264';
                    } else {
                        mapped.matchedEpisodeCount = nonHevc;
                    }
                }
                return mapped;
            })
            .filter((item) => {
                if (!includeExcluded && item.excluded && !item.snoozed) return false;
                if (!includeSnoozed && item.snoozed) return false;
                return true;
            });

        const resolvedSort = sort === 'staleAdded' ? 'daysSinceAdded' : sort;
        
        const getFamilySize = (item, fam) => {
            if (item.codecSizesGB) {
                let s = 0;
                for (const [c, sz] of Object.entries(item.codecSizesGB)) {
                    if (getUpgraderCodecFamily({ videoCodec: c }) === fam) s += sz;
                }
                return s;
            }
            if (getUpgraderCodecFamily(item) === fam) return Number(item.sizeGB || 0);
            return 0;
        };

        const sorters = {
            sizeGB: (a, b) => Number(b.sizeGB || 0) - Number(a.sizeGB || 0),
            watchCount: (a, b) => Number(b.watchCount || 0) - Number(a.watchCount || 0),
            addedAt: (a, b) => Date.parse(b.addedAt || 0) - Date.parse(a.addedAt || 0),
            daysSinceAdded: (a, b) => Number(b.daysSinceAdded || 0) - Number(a.daysSinceAdded || 0),
            title: (a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' }),
            hevcFirst: (a, b) => {
                const diff = getFamilySize(b, 'hevc') - getFamilySize(a, 'hevc');
                return diff !== 0 ? diff : Number(b.sizeGB || 0) - Number(a.sizeGB || 0);
            },
            h264First: (a, b) => {
                const diff = getFamilySize(b, 'h264') - getFamilySize(a, 'h264');
                return diff !== 0 ? diff : Number(b.sizeGB || 0) - Number(a.sizeGB || 0);
            },
            av1First: (a, b) => {
                const diff = getFamilySize(b, 'av1') - getFamilySize(a, 'av1');
                return diff !== 0 ? diff : Number(b.sizeGB || 0) - Number(a.sizeGB || 0);
            },
        };
        filtered.sort(sorters[resolvedSort] || sorters.sizeGB);

        const start = (page - 1) * limit;
        const pageItems = filtered.slice(start, start + limit)
            .map((item) => enrichUpgraderItemPosters(item, plexLookup));
        res.json({
            generatedAt: payload.generatedAt || null,
            codecs,
            resolutions,
            features,
            qualities,
            total: filtered.length,
            page,
            limit,
            libraries: Object.values(librariesMap).sort((a, b) => String(a.title).localeCompare(String(b.title), undefined, { sensitivity: 'base' })),
            items: pageItems,
        });
    } catch (e) {
        res.status(500).json({ error: `Failed to load upgrader items: ${e.message}` });
    }
});

app.post('/api/upgrader/rebuild', requireAdmin, async (req, res) => {
    try {
        if (systemJobs.upgraderIndex.running) {
            return res.json({ success: true, alreadyRunning: true });
        }
        const config = await loadFile(CONFIG_PATH, {});
        res.json({ success: true, started: true });
        buildUpgraderArrIndex(config, { actor: req.user }).catch((error) => {
            log(`Upgrader index rebuild failed: ${error.message}`);
        });
    } catch (e) {
        res.status(500).json({ error: `Failed to rebuild upgrader index: ${e.message}` });
    }
});

app.get('/api/upgrader/arr-cover', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const arrType = String(req.query.type || 'sonarr');
        const instanceId = String(req.query.instanceId || '');
        const entityId = Number(req.query.entityId || 0);
        if (!instanceId || !entityId) return res.status(400).send('Missing instanceId or entityId');

        const instance = getArrInstance(config, instanceId);
        if (!instance || !isArrInstanceReady(instance)) return res.status(404).send('Instance not ready');

        const resolveUrl = resolveIntegrationUrlForFetch;
        const base = String(resolveUrl(instance.url) || '').replace(/\/+$/, '');
        const coverPath = `/MediaCover/${entityId}/poster.jpg`;
        let imageRes = await fetch(`${base}${coverPath}`, {
            headers: { 'X-Api-Key': instance.apiKey },
        });

        if (!imageRes.ok) {
            let entity = null;
            if (arrType === 'sonarr') {
                entity = await fetchSonarrSeriesById(instance, entityId, { resolveUrl, fetchImpl: fetch });
            } else {
                entity = await fetchArrInstanceJson(instance, `/api/v3/movie/${entityId}`, { resolveUrl, fetchImpl: fetch });
            }
            const posterImage = (entity?.images || []).find((img) => img.coverType === 'poster')
                || (entity?.images || []).find((img) => img.coverType === 'fanart');
            const remoteUrl = posterImage?.remoteUrl || posterImage?.url || null;
            if (remoteUrl) {
                const safeRemote = await resolveSafeArrRemoteImageUrl(remoteUrl, base).catch(() => null);
                if (safeRemote) {
                    imageRes = await fetch(safeRemote);
                }
            }
        }

        if (!imageRes?.ok) return res.status(imageRes?.status || 404).send('Cover not found');

        const contentType = imageRes.headers.get('content-type') || 'image/jpeg';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        const buffer = Buffer.from(await imageRes.arrayBuffer());
        res.send(buffer);
    } catch (e) {
        res.status(500).send('Failed to load cover art');
    }
});

app.get('/api/upgrader/arr-episode-image', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const instanceId = String(req.query.instanceId || '');
        const episodeId = Number(req.query.episodeId || 0);
        if (!instanceId || !episodeId) return res.status(400).send('Missing instanceId or episodeId');

        const instance = getArrInstance(config, instanceId);
        if (!instance || !isArrInstanceReady(instance)) return res.status(404).send('Instance not ready');

        const resolveUrl = resolveIntegrationUrlForFetch;
        const base = String(resolveUrl(instance.url) || '').replace(/\/+$/, '');
        const headers = { 'X-Api-Key': instance.apiKey };

        // Strategy 1: try the direct MediaCover path (Sonarr stores local thumbnails here)
        const directPaths = [
            `/MediaCover/EpisodeImages/${episodeId}.jpg`,
            `/MediaCover/EpisodeImages/${episodeId}.png`,
            `/MediaCover/EpisodeImages/${episodeId}-thumb.jpg`,
        ];
        for (const path of directPaths) {
            const tryRes = await fetch(`${base}${path}`, { headers }).catch(() => null);
            if (tryRes?.ok) {
                const contentType = tryRes.headers.get('content-type') || 'image/jpeg';
                if (contentType.startsWith('image/')) {
                    res.setHeader('Content-Type', contentType);
                    res.setHeader('Cache-Control', 'public, max-age=86400');
                    res.send(Buffer.from(await tryRes.arrayBuffer()));
                    return;
                }
            }
        }

        // Strategy 2: fetch via the episode API and look at images array
        const episode = await fetchArrInstanceJson(instance, `/api/v3/episode/${episodeId}`, { resolveUrl, fetchImpl: fetch }).catch(() => null);
        const screenshot = (episode?.images || []).find((img) => img.coverType === 'screenshot');
        const remoteUrl = screenshot?.remoteUrl || screenshot?.url || null;
        if (!remoteUrl) return res.status(404).send('No screenshot found');

        const safeRemote = await resolveSafeArrRemoteImageUrl(remoteUrl, base).catch(() => null);
        if (!safeRemote) return res.status(404).send('Cover not found');
        const imageRes = await fetch(safeRemote, { headers });
        if (!imageRes?.ok) return res.status(imageRes?.status || 404).send('Cover not found');

        const contentType = imageRes.headers.get('content-type') || 'image/jpeg';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(Buffer.from(await imageRes.arrayBuffer()));
    } catch (e) {
        res.status(500).send('Failed to load episode image');
    }
});

app.get('/api/upgrader/profiles', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const instances = getArrInstances(config, { enabledOnly: true })
            .filter((entry) => entry.type === 'sonarr' || entry.type === 'radarr')
            .filter(isArrInstanceReady);
        res.json({ instances: maskArrInstancesForApi(instances) });
    } catch (e) {
        res.status(500).json({ error: `Failed to load profiles instances: ${e.message}` });
    }
});

const normalizeCustomFormatPayload = (body = {}, { keepIds = false } = {}) => {
    const specifications = (Array.isArray(body.specifications) ? body.specifications : []).map((spec) => {
        const next = { ...spec };
        if (!keepIds) delete next.id;
        return next;
    });
    const payload = {
        name: String(body.name || '').trim(),
        includeCustomFormatWhenRenaming: !!body.includeCustomFormatWhenRenaming,
        specifications,
    };
    if (keepIds && body.id != null) payload.id = Number(body.id);
    return payload;
};

app.get('/api/upgrader/trash/sonarr/catalog', requireAdmin, async (req, res) => {
    try {
        const refresh = String(req.query.refresh || '') === '1';
        const catalog = await getSonarrTrashCatalog(CONFIG_DIR, { refresh });
        res.json({
            source: catalog.source,
            fetchedAt: catalog.fetchedAt,
            itemCount: catalog.itemCount,
            categories: catalog.categories,
            items: catalog.items,
        });
    } catch (e) {
        res.status(500).json({ error: `Failed to load TRaSH catalog: ${e.message}` });
    }
});

app.get('/api/upgrader/trash/sonarr/catalog/:slug', requireAdmin, async (req, res) => {
    try {
        const format = await getSonarrTrashCustomFormat(req.params.slug);
        if (!format?.name) return res.status(404).json({ error: 'Custom format not found' });
        res.json({ format });
    } catch (e) {
        res.status(500).json({ error: `Failed to load TRaSH custom format: ${e.message}` });
    }
});

app.get('/api/upgrader/arr/:instanceId/customformats/schema', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const instanceId = req.params.instanceId;
        const instances = getArrInstances(config, { enabledOnly: true })
            .filter((entry) => entry.type === 'sonarr' || entry.type === 'radarr')
            .filter(isArrInstanceReady);
        const instance = instances.find(i => i.id === instanceId);
        if (!instance) return res.status(404).json({ error: 'Instance not found or not ready' });

        const baseUrl = String(instance.url || '').replace(/\/+$/, '');
        const headers = { 'X-Api-Key': instance.apiKey };
        const url = `${baseUrl}/api/v3/customformat/schema`;
        const schema = await fetchWithTimeout(url, { headers }).then(r => r.json());

        res.json({ schema: Array.isArray(schema) ? schema : [] });
    } catch (e) {
        res.status(500).json({ error: `Failed to fetch custom format schema: ${e.message}` });
    }
});

app.get('/api/upgrader/arr/:instanceId/customformats', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const instanceId = req.params.instanceId;
        const instances = getArrInstances(config, { enabledOnly: true })
            .filter((entry) => entry.type === 'sonarr' || entry.type === 'radarr')
            .filter(isArrInstanceReady);
        const instance = instances.find(i => i.id === instanceId);
        if (!instance) return res.status(404).json({ error: 'Instance not found or not ready' });
        
        const baseUrl = String(instance.url || '').replace(/\/+$/, '');
        const headers = { 'X-Api-Key': instance.apiKey };
        const url = `${baseUrl}/api/v3/customformat`;
        const formats = await fetchWithTimeout(url, { headers }).then(r => r.json());
        
        res.json({ formats: Array.isArray(formats) ? formats : [] });
    } catch (e) {
        res.status(500).json({ error: `Failed to fetch custom formats: ${e.message}` });
    }
});

app.post('/api/upgrader/arr/:instanceId/customformats', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const instanceId = req.params.instanceId;
        const instances = getArrInstances(config, { enabledOnly: true })
            .filter((entry) => entry.type === 'sonarr' || entry.type === 'radarr')
            .filter(isArrInstanceReady);
        const instance = instances.find(i => i.id === instanceId);
        if (!instance) return res.status(404).json({ error: 'Instance not found or not ready' });
        
        const baseUrl = String(instance.url || '').replace(/\/+$/, '');
        const headers = { 'X-Api-Key': instance.apiKey, 'Content-Type': 'application/json' };
        const url = `${baseUrl}/api/v3/customformat`;
        const payload = normalizeCustomFormatPayload(req.body, { keepIds: false });
        const result = await fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(payload) }).then(r => r.json());
        
        if (result.message) throw new Error(result.message);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: `Failed to create custom format: ${e.message}` });
    }
});

app.put('/api/upgrader/arr/:instanceId/customformats/:id', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const instanceId = req.params.instanceId;
        const id = req.params.id;
        const instances = getArrInstances(config, { enabledOnly: true })
            .filter((entry) => entry.type === 'sonarr' || entry.type === 'radarr')
            .filter(isArrInstanceReady);
        const instance = instances.find(i => i.id === instanceId);
        if (!instance) return res.status(404).json({ error: 'Instance not found or not ready' });
        
        const baseUrl = String(instance.url || '').replace(/\/+$/, '');
        const headers = { 'X-Api-Key': instance.apiKey, 'Content-Type': 'application/json' };
        
        const backupsDir = path.join(CONFIG_DIR, 'backups');
        await fs.mkdir(backupsDir, { recursive: true }).catch(() => {});
        const backupPath = path.join(backupsDir, `customformat_${instanceId}_${id}_${Date.now()}.json`);
        const existing = await fetchWithTimeout(`${baseUrl}/api/v3/customformat/${id}`, { headers: { 'X-Api-Key': instance.apiKey } }).then(r => r.json()).catch(() => null);
        if (existing && !existing.message) {
            await fs.writeFile(backupPath, JSON.stringify(existing, null, 2)).catch(() => {});
        }

        const url = `${baseUrl}/api/v3/customformat/${id}`;
        const payload = normalizeCustomFormatPayload({ ...req.body, id: Number(id) }, { keepIds: true });
        const result = await fetchWithTimeout(url, { method: 'PUT', headers, body: JSON.stringify(payload) }).then(r => r.json());
        
        if (result.message) throw new Error(result.message);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: `Failed to update custom format: ${e.message}` });
    }
});

app.get('/api/upgrader/arr/:instanceId/qualityprofiles', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const instanceId = req.params.instanceId;
        const instances = getArrInstances(config, { enabledOnly: true })
            .filter((entry) => entry.type === 'sonarr' || entry.type === 'radarr')
            .filter(isArrInstanceReady);
        const instance = instances.find(i => i.id === instanceId);
        if (!instance) return res.status(404).json({ error: 'Instance not found or not ready' });
        
        const baseUrl = String(instance.url || '').replace(/\/+$/, '');
        const headers = { 'X-Api-Key': instance.apiKey };
        const url = `${baseUrl}/api/v3/qualityprofile`;
        const profiles = await fetchWithTimeout(url, { headers }).then(r => r.json());
        
        res.json({ profiles: Array.isArray(profiles) ? profiles : [] });
    } catch (e) {
        res.status(500).json({ error: `Failed to fetch quality profiles: ${e.message}` });
    }
});

app.put('/api/upgrader/arr/:instanceId/qualityprofiles/:id', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const instanceId = req.params.instanceId;
        const id = req.params.id;
        const instances = getArrInstances(config, { enabledOnly: true })
            .filter((entry) => entry.type === 'sonarr' || entry.type === 'radarr')
            .filter(isArrInstanceReady);
        const instance = instances.find(i => i.id === instanceId);
        if (!instance) return res.status(404).json({ error: 'Instance not found or not ready' });
        
        const baseUrl = String(instance.url || '').replace(/\/+$/, '');
        const headers = { 'X-Api-Key': instance.apiKey, 'Content-Type': 'application/json' };
        
        const backupsDir = path.join(CONFIG_DIR, 'backups');
        await fs.mkdir(backupsDir, { recursive: true }).catch(() => {});
        const backupPath = path.join(backupsDir, `qualityprofile_${instanceId}_${id}_${Date.now()}.json`);
        const existing = await fetchWithTimeout(`${baseUrl}/api/v3/qualityprofile/${id}`, { headers: { 'X-Api-Key': instance.apiKey } }).then(r => r.json()).catch(() => null);
        if (existing && !existing.message) {
            await fs.writeFile(backupPath, JSON.stringify(existing, null, 2)).catch(() => {});
        }

        const url = `${baseUrl}/api/v3/qualityprofile/${id}`;
        const result = await fetchWithTimeout(url, { method: 'PUT', headers, body: JSON.stringify(req.body) }).then(r => r.json());
        
        if (result.message) throw new Error(result.message);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: `Failed to update quality profile: ${e.message}` });
    }
});

app.get('/api/upgrader/profiles', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const instances = await buildUpgraderProfilesPayload(config);
        res.json({ instances });
    } catch (e) {
        res.status(500).json({ error: `Failed to load upgrader profiles: ${e.message}` });
    }
});

app.get('/api/upgrader/audit', requireAdmin, async (req, res) => {
    try {
        const limit = Math.min(100, Math.max(1, Number(req.query.limit || 25)));
        const entries = await loadUpgraderAuditEntries();
        res.json({ entries: entries.slice(0, limit) });
    } catch (e) {
        res.status(500).json({ error: `Failed to load upgrader audit log: ${e.message}` });
    }
});

app.get('/api/upgrader/queue', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const instances = getArrInstances(config, { enabledOnly: true })
            .filter((entry) => entry.type === 'sonarr' || entry.type === 'radarr')
            .filter(isArrInstanceReady);
        const queues = await Promise.all(instances.map(async (instance) => {
            const summary = await fetchArrQueueSummary(instance, { resolveUrl: resolveIntegrationUrlForFetch, fetchImpl: fetch });
            return {
                instanceId: instance.id,
                instanceName: instance.name || (instance.type === 'radarr' ? 'Radarr' : 'Sonarr'),
                type: instance.type,
                total: summary.total,
            };
        }));
        res.json({ instances: queues, totalQueued: queues.reduce((sum, entry) => sum + Number(entry.total || 0), 0) });
    } catch (e) {
        res.status(500).json({ error: `Failed to load ARR queue summary: ${e.message}` });
    }
});

app.post('/api/upgrader/preview', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const ratingKeys = Array.isArray(req.body?.ratingKeys) ? req.body.ratingKeys.map(String) : [];
        const qualityProfileId = Number(req.body?.qualityProfileId || 0);
        const profileChangeOnly = !!req.body?.profileChangeOnly;
        const payload = await executeUpgraderUpgradeBatch({
            config,
            ratingKeys,
            dryRun: true,
            qualityProfileId,
            profileChangeOnly,
            actor: req.user,
        });
        res.json(payload);
    } catch (e) {
        res.status(400).json({ error: e.message || 'Failed to preview upgrader actions.' });
    }
});

app.post('/api/upgrader/upgrade', requireAdmin, async (req, res) => {
    if (upgraderUpgradeState.running) {
        return res.status(409).json({ error: 'An upgrader batch is already running.' });
    }
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const ratingKeys = Array.isArray(req.body?.ratingKeys) ? req.body.ratingKeys.map(String) : [];
        const qualityProfileId = Number(req.body?.qualityProfileId || 0);
        const triggerSearch = req.body?.triggerSearch !== false;
        const profileChangeOnly = !!req.body?.profileChangeOnly;
        upgraderUpgradeState.running = true;
        const payload = await executeUpgraderUpgradeBatch({
            config,
            ratingKeys,
            dryRun: false,
            qualityProfileId,
            triggerSearch,
            profileChangeOnly,
            actor: req.user,
        });
        res.json(payload);
    } catch (e) {
        res.status(400).json({ error: e.message || 'Failed to run upgrader actions.' });
    } finally {
        upgraderUpgradeState.running = false;
    }
});

app.get('/api/upgrader/items/:ratingKey/episodes', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const ratingKey = decodeURIComponent(String(req.params.ratingKey || '').trim());
        const codecs = String(req.query.codecs || '').toLowerCase().split(',').filter(Boolean);
        const resolutions = String(req.query.resolutions || '').toLowerCase().split(',').filter(Boolean);
        const features = String(req.query.features || '').toLowerCase().split(',').filter(Boolean);
        const minSizeGB = Math.max(0, Number(config.upgraderMinSizeGB ?? 5));
        const payload = await loadUpgraderIndex();
        const showItem = (Array.isArray(payload.items) ? payload.items : []).find((item) => String(item.ratingKey) === ratingKey);
        if (!showItem || showItem.mediaType !== 'show') {
            return res.status(404).json({ error: 'Series not found in Upgrader index.' });
        }

        const detail = await buildUpgraderShowDetail(config, showItem, codecs, resolutions, features, minSizeGB);
        res.json({
            show: detail.show,
            total: detail.total,
            episodes: detail.episodes,
        });
    } catch (e) {
        res.status(500).json({ error: `Failed to load show episodes: ${e.message}` });
    }
});

app.get('/api/upgrader/items/:ratingKey/detail', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});
        const ratingKey = decodeURIComponent(String(req.params.ratingKey || '').trim());
        const codecs = String(req.query.codecs || '').toLowerCase().split(',').filter(Boolean);
        const resolutions = String(req.query.resolutions || '').toLowerCase().split(',').filter(Boolean);
        const features = String(req.query.features || '').toLowerCase().split(',').filter(Boolean);
        const minSizeGB = Math.max(0, Number(config.upgraderMinSizeGB ?? 5));
        const payload = await loadUpgraderIndex();
        const showItem = (Array.isArray(payload.items) ? payload.items : []).find((item) => String(item.ratingKey) === ratingKey);
        if (!showItem || showItem.mediaType !== 'show') {
            return res.status(404).json({ error: 'Series not found in Upgrader index.' });
        }

        const detail = await buildUpgraderShowDetail(config, showItem, codecs, resolutions, features, minSizeGB);
        res.json(detail);
    } catch (e) {
        res.status(500).json({ error: `Failed to load show detail: ${e.message}` });
    }
});

app.post('/api/upgrader/search', requireAdmin, async (req, res) => {
    try {
        const config = await loadFile(CONFIG_PATH, {});

        const ratingKey = String(req.body?.ratingKey || '').trim();
        const scope = String(req.body?.scope || 'series').toLowerCase();
        const episodeIds = Array.isArray(req.body?.episodeIds)
            ? req.body.episodeIds.map(Number).filter((id) => id > 0)
            : [];

        if (!ratingKey) return res.status(400).json({ error: 'ratingKey is required.' });

        const payload = await loadUpgraderIndex();
        const item = (Array.isArray(payload.items) ? payload.items : []).find((entry) => String(entry.ratingKey) === ratingKey);
        if (!item) return res.status(404).json({ error: 'Title not found in Upgrader index.' });

        const instance = item.arrInstanceId ? getArrInstance(config, item.arrInstanceId) : null;
        if (!instance || !isArrInstanceReady(instance)) {
            return res.status(400).json({ error: 'ARR instance is not ready.' });
        }

        const resolveUrl = resolveIntegrationUrlForFetch;
        let entity = null;
        const arrType = item.arrType || instance.type;
        if (arrType === 'sonarr') {
            entity = await fetchSonarrSeriesById(instance, item.arrEntityId, { resolveUrl, fetchImpl: fetch });
        } else {
            entity = await fetchArrInstanceJson(instance, `/api/v3/movie/${item.arrEntityId}`, { resolveUrl, fetchImpl: fetch });
        }
        if (!entity?.id) {
            return res.status(400).json({ error: 'Could not load title from Sonarr/Radarr.' });
        }

        const resolved = { type: arrType, entity, instanceId: instance.id, instanceName: item.arrInstanceName || instance.name };
        let searchResult = null;
        let action = 'series_search';

        if (scope === 'episode') {
            if (resolved.type !== 'sonarr') {
                return res.status(400).json({ error: 'Episode search is only available for Sonarr series.' });
            }
            if (!episodeIds.length) {
                return res.status(400).json({ error: 'episodeIds is required for episode search.' });
            }
            action = 'episode_search';
            searchResult = await triggerSonarrEpisodeSearch(instance, episodeIds, { resolveUrl, fetchImpl: fetch });
        } else {
            searchResult = await triggerArrEntitySearch(instance, resolved.entity, resolved.type, { resolveUrl, fetchImpl: fetch });
            action = resolved.type === 'radarr' ? 'movie_search' : 'series_search';
        }

        if (!searchResult?.ok) {
            await appendUpgraderAuditEntry({
                action,
                success: false,
                ratingKey,
                title: item.title,
                arrInstanceId: resolved.instanceId,
                arrInstanceName: resolved.instanceName || instance.name,
                arrType: resolved.type,
                episodeIds: scope === 'episode' ? episodeIds : undefined,
                reason: searchResult?.reason || 'Search command failed.',
                actor: req.user ? { username: req.user.username || null, email: req.user.email || null } : null,
                dryRun: false,
            });
            return res.status(400).json({ error: searchResult?.reason || 'Search command failed.' });
        }

        const auditEntry = await appendUpgraderAuditEntry({
            action,
            success: true,
            ratingKey,
            title: item.title,
            arrInstanceId: resolved.instanceId,
            arrInstanceName: resolved.instanceName || instance.name,
            arrType: resolved.type,
            episodeIds: scope === 'episode' ? episodeIds : undefined,
            commandId: searchResult.commandId || null,
            actor: req.user ? { username: req.user.username || null, email: req.user.email || null } : null,
            dryRun: false,
        });

        await appendAuditLog('upgrader_search', req.user, null, {
            ratingKey,
            title: item.title,
            action,
            arrInstanceName: resolved.instanceName || instance.name,
            commandId: searchResult.commandId || null,
            auditId: auditEntry.id,
        });

        res.json({
            success: true,
            action,
            commandId: searchResult.commandId || null,
            auditId: auditEntry.id,
        });
    } catch (e) {
        res.status(500).json({ error: `Failed to trigger search: ${e.message}` });
    }
});

app.get('/api/upgrader/preferences', requireAdmin, async (req, res) => {
    try {
        const maintenancePrefs = await loadMaintenancePreferences();
        const upgraderPrefs = await loadUpgraderPreferences();
        res.json({
            maintenanceExclusions: maintenancePrefs.exclusions,
            upgrader: upgraderPrefs,
        });
    } catch (e) {
        res.status(500).json({ error: `Failed to load upgrader preferences: ${e.message}` });
    }
});

app.post('/api/upgrader/preferences', requireAdmin, async (req, res) => {
    try {
        const incoming = req.body?.upgrader || req.body || {};
        const saved = await saveUpgraderPreferences(incoming);
        await appendAuditLog('upgrader_preferences_updated', req.user, null, {
            exclusions: {
                ratingKeys: saved.exclusions.ratingKeys.length,
                titles: saved.exclusions.titles.length,
                libraries: saved.exclusions.libraries.length,
            },
            snoozed: saved.snoozed.length,
        });
        res.json({ success: true, upgrader: saved });
    } catch (e) {
        res.status(500).json({ error: `Failed to save upgrader preferences: ${e.message}` });
    }
});

app.post('/api/upgrader/snooze', requireAdmin, async (req, res) => {
    try {
        const ratingKey = String(req.body?.ratingKey || '').trim();
        const days = Math.max(1, Math.min(365, Number(req.body?.days || 30)));
        if (!ratingKey) return res.status(400).json({ error: 'ratingKey is required.' });

        const prefs = await loadUpgraderPreferences();
        const until = new Date(Date.now() + (days * 24 * 60 * 60 * 1000)).toISOString();
        const nextSnoozed = [
            { ratingKey, until, reason: req.body?.reason || `Snoozed for ${days} days` },
            ...(prefs.snoozed || []).filter((entry) => String(entry.ratingKey) !== ratingKey),
        ];
        const saved = await saveUpgraderPreferences({ ...prefs, snoozed: nextSnoozed });
        await appendAuditLog('upgrader_snoozed', req.user, null, { ratingKey, until, days });
        res.json({ success: true, ratingKey, until, snoozed: saved.snoozed });
    } catch (e) {
        res.status(500).json({ error: `Failed to snooze upgrader item: ${e.message}` });
    }
});

app.post('/api/upgrader/unsnooze', requireAdmin, async (req, res) => {
    try {
        const ratingKey = String(req.body?.ratingKey || '').trim();
        if (!ratingKey) return res.status(400).json({ error: 'ratingKey is required.' });
        const prefs = await loadUpgraderPreferences();
        const saved = await saveUpgraderPreferences({
            ...prefs,
            snoozed: (prefs.snoozed || []).filter((entry) => String(entry.ratingKey) !== ratingKey),
        });
        res.json({ success: true, snoozed: saved.snoozed });
    } catch (e) {
        res.status(500).json({ error: `Failed to unsnooze upgrader item: ${e.message}` });
    }
});

app.get('/api/maintenance/storage-summary', requireAdmin, async (req, res) => {
    try {
        const payload = await loadFile(MAINTENANCE_MEDIA_INDEX_PATH, { generatedAt: null, items: [] });
        const preferences = await loadMaintenancePreferences();
        const rules = await loadFile(MAINTENANCE_RULES_PATH, []);
        const requestedRuleId = String(req.query.ruleId || '').trim();
        const allItems = Array.isArray(payload.items) ? payload.items : [];
        const usableItems = applyMaintenanceExclusions(allItems, preferences);

        const selectedRules = requestedRuleId
            ? rules.filter((r) => String(r.id || '') === requestedRuleId)
            : rules.filter((r) => r?.enabled !== false);

        const matched = selectedRules.length
            ? usableItems.filter((item) => selectedRules.some((rule) => evaluateMaintenanceRule(item, rule)))
            : [];
        const matchedKeys = new Set(matched.map((item) => String(item?.ratingKey || '')));

        const libraries = {};
        allItems.forEach((item) => {
            const libId = String(item?.libraryId || '');
            const libName = item?.libraryTitle || `Library ${libId || 'Unknown'}`;
            if (!libraries[libName]) {
                libraries[libName] = {
                    libraryId: libId,
                    libraryTitle: libName,
                    totalItems: 0,
                    totalSizeGB: 0,
                    matchedItems: 0,
                    reclaimGB: 0,
                    afterSizeGB: 0,
                    reclaimPercent: 0
                };
            }
            const size = Number(item?.sizeGB || 0);
            libraries[libName].totalItems += 1;
            libraries[libName].totalSizeGB += size;
            if (matchedKeys.has(String(item?.ratingKey || ''))) {
                libraries[libName].matchedItems += 1;
                libraries[libName].reclaimGB += size;
            }
        });

        const libraryRows = Object.values(libraries).map((lib) => {
            const after = Math.max(0, Number(lib.totalSizeGB || 0) - Number(lib.reclaimGB || 0));
            const percent = Number(lib.totalSizeGB || 0) > 0 ? ((Number(lib.reclaimGB || 0) / Number(lib.totalSizeGB || 0)) * 100) : 0;
            return {
                ...lib,
                totalSizeGB: Math.round(Number(lib.totalSizeGB || 0) * 100) / 100,
                reclaimGB: Math.round(Number(lib.reclaimGB || 0) * 100) / 100,
                afterSizeGB: Math.round(after * 100) / 100,
                reclaimPercent: Math.round(percent * 100) / 100
            };
        }).sort((a, b) => b.reclaimGB - a.reclaimGB);

        const totalBeforeGB = libraryRows.reduce((sum, row) => sum + Number(row.totalSizeGB || 0), 0);
        const totalReclaimGB = libraryRows.reduce((sum, row) => sum + Number(row.reclaimGB || 0), 0);
        const totalAfterGB = Math.max(0, totalBeforeGB - totalReclaimGB);

        res.json({
            generatedAt: new Date().toISOString(),
            indexGeneratedAt: payload.generatedAt || null,
            selectedRuleId: requestedRuleId || null,
            rulesConsidered: selectedRules.map((r) => ({ id: r.id, name: r.name || 'Unnamed Rule' })),
            totals: {
                libraries: libraryRows.length,
                items: allItems.length,
                matchedItems: matched.length,
                beforeGB: Math.round(totalBeforeGB * 100) / 100,
                reclaimGB: Math.round(totalReclaimGB * 100) / 100,
                afterGB: Math.round(totalAfterGB * 100) / 100,
                reclaimPercent: totalBeforeGB > 0 ? Math.round((totalReclaimGB / totalBeforeGB) * 10000) / 100 : 0
            },
            libraries: libraryRows
        });
    } catch (e) {
        res.status(500).json({ error: `Failed to load maintenance storage summary: ${e.message}` });
    }
});

app.post('/api/maintenance/preview', requireAdmin, async (req, res) => {
    try {
        const { ruleId, rule, limit = 300, includeAll = false, includeArrDiagnostics = false } = req.body || {};
        const config = await loadFile(CONFIG_PATH, {});
        const rules = await loadFile(MAINTENANCE_RULES_PATH, []);
        const payload = await loadFile(MAINTENANCE_MEDIA_INDEX_PATH, { items: [] });
        const preferences = await loadMaintenancePreferences();
        const allItems = Array.isArray(payload.items) ? payload.items : [];
        const selectedRules = rule
            ? [rule]
            : (ruleId ? rules.filter(r => r.id === ruleId) : rules.filter(r => r.enabled !== false));
        const catalog = includeArrDiagnostics ? await getArrCatalog(config) : null;
        const previews = selectedRules.map((selectedRule) => buildMaintenancePreviewForRule(
            selectedRule,
            allItems,
            preferences,
            catalog,
            config,
            { limit, includeAll }
        ));
        res.json({
            generatedAt: new Date().toISOString(),
            indexGeneratedAt: payload.generatedAt || null,
            preferences,
            arrDiagnostics: includeArrDiagnostics ? {
                radarrCount: catalog?.catalogCounts?.radarr ?? (catalog?.radarr?.length || 0),
                sonarrCount: catalog?.catalogCounts?.sonarr ?? (catalog?.sonarr?.length || 0),
                radarrConfigured: getArrInstanceCounts(config).radarr.ready > 0,
                sonarrConfigured: getArrInstanceCounts(config).sonarr.ready > 0,
                instanceCounts: catalog?.counts || getArrInstanceCounts(config),
                instances: Object.values(catalog?.instances || {}).map((entry) => ({
                    id: entry.id,
                    name: entry.name,
                    type: entry.type,
                    isDefault: !!entry.isDefault,
                    itemCount: entry.itemCount || 0,
                })),
            } : null,
            previews
        });
    } catch (e) {
        res.status(500).json({ error: `Failed to generate maintenance preview: ${e.message}` });
    }
});

app.post('/api/maintenance/preflight', requireAdmin, async (req, res) => {
    try {
        const ruleId = String(req.body?.ruleId || '').trim();
        if (!ruleId) return res.status(400).json({ error: 'ruleId is required.' });
        const config = await loadFile(CONFIG_PATH, {});
        const rules = await loadFile(MAINTENANCE_RULES_PATH, []);
        const rule = (Array.isArray(rules) ? rules : []).find((r) => String(r?.id || '') === ruleId);
        if (!rule) return res.status(404).json({ error: 'Maintenance rule not found.' });
        const catalog = await getArrCatalog(config);
        const preflight = await validateMaintenanceDestructivePreflight(config, rule, catalog);
        const preferences = await loadMaintenancePreferences();
        const indexPayload = await loadFile(MAINTENANCE_MEDIA_INDEX_PATH, { items: [] });
        const preview = buildMaintenancePreviewForRule(
            rule,
            Array.isArray(indexPayload.items) ? indexPayload.items : [],
            preferences,
            catalog,
            config,
            { limit: 5, includeAll: false }
        );
        res.json({
            ...preflight,
            preview: {
                totalMatches: preview.totalMatches,
                eligibleCount: preview.eligibleCount,
                inGraceCount: preview.inGraceCount,
                graceRemainingDays: preview.graceRemainingDays,
                actionableCount: preview.actionableCount,
                unactionableCount: preview.unactionableCount,
                wouldProcessCount: preview.wouldProcessCount,
                maxActionsPerRun: preview.maxActionsPerRun
            },
            arrCatalog: {
                radarrCount: catalog.radarr.length,
                sonarrCount: catalog.sonarr.length,
                instances: Object.values(catalog?.instances || {}).map((entry) => ({
                    id: entry.id,
                    name: entry.name,
                    type: entry.type,
                    itemCount: entry.itemCount || 0,
                })),
            }
        });
    } catch (e) {
        res.status(500).json({ error: `Failed maintenance preflight: ${e.message}` });
    }
});

app.get('/api/maintenance/preferences', requireAdmin, async (req, res) => {
    try {
        const prefs = await loadMaintenancePreferences();
        res.json(prefs);
    } catch (e) {
        res.status(500).json({ error: `Failed to load maintenance preferences: ${e.message}` });
    }
});

app.get('/api/maintenance/exclusions/summary', requireAdmin, async (req, res) => {
    try {
        const prefs = await loadMaintenancePreferences();
        const payload = await loadFile(MAINTENANCE_MEDIA_INDEX_PATH, { generatedAt: null, items: [] });
        const allItems = Array.isArray(payload.items) ? payload.items : [];

        const byRatingKey = new Map(allItems.map((item) => [String(item?.ratingKey || ''), item]));
        const byNormalizedTitle = new Map();
        allItems.forEach((item) => {
            const key = normalized(item?.title || '');
            if (!key) return;
            if (!byNormalizedTitle.has(key)) byNormalizedTitle.set(key, []);
            byNormalizedTitle.get(key).push(item);
        });

        const ratingKeyEntries = (prefs?.exclusions?.ratingKeys || []).map((ratingKey) => {
            const key = String(ratingKey || '');
            const item = byRatingKey.get(key);
            return {
                ratingKey: key,
                found: !!item,
                title: item?.title || '(Missing from current index)',
                libraryTitle: item?.libraryTitle || '',
                thumb: item?.thumb || ''
            };
        });

        const titleEntries = (prefs?.exclusions?.titles || []).map((title) => {
            const key = normalized(title || '');
            const matches = byNormalizedTitle.get(key) || [];
            const sample = matches[0] || null;
            return {
                title: String(title || ''),
                matchCount: matches.length,
                sampleTitle: sample?.title || null,
                sampleLibraryTitle: sample?.libraryTitle || null,
                sampleThumb: sample?.thumb || null
            };
        });

        const libraryEntries = (prefs?.exclusions?.libraries || []).map((library) => {
            const normalizedLibrary = normalized(library || '');
            const count = allItems.filter((item) => normalized(item?.libraryTitle || '') === normalizedLibrary).length;
            return {
                libraryTitle: String(library || ''),
                matchCount: count
            };
        });

        res.json({
            generatedAt: payload.generatedAt || null,
            ratingKeys: ratingKeyEntries,
            titles: titleEntries,
            libraries: libraryEntries
        });
    } catch (e) {
        res.status(500).json({ error: `Failed to load exclusions summary: ${e.message}` });
    }
});

app.post('/api/maintenance/preferences', requireAdmin, async (req, res) => {
    try {
        const body = req.body || {};
        const next = {
            global: {
                dryRunByDefault: body?.global?.dryRunByDefault !== undefined ? !!body.global.dryRunByDefault : MAINTENANCE_PREFS_DEFAULTS.global.dryRunByDefault,
                maxActionsPerRun: Math.max(1, Number(body?.global?.maxActionsPerRun || MAINTENANCE_PREFS_DEFAULTS.global.maxActionsPerRun)),
                requireConfirmForDestructive: body?.global?.requireConfirmForDestructive !== undefined ? !!body.global.requireConfirmForDestructive : MAINTENANCE_PREFS_DEFAULTS.global.requireConfirmForDestructive
            },
            exclusions: {
                ratingKeys: Array.isArray(body?.exclusions?.ratingKeys) ? body.exclusions.ratingKeys.map(v => String(v)) : [],
                titles: Array.isArray(body?.exclusions?.titles) ? body.exclusions.titles.map(v => String(v)) : [],
                libraries: Array.isArray(body?.exclusions?.libraries) ? body.exclusions.libraries.map(v => String(v)) : []
            }
        };
        await saveFile(MAINTENANCE_PREFS_PATH, next);
        await appendAuditLog('maintenance_preferences_updated', req.user, null, {
            titleExclusions: next.exclusions.titles.length,
            libraryExclusions: next.exclusions.libraries.length,
            keyExclusions: next.exclusions.ratingKeys.length
        });
        res.json({ success: true, preferences: next });
    } catch (e) {
        res.status(500).json({ error: `Failed to save maintenance preferences: ${e.message}` });
    }
});

app.get('/api/maintenance/runs', requireAdmin, async (req, res) => {
    try {
        const runs = await loadFile(MAINTENANCE_RUNS_PATH, []);
        res.json(Array.isArray(runs) ? runs : []);
    } catch (e) {
        res.status(500).json({ error: `Failed to load maintenance runs: ${e.message}` });
    }
});

const executeMaintenanceRunBatch = async ({ actor, ruleId = null, dryRun = undefined, confirmToken = null, runOptions = {} }) => {
    const config = await loadFile(CONFIG_PATH, {});
    if (!isMaintenanceExperimentalEnabled(config)) {
        throw new Error('Maintenance Experimental Mode is disabled. Enable it in Settings first.');
    }
    const rawRules = await loadFile(MAINTENANCE_RULES_PATH, []);
    const sourceRules = Array.isArray(rawRules) ? rawRules : [];
    let rulesChanged = false;
    const rules = sourceRules.map((rule) => {
        const graceDays = Math.max(0, Number(rule?.graceDays || 0));
        const createdAt = rule?.createdAt || new Date().toISOString();
        if (graceDays !== Number(rule?.graceDays || 0) || !rule?.createdAt) rulesChanged = true;
        return {
            ...rule,
            graceDays,
            createdAt
        };
    });
    if (rulesChanged) await saveFile(MAINTENANCE_RULES_PATH, rules);
    const selected = ruleId ? rules.filter(r => r.id === ruleId) : rules.filter(r => r.enabled !== false);
    if (!selected.length) {
        throw new Error('No enabled maintenance rule found.');
    }
    const existingRuns = await loadFile(MAINTENANCE_RUNS_PATH, []);
    const newRuns = [];
    for (const rule of selected) {
        const run = await runMaintenanceRule({ rule, dryRun, actor, confirmToken, runOptions });
        newRuns.push(run);
    }
    const updatedRuns = [...newRuns, ...existingRuns].slice(0, 400);
    await saveFile(MAINTENANCE_RUNS_PATH, updatedRuns);
    return newRuns;
};

app.post('/api/maintenance/run', requireAdmin, async (req, res) => {
    if (maintenanceRunState.running) {
        return res.status(409).json({ error: 'A maintenance run is already in progress.' });
    }
    const task = tasksInfo.find(t => t.id === 'maintenanceRuleRun');
    try {
        const { ruleId, dryRun, confirmToken, runOptions } = req.body || {};
        maintenanceRunState.running = true;
        maintenanceRunState.lastRunAt = new Date().toISOString();
        maintenanceRunState.lastError = null;
        if (task) markTaskStart(task);
        const newRuns = await executeMaintenanceRunBatch({ actor: req.user, ruleId, dryRun, confirmToken, runOptions });
        if (task) {
            task.nextRun = null;
            markTaskEnd(task, null);
        }
        maintenanceRunState.running = false;
        await appendAuditLog('maintenance_run_completed', req.user, null, {
            runCount: newRuns.length,
            dryRun: dryRun !== false
        });
        res.json({ success: true, runs: newRuns });
    } catch (e) {
        maintenanceRunState.running = false;
        maintenanceRunState.lastError = e.message;
        if (task) markTaskEnd(task, e);
        res.status(500).json({ error: `Maintenance run failed: ${e.message}` });
    }
});

// --- Stream Kill Rules Engine ---
function normalizeRuleResolution(rawResolution, isTranscoding, transcodeResolutionRaw) {
    const normalizeBucket = (value) => {
        const text = String(value || '').toLowerCase().trim();
        if (!text) return '';
        if (text.includes('4k') || text.includes('2160')) return '4k';
        if (text.includes('1440')) return '1440';
        if (text.includes('1080')) return '1080';
        if (text.includes('720')) return '720';
        if (text.includes('576')) return '576';
        if (text.includes('480')) return '480';
        if (text.includes('sd')) return 'sd';
        return text;
    };
    if (isTranscoding) {
        const hinted = normalizeBucket(transcodeResolutionRaw);
        if (hinted) return hinted;
        // Conservative behavior: never infer transcode output resolution from source metadata.
        // If output resolution is unknown, strict resolution rules should not match.
        return 'unknown';
    }
    return normalizeBucket(rawResolution);
}

function sessionMatchesCondition(session, condition) {
    const { field, operator, value } = condition;
    let sessionVal;

    switch (field) {
        case 'isTranscoding': sessionVal = session.isTranscoding ? 'true' : 'false'; break;
        case 'videoResolution': sessionVal = (session.resolution || '').toString().toLowerCase(); break;
        case 'user': sessionVal = (session.user || '').toLowerCase(); break;
        case 'bandwidth': sessionVal = Math.round((session.bandwidth || 0) / 1000); break; // in Mbps
        case 'playerProduct': sessionVal = (session.playerProduct || '').toLowerCase(); break;
        case 'state': sessionVal = (session.state || '').toLowerCase(); break;
        case 'mediaType': sessionVal = (session.type || '').toLowerCase(); break;
        case 'sessionLocation': sessionVal = (session.sessionLocation || '').toLowerCase(); break;
        case 'playerTitle': sessionVal = (session.playerTitle || '').toLowerCase(); break;
        case 'videoCodec': sessionVal = (session.videoCodec || '').toLowerCase(); break;
        case 'audioCodec': sessionVal = (session.audioCodec || '').toLowerCase(); break;
        case 'transcodeVideoDecision': sessionVal = (session.transcodeVideoDecision || '').toLowerCase(); break;
        default: return false;
    }

    const compareVal = field === 'bandwidth' ? parseFloat(value) : (value || '').toString().toLowerCase();

    switch (operator) {
        case 'equals': return String(sessionVal) === String(compareVal);
        case 'not_equals': return String(sessionVal) !== String(compareVal);
        case 'contains': return String(sessionVal).includes(String(compareVal));
        case 'not_contains': return !String(sessionVal).includes(String(compareVal));
        case 'greater_than': return parseFloat(sessionVal) > parseFloat(compareVal);
        case 'less_than': return parseFloat(sessionVal) < parseFloat(compareVal);
        default: return false;
    }
}

async function evaluateKillRules(config, uri, sessions) {
    if (!sessions || sessions.length === 0) return;
    const rules = await loadFile(KILL_RULES_PATH, []);
    const enabledRules = rules.filter(r => r.enabled !== false);
    if (enabledRules.length === 0) return;

    for (const session of sessions) {
        for (const rule of enabledRules) {
            const { conditions, conditionLogic = 'AND', killMessage, name } = rule;
            if (!conditions || conditions.length === 0) continue;

            let matched;
            if (conditionLogic === 'OR') {
                matched = conditions.some(c => sessionMatchesCondition(session, c));
            } else {
                matched = conditions.every(c => sessionMatchesCondition(session, c));
            }

            if (matched && session.sessionId) {
                const msg = killMessage || `Your stream has been stopped by the server administrator (Rule: ${name || 'Unnamed'}).`;
                try {
                    const killRes = await fetch(`${uri}/status/sessions/terminate?sessionId=${encodeURIComponent(session.sessionId)}&reason=${encodeURIComponent(msg)}&X-Plex-Token=${config.plexToken}`, {
                        method: 'GET', headers: plexClientHeaders(config.plexToken)
                    });
                    if (killRes.ok || killRes.status === 204) {
                        log(`[KillRules] Terminated session for "${session.user || 'Unknown'}" via rule "${name || 'Unnamed'}". Reason: ${msg}`);
                        await appendAuditLog('stream_killed_by_rule', null, null, { user: session.user, rule: name, reason: msg });
                    }
                } catch (e) {
                    log(`[KillRules] Error terminating session: ${e.message}`);
                }
                break; // One rule match per session is enough
            }
        }
    }
}

// --- Security: Schema validation for kill rules ---
const VALID_KILL_RULE_FIELDS    = new Set(['isTranscoding', 'videoResolution', 'user', 'bandwidth', 'playerProduct', 'state', 'mediaType', 'sessionLocation', 'playerTitle', 'videoCodec', 'audioCodec', 'transcodeVideoDecision']);
const VALID_KILL_RULE_OPERATORS = new Set(['equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than']);

const validateKillRulesSchema = (rules) => {
    if (!Array.isArray(rules)) throw new Error('Rules must be an array');
    for (const rule of rules) {
        if (typeof rule !== 'object' || rule === null) throw new Error('Each rule must be an object');
        if (!Array.isArray(rule.conditions))           throw new Error(`Rule "${rule.name || 'unnamed'}": conditions must be an array`);
        if (rule.conditionLogic && !['AND', 'OR'].includes(String(rule.conditionLogic))) {
            throw new Error(`Rule "${rule.name || 'unnamed'}": invalid conditionLogic "${rule.conditionLogic}"`);
        }
        if (rule.killMessage && String(rule.killMessage).length > 500) {
            throw new Error(`Rule "${rule.name || 'unnamed'}": killMessage exceeds 500 characters`);
        }
        for (const cond of rule.conditions) {
            if (!cond || typeof cond !== 'object') throw new Error('Each condition must be an object');
            if (!VALID_KILL_RULE_FIELDS.has(cond.field))       throw new Error(`Invalid condition field: "${cond.field}"`);
            if (!VALID_KILL_RULE_OPERATORS.has(cond.operator)) throw new Error(`Invalid condition operator: "${cond.operator}"`);
        }
    }
};

// Rules API
app.get('/api/kill-rules', requireAdmin, async (req, res) => {
    try {
        const rules = await loadFile(KILL_RULES_PATH, []);
        res.json(rules);
    } catch (e) {
        res.status(500).json({ error: 'Failed to load rules' });
    }
});

app.post('/api/kill-rules', requireAdmin, async (req, res) => {
    try {
        const rules = req.body;
        validateKillRulesSchema(rules);
        await saveFile(KILL_RULES_PATH, rules);
        res.json({ success: true });
    } catch (e) {
        res.status(e.message.startsWith('Rule') || e.message.startsWith('Each') || e.message.startsWith('Invalid') ? 400 : 500).json({ error: e.message || 'Failed to save rules' });
    }
});

// Monitor Plex sessions to track high watermarks
async function monitorConcurrentSessions() {
    try {
        const config = await loadFile(CONFIG_PATH, null);
        if (!config || !config.plexToken || !config.serverIdentifier) return;

        const uri = await getPlexConnectionUri(config);
        if (!uri) return;

        const sessionsRes = await fetch(`${uri}/status/sessions?X-Plex-Token=${config.plexToken}`, { headers: plexClientHeaders(config.plexToken) }).then(r => r.json()).catch(() => null);

        if (sessionsRes && sessionsRes.MediaContainer) {
            const currentStreams = sessionsRes.MediaContainer.size || 0;

            // Evaluate kill rules against live sessions
            if (sessionsRes.MediaContainer.Metadata) {
                const sessionObjs = sessionsRes.MediaContainer.Metadata.map(m => {
                    const isTranscode = !!(m.TranscodeSession || (m.Media && m.Media[0] && m.Media[0].Part && m.Media[0].Part[0] && m.Media[0].Part[0].Stream && m.Media[0].Part[0].Stream.some(s => s.decision === 'transcode')));
                    const player = m.Player || {};
                    const session = m.Session || {};
                    const transcodeResolutionRaw = m?.TranscodeSession?.videoResolution || '';
                    const sourceResolution = m.Media && m.Media[0] ? m.Media[0].videoResolution : null;
                    return {
                        sessionId: session.id || m.sessionKey,
                        user: m.User ? m.User.title : 'Unknown',
                        isTranscoding: isTranscode,
                        sourceResolution: sourceResolution ? String(sourceResolution).toLowerCase() : null,
                        resolution: normalizeRuleResolution(sourceResolution, isTranscode, transcodeResolutionRaw),
                        bandwidth: normalizePlexBandwidthKbps((session && session.bandwidth) || (m.Media && m.Media[0] && m.Media[0].bitrate) || 0),
                        playerProduct: player.product || '',
                        playerTitle: player.title || '',
                        state: player.state || 'playing',
                        type: m.type || '',
                        sessionLocation: session.location || 'lan',
                        videoCodec: m.Media && m.Media[0] ? m.Media[0].videoCodec : '',
                        audioCodec: m.Media && m.Media[0] ? m.Media[0].audioCodec : '',
                        transcodeVideoDecision: m.TranscodeSession ? m.TranscodeSession.videoDecision : 'directplay',
                    };
                });
                await evaluateKillRules(config, uri, sessionObjs);
            }
            let currentDirect = 0;
            let currentTranscodes = 0;

            if (sessionsRes.MediaContainer.Metadata) {
                sessionsRes.MediaContainer.Metadata.forEach(m => {
                    let isTranscode = false;
                    if (m.TranscodeSession) {
                        isTranscode = true;
                    } else if (m.Media && m.Media.length > 0) {
                        for (const media of m.Media) {
                            if (media.Part && media.Part.length > 0) {
                                for (const part of media.Part) {
                                    if (part.decision === 'transcode' || (part.Stream && part.Stream.some(s => s.decision === 'transcode'))) {
                                        isTranscode = true;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    if (isTranscode) {
                        currentTranscodes++;
                    } else {
                        currentDirect++;
                    }
                });
            }

            const stats = await loadFile(PLEX_STATS_CACHE_PATH, {});
            let updated = false;

            if (currentStreams > (stats.maxConcurrentStreams || 0)) {
                stats.maxConcurrentStreams = currentStreams;
                updated = true;
            }
            if (currentDirect > (stats.maxDirectPlays || 0)) {
                stats.maxDirectPlays = currentDirect;
                updated = true;
            }
            if (currentTranscodes > (stats.maxTranscodes || 0)) {
                stats.maxTranscodes = currentTranscodes;
                updated = true;
            }

            if (updated) {
                await saveFile(PLEX_STATS_CACHE_PATH, stats);
            }
        }
    } catch (e) { }
}

app.listen(PORT, BIND_HOST, async () => {
    log(`--- Server Manager Portal Service starting on http://${BIND_HOST}:${PORT} ---`);
    log(`Runtime: CONFIG_DIR=${CONFIG_DIR}, FORCE_SECURE_COOKIES=${FORCE_SECURE_COOKIES}, BASE_PATH=${BASE_PATH || '/'}, appVersion=${appVersion}`);
    if (!arePortalFrontendAssetsReady()) {
        log('CRITICAL: Frontend build assets missing (static/tailwind.css and/or static/index.js). Pull the latest Docker image or run npm run build before serving the UI.');
    }
    if (FORCE_SECURE_COOKIES) {
        log('WARNING: FORCE_SECURE_COOKIES=true — plain HTTP logins (http://LAN-IP:2121) will fail until this is set to false.');
    }

    await migrateConfigFiles((message) => log(`[config] ${message}`));

    // Ensure unique, *stable* CLIENT_ID per installation (survives Docker recreates).
    // Without this, PMS may register the container hostname (e.g. 151a94f8…) as a new device each restart.
    let config = await loadFile(CONFIG_PATH, {});
    // Seed Portal UI Public Base URL from PUBLIC_BASE_URL when the UI field was never set.
    if (!normalizePublicBaseUrl(config.publicDomain) && getEnvPublicBaseUrl()) {
        config.publicDomain = getEnvPublicBaseUrl();
        await saveFile(CONFIG_PATH, config);
        log(`Seeded publicDomain from PUBLIC_BASE_URL=${config.publicDomain}`);
    }
    refreshRuntimePublicBaseUrl(config);
    if (!config.clientId || config.clientId.startsWith('smp-') || config.clientId === 'plex-expiry-manager-client-id') {
        config.clientId = randomUUID();
        await saveFile(CONFIG_PATH, config);
        log(`Generated stable Plex clientId ${config.clientId}`);
    }
    if (!process.env.CLIENT_ID) {
        CLIENT_ID = config.clientId;
    } else {
        CLIENT_ID = process.env.CLIENT_ID;
        if (config.clientId !== CLIENT_ID) {
            config.clientId = CLIENT_ID;
            await saveFile(CONFIG_PATH, config);
        }
    }
    log(`Plex client identity: product=Server Manager Portal clientId=${String(CLIENT_ID).slice(0, 8)}…`);
    await syncAdminPlexIdFromConfigToken(config, { persist: true });

    await loadStatusState();
    runMonitorCycle();
    setInterval(runMonitorCycle, 15000);
    monitorConcurrentSessions();
    setInterval(monitorConcurrentSessions, 15000);
    startBackgroundService();
    loadFile(CONFIG_PATH, {}).then(async (bootConfig) => {
        try {
            // Prefer the in-memory CLIENT_ID so Collexions shares the same Plex device identity.
            const bootWithId = { ...(bootConfig || {}), clientId: CLIENT_ID || bootConfig?.clientId };
            const { config: withCollexions, changed } = applyCollexionsBundledDefaults(bootWithId, {
                configDir: CONFIG_DIR,
                log,
            });
            if (changed) {
                await saveFile(CONFIG_PATH, withCollexions);
            }
            await syncCollexionsEmbeddedWorker(withCollexions, { configDir: CONFIG_DIR, log });
        } catch (e) {
            log(`[collexions] Startup embedded worker sync failed: ${e.message}`);
        }
        // Phase 4: Discover prefs are portal-owned — skip Seerr settings sync on boot.
    });
    startPlexStatsBackgroundTask(); // start 24-hour library size cache task

    // Background cache builders: reuse on-disk cache and schedule next run by interval.
    startTrendingStatsBackgroundTask();
    startAnalyticsStatsBackgroundTask();
    startUpgraderIndexBackgroundTask();
    startPortalRequestStatusSyncBackgroundTask();
    startDiscoveryAvailabilityCacheBackgroundTask();
    startScannerWorker(async () => scannerPortalConfig(await loadFile(CONFIG_PATH, {})));
    void refreshScannerAuthCache();
    systemJobs.maintenanceIndex.nextRun = new Date(Date.now() + (20 * 1000)).toISOString();
    setTimeout(async () => {
        try {
            const cfg = await loadFile(CONFIG_PATH, {});
            if (!isMediaQualityIndexEnabled(cfg)) return;
            await buildMaintenanceMediaIndex({ actor: { username: 'System', email: 'system@local' }, force: false });
        } catch (e) {
            log(`Initial media quality index build failed: ${e.message}`);
        }
    }, 20000);
    setInterval(async () => {
        systemJobs.maintenanceIndex.nextRun = new Date(Date.now() + (6 * 60 * 60 * 1000)).toISOString();
        try {
            const cfg = await loadFile(CONFIG_PATH, {});
            if (!isMediaQualityIndexEnabled(cfg)) return;
            await buildMaintenanceMediaIndex({ actor: { username: 'System', email: 'system@local' }, force: false });
        } catch (e) {
            log(`Scheduled media quality index build failed: ${e.message}`);
        }
    }, 6 * 60 * 60 * 1000);

    const backupConfig = await loadFile(CONFIG_PATH, {});
    systemJobs.autoBackup.nextRun = backupConfig.autoBackupEnabled ? computeNextBackupRun(backupConfig) : null;
    // Check every hour whether an auto backup is due.
    setInterval(async () => {
        const cfg = await loadFile(CONFIG_PATH, {});
        if (!cfg.autoBackupEnabled) {
            systemJobs.autoBackup.nextRun = null;
            return;
        }
        const nextRunTs = Date.parse(computeNextBackupRun(cfg));
        systemJobs.autoBackup.nextRun = new Date(nextRunTs).toISOString();
        if (Date.now() >= nextRunTs) {
            await runAutoBackupCycle('scheduled');
        }
    }, 60 * 60 * 1000);
});
