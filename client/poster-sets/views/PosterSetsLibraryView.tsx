import React, { useEffect, useMemo, useState } from 'react';
import {
    CheckCircle2,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ChevronUp,
    Clock,
    Download,
    ExternalLink,
    Eye,
    History,
    Image as ImageIcon,
    Loader2,
    Pause,
    Play,
    RefreshCw,
    RotateCcw,
    Save,
    Search,
    Sparkles,
    Trash2,
    User,
    X,
} from 'lucide-react';
import { PosterSetsGridSizeSlider } from '../shared';
import { CustomSelect, SettingsToggleRow } from '../../shared/ui';
import { askConfirm } from '../../shared/confirm';
import { posterSetsApi } from '../api';
import { MEDIUX_FILTER_OPTIONS } from '../types';
import { PosterSetsSetupChecklist } from '../PosterSetsSetupChecklist';
import { PosterSetsLibraryBrowse } from '../PosterSetsLibraryBrowse';
import { PosterSetsCreatorsPanel } from '../PosterSetsCreatorsPanel';
import { SetInspector, SetInspectorThumbStrip } from '../SetInspector';
import { inferPreviewMediaType, relatedSetKey } from '../posterSetsDashboardUtils';
import {
    ALL_MEDIUX_FILTER_IDS,
    BrowseSetCard,
    CreatorPill,
    LibraryMediaCard,
    MetaPill,
    PreviewAssetGallery,
    ProviderPill,
    RECENT_CATEGORY_ORDER,
    RelatedSetsRail,
    SEARCH_SETS_PAGE_SIZE,
    SetKindPill,
    StatusPill,
    WATCHES_PAGE_SIZE_OPTIONS,
    bulkEntryFromSet,
    buttonClass,
    cardClass,
    fieldClass,
    nativeSearchCancelHiddenClass,
    formatSetLabel,
    formatTime,
    isTitleCardRail,
    isTitleCardSet,
    isCopyLibraryTitleEnabled,
    isTpdbEnabled,
    jobCardTone,
    jobSetMeta,
    jobTitle,
    posterMediaRadiusClass,
    providerLabel,
    sectionBodyClass,
    sectionTitleClass,
    textToList,
    upsertRecentSet,
} from '../shared';
import { usePosterSetsDashboard } from '../PosterSetsDashboardContext';
import { useTpdbCoverageMap } from '../shared/useTpdbCoverageMap';
import { coverageKeyForItem } from '../shared/tpdbCacheUi';
import { libraryItemIsWatching, type PosterSetsWatchingIndex } from '../watchingIndex';

export const PosterSetsLibraryView: React.FC = () => {
    const {
        toasts,
        setToasts,
        toast,
        tab,
        setTab,
        libraryDetailItem,
        setLibraryDetailItem,
        libraryViewMode,
        setLibraryViewMode,
        busy,
        setBusy,
        status,
        setStatus,
        configDraft,
        setConfigDraft,
        tvText,
        setTvText,
        movieText,
        setMovieText,
        whitelistText,
        setWhitelistText,
        url,
        setUrl,
        titleCardsOnly,
        setTitleCardsOnly,
        bulkText,
        setBulkText,
        findProvider,
        setFindProvider,
        findId,
        setFindId,
        searchProvider,
        setSearchProvider,
        searchMode,
        setSearchMode,
        searchQuery,
        setSearchQuery,
        searchTitles,
        setSearchTitles,
        searchSets,
        setSearchSets,
        searchSetsPage,
        setSearchSetsPage,
        searchLoadingMore,
        setSearchLoadingMore,
        searchContext,
        setSearchContext,
        creatorSearchAbortRef,
        selectedSearchTitle,
        setSelectedSearchTitle,
        selectedSearchSet,
        setSelectedSearchSet,
        advancedOpen,
        setAdvancedOpen,
        showInspectorAssets,
        setShowInspectorAssets,
        previewPanelRef,
        searchSetsSectionRef,
        recentTick,
        setRecentTick,
        gridSize,
        setGridSize,
        preview,
        setPreview,
        relatedSets,
        setRelatedSets,
        relatedSetsLoading,
        setRelatedSetsLoading,
        relatedSetsAbortRef,
        relatedSetsGenRef,
        browseLoadGenRef,
        queueLoadGenRef,
        watchesLoadGenRef,
        selectedAssetIds,
        setSelectedAssetIds,
        activeJob,
        setActiveJob,
        testResult,
        setTestResult,
        historyJobs,
        setHistoryJobs,
        historyFilter,
        setHistoryFilter,
        historySearch,
        setHistorySearch,
        selectedHistoryJob,
        setSelectedHistoryJob,
        selectedQueueJob,
        setSelectedQueueJob,
        auditEntries,
        setAuditEntries,
        queueJobs,
        setQueueJobs,
        queuePaused,
        setQueuePaused,
        queueStats,
        setQueueStats,
        watches,
        setWatches,
        watchStatsState,
        setWatchStatsState,
        watchUrlDraft,
        setWatchUrlDraft,
        watchesPage,
        setWatchesPage,
        watchesPageSize,
        setWatchesPageSize,
        watchesFilter,
        setWatchesFilter,
        selectedBulkSets,
        setSelectedBulkSets,
        browseRails,
        setBrowseRails,
        browseRailsRef,
        browseLoading,
        setBrowseLoading,
        browseSeeAllId,
        setBrowseSeeAllId,
        libraryShows,
        setLibraryShows,
        libraryMovies,
        setLibraryMovies,
        libraryLoading,
        setLibraryLoading,
        libraryError,
        setLibraryError,
        librarySearchQuery,
        setLibrarySearchQuery,
        librarySearchResults,
        setLibrarySearchResults,
        librarySearching,
        setLibrarySearching,
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
        runCatalogSearch,
        openCreatorCatalog,
        openLibraryItem,
        openSearchTitle,
        runLibraryItemSearch,
        pickSearchSet,
        backToTitles,
        clearSearch,
        matchedAssetCount,
        previewSections,
        searchSetsPageCount,
        pagedSearchSets,
        searchResultsLoading,
        searchHasResults,
        searchEmptyLabel,
        showSearchEmpty,
        watchedUrlSet,
        isSetWatched,
        filteredWatches,
        watchGroups,
        watchesPageCount,
        pagedWatchGroups,
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
    } = usePosterSetsDashboard();

    const coverageItems = useMemo(() => {
        const rows = libraryViewMode === 'recent' && librarySearchQuery.trim().length >= 2
            ? librarySearchResults
            : [...libraryMovies, ...libraryShows];
        return rows.filter((item) => coverageKeyForItem(item));
    }, [libraryViewMode, librarySearchQuery, librarySearchResults, libraryMovies, libraryShows]);
    const { levelFor } = useTpdbCoverageMap(coverageItems, tab === 'library' && isTpdbEnabled(configDraft));
    const [watchingIndex, setWatchingIndex] = useState<PosterSetsWatchingIndex | null>(null);

    useEffect(() => {
        if (tab !== 'library') return undefined;
        let cancelled = false;
        void posterSetsApi.watchingIndex()
            .then((data) => {
                if (cancelled) return;
                setWatchingIndex({
                    ratingKeys: data.ratingKeys || [],
                    titleKeys: data.titleKeys || [],
                    tmdbIds: data.tmdbIds || [],
                });
            })
            .catch(() => {
                if (!cancelled) setWatchingIndex(null);
            });
        return () => { cancelled = true; };
    }, [tab, watches]);

    if (tab !== 'library') return null;
    return (



        <section className={`${cardClass} space-y-6 p-4 sm:p-5`}>
                    <PosterSetsSetupChecklist
                        status={status}
                        hasToken={Boolean(configDraft.hasToken || (configDraft.token && configDraft.token !== '********'))}
                        hasTvLibraries={Boolean(tvText.trim())}
                        hasMovieLibraries={Boolean(movieText.trim())}
                        testing={busy === 'test'}
                        testResult={testResult}
                        onOpenSettings={() => goToPrimaryTab('settings')}
                        onTestConnection={() => void runTest()}
                    />
                    <div className="space-y-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 flex-1 max-w-3xl">
                                <h2 className={sectionTitleClass}>Library</h2>
                                <p className={sectionBodyClass}>
                                    Recently added movies and TV from every {status?.mediaServerLabel || 'media server'} library.
                                    Click a title to browse poster sets without leaving your library.
                                </p>
                                {libraryError ? (
                                    <p className="mt-2 text-xs text-amber-200">{libraryError}</p>
                                ) : null}
                            </div>
                            <div className="inline-flex shrink-0 self-start rounded-xl border border-white/10 bg-black/20 p-0.5">
                                {([
                                    ['recent', 'Recent'],
                                    ['browse', 'Browse all'],
                                ] as const).map(([id, label]) => (
                                    <button
                                        key={id}
                                        type="button"
                                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition sm:px-4 sm:text-sm ${
                                            libraryViewMode === id
                                                ? 'bg-plex text-background'
                                                : 'text-muted hover:text-text'
                                        }`}
                                        onClick={() => setLibraryViewMode(id)}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {libraryViewMode === 'recent' ? (
                            <div className="grid gap-3 border-t border-white/10 pt-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-3">
                                <div className="relative min-w-0">
                                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                                    <input
                                        type="text"
                                        inputMode="search"
                                        enterKeyHint="search"
                                        value={librarySearchQuery}
                                        onChange={(e) => setLibrarySearchQuery(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') void runLibrarySearch(librarySearchQuery);
                                        }}
                                        placeholder={`Search ${status?.mediaServerLabel || 'media server'} for a movie or show…`}
                                        aria-label={`Search ${status?.mediaServerLabel || 'media server'} library`}
                                        className={`${fieldClass} ${nativeSearchCancelHiddenClass} w-full pl-10 ${librarySearchQuery.trim() ? 'pr-[4.75rem]' : 'pr-11'}`}
                                    />
                                    <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                                        {librarySearchQuery.trim() ? (
                                            <button
                                                type="button"
                                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-white/10 hover:text-text"
                                                aria-label="Clear search"
                                                onClick={() => {
                                                    setLibrarySearchQuery('');
                                                    setLibrarySearchResults([]);
                                                }}
                                            >
                                                <X className="h-4 w-4" />
                                            </button>
                                        ) : null}
                                        <button
                                            type="button"
                                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-plex text-background transition hover:bg-plex-hover disabled:pointer-events-none disabled:opacity-40"
                                            aria-label="Search library"
                                            disabled={librarySearching || librarySearchQuery.trim().length < 2}
                                            onClick={() => void runLibrarySearch(librarySearchQuery)}
                                        >
                                            {librarySearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                                        </button>
                                    </div>
                                </div>
                                <div className="flex shrink-0 items-center justify-end gap-2 md:justify-self-end">
                                    <PosterSetsGridSizeSlider
                                        value={gridSize}
                                        onChange={setGridSize}
                                        className="min-w-[9.5rem]"
                                    />
                                    <button
                                        type="button"
                                        className={buttonClass}
                                        disabled={libraryLoading || busy !== null}
                                        title="Refresh recently added"
                                        onClick={() => void loadLibraryRecent({ refresh: true })}
                                    >
                                        {libraryLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                        <span className="hidden sm:inline">Refresh</span>
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <p className="border-t border-white/10 pt-4 text-xs text-muted sm:text-sm">
                                Browse your full library by section, type, and sort order.
                            </p>
                        )}
                    </div>
        
                    {libraryViewMode === 'browse' ? (
                        <PosterSetsLibraryBrowse
                            disabled={busy !== null}
                            gridSize={gridSize}
                            onGridSizeChange={(size) => setGridSize(size)}
                            onOpenItem={openLibraryItem}
                            showTpdbCoverage={isTpdbEnabled(configDraft)}
                            showCopyTitle={isCopyLibraryTitleEnabled(configDraft)}
                            watchingIndex={watchingIndex}
                        />
                    ) : null}
        
                    {libraryViewMode === 'recent' && librarySearchQuery.trim().length >= 2 ? (
                        <div className="space-y-3">
                            <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
                                <h3 className="text-sm font-bold text-text sm:text-base">
                                    Search results
                                    {librarySearchQuery.trim() ? ` · "${librarySearchQuery.trim()}"` : ''}
                                </h3>
                                <span className="text-[11px] text-muted">
                                    {librarySearching ? 'Searching…' : `${librarySearchResults.length} found`}
                                </span>
                            </div>
                            {librarySearching && !librarySearchResults.length ? (
                                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Searching your library…
                                </div>
                            ) : null}
                            {!librarySearching && !librarySearchResults.length ? (
                                <p className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted">
                                    No movies or TV shows matched that search on your media server.
                                </p>
                            ) : null}
                            {librarySearchResults.length ? (
                                <div className={posterGridClass} style={posterGridStyle}>
                                    {librarySearchResults.map((item) => (
                                        <LibraryMediaCard
                                            key={`library-search-${item.mediaType}-${item.id}`}
                                            item={item}
                                            disabled={busy !== null}
                                            onOpen={openLibraryItem}
                                            cacheLevel={levelFor(item)}
                                            showCopyTitle={isCopyLibraryTitleEnabled(configDraft)}
                                            watching={libraryItemIsWatching(item, watchingIndex)}
                                        />
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    ) : null}
        
                    {libraryViewMode === 'recent' && !librarySearchQuery.trim() && libraryLoading && !libraryShows.length && !libraryMovies.length ? (
                        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading recently added…
                        </div>
                    ) : null}
        
                    {libraryViewMode === 'recent' && !librarySearchQuery.trim() && !libraryLoading && !libraryShows.length && !libraryMovies.length && !libraryError ? (
                        <p className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted">
                            No recently added movies or TV found on your media server.
                        </p>
                    ) : null}
        
                    {libraryViewMode === 'recent' && !librarySearchQuery.trim() && libraryMovies.length ? (
                        <div className="space-y-3">
                            <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
                                <h3 className="text-sm font-bold text-text sm:text-base">Movies</h3>
                                <span className="text-[11px] text-muted">{libraryMovies.length}</span>
                            </div>
                            <div className={posterGridClass} style={posterGridStyle}>
                                {libraryMovies.map((item) => (
                                    <LibraryMediaCard
                                        key={`library-movie-${item.id}`}
                                        item={item}
                                        disabled={busy !== null}
                                        onOpen={openLibraryItem}
                                        cacheLevel={levelFor(item)}
                                        showCopyTitle={isCopyLibraryTitleEnabled(configDraft)}
                                        watching={libraryItemIsWatching(item, watchingIndex)}
                                    />
                                ))}
                            </div>
                        </div>
                    ) : null}
        
                    {libraryViewMode === 'recent' && !librarySearchQuery.trim() && libraryShows.length ? (
                        <div className="space-y-3">
                            <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
                                <h3 className="text-sm font-bold text-text sm:text-base">TV shows</h3>
                                <span className="text-[11px] text-muted">{libraryShows.length}</span>
                            </div>
                            <div className={posterGridClass} style={posterGridStyle}>
                                {libraryShows.map((item) => (
                                    <LibraryMediaCard
                                        key={`library-show-${item.id}`}
                                        item={item}
                                        disabled={busy !== null}
                                        onOpen={openLibraryItem}
                                        cacheLevel={levelFor(item)}
                                        showCopyTitle={isCopyLibraryTitleEnabled(configDraft)}
                                        watching={libraryItemIsWatching(item, watchingIndex)}
                                    />
                                ))}
                            </div>
                        </div>
                    ) : null}
                </section>
    
    
    
    );
};
