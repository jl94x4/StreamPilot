/**
 * Sonarr series matching helpers.
 * Sonarr is TVDB-first; many library entries have tvdbId but missing/zero tmdbId,
 * so TMDB-only indexes miss shows that are clearly on disk.
 */

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TVDB_FROM_TMDB_CACHE_MS = 24 * 60 * 60 * 1000;
const TMDB_FROM_TVDB_CACHE_MS = 24 * 60 * 60 * 1000;

const tvdbFromTmdbCache = new Map(); // tmdbId → { at, tvdbId }
const tmdbFromTvdbCache = new Map(); // tvdbId → { at, tmdbId }
const CROSS_REF_CACHE_MAX_ENTRIES = 2000;

const now = () => Date.now();

const pruneCrossRefCache = (cache, ttlMs) => {
    const t = now();
    for (const [key, entry] of cache.entries()) {
        if (!entry || t - entry.at >= ttlMs) cache.delete(key);
    }
    while (cache.size > CROSS_REF_CACHE_MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
    }
};

const tmdbApiKey = (config = {}) => String(config?.tmdbApiKey || '').trim();

export const normalizeSeriesTitleKey = (title = '', year = null) => {
    const cleaned = String(title || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        // Drop apostrophes so "Britain's" matches Sonarr "Britains".
        .replace(/['\u2018\u2019\u0060]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
    const y = Number(year);
    return Number.isFinite(y) && y > 1900 ? `${cleaned}|${y}` : cleaned;
};

export const seriesYearFromSonarr = (series = {}) => {
    const raw = series?.year ?? series?.firstAired ?? series?.premiereDate ?? '';
    const year = Number(series?.year);
    if (Number.isFinite(year) && year > 1900) return year;
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return new Date(parsed).getUTCFullYear();
    return null;
};

/** True when a catalog hit is a remake/sequel/wrong TMDB id — not this show. */
export const seriesConflictsRequestedShow = (series = {}, { tmdbId = null, year = null } = {}) => {
    const requestedTmdb = Number(tmdbId);
    const seriesTmdb = Number(series?.tmdbId);
    if (
        Number.isFinite(requestedTmdb) && requestedTmdb > 0
        && Number.isFinite(seriesTmdb) && seriesTmdb > 0
        && seriesTmdb !== requestedTmdb
    ) {
        return true;
    }
    const requestedYear = Number(year);
    const seriesYear = seriesYearFromSonarr(series);
    if (
        Number.isFinite(requestedYear) && requestedYear > 1900
        && Number.isFinite(seriesYear) && seriesYear > 1900
        && Math.abs(seriesYear - requestedYear) > 2
    ) {
        return true;
    }
    return false;
};

/** Build TMDB + TVDB + title indexes for a Sonarr series list. */
export const buildSonarrSeriesIndexes = (list = [], instance = null) => {
    const byTmdb = new Map();
    const byTvdb = new Map();
    const byTitleYear = new Map();

    const indexTitle = (title, year, entry) => {
        const titleYearKey = normalizeSeriesTitleKey(title, year);
        if (titleYearKey && !byTitleYear.has(titleYearKey)) {
            byTitleYear.set(titleYearKey, entry);
        }
        const titleOnlyKey = normalizeSeriesTitleKey(title, null);
        if (titleOnlyKey && !byTitleYear.has(titleOnlyKey)) {
            byTitleYear.set(titleOnlyKey, entry);
        }
    };

    for (const series of Array.isArray(list) ? list : []) {
        const entry = instance ? { series, instance } : series;
        const tmdb = Number(series?.tmdbId);
        if (Number.isFinite(tmdb) && tmdb > 0 && !byTmdb.has(tmdb)) {
            byTmdb.set(tmdb, entry);
        }
        const tvdb = Number(series?.tvdbId);
        if (Number.isFinite(tvdb) && tvdb > 0 && !byTvdb.has(tvdb)) {
            byTvdb.set(tvdb, entry);
        }
        const year = seriesYearFromSonarr(series);
        indexTitle(series?.title || series?.sortTitle, year, entry);
        for (const alt of Array.isArray(series?.alternateTitles) ? series.alternateTitles : []) {
            indexTitle(alt?.title || alt?.sceneName || alt, year, entry);
        }
    }
    return { byTmdb, byTvdb, byTitleYear };
};

export const resolveTvdbIdFromTmdb = async (config, tmdbId, { fetchImpl = fetch, timeoutMs = 5000 } = {}) => {
    const id = Number(tmdbId);
    if (!Number.isFinite(id) || id <= 0) return null;

    const cached = tvdbFromTmdbCache.get(id);
    if (cached) {
        if (now() - cached.at < TVDB_FROM_TMDB_CACHE_MS) return cached.tvdbId;
        tvdbFromTmdbCache.delete(id);
    }

    const apiKey = tmdbApiKey(config);
    if (!apiKey) {
        tvdbFromTmdbCache.set(id, { at: now(), tvdbId: null });
        pruneCrossRefCache(tvdbFromTmdbCache, TVDB_FROM_TMDB_CACHE_MS);
        return null;
    }

    const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : 5000;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), ms) : null;
    try {
        const response = await fetchImpl(
            `${TMDB_API_BASE}/tv/${id}/external_ids?api_key=${encodeURIComponent(apiKey)}`,
            {
                headers: { Accept: 'application/json' },
                ...(controller ? { signal: controller.signal } : {}),
                ...(ms > 0 ? { timeoutMs: ms } : {}),
            },
        );
        if (!response.ok) {
            tvdbFromTmdbCache.set(id, { at: now(), tvdbId: null });
            return null;
        }
        const data = await response.json();
        const tvdbId = Number(data?.tvdb_id);
        const resolved = Number.isFinite(tvdbId) && tvdbId > 0 ? tvdbId : null;
        tvdbFromTmdbCache.set(id, { at: now(), tvdbId: resolved });
        pruneCrossRefCache(tvdbFromTmdbCache, TVDB_FROM_TMDB_CACHE_MS);
        return resolved;
    } catch {
        tvdbFromTmdbCache.set(id, { at: now(), tvdbId: null });
        pruneCrossRefCache(tvdbFromTmdbCache, TVDB_FROM_TMDB_CACHE_MS);
        return null;
    } finally {
        if (timer) clearTimeout(timer);
    }
};

export const resolveTmdbIdFromTvdb = async (config, tvdbId, { fetchImpl = fetch } = {}) => {
    const id = Number(tvdbId);
    if (!Number.isFinite(id) || id <= 0) return null;

    const cached = tmdbFromTvdbCache.get(id);
    if (cached) {
        if (now() - cached.at < TMDB_FROM_TVDB_CACHE_MS) return cached.tmdbId;
        tmdbFromTvdbCache.delete(id);
    }

    const apiKey = tmdbApiKey(config);
    if (!apiKey) {
        tmdbFromTvdbCache.set(id, { at: now(), tmdbId: null });
        pruneCrossRefCache(tmdbFromTvdbCache, TMDB_FROM_TVDB_CACHE_MS);
        return null;
    }

    try {
        const response = await fetchImpl(
            `${TMDB_API_BASE}/find/${id}?api_key=${encodeURIComponent(apiKey)}&external_source=tvdb_id`,
            { headers: { Accept: 'application/json' } },
        );
        if (!response.ok) {
            tmdbFromTvdbCache.set(id, { at: now(), tmdbId: null });
            return null;
        }
        const data = await response.json();
        const hit = Array.isArray(data?.tv_results) ? data.tv_results[0] : null;
        const tmdbId = Number(hit?.id);
        const resolved = Number.isFinite(tmdbId) && tmdbId > 0 ? tmdbId : null;
        tmdbFromTvdbCache.set(id, { at: now(), tmdbId: resolved });
        pruneCrossRefCache(tmdbFromTvdbCache, TMDB_FROM_TVDB_CACHE_MS);
        return resolved;
    } catch {
        tmdbFromTvdbCache.set(id, { at: now(), tmdbId: null });
        pruneCrossRefCache(tmdbFromTvdbCache, TMDB_FROM_TVDB_CACHE_MS);
        return null;
    }
};

const imdbFromTmdbCache = new Map(); // `movie:123` → { at, imdbId }
const IMDB_FROM_TMDB_CACHE_MS = 24 * 60 * 60 * 1000;

/** Radarr is IMDB-friendly when tmdbId is missing/wrong on a library row. */
export const resolveImdbIdFromTmdb = async (config, tmdbId, {
    mediaType = 'movie',
    fetchImpl = fetch,
} = {}) => {
    const id = Number(tmdbId);
    const type = mediaType === 'tv' ? 'tv' : 'movie';
    if (!Number.isFinite(id) || id <= 0) return null;

    const cacheKey = `${type}:${id}`;
    const cached = imdbFromTmdbCache.get(cacheKey);
    if (cached) {
        if (now() - cached.at < IMDB_FROM_TMDB_CACHE_MS) return cached.imdbId;
        imdbFromTmdbCache.delete(cacheKey);
    }

    const apiKey = tmdbApiKey(config);
    if (!apiKey) {
        imdbFromTmdbCache.set(cacheKey, { at: now(), imdbId: null });
        pruneCrossRefCache(imdbFromTmdbCache, IMDB_FROM_TMDB_CACHE_MS);
        return null;
    }

    try {
        const response = await fetchImpl(
            `${TMDB_API_BASE}/${type}/${id}/external_ids?api_key=${encodeURIComponent(apiKey)}`,
            { headers: { Accept: 'application/json' } },
        );
        if (!response.ok) {
            imdbFromTmdbCache.set(cacheKey, { at: now(), imdbId: null });
            return null;
        }
        const data = await response.json();
        const imdbId = String(data?.imdb_id || '').trim();
        const resolved = imdbId || null;
        imdbFromTmdbCache.set(cacheKey, { at: now(), imdbId: resolved });
        pruneCrossRefCache(imdbFromTmdbCache, IMDB_FROM_TMDB_CACHE_MS);
        return resolved;
    } catch {
        imdbFromTmdbCache.set(cacheKey, { at: now(), imdbId: null });
        pruneCrossRefCache(imdbFromTmdbCache, IMDB_FROM_TMDB_CACHE_MS);
        return null;
    }
};

/**
 * Resolve a Sonarr series from indexes using TMDB id, with TVDB + title fallbacks.
 * @returns {{ series, instance } | null}
 */
export const matchSonarrSeriesFromIndexes = async (config, tmdbId, indexes, {
    fetchImpl = fetch,
    title = '',
    year = null,
    tvdbId: tvdbIdHint = null,
    preferTvdb = null,
    isAnime = false,
} = {}) => {
    const id = Number(tmdbId);
    if (!Number.isFinite(id) || id <= 0) return null;

    const byTmdb = indexes?.byTmdb || new Map();
    const byTvdb = indexes?.byTvdb || new Map();
    const byTitleYear = indexes?.byTitleYear || new Map();

    let provider = isAnime
        ? String(config?.animeMetadataProvider || 'tmdb').toLowerCase()
        : String(config?.seriesMetadataProvider || 'tmdb').toLowerCase();
    if (preferTvdb === true) provider = 'tvdb';
    if (preferTvdb === false) provider = 'tmdb';
    const tvdbFirst = provider === 'tvdb';

    const tryTvdb = async () => {
        const hintedTvdb = Number(tvdbIdHint);
        if (Number.isFinite(hintedTvdb) && hintedTvdb > 0 && byTvdb.has(hintedTvdb)) {
            return byTvdb.get(hintedTvdb);
        }
        const tvdbId = await resolveTvdbIdFromTmdb(config, id, { fetchImpl });
        if (tvdbId && byTvdb.has(tvdbId)) return byTvdb.get(tvdbId);
        return null;
    };

    const tryTmdb = () => byTmdb.get(id) || null;

    const accept = (hit) => {
        if (!hit) return null;
        const series = hit.series || hit;
        if (seriesConflictsRequestedShow(series, { tmdbId: id, year })) return null;
        return hit;
    };

    if (tvdbFirst) {
        const viaTvdb = accept(await tryTvdb());
        if (viaTvdb) return viaTvdb;
        const viaTmdb = accept(tryTmdb());
        if (viaTmdb) return viaTmdb;
    } else {
        const viaTmdb = accept(tryTmdb());
        if (viaTmdb) return viaTmdb;
        const viaTvdb = accept(await tryTvdb());
        if (viaTvdb) return viaTvdb;
    }

    if (title) {
        const requestedYear = Number(year);
        const hasYear = Number.isFinite(requestedYear) && requestedYear > 1900;
        const keyWithYear = hasYear ? normalizeSeriesTitleKey(title, requestedYear) : '';
        if (keyWithYear && byTitleYear.has(keyWithYear)) {
            const viaTitleYear = byTitleYear.get(keyWithYear);
            if (!seriesConflictsRequestedShow(viaTitleYear?.series || viaTitleYear, { tmdbId: id, year: requestedYear })) {
                return viaTitleYear;
            }
        }
        // Title-only matching collapses remakes/sequels ("The Librarians" vs
        // "The Librarians: The Next Chapter" can share a prefix index). Only use
        // it when TMDB did not give us a premiere year to disambiguate.
        if (!hasYear) {
            const keyNoYear = normalizeSeriesTitleKey(title, null);
            if (keyNoYear && byTitleYear.has(keyNoYear)) {
                const viaTitle = byTitleYear.get(keyNoYear);
                if (!seriesConflictsRequestedShow(viaTitle?.series || viaTitle, { tmdbId: id, year: requestedYear })) {
                    return viaTitle;
                }
            }
        }
    }

    return null;
};

export default {
    normalizeSeriesTitleKey,
    seriesYearFromSonarr,
    buildSonarrSeriesIndexes,
    resolveTvdbIdFromTmdb,
    resolveTmdbIdFromTvdb,
    resolveImdbIdFromTmdb,
    matchSonarrSeriesFromIndexes,
    seriesConflictsRequestedShow,
};
