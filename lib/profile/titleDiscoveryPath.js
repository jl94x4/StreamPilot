export const requestDiscoveryPath = (item = {}) => {
    const type = String(item?.mediaType || item?.kind || item?.type || '').toLowerCase();
    if (type === 'music' || type === 'artist' || type === 'album' || type === 'track') {
        const mbid = String(item?.mbid || '').trim();
        return mbid ? `/discovery/music/artist/${encodeURIComponent(mbid)}` : null;
    }
    const tmdbId = Number(item?.tmdbId);
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) return null;
    const kind = type === 'show' || type === 'tv' || type === 'series' || type === 'episode'
        ? 'tv'
        : 'movie';
    return `/discovery/${kind}/${tmdbId}`;
};

/** Deep-link a profile/wrap-up title into Discover (TMDB/MBID when known, else search). */
export const titleDiscoveryPath = (item = {}) => {
    const source = item && typeof item === 'object' ? item : {};
    const direct = requestDiscoveryPath(source);
    if (direct) return direct;
    const title = String(source.grandparentTitle || source.title || '').trim();
    if (!title) return null;
    return `/discovery?q=${encodeURIComponent(title)}`;
};
