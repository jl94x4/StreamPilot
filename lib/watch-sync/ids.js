/** Guid helpers for matching Plex metadata to Trakt ids. */

export const idsFromGuids = (guids) => {
    const ids = {};
    const list = Array.isArray(guids)
        ? guids
        : (guids ? [guids] : []);
    for (const raw of list) {
        const value = typeof raw === 'string' ? raw : (raw?.id || raw?.tag || '');
        const text = String(value || '');
        if (!text) continue;
        const imdb = text.match(/imdb:\/\/(tt\d+)/i) || text.match(/\b(tt\d{5,})\b/i);
        if (imdb && !ids.imdb) ids.imdb = imdb[1];
        const tmdb = text.match(/(?:tmdb|themoviedb):\/\/(\d+)/i);
        if (tmdb && !ids.tmdb) ids.tmdb = Number(tmdb[1]);
        const tvdb = text.match(/(?:thetvdb|tvdb):\/\/(\d+)/i);
        if (tvdb && !ids.tvdb) ids.tvdb = Number(tvdb[1]);
    }
    return ids;
};

export const hasAnyId = (ids) => !!(ids?.imdb || ids?.tmdb || ids?.tvdb);

export const movieKey = (ids) => {
    if (ids?.imdb) return `imdb:${ids.imdb}`;
    if (ids?.tvdb) return `tvdb:${ids.tvdb}`;
    if (ids?.tmdb) return `tmdb:${Number(ids.tmdb)}`;
    return '';
};

export const episodeKey = (showIds, season, episode) => {
    const base = movieKey(showIds);
    const s = Number(season);
    const e = Number(episode);
    if (!base || !Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e < 1) return '';
    return `${base}:s${s}e${e}`;
};

export const sameIds = (a, b) => {
    if (!a || !b) return false;
    if (a.imdb && b.imdb && a.imdb === b.imdb) return true;
    if (a.tmdb && b.tmdb && Number(a.tmdb) === Number(b.tmdb)) return true;
    if (a.tvdb && b.tvdb && Number(a.tvdb) === Number(b.tvdb)) return true;
    return false;
};

export const indexByIds = (items, getIds) => {
    const imdb = new Map();
    const tmdb = new Map();
    const tvdb = new Map();
    for (const item of items || []) {
        const ids = getIds(item) || {};
        if (ids.imdb) imdb.set(ids.imdb, item);
        if (ids.tmdb) tmdb.set(Number(ids.tmdb), item);
        if (ids.tvdb) tvdb.set(Number(ids.tvdb), item);
    }
    return {
        find(ids) {
            if (!ids) return null;
            if (ids.imdb && imdb.has(ids.imdb)) return imdb.get(ids.imdb);
            if (ids.tmdb && tmdb.has(Number(ids.tmdb))) return tmdb.get(Number(ids.tmdb));
            if (ids.tvdb && tvdb.has(Number(ids.tvdb))) return tvdb.get(Number(ids.tvdb));
            return null;
        },
    };
};

export const normalizeRating = (value) => {
    if (value == null || value === '') return null;
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < 1 || n > 10) return null;
    return n;
};

const unixMs = (value) => {
    if (value == null || value === '') return 0;
    if (typeof value === 'number') return value > 1e12 ? value : value * 1000;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Watched sync only adds a watch. It does not clear a watch on the other side.
 * First run fills gaps. Later runs follow whichever side changed since the snapshot.
 */
export const decideWatched = ({
    plexWatched,
    traktWatched,
    prev,
    plexToTrakt,
    traktToPlex,
    plexAt = 0,
    traktAt = 0,
}) => {
    const plex = !!plexWatched;
    const trakt = !!traktWatched;
    if (plex === trakt) return 'none';
    if (!prev) {
        if (plex && plexToTrakt) return 'toTrakt';
        if (trakt && traktToPlex) return 'toPlex';
        return 'none';
    }
    const plexChanged = plex !== !!prev.plexWatched;
    const traktChanged = trakt !== !!prev.traktWatched;
    if (plexChanged && !traktChanged && plex && plexToTrakt) return 'toTrakt';
    if (traktChanged && !plexChanged && trakt && traktToPlex) return 'toPlex';
    if (plexChanged && traktChanged) {
        if (plex && plexToTrakt && unixMs(plexAt) >= unixMs(traktAt)) return 'toTrakt';
        if (trakt && traktToPlex) return 'toPlex';
    }
    if (!plexChanged && !traktChanged) {
        if (plex && !trakt && plexToTrakt) return 'toTrakt';
        if (trakt && !plex && traktToPlex) return 'toPlex';
    }
    return 'none';
};

/**
 * Ratings copy into an empty side first. Existing disagreements stay put until
 * one side changes after the last successful sync.
 */
export const decideRating = ({
    plexRating,
    traktRating,
    prev,
    plexToTrakt,
    traktToPlex,
}) => {
    const plex = normalizeRating(plexRating);
    const trakt = normalizeRating(traktRating);
    if (plex == null && trakt == null) return 'none';
    if (plex != null && trakt != null && plex === trakt) return 'none';
    if (!prev) {
        if (plex != null && trakt == null && plexToTrakt) return 'toTrakt';
        if (trakt != null && plex == null && traktToPlex) return 'toPlex';
        return 'none';
    }
    const plexChanged = plex !== normalizeRating(prev.plexRating);
    const traktChanged = trakt !== normalizeRating(prev.traktRating);
    if (plexChanged && !traktChanged && plex != null && plex !== trakt && plexToTrakt) return 'toTrakt';
    if (traktChanged && !plexChanged && trakt != null && trakt !== plex && traktToPlex) return 'toPlex';
    if (plexChanged && traktChanged && plex != null && plex !== trakt && plexToTrakt) return 'toTrakt';
    if (plex != null && trakt == null && plexToTrakt) return 'toTrakt';
    if (trakt != null && plex == null && traktToPlex) return 'toPlex';
    return 'none';
};

export const chunk = (items, size = 100) => {
    const out = [];
    const list = items || [];
    const step = Math.max(1, size);
    for (let i = 0; i < list.length; i += step) out.push(list.slice(i, i + step));
    return out;
};
