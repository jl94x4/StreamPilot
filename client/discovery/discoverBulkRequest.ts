import { apiFetch } from '../shared/api';
import { isMainSeasonNumber } from './requestSeasonUtils';

export type BulkRequestResult = {
    requested: string[];
    skipped: string[];
    failed: string[];
    /** Keys that were handled (requested or already covered) and can leave the selection. */
    doneKeys: string[];
};

const mediaTypeOf = (item: any): 'movie' | 'tv' | null => {
    const raw = item?.mediaType || item?.type;
    return raw === 'movie' || raw === 'tv' ? raw : null;
};

/**
 * Request many titles with the same defaults the request dialog uses when Advanced is not opened:
 * HD quality, every requestable main season for shows, default server.
 */
export const bulkRequestItems = async (
    entries: Array<{ key: string; item: any }>,
    onProgress?: (done: number, total: number) => void,
): Promise<BulkRequestResult> => {
    const result: BulkRequestResult = { requested: [], skipped: [], failed: [], doneKeys: [] };
    let done = 0;
    for (const { key, item } of entries) {
        const title = String(item?.title || item?.name || key);
        const mediaType = mediaTypeOf(item);
        const mediaId = Number(item?.id || item?.tmdbId || 0);
        try {
            if (!mediaType || !Number.isFinite(mediaId) || mediaId <= 0) {
                result.skipped.push(title);
                continue;
            }
            const options = await apiFetch(
                `/api/discovery/request-options?mediaType=${encodeURIComponent(mediaType)}&mediaId=${mediaId}`,
            );
            if (!options || options.error) throw new Error(options?.error || 'options');
            const quotaBlocked = !!(
                options.standardQuotaBlocked
                || (options.quota?.standard && options.quota.standard.limit > 0 && options.quota.standard.remaining === 0)
            );
            const hdAllowed = !!options.canRequest
                && !quotaBlocked
                && options.hasHdServer !== false
                && !options.libraryQualities?.hd
                && !options.requestedQualities?.hd;
            if (!hdAllowed) {
                result.skipped.push(title);
                result.doneKeys.push(key);
                continue;
            }

            const body: Record<string, unknown> = { mediaType, mediaId };
            const posterPath = options.posterPath || item?.posterPath || null;
            if (posterPath) body.posterPath = posterPath;
            const requestTitle = String(options.title || item?.title || '').trim();
            if (requestTitle) body.title = requestTitle;
            const overview = String(options.overview || item?.overview || '').trim();
            if (overview) body.overview = overview;
            if (options.year != null) body.year = options.year;

            if (mediaType === 'tv') {
                const seasons: any[] = Array.isArray(options.seasons) ? options.seasons : [];
                const requestableMain = seasons
                    .filter((s) => s.requestable && isMainSeasonNumber(Number(s.seasonNumber)))
                    .map((s) => Number(s.seasonNumber));
                if (!requestableMain.length) {
                    result.skipped.push(title);
                    result.doneKeys.push(key);
                    continue;
                }
                const allMain = seasons.every((s) => isMainSeasonNumber(Number(s.seasonNumber)));
                body.seasons = allMain && requestableMain.length === seasons.length
                    ? 'all'
                    : requestableMain.sort((a, b) => a - b);
            }

            const servers: any[] = Array.isArray(options.servers) ? options.servers : [];
            const server = servers.find((s) => !s.is4k && s.isDefault)
                || servers.find((s) => !s.is4k)
                || servers.find((s) => s.isDefault)
                || servers[0]
                || null;
            if (server?.id != null) body.serverId = server.id;
            if (options.isAnime) body.isAnime = true;

            const res = await apiFetch('/api/discovery/request', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            if (res?.error) throw new Error(res.error);
            result.requested.push(title);
            result.doneKeys.push(key);
        } catch {
            result.failed.push(title);
        } finally {
            done += 1;
            onProgress?.(done, entries.length);
        }
    }
    return result;
};
