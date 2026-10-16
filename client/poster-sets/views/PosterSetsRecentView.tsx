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
    PosterThumb,
    PreviewAssetGallery,
    ProviderPill,
    RECENT_CATEGORY_ORDER,
    RECENT_SETS_PAGE_SIZE_STORAGE_KEY,
    RelatedSetsRail,
    SEARCH_SETS_PAGE_SIZE,
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
    jobSetMeta,
    jobTitle,
    normalizeSearchSetsPageSize,
    posterMediaRadiusClass,
    primaryButtonClass,
    providerLabel,
    removeRecentSets,
    sectionBodyClass,
    sectionTitleClass,
    textToList,
    upsertRecentSet,
    type RecentSetCategory,
} from '../shared';
import { usePosterSetsDashboard } from '../PosterSetsDashboardContext';

export const PosterSetsRecentView: React.FC = () => {
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

    const [recentPageSize, setRecentPageSize] = React.useState(() => {
        if (typeof window === 'undefined') return SEARCH_SETS_PAGE_SIZE;
        return normalizeSearchSetsPageSize(window.localStorage.getItem(RECENT_SETS_PAGE_SIZE_STORAGE_KEY));
    });
    const [recentPages, setRecentPages] = React.useState<Record<RecentSetCategory, number>>({
        posters: 1,
        backgrounds: 1,
        title_cards: 1,
    });

    React.useEffect(() => {
        window.localStorage.setItem(RECENT_SETS_PAGE_SIZE_STORAGE_KEY, String(recentPageSize));
    }, [recentPageSize]);

    React.useEffect(() => {
        setRecentPages((prev) => {
            let changed = false;
            const next = { ...prev };
            for (const category of RECENT_CATEGORY_ORDER) {
                const count = recentSetsByCategory[category.id].length;
                const pageCount = Math.max(1, Math.ceil(count / recentPageSize) || 1);
                if (next[category.id] > pageCount) {
                    next[category.id] = pageCount;
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
    }, [recentPageSize, recentSetsByCategory]);

    const bumpRecentPage = (category: RecentSetCategory, page: number) => {
        setRecentPages((prev) => ({ ...prev, [category]: Math.max(1, page) }));
    };

    const removeRecentUrls = async (urls: string[], confirmLabel: string) => {
        const unique = [...new Set(urls.map((item) => String(item || '').trim()).filter(Boolean))];
        if (!unique.length) return;
        const ok = await askConfirm(confirmLabel, {
            title: unique.length === 1 ? 'Remove from Recent?' : 'Remove selected from Recent?',
            confirmLabel: 'Remove',
            cancelLabel: 'Keep',
            danger: true,
        });
        if (!ok) return;
        removeRecentSets(unique);
        setSelectedBulkSets((prev) => {
            const next = { ...prev };
            for (const url of unique) delete next[url];
            return next;
        });
        setRecentTick((value) => value + 1);
        toast(unique.length === 1 ? 'Removed from Recent.' : `Removed ${unique.length} sets from Recent.`);
    };

    if (tab !== 'recent') return null;
    return (



        <section className={`${cardClass} space-y-5 p-5`}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 max-w-3xl">
                            <h2 className={sectionTitleClass}>Recent sets</h2>
                            <p className={sectionBodyClass}>
                                Every set you&apos;ve previewed, grouped by art type. Remove items you don&apos;t need anymore.
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            {selectedBulkCount ? (
                                <button
                                    type="button"
                                    className={buttonClass}
                                    disabled={busy !== null}
                                    onClick={() => void removeRecentUrls(
                                        Object.keys(selectedBulkSets),
                                        `Remove ${selectedBulkCount} set${selectedBulkCount === 1 ? '' : 's'} from Recent? Logs and Watching are unchanged.`,
                                    )}
                                >
                                    <Trash2 className="h-4 w-4" />
                                    Remove selected
                                </button>
                            ) : null}
                            <CustomSelect
                                value={String(recentPageSize)}
                                onChange={(value) => {
                                    setRecentPageSize(normalizeSearchSetsPageSize(value));
                                    setRecentPages({ posters: 1, backgrounds: 1, title_cards: 1 });
                                }}
                                options={[...SEARCH_SETS_PAGE_SIZE_OPTIONS]}
                                className="w-full min-w-[140px] sm:w-auto"
                                compact
                            />
                            <PosterSetsGridSizeSlider
                                value={gridSize}
                                onChange={setGridSize}
                                className="w-full min-w-[140px] sm:w-auto"
                            />
                        </div>
                    </div>
                    {recentSets.length ? (
                        <div className="space-y-6">
                            {RECENT_CATEGORY_ORDER.map((category) => {
                                const items = recentSetsByCategory[category.id];
                                if (!items.length) return null;
                                const landscape = category.landscape;
                                const pageCount = Math.max(1, Math.ceil(items.length / recentPageSize));
                                const page = Math.min(recentPages[category.id] || 1, pageCount);
                                const start = (page - 1) * recentPageSize;
                                const pagedItems = items.slice(start, start + recentPageSize);
                                return (
                                    <div key={category.id} className="space-y-3">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h3 className="text-sm font-bold text-text sm:text-base">{category.title}</h3>
                                            <span className="text-[11px] text-muted">{items.length}</span>
                                            {pageCount > 1 ? (
                                                <div className="ml-auto flex flex-wrap items-center gap-2">
                                                    <button
                                                        type="button"
                                                        className={buttonClass}
                                                        disabled={page <= 1}
                                                        onClick={() => bumpRecentPage(category.id, page - 1)}
                                                    >
                                                        <ChevronLeft className="h-4 w-4" />
                                                        Prev
                                                    </button>
                                                    <span className="text-xs text-muted">
                                                        Page {page} / {pageCount}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        className={buttonClass}
                                                        disabled={page >= pageCount}
                                                        onClick={() => bumpRecentPage(category.id, page + 1)}
                                                    >
                                                        Next
                                                        <ChevronRight className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            ) : null}
                                        </div>
                                        <div
                                            className={posterGridClass}
                                            style={landscape ? titleCardGridStyle : posterGridStyle}
                                        >
                                            {pagedItems.map((item) => {
                                                const label = formatSetLabel(item) || item.title;
                                                const bulkSelected = Boolean(selectedBulkSets[item.url]);
                                                const openRecent = () => {
                                                    void openSetForApply({
                                                        setId: item.setId || '',
                                                        title: item.title,
                                                        url: item.url,
                                                        thumbUrl: item.thumbUrl,
                                                        user: item.user,
                                                        provider: item.provider || undefined,
                                                        posterCount: item.assetCount,
                                                        setKind: item.setKind || category.id,
                                                    });
                                                };
                                                return (
                                                    <div
                                                        key={item.url}
                                                        className={`relative flex min-w-0 flex-col overflow-hidden ${posterMediaRadiusClass} border bg-black/20 ${
                                                            bulkSelected ? 'border-plex/50 ring-1 ring-plex/30' : 'border-white/10'
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
                                                                    url: item.url,
                                                                    title: item.title,
                                                                    user: item.user,
                                                                    thumbUrl: item.thumbUrl,
                                                                    provider: item.provider,
                                                                    setId: item.setId,
                                                                    setKind: item.setKind || category.id,
                                                                })}
                                                                onClick={(event) => event.stopPropagation()}
                                                                aria-label={`Select ${label}`}
                                                            />
                                                        </label>
                                                        <button
                                                            type="button"
                                                            className="block w-full min-w-0 flex-1 text-left"
                                                            disabled={busy !== null}
                                                            onClick={openRecent}
                                                            title={`Preview ${label}`}
                                                        >
                                                            <div className={`relative overflow-hidden bg-black text-center ${landscape ? 'aspect-[16/9]' : 'aspect-[2/3]'}`}>
                                                                <PosterThumb
                                                                    src={item.thumbUrl ? posterSetsApi.imageUrl(item.thumbUrl) : ''}
                                                                    alt={label}
                                                                    className="absolute inset-0 h-full w-full"
                                                                    imgClassName="absolute inset-0 h-full w-full object-contain object-center"
                                                                    loading="lazy"
                                                                    onLoad={(event) => {
                                                                        const img = event.currentTarget;
                                                                        if (!img.naturalWidth || !img.naturalHeight) return;
                                                                        const ratio = img.naturalWidth / img.naturalHeight;
                                                                        if (ratio < 1.2 || category.id !== 'posters') return;
                                                                        upsertRecentSet({
                                                                            ...item,
                                                                            setKind: 'title_cards',
                                                                        }, item.url, { setKind: 'title_cards' });
                                                                        setRecentTick((value) => value + 1);
                                                                    }}
                                                                />
                                                            </div>
                                                            <div className="min-w-0 space-y-0.5 px-1.5 py-1.5 text-center sm:px-2">
                                                                <p className="line-clamp-2 text-[10px] font-medium leading-snug text-text/90 sm:text-[11px]" title={label}>{label}</p>
                                                            </div>
                                                        </button>
                                                        <div className="flex flex-wrap items-center gap-1 px-1.5 pb-1 sm:px-2">
                                                            <ProviderPill provider={item.provider} compact />
                                                            <span className="truncate text-[9px] text-muted sm:text-[10px]">
                                                                {item.setId ? `#${item.setId}` : 'Set'}
                                                                {item.assetCount ? ` · ${item.assetCount} assets` : ''}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-1.5 border-t border-white/10 p-1.5">
                                                            <button
                                                                type="button"
                                                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-black/20 text-text transition hover:border-plex/40 hover:bg-white/5 disabled:pointer-events-none disabled:opacity-40"
                                                                disabled={busy !== null}
                                                                aria-label="Preview"
                                                                title="Preview"
                                                                onClick={openRecent}
                                                            >
                                                                {busy === 'preview' && url === item.url
                                                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                                    : <ImageIcon className="h-3.5 w-3.5" />}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-plex text-background transition hover:bg-plex-hover disabled:pointer-events-none disabled:opacity-40"
                                                                disabled={busy !== null}
                                                                aria-label="Apply"
                                                                title="Apply"
                                                                onClick={() => {
                                                                    goToDiscoverView('search');
                                                                    void runApply(false, item.url);
                                                                }}
                                                            >
                                                                {busy === 'apply' && url === item.url
                                                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                                    : <RotateCcw className="h-3.5 w-3.5" />}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-black/20 text-muted transition hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-300 disabled:pointer-events-none disabled:opacity-40"
                                                                disabled={busy !== null}
                                                                aria-label="Remove from Recent"
                                                                title="Remove from Recent"
                                                                onClick={() => void removeRecentUrls(
                                                                    [item.url],
                                                                    'Remove this set from Recent? Logs and Watching are unchanged.',
                                                                )}
                                                            >
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="rounded-xl border border-white/10 bg-black/20 p-5 text-sm text-muted">
                            No recent sets yet. Preview a set from Search, Browse, or Library and it will show up here.
                        </p>
                    )}
                </section>
    
    
    
    );
};
