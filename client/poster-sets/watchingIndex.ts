import { normalizeTitleMatchKey } from './autoMatchTitle';
import type { LibraryRecentItem } from './libraryRecent';

export type PosterSetsWatchingIndex = {
    ratingKeys?: string[];
    titleKeys?: string[];
    tmdbIds?: string[];
};

const COLLECTION_TITLE_KEY_RE = /\b(collection|boxset|box set|boxsets)\b/;

export const libraryItemIsWatching = (
    item: Pick<LibraryRecentItem, 'id' | 'title' | 'tmdbId'> | null | undefined,
    index: PosterSetsWatchingIndex | null | undefined,
) => {
    if (!item || !index) return false;
    const ratingKeys = new Set(index.ratingKeys || []);
    const titleKeys = new Set(index.titleKeys || []);
    const tmdbIds = new Set(index.tmdbIds || []);
    const ratingKey = String(item.id || '').trim();
    if (ratingKey && ratingKeys.has(ratingKey)) return true;
    const tmdb = String(item.tmdbId || '').trim();
    if (tmdb && tmdb !== '0' && tmdbIds.has(tmdb)) return true;
    const needle = normalizeTitleMatchKey(item.title || '');
    if (!needle) return false;
    if (titleKeys.has(needle)) return true;
    for (const stored of titleKeys) {
        if (!COLLECTION_TITLE_KEY_RE.test(stored)) continue;
        if (stored.startsWith(needle) || needle.startsWith(stored)) return true;
    }
    return false;
};
