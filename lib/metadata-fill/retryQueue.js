/**
 * Persist failed Metadata Fill jobs for later retry.
 */

import {
    MAX_RETRY,
    newMetadataFillId,
    readRetryQueue,
    writeRetryQueue,
} from './store.js';

const fingerprint = (item = {}) => {
    if (item.ratingKey) return `rk:${item.ratingKey}`;
    const se = `S${item.seasonNumber ?? 'x'}E${item.episodeNumber ?? 'x'}`;
    const id = item.tvdbId || item.tmdbId || item.imdbId || item.showTitle || '';
    return `${id}:${se}:${item.filePath || ''}`;
};

export const enqueueRetryItem = async (item = {}) => {
    const queue = await readRetryQueue();
    const fp = fingerprint(item);
    const existing = queue.items.find((row) => fingerprint(row) === fp);
    if (existing) {
        existing.lastError = item.reason || item.lastError || existing.lastError;
        existing.updatedAt = new Date().toISOString();
        existing.attempts = Number(existing.attempts) || 0;
        await writeRetryQueue(queue);
        return existing;
    }
    const row = {
        id: newMetadataFillId(),
        enqueuedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        attempts: 0,
        lastError: item.reason || null,
        filePath: item.filePath || null,
        seasonNumber: item.seasonNumber ?? null,
        episodeNumber: item.episodeNumber ?? null,
        tmdbId: item.tmdbId || null,
        tvdbId: item.tvdbId || null,
        imdbId: item.imdbId || null,
        showTitle: item.showTitle || null,
        ratingKey: item.ratingKey ? String(item.ratingKey) : null,
        source: item.source || 'retry',
    };
    queue.items.unshift(row);
    await writeRetryQueue({ items: queue.items.slice(0, MAX_RETRY) });
    return row;
};

export const listRetryQueue = async () => readRetryQueue();

export const removeRetryItem = async (id) => {
    const queue = await readRetryQueue();
    const next = queue.items.filter((row) => String(row.id) !== String(id));
    await writeRetryQueue({ items: next });
    return { ok: true, removed: queue.items.length - next.length };
};

export const clearRetryQueue = async () => {
    await writeRetryQueue({ items: [] });
    return { ok: true };
};

/**
 * Process up to `limit` retry items. Successful / permanently skipped items are removed.
 */
export const processRetryQueue = async ({
    config,
    baseUrl,
    token,
    rewrite = [],
    limit = 10,
    fetchImpl = fetch,
} = {}) => {
    // Dynamic import avoids circular dependency with job.js (which enqueues retries).
    const { fillEpisodeByFile, fillEpisodeByRatingKey } = await import('./job.js');
    const queue = await readRetryQueue();
    const batch = queue.items.slice(0, Math.min(50, Math.max(1, limit)));
    const results = [];

    for (const item of batch) {
        item.attempts = (Number(item.attempts) || 0) + 1;
        item.lastAttemptAt = new Date().toISOString();
        try {
            let result;
            if (item.ratingKey) {
                result = await fillEpisodeByRatingKey({
                    config,
                    baseUrl,
                    token,
                    rewrite,
                    fetchImpl,
                    ratingKey: item.ratingKey,
                    source: 'retry-queue',
                    dryRun: false,
                });
            } else {
                result = await fillEpisodeByFile({
                    config,
                    baseUrl,
                    token,
                    rewrite,
                    fetchImpl,
                    filePath: item.filePath,
                    seasonNumber: item.seasonNumber,
                    episodeNumber: item.episodeNumber,
                    tmdbId: item.tmdbId,
                    tvdbId: item.tvdbId,
                    imdbId: item.imdbId,
                    showTitle: item.showTitle,
                    source: 'retry-queue',
                    initialDelayMs: 0,
                    retries: 2,
                    retryDelayMs: 3000,
                    enqueueRetry: false,
                });
            }
            const stillMissing = result?.reason === 'plex-episode-not-found'
                || result?.reason === 'no-source-data'
                || result?.ok === false;
            const done = !stillMissing && (
                (result?.ok && !result?.skipped)
                || result?.skipped
                || result?.reason === 'already-filled'
            );
            if (done) {
                results.push({ id: item.id, ok: true, removed: true, result });
            } else {
                item.lastError = result?.reason || 'retry-failed';
                item.updatedAt = new Date().toISOString();
                results.push({ id: item.id, ok: false, removed: false, result, item });
            }
        } catch (error) {
            item.lastError = error?.message || String(error);
            item.updatedAt = new Date().toISOString();
            results.push({ id: item.id, ok: false, removed: false, error: item.lastError, item });
        }
    }

    const failed = results.filter((r) => !r.removed).map((r) => r.item || batch.find((b) => b.id === r.id));
    const untouched = queue.items.slice(batch.length);
    await writeRetryQueue({ items: [...failed.filter(Boolean), ...untouched] });

    return {
        ok: true,
        processed: results.length,
        removed: results.filter((r) => r.removed).length,
        remaining: failed.length + untouched.length,
        results: results.map(({ item: _i, ...rest }) => rest),
    };
};
