import { apiFetch } from '../shared/api';

/** Normalize Seerr media, request, watchlist, or TMDB cast/credit shapes into a TMDB-friendly item. */
export const normalizeRawDiscoveryItem = (item: any) => {
    if (!item || typeof item !== 'object') return item;

    if (item.media && (item.type != null || item.status != null || item.requestedBy)) {
        const media = item.media;
        return {
            ...media,
            mediaType: item.type || media.mediaType,
            tmdbId: media.tmdbId,
            posterPath: media.posterPath,
            title: media.title || media.name,
            name: media.name || media.title,
            // Keep request / library stamps — overlays need mediaInfo.requests + status.
            mediaInfo: item.mediaInfo || media.mediaInfo,
            isDownloading: item.isDownloading ?? media.isDownloading,
            sonarrLibraryStatus: item.sonarrLibraryStatus || media.sonarrLibraryStatus,
        };
    }

    if (item.title && typeof item.title === 'object' && !item.posterPath) {
        return {
            ...item.title,
            ...item,
            mediaType: item.title.mediaType || item.mediaType,
            tmdbId: item.title.tmdbId ?? item.tmdbId,
            posterPath: item.title.posterPath ?? item.posterPath,
        };
    }

    const mediaTypeRaw = item.mediaType ?? item.media_type;
    if (mediaTypeRaw === 'movie' || mediaTypeRaw === 'tv') {
        return {
            ...item,
            mediaType: mediaTypeRaw,
            tmdbId: item.tmdbId ?? item.id,
            posterPath: item.posterPath ?? item.poster_path ?? null,
            profilePath: item.profilePath ?? item.profile_path ?? null,
            releaseDate: item.releaseDate ?? item.release_date ?? null,
            firstAirDate: item.firstAirDate ?? item.first_air_date ?? null,
            originalName: item.originalName ?? item.original_name ?? null,
        };
    }

    return item;
};

export const getDiscoverItemKey = (item: any): string | null => {
    const normalized = normalizeRawDiscoveryItem(item);
    const rawType = normalized.mediaType ?? normalized.type;
    const mediaType = rawType === 1 || rawType === '1'
        ? 'movie'
        : rawType === 2 || rawType === '2'
            ? 'tv'
            : rawType === 'music'
                ? 'music'
                : rawType;
    if (mediaType === 'music') {
        const mbid = String(normalized.mbid ?? normalized.id ?? '').trim();
        if (!mbid) return null;
        return `music:${mbid}`;
    }
    const tmdbId = Number(normalized.tmdbId ?? normalized.id);
    if (!mediaType || !Number.isFinite(tmdbId) || tmdbId <= 0) return null;
    return `${mediaType}:${tmdbId}`;
};

/** Keep first occurrence of each movie/show when browse pages overlap or repeat. */
export const dedupeDiscoverResults = <T,>(items: T[]): T[] => {
    if (!Array.isArray(items) || items.length < 2) return items;
    const seen = new Set<string>();
    const deduped: T[] = [];
    for (const item of items) {
        const key = getDiscoverItemKey(item);
        if (!key) {
            deduped.push(item);
            continue;
        }
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
    }
    return deduped;
};

export const mergeDiscoverResults = <T,>(existing: T[], incoming: T[]): T[] => (
    dedupeDiscoverResults([...existing, ...incoming])
);

const resolveEnrichMediaType = (item: any): 'movie' | 'tv' | 'music' | null => {
    const raw = item?.mediaType ?? item?.type;
    if (raw === 'music') return 'music';
    if (raw === 2 || raw === '2' || raw === 'tv' || raw === 'show') return 'tv';
    if (raw === 1 || raw === '1' || raw === 'movie') return 'movie';
    if (item?.firstAirDate) return 'tv';
    if (item?.releaseDate) return 'movie';
    if (item?.mbid) return 'music';
    return null;
};

const needsEnrichment = (item: any) => {
    const normalized = normalizeRawDiscoveryItem(item);
    if (normalized.posterPath || normalized.profilePath) return false;
    const mediaType = resolveEnrichMediaType(normalized);
    const tmdbId = Number(normalized.tmdbId ?? normalized.id);
    return !!mediaType && Number.isFinite(tmdbId) && tmdbId > 0;
};

/** Fetch TMDB poster/title for library media, requests, and watchlist rows. */
const ENRICH_CONCURRENCY = 4;

const mapWithConcurrency = async <T, R>(
    items: T[],
    limit: number,
    mapper: (item: T) => Promise<R>,
): Promise<R[]> => {
    if (!items.length) return [];
    const results = new Array<R>(items.length);
    let cursor = 0;

    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await mapper(items[index]);
        }
    });

    await Promise.all(workers);
    return results;
};

export const enrichDiscoveryItems = async (items: any[]): Promise<any[]> => {
    if (!items?.length) return [];

    return mapWithConcurrency(items, ENRICH_CONCURRENCY, async (raw) => {
        const item = normalizeRawDiscoveryItem(raw);
        if (!needsEnrichment(item)) {
            const mediaType = resolveEnrichMediaType(item);
            return mediaType ? { ...item, mediaType, tmdbId: Number(item.tmdbId ?? item.id) || item.tmdbId } : item;
        }

        const mediaType = resolveEnrichMediaType(item) as 'movie' | 'tv';
        const tmdbId = Number(item.tmdbId ?? item.id);
        try {
            const details = await apiFetch(`/api/discovery/proxy/${mediaType}/${tmdbId}`);
            const priorInfo = item.mediaInfo && typeof item.mediaInfo === 'object' ? item.mediaInfo : null;
            const nextInfo = details?.mediaInfo && typeof details.mediaInfo === 'object' ? details.mediaInfo : null;
            const priorStatus = Number(priorInfo?.status);
            const nextStatus = Number(nextInfo?.status);
            // Keep a stronger list/cache stamp when detail enrich returns empty/unknown status.
            const mergedStatus = (Number.isFinite(nextStatus) && nextStatus > 1)
                ? nextStatus
                : (Number.isFinite(priorStatus) && priorStatus > 1 ? priorStatus : (nextInfo?.status ?? priorInfo?.status ?? null));
            const priorSonarr = item.sonarrLibraryStatus;
            const nextSonarr = details?.sonarrLibraryStatus;
            const priorRadarr = item.radarrLibraryStatus;
            const nextRadarr = details?.radarrLibraryStatus;
            return {
                ...item,
                ...details,
                mediaInfo: {
                    ...(priorInfo || {}),
                    ...(nextInfo || {}),
                    status: mergedStatus,
                    requests: Array.isArray(priorInfo?.requests) && priorInfo.requests.length
                        ? priorInfo.requests
                        : (Array.isArray(nextInfo?.requests) ? nextInfo.requests : []),
                },
                sonarrLibraryStatus: nextSonarr?.matched ? nextSonarr : (priorSonarr || nextSonarr || null),
                radarrLibraryStatus: nextRadarr?.matched ? nextRadarr : (priorRadarr || nextRadarr || null),
                mediaType,
                tmdbId,
            };
        } catch {
            return { ...item, mediaType, tmdbId };
        }
    });
};
