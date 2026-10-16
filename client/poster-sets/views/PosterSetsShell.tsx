import React from 'react';
import {
    CheckCircle2,
    ClipboardPaste,
    Clock,
    Compass,
    Eye,
    Image as ImageIcon,
    Layers,
    Library,
    ListOrdered,
    RefreshCw,
    ScrollText,
    Settings2,
    XCircle,
} from 'lucide-react';
import { ToastContainer } from '../../shared/toast';
import { BetaBadge } from '../../shared/BetaBadge';
import { useDiscoverI18n } from '../../discovery/i18n';
import {
    DashboardHero,
    DashboardPageShell,
    DashboardSubnav,
    dashboardSubnavLinkClass,
} from '../../shared/dashboard/DashboardChrome';
import { usePosterSetsDashboard } from '../PosterSetsDashboardContext';
import { LibraryTitleDetailPanel } from '../LibraryTitleDetailPanel';
import {
    buttonClass,
    discoverSubNavForConfig,
    isDiscoverInternalTab,
    isMediuxEnabled,
    isCopyLibraryTitleEnabled,
    isTpdbSearchEnabled,
    posterSetsHeroTitle,
    primaryButtonClass,
} from '../shared';
import { PosterSetsBrowseView } from './PosterSetsBrowseView';
import { PosterSetsLibraryView } from './PosterSetsLibraryView';
import { PosterSetsCollectionsView } from './PosterSetsCollectionsView';
import { PosterSetsQueueView } from './PosterSetsQueueView';
import { PosterSetsWatchingView } from './PosterSetsWatchingView';
import { PosterSetsRecentView } from './PosterSetsRecentView';
import { PosterSetsTpdbRecentView } from './PosterSetsTpdbRecentView';
import { PosterSetsSearchView } from './PosterSetsSearchView';
import { PosterSetsPasteView } from './PosterSetsPasteView';
import { PosterSetsHistoryView } from './PosterSetsHistoryView';
import { PosterSetsSettingsView } from './PosterSetsSettingsView';
import { PosterSetsFloatingBars } from './PosterSetsFloatingBars';

const formatJobState = (state?: string | null) => {
    const raw = String(state || 'none').trim();
    if (!raw) return 'None';
    return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
};

export const PosterSetsShell: React.FC = () => {
    const { t } = useDiscoverI18n();
    const betaNotice = t('posterSetsPage.betaNotice');
    const ctx = usePosterSetsDashboard();
    const {
        toasts,
        setToasts,
        load,
        busy,
        status,
        tab,
        browseSeeAllId,
        openBrowseRail,
        goToPrimaryTab,
        queueStats,
        watchStatsState,
        historyJobs,
        goToDiscoverView,
        selectedBulkCount,
        inspectorOpen,
        libraryDetailItem,
        closeLibraryItem,
        libraryDetailLayout,
        setLibraryDetailLayout,
        configDraft,
        queuePaused,
        watches,
        toast,
        blockCreator,
        loadQueue,
        loadHistory,
        loadWatches,
    } = ctx;

    const workerReady = Boolean(status?.workerReady);
    const configured = Boolean(status?.configured);
    const libraryPageOpen = Boolean(libraryDetailItem)
        && libraryDetailLayout !== 'drawer'
        && tab === 'library';
    const lastJob = status?.recentJobs?.[0] || null;
    const lastJobState = formatJobState(lastJob?.state);
    const lastJobFailed = /fail|error|cancel/i.test(String(lastJob?.state || ''));
    const lastJobWarning = /warn/i.test(String(lastJob?.state || ''));
    const failedHistoryCount = historyJobs.filter((job) => (
        ['failed', 'error'].includes(String(job.state || '').toLowerCase())
    )).length;

    const statusItems = [
        {
            label: 'Worker',
            value: workerReady ? 'Ready' : 'Missing',
            ok: workerReady,
            icon: workerReady
                ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                : <XCircle className="h-3.5 w-3.5 text-rose-300" />,
            hint: null as string | null,
        },
        {
            label: 'Config',
            value: configured ? 'Valid' : 'Setup',
            ok: configured,
            icon: configured
                ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                : <Settings2 className="h-3.5 w-3.5 text-amber-300" />,
            hint: null as string | null,
        },
        {
            label: 'Last job',
            value: lastJobState,
            ok: !lastJobFailed && !lastJobWarning && lastJobState !== 'None',
            icon: lastJobFailed
                ? <XCircle className="h-3.5 w-3.5 text-rose-300" />
                : lastJobWarning
                    ? <Clock className="h-3.5 w-3.5 text-amber-300" />
                    : <ListOrdered className="h-3.5 w-3.5 text-sky-300" />,
            hint: lastJob
                ? `${lastJob.type || 'job'} · ${lastJobState}`
                : 'No jobs yet',
        },
    ];

    return (
        <DashboardPageShell className={`${selectedBulkCount > 0 || inspectorOpen ? 'pb-28' : ''}`}>
                <ToastContainer toasts={toasts} setToasts={setToasts} />

                <DashboardHero
                    accent="plex"
                    eyebrow={
                        <span className="inline-flex items-center gap-2">
                            <span>Poster Sets</span>
                            <BetaBadge title={betaNotice} />
                        </span>
                    }
                    title={posterSetsHeroTitle(configDraft)}
                    description="Start from your library, pick a title, preview poster sets, and apply. Search creators and browse rails in Discover — queue, watching, logs, and settings stay one click away."
                    icon={<ImageIcon className="h-3.5 w-3.5" />}
                    secondaryBlob
                    actions={(
                        <button type="button" className={buttonClass} onClick={() => void load()} disabled={busy !== null}>
                            <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /> Refresh
                        </button>
                    )}
                />

                <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
                    <div className="grid grid-cols-3 divide-x divide-white/10">
                        {statusItems.map((item) => (
                            <div
                                key={item.label}
                                className="flex min-w-0 flex-col items-center gap-1 px-2 py-2.5 text-center sm:items-start sm:px-3 sm:py-3 sm:text-left"
                                title={item.hint || undefined}
                            >
                                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
                                    {item.icon}
                                    <span>{item.label}</span>
                                </div>
                                <p className={`truncate text-sm font-semibold sm:text-[15px] ${
                                    item.ok
                                        ? 'text-text'
                                        : item.label === 'Last job' && lastJobFailed
                                            ? 'text-rose-200'
                                            : 'text-amber-100'
                                }`}>
                                    {item.value}
                                </p>
                                {item.hint ? (
                                    <p className="hidden truncate text-[10px] text-muted sm:block">{item.hint}</p>
                                ) : null}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="space-y-2">
                    <DashboardSubnav>
                        {([
                            ['library', 'Library', Library],
                            ['collections', 'Collection Sets', Layers],
                            ['discover', 'Discover', Compass],
                            ['queue', 'Queue', ListOrdered],
                            ['watches', 'Watching', Eye],
                            ['logs', 'Logs', ScrollText],
                            ['paste', 'Paste / Import', ClipboardPaste],
                            ['settings', 'Settings', Settings2],
                        ] as const).map(([id, label, Icon]) => {
                            const active = id === 'discover'
                                ? isDiscoverInternalTab(tab)
                                : tab === id;
                            return (
                                <button
                                    key={id}
                                    type="button"
                                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap transition-colors ${dashboardSubnavLinkClass(active)}`}
                                    onClick={() => {
                                        if (active && id === 'discover' && browseSeeAllId) {
                                            openBrowseRail(null);
                                            return;
                                        }
                                        if (active) return;
                                        goToPrimaryTab(id);
                                    }}
                                >
                                    <Icon className="h-4 w-4 shrink-0" />
                                    <span>{label}</span>
                                    {id === 'queue' && (queueStats.pending || 0) > 0 ? (
                                        <span className="rounded-full bg-background/30 px-1.5 py-0.5 text-[10px] font-bold">
                                            {queueStats.pending}
                                        </span>
                                    ) : null}
                                    {id === 'watches' && (watchStatsState.enabled || 0) > 0 ? (
                                        <span className="rounded-full bg-background/30 px-1.5 py-0.5 text-[10px] font-bold">
                                            {watchStatsState.enabled}
                                        </span>
                                    ) : null}
                                    {id === 'watches' && (watchStatsState.errored || 0) > 0 ? (
                                        <span className="rounded-full bg-red-500/30 px-1.5 py-0.5 text-[10px] font-bold text-red-200">
                                            {watchStatsState.errored}
                                        </span>
                                    ) : null}
                                    {id === 'logs' && failedHistoryCount > 0 ? (
                                        <span className="rounded-full bg-red-500/30 px-1.5 py-0.5 text-[10px] font-bold text-red-200">
                                            {failedHistoryCount}
                                        </span>
                                    ) : null}
                                </button>
                            );
                        })}
                    </DashboardSubnav>

                    <div className="flex min-w-0 flex-wrap justify-center gap-1.5 md:hidden">
                    {([
                        ['library', 'Library', Library],
                        ['collections', 'Collection Sets', Layers],
                        ['discover', 'Discover', Compass],
                        ['queue', 'Queue', ListOrdered],
                        ['watches', 'Watching', Eye],
                        ['logs', 'Logs', ScrollText],
                        ['paste', 'Paste / Import', ClipboardPaste],
                        ['settings', 'Settings', Settings2],
                    ] as const).map(([id, label, Icon]) => {
                        const active = id === 'discover'
                            ? isDiscoverInternalTab(tab)
                            : tab === id;
                        return (
                        <button
                            key={id}
                            type="button"
                            className={`${active ? primaryButtonClass : buttonClass}`}
                            onClick={() => {
                                if (active && id === 'discover' && browseSeeAllId) {
                                    openBrowseRail(null);
                                    return;
                                }
                                if (active) return;
                                goToPrimaryTab(id);
                            }}
                        >
                            <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> {label}
                            {id === 'queue' && (queueStats.pending || 0) > 0 ? (
                                <span className="rounded-full bg-background/30 px-1.5 py-0.5 text-[10px] font-bold">
                                    {queueStats.pending}
                                </span>
                            ) : null}
                            {id === 'watches' && (watchStatsState.enabled || 0) > 0 ? (
                                <span className="rounded-full bg-background/30 px-1.5 py-0.5 text-[10px] font-bold">
                                    {watchStatsState.enabled}
                                </span>
                            ) : null}
                            {id === 'watches' && (watchStatsState.errored || 0) > 0 ? (
                                <span className="rounded-full bg-red-500/30 px-1.5 py-0.5 text-[10px] font-bold text-red-200">
                                    {watchStatsState.errored}
                                </span>
                            ) : null}
                            {id === 'logs' && failedHistoryCount > 0 ? (
                                <span className="rounded-full bg-red-500/30 px-1.5 py-0.5 text-[10px] font-bold text-red-200">
                                    {failedHistoryCount}
                                </span>
                            ) : null}
                        </button>
                        );
                    })}
                </div>
            
                {isDiscoverInternalTab(tab) ? (
                    <div className="flex min-w-0 flex-wrap justify-center gap-1 sm:gap-1.5 md:justify-start">
                        {discoverSubNavForConfig(configDraft).map(({ id, label, internalTab }) => (
                            <button
                                key={id}
                                type="button"
                                className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition sm:px-3 sm:text-xs ${
                                    tab === internalTab
                                        ? 'border-plex/40 bg-plex/15 text-plex'
                                        : 'border-white/10 bg-black/20 text-muted hover:border-plex/30 hover:text-text'
                                }`}
                                onClick={() => goToDiscoverView(id)}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                ) : null}
                </div>

            <div className={libraryPageOpen ? 'hidden' : undefined} aria-hidden={libraryPageOpen}>
                <PosterSetsBrowseView />
                <PosterSetsLibraryView />
                <PosterSetsCollectionsView />
                <PosterSetsQueueView />
                <PosterSetsWatchingView />
                <PosterSetsRecentView />
                <PosterSetsTpdbRecentView />
                <PosterSetsSearchView />
                <PosterSetsPasteView />
                <PosterSetsHistoryView />
                <PosterSetsSettingsView />
            </div>
            <PosterSetsFloatingBars />
            <LibraryTitleDetailPanel
                    item={libraryDetailItem}
                    pageVisible={tab === 'library'}
                    onClose={closeLibraryItem}
                    dupePreference={
                        !isTpdbSearchEnabled(configDraft)
                            ? 'mediux'
                            : !isMediuxEnabled(configDraft)
                                ? 'posterdb'
                                : (configDraft.dupePreference === 'mediux' ? 'mediux' : 'posterdb')
                    }
                    preferredCreators={configDraft.creatorWhitelist || []}
                    blockedCreators={configDraft.creatorBlocklist || []}
                    onBlockCreator={blockCreator}
                    queuePaused={queuePaused}
                    watches={watches}
                    serverType={status?.mediaServerLabel?.toLowerCase() === 'jellyfin' ? 'jellyfin' : 'plex'}
                    layoutMode={libraryDetailLayout}
                    onLayoutModeChange={setLibraryDetailLayout}
                    toast={toast}
                    tpdbConfigured={Boolean(configDraft.hasTpdbPassword && String(configDraft.tpdb_username || '').trim())}
                    tpdbEnabled={isTpdbSearchEnabled(configDraft)}
                    mediuxEnabled={isMediuxEnabled(configDraft)}
                    showCopyTitle={isCopyLibraryTitleEnabled(configDraft)}
                    onOpenTpdbSettings={() => goToPrimaryTab('settings')}
                    onApplied={() => {
                        void loadQueue();
                        void loadHistory();
                    }}
                    onWatchAdded={() => void loadWatches()}
                />
        </DashboardPageShell>
    );
};
