/**
 * Merge MediUX + ThePosterDB catalog results and collapse near-duplicates.
 * Preference decides which provider stays primary when titles/sets look the same.
 */

const stripDiacritics = (value) => String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

/** Normalize title/user text for fuzzy equality (case, punctuation, year suffix). */
export const normalizePosterMatchKey = (value) => {
    let text = stripDiacritics(value).toLowerCase().trim();
    text = text.replace(/\(\s*(?:\d{4}|n\/a)\s*\)\s*$/i, '');
    text = text.replace(/\b(set|poster set|posters|title cards?|collection)\b/g, ' ');
    text = text.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    return text;
};

export const normalizeDupePreference = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'mediux' || raw === 'mediaux') return 'mediux';
    return 'posterdb';
};

/** Normalize portal / Plex media type strings for poster-set scrapers. */
export const resolvePosterSetsMediaType = (value, fallback = 'movie') => {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'show' || raw === 'tv' || raw === 'series') return 'show';
    if (raw === 'movie' || raw === 'film') return 'movie';
    return fallback === 'show' ? 'show' : 'movie';
};

const providerRank = (provider, preferred) => {
    const value = String(provider || '').toLowerCase();
    if (value === preferred) return 0;
    if (value === 'posterdb' || value === 'tpdb' || value === 'theposterdb') return preferred === 'posterdb' ? 0 : 1;
    if (value === 'mediux') return preferred === 'mediux' ? 0 : 1;
    return 2;
};

export const normalizeCreatorHandle = (value) => String(value || '').trim().replace(/^@+/, '').toLowerCase();

/** MediUX thumbs often repeat via next/image wrappers — collapse to asset id when possible. */
const thumbAssetKey = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        const decoded = raw.includes('%') ? decodeURIComponent(raw) : raw;
        const match = decoded.match(/\/assets\/([^/?#]+)/i) || decoded.match(/assets%2F([^&%]+)/i);
        if (match?.[1]) return match[1].toLowerCase();
    } catch {
        // ignore decode failures
    }
    return raw.toLowerCase();
};

/**
 * Collapse MediUX carousel junk: same creator + same thumb/title shown as multiple set ids.
 * Keeps the first occurrence (followed-creator sort runs after this).
 */
export const collapseNearDuplicateSets = (sets = []) => {
    const list = Array.isArray(sets) ? sets : [];
    const seen = new Set();
    const out = [];
    let collapsed = 0;
    for (const set of list) {
        if (!set?.setId || !set?.url) continue;
        const provider = String(set.provider || '').toLowerCase() === 'mediux' ? 'mediux' : 'posterdb';
        const user = normalizeCreatorHandle(set.user);
        const thumb = thumbAssetKey(set.thumbUrl);
        const title = normalizePosterMatchKey(set.title || '');
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

const COLLECTION_KIND_RE = /^(collection|collections|boxset|boxsets)$/;
const COLLECTION_TITLE_RE = /\b(box\s*sets?|boxsets?|collection posters?|film collection|movie collection|collections?)\b/i;
const NON_COLLECTION_KIND_RE = /^(title_cards?|backgrounds?|backdrops?)$/;

/** MediUX boxsets, TPDB collection posters, and large multi-title packs. */
export const isCollectionSet = (set = {}) => {
    const kind = String(set?.setKind || '').trim().toLowerCase().replace(/-/g, '_');
    if (NON_COLLECTION_KIND_RE.test(kind)) return false;
    if (COLLECTION_KIND_RE.test(kind)) return true;
    const media = String(set?.mediaType || '').trim().toLowerCase();
    if (media === 'collection' || media === 'collections') return true;
    const title = String(set?.title || '');
    if (COLLECTION_TITLE_RE.test(title) && !/(title\s*cards?|episode\s*cards?)/i.test(title)) return true;
    const count = Number(set?.posterCount ?? set?.assetCount);
    return Number.isFinite(count) && count >= 10;
};

export const filterCollectionSets = (sets = []) => (
    (Array.isArray(sets) ? sets : []).filter((set) => isCollectionSet(set))
);

/** Drop sets that are not from followed creator handles. Unknown users are excluded. */
export const keepFollowedCreatorsOnly = (sets = [], followed = []) => {
    const list = Array.isArray(sets) ? sets : [];
    const keys = new Set(
        (Array.isArray(followed) ? followed : []).map((name) => normalizeCreatorHandle(name)).filter(Boolean),
    );
    if (!keys.size) return [];
    return list.filter((set) => {
        const user = normalizeCreatorHandle(set?.user);
        return Boolean(user && keys.has(user));
    });
};

/** Drop sets from blocked creator handles (blocklist wins over follow). */
export const excludeBlockedCreators = (sets = [], blocked = []) => {
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

/** Drop blocked handles from a follow/scrape username list (blocklist wins over follow). */
export const excludeBlockedHandles = (names = [], blocked = []) => {
    const list = Array.isArray(names) ? names : [];
    const keys = new Set(
        (Array.isArray(blocked) ? blocked : []).map((name) => normalizeCreatorHandle(name)).filter(Boolean),
    );
    if (!keys.size) return list;
    return list.filter((name) => {
        const key = normalizeCreatorHandle(name);
        return Boolean(key) && !keys.has(key);
    });
};

/** Stable-sort sets so followed creators (whitelist order) float to the top. */
export const prioritizeSetsByFollowedCreators = (sets = [], creators = []) => {
    const list = Array.isArray(sets) ? sets : [];
    const ranks = new Map();
    for (const [index, raw] of (Array.isArray(creators) ? creators : []).entries()) {
        const key = normalizeCreatorHandle(raw);
        if (key && !ranks.has(key)) ranks.set(key, index);
    }
    if (!ranks.size || list.length < 2) return list;
    return [...list].sort((a, b) => {
        const aKey = normalizeCreatorHandle(a?.user);
        const bKey = normalizeCreatorHandle(b?.user);
        const aRank = ranks.has(aKey) ? ranks.get(aKey) : Number.POSITIVE_INFINITY;
        const bRank = ranks.has(bKey) ? ranks.get(bKey) : Number.POSITIVE_INFINITY;
        return aRank - bRank;
    });
};

const titleMatchKey = (title) => {
    const provider = String(title?.provider || '').toLowerCase();
    const id = String(title?.id || '').trim();
    // Library + TMDB hits for the same work should collapse even when years differ
    // (Plex often has latest-season year; TMDB keeps premiere year).
    if ((provider === 'mediux' || title?.inLibrary) && /^\d+$/.test(id)) {
        return `tmdb:${id}`;
    }
    const name = normalizePosterMatchKey(title?.title || '');
    const year = title?.year != null && Number.isFinite(Number(title.year))
        ? String(Number(title.year))
        : '';
    return `${name}|${year}`;
};

const plexThumbPath = (thumb) => {
    const raw = String(thumb || '').trim();
    return raw.startsWith('/library/') || raw.includes('/library/metadata/');
};

/** Turn a Plex/Jellyfin library hit into a MediUX-shaped picker title (TMDB id required). */
export const libraryItemToSearchTitle = (item = {}) => {
    const tmdbId = String(item?.tmdbId || '').trim();
    const title = String(item?.title || '').trim();
    if (!title || !/^\d+$/.test(tmdbId)) return null;
    const mediaType = resolvePosterSetsMediaType(item.mediaType || item.type, 'movie');
    const existingThumb = String(item.thumbUrl || '').trim();
    const thumbUrl = existingThumb || (
        plexThumbPath(item.thumb)
            ? `/api/plex/image?path=${encodeURIComponent(String(item.thumb))}&width=300&height=450`
            : ''
    );
    const year = item.year != null && Number.isFinite(Number(item.year)) ? Number(item.year) : null;
    return {
        id: tmdbId,
        title,
        year,
        url: mediaType === 'show'
            ? `https://mediux.pro/shows/${tmdbId}`
            : `https://mediux.pro/movies/${tmdbId}`,
        mediaType,
        thumbUrl,
        provider: 'mediux',
        inLibrary: true,
    };
};

const sortTitlesLibraryFirst = (titles = []) => [...titles].sort((a, b) => {
    if (Boolean(a?.inLibrary) !== Boolean(b?.inLibrary)) return a?.inLibrary ? -1 : 1;
    return String(a?.title || '').localeCompare(String(b?.title || ''), undefined, { sensitivity: 'base' });
});

/** Merge catalog titles with in-library hits and keep library matches at the top. */
export const mergeTitleSearchWithLibrary = (catalogTitles = [], libraryTitles = [], preferred = 'posterdb') => {
    const library = (Array.isArray(libraryTitles) ? libraryTitles : [])
        .map((item) => (item?.inLibrary ? item : libraryItemToSearchTitle(item)))
        .filter(Boolean);
    const catalog = Array.isArray(catalogTitles) ? catalogTitles : [];
    const merged = mergePosterSearchTitles([...library, ...catalog], preferred);
    const titles = sortTitlesLibraryFirst(merged.titles.map((title) => ({
        ...title,
        inLibrary: Boolean(title.inLibrary),
    })));
    return { titles, dupesCollapsed: merged.dupesCollapsed };
};

const setMatchKey = (set) => {
    const title = normalizePosterMatchKey(set?.title || '');
    const user = normalizePosterMatchKey(set?.user || '');
    // Prefer title+creator when both sides have a user; fall back to title-only.
    return user ? `${title}|${user}` : `${title}|`;
};

const asSource = (title) => ({
    provider: String(title?.provider || '').toLowerCase() === 'mediux' ? 'mediux' : 'posterdb',
    id: String(title?.id || ''),
    url: String(title?.url || ''),
    mediaType: title?.mediaType || null,
    year: title?.year ?? null,
    thumbUrl: title?.thumbUrl || '',
});

/**
 * @param {Array<object>} titles
 * @param {'mediux'|'posterdb'} preferred
 */
/**
 * Pick a TMDB id from MediUX/TMDB title hits using library title, year, and media type.
 */
export const pickMediuxTmdbForHint = (
    titles = [],
    { titleHint = '', yearHint = null, mediaType = null } = {},
) => {
    const hintKey = normalizePosterMatchKey(titleHint);
    if (!hintKey) return null;
    const wantYear = yearHint != null && Number.isFinite(Number(yearHint)) ? Number(yearHint) : null;
    const wantMedia = String(mediaType || '').trim().toLowerCase();
    const isShow = wantMedia === 'show' || wantMedia === 'tv' || wantMedia === 'series';
    // Shows: Plex often has latest-season year while MediUX keeps premiere year.
    const yearSlack = isShow ? 5 : 1;
    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const title of titles) {
        if (!title?.id) continue;
        const key = normalizePosterMatchKey(title.title || '');
        if (key !== hintKey) continue;
        let score = 10;
        const year = title.year != null ? Number(title.year) : null;
        if (wantYear != null) {
            if (year === wantYear) score += 25;
            else if (year != null && Math.abs(year - wantYear) <= yearSlack) {
                score += Math.max(5, 20 - Math.abs(year - wantYear) * 3);
            } else if (year != null) {
                score -= 40;
            }
        }
        const mt = String(title.mediaType || '').trim().toLowerCase();
        if (isShow) {
            score += mt === 'show' ? 8 : -20;
        } else if (wantMedia === 'movie' || wantMedia === 'film') {
            score += mt === 'movie' ? 8 : -20;
        }
        if (score > bestScore) {
            bestScore = score;
            best = String(title.id);
        }
    }
    return bestScore > 0 ? best : null;
};

export const mergePosterSearchTitles = (titles = [], preferred = 'posterdb') => {
    const pref = normalizeDupePreference(preferred);
    const buckets = new Map();
    for (const title of Array.isArray(titles) ? titles : []) {
        if (!title?.title) continue;
        const key = titleMatchKey(title);
        if (!key.startsWith('|') && !normalizePosterMatchKey(title.title)) continue;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(title);
    }

    const merged = [];
    let dupesCollapsed = 0;
    for (const group of buckets.values()) {
        const sorted = [...group].sort((a, b) => (
            providerRank(a.provider, pref) - providerRank(b.provider, pref)
        ));
        const primary = sorted[0];
        const sources = [];
        const seenProviders = new Set();
        for (const item of sorted) {
            const source = asSource(item);
            if ((!source.id && !source.url) || seenProviders.has(source.provider)) continue;
            seenProviders.add(source.provider);
            sources.push(source);
        }
        if (sources.length > 1) dupesCollapsed += sources.length - 1;
        merged.push({
            ...primary,
            provider: asSource(primary).provider,
            inLibrary: group.some((item) => item?.inLibrary),
            sources,
            alsoOn: sources.filter((source) => source.provider !== asSource(primary).provider),
        });
    }

    merged.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' }));
    return { titles: merged, dupesCollapsed };
};

/**
 * @param {Array<object>} sets
 * @param {'mediux'|'posterdb'} preferred
 * @param {{ preserveOrder?: boolean, preferredCreators?: string[], creatorWhitelist?: string[], blockedCreators?: string[], creatorBlocklist?: string[] }} [options]
 */
export const mergePosterSearchSets = (sets = [], preferred = 'posterdb', options = {}) => {
    const pref = normalizeDupePreference(preferred);
    const preserveOrder = Boolean(options?.preserveOrder);
    const preferredCreators = options?.preferredCreators || options?.creatorWhitelist || [];
    const blockedCreators = options?.blockedCreators || options?.creatorBlocklist || [];
    const exact = new Map();
    const titleOnly = new Map();
    const inputOrder = [];

    const consider = (set) => {
        if (!set?.setId || !set?.url) return;
        const provider = String(set.provider || '').toLowerCase() === 'mediux' ? 'mediux' : 'posterdb';
        const normalized = {
            ...set,
            provider,
            setId: String(set.setId),
            title: String(set.title || `Set ${set.setId}`),
            url: String(set.url),
            user: set.user || null,
            thumbUrl: set.thumbUrl || '',
            posterCount: set.posterCount ?? null,
        };
        const keyed = setMatchKey(normalized);
        const map = keyed.endsWith('|') ? titleOnly : exact;
        if (!map.has(keyed)) map.set(keyed, []);
        map.get(keyed).push(normalized);
        inputOrder.push({ keyed, map, normalized });
    };

    for (const set of Array.isArray(sets) ? sets : []) consider(set);

    // Promote title-only groups into exact buckets when a matching titled+user group exists.
    for (const [key, group] of [...titleOnly.entries()]) {
        const titlePart = key.slice(0, -1);
        let folded = false;
        for (const [exactKey, exactGroup] of exact.entries()) {
            if (exactKey.startsWith(`${titlePart}|`) && exactKey !== key) {
                exactGroup.push(...group);
                folded = true;
                break;
            }
        }
        if (!folded) exact.set(key, group);
    }

    const resolveKey = (keyed, map) => {
        if (exact.has(keyed)) return keyed;
        if (map === titleOnly) {
            const titlePart = keyed.slice(0, -1);
            for (const exactKey of exact.keys()) {
                if (exactKey.startsWith(`${titlePart}|`) && exactKey !== keyed) return exactKey;
            }
        }
        return keyed;
    };

    const buildMerged = (group) => {
        const byProvider = new Map();
        for (const item of group) {
            if (!byProvider.has(item.provider)) byProvider.set(item.provider, item);
        }
        const unique = [...byProvider.values()].sort((a, b) => providerRank(a.provider, pref) - providerRank(b.provider, pref));
        const primary = unique[0];
        if (!primary) return null;
        return {
            item: {
                ...primary,
                alsoOn: unique.slice(1).map((entry) => ({
                    provider: entry.provider,
                    setId: entry.setId,
                    url: entry.url,
                    title: entry.title,
                    user: entry.user,
                    thumbUrl: entry.thumbUrl,
                    setKind: entry.setKind || null,
                })),
            },
            dupeExtra: Math.max(0, unique.length - 1),
        };
    };

    const merged = [];
    let dupesCollapsed = 0;

    if (preserveOrder) {
        // Keep scrape order (creator pages are newest-first on MediUX / ThePosterDB).
        const seen = new Set();
        for (const entry of inputOrder) {
            const key = resolveKey(entry.keyed, entry.map);
            if (seen.has(key)) continue;
            const group = exact.get(key);
            if (!group) continue;
            seen.add(key);
            const built = buildMerged(group);
            if (!built) continue;
            dupesCollapsed += built.dupeExtra;
            merged.push(built.item);
        }
    } else {
        for (const group of exact.values()) {
            const built = buildMerged(group);
            if (!built) continue;
            dupesCollapsed += built.dupeExtra;
            merged.push(built.item);
        }
        merged.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' }));
    }

    const near = collapseNearDuplicateSets(merged);
    return {
        sets: excludeBlockedCreators(
            prioritizeSetsByFollowedCreators(near.sets, preferredCreators),
            blockedCreators,
        ),
        dupesCollapsed: dupesCollapsed + near.collapsed,
    };
};
