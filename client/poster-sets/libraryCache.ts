import type { LibraryRecentItem } from './libraryRecent';

const RECENT_KEY = 'posterSetsLibraryRecent';
const SEARCH_KEY_PREFIX = 'posterSetsLibrarySearch:';
const RECENT_TTL_MS = 3 * 60 * 1000;
const SEARCH_TTL_MS = 60 * 1000;

type CachedPayload<T> = {
    savedAt: number;
    data: T;
};

export type LibraryRecentCache = {
    movies: LibraryRecentItem[];
    shows: LibraryRecentItem[];
};

const readPayload = <T>(key: string, ttlMs: number): T | null => {
    try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as CachedPayload<T>;
        if (!parsed?.savedAt || Date.now() - parsed.savedAt > ttlMs) {
            sessionStorage.removeItem(key);
            return null;
        }
        return parsed.data;
    } catch {
        return null;
    }
};

const writePayload = <T>(key: string, data: T) => {
    try {
        sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
    } catch {
        /* quota or private mode */
    }
};

export const readLibraryRecentCache = (): LibraryRecentCache | null =>
    readPayload<LibraryRecentCache>(RECENT_KEY, RECENT_TTL_MS);

export const writeLibraryRecentCache = (data: LibraryRecentCache) => {
    writePayload(RECENT_KEY, data);
};

export const clearLibraryRecentCache = () => {
    try {
        sessionStorage.removeItem(RECENT_KEY);
    } catch {
        /* ignore */
    }
};

export const readLibrarySearchCache = (query: string): LibraryRecentItem[] | null => {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return null;
    return readPayload<LibraryRecentItem[]>(`${SEARCH_KEY_PREFIX}${q}`, SEARCH_TTL_MS);
};

export const writeLibrarySearchCache = (query: string, results: LibraryRecentItem[]) => {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return;
    writePayload(`${SEARCH_KEY_PREFIX}${q}`, results);
};
