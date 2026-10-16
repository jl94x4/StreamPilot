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
    formatSetLabel,
    formatTime,
    isTitleCardRail,
    isTitleCardSet,
    jobCardTone,
    jobErrorBoxClass,
    jobErrorTextClass,
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

export const PosterSetsQueueView: React.FC = () => {
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
    if (tab !== 'queue') return null;
    return (



        <section className={`${cardClass} space-y-4 overflow-hidden p-4 sm:p-5`}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 max-w-3xl">
                            <h2 className={sectionTitleClass}>Apply queue</h2>
                            <p className={sectionBodyClass}>
                                Sets apply one at a time in the background. You can keep queueing while paused.
                            </p>
                            <p className="mt-2 text-[11px] text-muted sm:text-xs">
                                {queuePaused ? 'Paused' : 'Running'}
                                {' · '}
                                {queueStats.queued || 0} waiting
                                {' · '}
                                {queueStats.running || 0} active
                                {' · '}
                                {queueStats.succeeded || 0} succeeded
                                {' · '}
                                {queueStats.warning || 0} warning
                                {' · '}
                                {queueStats.failed || 0} failed
                            </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                            <button
                                type="button"
                                className={buttonClass}
                                disabled={busy !== null}
                                onClick={() => void loadQueue()}
                            >
                                <RefreshCw className="h-4 w-4" /> Refresh
                            </button>
                            <button
                                type="button"
                                className={queuePaused ? primaryButtonClass : buttonClass}
                                disabled={busy !== null}
                                onClick={async () => {
                                    setBusy('queue');
                                    try {
                                        const response = await posterSetsApi.pauseQueue(!queuePaused);
                                        setQueuePaused(Boolean(response.paused));
                                        setQueueStats(response.stats || {});
                                        toast(response.paused ? 'Queue paused — new applies still stack up.' : 'Queue resumed.');
                                        await loadQueue();
                                    } catch (error) {
                                        toast(error instanceof Error ? error.message : 'Failed to update queue', 'error');
                                    } finally {
                                        setBusy(null);
                                    }
                                }}
                            >
                                {queuePaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                                {queuePaused ? 'Resume' : 'Pause'}
                            </button>
                            <button
                                type="button"
                                className={primaryButtonClass}
                                disabled={busy !== null || !Number(queueStats.queued || 0)}
                                title="Cancel every waiting apply (does not touch running/finished)"
                                onClick={async () => {
                                    const waiting = Number(queueStats.queued || 0);
                                    if (!waiting) return;
                                    if (!window.confirm(`Cancel all ${waiting} waiting queue item${waiting === 1 ? '' : 's'}? Running jobs stay active.`)) return;
                                    setBusy('queue');
                                    try {
                                        const response = await posterSetsApi.clearQueuedJobs();
                                        setQueueJobs(response.jobs || []);
                                        setQueueStats(response.stats || {});
                                        await loadQueue();
                                        toast(`Cancelled ${response.cancelled || 0} waiting job(s).`);
                                    } catch (error) {
                                        toast(error instanceof Error ? error.message : 'Failed to cancel queued jobs', 'error');
                                    } finally {
                                        setBusy(null);
                                    }
                                }}
                            >
                                Cancel all
                            </button>
                            <button
                                type="button"
                                className={buttonClass}
                                disabled={busy !== null}
                                title="Remove succeeded, failed, and cancelled rows from the queue list"
                                onClick={async () => {
                                    setBusy('queue');
                                    try {
                                        await posterSetsApi.clearFinishedQueue();
                                        await loadQueue();
                                        toast('Cleared finished queue items.');
                                    } catch (error) {
                                        toast(error instanceof Error ? error.message : 'Failed to clear queue', 'error');
                                    } finally {
                                        setBusy(null);
                                    }
                                }}
                            >
                                Clear finished
                            </button>
                        </div>
                    </div>
        
                    {!queueJobs.length ? (
                        <p className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted">
                            Queue is empty. Apply a poster set from the Apply tab to add one.
                        </p>
                    ) : (
                        <div className="min-w-0 space-y-2 overflow-hidden">
                            {queueJobs.map((job) => {
                                const meta = jobSetMeta(job);
                                const state = String(job.state || '').toLowerCase();
                                const showName = String(meta?.title || '').trim() || jobTitle(job);
                                return (
                                    <div
                                        key={job.id}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => { void openQueueJob(job.id); }}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                void openQueueJob(job.id);
                                            }
                                        }}
                                        className={`min-w-0 overflow-hidden rounded-xl border px-3 py-3 sm:px-4 cursor-pointer transition-colors ${selectedQueueJob?.id === job.id ? 'border-plex/50 ring-1 ring-plex/30' : 'border-white/10'} ${jobCardTone(job)}`}
                                    >
                                        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                            <div className="min-w-0 flex-1 space-y-1.5 overflow-hidden">
                                                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                                    <StatusPill value={job.state} />
                                                    <ProviderPill provider={meta?.provider} />
                                                    <CreatorPill user={meta?.user} onOpen={openCreatorCatalog} />
                                                </div>
                                                <p className="break-words text-sm font-semibold leading-snug text-text [overflow-wrap:anywhere]" title={showName}>
                                                    {showName}
                                                </p>
                                                <p className="break-words text-[11px] text-muted sm:text-xs">
                                                    {formatTime(job.createdAt)}
                                                    {job.finishedAt ? ` · finished ${formatTime(job.finishedAt)}` : ''}
                                                    {typeof job.uploaded === 'number' ? ` · uploaded ${job.uploaded}` : ''}
                                                    {job.uploaded == null && typeof job.result?.uploaded === 'number'
                                                        ? ` · uploaded ${job.result.uploaded as number}`
                                                        : ''}
                                                    {job.input?.selectedCount ? ` · ${job.input.selectedCount} selected` : ''}
                                                </p>
                                                {job.error ? (
                                                    <p className={`break-words text-xs sm:text-sm [overflow-wrap:anywhere] ${jobErrorTextClass(job.state)}`}>{job.error}</p>
                                                ) : null}
                                                {meta?.url ? (
                                                    <a
                                                        href={meta.url}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="inline-flex max-w-full items-center gap-1 text-xs font-semibold text-plex no-underline hover:underline"
                                                    >
                                                        <span className="truncate">Open set</span> <ExternalLink className="h-3 w-3 shrink-0" />
                                                    </a>
                                                ) : null}
                                            </div>
                                            <div className="flex shrink-0 flex-wrap gap-2">
                                                {state === 'queued' ? (
                                                    <button
                                                        type="button"
                                                        className={buttonClass}
                                                        disabled={busy !== null}
                                                        onClick={async (event) => {
                                                            event.stopPropagation();
                                                            setBusy('queue');
                                                            try {
                                                                await posterSetsApi.cancelQueueJob(job.id);
                                                                await loadQueue();
                                                                toast('Removed from queue.');
                                                            } catch (error) {
                                                                toast(error instanceof Error ? error.message : 'Cancel failed', 'error');
                                                            } finally {
                                                                setBusy(null);
                                                            }
                                                        }}
                                                    >
                                                        <X className="h-4 w-4" /> Cancel
                                                    </button>
                                                ) : null}
                                                {state === 'running' ? (
                                                    <button
                                                        type="button"
                                                        className={primaryButtonClass}
                                                        disabled={busy !== null}
                                                        onClick={async (event) => {
                                                            event.stopPropagation();
                                                            if (!window.confirm('Stop this running apply? You can Retry it afterward.')) return;
                                                            setBusy('queue');
                                                            try {
                                                                await posterSetsApi.stopQueueJob(job.id);
                                                                await loadQueue();
                                                                toast('Stopped running apply.');
                                                            } catch (error) {
                                                                toast(error instanceof Error ? error.message : 'Stop failed', 'error');
                                                            } finally {
                                                                setBusy(null);
                                                            }
                                                        }}
                                                    >
                                                        <X className="h-4 w-4" /> Stop
                                                    </button>
                                                ) : null}
                                                {(state === 'failed' || state === 'cancelled' || state === 'warning') ? (
                                                    <button
                                                        type="button"
                                                        className={primaryButtonClass}
                                                        disabled={busy !== null}
                                                        onClick={async (event) => {
                                                            event.stopPropagation();
                                                            setBusy('queue');
                                                            try {
                                                                await posterSetsApi.retryQueueJob(job.id);
                                                                await loadQueue();
                                                                toast('Re-queued apply.');
                                                            } catch (error) {
                                                                toast(error instanceof Error ? error.message : 'Retry failed', 'error');
                                                            } finally {
                                                                setBusy(null);
                                                            }
                                                        }}
                                                    >
                                                        <RotateCcw className="h-4 w-4" /> Retry
                                                    </button>
                                                ) : null}
                                                {(state === 'failed' || state === 'cancelled' || state === 'succeeded' || state === 'warning') ? (
                                                    <button
                                                        type="button"
                                                        className={buttonClass}
                                                        disabled={busy !== null}
                                                        title="Remove this row from the queue list"
                                                        onClick={async (event) => {
                                                            event.stopPropagation();
                                                            setBusy('queue');
                                                            try {
                                                                await posterSetsApi.dismissQueueJob(job.id);
                                                                await loadQueue();
                                                                if (selectedQueueJob?.id === job.id) setSelectedQueueJob(null);
                                                                toast('Removed from queue.');
                                                            } catch (error) {
                                                                toast(error instanceof Error ? error.message : 'Dismiss failed', 'error');
                                                            } finally {
                                                                setBusy(null);
                                                            }
                                                        }}
                                                    >
                                                        <X className="h-4 w-4" /> Dismiss
                                                    </button>
                                                ) : null}
                                                {(state === 'failed' || state === 'warning') && (job.input?.url || meta?.url) ? (
                                                    <button
                                                        type="button"
                                                        className={buttonClass}
                                                        disabled={busy !== null}
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            const target = String(job.input?.url || meta?.url || '').trim();
                                                            if (!target) return;
                                                            void openSetForApply({
                                                                setId: String(meta?.setId || ''),
                                                                title: String(meta?.title || ''),
                                                                url: target,
                                                                thumbUrl: meta?.thumbUrl,
                                                                user: meta?.user,
                                                                provider: meta?.provider || undefined,
                                                            });
                                                        }}
                                                    >
                                                        Re-open
                                                    </button>
                                                ) : null}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
        
                    {selectedQueueJob ? (
                        <section className={`${cardClass} space-y-3 p-5`}>
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <h3 className="text-lg font-bold text-text">Queue job detail</h3>
                                    <p className="mt-1 truncate text-sm text-muted" title={jobTitle(selectedQueueJob)}>
                                        {jobTitle(selectedQueueJob)}
                                    </p>
                                </div>
                                <StatusPill value={selectedQueueJob.state} />
                            </div>
                            <div className="flex flex-wrap gap-3 text-xs text-muted">
                                <span>Queued {formatTime(selectedQueueJob.createdAt)}</span>
                                {selectedQueueJob.finishedAt ? <span>Finished {formatTime(selectedQueueJob.finishedAt)}</span> : null}
                                {typeof selectedQueueJob.result?.uploaded === 'number' ? (
                                    <span className="text-emerald-300">
                                        Uploaded {String(selectedQueueJob.result.uploaded)}
                                        {typeof selectedQueueJob.result.attempted === 'number'
                                            ? ` / ${String(selectedQueueJob.result.attempted)}`
                                            : ''}
                                    </span>
                                ) : null}
                            </div>
                            {selectedQueueJob.error ? (
                                <p className={jobErrorBoxClass(selectedQueueJob.state)}>
                                    {selectedQueueJob.error}
                                </p>
                            ) : null}
                            {selectedQueueLogs.length ? (
                                <pre className="max-h-48 overflow-auto rounded-xl border border-white/10 bg-black/30 p-3 text-[11px] text-muted font-mono">
                                    {selectedQueueLogs.join('\n')}
                                </pre>
                            ) : null}
                        </section>
                    ) : null}
                </section>
    
    
    
    );
};
