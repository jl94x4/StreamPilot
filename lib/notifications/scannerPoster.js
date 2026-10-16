/**
 * Artwork for Scanner import/upgrade/delete notifications.
 * Prefer the public poster URL Sonarr/Radarr/Lidarr already attached to the webhook.
 * If that is a local MediaCover path, fall back to TMDB using the ARR tmdbId.
 */

import { createTmdbClient } from '../portal-request/tmdbClient.js';
import { buildNotificationPosterUrl } from './mediaMeta.js';
import { isPublicArtworkUrl } from '../scanner/triggers/parsers.js';

const DEFAULT_TIMEOUT_MS = 4000;

export const resolveScannerNotifyPoster = async ({
    artwork = {},
    config = {},
    fetchImpl,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    tv,
    movie,
} = {}) => {
    const mediaType = artwork.mediaType === 'movie'
        ? 'movie'
        : (artwork.mediaType === 'music' ? 'music' : 'tv');
    const tmdbId = Number(artwork.tmdbId) > 0 ? Number(artwork.tmdbId) : null;

    const withIds = (extra = {}) => ({
        mediaType,
        ...(tmdbId ? { tmdbId } : {}),
        ...extra,
    });

    if (isPublicArtworkUrl(artwork.posterUrl)) {
        return withIds({ posterUrl: artwork.posterUrl });
    }

    if (!tmdbId || mediaType === 'music') return withIds();

    const apiKey = String(config?.tmdbApiKey || '').trim();
    if (!apiKey && typeof tv !== 'function' && typeof movie !== 'function') {
        return withIds();
    }

    try {
        const client = (!tv && !movie && apiKey)
            ? createTmdbClient({ tmdbApiKey: apiKey, fetchImpl, timeoutMs })
            : null;
        const fetchDetails = mediaType === 'movie'
            ? (movie || client?.movie)
            : (tv || client?.tv);
        if (typeof fetchDetails !== 'function') return withIds();
        const details = await fetchDetails(tmdbId, { appendToResponse: 'external_ids' });
        const posterPath = details?.posterPath || details?.poster_path || '';
        if (!posterPath) return withIds();
        return withIds({
            posterPath,
            posterUrl: buildNotificationPosterUrl({ posterPath }),
        });
    } catch {
        return withIds();
    }
};

export default resolveScannerNotifyPoster;
