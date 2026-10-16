/**
 * Gzip of large JSON / streamed images duplicates the payload in RAM.
 * Compression middleware decides before Content-Type is set, so skip by URL.
 */
const SKIP_PREFIXES = [
    '/api/speedtest/',
    '/api/plex/image',
    '/api/jellyfin/image',
    '/api/jellyfin/user-image',
    '/api/jellyfin/branding',
    '/api/discovery/music/cover',
    '/api/upgrader/arr-cover',
    '/api/upgrader/arr-episode-image',
    '/api/dynamic-theme/sample-image',
    '/api/collexions/',
    '/api/plex/analytics',
    '/api/achievements',
    '/api/admin/heap',
    '/api/poster-sets/watches',
    '/api/poster-sets/watch/',
    '/api/media-player/file',
    '/api/media-player/hls',
    '/api/media-player/proxy',
    '/api/media-player/theme',
];

export const shouldSkipGzipForUrl = (url = '') => {
    const pathOnly = String(url || '').split('?')[0];
    return SKIP_PREFIXES.some((prefix) => pathOnly.includes(prefix));
};

export default shouldSkipGzipForUrl;
