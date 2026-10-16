/**
 * Pure helpers for TPDB on-disk cache audits (counts vs orphans).
 */

const numericId = (value) => {
    const id = String(value || '').trim();
    return /^\d+$/.test(id) ? id : null;
};

const normalizeMedia = (value) => {
    const raw = String(value || 'movie').toLowerCase();
    if (raw === 'show' || raw === 'tv' || raw === 'series') return 'show';
    return 'movie';
};

/** Canonical identity for a title-cache row (dedupes TMDB↔TVDB aliases). */
export const canonicalTitleIdentity = (entry = {}) => {
    const media = normalizeMedia(entry.mediaType);
    const tmdbId = numericId(entry.tmdbId);
    if (tmdbId) return `tmdb:${media}:${tmdbId}`;
    const tvdbId = numericId(entry.tvdbId);
    if (tvdbId) return `tvdb:${media}:${tvdbId}`;
    const fileName = String(entry.fileName || entry.key || '').trim();
    return fileName ? `file:${fileName}` : null;
};

/**
 * @param {{
 *   titleEntries?: Array<{ fileName?: string, key?: string, tmdbId?: string|null, tvdbId?: string|null, mediaType?: string|null, setIds?: string[], valid?: boolean }>,
 *   setIdsOnDisk?: string[],
 *   imageKeysOnDisk?: string[],
 *   referencedImageKeys?: string[],
 * }} input
 */
export const summarizeTpdbDiskAudit = (input = {}) => {
    const titleEntries = Array.isArray(input.titleEntries) ? input.titleEntries : [];
    const setIdsOnDisk = Array.isArray(input.setIdsOnDisk) ? input.setIdsOnDisk : [];
    const imageKeysOnDisk = Array.isArray(input.imageKeysOnDisk) ? input.imageKeysOnDisk : [];
    const referencedImageKeys = new Set(
        (Array.isArray(input.referencedImageKeys) ? input.referencedImageKeys : [])
            .map((key) => String(key || '').trim())
            .filter(Boolean),
    );

    const titleFiles = titleEntries.length;
    const titleValid = titleEntries.filter((entry) => entry?.valid !== false).length;
    const titleInvalid = titleFiles - titleValid;
    const uniqueIds = new Set();
    for (const entry of titleEntries) {
        if (entry?.valid === false) continue;
        const id = canonicalTitleIdentity(entry);
        if (id) uniqueIds.add(id);
    }
    const uniqueTitles = uniqueIds.size;
    const titleAliasExtra = Math.max(0, titleValid - uniqueTitles);

    const referencedSets = new Set();
    for (const entry of titleEntries) {
        if (entry?.valid === false) continue;
        for (const setId of (entry.setIds || [])) {
            const id = String(setId || '').trim();
            if (id) referencedSets.add(id);
        }
    }

    const setIdSet = new Set(setIdsOnDisk.map((id) => String(id)));
    const setFiles = setIdSet.size;
    let setsReferenced = 0;
    let setsOrphan = 0;
    for (const setId of setIdSet) {
        if (referencedSets.has(String(setId))) setsReferenced += 1;
        else setsOrphan += 1;
    }
    const setsMissing = [...referencedSets].filter((id) => !setIdSet.has(id)).length;

    const imageFiles = imageKeysOnDisk.length;
    let imagesReferenced = 0;
    let imagesOrphan = 0;
    for (const key of imageKeysOnDisk) {
        if (referencedImageKeys.has(String(key))) imagesReferenced += 1;
        else imagesOrphan += 1;
    }

    return {
        titles: {
            files: titleFiles,
            valid: titleValid,
            invalid: titleInvalid,
            unique: uniqueTitles,
            aliasExtra: titleAliasExtra,
        },
        sets: {
            files: setFiles,
            referenced: setsReferenced,
            orphan: setsOrphan,
            missingFromDisk: setsMissing,
        },
        images: {
            files: imageFiles,
            referenced: imagesReferenced,
            orphan: imagesOrphan,
        },
    };
};
