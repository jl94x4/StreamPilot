/**
 * Bulk ratingKey → genre tags from Plex movie/show libraries.
 * History APIs almost never include Genre; one library walk covers unique titles.
 */

export const tagsFromPlexMeta = (meta) => {
    if (!meta || typeof meta !== 'object') return [];
    const raw = meta.Genre;
    const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    const tags = [];
    const seen = new Set();
    for (const entry of list) {
        const tag = typeof entry === 'string'
            ? entry.trim()
            : String(entry?.tag || '').trim();
        if (!tag) continue;
        const key = tag.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        tags.push(tag);
    }
    return tags;
};

/**
 * @param {(pathQuery: string) => Promise<object|null>} fetchPlexJson
 * @param {{ pageSize?: number, maxItems?: number }} [opts]
 * @returns {Promise<Record<string, string[]>>}
 */
export const buildPlexLibraryGenreMap = async (fetchPlexJson, opts = {}) => {
    if (typeof fetchPlexJson !== 'function') return {};
    const pageSize = Math.max(50, Math.min(1000, Number(opts.pageSize) || 400));
    const maxItems = Math.max(pageSize, Number(opts.maxItems) || 80000);
    const sectionsPayload = await fetchPlexJson('/library/sections').catch(() => null);
    const dirRaw = sectionsPayload?.MediaContainer?.Directory;
    const dirs = Array.isArray(dirRaw) ? dirRaw : (dirRaw ? [dirRaw] : []);
    const map = {};

    for (const dir of dirs) {
        const type = String(dir?.type || '').toLowerCase();
        if (type !== 'movie' && type !== 'show') continue;
        const sectionKey = String(dir?.key || '').trim();
        if (!sectionKey) continue;
        const plexType = type === 'movie' ? 1 : 2;
        let start = 0;
        let scanned = 0;
        while (scanned < maxItems) {
            const payload = await fetchPlexJson(
                `/library/sections/${encodeURIComponent(sectionKey)}/all?type=${plexType}&includeGuids=0&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${pageSize}`,
            ).catch(() => null);
            const metaRaw = payload?.MediaContainer?.Metadata;
            const items = Array.isArray(metaRaw) ? metaRaw : (metaRaw ? [metaRaw] : []);
            if (!items.length) break;
            for (const meta of items) {
                const key = String(meta?.ratingKey || '').trim();
                const tags = tagsFromPlexMeta(meta);
                if (key && tags.length) map[key] = tags;
            }
            start += items.length;
            scanned += items.length;
            const totalSize = Number(payload?.MediaContainer?.totalSize || 0);
            if ((totalSize > 0 && start >= totalSize) || items.length < pageSize) break;
        }
    }

    return map;
};
