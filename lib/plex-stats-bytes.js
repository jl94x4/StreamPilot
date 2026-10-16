/**
 * Helpers for summing Plex library bytes from /library/sections/.../all responses.
 * Plex JSON often returns a single Media/Part as an object instead of a 1-item array.
 */

export const asArray = (value) => {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
};

/**
 * Advance a Plex `X-Plex-Container-Start` by how many items actually came back.
 * Never step by the requested page size — PMS often returns fewer than asked,
 * and jumping by PAGE skips items (undercounts episodes/tracks).
 */
export const nextPlexContainerStart = (start, returnedCount) => {
    const n = Number(returnedCount) || 0;
    if (n <= 0) return null;
    return (Number(start) || 0) + n;
};

/** Sum file bytes for one metadata item (movie / episode / track). */
export const extractPlexItemBytes = (item = {}) => {
    let total = 0;
    for (const media of asArray(item.Media)) {
        if (!media || typeof media !== 'object') continue;
        let partBytes = 0;
        for (const part of asArray(media.Part)) {
            if (!part || typeof part !== 'object') continue;
            const n = Number(part.size ?? part.fileSize ?? 0);
            if (Number.isFinite(n) && n > 0) partBytes += n;
        }
        if (partBytes > 0) {
            total += partBytes;
            continue;
        }
        const mediaSize = Number(media.size ?? 0);
        if (Number.isFinite(mediaSize) && mediaSize > 0) {
            total += mediaSize;
            continue;
        }
        const durationMs = Number(media.duration ?? item.duration ?? 0);
        const bitrateKbps = Number(media.bitrate ?? 0);
        if (durationMs > 0 && bitrateKbps > 0) {
            total += Math.round((durationMs / 1000) * (bitrateKbps * 1000 / 8));
        }
    }
    return total;
};

export default { asArray, extractPlexItemBytes, nextPlexContainerStart };
