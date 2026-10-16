import { portalUrl, resolvePortalAssetUrl } from './basePath';

/** Ensure Plex proxy URLs request a poster-sized transcode (defaults match server plexPosterUrl). */
export const sizedPlexImageUrl = (
    url: string | null | undefined,
    width = 600,
    height = 900,
): string => {
    if (!url) return '';
    const resolved = resolvePortalAssetUrl(url);
    if (!resolved.includes('/api/plex/image')) return resolved;
    const hashAt = resolved.indexOf('#');
    const withoutHash = hashAt >= 0 ? resolved.slice(0, hashAt) : resolved;
    const qAt = withoutHash.indexOf('?');
    const base = qAt >= 0 ? withoutHash.slice(0, qAt) : withoutHash;
    const params = new URLSearchParams(qAt >= 0 ? withoutHash.slice(qAt + 1) : '');
    params.set('width', String(width));
    params.set('height', String(height));
    return portalUrl(`${base}?${params.toString()}`);
};
