import React from 'react';
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
    formatSetLabel,
    formatTime,
    isTitleCardRail,
    isTitleCardSet,
    jobCardTone,
    jobSetMeta,
    jobTitle,
    listToText,
    posterMediaRadiusClass,
    primaryButtonClass,
    providerLabel,
    sectionBodyClass,
    sectionTitleClass,
    textToList,
    upsertRecentSet,
} from '../shared';
import { usePosterSetsDashboard } from '../PosterSetsDashboardContext';

export const PosterSetsBrowseView: React.FC = () => {
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
    if (tab !== 'browse') return null;
    return (



        <section className={`${cardClass} space-y-5 p-4 sm:p-5`}>
                    {inspectorOpen && tab === 'browse' ? (
                        <SetInspector
                            panelRef={previewPanelRef}
                            set={selectedSearchSet}
                            headerLabel={previewHeaderLabel}
                            loading={busy === 'preview'}
                            ready={readyToApply}
                            matchedCount={matchedAssetCount}
                            unmatchedCount={preview?.unmatched ?? 0}
                            totalCount={preview?.total || 0}
                            selectedCount={selectedAssetIds.length}
                            titleCardsOnly={titleCardsOnly}
                            showAssets={showInspectorAssets}
                            busy={busy}
                            assets={preview?.assets}
                            onChangeSelectedIds={setSelectedAssetIds}
                            onToggleShowAssets={() => setShowInspectorAssets((value) => !value)}
                            onQueueMatched={() => void applyMatched()}
                            onQueueSelected={() => void runApply(true)}
                            onQueueEntire={() => void queueEntireWithConfirm()}
                            onQueueUnmatched={() => void applyUnmatched()}
                            onQueueNewSinceWatch={() => void applyNewSinceWatch()}
                            onSelectMatched={() => selectPreviewAssets('matched')}
                            onSelectAll={() => selectPreviewAssets('all')}
                            onClearSelection={() => selectPreviewAssets('none')}
                            onClose={() => collapseSetInspector({ scrollToSets: false })}
                            closeLabel="Back"
                            thumbStrip={(
                                <SetInspectorThumbStrip
                                    thumbs={matchedThumbStrip}
                                    layout={titleCardsOnly || isTitleCardSet(selectedSearchSet) ? 'landscape' : 'poster'}
                                    setUrl={selectedSearchSet?.url}
                                    provider={selectedSearchSet?.provider}
                                />
                            )}
                            gallery={(
                                <PreviewAssetGallery
                                    sections={previewSections}
                                    selectedAssetIds={selectedAssetIds}
                                    onToggle={toggleAsset}
                                />
                            )}
                            relatedRail={(
                                <RelatedSetsRail
                                    sets={relatedSets}
                                    loading={relatedSetsLoading}
                                    mediaLabel={inferPreviewMediaType(preview) === 'show' ? 'show' : 'movie'}
                                    disabled={busy !== null}
                                    onOpen={(item) => void expandSetInline(item, { stayOnTab: true, toggle: false, skipUrl: true })}
                                    onOpenCreator={openCreatorCatalog}
                                />
                            )}
                        />
                    ) : browseSeeAllRail ? (
                        <>
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0 max-w-3xl">
                                    <button
                                        type="button"
                                        className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-plex hover:underline"
                                        onClick={() => openBrowseRail(null)}
                                    >
                                        <ChevronLeft className="h-3.5 w-3.5" />
                                        Back to Browse
                                    </button>
                                    <h2 className={sectionTitleClass}>{browseSeeAllRail.title}</h2>
                                    <p className={sectionBodyClass}>
                                        {browseSeeAllRail.buffered || browseSeeAllRail.sets.length}
                                        {browseSeeAllRail.cap ? ` / ${browseSeeAllRail.cap}` : ''} sets
                                        {browseSeeAllRail.loading ? ' · loading more in the background…' : ''}
                                    </p>
                                    {browseSeeAllRail.error ? (
                                        <p className="mt-1 text-xs text-amber-200">{browseSeeAllRail.error}</p>
                                    ) : null}
                                </div>
                                <div className="flex shrink-0 flex-wrap items-center gap-2">
                                    <PosterSetsGridSizeSlider
                                        value={gridSize}
                                        onChange={setGridSize}
                                        className="w-full min-w-[140px] sm:w-auto"
                                    />
                                    <button
                                        type="button"
                                        className={buttonClass}
                                        disabled={browseLoading || busy !== null}
                                        onClick={() => void loadBrowse({ refresh: true })}
                                    >
                                        {browseLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                        Refresh
                                    </button>
                                    {browseSeeAllRail.sets.length ? (
                                        <button
                                            type="button"
                                            className={buttonClass}
                                            disabled={busy !== null}
                                            onClick={() => selectBrowseSets(browseSeeAllRail.sets)}
                                        >
                                            Select all
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                            <div className={posterGridClass} style={isTitleCardRail(browseSeeAllRail) ? titleCardGridStyle : posterGridStyle}>
                                {browseSeeAllRail.sets.map((set) => (
                                    <BrowseSetCard
                                        key={`${set.provider}-${set.setId}`}
                                        set={set}
                                        disabled={busy !== null}
                                        bulkSelected={Boolean(selectedBulkSets[set.url])}
                                        onToggleBulk={() => toggleBulkSet(bulkEntryFromSet(set))}
                                        expanded={Boolean(selectedSearchSet && relatedSetKey(selectedSearchSet) === relatedSetKey(set))}
                                        onOpen={(item) => void expandSetInline(item, { stayOnTab: true, toggle: true, skipUrl: true })}
                                        onOpenCreator={openCreatorCatalog}
                                    />
                                ))}
                            </div>
                            {!browseSeeAllRail.sets.length && browseLoading ? (
                                <div className="flex items-center gap-2 text-sm text-muted">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Loading sets…
                                </div>
                            ) : null}
                        </>
                    ) : (
                        <>
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0 max-w-3xl">
                                    <h2 className={sectionTitleClass}>Browse recently added</h2>
                                    <p className={sectionBodyClass}>
                                        Newest sets show first; more fill in the background (up to 600 per row) without reshuffling the first page. Tap a row title to see all.
                                        Check sets to queue many at once without opening each one.
                                    </p>
                                </div>
                                <div className="flex shrink-0 flex-wrap items-center gap-2">
                                    <PosterSetsGridSizeSlider
                                        value={gridSize}
                                        onChange={setGridSize}
                                        className="w-full min-w-[140px] sm:w-auto"
                                    />
                                    <button
                                        type="button"
                                        className={buttonClass}
                                        disabled={browseLoading || busy !== null}
                                        onClick={() => void loadBrowse({ refresh: true })}
                                    >
                                        {browseLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                        Refresh
                                    </button>
                                </div>
                            </div>
                            <PosterSetsCreatorsPanel
                                collapsible
                                creators={textToList(whitelistText).map((item) => item.replace(/^@+/, ''))}
                                busy={busy}
                                onChange={(next) => {
                                    setWhitelistText(listToText(next));
                                    setConfigDraft((prev) => ({ ...prev, creatorWhitelist: next }));
                                }}
                                onSave={saveCreatorsConfig}
                                onOpenCreator={openCreatorCatalog}
                                toast={toast}
                            />
                            {browseLoading && !browseRails.length ? (
                                <div className="flex items-center gap-2 text-sm text-muted">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Loading rails…
                                </div>
                            ) : null}
                            {browseRails.map((rail) => (
                                <div key={rail.id} className="space-y-2.5">
                                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                                        <button
                                            type="button"
                                            className="group inline-flex min-w-0 items-center gap-2 text-left"
                                            onClick={() => openBrowseRail(rail.id)}
                                        >
                                            <h3 className="text-sm font-bold text-text group-hover:text-plex sm:text-base">
                                                {rail.title}
                                            </h3>
                                            <span className="text-[11px] font-semibold uppercase tracking-wide text-plex/80 group-hover:underline">
                                                See all
                                            </span>
                                        </button>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-[11px] text-muted">
                                                {rail.buffered || rail.sets.length}
                                                {rail.cap ? ` / ${rail.cap}` : ''}
                                                {rail.loading ? ' · loading…' : ''}
                                            </span>
                                            {rail.sets.length ? (
                                                <button
                                                    type="button"
                                                    className="text-[11px] font-semibold text-plex hover:underline"
                                                    disabled={busy !== null}
                                                    onClick={() => selectBrowseSets(rail.sets.slice(0, 24))}
                                                >
                                                    Select row
                                                </button>
                                            ) : null}
                                        </div>
                                    </div>
                                    {rail.error ? (
                                        <p className="text-xs text-amber-200">{rail.error}</p>
                                    ) : null}
                                    <div className={posterGridClass} style={isTitleCardRail(rail) ? titleCardGridStyle : posterGridStyle}>
                                        {rail.sets.slice(0, 24).map((set) => (
                                            <BrowseSetCard
                                                key={`${set.provider}-${set.setId}`}
                                                set={set}
                                                disabled={busy !== null}
                                                bulkSelected={Boolean(selectedBulkSets[set.url])}
                                                expanded={Boolean(selectedSearchSet && relatedSetKey(selectedSearchSet) === relatedSetKey(set))}
                                                onToggleBulk={() => toggleBulkSet(bulkEntryFromSet(set))}
                                                onOpen={(item) => void expandSetInline(item, { stayOnTab: true, toggle: true, skipUrl: true })}
                                                onOpenCreator={openCreatorCatalog}
                                            />
                                        ))}
                                    </div>
                                    {!rail.sets.length && !rail.error ? (
                                        <p className="py-6 text-sm text-muted">No sets yet.</p>
                                    ) : null}
                                    {rail.sets.length > 24 ? (
                                        <button
                                            type="button"
                                            className="text-xs font-semibold text-plex hover:underline"
                                            onClick={() => openBrowseRail(rail.id)}
                                        >
                                            See all {rail.sets.length} sets
                                        </button>
                                    ) : null}
                                </div>
                            ))}
                        </>
                    )}
                </section>
    
    
    
    );
};
