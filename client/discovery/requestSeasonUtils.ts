/** Seerr / Jellyseerr media status codes (library state). */
export const MEDIA_STATUS = {
    UNKNOWN: 1,
    PENDING: 2,
    PROCESSING: 3,
    PARTIAL: 4,
    AVAILABLE: 5,
    BLACKLISTED: 6,
    DELETED: 7,
} as const;

/** Seerr request status codes. */
export const REQUEST_STATUS = {
    PENDING: 1,
    APPROVED: 2,
    DECLINED: 3,
    FAILED: 4,
} as const;

export type SeasonStatusInfo = {
    seasonNumber: number;
    name: string;
    episodeCount: number;
    posterPath?: string | null;
    libraryStatus: number | null;
    requestStatus: number | null;
    statusLabel: string;
    requestable: boolean;
};

/** True when a Seerr downloadStatus row is an active Radarr/Sonarr queue transfer. */
export const isActiveSeerrDownloadItem = (item: any): boolean => {
    if (!item || typeof item !== 'object') return false;

    const sizeLeft = Number(item.sizeLeft ?? item.sizeleft);
    if (Number.isFinite(sizeLeft) && sizeLeft > 0) return true;

    const statusRaw = item.status;
    // Ignore mistaken numeric media-status values on download rows (e.g. 5 = available).
    if (
        typeof statusRaw === 'number'
        || (typeof statusRaw === 'string' && /^\d+$/.test(String(statusRaw).trim()))
    ) {
        return false;
    }

    const status = String(statusRaw || '').toLowerCase().trim();
    if (!status) return false;
    if (status === 'completed' || status === 'failed') return false;
    return (
        status === 'downloading'
        || status === 'queued'
        || status === 'paused'
        || status === 'delay'
        || status === 'warning'
        || status === 'downloadclientunavailable'
        || status === 'fallback'
        || status === 'unknown'
    );
};

/** True when Seerr's download tracker reports active Radarr/Sonarr queue items. */
export const hasActiveSeerrDownloads = (
    mediaInfo: any,
    opts?: { is4k?: boolean | null; seasonNumber?: number | null },
): boolean => {
    if (!mediaInfo || typeof mediaInfo !== 'object') return false;

    const hd = Array.isArray(mediaInfo.downloadStatus) ? mediaInfo.downloadStatus : [];
    const fourK = Array.isArray(mediaInfo.downloadStatus4k) ? mediaInfo.downloadStatus4k : [];
    let queues: any[] = [];
    if (opts?.is4k === true) queues = fourK;
    else if (opts?.is4k === false) queues = hd;
    else queues = [...hd, ...fourK];

    const activeQueues = queues.filter((item) => isActiveSeerrDownloadItem(item));

    if (typeof opts?.seasonNumber === 'number' && Number.isFinite(opts.seasonNumber)) {
        return activeQueues.some((item) => Number(item?.episode?.seasonNumber) === opts.seasonNumber);
    }

    return activeQueues.length > 0;
};

/** True when Seerr or Sonarr reports this title is still downloading / importing. */
export const hasActiveShowDownloads = (details?: any, mediaInfo?: any): boolean => {
    if (details?.sonarrLibraryStatus?.hasActiveDownloads) return true;
    return hasActiveSeerrDownloads(mediaInfo || details?.mediaInfo);
};

export const isMediaActivelyProcessing = (
    mediaInfo: any,
    mediaStatus?: number | null,
    details?: any,
): boolean => {
    if (hasActiveShowDownloads(details, mediaInfo)) return true;
    const status = Number(mediaStatus ?? mediaInfo?.status);
    if (status !== MEDIA_STATUS.PROCESSING) return false;
    return hasActiveSeerrDownloads(mediaInfo);
};

export const resolveInProgressDisplay = (
    mediaInfo: any,
    mediaStatus?: number | null,
    details?: any,
): { kind: 'processing' | 'requested'; label: string; detail: string } | null => {
    if (hasActiveShowDownloads(details, mediaInfo)) {
        return {
            kind: 'processing',
            label: 'Processing',
            detail: 'Episodes are still downloading or importing.',
        };
    }

    const status = Number(mediaStatus ?? mediaInfo?.status);
    if (status !== MEDIA_STATUS.PROCESSING) return null;
    // Files on disk (including still-airing / Partial) are not "waiting to download".
    if (sonarrHasOnDiskFiles(details?.sonarrLibraryStatus)) return null;

    if (hasActiveSeerrDownloads(mediaInfo)) {
        return {
            kind: 'processing',
            label: 'Processing',
            detail: 'Your request is being downloaded or imported.',
        };
    }

    return {
        kind: 'requested',
        label: 'Requested',
        detail: 'Your request was sent to the media server and is waiting to download.',
    };
};

/** Whether a season still has unaired episodes scheduled (currently airing). */
export const isReturningSeries = (details: any): boolean => {
    const status = String(details?.status || '').toLowerCase();
    if (status === 'ended' || status === 'canceled' || status === 'cancelled') return false;
    if (status === 'in production') return false;
    if (details?.inProduction === true || status === 'returning series') return true;
    // Browse cards omit TMDB status — Sonarr nextAiring / continuing is the list-path signal.
    const sonarrStatus = String(details?.sonarrLibraryStatus?.seriesStatus || '').toLowerCase();
    if (sonarrStatus === 'ended' || sonarrStatus === 'canceled' || sonarrStatus === 'cancelled') return false;
    if (sonarrStatus === 'continuing' || sonarrStatus === 'upcoming') return true;
    return Boolean(details?.sonarrLibraryStatus?.nextAiring);
};

/** True when Sonarr reports episode files on disk (continuing shows are not showComplete). */
export const sonarrHasOnDiskFiles = (sonarr: any): boolean => {
    if (!sonarr?.matched || sonarr.hasActiveDownloads) return false;
    if (sonarr.showComplete) return true;
    const fileCount = Number(sonarr.fileCount ?? sonarr.episodeFileCount) || 0;
    if (fileCount > 0) return true;
    return (sonarr.seasons || []).some((season: any) => (
        Number(season?.withFile) > 0 || Number(season?.airedWithFile) > 0
    ));
};

export const isEndedShow = (details: any): boolean => {
    if (details?.inProduction === true) return false;
    const status = String(details?.status || '').toLowerCase();
    return status === 'ended' || status === 'canceled' || status === 'cancelled';
};

export const isMainSeasonNumber = (seasonNumber: number) => Number(seasonNumber) > 0;

/** Sonarr episode rows confirm at least one episode has aired (or files on disk). */
export const sonarrHasAiredEpisodes = (sonarr: any): boolean => {
    if (!sonarr?.matched) return false;
    if ((sonarr.seasons || []).some((season: any) => Number(season?.airedTotal) > 0)) return true;
    const fileCount = Number(sonarr.fileCount ?? sonarr.episodeFileCount) || 0;
    return fileCount > 0;
};

/** True when at least one episode has aired on this show. */
export const hasAnyEpisodeAired = (details: any): boolean => {
    const last = details?.lastEpisodeToAir;
    const season = Number(last?.seasonNumber);
    const episode = Number(last?.episodeNumber);
    if (Number.isFinite(season) && season > 0 && Number.isFinite(episode) && episode > 0) {
        const airDate = last?.airDate || last?.air_date;
        if (airDate) {
            const parsed = Date.parse(String(airDate));
            if (!Number.isNaN(parsed) && parsed > Date.now()) return false;
        }
        return true;
    }

    const sonarr = details?.sonarrLibraryStatus;
    if (sonarr?.matched) {
        if (sonarrHasAiredEpisodes(sonarr)) return true;
        if (sonarr.showComplete) return true;
    }

    // Discover browse rows often omit lastEpisodeToAir — infer from premiere date.
    const firstAir = String(details?.firstAirDate || details?.first_air_date || '').slice(0, 10);
    if (firstAir) {
        const parsed = Date.parse(firstAir);
        if (!Number.isNaN(parsed) && parsed <= Date.now()) return true;
    }

    return false;
};

/** True when Sonarr confirms every aired main season is complete on disk. */
export const sonarrMainSeasonsFullyOnDisk = (details: any): boolean => {
    const sonarr = details?.sonarrLibraryStatus;
    if (!sonarr?.matched || sonarr.hasActiveDownloads || sonarr.nextAiring) return false;
    if (sonarr.showComplete) return true;

    const main = (sonarr.seasons || []).filter((s: any) => isMainSeasonNumber(Number(s?.seasonNumber)));
    if (!main.length) return false;

    const airedMain = main.filter((s: any) => Number(s?.airedTotal) > 0);
    if (airedMain.length > 0) {
        return airedMain.every((s: any) => !!s.complete);
    }

    // Unmonitored libraries: trust per-season file totals when every season is full.
    return main.every(
        (s: any) => !!s.complete
            || (Number(s.total) > 0 && Number(s.withFile) >= Number(s.total)),
    );
};

/** Never badge unreleased / pre-premiere shows as library-available. */
export const canMarkTvAsAvailable = (details: any): boolean => {
    const sonarr = details?.sonarrLibraryStatus;
    const status = Number(details?.mediaInfo?.status);
    const hasLibraryStamp = status >= MEDIA_STATUS.PARTIAL && status <= MEDIA_STATUS.AVAILABLE;
    const fileCount = Number(sonarr?.fileCount ?? sonarr?.episodeFileCount) || 0;

    // Discover browse / watchlist rows often omit lastEpisodeToAir + seasons[].
    if (sonarr?.matched) {
        if (sonarrHasAiredEpisodes(sonarr) || sonarr.showComplete) return true;
        // Catalog PARTIAL/AVAILABLE is file-backed; prefer fileCount when present.
        if (fileCount > 0 && hasLibraryStamp) return true;
        // Older cache rows omit fileCount — allow only after premiere (blocks Seerr pre-premiere AVAILABLE).
        if (hasLibraryStamp && hasAnyEpisodeAired({ ...details, sonarrLibraryStatus: null })) return true;
        return false;
    }

    if (!hasAnyEpisodeAired(details)) return false;
    return true;
};

/** True when this season has at least one aired episode. */
export const hasSeasonAired = (details: any, seasonNumber: number): boolean => {
    if (!hasAnyEpisodeAired(details)) return false;

    const last = details?.lastEpisodeToAir;
    const lastSeason = Number(last?.seasonNumber);
    const lastEpisode = Number(last?.episodeNumber);

    if (Number.isFinite(lastSeason) && lastSeason > 0 && Number.isFinite(lastEpisode) && lastEpisode > 0) {
        if (seasonNumber < lastSeason) return true;
        if (seasonNumber > lastSeason) return false;
        return lastEpisode > 0;
    }

    // Watchlist / browse rows often omit lastEpisodeToAir — infer from Sonarr aired counts.
    const sonarr = details?.sonarrLibraryStatus;
    if (sonarr?.matched) {
        const row = (sonarr.seasons || []).find(
            (s: any) => Number(s?.seasonNumber) === seasonNumber,
        );
        if (row && Number(row.airedTotal) > 0) return true;
        if (sonarr.showComplete && isMainSeasonNumber(seasonNumber)) return true;
    }

    return false;
};

export const isSeasonStillAiring = (details: any, seasonNumber: number): boolean => {
    if (!hasSeasonAired(details, seasonNumber)) return false;

    const next = details?.nextEpisodeToAir;
    if (next && Number(next.seasonNumber) === seasonNumber) return true;

    const last = details?.lastEpisodeToAir;
    const tmdbSeason = (Array.isArray(details?.seasons) ? details.seasons : []).find(
        (s: any) => Number(s?.seasonNumber ?? s?.season_number) === seasonNumber,
    );
    const totalEpisodes = Number(tmdbSeason?.episodeCount ?? tmdbSeason?.episode_count) || 0;

    if (last && Number(last.seasonNumber) === seasonNumber) {
        if (totalEpisodes > Number(last.episodeNumber)) return true;
        if (isReturningSeries(details)) return true;
    }

    return false;
};

/** Label for a season Seerr marks as PARTIAL (tracked in Sonarr with not-all episodes). */
export const resolvePartialSeasonLabel = (details: any, seasonNumber: number): string => (
    isSeasonStillAiring(details, seasonNumber) ? 'Up to date' : 'Partial'
);

/** Prefer "Up to date" over request/approval labels for ongoing seasons on returning series. */
export const resolveMonitoredSeasonLabel = (
    details: any,
    seasonNumber: number,
    fallback: string,
): string => (
    isReturningSeries(details)
        && hasSeasonAired(details, seasonNumber)
        && isSeasonStillAiring(details, seasonNumber)
        ? 'Up to date'
        : fallback
);

const fulfilledSeasonLabel = (label: string) => (
    label === 'Available' || label === 'Up to date'
);

/** All aired main-season episodes are on disk (continuing shows may still have nextAiring). */
export const sonarrCaughtUpWithAiredEpisodes = (details: any): boolean => {
    const sonarr = details?.sonarrLibraryStatus;
    if (!sonarr?.matched || sonarr.hasActiveDownloads) return false;
    if (sonarr.showComplete) return true;

    const main = (sonarr.seasons || []).filter((season: any) => isMainSeasonNumber(Number(season?.seasonNumber)));
    const airedMain = main.filter((season: any) => Number(season.airedTotal) > 0);
    if (!airedMain.length) return false;

    return airedMain.every((season: any) => {
        if (season.complete) return true;
        const aired = Number(season.airedTotal) || 0;
        const withFile = Number(season.airedWithFile ?? season.withFile) || 0;
        return aired > 0 && withFile >= aired;
    });
};

/** True when every aired season is actually on disk — never from approve alone. */
export const isTvShowLibraryComplete = (
    details: any,
    seasonRows: SeasonStatusInfo[],
    mediaInfo?: any,
): boolean => {
    if (!canMarkTvAsAvailable(details)) return false;
    const info = mediaInfo || details?.mediaInfo;
    if (hasActiveShowDownloads(details, info)) return false;

    const sonarr = details?.sonarrLibraryStatus;
    // Future airings mean the show is still Partial for Discover badges.
    if (sonarr?.nextAiring) return false;
    // Sonarr is the source of truth when the portal can see the series.
    if (sonarr?.matched) {
        if (sonarr.hasActiveDownloads) return false;
        if (sonarr.showComplete) return true;
        if (sonarrMainSeasonsFullyOnDisk(details)) return true;
        if (sonarrCaughtUpWithAiredEpisodes(details)) return true;
        // Fall through: showComplete can be conservative (specials / undated eps).
        // Prefer per-season evidence below when Sonarr matched but didn't flip complete.
    }

    // Without Sonarr verification, do not trust Seerr show-level AVAILABLE /
    // Approved — those flip on approve, before files land on disk.
    if (seasonRows.length > 0) {
        const requestable = seasonRows.filter((s) => s.requestable);
        if (requestable.length > 0) return false;

        const mainRows = seasonRows.filter((s) => isMainSeasonNumber(s.seasonNumber));
        if (!mainRows.length) return false;

        // Approved / Requested / Processing mean fulfillment is still in flight.
        return mainRows.every((s) => fulfilledSeasonLabel(s.statusLabel));
    }

    return false;
};

export const isSeasonUpToDateLabel = (label: string) => label === 'Up to date';

export const isSeasonHandledInLibrary = (label: string) => (
    label === 'Available'
    || label === 'Up to date'
    || label === 'Requested'
    || label === 'Processing'
    || label === 'Pending'
    || label === 'Approved'
);

/**
 * Seerr often lacks per-season rows even when Sonarr is monitoring a season.
 * Infer "Up to date" for aired seasons on returning/partial shows already in the library.
 */
export const inferMissingLibrarySeasonStatus = (
    details: any,
    mediaInfo: any,
    seasonRow: SeasonStatusInfo,
): { requestable: boolean; statusLabel: string } | null => {
    if (!seasonRow.requestable || seasonRow.statusLabel !== 'Not requested') return null;
    if (!Number(mediaInfo?.id)) return null;

    const showStatus = Number(mediaInfo?.status);
    const librarySeasons = Array.isArray(mediaInfo?.seasons) ? mediaInfo.seasons : [];
    const trackedStatuses: number[] = [
        MEDIA_STATUS.PROCESSING,
        MEDIA_STATUS.PARTIAL,
        MEDIA_STATUS.AVAILABLE,
        MEDIA_STATUS.PENDING,
    ];
    const hasTrackedSeason = librarySeasons.some(
        (s: any) => trackedStatuses.includes(Number(s?.status)),
    );
    const showInLibrary = showStatus === MEDIA_STATUS.PROCESSING
        || showStatus === MEDIA_STATUS.PARTIAL
        || showStatus === MEDIA_STATUS.AVAILABLE
        || hasTrackedSeason;
    if (!showInLibrary) return null;

    const seasonNumber = Number(seasonRow.seasonNumber);
    const lastAiredSeason = Number(details?.lastEpisodeToAir?.seasonNumber);
    if (!Number.isFinite(seasonNumber)) return null;
    if (!Number.isFinite(lastAiredSeason)) return null;
    if (seasonNumber > lastAiredSeason) return null;
    if (!hasSeasonAired(details, seasonNumber)) return null;

    const knownSeasonNumbers = librarySeasons
        .map((s: any) => Number(s?.seasonNumber))
        .filter((n: number) => Number.isFinite(n));

    const requests = Array.isArray(mediaInfo?.requests) ? mediaInfo.requests : [];
    for (const req of requests) {
        if (!Array.isArray(req?.seasons)) continue;
        for (const season of req.seasons) {
            const num = Number(season?.seasonNumber);
            if (Number.isFinite(num)) knownSeasonNumbers.push(num);
        }
    }

    if (!knownSeasonNumbers.length) {
        return null;
    }
    const maxKnownSeason = Math.max(...knownSeasonNumbers);
    if (seasonNumber > maxKnownSeason + 1) return null;

    if (isSeasonStillAiring(details, seasonNumber)) {
        return { requestable: false, statusLabel: 'Up to date' };
    }

    if (isReturningSeries(details) && seasonNumber <= lastAiredSeason) {
        return { requestable: false, statusLabel: 'Up to date' };
    }

    if (isEndedShow(details) && showInLibrary && seasonNumber > 0 && seasonNumber <= lastAiredSeason) {
        const mainLibrarySeasons = librarySeasons.filter(
            (s: any) => isMainSeasonNumber(Number(s?.seasonNumber)),
        );
        if (mainLibrarySeasons.length > 0 || showStatus === MEDIA_STATUS.PARTIAL || showStatus === MEDIA_STATUS.AVAILABLE) {
            return { requestable: false, statusLabel: 'Available' };
        }
    }

    return null;
};

export const applyMissingLibrarySeasonInference = (
    details: any,
    mediaInfo: any,
    seasonRows: SeasonStatusInfo[],
): SeasonStatusInfo[] => (
    seasonRows.map((row) => {
        const inferred = inferMissingLibrarySeasonStatus(details, mediaInfo, row);
        if (!inferred) return row;
        return { ...row, ...inferred };
    })
);

/** Prefer Sonarr episode files over stale Seerr season rows when enrichment is present. */
export const applySonarrLibrarySeasonOverrides = (
    details: any,
    seasonRows: SeasonStatusInfo[],
): SeasonStatusInfo[] => {
    const sonarr = details?.sonarrLibraryStatus;
    if (!sonarr?.matched) return seasonRows;

    if (sonarr.showComplete) {
        return seasonRows.map((row) => {
            if (!isMainSeasonNumber(Number(row.seasonNumber))) return row;
            if (!canMarkTvAsAvailable(details)) return row;
            return {
                ...row,
                requestable: false,
                statusLabel: 'Available',
                libraryStatus: MEDIA_STATUS.AVAILABLE,
            };
        });
    }

    if (!Array.isArray(sonarr.seasons)) return seasonRows;

    const bySeason = new Map<number, any>(
        sonarr.seasons.map((season: any) => [Number(season.seasonNumber), season]),
    );

    return seasonRows.map((row) => {
        const seasonNumber = Number(row.seasonNumber);
        if (!isMainSeasonNumber(seasonNumber)) return row;

        const probe = bySeason.get(seasonNumber);
        if (!probe) return row;

        const seasonComplete = !!probe.complete
            || (Number(probe.total) > 0 && Number(probe.withFile) >= Number(probe.total));
        if (seasonComplete && (Number(probe.airedTotal) > 0 || Number(probe.withFile) > 0)) {
            return {
                ...row,
                requestable: false,
                statusLabel: isEndedShow(details) ? 'Available' : resolvePartialSeasonLabel(details, seasonNumber),
                libraryStatus: MEDIA_STATUS.AVAILABLE,
            };
        }

        if (Number(probe.airedWithFile) > 0 || Number(probe.withFile) > 0) {
            return {
                ...row,
                requestable: false,
                statusLabel: resolvePartialSeasonLabel(details, seasonNumber),
                libraryStatus: MEDIA_STATUS.PARTIAL,
            };
        }

        // Seerr often marks seasons Available once approved/sent to Sonarr even
        // with 0 files on disk — prefer Processing/Requested from Sonarr truth.
        if (Number(probe.airedTotal) > 0 || Number(probe.total) > 0) {
            const downloading = !!sonarr.hasActiveDownloads;
            return {
                ...row,
                requestable: false,
                statusLabel: downloading ? 'Processing' : 'Requested',
                libraryStatus: MEDIA_STATUS.PROCESSING,
            };
        }

        return row;
    });
};

export const mediaLibraryStatusLabel = (status: number | null | undefined): string | null => {
    const value = Number(status);
    if (value === MEDIA_STATUS.AVAILABLE) return 'Available';
    if (value === MEDIA_STATUS.PARTIAL) return 'Partial';
    if (value === MEDIA_STATUS.PROCESSING) return 'Processing';
    if (value === MEDIA_STATUS.PENDING) return 'Pending';
    if (value === MEDIA_STATUS.BLACKLISTED) return 'Blacklisted';
    return null;
};

export const seasonStatusBadgeClass = (label: string, requestable: boolean): string => {
    if (label === 'Available' || label === 'Up to date') return 'bg-green-500/15 text-green-400 border-green-500/25';
    if (label === 'Processing' || label === 'Approved') return 'bg-blue-500/15 text-blue-300 border-blue-500/25';
    if (label === 'Requested') return 'bg-indigo-500/15 text-indigo-300 border-indigo-500/25';
    if (label === 'Pending') return 'bg-amber-500/15 text-amber-400 border-amber-500/25';
    if (label === 'Declined') return 'bg-red-500/15 text-red-400 border-red-500/25';
    if (!requestable) return 'bg-white/5 text-white/40 border-white/10';
    return 'bg-white/5 text-white/50 border-white/10';
};

export type QuotaSlot = {
    limit: number;
    days: number;
    used: number;
    remaining: number | null;
};

export type RequestOptionsPayload = {
    mediaType: 'movie' | 'tv';
    tmdbId: number;
    title: string;
    overview?: string;
    mediaStatus: number | null;
    isBlacklisted: boolean;
    isAnime?: boolean;
    canRequest: boolean;
    canRequest4k: boolean;
    canRequestAdvanced?: boolean;
    canRequestTags?: boolean;
    has4kServer: boolean;
    hasHdServer: boolean;
    /** Movie only — which qualities already have a file in Radarr / Seerr. */
    libraryQualities?: { hd?: boolean; '4k'?: boolean } | null;
    /** Movie only — which qualities already have an open Seerr request. */
    requestedQualities?: { hd?: boolean; '4k'?: boolean } | null;
    /** Soft notice when one quality is in library but another can still be requested. */
    availabilityNote?: string | null;
    standardQuotaBlocked?: boolean;
    fourKQuotaBlocked?: boolean;
    seerrUserId?: number | null;
    servers?: {
        id: number;
        name: string;
        is4k: boolean;
        isDefault: boolean;
    }[];
    permissions: {
        request: boolean;
        requestMovie?: boolean;
        requestTv?: boolean;
        request4k: boolean;
        request4kMovie?: boolean;
        request4kTv?: boolean;
        requestAdvanced?: boolean;
        requestTags?: boolean;
        createIssues?: boolean;
        viewIssues?: boolean;
    };
    canCreateIssues?: boolean;
    quota: {
        standard?: QuotaSlot;
        fourK?: QuotaSlot;
    };
    seasons: SeasonStatusInfo[];
    userMapped: boolean;
    blockReason?: string | null;
    posterPath?: string | null;
    engine?: string;
    canNotify?: boolean;
    isWatching?: boolean;
    requestedByName?: string | null;
    requestedByCount?: number;
};

export const formatRequestedByCopy = (
    t: (key: string, vars?: Record<string, string | number>) => string,
    name?: string | null,
    count?: number,
): string => {
    const n = Number(count) || 0;
    if (name && n > 1) return t('request.requestedByAndMore', { name, count: n - 1 });
    if (name) return t('request.requestedBy', { name });
    return t('request.requestedBySomeone');
};

export const formatNotifyMeHint = (
    t: (key: string, vars?: Record<string, string | number>) => string,
    name?: string | null,
    count?: number,
): string => {
    const n = Number(count) || 0;
    if (name && n > 1) return t('request.notifyMeHintNamedMore', { name, count: n - 1 });
    if (name) return t('request.notifyMeHintNamed', { name });
    return t('request.notifyMeHint');
};

export const formatQuotaHint = (
    slot: QuotaSlot | undefined,
    label: string,
    t?: (key: string, vars?: Record<string, string | number>) => string,
): string | null => {
    if (!slot || slot.limit === 0) return null;
    const remaining = slot.remaining ?? Math.max(0, slot.limit - slot.used);
    if (t) {
        return t('request.quotaLeft', {
            remaining,
            limit: slot.limit,
            label,
            days: slot.days,
        });
    }
    return `${remaining} of ${slot.limit} ${label} requests left (${slot.days}-day window)`;
};

export const isMovieFullyAvailable = (mediaStatus: number | null | undefined) => (
    Number(mediaStatus) === MEDIA_STATUS.AVAILABLE
);

export const isMovieRequestPending = (mediaStatus: number | null | undefined) => {
    const value = Number(mediaStatus);
    return value === MEDIA_STATUS.PENDING || value === MEDIA_STATUS.PROCESSING;
};

/** Build per-season rows from catalog cache when TMDB seasons[] are absent (browse grids). */
export const buildSeasonStatusFromCatalogCache = (details: any): SeasonStatusInfo[] => {
    const mediaInfo = details?.mediaInfo || {};
    const librarySeasons = Array.isArray(mediaInfo?.seasons) ? mediaInfo.seasons : [];
    if (!librarySeasons.length) return [];

    const rows = librarySeasons
        .filter((season: any) => isMainSeasonNumber(Number(season?.seasonNumber)))
        .sort((a: any, b: any) => Number(a.seasonNumber) - Number(b.seasonNumber))
        .map((season: any) => {
            const seasonNumber = Number(season.seasonNumber);
            const libraryStatus = Number(season?.status) || null;
            let statusLabel = mediaLibraryStatusLabel(libraryStatus) || 'Not requested';
            if (libraryStatus === MEDIA_STATUS.PARTIAL) {
                const sonarr = details?.sonarrLibraryStatus;
                statusLabel = sonarr?.nextAiring
                    ? 'Up to date'
                    : resolvePartialSeasonLabel(details, seasonNumber);
            } else if (libraryStatus === MEDIA_STATUS.AVAILABLE) {
                statusLabel = 'Available';
            }

            return {
                seasonNumber,
                name: `Season ${seasonNumber}`,
                episodeCount: 0,
                posterPath: null,
                libraryStatus,
                requestStatus: null,
                statusLabel,
                requestable: false,
            };
        });

    return applySonarrLibrarySeasonOverrides(details, rows);
};

export const buildTvSeasonStatusRows = (details: any): SeasonStatusInfo[] => {
    const fromDetails = buildSeasonStatusFromDetails(details);
    if (fromDetails.length) return fromDetails;
    return buildSeasonStatusFromCatalogCache(details);
};

/** Build per-season status from Seerr media detail payload (client-side, no extra API call). */
export const buildSeasonStatusFromDetails = (details: any): SeasonStatusInfo[] => {
    const mediaInfo = details?.mediaInfo || {};
    const tmdbSeasons = Array.isArray(details?.seasons) ? details.seasons : [];
    const librarySeasons = Array.isArray(mediaInfo?.seasons) ? mediaInfo.seasons : [];
    const libraryByNum = new Map<number, number | null>(
        librarySeasons.map((s: any) => [Number(s?.seasonNumber), Number(s?.status) || null]),
    );

    const requestedSeasonStatus = new Map<number, number>();
    const requests = Array.isArray(mediaInfo?.requests) ? mediaInfo.requests : [];
    for (const req of requests) {
        if (!Array.isArray(req?.seasons)) continue;
        const reqStatus = Number(req?.status);
        for (const season of req.seasons) {
            const num = Number(season?.seasonNumber);
            if (!Number.isFinite(num)) continue;
            const existing = requestedSeasonStatus.get(num);
            if (existing == null || reqStatus === 1) requestedSeasonStatus.set(num, reqStatus);
        }
    }

    return applySonarrLibrarySeasonOverrides(
        details,
        applyMissingLibrarySeasonInference(details, mediaInfo, tmdbSeasons
        .filter((s: any) => Number(s?.seasonNumber) >= 0)
        .sort((a: any, b: any) => Number(a.seasonNumber) - Number(b.seasonNumber))
        .map((s: any) => {
            const seasonNumber = Number(s.seasonNumber);
            const libraryStatus = libraryByNum.get(seasonNumber) ?? null;
            const requestStatus = requestedSeasonStatus.get(seasonNumber) ?? null;

            let requestable = true;
            let statusLabel = 'Not requested';

            if (libraryStatus === MEDIA_STATUS.AVAILABLE) {
                requestable = false;
                statusLabel = 'Available';
            } else if (libraryStatus === MEDIA_STATUS.PROCESSING) {
                requestable = false;
                const fallback = hasActiveSeerrDownloads(mediaInfo, { seasonNumber })
                    ? 'Processing'
                    : 'Requested';
                statusLabel = resolveMonitoredSeasonLabel(details, seasonNumber, fallback);
            } else if (libraryStatus === MEDIA_STATUS.PENDING) {
                requestable = false;
                statusLabel = 'Pending';
            } else if (libraryStatus === MEDIA_STATUS.PARTIAL) {
                requestable = false;
                statusLabel = resolvePartialSeasonLabel(details, seasonNumber);
            } else if (requestStatus === REQUEST_STATUS.PENDING) {
                requestable = false;
                statusLabel = 'Pending';
            } else if (requestStatus === REQUEST_STATUS.APPROVED) {
                requestable = false;
                statusLabel = resolveMonitoredSeasonLabel(details, seasonNumber, 'Approved');
            } else if (requestStatus === REQUEST_STATUS.DECLINED) {
                requestable = false;
                statusLabel = 'Declined';
            }

            return {
                seasonNumber,
                name: s?.name || (seasonNumber === 0 ? 'Specials' : `Season ${seasonNumber}`),
                episodeCount: Number(s?.episodeCount) || 0,
                posterPath: s?.posterPath ?? null,
                libraryStatus,
                requestStatus,
                statusLabel,
                requestable,
            };
        })),
    );
};

export const getRequestButtonState = (
    mediaType: 'movie' | 'tv',
    mediaStatus: number | null | undefined,
    seasonRows: SeasonStatusInfo[],
    mediaInfo?: any,
    details?: any,
) => {
    const status = Number(mediaStatus) || null;
    const requests = Array.isArray(mediaInfo?.requests) ? mediaInfo.requests : [];
    const activeRequest = requests.find((req: any) => {
        const requestStatus = Number(req?.status);
        return requestStatus === REQUEST_STATUS.PENDING || requestStatus === REQUEST_STATUS.APPROVED;
    });

    if (mediaType === 'movie') {
        const radarr = details?.radarrLibraryStatus;
        const hdHasFile = !!radarr?.hdHasFile;
        const fourKHasFile = !!radarr?.fourKHasFile;
        const libQ = mediaInfo?.libraryQualities;
        const reqQ = mediaInfo?.requestedQualities;
        const seerrCanRequest = mediaInfo?.canRequest === true;
        // Only keep Request open when the *other* quality is monitored and still missing a file.
        const qualityStillNeeded = (!!radarr && (
            (hdHasFile && !fourKHasFile && !!radarr.fourKMatched)
            || (fourKHasFile && !hdHasFile && !!radarr.hdMatched)
        )) || !!(libQ && (
            (libQ.hd && !libQ['4k'] && !reqQ?.['4k'])
            || (libQ['4k'] && !libQ.hd && !reqQ?.hd)
        ));

        if (status === MEDIA_STATUS.AVAILABLE && !qualityStillNeeded && !seerrCanRequest) {
            return { label: 'Available', disabled: true, variant: 'available' as const };
        }
        if (status === MEDIA_STATUS.AVAILABLE && (qualityStillNeeded || seerrCanRequest)) {
            return { label: 'Request Movie', disabled: false, variant: 'action' as const };
        }
        if (seerrCanRequest && (status === MEDIA_STATUS.PROCESSING || status === MEDIA_STATUS.PENDING)) {
            return { label: 'Request Movie', disabled: false, variant: 'action' as const };
        }
        if (status === MEDIA_STATUS.PROCESSING) {
            const label = isMediaActivelyProcessing(mediaInfo, status) ? 'Processing' : 'Requested';
            return { label, disabled: true, variant: 'pending' as const };
        }
        if (status === MEDIA_STATUS.PENDING) {
            return { label: 'Request Pending', disabled: true, variant: 'pending' as const };
        }
        if (activeRequest) {
            if (Number(activeRequest.status) === REQUEST_STATUS.PENDING) {
                return { label: 'Request Pending', disabled: true, variant: 'pending' as const };
            }
            // Active request for one quality should not block requesting the other.
            if (!qualityStillNeeded) {
                return { label: 'Requested', disabled: true, variant: 'pending' as const };
            }
        }
        if (status === MEDIA_STATUS.BLACKLISTED) {
            return { label: 'Blacklisted', disabled: true, variant: 'blocked' as const };
        }
        return { label: 'Request Movie', disabled: false, variant: 'action' as const };
    }

    if (status === MEDIA_STATUS.BLACKLISTED) {
        return { label: 'Blacklisted', disabled: true, variant: 'blocked' as const };
    }
    const requestableCount = seasonRows.filter((s) => s.requestable).length;
    if (hasActiveShowDownloads(details, mediaInfo)) {
        return { label: 'Processing', disabled: true, variant: 'pending' as const };
    }

    // Already monitored in Sonarr and still airing / Partial continuing — Sonarr will
    // pick up new episodes. Do not offer "Request Seasons" for that case.
    // Ended incomplete shows (missing seasons) still get a Request CTA.
    const sonarr = details?.sonarrLibraryStatus;
    const returning = !!(details && isReturningSeries(details));
    const monitoredContinuing = !!sonarr?.matched
        && (!!sonarr?.nextAiring || returning);
    const stampedContinuingPartial = status === MEDIA_STATUS.PARTIAL && returning;
    if (monitoredContinuing || stampedContinuingPartial) {
        return {
            label: 'Up to date',
            disabled: true,
            variant: 'available' as const,
            hide: true,
        };
    }

    const libraryComplete = isTvShowLibraryComplete(details, seasonRows, mediaInfo)
        || sonarrMainSeasonsFullyOnDisk(details);
    if (libraryComplete) {
        return {
            label: details && isReturningSeries(details) && hasAnyEpisodeAired(details) ? 'Up to date' : 'Available',
            disabled: true,
            variant: 'available' as const,
        };
    }
    if (requestableCount === 0 && seasonRows.length > 0) {
        const waiting = seasonRows.some((s) => (
            s.statusLabel === 'Pending'
            || s.statusLabel === 'Processing'
            || s.statusLabel === 'Requested'
            || s.statusLabel === 'Approved'
        ));
        if (waiting) {
            return { label: 'Requested', disabled: true, variant: 'pending' as const };
        }
        const mainRows = seasonRows.filter((s) => isMainSeasonNumber(s.seasonNumber));
        const allMainAvailable = mainRows.length > 0
            && mainRows.every((s) => s.statusLabel === 'Available' || s.statusLabel === 'Up to date');
        if (allMainAvailable || (details && isEndedShow(details) && sonarrMainSeasonsFullyOnDisk(details))) {
            return { label: 'Available', disabled: true, variant: 'available' as const };
        }
        if (details && isReturningSeries(details) && hasAnyEpisodeAired(details)) {
            return { label: 'Up to date', disabled: true, variant: 'available' as const };
        }
        return { label: 'All Seasons Requested', disabled: true, variant: 'pending' as const };
    }
    if (activeRequest && requestableCount === 0) {
        return { label: 'Requested', disabled: true, variant: 'pending' as const };
    }
    if (status === MEDIA_STATUS.AVAILABLE && requestableCount === 0) {
        return { label: 'Available', disabled: true, variant: 'available' as const };
    }
    return {
        label: requestableCount > 0 && requestableCount < seasonRows.length ? 'Request Seasons' : 'Request Series',
        disabled: false,
        variant: 'action' as const,
    };
};
