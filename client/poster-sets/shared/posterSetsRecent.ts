import { classifyPreviewAsset } from '../previewGroups';
import { type PosterSetsBrowseRail, type PosterSetsPreviewAsset, type PosterSetsSetMeta } from '../types';
import { type SetProvider } from './posterSetsNav';

export const RECENT_SETS_KEY = 'poster-sets-recent-v2';
const RECENT_SETS_KEY_LEGACY = 'poster-sets-recent-v1';
const REMOVED_RECENT_SETS_KEY = 'poster-sets-recent-removed-v1';
/** Keep a long local preview history; the Recent tab paginates the rest. */
export const MAX_RECENT_SETS = 500;

export type RecentSetCategory = 'posters' | 'backgrounds' | 'title_cards';

export type RecentSetChip = {
    url: string;
    title: string;
    user?: string | null;
    provider: string | null;
    setId: string | null;
    thumbUrl: string;
    assetCount: number | null;
    setKind?: string | null;
    at: string;
};

export const isTitleCardSet = (
    set?: { title?: string | null; setKind?: string | null } | null,
    options?: { mediaType?: string | null },
) => {
    const title = String(set?.title || '');
    const media = String(options?.mediaType || '').trim().toLowerCase();
    const titleSaysTitleCard = /(title\s*cards?|episode\s*cards?)/i.test(title);
    // Movies have no episode title-card packs — ignore aspect-video / setKind false positives
    // (MediUX boxset backdrop rails reuse the same landscape card chrome).
    if (media === 'movie' || media === 'movies') {
        return titleSaysTitleCard;
    }
    const kind = String(set?.setKind || '').trim().toLowerCase();
    if (kind === 'boxset' || kind === 'backgrounds' || kind === 'background' || kind === 'backdrop' || kind === 'backdrops') {
        return false;
    }
    if (kind === 'title_cards' || kind === 'title-cards' || kind === 'titlecard') return true;
    return titleSaysTitleCard || /cover\s*style/i.test(title);
};

export const isTitleCardRail = (rail?: PosterSetsBrowseRail | null) => {
    if (!rail) return false;
    if (rail.id === 'mediux_title_cards') return true;
    const sample = rail.sets.slice(0, 8);
    return sample.length > 0 && sample.every((set) => isTitleCardSet(set));
};

export const isExclusiveTitleCardSet = (
    set?: { title?: string | null; setKind?: string | null; posterThumbUrl?: string | null } | null,
    options?: { mediaType?: string | null },
) => {
    if (!isTitleCardSet(set, options)) return false;
    if (String(set?.posterThumbUrl || '').trim()) return false;
    const title = String(set?.title || '');
    return /(title\s*cards?|episode\s*cards?|cover\s*style)/i.test(title);
};

export const isBackgroundSet = (set?: { title?: string | null; setKind?: string | null } | null) => {
    const kind = String(set?.setKind || '').trim().toLowerCase();
    if (kind === 'backgrounds' || kind === 'background' || kind === 'backdrop' || kind === 'backdrops') return true;
    return /\b(backgrounds?|backdrops?)\b/i.test(String(set?.title || ''));
};

export const normalizeRecentSetKind = (value?: string | null): RecentSetCategory | null => {
    const kind = String(value || '').trim().toLowerCase().replace(/-/g, '_');
    if (!kind) return null;
    if (kind === 'title_cards' || kind === 'title_card' || kind === 'titlecards') return 'title_cards';
    if (kind === 'backgrounds' || kind === 'background' || kind === 'backdrop' || kind === 'backdrops') {
        return 'backgrounds';
    }
    if (kind === 'posters' || kind === 'poster' || kind === 'covers' || kind === 'boxset' || kind === 'collection' || kind === 'collections') return 'posters';
    return null;
};

export const inferRecentSetKindFromAssets = (assets?: PosterSetsPreviewAsset[] | null): RecentSetCategory | null => {
    if (!assets?.length) return null;
    const kinds = new Set(assets.map((asset) => classifyPreviewAsset(asset)));
    if (kinds.size === 1 && kinds.has('title_card')) return 'title_cards';
    if (kinds.size === 1 && kinds.has('background')) return 'backgrounds';
    if ([...kinds].every((kind) => kind === 'title_card' || kind === 'background') && kinds.has('title_card') && !kinds.has('background')) {
        return 'title_cards';
    }
    if ([...kinds].every((kind) => kind === 'background')) return 'backgrounds';
    if ([...kinds].every((kind) => kind === 'show_cover' || kind === 'season_cover' || kind === 'poster')) {
        return 'posters';
    }
    return null;
};

export const inferRecentSetKindFromFilters = (filters?: string[] | null): RecentSetCategory | null => {
    const list = (Array.isArray(filters) ? filters : [])
        .map((item) => String(item || '').trim().toLowerCase())
        .filter(Boolean);
    if (!list.length) return null;
    if (list.every((item) => item === 'title_card')) return 'title_cards';
    if (list.every((item) => item === 'background')) return 'backgrounds';
    if (list.every((item) => item === 'show_cover' || item === 'season_cover')) return 'posters';
    return null;
};

export const classifyRecentSet = (item: {
    title?: string | null;
    setKind?: string | null;
    mediuxFilters?: string[] | null;
}): RecentSetCategory => {
    const fromKind = normalizeRecentSetKind(item.setKind);
    if (fromKind) return fromKind;
    const fromFilters = inferRecentSetKindFromFilters(item.mediuxFilters);
    if (fromFilters) return fromFilters;
    if (isTitleCardSet(item)) return 'title_cards';
    if (isBackgroundSet(item)) return 'backgrounds';
    return 'posters';
};

export const RECENT_CATEGORY_ORDER: Array<{ id: RecentSetCategory; title: string; landscape: boolean }> = [
    { id: 'posters', title: 'Posters', landscape: false },
    { id: 'backgrounds', title: 'Backgrounds', landscape: true },
    { id: 'title_cards', title: 'Title cards', landscape: true },
];

/** Split search/browse results so title-card packs use landscape rows.
 *  Mixed MediUX sets (posters + episode cards) appear in both Posters and Title cards. */
export const partitionSetsByCategory = (
    sets: Array<{
        title?: string | null;
        setKind?: string | null;
        thumbUrl?: string | null;
        posterThumbUrl?: string | null;
        landscapeThumbUrl?: string | null;
    }>,
    options?: { mediaType?: string | null },
) => {
    const titleCards: typeof sets = [];
    const backgrounds: typeof sets = [];
    const posters: typeof sets = [];
    for (const set of sets) {
        if (isBackgroundSet(set)) {
            backgrounds.push(set);
            continue;
        }
        const landscapeThumb = String(set.landscapeThumbUrl || '').trim();
        const posterThumb = String(set.posterThumbUrl || '').trim();
        const titleCard = isTitleCardSet(set, options) || Boolean(landscapeThumb);
        const exclusiveTitleCard = isExclusiveTitleCardSet(set, options);
        if (titleCard) {
            titleCards.push(landscapeThumb ? { ...set, thumbUrl: landscapeThumb } : set);
        }
        if (!exclusiveTitleCard && (posterThumb || !titleCard)) {
            posters.push(posterThumb ? { ...set, thumbUrl: posterThumb } : set);
        }
    }
    return { titleCards, backgrounds, posters };
};

export const SEARCH_SET_CATEGORY_ORDER: Array<{ id: RecentSetCategory; title: string; landscape: boolean }> = [
    { id: 'title_cards', title: 'Title cards', landscape: true },
    { id: 'posters', title: 'Posters', landscape: false },
    { id: 'backgrounds', title: 'Backgrounds', landscape: true },
];

export const parseSetRef = (rawUrl: string): {
    provider: SetProvider | null;
    setId: string | null;
    kind: 'set' | 'poster' | 'user' | null;
    url: string;
} => {
    const url = String(rawUrl || '').trim();
    let host = '';
    try {
        host = new URL(url.includes('://') ? url : `https://${url}`).hostname.toLowerCase();
    } catch {
        host = '';
    }
    if (host === 'mediux.pro' || host.endsWith('.mediux.pro')) {
        const match = url.match(/\/sets?\/(\d+)/i);
        return { provider: 'mediux', setId: match?.[1] || null, kind: match ? 'set' : null, url };
    }
    if (host === 'theposterdb.com' || host.endsWith('.theposterdb.com')) {
        const posterMatch = url.match(/\/poster\/(\d+)/i);
        if (posterMatch) {
            return { provider: 'posterdb', setId: posterMatch[1], kind: 'poster', url };
        }
        const setMatch = url.match(/\/set\/(\d+)/i);
        if (setMatch) {
            return { provider: 'posterdb', setId: setMatch[1], kind: 'set', url };
        }
        const userMatch = url.match(/\/user\/([^/?#]+)/i);
        if (userMatch) {
            return { provider: 'posterdb', setId: userMatch[1], kind: 'user', url };
        }
        return { provider: 'posterdb', setId: null, kind: null, url };
    }
    return { provider: null, setId: null, kind: null, url };
};

export const buildSetUrl = (provider: SetProvider, rawId: string, kind: 'set' | 'poster' | 'user' = 'set') => {
    const id = String(rawId || '').trim().replace(/^#/, '');
    if (!id) return '';
    if (provider === 'mediux') return `https://mediux.pro/sets/${encodeURIComponent(id)}`;
    if (kind === 'poster' && /^\d+$/.test(id)) return `https://theposterdb.com/poster/${id}`;
    if (kind === 'user' || !/^\d+$/.test(id)) return `https://theposterdb.com/user/${encodeURIComponent(id)}`;
    return `https://theposterdb.com/set/${id}`;
};

export { parseTpdbUserHandle, isTpdbRecentUrl, isTpdbFeedUrl } from './tpdbUserHandle.js';

const normalizeRecentChip = (raw: any): RecentSetChip | null => {
    if (!raw?.url) return null;
    const url = String(raw.url || '').trim();
    if (!url) return null;
    const ref = parseSetRef(url);
    return {
        url,
        title: String(raw.title || (ref.setId ? `Set ${ref.setId}` : 'Poster set')).trim() || 'Poster set',
        user: raw.user != null ? String(raw.user).trim().replace(/^@/, '') || null : null,
        provider: raw.provider || ref.provider,
        setId: raw.setId != null ? String(raw.setId) : ref.setId,
        thumbUrl: String(raw.thumbUrl || ''),
        assetCount: Number.isFinite(Number(raw.assetCount)) ? Number(raw.assetCount) : null,
        setKind: normalizeRecentSetKind(raw.setKind) || (isTitleCardSet(raw) ? 'title_cards' : isBackgroundSet(raw) ? 'backgrounds' : null),
        at: String(raw.at || new Date(0).toISOString()),
    };
};

export const readRecentSets = (): RecentSetChip[] => {
    try {
        const raw = localStorage.getItem(RECENT_SETS_KEY) || localStorage.getItem(RECENT_SETS_KEY_LEGACY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        return parsed.map(normalizeRecentChip).filter(Boolean) as RecentSetChip[];
    } catch {
        return [];
    }
};

export const writeRecentSets = (entries: RecentSetChip[]) => {
    try {
        localStorage.setItem(RECENT_SETS_KEY, JSON.stringify(entries.slice(0, MAX_RECENT_SETS)));
    } catch {
        // ignore quota / private mode
    }
};

export const readRemovedRecentSetUrls = (): Set<string> => {
    try {
        const raw = localStorage.getItem(REMOVED_RECENT_SETS_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.map((item) => String(item || '').trim()).filter(Boolean));
    } catch {
        return new Set();
    }
};

const writeRemovedRecentSetUrls = (urls: Iterable<string>) => {
    try {
        const next = [...new Set([...urls].map((item) => String(item || '').trim()).filter(Boolean))];
        localStorage.setItem(REMOVED_RECENT_SETS_KEY, JSON.stringify(next));
    } catch {
        // ignore quota / private mode
    }
};

export const removeRecentSets = (urls: string[]) => {
    const drop = new Set(urls.map((item) => String(item || '').trim()).filter(Boolean));
    if (!drop.size) return;
    writeRecentSets(readRecentSets().filter((item) => !drop.has(item.url)));
    const removed = readRemovedRecentSetUrls();
    for (const url of drop) removed.add(url);
    writeRemovedRecentSetUrls(removed);
};

export const removeRecentSet = (url: string) => removeRecentSets([url]);

export const upsertRecentSet = (
    meta: PosterSetsSetMeta | null | undefined,
    fallbackUrl?: string,
    options?: {
        setKind?: string | null;
        assets?: PosterSetsPreviewAsset[] | null;
        mediuxFilters?: string[] | null;
    },
) => {
    const url = String(meta?.url || fallbackUrl || '').trim();
    if (!url) return;
    const ref = parseSetRef(url);
    const setKind = normalizeRecentSetKind(options?.setKind)
        || normalizeRecentSetKind(meta?.setKind)
        || inferRecentSetKindFromAssets(options?.assets)
        || inferRecentSetKindFromFilters(options?.mediuxFilters)
        || (isTitleCardSet({ title: meta?.title, setKind: meta?.setKind }) ? 'title_cards' : null)
        || (isBackgroundSet({ title: meta?.title, setKind: meta?.setKind }) ? 'backgrounds' : null)
        || 'posters';
    const next: RecentSetChip = {
        url,
        title: String(meta?.title || (ref.setId ? `Set ${ref.setId}` : 'Poster set')).trim() || 'Poster set',
        user: meta?.user != null ? String(meta.user).trim().replace(/^@/, '') || null : null,
        provider: meta?.provider || ref.provider,
        setId: meta?.setId != null ? String(meta.setId) : ref.setId,
        thumbUrl: String(meta?.thumbUrl || ''),
        assetCount: Number.isFinite(Number(meta?.assetCount)) ? Number(meta?.assetCount) : null,
        setKind,
        at: new Date().toISOString(),
    };
    const existing = readRecentSets().filter((item) => item.url !== url);
    writeRecentSets([next, ...existing]);
    const removed = readRemovedRecentSetUrls();
    if (removed.delete(url)) writeRemovedRecentSetUrls(removed);
};
