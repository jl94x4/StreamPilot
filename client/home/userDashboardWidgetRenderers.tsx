import React, { useEffect, useState } from 'react';
import {
    Activity,
    AlertTriangle,
    Calendar,
    Clapperboard,
    ExternalLink,
    FileText,
    Film,
    Gift,
    Layers,
    Megaphone,
    MessageCircle,
    Music,
    Settings,
    Shield,
    Star,
    Tv,
    Users,
} from 'lucide-react';
import { getPublicOrigin, portalUrl } from '../shared/basePath';
import type { MainGridWidgetId, RecentlyAddedWidgetId } from '../shared/dashboardLayout';
import { LibraryStatsSkeleton } from '../shared/skeletons';
import { PeriodDropdown } from '../shared/PeriodDropdown';
import { ScrollReveal } from '../shared/ui';
import { ANALYTICS_PERIOD_OPTIONS } from '../shared/analyticsPeriodOptions';
import { PendingRequestsHomeWidget } from '../requests/PendingRequestsHomeWidget';
import { CollexionsHomeWidget } from '../collexions/CollexionsHomeWidget';
import { ScannerHomeWidget } from '../scanner/ScannerHomeWidget';
import { SpotifySyncHomeWidget } from '../spotify-sync/SpotifySyncHomeWidget';
import { MediaAutomationHomeWidget } from '../media-automation/MediaAutomationHomeWidget';
import { AchievementsHomeWidget } from '../achievements/AchievementsDashboard';
import { UnlockCelebration } from '../achievements/UnlockCelebration';
import { tAchievements } from '../achievements/i18n';
import { apiFetch, apiFetchShared } from '../shared/api';
import { ToastContainer, pushToast, type ToastMessage } from '../shared/toast';
import type { DiscoverTranslate } from '../discovery/i18n/types';
import { HomePosterScrollRow } from './HomePosterScrollRow';
import { ExpiringMembersHomeWidget } from './ExpiringMembersHomeWidget';
import { HomeNotificationsWidget } from './HomeNotificationsWidget';

const AchievementsHomeWidgetConnected: React.FC = () => {
    const [summary, setSummary] = useState<any>(null);
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [celebrationBadges, setCelebrationBadges] = useState<any[]>([]);
    useEffect(() => {
        let cancelled = false;
        let idleId: number | null = null;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const load = () => {
            apiFetchShared('/api/achievements/me?view=summary')
                .then((data) => {
                    if (cancelled || data?.homeWidgetEnabled === false) {
                        if (!cancelled) setSummary(null);
                        return;
                    }
                    setSummary(data);
                    const newly = Array.isArray(data?.newlyEarnedIds) ? data.newlyEarnedIds : [];
                    if (newly.length && data?.notifyOnUnlock !== false) {
                        const unlocked = newly.map((id: string) => (
                            (data.recentEarned || data.earned || []).find((b: any) => b.id === id)
                            || { id, name: id, icon: '🏅' }
                        ));
                        setCelebrationBadges(unlocked);
                        if (newly.length === 1) {
                            const badge = unlocked[0];
                            setToasts((prev) => pushToast(prev, tAchievements('toast.unlockedOne', { name: badge?.name || newly[0] }), 'success'));
                        } else if (newly.length > 1) {
                            setToasts((prev) => pushToast(prev, tAchievements('toast.unlockedMany', { count: newly.length }), 'success'));
                        }
                    }
                    if (newly.length) {
                        void apiFetch('/api/achievements/me/ack-unlocks', {
                            method: 'POST',
                            body: JSON.stringify({ ids: newly }),
                        }).catch(() => null);
                    }
                })
                .catch(() => {
                    if (!cancelled) setSummary(null);
                });
        };

        // Don't compete with Wrap-Up's heavy /analytics/me on first paint.
        if (typeof window !== 'undefined' && typeof (window as any).requestIdleCallback === 'function') {
            idleId = (window as any).requestIdleCallback(load, { timeout: 4000 });
        } else {
            timeoutId = setTimeout(load, 2500);
        }

        return () => {
            cancelled = true;
            if (idleId != null && typeof (window as any).cancelIdleCallback === 'function') {
                (window as any).cancelIdleCallback(idleId);
            }
            if (timeoutId != null) clearTimeout(timeoutId);
        };
    }, []);
    if (!summary) return null;
    return (
        <>
            <ToastContainer toasts={toasts} setToasts={setToasts} />
            {celebrationBadges.length > 0 && (
                <UnlockCelebration
                    badges={celebrationBadges}
                    onClose={() => setCelebrationBadges([])}
                />
            )}
            <AchievementsHomeWidget
                summary={summary}
                onOpen={() => {
                    window.history.pushState({}, '', portalUrl('/achievements'));
                    window.dispatchEvent(new PopStateEvent('popstate'));
                }}
            />
        </>
    );
};

type PosterCardProps = {
    item: { title: string; thumb?: string; thumbUrl?: string; plexUrl: string; tags?: string[]; year?: number | string; parentTitle?: string };
    aspect?: '2/3' | 'square';
    variant?: 'discover' | 'home';
    className?: string;
    footer?: React.ReactNode;
    showQualityBadges?: boolean;
    loading?: 'lazy' | 'eager';
    fetchPriority?: 'high' | 'low' | 'auto';
    onPosterClick?: () => void;
};

export type UserDashboardWidgetDeps = {
    t: DiscoverTranslate;
    sessionInfo: any;
    publicConfig?: any;
    user: any;
    isRevoked: boolean;
    isExpiringSoon: boolean;
    daysLeft: number | null;
    progressPct: number;
    serverStats: any;
    serverDataLoading: boolean;
    analytics: any;
    analyticsLoading: boolean;
    analyticsDays: number | 'all';
    analyticsDaysOpen: boolean;
    setAnalyticsDays: (days: number | 'all') => void;
    setAnalyticsDaysOpen: (open: boolean) => void;
    showQualityBadges: boolean;
    dashboardData: any;
    bazarrWidgets: any;
    handleRelink: () => void;
    onViewAdmin: () => void;
    onNavigate?: (route: string, options?: { path?: string; hash?: string; reviewId?: number }) => void;
    onViewSettings?: () => void;
    onViewLogs?: () => void;
    onViewCollexions?: () => void;
    onViewScanner?: () => void;
    onViewSpotifySync?: () => void;
    onViewMediaAutomation?: () => void;
    onViewRequests?: (reviewId?: number) => void;
    onPendingRequestsChange?: () => void;
    setToast: (toast: { id: number; message: string; type: 'success' | 'error' }) => void;
    DiscoverPosterCard: React.ComponentType<PosterCardProps>;
    RebuildLibraryCacheButton: React.ComponentType;
};

const ReferralHomeWidget: React.FC<{
    t: DiscoverTranslate;
    referralUrl: string;
    setToast: (toast: { id: number; message: string; type: 'success' | 'error' }) => void;
}> = ({ t, referralUrl, setToast }) => {
    const [stats, setStats] = useState<{
        successfulReferrals: number;
        totalBonusDays: number;
        recent: Array<{ id: string; referredUsername: string; rewardDays: number; rewardApplied: boolean }>;
    } | null>(null);

    useEffect(() => {
        let cancelled = false;
        apiFetch('/api/me/referral-stats')
            .then((data) => {
                if (cancelled || !data?.enabled) return;
                setStats({
                    successfulReferrals: Number(data.successfulReferrals) || 0,
                    totalBonusDays: Number(data.totalBonusDays) || 0,
                    recent: Array.isArray(data.recent) ? data.recent.slice(0, 3) : [],
                });
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, []);

    return (
        <div className="glass-card p-4 md:p-5 shadow-lg">
            <p className="text-plex font-bold text-base mb-1 flex items-center gap-2">
                <Gift className="w-4 h-4 shrink-0" />
                {t('homeDashboard.inviteFriends')}
            </p>
            <p className="text-muted text-sm leading-relaxed mb-4">{t('homeDashboard.inviteFriendsHint')}</p>
            {stats && stats.successfulReferrals > 0 && (
                <div className="mb-4 space-y-2">
                    <p className="text-sm font-medium text-text">
                        {t('homeDashboard.referralStats', {
                            count: stats.successfulReferrals,
                            days: stats.totalBonusDays,
                        })}
                    </p>
                    {stats.recent.length > 0 && (
                        <div>
                            <p className="text-[11px] uppercase tracking-wide text-muted mb-1">{t('homeDashboard.referralRecent')}</p>
                            <ul className="space-y-1">
                                {stats.recent.map((item) => (
                                    <li key={item.id} className="text-xs text-muted">
                                        {item.rewardApplied && item.rewardDays > 0
                                            ? t('homeDashboard.referralRecentItem', { name: item.referredUsername, days: item.rewardDays })
                                            : t('homeDashboard.referralRecentItemNoDays', { name: item.referredUsername })}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
            <div className="flex flex-col gap-2">
                <input type="text" readOnly value={referralUrl} className="appearance-none text-[16px] leading-5 w-full p-3 rounded-lg border border-border bg-background text-text text-[16px] outline-none" />
                <button onClick={() => { navigator.clipboard.writeText(referralUrl); setToast({ id: 99, message: t('homeDashboard.copiedToClipboard'), type: 'success' }); }} className="w-full py-2.5 bg-plex text-background rounded-lg font-bold hover:bg-plex-hover transition-colors shadow-md">{t('homeDashboard.copyLink')}</button>
            </div>
        </div>
    );
};

const formatBytes = (bytes: number) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

const LibraryStatsContent: React.FC<{ serverStats: any; variant?: 'plex' | 'jellyfin'; t: DiscoverTranslate }> = ({ serverStats, variant = 'plex', t }) => {
    const catalogAsOf = (() => {
        const raw = serverStats?.generatedAt;
        const n = typeof raw === 'number' ? raw : Date.parse(String(raw || ''));
        if (!Number.isFinite(n) || n <= 0) return null;
        const mins = Math.max(0, Math.floor((Date.now() - n) / 60000));
        if (mins < 1) return t('homeDashboard.catalogAsOfJustNow');
        if (mins < 60) return t('homeDashboard.catalogAsOfMinutes', { count: mins });
        const hours = Math.floor(mins / 60);
        if (hours < 24) return t('homeDashboard.catalogAsOfHours', { count: hours });
        return t('homeDashboard.catalogAsOfDays', { count: Math.floor(hours / 24) });
    })();

    if (variant === 'jellyfin') {
        const totalBytes = Number(serverStats.totalCatalogBytes) || 0;
        const movies = Number(serverStats.movies) || 0;
        const shows = Number(serverStats.shows) || 0;
        const episodes = Number(serverStats.episodes) || 0;
        return (
            <div className="space-y-4">
                <div className="rounded-2xl border border-white/5 bg-background/40 p-4 md:p-5">
                    <p className="text-[10px] uppercase tracking-widest font-bold text-muted">{t('homeDashboard.totalCatalog')}</p>
                    <p className="text-3xl md:text-4xl font-black text-text mt-1 tracking-tight">{formatBytes(totalBytes)}</p>
                    <p className="text-xs text-muted mt-1.5">
                        {t('homeDashboard.catalogSummary', { movies: movies.toLocaleString(), shows: shows.toLocaleString(), episodes: episodes.toLocaleString() })}
                        {catalogAsOf ? ` · ${catalogAsOf}` : ''}
                    </p>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                    <div className="bg-background/60 p-3 rounded-xl border border-white/5 text-center">
                        <Film className="w-5 h-5 text-plex mx-auto mb-1.5 opacity-80" />
                        <p className="text-xl font-black text-text">{movies.toLocaleString()}</p>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted mt-0.5">{t('mediaType.movies')}</p>
                    </div>
                    <div className="bg-background/60 p-3 rounded-xl border border-white/5 text-center">
                        <Tv className="w-5 h-5 text-plex mx-auto mb-1.5 opacity-80" />
                        <p className="text-xl font-black text-text">{shows.toLocaleString()}</p>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted mt-0.5">{t('homeDashboard.shows')}</p>
                    </div>
                    <div className="bg-background/60 p-3 rounded-xl border border-white/5 text-center">
                        <Layers className="w-5 h-5 text-plex mx-auto mb-1.5 opacity-80" />
                        <p className="text-xl font-black text-text">{episodes.toLocaleString()}</p>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted mt-0.5">{t('homeDashboard.episodes')}</p>
                    </div>
                </div>
            </div>
        );
    }

    const movies = Number(serverStats.moviesBytes) || 0;
    const shows = Number(serverStats.showsBytes) || 0;
    const music = Number(serverStats.musicBytes) || 0;
    const total = movies + shows + music;
    if (total <= 0) return null;

    const movieCount = Number(serverStats.movies) || 0;
    const showCount = Number(serverStats.shows) || 0;
    const musicCount = Number(serverStats.music) || 0;
    const episodeCount = Number(serverStats.episodes) || 0;
    const trackCount = Number(serverStats.tracks) || 0;

    const libraryPalette = [
        { color: 'bg-sky-400', dot: 'bg-sky-400', icon: Film },
        { color: 'bg-emerald-400', dot: 'bg-emerald-400', icon: Tv },
        { color: 'bg-violet-400', dot: 'bg-violet-400', icon: Music },
        { color: 'bg-amber-400', dot: 'bg-amber-400', icon: Film },
        { color: 'bg-rose-400', dot: 'bg-rose-400', icon: Tv },
        { color: 'bg-cyan-400', dot: 'bg-cyan-400', icon: Music },
    ];
    const typeIcon = (type: string) => (type === 'artist' ? Music : type === 'show' ? Tv : Film);
    const typeCountLabel = (type: string) => (
        type === 'artist' ? t('homeDashboard.albumsLower')
            : type === 'show' ? t('homeDashboard.showsLower')
                : t('homeDashboard.moviesLower')
    );

    const libraryRows = Array.isArray(serverStats.libraries)
        ? [...serverStats.libraries]
            .filter((lib: any) => (Number(lib?.bytes) || 0) > 0 || (Number(lib?.count) || 0) > 0)
            .sort((a: any, b: any) => (Number(b.bytes) || 0) - (Number(a.bytes) || 0))
        : [];

    const segments = libraryRows.length > 0
        ? libraryRows.map((lib: any, index: number) => {
            const palette = libraryPalette[index % libraryPalette.length];
            return {
                label: String(lib.title || 'Library'),
                bytes: Number(lib.bytes) || 0,
                count: Number(lib.count) || 0,
                countLabel: typeCountLabel(String(lib.type || '')),
                extra: Number(lib.episodes) > 0
                    ? t('homeDashboard.episodeCountLabel', { count: Number(lib.episodes).toLocaleString() })
                    : Number(lib.tracks) > 0
                        ? t('homeDashboard.trackCountLabel', { count: Number(lib.tracks).toLocaleString() })
                        : null,
                icon: typeIcon(String(lib.type || '')),
                color: palette.color,
                dot: palette.dot,
            };
        })
        : [
            { label: t('mediaType.movies'), bytes: movies, count: movieCount, countLabel: t('homeDashboard.moviesLower'), extra: null, icon: Film, color: 'bg-sky-400', dot: 'bg-sky-400' },
            { label: t('homeDashboard.tvShows'), bytes: shows, count: showCount, countLabel: t('homeDashboard.showsLower'), extra: null, icon: Tv, color: 'bg-emerald-400', dot: 'bg-emerald-400' },
            { label: t('mediaType.music'), bytes: music, count: musicCount, countLabel: t('homeDashboard.albumsLower'), extra: null, icon: Music, color: 'bg-violet-400', dot: 'bg-violet-400' },
        ].filter((segment) => segment.bytes > 0 || segment.count > 0);

    if (segments.length === 0) return null;

    const pct = (bytes: number) => Math.max(bytes > 0 ? (bytes / total) * 100 : 0, 0);
    const summaryBits = [
        episodeCount > 0 ? t('homeDashboard.episodeCountLabel', { count: episodeCount.toLocaleString() }) : null,
        trackCount > 0 ? t('homeDashboard.trackCountLabel', { count: trackCount.toLocaleString() }) : null,
    ].filter(Boolean);
    const failedNames = [
        ...(Array.isArray(serverStats.lastBuildFailures) ? serverStats.lastBuildFailures : []),
        ...(Array.isArray(serverStats.failedLibraries) ? serverStats.failedLibraries : []),
    ].map((f: any) => f?.title).filter(Boolean)
        .filter((name, index, all) => all.indexOf(name) === index);

    return (
        <div className="space-y-3">
            <div>
                <p className="text-[10px] uppercase tracking-widest font-bold text-muted">{t('homeDashboard.totalLibrary')}</p>
                <p className="text-2xl md:text-3xl font-black text-text mt-1 tracking-tight">{formatBytes(total)}</p>
                {summaryBits.length > 0 ? (
                    <p className="text-xs text-muted mt-1">{summaryBits.join(' · ')}{catalogAsOf ? ` · ${catalogAsOf}` : ''}</p>
                ) : catalogAsOf ? (
                    <p className="text-xs text-muted mt-1">{catalogAsOf}</p>
                ) : null}
            </div>

            <div className="flex h-1.5 rounded-full overflow-hidden bg-white/5 gap-px">
                {segments.map((segment) => (
                    segment.bytes > 0 ? (
                        <div
                            key={segment.label}
                            className={`${segment.color} transition-all duration-500 first:rounded-l-full last:rounded-r-full`}
                            style={{ width: `${pct(segment.bytes)}%` }}
                            title={`${segment.label}: ${formatBytes(segment.bytes)}`}
                        />
                    ) : null
                ))}
            </div>

            <div className="space-y-1.5">
                {segments.map((segment) => {
                    const Icon = segment.icon;
                    return (
                        <div key={segment.label} className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg bg-background/50 border border-white/5">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${segment.dot}`} />
                            <Icon className="w-4 h-4 text-plex shrink-0 opacity-70" />
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-bold text-text">{segment.label}</p>
                                <p className="text-[11px] text-muted">
                                    {segment.count.toLocaleString()} {segment.countLabel}
                                    {segment.extra ? ` · ${segment.extra}` : ''}
                                </p>
                            </div>
                            <div className="text-right shrink-0">
                                <p className="text-sm font-black text-text">{formatBytes(segment.bytes)}</p>
                                <p className="text-[10px] font-semibold text-muted">{pct(segment.bytes).toFixed(0)}%</p>
                            </div>
                        </div>
                    );
                })}
            </div>
            {failedNames.length > 0 ? (
                <p className="text-[11px] text-amber-300/90">
                    {t('homeDashboard.incompleteLibraries', { names: failedNames.join(', ') })}
                </p>
            ) : null}
        </div>
    );
};

/** Trial flag can linger after admin extends access — only treat as temp access while ≤3 days remain. */
const isActiveShortTermTrial = (user: any, daysLeft: number | null) => (
    !!user?.isTrial && daysLeft !== null && daysLeft <= 3
);

export const createMainGridWidgetRenderer = (deps: UserDashboardWidgetDeps) => {
    const {
        t,
        sessionInfo,
        publicConfig,
        user,
        isRevoked,
        isExpiringSoon,
        daysLeft,
        progressPct,
        serverStats,
        serverDataLoading,
        bazarrWidgets,
        analytics,
        analyticsLoading,
        analyticsDays,
        analyticsDaysOpen,
        setAnalyticsDays,
        setAnalyticsDaysOpen,
        handleRelink,
        onViewAdmin,
        onNavigate,
        onViewSettings,
        onViewLogs,
        onViewCollexions,
        onViewScanner,
        onViewRequests,
        onPendingRequestsChange,
        setToast,
        RebuildLibraryCacheButton,
    } = deps;

    const analyticsDaysOptions = ANALYTICS_PERIOD_OPTIONS;
    const mediaServerType = String(publicConfig?.mediaServerType || 'plex').toLowerCase();
    const isJellyfinPortal = mediaServerType === 'jellyfin' || mediaServerType === 'emby';
    const mediaServerLabel = mediaServerType === 'emby' ? 'Emby' : 'Jellyfin';
    const analyticsProviderLabel = publicConfig?.jellyfinAnalyticsProvider === 'jellyglance' ? 'JellyGlance' : 'Jellystat';
    const isExpired = daysLeft !== null && daysLeft < 0;

    return (id: MainGridWidgetId): React.ReactNode => {
        switch (id) {
            case 'adminBadge':
                return (
                    <div className="glass-card p-4 md:p-5 shadow-xl flex flex-col items-center justify-center text-center flex-shrink-0">
                        <div className="w-14 h-14 md:w-16 md:h-16 bg-plex/10 rounded-full flex items-center justify-center mb-2 md:mb-3 border border-plex/30 shadow-[0_0_15px_rgba(229,160,13,0.15)]">
                            <Shield className="w-7 h-7 md:w-8 md:h-8 text-plex drop-shadow-md" />
                        </div>
                        <h3 className="text-xl md:text-2xl font-black text-text uppercase tracking-widest mb-1">{t('homeDashboard.admin.serverAdmin')}</h3>
                        <div className="mt-2 inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[10px] font-black bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border border-amber-500/40 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.25)] tracking-widest uppercase">
                            <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 drop-shadow-[0_0_8px_rgba(245,158,11,0.8)]" /> {t('homeDashboard.admin.vipUnlimited')}
                        </div>
                    </div>
                );
            case 'accessStatus':
                if (!user) return null;
                return (
                    <div className="glass-card p-4 md:p-5 shadow-xl flex flex-col justify-center flex-shrink-0">
                        <div className="flex flex-col gap-3 md:gap-4">
                            <div>
                                <p className="text-muted text-xs uppercase tracking-widest font-semibold mb-3">{t('homeDashboard.accessStatus')}</p>
                                <div className="flex flex-wrap items-center gap-3">
                                    <span className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-black border uppercase tracking-wider shadow-sm ${isRevoked ? 'bg-red-500/10 border-red-500/30 text-red-400' : isExpiringSoon ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400' : 'bg-green-500/10 border-green-500/30 text-green-400'}`}>
                                        <span className={`w-2 h-2 rounded-full animate-pulse ${isRevoked ? 'bg-red-400' : isExpiringSoon ? 'bg-yellow-400' : 'bg-green-400'}`} />
                                        {user.plexAccessStatus}{isActiveShortTermTrial(user, daysLeft) && ` · ${t('homeDashboard.tempAccess')}`}
                                    </span>
                                    {user.expiryDate ? (
                                        <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold bg-white/5 border border-white/10 text-text shadow-sm">
                                            <Calendar size={14} className="text-muted" />
                                            {new Date(user.expiryDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-[11px] font-black bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border border-amber-500/40 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.25)] tracking-widest uppercase">
                                            <Star className="w-4 h-4 text-amber-400 fill-amber-400 drop-shadow-[0_0_8px_rgba(245,158,11,0.8)]" /> {t('homeDashboard.admin.vipUnlimited')}
                                        </span>
                                    )}
                                </div>
                            </div>
                            {isRevoked && daysLeft !== null && daysLeft >= 0 && (
                            <button className="w-full mt-2 px-6 py-2.5 bg-plex text-background rounded-xl font-bold hover:bg-plex-hover transition-colors shadow-lg" onClick={handleRelink}>
                                    {t('homeDashboard.relinkAccount')}
                                </button>
                            )}
                            {daysLeft !== null && (
                                <div className="bg-background/40 rounded-xl p-5 border border-white/5 mt-2">
                                    <div className="flex justify-between items-baseline mb-3">
                                        <span className="text-muted text-xs uppercase tracking-widest font-semibold">{t('homeDashboard.timeRemaining')}</span>
                                        <span className={`font-black text-3xl md:text-4xl leading-none ${isExpired || isRevoked ? 'text-red-400 drop-shadow-[0_0_8px_rgba(248,113,113,0.3)]' : isExpiringSoon ? 'text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.3)]' : 'text-plex drop-shadow-[0_0_8px_rgba(229,160,13,0.3)]'}`}>
                                            {daysLeft}<span className="text-base font-semibold text-muted ml-1.5">{t('homeDashboard.day', { count: daysLeft })}</span>
                                        </span>
                                    </div>
                                    <div className="w-full h-3 bg-black/40 rounded-full overflow-hidden shadow-inner border border-white/5">
                                        <div className={`h-full rounded-full transition-all duration-1000 relative ${isExpired || isRevoked ? 'bg-red-400' : isExpiringSoon ? 'bg-yellow-400' : 'bg-gradient-to-r from-plex via-amber-400 to-orange-500'}`} style={{ width: `${progressPct}%` }}>
                                            <div className="absolute top-0 bottom-0 left-0 right-0 bg-[linear-gradient(45deg,rgba(255,255,255,0.15)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.15)_50%,rgba(255,255,255,0.15)_75%,transparent_75%,transparent)] bg-[length:1rem_1rem] animate-[shimmer_1s_linear_infinite]" />
                                        </div>
                                    </div>
                                    {isExpired && (
                                        <p className="text-red-400/90 text-sm font-medium mt-3 flex items-center gap-2">{t('homeDashboard.expired')}</p>
                                    )}
                                    {isExpiringSoon && !isExpired && (
                                        <p className="text-yellow-400/90 text-sm font-medium mt-3 flex items-center gap-2">
                                            <AlertTriangle className="w-4 h-4 shrink-0" />
                                            {t('homeDashboard.expiringSoonContactAdmin')}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                );
            case 'tempAccessSetup':
                return (
                    <div className="flex items-center gap-3 text-muted text-sm bg-card p-6 rounded-2xl border border-border shadow-lg flex-shrink-0">
                        <div className="w-5 h-5 rounded-full border-2 border-plex border-t-transparent animate-spin flex-shrink-0" />
                        {t('homeDashboard.settingUpTempAccess')}
                    </div>
                );
            case 'quickActions':
                return (
                    <div className="glass-card p-3 md:p-4 shadow-xl flex flex-col flex-shrink-0 justify-center gap-2.5">
                        <p className="text-muted text-xs uppercase tracking-widest font-semibold flex-shrink-0">{t('homeDashboard.admin.quickActions')}</p>
                        <div className="grid grid-cols-3 gap-2">
                            <button type="button" onClick={() => onViewAdmin()} className="flex flex-col items-center justify-center gap-1.5 px-2 py-3 rounded-xl font-bold text-[10px] leading-tight text-center transition-all border bg-plex/10 border-plex/30 text-plex hover:bg-plex/20">
                                <Users size={18} />
                                <span>{t('homeDashboard.admin.manageUsers')}</span>
                            </button>
                            <button type="button" onClick={() => onViewSettings?.()} className="flex flex-col items-center justify-center gap-1.5 px-2 py-3 rounded-xl font-bold text-[10px] leading-tight text-center transition-all border bg-white/5 border-white/10 text-text hover:bg-white/10">
                                <Settings size={18} />
                                <span>{t('homeDashboard.admin.settings')}</span>
                            </button>
                            <button type="button" onClick={() => onViewLogs?.()} className="flex flex-col items-center justify-center gap-1.5 px-2 py-3 rounded-xl font-bold text-[10px] leading-tight text-center transition-all border bg-white/5 border-white/10 text-text hover:bg-white/10">
                                <Activity size={18} />
                                <span>{t('homeDashboard.admin.systemLogs')}</span>
                            </button>
                        </div>
                    </div>
                );
            case 'announcement':
                if (!publicConfig?.announcement) return null;
                return (
                    <div className="bg-plex/10 border border-plex/30 rounded-2xl p-3 md:p-4 shadow-lg">
                        <div className="flex items-start gap-3">
                            <Megaphone className="w-5 h-5 text-plex mt-0.5 shrink-0" />
                            <div>
                                <h3 className="text-plex font-bold text-sm uppercase tracking-wider mb-1">{t('homeDashboard.announcement')}</h3>
                                <p className="text-text whitespace-pre-wrap text-sm leading-relaxed">{publicConfig.announcement}</p>
                            </div>
                        </div>
                    </div>
                );
            case 'referral':
                if (!user) return null;
                {
                    const referralBase = String(publicConfig?.publicBaseUrl || '').trim().replace(/\/+$/, '') || getPublicOrigin();
                    const referralUrl = `${referralBase}/?ref=${user.id}`;
                    return <ReferralHomeWidget t={t} referralUrl={referralUrl} setToast={setToast} />;
                }
            case 'support': {
                const showTempAccessMessage = isActiveShortTermTrial(user, daysLeft);
                const hasContactOptions = !!(publicConfig?.contactWhatsApp || publicConfig?.contactEmail);
                const ticketsEnabled = sessionInfo?.navFeatures?.support !== false;
                const openSupportInbox = (compose = false) => {
                    window.history.pushState({}, '', portalUrl(compose ? '/support?compose=1' : '/support'));
                    window.dispatchEvent(new PopStateEvent('popstate'));
                };
                return (
                    <div className="glass-card p-4 md:p-5 shadow-lg flex flex-col">
                        {showTempAccessMessage ? (
                            <div className="mb-3 md:mb-4 flex-shrink-0">
                                <p className="text-plex font-bold text-base mb-1 flex items-center gap-2">
                                    <Clapperboard className="w-4 h-4 shrink-0" />
                                    {t('homeDashboard.enjoyingTempAccess')}
                                </p>
                                <p className="text-muted text-sm leading-relaxed">
                                    {t('homeDashboard.tempAccessEnds', { count: daysLeft || 0 })}
                                </p>
                            </div>
                        ) : (
                            <div className="mb-3 md:mb-4 flex-shrink-0">
                                <p className="text-text font-bold text-base mb-1 flex items-center gap-2">
                                    <MessageCircle className="w-4 h-4 shrink-0" />
                                    {t('homeDashboard.needHelp')}
                                </p>
                                <p className="text-muted text-sm leading-relaxed">
                                    {t('homeDashboard.contactOwnerHint')}
                                </p>
                            </div>
                        )}
                        {hasContactOptions || ticketsEnabled ? (
                            <div className="flex flex-col gap-3 mt-auto">
                                {ticketsEnabled && (
                                    <button
                                        type="button"
                                        onClick={() => openSupportInbox(true)}
                                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all border bg-plex/10 border-plex/30 text-plex hover:bg-plex/20"
                                    >
                                        {t('homeDashboard.openSupportTicket')}
                                    </button>
                                )}
                                {publicConfig?.contactWhatsApp && (
                                    <a href={`https://wa.me/${String(publicConfig.contactWhatsApp).replace(/\D/g, '')}`} target="_blank" rel="noreferrer"
                                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all border bg-[#25D366]/10 border-[#25D366]/30 text-[#25D366] hover:bg-[#25D366]/20">
                                        WhatsApp
                                    </a>
                                )}
                                {publicConfig?.contactEmail && (
                                    <a href={`mailto:${publicConfig.contactEmail}`}
                                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all border bg-white/5 border-white/10 text-text hover:bg-white/10">
                                        {t('homeDashboard.email')}
                                    </a>
                                )}
                            </div>
                        ) : (
                            <p className="text-muted text-xs mt-auto">{t('homeDashboard.contactNotConfigured')}</p>
                        )}
                    </div>
                );
            }
            case 'libraryStats':
                if (isJellyfinPortal) {
                    return (
                        <div className="glass-card p-4 md:p-5 shadow-xl w-full self-start">
                            <div className="flex items-center justify-between mb-3 md:mb-4">
                                <p className="text-muted text-sm uppercase tracking-widest font-semibold">{t('homeDashboard.providerLibrary', { provider: mediaServerLabel })}</p>
                            </div>
                            {serverDataLoading && !serverStats ? (
                                <LibraryStatsSkeleton />
                            ) : serverStats ? (
                                <LibraryStatsContent serverStats={serverStats} variant="jellyfin" t={t} />
                            ) : (
                                <div className="text-muted text-sm bg-background/50 p-4 rounded-xl border border-white/5">{t('homeDashboard.providerLibraryStatsFailed', { provider: mediaServerLabel })}</div>
                            )}
                        </div>
                    );
                }
                return (
                    <div className="glass-card p-4 md:p-5 shadow-xl w-full self-start">
                        <div className="flex items-center justify-between mb-3 md:mb-4">
                            <p className="text-muted text-sm uppercase tracking-widest font-semibold">{t('homeDashboard.serverLibrarySize')}</p>
                            {sessionInfo.session.isAdmin && <RebuildLibraryCacheButton />}
                        </div>
                        {serverDataLoading && !serverStats ? (
                            <LibraryStatsSkeleton />
                        ) : serverStats?.isBuilding ? (
                            <div className="flex flex-col gap-2">
                                <div className="flex gap-3 items-center text-muted"><div className="w-5 h-5 rounded-full border-2 border-plex border-t-transparent animate-spin" /> {t('homeDashboard.buildingLibraryCache')}</div>
                                <p className="text-xs text-muted/60">{t('homeDashboard.buildingLibraryCacheHint')}</p>
                            </div>
                        ) : serverStats ? (
                            <LibraryStatsContent serverStats={serverStats} variant="plex" t={t} />
                        ) : (
                            <div className="text-muted text-sm bg-background/50 p-4 rounded-xl border border-white/5">{t('homeDashboard.serverStatsFailed')}</div>
                        )}
                    </div>
                );
            case 'collexions':
                return <CollexionsHomeWidget onOpen={onViewCollexions} />;
            case 'analytics':
                if (!sessionInfo.session.isAdmin && !user) return null;
                if (!isJellyfinPortal) return null;
                return (
                        <div className="glass-card p-3 md:p-4 shadow-xl flex flex-col flex-1 min-h-0">
                        <div className="flex items-center justify-between flex-shrink-0">
                            <h2 className="text-lg md:text-xl font-bold text-text flex items-center gap-2">
                                <Activity className="w-5 h-5 text-plex" /> {t('homeDashboard.providerActivity', { provider: analyticsProviderLabel })}
                            </h2>
                            <PeriodDropdown
                                value={analyticsDays}
                                open={analyticsDaysOpen}
                                onToggle={() => setAnalyticsDaysOpen(!analyticsDaysOpen)}
                                onClose={() => setAnalyticsDaysOpen(false)}
                                onChange={(value) => setAnalyticsDays(value as number | 'all')}
                                options={analyticsDaysOptions}
                            />
                        </div>
                        {analyticsLoading ? (
                            <div className="flex items-center gap-3 text-muted mt-4">
                                <div className="w-5 h-5 rounded-full border-2 border-plex border-t-transparent animate-spin" />
                                {t('homeDashboard.loadingProviderActivity', { provider: analyticsProviderLabel })}
                            </div>
                        ) : analytics && analytics.totalPlays > 0 ? (
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mt-4">
                                <div className="bg-background/60 rounded-xl border border-white/5 p-3">
                                    <p className="text-[10px] text-muted uppercase tracking-widest font-bold">{t('wrapUp.breakdown.totalPlays')}</p>
                                    <p className="text-2xl font-black text-text mt-1">{analytics.totalPlays?.toLocaleString?.() || 0}</p>
                                </div>
                                <div className="bg-background/60 rounded-xl border border-white/5 p-3">
                                    <p className="text-[10px] text-muted uppercase tracking-widest font-bold">{t('wrapUp.topLibrary')}</p>
                                    <p className="text-sm font-bold text-text mt-1 truncate">{analytics.favoriteLibrary || t('wrapUp.none')}</p>
                                </div>
                                <div className="bg-background/60 rounded-xl border border-white/5 p-3">
                                    <p className="text-[10px] text-muted uppercase tracking-widest font-bold">{t('wrapUp.topMovie')}</p>
                                    <p className="text-sm font-bold text-text mt-1 truncate">{analytics.topMovie?.title || t('wrapUp.none')}</p>
                                </div>
                                <div className="bg-background/60 rounded-xl border border-white/5 p-3">
                                    <p className="text-[10px] text-muted uppercase tracking-widest font-bold">{t('homeDashboard.topShow')}</p>
                                    <p className="text-sm font-bold text-text mt-1 truncate">{analytics.topBinge?.title || t('wrapUp.none')}</p>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center p-4 md:p-5 text-center flex-1 min-h-0 mt-2 md:mt-3">
                                <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-3 shadow-inner">
                                    <Clapperboard className="w-6 h-6 text-muted" />
                                </div>
                                <h3 className="font-bold text-text mb-1">{t('homeDashboard.noProviderActivity', { provider: analyticsProviderLabel })}</h3>
                                <p className="text-muted text-sm max-w-sm">{t('homeDashboard.noProviderActivityHint', { provider: analyticsProviderLabel })}</p>
                            </div>
                        )}
                    </div>
                );
            case 'achievements':
                if (!sessionInfo?.navFeatures?.achievements) return null;
                return <AchievementsHomeWidgetConnected />;
            case 'expiringMembers':
                if (!sessionInfo?.session?.isAdmin) return null;
                return <ExpiringMembersHomeWidget t={t} onViewAdmin={onViewAdmin} />;
            case 'homeNotifications':
                return <HomeNotificationsWidget t={t} onNavigate={onNavigate} />;
            default:
                return null;
        }
    };
};

export const createPendingRequestsSectionRenderer = (deps: UserDashboardWidgetDeps) => {
    const { t, sessionInfo, onViewRequests, onPendingRequestsChange, setToast } = deps;

    return (): React.ReactNode => {
        if (!sessionInfo?.session?.isAdmin) return null;
        if (!sessionInfo?.navFeatures?.requestsQueue) {
            return (
                <div className="glass-card p-4 md:p-5 shadow-xl border-white/10">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                            <p className="text-sm font-semibold text-text">{t('homeDashboard.admin.requestsTitle')}</p>
                            <p className="text-xs text-muted mt-1">{t('homeDashboard.admin.requestsSetupHintWithSettings')}</p>
                        </div>
                        {onViewRequests && (
                            <button type="button" onClick={() => onViewRequests()} className="inline-flex items-center justify-center px-3 py-2 rounded-lg border border-white/10 text-sm font-semibold text-text hover:bg-white/5 transition-colors">
                                {t('homeDashboard.admin.openRequests')}
                            </button>
                        )}
                    </div>
                </div>
            );
        }
        return (
            <PendingRequestsHomeWidget
                layout="wide"
                showEmpty
                onViewAll={() => onViewRequests?.()}
                onReviewRequest={(requestId) => onViewRequests?.(requestId)}
                onActionComplete={onPendingRequestsChange}
                onToast={(message, type) => setToast({ id: Date.now(), message, type })}
            />
        );
    };
};

export const createScannerSectionRenderer = (deps: UserDashboardWidgetDeps) => {
    const { sessionInfo, onViewScanner } = deps;
    return (): React.ReactNode => {
        if (!sessionInfo?.session?.isAdmin) return null;
        if (!sessionInfo?.navFeatures?.scannerHomeWidget) return null;
        return <ScannerHomeWidget onOpen={onViewScanner} />;
    };
};

export const createSpotifySyncSectionRenderer = (deps: UserDashboardWidgetDeps) => {
    const { sessionInfo, onViewSpotifySync } = deps;
    return (): React.ReactNode => {
        if (!sessionInfo?.session?.isAdmin) return null;
        if (!sessionInfo?.navFeatures?.spotifySyncHomeWidget) return null;
        return <SpotifySyncHomeWidget onOpen={onViewSpotifySync} />;
    };
};

export const createMediaAutomationSectionRenderer = (deps: UserDashboardWidgetDeps) => {
    const { sessionInfo, onViewMediaAutomation } = deps;
    return (): React.ReactNode => {
        if (!sessionInfo?.session?.isAdmin) return null;
        if (!sessionInfo?.navFeatures?.mediaAutomationHomeWidget) return null;
        return <MediaAutomationHomeWidget onOpen={onViewMediaAutomation} />;
    };
};

export const createBazarrToolsSectionRenderer = (deps: UserDashboardWidgetDeps) => {
    const { t, sessionInfo, bazarrWidgets } = deps;
    return (): React.ReactNode => {
        if (!sessionInfo.session.isAdmin) return null;
        const instances = Array.isArray(bazarrWidgets?.instances) ? bazarrWidgets.instances : [];
        if (!bazarrWidgets?.configured && instances.length === 0) return null;
        const totals = bazarrWidgets?.totals || {};
        const primary = instances[0] || {};
        return (
            <div className="glass-card p-4 md:p-5 shadow-xl w-full">
                <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                        <p className="text-muted text-sm uppercase tracking-widest font-semibold">{t('homeDashboard.bazarr.title')}</p>
                        <div className="flex items-center gap-2 mt-1">
                            <span className={`w-2 h-2 rounded-full ${totals.online > 0 ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500'}`} />
                            <span className={`text-[10px] font-bold uppercase tracking-wider ${totals.online > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {totals.online > 0
                                    ? t('homeDashboard.bazarr.onlineCount', { online: totals.online, total: instances.length })
                                    : t('homeDashboard.bazarr.unavailable')}
                            </span>
                            {primary.version && <span className="text-[10px] font-bold text-muted">v{primary.version}</span>}
                        </div>
                    </div>
                    {primary.url && (
                        <a
                            href={primary.url}
                            target="_blank"
                            rel="noreferrer"
                            title={t('homeDashboard.bazarr.open')}
                            className="p-2 rounded-lg text-muted hover:text-text hover:bg-white/5 transition-colors shrink-0"
                        >
                            <ExternalLink className="w-4 h-4" />
                        </a>
                    )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                    <div className="bg-background/60 rounded-xl border border-white/5 p-3">
                        <FileText className="w-4 h-4 text-plex mb-2 opacity-80" />
                        <p className="text-2xl font-black text-text">{Number(totals.wantedEpisodes || 0).toLocaleString()}</p>
                        <p className="text-[10px] uppercase tracking-wider font-bold text-muted mt-0.5">{t('homeDashboard.bazarr.wantedEpisodes')}</p>
                    </div>
                    <div className="bg-background/60 rounded-xl border border-white/5 p-3">
                        <Film className="w-4 h-4 text-plex mb-2 opacity-80" />
                        <p className="text-2xl font-black text-text">{Number(totals.wantedMovies || 0).toLocaleString()}</p>
                        <p className="text-[10px] uppercase tracking-wider font-bold text-muted mt-0.5">{t('homeDashboard.bazarr.wantedMovies')}</p>
                    </div>
                    <div className="bg-background/60 rounded-xl border border-white/5 p-3">
                        <Layers className="w-4 h-4 text-plex mb-2 opacity-80" />
                        <p className="text-xl font-black text-text">{Number(totals.providers || 0).toLocaleString()}</p>
                        <p className="text-[10px] uppercase tracking-wider font-bold text-muted mt-0.5">{t('homeDashboard.bazarr.providers')}</p>
                    </div>
                    <div className="bg-background/60 rounded-xl border border-white/5 p-3">
                        <Activity className="w-4 h-4 text-plex mb-2 opacity-80" />
                        <p className="text-xl font-black text-text">{Number(totals.announcements || 0).toLocaleString()}</p>
                        <p className="text-[10px] uppercase tracking-wider font-bold text-muted mt-0.5">{t('homeDashboard.bazarr.announcements')}</p>
                    </div>
                </div>

                {instances.length > 1 && (
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-1.5">
                        {instances.map((instance: any) => (
                            <div key={instance.id} className="flex items-center justify-between gap-2 rounded-lg bg-background/40 border border-white/5 px-3 py-2">
                                <span className="text-xs font-bold text-text truncate">{instance.name || 'Bazarr'}</span>
                                <span className="text-[10px] font-bold text-muted">
                                    {t('homeDashboard.bazarr.instanceWantedSummary', {
                                        episodes: Number(instance.wantedEpisodes || 0).toLocaleString(),
                                        movies: Number(instance.wantedMovies || 0).toLocaleString(),
                                    })}
                                </span>
                            </div>
                        ))}
                    </div>
                )}

                {primary.error && (
                    <p className="text-xs text-red-300 mt-3">{t('homeDashboard.bazarr.warning', { message: primary.error })}</p>
                )}
            </div>
        );
    };
};

export const createRecentlyAddedWidgetRenderer = (deps: UserDashboardWidgetDeps) => {
    const { t, dashboardData, showQualityBadges, DiscoverPosterCard, publicConfig } = deps;

    return (id: RecentlyAddedWidgetId): React.ReactNode => {
        if (!dashboardData) return null;
        switch (id) {
            case 'recentMovies':
                if (!dashboardData.recentMovies?.length) return null;
                return (
                    <ScrollReveal enabled={!!publicConfig?.useScrollRevealAnimations}>
                        <HomePosterScrollRow title={t('homeDashboard.recentMovies')} t={t}>
                        {dashboardData.recentMovies.map((item: any, idx: number) => (
                            <DiscoverPosterCard
                                key={idx}
                                variant="home"
                                className="snap-start shrink-0 w-32 md:w-40"
                                item={item}
                                showQualityBadges={showQualityBadges}
                                loading={idx < 12 ? 'eager' : 'lazy'}
                                fetchPriority={idx < 4 ? 'high' : 'auto'}
                                footer={(
                                    <div className="flex flex-col px-1">
                                        <p className="text-xs font-bold text-text truncate group-hover:text-plex transition-colors">{item.title}</p>
                                        {item.year && <p className="text-[10px] text-muted font-semibold mt-0.5">{item.year}</p>}
                                    </div>
                                )}
                            />
                        ))}
                    </HomePosterScrollRow>
                    </ScrollReveal>
                );
            case 'recentShows':
                if (!dashboardData.recentShows?.length) return null;
                return (
                    <ScrollReveal enabled={!!publicConfig?.useScrollRevealAnimations}>
                        <HomePosterScrollRow title={t('homeDashboard.recentShows')} t={t}>
                        {dashboardData.recentShows.map((item: any, idx: number) => (
                            <DiscoverPosterCard
                                key={idx}
                                variant="home"
                                className="snap-start shrink-0 w-32 md:w-40"
                                item={item}
                                showQualityBadges={showQualityBadges}
                                loading={idx < 12 ? 'eager' : 'lazy'}
                                fetchPriority={idx < 4 ? 'high' : 'auto'}
                                footer={(
                                    <div className="flex flex-col px-1">
                                        <p className="text-xs font-bold text-text truncate group-hover:text-plex transition-colors">{item.title}</p>
                                        {(item.parentTitle || item.year) ? (
                                            <p className="text-[10px] text-muted font-semibold mt-0.5 truncate">
                                                {item.parentTitle || item.year}
                                            </p>
                                        ) : null}
                                    </div>
                                )}
                            />
                        ))}
                    </HomePosterScrollRow>
                    </ScrollReveal>
                );
            case 'recentMusic':
                if (!dashboardData.recentMusic?.length) return null;
                return (
                    <ScrollReveal enabled={!!publicConfig?.useScrollRevealAnimations}>
                        <HomePosterScrollRow title={t('homeDashboard.recentMusic')} t={t}>
                        {dashboardData.recentMusic.map((item: any, idx: number) => (
                            <DiscoverPosterCard
                                key={idx}
                                variant="home"
                                aspect="square"
                                className="snap-start shrink-0 w-32 md:w-40"
                                item={item}
                                showQualityBadges={showQualityBadges}
                                loading={idx < 12 ? 'eager' : 'lazy'}
                                fetchPriority={idx < 4 ? 'high' : 'auto'}
                                footer={(
                                    <div className="flex flex-col px-1">
                                        <p className="text-xs font-bold text-text truncate group-hover:text-plex transition-colors">{item.title}</p>
                                        {item.parentTitle && <p className="text-[10px] text-muted font-semibold mt-0.5 truncate">{item.parentTitle}</p>}
                                    </div>
                                )}
                            />
                        ))}
                    </HomePosterScrollRow>
                    </ScrollReveal>
                );
            default:
                return null;
        }
    };
};
