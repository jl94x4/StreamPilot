import { pickPlayerTmdbId, safePlexLibraryPath } from './mapItem.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const EMPTY_CACHE_MS = 5 * 60 * 1000;
const HERO_LIMIT = 15;
const TRENDING_SCAN = 40;
const SEASONAL_SCAN = 40;
/** Native Plex art — full HD canvas, lossless JPEG quality for hero sharpness. */
const HERO_PLEX_WIDTH = 1920;
const HERO_PLEX_HEIGHT = 1080;
const HERO_PLEX_QUALITY = 100;
/** TMDB original — no CDN downscale; heroes deserve full fidelity. */
const TMDB_BACKDROP_SIZE = 'original';

/** @type {{ key: string, expiresAt: number, payload: object } | null} */
let heroCache = null;

export const MEDIA_PLAYER_HOME_HERO_MODES = [
    'off',
    'trending_week',
    'continue_watching',
    'seasonal_halloween',
    'seasonal_christmas',
    'seasonal_nye',
    'seasonal_easter',
    'seasonal_thanksgiving',
    'recently_added',
    'most_watched',
    'unwatched_picks',
    'new_releases',
    'random_spotlight',
];

const MODE_SET = new Set(MEDIA_PLAYER_HOME_HERO_MODES);

const SEASONAL_MODES = new Set([
    'seasonal_halloween',
    'seasonal_christmas',
    'seasonal_nye',
    'seasonal_easter',
    'seasonal_thanksgiving',
]);

const SEASONAL_QUERIES = {
    seasonal_halloween: ['halloween', 'horror', 'scary movie'],
    seasonal_christmas: ['christmas', 'holiday', 'xmas', 'santa'],
    // Avoid vague terms like "celebration" — they crowd out titles that exist in libraries.
    seasonal_nye: ["new year's eve", 'new year', "new year's day", 'new years'],
    seasonal_easter: ['easter', 'easter bunny', 'peter rabbit', 'hop'],
    seasonal_thanksgiving: ['thanksgiving', 'family dinner'],
};

/** TMDB keyword search terms for /discover (resolved at runtime). */
const SEASONAL_KEYWORDS = {
    seasonal_halloween: ['halloween'],
    seasonal_christmas: ['christmas'],
    seasonal_nye: ['new year', "new year's eve"],
    seasonal_easter: ['easter'],
    seasonal_thanksgiving: ['thanksgiving'],
};

/**
 * Well-known TMDB IDs so NYE/Easter still have candidates when multi-search is thin.
 * Matching still requires the title in the Plex library (or Plex search fallback).
 */
const SEASONAL_SEED_IDS = {
    seasonal_nye: [
        { id: 55499, type: 'movie' }, // New Year's Eve (2011)
        { id: 639, type: 'movie' }, // When Harry Met Sally...
        { id: 10559, type: 'movie' }, // 200 Cigarettes
        { id: 313369, type: 'movie' }, // La La Land
        { id: 161, type: 'movie' }, // Ocean's Eleven
        { id: 434, type: 'movie' }, // Singin' in the Rain
        { id: 4922, type: 'movie' }, // The Curious Case of Benjamin Button
    ],
    seasonal_easter: [
        { id: 38579, type: 'movie' }, // Hop
        { id: 321303, type: 'movie' }, // Peter Rabbit
        { id: 11324, type: 'movie' }, // Easter Parade
        { id: 1904, type: 'movie' }, // The Passion of the Christ
        { id: 49013, type: 'movie' }, // Rise of the Guardians
        { id: 227306, type: 'movie' }, // The Dog Who Saved Easter
        { id: 228970, type: 'movie' }, // Here Comes Peter Cottontail: The Movie
    ],
};

const tmdbImg = (path, size = TMDB_BACKDROP_SIZE) => {
    const raw = String(path || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    const normalized = raw.startsWith('/') ? raw : `/${raw}`;
    return `https://image.tmdb.org/t/p/${size}${normalized}`;
};

const pickBestTmdbBackdropPath = (backdrops = [], fallbackPath = '') => {
    const list = [].concat(backdrops || []).filter((row) => String(row?.file_path || '').trim());
    if (!list.length) return String(fallbackPath || '').trim();
    list.sort((a, b) => {
        const widthDelta = (Number(b.width) || 0) - (Number(a.width) || 0);
        if (widthDelta) return widthDelta;
        return (Number(b.vote_average) || 0) - (Number(a.vote_average) || 0);
    });
    return String(list[0].file_path || fallbackPath || '').trim();
};

const fetchBestTmdbBackdropUrl = async (fetchImpl, apiKey, tmdbId, mediaType) => {
    const key = String(apiKey || '').trim();
    const id = Number(tmdbId);
    if (!key || key === '********' || !Number.isFinite(id) || id <= 0) return '';
    const kind = mediaType === 'show' || mediaType === 'tv' ? 'tv' : 'movie';
    const res = await fetchImpl(
        `https://api.themoviedb.org/3/${kind}/${id}/images?api_key=${encodeURIComponent(key)}`,
    ).catch(() => null);
    if (!res?.ok) return '';
    const json = await res.json().catch(() => null);
    const path = pickBestTmdbBackdropPath(json?.backdrops);
    return path ? tmdbImg(path, TMDB_BACKDROP_SIZE) : '';
};

const guidCandidatesFor = (tmdbId) => {
    const id = Number(tmdbId);
    if (!Number.isFinite(id) || id <= 0) return [];
    return [
        `tmdb://${id}`,
        `com.plexapp.agents.themoviedb://${id}?lang=en`,
        `tmdb://${id}?lang=en`,
        `com.plexapp.agents.themoviedb://${id}`,
    ];
};

const metaMatchesTmdb = (meta, tmdbId) => {
    const needle = String(tmdbId);
    if (!needle || !meta) return false;
    const guidBlob = [
        meta.guid,
        meta.grandparentGuid,
        ...(Array.isArray(meta.Guid) ? meta.Guid.map((g) => g?.id || g) : []),
    ].map((v) => String(v || '')).join(' ').toLowerCase();
    return guidBlob.includes(`tmdb://${needle}`)
        || guidBlob.includes(`themoviedb://${needle}`)
        || guidBlob.includes(`tmdb:${needle}`);
};

const normalizeTitle = (value) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const titlesClose = (a, b) => {
    const left = normalizeTitle(a);
    const right = normalizeTitle(b);
    if (!left || !right) return false;
    return left === right || left.includes(right) || right.includes(left);
};

const metadataList = (payload) => {
    const list = payload?.MediaContainer?.Metadata;
    if (Array.isArray(list)) return list;
    if (list && typeof list === 'object') return [list];
    return [];
};

const directoryList = (payload) => [].concat(payload?.MediaContainer?.Directory || []);

/** Western (Gregorian) Easter Sunday for a given year. */
export const easterSundayUtc = (year) => {
    const y = Math.floor(Number(year));
    const a = y % 19;
    const b = Math.floor(y / 100);
    const c = y % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(y, month - 1, day));
};

const ymdUtc = (date) => {
    const d = date instanceof Date ? date : new Date(date);
    return {
        y: d.getUTCFullYear(),
        m: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
        time: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    };
};

const inInclusiveRange = (now, start, end) => {
    const t = ymdUtc(now).time;
    return t >= start && t <= end;
};

export const isSeasonalHeroMode = (mode) => SEASONAL_MODES.has(String(mode || ''));

export const isSeasonalHeroInWindow = (mode, now = new Date()) => {
    const id = String(mode || '');
    const { y, m, day, time } = ymdUtc(now);
    if (id === 'seasonal_halloween') {
        return m === 10 && day >= 1 && day <= 31;
    }
    if (id === 'seasonal_christmas') {
        const start = Date.UTC(y, 10, 20);
        const end = Date.UTC(y, 11, 26);
        return inInclusiveRange(now, start, end);
    }
    if (id === 'seasonal_nye') {
        // Dec 26 – Jan 4 (spans year boundary).
        if (m === 12 && day >= 26) return true;
        if (m === 1 && day <= 4) return true;
        return false;
    }
    if (id === 'seasonal_thanksgiving') {
        return m === 11 && day >= 15 && day <= 30;
    }
    if (id === 'seasonal_easter') {
        // Roughly Palm Sunday week through the Sunday after Easter.
        const easter = easterSundayUtc(y);
        const start = new Date(easter.getTime() - 14 * DAY_MS);
        const end = new Date(easter.getTime() + 7 * DAY_MS);
        return time >= ymdUtc(start).time && time <= ymdUtc(end).time;
    }
    return false;
};

/**
 * Resolve configured mode. Legacy `mediaPlayerHomeHeroEnabled: false` → off.
 */
export const normalizeMediaPlayerHomeHeroMode = (config = {}) => {
    if (config.mediaPlayerHomeHeroEnabled === false && config.mediaPlayerHomeHeroMode == null) {
        return 'off';
    }
    const raw = String(config.mediaPlayerHomeHeroMode || '').trim();
    if (MODE_SET.has(raw)) return raw;
    if (config.mediaPlayerHomeHeroEnabled === false) return 'off';
    return 'trending_week';
};

export const isMediaPlayerHomeHeroEnabled = (config = {}) => (
    normalizeMediaPlayerHomeHeroMode(config) !== 'off'
);

export const resolveEffectiveHeroMode = (config = {}, now = new Date()) => {
    const mode = normalizeMediaPlayerHomeHeroMode(config);
    if (mode === 'off') return 'off';
    const inWindowOnly = config.mediaPlayerHomeHeroSeasonalInWindowOnly === true;
    if (inWindowOnly && isSeasonalHeroMode(mode) && !isSeasonalHeroInWindow(mode, now)) {
        return 'trending_week';
    }
    return mode;
};

export const clearMediaPlayerHomeHeroCache = () => {
    heroCache = null;
};

const fetchTmdbTrendingWeek = async (fetchImpl, apiKey) => {
    const key = String(apiKey || '').trim();
    if (!key || key === '********' || /^•+$/.test(key)) return [];
    const res = await fetchImpl(
        `https://api.themoviedb.org/3/trending/all/week?api_key=${encodeURIComponent(key)}&page=1`,
    ).catch(() => null);
    if (!res?.ok) return [];
    const json = await res.json().catch(() => null);
    const rows = Array.isArray(json?.results) ? json.results : [];
    return rows
        .map((row) => mapTmdbListRow(row))
        .filter(Boolean)
        .slice(0, TRENDING_SCAN);
};

const mapTmdbListRow = (row) => {
    const mediaType = row?.media_type === 'tv' || row?.first_air_date
        ? 'show'
        : (row?.media_type === 'movie' || row?.release_date || row?.title ? 'movie' : '');
    const resolvedType = mediaType === 'show' || mediaType === 'movie'
        ? mediaType
        : (row?.media_type === 'tv' ? 'show' : row?.media_type === 'movie' ? 'movie' : '');
            const tmdbId = Number(row?.id);
            const title = String(row?.title || row?.name || '').trim();
            const backdropPath = String(row?.backdrop_path || '').trim();
    if (!resolvedType || !Number.isFinite(tmdbId) || tmdbId <= 0 || !title || !backdropPath) return null;
            return {
                tmdbId,
        mediaType: resolvedType,
                title,
                overview: String(row?.overview || '').trim(),
                year: String(row?.release_date || row?.first_air_date || '').slice(0, 4) || null,
        backdropUrl: tmdbImg(backdropPath, TMDB_BACKDROP_SIZE),
                posterUrl: tmdbImg(row?.poster_path, 'w500'),
            };
};

const fetchTmdbByIds = async (fetchImpl, apiKey, seeds = []) => {
    const key = String(apiKey || '').trim();
    if (!key || key === '********' || !seeds.length) return [];
    const out = [];
    for (const seed of seeds) {
        const kind = seed?.type === 'tv' ? 'tv' : 'movie';
        const id = Number(seed?.id);
        if (!Number.isFinite(id) || id <= 0) continue;
        const res = await fetchImpl(
            `https://api.themoviedb.org/3/${kind}/${id}?api_key=${encodeURIComponent(key)}`,
        ).catch(() => null);
        if (!res?.ok) continue;
        const json = await res.json().catch(() => null);
        const mapped = mapTmdbListRow({
            ...json,
            id,
            media_type: kind === 'tv' ? 'tv' : 'movie',
        });
        if (mapped) out.push(mapped);
    }
    return out;
};

const fetchTmdbKeywordIds = async (fetchImpl, apiKey, terms = []) => {
    const key = String(apiKey || '').trim();
    if (!key || key === '********') return [];
    const ids = [];
    const seen = new Set();
    for (const term of terms) {
        const res = await fetchImpl(
            `https://api.themoviedb.org/3/search/keyword?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(term)}`,
        ).catch(() => null);
        if (!res?.ok) continue;
        const json = await res.json().catch(() => null);
        const hit = [].concat(json?.results || []).find((row) => Number(row?.id) > 0);
        const id = Number(hit?.id);
        if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
    }
    return ids;
};

const fetchTmdbDiscoverByKeywords = async (fetchImpl, apiKey, keywordIds = []) => {
    const key = String(apiKey || '').trim();
    if (!key || key === '********' || !keywordIds.length) return [];
    const out = [];
    const seen = new Set();
    for (const keywordId of keywordIds.slice(0, 3)) {
        for (const kind of ['movie', 'tv']) {
            const res = await fetchImpl(
                `https://api.themoviedb.org/3/discover/${kind}?api_key=${encodeURIComponent(key)}&with_keywords=${encodeURIComponent(String(keywordId))}&sort_by=popularity.desc&include_adult=false&page=1`,
            ).catch(() => null);
            if (!res?.ok) continue;
            const json = await res.json().catch(() => null);
            for (const row of [].concat(json?.results || [])) {
                const mapped = mapTmdbListRow({
                    ...row,
                    media_type: kind === 'tv' ? 'tv' : 'movie',
                });
                if (!mapped || seen.has(mapped.tmdbId)) continue;
                seen.add(mapped.tmdbId);
                out.push(mapped);
                if (out.length >= SEASONAL_SCAN) return out;
            }
        }
    }
    return out;
};

const fetchTmdbSeasonalCandidates = async (fetchImpl, apiKey, mode) => {
    const key = String(apiKey || '').trim();
    const queries = SEASONAL_QUERIES[mode] || [];
    if (!key || key === '********') return [];

    const seen = new Set();
    const out = [];
    const pushAll = (rows) => {
        for (const mapped of rows) {
            if (!mapped || seen.has(mapped.tmdbId)) continue;
            seen.add(mapped.tmdbId);
            out.push(mapped);
            if (out.length >= SEASONAL_SCAN) return true;
        }
        return false;
    };

    // 1) Curated seeds (helps thin holidays like NYE / Easter)
    if (pushAll(await fetchTmdbByIds(fetchImpl, key, SEASONAL_SEED_IDS[mode] || []))) return out;

    // 2) Keyword discover
    const keywordIds = await fetchTmdbKeywordIds(fetchImpl, key, SEASONAL_KEYWORDS[mode] || []);
    if (pushAll(await fetchTmdbDiscoverByKeywords(fetchImpl, key, keywordIds))) return out;

    // 3) Multi search for each seasonal query
    for (const query of queries) {
        const res = await fetchImpl(
            `https://api.themoviedb.org/3/search/multi?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(query)}&include_adult=false&page=1`,
        ).catch(() => null);
        if (!res?.ok) continue;
        const json = await res.json().catch(() => null);
        const mappedRows = [];
        for (const row of [].concat(json?.results || [])) {
            if (row?.media_type !== 'movie' && row?.media_type !== 'tv') continue;
            const mapped = mapTmdbListRow(row);
            if (mapped) mappedRows.push(mapped);
        }
        if (pushAll(mappedRows)) return out;
    }
    return out;
};

const plexGet = async (plexJson, fetchImpl, url, headers, timeoutMs = 4500) => (
    plexJson(fetchImpl, url, headers, { timeoutMs }).catch(() => null)
);

const findPlexByGuid = async ({
    fetchImpl,
    plexJson,
    uri,
    token,
    headers,
    tmdbId,
    mediaType,
}) => {
    const plexType = mediaType === 'movie' ? 1 : 2;
    const guids = guidCandidatesFor(tmdbId).slice(0, 2);

    for (const guid of guids) {
        const data = await plexGet(
            plexJson,
            fetchImpl,
            `${uri}/library/all?type=${plexType}&guid=${encodeURIComponent(guid)}&includeGuids=1&X-Plex-Token=${encodeURIComponent(token)}`,
            headers,
        );
        const meta = metadataList(data)[0];
        if (meta?.ratingKey) return meta;
    }
    return null;
};

const findPlexByTitleSearch = async ({
    fetchImpl,
    plexJson,
    uri,
    token,
    headers,
    title,
    mediaType,
    tmdbId,
    year,
}) => {
    const data = await plexGet(
        plexJson,
        fetchImpl,
        `${uri}/hubs/search?query=${encodeURIComponent(title)}&limit=24&includeGuids=1&X-Plex-Token=${encodeURIComponent(token)}`,
        headers,
    );
    const wanted = mediaType === 'movie' ? 'movie' : 'show';
    const yearNum = year ? Number(year) : null;
    let fallback = null;
    for (const hub of [].concat(data?.MediaContainer?.Hub || [])) {
        for (const meta of metadataList({ MediaContainer: { Metadata: hub.Metadata } })) {
            if (String(meta?.type || '') !== wanted) continue;
            if (!meta?.ratingKey) continue;
            if (metaMatchesTmdb(meta, tmdbId)) return meta;
            if (!titlesClose(meta.title || meta.grandparentTitle, title)) continue;
            if (yearNum && Number(meta.year) && Math.abs(Number(meta.year) - yearNum) > 1) continue;
            if (!fallback) fallback = meta;
        }
    }
    return fallback;
};

const findPlexForTrending = async (opts) => {
    const byGuid = await findPlexByGuid(opts);
    if (byGuid?.ratingKey) return byGuid;
    return findPlexByTitleSearch(opts);
};

/** Match rows in order with limited concurrency; stop once `limit` hits are found. */
const matchUntilLimit = async (rows, limit, concurrency, mapper) => {
    const hits = [];
    let next = 0;
    let stop = false;

    const workers = Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
        while (!stop) {
            const index = next;
            next += 1;
            if (index >= rows.length) return;
            const item = await mapper(rows[index], index);
            if (stop) return;
            if (!item) continue;
            hits.push({ index, item });
            if (hits.length >= limit) stop = true;
        }
    });
    await Promise.all(workers);
    return hits
        .sort((a, b) => a.index - b.index)
        .map((row) => row.item)
        .slice(0, limit);
};

const toHeroItem = (meta, row, mapPlayerItem, config) => {
    const mapped = mapPlayerItem(meta, config);
    const ratingKey = String(mapped?.ratingKey || meta.ratingKey || '').trim();
    if (!ratingKey) return null;
    const artPath = pickHeroArtPath(meta, mapped);
    return {
        ratingKey,
        title: mapped?.title || row.title,
        type: mapped?.type || row.mediaType,
        year: mapped?.year || (row.year ? Number(row.year) : null),
        summary: mapped?.summary || row.overview || '',
        thumb: mapped?.thumb || null,
        art: mapped?.art || artPath || null,
        logo: mapped?.logo || null,
        backdropUrl: (artPath ? plexImageProxyUrl(artPath) : null) || row.backdropUrl || null,
        posterUrl: row.posterUrl || null,
        tmdbId: row.tmdbId ?? mapped?.tmdbId ?? null,
        canPlay: mapped?.canPlay !== false,
    };
};

const plexImageProxyUrl = (path, width = HERO_PLEX_WIDTH, height = HERO_PLEX_HEIGHT, { quality = HERO_PLEX_QUALITY } = {}) => {
    const raw = String(path || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    const q = Math.min(100, Math.max(1, Number(quality) || HERO_PLEX_QUALITY));
    return `/api/plex/image?path=${encodeURIComponent(raw)}&width=${width}&height=${height}&quality=${q}`;
};

/** Prefer Plex background Image entries; never use poster thumbs for ultrawide heroes. */
const pickHeroArtPath = (meta = {}, mapped = {}) => {
    const images = [].concat(meta?.Image || []);
    for (const image of images) {
        const type = String(image?.type || '').toLowerCase();
        if (type !== 'background' && type !== 'banner' && type !== 'art') continue;
        const path = safePlexLibraryPath(image?.url || image?.path || '');
        if (path) return path;
    }
    const candidates = [
        mapped?.art,
        meta?.art,
        meta?.grandparentArt,
        meta?.parentArt,
    ];
    for (const candidate of candidates) {
        const path = safePlexLibraryPath(candidate);
        if (path) return path;
    }
    return null;
};

const metaToHeroSlide = (meta, mapPlayerItem, config, extras = {}) => {
    const mapped = mapPlayerItem(meta, config);
    const ratingKey = String(mapped?.ratingKey || meta.ratingKey || '').trim();
    if (!ratingKey) return null;
    const artPath = pickHeroArtPath(meta, mapped);
    const thumbPath = mapped?.thumb || meta.thumb || meta.grandparentThumb || null;
    const tmdbId = extras.tmdbId ?? mapped?.tmdbId ?? pickPlayerTmdbId(meta);
    const rawType = String(mapped?.type || meta.type || extras.type || '').toLowerCase();
    const inferredShow = Boolean(
        meta.grandparentRatingKey || meta.grandparentTitle || mapped?.showTitle || extras.showTitle,
    );
    const type = rawType
        || (inferredShow ? 'show' : '')
        || (extras.mediaType === 'show' ? 'show' : '')
        || 'movie';
    return {
        ratingKey,
        title: mapped?.title || meta.title || meta.grandparentTitle || 'Untitled',
        type,
        year: mapped?.year || meta.year || null,
        summary: mapped?.summary || meta.summary || '',
        thumb: mapped?.thumb || null,
        art: mapped?.art || null,
        logo: mapped?.logo || null,
        // Prefer caller-supplied TMDB original; otherwise max-res Plex background (not poster).
        backdropUrl: extras.backdropUrl
            || (artPath ? plexImageProxyUrl(artPath) : null)
            || null,
        posterUrl: thumbPath ? plexImageProxyUrl(thumbPath, 500, 750, { quality: 90 }) : null,
        tmdbId: tmdbId || null,
        canPlay: mapped?.canPlay !== false,
        viewOffsetMs: mapped?.viewOffsetMs || Number(meta.viewOffset) || 0,
    };
};

const continueWatchingToSlides = (items, mapPlayerItem, config) => {
    const out = [];
    const seen = new Set();
    for (const row of [].concat(items || [])) {
        const ratingKey = String(row?.ratingKey || '').trim();
        if (!ratingKey || seen.has(ratingKey)) continue;
        seen.add(ratingKey);
        const artPath = pickHeroArtPath(row) || safePlexLibraryPath(row.art) || null;
        const rawType = String(row.type || '').toLowerCase();
        // Keep episode/season type for play/open; never default TV to movie.
        const type = rawType || 'movie';
        const slide = {
            ratingKey,
            title: row.title || row.showTitle || 'Untitled',
            type,
            year: row.year || null,
            summary: row.summary || '',
            thumb: row.thumb || null,
            art: row.art || null,
            logo: row.logo || null,
            backdropUrl: artPath ? plexImageProxyUrl(artPath) : null,
            posterUrl: row.thumb ? plexImageProxyUrl(row.thumb, 500, 750, { quality: 90 }) : null,
            tmdbId: row.tmdbId || null,
            canPlay: row.canPlay !== false,
            viewOffsetMs: row.viewOffsetMs || 0,
        };
        if (!slide.backdropUrl && mapPlayerItem) {
            /* keep as-is — UI has gradient fallback */
        }
        out.push(slide);
        if (out.length >= HERO_LIMIT) break;
    }
    return out;
};

const fetchLibrarySections = async ({ fetchImpl, plexJson, uri, token, headers }) => {
    const sectionsRes = await plexGet(
        plexJson,
        fetchImpl,
        `${uri}/library/sections?X-Plex-Token=${encodeURIComponent(token)}`,
        headers,
        8000,
    );
    return directoryList(sectionsRes).filter((dir) => dir?.type === 'movie' || dir?.type === 'show');
};

const enrichMeta = async ({ fetchImpl, plexJson, uri, token, headers, meta }) => {
    if (!meta?.ratingKey) return meta;
    const detail = await plexGet(
        plexJson,
        fetchImpl,
        `${uri}/library/metadata/${encodeURIComponent(meta.ratingKey)}?includeImages=1&includeGuids=1&X-Plex-Token=${encodeURIComponent(token)}`,
        headers,
        6000,
    );
    return metadataList(detail)[0] || meta;
};

const withPreferredHeroBackdrop = async (slide, fetchImpl, apiKey) => {
    if (!slide) return null;
    const artPath = pickHeroArtPath({ art: slide.art }, { art: slide.art });
    if (artPath) {
        return { ...slide, backdropUrl: plexImageProxyUrl(artPath) };
    }
    const key = String(apiKey || '').trim();
    if (!key || key === '********' || !slide.tmdbId) return slide;
    const best = await fetchBestTmdbBackdropUrl(fetchImpl, key, slide.tmdbId, slide.type);
    if (!best) return slide;
    return { ...slide, backdropUrl: best };
};

const buildFromTmdbCandidates = async ({
    candidates,
    config,
    uri,
    token,
    headers,
    fetchImpl,
    plexJson,
    mapPlayerItem,
}) => {
    const sections = await fetchLibrarySections({ fetchImpl, plexJson, uri, token, headers });
    const matched = await matchUntilLimit(candidates, HERO_LIMIT, 5, async (row) => {
        const meta = await findPlexForTrending({
            fetchImpl,
            plexJson,
            uri,
            token,
            headers,
            tmdbId: row.tmdbId,
            mediaType: row.mediaType,
            title: row.title,
            year: row.year,
            sections,
        });
        if (!meta?.ratingKey) return null;
        const full = await enrichMeta({ fetchImpl, plexJson, uri, token, headers, meta });
        return toHeroItem(full, row, mapPlayerItem, config);
    });
    const items = [];
    const seenKeys = new Set();
    for (const item of matched) {
        if (!item?.ratingKey || seenKeys.has(item.ratingKey)) continue;
        seenKeys.add(item.ratingKey);
        const upgraded = await withPreferredHeroBackdrop(item, fetchImpl, config?.tmdbApiKey);
        if (upgraded?.backdropUrl) items.push(upgraded);
    }
    return items;
};

const buildFromPlexSeasonalSearch = async ({
    mode,
    config,
    uri,
    token,
    headers,
    fetchImpl,
    plexJson,
    mapPlayerItem,
}) => {
    const queries = SEASONAL_QUERIES[mode] || [];
    if (!queries.length || !uri || !token) return [];
    const seen = new Set();
    const metas = [];
    for (const query of queries) {
        const data = await plexGet(
            plexJson,
            fetchImpl,
            `${uri}/hubs/search?query=${encodeURIComponent(query)}&limit=24&includeGuids=1&includeImages=1&X-Plex-Token=${encodeURIComponent(token)}`,
            headers,
            6000,
        );
        for (const hub of [].concat(data?.MediaContainer?.Hub || [])) {
            for (const meta of metadataList({ MediaContainer: { Metadata: hub.Metadata } })) {
                const type = String(meta?.type || '').toLowerCase();
                const ratingKey = String(meta?.ratingKey || '').trim();
                if ((type !== 'movie' && type !== 'show') || !ratingKey || seen.has(ratingKey)) continue;
                seen.add(ratingKey);
                metas.push(meta);
                if (metas.length >= HERO_LIMIT * 2) break;
            }
            if (metas.length >= HERO_LIMIT * 2) break;
        }
        if (metas.length >= HERO_LIMIT * 2) break;
    }
    const items = [];
    for (const meta of metas) {
        if (items.length >= HERO_LIMIT) break;
        const full = await enrichMeta({ fetchImpl, plexJson, uri, token, headers, meta });
        let slide = metaToHeroSlide(full, mapPlayerItem, config);
        slide = await withPreferredHeroBackdrop(slide, fetchImpl, config?.tmdbApiKey);
        if (slide?.ratingKey && slide.backdropUrl) items.push(slide);
    }
    return items;
};

const querySectionAll = async ({
    fetchImpl,
    plexJson,
    uri,
    token,
    headers,
    sectionKey,
    type,
    sort,
    extra = '',
    size = 24,
}) => {
    const qs = [
        `type=${type}`,
        `sort=${encodeURIComponent(sort)}`,
        'includeGuids=1',
        'includeImages=1',
        `X-Plex-Container-Start=0`,
        `X-Plex-Container-Size=${size}`,
        `X-Plex-Token=${encodeURIComponent(token)}`,
        extra,
    ].filter(Boolean).join('&');
    const data = await plexGet(
        plexJson,
        fetchImpl,
        `${uri}/library/sections/${encodeURIComponent(sectionKey)}/all?${qs}`,
        headers,
        8000,
    );
    return metadataList(data);
};

const HISTORY_PAGE_SIZE = 100;
const MOST_WATCHED_HISTORY_CAP = 5000;

/**
 * Roll history rows into movie/show play counts across all accounts.
 * Episodes count toward their show.
 */
export const aggregateServerMostWatched = (historyItems = [], { limit = HERO_LIMIT } = {}) => {
    const counts = new Map();
    for (const item of [].concat(historyItems || [])) {
        const type = String(item?.type || '').toLowerCase();
        if (type !== 'movie' && type !== 'episode' && type !== 'show') continue;
        const isEpisode = type === 'episode';
        const ratingKey = String(
            isEpisode
                ? (item.grandparentRatingKey || item.grandparentKey || item.ratingKey || '')
                : (item.ratingKey || item.key || ''),
        ).replace(/^\/library\/metadata\//, '').trim();
        if (!ratingKey) continue;
        const title = isEpisode
            ? (item.grandparentTitle || item.parentTitle || item.title || 'Untitled')
            : (item.title || 'Untitled');
        const mediaType = isEpisode || type === 'show' ? 'show' : 'movie';
        const existing = counts.get(ratingKey);
        if (existing) {
            existing.plays += 1;
            continue;
        }
        counts.set(ratingKey, {
            ratingKey,
            type: mediaType,
            title,
            plays: 1,
        });
    }
    return [...counts.values()]
        .sort((a, b) => (b.plays - a.plays) || String(a.title).localeCompare(String(b.title)))
        .slice(0, Math.max(1, Number(limit) || HERO_LIMIT));
};

const fetchServerWatchHistoryPage = async ({
    fetchImpl,
    plexJson,
    uri,
    token,
    headers,
    start = 0,
    size = HISTORY_PAGE_SIZE,
}) => {
    const data = await plexGet(
        plexJson,
        fetchImpl,
        `${uri}/status/sessions/history/all?sort=viewedAt:desc&includeGuids=1&X-Plex-Container-Start=${Math.max(0, start)}&X-Plex-Container-Size=${Math.max(1, size)}&X-Plex-Token=${encodeURIComponent(token)}`,
        headers,
        12000,
    );
    return {
        items: metadataList(data),
        totalSize: Number(data?.MediaContainer?.totalSize || 0),
    };
};

const buildMostWatchedFromServerHistory = async ({
    config,
    uri,
    token,
    headers,
    fetchImpl,
    plexJson,
    mapPlayerItem,
}) => {
    if (!uri || !token) return [];
    const historyItems = [];
    let start = 0;
    while (start < MOST_WATCHED_HISTORY_CAP) {
        const page = await fetchServerWatchHistoryPage({
            fetchImpl,
            plexJson,
            uri,
            token,
            headers,
            start,
            size: HISTORY_PAGE_SIZE,
        });
        if (!page.items.length) break;
        historyItems.push(...page.items);
        start += page.items.length;
        if (page.items.length < HISTORY_PAGE_SIZE) break;
        if (page.totalSize > 0 && start >= page.totalSize) break;
    }
    const ranked = aggregateServerMostWatched(historyItems, { limit: HERO_LIMIT * 2 });
    if (!ranked.length) return [];

    const items = [];
    const seen = new Set();
    for (const row of ranked) {
        if (items.length >= HERO_LIMIT) break;
        const key = String(row.ratingKey);
        if (seen.has(key)) continue;
        seen.add(key);
        const detail = await plexGet(
            plexJson,
            fetchImpl,
            `${uri}/library/metadata/${encodeURIComponent(key)}?includeImages=1&includeGuids=1&X-Plex-Token=${encodeURIComponent(token)}`,
            headers,
            6000,
        );
        const meta = metadataList(detail)[0];
        if (!meta?.ratingKey) continue;
        const type = String(meta.type || '').toLowerCase();
        if (type !== 'movie' && type !== 'show') continue;
        let slide = metaToHeroSlide(meta, mapPlayerItem, config);
        slide = await withPreferredHeroBackdrop(slide, fetchImpl, config?.tmdbApiKey);
        if (slide?.backdropUrl) items.push(slide);
    }
    return items;
};

const buildFromLibraryQuery = async ({
    config,
    uri,
    token,
    headers,
    fetchImpl,
    plexJson,
    mapPlayerItem,
    sort,
    extra = '',
    preferUnwatched = false,
}) => {
    const sections = await fetchLibrarySections({ fetchImpl, plexJson, uri, token, headers });
    const pools = await Promise.all(sections.slice(0, 8).map(async (section) => {
        const plexType = section.type === 'movie' ? 1 : 2;
        const filter = preferUnwatched ? 'unwatched=1' : extra;
        return querySectionAll({
            fetchImpl,
            plexJson,
            uri,
            token,
            headers,
            sectionKey: section.key,
            type: plexType,
            sort,
            extra: filter,
            size: 20,
        });
    }));
    const flat = pools.flat().filter((meta) => meta?.ratingKey && (meta.type === 'movie' || meta.type === 'show'));
    const items = [];
    const seen = new Set();
    for (const meta of flat) {
        const key = String(meta.ratingKey);
        if (seen.has(key)) continue;
        seen.add(key);
        const full = await enrichMeta({ fetchImpl, plexJson, uri, token, headers, meta });
        let slide = metaToHeroSlide(full, mapPlayerItem, config);
        slide = await withPreferredHeroBackdrop(slide, fetchImpl, config?.tmdbApiKey);
        if (slide?.backdropUrl) items.push(slide);
        if (items.length >= HERO_LIMIT) break;
    }
    return items;
};

const seededShuffle = (items, seed) => {
    const out = [...items];
    let state = Math.abs(Number(seed) || 1) % 2147483647 || 1;
    for (let i = out.length - 1; i > 0; i -= 1) {
        state = (state * 16807) % 2147483647;
        const j = state % (i + 1);
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
};

const buildRandomSpotlight = async (opts) => {
    const sections = await fetchLibrarySections(opts);
    const pools = await Promise.all(sections.slice(0, 6).map(async (section) => {
        const plexType = section.type === 'movie' ? 1 : 2;
        return querySectionAll({
            ...opts,
            sectionKey: section.key,
            type: plexType,
            sort: 'random',
            size: 30,
        });
    }));
    let flat = pools.flat().filter((meta) => meta?.ratingKey && (meta.type === 'movie' || meta.type === 'show'));
    const daySeed = Math.floor(Date.now() / DAY_MS);
    flat = seededShuffle(flat, daySeed).slice(0, HERO_LIMIT * 2);
    const items = [];
    const seen = new Set();
    for (const meta of flat) {
        const key = String(meta.ratingKey);
        if (seen.has(key)) continue;
        seen.add(key);
        const full = await enrichMeta({ ...opts, meta });
        let slide = metaToHeroSlide(full, opts.mapPlayerItem, opts.config);
        slide = await withPreferredHeroBackdrop(slide, opts.fetchImpl, opts.config?.tmdbApiKey);
        if (slide?.backdropUrl) items.push(slide);
        if (items.length >= HERO_LIMIT) break;
    }
    return items;
};

const emptyPayload = (mode, effectiveMode, reason, enabled = true) => ({
    enabled,
    mode,
    effectiveMode,
    refreshedAt: Date.now(),
    expiresAt: Date.now() + EMPTY_CACHE_MS,
    items: [],
    reason,
});

/**
 * Build hero slides for the configured (or effective) mode.
 * @returns {{ enabled, mode, effectiveMode, refreshedAt, expiresAt, items, reason? }}
 */
export const buildMediaPlayerHomeHero = async ({
    config,
    uri,
    token,
    headers,
    fetchImpl = fetch,
    plexJson,
    mapPlayerItem,
    force = false,
    continueWatchingItems = [],
    now = new Date(),
} = {}) => {
    const mode = normalizeMediaPlayerHomeHeroMode(config);
    const effectiveMode = resolveEffectiveHeroMode(config, now);

    if (effectiveMode === 'off') {
        return {
            enabled: false,
            mode,
            effectiveMode: 'off',
            refreshedAt: null,
            expiresAt: null,
            items: [],
            reason: 'disabled',
        };
    }

    // Continue Watching is per-viewer — never share cache across users.
    const useCache = effectiveMode !== 'continue_watching';
    const cacheKey = [
        'hero-modes-v6-max-quality',
        effectiveMode,
        String(config?.serverIdentifier || ''),
        String(config?.tmdbApiKey || '').slice(0, 8),
        Math.floor(Date.now() / DAY_MS),
    ].join('|');

    if (useCache && !force && heroCache && heroCache.key === cacheKey && heroCache.expiresAt > Date.now()) {
        return { ...heroCache.payload, mode, effectiveMode };
    }

    let items = [];
    let reason = 'ok';

    try {
        if (effectiveMode === 'continue_watching') {
            const slides = continueWatchingToSlides(continueWatchingItems, mapPlayerItem, config);
            items = (await Promise.all(
                slides.map((slide) => withPreferredHeroBackdrop(slide, fetchImpl, config?.tmdbApiKey)),
            )).filter((slide) => slide?.backdropUrl);
            reason = items.length ? 'ok' : 'no-continue-watching';
        } else if (effectiveMode === 'trending_week' || isSeasonalHeroMode(effectiveMode)) {
            const apiKey = String(config?.tmdbApiKey || '').trim();
            const seasonal = isSeasonalHeroMode(effectiveMode);
            if ((!apiKey || apiKey === '********') && !seasonal) {
                const payload = emptyPayload(mode, effectiveMode, 'missing-tmdb-key');
                if (useCache) heroCache = { key: cacheKey, expiresAt: payload.expiresAt, payload };
                return payload;
            }
            const candidates = (!apiKey || apiKey === '********')
                ? []
                : (effectiveMode === 'trending_week'
                    ? await fetchTmdbTrendingWeek(fetchImpl, apiKey)
                    : await fetchTmdbSeasonalCandidates(fetchImpl, apiKey, effectiveMode));
            if (!candidates.length && !seasonal) {
                const payload = emptyPayload(mode, effectiveMode, 'tmdb-empty');
                if (useCache) heroCache = { key: cacheKey, expiresAt: payload.expiresAt, payload };
                return payload;
            }
            if (candidates.length) {
                items = await buildFromTmdbCandidates({
                    candidates,
                    config,
                    uri,
                    token,
                    headers,
                    fetchImpl,
                    plexJson,
                    mapPlayerItem,
                });
            }
            // Seasonal themes (esp. NYE / Easter) often miss library GUID matches — search Plex next.
            if (!items.length && seasonal) {
                items = await buildFromPlexSeasonalSearch({
                    mode: effectiveMode,
                    config,
                    uri,
                    token,
                    headers,
                    fetchImpl,
                    plexJson,
                    mapPlayerItem,
                });
            }
            if (!items.length && !candidates.length && !seasonal) {
                const payload = emptyPayload(mode, effectiveMode, 'tmdb-empty');
                if (useCache) heroCache = { key: cacheKey, expiresAt: payload.expiresAt, payload };
                return payload;
            }
            reason = items.length ? 'ok' : 'no-library-matches';
        } else if (effectiveMode === 'recently_added') {
            items = await buildFromLibraryQuery({
                config, uri, token, headers, fetchImpl, plexJson, mapPlayerItem,
                sort: 'addedAt:desc',
            });
            reason = items.length ? 'ok' : 'no-library-matches';
        } else if (effectiveMode === 'most_watched') {
            // Library viewCount is per-account (usually the owner). Prefer server-wide history.
            items = await buildMostWatchedFromServerHistory({
                config, uri, token, headers, fetchImpl, plexJson, mapPlayerItem,
            });
            if (!items.length) {
                items = await buildFromLibraryQuery({
                    config, uri, token, headers, fetchImpl, plexJson, mapPlayerItem,
                    sort: 'viewCount:desc',
                });
            }
            reason = items.length ? 'ok' : 'no-library-matches';
        } else if (effectiveMode === 'unwatched_picks') {
            items = await buildFromLibraryQuery({
                config, uri, token, headers, fetchImpl, plexJson, mapPlayerItem,
                sort: 'audienceRating:desc',
                preferUnwatched: true,
            });
            reason = items.length ? 'ok' : 'no-library-matches';
        } else if (effectiveMode === 'new_releases') {
            items = await buildFromLibraryQuery({
                config, uri, token, headers, fetchImpl, plexJson, mapPlayerItem,
                sort: 'originallyAvailableAt:desc',
            });
            reason = items.length ? 'ok' : 'no-library-matches';
        } else if (effectiveMode === 'random_spotlight') {
            items = await buildRandomSpotlight({
                config, uri, token, headers, fetchImpl, plexJson, mapPlayerItem,
            });
            reason = items.length ? 'ok' : 'no-library-matches';
        } else {
            reason = 'unknown-mode';
        }
    } catch {
        reason = 'build-error';
        items = [];
    }

    const refreshedAt = Date.now();
    const payload = {
        enabled: true,
        mode,
        effectiveMode,
        refreshedAt,
        expiresAt: refreshedAt + (items.length ? DAY_MS : EMPTY_CACHE_MS),
        items,
        reason,
    };
    if (useCache) heroCache = { key: cacheKey, expiresAt: payload.expiresAt, payload };
    return payload;
};
