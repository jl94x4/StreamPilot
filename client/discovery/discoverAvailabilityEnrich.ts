/**
 * Client helper: attach library / request availability onto Discover items
 * without blocking the first paint.
 */

import { apiFetch } from '../shared/api';
import { resolveMediaAvailabilityState } from './discoverAvailability';
import { normalizeRawDiscoveryItem } from './discoverItemUtils';
import { MEDIA_STATUS } from './requestSeasonUtils';

const RESOLVED_MEDIA_STATUSES = new Set<number>([
    MEDIA_STATUS.PENDING,
    MEDIA_STATUS.PROCESSING,
    MEDIA_STATUS.PARTIAL,
    MEDIA_STATUS.AVAILABLE,
    MEDIA_STATUS.BLACKLISTED,
]);

const itemKey = (item: any) => {
    const normalized = normalizeRawDiscoveryItem(item) || item;
    if (normalized?.mediaType === 'music' || normalized?.type === 'music') {
        const mbid = String(normalized?.mbid ?? normalized?.id ?? '').trim();
        return mbid ? `music:${mbid}` : null;
    }
    const mediaType = normalized?.mediaType === 'tv' || normalized?.mediaType === 2 || normalized?.mediaType === '2'
        ? 'tv'
        : (normalized?.mediaType === 'movie' || normalized?.mediaType === 1 || normalized?.mediaType === '1'
            ? 'movie'
            : null);
    const tmdbId = Number(normalized?.tmdbId ?? normalized?.id);
    if (!mediaType || !Number.isFinite(tmdbId) || tmdbId <= 0) return null;
    return `${mediaType}:${tmdbId}`;
};

const REQUEST_PRESERVE_STATUSES = new Set<number>([
    MEDIA_STATUS.PENDING,
    MEDIA_STATUS.PROCESSING,
]);

const SKIP_ENRICH_STATUSES = new Set<number>([
    MEDIA_STATUS.AVAILABLE,
    MEDIA_STATUS.PARTIAL,
    MEDIA_STATUS.BLACKLISTED,
]);

const LIBRARY_OWNED_STATUSES = new Set<number>([
    MEDIA_STATUS.PARTIAL,
    MEDIA_STATUS.AVAILABLE,
    MEDIA_STATUS.BLACKLISTED,
]);

const sonarrPatchShowsOnDisk = (sonarr: any) => {
    if (!sonarr?.matched || sonarr.hasActiveDownloads) return false;
    if (sonarr.showComplete) return true;
    const fileCount = Number(sonarr.fileCount ?? sonarr.episodeFileCount) || 0;
    if (fileCount > 0) return true;
    return (sonarr.seasons || []).some((season: any) => (
        Number(season?.withFile) > 0 || Number(season?.airedWithFile) > 0
    ));
};

const patchShowsLibraryAvailable = (patch: any) => (
    LIBRARY_OWNED_STATUSES.has(Number(patch?.mediaInfo?.status))
    || Boolean(patch?.radarrLibraryStatus?.hasFile && !patch?.radarrLibraryStatus?.downloading)
    || sonarrPatchShowsOnDisk(patch?.sonarrLibraryStatus)
    || Boolean(patch?.inLibrary && !patch?.downloading)
);

const hasActiveMediaRequests = (mediaInfo: any) => (
    Array.isArray(mediaInfo?.requests)
    && mediaInfo.requests.some((req: any) => {
        const status = Number(req?.status);
        return status === 1 || status === 2; // pending / approved
    })
);

export const mergeAvailabilityOntoItems = <T,>(items: T[], availabilityByKey: Record<string, any>): T[] => {
    if (!Array.isArray(items) || !items.length) return items;
    return items.map((item) => {
        const key = itemKey(item);
        if (!key || !availabilityByKey[key]) return item;
        const patch = availabilityByKey[key];
        const existingInfo = (item as any)?.mediaInfo || {};
        const patchInfo = patch.mediaInfo || {};
        const existingStatus = Number(existingInfo?.status);
        const patchStatus = Number(patchInfo?.status);
        const mergedInfo = {
            ...existingInfo,
            ...patchInfo,
        };
        const libraryWins = patchShowsLibraryAvailable(patch);
        // Library AVAILABLE/PARTIAL/BLACKLISTED always wins.
        // Don't let empty Radarr/cache patches wipe Seerr/portal PENDING/PROCESSING
        // (or an active requests[] stamp) — that left detail CTAs on "Request Movie"
        // while the modal correctly said already requested.
        const preserveRequest = !libraryWins && (
            (REQUEST_PRESERVE_STATUSES.has(existingStatus) || hasActiveMediaRequests(existingInfo))
            && !LIBRARY_OWNED_STATUSES.has(patchStatus)
        );
        if (libraryWins) {
            if (LIBRARY_OWNED_STATUSES.has(patchStatus)) {
                mergedInfo.status = patchStatus;
            } else if (patch.radarrLibraryStatus?.hasFile && !patch.radarrLibraryStatus?.downloading) {
                mergedInfo.status = MEDIA_STATUS.AVAILABLE;
            } else if (patch.sonarrLibraryStatus?.showComplete) {
                mergedInfo.status = MEDIA_STATUS.AVAILABLE;
            } else if (sonarrPatchShowsOnDisk(patch.sonarrLibraryStatus)) {
                mergedInfo.status = MEDIA_STATUS.PARTIAL;
            }
        } else if (preserveRequest) {
            if (REQUEST_PRESERVE_STATUSES.has(existingStatus)) {
                mergedInfo.status = existingStatus;
            } else if (!Number.isFinite(patchStatus) || patchStatus <= 1) {
                mergedInfo.status = MEDIA_STATUS.PROCESSING;
            }
            if (Array.isArray(existingInfo.requests) && existingInfo.requests.length) {
                mergedInfo.requests = existingInfo.requests;
            }
        } else if (
            (!Number.isFinite(patchStatus) || patchStatus <= 1)
            && REQUEST_PRESERVE_STATUSES.has(existingStatus)
        ) {
            mergedInfo.status = existingStatus;
        }
        return {
            ...item,
            mediaInfo: mergedInfo,
            ...(patch.sonarrLibraryStatus ? { sonarrLibraryStatus: patch.sonarrLibraryStatus } : {}),
            ...(patch.radarrLibraryStatus ? { radarrLibraryStatus: patch.radarrLibraryStatus } : {}),
            ...(patch.lidarrLibraryStatus ? { lidarrLibraryStatus: patch.lidarrLibraryStatus } : {}),
            ...(patch.posterPath ? { posterPath: patch.posterPath, posterUrl: patch.posterPath } : {}),
        };
    });
};

/** Live Radarr/Sonarr lookup for browse rows when the disk cache missed a title. */
const browseRowNeedsLiveAvailability = (item: any): boolean => {
    const state = resolveMediaAvailabilityState(item);
    if (state.kind === 'none') return true;
    const normalized = normalizeRawDiscoveryItem(item) || item;
    const mediaType = normalized?.mediaType;
    const isTv = mediaType === 'tv' || mediaType === 2 || mediaType === '2';
    if (!isTv) return false;
    if (!['requested', 'processing', 'pending'].includes(state.kind)) return false;
    return !item?.sonarrLibraryStatus?.matched;
};

export async function enrichDiscoverBrowseRows<T>(items: T[]): Promise<T[]> {
    if (!Array.isArray(items) || items.length === 0) return items;
    const needsLive = items.some((item) => browseRowNeedsLiveAvailability(item));
    if (!needsLive) return items;
    return enrichDiscoverItemsWithAvailability(items);
}

/** Fetch availability for a list of discover items and merge mediaInfo back on. */
export async function enrichDiscoverItemsWithAvailability<T>(items: T[]): Promise<T[]> {
    if (!Array.isArray(items) || items.length === 0) return items;

    // Skip titles that already have library/request status (e.g. from the disk cache on browse).
    // UNKNOWN (1) is not resolved — still live-check those.
    const payloadItems = items
        .map((item) => {
            const key = itemKey(item);
            if (!key) return null;
            const status = Number((item as any)?.mediaInfo?.status);
            const hasRequests = Array.isArray((item as any)?.mediaInfo?.requests)
                && (item as any).mediaInfo.requests.length > 0;
            if (SKIP_ENRICH_STATUSES.has(status)) return null;
            const normalized = normalizeRawDiscoveryItem(item) || item;
            if (key.startsWith('music:')) {
                const mbid = key.slice('music:'.length);
                return {
                    mediaType: 'music',
                    mbid,
                    id: mbid,
                    title: String((normalized as any)?.title || (normalized as any)?.name || '').trim(),
                    name: String((normalized as any)?.name || (normalized as any)?.title || '').trim(),
                };
            }
            const [mediaType, tmdbId] = key.split(':');
            const yearRaw = String(
                (normalized as any)?.firstAirDate
                || (normalized as any)?.releaseDate
                || (item as any)?.firstAirDate
                || (item as any)?.releaseDate
                || '',
            ).slice(0, 4);
            const year = Number(yearRaw);
            const tvdbId = Number(
                (normalized as any)?.tvdbId
                || (normalized as any)?.externalIds?.tvdbId
                || (item as any)?.tvdbId
                || (item as any)?.externalIds?.tvdbId,
            );
            return {
                mediaType,
                tmdbId: Number(tmdbId),
                title: String((normalized as any)?.title || (normalized as any)?.name || (item as any)?.title || (item as any)?.name || '').trim(),
                year: Number.isFinite(year) && year > 1900 ? year : null,
                tvdbId: Number.isFinite(tvdbId) && tvdbId > 0 ? tvdbId : null,
                firstAirDate: (normalized as any)?.firstAirDate || (item as any)?.firstAirDate || null,
                releaseDate: (normalized as any)?.releaseDate || (item as any)?.releaseDate || null,
            };
        })
        .filter(Boolean);

    if (!payloadItems.length) return items;

    // Dedupe keys for a smaller request.
    const seen = new Set<string>();
    const unique = payloadItems.filter((entry: any) => {
        const key = entry.mediaType === 'music'
            ? `music:${entry.mbid}`
            : `${entry.mediaType}:${entry.tmdbId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    try {
        const data = await apiFetch('/api/discovery/availability-batch', {
            method: 'POST',
            body: JSON.stringify({ items: unique }),
        });
        const availabilityByKey: Record<string, any> = {};
        for (const entry of Array.isArray(data?.results) ? data.results : []) {
            if (entry?.mediaType === 'music') {
                const mbid = String(entry?.mbid || entry?.key?.replace(/^music:/, '') || '').trim();
                if (mbid) availabilityByKey[`music:${mbid}`] = entry;
                continue;
            }
            const mediaType = entry?.mediaType === 'tv' ? 'tv' : 'movie';
            const tmdbId = Number(entry?.tmdbId);
            if (!Number.isFinite(tmdbId) || tmdbId <= 0) continue;
            availabilityByKey[`${mediaType}:${tmdbId}`] = entry;
        }
        return mergeAvailabilityOntoItems(items, availabilityByKey);
    } catch {
        return items;
    }
}
