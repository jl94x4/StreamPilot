import React, { useEffect, useMemo, useState } from 'react';
import {
    CheckCircle2,
    Bookmark,
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
import { StickySaveBar } from '../../shared/StickySaveBar';
import { BetaBadge, PosterSetsBetaBanner } from '../../shared/BetaBadge';
import { askConfirm } from '../../shared/confirm';
import { portalUrl, getPublicOrigin } from '../../shared/basePath';
import { posterSetsApi } from '../api';
import { buildTpdbImportBookmarklet } from '../../../lib/poster-sets/tpdbImportTools.js';
import { MEDIUX_FILTER_OPTIONS, type PosterSetsConfig } from '../types';
import { formatTpdbEta } from '../shared/tpdbCacheUi';
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
    LIBRARY_DETAIL_LAYOUT_OPTIONS,
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
    isCopyLibraryTitleEnabled,
    isMediuxEnabled,
    isTitleCardRail,
    isTitleCardSet,
    isTpdbEnabled,
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

const GB = 1024 * 1024 * 1024;
const TPDB_DISK_BUDGET_OPTIONS: Array<{ bytes: number; label: string }> = [
    { bytes: Math.round(0.5 * GB), label: '512 MB' },
    { bytes: 1 * GB, label: '1 GB' },
    { bytes: 2 * GB, label: '2 GB' },
    { bytes: 5 * GB, label: '5 GB' },
    { bytes: 10 * GB, label: '10 GB' },
    { bytes: 20 * GB, label: '20 GB' },
    { bytes: 50 * GB, label: '50 GB' },
    { bytes: 100 * GB, label: '100 GB' },
    { bytes: 128 * GB, label: '128 GB' },
    { bytes: 256 * GB, label: '256 GB' },
    { bytes: 512 * GB, label: '512 GB' },
];

const TPDB_REFRESH_HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
    value: String(hour),
    label: `${String(hour).padStart(2, '0')}:00`,
}));

const TPDB_REFRESH_INTERVAL_OPTIONS = [
    { value: '0', label: 'Once per day' },
    { value: '1', label: 'Every 1 hour' },
    { value: '2', label: 'Every 2 hours' },
    { value: '3', label: 'Every 3 hours' },
    { value: '4', label: 'Every 4 hours' },
    { value: '6', label: 'Every 6 hours' },
    { value: '8', label: 'Every 8 hours' },
    { value: '12', label: 'Every 12 hours' },
];

const formatRefreshScheduleHint = (hour: number, intervalHours: number) => {
    const start = Math.max(0, Math.min(23, Math.round(Number(hour) || 0)));
    const interval = Math.max(0, Math.min(24, Math.round(Number(intervalHours) || 0)));
    const fmt = (h: number) => `${String(h).padStart(2, '0')}:00`;
    if (!interval || interval >= 24) {
        return `Runs once daily at ${fmt(start)} (server local time).`;
    }
    const slots: number[] = [];
    for (let t = start; t < start + 24; t += interval) {
        slots.push(((t % 24) + 24) % 24);
    }
    const unique = [...new Set(slots)].sort((a, b) => a - b);
    return `Runs at ${unique.map(fmt).join(', ')} (server local time).`;
};

const formatBytes = (bytes: number) => {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    if (value < GB) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    return `${(value / GB).toFixed(2)} GB`;
};

export const PosterSetsSettingsView: React.FC = () => {
    const {
        toasts,
        setToasts,
        toast,
        tab,
        setTab,
        libraryDetailItem,
        setLibraryDetailItem,
        libraryDetailLayout,
        setLibraryDetailLayout,
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
        blocklistText,
        setBlocklistText,
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

    const webhookUrl = useMemo(() => {
        if (typeof window === 'undefined') return '';
        const token = String(configDraft.webhookToken || '').trim();
        if (!token) return '';
        return `${window.location.origin}${portalUrl('/api/poster-sets/webhook')}?token=${encodeURIComponent(token)}`;
    }, [configDraft.webhookToken]);

    const tpdbBookmarklet = useMemo(
        () => buildTpdbImportBookmarklet(getPublicOrigin(), { apply: false }),
        [],
    );
    const tpdbUserscriptHref = portalUrl('/api/poster-sets/tpdb-import.user.js');

    const [tpdbCacheStatus, setTpdbCacheStatus] = useState<Awaited<ReturnType<typeof posterSetsApi.tpdbCacheStatus>> | null>(null);
    const [tpdbCookiePaste, setTpdbCookiePaste] = useState('');
    const [tpdbCookieUserAgent, setTpdbCookieUserAgent] = useState('');
    const [warmScope, setWarmScope] = useState<{
        media: 'all' | 'movie' | 'show';
        source: 'full' | 'recent';
        skipCached: boolean;
        followedPrefetchOnly: boolean;
        followedCreatorsOnly: boolean;
    }>(() => ({
        media: configDraft.tpdbCacheWarmMedia === 'movie' || configDraft.tpdbCacheWarmMedia === 'show'
            ? configDraft.tpdbCacheWarmMedia
            : 'all',
        source: configDraft.tpdbCacheWarmSource === 'recent' ? 'recent' : 'full',
        skipCached: configDraft.tpdbCacheSkipCached !== false,
        followedPrefetchOnly: configDraft.tpdbPrioritizeFollowedCreators !== false,
        followedCreatorsOnly: configDraft.tpdbCacheFollowedCreatorsOnly === true,
    }));
    const [activityFilter, setActivityFilter] = useState<'all' | 'cache' | 'prefetch' | 'error' | 'followed'>('all');

    useEffect(() => {
        setWarmScope((prev) => {
            const media = configDraft.tpdbCacheWarmMedia === 'movie' || configDraft.tpdbCacheWarmMedia === 'show'
                ? configDraft.tpdbCacheWarmMedia
                : 'all';
            const source = configDraft.tpdbCacheWarmSource === 'recent' ? 'recent' : 'full';
            const skipCached = configDraft.tpdbCacheSkipCached !== false;
            const followedPrefetchOnly = configDraft.tpdbPrioritizeFollowedCreators !== false;
            const followedCreatorsOnly = configDraft.tpdbCacheFollowedCreatorsOnly === true;
            if (
                prev.media === media
                && prev.source === source
                && prev.skipCached === skipCached
                && prev.followedPrefetchOnly === followedPrefetchOnly
                && prev.followedCreatorsOnly === followedCreatorsOnly
            ) {
                return prev;
            }
            return { media, source, skipCached, followedPrefetchOnly, followedCreatorsOnly };
        });
    }, [
        configDraft.tpdbCacheWarmMedia,
        configDraft.tpdbCacheWarmSource,
        configDraft.tpdbCacheSkipCached,
        configDraft.tpdbPrioritizeFollowedCreators,
        configDraft.tpdbCacheFollowedCreatorsOnly,
    ]);

    useEffect(() => {
        if (tab !== 'settings' || !isTpdbEnabled(configDraft)) return undefined;
        let cancelled = false;
        let inFlight = false;
        const refresh = () => {
            if (inFlight) return;
            inFlight = true;
            void posterSetsApi.tpdbCacheStatus()
                .then((status) => {
                    if (!cancelled) {
                        setTpdbCacheStatus((prev) => (
                            prev?.audit && !status.audit
                                ? { ...status, audit: prev.audit }
                                : status
                        ));
                    }
                })
                .catch(() => {
                    // Keep the last snapshot so the live panel does not blank out.
                })
                .finally(() => {
                    inFlight = false;
                });
        };
        refresh();
        // Keep the scrape activity panel live while Settings is open.
        const timer = window.setInterval(refresh, 2000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [tab, configDraft.tpdbEnabled]);

    if (tab !== 'settings') return null;

    const warmPct = tpdbCacheStatus?.progress?.warm?.percent;
    const warmEta = formatTpdbEta(tpdbCacheStatus?.progress?.warm?.etaMs);
    const hydratePct = tpdbCacheStatus?.progress?.hydrate?.percent;
    const hydrateEta = formatTpdbEta(tpdbCacheStatus?.progress?.hydrate?.etaMs);
    const cacheBusy = Boolean(tpdbCacheStatus?.progress?.busy)
        || (tpdbCacheStatus?.hydrate?.warmQueue || 0) > 0
        || (tpdbCacheStatus?.hydrate?.queue || 0) > 0
        || (tpdbCacheStatus?.hydrate?.warmActive || 0) > 0
        || (tpdbCacheStatus?.hydrate?.active || 0) > 0
        || tpdbCacheStatus?.paused === true;
    const filteredActivity = (tpdbCacheStatus?.activity || []).filter((entry) => {
        if (activityFilter === 'all') return true;
        const kind = String(entry.kind || (
            entry.level === 'error' ? 'error'
                : /prefetch|hydrat|image/i.test(entry.message) ? 'prefetch'
                    : /follow/i.test(entry.message) ? 'followed'
                        : 'cache'
        ));
        return kind === activityFilter;
    });

    const persistConfig = async (partial: PosterSetsConfig | Record<string, unknown>) => {
        const response = await posterSetsApi.saveConfig({
            ...configDraft,
            tv_library: textToList(tvText),
            movie_library: textToList(movieText),
            creatorWhitelist: textToList(whitelistText).map((item) => item.replace(/^@+/, '')),
            creatorBlocklist: textToList(blocklistText).map((item) => item.replace(/^@+/, '')),
            token: configDraft.token === '********' ? undefined : configDraft.token,
            tpdb_password: configDraft.tpdb_password === '********' ? undefined : configDraft.tpdb_password,
            ...partial,
        });
        setConfigDraft({
            ...response.config,
            token: response.config.hasToken ? '********' : '',
            tpdb_password: response.config.hasTpdbPassword ? '********' : '',
        });
        return response.config;
    };

    const applySourceEnabled = async (source: 'tpdb' | 'mediux', enabled: boolean) => {
        const key = source === 'tpdb' ? 'tpdbEnabled' : 'mediuxEnabled';
        const label = source === 'tpdb' ? 'ThePosterDB' : 'MediUX';
        if (enabled) {
            setBusy('save');
            try {
                await persistConfig({ [key]: true });
                toast(`${label} turned on`);
            } catch (error) {
                toast(error instanceof Error ? error.message : `Failed to enable ${label}`, 'error');
            } finally {
                setBusy(null);
            }
            return;
        }
        const ok = await askConfirm(
            `Turn off ${label}? ${source === 'tpdb'
                ? 'Watches, Paste / Import, search, and cache for ThePosterDB will stop until you turn it back on.'
                : 'Search, Browse, and other MediUX labels will be hidden until you turn it back on.'}`,
            { title: `Disable ${label}?`, confirmLabel: 'Turn off' },
        );
        if (!ok) return;
        const purge = await askConfirm(
            source === 'tpdb'
                ? 'Also delete cached ThePosterDB titles, sets, and images from disk? Keep them if you might turn ThePosterDB back on.\n\nThis cannot be undone.'
                : 'Also delete cached MediUX Browse rails and collection sets from disk? Keep them if you might turn MediUX back on.\n\nThis cannot be undone.',
            {
                title: `Delete ${label} cache?`,
                confirmLabel: 'Delete cache',
                cancelLabel: 'Keep cache',
                danger: true,
            },
        );
        setBusy('save');
        try {
            if (source === 'tpdb') {
                await posterSetsApi.stopTpdbCache().catch(() => null);
            }
            if (purge) {
                if (source === 'tpdb') await posterSetsApi.clearTpdbCache();
                else await posterSetsApi.clearMediuxCache();
            }
            await persistConfig({ [key]: false });
            toast(purge ? `${label} turned off and cache deleted` : `${label} turned off`);
        } catch (error) {
            toast(error instanceof Error ? error.message : `Failed to disable ${label}`, 'error');
        } finally {
            setBusy(null);
        }
    };

    return (



        <section className={`${cardClass} w-full min-w-0 overflow-visible space-y-5 p-5 [overflow-wrap:anywhere]`}>
                    <div>
                        <h2 className={`${sectionTitleClass} flex flex-wrap items-center gap-2`}>
                            <span>Poster Sets config</span>
                            <BetaBadge title="Poster Sets is in BETA and still heavily in development. Expect rough edges, missing features, and breaking changes." />
                        </h2>
                        <p className={sectionBodyClass}>
                            Plex URL and token come from Settings → Media Player.
                            Import library names from there, then tune Poster Sets options below.
                        </p>
                    </div>
                    <PosterSetsBetaBanner />
                    <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 space-y-1">
                        <p className="text-sm font-semibold text-text">Plex connection</p>
                        {configDraft.portalPlexAvailable || configDraft.configured ? (
                            <>
                                <p className="text-xs text-muted">
                                    Using Settings → Media Player
                                    {configDraft.effective_base_url
                                        ? <> (<span className="font-mono text-text/80">{String(configDraft.effective_base_url).replace(/\/+$/, '')}</span>)</>
                                        : null}.
                                </p>
                                <p className="text-[11px] text-muted">
                                    Change the Direct Plex URL or token under Media Player — Poster Sets picks them up automatically.
                                </p>
                            </>
                        ) : (
                            <p className="text-xs text-amber-200/90">
                                Set Direct Plex URL and token under Settings → Media Player first.
                            </p>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void importFromPortal()}>
                            {busy === 'import' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                            Import libraries from Media Player
                        </button>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 space-y-1">
                        <p className="text-sm font-semibold text-text">Artwork sources</p>
                        <p className="text-xs text-muted">
                            Both are on by default. Turn ThePosterDB search off to use MediUX only in Discover while watches and the import script keep using ThePosterDB.
                        </p>
                        <SettingsToggleRow
                            title="ThePosterDB"
                            description="Watches, Paste / Import, credentials, and local cache."
                            checked={isTpdbEnabled(configDraft)}
                            onChange={(next) => void applySourceEnabled('tpdb', next)}
                            border={false}
                        />
                        {isTpdbEnabled(configDraft) ? (
                            <SettingsToggleRow
                                title="ThePosterDB in search"
                                description="Discover search, Browse, TPDB New, and library set lookup. Off = MediUX only, no TPDB rate limits. Watches and the import script still work."
                                checked={configDraft.tpdbSearchEnabled !== false}
                                onChange={(next) => {
                                    void (async () => {
                                        setBusy('save');
                                        try {
                                            await persistConfig({ tpdbSearchEnabled: next });
                                            toast(next
                                                ? 'ThePosterDB search on'
                                                : 'ThePosterDB search off — watches and the import script still work');
                                        } catch (error) {
                                            toast(error instanceof Error ? error.message : 'Failed to update search', 'error');
                                        } finally {
                                            setBusy(null);
                                        }
                                    })();
                                }}
                                border={false}
                            />
                        ) : null}
                        <SettingsToggleRow
                            title="MediUX"
                            description="Search, Browse rails, title cards, and MediUX labels."
                            checked={isMediuxEnabled(configDraft)}
                            onChange={(next) => void applySourceEnabled('mediux', next)}
                            border={false}
                        />
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 space-y-1">
                        <p className="text-sm font-semibold text-text">Library</p>
                        <SettingsToggleRow
                            title="Copy title on poster hover"
                            description="Shows a copy button on library movie/TV posters so you can paste the name into ThePosterDB. On phones the button stays visible on the poster. Off keeps the grid unchanged."
                            checked={isCopyLibraryTitleEnabled(configDraft)}
                            onChange={(next) => {
                                void (async () => {
                                    setBusy('save');
                                    try {
                                        await persistConfig({ copyLibraryTitleEnabled: next });
                                        toast(next ? 'Copy title on poster hover on' : 'Copy title on poster hover off');
                                    } catch (error) {
                                        toast(error instanceof Error ? error.message : 'Failed to update copy title', 'error');
                                    } finally {
                                        setBusy(null);
                                    }
                                })();
                            }}
                            border={false}
                        />
                    </div>
                    {isTpdbEnabled(configDraft) ? (
                        <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 space-y-3">
                            <p className="text-sm font-semibold text-text">Import from ThePosterDB</p>
                            <p className="text-xs text-muted leading-relaxed">
                                ThePosterDB blocks iframes, so this cannot live in an applet. Browse TPDB in a normal tab,
                                then send the set here. Both tools open Paste / Import so you can preview and queue
                                (you must be logged in as admin). Repeat imports reuse the same portal tab.
                            </p>
                            <div className="flex flex-wrap gap-2">
                                <a
                                    href={tpdbBookmarklet}
                                    onClick={(event) => event.preventDefault()}
                                    className={`${buttonClass} no-underline`}
                                    title="Drag this onto your bookmarks bar"
                                >
                                    <Bookmark className="h-4 w-4" />
                                    Bookmarklet (drag to bookmarks)
                                </a>
                                <button
                                    type="button"
                                    className={buttonClass}
                                    onClick={() => {
                                        void navigator.clipboard.writeText(tpdbBookmarklet).then(
                                            () => toast('Bookmarklet copied. Paste it as a new bookmark URL.'),
                                            () => toast('Could not copy bookmarklet.', 'error'),
                                        );
                                    }}
                                >
                                    Copy bookmarklet
                                </button>
                                <a
                                    href={tpdbUserscriptHref}
                                    className={`${primaryButtonClass} no-underline`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <Download className="h-4 w-4" />
                                    Install Tampermonkey script
                                </a>
                                <a
                                    href="https://theposterdb.com/recent"
                                    className={`${buttonClass} no-underline`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <ExternalLink className="h-4 w-4" />
                                    Open ThePosterDB
                                </a>
                            </div>
                            <p className="text-[11px] text-muted leading-relaxed">
                                Bookmarklet: open a set page, then click the bookmark. Userscript: adds a TPDB-styled import icon next to download/share on set pages and on poster cards.
                            </p>
                        </div>
                    ) : null}
                    <div className="grid gap-4 sm:grid-cols-2">
                        {isTpdbEnabled(configDraft) ? (
                        <>
                        <label className="block">
                            <span className="text-xs font-bold uppercase tracking-wide text-muted">TPDB username</span>
                            <input
                                className={`${fieldClass} mt-2`}
                                autoComplete="username"
                                placeholder="ThePosterDB login (optional)"
                                value={configDraft.tpdb_username || ''}
                                onChange={(event) => setConfigDraft((prev) => ({ ...prev, tpdb_username: event.target.value }))}
                            />
                        </label>
                        <label className="block">
                            <span className="text-xs font-bold uppercase tracking-wide text-muted">TPDB password</span>
                            <input
                                className={`${fieldClass} mt-2`}
                                type="password"
                                autoComplete="current-password"
                                placeholder={configDraft.hasTpdbPassword ? '•••••••• (unchanged)' : 'Optional — unlocks TMDB title search'}
                                value={configDraft.tpdb_password === '********' ? '' : (configDraft.tpdb_password || '')}
                                onChange={(event) => setConfigDraft((prev) => ({ ...prev, tpdb_password: event.target.value }))}
                            />
                            <span className="mt-1 block text-[11px] text-muted">
                                Optional. Login unlocks advanced TMDB/TVDB search. If Cloudflare blocks login from Docker/VPS,
                                import browser cookies below (or turn off “Use TPDB login” and use public search).
                            </span>
                        </label>
                        <div className="sm:col-span-2">
                            <SettingsToggleRow
                                title="Use TPDB login (advanced search)"
                                description="On: try login/saved cookies for TMDB/IMDB/TVDB resolve. Off: public title+year search only (works when Cloudflare blocks this host)."
                                checked={configDraft.tpdbUseLogin !== false}
                                onChange={(next) => setConfigDraft((prev) => ({
                                    ...prev,
                                    tpdbUseLogin: next,
                                }))}
                                border={false}
                            />
                        </div>
                        <div className="sm:col-span-2 space-y-2 rounded-lg border border-white/10 bg-black/20 px-3 py-3">
                            <p className="text-xs font-semibold text-text">Import TPDB browser cookies</p>
                            <p className="text-[11px] leading-relaxed text-muted">
                                Cloudflare often blocks password login from servers. In the same browser that is logged into theposterdb.com,
                                export cookies for that site only (Get cookies.txt LOCALLY or Cookie-Editor). Include
                                {' '}<code className="text-text/80">cf_clearance</code> and the session cookie
                                ({' '}<code className="text-text/80">the_poster_database_session</code>
                                {' '}/ <code className="text-text/80">remember_web_*</code>).
                                DevTools <code className="text-text/80">document.cookie</code> skips HttpOnly cookies and will fail.
                                Advanced TMDB search needs TPDB Pro. If Poster Sets runs on Docker/a VPS, Cloudflare may still
                                block because <code className="text-text/80">cf_clearance</code> is tied to your home IP — paste the
                                exact browser User-Agent below. Cookies expire — re-import when login stops working.
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                                <label className={`${buttonClass} cursor-pointer`}>
                                    <input
                                        type="file"
                                        accept=".txt,.json,text/plain,application/json"
                                        className="sr-only"
                                        disabled={busy !== null}
                                        onChange={(event) => {
                                            const file = event.target.files?.[0];
                                            event.target.value = '';
                                            if (!file) return;
                                            const reader = new FileReader();
                                            reader.onload = () => {
                                                const text = typeof reader.result === 'string' ? reader.result : '';
                                                if (!text.trim()) {
                                                    toast('Cookie file was empty', 'error');
                                                    return;
                                                }
                                                setTpdbCookiePaste(text);
                                                toast(`Loaded ${file.name} — click Import cookies`, 'success');
                                            };
                                            reader.onerror = () => toast('Could not read cookie file', 'error');
                                            reader.readAsText(file);
                                        }}
                                    />
                                    Choose cookies.txt
                                </label>
                                <span className="text-[11px] text-muted">or paste below</span>
                            </div>
                            <textarea
                                className={`${fieldClass} mt-1 min-h-[88px] font-mono text-[11px]`}
                                placeholder={'# Netscape HTTP Cookie File\nor Cookie-Editor JSON…'}
                                value={tpdbCookiePaste}
                                onChange={(event) => setTpdbCookiePaste(event.target.value)}
                            />
                            <label className="block">
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Browser User-Agent (needed for cf_clearance)</span>
                                <input
                                    className={`${fieldClass} mt-1 font-mono text-[11px]`}
                                    placeholder="chrome://version → copy the full User-Agent string"
                                    value={tpdbCookieUserAgent}
                                    onChange={(event) => setTpdbCookieUserAgent(event.target.value)}
                                />
                            </label>
                            <button
                                type="button"
                                className={buttonClass}
                                disabled={busy !== null || !tpdbCookiePaste.trim()}
                                onClick={async () => {
                                    setBusy('tpdb-cookies');
                                    try {
                                        const result = await posterSetsApi.importTpdbCookies({
                                            cookies: tpdbCookiePaste,
                                            userAgent: tpdbCookieUserAgent.trim() || undefined,
                                            tpdb_username: configDraft.tpdb_username,
                                            tpdb_password: configDraft.tpdb_password === '********'
                                                ? undefined
                                                : configDraft.tpdb_password,
                                        });
                                        toast(
                                            result.ok
                                                ? (result.warning
                                                    || `TPDB cookies imported (${result.cookieCount || 0})${result.hasCfClearance ? ' · cf_clearance OK' : ''}.`)
                                                : (result.error || 'Cookie import failed'),
                                            result.ok ? (result.warning ? undefined : 'success') : 'error',
                                        );
                                        if (result.ok) setTpdbCookiePaste('');
                                    } catch (error) {
                                        toast(error instanceof Error ? error.message : 'Cookie import failed', 'error');
                                    } finally {
                                        setBusy(null);
                                    }
                                }}
                            >
                                {busy === 'tpdb-cookies' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                Import cookies
                            </button>
                        </div>
                        <div className="sm:col-span-2 rounded-xl border border-white/10 bg-black/20 px-4 py-4 lg:px-5 lg:py-5 space-y-5">
                            <div className="flex flex-wrap items-end justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-text">ThePosterDB local cache</p>
                                    <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
                                        Permanent local poster database for <span className="text-text">library titles</span> (Library / Watching) —
                                        set lists and images stay on disk until you clear them or hit the image budget.
                                        With cache enabled, uncached library titles keep resolving in the background after a build
                                        (and after restart) until every title is attempted. Stop drops the queue and turns catch-up off
                                        until you build again. The daily job only rechecks titles already on disk for new sets.
                                    </p>
                                </div>
                                {tpdbCacheStatus ? (
                                    <p className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                                        tpdbCacheStatus.cacheEnabled === true
                                            ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300'
                                            : 'border-amber-400/30 bg-amber-500/10 text-amber-200'
                                    }`}
                                    >
                                        Server {tpdbCacheStatus.cacheEnabled === true ? 'ENABLED' : 'DISABLED'}
                                        {typeof tpdbCacheStatus.titles === 'number'
                                            ? ` · ${tpdbCacheStatus.titles} titles`
                                            : ''}
                                    </p>
                                ) : (
                                    <p className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-muted">
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        Connecting…
                                    </p>
                                )}
                            </div>

                            <div className="grid gap-4 lg:grid-cols-12 lg:gap-5">
                                <div className="space-y-3 lg:col-span-5">
                                    <div className="space-y-2 text-xs leading-relaxed text-muted">
                                        <p>
                                            <span className="font-semibold text-text/90">What it’s for:</span>{' '}
                                            a local poster “database” you keep — reopen titles offline, reapply from disk when TPDB is down,
                                            and keep sets/images ready when you change posters later.
                                        </p>
                                        <p>
                                            <span className="font-semibold text-text/90">How it works:</span>{' '}
                                            first open or library build scrapes TPDB once through the cache worker (priority front-of-queue on open) and writes title/set/image files.
                                            Later opens serve that disk copy, then quietly check TPDB for any new sets and merge them in.
                                            A scheduled job (configurable below) also checks all cached titles. Prefetch hydrates new set images.
                                            Followed creators can queue first; parallel workers (5) speed title resolve but raise 429 risk.
                                            Resumes from <code className="text-text/80">tpdb-warm-progress.json</code>; only image files drop when over budget.
                                        </p>
                                    </div>
                                    <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 font-mono text-[11px] text-text/85">
                                        <p className="font-sans text-[11px] font-semibold uppercase tracking-wide text-muted">Saved under</p>
                                        <p className="mt-1 break-all">
                                            {tpdbCacheStatus?.relativeRoot || 'config/poster-sets'}
                                            /
                                        </p>
                                        <ul className="mt-2 list-disc space-y-1 pl-4 font-sans text-[11px] text-muted">
                                            <li>
                                                <code className="text-text/80">tpdb-title-cache/</code>
                                                {' '}— title + set lists
                                            </li>
                                            <li>
                                                <code className="text-text/80">tpdb-set-cache/</code>
                                                {' '}— set preview metadata
                                            </li>
                                            <li>
                                                <code className="text-text/80">tpdb-image-cache/</code>
                                                {' '}— poster images
                                            </li>
                                        </ul>
                                        {tpdbCacheStatus?.rootDir ? (
                                            <p className="mt-2 break-all font-sans text-[11px] text-muted">
                                                Host: <span className="text-text/70">{tpdbCacheStatus.rootDir}</span>
                                            </p>
                                        ) : (
                                            <p className="mt-2 font-sans text-[11px] text-muted">
                                                Default <code className="text-text/80">config/poster-sets/</code>
                                                {' '}(or <code className="text-text/80">CONFIG_DIR</code> / <code className="text-text/80">POSTER_SETS_CONFIG_DIR</code>).
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <div className="rounded-lg border border-white/10 bg-black/25 px-3 lg:col-span-7">
                                    <SettingsToggleRow
                                        title="Enable local TPDB cache"
                                        description="Turn on disk caching for library title set lists (and optionally full set images below)."
                                        checked={configDraft.tpdbLocalCacheEnabled === true}
                                        onChange={(next) => setConfigDraft((prev) => ({
                                            ...prev,
                                            tpdbLocalCacheEnabled: next,
                                            ...(next ? {} : {
                                                tpdbAggressivePrefetch: false,
                                                tpdbWarmParallelWorkers: false,
                                                tpdbCacheOnLibraryAdd: false,
                                            }),
                                        }))}
                                        className="!py-3"
                                    />
                                    {tpdbCacheStatus && (
                                        <p className={`-mt-1 mb-1 text-[11px] ${
                                            tpdbCacheStatus.cacheEnabled === true
                                                ? 'text-emerald-300/90'
                                                : 'text-amber-200/90'
                                        }`}
                                        >
                                            {configDraft.tpdbLocalCacheEnabled === true && tpdbCacheStatus.cacheEnabled !== true
                                                ? 'Toggle is on in this form but not saved yet — click Save settings.'
                                                : configDraft.tpdbLocalCacheEnabled !== true && tpdbCacheStatus.cacheEnabled === true
                                                    ? 'Form shows off; reload or Save to sync.'
                                                    : tpdbCacheStatus.cacheEnabled === true && (tpdbCacheStatus.titles || 0) === 0
                                                        ? 'Enabled but empty — click Build cache from library, or wait for background catch-up after save.'
                                                        : null}
                                        </p>
                                    )}
                                    <SettingsToggleRow
                                        title="Cache on Plex library add"
                                        description="When Plex adds a movie or show (library.new webhook), download all ThePosterDB posters for that title into the local cache. On first enable, also backfills the last 20 movies and last 20 shows."
                                        checked={
                                            configDraft.tpdbLocalCacheEnabled === true
                                            && configDraft.tpdbCacheOnLibraryAdd !== false
                                        }
                                        onChange={(next) => setConfigDraft((prev) => ({
                                            ...prev,
                                            tpdbCacheOnLibraryAdd: next,
                                            ...(next ? { tpdbLocalCacheEnabled: true } : {}),
                                        }))}
                                        disabled={configDraft.tpdbLocalCacheEnabled !== true}
                                        className="!py-3"
                                    />
                                    {configDraft.tpdbLocalCacheEnabled === true
                                        && configDraft.tpdbCacheOnLibraryAdd !== false && (
                                        <div className="mb-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2.5">
                                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">
                                                Plex webhook URL
                                            </p>
                                            {webhookUrl ? (
                                                <>
                                                    <code className="text-[11px] break-all text-plex">{webhookUrl}</code>
                                                    <p className="mt-2 text-[11px] text-muted">
                                                        Add this under Plex Settings → Network → Webhooks (Plex Pass).
                                                        Treat the token like a password. Opening the URL in a browser only returns a health check.
                                                    </p>
                                                    <button
                                                        type="button"
                                                        disabled={busy !== null}
                                                        onClick={async () => {
                                                            setBusy('save');
                                                            try {
                                                                const response = await posterSetsApi.saveConfig({
                                                                    ...configDraft,
                                                                    rotateWebhookToken: true,
                                                                });
                                                                setConfigDraft({
                                                                    ...response.config,
                                                                    token: response.config.hasToken ? '********' : '',
                                                                    tpdb_password: response.config.hasTpdbPassword ? '********' : '',
                                                                });
                                                                toast('Webhook token rotated — update the URL in Plex', 'success');
                                                            } catch (error) {
                                                                toast(error instanceof Error ? error.message : 'Failed to rotate token', 'error');
                                                            } finally {
                                                                setBusy(null);
                                                            }
                                                        }}
                                                        className="mt-2 text-xs font-bold text-plex hover:underline disabled:opacity-50"
                                                    >
                                                        Rotate webhook token
                                                    </button>
                                                </>
                                            ) : (
                                                <p className="text-[11px] text-muted">
                                                    Save settings to generate a secret webhook URL for Plex.
                                                </p>
                                            )}
                                            {configDraft.tpdbFirstRunBackfillDone !== true && (
                                                <p className="mt-2 text-[11px] text-amber-200/90">
                                                    First-run backfill pending: last 20 movies + 20 shows will cache after save (or on next portal start).
                                                </p>
                                            )}
                                        </div>
                                    )}
                                    <SettingsToggleRow
                                        title="Prefetch set images (library titles only)"
                                        description="Download set pages and images in the background after a library cache build resolves a title or you open one (up to 6 parallel CDN downloads). Disk counts for sets/images update live while this runs."
                                        checked={configDraft.tpdbLocalCacheEnabled === true && configDraft.tpdbAggressivePrefetch === true}
                                        onChange={(next) => setConfigDraft((prev) => ({
                                            ...prev,
                                            tpdbAggressivePrefetch: next,
                                            ...(next ? { tpdbLocalCacheEnabled: true } : {}),
                                        }))}
                                        disabled={configDraft.tpdbLocalCacheEnabled !== true}
                                        className="!py-3"
                                    />
                                    <SettingsToggleRow
                                        title="Prioritize Creators you follow"
                                        description="When Prefetch is caching set pages and images, queue sets from Creators you follow first (in whitelist order) ahead of everyone else. Add creators under Creators you follow below."
                                        checked={
                                            configDraft.tpdbLocalCacheEnabled === true
                                            && configDraft.tpdbPrioritizeFollowedCreators !== false
                                        }
                                        onChange={(next) => setConfigDraft((prev) => ({
                                            ...prev,
                                            tpdbPrioritizeFollowedCreators: next,
                                            ...(next ? { tpdbLocalCacheEnabled: true } : {}),
                                        }))}
                                        disabled={configDraft.tpdbLocalCacheEnabled !== true}
                                        className="!py-3"
                                    />
                                    <SettingsToggleRow
                                        title="Only cache followed creators"
                                        description="Skip downloading set pages and images from creators you do not follow. Library titles still resolve; only Creators you follow fill the image cache. Add people under Creators you follow first."
                                        checked={
                                            configDraft.tpdbLocalCacheEnabled === true
                                            && configDraft.tpdbCacheFollowedCreatorsOnly === true
                                        }
                                        onChange={(next) => setConfigDraft((prev) => ({
                                            ...prev,
                                            tpdbCacheFollowedCreatorsOnly: next,
                                            ...(next ? {
                                                tpdbLocalCacheEnabled: true,
                                                tpdbPrioritizeFollowedCreators: true,
                                            } : {}),
                                        }))}
                                        disabled={configDraft.tpdbLocalCacheEnabled !== true}
                                        className="!py-3"
                                    />
                                    <SettingsToggleRow
                                        title="Parallel cache workers (experimental)"
                                        description="Run 5 cache workers with separate TPDB sessions (~5× title resolve). Turn off if you hit rate limits or Cloudflare blocks."
                                        checked={configDraft.tpdbLocalCacheEnabled === true && configDraft.tpdbWarmParallelWorkers === true}
                                        onChange={(next) => setConfigDraft((prev) => ({
                                            ...prev,
                                            tpdbWarmParallelWorkers: next,
                                            ...(next ? { tpdbLocalCacheEnabled: true } : {}),
                                        }))}
                                        disabled={configDraft.tpdbLocalCacheEnabled !== true}
                                        border={false}
                                        className="!py-3"
                                    />
                                </div>
                            </div>

                            <div className={`grid gap-4 border-t border-white/10 pt-5 lg:grid-cols-12 lg:gap-5 ${configDraft.tpdbLocalCacheEnabled === true ? '' : 'opacity-50'}`}>
                                <div className={`lg:col-span-4 ${configDraft.tpdbLocalCacheEnabled === true ? '' : 'pointer-events-none'}`}>
                                    <span className="text-xs font-bold uppercase tracking-wide text-muted">Disk budget</span>
                                    <div className="mt-2">
                                        <CustomSelect
                                            value={String(
                                                TPDB_DISK_BUDGET_OPTIONS.find((option) => (
                                                    option.bytes === Number(configDraft.tpdbCacheMaxBytes)
                                                ))?.bytes
                                                || TPDB_DISK_BUDGET_OPTIONS.find((option) => option.bytes === 2 * GB)?.bytes
                                                || TPDB_DISK_BUDGET_OPTIONS[2].bytes
                                            )}
                                            onChange={(value) => setConfigDraft((prev) => ({
                                                ...prev,
                                                tpdbCacheMaxBytes: Number(value) || (2 * GB),
                                            }))}
                                            options={TPDB_DISK_BUDGET_OPTIONS.map((option) => ({
                                                value: String(option.bytes),
                                                label: option.label,
                                            }))}
                                            className="w-full sm:min-w-[180px]"
                                        />
                                    </div>
                                    <span className="mt-1.5 block text-[11px] text-muted">
                                        Caps <code className="text-text/80">tpdb-image-cache/</code> only — oldest images are removed when over budget.
                                    </span>
                                </div>
                                {tpdbCacheStatus ? (
                                    <div className="rounded-lg border border-white/10 bg-black/25 px-3 py-3 sm:px-4 lg:col-span-8">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                                                Cache on disk
                                            </p>
                                            <p className="text-[11px] text-muted">
                                                {tpdbCacheStatus.diskScanning
                                                    ? 'Counting files on disk…'
                                                    : (tpdbCacheStatus?.hydrate?.warmActive || 0) > 0
                                                    || (tpdbCacheStatus?.hydrate?.warmQueue || 0) > 0
                                                    || (tpdbCacheStatus?.hydrate?.active || 0) > 0
                                                        ? 'Live · refreshes every 2s'
                                                        : 'Refreshes every 2s'}
                                            </p>
                                        </div>
                                        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                                            <div>
                                                <p className="text-[10px] uppercase tracking-wide text-muted">Title pages</p>
                                                <p className="text-lg font-semibold tabular-nums text-text sm:text-xl">
                                                    {tpdbCacheStatus.titles || 0}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] uppercase tracking-wide text-muted">Set pages</p>
                                                <p className="text-lg font-semibold tabular-nums text-text sm:text-xl">
                                                    {tpdbCacheStatus.sets || 0}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] uppercase tracking-wide text-muted">Images</p>
                                                <p className="text-lg font-semibold tabular-nums text-text sm:text-xl">
                                                    {tpdbCacheStatus.images || 0}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] uppercase tracking-wide text-muted">Image disk</p>
                                                <p className="text-lg font-semibold tabular-nums text-text sm:text-xl">
                                                    {formatBytes(tpdbCacheStatus.imageBytes || 0)}
                                                </p>
                                            </div>
                                        </div>
                                        <p className="mt-3 text-[11px] text-muted">
                                            Library builds grow <span className="text-text/80">title pages</span> as each title resolves.
                                            With <span className="text-text/80">Prefetch</span>, set pages and images rise live too
                                            (otherwise when you open a title).
                                        </p>
                                        {tpdbCacheStatus.audit ? (
                                            <div className="mt-3 space-y-1.5 rounded-md border border-white/10 bg-black/30 px-2.5 py-2 text-[11px] text-muted">
                                                <p className="font-semibold uppercase tracking-wide text-text/80">
                                                    Disk audit
                                                    {tpdbCacheStatus.audit.elapsedMs != null
                                                        ? ` · ${tpdbCacheStatus.audit.elapsedMs}ms`
                                                        : ''}
                                                </p>
                                                <p>
                                                    Titles: {tpdbCacheStatus.audit.titles?.files ?? 0} file(s)
                                                    {typeof tpdbCacheStatus.audit.titles?.unique === 'number'
                                                        ? ` · ${tpdbCacheStatus.audit.titles.unique} unique`
                                                        : ''}
                                                    {(tpdbCacheStatus.audit.titles?.aliasExtra || 0) > 0
                                                        ? ` · ${tpdbCacheStatus.audit.titles?.aliasExtra} TMDB/TVDB alias file(s)`
                                                        : ''}
                                                    {(tpdbCacheStatus.audit.titles?.invalid || 0) > 0
                                                        ? ` · ${tpdbCacheStatus.audit.titles?.invalid} empty/invalid`
                                                        : ''}
                                                </p>
                                                <p>
                                                    Sets: {tpdbCacheStatus.audit.sets?.files ?? 0} file(s)
                                                    {(tpdbCacheStatus.audit.sets?.orphan || 0) > 0
                                                        ? ` · ${tpdbCacheStatus.audit.sets?.orphan} orphan (not linked from any title page)`
                                                        : ' · none orphaned'}
                                                    {(tpdbCacheStatus.audit.sets?.missingFromDisk || 0) > 0
                                                        ? ` · ${tpdbCacheStatus.audit.sets?.missingFromDisk} referenced but missing`
                                                        : ''}
                                                </p>
                                                <p>
                                                    Images: {tpdbCacheStatus.audit.images?.files ?? 0} file(s)
                                                    {(tpdbCacheStatus.audit.images?.orphan || 0) > 0
                                                        ? ` · ${tpdbCacheStatus.audit.images?.orphan} orphan (not linked from set pages)`
                                                        : ' · none orphaned'}
                                                </p>
                                                {(tpdbCacheStatus.audit.proxyThumbs?.files || 0) > 0 ? (
                                                    <p>
                                                        UI thumb proxy ({tpdbCacheStatus.audit.folders?.proxyThumbs || 'image-cache/'}):
                                                        {' '}{tpdbCacheStatus.audit.proxyThumbs?.files} file(s)
                                                        {' · '}{formatBytes(tpdbCacheStatus.audit.proxyThumbs?.bytes || 0)}
                                                        {' '}(not in Image disk)
                                                    </p>
                                                ) : null}
                                            </div>
                                        ) : null}
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2 rounded-lg border border-dashed border-white/10 px-3 py-3 text-[11px] text-muted lg:col-span-8">
                                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                                        Loading live cache status…
                                    </div>
                                )}
                            </div>

                            <div className={`space-y-3 border-t border-white/10 pt-5 ${configDraft.tpdbLocalCacheEnabled === true ? '' : 'pointer-events-none opacity-50'}`}>
                                <div className="overflow-visible rounded-lg border border-white/10 bg-black/25">
                                    <div className="border-b border-white/10 px-3 py-2 sm:px-4">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                                                New-sets refresh schedule
                                            </p>
                                            {tpdbCacheStatus?.dailyRefresh?.nextRunAt ? (
                                                <p className="text-[11px] text-muted">
                                                    Next {new Date(tpdbCacheStatus.dailyRefresh.nextRunAt).toLocaleString()}
                                                </p>
                                            ) : null}
                                        </div>
                                    </div>
                                    <div className={`grid gap-3 p-3 sm:grid-cols-2 sm:gap-4 sm:p-4 ${configDraft.tpdbLocalCacheEnabled === true ? '' : 'pointer-events-none'}`}>
                                        <label className="block min-w-0">
                                            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Start time</span>
                                            <div className="mt-1.5">
                                                <CustomSelect
                                                    value={String(
                                                        Number.isFinite(Number(configDraft.tpdbCacheRefreshHour))
                                                            ? Math.max(0, Math.min(23, Number(configDraft.tpdbCacheRefreshHour)))
                                                            : 3
                                                    )}
                                                    onChange={(value) => setConfigDraft((prev) => ({
                                                        ...prev,
                                                        tpdbCacheRefreshHour: Math.max(0, Math.min(23, Number(value) || 0)),
                                                    }))}
                                                    options={TPDB_REFRESH_HOUR_OPTIONS}
                                                    className="w-full"
                                                />
                                            </div>
                                        </label>
                                        <label className="block min-w-0">
                                            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Repeat</span>
                                            <div className="mt-1.5">
                                                <CustomSelect
                                                    value={String(
                                                        Number.isFinite(Number(configDraft.tpdbCacheRefreshIntervalHours))
                                                            ? Math.max(0, Math.min(24, Number(configDraft.tpdbCacheRefreshIntervalHours)))
                                                            : 0
                                                    )}
                                                    onChange={(value) => setConfigDraft((prev) => ({
                                                        ...prev,
                                                        tpdbCacheRefreshIntervalHours: Math.max(0, Math.min(24, Number(value) || 0)),
                                                    }))}
                                                    options={TPDB_REFRESH_INTERVAL_OPTIONS}
                                                    className="w-full"
                                                />
                                            </div>
                                        </label>
                                        <p className="text-[11px] text-muted sm:col-span-2">
                                            {formatRefreshScheduleHint(
                                                Number(configDraft.tpdbCacheRefreshHour ?? 3),
                                                Number(configDraft.tpdbCacheRefreshIntervalHours ?? 0),
                                            )}
                                            {' '}Only rechecks titles already on disk for new sets — never starts a library build.
                                            Runs as its own worker (separate TPDB session), so it still goes ahead while a cache build is running.
                                            Save settings to apply. Times use the server/container clock.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className={`space-y-3 border-t border-white/10 pt-5 ${configDraft.tpdbLocalCacheEnabled === true ? '' : 'pointer-events-none opacity-50'}`}>
                                <div className="overflow-visible rounded-lg border border-white/10 bg-black/25">
                                    <div className="border-b border-white/10 px-3 py-2 sm:px-4">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Build scope</p>
                                        <p className="mt-0.5 text-[11px] text-muted">Save settings to keep Media, library source, skip-cached, and followed-only for later builds.</p>
                                    </div>
                                    <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-white/10">
                                        <div className="grid gap-3 p-3 sm:grid-cols-2 sm:gap-4 sm:p-4">
                                            <label className="block min-w-0">
                                                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Media</span>
                                                <div className="mt-1.5">
                                                    <CustomSelect
                                                        value={warmScope.media}
                                                        onChange={(value) => {
                                                            const media = (value === 'movie' || value === 'show' ? value : 'all') as 'all' | 'movie' | 'show';
                                                            setWarmScope((prev) => ({ ...prev, media }));
                                                            setConfigDraft((prev) => ({ ...prev, tpdbCacheWarmMedia: media }));
                                                        }}
                                                        options={[
                                                            { value: 'all', label: 'Movies + TV' },
                                                            { value: 'movie', label: 'Movies only' },
                                                            { value: 'show', label: 'TV only' },
                                                        ]}
                                                        className="w-full"
                                                    />
                                                </div>
                                            </label>
                                            <label className="block min-w-0">
                                                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Library source</span>
                                                <div className="mt-1.5">
                                                    <CustomSelect
                                                        value={warmScope.source}
                                                        onChange={(value) => {
                                                            const source = value === 'recent' ? 'recent' : 'full';
                                                            setWarmScope((prev) => ({ ...prev, source }));
                                                            setConfigDraft((prev) => ({ ...prev, tpdbCacheWarmSource: source }));
                                                        }}
                                                        options={[
                                                            { value: 'full', label: 'Recent + full library' },
                                                            { value: 'recent', label: 'Recently added only' },
                                                        ]}
                                                        className="w-full"
                                                    />
                                                </div>
                                            </label>
                                        </div>
                                        <div className="border-t border-white/10 px-3 py-1 lg:border-t-0 sm:px-4">
                                            <SettingsToggleRow
                                                title="Skip already cached titles"
                                                description="Only queue titles that do not already have a TPDB set list on disk (resume-friendly)."
                                                checked={warmScope.skipCached}
                                                onChange={(next) => {
                                                    setWarmScope((prev) => ({ ...prev, skipCached: next }));
                                                    setConfigDraft((prev) => ({ ...prev, tpdbCacheSkipCached: next }));
                                                }}
                                                border
                                                className="!py-2.5"
                                            />
                                            <SettingsToggleRow
                                                title="Prefetch followed creators first"
                                                description="When Prefetch is on, hydrate sets from Creators you follow before everyone else — others still queue after. Saves immediately."
                                                checked={warmScope.followedPrefetchOnly}
                                                onChange={(next) => {
                                                    setWarmScope((prev) => ({ ...prev, followedPrefetchOnly: next }));
                                                    setConfigDraft((prev) => ({
                                                        ...prev,
                                                        tpdbPrioritizeFollowedCreators: next,
                                                    }));
                                                    void posterSetsApi.saveConfig({ tpdbPrioritizeFollowedCreators: next })
                                                        .then((response) => {
                                                            if (response?.config) {
                                                                setConfigDraft((prev) => ({
                                                                    ...prev,
                                                                    ...response.config,
                                                                    token: response.config.hasToken ? '********' : (prev.token || ''),
                                                                    tpdb_password: response.config.hasTpdbPassword
                                                                        ? '********'
                                                                        : (prev.tpdb_password || ''),
                                                                    tpdbPrioritizeFollowedCreators: next,
                                                                }));
                                                            }
                                                        })
                                                        .catch((error) => {
                                                            toast(
                                                                error instanceof Error
                                                                    ? error.message
                                                                    : 'Failed to save followed-creators preference',
                                                                'error',
                                                            );
                                                        });
                                                }}
                                                border
                                                className="!py-2.5"
                                            />
                                            <SettingsToggleRow
                                                title="Only cache followed creators"
                                                description="Do not prefetch set pages or images from creators outside Creators you follow. Save settings to keep this for catch-up builds."
                                                checked={warmScope.followedCreatorsOnly}
                                                onChange={(next) => {
                                                    setWarmScope((prev) => ({ ...prev, followedCreatorsOnly: next }));
                                                    setConfigDraft((prev) => ({
                                                        ...prev,
                                                        tpdbCacheFollowedCreatorsOnly: next,
                                                        ...(next ? { tpdbPrioritizeFollowedCreators: true } : {}),
                                                    }));
                                                }}
                                                border={false}
                                                className="!py-2.5"
                                            />
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        className={buttonClass}
                                        disabled={busy !== null || configDraft.tpdbLocalCacheEnabled !== true}
                                        onClick={async () => {
                                            setBusy('tpdb-cache');
                                            try {
                                                if (
                                                    warmScope.followedCreatorsOnly
                                                    && !(configDraft.creatorWhitelist || []).length
                                                ) {
                                                    toast(
                                                        'Only cache followed creators is on, but Creators you follow is empty. Add creators first, or turn the option off.',
                                                        'error',
                                                    );
                                                    return;
                                                }
                                                const result = await posterSetsApi.warmTpdbLibraryCache([], {
                                                    skipCached: warmScope.skipCached,
                                                    force: !warmScope.skipCached,
                                                    followedPrefetchOnly: warmScope.followedPrefetchOnly,
                                                    followedCreatorsOnly: warmScope.followedCreatorsOnly,
                                                    fromLibrary: true,
                                                    media: warmScope.media,
                                                    source: warmScope.source,
                                                });
                                                toast(result.message || `Caching ${result.titles || 0} library title(s).`);
                                                const status = await posterSetsApi.tpdbCacheStatus().catch(() => null);
                                                if (status) setTpdbCacheStatus(status);
                                            } catch (error) {
                                                toast(error instanceof Error ? error.message : 'Cache build failed', 'error');
                                            } finally {
                                                setBusy(null);
                                            }
                                        }}
                                    >
                                        {busy === 'tpdb-cache' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                        Build cache from library
                                    </button>
                                    <button
                                        type="button"
                                        className={buttonClass}
                                        disabled={busy !== null || !cacheBusy}
                                        onClick={async () => {
                                            try {
                                                if (tpdbCacheStatus?.paused) {
                                                    await posterSetsApi.resumeTpdbCache();
                                                    toast('Cache resumed.');
                                                } else {
                                                    await posterSetsApi.pauseTpdbCache();
                                                    toast('Cache paused after the current title/set.');
                                                }
                                                const status = await posterSetsApi.tpdbCacheStatus().catch(() => null);
                                                if (status) setTpdbCacheStatus(status);
                                            } catch (error) {
                                                toast(error instanceof Error ? error.message : 'Pause/resume failed', 'error');
                                            }
                                        }}
                                    >
                                        {tpdbCacheStatus?.paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                                        {tpdbCacheStatus?.paused ? 'Resume' : 'Pause'}
                                    </button>
                                    <button
                                        type="button"
                                        className={buttonClass}
                                        disabled={busy !== null || !cacheBusy}
                                        onClick={async () => {
                                            const ok = await askConfirm('Stop the cache queue? In-flight work finishes; waiting titles/sets are dropped (disk cache is kept).', {
                                                title: 'Stop cache build?',
                                                confirmLabel: 'Stop',
                                                cancelLabel: 'Cancel',
                                            });
                                            if (!ok) return;
                                            try {
                                                const result = await posterSetsApi.stopTpdbCache();
                                                toast(`Stopped — dropped ${result.droppedTitles || 0} title(s), ${result.droppedSets || 0} set(s).`);
                                                const status = await posterSetsApi.tpdbCacheStatus().catch(() => null);
                                                if (status) setTpdbCacheStatus(status);
                                            } catch (error) {
                                                toast(error instanceof Error ? error.message : 'Stop failed', 'error');
                                            }
                                        }}
                                    >
                                        <X className="h-4 w-4" />
                                        Stop
                                    </button>
                                    <button
                                        type="button"
                                        className={buttonClass}
                                        disabled={busy !== null}
                                        onClick={async () => {
                                            const ok = await askConfirm(
                                                'This will delete cached ThePosterDB title pages, set previews, and downloaded images from disk.',
                                                {
                                                    title: 'Clear TPDB cache?',
                                                    confirmLabel: 'Continue',
                                                    cancelLabel: 'Cancel',
                                                },
                                            );
                                            if (!ok) return;
                                            const confirmed = await askConfirm(
                                                'All TPDB cache files on disk will be permanently deleted. You will need to rebuild or re-open titles to restore them.\n\nThis action cannot be undone.',
                                                {
                                                    title: 'Permanently delete TPDB cache?',
                                                    confirmLabel: 'Delete everything',
                                                    cancelLabel: 'Keep cache',
                                                    danger: true,
                                                },
                                            );
                                            if (!confirmed) return;
                                            setBusy('tpdb-cache');
                                            try {
                                                const result = await posterSetsApi.clearTpdbCache();
                                                toast(`Cleared ${result.cleared?.titles || 0} titles, ${result.cleared?.sets || 0} sets, ${result.cleared?.images || 0} images.`);
                                                const status = await posterSetsApi.tpdbCacheStatus().catch(() => null);
                                                if (status) setTpdbCacheStatus(status);
                                            } catch (error) {
                                                toast(error instanceof Error ? error.message : 'Clear failed', 'error');
                                            } finally {
                                                setBusy(null);
                                            }
                                        }}
                                    >
                                        Clear TPDB cache
                                    </button>
                                    <button
                                        type="button"
                                        className={buttonClass}
                                        disabled={busy !== null}
                                        onClick={async () => {
                                            try {
                                                const status = await posterSetsApi.tpdbCacheAuditDisk();
                                                setTpdbCacheStatus(status);
                                                const audit = status.audit;
                                                const orphanSets = audit?.sets?.orphan || 0;
                                                const orphanImages = audit?.images?.orphan || 0;
                                                const aliases = audit?.titles?.aliasExtra || 0;
                                                const invalid = audit?.titles?.invalid || 0;
                                                const parts = [
                                                    `Titles ${status.titles ?? 0}`,
                                                    `sets ${status.sets ?? 0}`,
                                                    `images ${status.images ?? 0}`,
                                                ];
                                                if (aliases) parts.push(`${aliases} alias file(s)`);
                                                if (invalid) parts.push(`${invalid} invalid title(s)`);
                                                if (orphanSets) parts.push(`${orphanSets} orphan set(s)`);
                                                if (orphanImages) parts.push(`${orphanImages} orphan image(s)`);
                                                toast(
                                                    orphanSets || orphanImages || invalid
                                                        ? `Disk audit: ${parts.join(' · ')}`
                                                        : `Disk audit OK — ${parts.join(' · ')}`,
                                                );
                                            } catch (error) {
                                                toast(error instanceof Error ? error.message : 'Disk audit failed', 'error');
                                            }
                                        }}
                                    >
                                        <RefreshCw className="h-4 w-4" />
                                        Refresh usage
                                    </button>
                                </div>
                                <p className="px-1 text-[11px] text-muted">
                                    Build walks the full library (not just the first 1,000 titles) and keeps going in the background
                                    until every title is attempted. Stop turns catch-up off; Pause only waits.
                                    Refresh usage force-rescans title/set/image folders and reports orphans vs the counters.
                                </p>
                            </div>

                            <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-3 sm:px-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                                        Live scrape activity
                                    </p>
                                    <p className="text-[11px] text-muted">
                                        {tpdbCacheStatus?.paused
                                            ? 'Paused'
                                            : (tpdbCacheStatus?.hydrate?.warmActive || 0) > 0 || (tpdbCacheStatus?.hydrate?.active || 0) > 0
                                                ? 'Working…'
                                                : (tpdbCacheStatus?.hydrate?.warmQueue || 0) > 0 || (tpdbCacheStatus?.hydrate?.queue || 0) > 0
                                                    ? 'Queued'
                                                    : tpdbCacheStatus?.libraryContinue?.enabled
                                                        ? 'Background catch-up on'
                                                        : 'Idle'}
                                        {(tpdbCacheStatus?.hydrate?.warmQueue || 0) > 0
                                            ? ` · ${tpdbCacheStatus?.hydrate?.warmQueue} title(s)`
                                            : ''}
                                        {(tpdbCacheStatus?.hydrate?.queue || 0) > 0
                                            ? ` · ${tpdbCacheStatus?.hydrate?.queue} set(s)`
                                            : ''}
                                        {(tpdbCacheStatus?.hydrate?.rateLimit?.cooldownMs || 0) > 0
                                            ? ` · cooldown ${Math.ceil((tpdbCacheStatus?.hydrate?.rateLimit?.cooldownMs || 0) / 1000)}s`
                                            : ''}
                                    </p>
                                </div>
                                <div className="mt-3 grid gap-4 lg:grid-cols-12 lg:gap-5">
                                    <div className="space-y-2 lg:col-span-5">
                                        {(warmPct != null || hydratePct != null) ? (
                                            <div className="space-y-2 rounded-md border border-white/10 bg-black/25 px-2.5 py-2">
                                                {warmPct != null ? (
                                                    <div>
                                                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                                                            <span className="font-semibold text-text/90">
                                                                Titles {tpdbCacheStatus?.progress?.warm?.completed || 0}/{tpdbCacheStatus?.progress?.warm?.total || 0}
                                                                {warmPct != null ? ` · ${warmPct}%` : ''}
                                                            </span>
                                                            <span className="text-muted">{warmEta ? `ETA ${warmEta}` : 'ETA —'}</span>
                                                        </div>
                                                        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                                                            <div className="h-full rounded-full bg-plex/80 transition-all" style={{ width: `${Math.max(2, warmPct || 0)}%` }} />
                                                        </div>
                                                    </div>
                                                ) : null}
                                                {hydratePct != null && (tpdbCacheStatus?.progress?.hydrate?.total || 0) > 0 ? (
                                                    <div>
                                                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                                                            <span className="font-semibold text-text/90">
                                                                Prefetch {tpdbCacheStatus?.progress?.hydrate?.completed || 0}/{tpdbCacheStatus?.progress?.hydrate?.total || 0}
                                                                {hydratePct != null ? ` · ${hydratePct}%` : ''}
                                                            </span>
                                                            <span className="text-muted">{hydrateEta ? `ETA ${hydrateEta}` : 'ETA —'}</span>
                                                        </div>
                                                        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                                                            <div className="h-full rounded-full bg-sky-400/80 transition-all" style={{ width: `${Math.max(2, hydratePct || 0)}%` }} />
                                                        </div>
                                                    </div>
                                                ) : null}
                                            </div>
                                        ) : null}
                                        <p className="text-xs text-text/90">
                                            {tpdbCacheStatus?.current
                                                || (configDraft.tpdbLocalCacheEnabled === true
                                                    ? 'No scrape in progress — open a library title or build the cache from your library to see activity here.'
                                                    : 'Enable local TPDB cache to start logging scrape / prefetch work.')}
                                        </p>
                                        {tpdbCacheStatus?.hydrate?.lastError ? (
                                            <div className="flex flex-wrap items-start justify-between gap-2">
                                                <p className="text-[11px] text-red-300/90">
                                                    Last error: {tpdbCacheStatus.hydrate.lastError}
                                                </p>
                                                <button
                                                    type="button"
                                                    className="text-[11px] font-semibold text-plex hover:underline"
                                                    onClick={async () => {
                                                        try {
                                                            await navigator.clipboard.writeText(String(tpdbCacheStatus.hydrate?.lastError || ''));
                                                            toast('Copied last error.');
                                                        } catch {
                                                            toast('Could not copy error', 'error');
                                                        }
                                                    }}
                                                >
                                                    Copy error
                                                </button>
                                            </div>
                                        ) : null}
                                        <p className="text-[11px] text-muted">
                                            Auto-refreshes every 2s. Builds write title pages as they finish; Prefetch also grows set/image counts live.
                                        </p>
                                    </div>
                                    <div className="space-y-2 lg:col-span-7">
                                        <div className="flex flex-wrap gap-1.5">
                                            {([
                                                ['all', 'All'],
                                                ['cache', 'Cache'],
                                                ['prefetch', 'Prefetch'],
                                                ['followed', 'Followed'],
                                                ['error', 'Errors'],
                                            ] as const).map(([id, label]) => (
                                                <button
                                                    key={id}
                                                    type="button"
                                                    className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide transition ${
                                                        activityFilter === id
                                                            ? 'border-plex/40 bg-plex/15 text-plex'
                                                            : 'border-white/10 bg-black/20 text-muted hover:border-plex/30 hover:text-text'
                                                    }`}
                                                    onClick={() => setActivityFilter(id)}
                                                >
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                        <div className="max-h-56 overflow-y-auto rounded-md border border-white/5 bg-black/40 px-2 py-1.5 font-mono text-[11px] leading-relaxed lg:min-h-[12rem]">
                                            {filteredActivity.length ? (
                                                filteredActivity.slice(0, 40).map((entry) => {
                                                    const time = new Date(entry.at).toLocaleTimeString();
                                                    const tone = entry.level === 'error'
                                                        ? 'text-red-300'
                                                        : entry.level === 'warn'
                                                            ? 'text-amber-200/90'
                                                            : 'text-text/80';
                                                    return (
                                                        <div key={`${entry.at}-${entry.message}`} className={`py-0.5 ${tone}`}>
                                                            <span className="text-muted">{time}</span>
                                                            {' '}
                                                            {entry.message}
                                                            {entry.detail ? (
                                                                <span className="text-muted"> — {entry.detail}</span>
                                                            ) : null}
                                                        </div>
                                                    );
                                                })
                                            ) : (
                                                <p className="py-1 text-muted">No activity yet this session.</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        </>
                        ) : null}
                        <label className="block">
                            <textarea
                                className={`${fieldClass} mt-2 min-h-24`}
                                placeholder={'TV Shows\nAnime'}
                                value={tvText}
                                onChange={(event) => setTvText(event.target.value)}
                            />
                            <span className="mt-1 block text-[11px] text-muted">One library name per line.</span>
                        </label>
                        <label className="block">
                            <span className="text-xs font-bold uppercase tracking-wide text-muted">movie_library</span>
                            <textarea
                                className={`${fieldClass} mt-2 min-h-24`}
                                placeholder="Movies"
                                value={movieText}
                                onChange={(event) => setMovieText(event.target.value)}
                            />
                        </label>
                        <label className="block sm:col-span-2">
                            <span className="text-xs font-bold uppercase tracking-wide text-muted">bulk_txt</span>
                            <input
                                className={`${fieldClass} mt-2`}
                                value={configDraft.bulk_txt}
                                onChange={(event) => setConfigDraft((prev) => ({ ...prev, bulk_txt: event.target.value }))}
                            />
                            <span className="mt-1 block text-[11px] text-muted">
                                Filename under config/poster-sets/ for "Apply from file".
                            </span>
                        </label>
                        <label className="block sm:col-span-2">
                            <span className="text-xs font-bold uppercase tracking-wide text-muted">Creators you follow</span>
                            <textarea
                                className={`${fieldClass} mt-2 min-h-24`}
                                placeholder={'kaster\nTheDoctor30'}
                                value={whitelistText}
                                onChange={(event) => setWhitelistText(event.target.value)}
                            />
                            <span className="mt-1 block text-[11px] text-muted">
                                One{(isMediuxEnabled(configDraft) && isTpdbEnabled(configDraft))
                                    ? ' MediUX / ThePosterDB'
                                    : isMediuxEnabled(configDraft)
                                        ? ' MediUX'
                                        : isTpdbEnabled(configDraft)
                                            ? ' ThePosterDB'
                                            : ''} username per line (no @ needed). Browse adds a &quot;Creators you follow&quot; row with only their sets.
                                {isTpdbEnabled(configDraft)
                                    ? ' With local cache Prefetch + Prioritize Creators you follow, their sets hydrate first during cache builds.'
                                    : ''}
                                Click any @username to open their full catalog.
                            </span>
                        </label>
                        <label className="block sm:col-span-2">
                            <span className="text-xs font-bold uppercase tracking-wide text-muted">Blocked creators</span>
                            <textarea
                                className={`${fieldClass} mt-2 min-h-24`}
                                placeholder={'muikman2000'}
                                value={blocklistText}
                                onChange={(event) => setBlocklistText(event.target.value)}
                            />
                            <span className="mt-1 block text-[11px] text-muted">
                                One username per line. Their sets are hidden on titles/Browse
                                {isTpdbEnabled(configDraft) ? ' and skipped during TPDB image cache' : ''}. Save settings to apply.
                            </span>
                        </label>
                    </div>
                    {isMediuxEnabled(configDraft) ? (
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-muted">mediux_filters</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                            {MEDIUX_FILTER_OPTIONS.map((option) => {
                                const active = (configDraft.mediux_filters || []).includes(option.id);
                                return (
                                    <button
                                        key={option.id}
                                        type="button"
                                        className={active ? primaryButtonClass : buttonClass}
                                        onClick={() => toggleFilter(option.id)}
                                    >
                                        {option.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    ) : null}
                    <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                        <p className="text-sm font-semibold text-text">Library title panel</p>
                        <p className="mt-1 text-xs text-muted">
                            Full screen opens the title in the Library tab (same in-page layout as Discover).
                            Side drawer overlays the library grid. You can also toggle layout from the panel header.
                        </p>
                        <div className="mt-3">
                            <CustomSelect
                                value={libraryDetailLayout}
                                onChange={(value) => setLibraryDetailLayout(value === 'modal' ? 'modal' : 'drawer')}
                                options={[...LIBRARY_DETAIL_LAYOUT_OPTIONS]}
                                className="w-full sm:min-w-[180px] sm:w-auto"
                            />
                        </div>
                    </div>
                    {isTpdbEnabled(configDraft) && isMediuxEnabled(configDraft) && configDraft.tpdbSearchEnabled !== false ? (
                    <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                        <p className="text-sm font-semibold text-text">Fallback for duplicates</p>
                        <p className="mt-1 text-xs text-muted">
                            When Both finds the same title/set on MediUX and ThePosterDB, keep this source as the primary card.
                        </p>
                        <div className="mt-3">
                            <CustomSelect
                                value={configDraft.dupePreference === 'mediux' ? 'mediux' : 'posterdb'}
                                onChange={(value) => setConfigDraft((prev) => ({
                                    ...prev,
                                    dupePreference: value === 'mediux' ? 'mediux' : 'posterdb',
                                }))}
                                options={[
                                    { value: 'posterdb', label: 'Prefer ThePosterDB' },
                                    { value: 'mediux', label: 'Prefer MediUX' },
                                ]}
                                className="w-full sm:min-w-[180px] sm:w-auto"
                            />
                        </div>
                    </div>
                    ) : null}
                    <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                        <p className="text-sm font-semibold text-text">Apply destination</p>
                        <p className="mt-1 text-xs text-muted">
                            Where queued artwork is written after a successful apply. Jellyfin/Emby use Settings → Media Player credentials.
                            Local mode writes poster.jpg, season posters, and episode thumbs beside Plex media paths.
                        </p>
                        <div className="mt-3">
                            <CustomSelect
                                value={configDraft.applyDestination || 'plex'}
                                onChange={(value) => setConfigDraft((prev) => ({
                                    ...prev,
                                    applyDestination: value as PosterSetsConfig['applyDestination'],
                                }))}
                                options={[
                                    { value: 'plex', label: 'Plex server upload' },
                                    { value: 'local', label: 'Local files only (beside media)' },
                                    { value: 'plex_local', label: 'Plex upload + local files' },
                                    { value: 'jellyfin', label: 'Jellyfin Images API' },
                                    { value: 'emby', label: 'Emby Images API' },
                                ]}
                                className="w-full sm:min-w-[180px] sm:w-auto"
                            />
                        </div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 px-4">
                        <SettingsToggleRow
                            title="Clear overlays after upload"
                            description="Default on. Removes every Overlays stamp the Overlays page can apply — 4K/HDR, Atmos, editions, banners, and the Overlay label — so the new set art stays clean. The next Overlays run can restamp onto this artwork."
                            checked={configDraft.reset_overlay !== false}
                            onChange={(next) => setConfigDraft((prev) => ({ ...prev, reset_overlay: next }))}
                            border={false}
                        />
                    </div>
                    <div className="space-y-0 rounded-xl border border-white/10 bg-black/20 px-4">
                        <SettingsToggleRow
                            title="Enable set watchers"
                            description="Required for auto-apply. Periodically re-scrape pinned sets and queue only new or newly matched assets (respects Queue pause)."
                            checked={configDraft.watchersEnabled !== false}
                            onChange={(next) => setConfigDraft((prev) => ({ ...prev, watchersEnabled: next }))}
                        />
                        <SettingsToggleRow
                            title="Auto-watch on apply"
                            description="After you apply a set — including bulk — pin it on Watching. If the title is not in your library yet, the apply is logged as a Warning and the set auto-applies when the title is added."
                            checked={configDraft.autoWatchOnApply !== false}
                            onChange={(next) => setConfigDraft((prev) => ({ ...prev, autoWatchOnApply: next }))}
                        />
                        <SettingsToggleRow
                            title="Gotify digest when watchers queue new art"
                            description="Send a Gotify digest when set watchers enqueue new posters. Requires Gotify enabled under Settings → Notifications."
                            checked={configDraft.notifyOnWatcherDigest !== false}
                            onChange={(next) => setConfigDraft((prev) => ({ ...prev, notifyOnWatcherDigest: next }))}
                        />
                        <SettingsToggleRow
                            title="Check watches when Sonarr imports episodes"
                            description="Uses the existing Scanner Sonarr On Import webhook. Debounces 3 minutes per show/season, then checks matching watches for new title cards."
                            checked={configDraft.arrWatchHookEnabled !== false}
                            onChange={(next) => setConfigDraft((prev) => ({ ...prev, arrWatchHookEnabled: next }))}
                            border={false}
                        />
                    </div>
                    <label className="block max-w-xs">
                        <span className="text-xs font-bold uppercase tracking-wide text-muted">watch interval (hours)</span>
                        <input
                            className={`${fieldClass} mt-2`}
                            type="number"
                            min={1}
                            step={1}
                            value={configDraft.watchIntervalHours ?? 6}
                            onChange={(event) => {
                                const hours = Math.max(1, Number(event.target.value) || 6);
                                setConfigDraft((prev) => ({ ...prev, watchIntervalHours: hours }));
                            }}
                        />
                        <span className="mt-1 block text-[11px] text-muted">Default 6 hours. Minimum 1. Plex library-add and Sonarr import also check matching watches sooner.</span>
                    </label>
                    <StickySaveBar>
                        <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void runTest()}>
                            {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            Test connection
                        </button>
                        <button type="button" className={primaryButtonClass} disabled={busy !== null} onClick={() => void saveSettings()}>
                            {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            Save settings
                        </button>
                    </StickySaveBar>
                    {testResult ? <p className="text-sm text-muted">{testResult}</p> : null}
                </section>
    
    
    
    );
};
