import React from 'react';
import {
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
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
    Search,
    Trash2,
    User,
    UserCheck,
    UserPlus,
    X,
} from 'lucide-react';
import { CustomSelect, SettingsToggleRow } from '../../shared/ui';
import { askConfirm } from '../../shared/confirm';
import { posterSetsApi } from '../api';
import { portalUrl } from '../../shared/basePath';
import { MEDIUX_FILTER_OPTIONS } from '../types';
import { PosterSetsSetupChecklist } from '../PosterSetsSetupChecklist';
import { PosterSetsLibraryBrowse } from '../PosterSetsLibraryBrowse';
import { PosterSetsCreatorsPanel } from '../PosterSetsCreatorsPanel';
import { SetInspector, SetInspectorThumbStrip } from '../SetInspector';
import { PosterSetsGridSizeSlider } from '../shared/PosterSetsGridSizeSlider';
import { inferPreviewMediaType, relatedSetKey } from '../posterSetsDashboardUtils';
import {
    ALL_MEDIUX_FILTER_IDS,
    BrowseSetCard,
    CreatorPill,
    LibraryMediaCard,
    MetaPill,
    PreviewAssetGallery,
    ProviderCornerBadge,
    ProviderPill,
    RECENT_CATEGORY_ORDER,
    RelatedSetsRail,
    SEARCH_SETS_PAGE_SIZE_OPTIONS,
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
    jobErrorTextClass,
    jobSetMeta,
    jobTitle,
    normalizeSearchSetsPageSize,
    posterMediaRadiusClass,
    primaryButtonClass,
    providerLabel,
    sectionBodyClass,
    sectionTitleClass,
    textToList,
    upsertRecentSet,
    isMediuxEnabled,
    isTpdbSearchEnabled,
    posterSetsSearchScopeLabel,
} from '../shared';
import { usePosterSetsDashboard } from '../PosterSetsDashboardContext';

export const PosterSetsSearchView: React.FC = () => {
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
        titleCardsOnly,
        setTitleCardsOnly,
        findProvider,
        setFindProvider,
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
        searchSetsPageSize,
        setSearchSetsPageSize,
        searchLoadingMore,
        setSearchLoadingMore,
        searchContext,
        setSearchContext,
        resetSearchCatalogUi,
        selectedSearchTitle,
        setSelectedSearchTitle,
        selectedSearchSet,
        setSelectedSearchSet,
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
        loadingTitleSets,
        showSearchEmpty,
        showSearchSetGrid,
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
    if (tab !== 'apply') return null;
    return (



        <div className="min-w-0 space-y-4">
                    <section className={`${cardClass} min-w-0 space-y-4 overflow-hidden p-5`}>
                        {inspectorOpen ? (
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
                                        onOpen={(item) => void expandSetInline(item, { stayOnTab: true, toggle: false })}
                                        onOpenCreator={openCreatorCatalog}
                                    />
                                )}
                            />
                        ) : (
                        <div>
                            <label className="text-xs font-bold uppercase tracking-wide text-muted">Find poster sets</label>
                            <p className="mt-1 text-sm text-muted">
                                Search, open a set, then queue matched
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                                {([
                                    ...(isMediuxEnabled(configDraft) && isTpdbSearchEnabled(configDraft)
                                        ? [['both', 'Both'] as const]
                                        : []),
                                    ...(isMediuxEnabled(configDraft) ? [['mediux', 'MediUX'] as const] : []),
                                    ...(isTpdbSearchEnabled(configDraft) ? [['posterdb', 'ThePosterDB'] as const] : []),
                                ]).map(([id, label]) => (
                                    <button
                                        key={id}
                                        type="button"
                                        className={`${buttonClass} ${searchProvider === id ? 'border-plex/40 bg-plex/15 text-plex' : ''}`}
                                        onClick={() => {
                                            resetSearchCatalogUi();
                                            setSearchProvider(id);
                                            if (id !== 'both') setFindProvider(id);
                                            if (searchMode === 'recent' || searchMode === 'feed') {
                                                setSearchMode('title');
                                            }
                                        }}
                                    >
                                        {label}
                                    </button>
                                ))}
                                {([
                                    ['title', 'Title', Search],
                                    ['creator', 'Creator', User],
                                ] as const).map(([id, label, Icon]) => (
                                    <button
                                        key={id}
                                        type="button"
                                        className={`${buttonClass} ${searchMode === id ? 'border-plex/40 bg-plex/15 text-plex' : ''}`}
                                        onClick={() => {
                                            resetSearchCatalogUi();
                                            setSearchMode(id);
                                        }}
                                    >
                                        <Icon className="h-4 w-4" />
                                        {label}
                                    </button>
                                ))}
                                <a
                                    href={searchProvider === 'posterdb' ? 'https://theposterdb.com/' : 'https://mediux.pro/'}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={`${buttonClass} no-underline`}
                                >
                                    <ExternalLink className="h-4 w-4" />
                                    Browse site
                                </a>
                                <PosterSetsGridSizeSlider
                                    value={gridSize}
                                    onChange={setGridSize}
                                    className="ml-auto w-full min-w-[140px] sm:w-auto"
                                />
                            </div>
                            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                                <div className="relative min-w-0 flex-1">
                                    {searchMode === 'creator'
                                        ? <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                                        : <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />}
                                    <input
                                        className={`${fieldClass} pl-9`}
                                        value={searchQuery}
                                        onChange={(event) => setSearchQuery(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                                event.preventDefault();
                                                void runCatalogSearch();
                                            }
                                        }}
                                        placeholder={searchMode === 'creator'
                                            ? 'Creator username e.g. kaster / TheDoctor30'
                                            : 'Search titles e.g. The Matrix'}
                                    />
                                </div>
                                <button type="button" className={primaryButtonClass} disabled={busy !== null && busy !== 'search'} onClick={() => void runCatalogSearch()}>
                                    {busy === 'search' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                                    Search
                                </button>
                                {(searchQuery || searchTitles.length || searchSets.length || selectedSearchTitle || selectedSearchSet || preview) ? (
                                    <button
                                        type="button"
                                        className={buttonClass}
                                        disabled={busy !== null}
                                        onClick={clearSearch}
                                        title="Clear search and selection"
                                    >
                                        <X className="h-4 w-4" />
                                        Clear
                                    </button>
                                ) : null}
                            </div>
        
                            {(selectedSearchTitle || selectedSearchSet) ? (
                                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                                    {selectedSearchTitle ? (
                                        <button type="button" className={`${buttonClass} !py-1.5 text-xs`} onClick={() => void backToTitles()} disabled={busy !== null}>
                                            <ChevronLeft className="h-3.5 w-3.5" /> Titles
                                        </button>
                                    ) : null}
                                    {selectedSearchTitle ? (
                                        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-text">
                                            {selectedSearchTitle.title}
                                        </span>
                                    ) : null}
                                    {selectedSearchSet ? (
                                        <span className="inline-flex items-center gap-1.5 rounded-full border border-plex/30 bg-plex/10 px-2.5 py-1 text-plex">
                                            {formatSetLabel(preview?.setMeta)
                                                || formatSetLabel(selectedSearchSet)
                                                || selectedSearchSet.title
                                                || `Set #${selectedSearchSet.setId}`}
                                            <button
                                                type="button"
                                                className="rounded-full p-0.5 text-plex/80 hover:bg-plex/20 hover:text-plex"
                                                onClick={() => collapseSetInspector({ scrollToSets: false })}
                                                title="Close set"
                                                aria-label="Close set"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </span>
                                    ) : null}
                                    <button
                                        type="button"
                                        className="text-xs font-semibold text-muted hover:text-text"
                                        onClick={clearSearch}
                                    >
                                        Clear search
                                    </button>
                                </div>
                            ) : null}
        
                            <div ref={searchSetsSectionRef}>
                                {loadingTitleSets ? (
                                    <div className="mt-4 flex flex-col items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-10 text-sm text-muted">
                                        <Loader2 className="h-5 w-5 animate-spin text-plex" />
                                        Loading sets for {selectedSearchTitle?.title || 'this title'}…
                                    </div>
                                ) : searchResultsLoading && !searchHasResults ? (
                                    <div className="mt-4 flex flex-col items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-10 text-sm text-muted">
                                        <Loader2 className="h-5 w-5 animate-spin text-plex" />
                                        Searching {posterSetsSearchScopeLabel(searchProvider)}…
                                    </div>
                                ) : null}
        
                                {showSearchEmpty ? (
                                    <div className="mt-4 rounded-xl border border-dashed border-amber-400/25 bg-amber-500/5 px-4 py-8 text-center">
                                        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-black/25 text-muted">
                                            <ImageIcon className="h-5 w-5 opacity-60" />
                                        </div>
                                        <p className="text-sm font-semibold text-text">
                                            No poster sets found
                                            {searchEmptyLabel ? ` for "${searchEmptyLabel}"` : ''}
                                        </p>
                                        <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted">
                                            This title matched on your library, but {posterSetsSearchScopeLabel(searchProvider)} returned no sets.
                                            Try editing the search above, pick a different title match, or browse the sites directly.
                                        </p>
                                    </div>
                                ) : null}
                            </div>
        
                            {searchTitles.length && !selectedSearchTitle ? (
                                <div className="mt-4 space-y-2">
                                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Choose a title</p>
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                        {searchTitles.map((title) => (
                                            <button
                                                key={`${title.provider || findProvider}-${title.id}`}
                                                type="button"
                                                className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-2 text-left transition hover:border-plex/40 disabled:pointer-events-none disabled:opacity-40"
                                                disabled={busy === 'search'}
                                                onClick={() => void openSearchTitle(title)}
                                            >
                                                <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-black/40">
                                                    {title.thumbUrl ? (
                                                        <img
                                                            src={(
                                                                title.thumbUrl.startsWith('https://image.tmdb.org/')
                                                                || title.thumbUrl.startsWith('http://')
                                                                || title.thumbUrl.startsWith('https://')
                                                            )
                                                                ? title.thumbUrl
                                                                : title.thumbUrl.startsWith('/')
                                                                    ? portalUrl(title.thumbUrl)
                                                                    : posterSetsApi.imageUrl(title.thumbUrl)}
                                                            alt=""
                                                            className="h-full w-full object-cover"
                                                            loading="lazy"
                                                        />
                                                    ) : (
                                                        <div className="flex h-full items-center justify-center text-muted">
                                                            <ImageIcon className="h-4 w-4 opacity-40" />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-semibold text-text">{title.title}</p>
                                                    <p className="text-[11px] text-muted">
                                                        {title.inLibrary ? 'In library' : providerLabel(title.provider)}
                                                        {title.inLibrary && title.provider
                                                            ? ` · ${providerLabel(title.provider)}`
                                                            : ''}
                                                        {title.alsoOn?.length
                                                            ? ` · also ${title.alsoOn.map((entry) => providerLabel(entry.provider)).join(', ')}`
                                                            : ''}
                                                        {' · '}
                                                        {title.year || '—'}
                                                        {title.mediaType ? ` · ${title.mediaType}` : ''}
                                                    </p>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : null}
        
                            {showSearchSetGrid ? (
                                <div className="mt-4 space-y-2">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                                            <p className="text-xs font-bold uppercase tracking-wide text-muted">
                                                Poster sets{searchContext ? ` · ${searchContext}` : ''}
                                                {searchSets.length > searchSetsPageSize
                                                    ? ` · ${searchSets.length} sets`
                                                    : ''}
                                                {searchLoadingMore ? ' · loading more…' : ''}
                                            </p>
                                            {searchMode === 'creator' && searchQuery.trim() ? (() => {
                                                const handle = searchQuery.trim().replace(/^@+/, '');
                                                const whitelist = (configDraft.creatorWhitelist || [])
                                                    .map((entry) => String(entry).replace(/^@+/, ''))
                                                    .filter(Boolean);
                                                const followed = whitelist.some(
                                                    (entry) => entry.toLowerCase() === handle.toLowerCase(),
                                                );
                                                return (
                                                    <button
                                                        type="button"
                                                        className={`${buttonClass} ${followed ? 'border-plex/40 bg-plex/15 text-plex' : ''}`}
                                                        disabled={busy === 'save'}
                                                        onClick={async () => {
                                                            const next = followed
                                                                ? whitelist.filter((entry) => entry.toLowerCase() !== handle.toLowerCase())
                                                                : [...whitelist, handle];
                                                            try {
                                                                await saveCreatorsConfig({ creatorWhitelist: next });
                                                                toast(followed
                                                                    ? `Unfollowed @${handle}.`
                                                                    : `Following @${handle} — their sets appear in Browse → Following and rank first in searches.`);
                                                            } catch {
                                                                /* saveCreatorsConfig already toasts the failure */
                                                            }
                                                        }}
                                                    >
                                                        {followed ? <UserCheck className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                                                        {followed ? 'Following' : 'Follow'}
                                                    </button>
                                                );
                                            })() : null}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <CustomSelect
                                                value={String(searchSetsPageSize)}
                                                onChange={(value) => {
                                                    setSearchSetsPageSize(normalizeSearchSetsPageSize(value));
                                                    setSearchSetsPage(1);
                                                }}
                                                options={[...SEARCH_SETS_PAGE_SIZE_OPTIONS]}
                                                className="w-full min-w-[140px] sm:w-auto"
                                                compact
                                            />
                                            {searchSetsPageCount > 1 ? (
                                                <>
                                                    <button
                                                        type="button"
                                                        className={buttonClass}
                                                        disabled={(busy !== null && busy !== 'preview') || searchSetsPage <= 1}
                                                        onClick={() => setSearchSetsPage((page) => Math.max(1, page - 1))}
                                                    >
                                                        <ChevronLeft className="h-4 w-4" />
                                                        Prev
                                                    </button>
                                                    <span className="text-xs text-muted">
                                                        Page {Math.min(searchSetsPage, searchSetsPageCount)} / {searchSetsPageCount}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        className={buttonClass}
                                                        disabled={(busy !== null && busy !== 'preview') || searchSetsPage >= searchSetsPageCount}
                                                        onClick={() => setSearchSetsPage((page) => Math.min(searchSetsPageCount, page + 1))}
                                                    >
                                                        Next
                                                        <ChevronRight className="h-4 w-4" />
                                                    </button>
                                                </>
                                            ) : null}
                                        </div>
                                    </div>
                                    <div className={posterGridClass} style={searchSetsUseTitleCardGrid ? titleCardGridStyle : posterGridStyle}>
                                        {pagedSearchSets.map((set) => {
                                            const setTitle = String(set.title || '').trim() || `Set #${set.setId}`;
                                            const setLabel = formatSetLabel(set) || setTitle;
                                            const bulkSelected = Boolean(selectedBulkSets[set.url]);
                                            const watching = isSetWatched(set);
                                            const landscape = isTitleCardSet(set);
                                            const expanded = Boolean(selectedSearchSet && relatedSetKey(selectedSearchSet) === relatedSetKey(set));
                                            return (
                                            <div
                                                key={`${set.provider || findProvider}-${set.setId}`}
                                                className={`relative overflow-hidden ${posterMediaRadiusClass} border text-left transition ${
                                                    expanded
                                                        ? 'border-plex/60 bg-plex/10 ring-1 ring-plex/30'
                                                        : bulkSelected
                                                            ? 'border-plex/40 bg-black/20 ring-1 ring-plex/20'
                                                            : 'border-white/10 bg-black/20 hover:border-plex/40'
                                                }`}
                                            >
                                                <label
                                                    className="absolute left-2 top-2 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-white/20 bg-black/60"
                                                    onClick={(event) => event.stopPropagation()}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        className="h-3.5 w-3.5 accent-[var(--plex,#e5a00d)]"
                                                        checked={bulkSelected}
                                                        onChange={() => toggleBulkSet({
                                                            url: set.url,
                                                            title: set.title,
                                                            user: set.user,
                                                            thumbUrl: set.thumbUrl,
                                                            provider: set.provider,
                                                            setId: set.setId,
                                                        })}
                                                        onClick={(event) => event.stopPropagation()}
                                                        aria-label={`Select ${setLabel}`}
                                                    />
                                                </label>
                                                <button
                                                    type="button"
                                                    className="block w-full text-left"
                                                    disabled={busy !== null && busy !== 'preview' && busy !== 'search'}
                                                    onClick={() => void pickSearchSet(set)}
                                                >
                                                <div className={`relative overflow-hidden bg-black text-center ${landscape ? 'aspect-[16/9]' : 'aspect-[2/3]'}`}>
                                                    {set.thumbUrl ? (
                                                        <img
                                                            src={posterSetsApi.imageUrl(set.thumbUrl)}
                                                            alt={setLabel}
                                                            className="absolute inset-0 h-full w-full object-contain object-center"
                                                            loading="lazy"
                                                        />
                                                    ) : (
                                                        <div className="absolute inset-0 flex items-center justify-center text-muted">
                                                            <ImageIcon className="h-8 w-8 opacity-40" />
                                                        </div>
                                                    )}
                                                    {busy === 'preview' && expanded ? (
                                                        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                                                            <Loader2 className="h-6 w-6 animate-spin text-plex" />
                                                        </div>
                                                    ) : null}
                                                    <ProviderCornerBadge provider={set.provider} />
                                                </div>
                                                <div className="px-3 pt-3">
                                                    <p className="truncate text-sm font-semibold text-text" title={setTitle}>{setTitle}</p>
                                                </div>
                                                </button>
                                                <div className="flex flex-wrap items-center gap-1.5 px-3 pb-3 pt-1.5">
                                                    {watching ? (
                                                        <MetaPill className="border-plex/35 bg-plex/15 text-plex" truncate={false}>
                                                            Watching
                                                        </MetaPill>
                                                    ) : null}
                                                    <CreatorPill user={set.user} onOpen={openCreatorCatalog} />
                                                    <SetKindPill set={set} />
                                                    <ProviderPill provider={set.provider} />
                                                    {set.alsoOn?.length ? (
                                                        <span className="truncate text-[11px] text-muted">
                                                            also {set.alsoOn.map((entry) => providerLabel(entry.provider)).join(', ')}
                                                        </span>
                                                    ) : null}
                                                    {set.posterCount ? (
                                                        <span className="truncate text-[11px] text-muted">{set.posterCount}</span>
                                                    ) : null}
                                                </div>
                                            </div>
                                            );
                                        })}
                                    </div>
                                    {searchSetsPageCount > 1 ? (
                                        <div className="flex items-center justify-center gap-2 pt-1">
                                            <button
                                                type="button"
                                                className={buttonClass}
                                                disabled={(busy !== null && busy !== 'preview') || searchSetsPage <= 1}
                                                onClick={() => setSearchSetsPage((page) => Math.max(1, page - 1))}
                                            >
                                                <ChevronLeft className="h-4 w-4" />
                                                Prev
                                            </button>
                                            <span className="text-xs text-muted">
                                                Page {Math.min(searchSetsPage, searchSetsPageCount)} / {searchSetsPageCount}
                                            </span>
                                            <button
                                                type="button"
                                                className={buttonClass}
                                                disabled={(busy !== null && busy !== 'preview') || searchSetsPage >= searchSetsPageCount}
                                                onClick={() => setSearchSetsPage((page) => Math.min(searchSetsPageCount, page + 1))}
                                            >
                                                Next
                                                <ChevronRight className="h-4 w-4" />
                                            </button>
                                        </div>
                                    ) : null}
                                </div>
                            ) : null}
        
                            <div className="mt-5 border-t border-white/10 pt-4">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <h2 className="text-sm font-bold text-text">Paste a URL or ID?</h2>
                                        <p className="mt-1 text-xs text-muted">
                                            Manual set links, ThePosterDB title pages, and bulk import live under Paste / Import.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        className={buttonClass}
                                        onClick={() => goToPrimaryTab('paste')}
                                    >
                                        Open Paste / Import
                                    </button>
                                </div>
                            </div>
                        </div>
                        )}
                    </section>
        
                    {!inspectorOpen && activeJob ? (
                        <section className={`${cardClass} space-y-3 p-5`}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <h2 className="text-lg font-bold text-text">Job #{activeJob.id.slice(0, 8)}</h2>
                                <StatusPill value={activeJob.state} />
                            </div>
                            {activeJob.error ? <p className={`text-sm ${jobErrorTextClass(activeJob.state)}`}>{activeJob.error}</p> : null}
                            {activeJob.result && typeof activeJob.result.uploaded === 'number' ? (
                                <p className="text-sm text-emerald-300">
                                    Uploaded {String(activeJob.result.uploaded)} / {String(activeJob.result.attempted ?? activeJob.result.uploaded)}
                                </p>
                            ) : null}
                            <div className="max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-[11px] text-muted custom-scrollbar">
                                {jobLogs.length ? jobLogs.map((line, index) => (
                                    <p key={`${index}-${line.slice(0, 24)}`}>{line}</p>
                                )) : (
                                    <p>Waiting for progress…</p>
                                )}
                            </div>
                        </section>
                    ) : null}
                </div>
    
    
    
    );
};
