import {
    fetchArrInstanceJson,
    fetchArrQueueSummary,
    fetchSonarrEpisodesForSeries,
    fetchSonarrSeriesById,
    getArrInstance,
    getArrInstances,
    isArrInstanceReady,
    lookupSonarrSeriesByTmdb,
    lookupSonarrSeriesByTvdb,
} from './arr-service.js';
import {
    buildSonarrSeriesIndexes,
    matchSonarrSeriesFromIndexes,
    resolveTvdbIdFromTmdb,
} from './portal-request/sonarrSeriesMatch.js';
import { leanSonarrSeriesList } from './portal-request/leanArrCatalog.js';

const SEERR_MEDIA_PARTIAL = 4;
const SEERR_MEDIA_AVAILABLE = 5;

const SERIES_LIST_CACHE_MS = 5 * 60 * 1000;
const STATUS_CACHE_MS = 90 * 1000;
const seriesListCache = new Map();
const seriesIndexCache = new Map();
const sonarrStatusCache = new Map();
const SONARR_STATUS_CACHE_MAX_ENTRIES = 500;

const getCachedStatus = (tmdbId) => {
    const key = String(tmdbId);
    const cached = sonarrStatusCache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.at >= STATUS_CACHE_MS) {
        sonarrStatusCache.delete(key);
        return null;
    }
    return cached.value;
};

const pruneSonarrStatusCache = () => {
    const now = Date.now();
    for (const [key, entry] of sonarrStatusCache.entries()) {
        if (!entry || now - entry.at >= STATUS_CACHE_MS) sonarrStatusCache.delete(key);
    }
    while (sonarrStatusCache.size > SONARR_STATUS_CACHE_MAX_ENTRIES) {
        const oldest = sonarrStatusCache.keys().next().value;
        if (oldest === undefined) break;
        sonarrStatusCache.delete(oldest);
    }
};

const setCachedStatus = (tmdbId, value) => {
    sonarrStatusCache.set(String(tmdbId), { at: Date.now(), value });
    pruneSonarrStatusCache();
};

const episodeHasAired = (episode = {}) => {
    const raw = episode.airDateUtc || episode.airDate;
    // No air date → not aired yet. Counting these as aired falsely marked complete
    // Sonarr libraries (e.g. ended shows) as Partial / "still airing".
    if (!raw) return false;
    const parsed = Date.parse(raw);
    if (Number.isNaN(parsed)) return false;
    return parsed <= Date.now();
};

/** Group Sonarr episodes into per-season file counts (excludes specials by default). */
export const buildSonarrSeasonAvailability = (episodes = [], {
    includeSpecials = false,
    /** Match Sonarr UI: only monitored episodes count toward "on disk". */
    monitoredOnly = true,
} = {}) => {
    const bySeason = new Map();

    for (const episode of Array.isArray(episodes) ? episodes : []) {
        const seasonNumber = Number(episode?.seasonNumber);
        if (!Number.isFinite(seasonNumber)) continue;
        if (!includeSpecials && seasonNumber === 0) continue;
        if (monitoredOnly && episode?.monitored === false) continue;

        if (!bySeason.has(seasonNumber)) {
            bySeason.set(seasonNumber, {
                seasonNumber,
                total: 0,
                withFile: 0,
                airedTotal: 0,
                airedWithFile: 0,
            });
        }

        const bucket = bySeason.get(seasonNumber);
        bucket.total += 1;
        if (episode.hasFile) bucket.withFile += 1;
        if (episodeHasAired(episode)) {
            bucket.airedTotal += 1;
            if (episode.hasFile) bucket.airedWithFile += 1;
        }
    }

    return Array.from(bySeason.values())
        .sort((a, b) => a.seasonNumber - b.seasonNumber)
        .map((season) => ({
            ...season,
        // Complete = every monitored aired episode has a file (Sonarr "up to date").
        complete: season.airedTotal > 0
            ? season.airedWithFile >= season.airedTotal
            : false,
        }));
};

const loadCachedSeriesList = async (instance, fetchOpts) => {
    const cacheKey = String(instance?.id || instance?.url || '');
    const cached = seriesListCache.get(cacheKey);
    if (cached && Date.now() - cached.at < SERIES_LIST_CACHE_MS) {
        return cached.list;
    }
    if (cached) {
        seriesListCache.delete(cacheKey);
        seriesIndexCache.delete(cacheKey);
    }

    const list = await fetchArrInstanceJson(instance, '/api/v3/series', fetchOpts);
    const normalized = leanSonarrSeriesList(Array.isArray(list) ? list : []);
    seriesListCache.set(cacheKey, { at: Date.now(), list: normalized });
    seriesIndexCache.set(cacheKey, { at: Date.now(), indexes: buildSonarrSeriesIndexes(normalized, instance) });

    return normalized;
};

const loadCachedSeriesIndexes = async (instance, fetchOpts) => {
    const cacheKey = String(instance?.id || instance?.url || '');
    const indexed = seriesIndexCache.get(cacheKey);
    if (indexed && Date.now() - indexed.at < SERIES_LIST_CACHE_MS) return indexed.indexes;
    await loadCachedSeriesList(instance, fetchOpts);
    return seriesIndexCache.get(cacheKey)?.indexes || buildSonarrSeriesIndexes([], instance);
};

const findSeriesInInstance = async (instance, tmdbId, fetchOpts, {
    config = null,
    title = '',
    year = null,
    tvdbId: tvdbIdHint = null,
} = {}) => {
    const indexes = await loadCachedSeriesIndexes(instance, fetchOpts);
    const matched = await matchSonarrSeriesFromIndexes(config || {}, tmdbId, indexes, {
        fetchImpl: fetchOpts?.fetchImpl || fetch,
        title,
        year,
        tvdbId: tvdbIdHint,
    });
    if (matched?.series?.id) return matched.series;
    if (matched?.id) return matched;

    // Sonarr lookup: when the series is already in the library, the result includes `id`.
    try {
        const lookup = await lookupSonarrSeriesByTmdb(instance, tmdbId, fetchOpts);
        if (lookup?.id) return lookup;

        const lookupTvdb = Number(lookup?.tvdbId);
        if (Number.isFinite(lookupTvdb) && lookupTvdb > 0 && indexes.byTvdb.has(lookupTvdb)) {
            const hit = indexes.byTvdb.get(lookupTvdb);
            return hit?.series || hit;
        }
    } catch {
        // Ignore lookup failures; try TVDB next.
    }

    // TVDB path: TMDB external_ids → Sonarr tvdb: lookup / catalog index.
    if (config) {
        const hinted = Number(tvdbIdHint);
        const tvdbId = (Number.isFinite(hinted) && hinted > 0)
            ? hinted
            : await resolveTvdbIdFromTmdb(config, tmdbId, { fetchImpl: fetchOpts?.fetchImpl || fetch });
        if (tvdbId) {
            if (indexes.byTvdb.has(tvdbId)) {
                const hit = indexes.byTvdb.get(tvdbId);
                return hit?.series || hit;
            }
            try {
                const lookup = await lookupSonarrSeriesByTvdb(instance, tvdbId, fetchOpts);
                if (lookup?.id) return lookup;
            } catch {
                // Ignore.
            }
        }
    }

    return null;
};

export const resolveSonarrSeriesForTmdbShow = async (config, tmdbId, {
    resolveUrl,
    fetchImpl,
    upgraderItems = [],
    title = '',
    year = null,
    tvdbId = null,
} = {}) => {
    const id = Number(tmdbId);
    if (!Number.isFinite(id) || id <= 0) return null;

    const indexHit = (Array.isArray(upgraderItems) ? upgraderItems : []).find(
        (item) => item?.mediaType === 'show'
            && Number(item?.tmdbId) === id
            && item?.arrInstanceId
            && item?.arrEntityId,
    );
    if (indexHit) {
        const instance = getArrInstance(config, indexHit.arrInstanceId);
        if (isArrInstanceReady(instance)) {
            return {
                instance,
                seriesId: Number(indexHit.arrEntityId),
                source: 'upgrader-index',
            };
        }
    }

    const fetchOpts = { resolveUrl, fetchImpl };
    for (const instance of getArrInstances(config, { type: 'sonarr', enabledOnly: true })) {
        if (!isArrInstanceReady(instance)) continue;
        const series = await findSeriesInInstance(instance, id, fetchOpts, {
            config,
            title,
            year,
            tvdbId,
        });
        if (series?.id) {
            return {
                instance,
                seriesId: Number(series.id),
                series,
                source: 'sonarr',
            };
        }
    }

    return null;
};

const isShowCompleteFromStatistics = (series = {}) => {
    const stats = series?.statistics || {};
    const episodeFileCount = Number(stats.episodeFileCount) || 0;
    if (episodeFileCount <= 0) return false;
    // Sonarr episodeCount is monitored-only. Prefer totalEpisodeCount so unmonitored
    // missing episodes still count as incomplete (Partial), not "Up to date".
    const monitored = Number(stats.episodeCount) || 0;
    const total = Number(stats.totalEpisodeCount) || 0;
    const expected = Math.max(monitored, total);
    if (expected <= 0) return false;
    if (total > monitored && episodeFileCount < total) return false;
    const percent = Number(stats.percentOfEpisodes);
    if (Number.isFinite(percent) && percent < 100) return false;
    return episodeFileCount >= expected;
};

/** True when Sonarr still has queue rows for this series (downloading, importing, stalled, etc.). */
const seriesHasActiveQueue = async (instance, seriesId, fetchOpts) => {
    const id = Number(seriesId);
    if (!Number.isFinite(id) || id <= 0) return false;

    try {
        const filtered = await fetchArrInstanceJson(
            instance,
            `/api/v3/queue?seriesIds=${id}&page=1&pageSize=50&includeEpisode=false`,
            fetchOpts,
        );
        const filteredRecords = Array.isArray(filtered?.records)
            ? filtered.records
            : (Array.isArray(filtered) ? filtered : []);
        if (filteredRecords.some((row) => Number(row?.seriesId) === id)) return true;
    } catch {
        // Fall through to full queue summary.
    }

    try {
        const summary = await fetchArrQueueSummary(instance, fetchOpts);
        return (summary.records || []).some((row) => Number(row?.seriesId) === id);
    } catch {
        return false;
    }
};

export const fetchSonarrLibraryStatusForShow = async (config, tmdbId, opts = {}) => {
    const id = Number(tmdbId);
    if (!Number.isFinite(id) || id <= 0) return { matched: false };

    const cached = getCachedStatus(id);
    if (cached) return cached;

    const resolved = await resolveSonarrSeriesForTmdbShow(config, id, opts);
    if (!resolved) {
        // Do not cache misses — TVDB/lookup fallbacks and catalog warms change quickly.
        return { matched: false };
    }

    const fetchOpts = { resolveUrl: opts.resolveUrl, fetchImpl: opts.fetchImpl };
    const series = resolved.series
        || await fetchSonarrSeriesById(resolved.instance, resolved.seriesId, fetchOpts);

    let seasons = [];
    let showComplete = false;

    // Always verify with per-episode aired/file counts. Monitored-only statistics
    // falsely mark selective libraries (e.g. Lucky) as fully complete / "Up to date".
    const episodes = await fetchSonarrEpisodesForSeries(resolved.instance, resolved.seriesId, fetchOpts);
    // Include unmonitored episodes — ended libraries often unmonitor seasons after
    // completion; monitored-only falsely reports 0 aired / incomplete.
    seasons = buildSonarrSeasonAvailability(episodes, { monitoredOnly: false });
    const mainSeasons = seasons.filter((season) => season.seasonNumber > 0);
    const airedMain = mainSeasons.filter((season) => Number(season.airedTotal) > 0);
    const totalAiredEpisodes = seasons.reduce((n, s) => n + (Number(s.airedTotal) || 0), 0);
    showComplete = airedMain.length > 0
        && airedMain.every((season) => season.complete);

    // Unmonitored complete libraries may yield empty airedMain while statistics
    // still report 100% episode files on disk.
    if (!showComplete && totalAiredEpisodes === 0 && mainSeasons.length > 0) {
        showComplete = mainSeasons.every((season) => season.complete);
    }
    if (!showComplete && isShowCompleteFromStatistics(series)) {
        const fileCount = seasons.reduce(
            (n, s) => n + (Number(s.airedWithFile) || Number(s.withFile) || 0),
            0,
        ) || Number(series?.statistics?.episodeFileCount) || 0;
        if (fileCount > 0) showComplete = true;
    }

    const hasActiveDownloads = await seriesHasActiveQueue(
        resolved.instance,
        resolved.seriesId,
        fetchOpts,
    );
    if (hasActiveDownloads) showComplete = false;

    const result = {
        matched: true,
        seriesId: resolved.seriesId,
        instanceId: resolved.instance.id,
        instanceName: resolved.instance.name || 'Sonarr',
        source: resolved.source,
        showComplete,
        hasActiveDownloads,
        seasons,
        episodeCount: seasons.reduce((n, s) => n + (Number(s.airedTotal) || Number(s.total) || 0), 0)
            || Number(series?.statistics?.episodeCount)
            || 0,
        fileCount: seasons.reduce((n, s) => n + (Number(s.airedWithFile) || Number(s.withFile) || 0), 0)
            || Number(series?.statistics?.episodeFileCount)
            || 0,
        seriesStatus: series?.status || null,
        nextAiring: series?.nextAiring || series?.nextAiringUtc || null,
    };

    setCachedStatus(id, result);
    return result;
};

export const applySonarrLibraryStatusToTvDetails = (details, sonarrStatus) => {
    if (!sonarrStatus?.matched || !details || typeof details !== 'object') return details;

    const mediaInfo = { ...(details.mediaInfo || {}) };
    const librarySeasons = Array.isArray(mediaInfo.seasons) ? [...mediaInfo.seasons] : [];
    const bySeason = new Map(
        librarySeasons.map((season) => [Number(season?.seasonNumber), { ...season }]),
    );

    for (const season of sonarrStatus.seasons || []) {
        const seasonNumber = Number(season?.seasonNumber);
        if (!Number.isFinite(seasonNumber) || seasonNumber <= 0) continue;
        if (!(season.airedTotal > 0 || season.withFile > 0)) continue;

        const nextStatus = season.complete ? SEERR_MEDIA_AVAILABLE : SEERR_MEDIA_PARTIAL;
        const existing = bySeason.get(seasonNumber);
        if (existing) {
            if (season.complete || Number(existing.status) !== SEERR_MEDIA_AVAILABLE) {
                existing.status = nextStatus;
            }
            bySeason.set(seasonNumber, existing);
        } else {
            bySeason.set(seasonNumber, { seasonNumber, status: nextStatus });
        }
    }

    mediaInfo.seasons = Array.from(bySeason.values()).sort(
        (a, b) => Number(a.seasonNumber) - Number(b.seasonNumber),
    );

    if (sonarrStatus.showComplete && !sonarrStatus.hasActiveDownloads) {
        mediaInfo.status = SEERR_MEDIA_AVAILABLE;
    } else if (mainSeasonsHaveFiles(sonarrStatus.seasons)) {
        mediaInfo.status = SEERR_MEDIA_PARTIAL;
    }

    return {
        ...details,
        mediaInfo,
        sonarrLibraryStatus: sonarrStatus,
    };
};

const mainSeasonsHaveFiles = (seasons = []) => (
    seasons.some((season) => Number(season?.seasonNumber) > 0 && Number(season?.withFile) > 0)
);

export const enrichTvDetailsWithSonarrLibraryStatus = async (config, details, opts = {}) => {
    if (!details || typeof details !== 'object') return details;
    const tmdbId = Number(details.id ?? details.tmdbId);
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) return details;

    const yearRaw = String(details.firstAirDate || details.releaseDate || '').slice(0, 4);
    const year = Number(yearRaw);
    const sonarrStatus = await fetchSonarrLibraryStatusForShow(config, tmdbId, {
        ...opts,
        title: details.name || details.title || '',
        year: Number.isFinite(year) && year > 1900 ? year : null,
    });
    if (!sonarrStatus.matched) return details;

    return applySonarrLibraryStatusToTvDetails(details, sonarrStatus);
};
