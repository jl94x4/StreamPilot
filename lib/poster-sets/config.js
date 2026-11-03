import { randomBytes } from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { CONFIG_DIR } from '../data-paths.js';

export const POSTER_SETS_DIR = process.env.POSTER_SETS_CONFIG_DIR
    ? path.resolve(process.env.POSTER_SETS_CONFIG_DIR)
    : path.join(CONFIG_DIR, 'poster-sets');

export const POSTER_SETS_CONFIG_PATH = path.join(POSTER_SETS_DIR, 'config.json');

export const generatePosterSetsWebhookToken = () => randomBytes(32).toString('base64url');

export const DEFAULT_POSTER_SETS_CONFIG = {
    base_url: '',
    token: '',
    bulk_txt: 'bulk_import.txt',
    tv_library: ['TV Shows'],
    movie_library: ['Movies'],
    mediux_filters: ['title_card', 'background', 'season_cover', 'show_cover'],
    /** Clear Kometa/Overlays stamps after upload so the next Overlays run restamps the new art. */
    reset_overlay: true,
    /** When the same set appears on MediUX and ThePosterDB, which one to keep as primary. */
    dupePreference: 'posterdb',
    /** Periodically re-check watched sets for new posters / title cards. */
    watchersEnabled: true,
    /** Hours between watcher passes (minimum 1). */
    watchIntervalHours: 6,
    /** After a successful apply, automatically pin the set for future updates. */
    autoWatchOnApply: true,
    /** Gotify summary when a watcher pass queues new art (uses portal Gotify settings). */
    notifyOnWatcherDigest: true,
    /** When Sonarr On Import fires, debounce-check matching Poster Sets watches. */
    arrWatchHookEnabled: true,
    /**
     * Creator usernames (MediUX / ThePosterDB) to surface on Browse → Following.
     * Clicking @user anywhere still opens their full catalog.
     */
    creatorWhitelist: [],
    /**
     * Creator usernames whose sets are hidden, omitted from title-cache scrapes, and never image-cached.
     */
    creatorBlocklist: [],
    /**
     * Where applied artwork is written: Plex server upload, Jellyfin/Emby API, local files, or Plex + local.
     * Jellyfin/Emby uses portal Media Player credentials.
     */
    applyDestination: 'plex',
    tpdb_username: '',
    tpdb_password: '',
    /** Persist TPDB scrapes for library titles (fast reopen + offline apply). Opt-in. */
    tpdbLocalCacheEnabled: false,
    /** After a library title's TPDB sets load, background-cache every set's assets + images. */
    tpdbAggressivePrefetch: false,
    /**
     * Experimental: run 5 cache-build CLI workers in parallel (separate sessions).
     * Faster title resolve, higher 429 / Cloudflare risk — turn off if the build gets flaky.
     */
    tpdbWarmParallelWorkers: false,
    /**
     * When Prefetch hydrates set pages/images, queue Creators you follow first (whitelist order).
     */
    tpdbPrioritizeFollowedCreators: true,
    /**
     * Only prefetch/cache set pages and images from Creators you follow.
     * Title set lists still resolve for the whole library.
     */
    tpdbCacheFollowedCreatorsOnly: false,
    /**
     * Attempt TPDB login for advanced TMDB/IMDB/TVDB search.
     * Turn off on Cloudflare-blocked hosts — public title search still scrapes posters.
     */
    tpdbUseLogin: true,
    /** Master ThePosterDB switch: watches, Paste / Import, credentials, and cache. */
    tpdbEnabled: true,
    /**
     * Include ThePosterDB in Discover search, Browse, TPDB New, and library set lookup.
     * Off keeps watches and the import script working without TPDB search rate limits.
     */
    tpdbSearchEnabled: true,
    /** Copy-title control on library posters for pasting into ThePosterDB. */
    copyLibraryTitleEnabled: true,
    /** Include MediUX in search, Browse, and UI copy. */
    mediuxEnabled: true,
    /** Soft cap for tpdb-image-cache on disk (bytes). */
    tpdbCacheMaxBytes: 2 * 1024 * 1024 * 1024,
    /** Local hour (0–23) for the first TPDB cache “new sets” refresh each day. */
    tpdbCacheRefreshHour: 3,
    /**
     * Repeat refresh every N hours after the start hour (clock-aligned).
     * 0 or 24 = once daily at tpdbCacheRefreshHour only.
     */
    tpdbCacheRefreshIntervalHours: 0,
    /** Library cache build: movies + TV, movies only, or TV only. */
    tpdbCacheWarmMedia: 'all',
    /** Library cache build: recent + full library, or recently added only. */
    tpdbCacheWarmSource: 'full',
    /** Skip titles that already have a TPDB set list on disk. */
    tpdbCacheSkipCached: true,
    /**
     * When Plex posts library.new, resolve the title on ThePosterDB and cache set lists + images.
     * Requires Enable local TPDB cache. Uses /api/poster-sets/webhook (register in Plex).
     */
    tpdbCacheOnLibraryAdd: true,
    /** One-shot: last 20 movies + last 20 shows warmed when local cache is first enabled. */
    tpdbFirstRunBackfillDone: false,
    /** Shared-secret for Plex → Poster Sets library.new webhook (?token=). */
    webhookToken: '',
};

const asLibraryList = (value) => {
    if (Array.isArray(value)) {
        return value.map((item) => String(item || '').trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
        return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
    }
    return [];
};

/** Every TV and movie library on the server. Music and photos are not artwork targets. */
export const librariesForPosterSets = (libraries = []) => {
    const tv_library = [];
    const movie_library = [];
    const skipped = [];
    for (const lib of Array.isArray(libraries) ? libraries : []) {
        const title = String(lib?.title || '').trim();
        const type = String(lib?.type || '').trim().toLowerCase();
        if (!title) continue;
        if (type === 'show' || type === 'tv' || type === 'series') tv_library.push(title);
        else if (type === 'movie') movie_library.push(title);
        else skipped.push(title);
    }
    return {
        tv_library,
        movie_library,
        skipped,
        librarySource: 'all-sections',
    };
};

const asCreatorWhitelist = (value) => {
    const seen = new Set();
    const out = [];
    for (const raw of asLibraryList(value)) {
        const user = String(raw || '').trim().replace(/^@+/, '');
        if (!user || !/^[A-Za-z0-9._-]{1,64}$/.test(user)) continue;
        const key = user.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(user);
        if (out.length >= 40) break;
    }
    return out;
};

const asFilterList = (value) => {
    const allowed = new Set(['title_card', 'background', 'season_cover', 'show_cover']);
    return asLibraryList(value).filter((item) => allowed.has(item));
};

const asDupePreference = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'mediux' || raw === 'mediaux') return 'mediux';
    return 'posterdb';
};

const APPLY_DESTINATIONS = new Set(['plex', 'local', 'plex_local', 'jellyfin', 'emby']);

export const asWarmMedia = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'movie' || raw === 'show') return raw;
    if (raw === 'tv' || raw === 'series') return 'show';
    return 'all';
};

export const isPosterSetsTpdbEnabled = (config = {}) => config?.tpdbEnabled !== false;

export const isPosterSetsTpdbSearchEnabled = (config = {}) => (
    isPosterSetsTpdbEnabled(config) && config?.tpdbSearchEnabled !== false
);

export const isPosterSetsMediuxEnabled = (config = {}) => config?.mediuxEnabled !== false;

/** Enabled catalog providers for search/Browse (`posterdb` / `mediux`). */
export const enabledPosterSetsProviders = (config = {}) => {
    const out = [];
    if (isPosterSetsMediuxEnabled(config)) out.push('mediux');
    if (isPosterSetsTpdbSearchEnabled(config)) out.push('posterdb');
    return out;
};

/** Coerce a requested search provider to what settings still allow, or null. */
export const resolvePosterSetsSearchProvider = (config = {}, requested = 'both') => {
    const tpdb = isPosterSetsTpdbSearchEnabled(config);
    const mediux = isPosterSetsMediuxEnabled(config);
    const raw = String(requested || 'both').trim().toLowerCase();
    const want = (raw === 'posterdb' || raw === 'tpdb' || raw === 'theposterdb')
        ? 'posterdb'
        : raw === 'mediux'
            ? 'mediux'
            : 'both';
    if (want === 'posterdb') return tpdb ? 'posterdb' : null;
    if (want === 'mediux') return mediux ? 'mediux' : null;
    if (tpdb && mediux) return 'both';
    if (tpdb) return 'posterdb';
    if (mediux) return 'mediux';
    return null;
};

export const posterSetsWatchProviderAllowed = (config = {}, watch = {}) => {
    const provider = String(watch?.provider || '').toLowerCase();
    const url = String(watch?.url || '');
    const isTpdb = provider === 'posterdb' || provider === 'tpdb' || provider === 'theposterdb'
        || /theposterdb\.com/i.test(url);
    const isMediux = provider === 'mediux' || /mediux\.pro/i.test(url);
    if (isTpdb && !isPosterSetsTpdbEnabled(config)) return false;
    if (isMediux && !isPosterSetsMediuxEnabled(config)) return false;
    return true;
};

/** Whether a movie/show title is in the current library cache media scope. */
export const warmMediaAllows = (wanted, mediaType) => {
    const want = asWarmMedia(wanted);
    if (want === 'all') return true;
    const raw = String(mediaType || '').trim().toLowerCase();
    const type = (raw === 'show' || raw === 'tv' || raw === 'series') ? 'show' : 'movie';
    return want === type;
};

const asWarmSource = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'recent') return 'recent';
    return 'full';
};

const asApplyDestination = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (APPLY_DESTINATIONS.has(raw)) return raw;
    if (raw === 'both' || raw === 'plex+local' || raw === 'plex_and_local') return 'plex_local';
    return DEFAULT_POSTER_SETS_CONFIG.applyDestination;
};

const loadPortalConfigFile = async () => {
    try {
        const raw = await fs.readFile(path.join(CONFIG_DIR, 'config.json'), 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
};

/**
 * Fill empty Poster Sets Plex URL/token from Settings → Media Player.
 * Feature-local values still win when set (advanced override).
 */
export const withPortalPlexCredentials = (config = {}, portal = {}) => {
    const mediaType = String(portal?.mediaServerType || 'plex').toLowerCase();
    let portalUrl = '';
    let portalToken = '';
    if (mediaType === 'plex') {
        portalUrl = String(portal?.plexServerUrl || process.env.PLEX_SERVER_URL || '')
            .trim()
            .replace(/\/+$/, '');
        portalToken = String(portal?.plexToken || '').trim();
    }
    const ownUrl = String(config?.base_url || '').trim();
    const ownToken = String(config?.token || '').trim();
    const base_url = ownUrl || (portalUrl ? `${portalUrl}/` : '');
    const token = ownToken || portalToken;
    return {
        ...config,
        base_url,
        token,
        usingPortalPlex: Boolean((!ownUrl && portalUrl) || (!ownToken && portalToken)),
        portalPlexAvailable: Boolean(portalUrl && portalToken),
    };
};

export const normalizePosterSetsConfig = (input = {}) => {
    const filters = asFilterList(input.mediux_filters);
    const resetOverlay = input.reset_overlay;
    const watchersEnabled = input.watchersEnabled ?? input.watchers_enabled;
    const autoWatchOnApply = input.autoWatchOnApply ?? input.auto_watch_on_apply;
    const notifyOnWatcherDigest = input.notifyOnWatcherDigest ?? input.notify_on_watcher_digest;
    const arrWatchHookEnabled = input.arrWatchHookEnabled ?? input.arr_watch_hook_enabled;
    const intervalRaw = Number(input.watchIntervalHours ?? input.watch_interval_hours);
    return {
        base_url: String(input.base_url || '').trim(),
        token: String(input.token || '').trim(),
        bulk_txt: String(input.bulk_txt || 'bulk_import.txt').trim() || 'bulk_import.txt',
        tv_library: asLibraryList(input.tv_library),
        movie_library: asLibraryList(input.movie_library),
        mediux_filters: filters.length
            ? filters
            : [...DEFAULT_POSTER_SETS_CONFIG.mediux_filters],
        reset_overlay: resetOverlay === undefined ? true : !!resetOverlay,
        dupePreference: asDupePreference(input.dupePreference ?? input.dupe_preference),
        watchersEnabled: watchersEnabled === undefined ? true : !!watchersEnabled,
        watchIntervalHours: Number.isFinite(intervalRaw)
            ? Math.max(1, Math.min(168, Math.round(intervalRaw)))
            : DEFAULT_POSTER_SETS_CONFIG.watchIntervalHours,
        autoWatchOnApply: autoWatchOnApply === undefined ? true : !!autoWatchOnApply,
        notifyOnWatcherDigest: notifyOnWatcherDigest === undefined ? true : !!notifyOnWatcherDigest,
        arrWatchHookEnabled: arrWatchHookEnabled === undefined ? true : !!arrWatchHookEnabled,
        creatorWhitelist: asCreatorWhitelist(input.creatorWhitelist ?? input.creator_whitelist),
        creatorBlocklist: asCreatorWhitelist(input.creatorBlocklist ?? input.creator_blocklist),
        applyDestination: asApplyDestination(input.applyDestination ?? input.apply_destination),
        tpdb_username: String(input.tpdb_username || input.tpdb_login || '').trim(),
        tpdb_password: String(input.tpdb_password || '').trim(),
        tpdbLocalCacheEnabled: (input.tpdbLocalCacheEnabled ?? input.tpdb_local_cache_enabled) === undefined
            ? false
            : Boolean(input.tpdbLocalCacheEnabled ?? input.tpdb_local_cache_enabled),
        tpdbAggressivePrefetch: (input.tpdbAggressivePrefetch ?? input.tpdb_aggressive_prefetch) === undefined
            ? false
            : Boolean(input.tpdbAggressivePrefetch ?? input.tpdb_aggressive_prefetch),
        tpdbWarmParallelWorkers: (input.tpdbWarmParallelWorkers ?? input.tpdb_warm_parallel_workers) === undefined
            ? false
            : Boolean(input.tpdbWarmParallelWorkers ?? input.tpdb_warm_parallel_workers),
        tpdbPrioritizeFollowedCreators: (input.tpdbPrioritizeFollowedCreators ?? input.tpdb_prioritize_followed_creators) === undefined
            ? true
            : Boolean(input.tpdbPrioritizeFollowedCreators ?? input.tpdb_prioritize_followed_creators),
        tpdbCacheFollowedCreatorsOnly: (input.tpdbCacheFollowedCreatorsOnly ?? input.tpdb_cache_followed_creators_only) === undefined
            ? false
            : Boolean(input.tpdbCacheFollowedCreatorsOnly ?? input.tpdb_cache_followed_creators_only),
        tpdbUseLogin: (input.tpdbUseLogin ?? input.tpdb_use_login) === undefined
            ? true
            : Boolean(input.tpdbUseLogin ?? input.tpdb_use_login),
        tpdbEnabled: (input.tpdbEnabled ?? input.tpdb_enabled) === undefined
            ? true
            : Boolean(input.tpdbEnabled ?? input.tpdb_enabled),
        tpdbSearchEnabled: (input.tpdbSearchEnabled ?? input.tpdb_search_enabled) === undefined
            ? true
            : Boolean(input.tpdbSearchEnabled ?? input.tpdb_search_enabled),
        copyLibraryTitleEnabled: (input.copyLibraryTitleEnabled ?? input.copy_library_title_enabled) === undefined
            ? true
            : Boolean(input.copyLibraryTitleEnabled ?? input.copy_library_title_enabled),
        mediuxEnabled: (input.mediuxEnabled ?? input.mediux_enabled) === undefined
            ? true
            : Boolean(input.mediuxEnabled ?? input.mediux_enabled),
        tpdbCacheMaxBytes: (() => {
            const raw = Number(input.tpdbCacheMaxBytes ?? input.tpdb_cache_max_bytes);
            if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_POSTER_SETS_CONFIG.tpdbCacheMaxBytes;
            // 256 MB floor … 512 GB ceiling
            return Math.max(256 * 1024 * 1024, Math.min(512 * 1024 * 1024 * 1024, Math.round(raw)));
        })(),
        tpdbCacheRefreshHour: (() => {
            const raw = Number(input.tpdbCacheRefreshHour ?? input.tpdb_cache_refresh_hour);
            if (!Number.isFinite(raw)) return DEFAULT_POSTER_SETS_CONFIG.tpdbCacheRefreshHour;
            return Math.max(0, Math.min(23, Math.round(raw)));
        })(),
        tpdbCacheRefreshIntervalHours: (() => {
            const raw = Number(input.tpdbCacheRefreshIntervalHours ?? input.tpdb_cache_refresh_interval_hours);
            if (!Number.isFinite(raw) || raw <= 0) return 0;
            return Math.max(0, Math.min(24, Math.round(raw)));
        })(),
        tpdbCacheWarmMedia: asWarmMedia(input.tpdbCacheWarmMedia ?? input.tpdb_cache_warm_media),
        tpdbCacheWarmSource: asWarmSource(input.tpdbCacheWarmSource ?? input.tpdb_cache_warm_source),
        tpdbCacheSkipCached: (input.tpdbCacheSkipCached ?? input.tpdb_cache_skip_cached) === undefined
            ? true
            : Boolean(input.tpdbCacheSkipCached ?? input.tpdb_cache_skip_cached),
        tpdbCacheOnLibraryAdd: (input.tpdbCacheOnLibraryAdd ?? input.tpdb_cache_on_library_add) === undefined
            ? true
            : Boolean(input.tpdbCacheOnLibraryAdd ?? input.tpdb_cache_on_library_add),
        tpdbFirstRunBackfillDone: (input.tpdbFirstRunBackfillDone ?? input.tpdb_first_run_backfill_done) === true,
        webhookToken: String(input.webhookToken ?? input.webhook_token ?? '').trim(),
    };
};

export const maskPosterSetsConfig = (config, portal = null) => {
    const stored = normalizePosterSetsConfig(config);
    const effective = portal
        ? withPortalPlexCredentials(stored, portal)
        : withPortalPlexCredentials(stored, {});
    const hasOwnToken = Boolean(stored.token);
    const hasEffectiveToken = Boolean(effective.token);
    const hasTpdbPassword = Boolean(stored.tpdb_password);
    return {
        ...stored,
        // Keep stored URL/token for the form; expose effective connection separately.
        token: hasOwnToken ? '********' : '',
        tpdb_password: hasTpdbPassword ? '********' : '',
        hasToken: hasEffectiveToken,
        hasTpdbPassword,
        configured: Boolean(effective.base_url && effective.token),
        usingPortalPlex: Boolean(effective.usingPortalPlex),
        portalPlexAvailable: Boolean(effective.portalPlexAvailable),
        effective_base_url: effective.base_url || '',
    };
};

export const ensurePosterSetsDir = async () => {
    await fs.mkdir(POSTER_SETS_DIR, { recursive: true });
};

const isJsonReadError = (error) => (
    error instanceof SyntaxError || /JSON/i.test(String(error?.message || ''))
);

/** Move an empty or truncated JSON file aside and let the caller start fresh. */
export const readPosterSetsJson = async (filePath, label) => {
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        if (!String(raw || '').trim()) {
            await quarantinePosterSetsJson(filePath, label, 'empty file');
            return null;
        }
        return JSON.parse(raw);
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        if (!isJsonReadError(error)) throw error;
        await quarantinePosterSetsJson(filePath, label, error?.message || 'invalid json');
        return null;
    }
};

export const writePosterSetsJson = async (filePath, value) => {
    const body = `${JSON.stringify(value, null, 2)}\n`;
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, body, 'utf8');
    try {
        await fs.rename(tempPath, filePath);
    } catch {
        await fs.writeFile(filePath, body, 'utf8');
        await fs.unlink(tempPath).catch(() => {});
    }
};

const quarantinePosterSetsJson = async (filePath, label, reason) => {
    try {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = `${filePath}.corrupt-${stamp}`;
        await fs.rename(filePath, backupPath);
        console.warn(`[poster-sets] reset corrupt ${label} file (${reason}) → ${backupPath}`);
    } catch {
        try {
            await fs.unlink(filePath);
        } catch {
            /* ignore */
        }
    }
};

export const loadPosterSetsConfig = async ({ includePortalPlex = true } = {}) => {
    await ensurePosterSetsDir();
    const parsed = await readPosterSetsJson(POSTER_SETS_CONFIG_PATH, 'config');
    const normalized = normalizePosterSetsConfig(
        parsed && typeof parsed === 'object' ? parsed : DEFAULT_POSTER_SETS_CONFIG,
    );
    if (!includePortalPlex) return normalized;
    const portal = await loadPortalConfigFile();
    return withPortalPlexCredentials(normalized, portal);
};

export const savePosterSetsConfig = async (input = {}, {
    keepExistingToken = true,
    clearPlexCredentials = false,
} = {}) => {
    const existing = await loadPosterSetsConfig({ includePortalPlex: false });
    const incoming = input && typeof input === 'object' ? input : {};
    let token = String(incoming.token || '').trim();
    if (clearPlexCredentials) {
        token = '';
        incoming.base_url = '';
    } else if ((!token || token === '********') && keepExistingToken) {
        token = existing.token;
    }
    let tpdbPassword = String(incoming.tpdb_password || '').trim();
    if ((!tpdbPassword || tpdbPassword === '********') && keepExistingToken) {
        tpdbPassword = existing.tpdb_password;
    }
    if (tpdbPassword === '********') tpdbPassword = '';
    let webhookToken = String(incoming.webhookToken ?? incoming.webhook_token ?? '').trim();
    if ((!webhookToken || webhookToken === '********') && keepExistingToken) {
        webhookToken = existing.webhookToken || '';
    }
    if (webhookToken === '********') webhookToken = '';
    if (incoming.rotateWebhookToken === true || incoming.rotate_webhook_token === true) {
        webhookToken = generatePosterSetsWebhookToken();
    }
    // Auto-mint a webhook token the first time on-add caching is enabled.
    const onLibraryAdd = (incoming.tpdbCacheOnLibraryAdd ?? incoming.tpdb_cache_on_library_add);
    const cacheEnabled = (incoming.tpdbLocalCacheEnabled ?? incoming.tpdb_local_cache_enabled);
    const wantsOnAdd = onLibraryAdd === undefined
        ? existing.tpdbCacheOnLibraryAdd !== false
        : Boolean(onLibraryAdd);
    const wantsCache = cacheEnabled === undefined
        ? existing.tpdbLocalCacheEnabled === true
        : Boolean(cacheEnabled);
    if (wantsCache && wantsOnAdd && !webhookToken) {
        webhookToken = generatePosterSetsWebhookToken();
    }
    const next = normalizePosterSetsConfig({
        ...existing,
        ...incoming,
        token,
        tpdb_password: tpdbPassword,
        webhookToken,
    });
    await ensurePosterSetsDir();
    await writePosterSetsJson(POSTER_SETS_CONFIG_PATH, next);
    return next;
};

export const resolveBulkFilePath = (config) => {
    const name = String(config?.bulk_txt || 'bulk_import.txt').trim() || 'bulk_import.txt';
    const safe = path.basename(name);
    return path.join(POSTER_SETS_DIR, safe);
};
