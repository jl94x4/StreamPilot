import { isRequestAppConfigured, isSeerrFamilyRequestApp } from './request-app-service.js';

export const DISCOVER_REGIONS = [
    { code: '', name: 'All Regions' },
    { code: 'US', name: 'United States' },
    { code: 'GB', name: 'United Kingdom' },
    { code: 'CA', name: 'Canada' },
    { code: 'AU', name: 'Australia' },
    { code: 'NZ', name: 'New Zealand' },
    { code: 'IE', name: 'Ireland' },
    { code: 'DE', name: 'Germany' },
    { code: 'FR', name: 'France' },
    { code: 'ES', name: 'Spain' },
    { code: 'IT', name: 'Italy' },
    { code: 'NL', name: 'Netherlands' },
    { code: 'BE', name: 'Belgium' },
    { code: 'SE', name: 'Sweden' },
    { code: 'NO', name: 'Norway' },
    { code: 'DK', name: 'Denmark' },
    { code: 'FI', name: 'Finland' },
    { code: 'PL', name: 'Poland' },
    { code: 'PT', name: 'Portugal' },
    { code: 'AT', name: 'Austria' },
    { code: 'CH', name: 'Switzerland' },
    { code: 'JP', name: 'Japan' },
    { code: 'KR', name: 'South Korea' },
    { code: 'IN', name: 'India' },
    { code: 'BR', name: 'Brazil' },
    { code: 'MX', name: 'Mexico' },
    { code: 'ZA', name: 'South Africa' },
];

export const DISCOVER_LANGUAGES = [
    { code: '', name: 'All Languages' },
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'it', name: 'Italian' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' },
    { code: 'zh', name: 'Chinese' },
    { code: 'hi', name: 'Hindi' },
    { code: 'ar', name: 'Arabic' },
    { code: 'ru', name: 'Russian' },
    { code: 'nl', name: 'Dutch' },
    { code: 'sv', name: 'Swedish' },
    { code: 'no', name: 'Norwegian' },
    { code: 'da', name: 'Danish' },
    { code: 'fi', name: 'Finnish' },
    { code: 'pl', name: 'Polish' },
    { code: 'tr', name: 'Turkish' },
];

const VALID_REGION_CODES = new Set(DISCOVER_REGIONS.map((entry) => entry.code));
const VALID_LANGUAGE_CODES = new Set(DISCOVER_LANGUAGES.map((entry) => entry.code));

export const normalizeDiscoverRegion = (value) => {
    const code = String(value || '').trim().toUpperCase();
    if (!code) return '';
    return VALID_REGION_CODES.has(code) ? code : '';
};

export const normalizeDiscoverLanguage = (value) => {
    const code = String(value || '').trim().toLowerCase();
    if (!code) return '';
    return VALID_LANGUAGE_CODES.has(code) ? code : '';
};

/** Discover metadata source. Default TMDB; Seerr remains an optional rollback. */
export const normalizeDiscoverySource = (value) => {
    const source = String(value || '').trim().toLowerCase();
    if (source === 'seerr') return 'seerr';
    return 'tmdb';
};

/**
 * Effective Discover metadata source.
 * Prefers TMDB when selected and a key is set; falls back to Seerr when
 * Seerr is selected or TMDB has no key (so Discover can still work via Seerr).
 */
export const getDiscoverySource = (config = {}) => {
    const raw = String(config.discoverySource || '').trim().toLowerCase();
    const preferTmdb = raw !== 'seerr';
    if (preferTmdb && String(config.tmdbApiKey || '').trim()) return 'tmdb';
    return 'seerr';
};

/** Request engine. Default portal; Seerr remains optional dual-run. */
export const normalizeRequestEngine = (value) => {
    const engine = String(value || '').trim().toLowerCase();
    if (engine === 'seerr') return 'seerr';
    return 'portal';
};

/** Member request persistence engine. */
export const getRequestEngine = (config = {}) => normalizeRequestEngine(config.requestEngine);

/** True when portal requests should unlock Discover / Requests nav. */
export const isPortalRequestNavReady = (config = {}) => getRequestEngine(config) === 'portal';

export const getDiscoveryPreferences = (config = {}) => ({
    discoverRegion: normalizeDiscoverRegion(config.requestDiscoverRegion),
    discoverLanguage: normalizeDiscoverLanguage(config.requestDiscoverLanguage),
    hideAvailableMedia: config.requestHideAvailableMedia === true,
    discoverySource: getDiscoverySource(config),
    requestEngine: getRequestEngine(config),
    /** Default TMDB metadata language when the client does not send a locale header. */
    tmdbLanguage: 'en',
    showRecentlyAdded: config.portalShowRecentlyAdded !== false,
    showWatchlist: config.portalShowWatchlist !== false,
    /** Admin master switch for Discover hero Now Playing strip. */
    nowPlayingEnabled: config.discoverNowPlayingEnabled !== false,
});

const DISCOVER_METADATA_LOCALES = new Set(['en', 'fr', 'de', 'es', 'pt-br', 'it', 'ja', 'pl', 'nl', 'ru']);

/** Normalize portal UI locale → TMDB/Seerr metadata language (en/fr/de/es). */
export const normalizeDiscoverMetadataLanguage = (value) => {
    const code = String(value || '').trim().toLowerCase().replace(/_/g, '-');
    if (code === 'pt-br') return 'pt-BR';
    const base = code.split('-')[0];
    return DISCOVER_METADATA_LOCALES.has(base) ? base : 'en';
};

export const resolveDiscoverMetadataLanguage = (req) => {
    const header = req?.get?.('X-Portal-Discover-Locale')
        || req?.headers?.['x-portal-discover-locale']
        || req?.query?.locale
        || '';
    return normalizeDiscoverMetadataLanguage(header);
};

export const isMediaAvailableInLibrary = (item = {}) => {
    const raw = item?.mediaInfo?.status ?? item?.media?.status;
    const status = Number(raw);
    if (status === 5) return true;
    if (status === 4) {
        const mediaType = item?.mediaType ?? item?.media?.mediaType ?? item?.type;
        const isTv = mediaType === 'tv' || mediaType === 2 || mediaType === '2';
        if (isTv) return false;
        return true;
    }

    const mediaInfo = item?.mediaInfo;
    if (mediaInfo && Number(mediaInfo.id) > 0 && !Number.isFinite(status)) {
        const downloadStatus = Array.isArray(mediaInfo.downloadStatus) ? mediaInfo.downloadStatus : [];
        if (downloadStatus.some((entry) => Number(entry?.status) === 5)) return true;
    }
    return false;
};

export const shouldHideAvailableMediaItem = (item = {}) => {
    const status = Number(item?.mediaInfo?.status ?? item?.media?.status);
    const mediaType = item?.mediaType ?? item?.media?.mediaType ?? item?.type;
    const isMovie = mediaType === 'movie' || mediaType === 1 || mediaType === '1';
    const isTv = mediaType === 'tv' || mediaType === 2 || mediaType === '2';

    if (isMovie) return status === 5 || status === 4;

    if (isTv) {
        if (status === 4 || status === 5) return true;
        const librarySeasons = Array.isArray(item?.mediaInfo?.seasons) ? item.mediaInfo.seasons : [];
        if (librarySeasons.length > 0) {
            const regular = librarySeasons.filter((s) => Number(s?.seasonNumber) >= 0);
            if (regular.some((s) => {
                const seasonStatus = Number(s?.status);
                return seasonStatus === 5 || seasonStatus === 4;
            })) {
                return true;
            }
        }
        return false;
    }

    return status === 5 || status === 4;
};

export const filterAvailableMedia = (items) => {
    if (!Array.isArray(items)) return items;
    return items.filter((item) => !shouldHideAvailableMediaItem(item));
};

export const getItemOriginalLanguage = (item = {}) => {
    const raw = item?.originalLanguage ?? item?.original_language ?? '';
    return String(raw || '').trim().toLowerCase().split(/[-_]/)[0];
};

export const filterByDiscoverLanguage = (items, language) => {
    const code = normalizeDiscoverLanguage(language);
    if (!code || !Array.isArray(items)) return items;
    return items.filter((item) => {
        const itemLang = getItemOriginalLanguage(item);
        // Keep items with unknown language rather than wiping sparse payloads.
        if (!itemLang) return true;
        return itemLang === code;
    });
};

export const isDiscoverySearchPath = (path = '') => (
    /^\/search(\/|\?|$)/i.test(String(path))
);

export const isDiscoverBrowsePath = (path = '') => {
    const normalized = String(path || '').split('?')[0];
    if (isDiscoverySearchPath(normalized)) return false;
    if (/^\/discover\/genreslider\//i.test(normalized)) return false;
    if (/^\/discover\//i.test(normalized)) return true;
    if (/^\/media(\/|$)/i.test(normalized)) return true;
    if (/^\/(movie|tv)\/\d+\/recommendations$/i.test(normalized)) return true;
    return false;
};

/** Browse lists where Discover Language should restrict original language. */
export const shouldApplyDiscoverLanguageFilter = (path = '') => {
    const normalized = String(path || '').split('?')[0];
    if (!isDiscoverBrowsePath(normalized)) return false;
    // Library shelves are already in the user's collection — don't language-strip them.
    if (/^\/media(\/|$)/i.test(normalized)) return false;
    return true;
};

/** Paths members may reach via /api/discovery/proxy/* (Seerr admin key). Deny by default. */
const DISCOVERY_PROXY_ALLOWED_PATHS = [
    /^\/discover(?:\/|$)/i,
    /^\/movie\/\d+(?:\/recommendations)?$/i,
    /^\/tv\/\d+(?:\/recommendations|\/season\/\d+)?$/i,
    /^\/person\/\d+(?:\/combined_credits)?$/i,
    /^\/media$/i,
    /^\/search(?:\/keyword|\/company)?$/i,
    /^\/watchproviders\/(?:movies|tv)$/i,
];

export const normalizeDiscoveryProxyPath = (rawPath = '') => {
    let path = String(rawPath || '').split('?')[0];
    try {
        path = decodeURIComponent(path);
    } catch {
        return null;
    }
    path = path.replace(/\\/g, '/').replace(/\/+/g, '/');
    if (!path.startsWith('/')) path = `/${path}`;
    if (path.includes('..') || path.includes('\0') || path.includes('%00')) return null;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return path;
};

export const isAllowedDiscoveryProxyPath = (rawPath = '') => {
    const path = normalizeDiscoveryProxyPath(rawPath);
    if (!path) return false;
    return DISCOVERY_PROXY_ALLOWED_PATHS.some((pattern) => pattern.test(path));
};

/** Seerr-sidecar proxy timeout budget by path (ms). */
export const discoverySeerrProxyTimeoutMs = (rawPath = '') => {
    const path = String(rawPath || '').split('?')[0];
    if (/^\/discover\/genreslider\//i.test(path)) return 90_000;
    if (/^\/(movie|tv)\/\d+(?:\/season\/\d+)?$/i.test(path)) return 60_000;
    if (/^\/discover\//i.test(path)) return 60_000;
    if (/^\/search/i.test(path)) return 45_000;
    if (/^\/person\//i.test(path)) return 45_000;
    return 30_000;
};

/** TMDB direct Discover proxy uses the same tiered budgets as Seerr. */
export const discoveryTmdbProxyTimeoutMs = discoverySeerrProxyTimeoutMs;

export const filterDiscoveryPayload = (data, path, hideAvailable, discoverLanguage = '') => {
    if (!data || typeof data !== 'object') {
        return data;
    }
    const applyHide = hideAvailable && isDiscoverBrowsePath(path);
    const applyLang = discoverLanguage && shouldApplyDiscoverLanguageFilter(path);
    if (!applyHide && !applyLang) {
        return data;
    }

    const filterList = (items) => {
        let next = items;
        if (applyHide) next = filterAvailableMedia(next);
        if (applyLang) next = filterByDiscoverLanguage(next, discoverLanguage);
        return next;
    };

    if (Array.isArray(data.results)) {
        return { ...data, results: filterList(data.results) };
    }
    if (Array.isArray(data)) {
        return filterList(data);
    }
    return data;
};

export const applyDiscoveryQueryParams = (searchParams, path, prefs = {}, metadataLanguage = 'en') => {
    const params = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(searchParams);
    const normalizedPath = String(path || '').split('?')[0];
    const metaLang = normalizeDiscoverMetadataLanguage(metadataLanguage || prefs.tmdbLanguage || 'en');

    // Drop client-only markers so Seerr/TMDB never treat them as filters.
    const allLanguages = params.get('allLanguages') === '1';
    params.delete('allLanguages');
    params.delete('locale');

    // Seerr discover movie/TV list routes map query.language → originalLanguage filter,
    // while req.locale (Accept-Language) drives TMDB metadata language.
    const usesLanguageAsOriginalFilter = (
        /^\/discover\/movies(?:\/|$)/i.test(normalizedPath)
        || /^\/discover\/tv(?:\/|$)/i.test(normalizedPath)
    ) && !/\/language\//i.test(normalizedPath);

    if (usesLanguageAsOriginalFilter) {
        if (allLanguages) {
            // Explicit escape hatch only — Discover home uses Discover Language like Seerr.
            params.delete('language');
        } else if (prefs.discoverLanguage && !params.has('language')) {
            params.set('language', prefs.discoverLanguage);
        }
        // Metadata comes from Accept-Language on these routes — do not overwrite filter.
    } else if (!params.has('language') && metaLang) {
        // Detail, search, trending, person, genre slider, etc. use language as TMDB locale.
        params.set('language', metaLang);
    }

    // Discover region is applied via Seerr main settings (discoverRegion / streamingRegion),
    // not as a request query param — "region" is not a valid Seerr discover filter.
    return params;
};

let lastSeerrDiscoverySyncKey = '';

export const ensureSeerrDiscoverySettings = async (config, rawFetch) => {
    const prefs = getDiscoveryPreferences(config);
    const syncKey = `${prefs.discoverRegion}|${prefs.discoverLanguage}|${prefs.hideAvailableMedia}`;
    if (syncKey === lastSeerrDiscoverySyncKey) {
        return { ok: true, skipped: true, reason: 'unchanged' };
    }
    const result = await syncSeerrDiscoverySettings(config, rawFetch);
    if (result.ok) {
        lastSeerrDiscoverySyncKey = syncKey;
    }
    return result;
};

export const syncSeerrDiscoverySettings = async (config, rawFetch) => {
    if (!isRequestAppConfigured(config) || !isSeerrFamilyRequestApp(config.requestAppType)) {
        return { ok: false, skipped: true, reason: 'not_configured' };
    }
    const prefs = getDiscoveryPreferences(config);
    try {
        await rawFetch(config, '/api/v1/settings/main', {
            method: 'POST',
            body: {
                discoverRegion: prefs.discoverRegion || '',
                streamingRegion: prefs.discoverRegion || '',
                originalLanguage: prefs.discoverLanguage || '',
                hideAvailable: prefs.hideAvailableMedia,
            },
        });
        lastSeerrDiscoverySyncKey = `${prefs.discoverRegion}|${prefs.discoverLanguage}|${prefs.hideAvailableMedia}`;
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error?.message || 'Failed to sync discovery settings to request app' };
    }
};
