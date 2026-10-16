/**
 * Phase 7: sync portal request mediaStatus / isDownloading from *arr (+ disk).
 * Uses libraryAvailability — no Seerr download APIs.
 * Phase 1 (#89): also emits season-available and new-episode callbacks.
 */

import { createLibraryAvailability } from './libraryAvailability.js';
import {
    listNewlyCompletedSeasons,
    shouldNotifyNewEpisode,
} from '../notifications/requestLifecycle.js';

const REQUEST_STATUS_APPROVED = 2;
const SEERR_MEDIA_PROCESSING = 3;
const SEERR_MEDIA_PARTIAL = 4;
const SEERR_MEDIA_AVAILABLE = 5;

const needsStatusSync = (record) => {
    if (Number(record?.status) !== REQUEST_STATUS_APPROVED) return false;
    const mediaStatus = Number(record?.meta?.mediaStatus);
    const downloading = !!record?.meta?.isDownloading;
    // Keep polling until available and idle; also refresh partial/TV for season/episode.
    if (mediaStatus === SEERR_MEDIA_AVAILABLE && !downloading) {
        return !record?.meta?.notifiedAvailableAt;
    }
    return true;
};

const mapAvailabilityToMeta = (availability = {}) => {
    const downloading = !!availability.downloading;
    let mediaStatus = Number(availability.status);
    if (!Number.isFinite(mediaStatus) || mediaStatus <= 0) {
        mediaStatus = downloading ? SEERR_MEDIA_PROCESSING : SEERR_MEDIA_PROCESSING;
    }
    // Movie fully on disk → available; TV may be partial (4) or available (5).
    if (!downloading && (mediaStatus === SEERR_MEDIA_PARTIAL || mediaStatus === SEERR_MEDIA_AVAILABLE)) {
        // keep
    } else if (!downloading && availability.inLibrary) {
        mediaStatus = availability.partial ? SEERR_MEDIA_PARTIAL : SEERR_MEDIA_AVAILABLE;
    } else if (downloading) {
        mediaStatus = SEERR_MEDIA_PROCESSING;
    }

    return {
        mediaStatus,
        isDownloading: downloading,
        arrEntityId: availability?.radarrLibraryStatus?.movieId
            ?? availability?.sonarrLibraryStatus?.seriesId
            ?? availability?.lidarrLibraryStatus?.artistId
            ?? null,
        statusLabel: availability.statusLabel || null,
        syncedAt: new Date().toISOString(),
        episodeFileCount: Number(
            availability?.sonarrLibraryStatus?.episodeFileCount
            ?? availability?.sonarrLibraryStatus?.fileCount
            ?? NaN,
        ),
    };
};

const buildNextMeta = (record, nextMetaPatch) => ({
    ...(record.meta || {}),
    mediaStatus: nextMetaPatch.mediaStatus,
    isDownloading: nextMetaPatch.isDownloading,
    ...(nextMetaPatch.arrEntityId != null ? { arrEntityId: nextMetaPatch.arrEntityId } : {}),
    statusSyncedAt: nextMetaPatch.syncedAt,
    statusSyncLabel: nextMetaPatch.statusLabel,
});

/**
 * @param {object} options
 * @param {object} options.config
 * @param {{ list: Function, update: Function }} options.store
 * @param {(url: string) => string} [options.resolveUrl]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.limit] Max records per tick
 * @param {(args: { record: object, prevMediaStatus: number }) => Promise<*>} [options.onBecameAvailable]
 * @param {(args: { record: object, seasonNumber: number }) => Promise<*>} [options.onSeasonAvailable]
 * @param {(args: { record: object, added: number }) => Promise<*>} [options.onNewEpisode]
 */
export const syncPortalRequestStatuses = async ({
    config,
    store,
    resolveUrl = (url) => url,
    fetchImpl = fetch,
    limit = 80,
    onBecameAvailable = null,
    onSeasonAvailable = null,
    onNewEpisode = null,
} = {}) => {
    if (!store?.list || !store?.update) {
        throw new Error('request store is required');
    }

    const library = createLibraryAvailability(config, {
        resolveUrl,
        fetchImpl,
        upgraderItems: [],
        catalogTimeoutMs: 8000,
    });

    const records = await store.list({ status: REQUEST_STATUS_APPROVED });
    const targets = records.filter(needsStatusSync).slice(0, Math.max(1, limit));

    const summary = {
        scanned: records.length,
        checked: targets.length,
        updated: 0,
        available: 0,
        downloading: 0,
        unchanged: 0,
        notified: 0,
        seasonsNotified: 0,
        episodesNotified: 0,
        errors: 0,
    };

    const stampNotifiedAvailable = async (record, metaBase) => {
        const notifiedAvailableAt = new Date().toISOString();
        await store.update(record.id, {
            meta: {
                ...(metaBase || record.meta || {}),
                notifiedAvailableAt,
            },
        });
        return notifiedAvailableAt;
    };

    const maybeNotifySeasonsAndEpisodes = async (record, nextMeta, availability) => {
        if (record.mediaType !== 'tv') return nextMeta;

        let meta = { ...nextMeta };

        // Seed / update episode file count + optional new-episode notify.
        const episodeCheck = shouldNotifyNewEpisode({ ...record, meta }, availability);
        if (episodeCheck.nextCount != null && Number.isFinite(episodeCheck.nextCount)) {
            meta.lastEpisodeFileCount = episodeCheck.nextCount;
        }
        if (episodeCheck.ok && typeof onNewEpisode === 'function') {
            try {
                await onNewEpisode({
                    record: { ...record, meta },
                    added: episodeCheck.added || 0,
                });
                meta.lastNewEpisodeNotifyAt = new Date().toISOString();
                summary.episodesNotified += 1;
            } catch {
                // Keep going; count still advances so we don't spam later.
            }
        } else if (episodeCheck.seed && episodeCheck.nextCount != null) {
            meta.lastEpisodeFileCount = episodeCheck.nextCount;
        }

        // Season-complete notifications (batch per season, not per episode).
        const seasonNums = listNewlyCompletedSeasons({ ...record, meta }, availability);
        if (seasonNums.length) {
            const notifiedSeasonAvailable = {
                ...(meta.notifiedSeasonAvailable && typeof meta.notifiedSeasonAvailable === 'object'
                    ? meta.notifiedSeasonAvailable
                    : {}),
            };
            for (const seasonNumber of seasonNums) {
                // Skip season notifies once the show is already fully notified-available.
                if (meta.notifiedAvailableAt) {
                    notifiedSeasonAvailable[String(seasonNumber)] = meta.notifiedAvailableAt;
                    continue;
                }
                if (typeof onSeasonAvailable === 'function') {
                    try {
                        await onSeasonAvailable({
                            record: { ...record, meta },
                            seasonNumber,
                        });
                        summary.seasonsNotified += 1;
                    } catch {
                        // Still stamp to avoid retry spam.
                    }
                }
                notifiedSeasonAvailable[String(seasonNumber)] = new Date().toISOString();
            }
            meta.notifiedSeasonAvailable = notifiedSeasonAvailable;
        }

        return meta;
    };

    const maybeNotifyBecameAvailable = async (record, nextMeta, prevStatus, availability) => {
        let meta = await maybeNotifySeasonsAndEpisodes(record, nextMeta, availability);

        const becameFullyAvailable = meta.mediaStatus === SEERR_MEDIA_AVAILABLE
            && prevStatus !== SEERR_MEDIA_AVAILABLE
            && !meta.isDownloading
            && !meta.notifiedAvailableAt;

        if (!becameFullyAvailable) {
            // Already available but missing stamp (legacy import) — mark without notifying.
            if (
                meta.mediaStatus === SEERR_MEDIA_AVAILABLE
                && !meta.isDownloading
                && !meta.notifiedAvailableAt
            ) {
                const notifiedAvailableAt = new Date().toISOString();
                const seasons = listNewlyCompletedSeasons({ ...record, meta }, availability);
                const notifiedSeasonAvailable = {
                    ...(meta.notifiedSeasonAvailable || {}),
                };
                for (const seasonNumber of seasons) {
                    notifiedSeasonAvailable[String(seasonNumber)] = notifiedAvailableAt;
                }
                meta = { ...meta, notifiedAvailableAt, notifiedSeasonAvailable };
                await store.update(record.id, { meta });
                return;
            }

            // Persist episode/season stamp updates even when mediaStatus did not change.
            const prevEpisode = Number(record?.meta?.lastEpisodeFileCount);
            const nextEpisode = Number(meta.lastEpisodeFileCount);
            const seasonsChanged = JSON.stringify(record?.meta?.notifiedSeasonAvailable || {})
                !== JSON.stringify(meta.notifiedSeasonAvailable || {});
            const episodeChanged = Number.isFinite(nextEpisode) && nextEpisode !== prevEpisode;
            const episodeNotifyChanged = record?.meta?.lastNewEpisodeNotifyAt !== meta.lastNewEpisodeNotifyAt;
            if (seasonsChanged || episodeChanged || episodeNotifyChanged) {
                await store.update(record.id, { meta });
            }
            return;
        }

        if (typeof onBecameAvailable === 'function') {
            try {
                await onBecameAvailable({
                    record: { ...record, meta },
                    prevMediaStatus: prevStatus,
                });
                summary.notified += 1;
            } catch {
                // Still stamp so we don't spam every tick on a permanent handler failure.
            }
        }

        const notifiedAvailableAt = new Date().toISOString();
        const seasons = listNewlyCompletedSeasons({ ...record, meta }, availability);
        const notifiedSeasonAvailable = {
            ...(meta.notifiedSeasonAvailable || {}),
        };
        for (const seasonNumber of seasons) {
            notifiedSeasonAvailable[String(seasonNumber)] = notifiedAvailableAt;
        }
        // Also stamp any remaining availability seasons as notified under full-available.
        for (const season of (availability?.mediaInfo?.seasons || [])) {
            const num = Number(season?.seasonNumber);
            if (Number.isFinite(num) && num > 0 && Number(season?.status) === 5) {
                notifiedSeasonAvailable[String(num)] = notifiedSeasonAvailable[String(num)] || notifiedAvailableAt;
            }
        }
        meta = { ...meta, notifiedAvailableAt, notifiedSeasonAvailable };
        await store.update(record.id, { meta });
    };

    for (const record of targets) {
        const mediaType = record.mediaType === 'tv'
            ? 'tv'
            : (record.mediaType === 'music' ? 'music' : 'movie');
        if (mediaType === 'music') {
            const mbid = String(record?.mbid || '').trim();
            if (!mbid) {
                summary.unchanged += 1;
                continue;
            }
            try {
                const availability = await library.getMusicStatus(mbid);
                const nextMetaPatch = mapAvailabilityToMeta(availability || {});
                const prevStatus = Number(record?.meta?.mediaStatus);
                const prevDownloading = !!record?.meta?.isDownloading;
                const prevEntityId = record?.meta?.arrEntityId ?? null;
                const changed = prevStatus !== nextMetaPatch.mediaStatus
                    || prevDownloading !== nextMetaPatch.isDownloading
                    || (nextMetaPatch.arrEntityId != null && Number(prevEntityId) !== Number(nextMetaPatch.arrEntityId));
                if (!changed) {
                    if (
                        nextMetaPatch.mediaStatus === SEERR_MEDIA_AVAILABLE
                        && !nextMetaPatch.isDownloading
                        && !record?.meta?.notifiedAvailableAt
                    ) {
                        await stampNotifiedAvailable(record, record.meta || {});
                    }
                    summary.unchanged += 1;
                    continue;
                }
                const nextMeta = buildNextMeta(record, nextMetaPatch);
                await store.update(record.id, { meta: nextMeta });
                summary.updated += 1;
                if (nextMetaPatch.mediaStatus === SEERR_MEDIA_AVAILABLE) summary.available += 1;
                if (nextMetaPatch.isDownloading) summary.downloading += 1;
                await maybeNotifyBecameAvailable(record, nextMeta, prevStatus, availability || {});
            } catch {
                summary.errors += 1;
            }
            continue;
        }
        const tmdbId = Number(record.tmdbId);
        if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
            summary.unchanged += 1;
            continue;
        }

        try {
            const availability = await library.getMediaStatus(mediaType, tmdbId);
            const nextMetaPatch = mapAvailabilityToMeta(availability || {});
            const prevStatus = Number(record?.meta?.mediaStatus);
            const prevDownloading = !!record?.meta?.isDownloading;
            const prevEntityId = record?.meta?.arrEntityId ?? null;

            const changed = prevStatus !== nextMetaPatch.mediaStatus
                || prevDownloading !== nextMetaPatch.isDownloading
                || (nextMetaPatch.arrEntityId != null && Number(prevEntityId) !== Number(nextMetaPatch.arrEntityId));

            if (!changed) {
                if (mediaType === 'tv') {
                    const nextMeta = buildNextMeta(record, nextMetaPatch);
                    await maybeNotifyBecameAvailable(record, nextMeta, prevStatus, availability || {});
                } else if (
                    nextMetaPatch.mediaStatus === SEERR_MEDIA_AVAILABLE
                    && !nextMetaPatch.isDownloading
                    && !record?.meta?.notifiedAvailableAt
                ) {
                    await stampNotifiedAvailable(record, record.meta || {});
                } else {
                    summary.unchanged += 1;
                    continue;
                }
                summary.unchanged += 1;
                continue;
            }

            const nextMeta = buildNextMeta(record, nextMetaPatch);
            await store.update(record.id, { meta: nextMeta });

            summary.updated += 1;
            if (nextMetaPatch.isDownloading) summary.downloading += 1;
            if (
                !nextMetaPatch.isDownloading
                && (nextMetaPatch.mediaStatus === SEERR_MEDIA_AVAILABLE || nextMetaPatch.mediaStatus === SEERR_MEDIA_PARTIAL)
            ) {
                summary.available += 1;
            }
            await maybeNotifyBecameAvailable(record, nextMeta, prevStatus, availability || {});
        } catch {
            summary.errors += 1;
        }
    }

    return summary;
};

export default syncPortalRequestStatuses;
