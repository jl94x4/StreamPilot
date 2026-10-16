import React, { useEffect, useState } from 'react';
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
    Unlock,
    User,
    X,
} from 'lucide-react';
import { CustomSelect, SettingsToggleRow } from '../../shared/ui';
import { askConfirm } from '../../shared/confirm';
import { posterSetsApi } from '../api';
import { MEDIUX_FILTER_OPTIONS, type PosterSetsWatcherPassStatus } from '../types';
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
    isFailedJobState,
    isTitleCardRail,
    isTitleCardSet,
    isWarningJobState,
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

export const PosterSetsHistoryView: React.FC = () => {
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

    const [watcherPass, setWatcherPass] = useState<PosterSetsWatcherPassStatus | null>(null);
    const [unlockingWatcher, setUnlockingWatcher] = useState(false);

    useEffect(() => {
        if (tab !== 'history') return undefined;
        let cancelled = false;
        const poll = async () => {
            try {
                const result = await posterSetsApi.watchesRunStatus();
                if (!cancelled) setWatcherPass(result.status || null);
            } catch {
                if (!cancelled) setWatcherPass(null);
            }
        };
        void poll();
        const timer = window.setInterval(() => {
            void poll();
            if (historyFilter === 'audit') void loadAudit();
        }, 5000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [tab, historyFilter, loadAudit]);

    if (tab !== 'history') return null;
    const watcherBusy = Boolean(watcherPass?.busy || watcherPass?.running);
    const failedHistoryCount = historyJobs.filter((job) => isFailedJobState(job.state)).length;
    const failedAuditCount = auditEntries.filter((entry) => (
        !isWarningJobState(entry.state)
        && (Boolean(entry.error) || isFailedJobState(entry.state))
    )).length;
    return (



        <div className="space-y-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 max-w-3xl">
                            <h2 className="text-lg font-bold text-text">
                                {historyFilter === 'audit' ? 'Audit log' : 'Logs'}
                            </h2>
                            <p className="mt-1 text-sm text-muted">
                                {historyFilter === 'audit'
                                    ? 'Manual, watch, and bulk apply events with upload counts. Watcher “Check all” runs land here too.'
                                    : 'Apply jobs, watcher checks, and bulk runs with detail logs.'}
                            </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                            {([
                                ['all', 'All'],
                                ['running', 'Running'],
                                ['succeeded', 'Succeeded'],
                                ['warning', 'Warning'],
                                ['failed', 'Failed'],
                                ['audit', 'Audit log'],
                            ] as const).map(([value, label]) => (
                                <button
                                    key={value}
                                    type="button"
                                    className={`${buttonClass} ${historyFilter === value ? 'border-plex/40 bg-plex/15 text-plex' : ''}`}
                                    onClick={() => {
                                        setHistoryFilter(value);
                                        if (value === 'audit') void loadAudit();
                                    }}
                                >
                                    {label}
                                </button>
                            ))}
                            {historyFilter === 'audit' ? (
                                <button
                                    type="button"
                                    className={buttonClass}
                                    disabled={busy !== null || failedAuditCount < 1}
                                    title="Remove audit rows that recorded an error"
                                    onClick={async () => {
                                        if (failedAuditCount < 1) return;
                                        const confirmed = await askConfirm(
                                            `Remove ${failedAuditCount} failed audit ${failedAuditCount === 1 ? 'entry' : 'entries'}?`,
                                            { confirmLabel: 'Clear errors', danger: true },
                                        );
                                        if (!confirmed) return;
                                        setBusy('history');
                                        try {
                                            const response = await posterSetsApi.clearFailedAudit();
                                            setAuditEntries(response.entries || []);
                                            toast(response.removed
                                                ? `Cleared ${response.removed} failed audit ${response.removed === 1 ? 'entry' : 'entries'}.`
                                                : 'No failed audit entries.');
                                        } catch (error) {
                                            toast(error instanceof Error ? error.message : 'Failed to clear audit errors', 'error');
                                        } finally {
                                            setBusy(null);
                                        }
                                    }}
                                >
                                    <Trash2 className="h-4 w-4" /> Clear errors
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    className={buttonClass}
                                    disabled={busy !== null || failedHistoryCount < 1}
                                    title="Remove failed jobs from Logs and the queue list"
                                    onClick={async () => {
                                        if (failedHistoryCount < 1) return;
                                        const confirmed = await askConfirm(
                                            `Remove ${failedHistoryCount} failed ${failedHistoryCount === 1 ? 'job' : 'jobs'} from Logs and the queue?`,
                                            { confirmLabel: 'Clear failed', danger: true },
                                        );
                                        if (!confirmed) return;
                                        setBusy('history');
                                        try {
                                            const response = await posterSetsApi.clearFailedJobs();
                                            setHistoryJobs(response.jobs || []);
                                            if (selectedHistoryJob && isFailedJobState(selectedHistoryJob.state)) {
                                                setSelectedHistoryJob(null);
                                            }
                                            await loadQueue();
                                            toast(response.removed
                                                ? `Cleared ${response.removed} failed ${response.removed === 1 ? 'job' : 'jobs'}.`
                                                : 'No failed jobs.');
                                        } catch (error) {
                                            toast(error instanceof Error ? error.message : 'Failed to clear failed jobs', 'error');
                                        } finally {
                                            setBusy(null);
                                        }
                                    }}
                                >
                                    <Trash2 className="h-4 w-4" /> Clear failed
                                </button>
                            )}
                        </div>
                    </div>
        
                    <input
                        className={fieldClass}
                        value={historySearch}
                        onChange={(event) => setHistorySearch(event.target.value)}
                        placeholder={historyFilter === 'audit'
                            ? 'Search title, source, job id…'
                            : 'Search URL, job id, type…'}
                    />

                    {watcherBusy || watcherPass?.stale ? (
                        <div className={`rounded-xl border px-3 py-3 text-sm sm:px-4 ${
                            watcherPass?.stale
                                ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
                                : 'border-plex/40 bg-plex/10 text-text'
                        }`}>
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0 space-y-1">
                                    <p className="font-semibold">
                                        {watcherPass?.stale
                                            ? 'Check all looks stuck'
                                            : 'Check all is running in the background'}
                                    </p>
                                    <p className="text-xs text-muted">
                                        {watcherPass?.checked != null
                                            ? `Progress ${watcherPass.checked}/${watcherPass.total || '?'}`
                                                + (watcherPass.currentTitle ? ` — ${watcherPass.currentTitle}` : '')
                                                + `. This is not a queue job — open Audit log below.`
                                            : 'Progress appears under Audit log (not the Running jobs filter).'}
                                    </p>
                                </div>
                                <div className="flex shrink-0 flex-wrap gap-2">
                                    {historyFilter !== 'audit' ? (
                                        <button
                                            type="button"
                                            className={buttonClass}
                                            onClick={() => {
                                                setHistoryFilter('audit');
                                                void loadAudit();
                                            }}
                                        >
                                            Open Audit log
                                        </button>
                                    ) : null}
                                    <button
                                        type="button"
                                        className={buttonClass}
                                        disabled={unlockingWatcher}
                                        onClick={() => {
                                            void (async () => {
                                                const ok = await askConfirm(
                                                    'Only unlock if Check all progress has stopped for a long time. A hung scrape may still finish in the background.',
                                                    { title: 'Unlock Check all?', confirmLabel: 'Unlock' },
                                                );
                                                if (!ok) return;
                                                setUnlockingWatcher(true);
                                                try {
                                                    await posterSetsApi.unlockWatchesRun();
                                                    const result = await posterSetsApi.watchesRunStatus();
                                                    setWatcherPass(result.status || null);
                                                    void loadAudit();
                                                    toast('Watcher lock cleared — you can run Check all again.');
                                                } catch (error) {
                                                    toast(error instanceof Error ? error.message : 'Unlock failed', 'error');
                                                } finally {
                                                    setUnlockingWatcher(false);
                                                }
                                            })();
                                        }}
                                    >
                                        {unlockingWatcher
                                            ? <Loader2 className="h-4 w-4 animate-spin" />
                                            : <Unlock className="h-4 w-4" />}
                                        Unlock check
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : null}
        
                    {historyFilter === 'audit' ? (
                        <div className="space-y-2">
                            {filteredAudit.map((entry) => {
                                const label = formatSetLabel(entry) || entry.url || entry.action || 'Audit entry';
                                const source = String(entry.source || 'manual').toLowerCase();
                                return (
                                    <article
                                        key={entry.id}
                                        className={`${cardClass} min-w-0 space-y-2 overflow-hidden p-3 sm:p-4 ${entry.jobId ? 'cursor-pointer transition hover:border-plex/40' : ''}`}
                                        onClick={() => {
                                            if (!entry.jobId) return;
                                            void openHistoryJob(entry.jobId);
                                            setHistoryFilter('all');
                                        }}
                                    >
                                        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                                            <div className="min-w-0 flex-1 space-y-1 overflow-hidden">
                                                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                                                        source === 'watch' || source === 'watcher'
                                                            ? 'border-plex/40 bg-plex/15 text-plex'
                                                            : source === 'bulk'
                                                                ? 'border-sky-500/40 bg-sky-500/15 text-sky-200'
                                                                : 'border-white/10 bg-white/5 text-muted'
                                                    }`}>
                                                        {source}
                                                    </span>
                                                    {entry.state ? <StatusPill value={entry.state} /> : null}
                                                </div>
                                                <p className="break-words text-sm font-semibold text-text [overflow-wrap:anywhere]" title={label}>{label}</p>
                                                {entry.detail ? (
                                                    <p className="text-xs text-muted">{entry.detail}</p>
                                                ) : null}
                                                {entry.jobId ? (
                                                    <p className="font-mono text-xs text-muted">job #{entry.jobId.slice(0, 8)}</p>
                                                ) : null}
                                            </div>
                                            <time className="shrink-0 text-xs text-muted" dateTime={entry.at || undefined}>
                                                {formatTime(entry.at)}
                                            </time>
                                        </div>
                                        <div className="flex flex-wrap gap-2 text-[11px] text-muted">
                                            {typeof entry.checked === 'number' ? (
                                                <span>Checked {entry.checked}</span>
                                            ) : null}
                                            {typeof entry.queued === 'number' ? (
                                                <span>Queued {entry.queued}</span>
                                            ) : null}
                                            {typeof entry.assetsQueued === 'number' ? (
                                                <span>{entry.assetsQueued} asset(s)</span>
                                            ) : null}
                                            {typeof entry.uploaded === 'number' ? (
                                                <span className="text-emerald-300">
                                                    Uploaded {entry.uploaded}
                                                    {typeof entry.attempted === 'number' ? ` / ${entry.attempted}` : ''}
                                                </span>
                                            ) : null}
                                            {typeof entry.selectedCount === 'number' ? (
                                                <span>{entry.selectedCount} selected</span>
                                            ) : null}
                                            {entry.error ? (
                                                <span className={isWarningJobState(entry.state) ? 'text-amber-200' : 'text-red-300'}>
                                                    {entry.error}
                                                </span>
                                            ) : null}
                                        </div>
                                    </article>
                                );
                            })}
                            {!filteredAudit.length ? (
                                <p className={`${cardClass} p-5 text-sm text-muted`}>
                                    No audit entries yet. Applies and watch checks will appear here.
                                </p>
                            ) : null}
                        </div>
                    ) : (
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                        <div className="space-y-2">
                            {filteredHistory.map((job) => {
                                const selected = selectedHistoryJob?.id === job.id;
                                const uploaded = job.uploaded ?? (typeof job.result?.uploaded === 'number' ? job.result.uploaded : null);
                                const attempted = job.attempted ?? (typeof job.result?.attempted === 'number' ? job.result.attempted : null);
                                const meta = jobSetMeta(job);
                                return (
                                    <article
                                        key={job.id}
                                        className={`${cardClass} min-w-0 cursor-pointer space-y-2 overflow-hidden p-3 transition hover:border-plex/40 sm:p-4 ${selected ? 'border-plex/50' : ''} ${jobCardTone(job)}`}
                                        onClick={() => void openHistoryJob(job.id)}
                                    >
                                        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                                            <div className="flex min-w-0 flex-1 items-start gap-3 overflow-hidden">
                                                {meta?.thumbUrl ? (
                                                    <img
                                                        src={posterSetsApi.imageUrl(meta.thumbUrl)}
                                                        alt=""
                                                        className="h-14 w-10 shrink-0 rounded-md object-cover"
                                                        loading="lazy"
                                                    />
                                                ) : null}
                                                <div className="min-w-0 flex-1 overflow-hidden">
                                                    <p className="break-words text-sm font-semibold text-text [overflow-wrap:anywhere]" title={jobTitle(job)}>
                                                        {jobTitle(job)}
                                                    </p>
                                                    <p className="mt-1 font-mono text-xs text-muted">
                                                        #{job.id.slice(0, 8)} · {job.type || 'job'}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex shrink-0 flex-col items-end gap-1">
                                                <StatusPill value={job.state} />
                                                <time className="text-xs text-muted" dateTime={job.finishedAt || job.createdAt || undefined}>
                                                    {formatTime(job.finishedAt || job.createdAt)}
                                                </time>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-2 text-[11px] text-muted">
                                            {typeof uploaded === 'number' ? (
                                                <span className="text-emerald-300">
                                                    Uploaded {uploaded}{typeof attempted === 'number' ? ` / ${attempted}` : ''}
                                                </span>
                                            ) : null}
                                            {typeof job.logCount === 'number' ? <span>{job.logCount} log lines</span> : null}
                                            {job.error ? <span className={jobErrorTextClass(job.state)}>{job.error}</span> : null}
                                        </div>
                                    </article>
                                );
                            })}
                            {!filteredHistory.length ? (
                                <p className={`${cardClass} p-5 text-sm text-muted`}>
                                    No jobs yet. Apply a set and finished runs will show up here.
                                </p>
                            ) : null}
                        </div>
        
                        <section className={`${cardClass} space-y-3 p-5`}>
                            {selectedHistoryJob ? (
                                <>
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <h3 className="text-lg font-bold text-text">Job detail</h3>
                                            <p className="mt-1 truncate text-sm text-muted" title={jobTitle(selectedHistoryJob)}>
                                                {jobTitle(selectedHistoryJob)}
                                            </p>
                                        </div>
                                        <StatusPill value={selectedHistoryJob.state} />
                                    </div>
                                    <div className="flex flex-wrap gap-3 text-xs text-muted">
                                        <span>Started {formatTime(selectedHistoryJob.createdAt)}</span>
                                        <span>Finished {formatTime(selectedHistoryJob.finishedAt)}</span>
                                        {typeof selectedHistoryJob.result?.uploaded === 'number' ? (
                                            <span className="text-emerald-300">
                                                Uploaded {String(selectedHistoryJob.result.uploaded)}
                                                {typeof selectedHistoryJob.result.attempted === 'number'
                                                    ? ` / ${String(selectedHistoryJob.result.attempted)}`
                                                    : ''}
                                            </span>
                                        ) : null}
                                    </div>
                                    {selectedHistoryJob.error ? (
                                        <p className={jobErrorBoxClass(selectedHistoryJob.state)}>
                                            {selectedHistoryJob.error}
                                        </p>
                                    ) : null}
                                    {selectedHistoryJob.input?.url ? (
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                className={buttonClass}
                                                disabled={busy !== null}
                                                onClick={() => {
                                                    const target = String(selectedHistoryJob.input?.url || '').trim();
                                                    if (!target) return;
                                                    void openSetForApply({
                                                        setId: '',
                                                        title: '',
                                                        url: target,
                                                    });
                                                }}
                                            >
                                                <ImageIcon className="h-4 w-4" /> Re-preview
                                            </button>
                                            <button
                                                type="button"
                                                className={primaryButtonClass}
                                                disabled={busy !== null}
                                                onClick={() => {
                                                    const target = String(selectedHistoryJob.input?.url || '').trim();
                                                    if (!target) return;
                                                    goToDiscoverView('search');
                                                    void runApply(false, target);
                                                }}
                                            >
                                                <RotateCcw className="h-4 w-4" /> Re-apply
                                            </button>
                                        </div>
                                    ) : null}
                                    <div className="max-h-[28rem] overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-[11px] text-muted custom-scrollbar">
                                        {selectedLogs.length ? selectedLogs.map((line, index) => (
                                            <p key={`${index}-${line.slice(0, 24)}`}>{line}</p>
                                        )) : (
                                            <p>No log lines for this job.</p>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-center text-sm text-muted">
                                    <History className="h-8 w-8 opacity-30" />
                                    <p>Select a job to inspect its logs.</p>
                                </div>
                            )}
                        </section>
                    </div>
                    )}
                </div>
    
    
    
    );
};
