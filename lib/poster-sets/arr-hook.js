/**
 * Debounced Sonarr On Import → Poster Sets watch checks.
 */
import { loadPosterSetsConfig } from './config.js';
import { checkPosterSetsWatchesForSeries } from './watcher.js';

const DEBOUNCE_MS = 3 * 60 * 1000;
const pending = new Map();

const pick = (obj, ...keys) => {
    if (!obj || typeof obj !== 'object') return undefined;
    for (const key of keys) {
        if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
    }
    return undefined;
};

const asId = (value) => {
    if (value == null || value === false) return null;
    const text = String(value).trim();
    if (!text || text === '0') return null;
    return text;
};

const normalizeTitleKey = (value) => String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

/** Extract series identity + season from a Sonarr webhook body. */
export const parseSonarrSeriesHook = (event = {}) => {
    const series = pick(event, 'series', 'Series') || {};
    const title = String(pick(series, 'title', 'Title') || '').trim() || null;
    const tvdbId = asId(pick(series, 'tvdbId', 'TvdbId', 'tvdb_id'));
    const tmdbId = asId(pick(series, 'tmdbId', 'TmdbId', 'tmdb_id'));
    const yearRaw = Number(pick(series, 'year', 'Year'));
    const year = Number.isFinite(yearRaw) && yearRaw > 1900 ? yearRaw : null;

    let seasonNumber = null;
    const episodes = pick(event, 'episodes', 'Episodes');
    if (Array.isArray(episodes) && episodes.length) {
        const seasons = episodes
            .map((ep) => Number(pick(ep, 'seasonNumber', 'SeasonNumber')))
            .filter((n) => Number.isFinite(n));
        if (seasons.length) seasonNumber = Math.min(...seasons);
    }
    if (seasonNumber == null) {
        const files = pick(event, 'episodeFiles', 'EpisodeFiles');
        const file = pick(event, 'episodeFile', 'EpisodeFile');
        const list = Array.isArray(files) && files.length ? files : (file ? [file] : []);
        for (const item of list) {
            const rel = String(pick(item, 'relativePath', 'RelativePath', 'path', 'Path') || '');
            const match = rel.match(/[\\/](?:Season|Specials)\s*0*(\d+)/i)
                || rel.match(/\bS(?:eason)?[ ._-]?0*(\d+)\b/i);
            if (match) {
                seasonNumber = Number(match[1]);
                break;
            }
        }
    }

    return {
        title,
        tvdbId,
        tmdbId,
        year,
        seasonNumber: Number.isFinite(Number(seasonNumber)) ? Number(seasonNumber) : null,
    };
};

const debounceKey = ({ title, tvdbId, tmdbId, seasonNumber }) => {
    const id = tvdbId || tmdbId || normalizeTitleKey(title) || 'unknown';
    const season = Number.isFinite(Number(seasonNumber)) ? Number(seasonNumber) : 'x';
    return `${id}:S${season}`;
};

/**
 * Schedule a non-blocking watch check after Sonarr Download (On Import).
 * Debounces bursts / season packs for 3 minutes per series+season.
 */
export const schedulePosterSetsArrHook = async (event) => {
    const parsed = parseSonarrSeriesHook(event);
    if (!parsed.title && !parsed.tvdbId && !parsed.tmdbId) return { ok: true, skipped: true, reason: 'no-series' };

    const key = debounceKey(parsed);
    const existing = pending.get(key);
    if (existing?.timer) clearTimeout(existing.timer);

    const payload = {
        ...parsed,
        // Keep latest identity fields if a later webhook adds IDs.
        title: parsed.title || existing?.payload?.title || null,
        tvdbId: parsed.tvdbId || existing?.payload?.tvdbId || null,
        tmdbId: parsed.tmdbId || existing?.payload?.tmdbId || null,
        year: parsed.year ?? existing?.payload?.year ?? null,
        seasonNumber: parsed.seasonNumber ?? existing?.payload?.seasonNumber ?? null,
    };

    const timer = setTimeout(() => {
        pending.delete(key);
        void (async () => {
            try {
                const config = await loadPosterSetsConfig();
                if (config.arrWatchHookEnabled === false) return;
                if (config.watchersEnabled === false) return;
                await checkPosterSetsWatchesForSeries(payload);
            } catch {
                /* never throw into webhook path */
            }
        })();
    }, DEBOUNCE_MS);
    timer.unref?.();

    pending.set(key, { timer, payload });
    return { ok: true, scheduled: true, key, debounceMs: DEBOUNCE_MS, ...payload };
};

/** Immediate check (admin/test) — skips debounce. */
export const runPosterSetsArrHookNow = async (eventOrPayload = {}) => {
    const config = await loadPosterSetsConfig();
    if (config.arrWatchHookEnabled === false) {
        return { ok: true, skipped: true, reason: 'arr-hook-disabled' };
    }
    if (config.watchersEnabled === false) {
        return { ok: true, skipped: true, reason: 'watchers-disabled' };
    }
    const parsed = eventOrPayload.series || eventOrPayload.Series
        ? parseSonarrSeriesHook(eventOrPayload)
        : {
            title: eventOrPayload.title || null,
            tvdbId: asId(eventOrPayload.tvdbId ?? eventOrPayload.tvdb_id),
            tmdbId: asId(eventOrPayload.tmdbId ?? eventOrPayload.tmdb_id),
            year: Number.isFinite(Number(eventOrPayload.year)) ? Number(eventOrPayload.year) : null,
            seasonNumber: Number.isFinite(Number(eventOrPayload.seasonNumber))
                ? Number(eventOrPayload.seasonNumber)
                : null,
        };
    return checkPosterSetsWatchesForSeries(parsed);
};
