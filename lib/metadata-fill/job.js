/**
 * Metadata fill job runner + activity log (JSON under config/metadata-fill/).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { needsMetadataFill } from './detect.js';
import { fetchEpisodeMetadata } from './sources.js';
import { createPlexMetadataClient } from './plexWrite.js';

export const METADATA_FILL_DIR = path.join(process.cwd(), 'config', 'metadata-fill');
const LOG_PATH = path.join(METADATA_FILL_DIR, 'activity.json');
const MAX_LOG = 200;

const ensureDir = async () => {
    await fs.mkdir(METADATA_FILL_DIR, { recursive: true });
};

export const readMetadataFillLog = async () => {
    try {
        const raw = await fs.readFile(LOG_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

export const appendMetadataFillLog = async (entry) => {
    await ensureDir();
    const list = await readMetadataFillLog();
    list.unshift({
        at: new Date().toISOString(),
        ...entry,
    });
    await fs.writeFile(LOG_PATH, JSON.stringify(list.slice(0, MAX_LOG), null, 2), 'utf8');
};

export const isMetadataFillEnabled = (config = {}) => (
    !!config.metadataFillEnabled
    && String(config.mediaServerType || 'plex').toLowerCase() === 'plex'
);

export const isMetadataFillAutoImportEnabled = (config = {}) => (
    isMetadataFillEnabled(config) && config.metadataFillAutoImport !== false
);

/**
 * Fill one Plex episode metadata object (already loaded).
 */
export const fillOneEpisode = async ({
    config,
    plex,
    episode,
    source = 'manual',
} = {}) => {
    const gate = needsMetadataFill(episode);
    if (!gate.needs) {
        return { ok: true, skipped: true, reason: 'already-filled', ratingKey: episode?.ratingKey };
    }

    const ids = plex.extractIdsFromMeta(episode);
    // Prefer show-level GUIDs when episode lacks them
    if (!ids.tmdbId || !ids.tvdbId) {
        const showKey = String(episode?.grandparentRatingKey || '').replace(/\D/g, '');
        if (showKey) {
            const show = await plex.getMetadata(showKey).catch(() => null);
            if (show) {
                const showIds = plex.extractIdsFromMeta({ ...show, grandparentGuid: show.guid });
                ids.tmdbId = ids.tmdbId || showIds.tmdbId;
                ids.tvdbId = ids.tvdbId || showIds.tvdbId;
            }
        }
    }

    if (!Number.isFinite(ids.seasonNumber) || !Number.isFinite(ids.episodeNumber)) {
        const result = { ok: false, reason: 'missing-season-episode', ratingKey: episode?.ratingKey };
        await appendMetadataFillLog({ ...result, source, title: episode?.title });
        return result;
    }

    const patch = await fetchEpisodeMetadata(config, ids);
    if (patch.error && !patch.title && !patch.summary && !patch.originallyAvailableAt) {
        const result = {
            ok: false,
            reason: patch.error || 'no-source-data',
            ratingKey: episode?.ratingKey,
            showTitle: ids.showTitle,
            seasonNumber: ids.seasonNumber,
            episodeNumber: ids.episodeNumber,
        };
        await appendMetadataFillLog({ ...result, source, title: episode?.title });
        return result;
    }

    // Only write fields that still need fill AND we have a value for.
    const fields = {
        title: gate.fields.title && !!patch.title,
        summary: gate.fields.summary && !!patch.summary,
        originallyAvailableAt: gate.fields.originallyAvailableAt && !!patch.originallyAvailableAt,
    };
    if (!fields.title && !fields.summary && !fields.originallyAvailableAt) {
        const result = { ok: true, skipped: true, reason: 'no-usable-fields', ratingKey: episode?.ratingKey };
        await appendMetadataFillLog({ ...result, source, title: episode?.title, sources: patch.sources });
        return result;
    }

    const write = await plex.writeEpisodeFields(episode.ratingKey, patch, fields);
    const result = {
        ok: true,
        ratingKey: String(episode.ratingKey),
        showTitle: ids.showTitle,
        seasonNumber: ids.seasonNumber,
        episodeNumber: ids.episodeNumber,
        title: fields.title ? patch.title : undefined,
        summaryWritten: fields.summary,
        airDate: fields.originallyAvailableAt ? patch.originallyAvailableAt : undefined,
        sources: patch.sources,
        fields,
        source,
    };
    await appendMetadataFillLog(result);
    return { ...result, write };
};

export const fillShowEpisodes = async ({
    config,
    baseUrl,
    token,
    showRatingKey,
    concurrency = 2,
    source = 'manual-show',
    fetchImpl = fetch,
    rewrite = [],
} = {}) => {
    const plex = createPlexMetadataClient({ baseUrl, token, fetchImpl, rewrite });
    const episodes = await plex.listShowEpisodesNeedingFill(showRatingKey);
    const results = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, Math.max(1, episodes.length)) }, async () => {
        while (cursor < episodes.length) {
            const index = cursor;
            cursor += 1;
            const episode = episodes[index];
            try {
                results[index] = await fillOneEpisode({ config, plex, episode, source });
            } catch (error) {
                results[index] = {
                    ok: false,
                    ratingKey: episode?.ratingKey,
                    reason: error?.message || String(error),
                };
                await appendMetadataFillLog({ ...results[index], source });
            }
        }
    });
    await Promise.all(workers);
    return {
        ok: true,
        showRatingKey: String(showRatingKey),
        total: episodes.length,
        filled: results.filter((r) => r?.ok && !r.skipped).length,
        skipped: results.filter((r) => r?.skipped).length,
        failed: results.filter((r) => r && r.ok === false).length,
        results,
    };
};

export const fillEpisodeByFile = async ({
    config,
    baseUrl,
    token,
    filePath,
    seasonNumber,
    episodeNumber,
    tmdbId,
    tvdbId,
    source = 'sonarr-import',
    fetchImpl = fetch,
    rewrite = [],
    initialDelayMs = 45_000,
    retries = 3,
} = {}) => {
    const plex = createPlexMetadataClient({ baseUrl, token, fetchImpl, rewrite });
    let episode = null;
    if (filePath) {
        episode = await plex.findEpisodeByFile(filePath, { initialDelayMs, retries, retryDelayMs: 5000 });
    }
    if (!episode && Number.isFinite(Number(seasonNumber)) && Number.isFinite(Number(episodeNumber))) {
        // Soft fail — file not in Plex yet
        const result = {
            ok: false,
            reason: 'plex-episode-not-found',
            filePath,
            seasonNumber,
            episodeNumber,
            tmdbId,
            tvdbId,
        };
        await appendMetadataFillLog({ ...result, source });
        return result;
    }
    if (!episode) {
        const result = { ok: false, reason: 'plex-episode-not-found', filePath };
        await appendMetadataFillLog({ ...result, source });
        return result;
    }
    // Overlay Sonarr ids when Plex GUIDs are missing
    if (tmdbId && !plex.extractIdsFromMeta(episode).tmdbId) {
        episode = {
            ...episode,
            Guid: [...(Array.isArray(episode.Guid) ? episode.Guid : []), { id: `tmdb://${tmdbId}` }],
        };
    }
    if (tvdbId && !plex.extractIdsFromMeta(episode).tvdbId) {
        episode = {
            ...episode,
            Guid: [...(Array.isArray(episode.Guid) ? episode.Guid : []), { id: `tvdb://${tvdbId}` }],
        };
    }
    return fillOneEpisode({ config, plex, episode, source });
};
