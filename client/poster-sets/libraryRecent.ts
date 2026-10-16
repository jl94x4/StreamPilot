import { portalUrl } from '../shared/basePath';
import type { PosterSetsSearchTitle } from './types';

export type LibraryRecentItem = {
    id: string;
    title: string;
    year?: number | null;
    mediaType: 'show' | 'movie';
    /** Plex/Jellyfin TMDB id when known — skip fuzzy title search. */
    tmdbId?: string | null;
    /** TheTVDB id when TMDB is missing (common on Plex TV agents). */
    tvdbId?: string | null;
    thumb?: string | null;
    thumbUrl?: string | null;
    posterFallbackUrl?: string | null;
    addedAt?: number;
    librarySection?: string | null;
    librarySectionKey?: string | null;
};

export type LibrarySection = {
    key: string;
    title: string;
    type: 'show' | 'movie';
    count?: number;
};

export type LibraryBrowseSort = 'titleAsc' | 'titleDesc' | 'yearDesc' | 'yearAsc' | 'addedDesc' | 'addedAsc' | 'cachedFirst';
export type LibraryCacheStatus = 'all' | 'cached' | 'uncached';

const mapMovie = (item: Record<string, unknown>): LibraryRecentItem | null => {
    const title = String(item.title || '').trim();
    if (!title) return null;
    return {
        id: String(item.ratingKey || title),
        title,
        year: Number(item.year) || null,
        mediaType: 'movie',
        tmdbId: item.tmdbId != null ? String(item.tmdbId) : null,
        tvdbId: item.tvdbId != null ? String(item.tvdbId) : null,
        thumb: item.thumb ? String(item.thumb) : null,
        thumbUrl: item.thumbUrl ? String(item.thumbUrl) : null,
        posterFallbackUrl: item.posterFallbackUrl ? String(item.posterFallbackUrl) : null,
        addedAt: Number(item.addedAt) || 0,
    };
};

export const normalizePlexShows = (shows: Record<string, unknown>[] = []): LibraryRecentItem[] =>
    shows.map((item) => {
        const title = String(item.title || '').trim();
        if (!title) return null;
        return {
            id: String(item.ratingKey || title),
            title,
            year: Number(item.year) || null,
            mediaType: 'show' as const,
            tmdbId: item.tmdbId != null ? String(item.tmdbId) : null,
            tvdbId: item.tvdbId != null ? String(item.tvdbId) : null,
            thumb: item.thumb ? String(item.thumb) : null,
            thumbUrl: item.thumbUrl ? String(item.thumbUrl) : null,
            addedAt: Number(item.addedAt) || 0,
        };
    }).filter(Boolean) as LibraryRecentItem[];

/** Jellyfin recently-added episodes → deduped show list (newest episode per series wins). */
export const normalizeJellyfinShows = (episodes: Record<string, unknown>[] = []): LibraryRecentItem[] => {
    const seen = new Map<string, LibraryRecentItem>();
    for (const item of episodes) {
        const seriesTitle = String(item.parentTitle || String(item.title || '').split(' - ')[0] || item.title || '').trim();
        if (!seriesTitle) continue;
        const entry: LibraryRecentItem = {
            id: String(item.thumb || item.ratingKey || seriesTitle),
            title: seriesTitle,
            year: Number(item.year) || null,
            mediaType: 'show',
            thumb: item.thumb ? String(item.thumb) : null,
            thumbUrl: item.thumbUrl ? String(item.thumbUrl) : null,
            posterFallbackUrl: item.posterFallbackUrl ? String(item.posterFallbackUrl) : null,
            addedAt: Number(item.addedAt) || 0,
        };
        const key = seriesTitle.toLowerCase();
        const existing = seen.get(key);
        if (!existing || (entry.addedAt || 0) > (existing.addedAt || 0)) {
            seen.set(key, entry);
        }
    }
    return [...seen.values()].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
};

export const normalizeLibraryMovies = (movies: Record<string, unknown>[] = []): LibraryRecentItem[] =>
    movies.map(mapMovie).filter(Boolean) as LibraryRecentItem[];

export const normalizeLibraryItems = (items: Record<string, unknown>[] = []): LibraryRecentItem[] =>
    items.map((item) => {
        const mediaType = String(item.mediaType || '').toLowerCase() === 'show' ? 'show' : 'movie';
        const title = String(item.title || '').trim();
        if (!title) return null;
        return {
            id: String(item.id || item.ratingKey || title),
            title,
            year: Number(item.year) || null,
            mediaType,
            tmdbId: item.tmdbId != null ? String(item.tmdbId) : null,
            tvdbId: item.tvdbId != null ? String(item.tvdbId) : null,
            thumb: item.thumb ? String(item.thumb) : null,
            thumbUrl: item.thumbUrl ? String(item.thumbUrl) : null,
            posterFallbackUrl: item.posterFallbackUrl ? String(item.posterFallbackUrl) : null,
            addedAt: Number(item.addedAt) || 0,
            librarySection: item.librarySection ? String(item.librarySection) : null,
            librarySectionKey: item.librarySectionKey ? String(item.librarySectionKey) : null,
        };
    }).filter(Boolean) as LibraryRecentItem[];

export const libraryItemPosterSrc = (item: LibraryRecentItem): string => {
    if (item.thumbUrl) {
        const raw = String(item.thumbUrl).trim();
        if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
        return portalUrl(raw.startsWith('/') ? raw : `/${raw}`);
    }
    if (item.thumb) {
        return portalUrl(`/api/plex/image?path=${encodeURIComponent(item.thumb)}&width=300&height=450`);
    }
    if (item.posterFallbackUrl) {
        const raw = String(item.posterFallbackUrl).trim();
        return portalUrl(raw.startsWith('/') ? raw : `/${raw}`);
    }
    return '';
};

/** Discover picker row for a library title that already has a TMDB id. */
export const libraryItemToSearchTitle = (item: LibraryRecentItem): PosterSetsSearchTitle | null => {
    const tmdbId = String(item.tmdbId || '').trim();
    const title = String(item.title || '').trim();
    if (!title || !/^\d+$/.test(tmdbId)) return null;
    return {
        id: tmdbId,
        title,
        year: item.year ?? null,
        url: item.mediaType === 'show'
            ? `https://mediux.pro/shows/${tmdbId}`
            : `https://mediux.pro/movies/${tmdbId}`,
        mediaType: item.mediaType,
        thumbUrl: libraryItemPosterSrc(item),
        provider: 'mediux',
        inLibrary: true,
    };
};
