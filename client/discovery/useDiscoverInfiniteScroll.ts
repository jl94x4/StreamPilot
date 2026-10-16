import { useCallback, useEffect, useRef, useState } from 'react';
import type { PosterGridValue } from '../shared/portalLayout';
import { mergeDiscoverResults } from './discoverItemUtils';
import { filterDiscoverBrowseItems } from './discoverAvailability';
import { enrichDiscoverBrowseRows } from './discoverAvailabilityEnrich';
import { DISCOVER_LOAD_MORE_TARGET } from './discoverPaginationUtils';
import type { DiscoverPagePayload } from './discoverFetchUtils';

export type { DiscoverPagePayload };

type BrowseFilterOptions = {
    hideAvailable?: boolean;
    hideRequested?: boolean;
};

type Options = {
    resetKey: string;
    gridSize: PosterGridValue;
    containerRef: React.RefObject<HTMLElement | null>;
    fetchPage: (page: number) => Promise<DiscoverPagePayload>;
    /** Re-applied after live badge enrich so newly-marked available titles drop out. */
    filterOptions?: BrowseFilterOptions;
};

/** First paint: two batches (~60 titles), then +30 on each scroll. */
const INITIAL_BATCH_COUNT = 2;
const MAX_BROWSE_CACHE_ENTRIES = 8;

type BrowseCacheEntry = {
    results: any[];
    loadedPage: number;
    totalPages: number;
};

const browseCache = new Map<string, BrowseCacheEntry>();

const peekBrowseCache = (key: string): BrowseCacheEntry | null => {
    const entry = browseCache.get(key);
    return entry?.results?.length ? entry : null;
};

const readBrowseCache = (key: string): BrowseCacheEntry | null => {
    const entry = peekBrowseCache(key);
    if (!entry) return null;
    browseCache.delete(key);
    browseCache.set(key, entry);
    return entry;
};

const writeBrowseCache = (key: string, entry: BrowseCacheEntry) => {
    if (!key || !entry.results.length) return;
    browseCache.delete(key);
    browseCache.set(key, {
        results: entry.results,
        loadedPage: entry.loadedPage,
        totalPages: entry.totalPages,
    });
    while (browseCache.size > MAX_BROWSE_CACHE_ENTRIES) {
        const oldest = browseCache.keys().next().value;
        if (!oldest) break;
        browseCache.delete(oldest);
    }
};

export function useDiscoverInfiniteScroll({
    resetKey,
    gridSize,
    containerRef,
    fetchPage,
    filterOptions,
}: Options) {
    const filterOptionsRef = useRef(filterOptions);
    filterOptionsRef.current = filterOptions;
    const [results, setResults] = useState<any[]>(() => peekBrowseCache(resetKey)?.results ?? []);
    const [loadedPage, setLoadedPage] = useState(() => peekBrowseCache(resetKey)?.loadedPage ?? 0);
    const [totalPages, setTotalPages] = useState(() => peekBrowseCache(resetKey)?.totalPages ?? 1);
    const [loading, setLoading] = useState(() => !peekBrowseCache(resetKey)?.results?.length);
    const committedKeyRef = useRef(peekBrowseCache(resetKey)?.results?.length ? resetKey : '');
    const [loadingMore, setLoadingMore] = useState(false);
    const sentinelRef = useRef<HTMLDivElement>(null);
    const fetchingRef = useRef(false);
    const prefetchingRef = useRef(false);
    const prefetchRef = useRef<{
        fromPage: number;
        mergedBatch: any[];
        lastPage: number;
        totalPages: number;
    } | null>(null);
    const generationRef = useRef(0);

    const hasMore = loadedPage < totalPages;

    const prefetchNextBatch = useCallback(async (fromPage: number, knownTotalPages: number) => {
        if (prefetchingRef.current) return;
        if (fromPage <= 0 || fromPage > knownTotalPages) return;
        const generation = generationRef.current;
        prefetchingRef.current = true;
        try {
            let mergedBatch: any[] = [];
            let lastPage = fromPage - 1;
            let maxTotalPages = Math.max(1, knownTotalPages);

            while (mergedBatch.length < DISCOVER_LOAD_MORE_TARGET && lastPage < maxTotalPages) {
                const nextPage = lastPage + 1;
                const payload = await fetchPage(nextPage);
                if (generation !== generationRef.current) return;
                maxTotalPages = Math.max(1, Number(payload.totalPages) || maxTotalPages);
                const batch = Array.isArray(payload.results) ? payload.results : [];
                const filteredBatch = filterDiscoverBrowseItems(batch, filterOptionsRef.current || {});
                mergedBatch = mergeDiscoverResults(mergedBatch, filteredBatch);
                lastPage = payload.lastFetchedPage ?? nextPage;
                if (lastPage >= maxTotalPages) break;
            }

            if (generation !== generationRef.current) return;
            prefetchRef.current = {
                fromPage,
                mergedBatch,
                lastPage,
                totalPages: maxTotalPages,
            };
        } catch {
            if (generation !== generationRef.current) return;
            prefetchRef.current = null;
        } finally {
            if (generation === generationRef.current) prefetchingRef.current = false;
        }
    }, [fetchPage]);

    useEffect(() => {
        if (committedKeyRef.current === resetKey && results.length) {
            writeBrowseCache(resetKey, { results, loadedPage, totalPages });
        }
    }, [resetKey, results, loadedPage, totalPages]);

    useEffect(() => {
        let cancelled = false;
        generationRef.current += 1;
        prefetchRef.current = null;
        prefetchingRef.current = false;

        const cachedOnKey = readBrowseCache(resetKey);
        if (cachedOnKey?.results?.length) {
            committedKeyRef.current = resetKey;
            setResults(cachedOnKey.results);
            setLoadedPage(cachedOnKey.loadedPage);
            setTotalPages(cachedOnKey.totalPages);
            setLoading(false);
            void prefetchNextBatch(cachedOnKey.loadedPage + 1, cachedOnKey.totalPages);
            void enrichDiscoverBrowseRows(cachedOnKey.results).then((enriched) => {
                if (cancelled || committedKeyRef.current !== resetKey) return;
                const filtered = filterDiscoverBrowseItems(enriched, filterOptionsRef.current || {});
                setResults(filtered);
                writeBrowseCache(resetKey, {
                    results: filtered,
                    loadedPage: cachedOnKey.loadedPage,
                    totalPages: cachedOnKey.totalPages,
                });
            }).catch(() => {});
            return () => {
                cancelled = true;
            };
        }

        const runInitialLoad = async () => {
            setLoading(true);
            setResults([]);
            setLoadedPage(0);
            setTotalPages(1);

            fetchingRef.current = false;
            let merged: any[] = [];
            let lastPage = 0;
            let maxTotalPages = 1;

            try {
                // First paint loads multiple 30-title batches; scroll keeps appending more.
                const initialTarget = DISCOVER_LOAD_MORE_TARGET * INITIAL_BATCH_COUNT;
                while (merged.length < initialTarget && lastPage < maxTotalPages) {
                    if (cancelled) return;
                    const pageNumber = lastPage + 1;
                    if (lastPage > 0 && pageNumber > maxTotalPages) break;
                    const payload = await fetchPage(pageNumber);
                    maxTotalPages = Math.max(1, Number(payload.totalPages) || 1);
                    const batch = Array.isArray(payload.results) ? payload.results : [];
                    merged = mergeDiscoverResults(merged, batch);
                    lastPage = payload.lastFetchedPage ?? pageNumber;
                    if (lastPage >= maxTotalPages) break;
                }

                if (!cancelled) {
                    // Server stamps mediaInfo (disk cache + warm catalog). Re-apply hide only —
                    // then live-enrich rows the cache missed so browse badges match detail pages.
                    const nextResults = filterDiscoverBrowseItems(merged, filterOptionsRef.current || {});
                    committedKeyRef.current = resetKey;
                    setResults(nextResults);
                    setLoadedPage(lastPage);
                    setTotalPages(maxTotalPages);
                    writeBrowseCache(resetKey, {
                        results: nextResults,
                        loadedPage: lastPage,
                        totalPages: maxTotalPages,
                    });
                    void prefetchNextBatch(lastPage + 1, maxTotalPages);
                    void enrichDiscoverBrowseRows(nextResults).then((enriched) => {
                        if (cancelled || committedKeyRef.current !== resetKey) return;
                        const filtered = filterDiscoverBrowseItems(enriched, filterOptionsRef.current || {});
                        setResults(filtered);
                        writeBrowseCache(resetKey, {
                            results: filtered,
                            loadedPage: lastPage,
                            totalPages: maxTotalPages,
                        });
                    }).catch(() => {});
                }
            } catch (e) {
                console.error(e);
                if (!cancelled) {
                    setResults([]);
                    setLoadedPage(1);
                    setTotalPages(1);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        runInitialLoad();
        return () => {
            cancelled = true;
            fetchingRef.current = false;
            prefetchRef.current = null;
        };
    }, [resetKey, fetchPage, gridSize, containerRef, prefetchNextBatch]);

    const loadNextPage = useCallback(async () => {
        if (fetchingRef.current || loading || loadingMore || !hasMore) return;
        if (loadedPage >= totalPages) return;

        setLoadingMore(true);
        fetchingRef.current = true;
        try {
            const prefetched = prefetchRef.current;
            if (
                prefetched
                && prefetched.fromPage === loadedPage + 1
            ) {
                prefetchRef.current = null;
                setResults((prev) => mergeDiscoverResults(prev, prefetched.mergedBatch));
                setLoadedPage(prefetched.lastPage);
                setTotalPages(prefetched.totalPages);
                void prefetchNextBatch(prefetched.lastPage + 1, prefetched.totalPages);
                void enrichDiscoverBrowseRows(prefetched.mergedBatch).then((enrichedBatch) => {
                    if (fetchingRef.current) return;
                    setResults((prev) => mergeDiscoverResults(prev, enrichedBatch));
                }).catch(() => {});
                return;
            }

            let mergedBatch: any[] = [];
            let lastPage = loadedPage;
            let maxTotalPages = totalPages;

            while (mergedBatch.length < DISCOVER_LOAD_MORE_TARGET && lastPage < maxTotalPages) {
                const nextPage = lastPage + 1;
                const payload = await fetchPage(nextPage);
                maxTotalPages = Math.max(1, Number(payload.totalPages) || maxTotalPages);
                const batch = Array.isArray(payload.results) ? payload.results : [];
                const filteredBatch = filterDiscoverBrowseItems(batch, filterOptionsRef.current || {});
                mergedBatch = mergeDiscoverResults(mergedBatch, filteredBatch);
                lastPage = payload.lastFetchedPage ?? nextPage;
                if (lastPage >= maxTotalPages) break;
            }

            setResults((prev) => mergeDiscoverResults(prev, mergedBatch));
            setLoadedPage(lastPage);
            setTotalPages(maxTotalPages);
            prefetchRef.current = null;
            void prefetchNextBatch(lastPage + 1, maxTotalPages);
            void enrichDiscoverBrowseRows(mergedBatch).then((enrichedBatch) => {
                if (fetchingRef.current) return;
                setResults((prev) => mergeDiscoverResults(prev, enrichedBatch));
            }).catch(() => {});
        } catch (e) {
            console.error(e);
            setLoadedPage(totalPages);
        } finally {
            fetchingRef.current = false;
            setLoadingMore(false);
        }
    }, [fetchPage, hasMore, loadedPage, loading, loadingMore, prefetchNextBatch, totalPages]);

    useEffect(() => {
        if (loading || loadingMore || !hasMore) return undefined;
        const node = sentinelRef.current;
        if (!node) return undefined;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    loadNextPage();
                }
            },
            { root: null, rootMargin: '600px 0px 400px 0px', threshold: 0.01 },
        );

        observer.observe(node);
        return () => observer.disconnect();
    }, [hasMore, loadNextPage, loading, loadingMore, results.length]);

    return {
        results,
        loading,
        loadingMore,
        hasMore,
        sentinelRef,
    };
}
