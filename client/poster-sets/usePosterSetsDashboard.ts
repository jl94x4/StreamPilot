import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pushToast, type ToastMessage } from '../shared/toast';
import { usePoll } from '../shared/usePoll';
import { askConfirm } from '../shared/confirm';
import {
    internalTabFromUrl,
    normalizePosterLocation,
    parsePosterSetsUrl,
    urlStateFromInternalTab,
    writePosterSetsUrl,
    type DiscoverView,
} from './urlState';
import {
    capturePortalScroll,
    restorePortalScroll,
    scheduleScrollRestore,
    type PortalScrollSnapshot,
} from './shared/posterSetsScroll';
import {
    upgraderPosterGridClass,
    type PosterGridValue,
} from '../shared/portalLayout';
import { posterSetsApi } from './api';
import { addWatchWithTitleReplaceConfirm } from './pinWatch';
import { isPosterSetsUpstreamOutage } from './upstreamErrors';
import {
    DEFAULT_POSTER_SETS_CONFIG,
    mediuxFiltersFromAssets,
    type PosterSetsAuditEntry,
    type PosterSetsBrowseRail,
    type PosterSetsBrowseResponse,
    type PosterSetsCollectionGroup,
    type PosterSetsCollectionsResponse,
    type PosterSetsConfig,
    type PosterSetsJob,
    type PosterSetsPreview,
    type PosterSetsPreviewAsset,
    type PosterSetsQueueStats,
    type PosterSetsSearchSet,
    type PosterSetsSearchTitle,
    type PosterSetsSetMeta,
    type PosterSetsStatus,
    type PosterSetsWatch,
    type PosterSetsWatchStats,
} from './types';
import { groupPosterSetsWatchesByCategory } from './watchGroups';
import type { RecentSetCategory } from './shared/posterSetsRecent';
import { excludeBlockedCreators, prioritizeSetsByFollowedCreators } from './prioritizeCreatorSets';
import { classifyPreviewAsset, groupPreviewAssets, inspectorThumbsFromAssets } from './previewGroups';
import { pickAutoMatchedTitle, rankSearchTitlesForLibraryItem } from './autoMatchTitle';
import { fetchPosterSetsForTitle } from './fetchPosterSetsForTitle';
import {
    defaultSearchProvider,
    isMediuxEnabled,
    isTpdbEnabled,
    isTpdbSearchEnabled,
} from './shared/posterSetsNav';
import {
    clearLibraryRecentCache,
    readLibraryRecentCache,
    readLibrarySearchCache,
    writeLibraryRecentCache,
    writeLibrarySearchCache,
} from './libraryCache';
import {
    libraryItemToSearchTitle,
    normalizeLibraryItems,
    type LibraryRecentItem,
} from './libraryRecent';
import {
    ALL_MEDIUX_FILTER_IDS,
    DEFAULT_POSTER_SETS_GRID_SIZE,
    DISCOVER_SUB_NAV,
    POSTER_SETS_GRID_STORAGE_KEY,
    POSTER_SETS_LIBRARY_DETAIL_LAYOUT_KEY,
    posterSetsLandscapeGridStyle,
    posterSetsPosterGridStyle,
    readStoredPosterSetsGridSize,
    SEARCH_SETS_PAGE_SIZE,
    SEARCH_SETS_PAGE_SIZE_STORAGE_KEY,
    TITLE_CARD_ONLY_FILTERS,
    normalizeSearchSetsPageSize,
    browseRailsCache,
    buildSetUrl,
    bulkEntryFromSet,
    classifyRecentSet,
    formatSetLabel,
    formatTime,
    inferRecentSetKindFromAssets,
    inferRecentSetKindFromFilters,
    isBackgroundSet,
    isExclusiveTitleCardSet,
    isTitleCardSet,
    jobLogLines,
    jobSetMeta,
    jobTitle,
    listToText,
    MAX_RECENT_SETS,
    normalizeLibraryDetailLayout,
    normalizeRecentSetKind,
    parseSetRef,
    parseTpdbUserHandle,
    isTpdbRecentUrl,
    isTpdbFeedUrl,
    readRecentSets,
    readRemovedRecentSetUrls,
    textToList,
    upsertRecentSet,
    type BulkSetSelection,
    type HistoryFilter,
    type PrimaryTabId,
    type RecentSetCategory,
    type RecentSetChip,
    type SearchProvider,
    type SetProvider,
    type TabId,
} from './shared';
import {
    inferPreviewMediaType,
    isTpdbDiscoverCatalogContext,
    normalizeRelatedTitle,
    pickBestRelatedTitle,
    relatedSetKey,
    shouldShowSearchSetGrid,
} from './posterSetsDashboardUtils';

/** Provider-only state hook. Views must use `usePosterSetsDashboard` from PosterSetsDashboardContext. */
export function usePosterSetsDashboardState() {
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const toast = useCallback((message: string, type: ToastMessage['type'] = 'success') => {
        setToasts((current) => pushToast(current, message, type));
    }, []);

    const initialUrlState = useMemo(
        () => (typeof window !== 'undefined'
            ? parsePosterSetsUrl()
            : urlStateFromInternalTab('library')),
        [],
    );
    const initialLocation = useMemo(
        () => ({
            ...initialUrlState,
            tab: internalTabFromUrl(initialUrlState),
        }),
        [initialUrlState],
    );
    const [tab, setTab] = useState<TabId>(initialLocation.tab);
    const [libraryDetailItem, setLibraryDetailItem] = useState<LibraryRecentItem | null>(null);
    const [libraryViewMode, setLibraryViewMode] = useState<'recent' | 'browse'>('recent');
    const [busy, setBusy] = useState<string | null>(null);
    const [status, setStatus] = useState<PosterSetsStatus | null>(null);
    const [configDraft, setConfigDraft] = useState<PosterSetsConfig>(DEFAULT_POSTER_SETS_CONFIG);
    const [tvText, setTvText] = useState(listToText(DEFAULT_POSTER_SETS_CONFIG.tv_library));
    const [movieText, setMovieText] = useState(listToText(DEFAULT_POSTER_SETS_CONFIG.movie_library));
    const [whitelistText, setWhitelistText] = useState(listToText(DEFAULT_POSTER_SETS_CONFIG.creatorWhitelist));
    const [blocklistText, setBlocklistText] = useState(listToText(DEFAULT_POSTER_SETS_CONFIG.creatorBlocklist || []));
    const [url, setUrl] = useState(initialLocation.setUrl || '');
    const [titleCardsOnly, setTitleCardsOnly] = useState(Boolean(initialLocation.titleCardsOnly));
    const [bulkText, setBulkText] = useState('');
    const [findProvider, setFindProvider] = useState<SetProvider>('mediux');
    const [findId, setFindId] = useState('');
    const [searchProvider, setSearchProvider] = useState<SearchProvider>('both');
    const [searchMode, setSearchMode] = useState<'title' | 'creator' | 'recent' | 'feed'>(
        initialLocation.tab === 'tpdb' ? 'recent' : (initialLocation.creator ? 'creator' : 'title'),
    );
    const [searchQuery, setSearchQuery] = useState(initialLocation.creator || '');
    const [searchTitles, setSearchTitles] = useState<PosterSetsSearchTitle[]>([]);
    const [searchSets, setSearchSets] = useState<PosterSetsSearchSet[]>([]);
    const [searchSetsPage, setSearchSetsPage] = useState(1);
    const [searchSetsPageSize, setSearchSetsPageSize] = useState(() => {
        if (typeof window === 'undefined') return SEARCH_SETS_PAGE_SIZE;
        return normalizeSearchSetsPageSize(window.localStorage.getItem(SEARCH_SETS_PAGE_SIZE_STORAGE_KEY));
    });
    const [searchLoadingMore, setSearchLoadingMore] = useState(false);
    const [searchContext, setSearchContext] = useState('');
    const [catalogError, setCatalogError] = useState('');
    const creatorSearchAbortRef = useRef<AbortController | null>(null);
    const catalogSearchGenRef = useRef(0);
    const searchModeRef = useRef(searchMode);
    searchModeRef.current = searchMode;
    const [selectedSearchTitle, setSelectedSearchTitle] = useState<PosterSetsSearchTitle | null>(null);
    const [selectedSearchSet, setSelectedSearchSet] = useState<PosterSetsSearchSet | null>(null);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [showInspectorAssets, setShowInspectorAssets] = useState(false);
    const previewPanelRef = useRef<HTMLDivElement | null>(null);
    const searchSetsSectionRef = useRef<HTMLDivElement | null>(null);
    const [recentTick, setRecentTick] = useState(0);
    const [gridSize, setGridSize] = useState<PosterGridValue>(() => readStoredPosterSetsGridSize());
    const [libraryDetailLayout, setLibraryDetailLayout] = useState(() => {
        if (typeof window === 'undefined') return normalizeLibraryDetailLayout('modal');
        return normalizeLibraryDetailLayout(window.localStorage.getItem(POSTER_SETS_LIBRARY_DETAIL_LAYOUT_KEY));
    });
    const [preview, setPreview] = useState<PosterSetsPreview | null>(null);
    const [relatedSets, setRelatedSets] = useState<PosterSetsSearchSet[]>([]);
    const [relatedSetsLoading, setRelatedSetsLoading] = useState(false);
    const relatedSetsAbortRef = useRef<AbortController | null>(null);
    const relatedSetsGenRef = useRef(0);
    const browseLoadGenRef = useRef(0);
    const queueLoadGenRef = useRef(0);
    const watchesLoadGenRef = useRef(0);
    const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
    const [activeJob, setActiveJob] = useState<PosterSetsJob | null>(null);
    const [testResult, setTestResult] = useState<string | null>(null);
    const [historyJobs, setHistoryJobs] = useState<PosterSetsJob[]>([]);
    const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
    const [historySearch, setHistorySearch] = useState('');
    const [selectedHistoryJob, setSelectedHistoryJob] = useState<PosterSetsJob | null>(null);
    const [selectedQueueJob, setSelectedQueueJob] = useState<PosterSetsJob | null>(null);
    const [auditEntries, setAuditEntries] = useState<PosterSetsAuditEntry[]>([]);
    const [queueJobs, setQueueJobs] = useState<PosterSetsJob[]>([]);
    const [queuePaused, setQueuePaused] = useState(false);
    const [queueStats, setQueueStats] = useState<PosterSetsQueueStats>({});
    const [watches, setWatches] = useState<PosterSetsWatch[]>([]);
    const [watchStatsState, setWatchStatsState] = useState<PosterSetsWatchStats>({});
    const [watchUrlDraft, setWatchUrlDraft] = useState('');
    const [watchesPage, setWatchesPage] = useState(1);
    const [watchesPageSize, setWatchesPageSize] = useState(12);
    const [watchesFilter, setWatchesFilter] = useState('');
    const [watchesCategoryFilter, setWatchesCategoryFilter] = useState<'all' | RecentSetCategory>('all');
    const [watchArtKindOverrides, setWatchArtKindOverrides] = useState<Record<string, RecentSetCategory>>({});
    const [selectedBulkSets, setSelectedBulkSets] = useState<Record<string, BulkSetSelection>>({});
    const [browseRails, setBrowseRails] = useState<PosterSetsBrowseRail[]>(() => browseRailsCache.rails);
    const browseRailsRef = useRef<PosterSetsBrowseRail[]>(browseRailsCache.rails);
    browseRailsRef.current = browseRails;
    const [browseLoading, setBrowseLoading] = useState(false);
    const [browseSeeAllId, setBrowseSeeAllId] = useState<string | null>(initialLocation.rail);
    const [collectionSets, setCollectionSets] = useState<PosterSetsSearchSet[]>([]);
    const collectionSetsRef = useRef<PosterSetsSearchSet[]>([]);
    collectionSetsRef.current = collectionSets;
    const [collectionGroups, setCollectionGroups] = useState<PosterSetsCollectionGroup[]>([]);
    const [collectionsLoading, setCollectionsLoading] = useState(false);
    const [collectionsError, setCollectionsError] = useState<string | null>(null);
    const [collectionsNeedsFollowers, setCollectionsNeedsFollowers] = useState(false);
    const collectionsLoadGenRef = useRef(0);
    const [libraryShows, setLibraryShows] = useState<LibraryRecentItem[]>([]);
    const [libraryMovies, setLibraryMovies] = useState<LibraryRecentItem[]>([]);
    const [libraryLoading, setLibraryLoading] = useState(false);
    const [libraryError, setLibraryError] = useState<string | null>(null);
    const [librarySearchQuery, setLibrarySearchQuery] = useState('');
    const [librarySearchResults, setLibrarySearchResults] = useState<LibraryRecentItem[]>([]);
    const [librarySearching, setLibrarySearching] = useState(false);
    const librarySearchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const libraryLoadGenRef = useRef(0);
    const scrollPreviewAfterLoadRef = useRef(false);
    const resultsScrollTopRef = useRef<PortalScrollSnapshot | null>(null);
    const libraryListScrollRef = useRef<PortalScrollSnapshot | null>(null);
    const syncedSetUrlRef = useRef<string | null>(initialLocation.setUrl);
    const titleCardsOnlyRef = useRef(Boolean(initialLocation.titleCardsOnly));
    const deepLinkHandledRef = useRef(false);
    const runApplyRef = useRef<(selectedOnly?: boolean, overrideUrl?: string) => Promise<void>>(async () => {});
    const openCreatorCatalogRef = useRef<(username: string, options?: { skipUrl?: boolean; locationTab?: 'paste' | 'apply' }) => void>(() => {});
    const openTpdbRecentCatalogRef = useRef<(options?: { skipUrl?: boolean; locationTab?: 'paste' | 'tpdb'; refresh?: boolean; kind?: 'recent' | 'feed' }) => void>(() => {});

    const loadHistory = useCallback(async () => {
        try {
            const response = await posterSetsApi.jobs();
            setHistoryJobs(response.jobs || []);
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to load job history', 'error');
        }
    }, [toast]);

    const loadAudit = useCallback(async () => {
        try {
            const response = await posterSetsApi.audit();
            setAuditEntries(response.entries || []);
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to load audit log', 'error');
        }
    }, [toast]);

    const loadQueue = useCallback(async () => {
        const gen = ++queueLoadGenRef.current;
        try {
            const response = await posterSetsApi.queue();
            if (gen !== queueLoadGenRef.current) return;
            setQueueJobs(response.jobs || []);
            setQueuePaused(Boolean(response.paused));
            setQueueStats(response.stats || {});
        } catch (error) {
            if (gen !== queueLoadGenRef.current) return;
            toast(error instanceof Error ? error.message : 'Failed to load queue', 'error');
        }
    }, [toast]);

    const loadWatches = useCallback(async () => {
        const gen = ++watchesLoadGenRef.current;
        try {
            const response = await posterSetsApi.watches();
            if (gen !== watchesLoadGenRef.current) return;
            setWatches(response.watches || []);
            setWatchStatsState(response.stats || {});
        } catch (error) {
            if (gen !== watchesLoadGenRef.current) return;
            toast(error instanceof Error ? error.message : 'Failed to load watches', 'error');
        }
    }, [toast]);

    const loadLibraryRecent = useCallback(async (options?: { silent?: boolean; refresh?: boolean }) => {
        const requestId = ++libraryLoadGenRef.current;
        setLibraryError(null);

        if (options?.refresh) {
            clearLibraryRecentCache();
        }

        const cached = !options?.refresh ? readLibraryRecentCache() : null;
        if (cached) {
            setLibraryMovies(cached.movies);
            setLibraryShows(cached.shows);
        }

        const silent = options?.silent || !!cached;
        if (!silent) setLibraryLoading(true);

        try {
            const response = await posterSetsApi.libraryRecent(120, { refresh: options?.refresh });
            if (requestId !== libraryLoadGenRef.current) return;
            const movies = normalizeLibraryItems(response.movies || []);
            const shows = normalizeLibraryItems(response.shows || []);
            const merged = normalizeLibraryItems(response.items || []);
            const movieList = movies.length ? movies : merged.filter((item) => item.mediaType === 'movie');
            const showList = shows.length ? shows : merged.filter((item) => item.mediaType === 'show');
            setLibraryMovies(movieList);
            setLibraryShows(showList);
            writeLibraryRecentCache({ movies: movieList, shows: showList });
        } catch (error) {
            if (requestId !== libraryLoadGenRef.current) return;
            const message = error instanceof Error ? error.message : 'Failed to load recently added library items';
            setLibraryError(message);
            if (!silent) toast(message, 'error');
        } finally {
            if (requestId === libraryLoadGenRef.current) {
                setLibraryLoading(false);
            }
        }
    }, [toast]);

    const runLibrarySearch = useCallback(async (query: string, options?: { refresh?: boolean }) => {
        const q = String(query || '').trim();
        if (!q) {
            setLibrarySearchResults([]);
            setLibrarySearching(false);
            return;
        }

        const cached = !options?.refresh ? readLibrarySearchCache(q) : null;
        if (cached?.length) {
            setLibrarySearchResults(cached);
        }

        const silent = !!cached?.length;
        if (!silent) setLibrarySearching(true);
        setLibraryError(null);
        try {
            const response = await posterSetsApi.librarySearch(q, 48, { refresh: options?.refresh });
            const results = normalizeLibraryItems(response.results || []);
            setLibrarySearchResults(results);
            writeLibrarySearchCache(q, results);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Library search failed';
            setLibraryError(message);
            if (!silent) toast(message, 'error');
            if (!cached?.length) setLibrarySearchResults([]);
        } finally {
            setLibrarySearching(false);
        }
    }, [toast]);

    const loadBrowse = useCallback(async (options?: { refresh?: boolean; silent?: boolean }) => {
        const hasCachedRails = browseRailsRef.current.length > 0;
        const silent = Boolean(options?.silent || (hasCachedRails && !options?.refresh));
        const requestId = ++browseLoadGenRef.current;
        if (!silent) setBrowseLoading(true);
        try {
            const response: PosterSetsBrowseResponse = await posterSetsApi.browse({ refresh: options?.refresh });
            if (requestId !== browseLoadGenRef.current) return;
            const nextRails = response.rails || [];
            const prevRails = browseRailsRef.current;
            // Don't let an empty in-flight snapshot wipe cards we already have.
            const merged = nextRails.map((rail) => {
                const prev = prevRails.find((entry) => entry.id === rail.id);
                if (
                    prev?.sets?.length
                    && !(rail.sets?.length)
                    && (rail.loading || options?.refresh)
                ) {
                    return {
                        ...rail,
                        sets: prev.sets,
                        buffered: prev.sets.length,
                    };
                }
                return rail;
            });
            const applied = merged.length ? merged : (prevRails.length && !options?.refresh ? prevRails : nextRails);
            setBrowseRails(applied);
            browseRailsCache.rails = applied;
        } catch (error) {
            if (requestId !== browseLoadGenRef.current) return;
            if (!silent) {
                toast(error instanceof Error ? error.message : 'Failed to load browse rails', 'error');
            }
        } finally {
            if (requestId === browseLoadGenRef.current && !silent) setBrowseLoading(false);
        }
    }, [toast]);

    const loadCollections = useCallback(async (options?: { refresh?: boolean; silent?: boolean }) => {
        const hasCached = collectionSetsRef.current.length > 0;
        const silent = Boolean(options?.silent || (hasCached && !options?.refresh));
        const requestId = ++collectionsLoadGenRef.current;
        if (!silent) setCollectionsLoading(true);
        try {
            const response: PosterSetsCollectionsResponse = await posterSetsApi.collections({
                refresh: options?.refresh,
            });
            if (requestId !== collectionsLoadGenRef.current) return;
            const nextSets = Array.isArray(response.sets) ? response.sets : [];
            const prevSets = collectionSetsRef.current;
            const keepPrev = Boolean(
                prevSets.length
                && !nextSets.length
                && (response.loading || options?.refresh)
                && !response.needsFollowers
            );
            if (!keepPrev) {
                setCollectionSets(nextSets);
                setCollectionGroups(Array.isArray(response.groups) ? response.groups : []);
            }
            setCollectionsError(response.error || null);
            setCollectionsNeedsFollowers(Boolean(response.needsFollowers));
            setCollectionsLoading(Boolean(response.loading));
        } catch (error) {
            if (requestId !== collectionsLoadGenRef.current) return;
            setCollectionsLoading(false);
            if (!silent) {
                toast(error instanceof Error ? error.message : 'Failed to load collection sets', 'error');
            }
        }
    }, [toast]);

    /** Collapse the inline set inspector without wiping search/browse results. */
    const collapseSetInspector = useCallback((options?: { scrollToSets?: boolean }) => {
        const saved = resultsScrollTopRef.current ?? capturePortalScroll();
        setPreview(null);
        setSelectedSearchSet(null);
        setSelectedAssetIds([]);
        setShowInspectorAssets(false);
        setTitleCardsOnly(false);
        titleCardsOnlyRef.current = false;
        const creator = searchMode === 'creator' ? String(searchQuery || '').trim().replace(/^@+/, '') || null : null;
        if (tab === 'paste') {
            const userUrl = creator
                ? `https://theposterdb.com/user/${encodeURIComponent(creator)}`
                : (searchMode === 'feed'
                    ? 'https://theposterdb.com/feed'
                    : (searchMode === 'recent' ? 'https://theposterdb.com/recent' : null));
            syncedSetUrlRef.current = userUrl;
            if (userUrl) setUrl(userUrl);
            writePosterSetsUrl(normalizePosterLocation({
                tab: 'paste',
                rail: null,
                setUrl: userUrl,
                creator: null,
                titleCardsOnly: false,
            }), 'replace', { restoreScroll: saved });
        } else {
            syncedSetUrlRef.current = null;
            writePosterSetsUrl(normalizePosterLocation({
                tab: tab === 'browse' ? 'browse' : tab === 'collections' ? 'collections' : tab === 'tpdb' ? 'tpdb' : 'apply',
                rail: tab === 'browse' ? browseSeeAllId : null,
                setUrl: null,
                creator: tab === 'apply' ? creator : null,
                titleCardsOnly: false,
            }), 'replace', { restoreScroll: saved });
        }
        if (options?.scrollToSets !== false) {
            requestAnimationFrame(() => {
                searchSetsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        } else {
            scheduleScrollRestore(() => restorePortalScroll(saved), { frames: 3, delays: [0, 50, 160, 400] });
        }
    }, [browseSeeAllId, searchMode, searchQuery, tab]);

    const dismissPreviewToSearch = collapseSetInspector;

    const invalidateCatalogSearch = useCallback(() => {
        catalogSearchGenRef.current += 1;
        creatorSearchAbortRef.current?.abort();
        creatorSearchAbortRef.current = null;
    }, []);

    const resetSearchCatalogUi = useCallback(() => {
        invalidateCatalogSearch();
        setSearchTitles([]);
        setSearchSets([]);
        setSearchSetsPage(1);
        setSearchLoadingMore(false);
        setSearchContext('');
        setCatalogError('');
        setSelectedSearchTitle(null);
        setSelectedSearchSet(null);
        setPreview(null);
        setShowInspectorAssets(false);
        setBusy((current) => (current === 'search' ? null : current));
    }, [invalidateCatalogSearch]);

    const pushPosterLocation = useCallback((next: Parameters<typeof normalizePosterLocation>[0], mode: 'push' | 'replace' = 'push') => {
        const state = normalizePosterLocation(next);
        const internal = internalTabFromUrl(state);
        syncedSetUrlRef.current = (internal === 'apply' || internal === 'paste') ? state.setUrl : null;
        const nextTitleCards = Boolean(
            (internal === 'apply' || internal === 'paste') && state.titleCardsOnly && state.setUrl,
        );
        titleCardsOnlyRef.current = nextTitleCards;
        setTitleCardsOnly(nextTitleCards);
        writePosterSetsUrl(state, mode);
    }, []);

    const goToTab = useCallback((id: TabId, options?: { rail?: string | null; mode?: 'push' | 'replace' }) => {
        if (id !== tab) {
            setPreview(null);
            setSelectedSearchSet(null);
            setSelectedAssetIds([]);
            setShowInspectorAssets(false);
        }
        setLibraryDetailItem(null);
        setTab(id);
        const rail = id === 'browse' ? (options?.rail !== undefined ? options.rail : null) : null;
        if (id === 'browse') setBrowseSeeAllId(rail);
        else setBrowseSeeAllId(null);
        if (id !== 'apply') {
            syncedSetUrlRef.current = null;
            titleCardsOnlyRef.current = false;
            setTitleCardsOnly(false);
        }
        pushPosterLocation({
            tab: id,
            rail,
            setUrl: null,
            creator: null,
            titleCardsOnly: false,
        }, options?.mode || 'push');
        if (id === 'apply') {
            const mode = searchModeRef.current;
            if (mode === 'recent' || mode === 'feed') {
                resetSearchCatalogUi();
                setSearchMode('title');
            }
        }
        if (id === 'history') {
            void loadHistory();
            void loadAudit();
            if (historyFilter !== 'audit') setHistoryFilter('audit');
        }
        if (id === 'queue') void loadQueue();
        if (id === 'watches') void loadWatches();
        if (id === 'browse') void loadBrowse({ silent: browseRailsRef.current.length > 0 });
        if (id === 'library') void loadLibraryRecent({ silent: libraryShows.length > 0 || libraryMovies.length > 0 });
        if (id === 'collections') void loadCollections({ silent: collectionSetsRef.current.length > 0 });
        if (id === 'tpdb') {
            queueMicrotask(() => openTpdbRecentCatalogRef.current({ skipUrl: true }));
        }
    }, [historyFilter, loadAudit, loadBrowse, loadCollections, loadHistory, loadLibraryRecent, loadQueue, loadWatches, libraryMovies.length, libraryShows.length, pushPosterLocation, resetSearchCatalogUi, setHistoryFilter, tab]);

    const goToPrimaryTab = useCallback((id: PrimaryTabId, options?: { mode?: 'push' | 'replace' }) => {
        if (id === 'discover') {
            goToTab('apply', options);
            return;
        }
        if (id === 'logs') {
            goToTab('history', options);
            return;
        }
        goToTab(id, options);
    }, [goToTab]);

    const goToDiscoverView = useCallback((view: DiscoverView, options?: { rail?: string | null; mode?: 'push' | 'replace' }) => {
        const internal: TabId = view === 'browse'
            ? 'browse'
            : view === 'recent'
                ? 'recent'
                : view === 'tpdb'
                    ? 'tpdb'
                    : 'apply';
        goToTab(internal, options);
    }, [goToTab]);

    const openBrowseRail = useCallback((railId: string | null) => {
        setTab('browse');
        setBrowseSeeAllId(railId);
        pushPosterLocation({
            tab: 'browse',
            rail: railId,
            setUrl: null,
            creator: null,
            titleCardsOnly: false,
        }, 'push');
    }, [pushPosterLocation]);

    const currentSetMeta = useCallback((): PosterSetsSetMeta | null => {
        if (selectedSearchSet || preview?.setMeta) {
            const previewMeta = preview?.setMeta as PosterSetsSetMeta | undefined;
            const selected = selectedAssetIds.length && preview?.assets?.length
                ? preview.assets.filter((asset) => selectedAssetIds.includes(asset.id))
                : [];
            const mediuxFilters = selected.length
                ? mediuxFiltersFromAssets(selected)
                : (titleCardsOnly ? TITLE_CARD_ONLY_FILTERS : undefined);
            const setKind = inferRecentSetKindFromFilters(mediuxFilters)
                || normalizeRecentSetKind(selectedSearchSet?.setKind)
                || normalizeRecentSetKind(previewMeta?.setKind)
                || (titleCardsOnly || isExclusiveTitleCardSet(selectedSearchSet) ? 'title_cards' : null)
                || inferRecentSetKindFromAssets(preview?.assets)
                || null;
            return {
                provider: selectedSearchSet?.provider || previewMeta?.provider || null,
                setId: selectedSearchSet?.setId || previewMeta?.setId || null,
                url: selectedSearchSet?.url || previewMeta?.url || url || null,
                // Prefer scraped show/movie name over search card labels like "Season 3".
                title: previewMeta?.title || selectedSearchSet?.title || null,
                user: previewMeta?.user || selectedSearchSet?.user || null,
                thumbUrl: selectedSearchSet?.thumbUrl || previewMeta?.thumbUrl || '',
                assetCount: selectedSearchSet?.posterCount
                    ?? preview?.total
                    ?? previewMeta?.assetCount
                    ?? null,
                setKind,
                mediuxFilters: mediuxFilters?.length ? mediuxFilters : undefined,
            };
        }
        return url ? {
            url,
            title: null,
            user: null,
            thumbUrl: '',
            setKind: titleCardsOnly ? 'title_cards' : null,
            mediuxFilters: titleCardsOnly ? TITLE_CARD_ONLY_FILTERS : undefined,
        } : null;
    }, [preview, selectedAssetIds, selectedSearchSet, titleCardsOnly, url]);

    const rememberRecentFromContext = useCallback((
        meta: PosterSetsSetMeta | null | undefined,
        fallbackUrl?: string,
        extra?: { mediuxFilters?: string[] | null },
    ) => {
        upsertRecentSet(meta, fallbackUrl, {
            setKind: meta?.setKind || (titleCardsOnly ? 'title_cards' : null),
            assets: preview?.assets,
            mediuxFilters: extra?.mediuxFilters
                || (titleCardsOnly ? TITLE_CARD_ONLY_FILTERS : undefined),
        });
        setRecentTick((value) => value + 1);
    }, [preview?.assets, titleCardsOnly]);

    const load = useCallback(async () => {
        try {
            const [nextStatus, configResponse] = await Promise.all([
                posterSetsApi.status(),
                posterSetsApi.getConfig(),
            ]);
            setStatus(nextStatus);
            if (nextStatus.queue) setQueueStats(nextStatus.queue);
            const cfg = configResponse.config || DEFAULT_POSTER_SETS_CONFIG;
            setConfigDraft({
                ...DEFAULT_POSTER_SETS_CONFIG,
                ...cfg,
                token: cfg.hasToken ? '********' : '',
                tpdb_password: cfg.hasTpdbPassword ? '********' : '',
            });
            setTvText(listToText(cfg.tv_library));
            setMovieText(listToText(cfg.movie_library));
            setWhitelistText(listToText(cfg.creatorWhitelist));
            setBlocklistText(listToText(cfg.creatorBlocklist));
            await loadHistory();
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to load Poster Sets', 'error');
        }
    }, [loadHistory, toast]);

    useEffect(() => {
        const tpdbSearch = isTpdbSearchEnabled(configDraft);
        const mediux = isMediuxEnabled(configDraft);
        const nextSearch = defaultSearchProvider(configDraft);
        if (searchProvider === 'both' && (!tpdbSearch || !mediux)) setSearchProvider(nextSearch);
        else if (searchProvider === 'posterdb' && !tpdbSearch) setSearchProvider(nextSearch);
        else if (searchProvider === 'mediux' && !mediux) setSearchProvider(nextSearch);
        if (findProvider === 'posterdb' && !isTpdbEnabled(configDraft) && mediux) setFindProvider('mediux');
        if (findProvider === 'mediux' && !mediux && isTpdbEnabled(configDraft)) setFindProvider('posterdb');
        if (tab === 'tpdb' && !tpdbSearch) setTab('apply');
    }, [configDraft.tpdbEnabled, configDraft.tpdbSearchEnabled, configDraft.mediuxEnabled, findProvider, searchProvider, tab]);

    useEffect(() => { void load(); }, [load]);
    useEffect(() => { void loadQueue(); }, [loadQueue]);
    useEffect(() => { void loadWatches(); }, [loadWatches]);

    usePoll(() => { void loadQueue(); }, (tab === 'queue' || queueStats.pending) ? 2000 : null, { immediate: false });

    usePoll(() => { void loadWatches(); }, tab === 'watches' ? 8000 : null, { immediate: false });

    useEffect(() => {
        if (tab !== 'browse') return undefined;
        void loadBrowse({ silent: browseRailsRef.current.length > 0 });
        return undefined;
    }, [tab, loadBrowse]);

    useEffect(() => {
        if (tab !== 'collections') return undefined;
        void loadCollections({ silent: collectionSetsRef.current.length > 0 });
        return undefined;
    }, [tab, loadCollections]);

    useEffect(() => {
        if (tab !== 'library' || !status) return undefined;
        void loadLibraryRecent({ silent: libraryShows.length > 0 || libraryMovies.length > 0 });
        return undefined;
    }, [tab, status, libraryMovies.length, libraryShows.length, loadLibraryRecent]);

    useEffect(() => {
        if (tab !== 'library') return undefined;
        if (librarySearchDebounceRef.current) {
            clearTimeout(librarySearchDebounceRef.current);
            librarySearchDebounceRef.current = null;
        }
        const q = librarySearchQuery.trim();
        if (q.length < 2) {
            setLibrarySearchResults([]);
            setLibrarySearching(false);
            return undefined;
        }
        librarySearchDebounceRef.current = setTimeout(() => {
            void runLibrarySearch(q);
        }, 350);
        return () => {
            if (librarySearchDebounceRef.current) {
                clearTimeout(librarySearchDebounceRef.current);
                librarySearchDebounceRef.current = null;
            }
        };
    }, [librarySearchQuery, runLibrarySearch, tab]);

    usePoll(() => { void loadBrowse({ silent: true }); }, (tab === 'browse' && browseRails.some((rail) => rail.loading)) ? 4000 : null, { immediate: false });
    usePoll(() => { void loadCollections({ silent: true }); }, (tab === 'collections' && collectionsLoading) ? 1500 : null, { immediate: false });

    usePoll(async () => {
        if (!activeJob?.id || !['running', 'queued'].includes(String(activeJob.state || ''))) return;
        try {
            const response = await posterSetsApi.job(activeJob.id);
            setActiveJob(response.job);
            const state = String(response.job.state || '').toLowerCase();
            if (state && state !== 'running' && state !== 'queued') {
                const meta = jobSetMeta(response.job);
                if (meta?.thumbUrl || meta?.title) {
                    rememberRecentFromContext(meta, response.job.input?.url, {
                        mediuxFilters: response.job.input?.mediuxFilters,
                    });
                }
                await load();
                await loadHistory();
                await loadQueue();
                await loadWatches();
                if (state === 'succeeded' || state === 'completed' || state === 'success') {
                    if (
                        configDraft.autoWatchOnApply !== false
                        && response.job.input?.url
                        && !response.job.input?.watchId
                    ) {
                        toast('Watching for new posters on this set.');
                    }
                }
            }
        } catch {
            // keep polling until terminal or user leaves
        }
    }, (activeJob?.id && ['running', 'queued'].includes(String(activeJob.state || ''))) ? 1500 : null, { immediate: false });

    usePoll(async () => {
        if (tab !== 'history') return;
        const hasRunning = historyJobs.some((job) => ['running', 'queued'].includes(String(job.state || '')))
            || ['running', 'queued'].includes(String(selectedHistoryJob?.state || ''));
        if (!hasRunning) return;
        try {
            await loadHistory();
            if (selectedHistoryJob?.id) {
                const response = await posterSetsApi.job(selectedHistoryJob.id);
                setSelectedHistoryJob(response.job);
            }
        } catch {
            // ignore transient poll errors
        }
    }, (tab === 'history' && (historyJobs.some((job) => ['running', 'queued'].includes(String(job.state || '')))
        || ['running', 'queued'].includes(String(selectedHistoryJob?.state || '')))) ? 2000 : null, { immediate: false });

    usePoll(async () => {
        if (!selectedQueueJob?.id) return;
        const state = String(selectedQueueJob.state || '').toLowerCase();
        if (!['running', 'queued'].includes(state)) return;
        try {
            const response = await posterSetsApi.job(selectedQueueJob.id);
            setSelectedQueueJob(response.job);
            await loadQueue();
        } catch {
            // ignore transient poll errors
        }
    }, (selectedQueueJob?.id && ['running', 'queued'].includes(String(selectedQueueJob.state || ''))) ? 2000 : null, { immediate: false });

    const openHistoryJob = async (jobId: string) => {
        try {
            const response = await posterSetsApi.job(jobId);
            setSelectedHistoryJob(response.job);
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to open job', 'error');
        }
    };

    const openQueueJob = async (jobId: string) => {
        try {
            const response = await posterSetsApi.job(jobId);
            setSelectedQueueJob(response.job);
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to open job', 'error');
        }
    };

    const saveCreatorsConfig = async (partial: Partial<PosterSetsConfig>) => {
        setBusy('save');
        try {
            const fromPartial = Array.isArray(partial.creatorWhitelist)
                ? partial.creatorWhitelist.map((item) => String(item || '').trim().replace(/^@+/, '')).filter(Boolean)
                : null;
            const creatorWhitelist = fromPartial
                || textToList(whitelistText).map((item) => item.replace(/^@+/, ''));
            const fromPartialBlock = Array.isArray(partial.creatorBlocklist)
                ? partial.creatorBlocklist.map((item) => String(item || '').trim().replace(/^@+/, '')).filter(Boolean)
                : null;
            const creatorBlocklist = fromPartialBlock
                || textToList(blocklistText).map((item) => item.replace(/^@+/, ''));
            const response = await posterSetsApi.saveConfig({
                ...configDraft,
                tv_library: textToList(tvText),
                movie_library: textToList(movieText),
                token: configDraft.token === '********' ? undefined : configDraft.token,
                tpdb_password: configDraft.tpdb_password === '********' ? undefined : configDraft.tpdb_password,
                ...partial,
                creatorWhitelist,
                creatorBlocklist,
            });
            setConfigDraft({
                ...response.config,
                token: response.config.hasToken ? '********' : '',
                tpdb_password: response.config.hasTpdbPassword ? '********' : '',
            });
            setWhitelistText(listToText(response.config.creatorWhitelist));
            setBlocklistText(listToText(response.config.creatorBlocklist));
            void loadBrowse({ refresh: true, silent: true });
            void loadCollections({ refresh: true, silent: true });
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to save creators', 'error');
            throw error;
        } finally {
            setBusy(null);
        }
    };

    const blockCreator = async (handle: string) => {
        const name = String(handle || '').trim().replace(/^@+/, '');
        if (!name) return;
        const follow = (configDraft.creatorWhitelist || [])
            .map((item) => String(item || '').trim().replace(/^@+/, ''))
            .filter((item) => item && item.toLowerCase() !== name.toLowerCase());
        const blocked = [
            ...(configDraft.creatorBlocklist || [])
                .map((item) => String(item || '').trim().replace(/^@+/, ''))
                .filter((item) => item && item.toLowerCase() !== name.toLowerCase()),
            name,
        ];
        await saveCreatorsConfig({ creatorWhitelist: follow, creatorBlocklist: blocked });
        toast(`Blocked @${name} — their sets are hidden and will not be cached.`);
    };

    const saveSettings = async () => {
        setBusy('save');
        try {
            const prevWhitelist = textToList(listToText(configDraft.creatorWhitelist || []))
                .map((item) => item.replace(/^@+/, '').toLowerCase())
                .sort()
                .join('|');
            const payload = {
                ...configDraft,
                tv_library: textToList(tvText),
                movie_library: textToList(movieText),
                creatorWhitelist: textToList(whitelistText).map((item) => item.replace(/^@+/, '')),
                creatorBlocklist: textToList(blocklistText).map((item) => item.replace(/^@+/, '')),
                token: configDraft.token === '********' ? undefined : configDraft.token,
                tpdb_password: configDraft.tpdb_password === '********' ? undefined : configDraft.tpdb_password,
            };
            const nextWhitelist = (payload.creatorWhitelist || [])
                .map((item) => String(item).replace(/^@+/, '').toLowerCase())
                .sort()
                .join('|');
            const response = await posterSetsApi.saveConfig(payload);
            setConfigDraft({
                ...response.config,
                token: response.config.hasToken ? '********' : '',
                tpdb_password: response.config.hasTpdbPassword ? '********' : '',
            });
            setTvText(listToText(response.config.tv_library));
            setMovieText(listToText(response.config.movie_library));
            setWhitelistText(listToText(response.config.creatorWhitelist));
            setBlocklistText(listToText(response.config.creatorBlocklist));
            toast('Poster Sets settings saved.');
            await load();
            // Only hard-refresh Browse when followed creators changed; otherwise keep durable cache.
            void loadBrowse({
                refresh: prevWhitelist !== nextWhitelist,
                silent: true,
            });
            void loadCollections({
                refresh: prevWhitelist !== nextWhitelist,
                silent: true,
            });
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to save settings', 'error');
        } finally {
            setBusy(null);
        }
    };

    const importFromPortal = async () => {
        setBusy('import');
        setTestResult(null);
        try {
            const response = await posterSetsApi.importPortal();
            const cfg = response.config;
            setConfigDraft({
                ...DEFAULT_POSTER_SETS_CONFIG,
                ...cfg,
                token: cfg.hasToken ? '********' : '',
                tpdb_password: cfg.hasTpdbPassword ? '********' : '',
            });
            setTvText(listToText(cfg.tv_library));
            setMovieText(listToText(cfg.movie_library));
            setWhitelistText(listToText(cfg.creatorWhitelist));
            setBlocklistText(listToText(cfg.creatorBlocklist));
            const tvCount = response.imported?.tv_library?.length || 0;
            const movieCount = response.imported?.movie_library?.length || 0;
            toast(`Imported libraries from Media Player (${tvCount} TV, ${movieCount} movie).`);
            await load();
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Import failed', 'error');
        } finally {
            setBusy(null);
        }
    };

    const runTest = async () => {
        setBusy('test');
        setTestResult(null);
        try {
            const response = await posterSetsApi.test({
                ...configDraft,
                tv_library: textToList(tvText),
                movie_library: textToList(movieText),
                token: configDraft.token === '********' ? undefined : configDraft.token,
                tpdb_password: configDraft.tpdb_password === '********' ? undefined : configDraft.tpdb_password,
            });
            const libraries = [
                ...(response.tvLibraries || []).map((name) => `TV: ${name}`),
                ...(response.movieLibraries || []).map((name) => `Movie: ${name}`),
            ];
            const tpdbLine = response.tpdb?.ok
                ? (response.tpdb.warning
                    ? `ThePosterDB login OK. ${response.tpdb.warning}`
                    : (response.tpdb.via === 'saved-session'
                        ? 'ThePosterDB session OK (saved cookies).'
                        : 'ThePosterDB login OK.'))
                : response.tpdb?.error
                    ? `ThePosterDB: ${response.tpdb.error}`
                    : '';
            const message = response.ok
                ? [
                    `Connected${response.server ? ` to ${response.server}` : ''}. ${libraries.join(' · ') || 'No matched libraries.'}`,
                    tpdbLine,
                ].filter(Boolean).join(' ')
                : (response.error || 'Connection test failed');
            setTestResult(message);
            toast(message, response.ok ? 'success' : 'error');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Connection test failed';
            setTestResult(message);
            toast(message, 'error');
        } finally {
            setBusy(null);
        }
    };

    const runPreview = async (overrideUrl?: string, options?: {
        scroll?: boolean;
        keepSearch?: boolean;
        titleCardsOnly?: boolean;
    }) => {
        const target = String(overrideUrl ?? url).trim();
        if (!target) {
            toast('Paste a MediUX or ThePosterDB set URL first.', 'error');
            return null;
        }
        if (overrideUrl) setUrl(target);
        const restrictTitleCards = options?.titleCardsOnly ?? titleCardsOnly;
        titleCardsOnlyRef.current = Boolean(restrictTitleCards);
        setTitleCardsOnly(Boolean(restrictTitleCards));
        setBusy('preview');
        setPreview(null);
        setRelatedSets([]);
        setRelatedSetsLoading(false);
        relatedSetsAbortRef.current?.abort();
        setSelectedAssetIds([]);
        try {
            const response = await posterSetsApi.preview(target, {
                mediuxFilters: restrictTitleCards ? TITLE_CARD_ONLY_FILTERS : undefined,
            });
            setPreview(response);
            const assets = response.assets || [];
            const matchedIds = assets.filter((asset) => asset.matched === true).map((asset) => asset.id);
            const defaults = matchedIds.length ? matchedIds : assets.map((asset) => asset.id);
            setSelectedAssetIds(defaults);
            upsertRecentSet(response.setMeta, target, {
                setKind: restrictTitleCards ? 'title_cards' : undefined,
                assets,
                mediuxFilters: restrictTitleCards ? TITLE_CARD_ONLY_FILTERS : undefined,
            });
            setRecentTick((value) => value + 1);
            const matched = response.matched ?? matchedIds.length;
            const total = response.total || assets.length;
            if (!total) {
                toast(restrictTitleCards
                    ? 'This title-card pack previewed with 0 title cards. The set may only contain covers/backgrounds, or MediUX changed the listing.'
                    : 'This set previewed with 0 assets. Check MediUX filters in Poster Sets settings (title cards may be off).', 'error');
            } else {
                const caching = /theposterdb\.com/i.test(target) && configDraft.tpdbLocalCacheEnabled === true
                    ? ' Caching this set for next time.'
                    : '';
                toast(restrictTitleCards
                    ? `Ready: ${matched} matched title cards · ${total} in pack.${caching}`
                    : `Ready: ${matched} matched in Plex · ${total} in set.${caching}`);
            }
            if (options?.scroll !== false) {
                window.setTimeout(() => {
                    previewPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 200);
            }
            if (!options?.keepSearch) {
                // Keep context for the ready card, but get titles out of the way.
                setSearchTitles([]);
            }
            return response;
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Preview failed', 'error');
            return null;
        } finally {
            setBusy(null);
        }
    };

    /** Expand a set inline and load preview without wiping search/browse results. */
    const expandSetInline = async (
        set: PosterSetsSearchSet,
        options?: { skipUrl?: boolean; stayOnTab?: boolean; toggle?: boolean },
    ) => {
        const target = String(set.url || '').trim();
        if (!target) {
            toast('This set is missing a URL.', 'error');
            return;
        }
        const sameKey = selectedSearchSet
            && relatedSetKey(selectedSearchSet) === relatedSetKey(set)
            && (Boolean(preview) || busy === 'preview');
        if (options?.toggle !== false && sameKey) {
            collapseSetInspector({ scrollToSets: false });
            return;
        }

        const restrictTitleCards = isExclusiveTitleCardSet(set);
        const stayOnTab = Boolean(options?.stayOnTab);
        if (!selectedSearchSet || !(preview || busy === 'preview')) {
            resultsScrollTopRef.current = capturePortalScroll();
        }
        setShowInspectorAssets(false);
        setSelectedSearchSet(set);
        setUrl(target);
        setTitleCardsOnly(restrictTitleCards);
        titleCardsOnlyRef.current = restrictTitleCards;
        scrollPreviewAfterLoadRef.current = true;

        if (!stayOnTab) {
            setBrowseSeeAllId(null);
            setTab('apply');
        }

        if (!options?.skipUrl && !stayOnTab) {
            pushPosterLocation({
                tab: 'apply',
                rail: null,
                setUrl: target,
                creator: null,
                titleCardsOnly: restrictTitleCards,
            }, 'push');
        } else if (!stayOnTab) {
            syncedSetUrlRef.current = target;
        } else if (!options?.skipUrl && (tab === 'apply' || tab === 'paste')) {
            pushPosterLocation({
                tab,
                rail: null,
                setUrl: target,
                creator: null,
                titleCardsOnly: restrictTitleCards,
            }, 'push');
        } else {
            syncedSetUrlRef.current = target;
        }

        await runPreview(target, {
            scroll: false,
            keepSearch: true,
            titleCardsOnly: restrictTitleCards,
        });
        window.setTimeout(() => {
            previewPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            scrollPreviewAfterLoadRef.current = false;
        }, 200);
    };

    /** Deep links / Recent / Queue reopen — Apply with set expanded (keeps any existing search). */
    const openSetForApply = async (set: PosterSetsSearchSet, options?: { skipUrl?: boolean; stayOnTab?: boolean }) => {
        await expandSetInline(set, {
            skipUrl: options?.skipUrl,
            stayOnTab: Boolean(options?.stayOnTab),
            toggle: false,
        });
    };
    const openSetForApplyRef = useRef(openSetForApply);
    openSetForApplyRef.current = openSetForApply;

    // After preview, load other packs for the same show/movie (MediUX + ThePosterDB).
    useEffect(() => {
        relatedSetsAbortRef.current?.abort();
        const generation = ++relatedSetsGenRef.current;
        if (!preview) {
            setRelatedSets([]);
            setRelatedSetsLoading(false);
            return;
        }

        const meta = preview.setMeta;
        const tmdbId = String(meta?.tmdbId || '').trim();
        const title = String(meta?.title || '').trim();
        if (!tmdbId && !title) {
            setRelatedSets([]);
            setRelatedSetsLoading(false);
            return;
        }

        const currentKeys = new Set(
            [
                relatedSetKey({
                    provider: meta?.provider,
                    setId: meta?.setId,
                    url: meta?.url || preview.url,
                }),
                relatedSetKey({ url: preview.url }),
            ].filter(Boolean),
        );
        const mediaType = inferPreviewMediaType(preview);
        const wantYear = (preview.assets || []).map((asset) => asset.year).find((year) => year != null) ?? null;
        const relatedProvider = defaultSearchProvider(configDraft);
        const dupePreference = configDraft.dupePreference === 'mediux' ? 'mediux' : 'posterdb';
        const controller = new AbortController();
        relatedSetsAbortRef.current = controller;
        const stillCurrent = () => generation === relatedSetsGenRef.current && !controller.signal.aborted;

        const pushUnique = (bucket: PosterSetsSearchSet[], incoming: PosterSetsSearchSet[]) => {
            const seen = new Set(bucket.map((set) => relatedSetKey(set)).filter(Boolean));
            for (const set of incoming) {
                const key = relatedSetKey(set);
                if (!key || currentKeys.has(key) || seen.has(key)) continue;
                seen.add(key);
                bucket.push(set);
            }
        };

        const load = async () => {
            setRelatedSetsLoading(true);
            setRelatedSets([]);
            const collected: PosterSetsSearchSet[] = [];
            try {
                if (tmdbId) {
                    try {
                        let response = await posterSetsApi.search({
                            provider: 'mediux',
                            tmdbId,
                            mediaType,
                            limit: 40,
                        });
                        if (!stillCurrent()) return;
                        pushUnique(collected, response.sets || []);
                        if (!collected.length) {
                            response = await posterSetsApi.search({
                                provider: 'mediux',
                                tmdbId,
                                mediaType: mediaType === 'show' ? 'movie' : 'show',
                                limit: 40,
                            });
                            if (!stillCurrent()) return;
                            pushUnique(collected, response.sets || []);
                        }
                        if (stillCurrent()) setRelatedSets([...collected]);
                    } catch {
                        // Title search below may still find packs.
                    }
                }

                if (title && !/^set\s+\d+$/i.test(title) && title.toLowerCase() !== 'poster set') {
                    try {
                        const titleSearch = await posterSetsApi.search({
                            provider: relatedProvider,
                            query: title,
                            mode: 'title',
                            limit: 12,
                            dupePreference,
                        });
                        if (!stillCurrent()) return;
                        const best = pickBestRelatedTitle(titleSearch.titles || [], title, wantYear);
                        if (best) {
                            const sources = (best.sources?.length
                                ? best.sources
                                : [{
                                    provider: best.provider || 'mediux',
                                    id: best.id,
                                    url: best.url,
                                    mediaType: best.mediaType,
                                }]).filter((source) => {
                                    if (!(source?.id || source?.url)) return false;
                                    const provider = String(source?.provider || '').toLowerCase() === 'mediux' ? 'mediux' : 'posterdb';
                                    if (relatedProvider === 'mediux') return provider === 'mediux';
                                    if (relatedProvider === 'posterdb') return provider === 'posterdb';
                                    return true;
                                });
                            if (sources.length) {
                            const setsResponse = sources.length > 1
                                ? await posterSetsApi.search({
                                    provider: relatedProvider,
                                    query: best.title,
                                    title: best.title,
                                    titleSources: sources,
                                    dupePreference,
                                    limit: 40,
                                })
                                : (String(sources[0]?.provider || '').toLowerCase() === 'mediux'
                                    ? await posterSetsApi.search({
                                        provider: 'mediux',
                                        tmdbId: sources[0].id,
                                        mediaType: sources[0].mediaType === 'show' ? 'show' : 'movie',
                                        limit: 40,
                                    })
                                    : await posterSetsApi.search({
                                        provider: 'posterdb',
                                        titleUrl: sources[0].url,
                                        limit: 40,
                                    }));
                            if (!stillCurrent()) return;
                            pushUnique(collected, setsResponse.sets || []);
                            }
                        }
                    } catch {
                        // Soft-fail: related rail is optional QoL.
                    }
                }

                if (stillCurrent()) {
                    setRelatedSets(collected.slice(0, 36));
                }
            } finally {
                if (stillCurrent()) {
                    setRelatedSetsLoading(false);
                }
            }
        };

        void load();
        return () => {
            relatedSetsGenRef.current += 1;
            controller.abort();
        };
    }, [
        preview,
        configDraft.dupePreference,
        configDraft.tpdbEnabled,
        configDraft.tpdbSearchEnabled,
        configDraft.mediuxEnabled,
    ]);

    // Keep /poster-sets#… in sync so refresh and browser Back stay inside Poster Sets.
    useEffect(() => {
        writePosterSetsUrl(
            initialUrlState.action ? { ...initialUrlState, action: null } : initialUrlState,
            'replace',
        );
    }, [initialUrlState]);

    useEffect(() => {
        if (deepLinkHandledRef.current) return;
        deepLinkHandledRef.current = true;
        if (initialLocation.tab === 'tpdb') {
            void openTpdbRecentCatalogRef.current({ skipUrl: true });
            return;
        }
        if (isTpdbFeedUrl(initialUrlState.setUrl || '') && initialLocation.tab === 'paste') {
            void openTpdbRecentCatalogRef.current({ skipUrl: true, locationTab: 'paste', kind: 'feed' });
            return;
        }
        if (isTpdbRecentUrl(initialUrlState.setUrl || '') && initialLocation.tab === 'paste') {
            void openTpdbRecentCatalogRef.current({ skipUrl: true, locationTab: 'paste' });
            return;
        }
        const handleFromUrl = parseTpdbUserHandle(initialUrlState.setUrl || '');
        if (handleFromUrl && (initialLocation.tab === 'apply' || initialLocation.tab === 'paste')) {
            void openCreatorCatalogRef.current(handleFromUrl, {
                skipUrl: true,
                locationTab: initialLocation.tab === 'paste' ? 'paste' : 'apply',
            });
            return;
        }
        const target = initialUrlState.setUrl;
        if (target && (initialLocation.tab === 'apply' || initialLocation.tab === 'paste')) {
            void (async () => {
                await openSetForApplyRef.current({
                    setId: '',
                    title: '',
                    url: target,
                    setKind: initialUrlState.titleCardsOnly ? 'title_cards' : null,
                }, { skipUrl: true, stayOnTab: initialLocation.tab === 'paste' });
                if (initialUrlState.action === 'apply') {
                    await runApplyRef.current(false, target);
                }
            })();
            return;
        }
        if (initialLocation.tab !== 'apply') return;
        if (initialUrlState.creator) {
            void openCreatorCatalogRef.current(initialUrlState.creator, { skipUrl: true });
        }
    }, [initialLocation.tab, initialUrlState]);

    useEffect(() => {
        let lastHash = window.location.hash || '';
        const onLocationChange = () => {
            const hash = window.location.hash || '';
            if (hash === lastHash) return;
            lastHash = hash;
            const parsed = parsePosterSetsUrl();
            const internalTab = internalTabFromUrl(parsed);
            setTab(internalTab);
            setBrowseSeeAllId(internalTab === 'browse' ? parsed.rail : null);
            const nextTitleCards = Boolean(parsed.titleCardsOnly);

            if (internalTab === 'apply' && parsed.setUrl) {
                const handleFromUrl = parseTpdbUserHandle(parsed.setUrl);
                if (handleFromUrl) {
                    syncedSetUrlRef.current = null;
                    titleCardsOnlyRef.current = false;
                    setTitleCardsOnly(false);
                    void openCreatorCatalogRef.current(handleFromUrl, { skipUrl: true });
                    return;
                }
                const changed = syncedSetUrlRef.current !== parsed.setUrl
                    || titleCardsOnlyRef.current !== nextTitleCards;
                syncedSetUrlRef.current = parsed.setUrl;
                titleCardsOnlyRef.current = nextTitleCards;
                setTitleCardsOnly(nextTitleCards);
                if (changed) {
                    void openSetForApplyRef.current({
                        setId: '',
                        title: '',
                        url: parsed.setUrl,
                        setKind: nextTitleCards ? 'title_cards' : null,
                    }, { skipUrl: true });
                }
                return;
            }

            if (internalTab === 'tpdb') {
                titleCardsOnlyRef.current = false;
                setTitleCardsOnly(false);
                void openTpdbRecentCatalogRef.current({ skipUrl: true });
                return;
            }

            if (internalTab === 'paste' && parsed.setUrl) {
                if (isTpdbFeedUrl(parsed.setUrl)) {
                    syncedSetUrlRef.current = parsed.setUrl;
                    titleCardsOnlyRef.current = false;
                    setTitleCardsOnly(false);
                    setUrl(parsed.setUrl);
                    void openTpdbRecentCatalogRef.current({ skipUrl: true, locationTab: 'paste', kind: 'feed' });
                    return;
                }
                if (isTpdbRecentUrl(parsed.setUrl)) {
                    syncedSetUrlRef.current = parsed.setUrl;
                    titleCardsOnlyRef.current = false;
                    setTitleCardsOnly(false);
                    setUrl(parsed.setUrl);
                    void openTpdbRecentCatalogRef.current({ skipUrl: true, locationTab: 'paste' });
                    return;
                }
                const handleFromUrl = parseTpdbUserHandle(parsed.setUrl);
                if (handleFromUrl) {
                    syncedSetUrlRef.current = parsed.setUrl;
                    titleCardsOnlyRef.current = false;
                    setTitleCardsOnly(false);
                    setUrl(parsed.setUrl);
                    void openCreatorCatalogRef.current(handleFromUrl, { skipUrl: true, locationTab: 'paste' });
                    return;
                }
                const changed = syncedSetUrlRef.current !== parsed.setUrl
                    || titleCardsOnlyRef.current !== nextTitleCards;
                syncedSetUrlRef.current = parsed.setUrl;
                titleCardsOnlyRef.current = nextTitleCards;
                setTitleCardsOnly(nextTitleCards);
                setUrl(parsed.setUrl);
                if (changed) {
                    void openSetForApplyRef.current({
                        setId: '',
                        title: '',
                        url: parsed.setUrl,
                        setKind: nextTitleCards ? 'title_cards' : null,
                    }, { skipUrl: true, stayOnTab: true });
                }
                return;
            }

            if (internalTab === 'apply' && parsed.creator) {
                syncedSetUrlRef.current = null;
                titleCardsOnlyRef.current = false;
                setTitleCardsOnly(false);
                setPreview(null);
                setSelectedSearchSet(null);
                setSelectedAssetIds([]);
                setUrl('');
                void openCreatorCatalogRef.current(parsed.creator, { skipUrl: true });
                return;
            }

            if (syncedSetUrlRef.current) {
                syncedSetUrlRef.current = null;
                titleCardsOnlyRef.current = false;
                setTitleCardsOnly(false);
                setPreview(null);
                setSelectedSearchSet(null);
                setSelectedAssetIds([]);
                setUrl('');
            } else {
                titleCardsOnlyRef.current = false;
                setTitleCardsOnly(false);
            }
        };
        window.addEventListener('popstate', onLocationChange);
        window.addEventListener('hashchange', onLocationChange);
        return () => {
            window.removeEventListener('popstate', onLocationChange);
            window.removeEventListener('hashchange', onLocationChange);
        };
    }, []);

    const filtersForSelectedIds = (ids: string[]) => {
        if (!ids.length) return undefined;
        const byId = new Map((preview?.assets || []).map((asset) => [asset.id, asset]));
        const selected = ids.map((id) => byId.get(id)).filter(Boolean) as PosterSetsPreviewAsset[];
        const filters = mediuxFiltersFromAssets(selected);
        return filters.length ? filters : undefined;
    };

    const selectedAssetsForIds = (ids: string[]) => {
        if (!ids.length) return undefined;
        const byId = new Map((preview?.assets || []).map((asset) => [asset.id, asset]));
        const assets = ids
            .map((id) => byId.get(id))
            .filter((asset): asset is PosterSetsPreviewAsset => Boolean(asset?.thumbUrl));
        if (!assets.length) return undefined;
        return assets.map((asset) => ({
            id: asset.id,
            kind: asset.kind,
            title: asset.title,
            year: asset.year ?? null,
            season: asset.season ?? null,
            episode: asset.episode ?? null,
            url: asset.thumbUrl,
            thumbUrl: asset.thumbUrl,
            source: asset.source,
            fileType: asset.fileType ?? null,
        }));
    };

    const runApply = async (selectedOnly = false, overrideUrl?: string) => {
        const target = String(overrideUrl ?? url).trim();
        if (!target) {
            toast('Paste a MediUX or ThePosterDB set URL first.', 'error');
            return;
        }
        if (overrideUrl) setUrl(target);
        if (selectedOnly && !selectedAssetIds.length) {
            toast('Select at least one asset to apply.', 'error');
            return;
        }
        setBusy('apply');
        try {
            const selected = selectedOnly ? selectedAssetIds : undefined;
            const response = await posterSetsApi.apply(
                target,
                selected,
                currentSetMeta(),
                undefined,
                selected
                    ? filtersForSelectedIds(selected)
                    : (titleCardsOnly ? TITLE_CARD_ONLY_FILTERS : undefined),
                undefined,
                selected ? selectedAssetsForIds(selected) : undefined,
            );
            setActiveJob(response.job);
            rememberRecentFromContext(jobSetMeta(response.job) || currentSetMeta(), target, {
                mediuxFilters: selected
                    ? filtersForSelectedIds(selected)
                    : (titleCardsOnly ? TITLE_CARD_ONLY_FILTERS : undefined),
            });
            await loadQueue();
            collapseSetInspector({ scrollToSets: false });
            toast(queuePaused
                ? 'Added to queue (paused — resume in Queue tab).'
                : selectedOnly
                    ? `Queued ${selectedAssetIds.length} selected asset(s).`
                    : 'Queued full set apply.');
            await loadHistory();
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to queue apply', 'error');
        } finally {
            setBusy(null);
        }
    };

    runApplyRef.current = runApply;

    const applyMatched = async () => {
        const assets = preview?.assets || [];
        const matchedIds = assets.filter((asset) => asset.matched === true).map((asset) => asset.id);
        const ids = selectedAssetIds.length ? selectedAssetIds : matchedIds;
        if (!ids.length) {
            toast('No posters to apply. Check at least one art type.', 'error');
            return;
        }
        setBusy('apply');
        try {
            const target = url.trim();
            const response = await posterSetsApi.apply(
                target,
                ids,
                currentSetMeta(),
                undefined,
                filtersForSelectedIds(ids),
                undefined,
                selectedAssetsForIds(ids),
            );
            setActiveJob(response.job);
            rememberRecentFromContext(jobSetMeta(response.job) || currentSetMeta(), target, {
                mediuxFilters: filtersForSelectedIds(ids),
            });
            await loadQueue();
            collapseSetInspector({ scrollToSets: false });
            toast(queuePaused
                ? `Queued ${ids.length} poster${ids.length === 1 ? '' : 's'} (queue paused).`
                : `Queued ${ids.length} poster${ids.length === 1 ? '' : 's'}.`);
            await loadHistory();
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to queue apply', 'error');
        } finally {
            setBusy(null);
        }
    };

    const applyUnmatched = async () => {
        const assets = preview?.assets || [];
        const unmatchedIds = assets.filter((asset) => asset.matched === false).map((asset) => asset.id);
        if (!unmatchedIds.length) {
            toast('No unmatched posters to queue.', 'error');
            return;
        }
        setSelectedAssetIds(unmatchedIds);
        const ok = await askConfirm(
            `Queue ${unmatchedIds.length} unmatched poster${unmatchedIds.length === 1 ? '' : 's'} for apply?`,
            {
                title: 'Queue unmatched?',
                confirmLabel: 'Add to queue',
                cancelLabel: 'Cancel',
            },
        );
        if (!ok) return;
        setBusy('apply');
        try {
            const target = url.trim();
            const response = await posterSetsApi.apply(
                target,
                unmatchedIds,
                currentSetMeta(),
                undefined,
                filtersForSelectedIds(unmatchedIds),
                undefined,
                selectedAssetsForIds(unmatchedIds),
            );
            setActiveJob(response.job);
            rememberRecentFromContext(jobSetMeta(response.job) || currentSetMeta(), target, {
                mediuxFilters: filtersForSelectedIds(unmatchedIds),
            });
            await loadQueue();
            collapseSetInspector({ scrollToSets: false });
            toast(queuePaused
                ? `Queued ${unmatchedIds.length} unmatched poster${unmatchedIds.length === 1 ? '' : 's'} (queue paused).`
                : `Queued ${unmatchedIds.length} unmatched poster${unmatchedIds.length === 1 ? '' : 's'}.`);
            await loadHistory();
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to queue apply', 'error');
        } finally {
            setBusy(null);
        }
    };

    const applyNewSinceWatch = async () => {
        const target = url.trim();
        if (!target) {
            toast('Preview a set URL first.', 'error');
            return;
        }
        const assets = preview?.assets || [];
        if (!assets.length) {
            toast('No preview assets available.', 'error');
            return;
        }
        setBusy('apply');
        let newIds: string[] = [];
        try {
            let watch = watches.find((entry) => String(entry.url || '').trim() === target) || null;
            if (!watch) {
                const response = await posterSetsApi.watchByUrl(target);
                watch = response.watch || null;
            }
            const known = watch?.knownAssetIds;
            if (!watch || !Array.isArray(known)) {
                toast('Pin a watch on this set first, then try again.', 'error');
                return;
            }
            const knownSet = new Set(known.map((id) => String(id)));
            newIds = assets
                .map((asset) => asset.id)
                .filter((id) => id && !knownSet.has(String(id)));
            if (!newIds.length) {
                toast('No new assets since this watch was last checked.', 'error');
                return;
            }
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to check watch', 'error');
            return;
        } finally {
            setBusy(null);
        }

        setSelectedAssetIds(newIds);
        const ok = await askConfirm(
            `Queue ${newIds.length} new poster${newIds.length === 1 ? '' : 's'} since watch?`,
            {
                title: 'Queue new since watch?',
                confirmLabel: 'Add to queue',
                cancelLabel: 'Cancel',
            },
        );
        if (!ok) return;
        setBusy('apply');
        try {
            const response = await posterSetsApi.apply(
                target,
                newIds,
                currentSetMeta(),
                undefined,
                filtersForSelectedIds(newIds),
                undefined,
                selectedAssetsForIds(newIds),
            );
            setActiveJob(response.job);
            rememberRecentFromContext(jobSetMeta(response.job) || currentSetMeta(), target, {
                mediuxFilters: filtersForSelectedIds(newIds),
            });
            await loadQueue();
            collapseSetInspector({ scrollToSets: false });
            toast(queuePaused
                ? `Queued ${newIds.length} new poster${newIds.length === 1 ? '' : 's'} (queue paused).`
                : `Queued ${newIds.length} new poster${newIds.length === 1 ? '' : 's'}.`);
            await loadHistory();
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to queue new assets', 'error');
        } finally {
            setBusy(null);
        }
    };

    const toggleBulkSet = (entry: BulkSetSelection) => {
        const key = String(entry.url || '').trim();
        if (!key) return;
        setSelectedBulkSets((prev) => {
            const next = { ...prev };
            if (next[key]) delete next[key];
            else {
                next[key] = {
                    url: key,
                    title: entry.title ?? null,
                    user: entry.user ?? null,
                    thumbUrl: entry.thumbUrl || '',
                    provider: entry.provider ?? null,
                    setId: entry.setId != null ? String(entry.setId) : null,
                };
            }
            return next;
        });
    };

    const clearBulkSelection = () => setSelectedBulkSets({});

    const selectBrowseSets = (sets: PosterSetsSearchSet[]) => {
        setSelectedBulkSets((prev) => {
            const next = { ...prev };
            for (const set of sets) {
                const key = String(set.url || '').trim();
                if (!key) continue;
                next[key] = bulkEntryFromSet(set);
            }
            return next;
        });
    };

    const queueBulkSelected = async () => {
        const entries = Object.values(selectedBulkSets);
        if (!entries.length) return;
        if (entries.length > 5) {
            const ok = await askConfirm(
                `Queue ${entries.length} selected sets for apply and add each one to Watching?`,
                {
                    title: 'Queue selected sets?',
                    confirmLabel: 'Queue & watch',
                    cancelLabel: 'Cancel',
                },
            );
            if (!ok) return;
        }
        setBusy('bulk-select');
        let queued = 0;
        let watched = 0;
        try {
            for (const entry of entries) {
                const setMeta: PosterSetsSetMeta = {
                    url: entry.url,
                    title: entry.title ?? null,
                    user: entry.user ?? null,
                    thumbUrl: entry.thumbUrl || '',
                    provider: entry.provider ?? null,
                    setId: entry.setId ?? null,
                    setKind: entry.setKind || null,
                };
                const response = await posterSetsApi.apply(entry.url, undefined, setMeta, 'bulk');
                setActiveJob(response.job);
                rememberRecentFromContext(jobSetMeta(response.job) || setMeta, entry.url);
                queued += 1;
                try {
                    const result = await addWatchWithTitleReplaceConfirm({
                        url: entry.url,
                        title: entry.title || undefined,
                        user: entry.user || undefined,
                        thumbUrl: entry.thumbUrl || undefined,
                        provider: entry.provider || undefined,
                        setId: entry.setId || undefined,
                    });
                    if (result.ok) watched += 1;
                } catch {
                    /* apply still queued */
                }
            }
            clearBulkSelection();
            await loadQueue();
            await loadHistory();
            await loadWatches();
            toast(queuePaused
                ? `Queued ${queued} set${queued === 1 ? '' : 's'} (queue paused)${watched ? ` and watching ${watched}` : ''}.`
                : `Queued ${queued} set${queued === 1 ? '' : 's'}${watched ? ` and watching ${watched}` : ''}.`);
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to queue selected sets', 'error');
        } finally {
            setBusy(null);
        }
    };

    const watchBulkSelected = async () => {
        const entries = Object.values(selectedBulkSets);
        if (!entries.length) return;
        setBusy('bulk-watch');
        let added = 0;
        try {
            for (const entry of entries) {
                const result = await addWatchWithTitleReplaceConfirm({
                    url: entry.url,
                    title: entry.title || undefined,
                    user: entry.user || undefined,
                    thumbUrl: entry.thumbUrl || undefined,
                    provider: entry.provider || undefined,
                    setId: entry.setId || undefined,
                });
                if (result.cancelled) continue;
                if (result.ok) added += 1;
            }
            clearBulkSelection();
            await loadWatches();
            toast(`Watching ${added} set${added === 1 ? '' : 's'}.`);
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to watch selected sets', 'error');
        } finally {
            setBusy(null);
        }
    };

    const useFindId = async (
        andPreview: boolean,
        options?: { locationTab?: 'apply' | 'paste' },
    ) => {
        const rawId = findId.trim();
        const built = buildSetUrl(findProvider, rawId);
        const locationTab = options?.locationTab === 'paste' ? 'paste' : 'apply';
        if (!built) {
            toast(findProvider === 'mediux'
                ? 'Enter a MediUX set ID (numbers only).'
                : 'Enter a ThePosterDB set ID, poster ID, or username.', 'error');
            return;
        }
        const creatorHandle = findProvider === 'posterdb'
            ? (parseTpdbUserHandle(rawId) || parseTpdbUserHandle(built))
            : null;
        if (creatorHandle) {
            openCreatorCatalogRef.current(creatorHandle, { locationTab });
            return;
        }
        setSelectedSearchSet({
            setId: rawId,
            title: `Set ${rawId}`,
            url: built,
            provider: findProvider,
        });
        setUrl(built);
        if (andPreview) {
            setShowInspectorAssets(false);
            pushPosterLocation({ tab: locationTab, rail: null, setUrl: built, creator: null, titleCardsOnly: false }, 'push');
            let response = await runPreview(built, { titleCardsOnly: false, keepSearch: true });
            // Numeric TPDb ids are often poster ids (/poster/N), not set ids — retry when /set/N fails.
            if (
                !response
                && findProvider === 'posterdb'
                && /^\d+$/.test(rawId)
            ) {
                const posterUrl = buildSetUrl('posterdb', rawId, 'poster');
                setSelectedSearchSet({
                    setId: rawId,
                    title: `Poster ${rawId}`,
                    url: posterUrl,
                    provider: 'posterdb',
                });
                setUrl(posterUrl);
                pushPosterLocation({ tab: locationTab, rail: null, setUrl: posterUrl, creator: null, titleCardsOnly: false }, 'replace');
                response = await runPreview(posterUrl, { titleCardsOnly: false, keepSearch: true });
            }
        } else toast('Set URL filled — preview or apply when ready.');
    };

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(POSTER_SETS_GRID_STORAGE_KEY, String(gridSize === 'list' ? DEFAULT_POSTER_SETS_GRID_SIZE : gridSize));
    }, [gridSize]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(SEARCH_SETS_PAGE_SIZE_STORAGE_KEY, String(searchSetsPageSize));
    }, [searchSetsPageSize]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(POSTER_SETS_LIBRARY_DETAIL_LAYOUT_KEY, libraryDetailLayout);
    }, [libraryDetailLayout]);

    const posterGridClass = useMemo(
        () => upgraderPosterGridClass(gridSize === 'list' ? DEFAULT_POSTER_SETS_GRID_SIZE : gridSize),
        [gridSize],
    );
    const posterGridStyle = useMemo(
        () => posterSetsPosterGridStyle(gridSize === 'list' ? DEFAULT_POSTER_SETS_GRID_SIZE : gridSize),
        [gridSize],
    );
    const titleCardGridStyle = useMemo(
        () => posterSetsLandscapeGridStyle(gridSize === 'list' ? DEFAULT_POSTER_SETS_GRID_SIZE : gridSize),
        [gridSize],
    );
    const searchSetsUseTitleCardGrid = useMemo(
        () => searchSets.length > 0 && searchSets.every((set) => isTitleCardSet(set)),
        [searchSets],
    );

    const runCatalogSearch = async (options?: {
        mode?: 'title' | 'creator' | 'recent' | 'feed';
        query?: string;
        provider?: SearchProvider;
    }) => {
        const requestedMode = options?.mode || searchMode;
        // Discover Search must never re-run a leftover TPDB New catalog just because
        // searchMode is still 'recent'/'feed' from the other sub-tab.
        const mode = (!options?.mode && tab === 'apply' && (requestedMode === 'recent' || requestedMode === 'feed'))
            ? 'title'
            : requestedMode;
        if (mode === 'title' && (searchMode === 'recent' || searchMode === 'feed')) {
            setSearchMode('title');
        }
        const q = String(options?.query ?? searchQuery).trim().replace(/^@+/, '');
        const provider = options?.provider || searchProvider;
        if (mode !== 'recent' && mode !== 'feed' && !q) {
            toast(mode === 'creator' ? 'Enter a creator username.' : 'Enter a title to search.', 'error');
            return;
        }
        const gen = ++catalogSearchGenRef.current;
        creatorSearchAbortRef.current?.abort();
        const abort = new AbortController();
        creatorSearchAbortRef.current = abort;
        const catalogIsCurrent = () => gen === catalogSearchGenRef.current && !abort.signal.aborted;

        setBusy('search');
        setSearchTitles([]);
        setSearchSets([]);
        setSearchSetsPage(1);
        setSearchLoadingMore(false);
        setSearchContext('');
        setCatalogError('');
        setSelectedSearchTitle(null);
        setSelectedSearchSet(null);
        setPreview(null);
        try {
            if (mode === 'creator' || mode === 'recent' || mode === 'feed') {
                toast("Loading first pages… more will fill in as they're found.");
                setSearchLoadingMore(true);
                let sawFirstBatch = false;
                const finalEvent = await posterSetsApi.searchCatalogStream({
                    provider: (mode === 'recent' || mode === 'feed') ? 'posterdb' : provider,
                    query: mode === 'feed' ? 'feed' : mode === 'recent' ? 'recent' : q,
                    mode,
                    dupePreference: configDraft.dupePreference === 'mediux' ? 'mediux' : 'posterdb',
                    limit: 0,
                    batchPages: 3,
                }, {
                    signal: abort.signal,
                    onBatch: (event) => {
                        if (!catalogIsCurrent()) return;
                        const sets = event.sets || [];
                        setSearchSets(sets);
                        setSearchContext(event.title || (mode === 'feed'
                            ? 'ThePosterDB · Following'
                            : mode === 'recent' ? 'ThePosterDB · Recently added' : `@${q}`));
                        if (!sawFirstBatch && sets.length) {
                            sawFirstBatch = true;
                            setBusy(null);
                            setSearchSetsPage(1);
                            toast(`Showing first results — loading more in the background…`);
                        }
                        if (event.loading === false || event.type === 'result') {
                            setSearchLoadingMore(false);
                        } else {
                            setSearchLoadingMore(true);
                        }
                    },
                });
                if (!catalogIsCurrent()) return;
                const setCount = finalEvent?.sets?.length || 0;
                const dupes = Number(finalEvent?.dupesCollapsed || 0);
                const dupeNote = dupes > 0 ? ` · ${dupes} duplicate${dupes === 1 ? '' : 's'} collapsed` : '';
                setSearchLoadingMore(false);
                if (!setCount && !sawFirstBatch) {
                    const emptyMessage = mode === 'feed'
                        ? 'No sets from creators you follow in Poster Sets settings.'
                        : 'No matches found.';
                    setCatalogError(emptyMessage);
                    toast(emptyMessage, 'error');
                } else {
                    setCatalogError('');
                    toast(`Found ${setCount} set${setCount === 1 ? '' : 's'} from ${finalEvent?.title || q}${dupeNote}.`);
                }
                if (finalEvent?.partialErrors?.length) {
                    const msg = finalEvent.partialErrors[0];
                    toast(msg, isPosterSetsUpstreamOutage(msg) ? undefined : 'error');
                }
                return;
            }

            const paintLibraryTitles = async () => {
                try {
                    const cached = readLibrarySearchCache(q);
                    const cachedTitles = (cached || []).map(libraryItemToSearchTitle).filter(Boolean) as PosterSetsSearchTitle[];
                    if (cachedTitles.length && catalogIsCurrent()) {
                        setSearchTitles(cachedTitles);
                        setSearchContext(q);
                        setBusy(null);
                        setSearchLoadingMore(true);
                    }
                    const lib = await posterSetsApi.librarySearch(q, 12);
                    if (!catalogIsCurrent()) return;
                    const titles = normalizeLibraryItems(lib.results || [])
                        .map(libraryItemToSearchTitle)
                        .filter(Boolean) as PosterSetsSearchTitle[];
                    if (!titles.length) return;
                    writeLibrarySearchCache(q, normalizeLibraryItems(lib.results || []));
                    setSearchTitles((current) => (current.length ? current : titles));
                    setSearchContext(q);
                    setBusy((current) => (current === 'search' ? null : current));
                    setSearchLoadingMore(true);
                } catch {
                    /* catalog search still owns the error toast */
                }
            };

            const [response] = await Promise.all([
                posterSetsApi.search({
                    provider,
                    query: q,
                    mode,
                    dupePreference: configDraft.dupePreference === 'mediux' ? 'mediux' : 'posterdb',
                    limit: 24,
                }, { signal: abort.signal }),
                paintLibraryTitles(),
            ]);
            if (!catalogIsCurrent()) return;
            setSearchTitles(response.titles || []);
            setSearchSets(response.sets || []);
            setSearchSetsPage(1);
            setSearchContext(response.title || q);
            const titleCount = response.titles?.length || 0;
            const setCount = response.sets?.length || 0;
            const libraryCount = (response.titles || []).filter((title) => title.inLibrary).length;
            const dupes = Number(response.dupesCollapsed || 0);
            const dupeNote = dupes > 0 ? ` · ${dupes} duplicate${dupes === 1 ? '' : 's'} collapsed` : '';
            const libraryNote = libraryCount > 0
                ? ` · ${libraryCount} in your library`
                : '';
            if (!titleCount && !setCount) {
                toast('No matches found.', 'error');
            } else if (titleCount) {
                toast(`Found ${titleCount} title${titleCount === 1 ? '' : 's'}${libraryNote}${dupeNote}. Choose one.`);
            } else {
                toast(`Found ${setCount} set${setCount === 1 ? '' : 's'}${dupeNote}. Choose one to preview.`);
            }
            if (response.partialErrors?.length) {
                const msg = response.partialErrors[0];
                toast(msg, isPosterSetsUpstreamOutage(msg) ? undefined : 'error');
            }
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            if (!catalogIsCurrent()) return;
            const message = error instanceof Error ? error.message : 'Search failed';
            setCatalogError(message);
            toast(message, 'error');
            setSearchLoadingMore(false);
        } finally {
            if (creatorSearchAbortRef.current === abort) {
                creatorSearchAbortRef.current = null;
            }
            if (catalogIsCurrent()) {
                setBusy((current) => (current === 'search' ? null : current));
                setSearchLoadingMore(false);
            }
        }
    };

    const openCreatorCatalog = (username: string, options?: { skipUrl?: boolean; locationTab?: 'paste' | 'apply' }) => {
        const handle = String(username || '').trim().replace(/^@+/, '');
        if (!handle) return;
        const locationTab = options?.locationTab === 'paste' ? 'paste' : 'apply';
        const userUrl = `https://theposterdb.com/user/${encodeURIComponent(handle)}`;
        setTab(locationTab);
        setBrowseSeeAllId(null);
        setSearchMode('creator');
        setSearchQuery(handle);
        setSearchProvider(locationTab === 'paste' ? 'posterdb' : 'both');
        setTitleCardsOnly(false);
        titleCardsOnlyRef.current = false;
        setPreview(null);
        setSelectedSearchSet(null);
        setSelectedSearchTitle(null);
        setShowInspectorAssets(false);
        setSelectedAssetIds([]);
        if (locationTab === 'paste') {
            syncedSetUrlRef.current = userUrl;
            setUrl(userUrl);
            if (!options?.skipUrl) {
                pushPosterLocation({
                    tab: 'paste',
                    rail: null,
                    setUrl: userUrl,
                    creator: null,
                    titleCardsOnly: false,
                }, 'push');
            }
        } else {
            syncedSetUrlRef.current = null;
            setUrl('');
            if (!options?.skipUrl) {
                pushPosterLocation({
                    tab: 'apply',
                    rail: null,
                    setUrl: null,
                    creator: handle,
                    titleCardsOnly: false,
                }, 'push');
            } else {
                writePosterSetsUrl(normalizePosterLocation({
                    tab: 'apply',
                    rail: null,
                    setUrl: null,
                    creator: handle,
                    titleCardsOnly: false,
                }), 'replace');
            }
        }
        requestAnimationFrame(() => {
            searchSetsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        void runCatalogSearch({
            mode: 'creator',
            query: handle,
            provider: locationTab === 'paste' ? 'posterdb' : 'both',
        });
    };
    openCreatorCatalogRef.current = openCreatorCatalog;

    const openTpdbRecentCatalog = (options?: { skipUrl?: boolean; locationTab?: 'paste' | 'tpdb'; refresh?: boolean; kind?: 'recent' | 'feed' }) => {
        const locationTab = options?.locationTab === 'paste' ? 'paste' : 'tpdb';
        const kind = options?.kind === 'feed' ? 'feed' : 'recent';
        const followed = (configDraft.creatorWhitelist || [])
            .map((name) => String(name || '').replace(/^@+/, '').trim())
            .filter(Boolean);
        if (kind === 'feed' && !followed.length) {
            setTab(locationTab);
            setSearchMode('feed');
            setSearchSets([]);
            setSearchLoadingMore(false);
            setCatalogError('Add creators under Poster Sets → Settings → Creators you follow.');
            toast('Add creators under Poster Sets → Settings → Creators you follow.', 'error');
            if (!options?.skipUrl && locationTab !== 'paste') {
                pushPosterLocation({
                    tab: 'tpdb',
                    rail: null,
                    setUrl: null,
                    creator: null,
                    titleCardsOnly: false,
                }, 'push');
            }
            return;
        }
        const catalogUrl = kind === 'feed'
            ? `https://theposterdb.com/user/${encodeURIComponent(followed[0])}`
            : 'https://theposterdb.com/recent';
        if (
            !options?.refresh
            && searchMode === kind
            && tab === locationTab
            && (searchSets.length > 0 || searchLoadingMore || busy === 'search')
        ) {
            setTab(locationTab);
            return;
        }
        setTab(locationTab);
        setBrowseSeeAllId(null);
        setSearchMode(kind);
        setSearchQuery('');
        setSearchProvider('posterdb');
        setTitleCardsOnly(false);
        titleCardsOnlyRef.current = false;
        setPreview(null);
        setSelectedSearchSet(null);
        setSelectedSearchTitle(null);
        setShowInspectorAssets(false);
        setSelectedAssetIds([]);
        if (locationTab === 'paste') {
            syncedSetUrlRef.current = catalogUrl;
            setUrl(catalogUrl);
            if (!options?.skipUrl) {
                pushPosterLocation({
                    tab: 'paste',
                    rail: null,
                    setUrl: catalogUrl,
                    creator: null,
                    titleCardsOnly: false,
                }, 'push');
            }
        } else {
            syncedSetUrlRef.current = null;
            setUrl('');
            if (!options?.skipUrl) {
                pushPosterLocation({
                    tab: 'tpdb',
                    rail: null,
                    setUrl: null,
                    creator: null,
                    titleCardsOnly: false,
                }, 'push');
            }
        }
        requestAnimationFrame(() => {
            searchSetsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        void runCatalogSearch({
            mode: kind,
            query: kind,
            provider: 'posterdb',
        });
    };
    openTpdbRecentCatalogRef.current = openTpdbRecentCatalog;

    const openLibraryItem = (item: LibraryRecentItem) => {
        if (libraryDetailLayout !== 'drawer') {
            libraryListScrollRef.current = capturePortalScroll();
        }
        setLibraryDetailItem(item);
    };

    const closeLibraryItem = useCallback(() => {
        const saved = libraryListScrollRef.current;
        libraryListScrollRef.current = null;
        setLibraryDetailItem(null);
        if (saved) {
            scheduleScrollRestore(() => restorePortalScroll(saved), { frames: 3, delays: [0, 50, 160, 400] });
        }
    }, []);

    const openSearchTitle = async (title: PosterSetsSearchTitle, libraryItem?: LibraryRecentItem) => {
        const gen = ++catalogSearchGenRef.current;
        creatorSearchAbortRef.current?.abort();
        creatorSearchAbortRef.current = null;
        const titleLoadIsCurrent = () => gen === catalogSearchGenRef.current;
        setBusy('search');
        setSearchSets([]);
        setSearchSetsPage(1);
        setSearchLoadingMore(true);
        setSelectedSearchTitle(title);
        setSelectedSearchSet(null);
        setPreview(null);
        // Hide the picker immediately so the click doesn't look like a no-op while sets load.
        setSearchTitles([]);
        const hasLinkedTmdb = String(title.provider || '').toLowerCase() === 'mediux' && Boolean(title.id);
        const tpdbConfigured = Boolean(configDraft.hasTpdbPassword && String(configDraft.tpdb_username || '').trim());
        const waitForTpdb = hasLinkedTmdb && tpdbConfigured && isTpdbSearchEnabled(configDraft);
        try {
            const response = await fetchPosterSetsForTitle(title, {
                dupePreference: configDraft.dupePreference === 'mediux' ? 'mediux' : 'posterdb',
                mediaType: libraryItem?.mediaType,
                libraryItem,
                preferredCreators: configDraft.creatorWhitelist,
                blockedCreators: configDraft.creatorBlocklist,
                tpdbConfigured,
                tpdbEnabled: isTpdbSearchEnabled(configDraft),
                mediuxEnabled: isMediuxEnabled(configDraft),
                searchProvider,
                onPartial: (partial) => {
                    if (!titleLoadIsCurrent()) return;
                    if ((partial.sets?.length || 0) > 0) {
                        setSearchSets(partial.sets || []);
                        setSearchContext(partial.title || title.title);
                        if (waitForTpdb) setSearchLoadingMore(true);
                        setBusy((current) => (current === 'search' ? null : current));
                    }
                },
                onMediuxSettled: () => {
                    if (!titleLoadIsCurrent()) return;
                    // Keep the spinner until sets land or TPDB finishes — empty MediUX
                    // settle used to clear busy while the title list was still on screen.
                    if (!waitForTpdb) {
                        setBusy((current) => (current === 'search' ? null : current));
                        setSearchLoadingMore(false);
                    }
                },
                onTpdbSettled: () => {
                    if (!titleLoadIsCurrent()) return;
                    setBusy((current) => (current === 'search' ? null : current));
                    setSearchLoadingMore(false);
                },
            });
            if (!titleLoadIsCurrent()) return;
            setSearchSets((prev) => {
                const next = response.sets || [];
                if (next.length === 0) return prev;
                // Prefer the richer paint (late TPDB can land after soft timeout).
                return next.length >= prev.length ? next : prev;
            });
            setSearchSetsPage(1);
            setSearchContext(response.title || title.title);
            // Focus on sets: titles list becomes a back action only.
            setSearchTitles([]);
            const dupes = Number(response.dupesCollapsed || 0);
            const setCount = response.sets?.length || 0;
            if (!setCount) {
                toast(`No poster sets found for ${title.title}.`, 'error');
            } else {
                toast(`Sets for ${title.title}${dupes > 0 ? ` · ${dupes} duplicate${dupes === 1 ? '' : 's'} collapsed` : ''}. Expand one to queue.`);
            }
            if (response.partialErrors?.length) {
                const msg = response.partialErrors[0];
                if (msg.includes('ThePosterDB login not configured')) {
                    // Inline / settings hint — skip toast.
                } else if (
                    msg.includes('taking longer')
                    || msg.includes('timed out')
                    || msg.includes('still searching')
                    || isPosterSetsUpstreamOutage(msg)
                ) {
                    toast(msg);
                } else {
                    toast(msg, 'error');
                }
            }
        } catch (error) {
            if (!titleLoadIsCurrent()) return;
            toast(error instanceof Error ? error.message : 'Failed to load sets', 'error');
        } finally {
            if (titleLoadIsCurrent()) {
                setBusy((current) => (current === 'search' ? null : current));
                setSearchLoadingMore(false);
            }
        }
    };

    const runLibraryItemSearch = async (item: LibraryRecentItem) => {
        setBusy('search');
        setSearchTitles([]);
        setSearchSets([]);
        setSearchSetsPage(1);
        setSearchLoadingMore(false);
        setSearchContext('');
        setSelectedSearchTitle(null);
        setSelectedSearchSet(null);
        setPreview(null);

        const dupePreference = configDraft.dupePreference === 'mediux' ? 'mediux' : 'posterdb';
        const queries = [item.title];

        try {
            const tmdbId = String(item.tmdbId || '').trim();
            if (tmdbId) {
                const directTitle: PosterSetsSearchTitle = {
                    id: tmdbId,
                    title: item.title,
                    year: item.year ?? null,
                    url: item.mediaType === 'show'
                        ? `https://mediux.pro/shows/${tmdbId}`
                        : `https://mediux.pro/movies/${tmdbId}`,
                    mediaType: item.mediaType,
                    provider: 'mediux',
                    thumbUrl: '',
                };
                toast(`Matched ${item.title} via library ID — loading sets…`);
                await openSearchTitle(directTitle, item);
                return;
            }

            let response: Awaited<ReturnType<typeof posterSetsApi.search>> | null = null;
            let titles: PosterSetsSearchTitle[] = [];
            let autoMatch: PosterSetsSearchTitle | null = null;

            for (const query of queries) {
                response = await posterSetsApi.search({
                    provider: defaultSearchProvider(configDraft),
                    query,
                    mode: 'title',
                    dupePreference,
                    limit: 24,
                    mediaType: item.mediaType,
                    titleHint: item.title,
                    yearHint: item.year ?? undefined,
                });
                titles = response.titles || [];
                autoMatch = pickAutoMatchedTitle(item, titles);
                if (autoMatch) break;
            }

            if (autoMatch) {
                const yearLabel = autoMatch.year ? ` (${autoMatch.year})` : '';
                toast(`Auto-matched ${autoMatch.title}${yearLabel} — loading sets…`);
                await openSearchTitle(autoMatch, item);
                return;
            }

            setSearchTitles(rankSearchTitlesForLibraryItem(item, titles));
            setSearchSets(response?.sets || []);
            setSearchSetsPage(1);
            setSearchContext(response?.title || item.title);
            const titleCount = titles.length;
            const setCount = response?.sets?.length || 0;
            const dupes = Number(response?.dupesCollapsed || 0);
            const dupeNote = dupes > 0 ? ` · ${dupes} duplicate${dupes === 1 ? '' : 's'} collapsed` : '';
            if (!titleCount && !setCount) {
                toast(`No poster sets found for ${item.title}.`, 'error');
            } else if (titleCount) {
                const yearHint = item.year ? ` (${item.year})` : '';
                toast(
                    `Could not auto-match ${item.title}${yearHint} — ${titleCount} possible title${titleCount === 1 ? '' : 's'}${dupeNote}. Pick one.`,
                );
            } else {
                toast(`Found ${setCount} set${setCount === 1 ? '' : 's'}${dupeNote}. Choose one to preview.`);
            }
            if (response?.partialErrors?.length) {
                const msg = response.partialErrors[0];
                toast(msg, isPosterSetsUpstreamOutage(msg) ? undefined : 'error');
            }
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Search failed', 'error');
        } finally {
            setBusy((current) => (current === 'search' ? null : current));
        }
    };

    const pickSearchSet = async (set: PosterSetsSearchSet) => {
        await expandSetInline(set, { stayOnTab: true, toggle: true });
    };

    const backToTitles = () => {
        setSearchSets([]);
        setSelectedSearchTitle(null);
        setSelectedSearchSet(null);
        setPreview(null);
        if (searchQuery.trim()) void runCatalogSearch();
    };

    const clearSearch = () => {
        invalidateCatalogSearch();
        setSearchQuery('');
        setSearchTitles([]);
        setSearchSets([]);
        setSearchSetsPage(1);
        setSearchLoadingMore(false);
        setSearchContext('');
        setSelectedSearchTitle(null);
        setSelectedSearchSet(null);
        setPreview(null);
        setShowInspectorAssets(false);
        setSelectedAssetIds([]);
        setUrl('');
        setTitleCardsOnly(false);
        titleCardsOnlyRef.current = false;
        setCatalogError('');
        pushPosterLocation({ tab: 'apply', rail: null, setUrl: null, creator: null, titleCardsOnly: false }, 'push');
    };

    const matchedAssetCount = useMemo(() => {
        const assets = preview?.assets || [];
        return assets.filter((asset) => asset.matched === true).length;
    }, [preview]);

    const previewSections = useMemo(
        () => groupPreviewAssets(preview?.assets || []),
        [preview],
    );

    const searchSetsPageCount = Math.max(1, Math.ceil(searchSets.length / Math.max(1, searchSetsPageSize)));
    useEffect(() => {
        setSearchSetsPage((page) => Math.min(Math.max(1, page), searchSetsPageCount));
    }, [searchSetsPageCount]);
    const rankedSearchSets = useMemo(
        () => excludeBlockedCreators(
            prioritizeSetsByFollowedCreators(searchSets, configDraft.creatorWhitelist),
            configDraft.creatorBlocklist,
        ),
        [searchSets, configDraft.creatorWhitelist, configDraft.creatorBlocklist],
    );
    const pagedSearchSets = useMemo(() => {
        const page = Math.min(Math.max(1, searchSetsPage), searchSetsPageCount);
        const start = (page - 1) * searchSetsPageSize;
        return rankedSearchSets.slice(start, start + searchSetsPageSize);
    }, [rankedSearchSets, searchSetsPage, searchSetsPageCount, searchSetsPageSize]);

    const leftoverDiscoverCatalog = searchMode === 'recent'
        || searchMode === 'feed'
        || isTpdbDiscoverCatalogContext(searchContext);
    const searchResultsLoading = busy === 'search';
    const searchHasResults = searchTitles.length > 0
        || (searchSets.length > 0 && !leftoverDiscoverCatalog)
        || !!preview
        || !!selectedSearchSet;
    const searchEmptyLabel = selectedSearchTitle?.title || searchContext || searchQuery.trim();
    const loadingTitleSets = Boolean(selectedSearchTitle)
        && searchSets.length === 0
        && (searchResultsLoading || searchLoadingMore);
    const showSearchEmpty = !searchResultsLoading
        && !searchLoadingMore
        && !searchHasResults
        && Boolean(searchContext || selectedSearchTitle)
        && !leftoverDiscoverCatalog;
    const showSearchSetGrid = shouldShowSearchSetGrid({
        searchMode,
        setCount: searchSets.length,
        searchContext,
    });

    const watchedUrlSet = useMemo(() => {
        const urls = new Set<string>();
        const setKeys = new Set<string>();
        for (const watch of watches) {
            const url = String(watch.url || '').trim();
            if (url) urls.add(url);
            const setId = watch.setId != null ? String(watch.setId) : '';
            const provider = String(watch.provider || '').toLowerCase();
            if (setId) setKeys.add(`${provider}:${setId}`);
        }
        return { urls, setKeys };
    }, [watches]);

    const isSetWatched = useCallback((set: { url?: string | null; setId?: string | null; provider?: string | null }) => {
        const url = String(set.url || '').trim();
        if (url && watchedUrlSet.urls.has(url)) return true;
        const setId = set.setId != null ? String(set.setId) : '';
        if (!setId) return false;
        const provider = String(set.provider || '').toLowerCase();
        return watchedUrlSet.setKeys.has(`${provider}:${setId}`);
    }, [watchedUrlSet]);

    const filteredWatches = useMemo(() => {
        const needle = watchesFilter.trim().toLowerCase();
        if (!needle) return watches;
        return watches.filter((watch) => {
            const haystack = [
                watch.title,
                watch.user,
                watch.url,
                watch.setId,
                watch.provider,
                watch.lastError,
            ].map((value) => String(value || '').toLowerCase()).join(' ');
            return haystack.includes(needle);
        });
    }, [watches, watchesFilter]);

    const watchGroups = useMemo(
        () => groupPosterSetsWatchesByCategory(filteredWatches, watchArtKindOverrides),
        [filteredWatches, watchArtKindOverrides],
    );

    const watchGroupsByCategory = useMemo(() => {
        const buckets: Record<RecentSetCategory, typeof watchGroups> = {
            posters: [],
            backgrounds: [],
            title_cards: [],
        };
        for (const group of watchGroups) {
            buckets[group.category].push(group);
        }
        return buckets;
    }, [watchGroups]);

    const categoryFilteredWatchGroups = useMemo(() => (
        watchesCategoryFilter === 'all'
            ? watchGroups
            : watchGroups.filter((group) => group.category === watchesCategoryFilter)
    ), [watchGroups, watchesCategoryFilter]);

    const promoteWatchArtKind = useCallback((watchId: string, kind: RecentSetCategory) => {
        const id = String(watchId || '').trim();
        if (!id) return;
        setWatchArtKindOverrides((prev) => (prev[id] === kind ? prev : { ...prev, [id]: kind }));
        void posterSetsApi.patchWatch(id, { setKind: kind }).catch(() => undefined);
    }, []);

    const watchesPageCount = watchesCategoryFilter === 'all'
        ? 1
        : Math.max(1, Math.ceil(categoryFilteredWatchGroups.length / Math.max(1, watchesPageSize)));
    const pagedWatchGroups = useMemo(() => {
        if (watchesCategoryFilter === 'all') return categoryFilteredWatchGroups;
        const page = Math.min(Math.max(1, watchesPage), watchesPageCount);
        const start = (page - 1) * watchesPageSize;
        return categoryFilteredWatchGroups.slice(start, start + watchesPageSize);
    }, [categoryFilteredWatchGroups, watchesCategoryFilter, watchesPage, watchesPageCount, watchesPageSize]);

    const pagedWatchGroupsByCategory = useMemo(() => {
        const buckets: Record<RecentSetCategory, typeof pagedWatchGroups> = {
            posters: [],
            backgrounds: [],
            title_cards: [],
        };
        for (const group of pagedWatchGroups) {
            buckets[group.category].push(group);
        }
        return buckets;
    }, [pagedWatchGroups]);

    useEffect(() => {
        setWatchesPage((page) => Math.min(page, watchesPageCount));
    }, [watchesPageCount]);

    const readyToApply = Boolean(preview);
    const inspectorOpen = Boolean(
        selectedSearchSet
        || preview
        || (busy === 'preview' && Boolean(String(url || '').trim())),
    );
    const matchedThumbStrip = useMemo(() => {
        const selected = new Set(selectedAssetIds);
        let assets = preview?.assets || [];
        if (selected.size) {
            const filtered = assets.filter((asset) => selected.has(asset.id));
            if (filtered.length) assets = filtered;
            else assets = assets.filter((asset) => asset.matched === true);
        } else {
            assets = assets.filter((asset) => asset.matched === true);
        }
        if (titleCardsOnly) {
            const titleCards = assets.filter((asset) => classifyPreviewAsset(asset) === 'title_card');
            if (titleCards.length) assets = titleCards;
        }
        return inspectorThumbsFromAssets(
            assets,
            (url) => (url ? posterSetsApi.imageUrl(url) : ''),
        );
    }, [preview, titleCardsOnly, selectedAssetIds]);

    const queueEntireWithConfirm = async () => {
        const ok = await askConfirm('Queue the entire set, including posters not matched in your libraries?', {
            title: 'Queue full set?',
            confirmLabel: 'Add to queue',
            cancelLabel: 'Cancel',
        });
        if (!ok) return;
        void runApply(false);
    };

    useEffect(() => {
        if (tab !== 'apply' || !preview || !scrollPreviewAfterLoadRef.current) return undefined;
        const timer = window.setTimeout(() => {
            previewPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            scrollPreviewAfterLoadRef.current = false;
        }, 150);
        return () => window.clearTimeout(timer);
    }, [tab, preview]);

    const browseSeeAllRail = useMemo(
        () => browseRails.find((rail) => rail.id === browseSeeAllId) || null,
        [browseRails, browseSeeAllId],
    );

    const toggleAsset = (id: string) => {
        setSelectedAssetIds((prev) => (
            prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
        ));
    };

    const selectPreviewAssets = (mode: 'all' | 'matched' | 'none') => {
        const assets = preview?.assets || [];
        if (mode === 'none') {
            setSelectedAssetIds([]);
            return;
        }
        if (mode === 'matched') {
            setSelectedAssetIds(assets.filter((asset) => asset.matched).map((asset) => asset.id));
            return;
        }
        setSelectedAssetIds(assets.map((asset) => asset.id));
    };

    const runBulk = async (fromFile = false) => {
        setBusy(fromFile ? 'bulk-file' : 'bulk');
        try {
            const response = fromFile
                ? await posterSetsApi.bulk({ fromFile: true })
                : await posterSetsApi.bulk({ text: bulkText });
            setActiveJob(response.job);
            await loadQueue();
            if (!fromFile) {
                const urls = bulkText.split(/\r?\n/).map((line) => line.trim()).filter((line) => (
                    line && !line.startsWith('#') && !line.startsWith('//') && /^https?:\/\//i.test(line)
                ));
                let watched = 0;
                for (const url of urls) {
                    try {
                        const result = await addWatchWithTitleReplaceConfirm({ url });
                        if (result.ok) watched += 1;
                    } catch {
                        /* apply still queued */
                    }
                }
                if (watched) await loadWatches();
                toast(queuePaused
                    ? `Bulk list queued (paused)${watched ? ` and watching ${watched} set${watched === 1 ? '' : 's'}` : ''}.`
                    : `Bulk list added to queue${watched ? ` and watching ${watched} set${watched === 1 ? '' : 's'}` : ''}.`);
            } else {
                toast(queuePaused
                    ? 'Bulk file queued (paused). Sets will be added to Watching as they apply.'
                    : 'Bulk file added to queue. Sets will be added to Watching as they apply.');
            }
            await loadHistory();
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Bulk apply failed', 'error');
        } finally {
            setBusy(null);
        }
    };

    const toggleFilter = (id: string) => {
        setConfigDraft((prev) => {
            const set = new Set(prev.mediux_filters || []);
            if (set.has(id)) set.delete(id);
            else set.add(id);
            return { ...prev, mediux_filters: [...set] };
        });
    };

    const jobLogs = jobLogLines(activeJob);
    const selectedLogs = jobLogLines(selectedHistoryJob);
    const selectedQueueLogs = jobLogLines(selectedQueueJob);

    const recentSets = useMemo(() => {
        void recentTick;
        const byUrl = new Map<string, RecentSetChip>();
        const push = (chip: RecentSetChip | null) => {
            if (!chip?.url || byUrl.has(chip.url)) return;
            byUrl.set(chip.url, chip);
        };

        for (const stored of readRecentSets()) {
            push(stored);
        }
        for (const job of historyJobs) {
            const urlValue = String(job.input?.url || jobSetMeta(job)?.url || '').trim();
            if (!urlValue) continue;
            const meta = jobSetMeta(job);
            const ref = parseSetRef(urlValue);
            const setKind = normalizeRecentSetKind(meta?.setKind)
                || inferRecentSetKindFromFilters(job.input?.mediuxFilters)
                || (isTitleCardSet({ title: meta?.title, setKind: meta?.setKind }) ? 'title_cards' : null)
                || (isBackgroundSet({ title: meta?.title, setKind: meta?.setKind }) ? 'backgrounds' : null);
            push({
                url: urlValue,
                title: String(meta?.title || (ref.setId ? `Set ${ref.setId}` : 'Poster set')),
                user: meta?.user != null ? String(meta.user).trim().replace(/^@/, '') || null : null,
                provider: meta?.provider || ref.provider,
                setId: meta?.setId != null ? String(meta.setId) : ref.setId,
                thumbUrl: String(meta?.thumbUrl || ''),
                assetCount: Number.isFinite(Number(meta?.assetCount)) ? Number(meta?.assetCount) : null,
                setKind,
                at: job.finishedAt || job.createdAt || new Date(0).toISOString(),
            });
        }
        const removed = readRemovedRecentSetUrls();
        return [...byUrl.values()]
            .filter((item) => !removed.has(item.url))
            .sort((a, b) => String(b.at).localeCompare(String(a.at)))
            .slice(0, MAX_RECENT_SETS);
    }, [historyJobs, recentTick]);

    const recentSetsByCategory = useMemo(() => {
        const groups: Record<RecentSetCategory, RecentSetChip[]> = {
            posters: [],
            backgrounds: [],
            title_cards: [],
        };
        for (const item of recentSets) {
            groups[classifyRecentSet(item)].push(item);
        }
        return groups;
    }, [recentSets]);

    const selectedBulkCount = Object.keys(selectedBulkSets).length;
    const previewHeaderLabel = formatSetLabel(preview?.setMeta)
        || formatSetLabel(selectedSearchSet)
        || selectedSearchSet?.title
        || preview?.setMeta?.title
        || 'Poster set';

    const filteredHistory = historyFilter === 'audit'
        ? []
        : historyJobs.filter((job) => {
            const state = String(job.state || '').toLowerCase();
            if (historyFilter === 'running') return ['running', 'queued'].includes(state);
            if (historyFilter === 'succeeded') return ['succeeded', 'completed', 'success'].includes(state);
            if (historyFilter === 'warning') return ['warning', 'warn'].includes(state);
            if (historyFilter === 'failed') return ['failed', 'error'].includes(state);
            return true;
        }).filter((job) => {
            if (!historySearch.trim()) return true;
            const needle = historySearch.toLowerCase();
            const haystack = [
                job.id,
                job.type,
                job.state,
                job.error,
                jobTitle(job),
                ...(job.input?.urls || []),
            ].join(' ').toLowerCase();
            return haystack.includes(needle);
        });

    const filteredAudit = auditEntries.filter((entry) => {
        if (!historySearch.trim()) return true;
        const needle = historySearch.toLowerCase();
        const haystack = [
            entry.id,
            entry.action,
            entry.source,
            entry.state,
            entry.error,
            entry.detail,
            entry.jobId,
            entry.url,
            formatSetLabel(entry),
        ].join(' ').toLowerCase();
        return haystack.includes(needle);
    });
    return {
        toasts, setToasts, toast,
        tab, setTab,
        libraryDetailItem, setLibraryDetailItem,
        libraryDetailLayout, setLibraryDetailLayout,
        libraryViewMode, setLibraryViewMode,
        busy, setBusy,
        status, setStatus,
        configDraft, setConfigDraft,
        tvText, setTvText,
        movieText, setMovieText,
        whitelistText, setWhitelistText,
        blocklistText, setBlocklistText,
        url, setUrl,
        titleCardsOnly, setTitleCardsOnly,
        bulkText, setBulkText,
        findProvider, setFindProvider,
        findId, setFindId,
        searchProvider, setSearchProvider,
        searchMode, setSearchMode,
        searchQuery, setSearchQuery,
        searchTitles, setSearchTitles,
        searchSets, setSearchSets,
        searchSetsPage, setSearchSetsPage,
        searchSetsPageSize, setSearchSetsPageSize,
        searchLoadingMore, setSearchLoadingMore,
        searchContext, setSearchContext,
        creatorSearchAbortRef,
        resetSearchCatalogUi,
        selectedSearchTitle, setSelectedSearchTitle,
        selectedSearchSet, setSelectedSearchSet,
        advancedOpen, setAdvancedOpen,
        showInspectorAssets, setShowInspectorAssets,
        previewPanelRef,
        searchSetsSectionRef,
        recentTick, setRecentTick,
        gridSize, setGridSize,
        preview, setPreview,
        relatedSets, setRelatedSets,
        relatedSetsLoading, setRelatedSetsLoading,
        relatedSetsAbortRef,
        relatedSetsGenRef,
        browseLoadGenRef,
        queueLoadGenRef,
        watchesLoadGenRef,
        selectedAssetIds, setSelectedAssetIds,
        activeJob, setActiveJob,
        testResult, setTestResult,
        historyJobs, setHistoryJobs,
        historyFilter, setHistoryFilter,
        historySearch, setHistorySearch,
        selectedHistoryJob, setSelectedHistoryJob,
        selectedQueueJob, setSelectedQueueJob,
        auditEntries, setAuditEntries,
        queueJobs, setQueueJobs,
        queuePaused, setQueuePaused,
        queueStats, setQueueStats,
        watches, setWatches,
        watchStatsState, setWatchStatsState,
        watchUrlDraft, setWatchUrlDraft,
        watchesPage, setWatchesPage,
        watchesPageSize, setWatchesPageSize,
        watchesFilter, setWatchesFilter,
        watchesCategoryFilter, setWatchesCategoryFilter,
        selectedBulkSets, setSelectedBulkSets,
        browseRails, setBrowseRails,
        browseRailsRef,
        browseLoading, setBrowseLoading,
        browseSeeAllId, setBrowseSeeAllId,
        collectionSets, setCollectionSets,
        collectionGroups, setCollectionGroups,
        collectionsLoading, setCollectionsLoading,
        collectionsError, setCollectionsError,
        collectionsNeedsFollowers, setCollectionsNeedsFollowers,
        loadCollections,
        libraryShows, setLibraryShows,
        libraryMovies, setLibraryMovies,
        libraryLoading, setLibraryLoading,
        libraryError, setLibraryError,
        librarySearchQuery, setLibrarySearchQuery,
        librarySearchResults, setLibrarySearchResults,
        librarySearching, setLibrarySearching,
        librarySearchDebounceRef,
        libraryLoadGenRef,
        scrollPreviewAfterLoadRef,
        syncedSetUrlRef,
        titleCardsOnlyRef,
        deepLinkHandledRef,
        openCreatorCatalogRef,
        loadHistory,
        loadAudit,
        loadQueue,
        loadWatches,
        loadLibraryRecent,
        runLibrarySearch,
        loadBrowse,
        collapseSetInspector,
        dismissPreviewToSearch,
        pushPosterLocation,
        goToTab,
        goToPrimaryTab,
        goToDiscoverView,
        openBrowseRail,
        currentSetMeta,
        rememberRecentFromContext,
        load,
        openHistoryJob,
        openQueueJob,
        saveCreatorsConfig,
        blockCreator,
        saveSettings,
        importFromPortal,
        runTest,
        runPreview,
        expandSetInline,
        openSetForApply,
        openSetForApplyRef,
        filtersForSelectedIds,
        runApply,
        applyMatched,
        applyUnmatched,
        applyNewSinceWatch,
        toggleBulkSet,
        clearBulkSelection,
        selectBrowseSets,
        queueBulkSelected,
        watchBulkSelected,
        useFindId,
        posterGridClass,
        posterGridStyle,
        titleCardGridStyle,
        searchSetsUseTitleCardGrid,
        catalogError,
        runCatalogSearch,
        openCreatorCatalog,
        openTpdbRecentCatalog,
        openLibraryItem,
        closeLibraryItem,
        openSearchTitle,
        runLibraryItemSearch,
        pickSearchSet,
        backToTitles,
        clearSearch,
        matchedAssetCount,
        previewSections,
        searchSetsPageCount,
        pagedSearchSets,
        rankedSearchSets,
        searchResultsLoading,
        searchHasResults,
        searchEmptyLabel,
        loadingTitleSets,
        showSearchEmpty,
        showSearchSetGrid,
        watchedUrlSet,
        isSetWatched,
        filteredWatches,
        watchGroups,
        watchGroupsByCategory,
        categoryFilteredWatchGroups,
        watchesPageCount,
        pagedWatchGroups,
        pagedWatchGroupsByCategory,
        promoteWatchArtKind,
        readyToApply,
        inspectorOpen,
        matchedThumbStrip,
        queueEntireWithConfirm,
        browseSeeAllRail,
        toggleAsset,
        selectPreviewAssets,
        runBulk,
        toggleFilter,
        jobLogs,
        selectedLogs,
        selectedQueueLogs,
        recentSets,
        recentSetsByCategory,
        selectedBulkCount,
        previewHeaderLabel,
        filteredHistory,
        filteredAudit,
        initialUrlState,
        initialLocation,
    };
}
