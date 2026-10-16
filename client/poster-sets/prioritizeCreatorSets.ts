/** Sort poster-set results so followed creators appear first (whitelist order). */

export const normalizeCreatorHandle = (value?: string | null) =>
    String(value || '').trim().replace(/^@+/, '').toLowerCase();

const normalizePosterMatchKey = (value: string) => {
    let text = String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    text = text.replace(/\(\s*(?:\d{4}|n\/a)\s*\)\s*$/i, '');
    text = text.replace(/\b(set|poster set|posters|title cards?|collection)\b/g, ' ');
    text = text.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    return text;
};

const thumbAssetKey = (value?: string | null) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        const decoded = raw.includes('%') ? decodeURIComponent(raw) : raw;
        const match = decoded.match(/\/assets\/([^/?#]+)/i) || decoded.match(/assets%2F([^&%]+)/i);
        if (match?.[1]) return match[1].toLowerCase();
    } catch {
        // ignore
    }
    return raw.toLowerCase();
};

/** Collapse MediUX carousel duplicates (same creator + thumb/title, different set ids). */
export const collapseNearDuplicateSets = <T extends {
    provider?: string | null;
    setId?: string | null;
    url?: string | null;
    user?: string | null;
    thumbUrl?: string | null;
    title?: string | null;
}>(sets: T[]): { sets: T[]; collapsed: number } => {
    const list = Array.isArray(sets) ? sets : [];
    const seen = new Set<string>();
    const out: T[] = [];
    let collapsed = 0;
    for (const set of list) {
        if (!set?.setId || !set?.url) continue;
        const provider = String(set.provider || '').toLowerCase() === 'mediux' ? 'mediux' : 'posterdb';
        const user = normalizeCreatorHandle(set.user);
        const thumb = thumbAssetKey(set.thumbUrl);
        const title = normalizePosterMatchKey(String(set.title || ''));
        const key = thumb && thumb.length > 6
            ? `${provider}|${user}|thumb:${thumb}`
            : (title && user ? `${provider}|${user}|title:${title}` : `${provider}|${set.setId}|${set.url}`);
        if (seen.has(key)) {
            collapsed += 1;
            continue;
        }
        seen.add(key);
        out.push(set);
    }
    return { sets: out, collapsed };
};

export const excludeBlockedCreators = <T extends { user?: string | null }>(
    sets: T[],
    blocked?: string[] | null,
): T[] => {
    const list = Array.isArray(sets) ? sets : [];
    const keys = new Set(
        (Array.isArray(blocked) ? blocked : []).map((name) => normalizeCreatorHandle(name)).filter(Boolean),
    );
    if (!keys.size) return list;
    return list.filter((set) => {
        const user = normalizeCreatorHandle(set?.user);
        return !user || !keys.has(user);
    });
};

export const prioritizeSetsByFollowedCreators = <T extends { user?: string | null }>(
    sets: T[],
    creators?: string[] | null,
): T[] => {
    const list = Array.isArray(sets) ? sets : [];
    const ranks = new Map<string, number>();
    for (const [index, raw] of (Array.isArray(creators) ? creators : []).entries()) {
        const key = normalizeCreatorHandle(raw);
        if (key && !ranks.has(key)) ranks.set(key, index);
    }
    if (!ranks.size || list.length < 2) return list;

    return [...list].sort((a, b) => {
        const aKey = normalizeCreatorHandle(a?.user);
        const bKey = normalizeCreatorHandle(b?.user);
        const aRank = ranks.has(aKey) ? ranks.get(aKey)! : Number.POSITIVE_INFINITY;
        const bRank = ranks.has(bKey) ? ranks.get(bKey)! : Number.POSITIVE_INFINITY;
        return aRank - bRank;
    });
};
