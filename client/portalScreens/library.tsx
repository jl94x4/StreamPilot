import { ChevronRight,X } from 'lucide-react';
import React,{ useCallback,useEffect,useRef,useState } from 'react';

import {
dashboardTitleKeyFromPath,
dashboardTitlePath,
readDashboardSearchQuery,
writeDashboardSearchQuery,
} from '../dashboard/dashboardTitlePath';
import { TitleAnalyticsPage } from '../dashboard/TitleAnalyticsPage';
import { DiscoverGridSizeSelect } from '../discovery/DiscoverGridSizeSelect';
import { useDiscoverI18n } from '../discovery/i18n';
import { useDiscoverGridSize } from '../discovery/useDiscoverGridSize';
import { apiFetch } from '../shared/api';
import { portalUrl,resolvePortalAssetUrl } from '../shared/basePath';
import {
preferCollapsedOnNarrow,
usePersistedCollapsed
} from '../shared/dashboard/DashboardChrome';
import { formatTime } from '../shared/format';
import { IN_APP_NOTIFICATIONS_CHANGED_EVENT } from '../shared/inAppNotificationsRefresh';
import { activityStreamGridClass,upgraderPosterGridClass,upgraderPosterGridStyle } from '../shared/portalLayout';
import { RetryablePoster } from '../shared/RetryablePoster';
import {
DiscoverPageSkeleton,
TrendingSectionsSkeleton
} from '../shared/skeletons';
import {
fleetUptimeForPeriod
} from '../shared/statusHealth';
import { CustomSelect,ScrollReveal } from '../shared/ui';
import { usePoll } from '../shared/usePoll';
import { DiscoverPosterCard } from './discoverCard';
import { ACTIVE_STREAMS_COLLAPSED_KEY,OPS_SNAPSHOT_COLLAPSED_KEY } from './downloads';
import { NeedsAttentionCard } from '../shared/NeedsAttentionCard';
import { DashboardTitleLink,EmptyStreamsMessage,StreamDetailsModal,type AdminOpsSnapshot } from './status';
import { DISCOVER_DESKTOP_ITEM_LIMIT,DISCOVER_LIMIT_OPTIONS,DISCOVER_MOBILE_ITEM_LIMIT,TrendingDiscoverSection } from './userDashboard';


export const LibraryDashboard: React.FC<{ onBack: () => void, isAdmin?: boolean, publicConfig?: any, mediaServerType?: string, onViewAnalytics?: (hash?: string) => void, onNavigate?: (route: string, options?: { path?: string }) => void }> = ({ onBack, isAdmin, publicConfig, mediaServerType, onViewAnalytics, onNavigate }) => {
    const { t } = useDiscoverI18n();
    const [dashboardData, setDashboardData] = useState<{ activeSessions: any[], recentMovies: any[], recentShows: any[], recentMusic: any[] } | null>(null);
    const [trendingStats, setTrendingStats] = useState<{ trending7Days: any[], movies30Days: any[], shows30Days: any[], top365Days: any[], allTime: any[], weekendWarriors: any[], nightOwls: any[], retroHits: any[], cultClassics: any[] } | null>(null);
    const [dashboardLoading, setDashboardLoading] = useState(true);
    const [trendingLoading, setTrendingLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [pollError, setPollError] = useState<string | null>(null);
    const [isDiscoverDesktop, setIsDiscoverDesktop] = useState(
        () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
    );
    const [recentLimitOverride, setRecentLimitOverride] = useState<number | null>(() => {
        const saved = localStorage.getItem('discoverRecentLimitOverride');
        return saved ? Number(saved) : null;
    });
    const responsiveRecentLimit = isDiscoverDesktop ? DISCOVER_DESKTOP_ITEM_LIMIT : DISCOVER_MOBILE_ITEM_LIMIT;
    const recentLimit = recentLimitOverride ?? responsiveRecentLimit;
    const [gridSize, setGridSize] = useDiscoverGridSize();
    const [selectedSession, setSelectedSession] = useState<any | null>(null);
    const [isDocumentVisible, setIsDocumentVisible] = useState(
        () => typeof document === 'undefined' || document.visibilityState === 'visible'
    );
    const [opsSnapshot, setOpsSnapshot] = useState<AdminOpsSnapshot | null>(null);
    const [opsLoading, setOpsLoading] = useState(false);
    const [opsError, setOpsError] = useState<string | null>(null);
    const [opsCollapsed, setOpsCollapsed] = usePersistedCollapsed(
        OPS_SNAPSHOT_COLLAPSED_KEY,
        preferCollapsedOnNarrow(),
    );
    const [streamsCollapsed, setStreamsCollapsed] = usePersistedCollapsed(
        ACTIVE_STREAMS_COLLAPSED_KEY,
        preferCollapsedOnNarrow(),
    );
    const showQualityBadges = publicConfig?.showPosterQualityBadges !== false;
    const libraryMediaServerType = String(publicConfig?.mediaServerType || mediaServerType || 'plex').toLowerCase();
    const isJellyfinPortal = libraryMediaServerType === 'jellyfin' || libraryMediaServerType === 'emby';
    const libraryProviderLabel = libraryMediaServerType === 'emby' ? 'Emby' : libraryMediaServerType === 'jellyfin' ? 'Jellyfin' : 'Plex';
    const canOpenDashboardTitle = Boolean(isAdmin && onNavigate && !isJellyfinPortal);
    const openDashboardTitle = useCallback((ratingKey: string) => {
        const key = String(ratingKey || '').trim();
        if (!key || !onNavigate) return;
        onNavigate('dashboard', { path: dashboardTitlePath(key) });
    }, [onNavigate]);
    const hasLoadedDashboard = useRef(false);
    const hasLoadedTrending = useRef(false);

    const [discoverSearchQuery, setDiscoverSearchQuery] = useState(() => readDashboardSearchQuery());
    const [discoverSearchResults, setDiscoverSearchResults] = useState<any[] | null>(null);
    const [isDiscoverSearching, setIsDiscoverSearching] = useState(false);
    const discoverSearchGenRef = useRef(0);
    const discoverSearchAbortRef = useRef<AbortController | null>(null);
    const [dashboardTitleKey, setDashboardTitleKey] = useState(() => dashboardTitleKeyFromPath());

    useEffect(() => {
        const syncTitle = () => setDashboardTitleKey(dashboardTitleKeyFromPath());
        window.addEventListener('popstate', syncTitle);
        window.addEventListener('portal-dashboard-navigate', syncTitle);
        return () => {
            window.removeEventListener('popstate', syncTitle);
            window.removeEventListener('portal-dashboard-navigate', syncTitle);
        };
    }, []);

    useEffect(() => () => {
        discoverSearchAbortRef.current?.abort();
    }, []);

    const performDiscoverSearch = useCallback(async (query: string) => {
        const trimmed = query.trim();
        if (!trimmed) {
            discoverSearchAbortRef.current?.abort();
            discoverSearchAbortRef.current = null;
            setDiscoverSearchResults(null);
            return;
        }
        discoverSearchAbortRef.current?.abort();
        const controller = new AbortController();
        discoverSearchAbortRef.current = controller;
        const gen = ++discoverSearchGenRef.current;
        setIsDiscoverSearching(true);
        try {
            const res = await apiFetch(
                `/api/plex/discover-search?query=${encodeURIComponent(trimmed)}`,
                { signal: controller.signal },
            );
            if (gen !== discoverSearchGenRef.current) return;
            if (!res.error) {
                setDiscoverSearchResults(res.results || []);
                writeDashboardSearchQuery(trimmed);
            }
        } catch (err) {
            if (gen !== discoverSearchGenRef.current) return;
            if (err instanceof DOMException && err.name === 'AbortError') return;
            if (err instanceof Error && err.name === 'AbortError') return;
        } finally {
            if (gen === discoverSearchGenRef.current) {
                setIsDiscoverSearching(false);
            }
        }
    }, []);

    const handleSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        performDiscoverSearch(discoverSearchQuery);
    };

    useEffect(() => {
        const timer = setTimeout(() => {
            if (discoverSearchQuery.trim().length >= 2) {
                performDiscoverSearch(discoverSearchQuery);
            } else if (!discoverSearchQuery.trim()) {
                discoverSearchGenRef.current += 1;
                discoverSearchAbortRef.current?.abort();
                discoverSearchAbortRef.current = null;
                setDiscoverSearchResults(null);
                setIsDiscoverSearching(false);
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [discoverSearchQuery, performDiscoverSearch]);

    useEffect(() => {
        const mq = window.matchMedia('(min-width: 1024px)');
        const onChange = (e: MediaQueryListEvent) => setIsDiscoverDesktop(e.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);

    useEffect(() => {
        const onVisibility = () => setIsDocumentVisible(document.visibilityState === 'visible');
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, []);

    useEffect(() => {
        if (!isJellyfinPortal) return;
        setDashboardData({ activeSessions: [], recentMovies: [], recentShows: [], recentMusic: [] });
        setTrendingStats(null);
        setError(null);
        setPollError(null);
        setDashboardLoading(false);
        setTrendingLoading(false);
    }, [isJellyfinPortal]);

    const handleRecentLimitChange = useCallback((value: string) => {
        const next = Number(value);
        setRecentLimitOverride(next);
        localStorage.setItem('discoverRecentLimitOverride', String(next));
        localStorage.removeItem('discoverRecentLimit');
    }, []);

    const fetchDashboardOnly = useCallback(async () => {
        try {
            const res = await apiFetch(`${isJellyfinPortal ? '/api/jellyfin/dashboard' : '/api/plex/dashboard'}?limit=${recentLimit}`);
            if (res.error) {
                setPollError(res.error);
                return;
            }
            setDashboardData(res);
            setPollError(null);
        } catch (err: any) {
            setPollError(err?.message || 'Live dashboard update failed');
        }
    }, [recentLimit, isJellyfinPortal]);

    const fetchData = useCallback(async () => {
        setError(null);
        if (!hasLoadedDashboard.current) setDashboardLoading(true);
        if (!isJellyfinPortal && !hasLoadedTrending.current) setTrendingLoading(true);
        try {
            const res = await apiFetch(`${isJellyfinPortal ? '/api/jellyfin/dashboard' : '/api/plex/dashboard'}?limit=${recentLimit}`);
            if (res.error) throw new Error(res.error);
            setDashboardData(res);
        } catch (err: any) {
            setError(err.message || 'Failed to load dashboard data');
        } finally {
            hasLoadedDashboard.current = true;
            setDashboardLoading(false);
        }

        if (isJellyfinPortal) {
            setTrendingStats(null);
            hasLoadedTrending.current = true;
            setTrendingLoading(false);
            return;
        }

        try {
            const statsRes = await apiFetch('/api/plex/stats/trending');
            if (!statsRes.error) {
                setTrendingStats(statsRes);
            }
        } catch {
            // Trending cache may still be building
        } finally {
            hasLoadedTrending.current = true;
            setTrendingLoading(false);
        }
    }, [recentLimit, isJellyfinPortal]);

    const fetchOpsSnapshot = useCallback(async (silent = true) => {
        if (!isAdmin) {
            setOpsSnapshot(null);
            setOpsError(null);
            return;
        }
        if (!silent) setOpsLoading(true);
        try {
            const [statusRes, requestsRes, notificationsRes, inboxRes] = await Promise.all([
                apiFetch('/api/status').catch(() => null),
                apiFetch('/api/requests/count').catch(() => null),
                apiFetch('/api/admin/notifications/status').catch(() => null),
                apiFetch('/api/notifications?limit=1').catch(() => null),
            ]);

            const services = Array.isArray(statusRes?.config?.services) ? statusRes.config.services : [];
            const healthData = statusRes?.healthData && typeof statusRes.healthData === 'object' ? statusRes.healthData : {};
            const serviceIds = services
                .map((service: any) => String(service?.id || '').trim())
                .filter(Boolean);
            const unhealthyServices = services.filter((service: any) => {
                const id = String(service?.id || '').trim();
                const status = String((healthData as any)?.[id]?.currentStatus || '').toLowerCase();
                return status === 'offline' || status === 'degraded';
            });
            const offlineCount = unhealthyServices.filter((service: any) => {
                const id = String(service?.id || '').trim();
                const status = String((healthData as any)?.[id]?.currentStatus || '').toLowerCase();
                return status === 'offline';
            }).length;
            const fleetUptime24h = serviceIds.length
                ? fleetUptimeForPeriod(healthData as Record<string, any>, serviceIds, '24h')
                : null;

            const jobs = notificationsRes?.jobs || {};
            const failingJobs = ['seerrAvailableNotify', 'seerrPendingNotify', 'requestStatusSync']
                .filter((key) => String(jobs?.[key]?.lastError || '').trim()).length;
            const runningJobs = ['seerrAvailableNotify', 'seerrPendingNotify', 'requestStatusSync']
                .filter((key) => !!jobs?.[key]?.running).length;

            setOpsSnapshot({
                checkedAt: Date.now(),
                fleetUptime24h,
                serviceCount: services.length,
                unhealthyCount: unhealthyServices.length,
                offlineCount,
                unhealthyNames: unhealthyServices
                    .map((service: any) => String(service?.name || service?.id || '').trim())
                    .filter(Boolean)
                    .slice(0, 4),
                requestPending: Math.max(0, Number(requestsRes?.pending || 0)),
                requestEngineConnected: requestsRes?.connected !== false,
                notificationUnread: Math.max(0, Number(inboxRes?.unread || 0)),
                notificationTotal: Math.max(0, Number(inboxRes?.total || 0)),
                failingJobs,
                runningJobs,
            });
            setOpsError(null);
        } catch (err: any) {
            setOpsError(err?.message || t('homeDashboard.opsSnapshot.errors.loadFailed'));
        } finally {
            if (!silent) setOpsLoading(false);
        }
    }, [isAdmin, t]);

    useEffect(() => {
        void fetchData();
    }, [fetchData]);

    useEffect(() => {
        if (!isAdmin) return;
        void fetchOpsSnapshot(false);
    }, [isAdmin, fetchOpsSnapshot]);

    useEffect(() => {
        if (!isAdmin) return;
        const onChanged = () => { void fetchOpsSnapshot(true); };
        window.addEventListener(IN_APP_NOTIFICATIONS_CHANGED_EVENT, onChanged);
        return () => window.removeEventListener(IN_APP_NOTIFICATIONS_CHANGED_EVENT, onChanged);
    }, [isAdmin, fetchOpsSnapshot]);

    usePoll(() => { if (isDocumentVisible) void fetchDashboardOnly(); }, isDocumentVisible ? 10_000 : null);
    usePoll(() => { if (isDocumentVisible) void fetchOpsSnapshot(true); }, (isAdmin && isDocumentVisible) ? 30_000 : null);

    if (dashboardTitleKey) {
        return (
            <TitleAnalyticsPage
                ratingKey={dashboardTitleKey}
                onBack={() => onNavigate?.('dashboard', { path: '/dashboard' })}
                onOpenTitle={(key) => onNavigate?.('dashboard', { path: dashboardTitlePath(key) })}
                onViewUser={(username) => onViewAnalytics?.(`#user=${encodeURIComponent(username)}`)}
            />
        );
    }

    if (dashboardLoading && !dashboardData) {
        return <DiscoverPageSkeleton recentLimit={recentLimit} gridSize={gridSize} />;
    }

    const totalStreams = dashboardData?.activeSessions?.length || 0;
    const trendingCount = recentLimit;
    const transcodingStreams = dashboardData?.activeSessions?.filter(s => s.isTranscoding).length || 0;
    const directStreams = totalStreams - transcodingStreams;
    const totalBandwidthKbps = dashboardData?.activeSessions?.reduce((acc, s) => acc + (s.bandwidth || 0), 0) || 0;
    const totalBandwidthMbps = (totalBandwidthKbps / 1000).toFixed(2);
    const showStreamCards = Boolean(dashboardData && totalStreams > 0);
    const showOpsSnapshot = Boolean(isAdmin);
    const snapshotHealthHint = opsSnapshot
        ? (opsSnapshot.unhealthyCount > 0
            ? t('homeDashboard.opsSnapshot.metrics.unhealthy', { count: opsSnapshot.unhealthyCount })
            : t('homeDashboard.opsSnapshot.metrics.allHealthy'))
        : '';
    const snapshotStreamHint = showStreamCards
        ? t('homeDashboard.opsSnapshot.metrics.streams', { count: totalStreams })
        : '';
    const searchActive = Boolean(
        discoverSearchQuery.trim() && (discoverSearchResults || isDiscoverSearching),
    );

    return (
        <div className="w-full min-w-0 flex flex-col shrink-0">
            <main className="discover-layout-container w-full min-w-0 pb-8 mt-4 md:mt-0">
                {error && <div className="toast error show">{error}</div>}
                {pollError && !error && <div className="toast error show">{pollError}</div>}

                {isAdmin && !isJellyfinPortal && (
                    <div className="mb-6 w-full max-w-full min-w-0">
                        <form onSubmit={handleSearchSubmit} className="flex w-full max-w-full min-w-0 gap-2">
                            <div className="relative min-w-0 flex-1">
                                <input 
                                    type="text" 
                                    value={discoverSearchQuery}
                                    onChange={(e) => setDiscoverSearchQuery(e.target.value)}
                                    placeholder="Search a title to open watch history…" 
                                    className="w-full min-w-0 appearance-none bg-card border border-border rounded-xl px-3 sm:px-4 py-3 text-[16px] leading-5 text-text focus:border-plex focus:ring-1 focus:ring-plex outline-none transition-all shadow-lg pr-10 sm:pr-12"
                                />
                                {discoverSearchQuery && (
                                    <button 
                                        type="button" 
                                        onClick={() => { setDiscoverSearchQuery(''); setDiscoverSearchResults(null); writeDashboardSearchQuery(''); }}
                                        className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text transition-colors p-1"
                                    >
                                        <X size={20} />
                                    </button>
                                )}
                            </div>
                            <button type="submit" className="shrink-0 bg-plex hover:bg-orange-500 text-white px-3 sm:px-6 py-3 rounded-xl font-bold transition-colors disabled:opacity-50 shadow-lg" disabled={isDiscoverSearching || !discoverSearchQuery.trim()}>
                                {isDiscoverSearching ? 'Searching...' : 'Search'}
                            </button>
                        </form>

                        {searchActive && (
                            <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-card/80 shadow-xl">
                                {isDiscoverSearching ? (
                                    <p className="py-6 text-center text-sm text-muted">Searching…</p>
                                ) : discoverSearchResults?.length === 0 ? (
                                    <p className="py-6 text-center text-sm text-muted">No titles found.</p>
                                ) : (
                                    <div>
                                        <p className="border-b border-white/10 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-muted">
                                            Pick a title for server-wide stats and watch history
                                        </p>
                                        {discoverSearchResults?.map((item: any) => (
                                            <button
                                                key={item.ratingKey}
                                                type="button"
                                                onClick={() => {
                                                    writeDashboardSearchQuery(discoverSearchQuery);
                                                    onNavigate?.('dashboard', { path: dashboardTitlePath(item.ratingKey) });
                                                }}
                                                className="flex w-full min-w-0 items-center gap-3 border-b border-white/5 px-3 py-3 text-left last:border-0 transition-colors hover:bg-white/5 sm:px-4"
                                            >
                                                <div className="h-16 w-11 shrink-0 overflow-hidden rounded-md bg-white/5 sm:h-[4.5rem] sm:w-12">
                                                    {item.thumb ? (
                                                        <img src={portalUrl(`/api/plex/image?path=${encodeURIComponent(item.thumb)}&width=150&height=225`)} alt="" className="h-full w-full object-cover" />
                                                    ) : null}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <h3 className="truncate text-sm font-bold text-text sm:text-base">{item.title}</h3>
                                                    <p className="mt-0.5 text-xs text-muted">{String(item.type || '').toUpperCase()}{item.year ? ` · ${item.year}` : ''}</p>
                                                </div>
                                                <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {!searchActive && (
                <>
                {isAdmin ? <NeedsAttentionCard onNavigate={(route) => onNavigate?.(route)} /> : null}
                {showStreamCards && (
                    <section className="mb-8 w-full">
                        <div className="flex items-center justify-between gap-3 mb-3">
                            <button
                                type="button"
                                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                onClick={() => setStreamsCollapsed(!streamsCollapsed)}
                                aria-expanded={!streamsCollapsed}
                                aria-label={streamsCollapsed ? t('homeDashboard.opsSnapshot.expand') : t('homeDashboard.opsSnapshot.collapse')}
                            >
                                <span className="w-3 shrink-0 text-muted" aria-hidden>{streamsCollapsed ? '▸' : '▾'}</span>
                                <h2 className="text-plex text-sm uppercase tracking-[2px] font-bold border-b border-white/10 pb-2 w-full">
                                    {t('homeDashboard.opsSnapshot.streamsTitle')}
                                </h2>
                            </button>
                            {streamsCollapsed && snapshotStreamHint ? (
                                <span className="shrink-0 text-xs font-semibold text-muted">
                                    {snapshotStreamHint}
                                </span>
                            ) : null}
                        </div>
                        {streamsCollapsed ? null : (
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                <div className="bg-white/5 border border-white/10 rounded-xl py-2 px-3 flex flex-col items-center justify-center gap-0.5 shadow-lg backdrop-blur-sm">
                                    <span className="text-plex font-bold text-2xl">{totalStreams}</span>
                                    <span className="text-muted text-[10px] uppercase tracking-wider font-bold">{t('homeDashboard.opsSnapshot.metrics.totalStreams')}</span>
                                </div>
                                <div className="bg-white/5 border border-white/10 rounded-xl py-2 px-3 flex flex-col items-center justify-center gap-0.5 shadow-lg backdrop-blur-sm">
                                    <span className="text-status-active font-bold text-2xl">{directStreams}</span>
                                    <span className="text-muted text-[10px] uppercase tracking-wider font-bold">{t('homeDashboard.opsSnapshot.metrics.directPlay')}</span>
                                </div>
                                <div className="bg-white/5 border border-white/10 rounded-xl py-2 px-3 flex flex-col items-center justify-center gap-0.5 shadow-lg backdrop-blur-sm">
                                    <span className="text-status-expiring font-bold text-2xl">{transcodingStreams}</span>
                                    <span className="text-muted text-[10px] uppercase tracking-wider font-bold">{t('homeDashboard.opsSnapshot.metrics.transcoding')}</span>
                                </div>
                                <div className="bg-white/5 border border-white/10 rounded-xl py-2 px-3 flex flex-col items-center justify-center gap-0.5 shadow-lg backdrop-blur-sm">
                                    <span className="text-plex font-bold text-2xl">{totalBandwidthMbps} <span className="text-sm">Mbps</span></span>
                                    <span className="text-muted text-[10px] uppercase tracking-wider font-bold">{t('homeDashboard.opsSnapshot.metrics.totalBandwidth')}</span>
                                </div>
                            </div>
                        )}
                    </section>
                )}

                {showOpsSnapshot && (
                    <section className="mb-8 w-full">
                        <div className="flex items-center justify-between gap-3 mb-3">
                            <button
                                type="button"
                                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                onClick={() => setOpsCollapsed(!opsCollapsed)}
                                aria-expanded={!opsCollapsed}
                                aria-label={opsCollapsed ? t('homeDashboard.opsSnapshot.expand') : t('homeDashboard.opsSnapshot.collapse')}
                            >
                                <span className="w-3 shrink-0 text-muted" aria-hidden>{opsCollapsed ? '▸' : '▾'}</span>
                                <h2 className="text-plex text-sm uppercase tracking-[2px] font-bold border-b border-white/10 pb-2 w-full">
                                    {t('homeDashboard.opsSnapshot.title')}
                                </h2>
                            </button>
                            {opsCollapsed && snapshotHealthHint ? (
                                <span className={`shrink-0 text-xs font-semibold ${
                                    opsSnapshot && opsSnapshot.unhealthyCount > 0
                                        ? 'text-rose-200'
                                        : 'text-emerald-200'
                                }`}>
                                    {snapshotHealthHint}
                                </span>
                            ) : null}
                            <button
                                type="button"
                                onClick={() => { void fetchOpsSnapshot(false); }}
                                className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg border border-border bg-white/5 hover:bg-white/10 transition-colors"
                            >
                                {t('homeDashboard.admin.refresh')}
                            </button>
                        </div>
                        {opsCollapsed ? null : (
                            opsLoading && !opsSnapshot ? (
                            <div className="text-center text-muted p-6 border border-dashed border-border rounded-xl">{t('homeDashboard.opsSnapshot.loading')}</div>
                        ) : opsError && !opsSnapshot ? (
                            <div className="text-center text-red-300 p-6 border border-red-500/30 rounded-xl bg-red-500/10">{opsError}</div>
                        ) : opsSnapshot ? (
                            <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
                                <div className={`rounded-xl border px-3 py-2 ${opsSnapshot.unhealthyCount > 0 ? 'border-rose-500/40 bg-rose-500/10' : 'border-emerald-500/40 bg-emerald-500/10'}`}>
                                    <div className="text-[10px] uppercase tracking-wider text-muted font-bold">{t('statusPage.labels.services')}</div>
                                    <div className="text-lg font-black text-white mt-0.5">{opsSnapshot.serviceCount}</div>
                                    <div className={`text-xs mt-0.5 ${opsSnapshot.unhealthyCount > 0 ? 'text-rose-200' : 'text-emerald-200'}`}>
                                        {opsSnapshot.unhealthyCount > 0
                                            ? t('homeDashboard.opsSnapshot.metrics.unhealthy', { count: opsSnapshot.unhealthyCount })
                                            : t('homeDashboard.opsSnapshot.metrics.allHealthy')}
                                    </div>
                                </div>
                                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                                    <div className="text-[10px] uppercase tracking-wider text-muted font-bold">{t('homeDashboard.opsSnapshot.metrics.fleetUptime24h')}</div>
                                    <div className="text-lg font-black text-white mt-0.5">
                                        {opsSnapshot.fleetUptime24h == null ? '—' : `${opsSnapshot.fleetUptime24h.toFixed(2)}%`}
                                    </div>
                                    <div className="text-xs text-muted mt-0.5">{t('statusPage.summary.offline', { count: opsSnapshot.offlineCount })}</div>
                                </div>
                                <div className={`rounded-xl border px-3 py-2 ${opsSnapshot.requestPending > 0 ? 'border-amber-500/40 bg-amber-500/10' : 'border-white/10 bg-white/5'}`}>
                                    <div className="text-[10px] uppercase tracking-wider text-muted font-bold">{t('homeDashboard.admin.pendingRequests')}</div>
                                    <div className="text-lg font-black text-white mt-0.5">{opsSnapshot.requestPending}</div>
                                    <div className={`text-xs mt-0.5 ${opsSnapshot.requestEngineConnected ? 'text-muted' : 'text-rose-200'}`}>
                                        {opsSnapshot.requestEngineConnected
                                            ? t('homeDashboard.opsSnapshot.metrics.requestAppConnected')
                                            : t('homeDashboard.opsSnapshot.metrics.requestAppOffline')}
                                    </div>
                                </div>
                                <div className={`rounded-xl border px-3 py-2 ${opsSnapshot.notificationUnread > 0 ? 'border-sky-500/40 bg-sky-500/10' : 'border-white/10 bg-white/5'}`}>
                                    <div className="text-[10px] uppercase tracking-wider text-muted font-bold">{t('homeDashboard.opsSnapshot.metrics.unreadNotifications')}</div>
                                    <div className="text-lg font-black text-white mt-0.5">{opsSnapshot.notificationUnread}</div>
                                    <div className="text-xs text-muted mt-0.5">{t('homeDashboard.opsSnapshot.metrics.stored', { count: opsSnapshot.notificationTotal })}</div>
                                </div>
                                <div className={`rounded-xl border px-3 py-2 ${opsSnapshot.failingJobs > 0 ? 'border-rose-500/40 bg-rose-500/10' : 'border-white/10 bg-white/5'}`}>
                                    <div className="text-[10px] uppercase tracking-wider text-muted font-bold">{t('homeDashboard.opsSnapshot.metrics.jobAlerts')}</div>
                                    <div className="text-lg font-black text-white mt-0.5">{opsSnapshot.failingJobs}</div>
                                    <div className="text-xs text-muted mt-0.5">{t('homeDashboard.opsSnapshot.metrics.running', { count: opsSnapshot.runningJobs })}</div>
                                </div>
                                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                                    <div className="text-[10px] uppercase tracking-wider text-muted font-bold">{t('homeDashboard.opsSnapshot.metrics.lastCheck')}</div>
                                    <div className="text-lg font-black text-white mt-0.5">
                                        {t('homeDashboard.opsSnapshot.metrics.seconds', { count: Math.max(0, Math.round((Date.now() - opsSnapshot.checkedAt) / 1000)) })}
                                    </div>
                                    <div className="text-xs text-muted mt-0.5">
                                        {opsSnapshot.unhealthyNames.length
                                            ? opsSnapshot.unhealthyNames.join(', ')
                                            : t('homeDashboard.opsSnapshot.empty.noIncidents')}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="text-center text-muted p-6 border border-dashed border-border rounded-xl">{t('homeDashboard.opsSnapshot.empty.unavailable')}</div>
                        )
                        )}
                    </section>
                )}

                {/* ACTIVITY CARDS */}
                <section className="mb-12 w-full">
                    <h2 className="text-plex text-sm uppercase tracking-[2px] mb-6 font-bold border-b border-white/10 pb-2">ACTIVITY</h2>
                    {dashboardData && dashboardData.activeSessions && dashboardData.activeSessions.length > 0 ? (
                        <div className="w-full">
                            <div className={activityStreamGridClass()}>
                                {dashboardData.activeSessions.map((session, i) => {
                                    const sessionPosterSrc = session.thumbUrl
                                        ? resolvePortalAssetUrl(session.thumbUrl)
                                        : (session.thumb
                                            ? portalUrl(`/api/plex/image?path=${encodeURIComponent(session.thumb)}&width=360&height=540`)
                                            : '');
                                    const sessionFallbackPosterSrc = session.posterFallbackUrl ? resolvePortalAssetUrl(session.posterFallbackUrl) : '';
                                    const sessionUserThumbSrc = session.userThumb ? resolvePortalAssetUrl(session.userThumb) : 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
                                    const posterColumnClass = 'grid-cols-[clamp(6rem,36%,8.5rem)_minmax(0,1fr)]';
                                    return (
                                        <div key={session.sessionId ?? i} onClick={() => setSelectedSession(session)} className="bg-card rounded-xl border border-border flex flex-col overflow-hidden shadow-lg hover:border-plex/50 hover:shadow-plex/20 transition-all cursor-pointer select-none h-full">
                                            <div className={`grid ${posterColumnClass} items-stretch flex-1 min-h-0`}>
                                                <div className="relative aspect-[2/3] w-full overflow-hidden bg-black self-start rounded-tl-xl pointer-events-none">
                                                    <RetryablePoster
                                                        src={sessionPosterSrc}
                                                        fallbackSrc={sessionFallbackPosterSrc}
                                                        alt={session.title}
                                                        className="absolute inset-0 w-full h-full object-cover object-top drop-shadow-[4px_0_15px_rgba(0,0,0,0.5)] rounded-tl-xl"
                                                    />
                                                </div>
                                                <div className="p-2.5 md:p-3 flex flex-col min-w-0 h-full">
                                                    <div className="activity-header mb-1.5 min-w-0">
                                                        <div className="activity-title-group min-w-0">
                                                            <DashboardTitleLink
                                                                ratingKey={session.grandparentTitle ? session.grandparentRatingKey : session.ratingKey}
                                                                onOpen={canOpenDashboardTitle ? openDashboardTitle : undefined}
                                                                className="text-sm md:text-base font-bold text-text line-clamp-2 leading-tight"
                                                            >
                                                                {session.grandparentTitle ? session.grandparentTitle : session.title}
                                                            </DashboardTitleLink>
                                                            {session.type === 'episode' && session.season !== undefined && session.episode !== undefined ? (
                                                                <DashboardTitleLink
                                                                    ratingKey={session.ratingKey}
                                                                    onOpen={canOpenDashboardTitle ? openDashboardTitle : undefined}
                                                                    className="text-[10px] md:text-xs text-muted line-clamp-2 leading-snug mt-0.5"
                                                                >
                                                                    {session.title} | S{String(session.season).padStart(2, '0')}E{String(session.episode).padStart(2, '0')}
                                                                </DashboardTitleLink>
                                                            ) : (
                                                                session.grandparentTitle ? (
                                                                    <DashboardTitleLink
                                                                        ratingKey={session.ratingKey}
                                                                        onOpen={canOpenDashboardTitle ? openDashboardTitle : undefined}
                                                                        className="text-[10px] md:text-xs text-muted line-clamp-2 leading-snug mt-0.5"
                                                                    >
                                                                        {session.title}
                                                                    </DashboardTitleLink>
                                                                ) : null
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="flex flex-wrap items-center gap-1 mb-2">
                                                        {session.user && (
                                                            session.accountId && onNavigate ? (
                                                            <button
                                                                type="button"
                                                                onClick={(event) => {
                                                                    event.stopPropagation();
                                                                    onNavigate('profile', { path: `/profile/${encodeURIComponent(String(session.accountId))}` });
                                                                }}
                                                                className="inline-flex items-center min-w-0 max-w-full gap-1.5 bg-black/45 backdrop-blur-md rounded-full pr-2 p-0.5 shadow-md border border-white/5 hover:border-plex/40"
                                                            >
                                                                <img src={sessionUserThumbSrc} alt={session.user} className="w-5 h-5 rounded-full object-cover shrink-0" onError={(e) => { e.currentTarget.src = 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y'; }} />
                                                                <span className="text-[10px] font-bold text-white/90 truncate">{session.user}</span>
                                                            </button>
                                                            ) : (
                                                            <span className="inline-flex items-center min-w-0 max-w-full gap-1.5 bg-black/45 backdrop-blur-md rounded-full pr-2 p-0.5 shadow-md border border-white/5">
                                                                <img src={sessionUserThumbSrc} alt={session.user} className="w-5 h-5 rounded-full object-cover shrink-0" onError={(e) => { e.currentTarget.src = 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y'; }} />
                                                                <span className="text-[10px] font-bold text-white/90 truncate">{session.user}</span>
                                                            </span>
                                                            )
                                                        )}
                                                        {session.resolution && (
                                                            <span className="shrink-0 bg-white/10 text-white/90 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide border border-white/10">{session.resolution.includes('p') || session.resolution.includes('k') ? session.resolution : `${session.resolution}p`}</span>
                                                        )}
                                                        <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide border ${session.sessionLocation === 'lan' ? 'bg-status-active/20 text-status-active border-status-active/30' : 'bg-plex/20 text-plex border-plex/30'}`}>
                                                            {session.sessionLocation === 'lan' ? 'Local' : 'Remote'}
                                                        </span>
                                                    </div>

                                                    <div className="activity-details flex flex-col gap-0.5 mt-auto">
                                                        {session.playerTitle ? (
                                                        <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-2 text-[10px] md:text-xs border-b border-white/5 pb-0.5">
                                                            <span className="text-muted uppercase tracking-wider font-bold mt-0.5">Player</span>
                                                            <span className="detail-value text-right truncate" title={session.playerTitle}>{session.playerTitle}</span>
                                                        </div>
                                                        ) : null}
                                                        <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2 text-[10px] md:text-xs border-b border-white/5 pb-0.5">
                                                            <span className="text-muted uppercase tracking-wider font-bold">Stream</span>
                                                            {/* Subtitles ride on the Stream line as a small tag, so the card keeps its height. */}
                                                            <div className="flex items-center justify-end gap-1.5 min-w-0">
                                                                {session.subtitle ? (
                                                                    <span
                                                                        className={`shrink-0 inline-flex items-center gap-0.5 text-[9px] font-bold px-1 py-px rounded uppercase tracking-wide border leading-none ${session.subtitle.burn ? 'bg-status-expiring/15 text-status-expiring border-status-expiring/30' : 'bg-white/10 text-white/85 border-white/15'}`}
                                                                        title={`Subtitles: ${session.subtitle.label}${session.subtitle.forced ? ' (forced)' : ''}${session.subtitle.burn ? ' · burned in by the server' : ''}`}
                                                                    >
                                                                        CC{session.subtitle.code ? ` ${session.subtitle.code}` : ''}{session.subtitle.burn ? ' · Burn' : ''}
                                                                    </span>
                                                                ) : null}
                                                                <span className={`font-bold text-right truncate ${session.isTranscoding ? 'text-status-expiring' : 'text-status-active'}`}>
                                                                    {session.isTranscoding ? 'Transcode' : 'Direct Play'}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2 text-[10px] md:text-xs border-b border-white/5 pb-0.5">
                                                            <span className="text-muted uppercase tracking-wider font-bold">State</span>
                                                            <div className="flex items-center justify-end gap-1.5 min-w-0">
                                                                <span className="detail-value font-bold truncate">{session.state.charAt(0).toUpperCase() + session.state.slice(1)}</span>
                                                                {session.timeRemaining > 0 && session.state === 'playing' && (
                                                                    <span className="text-[9px] text-muted/80 whitespace-nowrap shrink-0">
                                                                        ({Math.floor(session.timeRemaining / 3600000) > 0 ? `${Math.floor(session.timeRemaining / 3600000)}h ` : ''}
                                                                        {Math.floor((session.timeRemaining % 3600000) / 60000)}m left)
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2 text-[10px] md:text-xs pb-0.5">
                                                            <span className="text-muted uppercase tracking-wider font-bold">Bandwidth</span>
                                                            <span className="detail-value text-right truncate">{(session.bandwidth / 1000).toFixed(1)} Mbps</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            {/* Progress Bar with embedded text */}
                                            {(() => {
                                                const progressBarText = `${Math.round(session.progress)}%${session.timeRemaining > 0 && session.state === 'playing' ? ` • ETA ${formatTime(new Date(Date.now() + session.timeRemaining))}` : ''}`;
                                                return (
                                                    <div className="w-full h-4 bg-white/10 relative mt-auto z-10 overflow-hidden rounded-b-lg">
                                                        {/* Progress fill */}
                                                        <div className="h-full bg-plex absolute top-0 left-0 transition-all duration-1000 z-10" style={{ width: `${session.progress}%` }}></div>

                                                        {/* Text visible on black background (white text) */}
                                                        <div
                                                            className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white z-20 pointer-events-none whitespace-nowrap"
                                                            style={{ clipPath: `inset(0 0 0 ${session.progress}%)` }}
                                                        >
                                                            {progressBarText}
                                                        </div>

                                                        {/* Text visible on yellow progress bar (black text) */}
                                                        <div
                                                            className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-black z-30 pointer-events-none whitespace-nowrap"
                                                            style={{ clipPath: `inset(0 ${100 - session.progress}% 0 0)` }}
                                                        >
                                                            {progressBarText}
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ) : (
                        <EmptyStreamsMessage />
                    )}
                </section>

                <div className="flex justify-end gap-2 sm:gap-3 items-end mb-8 flex-wrap">
                    <div className="flex flex-col gap-1">
                        <DiscoverGridSizeSelect className="self-end" value={gridSize} onChange={setGridSize} />
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted px-0.5">Per section</span>
                        <CustomSelect
                            compact
                            className="w-28"
                            value={String(recentLimit)}
                            onChange={handleRecentLimitChange}
                            options={DISCOVER_LIMIT_OPTIONS}
                        />
                    </div>
                </div>

                <div className="flex flex-col gap-12 w-full">
                    {/* RECENT MOVIES */}
                    <ScrollReveal enabled={!!publicConfig?.useScrollRevealAnimations} className="flex flex-col">
                        <h2 className="text-plex text-sm uppercase tracking-[2px] mb-6 font-bold border-b border-white/10 pb-2">RECENTLY ADDED MOVIES</h2>
                        <div className={upgraderPosterGridClass(gridSize)} style={upgraderPosterGridStyle(gridSize)}>
                            {dashboardData && dashboardData.recentMovies.slice(0, recentLimit).map((item, i) => (
                                <DiscoverPosterCard key={i} item={item} showQualityBadges={showQualityBadges} />
                            ))}
                            {(!dashboardData || dashboardData.recentMovies.length === 0) && <div className="text-center text-muted p-8 border border-dashed border-border rounded-xl mt-4 w-full col-span-full">No recent movies</div>}
                        </div>
                    </ScrollReveal>

                    {/* RECENT TV SHOWS */}
                    <ScrollReveal enabled={!!publicConfig?.useScrollRevealAnimations} className="flex flex-col">
                        <h2 className="text-plex text-sm uppercase tracking-[2px] mb-6 font-bold border-b border-white/10 pb-2">{isJellyfinPortal ? 'RECENTLY ADDED EPISODES' : 'RECENTLY ADDED TV SHOWS'}</h2>
                        <div className={upgraderPosterGridClass(gridSize)} style={upgraderPosterGridStyle(gridSize)}>
                            {dashboardData && dashboardData.recentShows.slice(0, recentLimit).map((item, i) => (
                                <DiscoverPosterCard key={i} item={item} showQualityBadges={showQualityBadges} />
                            ))}
                            {(!dashboardData || dashboardData.recentShows.length === 0) && <div className="text-center text-muted p-8 border border-dashed border-border rounded-xl mt-4 w-full col-span-full">{isJellyfinPortal ? 'No recent episodes' : 'No recent TV shows'}</div>}
                        </div>
                    </ScrollReveal>

                    {/* RECENT MUSIC */}
                    <ScrollReveal enabled={!!publicConfig?.useScrollRevealAnimations} className="flex flex-col">
                        <h2 className="text-plex text-sm uppercase tracking-[2px] mb-6 font-bold border-b border-white/10 pb-2">RECENTLY ADDED MUSIC</h2>
                        <div className={upgraderPosterGridClass(gridSize)} style={upgraderPosterGridStyle(gridSize)}>
                            {dashboardData && dashboardData.recentMusic.slice(0, recentLimit).map((item, i) => (
                                <DiscoverPosterCard key={i} item={item} aspect="square" showQualityBadges={showQualityBadges} />
                            ))}
                            {(!dashboardData || dashboardData.recentMusic.length === 0) && <div className="text-center text-muted p-8 border border-dashed border-border rounded-xl mt-4 w-full col-span-full">No recent music</div>}
                        </div>
                    </ScrollReveal>
                </div>

                {/* SERVER WIDE STATS SECTION */}
                {!isJellyfinPortal && trendingLoading && !trendingStats ? (
                    <TrendingSectionsSkeleton count={trendingCount} sections={3} />
                ) : !isJellyfinPortal && trendingStats && (
                    <div className="mt-16 w-full flex flex-col gap-12">
                        <div className="flex flex-col gap-2 items-center text-center mb-4">
                            <h2 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight">Other things happening on {publicConfig?.serverIdentifier || 'this server'}</h2>
                            <p className="text-muted text-sm max-w-xl">A look at what the community is currently watching across the entire server.</p>
                        </div>

                        <TrendingDiscoverSection useScrollRevealAnimations={publicConfig?.useScrollRevealAnimations} title="🔥 Trending This Week" items={trendingStats.trending7Days} limit={recentLimit} showQualityBadges={showQualityBadges} gridSize={gridSize} />
                        <TrendingDiscoverSection useScrollRevealAnimations={publicConfig?.useScrollRevealAnimations} title="🍿 Most Watched Movies (This Month)" items={trendingStats.movies30Days} limit={recentLimit} showQualityBadges={showQualityBadges} gridSize={gridSize} />
                        <TrendingDiscoverSection useScrollRevealAnimations={publicConfig?.useScrollRevealAnimations} title="📺 Most Watched Shows (This Month)" items={trendingStats.shows30Days} limit={recentLimit} showQualityBadges={showQualityBadges} gridSize={gridSize} />
                        <TrendingDiscoverSection useScrollRevealAnimations={publicConfig?.useScrollRevealAnimations} title="🏆 Top of the Year" items={trendingStats.top365Days} limit={recentLimit} showQualityBadges={showQualityBadges} gridSize={gridSize} />
                        <TrendingDiscoverSection useScrollRevealAnimations={publicConfig?.useScrollRevealAnimations} title="🌟 All Time Favorites" items={trendingStats.allTime} limit={recentLimit} showQualityBadges={showQualityBadges} gridSize={gridSize} />
                        <TrendingDiscoverSection useScrollRevealAnimations={publicConfig?.useScrollRevealAnimations} title="🍿 Weekend Warriors" items={trendingStats.weekendWarriors} limit={recentLimit} showQualityBadges={showQualityBadges} gridSize={gridSize} />
                        <TrendingDiscoverSection useScrollRevealAnimations={publicConfig?.useScrollRevealAnimations} title="🦇 Night Owl Club" items={trendingStats.nightOwls} limit={recentLimit} showQualityBadges={showQualityBadges} gridSize={gridSize} />
                        <TrendingDiscoverSection useScrollRevealAnimations={publicConfig?.useScrollRevealAnimations} title="📼 Blast from the Past" items={trendingStats.retroHits} limit={recentLimit} showQualityBadges={showQualityBadges} gridSize={gridSize} />
                        <TrendingDiscoverSection useScrollRevealAnimations={publicConfig?.useScrollRevealAnimations} title="💎 Cult Classics" items={trendingStats.cultClassics} limit={recentLimit} showQualityBadges={showQualityBadges} gridSize={gridSize} />
                    </div>
                )}
                </>
                )}
            </main>

            {/* Stream Details Modal */}
            {selectedSession && (
                <StreamDetailsModal
                    session={selectedSession}
                    onClose={() => setSelectedSession(null)}
                    isAdmin={isAdmin}
                    onKilled={fetchData}
                    providerLabel={libraryProviderLabel}
                    onOpenProfile={(id) => {
                        setSelectedSession(null);
                        onNavigate?.('profile', { path: `/profile/${encodeURIComponent(id)}` });
                    }}
                    onOpenTitle={canOpenDashboardTitle ? (key) => {
                        setSelectedSession(null);
                        openDashboardTitle(key);
                    } : undefined}
                />
            )}
        </div>
    );
};
