/**
 * plex.tv server library catalog helpers.
 *
 * Local PMS section keys (`/library/sections` `key`) are not the IDs plex.tv
 * wants on shared_servers invite/update. Map key → plex.tv Section `id`.
 */

const SECTION_TAG_RE = /<Section\b[^>]*>/gi;

const attr = (tag, name) => {
    const match = String(tag || '').match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
    return match?.[1] ? String(match[1]).trim() : '';
};

export const parsePlexTvServerSections = (xml = '') => {
    const sections = [];
    const source = String(xml || '');
    let match;
    SECTION_TAG_RE.lastIndex = 0;
    while ((match = SECTION_TAG_RE.exec(source)) !== null) {
        const tag = match[0];
        const plexTvId = attr(tag, 'id');
        const key = attr(tag, 'key');
        const title = attr(tag, 'title');
        if (!plexTvId && !key) continue;
        sections.push({ plexTvId: plexTvId || null, key: key || null, title });
    }
    return sections;
};

/**
 * Convert local section keys (or already-plex.tv ids) into numeric plex.tv section ids.
 * Unknown ids are dropped — sending local keys on invite is rejected by plex.tv.
 */
export const mapLibraryIdsToPlexTvSectionIds = (libraryIds = [], sections = []) => {
    const byAny = new Map();
    for (const section of Array.isArray(sections) ? sections : []) {
        const plexTvId = String(section?.plexTvId || '').trim();
        if (!plexTvId) continue;
        byAny.set(plexTvId, plexTvId);
        const key = String(section?.key || '').trim();
        if (key) byAny.set(key, plexTvId);
    }

    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(libraryIds) ? libraryIds : []) {
        const token = String(raw ?? '').trim();
        if (!token) continue;
        const mapped = byAny.get(token);
        if (!mapped || seen.has(mapped)) continue;
        const numeric = Number(mapped);
        if (!Number.isFinite(numeric)) continue;
        seen.add(mapped);
        out.push(numeric);
    }
    return out;
};

export default {
    parsePlexTvServerSections,
    mapLibraryIdsToPlexTvSectionIds,
};
