/**
 * Portal library availability (Phase 3).
 * Resolves in-library / partial / downloading without Seerr mediaInfo,
 * using Radarr (movies) + Sonarr (TV) catalogs with aggressive in-memory caches.
 */

import {
    fetchArrInstanceCatalogItems,
    fetchArrQueueSummary,
    getArrInstances,
    isArrInstanceReady,
    pickLidarrArtistImage,
    lookupSonarrSeriesByTmdb,
    lookupSonarrSeriesByTvdb,
} from '../arr-service.js';
import {
    applySonarrLibraryStatusToTvDetails,
    enrichTvDetailsWithSonarrLibraryStatus,
    fetchSonarrLibraryStatusForShow,
} from '../sonarr-library-status.js';
import { filterAvailableMedia, shouldHideAvailableMediaItem } from '../discovery-settings.js';
import {
    buildSonarrSeriesIndexes,
    matchSonarrSeriesFromIndexes,
    normalizeSeriesTitleKey,
    resolveImdbIdFromTmdb,
    resolveTmdbIdFromTvdb,
    resolveTvdbIdFromTmdb,
    seriesConflictsRequestedShow,
    seriesYearFromSonarr,
} from './sonarrSeriesMatch.js';
import {
    leanRadarrMovieList,
    leanSonarrSeriesList,
    leanLidarrArtistList,
} from './leanArrCatalog.js';

const SEERR_MEDIA_UNKNOWN = 1;
const SEERR_MEDIA_PROCESSING = 3;
const SEERR_MEDIA_PARTIAL = 4;
const SEERR_MEDIA_AVAILABLE = 5;

const CATALOG_CACHE_MS = 5 * 60 * 1000;
const EMPTY_CATALOG_CACHE_MS = 30 * 1000;
const QUEUE_CACHE_MS = 45 * 1000;
const STATUS_CACHE_MS = 90 * 1000;

const movieCatalogCache = new Map(); // key → { at, byTmdb: Map, list }
const seriesCatalogCache = new Map(); // key → { at, byTmdb: Map, list }
const artistCatalogCache = new Map(); // key → { at, byMbid: Map, list }
const queueCache = new Map(); // instanceKey → { at, movieIds, seriesIds, artistIds }
const movieStatusCache = new Map(); // tmdbId → { at, value }
const MOVIE_STATUS_CACHE_MAX_ENTRIES = 500;
const pruneMovieStatusCache = () => {
    const t = now();
    for (const [key, entry] of movieStatusCache.entries()) {
        if (!entry || t - entry.at >= STATUS_CACHE_MS) movieStatusCache.delete(key);
    }
    while (movieStatusCache.size > MOVIE_STATUS_CACHE_MAX_ENTRIES) {
        const oldest = movieStatusCache.keys().next().value;
        if (oldest === undefined) break;
        movieStatusCache.delete(oldest);
    }
};
const movieCatalogInflight = new Map(); // instanceKey → Promise
const seriesCatalogInflight = new Map(); // instanceKey → Promise
const artistCatalogInflight = new Map(); // instanceKey → Promise

const now = () => Date.now();

const instanceCacheKey = (instance) => String(instance?.id || instance?.url || '');

const isCatalogFresh = (cached) => {
    if (!cached) return false;
    // Empty downloads must not stick for 5 minutes — that made the Discovery
    // Availability Cache task finish instantly with 0 badges.
    const ttl = (Array.isArray(cached.list) && cached.list.length > 0)
        ? CATALOG_CACHE_MS
        : EMPTY_CATALOG_CACHE_MS;
    return now() - cached.at < ttl;
};

/** Drop stale catalog entries so fat graphs cannot linger after reads stop. */
const dropStaleCatalog = (cache, key, cached) => {
    if (cached && !isCatalogFresh(cached)) cache.delete(key);
};

/** Sync snapshot of cached catalogs — null if any required instance is cold. */
const peekMovieCatalogIndex = (config) => {
    const instances = getArrInstances(config, { type: 'radarr', enabledOnly: true })
        .filter(isArrInstanceReady);
    if (!instances.length) return new Map();
    const byTmdb = new Map();
    for (const instance of instances) {
        const cached = movieCatalogCache.get(instanceCacheKey(instance));
        if (!isCatalogFresh(cached)) return null;
        for (const [tmdb, entry] of cached.byTmdb.entries()) {
            if (!byTmdb.has(tmdb)) byTmdb.set(tmdb, entry);
        }
    }
    return byTmdb;
};

const peekSeriesCatalogIndexes = (config) => {
    const instances = getArrInstances(config, { type: 'sonarr', enabledOnly: true })
        .filter(isArrInstanceReady);
    if (!instances.length) {
        return { byTmdb: new Map(), byTvdb: new Map(), byTitleYear: new Map() };
    }
    const byTmdb = new Map();
    const byTvdb = new Map();
    const byTitleYear = new Map();
    for (const instance of instances) {
        const cached = seriesCatalogCache.get(instanceCacheKey(instance));
        if (!isCatalogFresh(cached)) return null;
        for (const [tmdb, entry] of (cached.byTmdb || new Map()).entries()) {
            if (!byTmdb.has(tmdb)) byTmdb.set(tmdb, entry);
        }
        for (const [tvdb, entry] of (cached.byTvdb || new Map()).entries()) {
            if (!byTvdb.has(tvdb)) byTvdb.set(tvdb, entry);
        }
        for (const [titleKey, entry] of (cached.byTitleYear || new Map()).entries()) {
            if (!byTitleYear.has(titleKey)) byTitleYear.set(titleKey, entry);
        }
    }
    return { byTmdb, byTvdb, byTitleYear };
};

const peekSeriesCatalogIndex = (config) => {
    const indexes = peekSeriesCatalogIndexes(config);
    return indexes ? indexes.byTmdb : null;
};

const loadInstanceMovieCatalog = async (instance, fetchOpts = {}) => {
    const key = instanceCacheKey(instance);
    const forceRefresh = fetchOpts.forceRefresh === true;
    const cached = movieCatalogCache.get(key);
    dropStaleCatalog(movieCatalogCache, key, cached);
    if (!forceRefresh && isCatalogFresh(movieCatalogCache.get(key))) return movieCatalogCache.get(key);

    // Never join a short-timeout Discover warm when doing a forced cache rebuild.
    if (!forceRefresh && movieCatalogInflight.has(key)) return movieCatalogInflight.get(key);

    const pending = (async () => {
        const rawList = await fetchArrInstanceCatalogItems(instance, fetchOpts);
        if (!Array.isArray(rawList)) {
            throw new Error(`Radarr catalog fetch failed (${instance?.name || instance?.id || 'instance'})`);
        }
        const list = leanRadarrMovieList(rawList);
        if (Array.isArray(rawList)) rawList.length = 0;
        const index = new Map();
        const byImdb = new Map();
        for (const movie of list) {
            const tmdb = Number(movie?.tmdbId);
            if (Number.isFinite(tmdb) && tmdb > 0 && !index.has(tmdb)) {
                index.set(tmdb, { movie, instance });
            }
            const imdb = String(movie?.imdbId || '').trim().toLowerCase();
            if (imdb && !byImdb.has(imdb)) {
                byImdb.set(imdb, { movie, instance });
            }
        }
        const value = { at: now(), list, byTmdb: index, byImdb };
        movieCatalogCache.set(key, value);
        return value;
    })().finally(() => {
        if (movieCatalogInflight.get(key) === pending) movieCatalogInflight.delete(key);
    });

    movieCatalogInflight.set(key, pending);
    return pending;
};

const loadInstanceSeriesCatalog = async (instance, fetchOpts = {}) => {
    const key = instanceCacheKey(instance);
    const forceRefresh = fetchOpts.forceRefresh === true;
    const cached = seriesCatalogCache.get(key);
    dropStaleCatalog(seriesCatalogCache, key, cached);
    if (!forceRefresh && isCatalogFresh(seriesCatalogCache.get(key))) return seriesCatalogCache.get(key);

    if (!forceRefresh && seriesCatalogInflight.has(key)) return seriesCatalogInflight.get(key);

    const pending = (async () => {
        const rawList = await fetchArrInstanceCatalogItems(instance, fetchOpts);
        if (!Array.isArray(rawList)) {
            throw new Error(`Sonarr catalog fetch failed (${instance?.name || instance?.id || 'instance'})`);
        }
        const list = leanSonarrSeriesList(rawList);
        if (Array.isArray(rawList)) rawList.length = 0;
        const indexes = buildSonarrSeriesIndexes(list, instance);
        const value = {
            at: now(),
            list,
            byTmdb: indexes.byTmdb,
            byTvdb: indexes.byTvdb,
            byTitleYear: indexes.byTitleYear,
        };
        seriesCatalogCache.set(key, value);
        return value;
    })().finally(() => {
        if (seriesCatalogInflight.get(key) === pending) seriesCatalogInflight.delete(key);
    });

    seriesCatalogInflight.set(key, pending);
    return pending;
};

const loadMovieCatalogIndexes = async (config, fetchOpts) => {
    const instances = getArrInstances(config, { type: 'radarr', enabledOnly: true })
        .filter(isArrInstanceReady);
    const byTmdb = new Map();
    const byImdb = new Map();
    await Promise.all(instances.map(async (instance) => {
        const cached = await loadInstanceMovieCatalog(instance, fetchOpts);
        for (const [tmdb, entry] of cached.byTmdb.entries()) {
            if (!byTmdb.has(tmdb)) byTmdb.set(tmdb, entry);
        }
        for (const [imdb, entry] of (cached.byImdb || new Map()).entries()) {
            if (!byImdb.has(imdb)) byImdb.set(imdb, entry);
        }
    }));
    return { byTmdb, byImdb };
};

const loadMovieCatalogIndex = async (config, fetchOpts) => {
    const indexes = await loadMovieCatalogIndexes(config, fetchOpts);
    return indexes.byTmdb;
};

const loadSeriesCatalogIndexes = async (config, fetchOpts) => {
    const instances = getArrInstances(config, { type: 'sonarr', enabledOnly: true })
        .filter(isArrInstanceReady);
    const byTmdb = new Map();
    const byTvdb = new Map();
    const byTitleYear = new Map();
    await Promise.all(instances.map(async (instance) => {
        const cached = await loadInstanceSeriesCatalog(instance, fetchOpts);
        for (const [tmdb, entry] of (cached.byTmdb || new Map()).entries()) {
            if (!byTmdb.has(tmdb)) byTmdb.set(tmdb, entry);
        }
        for (const [tvdb, entry] of (cached.byTvdb || new Map()).entries()) {
            if (!byTvdb.has(tvdb)) byTvdb.set(tvdb, entry);
        }
        for (const [titleKey, entry] of (cached.byTitleYear || new Map()).entries()) {
            if (!byTitleYear.has(titleKey)) byTitleYear.set(titleKey, entry);
        }
    }));
    return { byTmdb, byTvdb, byTitleYear };
};

const loadSeriesCatalogIndex = async (config, fetchOpts) => {
    const indexes = await loadSeriesCatalogIndexes(config, fetchOpts);
    return indexes.byTmdb;
};

const loadInstanceArtistCatalog = async (instance, fetchOpts = {}) => {
    const key = instanceCacheKey(instance);
    const forceRefresh = fetchOpts.forceRefresh === true;
    const cached = artistCatalogCache.get(key);
    dropStaleCatalog(artistCatalogCache, key, cached);
    if (!forceRefresh && isCatalogFresh(artistCatalogCache.get(key))) return artistCatalogCache.get(key);

    if (!forceRefresh && artistCatalogInflight.has(key)) return artistCatalogInflight.get(key);

    const pending = (async () => {
        const rawList = await fetchArrInstanceCatalogItems(instance, fetchOpts);
        if (!Array.isArray(rawList)) {
            throw new Error(`Lidarr catalog fetch failed (${instance?.name || instance?.id || 'instance'})`);
        }
        const list = leanLidarrArtistList(rawList);
        if (Array.isArray(rawList)) rawList.length = 0;
        const byMbid = new Map();
        for (const artist of list) {
            const mbid = String(artist?.foreignArtistId || '').trim();
            if (!mbid) continue;
            if (!byMbid.has(mbid)) byMbid.set(mbid, { artist, instance });
        }
        const value = { at: now(), list, byMbid };
        artistCatalogCache.set(key, value);
        return value;
    })().finally(() => {
        if (artistCatalogInflight.get(key) === pending) artistCatalogInflight.delete(key);
    });

    artistCatalogInflight.set(key, pending);
    return pending;
};

const peekArtistCatalogIndex = (config) => {
    const instances = getArrInstances(config, { type: 'lidarr', enabledOnly: true })
        .filter(isArrInstanceReady);
    if (!instances.length) return new Map();
    const byMbid = new Map();
    for (const instance of instances) {
        const cached = artistCatalogCache.get(instanceCacheKey(instance));
        if (!isCatalogFresh(cached)) return null;
        for (const [mbid, entry] of (cached.byMbid || new Map()).entries()) {
            if (!byMbid.has(mbid)) byMbid.set(mbid, entry);
        }
    }
    return byMbid;
};

const loadArtistCatalogIndex = async (config, fetchOpts) => {
    const instances = getArrInstances(config, { type: 'lidarr', enabledOnly: true })
        .filter(isArrInstanceReady);
    const byMbid = new Map();
    await Promise.all(instances.map(async (instance) => {
        const cached = await loadInstanceArtistCatalog(instance, fetchOpts);
        for (const [mbid, entry] of (cached.byMbid || new Map()).entries()) {
            if (!byMbid.has(mbid)) byMbid.set(mbid, entry);
        }
    }));
    return byMbid;
};

/** Fire-and-forget catalog warm so later enrichItems can be sync-fast. */
let lastCatalogWarmKickAt = 0;
const CATALOG_WARM_KICK_COOLDOWN_MS = 60 * 1000;
const warmCatalogsInBackground = (config, fetchOpts) => {
    const kickedAt = now();
    if (kickedAt - lastCatalogWarmKickAt < CATALOG_WARM_KICK_COOLDOWN_MS) return;
    lastCatalogWarmKickAt = kickedAt;
    loadMovieCatalogIndex(config, fetchOpts).catch(() => {});
    loadSeriesCatalogIndex(config, fetchOpts).catch(() => {});
    loadArtistCatalogIndex(config, fetchOpts).catch(() => {});
};

const resolveMediaType = (item = {}) => {
    const raw = item?.mediaType ?? item?.media?.mediaType ?? item?.type;
    if (raw === 'music') return 'music';
    if (raw === 'movie' || raw === 1 || raw === '1') return 'movie';
    if (raw === 'tv' || raw === 2 || raw === '2') return 'tv';
    if (item?.firstAirDate && !item?.releaseDate) return 'tv';
    if (item?.releaseDate && !item?.firstAirDate) return 'movie';
    if (item?.name && !item?.title) return 'tv';
    if (item?.title && !item?.name) return 'movie';
    return null;
};

const resolveMbid = (item = {}) => {
    const id = String(item?.mbid ?? item?.foreignArtistId ?? '').trim();
    return id || null;
};

const resolveTmdbId = (item = {}) => {
    const id = Number(item?.tmdbId ?? item?.id);
    return Number.isFinite(id) && id > 0 ? id : null;
};

const movieHasFile = (movie = {}) => {
    if (movie.hasFile === true) return true;
    if (Number(movie.movieFileId) > 0) return true;
    if (movie.movieFile && (movie.movieFile.id || movie.movieFile.relativePath)) return true;
    return false;
};

const seriesStatsStatus = (series = {}) => {
    const stats = series?.statistics || {};
    const episodeFileCount = Number(stats.episodeFileCount) || 0;
    if (episodeFileCount <= 0) return SEERR_MEDIA_PROCESSING;

    const seriesStatus = String(series?.status || '').toLowerCase();
    const seriesEnded = seriesStatus === 'ended'
        || seriesStatus === 'canceled'
        || seriesStatus === 'cancelled'
        || seriesStatus === 'deleted';

    // Future scheduled episodes mean the show is not finished — Discover should show Partial
    // (not Available). Sonarr "percent of monitored" can still read 100% for aired eps only.
    // Ended shows should not keep a stale nextAiring stamp as Partial.
    if (!seriesEnded && (series?.nextAiring || series?.nextAiringUtc)) {
        return SEERR_MEDIA_PARTIAL;
    }

    // Sonarr's own monitored completeness (same numbers the Sonarr UI uses).
    const monitored = Number(stats.episodeCount) || 0;
    const total = Number(stats.totalEpisodeCount) || 0;
    const percent = Number(stats.percentOfEpisodes);
    const expected = Math.max(monitored, total);
    const monitoredComplete = (
        (Number.isFinite(percent) && percent >= 100 && total <= monitored)
        || (expected > 0 && episodeFileCount >= expected)
    );

    // Any monitored season with files but missing episodes → Partial.
    for (const season of Array.isArray(series.seasons) ? series.seasons : []) {
        const seasonNumber = Number(season?.seasonNumber);
        if (!Number.isFinite(seasonNumber) || seasonNumber <= 0) continue;
        if (season.monitored === false) continue;
        const s = season?.statistics || {};
        const sFiles = Number(s.episodeFileCount) || 0;
        const sMonitored = Number(s.episodeCount) || 0;
        const sTotal = Number(s.totalEpisodeCount) || 0;
        const sExpected = Math.max(sMonitored, sTotal);
        const sPercent = Number(s.percentOfEpisodes);
        if (sExpected > 0 && sFiles < sExpected) return SEERR_MEDIA_PARTIAL;
        if (Number.isFinite(sPercent) && sPercent < 100 && sFiles > 0) return SEERR_MEDIA_PARTIAL;
        if (sExpected > 0 && sFiles <= 0) return SEERR_MEDIA_PARTIAL;
    }

    // Continuing series with files but not ended → Partial when stats look "complete"
    // only because unaired eps aren't in the monitored count yet.
    if (
        monitoredComplete
        && (seriesStatus === 'continuing' || seriesStatus === 'upcoming')
    ) {
        return SEERR_MEDIA_PARTIAL;
    }

    return monitoredComplete ? SEERR_MEDIA_AVAILABLE : SEERR_MEDIA_PARTIAL;
};

/** Catalog-grade per-season file stats so browse cards can tell Partial vs Requested. */
const sonarrSeasonDiskStats = (season = {}) => {
    const seasonNumber = Number(season?.seasonNumber);
    if (!Number.isFinite(seasonNumber) || seasonNumber <= 0) return null;
    const stats = season?.statistics || {};
    const withFile = Number(stats.episodeFileCount) || 0;
    const monitored = Number(stats.episodeCount) || 0;
    const total = Math.max(monitored, Number(stats.totalEpisodeCount) || 0);
    const percent = Number(stats.percentOfEpisodes);
    const complete = withFile > 0 && (
        (Number.isFinite(percent) && percent >= 100)
        || (monitored > 0 && withFile >= monitored)
    );
    const airedTotal = monitored > 0 ? monitored : (complete ? withFile : 0);
    return {
        seasonNumber,
        withFile,
        total,
        airedTotal,
        airedWithFile: airedTotal > 0 ? Math.min(withFile, airedTotal) : withFile,
        complete,
    };
};

const sonarrSeasonDiskList = (series = {}) => (
    (Array.isArray(series?.seasons) ? series.seasons : [])
        .map((season) => sonarrSeasonDiskStats(season))
        .filter(Boolean)
);

const artistStatsStatus = (artist = {}) => {
    const stats = artist?.statistics || {};
    const trackFileCount = Number(stats.trackFileCount) || 0;
    if (trackFileCount <= 0) return SEERR_MEDIA_PROCESSING;

    const albumCount = Number(stats.albumCount) || 0;
    const totalAlbumCount = Number(stats.totalAlbumCount) || 0;
    if (totalAlbumCount > 0 && albumCount >= totalAlbumCount) return SEERR_MEDIA_AVAILABLE;
    if (albumCount > 0 || trackFileCount > 0) return SEERR_MEDIA_PARTIAL;
    return SEERR_MEDIA_PROCESSING;
};

const loadQueueSets = async (instance, fetchOpts) => {
    const key = instanceCacheKey(instance);
    const cached = queueCache.get(key);
    if (cached && now() - cached.at < QUEUE_CACHE_MS) return cached;

    const movieIds = new Set();
    const seriesIds = new Set();
    const artistIds = new Set();
    try {
        const summary = await fetchArrQueueSummary(instance, fetchOpts);
        for (const row of summary.records || []) {
            const movieId = Number(row?.movieId);
            const seriesId = Number(row?.seriesId);
            const artistId = Number(row?.artistId);
            if (Number.isFinite(movieId) && movieId > 0) movieIds.add(movieId);
            if (Number.isFinite(seriesId) && seriesId > 0) seriesIds.add(seriesId);
            if (Number.isFinite(artistId) && artistId > 0) artistIds.add(artistId);
        }
    } catch {
        // Ignore queue failures — availability still works from catalog.
    }

    const value = { at: now(), movieIds, seriesIds, artistIds };
    queueCache.set(key, value);
    return value;
};

const statusLabelFor = (status) => {
    if (status === SEERR_MEDIA_AVAILABLE) return 'available';
    if (status === SEERR_MEDIA_PARTIAL) return 'partial';
    if (status === SEERR_MEDIA_PROCESSING) return 'processing';
    return 'unknown';
};

/**
 * @param {object} config Portal config
 * @param {object} [options]
 * @param {(url: string) => string} [options.resolveUrl]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {object[]} [options.upgraderItems]
 */
export const createLibraryAvailability = (config = {}, options = {}) => {
    const catalogTimeoutMs = Number(options.catalogTimeoutMs) > 0 ? Number(options.catalogTimeoutMs) : 8000;
    const fetchOpts = {
        resolveUrl: options.resolveUrl || ((url) => url),
        fetchImpl: options.fetchImpl || fetch,
        timeoutMs: catalogTimeoutMs,
        forceRefresh: options.forceCatalogRefresh === true,
    };
    const upgraderItems = Array.isArray(options.upgraderItems) ? options.upgraderItems : [];
    // Only warm when explicitly requested (cache rebuild). Request-path callers must not
    // kick multi‑MB Sonarr/Radarr downloads that freeze /api/config and Settings.
    if (options.warmOnCreate === true) {
        warmCatalogsInBackground(config, { ...fetchOpts, forceRefresh: false });
    }

    const getMovieStatus = async (tmdbId, { networkLookups = true } = {}) => {
        const id = Number(tmdbId);
        if (!Number.isFinite(id) || id <= 0) {
            return {
                mediaType: 'movie',
                tmdbId: id,
                inLibrary: false,
                partial: false,
                downloading: false,
                status: null,
                statusLabel: null,
                mediaInfo: null,
            };
        }

        const cached = movieStatusCache.get(String(id));
        if (cached) {
            if (now() - cached.at < STATUS_CACHE_MS) return cached.value;
            movieStatusCache.delete(String(id));
        }

        const miss = {
            mediaType: 'movie',
            tmdbId: id,
            inLibrary: false,
            partial: false,
            downloading: false,
            status: null,
            statusLabel: null,
            mediaInfo: null,
        };

        const instances = getArrInstances(config, { type: 'radarr', enabledOnly: true })
            .filter(isArrInstanceReady);

        /** @type {{ movie: any, instance: any }[]} */
        const hits = [];
        if (!networkLookups) {
            for (const instance of instances) {
                const key = instanceCacheKey(instance);
                const catalog = movieCatalogCache.get(key);
                if (!catalog?.byTmdb) continue;
                const entry = catalog.byTmdb.get(id);
                if (entry?.movie) hits.push({ movie: entry.movie, instance: entry.instance || instance });
            }
            if (!hits.length) return miss;
        } else {
            await Promise.all(instances.map(async (instance) => {
                const catalog = await loadInstanceMovieCatalog(instance, fetchOpts);
                const entry = catalog?.byTmdb?.get(id);
                if (entry?.movie) hits.push({ movie: entry.movie, instance: entry.instance || instance });
            }));
            if (!hits.length) {
                const imdbId = await resolveImdbIdFromTmdb(config, id, {
                    mediaType: 'movie',
                    fetchImpl: fetchOpts.fetchImpl || fetch,
                });
                if (imdbId) {
                    const imdbKey = String(imdbId).trim().toLowerCase();
                    await Promise.all(instances.map(async (instance) => {
                        const catalog = await loadInstanceMovieCatalog(instance, fetchOpts);
                        const entry = catalog?.byImdb?.get(imdbKey);
                        if (entry?.movie) hits.push({ movie: entry.movie, instance: entry.instance || instance });
                    }));
                }
            }
            if (!hits.length) {
                movieStatusCache.set(String(id), { at: now(), value: miss });
                pruneMovieStatusCache();
                return miss;
            }
        }

        let downloading = false;
        if (networkLookups) {
            const queueFlags = await Promise.all(hits.map(async ({ movie, instance }) => {
                const queue = await loadQueueSets(instance, fetchOpts);
                return queue.movieIds.has(Number(movie.id));
            }));
            downloading = queueFlags.some(Boolean);
        }

        let hdHasFile = false;
        let fourKHasFile = false;
        let hdMatched = false;
        let fourKMatched = false;
        let primary = hits[0];

        for (const hit of hits) {
            const hasFile = movieHasFile(hit.movie);
            const is4k = !!hit.instance?.is4k;
            if (is4k) {
                fourKMatched = true;
                if (hasFile) fourKHasFile = true;
            } else {
                hdMatched = true;
                if (hasFile) hdHasFile = true;
            }
            if (hasFile && !movieHasFile(primary.movie)) primary = hit;
        }

        // Single untagged Radarr: treat as HD for request gating.
        if (!hdMatched && !fourKMatched && hits.length) {
            hdMatched = true;
            hdHasFile = movieHasFile(primary.movie);
        }

        const hasFile = hdHasFile || fourKHasFile || movieHasFile(primary.movie);
        let status = SEERR_MEDIA_PROCESSING;
        if (hasFile && !downloading) status = SEERR_MEDIA_AVAILABLE;
        else if (hasFile && downloading) status = SEERR_MEDIA_PROCESSING;
        else if (downloading) status = SEERR_MEDIA_PROCESSING;

        const mediaInfo = {
            id: Number(primary.movie.id) || id,
            tmdbId: id,
            status,
            mediaType: 'movie',
        };
        if (downloading) {
            mediaInfo.downloadStatus = [{ status: 'downloading', movieId: primary.movie.id }];
        }

        const value = {
            mediaType: 'movie',
            tmdbId: id,
            inLibrary: hasFile,
            partial: false,
            downloading,
            status,
            statusLabel: statusLabelFor(status),
            mediaInfo,
            radarrLibraryStatus: {
                matched: true,
                movieId: primary.movie.id,
                instanceId: primary.instance?.id,
                instanceName: primary.instance?.name || 'Radarr',
                hasFile,
                downloading,
                hdMatched,
                fourKMatched,
                hdHasFile,
                fourKHasFile,
            },
        };
        movieStatusCache.set(String(id), { at: now(), value });
        pruneMovieStatusCache();
        return value;
    };

    /** Fast list-path TV status from Sonarr series statistics (no episode fan-out). */
    const getTvListStatus = async (tmdbId, {
        title = '',
        year = null,
        tvdbId: tvdbIdHint = null,
        networkLookups = true,
    } = {}) => {
        const id = Number(tmdbId);
        const miss = {
            mediaType: 'tv',
            tmdbId: id,
            inLibrary: false,
            partial: false,
            downloading: false,
            status: null,
            statusLabel: null,
            mediaInfo: null,
        };
        if (!Number.isFinite(id) || id <= 0) return miss;

        let indexes;
        let hit = null;
        const sonarrReady = getArrInstances(config, { type: 'sonarr', enabledOnly: true })
            .some(isArrInstanceReady);
        const unmatched = () => (
            sonarrReady
                ? { ...miss, sonarrLibraryStatus: { matched: false, source: 'catalog' } }
                : miss
        );

        if (!networkLookups) {
            // List/stamp path: Map/peek only — never block on Sonarr/TMDB HTTP.
            indexes = peekSeriesCatalogIndexes(config);
            if (!indexes) return miss;
            hit = indexes.byTmdb.get(id) || null;
            const hinted = Number(tvdbIdHint);
            if (!hit && Number.isFinite(hinted) && hinted > 0 && indexes.byTvdb.has(hinted)) {
                hit = indexes.byTvdb.get(hinted);
            }
            if (!hit && title) {
                const requestedYear = Number(year);
                const hasYear = Number.isFinite(requestedYear) && requestedYear > 1900;
                const keyWithYear = hasYear ? normalizeSeriesTitleKey(title, requestedYear) : '';
                if (keyWithYear && indexes.byTitleYear.has(keyWithYear)) {
                    hit = indexes.byTitleYear.get(keyWithYear);
                } else if (!hasYear) {
                    const keyNoYear = normalizeSeriesTitleKey(title, null);
                    if (keyNoYear && indexes.byTitleYear.has(keyNoYear)) {
                        hit = indexes.byTitleYear.get(keyNoYear);
                    }
                }
            }
        } else {
            indexes = await loadSeriesCatalogIndexes(config, fetchOpts);
            hit = await matchSonarrSeriesFromIndexes(config, id, indexes, {
                fetchImpl: fetchOpts.fetchImpl || fetch,
                title,
                year,
                tvdbId: tvdbIdHint,
            });

            if (!hit) {
                // Sonarr lookup fills the gap when library rows lack tmdbId but are already monitored.
                for (const instance of getArrInstances(config, { type: 'sonarr', enabledOnly: true }).filter(isArrInstanceReady)) {
                    try {
                        const lookup = await lookupSonarrSeriesByTmdb(instance, id, fetchOpts);
                        if (lookup?.id) {
                            hit = { series: lookup, instance };
                            break;
                        }
                        const lookupTvdb = Number(lookup?.tvdbId);
                        if (Number.isFinite(lookupTvdb) && lookupTvdb > 0 && indexes.byTvdb.has(lookupTvdb)) {
                            hit = indexes.byTvdb.get(lookupTvdb);
                            break;
                        }
                    } catch {
                        // try next instance
                    }
                }
            }

            if (!hit) {
                const hinted = Number(tvdbIdHint);
                const tvdbId = (Number.isFinite(hinted) && hinted > 0)
                    ? hinted
                    : await resolveTvdbIdFromTmdb(config, id, { fetchImpl: fetchOpts.fetchImpl || fetch });
                if (tvdbId) {
                    if (indexes.byTvdb.has(tvdbId)) {
                        hit = indexes.byTvdb.get(tvdbId);
                    } else {
                        for (const instance of getArrInstances(config, { type: 'sonarr', enabledOnly: true }).filter(isArrInstanceReady)) {
                            try {
                                const lookup = await lookupSonarrSeriesByTvdb(instance, tvdbId, fetchOpts);
                                if (lookup?.id) {
                                    hit = { series: lookup, instance };
                                    break;
                                }
                            } catch {
                                // try next instance
                            }
                        }
                    }
                }
            }
        }

        if (!hit?.series) return unmatched();
        if (seriesConflictsRequestedShow(hit.series, { tmdbId: id, year })) return unmatched();

        const { series, instance } = hit;
        let downloading = false;
        if (networkLookups) {
            const queue = await loadQueueSets(instance, fetchOpts);
            downloading = queue.seriesIds.has(Number(series.id));
        }
        let status = seriesStatsStatus(series);
        if (downloading && status === SEERR_MEDIA_AVAILABLE) status = SEERR_MEDIA_PARTIAL;

        const mediaInfo = {
            id: Number(series.id) || id,
            tmdbId: id,
            status,
            mediaType: 'tv',
        };
        if (downloading) {
            mediaInfo.downloadStatus = [{ status: 'downloading', seriesId: series.id }];
        }

        // Lightweight season hints from Sonarr season stats when present.
        const seasons = Array.isArray(series.seasons)
            ? series.seasons
                .map((season) => {
                    const seasonNumber = Number(season?.seasonNumber);
                    if (!Number.isFinite(seasonNumber) || seasonNumber <= 0) return null;
                    const stats = season?.statistics || {};
                    const episodeFileCount = Number(stats.episodeFileCount) || 0;
                    if (episodeFileCount <= 0) return null;
                    const expected = Math.max(
                        Number(stats.episodeCount) || 0,
                        Number(stats.totalEpisodeCount) || 0,
                    );
                    return {
                        seasonNumber,
                        status: expected > 0 && episodeFileCount >= expected
                            ? SEERR_MEDIA_AVAILABLE
                            : SEERR_MEDIA_PARTIAL,
                    };
                })
                .filter(Boolean)
            : [];
        if (seasons.length) mediaInfo.seasons = seasons;

        return {
            mediaType: 'tv',
            tmdbId: id,
            inLibrary: status === SEERR_MEDIA_AVAILABLE || status === SEERR_MEDIA_PARTIAL,
            partial: status === SEERR_MEDIA_PARTIAL,
            downloading,
            status,
            statusLabel: statusLabelFor(status),
            mediaInfo,
            sonarrLibraryStatus: {
                matched: true,
                seriesId: series.id,
                instanceId: instance.id,
                instanceName: instance.name || 'Sonarr',
                showComplete: status === SEERR_MEDIA_AVAILABLE && !downloading,
                hasActiveDownloads: downloading,
                source: 'catalog',
                seriesStatus: series?.status || null,
                nextAiring: series?.nextAiring || series?.nextAiringUtc || null,
                episodeFileCount: Number(series?.statistics?.episodeFileCount) || 0,
                fileCount: Number(series?.statistics?.episodeFileCount) || 0,
                seasons: sonarrSeasonDiskList(series),
            },
        };
    };

    const getMusicStatus = async (mbid, { networkLookups = true } = {}) => {
        const id = String(mbid || '').trim();
        if (!id) {
            return {
                mediaType: 'music',
                mbid: id,
                inLibrary: false,
                partial: false,
                downloading: false,
                status: null,
                statusLabel: null,
                mediaInfo: null,
            };
        }

        let artistIndex = peekArtistCatalogIndex(config);
        if (artistIndex == null && networkLookups) {
            artistIndex = await loadArtistCatalogIndex(config, fetchOpts);
        }
        if (!artistIndex || !artistIndex.size) {
            return {
                mediaType: 'music',
                mbid: id,
                inLibrary: false,
                partial: false,
                downloading: false,
                status: null,
                statusLabel: null,
                mediaInfo: null,
            };
        }

        const hit = artistIndex.get(id);
        if (!hit) {
            return {
                mediaType: 'music',
                mbid: id,
                inLibrary: false,
                partial: false,
                downloading: false,
                status: null,
                statusLabel: null,
                mediaInfo: null,
            };
        }

        const { artist, instance } = hit;
        const queueSets = await loadQueueSets(instance, fetchOpts);
        const downloading = queueSets.artistIds?.has(Number(artist.id)) || false;
        let status = artistStatsStatus(artist);
        if (downloading && status !== SEERR_MEDIA_AVAILABLE) {
            status = SEERR_MEDIA_PROCESSING;
        }

        const posterUrl = pickLidarrArtistImage(artist, { instance });
        const mediaInfo = {
            id: Number(artist?.id) || 0,
            mbid: id,
            status,
            mediaType: 'music',
        };
        if (downloading) {
            mediaInfo.downloadStatus = [{ status: 'downloading', artistId: artist.id }];
        }

        return {
            mediaType: 'music',
            mbid: id,
            inLibrary: status === SEERR_MEDIA_AVAILABLE || status === SEERR_MEDIA_PARTIAL,
            partial: status === SEERR_MEDIA_PARTIAL,
            downloading,
            status,
            statusLabel: statusLabelFor(status),
            mediaInfo,
            posterUrl,
            lidarrLibraryStatus: {
                matched: true,
                artistId: artist?.id,
                instanceId: instance?.id,
                instanceName: instance?.name || 'Lidarr',
                hasActiveDownloads: downloading,
                source: 'catalog',
            },
        };
    };

    const getMediaStatus = async (mediaType, mediaId) => {
        const type = resolveMediaType({ mediaType }) || (mediaType === 'music' ? 'music' : (mediaType === 'tv' ? 'tv' : 'movie'));
        if (type === 'music') return getMusicStatus(mediaId);
        if (type === 'movie') return getMovieStatus(mediaId);

        const tmdbId = Number(mediaId);
        // Detail-grade Sonarr status (episode-aware) for single lookups.
        const sonarrStatus = await fetchSonarrLibraryStatusForShow(config, tmdbId, {
            ...fetchOpts,
            upgraderItems,
        });
        if (!sonarrStatus?.matched) {
            return {
                mediaType: 'tv',
                tmdbId: Number(tmdbId),
                inLibrary: false,
                partial: false,
                downloading: false,
                status: null,
                statusLabel: null,
                mediaInfo: null,
                sonarrLibraryStatus: sonarrStatus,
            };
        }

        let status = SEERR_MEDIA_UNKNOWN;
        const totalAired = (sonarrStatus.seasons || []).reduce(
            (n, s) => n + (Number(s.airedTotal) || 0),
            0,
        );
        if (sonarrStatus.showComplete && !sonarrStatus.hasActiveDownloads && totalAired > 0) {
            status = SEERR_MEDIA_AVAILABLE;
        } else if (sonarrStatus.hasActiveDownloads) {
            status = SEERR_MEDIA_PROCESSING;
        } else if ((sonarrStatus.fileCount || 0) > 0 || (sonarrStatus.seasons || []).some((s) => s.withFile > 0)) {
            status = SEERR_MEDIA_PARTIAL;
        } else if (totalAired === 0) {
            status = null;
        } else {
            status = SEERR_MEDIA_PROCESSING;
        }

        const mediaInfo = {
            id: Number(sonarrStatus.seriesId) || Number(tmdbId),
            tmdbId: Number(tmdbId),
            status,
            mediaType: 'tv',
            seasons: (sonarrStatus.seasons || [])
                .filter((season) => Number(season?.seasonNumber) > 0 && (season.airedTotal > 0 || season.withFile > 0))
                .map((season) => ({
                    seasonNumber: season.seasonNumber,
                    status: season.complete ? SEERR_MEDIA_AVAILABLE : SEERR_MEDIA_PARTIAL,
                })),
        };
        if (sonarrStatus.hasActiveDownloads) {
            mediaInfo.downloadStatus = [{ status: 'downloading', seriesId: sonarrStatus.seriesId }];
        }

        return {
            mediaType: 'tv',
            tmdbId: Number(tmdbId),
            inLibrary: status === SEERR_MEDIA_AVAILABLE || status === SEERR_MEDIA_PARTIAL,
            partial: status === SEERR_MEDIA_PARTIAL,
            downloading: !!sonarrStatus.hasActiveDownloads,
            status,
            statusLabel: statusLabelFor(status),
            mediaInfo,
            sonarrLibraryStatus: sonarrStatus,
        };
    };

    /**
     * Enrich discover list items with mediaInfo.
     * @param {object[]} items
     * @param {object} [opts]
     * @param {boolean} [opts.blockForCatalog=false] When false (default), skip enrich if *arr
     *   catalogs are cold and warm them in the background — keeps Discover browse fast.
     * @param {boolean} [opts.networkLookups=true] When false, Map/peek only (no Sonarr/TMDB HTTP).
     */
    const enrichItems = async (items = [], opts = {}) => {
        if (!Array.isArray(items) || items.length === 0) return items;

        const blockForCatalog = opts.blockForCatalog === true;
        const networkLookups = opts.networkLookups !== false;
        const needsMovies = items.some((item) => resolveMediaType(item) === 'movie');
        const needsTv = items.some((item) => resolveMediaType(item) === 'tv');
        const needsMusic = items.some((item) => resolveMediaType(item) === 'music');

        let movieIndex = needsMovies ? peekMovieCatalogIndex(config) : new Map();
        let seriesIndex = needsTv ? peekSeriesCatalogIndex(config) : new Map();
        let artistIndex = needsMusic ? peekArtistCatalogIndex(config) : new Map();
        const catalogsCold = (needsMovies && movieIndex == null)
            || (needsTv && seriesIndex == null)
            || (needsMusic && artistIndex == null);

        if (catalogsCold) {
            warmCatalogsInBackground(config, fetchOpts);
            if (!blockForCatalog) {
                // Return TMDB payload immediately; next requests will enrich from cache.
                return items;
            }
            if (needsMovies) movieIndex = await loadMovieCatalogIndex(config, fetchOpts);
            if (needsTv) seriesIndex = await loadSeriesCatalogIndex(config, fetchOpts);
            if (needsMusic) artistIndex = await loadArtistCatalogIndex(config, fetchOpts);
        }

        // Use fast path once catalogs are warm (Map lookups only).
        const enriched = await Promise.all(items.map(async (item) => {
            const mediaType = resolveMediaType(item);
            const tmdbId = resolveTmdbId(item);
            const mbid = resolveMbid(item);
            if (!mediaType || mediaType === 'person') return item;
            if (mediaType === 'music' && !mbid) return item;
            if (mediaType !== 'music' && !tmdbId) return item;

            try {
                const availability = mediaType === 'music'
                    ? await getMusicStatus(mbid, { networkLookups })
                    : (mediaType === 'movie'
                        ? await getMovieStatus(tmdbId, { networkLookups })
                        : await getTvListStatus(tmdbId, {
                            title: item?.title || item?.name || '',
                            year: Number.isFinite(Number(String(item?.firstAirDate || '').slice(0, 4)))
                                && Number(String(item?.firstAirDate || '').slice(0, 4)) > 1900
                                ? Number(String(item?.firstAirDate || '').slice(0, 4))
                                : null,
                            tvdbId: Number(item?.tvdbId ?? item?.externalIds?.tvdbId) || null,
                            networkLookups,
                        }));

                if (!availability?.mediaInfo) return item;

                const posterPath = availability.posterUrl
                    || item.posterPath
                    || item.posterUrl
                    || null;

                return {
                    ...item,
                    ...(posterPath ? { posterPath, posterUrl: posterPath } : {}),
                    mediaInfo: {
                        ...(item.mediaInfo || {}),
                        ...availability.mediaInfo,
                    },
                    ...(availability.sonarrLibraryStatus
                        ? { sonarrLibraryStatus: availability.sonarrLibraryStatus }
                        : {}),
                    ...(availability.radarrLibraryStatus
                        ? { radarrLibraryStatus: availability.radarrLibraryStatus }
                        : {}),
                    ...(availability.lidarrLibraryStatus
                        ? { lidarrLibraryStatus: availability.lidarrLibraryStatus }
                        : {}),
                };
            } catch {
                return item;
            }
        }));

        return enriched;
    };

    const enrichDetails = async (details = {}) => {
        if (!details || typeof details !== 'object' || Array.isArray(details)) return details;
        const mediaType = resolveMediaType(details);
        const tmdbId = resolveTmdbId(details);
        const mbid = resolveMbid(details);
        if (mediaType === 'music' && mbid) {
            const availability = await getMusicStatus(mbid);
            if (!availability?.mediaInfo) return details;
            const posterPath = availability.posterUrl || details.posterPath || details.posterUrl || null;
            return {
                ...details,
                ...(posterPath ? { posterPath, posterUrl: posterPath } : {}),
                mediaInfo: {
                    ...(details.mediaInfo || {}),
                    ...availability.mediaInfo,
                },
                lidarrLibraryStatus: availability.lidarrLibraryStatus,
            };
        }
        if (!mediaType || !tmdbId) return details;

        if (mediaType === 'movie') {
            const availability = await getMovieStatus(tmdbId);
            if (!availability?.mediaInfo) return details;
            return {
                ...details,
                mediaInfo: {
                    ...(details.mediaInfo || {}),
                    ...availability.mediaInfo,
                },
                radarrLibraryStatus: availability.radarrLibraryStatus,
            };
        }

        const enriched = await enrichTvDetailsWithSonarrLibraryStatus(config, details, {
            ...fetchOpts,
            upgraderItems,
        });
        if (enriched?.sonarrLibraryStatus?.matched && enriched.mediaInfo && !enriched.mediaInfo.id) {
            return {
                ...enriched,
                mediaInfo: {
                    ...enriched.mediaInfo,
                    id: Number(enriched.sonarrLibraryStatus.seriesId) || tmdbId,
                },
            };
        }
        // Ensure mediaInfo.id even when applySonarr already set status.
        if (enriched?.sonarrLibraryStatus?.matched) {
            return applySonarrLibraryStatusToTvDetails(
                {
                    ...enriched,
                    mediaInfo: {
                        ...(enriched.mediaInfo || {}),
                        id: Number(enriched.sonarrLibraryStatus.seriesId) || tmdbId,
                    },
                },
                enriched.sonarrLibraryStatus,
            );
        }
        return enriched;
    };

    const filterAvailable = async (items, opts = {}) => {
        const list = Array.isArray(items) ? items : [];
        const enriched = opts.enrich === false ? list : await enrichItems(list);
        if (opts.hideAvailable) return filterAvailableMedia(enriched);
        return enriched.filter((item) => !shouldHideAvailableMediaItem(item));
    };

    /** Snapshot every catalog title for the on-disk discovery availability cache. */
    const snapshotLibraryStatuses = async () => {
        // Stamp directly from each *arr catalog row. Looking up by TMDB id after the fact
        // dropped Sonarr shows with missing/zero tmdbId (e.g. Rick and Morty).
        const radarrInstances = getArrInstances(config, { type: 'radarr', enabledOnly: true })
            .filter(isArrInstanceReady);
        const sonarrInstances = getArrInstances(config, { type: 'sonarr', enabledOnly: true })
            .filter(isArrInstanceReady);
        const lidarrInstances = getArrInstances(config, { type: 'lidarr', enabledOnly: true })
            .filter(isArrInstanceReady);

        if (!radarrInstances.length && !sonarrInstances.length && !lidarrInstances.length) {
            throw new Error('No ready Sonarr/Radarr/Lidarr instances configured');
        }

        // Always re-download catalogs for the 12h badge snapshot — never reuse a
        // short-timeout empty cache from Discover browse.
        const snapshotFetchOpts = { ...fetchOpts, forceRefresh: true };
        const movieCatalogs = radarrInstances.length
            ? await Promise.all(radarrInstances.map((instance) => loadInstanceMovieCatalog(instance, snapshotFetchOpts)))
            : [];
        const seriesCatalogs = sonarrInstances.length
            ? await Promise.all(sonarrInstances.map((instance) => loadInstanceSeriesCatalog(instance, snapshotFetchOpts)))
            : [];
        const artistCatalogs = lidarrInstances.length
            ? await Promise.all(lidarrInstances.map((instance) => loadInstanceArtistCatalog(instance, snapshotFetchOpts)))
            : [];

        const movieRows = movieCatalogs.reduce((sum, catalog) => sum + (catalog?.list?.length || 0), 0);
        const seriesRowsLoaded = seriesCatalogs.reduce((sum, catalog) => sum + (catalog?.list?.length || 0), 0);
        const artistRowsLoaded = artistCatalogs.reduce((sum, catalog) => sum + (catalog?.list?.length || 0), 0);
        if (movieRows + seriesRowsLoaded + artistRowsLoaded <= 0) {
            throw new Error('*arr catalogs returned 0 titles (check URL/API key or increase timeout)');
        }

        const byKey = {};
        let movieCount = 0;
        let tvCount = 0;
        let musicCount = 0;
        const yieldEventLoop = () => new Promise((resolve) => setImmediate(resolve));

        for (const catalog of movieCatalogs) {
            const list = Array.isArray(catalog?.list) ? catalog.list : [];
            for (let i = 0; i < list.length; i += 1) {
                const movie = list[i];
                const tmdbId = Number(movie?.tmdbId);
                const hasFile = movieHasFile(movie);
                const status = hasFile ? SEERR_MEDIA_AVAILABLE : SEERR_MEDIA_PROCESSING;
                const mediaInfo = {
                    id: Number(movie?.id) || (Number.isFinite(tmdbId) ? tmdbId : 0),
                    tmdbId: Number.isFinite(tmdbId) && tmdbId > 0 ? tmdbId : null,
                    status,
                    mediaType: 'movie',
                };
                const entry = {
                    mediaInfo,
                    radarrLibraryStatus: {
                        matched: true,
                        movieId: movie?.id,
                        hasFile,
                        downloading: false,
                    },
                    sonarrLibraryStatus: null,
                };
                if (Number.isFinite(tmdbId) && tmdbId > 0) {
                    byKey[`movie:${tmdbId}`] = entry;
                    movieCount += 1;
                }
                const title = movie?.title || movie?.originalTitle || '';
                const year = Number(movie?.year) || Number(String(movie?.releaseDate || '').slice(0, 4)) || null;
                const titleKey = normalizeSeriesTitleKey(title, year);
                if (titleKey) byKey[`movieTitle:${titleKey}`] = entry;
                if (i > 0 && i % 50 === 0) await yieldEventLoop();
            }
        }

        const seriesRows = [];
        for (let i = 0; i < sonarrInstances.length; i += 1) {
            const instance = sonarrInstances[i];
            const catalog = seriesCatalogs[i];
            const list = Array.isArray(catalog?.list) ? catalog.list : [];
            for (const series of list) {
                const existingTmdb = Number(series?.tmdbId);
                seriesRows.push({
                    series,
                    instance,
                    tmdbId: (Number.isFinite(existingTmdb) && existingTmdb > 0) ? existingTmdb : null,
                });
            }
        }

        const needsResolve = seriesRows.filter((row) => !row.tmdbId && Number(row.series?.tvdbId) > 0);
        const resolveConcurrency = 3;
        for (let i = 0; i < needsResolve.length; i += resolveConcurrency) {
            const slice = needsResolve.slice(i, i + resolveConcurrency);
            await Promise.all(slice.map(async (row) => {
                row.tmdbId = await resolveTmdbIdFromTvdb(config, Number(row.series.tvdbId), {
                    fetchImpl: fetchOpts.fetchImpl || fetch,
                });
            }));
            await yieldEventLoop();
        }

        for (let i = 0; i < seriesRows.length; i += 1) {
            const { series, instance, tmdbId } = seriesRows[i];
            const status = seriesStatsStatus(series);
            const mediaInfo = {
                id: Number(series?.id) || (Number.isFinite(Number(tmdbId)) ? Number(tmdbId) : 0),
                tmdbId: Number.isFinite(Number(tmdbId)) && Number(tmdbId) > 0 ? Number(tmdbId) : null,
                status,
                mediaType: 'tv',
            };
            const seasons = Array.isArray(series?.seasons)
                ? series.seasons
                    .map((season) => {
                        const seasonNumber = Number(season?.seasonNumber);
                        if (!Number.isFinite(seasonNumber) || seasonNumber <= 0) return null;
                        const stats = season?.statistics || {};
                        const episodeFileCount = Number(stats.episodeFileCount) || 0;
                        if (episodeFileCount <= 0) return null;
                        const expected = Math.max(
                            Number(stats.episodeCount) || 0,
                            Number(stats.totalEpisodeCount) || 0,
                        );
                        return {
                            seasonNumber,
                            status: expected > 0 && episodeFileCount >= expected
                                ? SEERR_MEDIA_AVAILABLE
                                : SEERR_MEDIA_PARTIAL,
                        };
                    })
                    .filter(Boolean)
                : [];
            if (seasons.length) mediaInfo.seasons = seasons;

            const entry = {
                mediaInfo,
                sonarrLibraryStatus: {
                    matched: true,
                    seriesId: series?.id,
                    instanceId: instance?.id,
                    instanceName: instance?.name || 'Sonarr',
                    // showComplete only when truly finished — continuing/nextAiring stays Partial.
                    showComplete: status === SEERR_MEDIA_AVAILABLE,
                    hasActiveDownloads: false,
                    source: 'catalog',
                    nextAiring: series?.nextAiring || series?.nextAiringUtc || null,
                    seriesStatus: series?.status || null,
                    episodeFileCount: Number(series?.statistics?.episodeFileCount) || 0,
                    fileCount: Number(series?.statistics?.episodeFileCount) || 0,
                    seasons: sonarrSeasonDiskList(series),
                },
                radarrLibraryStatus: null,
            };

            if (Number.isFinite(Number(tmdbId)) && Number(tmdbId) > 0) {
                byKey[`tv:${Number(tmdbId)}`] = entry;
                tvCount += 1;
            }
            const title = series?.title || series?.seriesTitle || series?.sortTitle || '';
            const year = seriesYearFromSonarr(series);
            const titleKey = normalizeSeriesTitleKey(title, year);
            if (titleKey) byKey[`tvTitle:${titleKey}`] = entry;
            const titleNoYear = normalizeSeriesTitleKey(title, null);
            if (titleNoYear && titleNoYear !== titleKey) byKey[`tvTitle:${titleNoYear}`] = entry;

            if (i > 0 && i % 50 === 0) await yieldEventLoop();
        }

        for (const catalog of artistCatalogs) {
            const list = Array.isArray(catalog?.list) ? catalog.list : [];
            for (let i = 0; i < list.length; i += 1) {
                const artist = list[i];
                const mbid = String(artist?.foreignArtistId || '').trim();
                if (!mbid) continue;
                const status = artistStatsStatus(artist);
                const catalogHit = catalog?.byMbid?.get?.(mbid);
                const posterUrl = pickLidarrArtistImage(artist, { instance: catalogHit?.instance });
                const mediaInfo = {
                    id: Number(artist?.id) || 0,
                    mbid,
                    status,
                    mediaType: 'music',
                };
                const entry = {
                    mediaInfo,
                    lidarrLibraryStatus: {
                        matched: true,
                        artistId: artist?.id,
                        instanceId: catalogHit?.instance?.id || null,
                        hasActiveDownloads: false,
                        source: 'catalog',
                    },
                    sonarrLibraryStatus: null,
                    radarrLibraryStatus: null,
                    ...(posterUrl ? { posterUrl } : {}),
                };
                byKey[`music:${mbid}`] = entry;
                musicCount += 1;
                if (i > 0 && i % 50 === 0) await yieldEventLoop();
            }
        }

        return {
            movieCount,
            tvCount,
            musicCount,
            itemCount: Object.keys(byKey).length,
            byKey,
        };
    };

    return {
        getMediaStatus,
        getMusicStatus,
        getTvListStatus,
        getMovieStatus,
        enrichItems,
        enrichDetails,
        filterAvailable,
        snapshotLibraryStatuses,
        /** Test / ops helpers */
        _caches: {
            movieCatalogCache,
            seriesCatalogCache,
            artistCatalogCache,
            queueCache,
            movieStatusCache,
        },
    };
};

export default createLibraryAvailability;
