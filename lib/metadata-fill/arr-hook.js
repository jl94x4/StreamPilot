/**
 * Debounced Sonarr On Import → Metadata Fill.
 */

import { parseSonarrSeriesHook } from '../poster-sets/arr-hook.js';
import { pathsFromSonarrEvent } from '../scanner/triggers/parsers.js';
import { fillEpisodeByFile, isMetadataFillAutoImportEnabled } from './job.js';

const DEBOUNCE_MS = 60 * 1000;
const pending = new Map();

const pick = (obj, ...keys) => {
    if (!obj || typeof obj !== 'object') return undefined;
    for (const key of keys) {
        if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
    }
    return undefined;
};

const collectEpisodeJobs = (event = {}) => {
    const series = parseSonarrSeriesHook(event);
    const files = []
        .concat(Array.isArray(event.episodeFiles) ? event.episodeFiles : [])
        .concat(Array.isArray(event.EpisodeFiles) ? event.EpisodeFiles : [])
        .concat(event.episodeFile ? [event.episodeFile] : [])
        .concat(event.EpisodeFile ? [event.EpisodeFile] : []);
    const episodes = []
        .concat(Array.isArray(event.episodes) ? event.episodes : [])
        .concat(Array.isArray(event.Episodes) ? event.Episodes : []);

    const jobs = [];
    if (files.length) {
        for (let i = 0; i < files.length; i += 1) {
            const file = files[i];
            const ep = episodes[i] || episodes[0] || {};
            const filePath = String(pick(file, 'path', 'Path') || '').trim();
            const seasonNumber = Number(pick(ep, 'seasonNumber', 'SeasonNumber') ?? series.seasonNumber);
            const episodeNumber = Number(pick(ep, 'episodeNumber', 'EpisodeNumber'));
            if (!filePath && !Number.isFinite(episodeNumber)) continue;
            jobs.push({
                filePath: filePath || null,
                seasonNumber: Number.isFinite(seasonNumber) ? seasonNumber : null,
                episodeNumber: Number.isFinite(episodeNumber) ? episodeNumber : null,
                tmdbId: series.tmdbId,
                tvdbId: series.tvdbId,
                title: series.title,
            });
        }
    } else if (episodes.length) {
        // No file paths — still try after folder scan using S/E + show ids (needs path from folders).
        const folders = pathsFromSonarrEvent(event);
        for (const ep of episodes) {
            const seasonNumber = Number(pick(ep, 'seasonNumber', 'SeasonNumber'));
            const episodeNumber = Number(pick(ep, 'episodeNumber', 'EpisodeNumber'));
            jobs.push({
                filePath: folders[0] || null,
                seasonNumber: Number.isFinite(seasonNumber) ? seasonNumber : null,
                episodeNumber: Number.isFinite(episodeNumber) ? episodeNumber : null,
                tmdbId: series.tmdbId,
                tvdbId: series.tvdbId,
                title: series.title,
            });
        }
    }
    return { series, jobs };
};

const debounceKey = (series, job) => {
    const id = series.tvdbId || series.tmdbId || series.title || 'unknown';
    return `${id}:S${job.seasonNumber ?? 'x'}E${job.episodeNumber ?? 'x'}:${job.filePath || ''}`;
};

/**
 * @param {object} event Sonarr webhook
 * @param {{ loadConfig: Function, resolvePlex: Function }} deps
 */
export const scheduleMetadataFillArrHook = async (event, deps = {}) => {
    const { series, jobs } = collectEpisodeJobs(event);
    if (!jobs.length) return { ok: true, skipped: true, reason: 'no-episodes' };

    const scheduled = [];
    for (const job of jobs) {
        const key = debounceKey(series, job);
        const existing = pending.get(key);
        if (existing?.timer) clearTimeout(existing.timer);

        const payload = { ...job, series };
        const timer = setTimeout(() => {
            pending.delete(key);
            void (async () => {
                try {
                    const config = await deps.loadConfig();
                    if (!isMetadataFillAutoImportEnabled(config)) return;
                    const plex = await deps.resolvePlex(config);
                    if (!plex?.baseUrl || !plex?.token) return;
                    await fillEpisodeByFile({
                        config,
                        baseUrl: plex.baseUrl,
                        token: plex.token,
                        rewrite: plex.rewrite || [],
                        filePath: payload.filePath,
                        seasonNumber: payload.seasonNumber,
                        episodeNumber: payload.episodeNumber,
                        tmdbId: payload.tmdbId,
                        tvdbId: payload.tvdbId,
                        source: 'sonarr-import',
                        initialDelayMs: 0, // already waited DEBOUNCE_MS
                        retries: 3,
                    });
                } catch {
                    /* never throw into webhook path */
                }
            })();
        }, DEBOUNCE_MS);
        timer.unref?.();
        pending.set(key, { timer, payload });
        scheduled.push(key);
    }

    return { ok: true, scheduled: true, count: scheduled.length, debounceMs: DEBOUNCE_MS };
};

/** @internal test helper */
export const _resetMetadataFillArrHookForTests = () => {
    for (const row of pending.values()) {
        if (row?.timer) clearTimeout(row.timer);
    }
    pending.clear();
};
