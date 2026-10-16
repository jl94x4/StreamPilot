/**
 * Metadata fill job runner + activity log (JSON under config/metadata-fill/).
 */

import { needsMetadataFill } from './detect.js';
import { fetchEpisodeMetadata } from './sources.js';
import { createPlexMetadataClient } from './plexWrite.js';
import {
    appendMetadataFillLog,
    findMetadataFillLogEntry,
    newMetadataFillId,
    readMetadataFillLog,
} from './store.js';
import { enqueueRetryItem } from './retryQueue.js';
import { getMetadataFillOptions } from './settings.js';

export {
    METADATA_FILL_DIR,
    readMetadataFillLog,
    appendMetadataFillLog,
} from './store.js';

export const isMetadataFillEnabled = (config = {}) => (
    !!config.metadataFillEnabled
    && String(config.mediaServerType || 'plex').toLowerCase() === 'plex'
);

export const isMetadataFillAutoImportEnabled = (config = {}) => (
    isMetadataFillEnabled(config) && config.metadataFillAutoImport !== false
);

const snapshotEpisode = (episode = {}) => ({
    title: episode?.title != null ? String(episode.title) : '',
    summary: episode?.summary != null ? String(episode.summary) : '',
    originallyAvailableAt: episode?.originallyAvailableAt != null
        ? String(episode.originallyAvailableAt).slice(0, 10)
        : '',
});

const enrichIdsFromShow = async (plex, episode, ids) => {
    if (ids.tmdbId && ids.tvdbId && ids.imdbId) return ids;
    const showKey = String(episode?.grandparentRatingKey || '').replace(/\D/g, '');
    if (!showKey) return ids;
    const show = await plex.getMetadata(showKey).catch(() => null);
    if (!show) return ids;
    const showIds = plex.extractIdsFromMeta({ ...show, grandparentGuid: show.guid });
    return {
        ...ids,
        tmdbId: ids.tmdbId || showIds.tmdbId,
        tvdbId: ids.tvdbId || showIds.tvdbId,
        imdbId: ids.imdbId || showIds.imdbId,
    };
};

/**
 * Fill one Plex episode metadata object (already loaded).
 */
export const fillOneEpisode = async ({
    config,
    plex,
    episode,
    source = 'manual',
    dryRun = false,
    enqueueRetry = true,
    logActivity = true,
} = {}) => {
    const gate = needsMetadataFill(episode);
    if (!gate.needs) {
        return { ok: true, skipped: true, reason: 'already-filled', ratingKey: episode?.ratingKey };
    }

    let ids = plex.extractIdsFromMeta(episode);
    ids = await enrichIdsFromShow(plex, episode, ids);

    if (!Number.isFinite(ids.seasonNumber) || !Number.isFinite(ids.episodeNumber)) {
        const result = { ok: false, reason: 'missing-season-episode', ratingKey: episode?.ratingKey };
        if (logActivity) await appendMetadataFillLog({ ...result, source, title: episode?.title });
        return result;
    }

    const options = getMetadataFillOptions(config);
    const showRatingKey = String(episode?.grandparentRatingKey || '').replace(/\D/g, '') || null;

    const patch = await fetchEpisodeMetadata(config, ids);
    if (patch.error && !patch.title && !patch.summary && !patch.originallyAvailableAt) {
        // No usable remote metadata is an expected miss, not a hard failure.
        const reason = patch.error || 'no-source-data';
        const result = {
            ok: true,
            skipped: true,
            reason,
            ratingKey: episode?.ratingKey,
            showRatingKey,
            showTitle: ids.showTitle,
            seasonNumber: ids.seasonNumber,
            episodeNumber: ids.episodeNumber,
            tmdbId: ids.tmdbId,
            tvdbId: ids.tvdbId,
            imdbId: ids.imdbId,
        };
        if (logActivity) await appendMetadataFillLog({ ...result, source, title: episode?.title });
        // Only queue retries for likely-transient misses (sources empty now may fill later).
        if (enqueueRetry && reason === 'no-source-data') {
            await enqueueRetryItem({
                reason: result.reason,
                ratingKey: result.ratingKey,
                showTitle: result.showTitle,
                seasonNumber: result.seasonNumber,
                episodeNumber: result.episodeNumber,
                tmdbId: result.tmdbId,
                tvdbId: result.tvdbId,
                imdbId: result.imdbId,
                source,
            }).catch(() => {});
        }
        return result;
    }

    const titleBlockedByConflict = options.requireTitleAgreement && !!patch.titleConflict;

    // Only write fields that still need fill, are enabled, AND we have a value for.
    const fields = {
        title: options.fields.title && gate.fields.title && !!patch.title && !titleBlockedByConflict,
        summary: options.fields.summary && gate.fields.summary && !!patch.summary,
        originallyAvailableAt: options.fields.originallyAvailableAt
            && gate.fields.originallyAvailableAt
            && !!patch.originallyAvailableAt,
    };
    if (!fields.title && !fields.summary && !fields.originallyAvailableAt) {
        const reason = titleBlockedByConflict && gate.fields.title && patch.title
            ? 'title-source-conflict'
            : 'no-usable-fields';
        const result = {
            ok: true,
            skipped: true,
            reason,
            ratingKey: episode?.ratingKey,
            showRatingKey,
            showTitle: ids.showTitle,
            seasonNumber: ids.seasonNumber,
            episodeNumber: ids.episodeNumber,
            titleConflict: !!patch.titleConflict,
            titles: patch.titles,
            sources: patch.sources,
        };
        if (logActivity) {
            await appendMetadataFillLog({ ...result, source, title: episode?.title });
        }
        return result;
    }

    const before = snapshotEpisode(episode);
    const after = {
        title: fields.title ? patch.title : before.title,
        summary: fields.summary ? patch.summary : before.summary,
        originallyAvailableAt: fields.originallyAvailableAt
            ? patch.originallyAvailableAt
            : before.originallyAvailableAt,
    };

    if (dryRun) {
        const result = {
            ok: true,
            dryRun: true,
            preview: true,
            ratingKey: String(episode.ratingKey),
            showRatingKey,
            showTitle: ids.showTitle,
            seasonNumber: ids.seasonNumber,
            episodeNumber: ids.episodeNumber,
            title: fields.title ? patch.title : undefined,
            summaryWritten: fields.summary,
            airDate: fields.originallyAvailableAt ? patch.originallyAvailableAt : undefined,
            sources: patch.sources,
            titleConflict: !!patch.titleConflict,
            titles: patch.titles,
            fields,
            before,
            after,
            source,
        };
        if (logActivity) await appendMetadataFillLog(result);
        return result;
    }

    const write = await plex.writeEpisodeFields(episode.ratingKey, patch, fields);
    const result = {
        ok: true,
        ratingKey: String(episode.ratingKey),
        showRatingKey,
        showTitle: ids.showTitle,
        seasonNumber: ids.seasonNumber,
        episodeNumber: ids.episodeNumber,
        title: fields.title ? patch.title : undefined,
        summaryWritten: fields.summary,
        airDate: fields.originallyAvailableAt ? patch.originallyAvailableAt : undefined,
        sources: patch.sources,
        titleConflict: !!patch.titleConflict,
        titles: patch.titles,
        fields,
        before,
        after,
        source,
        reversible: true,
    };
    if (logActivity) await appendMetadataFillLog(result);
    return { ...result, write };
};

export const fillShowEpisodes = async ({
    config,
    baseUrl,
    token,
    showRatingKey,
    concurrency = 2,
    source = 'manual-show',
    dryRun = false,
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
                results[index] = await fillOneEpisode({
                    config, plex, episode, source, dryRun,
                });
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

    // Re-check leaves that still need fill (audit after this show pass).
    let stillTba = [];
    if (!dryRun) {
        const remaining = await plex.listShowEpisodesNeedingFill(showRatingKey).catch(() => []);
        stillTba = remaining.slice(0, 100).map((ep) => ({
            ratingKey: String(ep.ratingKey),
            showRatingKey: String(showRatingKey),
            showTitle: ep.grandparentTitle || '',
            seasonNumber: Number(ep.parentIndex),
            episodeNumber: Number(ep.index),
            title: ep.title || '',
        }));
    }

    return {
        ok: true,
        dryRun: !!dryRun,
        showRatingKey: String(showRatingKey),
        total: episodes.length,
        filled: results.filter((r) => r?.ok && !r.skipped && !r.dryRun).length,
        previewed: results.filter((r) => r?.dryRun).length,
        skipped: results.filter((r) => r?.skipped).length,
        failed: results.filter((r) => r && r.ok === false).length,
        stillTba,
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
    imdbId,
    showTitle,
    source = 'sonarr-import',
    fetchImpl = fetch,
    rewrite = [],
    initialDelayMs = 45_000,
    retries = 3,
    retryDelayMs = 5000,
    enqueueRetry = true,
} = {}) => {
    const plex = createPlexMetadataClient({ baseUrl, token, fetchImpl, rewrite });
    let episode = null;
    if (filePath) {
        episode = await plex.findEpisodeByFile(filePath, { initialDelayMs, retries, retryDelayMs });
    }
    // Path lookup often loses to mount-map / scan lag — resolve by show + S/E instead.
    if (!episode && Number.isFinite(Number(seasonNumber)) && Number.isFinite(Number(episodeNumber))) {
        episode = await plex.findEpisodeByShowEpisode({
            seasonNumber,
            episodeNumber,
            tmdbId,
            tvdbId,
            imdbId,
            showTitle,
            retries: filePath ? Math.min(2, retries) : retries,
            retryDelayMs,
            initialDelayMs: filePath ? 0 : initialDelayMs,
        }).catch(() => null);
    }
    if (!episode) {
        const result = {
            ok: false,
            reason: 'plex-episode-not-found',
            filePath,
            seasonNumber,
            episodeNumber,
            tmdbId,
            tvdbId,
            imdbId,
            showTitle,
        };
        await appendMetadataFillLog({ ...result, source });
        if (enqueueRetry) {
            await enqueueRetryItem({
                ...result,
                source,
            }).catch(() => {});
        }
        return result;
    }
    // Overlay Sonarr ids when Plex GUIDs are missing
    const existing = plex.extractIdsFromMeta(episode);
    const extraGuids = [];
    if (tmdbId && !existing.tmdbId) extraGuids.push({ id: `tmdb://${tmdbId}` });
    if (tvdbId && !existing.tvdbId) extraGuids.push({ id: `tvdb://${tvdbId}` });
    if (imdbId && !existing.imdbId) extraGuids.push({ id: `imdb://${imdbId}` });
    if (extraGuids.length) {
        episode = {
            ...episode,
            Guid: [...(Array.isArray(episode.Guid) ? episode.Guid : []), ...extraGuids],
        };
    }
    return fillOneEpisode({ config, plex, episode, source, enqueueRetry });
};

export const unlockEpisode = async ({
    baseUrl,
    token,
    ratingKey,
    fields = { title: true, summary: true, originallyAvailableAt: true },
    fetchImpl = fetch,
    rewrite = [],
    source = 'manual-unlock',
} = {}) => {
    const plex = createPlexMetadataClient({ baseUrl, token, fetchImpl, rewrite });
    const key = String(ratingKey || '').replace(/\D/g, '');
    const meta = await plex.getMetadata(key);
    if (!meta || String(meta.type || '') !== 'episode') {
        return { ok: false, reason: 'episode-not-found', ratingKey: key };
    }
    const write = await plex.unlockEpisodeFields(key, fields);
    const result = {
        ok: true,
        unlocked: true,
        ratingKey: key,
        showTitle: String(meta.grandparentTitle || ''),
        seasonNumber: Number(meta.parentIndex),
        episodeNumber: Number(meta.index),
        title: meta.title,
        fields,
        source,
    };
    await appendMetadataFillLog(result);
    return { ...result, write };
};

export const revertEpisodeFill = async ({
    baseUrl,
    token,
    ratingKey,
    logId,
    unlock = true,
    fetchImpl = fetch,
    rewrite = [],
    source = 'manual-revert',
} = {}) => {
    const plex = createPlexMetadataClient({ baseUrl, token, fetchImpl, rewrite });
    let entry = null;
    if (logId) {
        entry = await findMetadataFillLogEntry(logId);
    }
    if (!entry && ratingKey) {
        const log = await readMetadataFillLog();
        entry = log.find((row) => (
            String(row?.ratingKey || '') === String(ratingKey)
            && row?.ok
            && row?.before
            && !row?.dryRun
            && !row?.reverted
            && !row?.unlocked
        )) || null;
    }
    if (!entry?.before || !entry?.fields) {
        return { ok: false, reason: 'no-reversible-snapshot', ratingKey, logId };
    }

    const key = String(entry.ratingKey || ratingKey || '').replace(/\D/g, '');
    const write = await plex.writeEpisodeFields(key, entry.before, entry.fields, { lock: !unlock });
    if (unlock) {
        await plex.unlockEpisodeFields(key, entry.fields);
    }

    const result = {
        ok: true,
        reverted: true,
        ratingKey: key,
        showTitle: entry.showTitle,
        seasonNumber: entry.seasonNumber,
        episodeNumber: entry.episodeNumber,
        title: entry.before.title,
        before: entry.after || null,
        after: entry.before,
        fields: entry.fields,
        unlocked: !!unlock,
        revertedFromLogId: entry.id || null,
        source,
    };
    await appendMetadataFillLog(result);
    return { ...result, write };
};

export const fillEpisodeByRatingKey = async ({
    config,
    baseUrl,
    token,
    ratingKey,
    source = 'manual-episode',
    dryRun = false,
    fetchImpl = fetch,
    rewrite = [],
} = {}) => {
    const plex = createPlexMetadataClient({ baseUrl, token, fetchImpl, rewrite });
    const key = String(ratingKey || '').replace(/\D/g, '');
    const episode = await plex.getMetadata(key);
    if (!episode || String(episode.type || '') !== 'episode') {
        return { ok: false, reason: 'episode-not-found', ratingKey: key };
    }
    return fillOneEpisode({ config, plex, episode, source, dryRun });
};

export { newMetadataFillId, findMetadataFillLogEntry };
