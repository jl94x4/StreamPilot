import { normalizeRawDiscoveryItem } from './discoverItemUtils';
import {
    buildTvSeasonStatusRows,
    canMarkTvAsAvailable,
    hasActiveSeerrDownloads,
    hasActiveShowDownloads,
    hasAnyEpisodeAired,
    isEndedShow,
    isMainSeasonNumber,
    isReturningSeries,
    isSeasonUpToDateLabel,
    isTvShowLibraryComplete,
    MEDIA_STATUS,
    REQUEST_STATUS,
    resolveInProgressDisplay,
    sonarrCaughtUpWithAiredEpisodes,
    sonarrHasOnDiskFiles,
    sonarrMainSeasonsFullyOnDisk,
    type SeasonStatusInfo,
} from './requestSeasonUtils';

const fulfilledSeasonLabel = (label: string) => (
    label === 'Available' || isSeasonUpToDateLabel(label)
);

/** Sort unique season numbers and render as a compact range (e.g. 0-3). */
export const formatSeasonNumberRange = (seasonNumbers: number[]): string => {
    const sorted = [...new Set(seasonNumbers)].sort((a, b) => a - b);
    if (!sorted.length) return '';
    if (sorted.length === 1) return String(sorted[0]);
    return `${sorted[0]}-${sorted[sorted.length - 1]}`;
};

export const formatFulfilledSeasonDetail = (seasonRows: SeasonStatusInfo[]): string | null => {
    const fulfilled = seasonRows.filter((s) => fulfilledSeasonLabel(s.statusLabel));
    if (!fulfilled.length) return null;
    const nums = fulfilled.map((s) => s.seasonNumber);
    const range = formatSeasonNumberRange(nums);
    const plural = nums.length !== 1;
    const preferUpToDate = fulfilled.some((s) => isSeasonUpToDateLabel(s.statusLabel));
    if (preferUpToDate) {
        return `Season${plural ? 's' : ''} ${range} up to date`;
    }
    return `Season${plural ? 's' : ''} ${range} in library`;
};

const sonarrRequestFulfilled = (item: any): boolean => {
    const sonarr = item?.sonarrLibraryStatus;
    if (!sonarr?.matched || sonarr.hasActiveDownloads) return false;
    if (sonarr.showComplete) return true;
    return sonarrCaughtUpWithAiredEpisodes(item) || sonarrMainSeasonsFullyOnDisk(item);
};

export type MediaAvailabilityKind =
    | 'available'
    | 'partial'
    | 'processing'
    | 'requested'
    | 'pending'
    | 'failed'
    | 'declined'
    | 'blacklisted'
    | 'none';

export type MediaAvailabilityState = {
    kind: MediaAvailabilityKind;
    label: string;
    detail?: string;
    mediaStatus: number | null;
    hasUserRequest: boolean;
    userRequestId?: number | null;
    userRequestStatus?: number | null;
};

const resolveMediaType = (item: any): 'movie' | 'tv' | 'music' | null => {
    const normalized = normalizeRawDiscoveryItem(item);
    const raw = normalized?.mediaType ?? item?.mediaType ?? item?.media_type ?? item?.type;
    if (raw === 'music') return 'music';
    if (raw === 'movie' || raw === 1 || raw === '1') return 'movie';
    if (raw === 'tv' || raw === 2 || raw === '2') return 'tv';
    if (normalized?.firstAirDate && !normalized?.releaseDate) return 'tv';
    if (normalized?.releaseDate && !normalized?.firstAirDate) return 'movie';
    return null;
};

const getActiveUserRequest = (mediaInfo: any) => {
    const requests = Array.isArray(mediaInfo?.requests) ? mediaInfo.requests : [];
    if (!requests.length) return null;

    const priority = [REQUEST_STATUS.FAILED, REQUEST_STATUS.DECLINED, REQUEST_STATUS.PENDING, REQUEST_STATUS.APPROVED];
    for (const status of priority) {
        const match = requests.find((req: any) => Number(req?.status) === status);
        if (match) return match;
    }
    return requests[0];
};

const formatSeasonSummary = (seasonRows: SeasonStatusInfo[]) => {
    const available = seasonRows.filter((s) => s.statusLabel === 'Available');
    if (!available.length) return null;
    const range = formatSeasonNumberRange(available.map((s) => s.seasonNumber));
    return `Season${available.length === 1 ? '' : 's'} ${range} in library`;
};

const formatTvLibraryDetail = (seasonRows: SeasonStatusInfo[], airingDetail?: string) => {
    const detail = formatFulfilledSeasonDetail(seasonRows);
    if (detail) {
        return airingDetail ? `${detail}. ${airingDetail}` : detail;
    }
    return airingDetail || 'All requested seasons are available.';
};

export const resolveMediaAvailabilityState = (item: any): MediaAvailabilityState => {
    const mediaInfo = item?.mediaInfo || item?.media?.mediaInfo || {};
    const mediaStatusRaw = item?.mediaInfo?.status ?? item?.media?.status ?? mediaInfo?.status;
    const mediaStatus = Number.isFinite(Number(mediaStatusRaw)) ? Number(mediaStatusRaw) : null;
    const mediaType = resolveMediaType(item);
    const userRequest = getActiveUserRequest(mediaInfo);
    const userRequestStatus = userRequest ? Number(userRequest.status) : null;
    const hasUserRequest = !!userRequest;
    const userRequestId = userRequest?.id ?? null;

    const base = {
        mediaStatus,
        hasUserRequest,
        userRequestId,
        userRequestStatus,
    };

    if (mediaStatus === MEDIA_STATUS.BLACKLISTED) {
        return {
            ...base,
            kind: 'blacklisted',
            label: 'Blacklisted',
            detail: 'This title cannot be requested.',
        };
    }

    if (userRequestStatus === REQUEST_STATUS.FAILED) {
        return {
            ...base,
            kind: 'failed',
            label: 'Request failed',
            detail: 'Something went wrong fulfilling this request. You can retry from My Requests.',
        };
    }

    if (userRequestStatus === REQUEST_STATUS.DECLINED) {
        return {
            ...base,
            kind: 'declined',
            label: 'Request declined',
            detail: userRequest?.declineReason || 'Your request was declined by an admin.',
        };
    }

    if (mediaType === 'movie') {
        const radarr = item?.radarrLibraryStatus;
        if (radarr?.matched && radarr?.hasFile) {
            if (radarr.downloading) {
                return {
                    ...base,
                    kind: 'processing',
                    label: 'Processing',
                    detail: 'Your request is being downloaded or imported.',
                };
            }
            return {
                ...base,
                kind: 'available',
                label: 'Available in library',
                detail: 'This movie is already in your media library.',
            };
        }
        if (mediaStatus === MEDIA_STATUS.AVAILABLE) {
            return {
                ...base,
                kind: 'available',
                label: 'Available in library',
                detail: 'This movie is already in your media library.',
            };
        }
    }

    const seasonRows = mediaType === 'tv' ? buildTvSeasonStatusRows(item) : [];
    const inProgressDisplay = resolveInProgressDisplay(mediaInfo, mediaStatus, item);
    if (inProgressDisplay?.kind === 'processing' || hasActiveShowDownloads(item, mediaInfo)) {
        return {
            ...base,
            kind: 'processing',
            label: 'Processing',
            detail: inProgressDisplay?.detail || 'Episodes are still downloading or importing.',
        };
    }

    // List stamps often lack TMDB inProduction — only treat as "still airing" when
    // the show is actually continuing (or Sonarr has a next airing). Ended shows with
    // files must not be forced to Partial via showComplete===false alone.
    if (mediaType === 'tv') {
        const sonarr = item?.sonarrLibraryStatus;
        const stamped = Number(mediaInfo?.status);
        const ended = isEndedShow(item);
        const returning = isReturningSeries(item);
        const libraryBadgeAllowed = canMarkTvAsAvailable(item);
        const caughtUp = sonarrCaughtUpWithAiredEpisodes(item)
            || (libraryBadgeAllowed && seasonRows.length > 0 && seasonRows
                .filter((s) => isMainSeasonNumber(s.seasonNumber))
                .every((s) => s.statusLabel === 'Available' || isSeasonUpToDateLabel(s.statusLabel)));

        if (libraryBadgeAllowed && (caughtUp || sonarr?.showComplete)) {
            const showUpToDate = returning && hasAnyEpisodeAired(item) && !ended;
            return {
                ...base,
                kind: 'available',
                label: showUpToDate ? 'Up to date' : 'Available in library',
                detail: sonarr?.showComplete
                    ? 'All aired episodes are on disk (verified via Sonarr).'
                    : (formatTvLibraryDetail(seasonRows) || 'All aired episodes are in your library.'),
            };
        }

        // Seerr: still-airing shows with files are Partially Available — not Requested —
        // even when the request overlay left a PROCESSING stamp (approved forever).
        const onDisk = sonarrHasOnDiskFiles(sonarr);
        const continuingInLibrary = libraryBadgeAllowed
            && Boolean(sonarr?.matched)
            && !ended
            && !caughtUp
            && (
                onDisk
                || Boolean(sonarr?.nextAiring)
                || (returning && sonarr?.showComplete === false)
            );
        if (
            continuingInLibrary
            && (onDisk || (stamped >= MEDIA_STATUS.PROCESSING && stamped <= MEDIA_STATUS.AVAILABLE))
        ) {
            return {
                ...base,
                kind: 'partial',
                label: 'Partially available',
                detail: sonarr?.nextAiring
                    ? 'Some episodes are on disk; more are scheduled to air.'
                    : 'This series is in your library and still airing.',
            };
        }
        // Ended/canceled shows may keep a stale Seerr PARTIAL stamp after every
        // season is on disk — defer to library-complete checks below.
        if (libraryBadgeAllowed && stamped === MEDIA_STATUS.PARTIAL && !ended && !caughtUp) {
            return {
                ...base,
                kind: 'partial',
                label: 'Partially available',
                detail: sonarr?.nextAiring
                    ? 'Some episodes are on disk; more are scheduled to air.'
                    : (formatSeasonSummary(seasonRows) || 'Part of this series is already in your library.'),
            };
        }
    }

    const tvLibraryComplete = mediaType === 'tv'
        ? isTvShowLibraryComplete(item, seasonRows, mediaInfo)
        : false;

    if (tvLibraryComplete && canMarkTvAsAvailable(item)) {
        const showUpToDate = isReturningSeries(item) && hasAnyEpisodeAired(item);
        return {
            ...base,
            kind: 'available',
            label: showUpToDate ? 'Up to date' : 'Available in library',
            detail: item?.sonarrLibraryStatus?.showComplete
                ? 'All aired episodes are on disk (verified via Sonarr).'
                : formatTvLibraryDetail(seasonRows) || 'All aired episodes are in your library.',
        };
    }

    const availableSeasons = seasonRows.filter((s) => s.statusLabel === 'Available');
    const upToDateSeasons = seasonRows.filter((s) => isSeasonUpToDateLabel(s.statusLabel));
    const incompleteSeasons = seasonRows.filter((s) => s.statusLabel === 'Partial');
    const pendingSeasons = seasonRows.filter((s) => s.statusLabel === 'Pending');
    const approvedSeasons = seasonRows.filter((s) => s.statusLabel === 'Approved');
    const processingSeasons = seasonRows.filter((s) => s.statusLabel === 'Processing');
    const requestedSeasons = seasonRows.filter((s) => s.statusLabel === 'Requested');
    const returningSeries = isReturningSeries(item);
    const endedShow = isEndedShow(item);
    // Seerr flips seasons/show to Available on approve; don't treat that as on-disk
    // unless Sonarr (or tvLibraryComplete) already confirmed files.
    const approvalStillOpen = userRequestStatus === REQUEST_STATUS.APPROVED
        && !sonarrRequestFulfilled(item);

    if (mediaType === 'tv' && seasonRows.length > 0) {
        const requestable = seasonRows.filter((s) => s.requestable);
        const mainRequestable = requestable.filter((s) => isMainSeasonNumber(s.seasonNumber));
        const mainAvailable = availableSeasons.filter((s) => isMainSeasonNumber(s.seasonNumber));
        const mainUpToDate = upToDateSeasons.filter((s) => isMainSeasonNumber(s.seasonNumber));
        const mainIncomplete = incompleteSeasons.filter((s) => isMainSeasonNumber(s.seasonNumber));
        const handledSeasons = seasonRows.filter(
            (s) => !s.requestable && s.statusLabel !== 'Not requested' && s.statusLabel !== 'Declined',
        );
        const mainHandled = handledSeasons.filter((s) => isMainSeasonNumber(s.seasonNumber));

        if (!approvalStillOpen && endedShow && mainRequestable.length === 0 && mainHandled.length > 0
            && (mainAvailable.length > 0 || mainUpToDate.length > 0) && canMarkTvAsAvailable(item)) {
            return {
                ...base,
                kind: 'available',
                label: 'Available in library',
                detail: formatTvLibraryDetail(seasonRows),
            };
        }

        if (!approvalStillOpen && mainRequestable.length === 0 && mainHandled.length > 0) {
            if (returningSeries && hasAnyEpisodeAired(item)) {
                return {
                    ...base,
                    kind: 'available',
                    label: 'Up to date',
                    detail: formatTvLibraryDetail(
                        seasonRows,
                        'New episodes will be added as they air.',
                    ),
                };
            }
            if ((mainAvailable.length > 0 || mainUpToDate.length > 0) && canMarkTvAsAvailable(item)) {
                return {
                    ...base,
                    kind: 'available',
                    label: 'Available in library',
                    detail: formatTvLibraryDetail(seasonRows),
                };
            }
        }
        if ((mainAvailable.length > 0 || mainUpToDate.length > 0) && mainRequestable.length > 0) {
            const handledSummary = formatTvLibraryDetail(seasonRows);
            return {
                ...base,
                kind: 'partial',
                label: 'Partially available',
                detail: handledSummary
                    ? `${handledSummary}. ${mainRequestable.length} season${mainRequestable.length === 1 ? '' : 's'} still requestable.`
                    : `${mainRequestable.length} season${mainRequestable.length === 1 ? '' : 's'} still requestable.`,
            };
        }
        if (mainIncomplete.length > 0 && mainRequestable.length === 0) {
            return {
                ...base,
                kind: 'partial',
                label: 'Partially available',
                detail: `${mainIncomplete.length} season${mainIncomplete.length === 1 ? '' : 's'} missing episodes in your library.`,
            };
        }
        if (processingSeasons.length > 0 || (approvalStillOpen && hasActiveShowDownloads(item, mediaInfo))) {
            return {
                ...base,
                kind: 'processing',
                label: 'Processing',
                detail: 'Your request is being downloaded or imported.',
            };
        }
        if (inProgressDisplay) {
            return { ...base, ...inProgressDisplay };
        }
        if (requestedSeasons.length > 0 || approvalStillOpen) {
            return {
                ...base,
                kind: 'requested',
                label: 'Requested',
                detail: approvalStillOpen
                    ? (hasAnyEpisodeAired(item)
                        ? 'Approved — waiting for downloads to finish.'
                        : 'Your request is approved. New episodes will download as they air.')
                    : 'Your request was sent to the media server and is waiting to download.',
            };
        }
        if (approvedSeasons.length > 0 || userRequestStatus === REQUEST_STATUS.APPROVED) {
            if (hasActiveSeerrDownloads(mediaInfo) || hasActiveShowDownloads(item, mediaInfo)) {
                return {
                    ...base,
                    kind: 'processing',
                    label: 'Processing',
                    detail: 'Your request is being downloaded or imported.',
                };
            }
            return {
                ...base,
                kind: 'requested',
                label: 'Requested',
                detail: hasAnyEpisodeAired(item)
                    ? 'Approved and sent to your media server.'
                    : 'Your request is approved. New episodes will download as they air.',
            };
        }
        if (pendingSeasons.length > 0 || userRequestStatus === REQUEST_STATUS.PENDING || mediaStatus === MEDIA_STATUS.PENDING) {
            return {
                ...base,
                kind: 'pending',
                label: 'Pending approval',
                detail: 'Waiting for an admin to approve your request.',
            };
        }
    }

    if (mediaType === 'movie') {
        if (mediaStatus === MEDIA_STATUS.AVAILABLE) {
            return {
                ...base,
                kind: 'available',
                label: 'Available in library',
                detail: 'This movie is already in your media library.',
            };
        }
        if (inProgressDisplay) {
            return { ...base, ...inProgressDisplay };
        }
        if (mediaStatus === MEDIA_STATUS.PENDING || userRequestStatus === REQUEST_STATUS.PENDING) {
            return {
                ...base,
                kind: 'pending',
                label: 'Pending approval',
                detail: 'Waiting for an admin to approve your request.',
            };
        }
        if (mediaStatus === MEDIA_STATUS.PARTIAL) {
            return {
                ...base,
                kind: 'partial',
                label: 'Partially available',
                detail: 'Part of this title may already be in your library.',
            };
        }
    }

    if (mediaType === 'music') {
        if (item?.lidarrLibraryStatus?.matched && !Number.isFinite(Number(mediaStatus))) {
            if (item?.lidarrLibraryStatus?.hasActiveDownloads) {
                return {
                    ...base,
                    kind: 'processing',
                    label: 'Processing',
                    detail: 'Albums are downloading or importing.',
                };
            }
            return {
                ...base,
                kind: 'partial',
                label: 'In Lidarr',
                detail: 'This artist is monitored in your music library.',
            };
        }
        if (mediaStatus === MEDIA_STATUS.AVAILABLE) {
            return {
                ...base,
                kind: 'available',
                label: 'Available in library',
                detail: 'This artist is already in your music library.',
            };
        }
        if (inProgressDisplay || item?.lidarrLibraryStatus?.hasActiveDownloads) {
            return {
                ...base,
                kind: 'processing',
                label: 'Processing',
                detail: inProgressDisplay?.detail || 'Albums are downloading or importing.',
            };
        }
        if (mediaStatus === MEDIA_STATUS.PARTIAL) {
            return {
                ...base,
                kind: 'partial',
                label: 'Partially available',
                detail: 'Some albums from this artist are already in your library.',
            };
        }
        if (mediaStatus === MEDIA_STATUS.PENDING || userRequestStatus === REQUEST_STATUS.PENDING) {
            return {
                ...base,
                kind: 'pending',
                label: 'Pending approval',
                detail: 'Waiting for an admin to approve your request.',
            };
        }
        if (mediaStatus === MEDIA_STATUS.PROCESSING || userRequestStatus === REQUEST_STATUS.APPROVED) {
            return {
                ...base,
                kind: 'requested',
                label: 'Requested',
                detail: 'Your artist request was sent to Lidarr.',
            };
        }
    }

    // TV list stamps from the disk cache (no full season rows). Trust mediaInfo.status.
    if (mediaType === 'tv' && mediaStatus === MEDIA_STATUS.PARTIAL && canMarkTvAsAvailable(item)) {
        if (sonarrCaughtUpWithAiredEpisodes(item) || item?.sonarrLibraryStatus?.showComplete) {
            const showUpToDate = isReturningSeries(item) && hasAnyEpisodeAired(item);
            return {
                ...base,
                kind: 'available',
                label: showUpToDate ? 'Up to date' : 'Available in library',
                detail: item?.sonarrLibraryStatus?.showComplete
                    ? 'All aired episodes are on disk (verified via Sonarr).'
                    : 'All aired episodes are in your library.',
            };
        }
        return {
            ...base,
            kind: 'partial',
            label: 'Partially available',
            detail: item?.sonarrLibraryStatus?.nextAiring
                ? 'Some episodes are on disk; more are scheduled to air.'
                : (formatSeasonSummary(seasonRows) || 'Part of this series is already in your library.'),
        };
    }
    if (mediaType === 'tv' && mediaStatus === MEDIA_STATUS.AVAILABLE && canMarkTvAsAvailable(item)) {
        const showUpToDate = isReturningSeries(item) && hasAnyEpisodeAired(item);
        return {
            ...base,
            kind: 'available',
            label: showUpToDate ? 'Up to date' : 'Available in library',
            detail: item?.sonarrLibraryStatus?.showComplete
                ? 'All aired episodes are on disk (verified via Sonarr).'
                : 'This series is in your media library.',
        };
    }

    // Seerr show-level AVAILABLE is unreliable for TV during/after approve —
    // only trust it for movies, or when Sonarr already confirmed completeness above.
    if (mediaStatus === MEDIA_STATUS.AVAILABLE && mediaType === 'movie') {
        return {
            ...base,
            kind: 'available',
            label: 'Available in library',
        };
    }

    if (mediaStatus === MEDIA_STATUS.PARTIAL) {
        if (mediaType === 'tv' && item?.sonarrLibraryStatus?.showComplete && canMarkTvAsAvailable(item)) {
            return {
                ...base,
                kind: 'available',
                label: 'Available in library',
                detail: 'All aired episodes are on disk (verified via Sonarr).',
            };
        }
        if (mediaType === 'tv' && !canMarkTvAsAvailable(item)) {
            // Pre-premiere Sonarr monitoring — fall through to request/none handling below.
        } else {
            return {
                ...base,
                kind: 'partial',
                label: 'Partially available',
                detail: formatSeasonSummary(seasonRows) || undefined,
            };
        }
    }

    if (inProgressDisplay) {
        return { ...base, ...inProgressDisplay };
    }

    if (mediaStatus === MEDIA_STATUS.PENDING) {
        return {
            ...base,
            kind: 'pending',
            label: 'Pending',
            detail: 'Request is awaiting processing.',
        };
    }

    if (userRequestStatus === REQUEST_STATUS.PENDING) {
        return {
            ...base,
            kind: 'pending',
            label: 'Pending approval',
            detail: 'Waiting for an admin to approve your request.',
        };
    }

    // Approval ≠ available. Keep requested/processing until files are on disk.
    if (userRequestStatus === REQUEST_STATUS.APPROVED) {
        if (mediaType === 'tv' && canMarkTvAsAvailable(item)) {
            const rows = seasonRows.length > 0 ? seasonRows : buildTvSeasonStatusRows(item);
            if (sonarrRequestFulfilled(item) || isTvShowLibraryComplete(item, rows, mediaInfo)) {
                const showUpToDate = isReturningSeries(item) && hasAnyEpisodeAired(item);
                return {
                    ...base,
                    kind: 'available',
                    label: showUpToDate ? 'Up to date' : 'Available in library',
                    detail: item?.sonarrLibraryStatus?.showComplete
                        ? 'All aired episodes are on disk (verified via Sonarr).'
                        : (formatTvLibraryDetail(rows) || 'All aired episodes are in your library.'),
                };
            }
        }
        if (hasActiveShowDownloads(item, mediaInfo) || hasActiveSeerrDownloads(mediaInfo)) {
            return {
                ...base,
                kind: 'processing',
                label: 'Processing',
                detail: 'Your request is being downloaded or imported.',
            };
        }
        return {
            ...base,
            kind: 'requested',
            label: 'Requested',
            detail: mediaType === 'tv' && !hasAnyEpisodeAired(item)
                ? 'Your request is approved. New episodes will download as they air.'
                : 'Approved and sent to your media server.',
        };
    }

    return {
        ...base,
        kind: 'none',
        label: '',
    };
};

/** Whether an item should be hidden when "hide available" is enabled. */
export const shouldHideAvailableItem = (item: any): boolean => {
    const { kind } = resolveMediaAvailabilityState(item);
    return kind === 'available' || kind === 'partial';
};

export const isMediaAvailableInLibrary = (item: any = {}) => {
    const mediaStatus = Number(item?.mediaInfo?.status ?? item?.media?.status);
    if (mediaStatus === MEDIA_STATUS.AVAILABLE || mediaStatus === MEDIA_STATUS.PARTIAL) return true;

    const mediaInfo = item?.mediaInfo;
    if (mediaInfo && Number(mediaInfo.id) > 0 && !Number.isFinite(mediaStatus)) {
        const downloadStatus = Array.isArray(mediaInfo.downloadStatus) ? mediaInfo.downloadStatus : [];
        if (downloadStatus.some((entry: any) => Number(entry?.status) === 5)) return true;
    }
    return false;
};

export const filterHiddenAvailableItems = <T extends { mediaInfo?: { status?: number }; media?: { status?: number } }>(
    items: T[],
    hideAvailable: boolean,
): T[] => {
    if (!hideAvailable || !Array.isArray(items)) return items;
    return items.filter((item) => !shouldHideAvailableItem(item));
};

/** Whether an item should be hidden when "hide requested" is enabled on browse pages. */
export const shouldHideRequestedItem = (item: any): boolean => {
    const { kind } = resolveMediaAvailabilityState(item);
    return kind === 'requested' || kind === 'pending' || kind === 'processing';
};

export const filterHiddenRequestedItems = <T extends { mediaInfo?: { status?: number }; media?: { status?: number } }>(
    items: T[],
    hideRequested: boolean,
): T[] => {
    if (!hideRequested || !Array.isArray(items)) return items;
    return items.filter((item) => !shouldHideRequestedItem(item));
};

export const filterDiscoverBrowseItems = (
    items: any[],
    options: { hideAvailable?: boolean; hideRequested?: boolean },
) => {
    let filtered = filterHiddenAvailableItems(items, !!options.hideAvailable);
    filtered = filterHiddenRequestedItems(filtered, !!options.hideRequested);
    return filtered;
};
