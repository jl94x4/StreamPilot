/**
 * File-backed discovery availability cache (library badges for Discover browse).
 * Rebuilt by a background task from Sonarr/Radarr catalogs; pending requests stay per-user.
 */

const CACHE_VERSION = 4;
const SEERR_MEDIA_PENDING = 2;
const SEERR_MEDIA_PROCESSING = 3;
const SEERR_MEDIA_PARTIAL = 4;
const SEERR_MEDIA_AVAILABLE = 5;

/** Match Sonarr title keys written during the 12h availability snapshot. */
const normalizeTitleKey = (title = '', year = null) => {
    const cleaned = String(title || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/['\u2018\u2019\u0060]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
    const y = Number(year);
    return Number.isFinite(y) && y > 1900 ? `${cleaned}|${y}` : cleaned;
};

export const emptyDiscoveryAvailabilityCache = () => ({
    version: CACHE_VERSION,
    generatedAt: null,
    itemCount: 0,
    movieCount: 0,
    tvCount: 0,
    musicCount: 0,
    byKey: {},
});

export const normalizeDiscoveryAvailabilityCache = (raw = null) => {
    const base = emptyDiscoveryAvailabilityCache();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
    const byKey = raw.byKey && typeof raw.byKey === 'object' && !Array.isArray(raw.byKey)
        ? raw.byKey
        : {};
    // Missing/invalid version must stay 0 so boot can force a v2 Partial rescan.
    const parsedVersion = raw.version == null || raw.version === ''
        ? 0
        : Number(raw.version);
    return {
        version: Number.isFinite(parsedVersion) ? parsedVersion : 0,
        generatedAt: raw.generatedAt ? String(raw.generatedAt) : null,
        itemCount: Number(raw.itemCount) || Object.keys(byKey).length,
        movieCount: Number(raw.movieCount) || 0,
        tvCount: Number(raw.tvCount) || 0,
        musicCount: Number(raw.musicCount) || 0,
        byKey,
    };
};

export const getDiscoveryAvailabilityCacheVersion = () => CACHE_VERSION;

export const availabilityCacheKey = (mediaType, mediaId) => {
    const type = String(mediaType || '').toLowerCase();
    if (type === 'music') {
        const mbid = String(mediaId || '').trim();
        return mbid ? `music:${mbid}` : null;
    }
    const normalized = type === 'tv' ? 'tv' : (type === 'movie' ? 'movie' : null);
    const id = Number(mediaId);
    if (!normalized || !Number.isFinite(id) || id <= 0) return null;
    return `${normalized}:${id}`;
};

export const lookupDiscoveryAvailability = (cache, mediaType, mediaId) => {
    const key = availabilityCacheKey(mediaType, mediaId);
    if (!key) return null;
    const entry = cache?.byKey?.[key];
    return entry && typeof entry === 'object' ? entry : null;
};

const resolveItemMediaType = (item = {}) => {
    const raw = item?.mediaType ?? item?.media?.mediaType ?? item?.type ?? item?.media_type;
    if (raw === 'music') return 'music';
    if (raw === 'movie' || raw === 1 || raw === '1') return 'movie';
    if (raw === 'tv' || raw === 2 || raw === '2') return 'tv';
    if (item?.firstAirDate || item?.first_air_date) {
        if (!(item?.releaseDate || item?.release_date)) return 'tv';
    }
    if (item?.releaseDate || item?.release_date) {
        if (!(item?.firstAirDate || item?.first_air_date)) return 'movie';
    }
    return null;
};

const resolveItemMbid = (item = {}) => {
    const mbid = String(item?.mbid ?? item?.foreignArtistId ?? '').trim();
    return mbid || null;
};

const resolveItemTmdbId = (item = {}) => {
    const id = Number(item?.tmdbId ?? item?.id);
    return Number.isFinite(id) && id > 0 ? id : null;
};

const resolveItemYear = (item = {}, mediaType = null) => {
    const type = mediaType || resolveItemMediaType(item);
    const date = type === 'tv'
        ? (item?.firstAirDate || item?.first_air_date || '')
        : (item?.releaseDate || item?.release_date || '');
    const year = Number(String(date).slice(0, 4)) || Number(item?.year) || null;
    return Number.isFinite(year) && year > 1900 ? year : null;
};

const lookupByTitle = (cache, mediaType, item = {}) => {
    const byKey = cache?.byKey;
    if (!byKey || typeof byKey !== 'object') return null;
    if (mediaType === 'tv') {
        const title = item?.name || item?.title || item?.originalName || item?.original_name || '';
        const year = resolveItemYear(item, 'tv');
        const withYear = normalizeTitleKey(title, year);
        const noYear = normalizeTitleKey(title, null);
        return (withYear && byKey[`tvTitle:${withYear}`])
            || (noYear && byKey[`tvTitle:${noYear}`])
            || null;
    }
    if (mediaType === 'movie') {
        const title = item?.title || item?.originalTitle || item?.original_title || '';
        const year = resolveItemYear(item, 'movie');
        const withYear = normalizeTitleKey(title, year);
        return (withYear && byKey[`movieTitle:${withYear}`]) || null;
    }
    return null;
};

/** Resolve cache entry by TMDB id, then title/year (Sonarr often lacks tmdbId). */
export const lookupDiscoveryAvailabilityForItem = (cache, item = {}) => {
    const mediaType = resolveItemMediaType(item);
    if (mediaType === 'music') {
        const mbid = resolveItemMbid(item);
        const entry = mbid ? lookupDiscoveryAvailability(cache, 'music', mbid) : null;
        return entry && typeof entry === 'object' ? entry : null;
    }
    const tmdbId = resolveItemTmdbId(item);
    let entry = (mediaType && tmdbId) ? lookupDiscoveryAvailability(cache, mediaType, tmdbId) : null;
    if (!entry && mediaType) entry = lookupByTitle(cache, mediaType, item);
    return entry && typeof entry === 'object' ? entry : null;
};

/**
 * Catalog snapshots already stamp PARTIAL/AVAILABLE from Sonarr file stats.
 * Only adjust continuing shows that must not stay AVAILABLE while nextAiring is set.
 * Never null out library stamps — browse rows omit seasons[] and that wiped Popular Series badges.
 */
const coerceTvPartialEntry = (entry) => {
    if (!entry?.mediaInfo) return entry;
    const mediaType = entry.mediaInfo.mediaType || 'tv';
    if (mediaType !== 'tv') return entry;
    const sonarr = entry.sonarrLibraryStatus;
    const status = Number(entry.mediaInfo.status);
    const episodeFiles = Number(sonarr?.fileCount ?? sonarr?.episodeFileCount) || 0;
    const hasOnDisk = episodeFiles > 0 || Boolean(sonarr?.showComplete)
        || (sonarr?.seasons || []).some((s) => (Number(s?.airedTotal) || 0) > 0 || (Number(s?.withFile) || 0) > 0);

    // Continuing show: AVAILABLE + scheduled episode → Partial.
    if (status === SEERR_MEDIA_AVAILABLE && sonarr?.nextAiring) {
        return {
            ...entry,
            mediaInfo: {
                ...entry.mediaInfo,
                status: SEERR_MEDIA_PARTIAL,
            },
            sonarrLibraryStatus: {
                ...sonarr,
                showComplete: false,
            },
        };
    }

    // Ended complete libraries may still carry PARTIAL from an older snapshot.
    if (
        status === SEERR_MEDIA_PARTIAL
        && !sonarr?.nextAiring
        && hasOnDisk
        && sonarr?.showComplete
        && !sonarr?.hasActiveDownloads
    ) {
        return {
            ...entry,
            mediaInfo: {
                ...entry.mediaInfo,
                status: SEERR_MEDIA_AVAILABLE,
            },
        };
    }

    return entry;
};

const coerceMovieAvailableEntry = (entry) => {
    if (!entry?.mediaInfo) return entry;
    const mediaType = entry.mediaInfo.mediaType || 'movie';
    if (mediaType !== 'movie') return entry;
    const status = Number(entry.mediaInfo.status);
    const radarr = entry.radarrLibraryStatus;
    if (
        (status === SEERR_MEDIA_PROCESSING || status === SEERR_MEDIA_PENDING)
        && radarr?.matched
        && radarr?.hasFile
        && !radarr?.downloading
    ) {
        return {
            ...entry,
            mediaInfo: {
                ...entry.mediaInfo,
                status: SEERR_MEDIA_AVAILABLE,
            },
        };
    }
    return entry;
};

/** Normalize stale snapshot rows before merging onto browse items. */
export const coerceAvailabilityCacheEntry = (entry) => (
    coerceMovieAvailableEntry(coerceTvPartialEntry(entry))
);

/** PROCESSING/PENDING cache rows may be stale after a download completes — live Radarr/Sonarr wins. */
export const discoveryAvailabilityCacheNeedsLiveRecheck = (entry) => {
    if (!entry?.mediaInfo) return true;
    const coerced = coerceAvailabilityCacheEntry(entry);
    const status = Number(coerced.mediaInfo?.status);
    return status === SEERR_MEDIA_PROCESSING
        || status === SEERR_MEDIA_PENDING
        || !Number.isFinite(status)
        || status <= 1;
};

/** Merge shared library cache onto a discover list item. */
export const mergeAvailabilityEntryOntoItem = (item, entry) => {
    if (!item || !entry?.mediaInfo) return item;
    const coerced = coerceAvailabilityCacheEntry(entry);
    return {
        ...item,
        mediaInfo: {
            ...(item.mediaInfo || {}),
            ...coerced.mediaInfo,
        },
        ...(coerced.sonarrLibraryStatus ? { sonarrLibraryStatus: coerced.sonarrLibraryStatus } : {}),
        ...(coerced.radarrLibraryStatus ? { radarrLibraryStatus: coerced.radarrLibraryStatus } : {}),
        ...(coerced.lidarrLibraryStatus ? { lidarrLibraryStatus: coerced.lidarrLibraryStatus } : {}),
        ...(coerced.posterUrl ? { posterPath: coerced.posterUrl, posterUrl: coerced.posterUrl } : {}),
    };
};

export const applyDiscoveryAvailabilityCacheToItems = (items, cache) => {
    if (!Array.isArray(items) || !items.length) return items;
    const byKey = cache?.byKey;
    if (!byKey || typeof byKey !== 'object') return items;
    return items.map((item) => {
        const entry = lookupDiscoveryAvailabilityForItem(cache, item);
        return entry ? mergeAvailabilityEntryOntoItem(item, entry) : item;
    });
};

/** Apply cache to common discovery JSON shapes (results / mediaInfo lists / detail objects). */
export const applyDiscoveryAvailabilityCacheToPayload = (data, cache) => {
    if (!data || typeof data !== 'object') return data;
    if (Array.isArray(data.results)) {
        return { ...data, results: applyDiscoveryAvailabilityCacheToItems(data.results, cache) };
    }
    if (Array.isArray(data.cast) || Array.isArray(data.crew)) {
        return {
            ...data,
            ...(Array.isArray(data.cast)
                ? { cast: applyDiscoveryAvailabilityCacheToItems(data.cast, cache) }
                : {}),
            ...(Array.isArray(data.crew)
                ? { crew: applyDiscoveryAvailabilityCacheToItems(data.crew, cache) }
                : {}),
        };
    }
    if (Array.isArray(data)) {
        return applyDiscoveryAvailabilityCacheToItems(data, cache);
    }
    // Movie / TV / music detail payloads are a single object with id + mediaType.
    const entry = lookupDiscoveryAvailabilityForItem(cache, data);
    return entry ? mergeAvailabilityEntryOntoItem(data, entry) : data;
};

/**
 * Rebuild the on-disk cache from live *arr catalogs.
 * @returns {{ itemCount: number, movieCount: number, tvCount: number, generatedAt: string }}
 */
export const rebuildDiscoveryAvailabilityCache = async ({
    config,
    createLibraryAvailability,
    saveFile,
    cachePath,
}) => {
    const library = createLibraryAvailability(config, {
        warmOnCreate: false,
        forceCatalogRefresh: true,
    });
    const snapshot = await library.snapshotLibraryStatuses();
    const payload = {
        version: CACHE_VERSION,
        generatedAt: new Date().toISOString(),
        itemCount: snapshot.itemCount,
        movieCount: snapshot.movieCount,
        tvCount: snapshot.tvCount,
        musicCount: snapshot.musicCount || 0,
        byKey: snapshot.byKey,
    };
    await saveFile(cachePath, payload);
    return {
        itemCount: payload.itemCount,
        movieCount: payload.movieCount,
        tvCount: payload.tvCount,
        generatedAt: payload.generatedAt,
        version: CACHE_VERSION,
    };
};

export default {
    emptyDiscoveryAvailabilityCache,
    normalizeDiscoveryAvailabilityCache,
    getDiscoveryAvailabilityCacheVersion,
    availabilityCacheKey,
    lookupDiscoveryAvailability,
    lookupDiscoveryAvailabilityForItem,
    mergeAvailabilityEntryOntoItem,
    applyDiscoveryAvailabilityCacheToItems,
    applyDiscoveryAvailabilityCacheToPayload,
    rebuildDiscoveryAvailabilityCache,
};
