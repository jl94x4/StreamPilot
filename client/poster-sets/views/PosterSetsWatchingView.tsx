import React, { useState } from 'react';
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
    MoreHorizontal,
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
import { ModalPortal } from '../../shared/ModalPortal';
import { posterSetsApi } from '../api';
import { addWatchWithTitleReplaceConfirm } from '../pinWatch';
import { MEDIUX_FILTER_OPTIONS, type PosterSetsWatch } from '../types';
import { isPosterSetsUpstreamOutage } from '../upstreamErrors';
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
    PosterImageLightbox,
    PosterThumb,
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
    isMediuxEnabled,
    isTpdbEnabled,
    isLibraryPendingWatchError,
    jobCardTone,
    jobSetMeta,
    jobTitle,
    posterMediaRadiusClass,
    primaryButtonClass,
    providerLabel,
    sectionBodyClass,
    sectionTitleClass,
    textToList,
    upsertRecentSet,
} from '../shared';
import { usePosterSetsDashboard } from '../PosterSetsDashboardContext';

type WatchImagePreview = {
    src: string;
    title: string;
    setUrl: string;
    provider: string;
};

type ReapplyTarget = {
    watch: PosterSetsWatch;
    title: string;
};

type WatchSheetTarget = {
    watch: PosterSetsWatch;
    title: string;
    setLabel: string;
};

export const PosterSetsWatchingView: React.FC = () => {
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
        watchGroupsByCategory,
        watchesCategoryFilter,
        setWatchesCategoryFilter,
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
    } = usePosterSetsDashboard();
    const [imagePreview, setImagePreview] = useState<WatchImagePreview | null>(null);
    const [reapplyTarget, setReapplyTarget] = useState<ReapplyTarget | null>(null);
    const [watchSheet, setWatchSheet] = useState<WatchSheetTarget | null>(null);

    const sheetWatch = watchSheet?.watch || null;
    const sheetProvider = String(sheetWatch?.provider || '').toLowerCase();
    const sheetCreator = String(sheetWatch?.user || '').trim().replace(/^@/, '');
    const sheetFilterIds = sheetWatch?.mediuxFilters?.length
        ? sheetWatch.mediuxFilters
        : ALL_MEDIUX_FILTER_IDS;

    const runReapply = async (mode: 'entire' | 'matched') => {
        const target = reapplyTarget;
        if (!target) return;
        setReapplyTarget(null);
        setBusy('watches');
        try {
            const result = await posterSetsApi.reapplyWatch(target.watch.id, mode);
            await loadWatches();
            await loadQueue();
            if (result.mode === 'matched') {
                toast(`Queued ${result.selectedCount || 0} matched asset(s) for reapply.`);
            } else {
                toast('Queued full set reapply.');
            }
        } catch (error) {
            await loadWatches();
            toast(error instanceof Error ? error.message : 'Reapply failed', 'error');
        } finally {
            setBusy(null);
        }
    };

    const checkWatchNow = async (watch: PosterSetsWatch) => {
        setBusy('watches');
        try {
            const result = await posterSetsApi.checkWatch(watch.id);
            await loadWatches();
            await loadQueue();
            if (result.baseline) {
                toast('Baselined current assets.');
            } else if (result.queued) {
                toast(`Queued ${result.newIds?.length || 0} new asset(s).`);
            } else {
                toast('No new art on this set.');
            }
        } catch (error) {
            await loadWatches();
            const message = error instanceof Error ? error.message : 'Check failed';
            toast(message, isPosterSetsUpstreamOutage(message) ? undefined : 'error');
        } finally {
            setBusy(null);
        }
    };

    const dismissWatchError = async (watch: PosterSetsWatch) => {
        setBusy('watches');
        try {
            const response = await posterSetsApi.patchWatch(watch.id, { lastError: null });
            await loadWatches();
            setWatchSheet((current) => (
                current && current.watch.id === watch.id
                    ? { ...current, watch: { ...current.watch, lastError: null, ...(response.watch || {}) } }
                    : current
            ));
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to dismiss error', 'error');
        } finally {
            setBusy(null);
        }
    };

    const dismissAllWatchErrors = async () => {
        const errored = Number(watchStatsState.errored || 0);
        if (!errored) return;
        const confirmed = await askConfirm(
            `Dismiss ${errored} watch error${errored === 1 ? '' : 's'}? Pins stay — only the failed-check banners are cleared.`,
            { confirmLabel: 'Dismiss errors' },
        );
        if (!confirmed) return;
        setBusy('watches');
        try {
            const response = await posterSetsApi.clearWatchErrors();
            setWatches(response.watches || []);
            setWatchStatsState(response.stats || {});
            setWatchSheet((current) => (
                current ? { ...current, watch: { ...current.watch, lastError: null } } : current
            ));
            toast(response.cleared
                ? `Dismissed ${response.cleared} error${response.cleared === 1 ? '' : 's'}.`
                : 'No watch errors to dismiss.');
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to dismiss errors', 'error');
        } finally {
            setBusy(null);
        }
    };

    const toggleWatchEnabled = async (watch: PosterSetsWatch) => {
        setBusy('watches');
        try {
            const response = await posterSetsApi.toggleWatch(watch.id);
            await loadWatches();
            setWatchSheet((current) => (
                current && current.watch.id === watch.id
                    ? { ...current, watch: response.watch || current.watch }
                    : current
            ));
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Toggle failed', 'error');
        } finally {
            setBusy(null);
        }
    };

    const patchWatchFilters = async (watch: PosterSetsWatch, optionId: string) => {
        const base = watch.mediuxFilters?.length
            ? [...watch.mediuxFilters]
            : [...ALL_MEDIUX_FILTER_IDS];
        const next = new Set(base);
        if (next.has(optionId)) next.delete(optionId);
        else next.add(optionId);
        const mediuxFilters = ALL_MEDIUX_FILTER_IDS.filter((id) => next.has(id));
        setBusy('watches');
        try {
            const response = await posterSetsApi.patchWatch(watch.id, { mediuxFilters });
            await loadWatches();
            setWatchSheet((current) => (
                current && current.watch.id === watch.id
                    ? { ...current, watch: response.watch || { ...current.watch, mediuxFilters } }
                    : current
            ));
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Failed to update filters', 'error');
        } finally {
            setBusy(null);
        }
    };

    const removeWatchNow = async (watch: PosterSetsWatch, setLabel: string, title: string) => {
        const ok = await askConfirm(`Remove ${setLabel} watch for "${title}"?`, {
            title: 'Remove watch?',
            confirmLabel: 'Remove',
            cancelLabel: 'Cancel',
        });
        if (!ok) return;
        setWatchSheet(null);
        setBusy('watches');
        try {
            await posterSetsApi.deleteWatch(watch.id);
            await loadWatches();
            toast('Watch removed.');
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Delete failed', 'error');
        } finally {
            setBusy(null);
        }
    };

    if (tab !== 'watches') return null;
    return (



        <section className={`${cardClass} min-w-0 space-y-5 overflow-hidden p-4 sm:p-5`}>
                    <PosterImageLightbox
                        open={Boolean(imagePreview)}
                        src={imagePreview?.src || ''}
                        title={imagePreview?.title}
                        setUrl={imagePreview?.setUrl}
                        provider={imagePreview?.provider}
                        onClose={() => setImagePreview(null)}
                    />
                    <ModalPortal open={Boolean(reapplyTarget)}>
                        <div
                            className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center sm:p-6"
                            onClick={() => setReapplyTarget(null)}
                            role="presentation"
                        >
                            <div
                                className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl"
                                role="dialog"
                                aria-modal="true"
                                aria-labelledby="poster-sets-reapply-title"
                                onClick={(event) => event.stopPropagation()}
                            >
                                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-plex">Reapply artwork</p>
                                <h3 id="poster-sets-reapply-title" className="mt-1 text-lg font-bold text-text">
                                    {reapplyTarget?.title || 'Pinned set'}
                                </h3>
                                <p className="mt-2 text-sm text-muted">
                                    Use after Plex rematches a title and drops art you already applied from this pin.
                                </p>
                                <div className="mt-5 flex flex-col gap-2">
                                    <button
                                        type="button"
                                        className={primaryButtonClass}
                                        disabled={busy !== null}
                                        onClick={() => void runReapply('entire')}
                                    >
                                        <RotateCcw className="h-4 w-4" />
                                        Entire set
                                    </button>
                                    <button
                                        type="button"
                                        className={buttonClass}
                                        disabled={busy !== null}
                                        onClick={() => void runReapply('matched')}
                                    >
                                        <CheckCircle2 className="h-4 w-4" />
                                        Matched assets only
                                    </button>
                                    <button
                                        type="button"
                                        className={buttonClass}
                                        disabled={busy !== null}
                                        onClick={() => setReapplyTarget(null)}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </div>
                    </ModalPortal>
                    <ModalPortal open={Boolean(watchSheet && sheetWatch)}>
                        <div
                            className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6"
                            onClick={() => setWatchSheet(null)}
                            role="presentation"
                        >
                            <div
                                className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:rounded-2xl"
                                role="dialog"
                                aria-modal="true"
                                aria-labelledby="poster-sets-watch-sheet-title"
                                onClick={(event) => event.stopPropagation()}
                            >
                                <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
                                    <div className="min-w-0">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-plex">Pinned set</p>
                                        <h3 id="poster-sets-watch-sheet-title" className="mt-1 truncate text-base font-bold text-text">
                                            {watchSheet?.title || 'Watch'}
                                        </h3>
                                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                            <ProviderPill provider={sheetProvider} compact />
                                            <CreatorPill user={sheetCreator} onOpen={openCreatorCatalog} compact />
                                            {sheetWatch?.enabled === false ? (
                                                <MetaPill className="border-white/15 bg-white/5 text-muted" compact>
                                                    Paused
                                                </MetaPill>
                                            ) : null}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 text-muted transition hover:border-white/20 hover:text-text"
                                        aria-label="Close"
                                        onClick={() => setWatchSheet(null)}
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>

                                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 custom-scrollbar sm:px-5">
                                    {sheetWatch?.lastError ? (
                                        <div className={`space-y-2 rounded-xl px-3 py-2 ${
                                            isLibraryPendingWatchError(sheetWatch.lastError)
                                                ? 'border border-amber-500/30 bg-amber-500/10'
                                                : 'border border-red-500/30 bg-red-500/10'
                                        }`}>
                                            <p className={`text-xs leading-relaxed ${
                                                isLibraryPendingWatchError(sheetWatch.lastError)
                                                    ? 'text-amber-100'
                                                    : 'text-red-200'
                                            }`}>
                                                {sheetWatch.lastError}
                                            </p>
                                            <button
                                                type="button"
                                                className={`${buttonClass} !justify-start min-h-9 text-xs`}
                                                disabled={busy !== null}
                                                onClick={() => void dismissWatchError(sheetWatch)}
                                            >
                                                <X className="h-3.5 w-3.5" /> Dismiss error
                                            </button>
                                        </div>
                                    ) : null}

                                    {sheetProvider === 'posterdb' ? (
                                        <p className="text-xs text-muted">ThePosterDB pins have no MediUX title-card filters.</p>
                                    ) : (
                                        <div className="space-y-2">
                                            <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Apply filters</p>
                                            <div className="grid grid-cols-2 gap-2">
                                                {MEDIUX_FILTER_OPTIONS.map((option) => {
                                                    const active = sheetFilterIds.includes(option.id);
                                                    return (
                                                        <button
                                                            key={option.id}
                                                            type="button"
                                                            className={`min-h-11 rounded-xl border px-3 py-2 text-left text-xs font-semibold transition ${
                                                                active
                                                                    ? 'border-plex/50 bg-plex/20 text-plex'
                                                                    : 'border-white/10 bg-black/20 text-muted hover:border-white/20 hover:text-text'
                                                            }`}
                                                            disabled={busy !== null || !sheetWatch}
                                                            onClick={() => {
                                                                if (!sheetWatch) return;
                                                                void patchWatchFilters(sheetWatch, option.id);
                                                            }}
                                                        >
                                                            {option.label}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    <div className="space-y-2">
                                        <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Actions</p>
                                        <div className="grid gap-2">
                                            <button
                                                type="button"
                                                className={`${buttonClass} !justify-start min-h-11`}
                                                disabled={busy !== null || !sheetWatch}
                                                onClick={() => {
                                                    if (!sheetWatch) return;
                                                    void toggleWatchEnabled(sheetWatch);
                                                }}
                                            >
                                                {sheetWatch?.enabled === false
                                                    ? <Play className="h-4 w-4" />
                                                    : <Pause className="h-4 w-4" />}
                                                {sheetWatch?.enabled === false ? 'Enable watch' : 'Pause watch'}
                                            </button>
                                            <button
                                                type="button"
                                                className={`${buttonClass} !justify-start min-h-11`}
                                                disabled={busy !== null || !sheetWatch}
                                                onClick={() => {
                                                    if (!sheetWatch || !watchSheet) return;
                                                    setWatchSheet(null);
                                                    setReapplyTarget({
                                                        watch: sheetWatch,
                                                        title: watchSheet.title,
                                                    });
                                                }}
                                            >
                                                <RotateCcw className="h-4 w-4" />
                                                Reapply set…
                                            </button>
                                            {String(sheetWatch?.url || '').trim() ? (
                                                <a
                                                    href={String(sheetWatch?.url || '').trim()}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className={`${buttonClass} !justify-start min-h-11 no-underline`}
                                                >
                                                    <ExternalLink className="h-4 w-4" />
                                                    Open on {providerLabel(sheetProvider)}
                                                </a>
                                            ) : null}
                                            <button
                                                type="button"
                                                className={`${buttonClass} !justify-start min-h-11 text-red-200 hover:border-red-400/40`}
                                                disabled={busy !== null || !sheetWatch || !watchSheet}
                                                onClick={() => {
                                                    if (!sheetWatch || !watchSheet) return;
                                                    void removeWatchNow(sheetWatch, watchSheet.setLabel, watchSheet.title);
                                                }}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                                Remove watch
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </ModalPortal>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 max-w-3xl">
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-plex">Pinned artwork</p>
                            <h2 className="mt-1 text-xl font-bold tracking-tight text-text sm:text-2xl">Watching</h2>
                            <p className={sectionBodyClass}>
                                Keep {[isMediuxEnabled(configDraft) && 'MediUX', isTpdbEnabled(configDraft) && 'ThePosterDB'].filter(Boolean).join(' and ') || 'pinned'} sets in view, grouped by posters and title cards. New art queues automatically.
                                Use Reapply if a Plex rematch wiped artwork you already set.
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <MetaPill className="border-plex/35 bg-plex/15 text-plex" truncate={false}>
                                    {watchStatsState.enabled || 0} live
                                </MetaPill>
                                <MetaPill className="border-white/15 bg-white/5 text-muted" truncate={false}>
                                    {watchStatsState.total || 0}{watchStatsState.max ? ` / ${watchStatsState.max}` : ''} pinned
                                </MetaPill>
                                {(watchStatsState.errored || 0) > 0 ? (
                                    <MetaPill className="border-red-400/35 bg-red-500/15 text-red-200" truncate={false}>
                                        {watchStatsState.errored} errors
                                    </MetaPill>
                                ) : null}
                                {configDraft.watchersEnabled === false ? (
                                    <MetaPill className="border-amber-400/35 bg-amber-500/15 text-amber-100" truncate={false}>
                                        Watchers paused in Settings
                                    </MetaPill>
                                ) : null}
                            </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                            <button
                                type="button"
                                className={buttonClass}
                                disabled={busy !== null}
                                onClick={() => void loadWatches()}
                            >
                                <RefreshCw className="h-4 w-4" /> Refresh
                            </button>
                            {(watchStatsState.errored || 0) > 0 ? (
                                <button
                                    type="button"
                                    className={buttonClass}
                                    disabled={busy !== null}
                                    title="Clear failed-check banners without removing pins"
                                    onClick={() => void dismissAllWatchErrors()}
                                >
                                    <X className="h-4 w-4" /> Dismiss errors
                                </button>
                            ) : null}
                            <button
                                type="button"
                                className={primaryButtonClass}
                                disabled={busy !== null || !watches.length}
                                onClick={async () => {
                                    setBusy('watches');
                                    try {
                                        const result = await posterSetsApi.runWatches();
                                        await loadWatches();
                                        await loadQueue();
                                        void loadAudit();
                                        if (result.started || result.running) {
                                            toast(result.message
                                                || 'Check all started in the background — open Logs → Audit log.');
                                            setHistoryFilter('audit');
                                            goToPrimaryTab('logs');
                                            return;
                                        }
                                        const checked = result.checked || 0;
                                        const queued = result.queued || 0;
                                        const assets = result.assetsQueued || 0;
                                        const errorItems = Array.isArray(result.errors) ? result.errors : [];
                                        const errors = errorItems.length;
                                        const allOutages = errors > 0 && errorItems.every((item) => isPosterSetsUpstreamOutage(item.error));
                                        toast(
                                            queued
                                                ? `Checked ${checked}; queued ${queued} watch(es) / ${assets} asset(s). See Logs → Audit.`
                                                : errors
                                                    ? allOutages
                                                        ? `Checked ${checked}; MediUX/ThePosterDB was unreachable (${errors}). Retry later, or dismiss the banners on these cards.`
                                                        : `Checked ${checked}; ${errors} error(s). See Logs → Audit.`
                                                    : `Checked ${checked}; nothing to apply. See Logs → Audit for the run.`,
                                            errors && !queued && !allOutages ? 'error' : undefined,
                                        );
                                    } catch (error) {
                                        const message = error instanceof Error ? error.message : 'Watcher run failed';
                                        toast(message, 'error');
                                        setHistoryFilter('audit');
                                        void loadAudit();
                                        goToPrimaryTab('logs');
                                    } finally {
                                        setBusy(null);
                                    }
                                }}
                            >
                                {busy === 'watches' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                                Check all now
                            </button>
                        </div>
                    </div>
        
                    <form
                        className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/20 p-3 sm:flex-row sm:items-center sm:p-3.5"
                        onSubmit={async (event) => {
                            event.preventDefault();
                            const target = watchUrlDraft.trim();
                            if (!target) {
                                toast('Paste a MediUX or ThePosterDB set URL.', 'error');
                                return;
                            }
                            setBusy('watches');
                            try {
                                const result = await addWatchWithTitleReplaceConfirm({ url: target });
                                if (result.cancelled) return;
                                setWatchUrlDraft('');
                                setWatchesPage(1);
                                await loadWatches();
                                toast(result.replaced
                                    ? 'Replaced the watched set for that title.'
                                    : 'Watch pinned. Current assets baselined — only future new art will queue.');
                            } catch (error) {
                                toast(error instanceof Error ? error.message : 'Failed to pin watch', 'error');
                            } finally {
                                setBusy(null);
                            }
                        }}
                    >
                        <input
                            className={`${fieldClass} border-white/10 bg-background/50`}
                            placeholder="Paste a MediUX or ThePosterDB set URL to pin…"
                            value={watchUrlDraft}
                            onChange={(event) => setWatchUrlDraft(event.target.value)}
                        />
                        <button type="submit" className={`${primaryButtonClass} shrink-0`} disabled={busy !== null}>
                            <Eye className="h-4 w-4" /> Pin set
                        </button>
                    </form>
        
                    {watches.length ? (
                        <div className="space-y-3">
                            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                                <input
                                    className={`${fieldClass} sm:max-w-sm`}
                                    placeholder="Filter by title, creator, URL…"
                                    value={watchesFilter}
                                    onChange={(event) => {
                                        setWatchesFilter(event.target.value);
                                        setWatchesPage(1);
                                    }}
                                />
                                <div className="flex flex-wrap items-center gap-2">
                                    <PosterSetsGridSizeSlider
                                        value={gridSize}
                                        onChange={setGridSize}
                                        className="w-full min-w-[140px] sm:w-auto"
                                    />
                                    {watchesCategoryFilter !== 'all' ? (
                                        <CustomSelect
                                            value={String(watchesPageSize)}
                                            onChange={(value) => {
                                                const next = Number(value) || 12;
                                                setWatchesPageSize(next);
                                                setWatchesPage(1);
                                            }}
                                            options={[...WATCHES_PAGE_SIZE_OPTIONS]}
                                            className="w-full min-w-[140px] sm:w-auto"
                                            compact
                                        />
                                    ) : null}
                                    <span className="text-xs text-muted">
                                        {watchGroups.length} title{watchGroups.length === 1 ? '' : 's'}
                                        {filteredWatches.length !== watches.length
                                            ? ` · ${filteredWatches.length} sets`
                                            : ''}
                                        {watchesFilter.trim() ? ` (of ${watches.length})` : ''}
                                    </span>
                                </div>
                            </div>
                            <div className="flex min-w-0 flex-wrap gap-1 sm:gap-1.5">
                                <button
                                    type="button"
                                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition sm:px-3 sm:text-xs ${
                                        watchesCategoryFilter === 'all'
                                            ? 'border-plex/40 bg-plex/15 text-plex'
                                            : 'border-white/10 bg-black/20 text-muted hover:border-plex/30 hover:text-text'
                                    }`}
                                    onClick={() => {
                                        setWatchesCategoryFilter('all');
                                        setWatchesPage(1);
                                    }}
                                >
                                    All
                                    <span className="ml-1 opacity-70">{watchGroups.length}</span>
                                </button>
                                {RECENT_CATEGORY_ORDER.map((category) => {
                                    const count = watchGroupsByCategory[category.id].length;
                                    if (!count) return null;
                                    return (
                                        <button
                                            key={category.id}
                                            type="button"
                                            className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition sm:px-3 sm:text-xs ${
                                                watchesCategoryFilter === category.id
                                                    ? 'border-plex/40 bg-plex/15 text-plex'
                                                    : 'border-white/10 bg-black/20 text-muted hover:border-plex/30 hover:text-text'
                                            }`}
                                            onClick={() => {
                                                setWatchesCategoryFilter(category.id);
                                                setWatchesPage(1);
                                            }}
                                        >
                                            {category.title}
                                            <span className="ml-1 opacity-70">{count}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ) : null}
        
                    {!watches.length ? (
                        <div className="rounded-xl border border-dashed border-white/15 bg-black/20 px-5 py-14 text-center">
                            <Eye className="mx-auto h-8 w-8 text-plex/70" />
                            <p className="mt-3 text-sm font-semibold text-text">Nothing watching yet</p>
                            <p className="mx-auto mt-1.5 max-w-md text-xs text-muted sm:text-sm">
                                Apply a set and keep watching, or pin a MediUX / TPDB URL above.
                                Sonarr On Import also refreshes matching watches after a short debounce.
                            </p>
                        </div>
                    ) : !filteredWatches.length ? (
                        <div className="rounded-xl border border-dashed border-white/15 bg-black/20 px-5 py-10 text-center text-sm text-muted">
                            No sets match "{watchesFilter.trim()}".
                        </div>
                    ) : watchesCategoryFilter !== 'all' && !categoryFilteredWatchGroups.length ? (
                        <div className="rounded-xl border border-dashed border-white/15 bg-black/20 px-5 py-10 text-center text-sm text-muted">
                            No {RECENT_CATEGORY_ORDER.find((category) => category.id === watchesCategoryFilter)?.title.toLowerCase() || 'items'} match your filters.
                        </div>
                    ) : (
                        <div className="min-w-0 space-y-6">
                            {(watchesCategoryFilter === 'all'
                                ? RECENT_CATEGORY_ORDER
                                : RECENT_CATEGORY_ORDER.filter((category) => category.id === watchesCategoryFilter)
                            ).map((category) => {
                                const items = pagedWatchGroupsByCategory[category.id];
                                if (!items.length) return null;
                                const landscape = category.landscape;
                                return (
                                    <div key={category.id} className="space-y-3">
                                        {watchesCategoryFilter === 'all' ? (
                                            <div className="flex flex-wrap items-center gap-2">
                                                <h3 className="text-sm font-bold text-text sm:text-base">{category.title}</h3>
                                                <span className="text-[11px] text-muted">
                                                    {watchGroupsByCategory[category.id].length}
                                                </span>
                                            </div>
                                        ) : null}
                                        <div
                                            className={posterGridClass}
                                            style={landscape ? titleCardGridStyle : posterGridStyle}
                                        >
                                            {items.map((group) => {
                                    const multi = group.watches.length > 1;
                                    const anyPaused = group.watches.every((watch) => watch.enabled === false);
                                    const thumbSrc = group.thumbUrl
                                        ? (group.thumbUrl.startsWith('http')
                                            ? posterSetsApi.imageUrl(group.thumbUrl)
                                            : group.thumbUrl)
                                        : '';
                                    return (
                                        <article
                                            key={group.key}
                                            className={`group flex min-w-0 flex-col overflow-hidden ${posterMediaRadiusClass} border bg-black/25 transition ${
                                                group.errored
                                                    ? 'border-red-500/35 ring-1 ring-red-500/20'
                                                    : 'border-white/10 hover:border-plex/40'
                                            }`}
                                        >
                                            <button
                                                type="button"
                                                className={`relative block w-full overflow-hidden bg-black text-center ${landscape ? 'aspect-[16/9]' : 'aspect-[2/3]'} ${anyPaused ? 'opacity-55' : ''} ${thumbSrc ? 'cursor-zoom-in' : 'cursor-default'}`}
                                                disabled={!thumbSrc}
                                                aria-label={`Preview ${group.title}`}
                                                title={thumbSrc ? 'Click to expand preview' : undefined}
                                                onClick={() => {
                                                    if (!thumbSrc) return;
                                                    const primary = group.watches.find((watch) => String(watch.url || '').trim())
                                                        || group.watches[0];
                                                    setImagePreview({
                                                        src: thumbSrc,
                                                        title: group.title,
                                                        setUrl: String(primary?.url || '').trim(),
                                                        provider: String(primary?.provider || ''),
                                                    });
                                                }}
                                            >
                                                <PosterThumb
                                                    src={thumbSrc}
                                                    alt={group.title}
                                                    className="absolute inset-0 h-full w-full pointer-events-none"
                                                    imgClassName="absolute inset-0 h-full w-full object-contain object-center transition duration-300 group-hover:scale-[1.02]"
                                                    onLoad={(event) => {
                                                        if (landscape || category.id !== 'posters') return;
                                                        const img = event.currentTarget;
                                                        if (!img.naturalWidth || !img.naturalHeight) return;
                                                        const ratio = img.naturalWidth / img.naturalHeight;
                                                        if (ratio < 1.2) return;
                                                        const kind = ratio < 1.6 ? 'backgrounds' : 'title_cards';
                                                        for (const watch of group.watches) {
                                                            promoteWatchArtKind(watch.id, kind);
                                                        }
                                                    }}
                                                />
                                            </button>
        
                                            <div className="flex min-w-0 flex-1 flex-col gap-2 p-2 text-left sm:p-2.5">
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    {group.errored ? (
                                                        <MetaPill className="border-red-400/35 bg-red-500/15 text-red-200" truncate={false}>
                                                            Error
                                                        </MetaPill>
                                                    ) : anyPaused ? (
                                                        <MetaPill className="border-white/15 bg-white/5 text-muted" truncate={false}>
                                                            Paused
                                                        </MetaPill>
                                                    ) : (
                                                        <MetaPill className="border-plex/35 bg-plex/15 text-plex" truncate={false}>
                                                            Watching
                                                        </MetaPill>
                                                    )}
                                                    {multi ? (
                                                        <MetaPill className="border-white/15 bg-white/5 text-muted" truncate={false}>
                                                            {group.watches.length} sets
                                                        </MetaPill>
                                                    ) : null}
                                                </div>
        
                                                <div className="min-w-0">
                                                    <p className="line-clamp-2 text-[11px] font-semibold leading-snug text-text sm:text-xs" title={group.title}>
                                                        {group.title}
                                                    </p>
                                                    <p className="mt-0.5 text-[10px] text-muted">
                                                        {multi ? `${group.watches.length} pinned sets` : '1 pinned set'}
                                                        {group.lastCheckedAt ? ` · ${formatTime(group.lastCheckedAt)}` : ''}
                                                    </p>
                                                </div>
        
                                                {group.watches.map((watch, watchIndex) => {
                                                    const creator = String(watch.user || '').trim().replace(/^@/, '');
                                                    const provider = String(watch.provider || '').toLowerCase();
                                                    const setLabel = creator
                                                        ? `@${creator}`
                                                        : (watch.setId ? `Set ${watch.setId}` : 'Set');
                                                    const watchThumb = String(watch.thumbUrl || '').trim();
                                                    const watchThumbSrc = watchThumb
                                                        ? (watchThumb.startsWith('http')
                                                            ? posterSetsApi.imageUrl(watchThumb)
                                                            : watchThumb)
                                                        : '';
                                                    const actionBtnClass = 'inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-black/25 px-2 text-[11px] font-semibold text-text transition hover:border-plex/40 hover:bg-white/5 disabled:pointer-events-none disabled:opacity-40';
                                                    const waitingForLibrary = isLibraryPendingWatchError(watch.lastError);
                                                    return (
                                                        <div
                                                            key={watch.id}
                                                            className={`flex w-full min-w-0 flex-col gap-2 ${
                                                                watchIndex > 0 ? 'border-t border-white/10 pt-2' : ''
                                                            } ${
                                                                watch.lastError
                                                                    ? waitingForLibrary
                                                                        ? 'rounded-xl border border-amber-500/30 bg-amber-500/10 p-2'
                                                                        : 'rounded-xl border border-red-500/30 bg-red-500/10 p-2'
                                                                    : ''
                                                            }`}
                                                        >
                                                            {multi ? (
                                                                <div className="flex min-w-0 items-start gap-2">
                                                                    {watchThumbSrc ? (
                                                                        <button
                                                                            type="button"
                                                                            className={`shrink-0 overflow-hidden rounded border border-white/10 bg-black cursor-zoom-in ${
                                                                                landscape ? 'h-10 w-16' : 'h-14 w-10'
                                                                            }`}
                                                                            aria-label={`Preview ${group.title}`}
                                                                            title="Click to expand preview"
                                                                            onClick={() => {
                                                                                setImagePreview({
                                                                                    src: watchThumbSrc,
                                                                                    title: group.title,
                                                                                    setUrl: String(watch.url || '').trim(),
                                                                                    provider,
                                                                                });
                                                                            }}
                                                                        >
                                                                            <PosterThumb
                                                                                src={watchThumbSrc}
                                                                                className="h-full w-full pointer-events-none"
                                                                                imgClassName="h-full w-full object-contain"
                                                                            />
                                                                        </button>
                                                                    ) : null}
                                                                    <div className="min-w-0 flex-1">
                                                                        <div className="flex flex-wrap items-center gap-1">
                                                                            <ProviderPill provider={provider} compact />
                                                                            <CreatorPill user={creator} onOpen={openCreatorCatalog} compact />
                                                                            {watch.enabled === false ? (
                                                                                <MetaPill className="border-white/15 bg-white/5 text-muted" compact>
                                                                                    Paused
                                                                                </MetaPill>
                                                                            ) : null}
                                                                        </div>
                                                                        <p className="mt-1 text-[10px] leading-relaxed text-muted">
                                                                            {(watch.knownAssetCount ?? watch.knownAssetIds?.length ?? 0)} known
                                                                            {watch.lastCheckedAt ? ` · ${formatTime(watch.lastCheckedAt)}` : ' · not checked'}
                                                                            {watch.lastNewCount ? ` · +${watch.lastNewCount} last` : ''}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <>
                                                                    <div className="flex flex-wrap items-center gap-1">
                                                                        <ProviderPill provider={provider} compact />
                                                                        <CreatorPill user={creator} onOpen={openCreatorCatalog} compact />
                                                                        {watch.enabled === false ? (
                                                                            <MetaPill className="border-white/15 bg-white/5 text-muted" compact>
                                                                                Paused
                                                                            </MetaPill>
                                                                        ) : null}
                                                                    </div>
                                                                    <p className="text-[10px] leading-relaxed text-muted">
                                                                        {(watch.knownAssetCount ?? watch.knownAssetIds?.length ?? 0)} known
                                                                        {watch.lastCheckedAt ? ` · ${formatTime(watch.lastCheckedAt)}` : ' · not checked'}
                                                                        {watch.lastNewCount ? ` · +${watch.lastNewCount} last` : ''}
                                                                    </p>
                                                                </>
                                                            )}
                                                            {watch.lastError ? (
                                                                <div className="space-y-1">
                                                                    <p className={`line-clamp-3 break-words text-[10px] leading-snug [overflow-wrap:anywhere] ${
                                                                        waitingForLibrary ? 'text-amber-100' : 'text-red-300'
                                                                    }`} title={watch.lastError}>
                                                                        {watch.lastError}
                                                                    </p>
                                                                    <button
                                                                        type="button"
                                                                        className={`text-[10px] font-semibold underline-offset-2 hover:underline ${
                                                                            waitingForLibrary
                                                                                ? 'text-amber-200/80 hover:text-amber-100'
                                                                                : 'text-red-200/80 hover:text-red-100'
                                                                        }`}
                                                                        disabled={busy !== null}
                                                                        onClick={(event) => {
                                                                            event.stopPropagation();
                                                                            void dismissWatchError(watch);
                                                                        }}
                                                                    >
                                                                        Dismiss
                                                                    </button>
                                                                </div>
                                                            ) : null}
                                                            <div className="grid grid-cols-2 gap-1.5">
                                                                <button
                                                                    type="button"
                                                                    className={actionBtnClass}
                                                                    disabled={busy !== null}
                                                                    aria-label="Check for new art"
                                                                    title="Check for new art"
                                                                    onClick={() => void checkWatchNow(watch)}
                                                                >
                                                                    <RefreshCw className="h-3.5 w-3.5 shrink-0" />
                                                                    Check
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className={actionBtnClass}
                                                                    disabled={busy !== null}
                                                                    aria-label="More actions"
                                                                    title="Filters, reapply, and more"
                                                                    onClick={() => {
                                                                        setWatchSheet({
                                                                            watch,
                                                                            title: group.title,
                                                                            setLabel,
                                                                        });
                                                                    }}
                                                                >
                                                                    <MoreHorizontal className="h-3.5 w-3.5 shrink-0" />
                                                                    More
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </article>
                                    );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                            {watchesCategoryFilter !== 'all' && watchesPageCount > 1 ? (
                                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                                    <button
                                        type="button"
                                        className={buttonClass}
                                        disabled={busy !== null || watchesPage <= 1}
                                        onClick={() => setWatchesPage((page) => Math.max(1, page - 1))}
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                        Prev
                                    </button>
                                    <span className="text-xs text-muted">
                                        Page {Math.min(watchesPage, watchesPageCount)} / {watchesPageCount}
                                    </span>
                                    <button
                                        type="button"
                                        className={buttonClass}
                                        disabled={busy !== null || watchesPage >= watchesPageCount}
                                        onClick={() => setWatchesPage((page) => Math.min(watchesPageCount, page + 1))}
                                    >
                                        Next
                                        <ChevronRight className="h-4 w-4" />
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    )}
                </section>
    
    
    
    );
};
