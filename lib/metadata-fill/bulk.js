/**
 * Bulk unlock / revert Metadata Fill writes for a show.
 */

import { createPlexMetadataClient } from './plexWrite.js';
import { readMetadataFillLog, appendMetadataFillLog } from './store.js';
import { getMetadataFillOptions } from './settings.js';

const reversibleLogEntriesForShow = (log, showRatingKey) => {
    const key = String(showRatingKey || '').replace(/\D/g, '');
    if (!key) return [];
    const seen = new Set();
    const out = [];
    for (const row of log) {
        if (!row?.ok || row.dryRun || row.reverted || row.unlocked) continue;
        if (!row.before || !row.fields) continue;
        const showKey = String(row.showRatingKey || '').replace(/\D/g, '');
        if (showKey !== key) continue;
        const rk = String(row.ratingKey || '').replace(/\D/g, '');
        if (!rk || seen.has(rk)) continue;
        seen.add(rk);
        out.push(row);
    }
    return out;
};

export const bulkUnlockShow = async ({
    config,
    baseUrl,
    token,
    showRatingKey,
    rewrite = [],
    fetchImpl = fetch,
    source = 'bulk-unlock-show',
} = {}) => {
    const plex = createPlexMetadataClient({ baseUrl, token, fetchImpl, rewrite });
    const showKey = String(showRatingKey || '').replace(/\D/g, '');
    if (!showKey) return { ok: false, reason: 'showRatingKey-required' };

    const options = getMetadataFillOptions(config);
    const fields = options.fields;
    const log = await readMetadataFillLog();
    const fromLog = reversibleLogEntriesForShow(log, showKey);

    // Prefer log-known episodes; also unlock every episode leaf if none logged.
    let targets = fromLog.map((row) => ({
        ratingKey: String(row.ratingKey),
        fields: row.fields || fields,
        showTitle: row.showTitle,
        seasonNumber: row.seasonNumber,
        episodeNumber: row.episodeNumber,
        title: row.title,
    }));

    if (!targets.length) {
        const episodes = await plex.listShowEpisodes(showKey, { needingFillOnly: false });
        targets = episodes.map((ep) => ({
            ratingKey: String(ep.ratingKey),
            fields,
            showTitle: ep.grandparentTitle,
            seasonNumber: Number(ep.parentIndex),
            episodeNumber: Number(ep.index),
            title: ep.title,
        }));
    }

    const results = [];
    for (const target of targets) {
        try {
            await plex.unlockEpisodeFields(target.ratingKey, target.fields);
            const row = {
                ok: true,
                unlocked: true,
                ratingKey: target.ratingKey,
                showRatingKey: showKey,
                showTitle: target.showTitle,
                seasonNumber: target.seasonNumber,
                episodeNumber: target.episodeNumber,
                title: target.title,
                fields: target.fields,
                source,
            };
            await appendMetadataFillLog(row);
            results.push(row);
        } catch (error) {
            results.push({
                ok: false,
                ratingKey: target.ratingKey,
                reason: error?.message || String(error),
            });
        }
    }

    return {
        ok: true,
        showRatingKey: showKey,
        unlocked: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
    };
};

export const bulkRevertShow = async ({
    baseUrl,
    token,
    showRatingKey,
    unlock = true,
    rewrite = [],
    fetchImpl = fetch,
    source = 'bulk-revert-show',
} = {}) => {
    const plex = createPlexMetadataClient({ baseUrl, token, fetchImpl, rewrite });
    const showKey = String(showRatingKey || '').replace(/\D/g, '');
    if (!showKey) return { ok: false, reason: 'showRatingKey-required' };

    const log = await readMetadataFillLog();
    const entries = reversibleLogEntriesForShow(log, showKey);
    if (!entries.length) {
        return { ok: false, reason: 'no-reversible-snapshots', showRatingKey: showKey, reverted: 0 };
    }

    const results = [];
    for (const entry of entries) {
        const key = String(entry.ratingKey || '').replace(/\D/g, '');
        try {
            await plex.writeEpisodeFields(key, entry.before, entry.fields, { lock: !unlock });
            if (unlock) {
                await plex.unlockEpisodeFields(key, entry.fields);
            }
            const row = {
                ok: true,
                reverted: true,
                ratingKey: key,
                showRatingKey: showKey,
                showTitle: entry.showTitle,
                seasonNumber: entry.seasonNumber,
                episodeNumber: entry.episodeNumber,
                title: entry.before?.title,
                before: entry.after || null,
                after: entry.before,
                fields: entry.fields,
                unlocked: !!unlock,
                revertedFromLogId: entry.id || null,
                source,
            };
            await appendMetadataFillLog(row);
            results.push(row);
        } catch (error) {
            results.push({
                ok: false,
                ratingKey: key,
                reason: error?.message || String(error),
            });
        }
    }

    return {
        ok: true,
        showRatingKey: showKey,
        reverted: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
    };
};
