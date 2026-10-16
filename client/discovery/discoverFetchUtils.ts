import { apiFetch } from '../shared/api';
import type { FilterState } from './FilterDrawer';
import { appendDiscoverQuery, hasAdvancedDiscoverFilters } from './discoverUrlUtils';
import { filterDiscoverBrowseItems } from './discoverAvailability';
import { dedupeDiscoverResults } from './discoverItemUtils';

export type DiscoverPagePayload = {
    results: any[];
    totalPages: number;
    lastFetchedPage?: number;
};

type DiscoverBrowseFilterOptions = {
    hideAvailable?: boolean;
    hideRequested?: boolean;
    /**
     * Trust mediaInfo already attached by the discovery proxy (disk cache + warm catalog).
     * Client must not round-trip /availability-batch — that caused badge pop-in after paint.
     */
    trustAttachedAvailability?: boolean;
};

/** Extra same-endpoint pages to scan when hide-available empties a single page (Seerr-style). */
const MAX_SEQUENTIAL_EXTRA_PAGES = 5;

export const buildDiscoverStudioApiUrl = (page: number, studioId: number | string, sort = 'popularity.desc') =>
    `/api/discovery/proxy/discover/movies/studio/${studioId}?page=${page}&sortBy=${encodeURIComponent(sort)}`;

export const buildDiscoverNetworkApiUrl = (page: number, networkId: number | string, sort = 'popularity.desc') =>
    `/api/discovery/proxy/discover/tv/network/${networkId}?page=${page}&sortBy=${encodeURIComponent(sort)}`;

export const buildDiscoverMoviesApiUrl = (page: number, filters: FilterState): string => {
    const sort = filters.sort || 'popularity.desc';
    const studioOnly = Boolean(filters.studio)
        && !hasAdvancedDiscoverFilters({ ...filters, studio: '', sort: 'popularity.desc' }, 'movie');

    if (studioOnly) {
        return buildDiscoverStudioApiUrl(page, filters.studio, sort);
    }

    let url = `/api/discovery/proxy/discover/movies?page=${page}&sortBy=${encodeURIComponent(sort)}`;
    return appendDiscoverQuery(url, filters, 'movie');
};

export const buildDiscoverSeriesApiUrl = (page: number, filters: FilterState): string => {
    const sort = filters.sort || 'popularity.desc';
    const networkOnly = Boolean(filters.network)
        && !hasAdvancedDiscoverFilters({ ...filters, network: '', sort: 'popularity.desc' }, 'tv');
    const keywordsOnly = Boolean(filters.keywords)
        && !hasAdvancedDiscoverFilters({ ...filters, keywords: '', keywordName: '', sort: 'popularity.desc' }, 'tv');

    if (keywordsOnly) {
        return `/api/discovery/proxy/discover/tv?keywords=${encodeURIComponent(filters.keywords)}&page=${page}&sortBy=${encodeURIComponent(sort)}`;
    }

    if (networkOnly) {
        return buildDiscoverNetworkApiUrl(page, filters.network, sort);
    }

    let url = `/api/discovery/proxy/discover/tv?page=${page}&sortBy=${encodeURIComponent(sort)}`;
    return appendDiscoverQuery(url, filters, 'tv');
};

export async function fetchDiscoverPage(
    url: string,
    options: DiscoverBrowseFilterOptions = {},
): Promise<DiscoverPagePayload> {
    const res = await apiFetch(url);
    const filtered = filterDiscoverBrowseItems(res?.results || [], options);
    return {
        results: dedupeDiscoverResults(filtered),
        totalPages: Math.max(1, Number(res?.totalPages) || 1),
    };
}

/** TMDB pages a home rail may scan when hide-available is on. View All keeps paging; home used to stop at 4. */
export const HOME_RAIL_HIDE_AVAILABLE_MAX_PAGES = 16;
export const HOME_RAIL_HIDE_AVAILABLE_MIN_ITEMS = 20;

type HomeRowFetchOptions = {
    minItems?: number;
    maxPages?: number;
    maxItems?: number;
    needsBackfill?: boolean;
    hideRequested?: boolean;
    trustAttachedAvailability?: boolean;
    /** Parallel page fetches — Seerr-style home uses 1 (sequential). */
    pageConcurrency?: number;
    /** Drop poster-less titles so home never shows "POSTER NOT FOUND" tiles. */
    requirePoster?: boolean;
    /** Cancel in-flight page fetches (home remount / refresh). */
    signal?: AbortSignal;
    /**
     * Live-enrich each page batch before counting toward minItems.
     * Needed when hide-available is on: disk cache can look full, then enrich
     * marks library titles available and the rail would otherwise shrink with no refill.
     */
    enrich?: (items: any[]) => Promise<any[]>;
    /** TMDB pages to fetch before each enrich round (hide-available only). */
    enrichChunkPages?: number;
    /** Called after each filled round so home can paint a partial rail, then grow it. */
    onPartial?: (items: any[]) => void;
};

const itemHasPoster = (item: any) => !!(
    item?.posterPath
    || item?.posterUrl
    || item?.poster
);

const applyHomeRowQualityFilters = (items: any[], options: HomeRowFetchOptions) => {
    let next = Array.isArray(items) ? items : [];
    if (options.requirePoster) next = next.filter(itemHasPoster);
    return next;
};

/**
 * Seerr-style home rail: one endpoint, sequential same-URL pages.
 * When hide-available is on, keep paging until minItems remain *after* optional live enrich —
 * never stop on a pre-enrich count, and never alternate sorts.
 */
export async function fetchDiscoverHomeRowResults(
    buildUrl: (page: number) => string,
    hideAvailable: boolean,
    options: HomeRowFetchOptions = {},
): Promise<any[]> {
    const maxItems = options.maxItems ?? 30;
    const maxPages = options.maxPages ?? (hideAvailable ? HOME_RAIL_HIDE_AVAILABLE_MAX_PAGES : 2);
    const minItems = Math.min(
        options.minItems ?? (hideAvailable ? HOME_RAIL_HIDE_AVAILABLE_MIN_ITEMS : Math.min(30, maxItems)),
        maxItems,
    );
    const hideRequested = options.hideRequested === true;
    const signal = options.signal;
    const enrich = typeof options.enrich === 'function' ? options.enrich : null;
    const pagesPerRound = enrich && hideAvailable
        ? Math.max(1, options.enrichChunkPages ?? 2)
        : 1;
    const filterOptions: DiscoverBrowseFilterOptions = {
        hideAvailable,
        hideRequested,
        trustAttachedAvailability: options.trustAttachedAvailability !== false,
    };

    const fetchPage = (page: number) => (
        apiFetch(buildUrl(page), signal ? { signal } : {}).catch((err: any) => {
            if (signal?.aborted || err?.name === 'AbortError') return null;
            return null;
        })
    );

    let visible: any[] = [];
    let totalPages = Number.POSITIVE_INFINITY;
    let page = 1;

    while (page <= maxPages && visible.length < minItems) {
        if (signal?.aborted) break;

        const rawChunk: any[] = [];
        let reachedEnd = false;
        const pagesThisRound = Math.min(pagesPerRound, maxPages - page + 1);

        for (let i = 0; i < pagesThisRound; i += 1) {
            if (signal?.aborted) break;
            const res = await fetchPage(page);
            page += 1;
            if (!res) {
                reachedEnd = true;
                break;
            }
            totalPages = Math.max(1, Number(res?.totalPages) || 1);
            rawChunk.push(...applyHomeRowQualityFilters(
                Array.isArray(res?.results) ? res.results : [],
                options,
            ));
            if ((page - 1) >= totalPages) {
                reachedEnd = true;
                break;
            }
        }

        if (!rawChunk.length) {
            if (reachedEnd) break;
            continue;
        }

        let batch = filterDiscoverBrowseItems(rawChunk, filterOptions);
        if (enrich && batch.length) {
            batch = filterDiscoverBrowseItems(await enrich(batch), filterOptions);
        }

        visible = dedupeDiscoverResults([...visible, ...batch]);
        if (visible.length) options.onPartial?.(visible.slice(0, maxItems));
        if (visible.length >= maxItems) break;
        if (reachedEnd) break;
    }

    return visible.slice(0, maxItems);
}

/**
 * Seerr-style browse step: fetch page N, filter hide-available, and if the filtered
 * page is empty advance sequentially up to MAX_SEQUENTIAL_EXTRA_PAGES (same endpoint).
 * Replaces the old 50×4 parallel backfill storm.
 */
export async function fetchDiscoverPageWithAdvance(
    buildUrl: (page: number) => string,
    page: number,
    options: DiscoverBrowseFilterOptions = {},
): Promise<DiscoverPagePayload & { lastFetchedPage: number }> {
    const needsAdvance = !!options.hideAvailable || !!options.hideRequested;
    if (!needsAdvance) {
        const payload = await fetchDiscoverPage(buildUrl(page), options);
        return { ...payload, lastFetchedPage: page };
    }

    let merged: any[] = [];
    let totalPages = 1;
    let lastFetchedPage = page;
    const endPage = page + MAX_SEQUENTIAL_EXTRA_PAGES;

    for (let current = page; current <= endPage; current += 1) {
        const payload = await fetchDiscoverPage(buildUrl(current), options).catch(() => null);
        if (!payload) {
            lastFetchedPage = current;
            break;
        }
        totalPages = Math.max(1, Number(payload.totalPages) || 1);
        lastFetchedPage = current;
        merged = dedupeDiscoverResults([...merged, ...(payload.results || [])]);
        if (merged.length > 0 || current >= totalPages) {
            return { results: merged, totalPages, lastFetchedPage };
        }
    }

    return { results: merged, totalPages, lastFetchedPage };
}

/** @deprecated Use fetchDiscoverPageWithAdvance — kept as alias for any stray imports. */
export const fetchDiscoverPageWithBackfill = fetchDiscoverPageWithAdvance;
