import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import { Home, Film, Activity, Sparkles, LogOut, Settings, FileText, BarChart3, Users, PlaySquare, TrendingUp, X, Star, Layers, HardDrive, Calendar, Tv, Clock, DownloadCloud, MonitorSmartphone, Copy, ChevronUp, ChevronDown, List, Palette, Music, Play, Pause, Upload, Shield, CheckCircle, AlertCircle, RefreshCw, ChevronLeft, ChevronRight, Trophy, PlayCircle, Coffee, Compass, PieChart, Clapperboard, AlertTriangle, Check, Cpu, Monitor, LineChart as LucideLineChart, Share2, Search, BookOpen, Loader2, Eye, EyeOff, ClipboardList, ArrowUpCircle, MoreHorizontal, ExternalLink, Info, GitFork, MapPin, Radar, Image as ImageIcon, SlidersHorizontal, LifeBuoy, MessageSquare, User, Mail, AppWindow } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, PieChart as RechartsPieChart, Pie, Cell } from 'recharts';

import { TitleAnalyticsPage } from './dashboard/TitleAnalyticsPage';
import {
    dashboardTitleKeyFromPath,
    dashboardTitlePath,
    readDashboardSearchQuery,
    writeDashboardSearchQuery,
} from './dashboard/dashboardTitlePath';
import { EmailSelectedUsersModal } from './settings/EmailSelectedUsersModal';
import { LibraryMaintenancePanel } from './maintenance/LibraryMaintenancePanel';
import { appConfirm, askConfirm } from './shared/confirm';
import { apiFetch, apiFetchShared } from './shared/api';
import { InAppNotificationsBell } from './shared/InAppNotificationsBell';
import { IN_APP_NOTIFICATIONS_CHANGED_EVENT } from './shared/inAppNotificationsRefresh';
import { getPublicOrigin, logoUrl, portalUrl, resolvePortalAssetUrl, stripBasePath, PLEX_ICON_URL, JELLYFIN_ICON_URL, EMBY_ICON_URL } from './shared/basePath';
import { sizedPlexImageUrl } from './shared/plexImageUrl';
import { LoginBrandMark } from './shared/LoginBrandMark';
import { PlexHomeSwitchModal } from './shared/PlexHomeSwitchModal';
import { formatDate, getDaysUntilExpiry, getAccessProgressPct, addMonths, addYears, formatTime, formatEventName, formatDateTime, hexToRgb, formatSizeCeil, formatStreamingHour, formatPortalDateTime, formatPortalDateTimeCompact } from './shared/format';
import { CustomSelect, ConfirmModal, StyledCheckbox, ScrollReveal } from './shared/ui';
import { PeriodDropdown } from './shared/PeriodDropdown';
import { formatWatchHistoryWhen, WatchHistoryMediaCard } from './shared/WatchHistoryMediaCard';
import { DEFAULT_USER_AVATAR, titleDiscoveryPath } from './profile/helpers';
import { ActivityHeatmap } from './shared/ActivityHeatmap';
import { Loader, Toast, ToastContainer, pushToast } from './shared/toast';
import { usePoll } from './shared/usePoll';
import { usePullToRefresh } from './shared/usePullToRefresh';
import { isActiveDownloadItem } from './shared/downloadStatus';
import { NoPosterPlaceholder } from './shared/NoPosterPlaceholder';
import { RetryablePoster } from './shared/RetryablePoster';
import {
    ActivityGridSkeleton,
    DiscoverPageSkeleton,
    HomeRecentlyAddedSkeleton,
    LibraryStatsSkeleton,
    TopWatchedGridSkeleton,
    TrendingSectionsSkeleton,
    WrapUpCardsSkeleton,
} from './shared/skeletons';
import type { User, PlexConfig, AppSettings, PlexServer, ToastMessage, DeletedUser, AuditEntry, UserStatus, HomeCustomModule } from './shared/types';
import { ShareWrapUpModal } from './shared/ShareWrapUp';
import { WrapUpModal } from './shared/WrapUpModal';
import { WrapUpRecapModal } from './shared/WrapUpRecapModal';
import { WrapUpCardGrid, AchievementsWrapUpSpotlight, periodLabel, formatWrapUpDelta, wrapUpPriorPeriodLabel } from './shared/WrapUpCards';
import { SetupWizard } from './setup/SetupWizard';
import { DiscoveryDashboard } from './discovery/DiscoveryDashboard';
import { AuthPageBackground, themeClasses, SlideshowBackground } from './shared/theme';
import { activityStreamColumnCount, activityStreamGridClass, DEFAULT_POSTER_GRID_SCALE, upgraderPosterGridClass, upgraderPosterGridStyle, type PosterGridValue } from './shared/portalLayout';
import { DiscoverGridSizeSelect } from './discovery/DiscoverGridSizeSelect';
import { useDiscoverGridSize } from './discovery/useDiscoverGridSize';
import { useDiscoverI18n } from './discovery/i18n';
import { AlphaBadge, BetaBadge } from './shared/BetaBadge';
import { DiscoverNowPlayingStrip } from './discovery/DiscoverNowPlayingStrip';
import { useNowPlaying } from './shared/useNowPlaying';
import { filterNavOrder, ensureCompleteNavOrder, resolveMemberNavOrder, MOBILE_NAV_PRIMARY_SLOTS, type NavFeatureFlags } from './shared/nav';
import { customNavTabKey, resolveCustomNavIcon, APPLETS_NAV_KEY, buildDesktopNavOrder, canAccessCustomNavTab } from './shared/customNavTabs';
import { AppletsPalette } from './shared/AppletsPalette';
import { readDesktopNavIconsOnly, writeDesktopNavIconsOnly } from './shared/desktopNavCollapse';
import { applyAppletPaletteOrder, getAppletPaletteAccountKey, readAppletPaletteOrder, sortCustomNavTabsByNavOrder, writeAppletPaletteOrder, type OpenAppletSession } from './shared/openApplets';
import { buildArrPortalEmbedHref } from '../lib/arr-portal-embed.js';
import type { CustomNavTab } from './shared/types';
import { isFirefoxMobileClient, useFirefoxMobileNavShell } from './shared/useFirefoxMobileNavShell';
import { ProfileBadgeRack, AchievementsHomeWidget } from './achievements/AchievementsDashboard';
import { AchievementsAnalyticsLeaderboard } from './achievements/AchievementsAnalyticsLeaderboard';
import { goToProfile } from './profile/helpers';
import {
    STATUS_PERIODS,
    barsForPeriod,
    fleetUptimeForPeriod,
    formatDurationShort,
    formatLatencyMs,
    historyRowsForPeriod,
    incidentsForPeriod,
    latencySeriesForPeriod,
    periodStats,
    statusToneFromPct,
    uptimeForPeriod,
    type StatusPeriod,
} from './shared/statusHealth';
import { StatusSpeedTest } from './shared/StatusSpeedTest';
import {
    DashboardHero,
    DashboardPageShell,
    DashboardPanel,
    DashboardStatCard,
    DashboardSubnav,
    dashboardGlowClass,
    dashboardPanelClass,
    dashboardSubnavLinkClass,
    preferCollapsedOnNarrow,
    usePersistedCollapsed,
} from './shared/dashboard/DashboardChrome';
import { ANALYTICS_PERIOD_OPTIONS, persistAnalyticsDays, readPersistedAnalyticsDays } from './shared/analyticsPeriodOptions';
import { UserDashboardLayout } from './home/UserDashboardLayout';
import { HomeCustomModuleSection } from './home/HomeCustomModuleSection';
import { HomeHeroMovieBackdrop } from './home/HomeHeroMovieBackdrop';
import { HomeHeroPlaybackBackdrop, useNowPlayingHeroArt } from './home/HomeHeroPlaybackBackdrop';
import { BecauseYouWatchedHomeRail } from './home/BecauseYouWatchedHomeRail';
import { userAllowsHomeBecauseYouWatched } from './home/becauseYouWatchedPref.js';
import { createBazarrToolsSectionRenderer, createMainGridWidgetRenderer, createMediaAutomationSectionRenderer, createPendingRequestsSectionRenderer, createRecentlyAddedWidgetRenderer, createScannerSectionRenderer, createSpotifySyncSectionRenderer } from './home/userDashboardWidgetRenderers';
import {
    DEFAULT_DASHBOARD_LAYOUT,
    DASHBOARD_SECTION_LABELS,
    MAIN_GRID_WIDGET_META,
    RECENTLY_ADDED_WIDGET_META,
    normalizeSectionLayout,
    type DashboardLayoutConfig,
    type DashboardSectionId,
    type DashboardWidgetId,
    type DashboardWidgetSize,
    type MainGridWidgetId,
    type RecentlyAddedWidgetId,
    type BuiltInDashboardSectionId,
} from './shared/dashboardLayout';
import { getHomeCustomModuleLabel, isHomeCustomModuleSectionId } from './shared/homeCustomModules';
import { NowPlayingCompanionPanel } from './home/NowPlayingCompanionPanel';

const STATUS_ICON_BASE = 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg';
const SIMPLE_STATUS_ICON_BASE = 'https://cdn.simpleicons.org';
const STATUS_SERVICE_ICONS: Record<string, string> = {
    plex: `${STATUS_ICON_BASE}/plex.svg`,
    jellyfin: `${STATUS_ICON_BASE}/jellyfin.svg`,
    emby: `${STATUS_ICON_BASE}/emby.svg`,
    tautulli: `${STATUS_ICON_BASE}/tautulli.svg`,
    jellystat: 'https://cdn.jsdelivr.net/gh/selfhst/icons@main/png/jellystat.png',
    sonarr: `${STATUS_ICON_BASE}/sonarr.svg`,
    radarr: `${STATUS_ICON_BASE}/radarr.svg`,
    lidarr: `${STATUS_ICON_BASE}/lidarr.svg`,
    bazarr: `${STATUS_ICON_BASE}/bazarr.svg`,
    qbittorrent: `${STATUS_ICON_BASE}/qbittorrent.svg`,
    rdtclient: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/rdt-client.svg',
    transmission: `${STATUS_ICON_BASE}/transmission.svg`,
    bittorrent: `${SIMPLE_STATUS_ICON_BASE}/bittorrent`,
    deluge: `${STATUS_ICON_BASE}/deluge.svg`,
    sabnzbd: `${STATUS_ICON_BASE}/sabnzbd.svg`,
    nzbget: `${STATUS_ICON_BASE}/nzbget.svg`,
    seerr: `${STATUS_ICON_BASE}/seerr.svg`,
    overseerr: `${STATUS_ICON_BASE}/seerr.svg`,
    jellyseerr: `${STATUS_ICON_BASE}/jellyseerr.svg`,
    ombi: `${STATUS_ICON_BASE}/ombi.svg`,
};

const NOW_PLAYING_COMPANION_PREF_KEY = 'portal.home.nowPlayingCompanion.v1';
const REFERRAL_REF_STORAGE_KEY = 'smp.referral.ref';
const REFERRAL_REF_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const readStoredReferralRef = (): string => {
    try {
        const raw = String(sessionStorage.getItem(REFERRAL_REF_STORAGE_KEY) || '').trim();
        if (!raw) return '';
        if (raw.startsWith('{')) {
            const parsed = JSON.parse(raw);
            const ref = String(parsed?.ref || '').trim();
            const savedAt = Number(parsed?.savedAt) || 0;
            if (!ref || !savedAt || (Date.now() - savedAt) > REFERRAL_REF_MAX_AGE_MS) {
                sessionStorage.removeItem(REFERRAL_REF_STORAGE_KEY);
                return '';
            }
            return ref;
        }
        return raw;
    } catch {
        return '';
    }
};

const writeStoredReferralRef = (ref: string) => {
    const value = String(ref || '').trim();
    if (!value) return;
    try {
        sessionStorage.setItem(REFERRAL_REF_STORAGE_KEY, JSON.stringify({ ref: value, savedAt: Date.now() }));
    } catch { /* ignore */ }
};

const clearStoredReferralRef = () => {
    try { sessionStorage.removeItem(REFERRAL_REF_STORAGE_KEY); } catch { /* ignore */ }
};
const readNowPlayingCompanionEnabled = (subjectId: string): boolean => {
    try {
        const raw = localStorage.getItem(NOW_PLAYING_COMPANION_PREF_KEY);
        if (!raw) return true;
        const parsed = JSON.parse(raw);
        const key = String(subjectId || '');
        if (!parsed || typeof parsed !== 'object' || !key) return true;
        if (!(key in parsed)) return true;
        return parsed[key] !== false;
    } catch {
        return true;
    }
};

const writeNowPlayingCompanionEnabled = (subjectId: string, enabled: boolean): void => {
    try {
        const key = String(subjectId || '');
        if (!key) return;
        const raw = localStorage.getItem(NOW_PLAYING_COMPANION_PREF_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        const next = parsed && typeof parsed === 'object' ? parsed : {};
        next[key] = !!enabled;
        localStorage.setItem(NOW_PLAYING_COMPANION_PREF_KEY, JSON.stringify(next));
    } catch {
        // Ignore persistence failures.
    }
};

const getStatusServiceIconKey = (service: any) => {
    if (service?.clientType) return String(service.clientType).toLowerCase();
    const id = String(service?.id || '').toLowerCase();
    const name = String(service?.name || '').toLowerCase();
    for (const key of Object.keys(STATUS_SERVICE_ICONS)) {
        if (id.includes(key) || name.includes(key)) return key;
    }
    return '';
};

const StatusServiceIcon: React.FC<{ service: any }> = ({ service }) => {
    const key = getStatusServiceIconKey(service);
    const iconUrl = key ? STATUS_SERVICE_ICONS[key] : '';
    return (
        <span className="inline-flex w-10 h-10 rounded-lg bg-white/5 border border-white/10 items-center justify-center overflow-hidden flex-shrink-0">
            {iconUrl ? (
                <img src={iconUrl} alt="" className="w-6 h-6 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            ) : (
                <Activity className="w-5 h-5 text-plex" />
            )}
        </span>
    );
};

const jellyfinQuickConnectUrl = (baseUrl: string) => {
    const base = String(baseUrl || '').replace(/\/+$/, '');
    return base ? `${base}/web/#/quickconnect` : '';
};

const copyTextToClipboard = async (value: string) => {
    if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
};

declare global {
    interface Window {
        __USE_24_HOUR_CLOCK__?: boolean;
    }
}

type BeforeInstallPromptEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};


export const updateFavicon = (thumbUrl: string | null | undefined) => {
    let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
    if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        link.type = 'image/png';
        document.head.appendChild(link);
    }
    let appleLink = document.querySelector("link[rel='apple-touch-icon']") as HTMLLinkElement;
    if (!appleLink) {
        appleLink = document.createElement('link');
        appleLink.rel = 'apple-touch-icon';
        appleLink.setAttribute('sizes', '180x180');
        document.head.appendChild(appleLink);
    }
    // Always use the circular branding-icon — raw custom logos are square PNGs
    // (the hero/nav clip them with CSS; favicons cannot).
    const version = encodeURIComponent(String(thumbUrl || 'default').slice(-64));
    const href = portalUrl(`/api/public/branding-icon?v=${version}&round=1`);
    link.href = href;
    appleLink.href = href;
};

// --- Components ---

const SettingsIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
        <path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.44,0.17-0.48,0.41L9.22,5.72C8.63,5.96,8.1,6.29,7.6,6.67L5.21,5.71C4.99,5.62,4.74,5.7,4.62,5.92L2.7,9.24 c-0.11,0.2-0.06,0.47,0.12,0.61L4.85,11c-0.04,0.3-0.06,0.61-0.06,0.94c0,0.32,0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.38,2.91 c0.04,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44,0.17,0.48,0.41l0.38-2.91c0.59-0.24,1.12-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z" />
    </svg>
);

const UserCard: React.FC<{
    user: User;
    onEdit: () => void;
    onDelete: () => void;
    onRevoke: () => void;
    onViewAs?: () => void;
    onViewAnalytics?: () => void;
    onViewProfile?: () => void;
    isConfigured: boolean;
    isSelected: boolean;
    onSelect: (id: string) => void;
    onEmail?: () => void;
    onResendInvite?: () => void;
    onCopied?: (message: string) => void;
    providerLabel?: string;
}> = ({ user, onEdit, onDelete, onRevoke, onViewAs, onViewAnalytics, onViewProfile, isConfigured, isSelected, onSelect, onEmail, onResendInvite, onCopied, providerLabel = 'Plex' }) => {
    const { t } = useDiscoverI18n();
    const isPlexRevoked = user.plexAccessStatus === 'revoked' && !(user.isServerOwner || user.isAdmin);
    const plexAccessStatus = (user.isServerOwner || user.isAdmin)
        ? 'active'
        : (user.plexAccessStatus || 'unknown');

    const { status, statusText, statusHint, daysRemainingText, pillClass, borderClass, glowClass } = useMemo(() => {
        const days = getDaysUntilExpiry(user.expiryDate);
        let status: UserStatus | 'revoked' = 'active';
        let statusText = t('usersAdmin.status.active');
        let statusHint = t('usersAdmin.statusHints.active');
        let daysRemainingText = '';
        let pillClass = 'bg-green-500/10 text-green-400 border border-green-500/20';
        let borderClass = 'border-green-500/30';
        let glowClass = 'hover:border-green-500/50 hover:shadow-[0_0_15px_rgba(34,197,94,0.12)]';

        if (days === null) {
            status = 'active';
            statusText = t('usersAdmin.status.active');
            daysRemainingText = t('usersAdmin.card.neverExpires');
        } else if (days < 0) {
            status = 'expired';
            statusText = t('usersAdmin.status.expired');
            statusHint = t('usersAdmin.statusHints.expired');
            daysRemainingText = t('usersAdmin.card.expiredDaysAgo', { count: Math.abs(days) });
            pillClass = 'bg-red-500/10 text-red-400 border border-red-500/20';
            borderClass = 'border-red-500/30';
            glowClass = 'hover:border-red-500/50 hover:shadow-[0_0_15px_rgba(239,68,68,0.12)]';
        } else if (days <= 30) {
            status = 'expiring';
            statusText = t('usersAdmin.status.expiring');
            statusHint = t('usersAdmin.statusHints.expiring');
            daysRemainingText = days === 0 ? t('usersAdmin.card.expiresToday') : t('usersAdmin.card.expiresInDays', { count: days });
            pillClass = 'bg-orange-500/10 text-orange-400 border border-orange-500/20';
            borderClass = 'border-orange-500/30';
            glowClass = 'hover:border-orange-500/50 hover:shadow-[0_0_15px_rgba(249,115,22,0.12)]';
        } else {
            daysRemainingText = t('usersAdmin.card.expiresInDays', { count: days });
        }

        if (isPlexRevoked) {
            status = 'revoked';
            statusText = t('usersAdmin.status.revoked');
            statusHint = t('usersAdmin.statusHints.revoked');
            pillClass = 'bg-zinc-500/15 text-zinc-300 border border-zinc-500/25';
            borderClass = 'border-zinc-500/40';
            glowClass = 'hover:border-zinc-400/50 hover:shadow-[0_0_15px_rgba(161,161,170,0.12)]';
        }

        return { status, statusText, statusHint, daysRemainingText, pillClass, borderClass, glowClass };
    }, [user.expiryDate, isPlexRevoked, t]);

    const handleCardClick = () => {
        onSelect(user.id);
    }

    return (
        <div className={`relative overflow-hidden rounded-2xl border border-white/10 bg-black/25 p-5 shadow-lg border-l-4 ${borderClass} ${glowClass} hover:-translate-y-0.5 transition-all duration-300 flex flex-col cursor-pointer ${isSelected ? 'border-plex/40 shadow-lg shadow-plex/10 bg-black/35' : ''}`} onClick={handleCardClick}>
            <div className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full blur-2xl bg-plex/10" />
            <div className="relative flex justify-between items-start mb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                    <input className="w-4 h-4 flex-shrink-0 appearance-none rounded-full border border-muted checked:bg-plex checked:border-plex transition-colors cursor-pointer relative checked:after:content-[''] checked:after:block checked:after:w-1.5 checked:after:h-1.5 checked:after:bg-background checked:after:rounded-full checked:after:absolute checked:after:top-1/2 checked:after:left-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2"
                        type="checkbox"
                        checked={isSelected}
                        readOnly
                        style={{ borderRadius: '50%' }}
                    />
                    {user.thumb ? (
                        <img src={resolvePortalAssetUrl(user.thumb)} alt={user.username} className="w-8 h-8 rounded-full object-cover border border-border flex-shrink-0" />
                    ) : (
                        <div className="w-8 h-8 rounded-full bg-border flex items-center justify-center text-text font-bold text-xs uppercase flex-shrink-0">
                            {user.username.substring(0, 2)}
                        </div>
                    )}
                    <div className="flex flex-col min-w-0 pr-1">
                        <div className="flex items-center gap-1 min-w-0">
                            <h3 className="text-sm font-bold truncate leading-tight" title={user.username}>{user.username}</h3>
                            {onCopied && (
                                <button
                                    type="button"
                                    className="text-muted hover:text-plex p-0.5 shrink-0"
                                    title={t('usersAdmin.actions.copyUsername')}
                                    onClick={async (e) => {
                                        e.stopPropagation();
                                        try {
                                            await copyTextToClipboard(user.username);
                                            onCopied(t('usersAdmin.actions.copiedUsername'));
                                        } catch {
                                            onCopied(t('usersAdmin.actions.copyFailed'));
                                        }
                                    }}
                                >
                                    <Copy className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                        {user.email && (
                            <div className="flex items-center gap-1 min-w-0 mt-0.5">
                                <span className="text-[10px] text-muted truncate" title={user.email}>{user.email}</span>
                                {onCopied && (
                                    <button
                                        type="button"
                                        className="text-muted hover:text-plex p-0.5 shrink-0"
                                        title={t('usersAdmin.actions.copyEmail')}
                                        onClick={async (e) => {
                                            e.stopPropagation();
                                            try {
                                                await copyTextToClipboard(user.email || '');
                                                onCopied(t('usersAdmin.actions.copiedEmail'));
                                            } catch {
                                                onCopied(t('usersAdmin.actions.copyFailed'));
                                            }
                                        }}
                                    >
                                        <Copy className="w-3 h-3" />
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
                <span
                    className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider whitespace-nowrap ${pillClass}`}
                    title={statusHint}
                >{statusText}</span>
            </div>
            <div className="relative flex flex-col gap-2 mt-3 flex-grow">
                <div className="flex justify-between items-center text-xs pb-1.5 border-b border-white/5 last:border-0 last:pb-0">
                    <span className="text-muted text-[10px] uppercase tracking-wider font-bold">{t('usersAdmin.card.joined')}</span>
                    <span className="text-text font-medium">{formatDate(user.joiningDate)}</span>
                </div>
                <div className="flex justify-between items-start text-xs pb-1.5 border-b border-white/5 last:border-0 last:pb-0 gap-2">
                    <span className="text-muted text-[10px] uppercase tracking-wider font-bold flex-shrink-0 pt-0.5">{t('usersAdmin.card.expires')}</span>
                    <span className="text-text font-medium flex flex-col items-end text-right">
                        <span className="whitespace-nowrap font-bold">{formatDate(user.expiryDate)}</span> 
                        <span className="text-[9px] text-muted mt-0.5">{daysRemainingText}</span>
                    </span>
                </div>
                <div className="flex justify-between items-center text-xs pb-1.5 border-b border-white/5 last:border-0 last:pb-0">
                    <span className="text-muted text-[10px] uppercase tracking-wider font-bold">{t('usersAdmin.card.share', { provider: providerLabel })}</span>
                    <span className="info-value plex-status flex items-center gap-1.5" title={t(`usersAdmin.accessHints.${plexAccessStatus}` as any)}>
                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                            plexAccessStatus === 'active' ? 'bg-emerald-400' :
                            plexAccessStatus === 'pending' ? 'bg-amber-400' :
                            plexAccessStatus === 'revoked' ? 'bg-zinc-400' : 'bg-muted'
                        }`} />
                        <span className="text-text font-medium text-xs">{t(`usersAdmin.access.${plexAccessStatus}` as any)}</span>
                    </span>
                </div>
                <div className="flex justify-between items-center text-xs pb-1.5 border-b border-white/5 last:border-0 last:pb-0">
                    <span className="text-muted text-[10px] uppercase tracking-wider font-bold">{t('usersAdmin.card.lastLogin')}</span>
                    <span className="text-text font-medium">{user.lastLogin ? formatDate(user.lastLogin) : t('usersAdmin.card.never')}</span>
                </div>
            </div>
            <div className="relative flex flex-wrap gap-2 mt-auto pt-4" onClick={e => e.stopPropagation()}>
                {onViewProfile && (
                    <button
                        className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:bg-white/5 flex items-center justify-center gap-1.5"
                        onClick={onViewProfile}
                        title={t('usersAdmin.actions.viewProfile')}
                    >
                        <User className="w-3.5 h-3.5" />
                        {t('usersAdmin.actions.viewProfile')}
                    </button>
                )}
                {onViewAnalytics && (
                    <button
                        className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:bg-white/5 flex items-center justify-center gap-1.5"
                        onClick={onViewAnalytics}
                        title={t('usersAdmin.actions.openAnalytics')}
                    >
                        <BarChart3 className="w-3.5 h-3.5" />
                        {t('navigation.analytics')}
                    </button>
                )}
                {onViewAs && (
                    <button className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:bg-white/5 flex items-center justify-center gap-1.5" onClick={onViewAs} title={t('usersAdmin.actions.viewAsTitle')}>
                        <Eye className="w-3.5 h-3.5" />
                        {t('usersAdmin.actions.viewAs')}
                    </button>
                )}
                {onEmail && (
                    <button
                        className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:bg-white/5 flex items-center justify-center gap-1.5"
                        onClick={onEmail}
                        title={t('usersAdmin.actions.emailUser')}
                    >
                        <Mail className="w-3.5 h-3.5" />
                        {t('usersAdmin.actions.emailUser')}
                    </button>
                )}
                {onResendInvite && (
                    <button
                        className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:bg-white/5 flex items-center justify-center gap-1.5"
                        onClick={onResendInvite}
                        title={t('usersAdmin.actions.resendInvite')}
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                        {t('usersAdmin.actions.resendInvite')}
                    </button>
                )}
                <button className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:bg-white/5 flex items-center justify-center gap-1.5" onClick={onEdit}>{isPlexRevoked ? t('usersAdmin.actions.restoreAccess') : t('usersAdmin.actions.edit')}</button>
                <button className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:bg-white/5 flex items-center justify-center gap-1.5" onClick={onDelete}>{t('common.delete')}</button>
                {status === 'expired' && !isPlexRevoked && (
                    <button className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:bg-white/5 flex items-center justify-center gap-1.5" onClick={onRevoke} disabled={!isConfigured}>{t('usersAdmin.actions.revoke')}</button>
                )}
            </div>
        </div>
    );
};

const UserModal: React.FC<{ isOpen: boolean; onClose: () => void; onSave: (user: User) => void; user: User | null }> = ({ isOpen, onClose, onSave, user }) => {
    const { t } = useDiscoverI18n();
    const [username, setUsername] = useState('');
    const [joiningDate, setJoiningDate] = useState(formatDate(new Date().toISOString()));
    const [expiryDate, setExpiryDate] = useState<string | null>(formatDate(addMonths(new Date(), 1).toISOString()));
    const [exemptFromCleanup, setExemptFromCleanup] = useState(false);
    const [optOutNewsletter, setOptOutNewsletter] = useState(false);
    const [libraries, setLibraries] = useState<Array<{ id: string; title: string; type?: string }>>([]);
    const [selectedLibraries, setSelectedLibraries] = useState<string[]>([]);
    const [librariesLoading, setLibrariesLoading] = useState(false);
    const [libraryShareSource, setLibraryShareSource] = useState<string | null>(null);
    const [overrideMovieQuota, setOverrideMovieQuota] = useState(false);
    const [movieQuotaLimit, setMovieQuotaLimit] = useState(0);
    const [movieQuotaDays, setMovieQuotaDays] = useState(7);
    const [overrideTvQuota, setOverrideTvQuota] = useState(false);
    const [tvQuotaLimit, setTvQuotaLimit] = useState(0);
    const [tvQuotaDays, setTvQuotaDays] = useState(7);
    const [allowRequestMovies, setAllowRequestMovies] = useState<'default' | 'on' | 'off'>('default');
    const [allowRequestTv, setAllowRequestTv] = useState<'default' | 'on' | 'off'>('default');
    const [allowRequest4kMovies, setAllowRequest4kMovies] = useState<'default' | 'on' | 'off'>('default');
    const [allowRequest4kTv, setAllowRequest4kTv] = useState<'default' | 'on' | 'off'>('default');
    const [allowAdvancedRequests, setAllowAdvancedRequests] = useState<'default' | 'on' | 'off'>('default');
    const initialLibraryPayloadRef = useRef<string[] | null>(null);
    const [librariesTouched, setLibrariesTouched] = useState(false);
    const [resetOnboardingMessage, setResetOnboardingMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const libraryIdsPayloadFromSelection = useCallback((
        selected: string[],
        allLibraryIds: string[],
    ): string[] => {
        const allSelected =
            allLibraryIds.length > 0 &&
            selected.length >= allLibraryIds.length &&
            allLibraryIds.every((id) => selected.includes(id));
        return allSelected || selected.length === 0 ? [] : selected;
    }, []);

    const triFrom = (value: boolean | null | undefined): 'default' | 'on' | 'off' => {
        if (value === true) return 'on';
        if (value === false) return 'off';
        return 'default';
    };
    const triTo = (value: 'default' | 'on' | 'off'): boolean | null => {
        if (value === 'on') return true;
        if (value === 'off') return false;
        return null;
    };

    useEffect(() => {
        if (user) {
            setUsername(user.username);
            setJoiningDate(formatDate(user.joiningDate));
            setExpiryDate(user.expiryDate ? formatDate(user.expiryDate) : null);
            setExemptFromCleanup(!!user.exemptFromCleanup);
            setOptOutNewsletter(!!user.optOutNewsletter);
            setSelectedLibraries(Array.isArray(user.libraryIds) ? user.libraryIds.map(String) : []);
            setLibraryShareSource(null);
            initialLibraryPayloadRef.current = null;
            setLibrariesTouched(false);
            setResetOnboardingMessage(null);
            const ov = user.requestOverrides || {};
            setOverrideMovieQuota(ov.movieQuotaLimit != null);
            setMovieQuotaLimit(Number(ov.movieQuotaLimit) || 0);
            setMovieQuotaDays(Number(ov.movieQuotaDays) || 7);
            setOverrideTvQuota(ov.tvQuotaLimit != null);
            setTvQuotaLimit(Number(ov.tvQuotaLimit) || 0);
            setTvQuotaDays(Number(ov.tvQuotaDays) || 7);
            setAllowRequestMovies(triFrom(ov.allowRequestMovies));
            setAllowRequestTv(triFrom(ov.allowRequestTv));
            setAllowRequest4kMovies(triFrom(ov.allowRequest4kMovies));
            setAllowRequest4kTv(triFrom(ov.allowRequest4kTv));
            setAllowAdvancedRequests(triFrom(ov.allowAdvancedRequests));
        } else {
            setUsername('');
            setJoiningDate(formatDate(new Date().toISOString()));
            setExpiryDate(formatDate(addMonths(new Date(), 1).toISOString()));
            setExemptFromCleanup(false);
            setOptOutNewsletter(false);
            setSelectedLibraries([]);
            setOverrideMovieQuota(false);
            setMovieQuotaLimit(0);
            setMovieQuotaDays(7);
            setOverrideTvQuota(false);
            setTvQuotaLimit(0);
            setTvQuotaDays(7);
            setAllowRequestMovies('default');
            setAllowRequestTv('default');
            setAllowRequest4kMovies('default');
            setAllowRequest4kTv('default');
            setAllowAdvancedRequests('default');
        }
    }, [user, isOpen]);

    useEffect(() => {
        if (!isOpen || !user?.id) return;
        let cancelled = false;
        setLibrariesLoading(true);
        Promise.all([
            apiFetch('/api/plex/libraries').catch(() => []),
            apiFetch(`/api/users/${user.id}/share-libraries`).catch(() => null),
        ])
            .then(([libs, share]) => {
                if (cancelled) return;
                const list = Array.isArray(libs) ? libs : (Array.isArray(libs?.libraries) ? libs.libraries : []);
                const mapped = list.map((l: any) => ({ id: String(l.id), title: l.title || `Library ${l.id}`, type: l.type }));
                const allIds = mapped.map((l) => l.id);
                setLibraries(mapped);
                setLibraryShareSource(share?.source || null);

                let nextSelected: string[] = [];
                if (share?.hasShare === false || share?.source === 'no-share') {
                    nextSelected = [];
                } else if (share?.source === 'plex-all' || (share?.hasShare && share?.selectedIds == null)) {
                    nextSelected = allIds;
                } else if (share && Array.isArray(share.selectedIds)) {
                    const liveIds = share.selectedIds.map(String);
                    const matched = liveIds.filter((id: string) => allIds.includes(id));
                    nextSelected = matched.length ? matched : liveIds;
                } else if (Array.isArray(user.libraryIds) && user.libraryIds.length > 0) {
                    nextSelected = user.libraryIds.map(String);
                }
                setSelectedLibraries(nextSelected);
                initialLibraryPayloadRef.current = libraryIdsPayloadFromSelection(nextSelected, allIds);
                setLibrariesTouched(false);
            })
            .finally(() => {
                if (!cancelled) setLibrariesLoading(false);
            });
        return () => { cancelled = true; };
    }, [isOpen, user?.id, user?.libraryIds, libraryIdsPayloadFromSelection]);

    if (!isOpen) return null;

    const handleSave = () => {
        if (!user) return;
        const requestOverrides: User['requestOverrides'] = {
            movieQuotaLimit: overrideMovieQuota ? movieQuotaLimit : null,
            movieQuotaDays: overrideMovieQuota ? movieQuotaDays : null,
            tvQuotaLimit: overrideTvQuota ? tvQuotaLimit : null,
            tvQuotaDays: overrideTvQuota ? tvQuotaDays : null,
            fourKQuotaLimit: null,
            fourKQuotaDays: null,
            allowRequestMovies: triTo(allowRequestMovies),
            allowRequestTv: triTo(allowRequestTv),
            allowRequest4kMovies: triTo(allowRequest4kMovies),
            allowRequest4kTv: triTo(allowRequest4kTv),
            allowAdvancedRequests: triTo(allowAdvancedRequests),
        };
        const allLibraryIds = libraries.map((l) => l.id);
        const libraryIdsToSave = libraryIdsPayloadFromSelection(selectedLibraries, allLibraryIds);
        const initialPayload = initialLibraryPayloadRef.current;
        const librariesChanged = librariesTouched || (
            initialPayload == null
                ? libraryIdsToSave.length > 0
                : JSON.stringify([...libraryIdsToSave].sort()) !== JSON.stringify([...initialPayload].sort())
        );
        const updatedUser: User = {
            ...user,
            expiryDate,
            exemptFromCleanup,
            optOutNewsletter,
            requestOverrides,
        };
        if (librariesChanged) {
            updatedUser.libraryIds = libraryIdsToSave;
        }
        onSave(updatedUser);
    };

    const handleQuickAction = (action: 'addMonth' | 'addYear' | 'unlimited') => {
        const baseDate = expiryDate ? new Date(expiryDate) : new Date();
        // Adjust for timezone when creating date from YYYY-MM-DD input
        if (expiryDate) baseDate.setMinutes(baseDate.getMinutes() + baseDate.getTimezoneOffset());

        switch (action) {
            case 'addMonth': setExpiryDate(formatDate(addMonths(baseDate, 1).toISOString())); break;
            case 'addYear': setExpiryDate(formatDate(addYears(baseDate, 1).toISOString())); break;
            case 'unlimited': setExpiryDate(null); break;
        }
    };

    const permSelect = (
        label: string,
        value: 'default' | 'on' | 'off',
        onChange: (v: 'default' | 'on' | 'off') => void,
    ) => (
        <div>
            <label className="text-xs font-semibold text-muted mb-1 block">{label}</label>
            <CustomSelect
                value={value}
                onChange={(val) => onChange((val as 'default' | 'on' | 'off') || 'default')}
                options={[
                    { value: 'default', label: t('usersAdmin.modal.useGlobalDefault') },
                    { value: 'on', label: t('usersAdmin.modal.allow') },
                    { value: 'off', label: t('usersAdmin.modal.deny') },
                ]}
            />
        </div>
    );

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex justify-center items-center z-[1000] p-3 sm:p-6" onClick={onClose}>
            <div className="bg-card p-4 md:p-6 lg:p-8 rounded-2xl w-full max-w-lg md:max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl border border-border" onClick={(e) => e.stopPropagation()}>
                <h2 className="text-2xl font-bold text-text mb-4">{t('usersAdmin.modal.editUser')}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label>{t('usersAdmin.modal.plexUsername')}</label>
                        <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" type="text" value={username} disabled />
                    </div>
                    <div>
                        <label>{t('usersAdmin.modal.joiningDate')}</label>
                        <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" type="date" value={joiningDate} disabled />
                    </div>
                </div>
                <div className="mb-4">
                    <label htmlFor="expiryDate">{t('usersAdmin.modal.expiryDate')}</label>
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
                        <input className="w-full appearance-none p-3 rounded-lg border border-border bg-background text-[16px] leading-5 text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all" id="expiryDate" type="date" value={expiryDate ?? ''} onChange={(e) => setExpiryDate(e.target.value)} />
                        <div className="grid grid-cols-3 gap-2 md:w-[240px]">
                            <button type="button" className="w-full h-11 px-3 bg-border text-text rounded-md font-medium hover:bg-opacity-80 transition-colors flex items-center justify-center text-sm whitespace-nowrap" onClick={() => handleQuickAction('addMonth')}>{t('usersAdmin.actions.addMonthShort')}</button>
                            <button type="button" className="w-full h-11 px-3 bg-border text-text rounded-md font-medium hover:bg-opacity-80 transition-colors flex items-center justify-center text-sm whitespace-nowrap" onClick={() => handleQuickAction('addYear')}>{t('usersAdmin.actions.addYearShort')}</button>
                            <button type="button" className="w-full h-11 px-3 bg-border text-text rounded-md font-medium hover:bg-opacity-80 transition-colors flex items-center justify-center text-sm whitespace-nowrap" onClick={() => handleQuickAction('unlimited')}>{t('usersAdmin.modal.unlimited')}</button>
                        </div>
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                    <div className="flex items-center justify-between bg-black/10 p-4 rounded-lg border border-border gap-3">
                        <div className="min-w-0">
                            <label className="font-bold block mb-1">{t('usersAdmin.modal.exemptCleanup')}</label>
                            <span className="text-xs text-muted block">{t('usersAdmin.modal.exemptCleanupHint')}</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => setExemptFromCleanup(!exemptFromCleanup)}
                            className={`relative inline-flex items-center h-6 rounded-full w-11 shrink-0 transition-colors ${exemptFromCleanup ? 'bg-plex' : 'bg-border'}`}
                        >
                            <span className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform ${exemptFromCleanup ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>
                    <div className="flex items-center justify-between bg-black/10 p-4 rounded-lg border border-border gap-3">
                        <div className="min-w-0">
                            <label className="font-bold block mb-1">{t('usersAdmin.modal.disableNewsletter')}</label>
                            <span className="text-xs text-muted block">{t('usersAdmin.modal.disableNewsletterHint')}</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => setOptOutNewsletter(!optOutNewsletter)}
                            className={`relative inline-flex items-center h-6 rounded-full w-11 shrink-0 transition-colors ${optOutNewsletter ? 'bg-plex' : 'bg-border'}`}
                        >
                            <span className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform ${optOutNewsletter ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>
                </div>
                {user?.id && (
                    <div className="mb-4 flex items-center justify-between bg-black/10 p-4 rounded-lg border border-border gap-3">
                        <div className="min-w-0">
                            <label className="font-bold block mb-1">{t('usersAdmin.modal.resetOnboarding')}</label>
                            <span className="text-xs text-muted block">{t('usersAdmin.modal.resetOnboardingHint')}</span>
                            {resetOnboardingMessage && (
                                <span className={`text-xs block mt-1 ${resetOnboardingMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {resetOnboardingMessage.text}
                                </span>
                            )}
                        </div>
                        <button
                            type="button"
                            className="shrink-0 px-3 py-2 rounded-lg border border-border text-sm font-medium hover:border-plex transition-colors"
                            onClick={() => {
                                appConfirm(t('usersAdmin.modal.resetOnboardingConfirm', { name: user.username }), async () => {
                                    try {
                                        await apiFetch(`/api/users/${encodeURIComponent(user.id)}/reset-onboarding`, { method: 'POST' });
                                        setResetOnboardingMessage({ type: 'success', text: t('usersAdmin.modal.resetOnboardingSuccess') });
                                    } catch (e: any) {
                                        setResetOnboardingMessage({ type: 'error', text: e.message || t('usersAdmin.modal.resetOnboardingFailed') });
                                    }
                                });
                            }}
                        >
                            {t('usersAdmin.modal.resetOnboarding')}
                        </button>
                    </div>
                )}

                <div className="mb-4 pt-4 border-t border-border">
                    <h3 className="text-lg font-bold text-text mb-1">{t('usersAdmin.modal.libraryAccess')}</h3>
                    <p className="text-xs text-muted mb-3">
                        {t('usersAdmin.modal.libraryAccessHint')}
                    </p>
                    {libraryShareSource === 'no-share' ? (
                        <p className="mb-3 text-xs text-amber-300">
                            {t('usersAdmin.modal.noPlexShare')}
                        </p>
                    ) : libraryShareSource === 'plex-all' ? (
                        <p className="mb-3 text-xs text-muted">{t('usersAdmin.modal.allLibrariesShared')}</p>
                    ) : libraryShareSource === 'plex' ? (
                        <p className="mb-3 text-xs text-muted">{t('usersAdmin.modal.liveSharingLoaded')}</p>
                    ) : null}
                    {librariesLoading ? (
                        <div className="text-sm text-muted py-2">{t('usersAdmin.modal.loadingLibraries')}</div>
                    ) : libraries.length === 0 ? (
                        <div className="text-sm text-muted py-2">{t('usersAdmin.modal.noLibraries')}</div>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            {libraries.map((lib) => (
                                <label key={lib.id} className="flex items-center gap-2 bg-background border border-border px-3 py-2 rounded-lg cursor-pointer hover:border-plex transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={selectedLibraries.includes(lib.id)}
                                        onChange={(e) => {
                                            setLibrariesTouched(true);
                                            if (e.target.checked) setSelectedLibraries([...selectedLibraries, lib.id]);
                                            else setSelectedLibraries(selectedLibraries.filter((id) => id !== lib.id));
                                        }}
                                        className="accent-plex"
                                    />
                                    <span className="text-sm font-medium">{lib.title}</span>
                                </label>
                            ))}
                        </div>
                    )}
                </div>

                <div className="mt-2 pt-4 border-t border-border">
                    <h3 className="text-lg font-bold text-text mb-1">{t('navigation.requests')}</h3>
                    <p className="text-xs text-muted mb-4">{t('usersAdmin.modal.requestDefaultsHint')}</p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                        <div className="p-3 rounded-lg border border-border bg-black/10 space-y-2">
                            <label className="inline-flex items-center gap-2 text-sm font-semibold">
                                <input type="checkbox" checked={overrideMovieQuota} onChange={(e) => setOverrideMovieQuota(e.target.checked)} />
                                {t('usersAdmin.modal.overrideMovieQuota')}
                            </label>
                            {overrideMovieQuota && (
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-xs text-muted">{t('usersAdmin.modal.limitUnlimited')}</label>
                                        <input type="number" min={0} className="w-full appearance-none p-2 rounded-lg border border-border bg-background text-[16px] leading-5" value={movieQuotaLimit} onChange={(e) => setMovieQuotaLimit(Math.max(0, Number(e.target.value) || 0))} />
                                    </div>
                                    <div>
                                        <label className="text-xs text-muted">{t('usersAdmin.modal.days')}</label>
                                        <input type="number" min={1} className="w-full appearance-none p-2 rounded-lg border border-border bg-background text-[16px] leading-5" value={movieQuotaDays} onChange={(e) => setMovieQuotaDays(Math.max(1, Number(e.target.value) || 7))} />
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="p-3 rounded-lg border border-border bg-black/10 space-y-2">
                            <label className="inline-flex items-center gap-2 text-sm font-semibold">
                                <input type="checkbox" checked={overrideTvQuota} onChange={(e) => setOverrideTvQuota(e.target.checked)} />
                                {t('usersAdmin.modal.overrideSeriesQuota')}
                            </label>
                            {overrideTvQuota && (
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-xs text-muted">{t('usersAdmin.modal.limitUnlimited')}</label>
                                        <input type="number" min={0} className="w-full appearance-none p-2 rounded-lg border border-border bg-background text-[16px] leading-5" value={tvQuotaLimit} onChange={(e) => setTvQuotaLimit(Math.max(0, Number(e.target.value) || 0))} />
                                    </div>
                                    <div>
                                        <label className="text-xs text-muted">{t('usersAdmin.modal.days')}</label>
                                        <input type="number" min={1} className="w-full appearance-none p-2 rounded-lg border border-border bg-background text-[16px] leading-5" value={tvQuotaDays} onChange={(e) => setTvQuotaDays(Math.max(1, Number(e.target.value) || 7))} />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {permSelect(t('usersAdmin.modal.requestMovies'), allowRequestMovies, setAllowRequestMovies)}
                        {permSelect(t('usersAdmin.modal.requestSeries'), allowRequestTv, setAllowRequestTv)}
                        {permSelect(t('usersAdmin.modal.request4kMovies'), allowRequest4kMovies, setAllowRequest4kMovies)}
                        {permSelect(t('usersAdmin.modal.request4kSeries'), allowRequest4kTv, setAllowRequest4kTv)}
                        {permSelect(t('usersAdmin.modal.allowAdvanced'), allowAdvancedRequests, setAllowAdvancedRequests)}
                    </div>
                </div>

                <div className="flex justify-end gap-4 mt-6 pt-4 border-t border-border">
                    <button type="button" className="px-6 py-3 bg-plex text-background rounded-md font-bold hover:bg-plex-hover transition-colors flex items-center justify-center gap-2" onClick={handleSave}>{t('usersAdmin.actions.save')}</button>
                </div>
            </div>
        </div>
    );
};






const UserAnalyticsModal: React.FC<{ userId: string, username: string, thumb: string | null, days: string, onClose: () => void, onOpenProfile?: (userId: string) => void }> = ({ userId, username, thumb, days, onClose, onOpenProfile }) => {
    const { t } = useDiscoverI18n();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [activeTab, setActiveTab] = useState<'overview' | 'history' | 'graphs' | 'xp'>('overview');

    const [historyPage, setHistoryPage] = useState(1);
    const [historySearch, setHistorySearch] = useState('');
    const [historyData, setHistoryData] = useState<any[]>([]);
    const [historyTotal, setHistoryTotal] = useState(0);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historySource, setHistorySource] = useState<'tautulli' | 'plex' | null>(null);
    const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
    const [xpAudit, setXpAudit] = useState<any>(null);
    const [xpAuditLoading, setXpAuditLoading] = useState(false);
    const [xpAuditError, setXpAuditError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(false);
        setActiveTab('overview');
        setHistoryPage(1);
        setHistorySearch('');
        setHistoryData([]);
        setHistorySource(null);
        setExpandedHistoryId(null);
        setXpAudit(null);
        setXpAuditError(null);
        apiFetch(`/api/plex/analytics/user/${userId}?days=${days}`)
            .then(res => { if (!cancelled) setData(res); })
            .catch(() => { if (!cancelled) setError(true); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [userId, days]);

    useEffect(() => {
        if (activeTab !== 'xp') return;
        let cancelled = false;
        setXpAuditLoading(true);
        setXpAuditError(null);
        apiFetch(`/api/achievements/admin/user/${encodeURIComponent(userId)}/audit`)
            .then((res) => {
                if (!cancelled) setXpAudit(res);
            })
            .catch((e: any) => {
                if (!cancelled) {
                    setXpAudit(null);
                    setXpAuditError(e?.message || t('userAnalytics.xp.noSnapshot'));
                }
            })
            .finally(() => {
                if (!cancelled) setXpAuditLoading(false);
            });
        return () => { cancelled = true; };
    }, [userId, activeTab, t]);

    useEffect(() => {
        if (activeTab !== 'history') return;
        let cancelled = false;
        setHistoryLoading(true);
        setExpandedHistoryId(null);
        apiFetch(`/api/plex/analytics/user/${userId}/history?page=${historyPage}&limit=15&search=${encodeURIComponent(historySearch)}`)
            .then(res => {
                if (!cancelled && res.data) {
                    setHistoryData(res.data);
                    setHistoryTotal(res.total);
                    setHistorySource(res.source === 'tautulli' ? 'tautulli' : 'plex');
                }
            })
            .catch(() => { })
            .finally(() => { if (!cancelled) setHistoryLoading(false); });
        return () => { cancelled = true; };
    }, [userId, activeTab, historyPage, historySearch]);

    const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
        setHistorySearch(e.target.value);
        setHistoryPage(1);
    };

    const formatHour = (h: number) => {
        if (h === 0) return '12 AM';
        if (h === 12) return '12 PM';
        return h > 12 ? `${h - 12} PM` : `${h} AM`;
    };

    const formatHistoryDuration = (seconds?: number | null) => {
        const total = Math.max(0, Math.round(Number(seconds) || 0));
        if (!total) return null;
        const hrs = Math.floor(total / 3600);
        const mins = Math.floor((total % 3600) / 60);
        if (hrs > 0) return `${hrs}h ${mins}m`;
        if (mins > 0) return `${mins}m`;
        return `${total}s`;
    };

    const formatHistoryTimestamp = (value?: number | string | null) => {
        if (value == null || value === '') return null;
        const raw = Number(value);
        if (!Number.isFinite(raw) || raw <= 0) return null;
        const ms = raw > 9999999999 ? raw : raw * 1000;
        return new Date(ms).toLocaleString();
    };

    const historyWatchedLabel = (status?: number | null) => {
        if (status == null) return null;
        if (status === 1) return t('userAnalytics.history.watched');
        if (status === 0) return t('userAnalytics.history.partial');
        return `Status ${status}`;
    };

    const formatSeasonEpisode = (season?: number | null, episode?: number | null) => {
        const s = season != null && Number.isFinite(Number(season)) ? Number(season) : null;
        const e = episode != null && Number.isFinite(Number(episode)) ? Number(episode) : null;
        if (s == null && e == null) return null;
        if (s != null && e != null) return `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`;
        if (s != null) return `S${String(s).padStart(2, '0')}`;
        return `E${String(e!).padStart(2, '0')}`;
    };

    const daysOfWeek = [
        t('userAnalytics.charts.weekdays.sunday'),
        t('userAnalytics.charts.weekdays.monday'),
        t('userAnalytics.charts.weekdays.tuesday'),
        t('userAnalytics.charts.weekdays.wednesday'),
        t('userAnalytics.charts.weekdays.thursday'),
        t('userAnalytics.charts.weekdays.friday'),
        t('userAnalytics.charts.weekdays.saturday'),
    ];

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-card/90 border border-border w-full max-w-6xl max-h-[90vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="p-6 border-b border-border flex items-center justify-between bg-black/20 flex-shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 rounded-full p-[2px] bg-gradient-to-r from-plex to-[#e5a00d]">
                            <img src={thumb ? (thumb.startsWith('http') ? thumb : portalUrl(`/api/plex/image?path=${encodeURIComponent(thumb)}&width=128&height=128`)) : logoUrl()} alt={username} className="w-full h-full rounded-full object-cover bg-card" onError={(e) => { (e.target as HTMLImageElement).src = logoUrl(); }} />
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold text-text">{username}</h2>
                            <p className="text-muted text-sm">{loading ? t('userAnalytics.page.loadingStats') : `${t('userAnalytics.page.totalPlays', { count: data?.totalPlays || 0 })} (${days === 'all' ? t('wrapUp.allTime') : t('wrapUp.lastNDays', { days })})`}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {onOpenProfile ? (
                            <button
                                type="button"
                                onClick={() => onOpenProfile(userId)}
                                className="text-sm font-bold text-plex hover:underline px-3 py-2 rounded-lg border border-white/10 bg-white/5"
                            >
                                {t('usersAdmin.actions.viewProfile')}
                            </button>
                        ) : null}
                        <button onClick={onClose} aria-label={t('common.close')} className="text-muted hover:text-white transition-colors bg-white/5 p-2 rounded-full"><X className="w-6 h-6" /></button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-border bg-black/40 px-6 gap-6">
                    {(['overview', 'history', 'graphs', 'xp'] as const).map(tab => (
                        <button key={tab} onClick={() => setActiveTab(tab)} className={`py-3 px-2 font-bold text-sm uppercase tracking-wider transition-colors border-b-2 ${activeTab === tab ? 'border-plex text-text' : 'border-transparent text-muted hover:text-white'}`}>
                            {t(`userAnalytics.tabs.${tab}` as 'userAnalytics.tabs.overview' | 'userAnalytics.tabs.history' | 'userAnalytics.tabs.graphs' | 'userAnalytics.tabs.xp')}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1 min-h-0 flex flex-col gap-8 custom-scrollbar">
                    {activeTab === 'xp' ? (
                        <div className="flex flex-col gap-5 min-h-[320px]">
                            <div>
                                <h3 className="text-lg font-bold text-text uppercase tracking-wider flex items-center gap-2">
                                    <Trophy className="text-plex w-4 h-4" /> {t('userAnalytics.xp.title')}
                                </h3>
                                <p className="text-xs text-muted mt-1">
                                    {t('userAnalytics.xp.description')}
                                </p>
                            </div>
                            {xpAuditLoading ? (
                                <div className="flex justify-center items-center h-40"><Loader isLoading={true} /></div>
                            ) : xpAuditError || !xpAudit ? (
                                <div className="flex flex-col items-center justify-center h-40 text-center gap-2">
                                    <AlertCircle className="w-8 h-8 text-amber-400" />
                                    <p className="text-muted text-sm">{xpAuditError || t('userAnalytics.xp.noData')}</p>
                                </div>
                            ) : (
                                <>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                        {[
                                            { label: 'XP', value: Number(xpAudit.xp || 0).toLocaleString() },
                                            { label: t('common.level'), value: String(xpAudit.level || 1) },
                                            { label: t('common.badges'), value: `${xpAudit.earnedCount || 0}/${xpAudit.totalBadges || 0}` },
                                            { label: t('userAnalytics.xp.source'), value: String(xpAudit.watchHistorySource || 'plex') },
                                        ].map((card) => (
                                            <div key={card.label} className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5">
                                                <p className="text-[10px] uppercase tracking-widest text-muted font-bold">{card.label}</p>
                                                <p className="text-lg font-black text-text font-mono mt-1 tabular-nums">{card.value}</p>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="text-[11px] text-muted flex flex-wrap gap-x-4 gap-y-1">
                                        {xpAudit.updatedAt && <span>{t('userAnalytics.xp.updated')} {new Date(xpAudit.updatedAt).toLocaleString()}</span>}
                                        {xpAudit.leaderboardOptOut ? <span className="text-amber-300">{t('userAnalytics.xp.hiddenLeaderboard')}</span> : null}
                                        {xpAudit.muteUnlockToasts ? <span>{t('userAnalytics.xp.unlockToastsMuted')}</span> : null}
                                        {Array.isArray(xpAudit.pinnedBadgeIds) && xpAudit.pinnedBadgeIds.length > 0 && (
                                            <span>{t('userAnalytics.xp.pinned')} {xpAudit.pinnedBadgeIds.join(', ')}</span>
                                        )}
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-bold text-text mb-2">{t('userAnalytics.xp.breakdown')}</h4>
                                        <div className="space-y-1.5">
                                            {(Array.isArray(xpAudit.breakdown) ? xpAudit.breakdown : Object.entries(xpAudit.breakdown || {}).map(([key, xp]) => ({ key, xp })))
                                                .map((row: any) => {
                                                    const key = row.key || row.metric || row.id;
                                                    const xp = Number(row.xp ?? row.value ?? row.points ?? 0) || 0;
                                                    if (!key && !xp) return null;
                                                    return (
                                                        <div key={String(key)} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-sm">
                                                            <span className="text-text truncate">{String(key)}</span>
                                                            <span className="font-mono text-plex font-bold tabular-nums shrink-0">+{xp.toLocaleString()}</span>
                                                        </div>
                                                    );
                                                })}
                                            {!(Array.isArray(xpAudit.breakdown) ? xpAudit.breakdown.length : Object.keys(xpAudit.breakdown || {}).length) && (
                                                <p className="text-sm text-muted">{t('userAnalytics.xp.noBreakdown')}</p>
                                            )}
                                        </div>
                                    </div>
                                    {Array.isArray(xpAudit.recentBadges) && xpAudit.recentBadges.length > 0 && (
                                        <div>
                                            <h4 className="text-sm font-bold text-text mb-2">{t('userAnalytics.xp.recentBadges')}</h4>
                                            <div className="flex flex-wrap gap-2">
                                                {xpAudit.recentBadges.map((b: any) => (
                                                    <span key={b.id} className="text-[11px] rounded-lg border border-white/10 bg-black/25 px-2.5 py-1 font-mono text-muted">
                                                        {b.id}{b.earnedAt ? ` · ${new Date(b.earnedAt).toLocaleDateString()}` : ''}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {xpAudit.stats && (
                                        <details className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                                            <summary className="cursor-pointer text-xs font-semibold text-muted hover:text-text">{t('userAnalytics.xp.rawStats')}</summary>
                                            <pre className="mt-2 text-[10px] text-muted overflow-x-auto whitespace-pre-wrap font-mono">
                                                {JSON.stringify(xpAudit.stats, null, 2)}
                                            </pre>
                                        </details>
                                    )}
                                </>
                            )}
                        </div>
                    ) : loading ? (
                        <div className="flex justify-center items-center h-40"><Loader isLoading={true} /></div>
                    ) : (error || !data) ? (
                        <div className="flex flex-col items-center justify-center h-40 text-center gap-2">
                            <AlertCircle className="w-8 h-8 text-red-500" />
                            <p className="text-muted text-sm">{t('userAnalytics.page.loadError')}</p>
                        </div>
                    ) : activeTab === 'overview' ? (
                        <>
                            {/* Top row */}
                            <div>
                                <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2"><PlaySquare className="text-plex w-4 h-4" /> {t('userAnalytics.overview.favoriteLibraries')}</h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                                    {(data.topLibraries ?? []).length === 0 ? <p className="text-muted text-sm col-span-full">{t('userAnalytics.overview.noLibraryData')}</p> : data.topLibraries.map((lib: any, i: number) => (
                                        <div key={lib.id} className="flex justify-between items-center bg-black/20 p-2 rounded border border-white/5">
                                            <span className="font-bold text-sm text-text"><span className="text-muted mr-2">#{i + 1}</span>{lib.title}</span>
                                            <span className="text-plex text-xs font-mono">{t('userAnalytics.overview.plays', { count: lib.plays })}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {data.topMovies && data.topMovies.length > 0 && (
                                <div>
                                    <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2"><Film className="text-plex w-4 h-4" /> {t('userAnalytics.overview.topMovies')}</h3>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                                        {data.topMovies.slice(0, 15).map((c: any, i: number) => (
                                            <a key={c.key} href={c.plexUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 bg-black/20 p-2 rounded border border-white/5 hover:bg-white/10 transition-colors">
                                                <div className="w-8 h-12 bg-black/40 rounded overflow-hidden flex-shrink-0 relative">
                                                    {c.thumbUrl && <img src={resolvePortalAssetUrl(c.thumbUrl)} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }} />}
                                                    <div className={`absolute inset-0 w-full h-full p-2 opacity-50 flex items-center justify-center ${c.thumbUrl ? 'hidden' : ''}`}>
                                                        <Film className="w-full h-full" />
                                                    </div>
                                                </div>
                                                <div className="flex flex-col flex-grow overflow-hidden">
                                                    <span className="font-bold text-sm text-text truncate">{c.title}</span>
                                                    <span className="text-muted text-[10px] uppercase tracking-wider">{c.type}</span>
                                                </div>
                                                <span className="text-plex text-xs font-mono whitespace-nowrap">{t('userAnalytics.overview.plays', { count: c.plays })}</span>
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {data.topShows && data.topShows.length > 0 && (
                                <div>
                                    <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2"><TrendingUp className="text-plex w-4 h-4" /> {t('userAnalytics.overview.topShows')}</h3>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                                        {data.topShows.slice(0, 15).map((c: any, i: number) => (
                                            <a key={c.key} href={c.plexUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 bg-black/20 p-2 rounded border border-white/5 hover:bg-white/10 transition-colors">
                                                <div className="w-8 h-12 bg-black/40 rounded overflow-hidden flex-shrink-0 relative">
                                                    {c.thumbUrl && <img src={resolvePortalAssetUrl(c.thumbUrl)} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }} />}
                                                    <div className={`absolute inset-0 w-full h-full p-2 opacity-50 flex items-center justify-center ${c.thumbUrl ? 'hidden' : ''}`}>
                                                        <Film className="w-full h-full" />
                                                    </div>
                                                </div>
                                                <div className="flex flex-col flex-grow overflow-hidden">
                                                    <span className="font-bold text-sm text-text truncate">{c.title}</span>
                                                    <span className="text-muted text-[10px] uppercase tracking-wider">{c.type}</span>
                                                </div>
                                                <span className="text-plex text-xs font-mono whitespace-nowrap">{t('userAnalytics.overview.plays', { count: c.plays })}</span>
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    ) : activeTab === 'history' ? (
                        <div className="flex flex-col gap-4 h-full min-h-[400px]">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div>
                                <h3 className="text-lg font-bold text-text uppercase tracking-wider flex items-center gap-2"><Activity className="text-plex w-4 h-4" /> {t('userAnalytics.history.title')}</h3>
                                    {historySource === 'plex' ? (
                                        <p className="mt-1 text-[11px] text-muted">{t('userAnalytics.history.plexHint')}</p>
                                    ) : historySource === 'tautulli' ? (
                                        <p className="mt-1 text-[11px] text-muted">{t('userAnalytics.history.tautulliHint')}</p>
                                    ) : null}
                                </div>
                                <div className="relative w-full sm:w-64">
                                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                                    <input
                                        type="text"
                                        inputMode="search"
                                        enterKeyHint="search"
                                        autoComplete="off"
                                        autoCorrect="off"
                                        autoCapitalize="none"
                                        spellCheck={false}
                                        placeholder={t('userAnalytics.history.searchPlaceholder')}
                                        value={historySearch}
                                        onChange={handleSearch}
                                        className="w-full appearance-none rounded-xl border border-white/10 bg-black/20 py-3 pl-10 pr-3 text-[16px] leading-5 text-text outline-none transition focus:border-plex/40 focus:ring-1 focus:ring-plex/20"
                                        style={{ fontSize: 16 }}
                                    />
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto bg-black/20 rounded-xl border border-white/5 p-2 custom-scrollbar">
                                {historyLoading ? (
                                    <div className="flex justify-center items-center h-40"><Loader isLoading={true} /></div>
                                ) : historyData.length === 0 ? (
                                    <div className="flex justify-center items-center h-40 text-muted">{t('userAnalytics.history.empty')}</div>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                        {historyData.map((h: any, i: number) => {
                                            const rowId = String(h.id || `${h.title}-${h.viewedAt}-${i}`);
                                            const expanded = expandedHistoryId === rowId;
                                            const durationLabel = formatHistoryDuration(h.duration);
                                            const playDurationLabel = formatHistoryDuration(h.playDuration);
                                            const pausedSeconds = Number(h.pausedCount) || 0;
                                            const pausedLabel = formatHistoryDuration(pausedSeconds);
                                            const seasonEpisode = formatSeasonEpisode(h.seasonNumber, h.episodeNumber);
                                            const playerLabel = [h.player, h.platform].filter(Boolean).join(' · ');
                                            const startedLabel = formatHistoryTimestamp(h.startedAt ?? h.viewedAt);
                                            const stoppedLabel = formatHistoryTimestamp(h.stoppedAt);
                                            const watchedLabel = historyWatchedLabel(h.watchedStatus);
                                            const detailRows: Array<{ label: string; value: string }> = [
                                                startedLabel ? { label: t('userAnalytics.history.started'), value: startedLabel } : null,
                                                stoppedLabel ? { label: t('userAnalytics.history.stopped'), value: stoppedLabel } : null,
                                                playDurationLabel ? { label: t('userAnalytics.history.watchedFor'), value: playDurationLabel } : null,
                                                durationLabel ? { label: t('userAnalytics.history.mediaLength'), value: durationLabel } : null,
                                                h.percentComplete != null ? { label: t('userAnalytics.history.progress'), value: `${h.percentComplete}%` } : null,
                                                historySource === 'tautulli' ? { label: t('userAnalytics.history.pausedFor'), value: pausedLabel || t('userAnalytics.history.none') } : null,
                                                seasonEpisode ? { label: t('userAnalytics.history.episode'), value: seasonEpisode } : null,
                                                watchedLabel ? { label: t('userAnalytics.history.status'), value: watchedLabel } : null,
                                                h.player ? { label: t('userAnalytics.history.player'), value: String(h.player) } : null,
                                                h.platform ? { label: t('userAnalytics.history.platform'), value: String(h.platform) } : null,
                                                h.product ? { label: t('userAnalytics.history.product'), value: String(h.product) } : null,
                                                h.transcodeDecision ? { label: t('userAnalytics.history.stream'), value: String(h.transcodeDecision) } : null,
                                                h.ipAddress ? { label: t('userAnalytics.history.ip'), value: String(h.ipAddress) } : null,
                                                h.location ? { label: t('userAnalytics.history.location'), value: String(h.location) } : null,
                                                h.year ? { label: t('userAnalytics.history.year'), value: String(h.year) } : null,
                                                h.type ? { label: t('userAnalytics.history.type'), value: String(h.type) } : null,
                                            ].filter(Boolean) as Array<{ label: string; value: string }>;
                                            return (
                                            <div
                                                key={rowId}
                                                className={`bg-white/5 border border-white/5 rounded-lg hover:bg-white/10 transition-colors ${expanded ? 'sm:col-span-2 lg:col-span-3 bg-white/[0.07]' : ''}`}
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => setExpandedHistoryId(expanded ? null : rowId)}
                                                    className="w-full flex items-center gap-3 p-2 text-left"
                                                    aria-expanded={expanded}
                                                >
                                                    <div className={`${h.type === 'track' ? 'w-12 h-12' : 'w-10 h-14'} bg-black/40 rounded overflow-hidden flex-shrink-0`}>
                                                        {h.thumbUrl && <img src={resolvePortalAssetUrl(h.thumbUrl)} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }} />}
                                                        <div className={`w-full h-full p-2 opacity-50 flex items-center justify-center ${h.thumbUrl ? 'hidden' : ''}`}>
                                                            {h.type === 'track' ? <Music className="w-full h-full" /> : <Film className="w-full h-full" />}
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col overflow-hidden w-full min-w-0">
                                                        <span className="font-bold text-sm text-text truncate w-[95%]">{h.title}</span>
                                                        {(h.parentTitle || h.episodeTitle || seasonEpisode) && h.type !== 'movie' && (
                                                            <span className="text-muted text-xs truncate w-[95%]">
                                                                {seasonEpisode ? (
                                                                    <span className="text-plex font-mono mr-1.5">{seasonEpisode}</span>
                                                                ) : null}
                                                                {h.parentTitle || h.episodeTitle || ''}
                                                            </span>
                                                        )}
                                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
                                                            <span className="text-plex font-mono text-[10px]">
                                                                {h.viewedAt ? formatPortalDateTime(h.viewedAt) : t('userAnalytics.history.unknownDate')}
                                                            </span>
                                                            {durationLabel ? (
                                                                <span className="text-muted font-mono text-[10px]">{durationLabel}</span>
                                                            ) : null}
                                                            {h.percentComplete != null && h.percentComplete < 100 && (
                                                                <span className="text-yellow-500 font-mono text-[10px]">{h.percentComplete}%</span>
                                                            )}
                                                            {pausedLabel ? (
                                                                <span className="inline-flex items-center gap-0.5 text-amber-300 font-mono text-[10px]" title={`${t('userAnalytics.history.pausedFor')} ${pausedLabel}`}>
                                                                    <Pause className="w-3 h-3" /> {pausedLabel}
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                        {playerLabel ? (
                                                            <span className="text-muted text-[10px] truncate mt-0.5" title={playerLabel}>{playerLabel}</span>
                                                        ) : null}
                                                    </div>
                                                    <span className="flex-shrink-0 text-muted" aria-hidden>
                                                        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                                    </span>
                                                </button>
                                                {expanded ? (
                                                    <div className="px-3 pb-3 pt-0 border-t border-white/5 mx-2 mb-2">
                                                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2 pt-3">
                                                            {detailRows.map((row) => (
                                                                <div key={row.label} className="min-w-0">
                                                                    <div className="text-[10px] uppercase tracking-wider text-muted">{row.label}</div>
                                                                    <div className="text-xs text-text truncate" title={row.value}>{row.value}</div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        {historySource === 'tautulli' ? (
                                                            <p className="mt-3 text-[10px] text-muted">
                                                                {t('userAnalytics.history.tautulliPauseHint')}
                                                            </p>
                                                        ) : (
                                                            <p className="mt-3 text-[10px] text-muted">
                                                                {t('userAnalytics.history.plexSessionHint')}
                                                            </p>
                                                        )}
                                                    </div>
                                                ) : null}
                                            </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Pagination */}
                            {historyTotal > 15 && (
                                <div className="flex justify-between items-center pt-2 border-t border-border mt-2 flex-shrink-0">
                                    <span className="text-sm text-muted">{t('userAnalytics.history.showing', { from: Math.min((historyPage - 1) * 15 + 1, historyTotal), to: Math.min(historyPage * 15, historyTotal), total: historyTotal })}</span>
                                    <div className="flex gap-2">
                                        <button type="button" disabled={historyPage === 1} onClick={() => setHistoryPage(p => p - 1)} className="bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/10 px-3 py-1.5 rounded-lg text-sm text-white font-bold transition-colors">{t('userAnalytics.history.prev')}</button>
                                        <button type="button" disabled={historyPage * 15 >= historyTotal} onClick={() => setHistoryPage(p => p + 1)} className="bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/10 px-3 py-1.5 rounded-lg text-sm text-white font-bold transition-colors">{t('userAnalytics.history.next')}</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : activeTab === 'graphs' ? (
                        <div className="flex flex-col gap-6 h-full min-h-[400px]">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <div className="glass-card-sm p-4 bg-black/20">
                                    <h3 className="text-sm font-bold text-text mb-4 uppercase tracking-wider">{t('userAnalytics.charts.playsByHour')}</h3>
                                    <div className="h-64">
                                        {data.hourDistribution ? (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <LineChart data={data.hourDistribution.map((plays: number, i: number) => ({ hour: formatHour(i), plays }))}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                                                    <XAxis dataKey="hour" stroke="rgba(255,255,255,0.3)" fontSize={11} tickMargin={10} minTickGap={20} />
                                                    <YAxis stroke="rgba(255,255,255,0.3)" fontSize={11} allowDecimals={false} />
                                                    <RechartsTooltip
                                                        contentStyle={{ backgroundColor: 'rgba(20,20,20,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                                        itemStyle={{ color: '#E5A00D' }}
                                                    />
                                                    <Line type="monotone" dataKey="plays" name={t('userAnalytics.charts.plays')} stroke="#E5A00D" strokeWidth={3} dot={{ fill: '#E5A00D', strokeWidth: 2, r: 4 }} activeDot={{ r: 6 }} />
                                                </LineChart>
                                            </ResponsiveContainer>
                                        ) : <p className="text-muted text-sm">{t('userAnalytics.charts.noData')}</p>}
                                    </div>
                                </div>

                                <div className="glass-card-sm p-4 bg-black/20">
                                    <h3 className="text-sm font-bold text-text mb-4 uppercase tracking-wider">{t('userAnalytics.charts.playsByDay')}</h3>
                                    <div className="h-64">
                                        {data.dayOfWeekCounts ? (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={Object.values(data.dayOfWeekCounts).map((plays: any, i: number) => ({ day: daysOfWeek[i].substring(0, 3), plays }))}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                                                    <XAxis dataKey="day" stroke="rgba(255,255,255,0.3)" fontSize={11} tickMargin={10} />
                                                    <YAxis stroke="rgba(255,255,255,0.3)" fontSize={11} allowDecimals={false} />
                                                    <RechartsTooltip
                                                        contentStyle={{ backgroundColor: 'rgba(20,20,20,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                                        itemStyle={{ color: '#E5A00D' }}
                                                        cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                                    />
                                                    <Bar dataKey="plays" name={t('userAnalytics.charts.plays')} fill="#E5A00D" radius={[4, 4, 0, 0]} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        ) : <p className="text-muted text-sm">{t('userAnalytics.charts.noData')}</p>}
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                                <div className="glass-card-sm p-4 bg-black/20">
                                    <h3 className="text-sm font-bold text-text mb-4 uppercase tracking-wider">{t('userAnalytics.charts.playsByLibrary')}</h3>
                                    <div className="h-64">
                                        {data.topLibraries && data.topLibraries.length > 0 ? (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <RechartsPieChart>
                                                    <Pie
                                                        data={data.topLibraries}
                                                        dataKey="plays"
                                                        nameKey="title"
                                                        cx="50%"
                                                        cy="50%"
                                                        outerRadius={80}
                                                        innerRadius={40}
                                                        fill="#E5A00D"
                                                        label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                                                        labelLine={false}
                                                    >
                                                        {data.topLibraries.map((entry: any, index: number) => (
                                                            <Cell key={`cell-${index}`} fill={['#E5A00D', '#3B82F6', '#10B981', '#EF4444', '#8B5CF6', '#EC4899'][index % 6]} />
                                                        ))}
                                                    </Pie>
                                                    <RechartsTooltip
                                                        contentStyle={{ backgroundColor: 'rgba(20,20,20,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                                        itemStyle={{ color: '#E5A00D' }}
                                                    />
                                                </RechartsPieChart>
                                            </ResponsiveContainer>
                                        ) : <p className="text-muted text-sm">{t('userAnalytics.charts.noData')}</p>}
                                    </div>
                                </div>

                                <div className="glass-card-sm p-4 bg-black/20">
                                    <h3 className="text-sm font-bold text-text mb-4 uppercase tracking-wider">{t('userAnalytics.charts.topShows')}</h3>
                                    <div className="h-64">
                                        {data.topShows && data.topShows.length > 0 ? (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={data.topShows.slice(0, 5)} layout="vertical" margin={{ left: 0, right: 20 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal={true} vertical={false} />
                                                    <XAxis type="number" stroke="rgba(255,255,255,0.3)" fontSize={11} allowDecimals={false} />
                                                    <YAxis dataKey="title" type="category" stroke="rgba(255,255,255,0.3)" fontSize={10} width={90} tickFormatter={(val) => val.length > 13 ? val.substring(0, 13) + '...' : val} />
                                                    <RechartsTooltip
                                                        contentStyle={{ backgroundColor: 'rgba(20,20,20,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                                        itemStyle={{ color: '#E5A00D' }}
                                                        cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                                    />
                                                    <Bar dataKey="plays" name={t('userAnalytics.charts.plays')} fill="#3B82F6" radius={[0, 4, 4, 0]} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        ) : <p className="text-muted text-sm">{t('userAnalytics.charts.noData')}</p>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
};

const CountUp: React.FC<{ end: number, duration?: number }> = ({ end, duration = 1500 }) => {
    const [count, setCount] = useState(0);

    useEffect(() => {
        let startTime: number | null = null;
        let animationFrame: number;

        const animate = (timestamp: number) => {
            if (!startTime) startTime = timestamp;
            const progress = timestamp - startTime;
            const percentage = Math.min(progress / duration, 1);

            // easeOutQuart easing
            const easeOut = 1 - Math.pow(1 - percentage, 4);

            setCount(Math.floor(end * easeOut));

            if (percentage < 1) {
                animationFrame = requestAnimationFrame(animate);
            } else {
                setCount(end);
            }
        };

        animationFrame = requestAnimationFrame(animate);

        return () => cancelAnimationFrame(animationFrame);
    }, [end, duration]);

    return <span>{count.toLocaleString()}</span>;
};

const ReportIssueModal: React.FC<{ item: any, onClose: () => void }> = ({ item, onClose }) => {
    const [issue, setIssue] = useState('');
    const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setStatus('submitting');
        try {
            const res = await apiFetch('/api/plex/report-issue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: item.title, key: item.key || item.ratingKey, issue })
            });
            if (res.success) {
                setStatus('success');
                setTimeout(() => onClose(), 2000);
            } else {
                setStatus('error');
            }
        } catch (e) {
            setStatus('error');
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="glass-card p-6 w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-plex" />
                        Report Issue
                    </h2>
                    <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors text-muted hover:text-text">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                {status === 'success' ? (
                    <div className="text-center py-8">
                        <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Check className="w-8 h-8 text-green-500" />
                        </div>
                        <h3 className="text-xl font-bold mb-2">Report Sent!</h3>
                        <p className="text-muted">The server admin has been notified.</p>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit}>
                        <div className="mb-4">
                            <p className="text-sm text-muted mb-2">Reporting issue for:</p>
                            <div className="bg-black/20 border border-white/5 p-3 rounded-xl flex items-center gap-3">
                                {item.thumbUrl ? (
                                    <img src={resolvePortalAssetUrl(item.thumbUrl)} className="w-10 h-10 rounded-lg object-cover" />
                                ) : (
                                    <div className="w-10 h-10 bg-white/5 rounded-lg flex items-center justify-center"><Film className="w-5 h-5 text-muted/50" /></div>
                                )}
                                <div>
                                    <p className="font-bold text-sm truncate">{item.title}</p>
                                    {item.episodeTitle && <p className="text-xs text-muted truncate">{item.episodeTitle}</p>}
                                </div>
                            </div>
                        </div>
                        <div className="mb-6">
                            <label className="block text-sm font-bold text-muted mb-2 uppercase tracking-wider">What's wrong?</label>
                            <textarea
                                value={issue}
                                onChange={e => setIssue(e.target.value)}
                                placeholder="E.g., Audio is out of sync, subtitles are missing, buffering constantly..."
                                className="w-full bg-background border border-border/50 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-plex/50 text-text resize-none h-32"
                                required
                            />
                        </div>
                        <div className="flex gap-3">
                            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-border/50 text-text font-bold hover:bg-white/5 transition-colors">Cancel</button>
                            <button type="submit" disabled={status === 'submitting' || !issue.trim()} className="flex-1 px-4 py-2.5 rounded-xl bg-plex text-black font-black hover:bg-plex/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                                {status === 'submitting' ? <><RefreshCw className="w-4 h-4 animate-spin" /> Sending...</> : 'Send Report'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};

// --- Analytics Dashboard Component ---
const PersonalAnalyticsDashboard: React.FC<{ username: string, thumb: string | null }> = ({ username, thumb }) => {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [days, setDays] = useState<string>('30');

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(false);
        apiFetch(`/api/plex/analytics/me?days=${days}`)
            .then(res => { if (!cancelled) setData(res); })
            .catch(() => { if (!cancelled) setError(true); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [days]);

    return (
        <div className="w-full animate-fade-in flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
                <div>
                    <h1 className="text-3xl font-bold text-text uppercase tracking-widest flex items-center gap-3">
                        <BarChart3 className="w-8 h-8 text-plex" />
                        Personal Analytics
                    </h1>
                    <p className="text-muted text-sm mt-1">Deep dive into your playback history</p>
                </div>
                <select
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                    className="bg-card text-text border border-border rounded px-4 py-2 text-sm focus:outline-none focus:border-plex"
                >
                    <option value="30">Last 30 Days</option>
                    <option value="60">Last 60 Days</option>
                    <option value="365">Last 1 Year</option>
                    <option value="1825">Last 5 Years</option>
                    <option value="all">All Time</option>
                </select>
            </div>

            <div className="bg-card/90 border border-border w-full rounded-2xl shadow-2xl overflow-hidden flex flex-col">
                <div className="p-6 border-b border-border flex items-center justify-between bg-black/20 flex-shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 rounded-full p-[2px] bg-gradient-to-r from-plex to-[#e5a00d]">
                            <img src={thumb ? (thumb.startsWith('http') ? thumb : portalUrl(`/api/plex/image?path=${encodeURIComponent(thumb)}&width=128&height=128`)) : logoUrl()} alt={username} className="w-full h-full rounded-full object-cover bg-card" onError={(e) => { (e.target as HTMLImageElement).src = logoUrl(); }} />
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold text-text">{username}</h2>
                            <p className="text-muted text-sm">{loading ? 'Loading stats...' : `${data?.totalPlays || 0} total plays (${days === 'all' ? 'All Time' : `Last ${days} Days`})`}</p>
                        </div>
                    </div>
                </div>

                <div className="p-6 overflow-y-auto flex-1 min-h-0 flex flex-col gap-8 custom-scrollbar">
                    {loading ? (
                        <div className="flex justify-center items-center h-40"><Loader isLoading={true} /></div>
                    ) : (error || !data) ? (
                        <div className="flex flex-col items-center justify-center h-40 text-center gap-2">
                            <AlertCircle className="w-8 h-8 text-red-500" />
                            <p className="text-muted text-sm">Failed to load your analytics. Please try again later.</p>
                        </div>
                    ) : (
                        <>
                            <div>
                                <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2"><PlaySquare className="text-plex w-4 h-4" /> Favorite Libraries</h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                                    {(data.topLibraries ?? []).length === 0 ? <p className="text-muted text-sm col-span-full">No library data.</p> : data.topLibraries.map((lib: any, i: number) => (
                                        <div key={lib.id} className="flex justify-between items-center bg-black/20 p-2 rounded border border-white/5">
                                            <span className="font-bold text-sm text-text"><span className="text-muted mr-2">#{i + 1}</span>{lib.title}</span>
                                            <span className="text-plex text-xs font-mono">{lib.plays} plays</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {data.topMovies && data.topMovies.length > 0 && (
                                <div>
                                    <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2"><Film className="text-plex w-4 h-4" /> Top Watched Movies</h3>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                                        {data.topMovies.map((c: any, i: number) => (
                                            <a key={c.key} href={c.plexUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 bg-black/20 p-2 rounded border border-white/5 hover:bg-white/10 transition-colors">
                                                <div className="w-8 h-12 bg-black/40 rounded overflow-hidden flex-shrink-0 relative">
                                                    {c.thumbUrl && <img src={resolvePortalAssetUrl(c.thumbUrl)} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }} />}
                                                    <div className={`absolute inset-0 w-full h-full p-2 opacity-50 flex items-center justify-center ${c.thumbUrl ? 'hidden' : ''}`}>
                                                        <Film className="w-full h-full" />
                                                    </div>
                                                </div>
                                                <div className="flex flex-col flex-grow overflow-hidden">
                                                    <span className="font-bold text-sm text-text truncate">{c.title}</span>
                                                    <span className="text-muted text-[10px] uppercase tracking-wider">{c.type}</span>
                                                </div>
                                                <span className="text-plex text-xs font-mono whitespace-nowrap">{c.plays} plays</span>
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {data.topShows && data.topShows.length > 0 && (
                                <div>
                                    <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2"><TrendingUp className="text-plex w-4 h-4" /> Top Watched TV Shows</h3>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                                        {data.topShows.map((c: any, i: number) => (
                                            <a key={c.key} href={c.plexUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 bg-black/20 p-2 rounded border border-white/5 hover:bg-white/10 transition-colors">
                                                <div className="w-8 h-12 bg-black/40 rounded overflow-hidden flex-shrink-0 relative">
                                                    {c.thumbUrl && <img src={resolvePortalAssetUrl(c.thumbUrl)} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }} />}
                                                    <div className={`absolute inset-0 w-full h-full p-2 opacity-50 flex items-center justify-center ${c.thumbUrl ? 'hidden' : ''}`}>
                                                        <Film className="w-full h-full" />
                                                    </div>
                                                </div>
                                                <div className="flex flex-col flex-grow overflow-hidden">
                                                    <span className="font-bold text-sm text-text truncate">{c.title}</span>
                                                    <span className="text-muted text-[10px] uppercase tracking-wider">{c.type}</span>
                                                </div>
                                                <span className="text-plex text-xs font-mono whitespace-nowrap">{c.plays} plays</span>
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {data.topMusic && data.topMusic.length > 0 && (
                                <div>
                                    <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2"><Music className="text-plex w-4 h-4" /> Top Listened</h3>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                                        {data.topMusic.map((c: any, i: number) => (
                                            <a key={c.key} href={c.plexUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 bg-black/20 p-2 rounded border border-white/5 hover:bg-white/10 transition-colors">
                                                <div className="w-12 h-12 bg-black/40 rounded overflow-hidden flex-shrink-0 relative">
                                                    {c.thumbUrl && <img src={resolvePortalAssetUrl(c.thumbUrl)} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }} />}
                                                    <div className={`absolute inset-0 w-full h-full p-2 opacity-50 flex items-center justify-center ${c.thumbUrl ? 'hidden' : ''}`}>
                                                        <Music className="w-full h-full" />
                                                    </div>
                                                </div>
                                                <div className="flex flex-col flex-grow overflow-hidden">
                                                    <span className="font-bold text-sm text-text truncate">{c.title}</span>
                                                    <span className="text-muted text-[10px] uppercase tracking-wider">{c.type}</span>
                                                </div>
                                                <span className="text-plex text-xs font-mono whitespace-nowrap">{c.plays} plays</span>
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div>

                                <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2"><Activity className="text-plex w-4 h-4" /> Recent Watch History</h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {data.recentHistory.length === 0 ? <p className="text-muted text-sm col-span-full">No recent history.</p> : data.recentHistory.map((h: any, i: number) => (
                                        <a key={i} href={h.plexUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 bg-white/5 border border-white/5 p-2 rounded-lg hover:bg-white/10 transition-colors">
                                            <div className={`${h.type === 'track' ? 'w-12 h-12' : 'w-10 h-14'} bg-black/40 rounded overflow-hidden flex-shrink-0`}>
                                                {h.thumbUrl && <img src={resolvePortalAssetUrl(h.thumbUrl)} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }} />}
                                                <div className={`w-full h-full p-2 opacity-50 flex items-center justify-center ${h.thumbUrl ? 'hidden' : ''}`}>
                                                    {h.type === 'track' ? <Music className="w-full h-full" /> : <Film className="w-full h-full" />}
                                                </div>
                                            </div>
                                            <div className="flex flex-col overflow-hidden">
                                                <span className="font-bold text-sm text-text truncate">{h.title}</span>
                                                {h.episodeTitle && <span className="text-muted text-xs truncate">{h.episodeTitle}</span>}
                                                <span className="text-plex font-mono text-[10px] mt-1">{formatPortalDateTime(h.viewedAt)}</span>
                                            </div>
                                        </a>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export const MediaStackDashboard: React.FC<{ isAdmin: boolean }> = ({ isAdmin }) => {
    const { locale, t } = useDiscoverI18n();
    const [detailsItem, setDetailsItem] = useState<any>(null);
    const [data, setData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [monthOffset, setMonthOffset] = useState(0);
    const [activeInstanceId, setActiveInstanceId] = useState<string | null>(null);
    const [activeCalendarItem, setActiveCalendarItem] = useState<any>(null);
    const [autoMonthNotice, setAutoMonthNotice] = useState('');

    const stackInstances = useMemo(() => {
        const fromApi = Array.isArray(data?.instances) ? data.instances : [];
        if (fromApi.length > 0) {
            return [...fromApi].sort((a: any, b: any) => {
                if (a.type !== b.type) return a.type === 'sonarr' ? -1 : 1;
                if (!!a.isDefault !== !!b.isDefault) return a.isDefault ? -1 : 1;
                return String(a.name || '').localeCompare(String(b.name || ''));
            });
        }
        const fallback: any[] = [];
        if (data?.sonarr) {
            fallback.push({
                ...data.sonarr,
                id: 'sonarr-default',
                type: 'sonarr',
                name: data.sonarr.instanceName || 'Sonarr',
            });
        }
        if (data?.radarr) {
            fallback.push({
                ...data.radarr,
                id: 'radarr-default',
                type: 'radarr',
                name: data.radarr.instanceName || 'Radarr',
            });
        }
        return fallback;
    }, [data]);

    const switchInstance = (instanceId: string) => {
        if (instanceId === activeInstanceId) return;
        setActiveInstanceId(instanceId);
        setAutoMonthNotice('');
        setMonthOffset(0);
    };

    useEffect(() => {
        if (stackInstances.length === 0) {
            setActiveInstanceId(null);
            return;
        }
        if (activeInstanceId && stackInstances.some((entry: any) => entry.id === activeInstanceId)) return;
        const preferred = stackInstances.find((entry: any) => entry.isDefault) || stackInstances[0];
        setActiveInstanceId(preferred?.id || null);
    }, [stackInstances, activeInstanceId]);

    const activeInstanceData = useMemo(() => {
        if (!stackInstances.length) return null;
        return stackInstances.find((entry: any) => entry.id === activeInstanceId) || stackInstances[0];
    }, [stackInstances, activeInstanceId]);

    const activeInstanceType = activeInstanceData?.type === 'radarr' ? 'radarr' : 'sonarr';
    const isTvInstance = activeInstanceType === 'sonarr';

    const fetchData = useCallback(async () => {
        try {
            const res = await apiFetch('/api/media-stack/summary?monthOffset=' + monthOffset);
            if (res.error) throw new Error(res.error);
            setData(res);
        } catch (err: any) {
            setError(err.message || t('calendar.errors.loadFailed'));
        } finally {
            setIsLoading(false);
        }
    }, [monthOffset, t]);

    useEffect(() => {
        void fetchData();
    }, [fetchData]);

    usePoll(() => { void fetchData(); }, 30_000);

    const formatRelativeAirDate = (date: Date) => {
        const now = new Date();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const isMidnight = date.getHours() === 0 && date.getMinutes() === 0;
        const timeStr = isMidnight ? '' : t('calendar.relative.atTime', { time: formatTime(date) });

        const diffDays = Math.ceil((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        if (date >= today && date < tomorrow) {
            return `${t('calendar.relative.today')}${timeStr}`;
        }
        const dayAfterTomorrow = new Date(tomorrow);
        dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);
        if (date >= tomorrow && date < dayAfterTomorrow) {
            return `${t('calendar.relative.tomorrow')}${timeStr}`;
        }
        if (diffDays > 1 && diffDays < 7) {
            const dayName = date.toLocaleDateString(locale, { weekday: 'long' });
            return `${dayName}${timeStr}`;
        }
        return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' }) + timeStr;
    };

    const formatBytes = (bytes: number) => {
        if (!bytes) return '0.0 GB';
        const gb = bytes / (1024 * 1024 * 1024);
        if (gb >= 1) return `${gb.toFixed(1)} GB`;
        const mb = bytes / (1024 * 1024);
        return `${mb.toFixed(1)} MB`;
    };

    const calendarItems = useMemo(() => {
        if (!activeInstanceData?.calendar) return [];
        const items: any[] = [];
        if (isTvInstance) {
            activeInstanceData.calendar.forEach((ep: any) => {
                const poster = ep.series?.images?.find((img: any) => img.coverType === 'poster');
                items.push({
                    id: `${activeInstanceData.id}-sonarr-${ep.id || ep.airDateUtc || ep.airDate}-${ep.title}`,
                    type: 'tv',
                    service: activeInstanceData.name || 'Sonarr',
                    title: ep.series?.title || t('calendar.fallback.unknownSeries'),
                    subtitle: ep.portalRequest
                        ? t('calendar.labels.requestedNotAired')
                        : `S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')} - ${ep.title}`,
                    date: new Date(ep.airDateUtc || ep.airDate),
                    hasFile: ep.hasFile,
                    monitored: ep.monitored,
                    imageUrl: poster ? (poster.remoteUrl || poster.url) : null,
                    network: ep.series?.network || '',
                    portalRequest: !!ep.portalRequest,
                });
            });
        } else {
            activeInstanceData.calendar.forEach((movie: any) => {
                const releaseDateStr = movie.digitalRelease || movie.physicalRelease || movie.inCinemas || movie.added;
                if (!releaseDateStr) return;
                const poster = movie.images?.find((img: any) => img.coverType === 'poster');
                items.push({
                    id: `${activeInstanceData.id}-radarr-${movie.id || releaseDateStr}-${movie.title}`,
                    type: 'movie',
                    service: activeInstanceData.name || 'Radarr',
                    title: movie.title,
                    subtitle: movie.portalRequest ? t('calendar.labels.requestedNotReleased') : (movie.studio || t('calendar.fallback.movieRelease')),
                    date: new Date(releaseDateStr),
                    hasFile: movie.hasFile,
                    monitored: movie.monitored,
                    imageUrl: poster ? (poster.remoteUrl || poster.url) : null,
                    portalRequest: !!movie.portalRequest,
                });
            });
        }
        return items.sort((a, b) => a.date.getTime() - b.date.getTime());
    }, [activeInstanceData, isTvInstance, t]);

    const filteredCalendar = calendarItems;

    const activeStackConfigured = !!activeInstanceData?.configured;

    const activeStackLabel = activeInstanceData?.name || activeInstanceData?.instanceName || (isTvInstance ? 'Sonarr' : 'Radarr');
    const stackTools = useMemo(() => (
        Array.isArray(data?.tools)
            ? data.tools.filter((tool: any) => tool?.type === 'lidarr' || tool?.type === 'bazarr')
            : []
    ), [data]);

    useEffect(() => {
        let cancelled = false;
        const maybeAutoSelectMonthWithReleases = async () => {
            if (!data || monthOffset !== 0 || filteredCalendar.length > 0) {
                if (!cancelled && monthOffset === 0) {
                    setAutoMonthNotice('');
                }
                return;
            }
            for (let offset = 1; offset <= 6; offset += 1) {
                try {
                    const res = await apiFetch(`/api/media-stack/summary?monthOffset=${offset}${activeInstanceId ? `&instanceId=${encodeURIComponent(activeInstanceId)}` : ''}`);
                    const activeSummary = activeInstanceId
                        ? res?.instances?.find((entry: any) => entry.id === activeInstanceId)
                        : res?.instances?.[0];
                    const count = Array.isArray(activeSummary?.calendar) ? activeSummary.calendar.length : 0;
                    if (count > 0) {
                        if (cancelled) return;
                        setData(res);
                        setMonthOffset(offset);
                        setAutoMonthNotice(t('calendar.relative.nextMonthNotice', { type: isTvInstance ? t('mediaType.tv') : t('mediaType.movie'), month: new Date(new Date().setFullYear(new Date().getFullYear(), new Date().getMonth() + offset, 1)).toLocaleDateString(locale, { month: 'long', year: 'numeric' }) }));
                        return;
                    }
                } catch {
                    // Keep trying next month; this is a best-effort UX fallback.
                }
            }
            if (!cancelled) {
                setAutoMonthNotice(t('calendar.relative.noNextReleases', { type: isTvInstance ? t('mediaType.tv') : t('mediaType.movie') }));
            }
        };
        maybeAutoSelectMonthWithReleases();
        return () => {
            cancelled = true;
        };
    }, [isTvInstance, filteredCalendar.length, data, monthOffset, activeInstanceId, locale, t]);

    const groupedCalendar = useMemo(() => {
        const groups: { [dateStr: string]: typeof filteredCalendar } = {};
        filteredCalendar.forEach(item => {
            const dateStr = item.date.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
            if (!groups[dateStr]) groups[dateStr] = [];
            groups[dateStr].push(item);
        });
        return groups;
    }, [filteredCalendar, locale]);

    useEffect(() => {
        if (filteredCalendar.length > 0) {
            setActiveCalendarItem((prev: any) => {
                if (prev && filteredCalendar.find(i => i.id === prev.id)) return prev;
                return filteredCalendar[0];
            });
        } else {
            setActiveCalendarItem(null);
        }
    }, [filteredCalendar]);

    const activeQueue = useMemo(() => {
        if (!activeInstanceData?.queue?.records) return [];
        return activeInstanceData.queue.records.map((item: any) => ({
            ...item,
            service: activeInstanceData.name || activeStackLabel,
        }));
    }, [activeInstanceData, activeStackLabel]);

    const activeHistory = useMemo(() => {
        if (!activeInstanceData?.history?.records) return [];
        const historyItems: any[] = [];
        if (isTvInstance) {
            activeInstanceData.history.records.forEach((item: any) => {
                let cleanTitle = '';
                if (item.series?.title) {
                    cleanTitle = item.series.title;
                    if (item.episode?.seasonNumber !== undefined && item.episode?.episodeNumber !== undefined) {
                        cleanTitle += ` - S${String(item.episode.seasonNumber).padStart(2, '0')}E${String(item.episode.episodeNumber).padStart(2, '0')}`;
                        if (item.episode.title) {
                            cleanTitle += ` - ${item.episode.title}`;
                        }
                    }
                } else {
                    cleanTitle = item.sourceTitle || t('calendar.fallback.unknownTvShow');
                }
                historyItems.push({
                    id: `${activeInstanceData.id}-sonarr-hist-${item.id}`,
                    service: activeInstanceData.name || 'Sonarr',
                    title: cleanTitle,
                    date: new Date(item.date),
                    eventType: item.eventType
                });
            });
        } else {
            activeInstanceData.history.records.forEach((item: any) => {
                historyItems.push({
                    id: `${activeInstanceData.id}-radarr-hist-${item.id}`,
                    service: activeInstanceData.name || 'Radarr',
                    title: item.movie?.title || item.sourceTitle || t('calendar.fallback.unknownMovie'),
                    date: new Date(item.date),
                    eventType: item.eventType
                });
            });
        }
        return historyItems.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 8);
    }, [activeInstanceData, isTvInstance, t]);

    if (isLoading) {
        return (
            <DashboardPageShell>
                <Loader isLoading={true} />
            </DashboardPageShell>
        );
    }
    if (error) {
        return (
            <DashboardPageShell>
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
            </DashboardPageShell>
        );
    }
    if (!data) return null;

    const getHistoryColor = (type: string) => {
        if (!type) return 'bg-muted';
        switch (type.toLowerCase()) {
            case 'grabbed':
                return 'bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.5)]';
            case 'downloadfolderimported':
            case 'moviefileimported':
            case 'imported':
                return 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]';
            case 'downloadfailed':
            case 'failed':
                return 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]';
            case 'episodefiledeleted':
            case 'moviefiledeleted':
            case 'deleted':
                return 'bg-zinc-600 shadow-[0_0_6px_rgba(113,113,122,0.5)]';
            default:
                return 'bg-plex shadow-[0_0_6px_rgba(229,160,13,0.5)]';
        }
    };

    const formatEventType = (type: string) => {
        if (!type) return '';
        switch (type.toLowerCase()) {
            case 'grabbed':
                return t('calendar.events.grabbed');
            case 'downloadfolderimported':
            case 'moviefileimported':
            case 'imported':
                return t('calendar.events.imported');
            case 'downloadfailed':
            case 'failed':
                return t('calendar.events.failed');
            case 'episodefiledeleted':
            case 'moviefiledeleted':
            case 'deleted':
                return t('calendar.events.deleted');
            default:
                return type
                    .replace(/([A-Z])/g, ' $1')
                    .replace(/^./, str => str.toUpperCase())
                    .trim();
        }
    };

    const renderStatusCard = (name: string, info: any) => {
        if (!info || !info.configured) {
            return (
                <div className="bg-card border border-border/40 rounded-2xl p-4 md:p-6 shadow-xl flex flex-col justify-between h-44 relative overflow-hidden">
                    <div className="flex justify-between items-start">
                        <h3 className="text-lg font-bold text-text/80">{name}</h3>
                        <span className="text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded bg-white/5 text-muted border border-white/5">{t('calendar.status.unconfigured')}</span>
                    </div>
                    <p className="text-xs text-muted leading-relaxed">{t('calendar.empty.configurationHint')}</p>
                    <div className="text-right">
                        <span className="text-xs font-bold text-plex hover:underline cursor-pointer">{t('calendar.actions.configureInSettings')}</span>
                    </div>
                </div>
            );
        }

        const status = info.status;
        const disk = info.disk ? info.disk[0] : null;
        const freeGB = disk ? (disk.freeSpace / 1024 / 1024 / 1024) : 0;
        const totalGB = disk ? (disk.totalSpace / 1024 / 1024 / 1024) : 1;
        const freePercent = disk ? (freeGB / totalGB) * 100 : 0;
        const usedPercent = 100 - freePercent;
        const isReachable = !!status;

        return (
            <div className="bg-card border border-white/5 shadow-2xl rounded-2xl p-4 md:p-6 relative overflow-hidden backdrop-blur-sm group hover:border-white/10 transition-all duration-300">
                <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-all duration-500">
                    <HardDrive className="w-24 h-24" />
                </div>

                <div className="flex items-center gap-4 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-plex/10 flex items-center justify-center border border-plex/20">
                        {name === 'Sonarr' ? <Tv className="w-5 h-5 text-plex" /> : <Film className="w-5 h-5 text-plex" />}
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-text tracking-wide">{name}</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className={`w-2 h-2 rounded-full ${isReachable ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'}`}></span>
                            <span className={`text-[10px] font-bold tracking-wider uppercase ${isReachable ? 'text-green-500' : 'text-red-400'}`}>{isReachable ? t('calendar.status.online') : t('status.unavailable')}</span>
                            {status?.version && <span className="text-[10px] text-muted font-bold">v{status.version}</span>}
                        </div>
                    </div>
                </div>
                {!isReachable && (
                    <p className="text-[11px] text-red-300 mb-2">{t('calendar.labels.unableToFetch', { name })}</p>
                )}

                {disk && (
                    <div className="bg-background/40 rounded-xl p-3 border border-white/5 mt-2">
                        <div className="flex justify-between items-end mb-1">
                            <span className="text-[10px] font-bold text-muted uppercase tracking-wider">{t('calendar.status.freeStorage')}</span>
                            <span className="text-xs font-bold text-text">{t('calendar.status.freeGb', { value: freeGB.toFixed(1) })}</span>
                        </div>
                        <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden">
                            <div className="bg-plex h-full rounded-full transition-all duration-500" style={{ width: `${usedPercent}%` }}></div>
                        </div>
                        <div className="flex justify-between text-[9px] text-muted/60 mt-1 font-medium">
                            <span>{t('calendar.status.usedPercent', { value: usedPercent.toFixed(0) })}</span>
                            <span>{t('calendar.status.totalGb', { value: totalGB.toFixed(0) })}</span>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const renderToolCard = (tool: any) => {
        const isBazarr = tool?.type === 'bazarr';
        const label = tool?.name || (isBazarr ? 'Bazarr' : 'Lidarr');
        const isOnline = !!tool?.status && !tool?.error;
        const href = tool?.externalUrl || tool?.url || '';
        return (
            <div key={tool.id || `${tool.type}-${label}`} className={`${dashboardPanelClass} p-4 md:p-5 relative overflow-hidden`}>
                <div className="absolute top-0 right-0 p-4 opacity-5">
                    {isBazarr ? <FileText className="w-20 h-20" /> : <Music className="w-20 h-20" />}
                </div>
                <div className="flex items-center justify-between gap-3 relative">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-plex/10 flex items-center justify-center border border-plex/20 shrink-0">
                            {isBazarr ? <FileText className="w-5 h-5 text-plex" /> : <Music className="w-5 h-5 text-plex" />}
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-base font-bold text-text truncate">{label}</h3>
                            <div className="flex items-center gap-2 mt-0.5">
                                <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'}`}></span>
                                <span className={`text-[10px] font-bold tracking-wider uppercase ${isOnline ? 'text-green-500' : 'text-red-400'}`}>{isOnline ? t('calendar.status.online') : t('status.unavailable')}</span>
                                {tool?.version && <span className="text-[10px] text-muted font-bold">v{tool.version}</span>}
                            </div>
                        </div>
                    </div>
                    {isAdmin && href && (
                        <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="p-2 rounded-lg text-muted hover:text-text hover:bg-white/5 transition-colors shrink-0"
                            title={`Open ${label}`}
                        >
                            <ExternalLink className="w-4 h-4" />
                        </a>
                    )}
                </div>
                <p className="text-xs text-muted mt-4 relative">
                    {isBazarr ? t('calendar.labels.subtitleAutomation') : t('calendar.labels.musicAutomation')}
                    {tool?.error ? ` · ${tool.error}` : ''}
                </p>
            </div>
        );
    };

    return (
        <DashboardPageShell>
            <DashboardHero
                accent="plex"
                eyebrow={t('navigation.calendar')}
                title={activeStackLabel}
                description={isTvInstance ? t('calendar.page.tvDescription') : t('calendar.page.movieDescription')}
                icon={<Calendar className="h-3.5 w-3.5" />}
                secondaryBlob
                actions={(
                    <div className="flex flex-wrap items-center gap-2">
                        {stackInstances.length > 0 && (
                            <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-white/10 bg-black/20 p-1 no-scrollbar">
                                {stackInstances.map((instance: any) => (
                                    <button
                                        key={instance.id}
                                        type="button"
                                        onClick={() => switchInstance(instance.id)}
                                        className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${dashboardSubnavLinkClass(activeInstanceId === instance.id)}`}
                                    >
                                        {instance.type === 'sonarr' ? <Tv className="h-3.5 w-3.5" /> : <Film className="h-3.5 w-3.5" />}
                                        {instance.name || (instance.type === 'radarr' ? 'Radarr' : 'Sonarr')}
                                    </button>
                                ))}
                            </div>
                        )}
                        <button
                            type="button"
                            onClick={fetchData}
                            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm font-semibold text-text transition hover:border-plex/40 hover:bg-white/5"
                        >
                            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                            {t('calendar.actions.refresh')}
                        </button>
                    </div>
                )}
            />

            <DetailsModal item={detailsItem} onClose={() => setDetailsItem(null)} />

            <div className="flex flex-col gap-8 w-full">
                {stackTools.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-7xl">
                        {stackTools.map(renderToolCard)}
                    </div>
                )}

                <DashboardPanel
                    title={t('calendar.sections.upcomingReleases')}
                    controls={(
                        <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/20 p-1">
                            <button type="button" onClick={() => { setAutoMonthNotice(''); setMonthOffset((m) => m - 1); }} className="rounded-lg p-1.5 text-muted transition hover:bg-white/10 hover:text-text">
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <span className="text-xs font-bold px-2 w-24 text-center text-text uppercase tracking-wider">
                                {new Date(new Date().setFullYear(new Date().getFullYear(), new Date().getMonth() + monthOffset, 1)).toLocaleDateString('default', { month: 'short', year: 'numeric' })}
                            </span>
                            <button type="button" onClick={() => { setAutoMonthNotice(''); setMonthOffset((m) => m + 1); }} className="rounded-lg p-1.5 text-muted transition hover:bg-white/10 hover:text-text">
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    )}
                >
                        {autoMonthNotice && (
                            <p className="text-xs text-plex/90 mb-3">{autoMonthNotice}</p>
                        )}

                        {filteredCalendar.length === 0 ? (
                            <div className="text-center py-12 bg-background/30 rounded-xl border border-white/5 text-muted text-sm">
                                <Calendar className="w-12 h-12 text-muted/30 mx-auto mb-3" />
                                {!activeStackConfigured ? (
                                    <>
                                        <p>{t('calendar.empty.notConfigured', { name: activeStackLabel })}</p>
                                        <p className="text-xs mt-2">{t('calendar.empty.configurationHint')}</p>
                                    </>
                                ) : (
                                    <p>{t('calendar.empty.noUpcoming', { type: isTvInstance ? t('mediaType.tv') : t('mediaType.movie') })}</p>
                                )}
                            </div>
                        ) : (
                            <div className="flex items-start gap-3 md:gap-5 xl:gap-6 w-full">
                                {/* Left Sticky Poster */}
                                <div className="sticky top-[64px] md:top-0 w-[100px] sm:w-[140px] md:w-[200px] xl:w-[240px] flex-shrink-0 hidden sm:block">
                                    <div className="flex flex-col gap-4 mt-8 md:mt-0">
                                        <div className="relative aspect-[2/3] rounded-lg md:rounded-2xl overflow-hidden shadow-2xl border border-white/10 group bg-card">
                                            {activeCalendarItem?.imageUrl ? (
                                                <img src={activeCalendarItem.imageUrl} alt={activeCalendarItem.title} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                                            ) : (
                                                <div className="w-full h-full flex flex-col items-center justify-center opacity-30">
                                                    {activeCalendarItem?.type === 'tv' ? <Tv className="w-10 h-10 md:w-20 md:h-20 mb-2 md:mb-4" /> : <Film className="w-10 h-10 md:w-20 md:h-20 mb-2 md:mb-4" />}
                                                    <span className="font-bold uppercase tracking-widest text-[8px] md:text-sm">{t('calendar.empty.noPoster')}</span>
                                                </div>
                                            )}
                                            <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-transparent to-transparent flex flex-col justify-start p-2 md:p-4">
                                                {activeCalendarItem?.network && (
                                                    <span className="hidden md:block text-sm text-white/90 uppercase tracking-widest font-bold text-left drop-shadow-lg">{activeCalendarItem.network}</span>
                                                )}
                                            </div>
                                        </div>
                                        {activeCalendarItem?.title && (
                                            <div className="hidden md:block px-0.5">
                                                <p className="text-sm font-bold text-text leading-snug break-words">{activeCalendarItem.title}</p>
                                                {activeCalendarItem.subtitle && (
                                                    <p className="text-xs text-muted mt-1 break-words">{activeCalendarItem.subtitle}</p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Right Side: day columns */}
                                <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 md:gap-5 pb-4">
                                    {Object.entries(groupedCalendar).map(([dateStr, items]: [string, typeof filteredCalendar]) => (
                                        <div key={dateStr} className="flex flex-col gap-2 md:gap-3 min-w-0">
                                            <div className="sticky top-[64px] md:top-0 bg-card z-20 py-1 md:py-3 border-b border-white/10 md:mb-2 page-bleed-x page-x md:mx-0 md:px-0 md:w-full shadow-[0_10px_20px_-10px_rgba(0,0,0,0.5)]">
                                                <h3 className="text-sm md:text-base xl:text-lg font-black text-plex md:text-text tracking-tight uppercase truncate" title={dateStr}>{dateStr}</h3>
                                            </div>
                                            {items.map(item => (
                                                <div
                                                    key={item.id}
                                                    onMouseEnter={() => setActiveCalendarItem(item)}
                                                    onClick={() => setActiveCalendarItem(item)}
                                                    className={`bg-background/40 hover:bg-background/80 transition-all duration-300 rounded-lg md:rounded-xl p-2.5 md:p-3 flex flex-col gap-1.5 shadow-md border-l-4 cursor-pointer group min-w-0 ${item.hasFile ? 'border-l-green-500/80' : item.monitored ? 'border-l-red-500/80' : 'border-l-blue-500/80'} ${activeCalendarItem?.id === item.id ? 'bg-white/10 border border-white/30 scale-[1.01]' : 'border border-white/5 hover:border-white/20'}`}
                                                >
                                                    <div className="flex items-center justify-between gap-2 min-w-0">
                                                        <span className="text-[9px] md:text-[11px] text-plex flex items-center gap-1 md:gap-1.5 font-bold tracking-wide shrink-0">
                                                            <Clock className="w-3 h-3 md:w-3.5 md:h-3.5" />
                                                            {formatTime(item.date).replace(/^0:/, '12:')}
                                                        </span>
                                                        {item.hasFile ? (
                                                            <span className="text-[8px] md:text-[10px] font-bold text-green-500 bg-green-500/10 border border-green-500/20 rounded md:rounded-md px-1.5 py-0.5 whitespace-nowrap shrink-0">
                                                                {t('calendar.status.ready')}
                                                            </span>
                                                        ) : (
                                                            item.monitored && (
                                                                <span className="text-[8px] md:text-[10px] font-bold text-plex bg-plex/10 border border-plex/20 rounded md:rounded-md px-1.5 py-0.5 flex items-center gap-1 whitespace-nowrap shrink-0">
                                                                    <span className="w-1 h-1 md:w-1.5 md:h-1.5 rounded-full bg-plex animate-pulse"></span>
                                                                    {t('calendar.status.monitored')}
                                                                </span>
                                                            )
                                                        )}
                                                    </div>
                                                    <h4
                                                        className="font-bold text-xs sm:text-sm text-text leading-snug break-words group-hover:text-plex transition-colors"
                                                        title={item.title}
                                                    >
                                                        {item.title}
                                                    </h4>
                                                    <p
                                                        className="text-[10px] md:text-[12px] text-muted/80 leading-snug break-words font-medium"
                                                        title={item.subtitle}
                                                    >
                                                        {item.subtitle}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                </DashboardPanel>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="flex flex-col gap-8">
                        <DashboardPanel
                            title={t('calendar.sections.downloads', { name: activeStackLabel })}
                            subtitle={t('calendar.labels.active', { count: activeQueue.length })}
                            className="flex-grow flex flex-col"
                        >
                                {!activeStackConfigured ? (
                                    <div className="text-center py-8 bg-background/30 rounded-xl border border-white/5 text-muted text-sm flex-grow flex flex-col justify-center items-center">
                                        <DownloadCloud className="w-10 h-10 text-muted/30 mx-auto mb-2" />
                                        <p>{t('calendar.empty.notConfigured', { name: activeStackLabel })}</p>
                                    </div>
                                ) : activeQueue.length === 0 ? (
                                    <div className="text-center py-8 bg-background/30 rounded-xl border border-white/5 text-muted text-sm flex-grow flex flex-col justify-center items-center">
                                        <DownloadCloud className="w-10 h-10 text-muted/30 mx-auto mb-2" />
                                        {t('calendar.empty.noActiveDownloads', { type: isTvInstance ? t('mediaType.tv') : t('mediaType.movie') })}
                                    </div>
                                ) : (
                                    activeQueue.map((item: any) => {
                                        const downloaded = item.size - item.sizeleft;
                                        const progress = item.size > 0 ? (downloaded / item.size) * 100 : 0;

                                        return (
                                            <div key={item.id} className="bg-background/40 hover:bg-background/60 transition-all rounded-xl p-4 border border-white/5 flex flex-col gap-2">
                                                <div className="flex justify-between items-start gap-4">
                                                    <div className="flex flex-col gap-1 min-w-0">
                                                        <span className="font-bold text-sm text-text line-clamp-1 leading-snug">{item.title}</span>
                                                        <span className="text-[10px] text-muted/60 font-semibold">{item.timeleft || t('calendar.empty.unknownTime')} left</span>
                                                    </div>
                                                    <span className="text-[10px] font-bold px-2 py-0.5 bg-plex/10 text-plex rounded-md border border-plex/20 uppercase tracking-wider">{item.status}</span>
                                                </div>
                                                <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden mt-1 relative">
                                                    <div className="bg-plex h-full rounded-full transition-all duration-500" style={{ width: `${progress}%` }}></div>
                                                </div>
                                                <div className="flex justify-between text-[10px] text-muted/60 mt-0.5 font-medium">
                                                    <span>{progress.toFixed(1)}%</span>
                                                    <span>{formatBytes(downloaded)} / {formatBytes(item.size)}</span>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                        </DashboardPanel>
                    </div>

                    <div className="flex flex-col gap-4">
                        <h2 className="text-xl font-bold text-text flex items-center gap-2 mb-1">
                            {isTvInstance ? <Tv className="w-5 h-5 text-plex" /> : <Film className="w-5 h-5 text-plex" />}
                            {t('calendar.sections.status', { name: activeStackLabel })}
                        </h2>
                        {renderStatusCard(activeStackLabel, activeInstanceData)}
                    </div>

                    <DashboardPanel
                        title={t('calendar.sections.history', { name: activeStackLabel })}
                        className="flex-grow flex flex-col"
                    >
                        <div className="flex flex-col gap-3 flex-grow justify-start">
                            {!activeStackConfigured ? (
                                <div className="text-center py-12 bg-background/30 rounded-xl border border-white/5 text-muted text-sm flex-grow flex flex-col justify-center items-center">
                                    <p>{t('calendar.empty.notConfigured', { name: activeStackLabel })}</p>
                                </div>
                            ) : activeHistory.length === 0 ? (
                                <div className="text-center py-12 bg-background/30 rounded-xl border border-white/5 text-muted text-sm flex-grow flex flex-col justify-center items-center">
                                    {t('calendar.empty.noRecentHistory', { type: isTvInstance ? t('mediaType.tv') : t('mediaType.movie') })}
                                </div>
                            ) : (
                                activeHistory.map((item: any) => (
                                    <div key={item.id} className="flex items-center gap-3 bg-background/30 rounded-xl p-3 border border-white/5 hover:bg-background/50 transition-colors">
                                        <div className={`w-1 h-8 rounded-full flex-shrink-0 ${getHistoryColor(item.eventType)}`}></div>
                                        <div className="flex-grow min-w-0">
                                            <div className="font-bold text-xs text-text line-clamp-1 leading-snug">{item.title}</div>
                                            <div className="text-[10px] text-muted flex justify-between items-center mt-0.5">
                                                <span>{formatEventType(item.eventType)}</span>
                                                <span>{formatRelativeAirDate(item.date)}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </DashboardPanel>
                </div>
            </div>
        </DashboardPageShell>
    );
};

const DOWNLOADS_STATUS_FILTER_KEY = 'portal-downloads-status-filter';
const DOWNLOADS_CLIENT_FILTER_KEY = 'portal-downloads-client-filter';
const DOWNLOADS_UPLOAD_COLLAPSED_KEY = 'portal-downloads-upload-collapsed';
const DOWNLOADS_CLIENTS_COLLAPSED_KEY = 'portal-downloads-clients-collapsed';
const OPS_SNAPSHOT_COLLAPSED_KEY = 'portal-home-ops-snapshot-collapsed';
const ACTIVE_STREAMS_COLLAPSED_KEY = 'portal-home-active-streams-collapsed';
const ANALYTICS_OVERVIEW_SNAPSHOT_COLLAPSED_KEY = 'portal-analytics-overview-snapshot-collapsed';
const USERS_STATS_COLLAPSED_KEY = 'portal-users-stats-collapsed';

const downloadClientTypeLabel = (type: string, fallback = 'Download Client') => ({
    qbittorrent: 'qBittorrent',
    rdtclient: 'Real-Debrid Client',
    transmission: 'Transmission',
    bittorrent: 'BitTorrent',
    deluge: 'Deluge',
    sabnzbd: 'SABnzbd',
    nzbget: 'NZBGet',
}[String(type || '').toLowerCase()] || fallback);

const torrentUploadFileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

const isTorrentUploadFile = (file: File) => {
    const name = String(file.name || '').toLowerCase();
    const type = String(file.type || '').toLowerCase();
    return name.endsWith('.torrent') || type === 'application/x-bittorrent';
};

const collectTorrentUploadFiles = (current: File[], incoming: ArrayLike<File>) => {
    const next = [...current];
    const seen = new Set(next.map(torrentUploadFileKey));
    let skipped = 0;
    for (const file of Array.from(incoming)) {
        if (!isTorrentUploadFile(file)) {
            skipped += 1;
            continue;
        }
        const key = torrentUploadFileKey(file);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(file);
    }
    return { files: next, skipped };
};

const readStoredDownloadFilter = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    try {
        const raw = String(localStorage.getItem(key) || '').trim() as T;
        return allowed.includes(raw) ? raw : fallback;
    } catch {
        return fallback;
    }
};

export const DownloadStatusPage: React.FC<{ isAdmin?: boolean }> = ({ isAdmin = false }) => {
    const { t } = useDiscoverI18n();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [filter, setFilter] = useState<'all' | 'sonarr' | 'radarr' | 'lidarr' | 'unknown'>('all');
    const [statusFilter, setStatusFilter] = useState<'all' | 'active'>(() => (
        readStoredDownloadFilter(DOWNLOADS_STATUS_FILTER_KEY, ['all', 'active'] as const, 'active')
    ));
    const [clientFilter, setClientFilter] = useState<string>(() => {
        try {
            return String(localStorage.getItem(DOWNLOADS_CLIENT_FILTER_KEY) || 'all').trim() || 'all';
        } catch {
            return 'all';
        }
    });
    const [busyAction, setBusyAction] = useState('');
    const [uploadClientId, setUploadClientId] = useState('');
    const [uploadCategory, setUploadCategory] = useState('');
    const [torrentUrl, setTorrentUrl] = useState('');
    const [torrentFiles, setTorrentFiles] = useState<File[]>([]);
    const [fileDropActive, setFileDropActive] = useState(false);
    const [uploadBusy, setUploadBusy] = useState(false);
    const [uploadCollapsed, setUploadCollapsed] = usePersistedCollapsed(
        DOWNLOADS_UPLOAD_COLLAPSED_KEY,
        preferCollapsedOnNarrow(),
    );
    const [clientsCollapsed, setClientsCollapsed] = usePersistedCollapsed(
        DOWNLOADS_CLIENTS_COLLAPSED_KEY,
        preferCollapsedOnNarrow(),
    );
    const loadGenRef = useRef(0);
    const torrentDropDepthRef = useRef(0);

    const load = useCallback(async () => {
        const gen = ++loadGenRef.current;
        try {
            const res = await apiFetch('/api/downloads/status');
            if (gen !== loadGenRef.current) return;
            setData(res);
            setError('');
        } catch (e: any) {
            if (gen !== loadGenRef.current) return;
            setError(e.message || t('downloads.errors.loadFailed'));
        } finally {
            if (gen === loadGenRef.current) setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        void load();
    }, [load]);

    usePoll(() => { void load(); }, 15_000);

    useEffect(() => {
        try { localStorage.setItem(DOWNLOADS_STATUS_FILTER_KEY, statusFilter); } catch { /* ignore */ }
    }, [statusFilter]);

    useEffect(() => {
        try { localStorage.setItem(DOWNLOADS_CLIENT_FILTER_KEY, clientFilter); } catch { /* ignore */ }
    }, [clientFilter]);

    const allDownloads = useMemo(
        () => (Array.isArray(data?.downloads) ? data.downloads : []),
        [data],
    );

    const downloads = useMemo(() => {
        let list = allDownloads;
        if (statusFilter === 'active') list = list.filter(isActiveDownloadItem);
        if (filter !== 'all') list = list.filter((item: any) => item.source === filter);
        if (clientFilter !== 'all') list = list.filter((item: any) => String(item.clientId) === clientFilter);
        return list;
    }, [allDownloads, filter, clientFilter, statusFilter]);

    const sourceCounts = useMemo(() => {
        const base = statusFilter === 'active' ? allDownloads.filter(isActiveDownloadItem) : allDownloads;
        return {
            total: base.length,
            sonarr: base.filter((item: any) => item.source === 'sonarr').length,
            radarr: base.filter((item: any) => item.source === 'radarr').length,
            lidarr: base.filter((item: any) => item.source === 'lidarr').length,
            unknown: base.filter((item: any) => item.source === 'unknown').length,
        };
    }, [allDownloads, statusFilter]);

    const torrentClients = useMemo(() => (
        (Array.isArray(data?.clients) ? data.clients : [])
            .filter((entry: any) => !['sabnzbd', 'nzbget'].includes(String(entry?.client?.type || '').toLowerCase()))
            .map((entry: any) => entry.client)
    ), [data]);

    const clientSelectOptions = useMemo(() => {
        const clients = Array.isArray(data?.clients) ? data.clients : [];
        return [
            { label: t('downloads.filters.allClients'), value: 'all' },
            ...clients.map((entry: any) => ({
                label: entry?.client?.name || downloadClientTypeLabel(entry?.client?.type, t('downloads.labels.downloadClient')),
                value: String(entry?.client?.id || ''),
            })).filter((option: { value: string }) => option.value),
        ];
    }, [data, t]);

    useEffect(() => {
        if (clientFilter === 'all') return;
        const known = (Array.isArray(data?.clients) ? data.clients : [])
            .some((entry: any) => String(entry?.client?.id || '') === clientFilter);
        if (data && !known) setClientFilter('all');
    }, [data, clientFilter]);

    useEffect(() => {
        if (!uploadClientId && torrentClients.length > 0) setUploadClientId(String(torrentClients[0].id));
        if (uploadClientId && !torrentClients.some((client: any) => String(client.id) === uploadClientId)) {
            setUploadClientId(torrentClients[0]?.id ? String(torrentClients[0].id) : '');
        }
    }, [torrentClients, uploadClientId]);

    const formatBytes = (bytes: number) => {
        if (!bytes) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let value = Number(bytes) || 0;
        let unit = 0;
        while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
        return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
    };

    const sourceLabel = (source: string) => ({ sonarr: 'Sonarr', radarr: 'Radarr', lidarr: 'Lidarr', unknown: t('downloads.filters.other') }[source] || t('downloads.filters.other'));
    const uploadCategoryOptions = useMemo(() => {
        const seen = new Set(['']);
        const arrOptions = (Array.isArray(data?.downloadCategoryOptions) ? data.downloadCategoryOptions : [])
            .map((option: any) => ({
                label: String(option?.label || option?.value || '').trim(),
                value: String(option?.value || '').trim(),
            }))
            .filter((option: any) => {
                if (!option.value || seen.has(option.value)) return false;
                seen.add(option.value);
                return true;
            });
        return [{ label: t('downloads.upload.noCategory'), value: '' }, ...arrOptions];
    }, [data, t]);
    useEffect(() => {
        if (uploadCategory && !uploadCategoryOptions.some((option) => String(option.value) === uploadCategory)) {
            setUploadCategory('');
        }
    }, [uploadCategory, uploadCategoryOptions]);
    const downloadClientLabel = (type: string) => downloadClientTypeLabel(type, t('downloads.labels.downloadClient'));
    const downloadClientIcon = (type: string) => {
        const normalized = String(type || '').toLowerCase();
        if (normalized === 'bittorrent') return 'https://cdn.simpleicons.org/bittorrent';
        if (normalized === 'rdtclient') return 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/rdt-client.svg';
        if (['qbittorrent', 'transmission', 'deluge', 'sabnzbd', 'nzbget'].includes(normalized)) return `${STATUS_ICON_BASE}/${normalized}.svg`;
        return `${STATUS_ICON_BASE}/qbittorrent.svg`;
    };
    const isPausedDownload = (item: any) => {
        const state = String(item?.state || '').toLowerCase();
        return state.includes('pause') || state.includes('stop') || state === 'queued';
    };
    const downloadActionLabel = (action: 'pause' | 'resume' | 'remove') => t(`downloads.actions.${action}`);
    const sendDownloadControl = async (item: any, action: 'pause' | 'resume' | 'remove') => {
        const key = `${item.clientId}-${item.id}-${action}`;
        setBusyAction(key);
        try {
            await apiFetch('/api/downloads/control', {
                method: 'POST',
                body: JSON.stringify({
                    clientId: item.clientId,
                    downloadId: item.downloadId || item.hash || item.infoHash || item.id,
                    action,
                }),
            });
            await load();
        } catch (e: any) {
            setError(e.message || t('downloads.errors.actionFailed', { action: downloadActionLabel(action) }));
        } finally {
            setBusyAction('');
        }
    };
    const controlDownload = (item: any, action: 'pause' | 'resume' | 'remove') => {
        if (action === 'remove') {
            appConfirm(
                t('downloads.confirm.remove', { name: item.name, client: item.clientName }),
                () => { sendDownloadControl(item, action); },
            );
            return;
        }
        sendDownloadControl(item, action);
    };
    const addTorrentFiles = (incoming: ArrayLike<File>) => {
        const { files, skipped } = collectTorrentUploadFiles(torrentFiles, incoming);
        if (!files.length && skipped) {
            setError(t('downloads.errors.invalidTorrent'));
            return;
        }
        setTorrentFiles(files);
        if (files.length) setTorrentUrl('');
        if (skipped && files.length) setError('');
    };
    const uploadTorrent = async () => {
        const targetClientId = String(uploadClientId || '').trim();
        if (!targetClientId) {
            setError(t('downloads.errors.chooseClient'));
            return;
        }
        if (!torrentFiles.length && !torrentUrl.trim()) {
            setError(t('downloads.errors.missingSource'));
            return;
        }
        setUploadBusy(true);
        const category = String(uploadCategory || '').trim();
        try {
            if (torrentFiles.length) {
                const failedKeys: string[] = [];
                const failedNames: string[] = [];
                for (const file of torrentFiles) {
                    try {
                        const bytes = await file.arrayBuffer();
                        const params = new URLSearchParams({
                            clientId: targetClientId,
                            filename: file.name || 'upload.torrent',
                        });
                        if (category) params.set('category', category);
                        await apiFetch(`/api/downloads/add-file?${params.toString()}`, {
                            method: 'POST',
                            headers: { 'Content-Type': file.type || 'application/x-bittorrent' },
                            body: bytes,
                        });
                    } catch {
                        failedKeys.push(torrentUploadFileKey(file));
                        failedNames.push(file.name || t('downloads.upload.torrentFile'));
                    }
                }
                const added = torrentFiles.length - failedKeys.length;
                if (failedKeys.length) {
                    setError(t('downloads.errors.addPartial', {
                        added,
                        total: torrentFiles.length,
                        failed: failedNames.join(', '),
                    }));
                    if (!added) return;
                    setTorrentFiles((current) => current.filter((file) => failedKeys.includes(torrentUploadFileKey(file))));
                } else {
                    setTorrentFiles([]);
                    setError('');
                }
                setTorrentUrl('');
            } else {
                await apiFetch('/api/downloads/add-url', {
                    method: 'POST',
                    body: JSON.stringify({ clientId: targetClientId, url: torrentUrl.trim(), category }),
                });
                setTorrentUrl('');
                setTorrentFiles([]);
                setError('');
            }
            await load();
        } catch (e: any) {
            setError(e.message || t('downloads.errors.addFailed'));
        } finally {
            setUploadBusy(false);
        }
    };

    if (loading) {
        return (
            <DashboardPageShell>
                <Loader isLoading={true} />
            </DashboardPageShell>
        );
    }

    const sourceFilterMeta: Record<'all' | 'sonarr' | 'radarr' | 'lidarr' | 'unknown', { label: string; icon: React.ReactNode; glow: string }> = {
        all: { label: t('downloads.filters.all'), icon: <DownloadCloud className="h-4 w-4 text-muted" />, glow: dashboardGlowClass('plex') },
        sonarr: { label: 'Sonarr', icon: <Tv className="h-4 w-4 text-muted" />, glow: dashboardGlowClass('sky') },
        radarr: { label: 'Radarr', icon: <Film className="h-4 w-4 text-muted" />, glow: dashboardGlowClass('violet') },
        lidarr: { label: 'Lidarr', icon: <Music className="h-4 w-4 text-muted" />, glow: dashboardGlowClass('emerald') },
        unknown: { label: t('downloads.filters.other'), icon: <HardDrive className="h-4 w-4 text-muted" />, glow: dashboardGlowClass('muted') },
    };

    return (
        <DashboardPageShell>
            <DashboardHero
                accent="sky"
                eyebrow={t('downloads.page.eyebrow')}
                title={t('downloads.page.title')}
                description={t('downloads.page.description')}
                icon={<DownloadCloud className="h-3.5 w-3.5" />}
                secondaryBlob
                actions={(
                    <button
                        type="button"
                        onClick={() => void load()}
                        className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm font-semibold text-text transition hover:border-plex/40 hover:bg-white/5"
                    >
                        <RefreshCw className="h-4 w-4" />
                        {t('downloads.actions.refresh')}
                    </button>
                )}
            />

            {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 px-4 py-3 text-sm">{error}</div>}

            {isAdmin && (
                <DashboardPanel
                    title={t('downloads.upload.title')}
                    subtitle={t('downloads.upload.subtitle')}
                    collapsible
                    collapsed={uploadCollapsed}
                    onCollapsedChange={setUploadCollapsed}
                    collapseLabel={t('downloads.actions.collapse')}
                    expandLabel={t('downloads.actions.expand')}
                >
                    <div className="space-y-3">
                        <div className="flex flex-col lg:flex-row lg:items-end gap-3">
                            <div className="lg:w-56">
                                <label className="text-[10px] uppercase tracking-widest font-bold text-muted mb-1.5 block">{t('downloads.upload.client')}</label>
                                <CustomSelect
                                    value={uploadClientId}
                                    onChange={setUploadClientId}
                                    options={torrentClients.map((client: any) => ({
                                        label: client.name || downloadClientLabel(client.type),
                                        value: String(client.id),
                                    }))}
                                />
                            </div>
                            <div className="lg:w-48">
                                <label className="text-[10px] uppercase tracking-widest font-bold text-muted mb-1.5 block">{t('downloads.upload.category')}</label>
                                <CustomSelect
                                    value={uploadCategory}
                                    onChange={setUploadCategory}
                                    options={uploadCategoryOptions}
                                />
                            </div>
                            <div className="flex-1 min-w-0">
                                <label className="text-[10px] uppercase tracking-widest font-bold text-muted mb-1.5 block">{t('downloads.upload.torrentUrl')}</label>
                                <input
                                    value={torrentUrl}
                                    onChange={(e) => {
                                        setTorrentUrl(e.target.value);
                                        if (e.target.value.trim()) setTorrentFiles([]);
                                    }}
                                    placeholder="magnet:?xt=... or https://example/torrent.torrent"
                                    className="w-full px-4 py-3 rounded-lg border border-border bg-background text-text outline-none focus:border-plex focus:ring-1 focus:ring-plex transition-all text-sm"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={uploadTorrent}
                                disabled={uploadBusy || !uploadClientId || (!torrentFiles.length && !torrentUrl.trim())}
                                className="px-5 py-3 rounded-lg bg-plex text-background text-sm font-black hover:bg-plex-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {uploadBusy
                                    ? t('downloads.upload.sending')
                                    : torrentFiles.length > 1
                                        ? t('downloads.upload.addCount', { count: torrentFiles.length })
                                        : t('downloads.upload.add')}
                            </button>
                        </div>
                        <div
                            onDragEnter={(event) => {
                                event.preventDefault();
                                torrentDropDepthRef.current += 1;
                                setFileDropActive(true);
                            }}
                            onDragOver={(event) => {
                                event.preventDefault();
                                event.dataTransfer.dropEffect = 'copy';
                            }}
                            onDragLeave={(event) => {
                                event.preventDefault();
                                torrentDropDepthRef.current = Math.max(0, torrentDropDepthRef.current - 1);
                                if (torrentDropDepthRef.current === 0) setFileDropActive(false);
                            }}
                            onDrop={(event) => {
                                event.preventDefault();
                                torrentDropDepthRef.current = 0;
                                setFileDropActive(false);
                                addTorrentFiles(event.dataTransfer.files);
                            }}
                            className={`rounded-xl border border-dashed px-4 py-3 transition-colors ${
                                fileDropActive ? 'border-plex bg-plex/10' : 'border-white/15 bg-white/[0.03]'
                            }`}
                        >
                            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                                <label className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-border bg-white/[0.04] text-sm font-bold text-text hover:bg-white/10 cursor-pointer transition-colors shrink-0">
                                    <Upload className="w-4 h-4 text-plex" />
                                    {t('downloads.upload.torrentFile')}
                                    <input
                                        type="file"
                                        accept=".torrent,application/x-bittorrent"
                                        multiple
                                        className="hidden"
                                        onChange={(e) => {
                                            addTorrentFiles(e.target.files || []);
                                            e.target.value = '';
                                        }}
                                    />
                                </label>
                                <p className="text-sm text-muted">
                                    {fileDropActive
                                        ? t('downloads.upload.dropHint')
                                        : torrentFiles.length
                                            ? t('downloads.upload.selectedCount', { count: torrentFiles.length })
                                            : t('downloads.upload.torrentFileHint')}
                                </p>
                                {torrentFiles.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setTorrentFiles([])}
                                        className="sm:ml-auto text-xs font-bold text-muted hover:text-text"
                                    >
                                        {t('downloads.upload.clearFiles')}
                                    </button>
                                )}
                            </div>
                            {torrentFiles.length > 0 && (
                                <ul className="mt-3 space-y-1.5">
                                    {torrentFiles.map((file) => (
                                        <li
                                            key={torrentUploadFileKey(file)}
                                            className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
                                        >
                                            <FileText className="w-3.5 h-3.5 text-plex shrink-0" />
                                            <span className="min-w-0 truncate font-semibold">{file.name}</span>
                                            <span className="text-[11px] text-muted shrink-0">{formatBytes(file.size)}</span>
                                            <button
                                                type="button"
                                                title={t('downloads.upload.removeFile', { name: file.name })}
                                                onClick={() => setTorrentFiles((current) => current.filter((entry) => torrentUploadFileKey(entry) !== torrentUploadFileKey(file)))}
                                                className="ml-auto rounded-md p-1 text-muted hover:text-text hover:bg-white/10"
                                            >
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                </DashboardPanel>
            )}

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {(['all', 'sonarr', 'radarr', 'lidarr', 'unknown'] as const).map((key) => {
                    const meta = sourceFilterMeta[key];
                    const active = filter === key;
                    return (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setFilter(key)}
                            className={`rounded-2xl text-left transition ${active ? 'ring-2 ring-plex/40 ring-offset-2 ring-offset-background' : 'opacity-90 hover:opacity-100'}`}
                        >
                            <DashboardStatCard
                                label={key === 'all' ? t('downloads.filters.all') : sourceLabel(key)}
                                value={key === 'all' ? sourceCounts.total : sourceCounts[key]}
                                icon={meta.icon}
                                glow={active ? meta.glow : dashboardGlowClass('muted')}
                            />
                        </button>
                    );
                })}
            </div>

            <div className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-background/90 backdrop-blur-md border-b border-white/5 lg:static lg:border-0 lg:bg-transparent lg:backdrop-blur-none lg:py-0">
                <div className="flex flex-col sm:flex-row gap-3 sm:items-end rounded-2xl border border-white/10 bg-background/50 p-3 lg:p-4">
                    <div className="flex-1 min-w-0 sm:max-w-xs">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-muted mb-1.5 block">{t('downloads.filters.client')}</label>
                        <CustomSelect
                            value={clientFilter}
                            onChange={setClientFilter}
                            options={clientSelectOptions}
                        />
                    </div>
                    <div className="sm:w-auto">
                        <p className="text-[10px] uppercase tracking-widest font-bold text-muted mb-1.5">{t('downloads.filters.show')}</p>
                        <div className="inline-flex rounded-xl border border-white/10 bg-black/20 p-1">
                            {([
                                { id: 'active', label: t('downloads.filters.activeOnly') },
                                { id: 'all', label: t('downloads.filters.all') },
                            ] as const).map((option) => {
                                const selected = statusFilter === option.id;
                                return (
                                    <button
                                        key={option.id}
                                        type="button"
                                        onClick={() => setStatusFilter(option.id)}
                                        className={`px-3 py-2 rounded-lg text-xs font-bold transition-colors ${selected ? 'bg-plex text-background' : 'text-muted hover:text-text'}`}
                                    >
                                        {option.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <p className="text-xs text-muted sm:ml-auto sm:pb-2">
                        {t('downloads.filters.shown', { count: downloads.length })}
                        {statusFilter === 'active' ? ` · ${t('downloads.filters.hidingCompleted')}` : ''}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <DashboardPanel
                    title={t('downloads.labels.clients')}
                    className="order-2 lg:order-2"
                    collapsible
                    collapsed={clientsCollapsed}
                    onCollapsedChange={setClientsCollapsed}
                    collapseLabel={t('downloads.actions.collapse')}
                    expandLabel={t('downloads.actions.expand')}
                >
                    <div className="space-y-3">
                        {(data?.clients || []).length === 0 ? (
                            <p className="text-sm text-muted">{t('downloads.empty.noClients')}</p>
                        ) : data.clients.map((client: any) => {
                            const activeClientFilter = clientFilter === String(client.client.id);
                            const clientItems = allDownloads.filter((item: any) => String(item.clientId) === String(client.client.id));
                            const visibleCount = statusFilter === 'active'
                                ? clientItems.filter(isActiveDownloadItem).length
                                : clientItems.length;
                            return (
                            <button
                                key={client.client.id}
                                type="button"
                                onClick={() => setClientFilter(activeClientFilter ? 'all' : String(client.client.id))}
                                className={`w-full rounded-xl border p-3 text-left transition-colors ${activeClientFilter ? 'border-plex bg-plex/10' : 'border-white/5 bg-background/40 hover:bg-white/[0.06]'}`}
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <span className="inline-flex w-8 h-8 rounded-lg bg-white/5 border border-white/10 items-center justify-center overflow-hidden shrink-0">
                                            <img src={downloadClientIcon(client.client.type)} alt="" className="w-5 h-5 object-contain" />
                                        </span>
                                        <div className="min-w-0">
                                            <p className="font-bold text-text truncate">{client.client.name || downloadClientLabel(client.client.type)}</p>
                                            <p className="text-[11px] text-muted">{downloadClientLabel(client.client.type)} · {t('downloads.labels.downloadCount', { count: visibleCount })}</p>
                                        </div>
                                    </div>
                                    <span className={`w-2.5 h-2.5 rounded-full ${client.online ? 'bg-green-500' : 'bg-red-500'}`} />
                                </div>
                                {client.error && <p className="text-xs text-red-300 mt-2">{client.error}</p>}
                            </button>
                        );})}
                    </div>
                    {clientFilter !== 'all' && (
                        <button type="button" onClick={() => setClientFilter('all')} className="mt-3 text-xs font-bold text-plex hover:underline">
                            {t('downloads.actions.clearClientFilter')}
                        </button>
                    )}
                </DashboardPanel>
                <DashboardPanel
                    title={statusFilter === 'active' ? t('downloads.status.activeDownloads') : t('downloads.status.downloads')}
                    className="lg:col-span-2 order-1 lg:order-1"
                >
                    <div className="space-y-3">
                        {downloads.length === 0 ? (
                            <div className="text-center py-12 text-muted bg-background/30 rounded-xl border border-white/5">{t('downloads.empty.noFilterResults')}</div>
                        ) : downloads.map((item: any) => {
                            const paused = isPausedDownload(item);
                            const actionKey = `${item.clientId}-${item.id}`;
                            return (
                            <div key={`${item.clientId}-${item.id}`} className="rounded-xl border border-white/5 bg-background/40 p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        <p className="font-bold text-text break-all leading-snug">{item.name}</p>
                                        <p className="text-xs text-muted mt-1 flex items-center gap-1.5 min-w-0">
                                            <img src={downloadClientIcon(item.clientType)} alt="" className="w-3.5 h-3.5 object-contain shrink-0 opacity-80" />
                                            <span className="min-w-0">
                                                {item.clientName} · {sourceLabel(item.source)}
                                                {item.arrInstanceName ? ` · ${item.arrInstanceName}` : ''}
                                                {' · '}
                                                {item.state || t('downloads.status.unknown')}
                                            </span>
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <span className="text-sm font-black text-plex">{Math.round(item.progress || 0)}%</span>
                                        {isAdmin && (
                                            <div className="flex items-center gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => controlDownload(item, paused ? 'resume' : 'pause')}
                                                    disabled={busyAction.startsWith(actionKey)}
                                                    title={paused ? t('downloads.actions.resume') : t('downloads.actions.pause')}
                                                    className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-text hover:border-plex/40 hover:text-plex disabled:opacity-50 transition-colors"
                                                >
                                                    {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => controlDownload(item, 'remove')}
                                                    disabled={busyAction.startsWith(actionKey)}
                                                    title={t('downloads.actions.remove')}
                                                    className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-red-500/20 bg-red-500/10 text-red-200 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="h-2 bg-white/5 rounded-full overflow-hidden mt-3">
                                    <div className="h-full bg-plex rounded-full" style={{ width: `${Math.max(0, Math.min(100, item.progress || 0))}%` }} />
                                </div>
                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted mt-2">
                                    <span>{formatBytes(item.downloaded)} / {formatBytes(item.size)}</span>
                                    <span>{t('downloads.labels.downSpeed', { value: `${formatBytes(item.downloadSpeed)}/s` })}</span>
                                    <span>{t('downloads.labels.upSpeed', { value: `${formatBytes(item.uploadSpeed)}/s` })}</span>
                                    {item.category && <span>{item.category}</span>}
                                    {item.sourceReason === 'arr_queue' && <span>{t('downloads.labels.matchedFromArrQueue')}</span>}
                                </div>
                            </div>
                        );})}
                    </div>
                </DashboardPanel>
            </div>
        </DashboardPageShell>
    );
};

const GRAPH_COLORS = [
    '#3b82f6', // blue
    '#10b981', // green
    '#f59e0b', // amber
    '#ef4444', // red
    '#8b5cf6', // purple
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#14b8a6', // teal
    '#f97316', // orange
    '#a855f7'  // violet
];

const TautulliGraphsTab: React.FC = () => {
    const [graphs, setGraphs] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [days, setDays] = useState('30');
    const [yAxis, setYAxis] = useState<'plays' | 'duration'>('plays');

    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);
        setError('');
        apiFetch(`/api/tautulli/graphs?days=${days}&y_axis=${yAxis}`)
            .then(data => {
                if (cancelled) return;
                setGraphs(data);
                setIsLoading(false);
            })
            .catch(err => {
                if (cancelled) return;
                setError(err.message || 'Failed to load graphs');
                setIsLoading(false);
            });
        return () => { cancelled = true; };
    }, [days, yAxis]);

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-64 glass-card-sm mt-6">
                <RefreshCw className="w-8 h-8 text-plex animate-spin" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-500/10 border border-red-500 text-red-500 p-4 rounded-xl mt-6 flex items-center gap-3">
                <AlertCircle className="w-6 h-6" />
                <span>{error}</span>
            </div>
        );
    }

    if (!graphs || Object.keys(graphs).length === 0) {
        return null;
    }

    const {
        get_plays_by_date,
        get_plays_by_dayofweek,
        get_plays_by_hourofday,
        get_plays_by_stream_type,
        get_plays_by_stream_resolution,
        get_plays_by_top_10_platforms,
        get_concurrent_streams_by_stream_type,
        get_plays_by_source_resolution,
        get_plays_by_top_10_users
    } = graphs;

    const parseDateData = (data: any) => {
        if (!data || !data.categories || !data.series) return [];
        return data.categories.map((date: string, i: number) => {
            const obj: any = { date };
            data.series.forEach((s: any) => {
                let val = s.data[i] || 0;
                if (yAxis === 'duration') {
                    // Convert seconds to hours, rounded to 1 decimal place
                    val = parseFloat((val / 3600).toFixed(1));
                }
                obj[s.name] = val;
            });
            return obj;
        });
    };

    const parseConcurrentData = (data: any) => {
        if (!data || !data.categories || !data.series) return [];
        return data.categories.map((date: string, i: number) => {
            const obj: any = { date };
            data.series.forEach((s: any) => {
                obj[s.name] = s.data[i] || 0;
            });
            return obj;
        });
    };

    const getSeriesKeys = (data: any) => {
        if (!data || !data.series) return [];
        return data.series.map((s: any) => s.name);
    };

    const STREAM_COLORS: Record<string, string> = {
        'Direct Play': '#eab308',
        'Direct Stream': '#e2e8f0',
        'Transcode': '#ef4444'
    };

    const dailyData = parseDateData(get_plays_by_date);
    const dayOfWeekData = parseDateData(get_plays_by_dayofweek);
    const hourOfDayData = parseDateData(get_plays_by_hourofday);

    const streamTypeData = parseDateData(get_plays_by_stream_type);
    const streamTypeKeys = getSeriesKeys(get_plays_by_stream_type);

    const concurrentData = parseConcurrentData(get_concurrent_streams_by_stream_type);
    const concurrentKeys = getSeriesKeys(get_concurrent_streams_by_stream_type);

    const resolutionData = parseDateData(get_plays_by_stream_resolution);
    const resolutionKeys = getSeriesKeys(get_plays_by_stream_resolution);

    const platformData = parseDateData(get_plays_by_top_10_platforms);
    const platformKeys = getSeriesKeys(get_plays_by_top_10_platforms);

    const sourceResolutionData = parseDateData(get_plays_by_source_resolution);
    const sourceResolutionKeys = getSeriesKeys(get_plays_by_source_resolution);

    const topUsersData = parseDateData(get_plays_by_top_10_users);
    const topUsersKeys = getSeriesKeys(get_plays_by_top_10_users);

    return (
        <div className="space-y-6 mt-6 min-w-0">
            <div className="flex flex-col sm:flex-row justify-between items-end sm:items-center gap-4">
                {/* Y-Axis Toggle */}
                <div className="flex bg-black/40 rounded-lg p-1 border border-white/5 w-fit">
                    <button onClick={() => setYAxis('plays')} className={`px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-colors ${yAxis === 'plays' ? 'bg-plex text-white shadow-lg' : 'text-muted hover:text-white'}`}>
                        Play Count
                    </button>
                    <button onClick={() => setYAxis('duration')} className={`px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-colors ${yAxis === 'duration' ? 'bg-plex text-white shadow-lg' : 'text-muted hover:text-white'}`}>
                        Watch Duration
                    </button>
                </div>
                {/* Timeframe selector */}
                <div className="w-48">
                    <CustomSelect
                        value={days}
                        onChange={setDays}
                        options={[
                            { label: 'Last 7 Days', value: '7' },
                            { label: 'Last 30 Days', value: '30' },
                            { label: 'Last 90 Days', value: '90' },
                            { label: 'Last 365 Days', value: '365' },
                            { label: 'All Time', value: '0' }
                        ]}
                    />
                </div>
            </div>

            {/* Daily Play Count by Media Type */}
            <div className="glass-card-sm p-4 md:p-6 relative overflow-hidden">
                <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2">
                    <LucideLineChart className="w-5 h-5 text-[#3b82f6]" /> {yAxis === 'plays' ? 'Daily Play Count by Media Type' : 'Daily Watch Duration by Media Type (Hours)'}
                </h3>
                <div className="h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={dailyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                            <XAxis dataKey="date" stroke="#666" tick={{ fill: '#888', fontSize: 12 }} tickMargin={10} minTickGap={20} />
                            <YAxis stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                            <RechartsTooltip contentStyle={{ backgroundColor: '#1e2329', borderColor: '#333', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} />
                            <Legend wrapperStyle={{ paddingTop: '20px' }} />
                            <Line type="monotone" dataKey="TV" stroke="#eab308" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="Movies" stroke="#3b82f6" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="Music" stroke="#ef4444" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="Total" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Play count by day of week */}
                <div className="glass-card-sm p-4 md:p-6 relative overflow-hidden">
                    <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2">
                        <Calendar className="w-5 h-5 text-green-400" /> {yAxis === 'plays' ? 'Play Count by Day of Week' : 'Watch Duration by Day of Week (Hours)'}
                    </h3>
                    <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={dayOfWeekData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                <XAxis dataKey="date" stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                <YAxis stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                <RechartsTooltip cursor={{ fill: '#ffffff10' }} contentStyle={{ backgroundColor: '#1e2329', borderColor: '#333', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} />
                                <Legend />
                                <Bar dataKey="TV" stackId="a" fill="#eab308" />
                                <Bar dataKey="Movies" stackId="a" fill="#3b82f6" />
                                <Bar dataKey="Music" stackId="a" fill="#ef4444" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Play count by hour of day */}
                <div className="glass-card-sm p-4 md:p-6 relative overflow-hidden">
                    <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2">
                        <Clock className="w-5 h-5 text-orange-400" /> {yAxis === 'plays' ? 'Play Count by Hour of Day' : 'Watch Duration by Hour of Day (Hours)'}
                    </h3>
                    <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={hourOfDayData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                <XAxis dataKey="date" stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                <YAxis stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                <RechartsTooltip cursor={{ fill: '#ffffff10' }} contentStyle={{ backgroundColor: '#1e2329', borderColor: '#333', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} />
                                <Legend />
                                <Bar dataKey="TV" stackId="a" fill="#eab308" />
                                <Bar dataKey="Movies" stackId="a" fill="#3b82f6" />
                                <Bar dataKey="Music" stackId="a" fill="#ef4444" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Play count by stream type */}
                <div className="glass-card-sm p-4 md:p-6 relative overflow-hidden">
                    <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2">
                        <Activity className="w-5 h-5 text-sky-400" /> {yAxis === 'plays' ? 'Daily Stream Type Breakdown' : 'Daily Stream Type Duration Breakdown (Hours)'}
                    </h3>
                    <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={streamTypeData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                <XAxis dataKey="date" stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                <YAxis stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                <RechartsTooltip contentStyle={{ backgroundColor: '#1e2329', borderColor: '#333', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} />
                                <Legend />
                                {streamTypeKeys.map((key: string) => (
                                    <Line key={key} type="monotone" dataKey={key} stroke={STREAM_COLORS[key] || '#3b82f6'} strokeWidth={2} dot={false} />
                                ))}
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Concurrent streams by stream type */}
                <div className="glass-card-sm p-4 md:p-6 relative overflow-hidden">
                    <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-plex" /> Daily Concurrent Stream Count by Stream Type
                    </h3>
                    <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={concurrentData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                <XAxis dataKey="date" stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                <YAxis stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                <RechartsTooltip contentStyle={{ backgroundColor: '#1e2329', borderColor: '#333', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} />
                                <Legend />
                                {concurrentKeys.map((key: string) => (
                                    <Line key={key} type="monotone" dataKey={key} stroke={STREAM_COLORS[key] || '#3b82f6'} strokeWidth={2} dot={false} />
                                ))}
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Play count by stream resolution */}
                <div className="glass-card-sm p-4 md:p-6 relative overflow-hidden">
                    <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2">
                        <MonitorSmartphone className="w-5 h-5 text-purple-400" /> {yAxis === 'plays' ? 'Stream Resolution Breakdown' : 'Stream Resolution Duration Breakdown (Hours)'}
                    </h3>
                    <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={resolutionData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                <XAxis dataKey="date" stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                <YAxis stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                <RechartsTooltip cursor={{ fill: '#ffffff10' }} contentStyle={{ backgroundColor: '#1e2329', borderColor: '#333', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} />
                                <Legend />
                                {resolutionKeys.map((key: string, idx: number) => (
                                    <Bar key={key} dataKey={key} stackId="a" fill={GRAPH_COLORS[idx % GRAPH_COLORS.length]} />
                                ))}
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Play count by platform */}
                <div className="glass-card-sm p-4 md:p-6 relative overflow-hidden flex flex-col justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2">
                            <Users className="w-5 h-5 text-teal-400" /> {yAxis === 'plays' ? 'Top 10 Streaming Platforms' : 'Top 10 Platforms by Watch Duration (Hours)'}
                        </h3>
                        <div className="h-64 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={platformData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                    <XAxis dataKey="date" stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                    <YAxis stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                    <RechartsTooltip cursor={{ fill: '#ffffff10' }} contentStyle={{ backgroundColor: '#1e2329', borderColor: '#333', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} />
                                    <Legend />
                                    {platformKeys.map((key: string, idx: number) => (
                                        <Bar key={key} dataKey={key} stackId="a" fill={GRAPH_COLORS[idx % GRAPH_COLORS.length]} />
                                    ))}
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Play count by source resolution */}
                <div className="glass-card-sm p-4 md:p-6 relative overflow-hidden">
                    <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2">
                        <Layers className="w-5 h-5 text-indigo-400" /> {yAxis === 'plays' ? 'Source File Resolution Breakdown' : 'Source File Resolution Duration Breakdown (Hours)'}
                    </h3>
                    <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={sourceResolutionData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                <XAxis dataKey="date" stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                <YAxis stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                <RechartsTooltip cursor={{ fill: '#ffffff10' }} contentStyle={{ backgroundColor: '#1e2329', borderColor: '#333', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} />
                                <Legend />
                                {sourceResolutionKeys.map((key: string, idx: number) => (
                                    <Bar key={key} dataKey={key} stackId="a" fill={GRAPH_COLORS[idx % GRAPH_COLORS.length]} />
                                ))}
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Play count by top 10 users */}
                <div className="glass-card-sm p-4 md:p-6 relative overflow-hidden flex flex-col justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-text mb-4 uppercase tracking-wider flex items-center gap-2">
                            <Trophy className="w-5 h-5 text-amber-400" /> {yAxis === 'plays' ? 'Top 10 Active Users Breakdown' : 'Top 10 Users by Watch Duration (Hours)'}
                        </h3>
                        <div className="h-64 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={topUsersData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                    <XAxis dataKey="date" stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                    <YAxis stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                    <RechartsTooltip cursor={{ fill: '#ffffff10' }} contentStyle={{ backgroundColor: '#1e2329', borderColor: '#333', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} />
                                    <Legend />
                                    {topUsersKeys.map((key: string, idx: number) => (
                                        <Bar key={key} dataKey={key} stackId="a" fill={GRAPH_COLORS[idx % GRAPH_COLORS.length]} />
                                    ))}
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const ServerInsightsWidget: React.FC<{
    peakHours: number[],
    tautulliData: any,
    compare: any,
    analyticsSourceLabel: string,
    peakDate?: string,
    setPeakDate: (date: string) => void,
    peakDateData?: number[] | null,
    peakDateLoading?: boolean,
    isJellyfinPortal?: boolean,
    periodPlays?: number,
    uniqueViewers?: number,
}> = ({ peakHours, tautulliData, compare, analyticsSourceLabel, peakDate, setPeakDate, peakDateData, peakDateLoading, isJellyfinPortal = false, periodPlays = 0, uniqueViewers = 0 }) => {
    
    // Format chart data
    const activePeakHours = peakDateData || peakHours;
    const chartData = activePeakHours ? activePeakHours.map((count, hour) => {
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const h = hour % 12 || 12;
        return {
            time: `${h}${ampm}`,
            plays: count
        };
    }) : [];
    const statsAreJellystatTotals = isJellyfinPortal && tautulliData?.playbackMethodStatsAreTotals;
    const displayPeriodPlays = compare?.totalPlaybacks?.current ?? periodPlays ?? tautulliData?.totalPlays ?? 0;
    const displayUniqueViewers = compare?.uniqueViewers?.current ?? uniqueViewers ?? 0;
    const displayWatchTime = tautulliData?.totalTimeStr || (isJellyfinPortal ? 'Unavailable' : '0 mins');

    const formatChange = (data: any) => {
        if (!data || data.percent === null) return null;
        const isPos = data.percent > 0;
        const color = isPos ? 'text-green-500' : (data.percent < 0 ? 'text-red-500' : 'text-muted');
        const icon = isPos ? '↑' : (data.percent < 0 ? '↓' : '');
        return <span className={`text-xs font-bold ${color} ml-2`}>{icon}{Math.abs(data.percent)}%</span>;
    };

    return (
        <div className="w-full flex flex-col gap-6 lg:col-span-2">
            <h2 className="text-xl font-bold text-text uppercase tracking-wider flex items-center gap-2">
                <Activity className="text-plex w-5 h-5" /> Server Insights & Load
            </h2>

            {/* Peak Hours Chart */}
            <div className="glass-card-sm p-4 md:p-6 w-full flex flex-col flex-1 relative">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                    <h3 className="text-sm font-bold text-muted uppercase tracking-wider flex items-center gap-2">
                        <Clock className="w-4 h-4" /> Peak Playback Hours
                    </h3>
                    <div className="flex items-center gap-2 relative z-10">
                        {peakDate && (
                            <button onClick={() => setPeakDate('')} className="text-xs text-muted hover:text-white" title="Clear specific date view">
                                <X className="w-4 h-4" />
                            </button>
                        )}
                        <input 
                            type="date" 
                            value={peakDate} 
                            onChange={(e) => setPeakDate(e.target.value)} 
                            max={new Date().toISOString().split('T')[0]}
                            className="bg-black/40 border border-white/5 rounded-md px-2 py-1 text-xs text-white outline-none focus:border-plex transition-colors"
                        />
                    </div>
                </div>
                <div className="w-full h-[250px] sm:h-[320px] relative">
                    {peakDateLoading && (
                        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm z-10 flex items-center justify-center rounded-xl">
                            <Loader2 className="w-8 h-8 text-plex animate-spin" />
                        </div>
                    )}
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorPlays" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#e5a00d" stopOpacity={0.4}/>
                                    <stop offset="95%" stopColor="#e5a00d" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                            <XAxis dataKey="time" stroke="#ffffff40" fontSize={10} tickMargin={10} minTickGap={15} />
                            <YAxis stroke="#ffffff40" fontSize={10} tickFormatter={(val) => val} />
                            <RechartsTooltip 
                                contentStyle={{ backgroundColor: '#111315', borderColor: '#ffffff20', borderRadius: '8px', color: '#fff', fontSize: '12px', fontWeight: 'bold' }}
                                itemStyle={{ color: '#e5a00d' }}
                                formatter={(value: any) => [`${value} plays`, 'Activity']}
                            />
                            <Area type="monotone" dataKey="plays" stroke="#e5a00d" strokeWidth={3} fillOpacity={1} fill="url(#colorPlays)" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Server Records Grid */}
            {tautulliData && (
                <div className="glass-card-sm p-4 md:p-6 w-full flex flex-col relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-3 opacity-5 pointer-events-none">
                        <Activity className="w-48 h-48 text-[#3b82f6]" />
                    </div>
                    <h3 className="text-sm font-bold text-muted uppercase tracking-wider mb-4 flex items-center gap-2 relative z-10">
                        <Activity className="w-4 h-4 text-[#3b82f6]" /> {analyticsSourceLabel} Records & Period Stats
                    </h3>
                    <div className="grid grid-cols-2 gap-3 relative z-10">
                        {!isJellyfinPortal ? (
                            <div className="flex flex-col p-3 bg-black/20 rounded-lg border border-white/5 shadow-inner">
                                <span className="font-bold text-muted text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5"><Users className="w-3 h-3 text-[#3b82f6]"/> Peak Streams</span>
                                <p className="text-xl font-black text-[#3b82f6]">{tautulliData?.streamsRecord || 0} <span className="text-[9px] font-normal text-muted">concurrent</span></p>
                            </div>
                        ) : (
                            <div className="flex flex-col p-3 bg-black/20 rounded-lg border border-white/5 shadow-inner">
                                <span className="font-bold text-muted text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5"><Users className="w-3 h-3 text-[#3b82f6]"/> Active Streams</span>
                                <p className="text-xl font-black text-[#3b82f6]">{tautulliData?.activeStreams || 0} <span className="text-[9px] font-normal text-muted">now</span></p>
                            </div>
                        )}
                        <div className="flex flex-col p-3 bg-black/20 rounded-lg border border-white/5 shadow-inner">
                            <span className="font-bold text-muted text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5"><Clock className="w-3 h-3 text-green-400"/> Watch Time</span>
                            <p className="text-base font-black text-green-400 leading-tight">{displayWatchTime}</p>
                        </div>
                        <div className="flex flex-col p-3 bg-black/20 rounded-lg border border-white/5 shadow-inner">
                            <span className="font-bold text-muted text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5"><TrendingUp className="w-3 h-3 text-yellow-400"/> Period Plays</span>
                            <p className="text-xl font-black text-yellow-400 flex items-center">{displayPeriodPlays.toLocaleString()} {formatChange(compare?.totalPlaybacks)}</p>
                        </div>
                        <div className="flex flex-col p-3 bg-black/20 rounded-lg border border-white/5 shadow-inner">
                            <span className="font-bold text-muted text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5"><Users className="w-3 h-3 text-pink-400"/> Unique Viewers</span>
                            <p className="text-xl font-black text-pink-400 flex items-center">{displayUniqueViewers.toLocaleString()} {formatChange(compare?.uniqueViewers)}</p>
                        </div>
                        <div className="flex flex-col p-3 bg-black/20 rounded-lg border border-white/5 shadow-inner">
                            <span className="font-bold text-muted text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5"><Monitor className="w-3 h-3 text-cyan-400" /> {statsAreJellystatTotals ? 'Direct Plays' : 'Peak Direct Plays'}</span>
                            <p className="font-mono font-black text-cyan-400 text-xl">{tautulliData?.directPlayRecord || 0}</p>
                        </div>
                        <div className="flex flex-col p-3 bg-black/20 rounded-lg border border-white/5 shadow-inner">
                            <span className="font-bold text-muted text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5"><Activity className="w-3 h-3 text-orange-400" /> {statsAreJellystatTotals ? 'Direct Streams' : 'Peak Direct Streams'}</span>
                            <p className="font-mono font-black text-orange-400 text-xl">{tautulliData?.directStreamRecord || 0}</p>
                        </div>
                        <div className="flex flex-col p-3 bg-black/20 rounded-lg border border-white/5 shadow-inner">
                            <span className="font-bold text-muted text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5"><Settings className="w-3 h-3 text-rose-400" /> {statsAreJellystatTotals ? 'Transcodes' : 'Peak Transcodes'}</span>
                            <p className="font-mono font-black text-rose-400 text-xl">{tautulliData?.transcodeRecord || 0}</p>
                        </div>
                        <div className="flex flex-col p-3 bg-black/20 rounded-lg border border-white/5 shadow-inner">
                            <span className="font-bold text-muted text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5"><PlaySquare className="w-3 h-3 text-purple-400" /> TV Shows Played</span>
                            <p className="font-mono font-black text-purple-400 text-xl">{tautulliData?.tvPlays ? tautulliData.tvPlays.toLocaleString() : 0}</p>
                        </div>
                        <div className="flex flex-col p-3 bg-black/20 rounded-lg border border-white/5 shadow-inner">
                            <span className="font-bold text-muted text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5"><Film className="w-3 h-3 text-red-400" /> Movies Played</span>
                            <p className="font-mono font-black text-red-400 text-xl">{tautulliData?.moviePlays ? tautulliData.moviePlays.toLocaleString() : 0}</p>
                        </div>
                        <div className="flex flex-col p-3 bg-black/20 rounded-lg border border-white/5 shadow-inner">
                            <span className="font-bold text-muted text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5"><Music className="w-3 h-3 text-emerald-400" /> Music Played</span>
                            <p className="font-mono font-black text-emerald-400 text-xl">{tautulliData?.musicPlays ? tautulliData.musicPlays.toLocaleString() : 0}</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const LibraryDeltaBadge: React.FC<{ value?: number }> = ({ value }) => {
    if (!value) return null;
    const isPos = value > 0;
    return (
        <span 
            className={`text-sm font-bold ml-2 ${isPos ? 'text-green-500' : 'text-red-500'} animate-[fade-in_0.5s_ease-out] cursor-help`}
            title="Change since the previous complete library scan"
        >
            {isPos ? '+' : ''}{value.toLocaleString()}
        </span>
    );
};

const formatCatalogScanAge = (generatedAt?: number | string | null) => {
    const n = typeof generatedAt === 'number' ? generatedAt : Date.parse(String(generatedAt || ''));
    if (!Number.isFinite(n) || n <= 0) return null;
    return formatPortalDateTime(n);
};
const AnimatedLeaderboard: React.FC<{ users: any[], resolveAvatar: (thumb: string | null | undefined, w?: number, h?: number) => string, isAdmin: boolean, onUserClick: (u: any) => void }> = ({ users, resolveAvatar, onUserClick }) => {
    const prevUsersRef = useRef<any[]>([]);
    
    useEffect(() => {
        prevUsersRef.current = users;
    }, [users]);

    const prevUsers = prevUsersRef.current;
    
    if (!users || users.length === 0) return null;

    const maxPlays = Math.max(...users.map(u => u.plays || 0), 1);

    const top3 = users.slice(0, 3);
    const rest = users.slice(3, 10);

    const getRankDelta = (userId: string, currentRank: number) => {
        if (!prevUsers || prevUsers.length === 0) return null;
        const prevIdx = prevUsers.findIndex(u => u.id === userId);
        if (prevIdx === -1) return { type: 'new' };
        const diff = prevIdx - (currentRank - 1);
        if (diff > 0) return { type: 'up', val: diff };
        if (diff < 0) return { type: 'down', val: Math.abs(diff) };
        return null;
    };

    const renderPodiumCard = (user: any, rank: number) => {
        const delta = getRankDelta(user.id, rank);
        const isFirst = rank === 1;
        const heightClass = isFirst ? 'h-48' : 'h-40';
        const ringClass = isFirst ? 'ring-2 ring-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.3)]' : rank === 2 ? 'ring-1 ring-slate-300' : 'ring-1 ring-amber-700';
        
        return (
            <div onClick={() => onUserClick(user)} className={`flex flex-col items-center justify-end bg-card/80 border border-border rounded-xl p-4 relative cursor-pointer hover:bg-white/5 transition-all group w-full ${heightClass} ${ringClass}`}>
                {isFirst && <div className="absolute -top-6 text-4xl animate-[crown-pulse_2s_ease-in-out_infinite]">👑</div>}
                {!isFirst && <div className="absolute -top-4 text-3xl">{rank === 2 ? '🥈' : '🥉'}</div>}
                
                <img src={resolveAvatar(user.thumb, 80, 80)} alt={user.username} onError={(e) => { (e.target as HTMLImageElement).src = logoUrl(); }} className={`rounded-full object-cover mb-2 border-2 ${isFirst ? 'w-20 h-20 border-yellow-500' : 'w-16 h-16 border-border'} bg-card`} />
                <span className="font-bold text-text group-hover:text-plex transition-colors truncate w-full text-center">{user.username}</span>
                <span className="text-xs text-muted font-mono mt-1">{user.plays} plays</span>
                
                {delta && (
                    <div className="absolute -right-2 -top-2">
                        {delta.type === 'new' && <span className="bg-plex text-black text-[9px] font-bold px-1.5 py-0.5 rounded-full animate-[rank-up_0.3s_ease-out]">NEW</span>}
                        {delta.type === 'up' && <span className="bg-green-500/20 text-green-400 text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center animate-[rank-up_0.3s_ease-out]">↑{delta.val}</span>}
                        {delta.type === 'down' && <span className="bg-red-500/20 text-red-400 text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center animate-[rank-down_0.3s_ease-out]">↓{delta.val}</span>}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="w-full flex flex-col gap-4">
            <h2 className="text-xl font-bold text-text uppercase tracking-wider flex items-center gap-2">
                <Trophy className="text-plex w-5 h-5" /> Hall of Fame
            </h2>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Podium */}
                {top3.length > 0 && (
                    <div className="lg:col-span-1 flex flex-col justify-center h-full pt-8 lg:pt-0">
                        <div className="flex items-end justify-center gap-2 sm:gap-4">
                            {top3[1] && <div className="flex-1 max-w-[120px]">{renderPodiumCard(top3[1], 2)}</div>}
                            <div className="flex-1 max-w-[140px] z-10">{renderPodiumCard(top3[0], 1)}</div>
                            {top3[2] && <div className="flex-1 max-w-[120px]">{renderPodiumCard(top3[2], 3)}</div>}
                        </div>
                    </div>
                )}

                {/* List */}
                <div className="lg:col-span-2 flex flex-col gap-2 justify-center">
                    {rest.map((user, idx) => {
                        const rank = idx + 4;
                        const delta = getRankDelta(user.id, rank);
                        const pct = Math.max(2, (user.plays / maxPlays) * 100);
                        const hasFire = user.plays >= (maxPlays * 0.4) && user.plays > 0;

                        return (
                            <div key={user.id} onClick={() => onUserClick(user)} className="flex items-center gap-3 sm:gap-4 bg-black/20 p-2 sm:p-3 rounded-lg border border-border/50 cursor-pointer hover:bg-black/40 hover:border-plex/50 transition-colors group relative overflow-hidden">
                                <div className="absolute left-0 top-0 bottom-0 bg-plex/10 animate-[bar-grow_1s_ease-out]" style={{ width: `${pct}%` }}></div>
                                
                                <div className="w-6 text-center font-bold text-muted group-hover:text-text z-10">#{rank}</div>
                                <img src={resolveAvatar(user.thumb, 40, 40)} onError={(e) => { (e.target as HTMLImageElement).src = logoUrl(); }} className="w-8 h-8 rounded-full border border-border z-10 bg-card flex-shrink-0" />
                                
                                <div className="flex-1 flex items-center gap-2 z-10 min-w-0">
                                    <span className="font-bold text-text truncate group-hover:text-plex transition-colors">{user.username}</span>
                                    {hasFire && <span className="text-sm" title="Hot Streak!">🔥</span>}
                                </div>

                                <div className="flex items-center gap-3 z-10 flex-shrink-0">
                                    {delta && (
                                        <div className="w-8 sm:w-10 text-right">
                                            {delta.type === 'new' && <span className="bg-plex/20 text-plex text-[9px] font-bold px-1.5 py-0.5 rounded animate-[rank-up_0.3s_ease-out]">NEW</span>}
                                            {delta.type === 'up' && <span className="text-green-400 text-xs font-bold animate-[rank-up_0.3s_ease-out]">↑{delta.val}</span>}
                                            {delta.type === 'down' && <span className="text-red-400 text-xs font-bold animate-[rank-down_0.3s_ease-out]">↓{delta.val}</span>}
                                        </div>
                                    )}
                                    <div className="w-16 sm:w-20 text-right font-mono text-xs sm:text-sm whitespace-nowrap">
                                        <CountUp end={user.plays} /> <span className="text-muted hidden sm:inline">plays</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
const DetailsModal: React.FC<{ item: any, onClose: () => void }> = ({ item, onClose }) => {
    const [details, setDetails] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    
    useEffect(() => {
        if (!item) return;
        const fetchDetails = async () => {
            try {
                // Robust ratingKey extraction
                let ratingKey = '';
                if (item.ratingKey) {
                    ratingKey = item.ratingKey;
                } else if (item.key) {
                    const m = String(item.key).match(/\/(\d+)$/);
                    if (m) ratingKey = m[1];
                } else if (item.plexUrl) {
                    const decoded = decodeURIComponent(item.plexUrl);
                    const match = decoded.match(/metadata\/(\d+)/);
                    if (match) ratingKey = match[1];
                }

                if (!ratingKey) {
                    console.warn('Could not extract ratingKey from item:', item);
                    setLoading(false);
                    return;
                }
                const res = await apiFetch('/api/plex/item/' + encodeURIComponent(ratingKey));
                if (res.ok) {
                    const data = await res.json();
                    if (!data.error) setDetails(data);
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetchDetails();
    }, [item]);

    if (!item) return null;

    const formatDuration = (ms: number) => {
        if (!ms) return '0m';
        const mins = Math.floor(ms / 60000);
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };

    const hasProgress = details?.viewOffset > 0 && details?.duration > 0;
    const progressPct = hasProgress ? Math.min(100, Math.max(0, (details.viewOffset / details.duration) * 100)) : 0;
    const isCompleted = details?.viewCount > 0;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 animate-fade-in backdrop-blur-sm" onClick={onClose}>
            <div className="bg-card border border-border w-full max-w-lg rounded-2xl shadow-2xl flex flex-col max-h-[85vh] animate-slide-up overflow-hidden relative isolate" onClick={e => e.stopPropagation()}>
                {/* Header with Background */}
                <div className="relative h-48 sm:h-56 flex-shrink-0 bg-black/50 border-b border-white/5 rounded-t-2xl overflow-hidden">
                    {details?.art ? (
                        <img src={resolvePortalAssetUrl(details.art)} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
                    ) : null}
                    <div className="absolute inset-0 bg-gradient-to-t from-card via-card/80 to-transparent" />
                    
                    <button onClick={onClose} className="absolute top-4 right-4 p-2 bg-black/40 hover:bg-black/60 rounded-full transition-colors text-white/70 hover:text-white z-10 border border-white/10">
                        <X className="w-5 h-5" />
                    </button>

                    <div className="absolute bottom-0 left-0 right-0 p-5 flex gap-4">
                        <div className={`w-16 sm:w-20 ${item.type === 'track' ? 'aspect-square' : 'aspect-[2/3]'} rounded-md overflow-hidden flex-shrink-0 shadow-lg border border-white/10 bg-black/50 z-10`}>
                            {details?.thumb || item.thumbUrl ? (
                                <img src={resolvePortalAssetUrl(details?.thumb || item.thumbUrl)} alt="" className="w-full h-full object-cover" />
                            ) : null}
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col justify-end pb-1 z-10">
                            <h2 className="text-xl sm:text-2xl font-bold text-white leading-tight drop-shadow-md">
                                {details?.title || item.title}
                            </h2>
                            {(details?.year || details?.grandparentTitle) && (
                                <span className="text-sm text-white/70 font-semibold drop-shadow-sm mt-1">
                                    {details?.grandparentTitle ? `${details.grandparentTitle} • ` : ''}{details?.year || ''}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="p-5 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                    {loading ? (
                        <div className="flex justify-center items-center py-12"><span className="animate-pulse text-muted font-medium">Loading details...</span></div>
                    ) : details ? (
                        <div className="space-y-6">
                            {/* Watch Progress */}
                            <div className="bg-white/5 rounded-xl p-4 border border-white/5 shadow-inner">
                                <div className="flex justify-between items-end mb-2.5">
                                    <div>
                                        <h4 className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">Watch Status</h4>
                                        <p className="text-sm font-semibold text-text">
                                            {isCompleted ? 'Completed' : hasProgress ? `Watched ${formatDuration(details.viewOffset)} of ${formatDuration(details.duration)}` : `Duration: ${formatDuration(details.duration)}`}
                                        </p>
                                    </div>
                                    {isCompleted && <div className="text-plex drop-shadow-[0_0_8px_rgba(229,160,13,0.5)]"><CheckCircle className="w-5 h-5" /></div>}
                                </div>
                                {(hasProgress || isCompleted) && (
                                    <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden">
                                        <div className="h-full bg-plex rounded-full transition-all duration-1000" style={{ width: isCompleted ? '100%' : `${progressPct}%` }} />
                                    </div>
                                )}
                            </div>

                            {/* Summary */}
                            {details.summary && (
                                <div>
                                    <h4 className="text-[10px] font-bold text-muted uppercase tracking-wider mb-2">Overview</h4>
                                    <p className="text-sm text-text/80 leading-relaxed font-medium">{details.summary}</p>
                                </div>
                            )}
                            
                            <div className="pt-2">
                                <a href={item.plexUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-sm font-bold text-text transition-colors border border-white/5 hover:border-white/10">
                                    <PlaySquare className="w-4 h-4 text-plex" /> View on Plex
                                </a>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-12 text-muted font-medium">Details not available.</div>
                    )}
                </div>
            </div>
        </div>
    );
};

const ItemViewersModal: React.FC<{
    item: { title: string, viewers: Record<string, any> } | null,
    onClose: () => void,
    resolveAvatar: (t: string|null|undefined) => string,
    onOpenProfile?: (accountId: string, username?: string) => void,
}> = ({ item, onClose, resolveAvatar, onOpenProfile }) => {
    if (!item) return null;
    const viewersArray = item.viewers
        ? Object.entries(item.viewers)
            .map(([accountId, row]: [string, any]) => ({
                ...row,
                accountId: row?.accountId || accountId,
            }))
            .sort((a: any, b: any) => (b.plays || 0) - (a.plays || 0))
        : [];
    
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 animate-fade-in backdrop-blur-sm" onClick={onClose}>
            <div className="bg-card border border-border w-full max-w-md rounded-2xl shadow-2xl flex flex-col max-h-[80vh] animate-slide-up overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-white/5 bg-black/20">
                    <h2 className="text-lg font-bold text-white pr-4 line-clamp-1 flex items-center gap-2"><PlaySquare className="w-5 h-5 text-plex" /> {item.title}</h2>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors text-muted hover:text-white flex-shrink-0">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                    {viewersArray.length === 0 ? (
                        <p className="p-4 text-center text-muted text-sm leading-relaxed">No specific viewer data available for this item yet. Viewer data will populate automatically as new views occur.</p>
                    ) : (
                        <div className="flex flex-col gap-1 p-2">
                            {viewersArray.map((v: any, i: number) => {
                                const name = String(v.username || '').trim();
                                const anonymous = !name || name.toLowerCase() === 'anonymous' || /^viewer\s+\d+$/i.test(name);
                                const canOpen = !anonymous && typeof onOpenProfile === 'function' && (v.accountId || name);
                                return (
                                <div key={v.accountId || i} className="flex items-center justify-between p-3 bg-background/50 hover:bg-white/5 rounded-xl transition-colors border border-transparent hover:border-white/5">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="w-10 h-10 rounded-full overflow-hidden bg-white/10 shadow-inner flex-shrink-0">
                                            <img src={resolveAvatar(v.thumb)} alt={name} className="w-full h-full object-cover" />
                                        </div>
                                        {canOpen ? (
                                            <button
                                                type="button"
                                                className="font-bold text-text truncate max-w-[150px] sm:max-w-[200px] hover:text-plex text-left"
                                                onClick={() => {
                                                    onOpenProfile(String(v.accountId || name), name);
                                                    onClose();
                                                }}
                                            >
                                                {name}
                                            </button>
                                        ) : (
                                            <span className="font-bold text-text truncate max-w-[150px] sm:max-w-[200px]">{name}</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1.5 bg-plex/10 text-plex px-3 py-1.5 rounded-lg text-sm font-mono font-bold shadow-sm">
                                        {v.plays} {v.plays === 1 ? 'play' : 'plays'}
                                    </div>
                                </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export const AnalyticsDashboard: React.FC<{ isAdmin: boolean, sessionInfo: any, onNavigate?: (route: string, options?: { path?: string }) => void }> = ({ isAdmin, sessionInfo, onNavigate }) => {
    const { t } = useDiscoverI18n();
    const [analyticsData, setAnalyticsData] = useState<{
        topUsers: any[],
        topLibraries: any[],
        topMovies: any[],
        topShows: any[],
        topMusic: any[],
        topDevices: any[],
        peakHours: number[],
        totalPlaybacks: number,
        totalActiveUsers?: number,
        maxConcurrentStreams: number,
        maxDirectPlays: number,
        maxTranscodes: number,
        compare?: {
            previousPeriodDays: string,
            totalPlaybacks: { absolute: number, percent: number | null, previous?: number, current?: number },
            uniqueViewers: { absolute: number, percent: number | null, previous?: number, current?: number },
            libraryPlays: { absolute: number, percent: number | null, previous?: number, current?: number }
        } | null,
        libraryHealth?: {
            activeLibraries: number,
            concentrationPct: number,
            totalCatalogItems: number,
            totalCatalogBytes?: number,
            sizeGB: number,
            fourKPercent: number,
            catalogWatchedPct?: number,
            healthLabel: string,
            movies?: number,
            shows?: number,
            episodes?: number,
            artists?: number,
            albums?: number,
            tracks?: number,
            resolutions?: Record<string, number> | null,
            codecs?: Record<string, number> | null,
            fileSizes?: Record<string, any> | null,
            deltas?: any,
            generatedAt?: number | string | null,
            lastBuildFailures?: any[],
            failedLibraries?: any[],
        },
        requestedPeriodDays?: string | number,
        cachePeriodDays?: string | number | null,
        cacheFallback?: boolean,
        source?: string | null,
        fallback?: string | null,
        degraded?: boolean,
        rebuildPending?: boolean,
        preferredSource?: string | null,
        sourceLabel?: string | null,
        lastUpdated?: number | null,
    } | null>(null);
    const [tautulliData, setTautulliData] = useState<{ streamsRecord: number, transcodeRecord: number, directPlayRecord: number, directStreamRecord: number, totalPlays: number, tvPlays: number, moviePlays: number, musicPlays: number, totalTimeStr: string } | null>(null);
    const [isLoading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [days, setDays] = useState<string>('30');
    const [peakDate, setPeakDate] = useState<string>('');
    const [peakDateData, setPeakDateData] = useState<number[] | null>(null);
    const [peakDateLoading, setPeakDateLoading] = useState(false);
    const [selectedUser, setSelectedUser] = useState<{ id: string, username: string, thumb: string | null } | null>(null);
    const [allUsers, setAllUsers] = useState<any[]>([]);
    const [userSearchQuery, setUserSearchQuery] = useState('');
    const [userSearchOpen, setUserSearchOpen] = useState(false);
    const userSearchInputRef = useRef<HTMLInputElement>(null);
    const [userSearchMenuBox, setUserSearchMenuBox] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
    const [contentTab, setContentTab] = useState<'movies' | 'shows' | 'music'>('movies');
    const [viewerItem, setViewerItem] = useState<{ title: string, viewers: Record<string, any> } | null>(null);
    const [viewerPage, setViewerPage] = useState(1);
    const viewersPerPage = 10;
    const [viewTab, setViewTab] = useState<'overview' | 'graphs'>('overview');
    const [analyticsToasts, setAnalyticsToasts] = useState<ToastMessage[]>([]);
    const [isRebuildingAnalytics, setIsRebuildingAnalytics] = useState(false);
    const [overviewSnapshotCollapsed, setOverviewSnapshotCollapsed] = usePersistedCollapsed(
        ANALYTICS_OVERVIEW_SNAPSHOT_COLLAPSED_KEY,
        preferCollapsedOnNarrow(),
    );
    const mediaServerType = String(sessionInfo?.mediaServerType || 'plex').toLowerCase();
    const isJellyfinPortal = mediaServerType === 'jellyfin' || mediaServerType === 'emby';
    const addAnalyticsToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
        setAnalyticsToasts((prev) => pushToast(prev, message, type));
    }, []);
    const analyticsSourceLabel = (() => {
        const stamped = String(analyticsData?.sourceLabel || '').trim();
        if (stamped) return stamped;
        const source = String(analyticsData?.source || '').toLowerCase();
        if (source === 'tautulli') return t('analytics.source.tautulli');
        if (source === 'plex') {
            if (analyticsData?.rebuildPending) return t('analytics.source.rebuildPending');
            if (analyticsData?.fallback === 'tautulli_not_configured') return t('analytics.source.tautulliNotConfigured');
            return analyticsData?.degraded
                ? t('analytics.source.plexDegraded')
                : t('analytics.source.plex');
        }
        if (source === 'jellystat') return t('analytics.source.jellystat');
        if (source === 'jellyglance') return t('analytics.source.jellyglance');
        if (source === 'emby') return t('analytics.source.emby');
        if (isJellyfinPortal) return mediaServerType === 'emby' ? t('analytics.source.emby') : t('analytics.source.jellystat');
        return t('analytics.source.plex');
    })();
    const analyticsSourceDegraded = !!analyticsData?.degraded;
    const analyticsRebuildPending = !!analyticsData?.rebuildPending;
    const analyticsLastUpdatedLabel = (() => {
        const ts = Number(analyticsData?.lastUpdated);
        if (!Number.isFinite(ts) || ts <= 0) return t('analytics.source.updatedUnknown');
        try {
            return t('analytics.source.updated', { time: new Date(ts).toLocaleString() });
        } catch {
            return t('analytics.source.updatedUnknown');
        }
    })();
    const libraryDeltas = (analyticsData?.libraryHealth as any)?.deltas || {};

    const resolveUserAvatar = (thumb: string | null | undefined, width = 80, height = 80) => {
        if (!thumb) return logoUrl();
        if (thumb.startsWith('http://') || thumb.startsWith('https://') || thumb.startsWith('/api/')) {
            return resolvePortalAssetUrl(thumb);
        }
        return portalUrl(`/api/plex/image?path=${encodeURIComponent(thumb)}&width=${width}&height=${height}`);
    };

    useEffect(() => {
        if (!isAdmin) return;
        const fetchUsers = async () => {
            try {
                const usersData = await apiFetch('/api/users');
                setAllUsers(usersData);
            } catch (err) {
                console.error("Failed to fetch users", err);
            }
        };
        fetchUsers();
    }, []);

    useEffect(() => {
        const checkHash = () => {
            const hash = typeof window !== 'undefined' ? window.location.hash : '';
            if (!hash.startsWith('#user=')) return;
            const username = decodeURIComponent(hash.replace('#user=', '')).trim();
            if (!username) return;
            const found = allUsers.find((u: any) => String(u.username || '').toLowerCase() === username.toLowerCase());
            const fromLeaderboard = (analyticsData?.topUsers || []).find(
                (u: any) => String(u.username || '').toLowerCase() === username.toLowerCase(),
            );
            const analyticsId = String(
                found?.plexAccountId
                || fromLeaderboard?.id
                || found?.id
                || username,
            );
            setSelectedUser({
                id: analyticsId,
                username: found?.username || fromLeaderboard?.username || username,
                thumb: found?.thumb || fromLeaderboard?.thumb || null,
            });
        };

        checkHash();
        window.addEventListener('hashchange', checkHash);
        return () => window.removeEventListener('hashchange', checkHash);
    }, [allUsers, analyticsData?.topUsers]);

    const openUserAnalytics = useCallback((user: { id?: string | null; username?: string | null; thumb?: string | null; plexAccountId?: string | null }) => {
        const username = String(user?.username || '').trim();
        if (!username) return;
        const found = allUsers.find((u: any) => String(u.username || '').toLowerCase() === username.toLowerCase());
        const fromLeaderboard = (analyticsData?.topUsers || []).find(
            (u: any) => String(u.username || '').toLowerCase() === username.toLowerCase(),
        );
        const analyticsId = String(
            user?.plexAccountId
            || found?.plexAccountId
            || user?.id
            || fromLeaderboard?.id
            || found?.id
            || username,
        );
        setSelectedUser({
            id: analyticsId,
            username: found?.username || username,
            thumb: user?.thumb || found?.thumb || fromLeaderboard?.thumb || null,
        });
        if (typeof window !== 'undefined') {
            const nextHash = `#user=${encodeURIComponent(found?.username || username)}`;
            if (window.location.hash !== nextHash) {
                window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${nextHash}`);
            }
        }
        setUserSearchQuery('');
        setUserSearchOpen(false);
    }, [allUsers, analyticsData?.topUsers]);

    const openUserProfile = useCallback((user: { id?: string | null; username?: string | null; thumb?: string | null; plexAccountId?: string | null; accountId?: string | null }) => {
        const id = String(user?.plexAccountId || user?.accountId || user?.id || '').trim();
        if (id && onNavigate) {
            onNavigate('profile', { path: `/profile/${encodeURIComponent(id)}` });
            return;
        }
        if (isAdmin) openUserAnalytics(user);
    }, [isAdmin, onNavigate, openUserAnalytics]);

    const userSearchMatches = useMemo(() => {
        const q = userSearchQuery.trim().toLowerCase();
        if (!q || !isAdmin) return [];
        const seen = new Set<string>();
        const out: Array<{ id: string; username: string; thumb: string | null; email?: string; plexAccountId?: string | null }> = [];
        const push = (entry: { id?: string | null; username?: string | null; thumb?: string | null; email?: string; plexAccountId?: string | null }) => {
            const name = String(entry.username || '').trim();
            if (!name) return;
            const key = name.toLowerCase();
            if (seen.has(key)) return;
            const hay = `${name} ${entry.email || ''}`.toLowerCase();
            if (!hay.includes(q)) return;
            seen.add(key);
            out.push({
                id: String(entry.plexAccountId || entry.id || name),
                username: name,
                thumb: entry.thumb || null,
                email: entry.email,
                plexAccountId: entry.plexAccountId || null,
            });
        };
        for (const u of allUsers) push(u);
        for (const u of analyticsData?.topUsers || []) push(u);
        return out.slice(0, 8);
    }, [allUsers, analyticsData?.topUsers, isAdmin, userSearchQuery]);

    useLayoutEffect(() => {
        if (!userSearchOpen || !userSearchQuery.trim()) {
            setUserSearchMenuBox(null);
            return;
        }
        const sync = () => {
            const el = userSearchInputRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const margin = 8;
            const maxHeight = Math.max(120, Math.min(288, window.innerHeight - rect.bottom - margin * 2));
            setUserSearchMenuBox({
                top: Math.round(rect.bottom + 4),
                left: Math.round(rect.left),
                width: Math.round(rect.width),
                maxHeight,
            });
        };
        sync();
        window.addEventListener('resize', sync);
        window.addEventListener('scroll', sync, true);
        window.visualViewport?.addEventListener('resize', sync);
        window.visualViewport?.addEventListener('scroll', sync);
        const mainScroll = document.getElementById('main-scroll-container');
        mainScroll?.addEventListener('scroll', sync, { passive: true });
        return () => {
            window.removeEventListener('resize', sync);
            window.removeEventListener('scroll', sync, true);
            window.visualViewport?.removeEventListener('resize', sync);
            window.visualViewport?.removeEventListener('scroll', sync);
            mainScroll?.removeEventListener('scroll', sync);
        };
    }, [userSearchOpen, userSearchQuery, userSearchMatches.length]);

    useEffect(() => {
        if (!peakDate) {
            setPeakDateData(null);
            return;
        }
        let cancelled = false;
        setPeakDateLoading(true);
        apiFetch(`/api/plex/analytics/day?date=${peakDate}`)
            .then(data => {
                if (!cancelled) setPeakDateData(data);
            })
            .catch(err => {
                console.error("Failed to fetch day analytics", err);
                if (!cancelled) setPeakDateData(null);
            })
            .finally(() => {
                if (!cancelled) setPeakDateLoading(false);
            });
        return () => { cancelled = true; };
    }, [peakDate]);

    useEffect(() => {
        let cancelled = false;
        const fetchAnalytics = async () => {
            setLoading(true);
            setError(null);
            try {
                const data = await apiFetch(`${isJellyfinPortal ? '/api/jellystat/analytics' : '/api/plex/analytics'}?days=${days}`);
                if (cancelled) return;
                setAnalyticsData(data);
            } catch (err: any) {
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        fetchAnalytics();
        return () => { cancelled = true; };
    }, [days, isJellyfinPortal]);

    useEffect(() => {
        if (!analyticsData?.rebuildPending || isJellyfinPortal) return undefined;
        let cancelled = false;
        let attempts = 0;
        const maxAttempts = 24;
        let timer: ReturnType<typeof window.setTimeout> | undefined;
        const poll = () => {
            if (cancelled || attempts >= maxAttempts) return;
            attempts += 1;
            void apiFetch(`/api/plex/analytics?days=${days}`)
                .then((data) => {
                    if (cancelled) return;
                    setAnalyticsData(data);
                    if (data?.rebuildPending && attempts < maxAttempts) {
                        timer = window.setTimeout(poll, 8000);
                    }
                })
                .catch(() => {
                    if (!cancelled && attempts < maxAttempts) {
                        timer = window.setTimeout(poll, 8000);
                    }
                });
        };
        timer = window.setTimeout(poll, 8000);
        return () => {
            cancelled = true;
            if (timer) window.clearTimeout(timer);
        };
    }, [analyticsData?.rebuildPending, days, isJellyfinPortal]);

    const handleRebuildAnalyticsCache = useCallback(async () => {
        if (!isAdmin || isJellyfinPortal || isRebuildingAnalytics) return;
        setIsRebuildingAnalytics(true);
        try {
            const result = await apiFetch('/api/plex/analytics/rebuild', { method: 'POST' });
            if (result?.status === 'already_running') {
                addAnalyticsToast(t('analytics.source.rebuildRunning'), 'error');
            } else {
                addAnalyticsToast(result?.message || t('analytics.source.rebuildStarted'), 'success');
            }
            window.setTimeout(() => {
                void apiFetch(`/api/plex/analytics?days=${days}`)
                    .then((data) => setAnalyticsData(data))
                    .catch(() => { /* keep current */ });
            }, 8000);
        } catch (err: any) {
            addAnalyticsToast(err?.message || t('analytics.source.rebuildFailed'), 'error');
        } finally {
            setIsRebuildingAnalytics(false);
        }
    }, [addAnalyticsToast, days, isAdmin, isJellyfinPortal, isRebuildingAnalytics, t]);

    // Tautulli/Jellystat extras must not block the main analytics page (slow Tautulli = endless spinner).
    useEffect(() => {
        if (!isAdmin || isLoading) {
            if (!isAdmin) setTautulliData(null);
            return;
        }
        let cancelled = false;
        const fetchExtras = async () => {
            try {
                if (isJellyfinPortal) {
                    const embedded = (analyticsData as any)?.jellystatInsights || null;
                    if (!cancelled) setTautulliData(embedded);
                    return;
                }
                const tData = await apiFetch('/api/tautulli/stats');
                if (!cancelled) setTautulliData(tData);
            } catch {
                if (!cancelled) setTautulliData(null);
            }
        };
        fetchExtras();
        return () => { cancelled = true; };
    }, [days, isAdmin, isJellyfinPortal, isLoading, (analyticsData as any)?.jellystatInsights]);

    useEffect(() => {
        if (isJellyfinPortal && viewTab === 'graphs') setViewTab('overview');
    }, [isJellyfinPortal, viewTab]);

    const topUsersLength = analyticsData?.topUsers?.length || 0;
    const totalViewerPages = Math.max(1, Math.ceil(topUsersLength / viewersPerPage));

    useEffect(() => {
        setViewerPage(1);
    }, [days]);

    useEffect(() => {
        if (viewerPage > totalViewerPages) {
            setViewerPage(totalViewerPages);
        }
    }, [viewerPage, totalViewerPages]);

    if (isLoading) {
        return (
            <DashboardPageShell>
                <DashboardHero
                    accent="violet"
                    eyebrow="Analytics"
                    title="Advanced Analytics"
                    description="Playback trends, library health, and viewer insights for your server."
                    icon={<BarChart3 className="h-3.5 w-3.5" />}
                />
                <Loader isLoading={true} />
            </DashboardPageShell>
        );
    }
    if (error) {
        return (
            <DashboardPageShell>
                <DashboardHero
                    accent="violet"
                    eyebrow="Analytics"
                    title="Advanced Analytics"
                    icon={<BarChart3 className="h-3.5 w-3.5" />}
                />
                <div className="rounded-2xl border border-white/10 bg-black/25 p-8 text-center font-bold text-red-400">{error}</div>
            </DashboardPageShell>
        );
    }
    if (!analyticsData) return null;

    const { topUsers, topLibraries, topMovies, topShows, topMusic, topDevices, peakHours, totalPlaybacks, maxConcurrentStreams, maxDirectPlays, maxTranscodes } = analyticsData;
    const uniqueActiveViewers = topUsers.filter((u: any) => (u.plays || 0) > 0).length;
    const maxLibraryPlays = Math.max(...topLibraries.map(l => l.plays), 1);
    const maxDevicePlays = Math.max(...topDevices.map(d => d.plays), 1);
    const maxPeakHour = Math.max(...peakHours, 1);
    const viewerPageSafe = Math.min(viewerPage, totalViewerPages);
    const pagedTopUsers = topUsers.slice((viewerPageSafe - 1) * viewersPerPage, viewerPageSafe * viewersPerPage);

    let activeContent = topMovies;
    if (contentTab === 'shows') activeContent = topShows;
    else if (contentTab === 'music') activeContent = topMusic;
    const compare = analyticsData.compare || null;
    const libraryHealth = analyticsData.libraryHealth || null;

    const formatPriorPeriodLabel = (days: string) => {
        if (days === '1') return '24 hours';
        if (days === '7') return '7 days';
        if (days === '365') return 'year';
        if (days === '1825') return '5 years';
        return `${days} days`;
    };

    const renderDelta = (delta?: { absolute: number, percent: number | null, previous?: number, current?: number } | null) => {
        if (!delta) return null;
        if (delta.absolute === 0 && delta.previous === 0) return null;
        const isUp = delta.absolute >= 0;
        const sign = isUp ? '+' : '';
        let pctText: string;
        if (delta.percent !== null) {
            pctText = `${sign}${delta.percent}%`;
        } else if ((delta.previous ?? 0) === 0 && delta.absolute > 0) {
            pctText = 'New';
        } else {
            pctText = `${sign}${delta.absolute}`;
        }
        const priorLabel = compare?.previousPeriodDays ? formatPriorPeriodLabel(compare.previousPeriodDays) : null;
        const tooltip = priorLabel
            ? `Compared to the previous ${priorLabel}${delta.previous != null ? ` (${delta.previous})` : ''}`
            : undefined;
        return (
            <span
                title={tooltip}
                className={`inline-flex items-center px-2 py-1 rounded-md text-[10px] font-bold mt-1 ${isUp ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}
            >
                {pctText}
            </span>
        );
    };
    const analyticsPeriodLabel = (() => {
        if (days === '1') return 'Last 24 hours';
        if (days === '7') return 'Last 7 days';
        if (days === '30') return 'Last 30 days';
        if (days === '60') return 'Last 60 days';
        if (days === '365') return 'Last year';
        if (days === '1825') return 'Last 5 years';
        if (days === 'all') return 'All time';
        return `Last ${days} days`;
    })();

    const analyticsTabs = [
        { id: 'overview' as const, label: 'Overview', icon: Activity },
        ...(!isJellyfinPortal ? [{ id: 'graphs' as const, label: 'Graphs', icon: LucideLineChart }] : []),
    ];

return (
        <DashboardPageShell>
            <ToastContainer toasts={analyticsToasts} setToasts={setAnalyticsToasts} />
            <DashboardHero
                accent="violet"
                eyebrow="Analytics"
                title="Advanced Analytics"
                description={(
                    <>
                        {totalPlaybacks.toLocaleString()} playbacks · {uniqueActiveViewers} active viewers · {analyticsPeriodLabel.toLowerCase()}
                        <span className={`ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide align-middle ${
                            analyticsSourceDegraded || analyticsRebuildPending
                                ? 'border-amber-400/40 bg-amber-500/10 text-amber-200'
                                : 'border-white/15 bg-white/5 text-muted'
                        }`}>
                            {t('analytics.source.badge', { source: analyticsSourceLabel })}
                        </span>
                        <span className="ml-2 inline-flex items-center rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] font-semibold text-muted align-middle normal-case tracking-normal">
                            {analyticsLastUpdatedLabel}
                        </span>
                    </>
                )}
                icon={<BarChart3 className="h-3.5 w-3.5" />}
                secondaryBlob
                actions={(
                    <div className="flex items-center gap-2 shrink-0">
                        {isAdmin && !isJellyfinPortal && (
                            <button
                                type="button"
                                onClick={() => void handleRebuildAnalyticsCache()}
                                disabled={isRebuildingAnalytics}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs font-bold text-text hover:bg-white/5 disabled:opacity-50"
                            >
                                <RefreshCw className={`h-3.5 w-3.5 ${isRebuildingAnalytics ? 'animate-spin' : ''}`} />
                                {isRebuildingAnalytics ? t('analytics.source.rebuilding') : t('analytics.source.rebuild')}
                            </button>
                        )}
                        {viewTab === 'overview' ? (
                            <div className="w-[140px] md:w-48">
                                <CustomSelect
                                    value={days}
                                    onChange={(val) => setDays(val as string)}
                                    compact={true}
                                    options={[
                                        { label: 'Last 24 Hours', value: '1' },
                                        { label: 'Last 7 Days', value: '7' },
                                        { label: 'Last 30 Days', value: '30' },
                                        { label: 'Last 60 Days', value: '60' },
                                        { label: 'Last 1 Year', value: '365' },
                                        { label: 'Last 5 Years', value: '1825' },
                                        { label: 'All Time', value: 'all' },
                                    ]}
                                />
                            </div>
                        ) : null}
                    </div>
                )}
            />

            <div className="md:hidden">
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-muted">
                    Analytics section
                </label>
                <CustomSelect
                    id="analytics-section-select"
                    value={viewTab}
                    onChange={(val) => setViewTab(val as typeof viewTab)}
                    options={analyticsTabs.map((tab) => {
                        const Icon = tab.icon;
                        return {
                            label: tab.label,
                            value: tab.id,
                            icon: <Icon className="h-4 w-4" />,
                        };
                    })}
                />
            </div>

            <DashboardSubnav className="mb-1">
                {analyticsTabs.map((tab) => {
                    const Icon = tab.icon;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setViewTab(tab.id)}
                            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap transition-colors border-none outline-none cursor-pointer ${dashboardSubnavLinkClass(viewTab === tab.id)}`}
                        >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span>{tab.label}</span>
                        </button>
                    );
                })}
            </DashboardSubnav>

            {viewTab === 'graphs' && <TautulliGraphsTab />}

            {viewTab === 'overview' && (
                <>
                    {analyticsData.cacheFallback && (
                        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
                            Analytics cache for this period is still building. Showing cached data from the last {analyticsData.cachePeriodDays} day period instead.
                        </div>
                    )}
                    {analyticsRebuildPending && (
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                            {t('analytics.source.mismatchHint')}
                        </div>
                    )}
                    {analyticsSourceDegraded && !analyticsRebuildPending && (
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                            {t('analytics.source.degradedHint')}
                        </div>
                    )}
                    <section>
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <button
                                type="button"
                                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                onClick={() => setOverviewSnapshotCollapsed(!overviewSnapshotCollapsed)}
                                aria-expanded={!overviewSnapshotCollapsed}
                                aria-label={overviewSnapshotCollapsed ? t('analytics.overviewSnapshot.expand') : t('analytics.overviewSnapshot.collapse')}
                            >
                                <span className="w-3 shrink-0 text-muted" aria-hidden>{overviewSnapshotCollapsed ? '▸' : '▾'}</span>
                                <h2 className="w-full border-b border-white/10 pb-2 text-sm font-bold uppercase tracking-[2px] text-plex">
                                    {t('analytics.overviewSnapshot.title')}
                                </h2>
                            </button>
                            {overviewSnapshotCollapsed ? (
                                <span className="shrink-0 text-xs font-semibold text-muted">
                                    {[
                                        t('analytics.overviewSnapshot.playbacks', { count: totalPlaybacks }),
                                        t('analytics.overviewSnapshot.viewers', { count: uniqueActiveViewers }),
                                        libraryHealth?.healthLabel,
                                    ].filter(Boolean).join(' · ')}
                                </span>
                            ) : null}
                        </div>
                    {overviewSnapshotCollapsed ? null : (
                    <div className="flex flex-col gap-6">
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
                        <DashboardStatCard
                            label="Total Playbacks"
                            value={(
                                <span className="inline-flex flex-wrap items-center gap-2">
                                    <CountUp end={totalPlaybacks} />
                                    {renderDelta(compare?.totalPlaybacks)}
                                </span>
                            )}
                            icon={<PlaySquare className="h-4 w-4 text-plex" />}
                            glow={dashboardGlowClass('plex')}
                        />
                        <DashboardStatCard
                            label="Unique Viewers"
                            value={(
                                <span className="inline-flex flex-wrap items-center gap-2">
                                    {uniqueActiveViewers}
                                    {renderDelta(compare?.uniqueViewers)}
                                </span>
                            )}
                            icon={<Users className="h-4 w-4 text-violet-300" />}
                            glow={dashboardGlowClass('violet')}
                        />
                        <DashboardPanel
                            title="Peak viewing hours"
                            subtitle="Plays by hour of day"
                            className="col-span-2"
                        >
                            <div className="flex items-end gap-1 h-12 w-full">
                                {peakHours.map((val, idx) => (
                                    <div key={idx} className="flex-1 bg-plex opacity-20 hover:opacity-80 transition-opacity rounded-t-sm relative group" style={{ height: `${Math.max((val / maxPeakHour) * 100, 5)}%` }}>
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 bg-black/80 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10">
                                            {idx === 0 ? '12 AM' : idx < 12 ? `${idx} AM` : idx === 12 ? '12 PM' : `${idx - 12} PM`}: {val} plays
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="flex justify-between text-[10px] text-muted mt-2 font-mono">
                                <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span>
                            </div>
                        </DashboardPanel>
                    </div>
                    {libraryHealth && (
                        <>
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
                                <DashboardStatCard
                                    label="Library Balance"
                                    value={libraryHealth.healthLabel}
                                    hint="How evenly viewing is spread across libraries"
                                    icon={<PieChart className="h-4 w-4 text-plex" />}
                                    glow={dashboardGlowClass('plex')}
                                    valueClassName="text-plex text-xl md:text-2xl"
                                />
                                <DashboardStatCard
                                    label="Active Libraries"
                                    value={libraryHealth.activeLibraries}
                                    icon={<Layers className="h-4 w-4 text-sky-300" />}
                                    glow={dashboardGlowClass('sky')}
                                />
                                <DashboardStatCard
                                    label="Catalog Size"
                                    value={libraryHealth.totalCatalogItems.toLocaleString()}
                                    hint={`${formatSizeCeil(libraryHealth.totalCatalogBytes ?? libraryHealth.sizeGB * 1024 ** 3)}${formatCatalogScanAge(libraryHealth.generatedAt) ? ` · as of ${formatCatalogScanAge(libraryHealth.generatedAt)}` : ''}`}
                                    icon={<HardDrive className="h-4 w-4 text-violet-300" />}
                                    glow={dashboardGlowClass('violet')}
                                />
                                <DashboardStatCard
                                    label="Usage Concentration"
                                    value={`${libraryHealth.concentrationPct}%`}
                                    hint={`Watched: ${libraryHealth.catalogWatchedPct || 0}% · 4K: ${libraryHealth.fourKPercent}%`}
                                    icon={<TrendingUp className="h-4 w-4 text-amber-300" />}
                                    glow={dashboardGlowClass('amber')}
                                />
                            </div>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4">
                                <DashboardStatCard
                                    label="Movies Catalog"
                                    value={(
                                        <span className="inline-flex items-center gap-1">
                                            <CountUp end={libraryHealth.movies || 0} />
                                            <LibraryDeltaBadge value={libraryDeltas.movies} />
                                        </span>
                                    )}
                                    hint="Total movies in library"
                                    icon={<Film className="h-4 w-4 text-plex" />}
                                    glow={dashboardGlowClass('plex')}
                                />
                                <DashboardStatCard
                                    label="TV Shows Catalog"
                                    value={(
                                        <span className="inline-flex items-center gap-1">
                                            <CountUp end={libraryHealth.shows || 0} />
                                            <span className="text-sm font-semibold text-muted">shows</span>
                                            <LibraryDeltaBadge value={libraryDeltas.shows} />
                                        </span>
                                    )}
                                    hint={(
                                        <span className="inline-flex items-center gap-1">
                                            <CountUp end={libraryHealth.episodes || 0} />
                                            <span>episodes</span>
                                            <LibraryDeltaBadge value={libraryDeltas.episodes} />
                                        </span>
                                    )}
                                    icon={<Tv className="h-4 w-4 text-sky-300" />}
                                    glow={dashboardGlowClass('sky')}
                                />
                                <DashboardStatCard
                                    label="Music Catalog"
                                    value={(
                                        <span className="inline-flex items-center gap-1">
                                            <CountUp end={libraryHealth.artists || 0} />
                                            <span className="text-sm font-semibold text-muted">artists</span>
                                            <LibraryDeltaBadge value={libraryDeltas.artists} />
                                        </span>
                                    )}
                                    hint={(
                                        <span className="inline-flex flex-wrap items-center gap-1">
                                            <CountUp end={libraryHealth.albums || 0} />
                                            <span>albums</span>
                                            <LibraryDeltaBadge value={libraryDeltas.albums} />
                                            <span>·</span>
                                            <CountUp end={libraryHealth.tracks || 0} />
                                            <span>tracks</span>
                                            <LibraryDeltaBadge value={libraryDeltas.tracks} />
                                        </span>
                                    )}
                                    icon={<Music className="h-4 w-4 text-violet-300" />}
                                    glow={dashboardGlowClass('violet')}
                                />
                            </div>
                            {((libraryHealth.lastBuildFailures || []).length > 0 || (libraryHealth.failedLibraries || []).length > 0) ? (
                                <p className="text-xs text-amber-300/90 -mt-1">
                                    Last library scan could not finish. Catalog totals are from the last complete count — nothing was deleted.
                                </p>
                            ) : null}

                            {libraryHealth.resolutions && libraryHealth.codecs && libraryHealth.fileSizes && (() => {
                                const sortedCodecs = Object.entries(libraryHealth.codecs || {})
                                    .map(([name, count]) => ({ name, count: count as number }))
                                    .sort((a, b) => b.count - a.count);
                                const totalCodecs = sortedCodecs.reduce((sum, item) => sum + item.count, 0) || 1;

                                const sortedResolutions = Object.entries(libraryHealth.resolutions || {})
                                    .map(([name, count]) => ({ name, count: count as number }))
                                    .sort((a, b) => b.count - a.count);
                                const totalResolutions = sortedResolutions.reduce((sum, item) => sum + item.count, 0) || 1;

                                const fileSizeEntries = Object.entries(libraryHealth.fileSizes || {})
                                    .map(([range, val]) => {
                                        let movies = 0;
                                        let shows = 0;
                                        if (val && typeof val === 'object') {
                                            movies = (val as any).movies || 0;
                                            shows = (val as any).shows || 0;
                                        } else if (typeof val === 'number') {
                                            shows = val;
                                        }
                                        return { range, movies, shows, total: movies + shows };
                                    });
                                const maxFileSizeCount = Math.max(...fileSizeEntries.map(e => e.total), 1);

                                return (
                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                        <DashboardPanel title="Video Codecs" subtitle="Share of library by codec">
                                            <div className="flex flex-col gap-3">
                                                {sortedCodecs.map((item) => {
                                                    const pct = Math.round((item.count / totalCodecs) * 100);
                                                    return (
                                                        <div key={item.name} className="flex flex-col gap-1">
                                                            <div className="flex justify-between text-xs font-semibold">
                                                                <span className="text-text">{item.name}</span>
                                                                <span className="text-muted font-mono">{item.count.toLocaleString()} ({pct}%)</span>
                                                            </div>
                                                            <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                                                                <div className="bg-plex h-full rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </DashboardPanel>

                                        <DashboardPanel title="Resolutions" subtitle="Share of library by resolution">
                                            <div className="flex flex-col gap-3">
                                                {sortedResolutions.map((item) => {
                                                    const pct = Math.round((item.count / totalResolutions) * 100);
                                                    return (
                                                        <div key={item.name} className="flex flex-col gap-1">
                                                            <div className="flex justify-between text-xs font-semibold">
                                                                <span className="text-text">{item.name}</span>
                                                                <span className="text-muted font-mono">{item.count.toLocaleString()} ({pct}%)</span>
                                                            </div>
                                                            <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                                                                <div className="bg-plex h-full rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </DashboardPanel>

                                        <DashboardPanel
                                            title="File Size Distribution"
                                            subtitle="Movies vs TV episodes by size bucket"
                                            controls={(
                                                <div className="flex items-center gap-3 text-[10px] text-muted font-semibold">
                                                    <span className="flex items-center gap-1">
                                                        <span className="w-2 h-2 bg-plex rounded-sm inline-block" />
                                                        <span>Movies</span>
                                                    </span>
                                                    <span className="flex items-center gap-1">
                                                        <span className="w-2 h-2 bg-plex/30 rounded-sm inline-block border border-plex/20" />
                                                        <span>TV Shows</span>
                                                    </span>
                                                </div>
                                            )}
                                        >
                                            <div className="flex items-end justify-between h-40 pt-4 px-2 w-full gap-3">
                                                {fileSizeEntries.map((item) => {
                                                    const totalHeightPct = (item.total / maxFileSizeCount) * 100;
                                                    const moviesPctOfBar = item.total > 0 ? (item.movies / item.total) * 100 : 0;
                                                    const showsPctOfBar = item.total > 0 ? (item.shows / item.total) * 100 : 0;
                                                    
                                                    return (
                                                        <div key={item.range} className="flex-1 flex flex-col items-center gap-2 h-full justify-end group relative">
                                                            <div 
                                                                className="w-full relative transition-all duration-500 flex flex-col justify-end" 
                                                                style={{ height: `${Math.max(totalHeightPct, 4)}%` }}
                                                            >
                                                                {/* Bar container with overflow-hidden for rounded-t corners */}
                                                                <div className="w-full h-full rounded-t overflow-hidden flex flex-col justify-end">
                                                                    {/* Movies part (Top) */}
                                                                    {item.movies > 0 && (
                                                                        <div 
                                                                            className="w-full bg-plex hover:opacity-100 transition-opacity" 
                                                                            style={{ height: `${moviesPctOfBar}%` }} 
                                                                        />
                                                                    )}
                                                                    {/* TV Shows part (Bottom) */}
                                                                    {item.shows > 0 && (
                                                                        <div 
                                                                            className="w-full bg-plex/30 hover:opacity-100 transition-opacity border-t border-black/10" 
                                                                            style={{ height: `${showsPctOfBar}%` }} 
                                                                        />
                                                                    )}
                                                                </div>

                                                                {/* Detailed Tooltip (Placed outside the overflow-hidden container, inside the height wrapper) */}
                                                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 bg-black/95 text-white text-[10px] px-2.5 py-1.5 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-20 font-mono shadow-md border border-white/5 flex flex-col gap-0.5 leading-none">
                                                                    <span className="font-bold text-plex mb-1 text-[11px]">{item.range}</span>
                                                                    <span className="flex justify-between gap-4"><span>Movies:</span> <span className="text-white font-bold">{item.movies.toLocaleString()}</span></span>
                                                                    <span className="flex justify-between gap-4"><span>TV Episodes:</span> <span className="text-white font-bold">{item.shows.toLocaleString()}</span></span>
                                                                    <span className="border-t border-white/10 mt-1 pt-1 flex justify-between gap-4"><span>Total:</span> <span className="text-plex font-bold">{item.total.toLocaleString()}</span></span>
                                                                </div>
                                                            </div>
                                                            <span className="text-[9px] text-muted font-bold tracking-wider text-center line-clamp-1 w-full" title={item.range}>{item.range}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </DashboardPanel>
                                    </div>
                                );
                            })()}
                        </>
                    )}
                    </div>
                    )}
                    </section>

                    {isAdmin ? (
                        <DashboardPanel
                            title="Find user"
                            subtitle="Search by username or email to open their stats and watch history."
                        >
                            <div className="relative w-full">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                                <input
                                    ref={userSearchInputRef}
                                    type="text"
                                    inputMode="search"
                                    enterKeyHint="search"
                                    value={userSearchQuery}
                                    onChange={(event) => {
                                        setUserSearchQuery(event.target.value);
                                        setUserSearchOpen(true);
                                    }}
                                    onFocus={() => setUserSearchOpen(true)}
                                    onBlur={() => window.setTimeout(() => setUserSearchOpen(false), 150)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            event.preventDefault();
                                            const first = userSearchMatches[0];
                                            if (first) openUserAnalytics(first);
                                        }
                                        if (event.key === 'Escape') {
                                            setUserSearchOpen(false);
                                            setUserSearchQuery('');
                                        }
                                    }}
                                    placeholder="e.g. username or email…"
                                    className="w-full appearance-none rounded-xl border border-white/10 bg-black/20 py-3 pr-10 pl-10 text-[16px] leading-5 text-text outline-none transition focus:border-plex/40 focus:ring-1 focus:ring-plex/20"
                                    style={{ fontSize: 16 }}
                                    autoComplete="off"
                                    autoCorrect="off"
                                    autoCapitalize="none"
                                    spellCheck={false}
                                />
                                {userSearchOpen && userSearchQuery.trim() && userSearchMenuBox && typeof document !== 'undefined'
                                    ? ReactDOM.createPortal(
                                            <div
                                                className="fixed z-[500] overflow-y-auto rounded-xl border border-border shadow-2xl custom-scrollbar"
                                                style={{
                                                    top: userSearchMenuBox.top,
                                                    left: userSearchMenuBox.left,
                                                    width: userSearchMenuBox.width,
                                                    maxHeight: userSearchMenuBox.maxHeight,
                                                    backgroundColor: 'rgb(var(--color-card))',
                                                }}
                                            >
                                                {userSearchMatches.length ? userSearchMatches.map((match) => (
                                                    <button
                                                        key={match.username}
                                                        type="button"
                                                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-white/10"
                                                        style={{ backgroundColor: 'rgb(var(--color-card))' }}
                                                        onMouseDown={(event) => event.preventDefault()}
                                                        onClick={() => openUserAnalytics(match)}
                                                    >
                                                        <img
                                                            src={resolveUserAvatar(match.thumb, 40, 40)}
                                                            alt=""
                                                            className="h-8 w-8 rounded-full object-cover bg-black/40"
                                                            onError={(e) => { (e.target as HTMLImageElement).src = logoUrl(); }}
                                                        />
                                                        <span className="min-w-0 flex-1">
                                                            <span className="block truncate text-sm font-semibold text-text">{match.username}</span>
                                                            {match.email ? (
                                                                <span className="block truncate text-[11px] text-muted">{match.email}</span>
                                                            ) : null}
                                                        </span>
                                                        <BarChart3 className="h-4 w-4 shrink-0 text-plex" />
                                                    </button>
                                                )) : (
                                                    <p className="px-3 py-3 text-sm text-muted" style={{ backgroundColor: 'rgb(var(--color-card))' }}>
                                                        No users match “{userSearchQuery.trim()}”.
                                                    </p>
                                                )}
                                            </div>,
                                            document.body,
                                        )
                                        : null}
                            </div>
                        </DashboardPanel>
                    ) : null}

                    <div className="w-full">
                        {(sessionInfo?.navFeatures?.achievementsLeaderboard
                            ?? sessionInfo?.navFeatures?.achievements) ? (
                            <AchievementsAnalyticsLeaderboard
                                resolveAvatar={resolveUserAvatar}
                                resolveThumbForUsername={(username) => {
                                    const key = String(username || '').toLowerCase();
                                    const fromUsers = allUsers.find((u: any) => String(u.username || '').toLowerCase() === key);
                                    if (fromUsers?.thumb) return fromUsers.thumb;
                                    const fromTop = (topUsers || []).find((u: any) => String(u.username || '').toLowerCase() === key);
                                    return fromTop?.thumb || null;
                                }}
                                isAdmin={isAdmin}
                                onUserClick={(u) => openUserProfile(u)}
                            />
                        ) : (
                            <AnimatedLeaderboard users={topUsers} resolveAvatar={resolveUserAvatar} isAdmin={isAdmin} onUserClick={(u: any) => openUserProfile(u)} />
                        )}
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                        <ServerInsightsWidget 
                            peakHours={analyticsData?.peakHours || []} 
                            tautulliData={tautulliData} 
                            compare={analyticsData?.compare} 
                            analyticsSourceLabel={analyticsSourceLabel}
                            peakDate={peakDate}
                            setPeakDate={setPeakDate}
                            peakDateData={peakDateData}
                            peakDateLoading={peakDateLoading}
                            isJellyfinPortal={isJellyfinPortal}
                            periodPlays={analyticsData?.totalPlaybacks || tautulliData?.totalPlays || 0}
                            uniqueViewers={analyticsData?.totalActiveUsers || topUsers?.length || 0}
                        />

                        {/* Top Devices & Libraries Container */}
                        <div className="flex flex-col gap-6 lg:col-span-1">
                            <DashboardPanel title="Popular Libraries" subtitle="Most played libraries in this period">
                                <div className="flex flex-col gap-5 mt-1">
                                    {topLibraries.length === 0 ? <p className="text-muted text-sm">No data available.</p> : topLibraries.map((lib, idx) => (
                                        <div key={lib.id} className="flex flex-col gap-2">
                                            <div className="flex justify-between items-end">
                                                <span className="font-bold text-text flex items-center gap-2"><span className="text-muted text-xs">#{idx + 1}</span> {lib.title}</span>
                                                <span className="text-xs text-muted font-mono">{lib.plays} plays</span>
                                            </div>
                                            <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden">
                                                <div className="h-full bg-gradient-to-r from-plex to-[#e5a00d] rounded-full" style={{ width: `${(lib.plays / maxLibraryPlays) * 100}%` }}></div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </DashboardPanel>

                            {topDevices && topDevices.length > 0 && (
                                <DashboardPanel title="Top Devices" subtitle="Where your users watch from">
                                    <div className="flex flex-col gap-4">
                                        {topDevices.slice(0, 5).map((device: any, idx: number) => (
                                            <div key={idx} className="flex flex-col gap-1.5">
                                                <div className="flex justify-between items-end">
                                                    <span className="font-bold text-sm text-text truncate pr-2 flex items-center gap-2">
                                                        <span className="text-muted text-xs">#{idx + 1}</span> {device.name || 'Unknown Device'}
                                                    </span>
                                                    <span className="text-xs text-muted font-mono flex-shrink-0">{device.plays} plays</span>
                                                </div>
                                                <div className="h-1.5 w-full bg-black/40 rounded-full overflow-hidden">
                                                    <div className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.5)] transition-all duration-1000" style={{ width: `${(device.plays / Math.max(maxDevicePlays, 1)) * 100}%` }}></div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </DashboardPanel>
                            )}
                        </div>



                        <DashboardPanel
                            title="Trending Content"
                            subtitle="Most played titles in this period"
                            className="col-span-full"
                            controls={(
                                <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-1">
                                    <button onClick={() => setContentTab('movies')} className={`rounded-lg px-4 py-1.5 text-sm font-bold transition-all border-none outline-none cursor-pointer ${contentTab === 'movies' ? 'bg-plex text-background shadow-md shadow-plex/25' : 'text-muted hover:text-text hover:bg-white/5'}`}>Movies</button>
                                    <button onClick={() => setContentTab('shows')} className={`rounded-lg px-4 py-1.5 text-sm font-bold transition-all border-none outline-none cursor-pointer ${contentTab === 'shows' ? 'bg-plex text-background shadow-md shadow-plex/25' : 'text-muted hover:text-text hover:bg-white/5'}`}>TV Shows</button>
                                    <button onClick={() => setContentTab('music')} className={`rounded-lg px-4 py-1.5 text-sm font-bold transition-all border-none outline-none cursor-pointer ${contentTab === 'music' ? 'bg-plex text-background shadow-md shadow-plex/25' : 'text-muted hover:text-text hover:bg-white/5'}`}>Music</button>
                                </div>
                            )}
                        >
                            <div className="flex flex-col gap-4">
                                {activeContent.length === 0 ? <p className="text-muted text-sm col-span-full">No data available.</p> : activeContent.slice(0, 10).map((item, idx) => {
                                    const viewerCount = item.viewers ? Object.keys(item.viewers).length : 0;
                                    return (
                                    <div key={item.key} className="flex flex-col sm:flex-row bg-black/20 rounded-xl overflow-hidden hover:bg-black/40 transition-all group hover:ring-1 hover:ring-plex shadow-md">
                                        <div className={`sm:w-32 lg:w-40 flex-shrink-0 relative ${contentTab === 'music' ? 'aspect-square' : 'aspect-[2/3]'}`}>
                                            {item.thumbUrl ? (
                                                <img src={resolvePortalAssetUrl(item.thumbUrl)} alt={item.title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center bg-black/40"><Film className="w-8 h-8 opacity-50 text-muted" /></div>
                                            )}
                                            <div className="absolute top-2 left-2 bg-plex text-black font-bold text-xs px-2 py-1 rounded-md shadow-lg drop-shadow-md">#{idx + 1}</div>
                                        </div>
                                        <div className="p-4 sm:p-5 flex flex-col justify-between flex-grow">
                                            <div>
                                                <div className="flex items-start justify-between gap-2 mb-2">
                                                    <h3 className="text-lg sm:text-xl font-bold text-text group-hover:text-plex transition-colors line-clamp-1">{item.title}</h3>
                                                    <div className="flex items-center gap-1 bg-white/10 px-2 py-1 rounded-md text-xs font-mono text-plex flex-shrink-0 whitespace-nowrap shadow-sm">
                                                        <PlaySquare className="w-3 h-3" /> {item.plays} plays
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted mb-3 font-medium">
                                                    {item.year && <span>{item.year}</span>}
                                                    {item.year && (item.contentRating || item.rating || item.duration > 0 || (item.genres && item.genres.length > 0)) && <span className="opacity-50">&bull;</span>}
                                                    {item.contentRating && <span>{item.contentRating}</span>}
                                                    {item.contentRating && (item.rating || item.duration > 0 || (item.genres && item.genres.length > 0)) && <span className="opacity-50">&bull;</span>}
                                                    {item.duration > 0 && <span>{Math.round(item.duration / 60000)} min</span>}
                                                    {item.duration > 0 && item.rating && <span className="opacity-50">&bull;</span>}
                                                    {item.rating && (
                                                        <span className="flex items-center gap-1 text-yellow-500">
                                                            <Star className="w-3 h-3 fill-current" /> {item.rating}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-sm text-text/80 line-clamp-2 sm:line-clamp-3 mb-3 leading-relaxed">
                                                    {item.summary || "No summary available."}
                                                </p>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2 mt-auto">
                                                {item.genres && item.genres.length > 0 ? (
                                                    item.genres.slice(0, 4).map((g: string, i: number) => (
                                                        <span key={i} className="text-[10px] uppercase tracking-wider bg-white/5 border border-white/10 text-muted px-2 py-1 rounded-full shadow-sm">{g}</span>
                                                    ))
                                                ) : null}
                                                {item.genres && item.genres.length > 4 ? (
                                                    <span className="text-[10px] uppercase tracking-wider bg-white/5 border border-white/10 text-muted px-2 py-1 rounded-full shadow-sm">+{item.genres.length - 4}</span>
                                                ) : null}
                                                {viewerCount > 0 ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => setViewerItem(item)}
                                                        className="text-[10px] uppercase tracking-wider bg-plex/15 border border-plex/30 text-plex px-2 py-1 rounded-full shadow-sm hover:bg-plex/25"
                                                    >
                                                        {t('analytics.overviewSnapshot.viewers', { count: viewerCount })}
                                                    </button>
                                                ) : null}
                                                {item.plexUrl ? (
                                                    <a
                                                        href={item.plexUrl}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="text-[10px] uppercase tracking-wider bg-white/5 border border-white/10 text-muted px-2 py-1 rounded-full shadow-sm hover:text-text hover:border-plex/40"
                                                    >
                                                        {t('common.view')}
                                                    </a>
                                                ) : null}
                                            </div>
                                        </div>
                                    </div>
                                    );
                                })}
                            </div>
                        </DashboardPanel>
                    </div>
                </>
            )}
            {isAdmin && selectedUser && (
                <UserAnalyticsModal
                    userId={selectedUser.id}
                    username={selectedUser.username}
                    thumb={selectedUser.thumb}
                    days={days}
                    onOpenProfile={(id) => {
                        setSelectedUser(null);
                        if (onNavigate) goToProfile(onNavigate, id, selectedUser.username);
                    }}
                    onClose={() => {
                        setSelectedUser(null);
                        if (window.location.hash.startsWith('#user=')) {
                            window.history.pushState('', document.title, window.location.pathname + window.location.search);
                        }
                    }}
                />
            )}
            {viewerItem ? (
                <ItemViewersModal
                    item={viewerItem}
                    onClose={() => setViewerItem(null)}
                    resolveAvatar={(thumb) => resolveUserAvatar(thumb, 80, 80)}
                    onOpenProfile={(id, username) => {
                        setViewerItem(null);
                        if (onNavigate) goToProfile(onNavigate, id, username);
                    }}
                />
            ) : null}
        </DashboardPageShell>
    );
};


// --- Logs Dashboard Component ---
export const LogsDashboard: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
    const [deletedUsers, setDeletedUsers] = useState<any[]>([]);
    const [auditEntries, setAuditEntries] = useState<any[]>([]);
    const [isLoading, setLoading] = useState(true);
    const [toasts, setToasts] = useState<any[]>([]);
    const [auditPage, setAuditPage] = useState(1);
    const [emailPage, setEmailPage] = useState(1);
    const itemsPerPage = 20;

    const addToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
        setToasts(t => pushToast(t, message, type));
    }, []);

    const fetchSecurityData = useCallback(async () => {
        setLoading(true);
        try {
            const [deletedUsersData, auditLogData] = await Promise.all([
                apiFetch('/api/deleted-users'),
                apiFetch('/api/audit-log')
            ]);
            setDeletedUsers(deletedUsersData);
            setAuditEntries(Array.isArray(auditLogData?.entries) ? auditLogData.entries : (Array.isArray(auditLogData) ? auditLogData : []));
        } catch (error: any) {
            addToast(error instanceof Error ? error.message : 'Failed to fetch logs.', 'error');
        } finally {
            setLoading(false);
        }
    }, [addToast]);

    useEffect(() => {
        fetchSecurityData();
    }, [fetchSecurityData]);

    const handleUnblockDeletedUser = async (deletedUser: any) => {
        const label = deletedUser.username || deletedUser.email || 'this user';
        appConfirm(`Allow ${label} to use the portal again? This does not invite them automatically.`, async () => {
            setLoading(true);
            try {
                await apiFetch(`/api/deleted-users/${encodeURIComponent(deletedUser.blockId)}`, { method: 'DELETE' });
                addToast('Deleted user unblocked.');
                await fetchSecurityData();
            } catch (error: any) {
                addToast(error instanceof Error ? error.message : 'Failed to unblock user.', 'error');
            } finally {
                setLoading(false);
            }
        });
    };

    // Helper functions
    const formatDateTime = (dateString: string) => {
        if (!dateString) return '';
        return formatPortalDateTime(dateString);
    };

    const formatEventName = (event: string) => {
        return event.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    };

    const isConfigured = true;

    const filteredAuditLog = auditEntries.filter(e => e.event !== 'system_email_sent');
    const emailLogs = auditEntries.filter(e => e.event === 'system_email_sent');
    const totalAuditPages = Math.max(1, Math.ceil(filteredAuditLog.length / itemsPerPage));
    const totalEmailPages = Math.max(1, Math.ceil(emailLogs.length / itemsPerPage));

    return (
        <div className="w-full flex flex-col">
            <Loader isLoading={isLoading} />
            <ToastContainer toasts={toasts} setToasts={setToasts} />
            <header className="page-header">
                <h1 className="page-title">System Logs</h1>
            </header>
            <main>
                <div className="flex flex-col gap-6 mb-8">
                    <section className="glass-card-sm p-4 md:p-5 shadow-md">
                        <div className="flex items-center justify-between gap-4 mb-4">
                            <div>
                                <h2 className="text-lg font-bold text-text">Deleted User Blocklist</h2>
                                <p className="text-muted text-xs mt-1">Deleted users are logged out and blocked from requesting temporary access again.</p>
                            </div>
                            <span className="px-3 py-1 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 text-xs font-bold">{deletedUsers.length}</span>
                        </div>
                        <div className="flex flex-col gap-3">
                            {deletedUsers.length === 0 ? (
                                <p className="text-muted text-sm border border-dashed border-border rounded-lg p-4 text-center">No deleted users are currently blocked.</p>
                            ) : (
                                deletedUsers.map(deletedUser => (
                                    <div key={deletedUser.blockId} className="flex items-center justify-between gap-3 bg-background/60 border border-border rounded-lg p-3">
                                        <div className="min-w-0">
                                            <p className="text-text font-semibold text-sm truncate">{deletedUser.username || 'Unknown user'}</p>
                                            <p className="text-muted text-xs truncate">{deletedUser.email || deletedUser.plexId || deletedUser.id || 'No identifier'}</p>
                                            <p className="text-muted/70 text-[11px] mt-1">Deleted {formatDateTime(deletedUser.deletedAt)} by {deletedUser.deletedBy || 'admin'}</p>
                                        </div>
                                        <button className="px-3 py-2 bg-border text-text rounded-md font-medium hover:bg-opacity-80 transition-colors text-xs flex-shrink-0" onClick={() => handleUnblockDeletedUser(deletedUser)}>
                                            Unblock
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </section>

                    <section className="glass-card-sm p-4 md:p-5 shadow-md">
                        <div className="flex items-center justify-between gap-4 mb-4">
                            <div>
                                <h2 className="text-lg font-bold text-text">Audit Log</h2>
                                <p className="text-muted text-xs mt-1">Recent invite, deletion, sync, and access events.</p>
                            </div>
                            <button className="px-3 py-2 bg-border text-text rounded-md font-medium hover:bg-opacity-80 transition-colors text-xs" onClick={fetchSecurityData}>
                                Refresh
                            </button>
                        </div>
                        <div className="flex flex-col gap-3">
                            {filteredAuditLog.length === 0 ? (
                                <p className="text-muted text-sm border border-dashed border-border rounded-lg p-4 text-center">No audit events recorded yet.</p>
                            ) : (
                                <>
                                    {filteredAuditLog.slice((auditPage - 1) * itemsPerPage, auditPage * itemsPerPage).map(entry => (
                                        <div key={entry.id} className="bg-background/60 border border-border rounded-lg p-3">
                                            <div className="flex items-start justify-between gap-3">
                                                <p className="text-text font-semibold text-sm">{formatEventName(entry.event)}</p>
                                                <span className="text-muted text-[11px] whitespace-nowrap">{formatDateTime(entry.timestamp)}</span>
                                            </div>
                                            <p className="text-muted text-xs mt-1">
                                                Target: {entry.target?.username || entry.target?.email || 'System'}
                                                {entry.actor?.username || entry.actor?.email ? ` · Actor: ${entry.actor.username || entry.actor.email}` : ''}
                                            </p>
                                        </div>
                                    ))}
                                    {totalAuditPages > 1 && (
                                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
                                            <button
                                                className="px-3 py-2 bg-border text-text rounded-md font-medium hover:bg-opacity-80 transition-colors text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                                                onClick={() => setAuditPage(p => Math.max(1, p - 1))}
                                                disabled={auditPage === 1}
                                            >
                                                Previous
                                            </button>
                                            <span className="text-xs text-muted font-semibold">Page {auditPage} of {totalAuditPages}</span>
                                            <button
                                                className="px-3 py-2 bg-border text-text rounded-md font-medium hover:bg-opacity-80 transition-colors text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                                                onClick={() => setAuditPage(p => Math.min(totalAuditPages, p + 1))}
                                                disabled={auditPage === totalAuditPages}
                                            >
                                                Next
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </section>

                    <section className="glass-card-sm p-4 md:p-5 shadow-md">
                        <div className="flex items-center justify-between gap-4 mb-4">
                            <div>
                                <h2 className="text-lg font-bold text-text">Email Log</h2>
                                <p className="text-muted text-xs mt-1">Recent system emails sent.</p>
                            </div>
                        </div>
                        <div className="flex flex-col gap-3">
                            {emailLogs.length === 0 ? (
                                <p className="text-muted text-sm border border-dashed border-border rounded-lg p-4 text-center">No emails sent yet.</p>
                            ) : (
                                <>
                                    {emailLogs.slice((emailPage - 1) * itemsPerPage, emailPage * itemsPerPage).map(entry => (
                                        <div key={entry.id} className="bg-background/60 border border-border rounded-lg p-3">
                                            <div className="flex items-start justify-between gap-3">
                                                <p className="text-text font-semibold text-sm line-clamp-1">{entry.details?.subject || 'System Email'}</p>
                                                <span className="text-muted text-[11px] whitespace-nowrap">{formatDateTime(entry.timestamp)}</span>
                                            </div>
                                            <p className="text-muted text-xs mt-1">
                                                To: {entry.target?.username || entry.target?.email || 'Unknown'}
                                            </p>
                                        </div>
                                    ))}
                                    {totalEmailPages > 1 && (
                                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
                                            <button
                                                className="px-3 py-2 bg-border text-text rounded-md font-medium hover:bg-opacity-80 transition-colors text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                                                onClick={() => setEmailPage(p => Math.max(1, p - 1))}
                                                disabled={emailPage === 1}
                                            >
                                                Previous
                                            </button>
                                            <span className="text-xs text-muted font-semibold">Page {emailPage} of {totalEmailPages}</span>
                                            <button
                                                className="px-3 py-2 bg-border text-text rounded-md font-medium hover:bg-opacity-80 transition-colors text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                                                onClick={() => setEmailPage(p => Math.min(totalEmailPages, p + 1))}
                                                disabled={emailPage === totalEmailPages}
                                            >
                                                Next
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </section>
                </div>
            </main>
        </div>
    );
};

const ABOUT_CONTRIBUTORS = [
    {
        id: 'primary',
        name: 'jl94x4',
        href: 'https://github.com/jl94x4',
        avatarUrl: 'https://github.com/jl94x4.png?size=128',
    },
    {
        id: 'integration',
        name: 'Nerdy-Technician',
        href: 'https://github.com/Nerdy-Technician',
        avatarUrl: 'https://github.com/Nerdy-Technician.png?size=128',
    },
];

const ABOUT_LINKS = [
    { id: 'documentation', href: 'https://jl94x4.github.io/StreamPilot/' },
    { id: 'githubRepository', href: 'https://github.com/jl94x4/StreamPilot' },
    { id: 'featureOverview', href: 'https://jl94x4.github.io/StreamPilot/features/overview.html' },
    { id: 'gettingStarted', href: 'https://jl94x4.github.io/StreamPilot/guide/getting-started.html' },
];

export const AboutDashboard: React.FC<{ appVersion?: string; mediaServerType?: string }> = ({ appVersion, mediaServerType = 'plex' }) => {
    const { t } = useDiscoverI18n();
    const providerLabel = String(mediaServerType || 'plex').toLowerCase() === 'jellyfin'
        ? 'Jellyfin'
        : String(mediaServerType || 'plex').toLowerCase() === 'emby'
            ? 'Emby'
            : 'Plex';
    const featurePillClass = 'rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-muted';
    return (
        <div className="w-full space-y-6 animate-fade-in">
            <div className="rounded-xl border border-border/70 bg-card/80 overflow-hidden shadow-2xl">
                <div className="p-6 sm:p-8 border-b border-border/70 bg-gradient-to-br from-white/10 via-transparent to-plex/10">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
                        <div className="min-w-0">
                            <div className="flex items-center gap-3 mb-4">
                                <span className="w-12 h-12 rounded-xl bg-plex/15 border border-plex/30 flex items-center justify-center">
                                    <Info className="w-6 h-6 text-plex" />
                                </span>
                                <div>
                                    <p className="text-xs uppercase tracking-[0.22em] text-muted font-bold">{t('about.eyebrow')}</p>
                                    <h1 className="text-3xl sm:text-4xl font-black text-text tracking-tight">StreamPilot</h1>
                                </div>
                            </div>
                            <p className="text-base sm:text-lg text-muted max-w-3xl leading-relaxed">
                                {t('about.description')}
                            </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3 lg:w-72 flex-shrink-0">
                            <div className="rounded-lg border border-border bg-background/70 p-3">
                                <p className="text-[10px] uppercase tracking-[0.18em] text-muted">{t('about.currentMode')}</p>
                                <p className="mt-1 text-lg font-black text-text">{providerLabel}</p>
                            </div>
                            <div className="rounded-lg border border-border bg-background/70 p-3">
                                <p className="text-[10px] uppercase tracking-[0.18em] text-muted">{t('about.version')}</p>
                                <p className="mt-1 text-sm font-mono font-bold text-plex truncate">{appVersion || t('about.development')}</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-6 sm:p-8 grid grid-cols-1 xl:grid-cols-[1.35fr_0.65fr] gap-6">
                    <section className="space-y-5">
                        <div>
                            <h2 className="text-xl font-black text-text mb-3">{t('about.centralPlace')}</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {[
                                    { id: 'access', icon: Users },
                                    { id: 'stats', icon: BarChart3 },
                                    { id: 'monitoring', icon: Activity },
                                    { id: 'requests', icon: ClipboardList },
                                    { id: 'mediaStack', icon: Calendar },
                                    { id: 'maintenance', icon: Shield },
                                ].map(({ id, icon: Icon }) => (
                                    <div key={id} className="rounded-lg border border-border bg-background/70 p-4">
                                        <div className="flex items-center gap-3 mb-2">
                                            <span className="w-9 h-9 rounded-lg bg-plex/10 border border-plex/20 flex items-center justify-center">
                                                <Icon className="w-4 h-4 text-plex" />
                                            </span>
                                            <h3 className="font-bold text-text">{t(`about.features.${id}.title`)}</h3>
                                        </div>
                                        <p className="text-sm text-muted leading-relaxed">{t(`about.features.${id}.description`)}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="rounded-lg border border-border bg-background/70 p-4">
                            <h2 className="text-lg font-black text-text mb-3">{t('about.ecosystem.title')}</h2>
                            <div className="flex flex-wrap gap-2">
                                {['Plex', 'Jellyfin', 'Emby', 'Seerr', 'Jellyseerr', 'Ombi', 'Sonarr', 'Radarr', 'Tautulli', 'Jellystat', t('about.ecosystem.downloadClients')].map((item) => (
                                    <span key={item} className={featurePillClass}>{item}</span>
                                ))}
                            </div>
                        </div>
                    </section>

                    <aside className="space-y-5">
                        <section className="rounded-lg border border-border bg-background/70 p-4">
                            <div className="flex items-center gap-2 mb-4">
                                <GitFork className="w-5 h-5 text-plex" />
                                <h2 className="text-lg font-black text-text">{t('about.contributors.title')}</h2>
                            </div>
                            <div className="space-y-3">
                                {ABOUT_CONTRIBUTORS.map((contributor) => (
                                    <a
                                        key={contributor.name}
                                        href={contributor.href}
	                                        target="_blank"
	                                        rel="noopener noreferrer"
	                                        className="block rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 hover:border-plex/40 transition-colors p-3"
	                                    >
	                                        <div className="flex items-start gap-3">
	                                            <img
	                                                src={contributor.avatarUrl}
	                                                alt=""
	                                                className="w-12 h-12 rounded-full object-cover bg-background border border-white/10 flex-shrink-0"
	                                                loading="lazy"
	                                            />
	                                            <div className="min-w-0 flex-1">
	                                                <div className="flex items-center justify-between gap-3">
	                                                    <div className="min-w-0">
	                                                        <p className="font-bold text-text truncate">{contributor.name}</p>
                                                        <p className="text-xs text-plex font-bold">{t(`about.contributors.${contributor.id}.role`)}</p>
	                                                    </div>
	                                                    <ExternalLink className="w-4 h-4 text-muted flex-shrink-0" />
	                                                </div>
                                                <p className="mt-2 text-xs text-muted leading-relaxed">{t(`about.contributors.${contributor.id}.note`)}</p>
	                                            </div>
	                                        </div>
	                                    </a>
                                ))}
                            </div>
                        </section>

                        <section className="rounded-lg border border-border bg-background/70 p-4">
                            <div className="flex items-center gap-2 mb-4">
                                <BookOpen className="w-5 h-5 text-plex" />
                                <h2 className="text-lg font-black text-text">{t('about.links.title')}</h2>
                            </div>
                            <div className="space-y-2">
                                {ABOUT_LINKS.map((link) => (
                                    <a
                                        key={link.href}
                                        href={link.href}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 hover:border-plex/40 transition-colors px-3 py-2 text-sm font-semibold text-text"
                                    >
                                        <span>{t(`about.links.${link.id}`)}</span>
                                        <ExternalLink className="w-4 h-4 text-muted flex-shrink-0" />
                                    </a>
                                ))}
                            </div>
                        </section>
                    </aside>
                </div>
            </div>
        </div>
    );
};

// --- Admin Dashboard Component ---

export const AdminDashboard: React.FC<{ onLogout: () => void, onViewUserPortal: () => void, onViewStatus: () => void, onViewDashboard: () => void, onViewAsUser: (userId: string) => Promise<void>, onViewProfile?: (userId: string) => void }> = ({ onLogout, onViewUserPortal, onViewStatus, onViewDashboard, onViewAsUser, onViewProfile }) => {
    const { t } = useDiscoverI18n();
    const [users, setUsers] = useState<User[]>([]);
    const [isConfigured, setConfigured] = useState(false);
    const [configSettings, setConfigSettings] = useState<AppSettings>({ checkIntervalMinutes: 60 });
    const [isUserModalOpen, setUserModalOpen] = useState(false);
    const [isSettingsModalOpen, setSettingsModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [isLoading, setLoading] = useState(true);
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
    const [bulkCustomDate, setBulkCustomDate] = useState('');
    const [bulkLibrariesOpen, setBulkLibrariesOpen] = useState(false);
    const [bulkLibraries, setBulkLibraries] = useState<Array<{ id: string; title: string }>>([]);
    const [bulkSelectedLibraries, setBulkSelectedLibraries] = useState<string[]>([]);
    const [bulkLibrariesLoading, setBulkLibrariesLoading] = useState(false);
    const [emailModalOpen, setEmailModalOpen] = useState(false);
    const [emailUserIds, setEmailUserIds] = useState<string[]>([]);
    const [deletedUsers, setDeletedUsers] = useState<DeletedUser[]>([]);
    const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);

    // Filters and Sorting States
    const [searchQuery, setSearchQuery] = useState(() => {
        if (typeof window === 'undefined') return '';
        try {
            return new URLSearchParams(window.location.search).get('q')?.trim() || '';
        } catch {
            return '';
        }
    });
    const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'trial' | 'expiring' | 'expired' | 'revoked' | 'pending'>('all');
    const [extraFilters, setExtraFilters] = useState<Array<'noEmail' | 'neverLoggedIn' | 'exempt' | 'newsletterOff'>>([]);
    const [sortBy, setSortBy] = useState<'username-asc' | 'username-desc' | 'expiry-asc' | 'expiry-desc' | 'joined-desc' | 'lastLogin-desc' | 'lastLogin-asc'>('username-asc');
    const mediaServerType = String(configSettings.mediaServerType || 'plex').toLowerCase();
    const mediaServerLabel = mediaServerType === 'emby' ? 'Emby' : mediaServerType === 'jellyfin' ? 'Jellyfin' : 'Plex';

    const addToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
        setToasts(t => pushToast(t, message, type));
    }, []);

    useEffect(() => {
        const syncSearchFromUrl = () => {
            try {
                const q = new URLSearchParams(window.location.search).get('q')?.trim() || '';
                if (q) setSearchQuery(q);
            } catch {
                /* ignore */
            }
        };
        syncSearchFromUrl();
        window.addEventListener('popstate', syncSearchFromUrl);
        return () => window.removeEventListener('popstate', syncSearchFromUrl);
    }, []);

    const fetchUsers = useCallback(async () => {
        try {
            const usersData = await apiFetch('/api/users');
            setUsers(usersData);
        } catch (error) {
            addToast(error instanceof Error ? error.message : t('usersAdmin.errors.fetchUsers'), 'error');
        }
    }, [addToast, t]);

    const fetchSecurityData = useCallback(async () => {
        try {
            const [deletedUsersData, auditLogData] = await Promise.all([
                apiFetch('/api/deleted-users'),
                apiFetch('/api/audit-log')
            ]);
            setDeletedUsers(deletedUsersData);
            setAuditEntries(Array.isArray(auditLogData?.entries) ? auditLogData.entries : (Array.isArray(auditLogData) ? auditLogData : []));
        } catch (error) {
            addToast(error instanceof Error ? error.message : t('usersAdmin.errors.fetchSecurity'), 'error');
        }
    }, [addToast, t]);

    useEffect(() => {
        const checkConfigAndFetchData = async () => {
            setLoading(true);
            try {
                const configStatus = await apiFetch('/api/config');
                setConfigured(configStatus.configured);
                setConfigSettings(configStatus.settings); // Always update settings from backend

                if (configStatus.configured) {
                    await fetchUsers();
                    await fetchSecurityData();
                } else {
                    addToast(t('usersAdmin.toasts.configureWelcome'), 'success');
                    setSettingsModalOpen(true);
                }
            } catch (error) {
                addToast(error instanceof Error ? error.message : t('usersAdmin.errors.backendConnection'), 'error');
            } finally {
                setLoading(false);
            }
        };
        checkConfigAndFetchData();
    }, [fetchUsers, fetchSecurityData, addToast]);


    const handleSaveConfig = async (config: PlexConfig) => {
        setLoading(true);
        try {
            await apiFetch('/api/config', {
                method: 'POST',
                body: JSON.stringify(config)
            });
            setConfigured(true);
            setConfigSettings({
                token: config.token,
                serverIdentifier: config.serverIdentifier,
                checkIntervalMinutes: config.checkIntervalMinutes || 60,
                smtpHost: config.smtpHost,
                smtpPort: config.smtpPort,
                smtpUser: config.smtpUser,
                smtpPass: config.smtpPass,
                smtpFrom: config.smtpFrom,
                smtpSecure: config.smtpSecure,
                emailDaysBefore: config.emailDaysBefore,
                newsletterFrequency: config.newsletterFrequency,
                newsletterDay: config.newsletterDay,
                publicDomain: config.publicDomain
            });
            setSettingsModalOpen(false);
            addToast(t('usersAdmin.toasts.settingsSaved'));
            await fetchUsers();
        } catch (error) {
            addToast(error instanceof Error ? error.message : t('usersAdmin.errors.saveConfig'), 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleImportUsers = async () => {
        if (!isConfigured) {
            addToast(t('usersAdmin.errors.configureMediaServer', { mediaServerLabel }), 'error');
            return;
        }
        setLoading(true);
        try {
            const result = await apiFetch('/api/sync', { method: 'POST' });
            addToast(result.message || t('usersAdmin.toasts.syncedUsers', { count: result.count || 0, mediaServerLabel }));
            await fetchUsers(); // Refresh user list
            await fetchSecurityData();
        } catch (error) {
            addToast(error instanceof Error ? error.message : t('usersAdmin.errors.sync'), 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleBackfillJoiningDates = async () => {
        if (!isConfigured) {
            addToast(t('usersAdmin.errors.configureMediaServer', { mediaServerLabel }), 'error');
            return;
        }
        setLoading(true);
        try {
            const result = await apiFetch('/api/users/backfill-joining-dates', {
                method: 'POST',
                body: JSON.stringify({ overwriteIfEarlier: true }),
            });
            const updated = Number(result?.updated) || 0;
            const processed = Number(result?.processed) || 0;
            const missing = Number(result?.missing) || 0;
            if (updated > 0) {
                addToast(t('usersAdmin.toasts.joinDatesUpdated', { updated, processed }));
            } else {
                addToast(
                    missing > 0
                        ? t('usersAdmin.toasts.noJoinDatesUpdated', { missing })
                        : t('usersAdmin.toasts.noJoinDatesNeeded'),
                );
            }
            await fetchUsers();
        } catch (error) {
            addToast(error instanceof Error ? error.message : t('usersAdmin.errors.backfillJoinDates'), 'error');
        } finally {
            setLoading(false);
        }
    };

    const revokePlexAccess = async (user: User) => {
        const ok = await askConfirm(
            t('usersAdmin.dialogs.revokeUser', { username: user.username, provider: mediaServerLabel }),
            {
                title: t('usersAdmin.actions.revoke'),
                confirmLabel: t('usersAdmin.actions.revoke'),
                cancelLabel: t('common.cancel'),
                danger: true,
            },
        );
        if (!ok) return;
        setLoading(true);
        try {
            const updatedUser = await apiFetch(`/api/users/${user.id}/revoke`, { method: 'POST' });
            setUsers(currentUsers => currentUsers.map(u => u.id === user.id ? updatedUser : u));
            addToast(t('usersAdmin.toasts.accessRevoked'));
            await fetchSecurityData();
        } catch (error) {
            addToast(error instanceof Error ? error.message : t('usersAdmin.errors.revokeAccess'), 'error');
        } finally {
            setLoading(false);
        }
    };

    const resendUserInvite = async (user: User) => {
        const ok = await askConfirm(
            t('usersAdmin.dialogs.resendInvite', { username: user.username }),
            {
                title: t('usersAdmin.actions.resendInvite'),
                confirmLabel: t('usersAdmin.actions.resendInvite'),
                cancelLabel: t('common.cancel'),
            },
        );
        if (!ok) return;
        setLoading(true);
        try {
            const updatedUser = await apiFetch(`/api/users/${user.id}/resend-invite`, { method: 'POST' });
            setUsers(currentUsers => currentUsers.map(u => u.id === user.id ? updatedUser : u));
            addToast(t('usersAdmin.toasts.inviteResent', { username: user.username }));
        } catch (error) {
            addToast(error instanceof Error ? error.message : t('usersAdmin.errors.resendInvite'), 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleViewAsUser = async (user: User) => {
        setLoading(true);
        try {
            await onViewAsUser(user.id);
            addToast(t('usersAdmin.toasts.viewingAs', { username: user.username }));
        } catch (error) {
            addToast(error instanceof Error ? error.message : t('usersAdmin.errors.viewAs'), 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleOpenUserModal = (user: User) => {
        setEditingUser(user);
        setUserModalOpen(true);
    };

    const handleCloseModal = () => {
        setUserModalOpen(false);
        setEditingUser(null);
    };

    const handleSaveUser = async (userToSave: User) => {
        setLoading(true);
        try {
            const payload: Record<string, unknown> = {
                expiryDate: userToSave.expiryDate,
                exemptFromCleanup: userToSave.exemptFromCleanup,
                optOutNewsletter: userToSave.optOutNewsletter,
                requestOverrides: userToSave.requestOverrides || {},
            };
            if (userToSave.libraryIds !== undefined) {
                payload.libraryIds = Array.isArray(userToSave.libraryIds) ? userToSave.libraryIds : [];
            }
            const updatedUser = await apiFetch(`/api/users/${userToSave.id}`, {
                method: 'PUT',
                body: JSON.stringify(payload),
            });
            setUsers(users.map(u => u.id === updatedUser.id ? updatedUser : u));
            handleCloseModal();
            if (updatedUser.warning) {
                addToast(updatedUser.warning, 'error');
            } else if (updatedUser.plexShareUpdated === false) {
                addToast(t('usersAdmin.toasts.savedLibraryWarning'), 'error');
            } else {
                addToast(t('usersAdmin.toasts.userUpdated'));
            }
            await fetchSecurityData();
        } catch (error) {
            addToast(error instanceof Error ? error.message : t('usersAdmin.errors.saveUser'), 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteUser = async (userId: string) => {
        appConfirm(t('usersAdmin.dialogs.deleteUser', { mediaServerLabel }), async () => {
            setLoading(true);
            try {
                await apiFetch(`/api/users/${userId}`, { method: 'DELETE' });
                setUsers(users.filter(u => u.id !== userId));
                addToast(t('usersAdmin.toasts.userRemoved'));
                await fetchSecurityData();
            } catch (error) {
                addToast(error instanceof Error ? error.message : t('usersAdmin.errors.deleteUser'), 'error');
            } finally {
                setLoading(false);
            }
        });
    };

    const handleToggleSelection = (userId: string) => {
        setSelectedUserIds(prev =>
            prev.includes(userId)
                ? prev.filter(id => id !== userId)
                : [...prev, userId]
        );
    };

    const handleBulkUpdate = async (action: 'addMonth' | 'addYear' | 'unlimited' | 'custom', customDate?: string) => {
        if (action === 'custom' && !customDate) {
            addToast(t('usersAdmin.errors.selectCustomDate'), 'error');
            return;
        }
        const message = action === 'addMonth'
            ? t('usersAdmin.dialogs.bulkAddMonth', { count: selectedUserIds.length })
            : action === 'addYear'
                ? t('usersAdmin.dialogs.bulkAddYear', { count: selectedUserIds.length })
                : action === 'unlimited'
                    ? t('usersAdmin.dialogs.bulkUnlimited', { count: selectedUserIds.length })
                    : t('usersAdmin.dialogs.bulkCustom', { count: selectedUserIds.length, date: customDate || '' });
        const ok = await askConfirm(message, {
            title: t('usersAdmin.dialogs.bulkExpiryTitle'),
            confirmLabel: t('usersAdmin.dialogs.bulkExpiryConfirm'),
            cancelLabel: t('common.cancel'),
            danger: action === 'unlimited',
        });
        if (!ok) return;
        setLoading(true);
        try {
            await apiFetch('/api/users/bulk-update', {
                method: 'POST',
                body: JSON.stringify({ userIds: selectedUserIds, action, customDate })
            });
            addToast(t('usersAdmin.toasts.bulkUpdated', { count: selectedUserIds.length }));
            setSelectedUserIds([]);
            setBulkCustomDate('');
            setBulkLibrariesOpen(false);
            await fetchUsers();
            await fetchSecurityData();
        } catch (error) {
            addToast(error instanceof Error ? error.message : t('usersAdmin.errors.bulkUpdate'), 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleBulkFlags = async (patch: { exemptFromCleanup?: boolean; optOutNewsletter?: boolean }) => {
        const count = selectedUserIds.length;
        const message = patch.exemptFromCleanup === true
            ? t('usersAdmin.dialogs.bulkExempt', { count })
            : patch.exemptFromCleanup === false
                ? t('usersAdmin.dialogs.bulkIncludeCleanup', { count })
                : patch.optOutNewsletter === true
                    ? t('usersAdmin.dialogs.bulkNewsletterOff', { count })
                    : t('usersAdmin.dialogs.bulkNewsletterOn', { count });
        const ok = await askConfirm(message, {
            title: t('usersAdmin.dialogs.flagsTitle'),
            confirmLabel: t('usersAdmin.dialogs.bulkExpiryConfirm'),
            cancelLabel: t('common.cancel'),
        });
        if (!ok) return;
        setLoading(true);
        try {
            const result = await apiFetch('/api/users/bulk-flags', {
                method: 'POST',
                body: JSON.stringify({ userIds: selectedUserIds, ...patch }),
            });
            addToast(result.message || t('usersAdmin.toasts.flagsUpdated', { count }));
            setSelectedUserIds([]);
            setBulkLibrariesOpen(false);
            await fetchUsers();
        } catch (error) {
            addToast(error instanceof Error ? error.message : t('usersAdmin.errors.bulkFlags'), 'error');
        } finally {
            setLoading(false);
        }
    };

    const openBulkLibraries = async () => {
        setBulkLibrariesOpen(true);
        if (bulkLibraries.length > 0) {
            if (bulkSelectedLibraries.length === 0) {
                setBulkSelectedLibraries(bulkLibraries.map((l) => l.id));
            }
            return;
        }
        setBulkLibrariesLoading(true);
        try {
            const libs = await apiFetch('/api/plex/libraries');
            const list = Array.isArray(libs) ? libs : [];
            const mapped = list.map((l: any) => ({ id: String(l.id), title: l.title || `Library ${l.id}` }));
            setBulkLibraries(mapped);
            setBulkSelectedLibraries(mapped.map((l) => l.id));
        } catch (error) {
            addToast(error instanceof Error ? error.message : t('usersAdmin.errors.loadLibraries'), 'error');
            setBulkLibrariesOpen(false);
        } finally {
            setBulkLibrariesLoading(false);
        }
    };

    const handleBulkLibraries = () => {
        const count = selectedUserIds.length;
        const allIds = bulkLibraries.map((l) => l.id);
        const allSelected =
            allIds.length > 0 &&
            bulkSelectedLibraries.length >= allIds.length &&
            allIds.every((id) => bulkSelectedLibraries.includes(id));
        const libraryIds = allSelected || bulkSelectedLibraries.length === 0 ? [] : bulkSelectedLibraries;
        const label = libraryIds.length === 0
            ? t('usersAdmin.dialogs.shareAllLibraries', { count })
            : t('usersAdmin.dialogs.shareSelectedLibraries', { libraries: libraryIds.length, count });
        appConfirm(`${label} ${t('usersAdmin.dialogs.livePlexAccess')}`, async () => {
            setLoading(true);
            try {
                const result = await apiFetch('/api/users/bulk-libraries', {
                    method: 'POST',
                    body: JSON.stringify({
                        userIds: selectedUserIds,
                        libraryIds,
                    }),
                });
                const failed = Number(result?.plexFailedCount) || 0;
                if (failed > 0) {
                    addToast(`${result.message || t('usersAdmin.toasts.saved')} ${t('usersAdmin.toasts.plexShareFailures', { count: failed })}`, 'error');
                } else {
                    addToast(result.message || t('usersAdmin.toasts.librariesUpdated', { count }));
                }
                setSelectedUserIds([]);
                setBulkSelectedLibraries([]);
                setBulkLibrariesOpen(false);
                await fetchUsers();
                await fetchSecurityData();
            } catch (error) {
            addToast(error instanceof Error ? error.message : t('usersAdmin.errors.bulkLibraryUpdate'), 'error');
            } finally {
                setLoading(false);
            }
        });
    };

    const handleUnblockDeletedUser = async (deletedUser: DeletedUser) => {
        const label = deletedUser.username || deletedUser.email || 'this user';
        appConfirm(`Allow ${label} to use the portal again? This does not invite them automatically.`, async () => {
            setLoading(true);
            try {
                await apiFetch(`/api/deleted-users/${encodeURIComponent(deletedUser.blockId)}`, { method: 'DELETE' });
                addToast('Deleted user unblocked.');
                await fetchSecurityData();
            } catch (error) {
                addToast(error instanceof Error ? error.message : 'Failed to unblock user.', 'error');
            } finally {
                setLoading(false);
            }
        });
    };

    // Derived State for Filtering and Sorting
    const filteredAndSortedUsers = useMemo(() => {
        return users
            .filter(user => {
                const query = searchQuery.toLowerCase().trim();
                if (query) {
                    const matchesName = user.username.toLowerCase().includes(query);
                    const matchesEmail = user.email?.toLowerCase().includes(query) || false;
                    if (!matchesName && !matchesEmail) return false;
                }

                if (statusFilter === 'all') {
                    // continue to extra filters
                } else {
                    const days = getDaysUntilExpiry(user.expiryDate);
                    const isRevoked = user.plexAccessStatus === 'revoked' && !(user.isServerOwner || user.isAdmin);
                    const isTrial = user.isTrial === true;
                    const isPending = user.plexAccessStatus === 'pending' && !(user.isServerOwner || user.isAdmin);

                    if (statusFilter === 'trial') {
                        if (!isTrial) return false;
                    } else if (statusFilter === 'revoked') {
                        if (!isRevoked) return false;
                    } else if (statusFilter === 'pending') {
                        if (!isPending) return false;
                    } else {
                        if (isRevoked) return false;
                        if (statusFilter === 'active' && !(days === null || days > 30)) return false;
                        if (statusFilter === 'expiring' && !(days !== null && days >= 0 && days <= 30)) return false;
                        if (statusFilter === 'expired' && !(days !== null && days < 0)) return false;
                    }
                }

                if (extraFilters.includes('noEmail') && String(user.email || '').trim()) return false;
                if (extraFilters.includes('neverLoggedIn') && user.lastLogin) return false;
                if (extraFilters.includes('exempt') && !user.exemptFromCleanup) return false;
                if (extraFilters.includes('newsletterOff') && !user.optOutNewsletter) return false;

                return true;
            })
            .sort((a, b) => {
                if (sortBy === 'username-asc') {
                    return a.username.localeCompare(b.username);
                }
                if (sortBy === 'username-desc') {
                    return b.username.localeCompare(a.username);
                }
                if (sortBy === 'joined-desc') {
                    return new Date(b.joiningDate).getTime() - new Date(a.joiningDate).getTime();
                }
                if (sortBy === 'lastLogin-desc' || sortBy === 'lastLogin-asc') {
                    const aMs = a.lastLogin ? new Date(a.lastLogin).getTime() : 0;
                    const bMs = b.lastLogin ? new Date(b.lastLogin).getTime() : 0;
                    return sortBy === 'lastLogin-desc' ? bMs - aMs : aMs - bMs;
                }
                if (sortBy === 'expiry-asc') {
                    if (a.expiryDate === null) return 1;
                    if (b.expiryDate === null) return -1;
                    return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
                }
                if (sortBy === 'expiry-desc') {
                    if (a.expiryDate === null) return 1;
                    if (b.expiryDate === null) return -1;
                    return new Date(b.expiryDate).getTime() - new Date(a.expiryDate).getTime();
                }
                return 0;
            });
    }, [users, searchQuery, statusFilter, extraFilters, sortBy]);

    const filteredUserIds = useMemo(() => filteredAndSortedUsers.map(u => u.id), [filteredAndSortedUsers]);
    const allFilteredSelected = filteredUserIds.length > 0 && filteredUserIds.every(id => selectedUserIds.includes(id));

    const userStats = useMemo(() => {
        let active = 0;
        let expiring = 0;
        let expired = 0;
        let trial = 0;
        let revoked = 0;
        for (const user of users) {
            if (user.plexAccessStatus === 'revoked' && !(user.isServerOwner || user.isAdmin)) {
                revoked += 1;
                continue;
            }
            if (user.isTrial) {
                trial += 1;
                continue;
            }
            const days = getDaysUntilExpiry(user.expiryDate);
            if (days !== null && days < 0) expired += 1;
            else if (days !== null && days <= 30) expiring += 1;
            else active += 1;
        }
        return { total: users.length, active, expiring, expired, trial, revoked };
    }, [users]);

    const [statsCollapsed, setStatsCollapsed] = usePersistedCollapsed(
        USERS_STATS_COLLAPSED_KEY,
        preferCollapsedOnNarrow(),
    );

    return (
        <DashboardPageShell>
            <Loader isLoading={isLoading} />
            <ToastContainer toasts={toasts} setToasts={setToasts} />

            <DashboardHero
                accent="plex"
                eyebrow={t('usersAdmin.page.eyebrow')}
                title={t('navigation.users')}
                description={isConfigured ? (
                    <>
                        {t('usersAdmin.page.summary', { total: userStats.total, active: userStats.active, shown: filteredAndSortedUsers.length })}
                    </>
                ) : (
                    <>{t('usersAdmin.page.configureHint')}</>
                )}
                icon={<Users className="h-3.5 w-3.5" />}
                secondaryBlob
                actions={isConfigured ? (
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-plex px-4 py-2.5 text-sm font-bold text-background transition-colors hover:bg-plex-hover disabled:opacity-50"
                            onClick={handleImportUsers}
                            disabled={isLoading}
                        >
                            <RefreshCw className="h-4 w-4" />
                            {t('usersAdmin.actions.syncUsers', { mediaServerLabel })}
                        </button>
                        <button
                            type="button"
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm font-bold text-text transition-colors hover:bg-white/5 disabled:opacity-50"
                            onClick={handleBackfillJoiningDates}
                            disabled={isLoading}
                            title={t('usersAdmin.actions.backfillTitle')}
                        >
                            <Calendar className="h-4 w-4" />
                            {t('usersAdmin.actions.backfillJoinDates')}
                        </button>
                    </div>
                ) : undefined}
            />

            <main>
                {isConfigured && (
                    <section className="mb-6">
                        <div className={`${statsCollapsed ? '' : 'mb-3'} flex items-center justify-between gap-3`}>
                            <button
                                type="button"
                                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                onClick={() => setStatsCollapsed(!statsCollapsed)}
                                aria-expanded={!statsCollapsed}
                                aria-label={statsCollapsed ? t('usersAdmin.stats.expand') : t('usersAdmin.stats.collapse')}
                            >
                                <span className="w-3 shrink-0 text-muted" aria-hidden>{statsCollapsed ? '▸' : '▾'}</span>
                                <h2 className="w-full border-b border-white/10 pb-2 text-sm font-bold uppercase tracking-[2px] text-plex">
                                    {t('usersAdmin.stats.title')}
                                </h2>
                            </button>
                            {statsCollapsed ? (
                                <span className="shrink-0 text-xs font-semibold text-muted">
                                    {t('usersAdmin.stats.summary', { total: userStats.total, active: userStats.active })}
                                </span>
                            ) : null}
                        </div>
                        {statsCollapsed ? null : (
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6 xl:gap-4">
                                <DashboardStatCard
                                    label={t('usersAdmin.stats.total')}
                                    value={userStats.total}
                                    icon={<Users className="h-4 w-4 text-plex" />}
                                    glow={dashboardGlowClass('plex')}
                                />
                                <DashboardStatCard
                                    label={t('usersAdmin.stats.active')}
                                    value={userStats.active}
                                    icon={<CheckCircle className="h-4 w-4 text-emerald-300" />}
                                    glow={dashboardGlowClass('emerald')}
                                    valueClassName="text-status-active"
                                />
                                <DashboardStatCard
                                    label={t('usersAdmin.stats.expiring')}
                                    value={userStats.expiring}
                                    icon={<AlertTriangle className="h-4 w-4 text-amber-300" />}
                                    glow={dashboardGlowClass('amber')}
                                    valueClassName="text-status-expiring"
                                />
                                <DashboardStatCard
                                    label={t('usersAdmin.stats.expired')}
                                    value={userStats.expired}
                                    icon={<AlertCircle className="h-4 w-4 text-rose-300" />}
                                    glow={dashboardGlowClass('rose')}
                                    valueClassName="text-status-expired"
                                />
                                <DashboardStatCard
                                    label={t('usersAdmin.stats.trial')}
                                    value={userStats.trial}
                                    icon={<Sparkles className="h-4 w-4 text-violet-300" />}
                                    glow={dashboardGlowClass('violet')}
                                />
                                <DashboardStatCard
                                    label={t('usersAdmin.stats.revoked')}
                                    value={userStats.revoked}
                                    icon={<Shield className="h-4 w-4 text-muted" />}
                                    glow={dashboardGlowClass('muted')}
                                />
                            </div>
                        )}
                    </section>
                )}

                {isConfigured && (
                    <DashboardPanel
                        title={t('usersAdmin.filters.title')}
                        subtitle={t('usersAdmin.filters.subtitle')}
                        className="mb-6"
                        controls={(
                            <CustomSelect
                                id="sortSelect"
                                value={sortBy}
                                onChange={(val) => setSortBy(val as any)}
                                className="w-full sm:w-[200px]"
                                options={[
                                    { label: t('usersAdmin.filters.usernameAsc'), value: 'username-asc' },
                                    { label: t('usersAdmin.filters.usernameDesc'), value: 'username-desc' },
                                    { label: t('usersAdmin.filters.expiryAsc'), value: 'expiry-asc' },
                                    { label: t('usersAdmin.filters.expiryDesc'), value: 'expiry-desc' },
                                    { label: t('usersAdmin.filters.joinedDesc'), value: 'joined-desc' },
                                    { label: t('usersAdmin.filters.lastLoginDesc'), value: 'lastLogin-desc' },
                                    { label: t('usersAdmin.filters.lastLoginAsc'), value: 'lastLogin-asc' },
                                ]}
                            />
                        )}
                    >
                        <div className="flex flex-col gap-4">
                            <div className="relative w-full">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                                <input
                                    type="text"
                                    inputMode="search"
                                    enterKeyHint="search"
                                    autoComplete="off"
                                    autoCorrect="off"
                                    autoCapitalize="none"
                                    spellCheck={false}
                                    placeholder={t('usersAdmin.filters.searchPlaceholder')}
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full appearance-none rounded-xl border border-white/10 bg-black/20 py-3 pr-10 pl-10 text-[16px] leading-5 text-text outline-none transition focus:border-plex/40 focus:ring-1 focus:ring-plex/20"
                                    style={{ fontSize: 16 }}
                                />
                                {searchQuery && (
                                    <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text text-xl" onClick={() => setSearchQuery('')}>×</button>
                                )}
                            </div>

                            <div className="flex flex-wrap gap-1 rounded-xl border border-white/10 bg-black/20 p-1">
                                {(['all', 'active', 'trial', 'expiring', 'expired', 'revoked', 'pending'] as const).map((status) => (
                                    <button
                                        key={status}
                                        type="button"
                                        title={status === 'all' ? t('usersAdmin.filters.subtitle') : t(`usersAdmin.statusHints.${status}` as any)}
                                        className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors border-none outline-none cursor-pointer sm:text-sm ${dashboardSubnavLinkClass(statusFilter === status)}`}
                                        onClick={() => setStatusFilter(status)}
                                    >
                                        {status === 'all' ? t('usersAdmin.filters.all') : t(`usersAdmin.status.${status}` as any)}
                                    </button>
                                ))}
                            </div>
                            <div>
                                <p className="text-[10px] uppercase tracking-wider font-bold text-muted mb-1.5">{t('usersAdmin.filters.extraTitle')}</p>
                                <div className="flex flex-wrap gap-1 rounded-xl border border-white/10 bg-black/20 p-1">
                                    {(['noEmail', 'neverLoggedIn', 'exempt', 'newsletterOff'] as const).map((key) => {
                                        const selected = extraFilters.includes(key);
                                        return (
                                            <button
                                                key={key}
                                                type="button"
                                                title={t(`usersAdmin.filters.extraHints.${key}` as any)}
                                                className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors border-none outline-none cursor-pointer sm:text-sm ${dashboardSubnavLinkClass(selected)}`}
                                                onClick={() => setExtraFilters((prev) => (
                                                    prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
                                                ))}
                                            >
                                                {t(`usersAdmin.filters.${key}` as any)}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            {(statusFilter !== 'all' || extraFilters.length > 0) && (
                                <p className="text-xs text-muted leading-relaxed">
                                    {statusFilter !== 'all' ? t(`usersAdmin.statusHints.${statusFilter}` as any) : t('usersAdmin.filters.subtitle')}
                                </p>
                            )}
                        </div>
                    </DashboardPanel>
                )}

                {selectedUserIds.length > 0 && (
                    <DashboardPanel
                        title={t('usersAdmin.bulk.title')}
                        subtitle={t('usersAdmin.bulk.selectedSummary', { count: selectedUserIds.length })}
                        className="mb-6"
                        badge={(
                            <span className="rounded-full border border-plex/30 bg-plex/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-plex">
                                {t('usersAdmin.bulk.selected', { count: selectedUserIds.length })}
                            </span>
                        )}
                    >
                        <div className="space-y-4">
                            <div className="flex flex-wrap items-center gap-4 text-sm font-medium">
                                {allFilteredSelected ? (
                                    <button type="button" className="text-muted underline transition-colors hover:text-text" onClick={() => setSelectedUserIds(prev => prev.filter(id => !filteredUserIds.includes(id)))}>{t('usersAdmin.bulk.unselectFiltered')}</button>
                                ) : (
                                    <button type="button" className="text-muted underline transition-colors hover:text-text" onClick={() => setSelectedUserIds(prev => Array.from(new Set([...prev, ...filteredUserIds])))}>{t('usersAdmin.bulk.selectFiltered', { count: filteredAndSortedUsers.length })}</button>
                                )}
                                {selectedUserIds.length < users.length && (
                                    <button type="button" className="text-muted underline transition-colors hover:text-text" onClick={() => setSelectedUserIds(users.map(user => user.id))}>{t('usersAdmin.bulk.selectAll', { count: users.length })}</button>
                                )}
                                <button type="button" className="text-muted underline transition-colors hover:text-text" onClick={() => { setSelectedUserIds([]); setBulkLibrariesOpen(false); }}>{t('usersAdmin.bulk.unselectAll')}</button>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <button type="button" className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-white/5" onClick={() => handleBulkUpdate('addMonth')}>{t('usersAdmin.bulk.addMonth')}</button>
                                <button type="button" className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-white/5" onClick={() => handleBulkUpdate('addYear')}>{t('usersAdmin.bulk.addYear')}</button>
                                <button type="button" className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-white/5" onClick={() => handleBulkUpdate('unlimited')}>{t('usersAdmin.modal.unlimited')}</button>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="date"
                                        value={bulkCustomDate}
                                        onChange={(e) => setBulkCustomDate(e.target.value)}
                                        className="cursor-pointer rounded-xl border border-white/10 bg-black/20 p-2 text-sm text-text outline-none focus:border-plex/40"
                                    />
                                    <button
                                        type="button"
                                        className="rounded-xl bg-plex px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-plex-hover"
                                        onClick={() => {
                                            if (!bulkCustomDate) {
                                                addToast(t('usersAdmin.errors.selectCustomDate'), 'error');
                                                return;
                                            }
                                            handleBulkUpdate('custom', bulkCustomDate);
                                        }}
                                    >
                                        {t('usersAdmin.bulk.setCustomDate')}
                                    </button>
                                </div>
                                <button
                                    type="button"
                                    className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${bulkLibrariesOpen ? 'bg-plex text-background' : 'border border-white/10 bg-black/20 text-text hover:bg-white/5'}`}
                                    onClick={() => {
                                        if (bulkLibrariesOpen) setBulkLibrariesOpen(false);
                                        else openBulkLibraries();
                                    }}
                                >
                                    {t('usersAdmin.bulk.libraries')}
                                </button>
                                <button
                                    type="button"
                                    className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-white/5 inline-flex items-center gap-2"
                                    onClick={() => {
                                        setEmailUserIds(selectedUserIds);
                                        setEmailModalOpen(true);
                                    }}
                                >
                                    <Mail className="w-4 h-4" />
                                    {t('usersAdmin.bulk.emailSelected')}
                                </button>
                                <button type="button" className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-white/5" onClick={() => handleBulkFlags({ exemptFromCleanup: true })}>{t('usersAdmin.bulk.exemptCleanup')}</button>
                                <button type="button" className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-white/5" onClick={() => handleBulkFlags({ exemptFromCleanup: false })}>{t('usersAdmin.bulk.includeCleanup')}</button>
                                <button type="button" className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-white/5" onClick={() => handleBulkFlags({ optOutNewsletter: true })}>{t('usersAdmin.bulk.newsletterOff')}</button>
                                <button type="button" className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-white/5" onClick={() => handleBulkFlags({ optOutNewsletter: false })}>{t('usersAdmin.bulk.newsletterOn')}</button>
                            </div>
                            {bulkLibrariesOpen && (
                                <div className="border-t border-white/10 pt-4">
                                    <p className="mb-3 text-xs text-muted">
                                        {t('usersAdmin.bulk.libraryHint', { count: selectedUserIds.length })}
                                    </p>
                                    {bulkLibrariesLoading ? (
                                        <div className="py-2 text-sm text-muted">{t('usersAdmin.modal.loadingLibraries')}</div>
                                    ) : bulkLibraries.length === 0 ? (
                                        <div className="py-2 text-sm text-muted">{t('usersAdmin.modal.noLibraries')}</div>
                                    ) : (
                                        <div className="mb-3 flex flex-wrap gap-2">
                                            {bulkLibraries.map((lib) => (
                                                <label key={lib.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 transition-colors hover:border-plex/30">
                                                    <input
                                                        type="checkbox"
                                                        checked={bulkSelectedLibraries.includes(lib.id)}
                                                        onChange={(e) => {
                                                            if (e.target.checked) setBulkSelectedLibraries([...bulkSelectedLibraries, lib.id]);
                                                            else setBulkSelectedLibraries(bulkSelectedLibraries.filter((id) => id !== lib.id));
                                                        }}
                                                        className="accent-plex"
                                                    />
                                                    <span className="text-sm font-medium">{lib.title}</span>
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            className="rounded-xl bg-plex px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-plex-hover disabled:opacity-50"
                                            disabled={bulkLibrariesLoading || bulkLibraries.length === 0}
                                            onClick={handleBulkLibraries}
                                        >
                                            {t('usersAdmin.bulk.applyLibraries')}
                                        </button>
                                        <button
                                            type="button"
                                            className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-white/5"
                                            onClick={() => setBulkSelectedLibraries(bulkLibraries.map((l) => l.id))}
                                        >
                                            {t('usersAdmin.bulk.selectAllPlain')}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </DashboardPanel>
                )}

                {isConfigured && filteredAndSortedUsers.length === 0 && !isLoading && (
                    <DashboardPanel title={t('usersAdmin.empty.title')} subtitle={t('usersAdmin.empty.subtitle')}>
                        <p className="text-center text-sm text-muted">{t('usersAdmin.empty.body')}</p>
                    </DashboardPanel>
                )}

                {isConfigured && filteredAndSortedUsers.length > 0 && (
                    <DashboardPanel
                        title={t('usersAdmin.page.portalUsers')}
                        subtitle={t('usersAdmin.page.showing', { shown: filteredAndSortedUsers.length, total: users.length })}
                        className="mb-6"
                    >
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {filteredAndSortedUsers.map((user) => (
                                <UserCard
                                    key={user.id}
                                    user={user}
                                    onEdit={() => handleOpenUserModal(user)}
                                    onDelete={() => handleDeleteUser(user.id)}
                                    onRevoke={() => revokePlexAccess(user)}
                                    onViewAs={() => handleViewAsUser(user)}
                                    onViewAnalytics={() => {
                                        window.location.assign(portalUrl(`/analytics#user=${encodeURIComponent(user.username)}`));
                                    }}
                                    onViewProfile={onViewProfile ? () => onViewProfile(String(user.id || user.plexAccountId || user.username)) : undefined}
                                    isConfigured={isConfigured}
                                    isSelected={selectedUserIds.includes(user.id)}
                                    onSelect={handleToggleSelection}
                                    onEmail={user.email ? () => {
                                        setEmailUserIds([user.id]);
                                        setEmailModalOpen(true);
                                    } : undefined}
                                    onResendInvite={user.plexAccessStatus === 'pending' && !(user.isServerOwner || user.isAdmin)
                                        ? () => resendUserInvite(user)
                                        : undefined}
                                    onCopied={(message) => addToast(message)}
                                    providerLabel={mediaServerLabel}
                                />
                            ))}
                        </div>
                    </DashboardPanel>
                )}
            </main>
            <UserModal
                isOpen={isUserModalOpen}
                onClose={handleCloseModal}
                onSave={handleSaveUser}
                user={editingUser}
            />
            <EmailSelectedUsersModal
                open={emailModalOpen}
                onClose={() => setEmailModalOpen(false)}
                users={users}
                selectedUserIds={emailUserIds}
            />
        </DashboardPageShell>
    );
};

// --- User Portal Components ---

const loginPrimaryBtnClass = themeClasses.btnPrimaryLg;
const loginSecondaryBtnClass = `${themeClasses.btnSecondary} w-full px-8 py-4 text-base`;

const PublicUptimeBanner: React.FC = () => {
    const [healthData, setHealthData] = useState<Record<string, any>>({});
    const [config, setConfig] = useState<any>({});
    const [statusError, setStatusError] = useState<string | null>(null);
    const [hasLoaded, setHasLoaded] = useState(false);
    const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
    const [staleHint, setStaleHint] = useState(false);
    const hasLoadedRef = useRef(false);
    hasLoadedRef.current = hasLoaded;

    const fetchStatus = useCallback(async () => {
        try {
            const res = await apiFetch('/api/status');
            setConfig(res.config);
            setHealthData(res.healthData);
            setStatusError(null);
            setHasLoaded(true);
            setLastUpdatedAt(Date.now());
            setStaleHint(false);
        } catch (e) {
            setStatusError(e instanceof Error ? e.message : 'Status unavailable');
            if (hasLoadedRef.current) setStaleHint(true);
        }
    }, []);

    useEffect(() => {
        void fetchStatus();
    }, [fetchStatus]);

    usePoll(() => { void fetchStatus(); }, 15_000);

    if (statusError && !hasLoaded) {
        return (
            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 backdrop-blur-xl px-4 py-4 sm:px-6 w-full">
                <p className="text-sm text-amber-200 text-center">Live status temporarily unavailable.</p>
            </div>
        );
    }

    if (!config.services?.length) return null;

    const visibleServices = config.services.filter((service: any) => healthData[service.id]);
    if (visibleServices.length === 0) return null;

    return (
        <div className="rounded-2xl border border-white/10 bg-card/40 backdrop-blur-xl px-4 py-5 sm:px-6 w-full">
            <div className="w-full flex flex-col">
                <div className="flex flex-col items-center text-center mb-4">
                    <a href={portalUrl('/status')} className="text-plex hover:text-plex-hover font-bold text-[10px] tracking-[0.16em] uppercase mb-1.5 transition-colors">
                        View Full Status Page &rarr;
                    </a>
                    <h3 className="text-text font-bold uppercase tracking-[0.14em] text-xs">Live System Status</h3>
                    {staleHint ? (
                        <p className="mt-1 text-[11px] text-amber-300/90">
                            Showing last update{lastUpdatedAt ? ` (${formatTime(new Date(lastUpdatedAt))})` : ''} — refresh failed
                        </p>
                    ) : null}
                </div>
                <div className="flex flex-wrap justify-center gap-2 sm:gap-3 w-full">
                    {visibleServices.map((service: any) => {
                        const health = healthData[service.id];
                        const isUp = health.currentStatus === 'online';
                        const colorClass = isUp ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-red-500/30 bg-red-500/10';
                        const dotClass = isUp ? 'bg-emerald-500 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]';

                        return (
                            <div key={service.id} className={`inline-flex items-center gap-1.5 sm:gap-2.5 px-2.5 py-1.5 sm:px-4 sm:py-2.5 rounded-lg sm:rounded-xl border ${colorClass} backdrop-blur-sm`}>
                                <span className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full shrink-0 ${dotClass}`} />
                                <span className="text-[11px] sm:text-sm font-bold text-text leading-tight">{service.name}</span>
                                <span className="text-[10px] sm:text-xs font-bold text-muted tabular-nums">{health.uptimePercentage}%</span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

const LivePlexStats: React.FC = () => {
    const [stats, setStats] = useState<{ movies: number, shows: number, music: number, fourKPercent?: number } | null>(null);

    const fetchStats = useCallback(async () => {
        const endpoints = [portalUrl('/api/public/plex/stats'), portalUrl('/api/plex/stats')];

        for (const endpoint of endpoints) {
            try {
                const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
                if (!response.ok) continue;
                const res = await response.json();
                if (res && typeof res.movies === 'number' && typeof res.shows === 'number' && typeof res.music === 'number') {
                    setStats(res);
                    return;
                }
            } catch {
                // Try next endpoint
            }
        }
    }, []);

    useEffect(() => {
        void fetchStats();
    }, [fetchStats]);

    usePoll(() => { void fetchStats(); }, 30_000);

    if (!stats) return (
        <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
                { icon: Film, label: 'Movies & TV', desc: 'Massive library' },
                { icon: Music, label: 'Music', desc: 'Thousands of albums' },
                { icon: Sparkles, label: 'Requests', desc: 'Automated system' },
            ].map(({ icon: Icon, label, desc }) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.05] to-transparent p-4 flex flex-col items-center text-center gap-2 animate-pulse">
                    <Icon className="w-5 h-5 text-plex/60" />
                    <span className="text-xs font-bold text-muted uppercase tracking-wider">{label}</span>
                    <span className="text-[11px] text-muted/70">{desc}</span>
                </div>
            ))}
        </div>
    );

    const statCardClass = 'section-card p-4 flex flex-col items-center justify-center gap-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]';

    return (
        <div className="w-full flex flex-col">
            <div className="inline-flex self-center items-center gap-2 px-3 py-1 rounded-full bg-plex/10 border border-plex/25 text-plex text-[10px] font-bold uppercase tracking-[0.14em] mb-4">
                <Activity className="w-3 h-3" /> Live Library Stats
            </div>
            <div className={`grid gap-3 w-full ${stats.music > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                <div className={statCardClass}>
                    <Film className="w-5 h-5 text-plex mb-0.5" />
                    <span className="text-plex font-black text-xl tabular-nums">{stats.movies.toLocaleString()}</span>
                    <span className="text-muted text-[10px] uppercase tracking-[0.12em] font-bold">Movies</span>
                </div>
                <div className={statCardClass}>
                    <Tv className="w-5 h-5 text-plex mb-0.5" />
                    <span className="text-plex font-black text-xl tabular-nums">{stats.shows.toLocaleString()}</span>
                    <span className="text-muted text-[10px] uppercase tracking-[0.12em] font-bold">TV Shows</span>
                </div>
                {stats.music > 0 && (
                    <div className={statCardClass}>
                        <Music className="w-5 h-5 text-plex mb-0.5" />
                        <span className="text-plex font-black text-xl tabular-nums">{stats.music.toLocaleString()}</span>
                        <span className="text-muted text-[10px] uppercase tracking-[0.12em] font-bold">Artists</span>
                    </div>
                )}
            </div>
            <div className="w-full mt-3">
                <div className={statCardClass + ' py-3.5'}>
                    <span className="text-plex font-black text-lg flex items-center gap-2 tabular-nums">
                        <Sparkles className="w-4 h-4 text-amber-400" />
                        {stats.fourKPercent !== undefined ? stats.fourKPercent : 30}%
                    </span>
                    <span className="text-muted text-[10px] uppercase tracking-[0.12em] font-bold">Available in 4K</span>
                </div>
            </div>
        </div>
    );
};

export const Login: React.FC<{ onLoginSuccess: () => void, publicConfig?: any, publicConfigWarning?: string | null, initialError?: string }> = ({ onLoginSuccess, publicConfig, publicConfigWarning, initialError }) => {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(initialError || '');
    const [jellyfinUsername, setJellyfinUsername] = useState('');
    const [jellyfinPassword, setJellyfinPassword] = useState('');
    const [showJellyfinPassword, setShowJellyfinPassword] = useState(false);
    const [quickConnect, setQuickConnect] = useState<{ sessionId: string, code: string, jellyfinUrl: string } | null>(null);
    const [homeSelectUsers, setHomeSelectUsers] = useState<any[] | null>(null);
    const [homeSelectBusy, setHomeSelectBusy] = useState(false);
    const [homeSelectRememberUserId, setHomeSelectRememberUserId] = useState<string | null>(null);
    const quickConnectPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [publicInfo, setPublicInfo] = useState<{ thumb: string | null, customLogoUrl?: string | null, serverName: string, isConfigured: boolean | null, mediaServerType?: string }>({ thumb: null, customLogoUrl: null, serverName: 'StreamPilot', isConfigured: null, mediaServerType: 'plex' });
    const [publicInfoLoading, setPublicInfoLoading] = useState(true);
    const [publicInfoLoadFailed, setPublicInfoLoadFailed] = useState(false);

    const fetchPublicInfo = () => {
        setPublicInfoLoading(true);
        setPublicInfoLoadFailed(false);
        apiFetch('/api/public/info').then(data => {
            if (data) {
                setPublicInfo({
                    thumb: data.thumb || null,
                    customLogoUrl: data.customLogoUrl || null,
                    serverName: data.serverName || 'StreamPilot',
                    isConfigured: data.isConfigured !== false,
                    mediaServerType: data.mediaServerType || 'plex'
                });
                if (data.serverName) document.title = `${data.serverName} Portal`;
            }
        }).catch(() => {
            setPublicInfoLoadFailed(true);
            setError('Could not reach the portal. If you just restarted or updated, wait a few seconds and refresh.');
        }).finally(() => setPublicInfoLoading(false));
    };

    const handleSetupComplete = () => {
        window.dispatchEvent(new CustomEvent('portal-public-config-updated'));
        fetchPublicInfo();
    };

    useEffect(() => {
        if (initialError) {
            window.history.replaceState({}, '', portalUrl('/'));
        }
    }, [initialError]);

    const pollJellyfinQuickConnect = useCallback(async () => {
        if (!quickConnect?.sessionId) return;
        try {
            const storedRef = readStoredReferralRef();
            const data = await apiFetch('/api/auth/jellyfin/quick-connect/poll', {
                method: 'POST',
                body: JSON.stringify({
                    sessionId: quickConnect.sessionId,
                    ...(storedRef ? { ref: storedRef } : {}),
                }),
            });
            if (data?.success) {
                clearStoredReferralRef();
                setQuickConnect(null);
                onLoginSuccess();
            }
        } catch (e: any) {
            setQuickConnect(null);
            setIsLoading(false);
            setError(e.message || 'Jellyfin Quick Connect failed');
        }
    }, [quickConnect?.sessionId, onLoginSuccess]);

    usePoll(() => { void pollJellyfinQuickConnect(); }, quickConnect?.sessionId ? 5000 : null);

    useEffect(() => {
        fetchPublicInfo();

        const path = stripBasePath(window.location.pathname);
        const params = new URLSearchParams(window.location.search);
        const referralRef = String(params.get('ref') || '').trim();
        if (referralRef) {
            writeStoredReferralRef(referralRef);
        }
        const loginError = params.get('loginError');
        if (loginError) {
            setError(loginError);
            window.history.replaceState({}, '', portalUrl('/'));
            return;
        }

        if (params.get('homeSelect') === '1') {
            window.history.replaceState({}, '', portalUrl('/'));
            setIsLoading(true);
            apiFetch('/api/auth/plex/home-users')
                .then((data) => {
                    if (Array.isArray(data?.users) && data.users.length) {
                        setHomeSelectUsers(data.users);
                        setHomeSelectRememberUserId(data.rememberUserId || null);
                        return;
                    }
                    setError('No Plex Home profiles were found. Please sign in again.');
                })
                .catch((e) => {
                    setError(e.message || 'Plex Home selection expired. Please sign in again.');
                })
                .finally(() => setIsLoading(false));
            return;
        }

        // Setup wizard OAuth return — SetupWizard handles this, not login
        if (path.startsWith('/auth/setup/')) {
            return;
        }

        if (path.startsWith('/auth/')) {
            const pinId = path.split('/')[2];
            setIsLoading(true);
            window.history.replaceState({}, '', portalUrl('/'));
            const storedRef = readStoredReferralRef();
            apiFetch('/api/auth/plex/callback', {
                method: 'POST',
                body: JSON.stringify({ pinId, ...(storedRef ? { ref: storedRef } : {}) }),
            }).then((data) => {
                if (data?.needsHomeSelect && Array.isArray(data.users)) {
                    setHomeSelectUsers(data.users);
                    setHomeSelectRememberUserId(data.rememberUserId || null);
                    return;
                }
                clearStoredReferralRef();
                onLoginSuccess();
            }).catch(e => {
                setError(e.message || 'Login failed');
            }).finally(() => {
                setIsLoading(false);
            });
        }
    }, [onLoginSuccess]);

    const handlePlexLogin = async () => {
        setIsLoading(true);
        setError('');
        try {
            const data = await apiFetch('/api/auth/plex/login', { method: 'POST' });
            const clientId = data.clientIdentifier || data.clientId || '';
            const storedRef = readStoredReferralRef();
            const callbackParams = new URLSearchParams({ pinId: String(data.id) });
            if (storedRef) callbackParams.set('ref', storedRef);
            const forwardUrl = window.location.origin + portalUrl(`/api/auth/plex/callback?${callbackParams.toString()}`);
            const authUrl = `https://app.plex.tv/auth#?clientID=${encodeURIComponent(clientId)}&code=${data.code}&context[device][product]=StreamPilot&forwardUrl=${encodeURIComponent(forwardUrl)}`;
            window.location.href = authUrl;
        } catch (e) {
            setError('Failed to initiate Plex login');
            setIsLoading(false);
        }
    };

    const handlePlexHomeSelect = async (user: { id: string }, pin: string | undefined, remember: boolean) => {
        setHomeSelectBusy(true);
        setError('');
        try {
            await apiFetch('/api/auth/plex/home-switch', {
                method: 'POST',
                body: JSON.stringify({
                    userId: user.id,
                    remember: remember === true,
                    ...(pin ? { pin } : {}),
                }),
            });
            clearStoredReferralRef();
            setHomeSelectUsers(null);
            setHomeSelectRememberUserId(null);
            onLoginSuccess();
        } catch (e: any) {
            setError(e.message || 'Could not switch Plex Home profile.');
        } finally {
            setHomeSelectBusy(false);
        }
    };

    const handlePlexHomeSelectCancel = async () => {
        setHomeSelectBusy(true);
        try {
            await apiFetch('/api/auth/plex/home-select/cancel', { method: 'POST' });
        } catch {
            // Cookie may already be gone
        } finally {
            setHomeSelectUsers(null);
            setHomeSelectRememberUserId(null);
            setHomeSelectBusy(false);
            setError('');
        }
    };

    const handleJellyfinLogin = async (event?: React.FormEvent) => {
        event?.preventDefault();
        setIsLoading(true);
        setError('');
        try {
            const storedRef = readStoredReferralRef();
            await apiFetch('/api/auth/jellyfin/login', {
                method: 'POST',
                body: JSON.stringify({
                    username: jellyfinUsername.trim(),
                    password: jellyfinPassword,
                    ...(storedRef ? { ref: storedRef } : {}),
                }),
            });
            clearStoredReferralRef();
            onLoginSuccess();
        } catch (e: any) {
            setError(e.message || 'Failed to authenticate with Jellyfin');
        } finally {
            setIsLoading(false);
        }
    };

    const handleJellyfinQuickConnect = async () => {
        setIsLoading(true);
        setError('');
        try {
            const data = await apiFetch('/api/auth/jellyfin/quick-connect/initiate', { method: 'POST' });
            setQuickConnect({
                sessionId: data.sessionId,
                code: data.code,
                jellyfinUrl: data.jellyfinUrl || '',
            });
            setIsLoading(false);
        } catch (e: any) {
            setIsLoading(false);
            setError(e.message || 'Failed to start Jellyfin Quick Connect');
        }
    };

    const handleOpenJellyfinQuickConnect = async () => {
        if (!quickConnect?.jellyfinUrl) return;
        try {
            await copyTextToClipboard(quickConnect.code);
        } catch {
            // Clipboard access can be blocked by browser settings; opening Jellyfin is still useful.
        }
        window.open(jellyfinQuickConnectUrl(quickConnect.jellyfinUrl), '_blank', 'noopener,noreferrer');
    };

    if (publicInfo.isConfigured === false || (typeof window !== 'undefined' && stripBasePath(window.location.pathname).startsWith('/auth/setup/'))) {
        return <SetupWizard onComplete={handleSetupComplete} />;
    }

    if (publicInfoLoading || (publicInfo.isConfigured === null && !publicInfoLoadFailed)) {
        return <Loader isLoading={true} isCinematic={!!publicConfig?.useCinematicLoading} />;
    }

    const mediaServerType = String(publicInfo.mediaServerType || publicConfig?.mediaServerType || 'plex').toLowerCase();
    const isJellyfinAuth = mediaServerType === 'jellyfin';
    const isEmbyAuth = mediaServerType === 'emby';
    const isEmbyLikeAuth = isJellyfinAuth || isEmbyAuth;
    const mediaServerLabel = isEmbyAuth ? 'Emby' : 'Jellyfin';
    const mediaServerIconUrl = isEmbyAuth ? EMBY_ICON_URL : JELLYFIN_ICON_URL;
    const showMediaServerPasswordLogin = isEmbyAuth || showJellyfinPassword;
    // Opt-in only — undefined/empty publicConfig must not flash the trial panel before /api/config/public loads.
    const showTrialAccess = !isEmbyLikeAuth && publicConfig?.allowTemporaryAccess === true;
    const sidebarLogoSrc = publicConfig?.customLogoUrl
        ? resolvePortalAssetUrl(publicConfig.customLogoUrl)
        : (publicInfo.customLogoUrl
            ? resolvePortalAssetUrl(publicInfo.customLogoUrl)
            : (publicInfo.thumb ? resolvePortalAssetUrl(publicInfo.thumb) : ''));
    const loginLogoSrc = publicConfig?.customLoginLogoUrl
        ? resolvePortalAssetUrl(publicConfig.customLoginLogoUrl)
        : sidebarLogoSrc;
    const splashBackgroundUrl = publicConfig?.backgroundImageUrl ? resolvePortalAssetUrl(publicConfig.backgroundImageUrl) : undefined;

    return (
        <div className="relative min-h-screen w-full flex flex-col items-center justify-center p-4 sm:p-6 md:p-8 lg:p-10 overflow-hidden">
            <AuthPageBackground backgroundImageUrl={splashBackgroundUrl} trendingBackgrounds={publicConfig?.useTrendingSlideshowOnLogin ? publicConfig?.trendingBackgrounds : undefined} trendingSlideshowInterval={publicConfig?.trendingSlideshowInterval} />
            <Loader isLoading={isLoading} isCinematic={!!publicConfig?.useCinematicLoading} />

            <div className="relative z-10 w-full max-w-6xl flex flex-col gap-6">
                <div className={`glass-card-lg overflow-hidden flex flex-col ${showTrialAccess ? 'lg:flex-row min-h-[min(680px,calc(100vh-3rem))]' : 'max-w-xl mx-auto w-full'}`}>
                    {showTrialAccess && (
                        <div className="flex-1 flex flex-col justify-center p-6 sm:p-8 lg:p-10 xl:p-12 border-t lg:border-t-0 lg:border-r border-white/10 bg-gradient-to-br from-plex/[0.08] via-plex/[0.03] to-transparent min-w-0 order-last lg:order-none">
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-plex/10 border border-plex/25 text-plex text-[11px] font-bold uppercase tracking-widest mb-5 w-fit">
                                <Sparkles className="w-3.5 h-3.5" /> New here?
                            </div>
                            <h1 className="text-3xl sm:text-4xl font-black text-text tracking-tight leading-tight mb-3">
                                Welcome to{' '}
                                <span className="text-transparent bg-clip-text bg-gradient-to-r from-plex to-amber-400">{publicInfo.serverName}</span>
                            </h1>
                            <p className="text-muted text-sm sm:text-base leading-relaxed mb-6 max-w-lg">
                                The ultimate Plex experience. Get instant access to our entire library with a{' '}
                                <strong className="text-text font-semibold">3-Day Temporary Access</strong> pass.
                            </p>

                            {publicConfig?.showPublicLibraryStats !== false && (
                                <div className="mb-6">
                                    <LivePlexStats />
                                </div>
                            )}

                            <p className="text-xs text-muted/80 leading-relaxed mb-5">
                                You&apos;ll need a free Plex account to continue. You can create one securely on the next screen.
                            </p>
                            <button type="button" className={loginPrimaryBtnClass} onClick={handlePlexLogin} disabled={isLoading}>
                                <img src={PLEX_ICON_URL} alt="" className="w-5 h-5 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                                Request Temporary Access
                            </button>
                        </div>
                    )}

                    <div className={`flex flex-col justify-center items-center text-center p-6 sm:p-8 lg:p-10 xl:p-12 min-w-0 ${showTrialAccess ? 'flex-1 order-first lg:order-none' : 'w-full py-10 sm:py-12'}`}>
                        {publicConfigWarning && (
                            <div className="w-full mb-4 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 text-center">
                                {publicConfigWarning}
                            </div>
                        )}
                        <div className={`relative mb-8 flex justify-center w-full ${(!loginLogoSrc || publicConfig?.loginLogoCircleFrame === false) ? 'max-w-lg px-2' : ''}`}>
                            {!loginLogoSrc ? (
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-16 bg-plex/20 rounded-full blur-[60px] pointer-events-none" />
                            ) : publicConfig?.loginLogoCircleFrame !== false ? (
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-36 h-36 bg-plex/20 rounded-full blur-[60px] pointer-events-none" />
                            ) : null}
                            <LoginBrandMark
                                src={loginLogoSrc}
                                circleFrame={Boolean(loginLogoSrc) && publicConfig?.loginLogoCircleFrame !== false}
                            />
                        </div>

                        {!showTrialAccess && (
                            <>
                                <h1 className="text-3xl sm:text-4xl font-black text-text tracking-tight mb-3">
                                    {publicInfo.serverName}
                                </h1>
                                <p className="text-muted text-sm sm:text-base leading-relaxed mb-8 max-w-sm">
                                    {isEmbyLikeAuth
                                        ? `Sign in with your ${mediaServerLabel} account to access your portal and manage your subscription.`
                                        : 'Sign in with Plex to access your portal and manage your subscription.'}
                                </p>
                            </>
                        )}

                        {showTrialAccess && (
                            <>
                                <p className="text-[11px] font-bold text-muted uppercase tracking-[0.16em] mb-2">Returning member</p>
                                <h2 className="text-2xl sm:text-3xl font-black text-text tracking-tight mb-3">Already on our server?</h2>
                                <p className="text-muted text-sm sm:text-base leading-relaxed mb-8 max-w-sm">
                                    Manage your existing access or re-link your Plex account.
                                </p>
                            </>
                        )}

                        {isEmbyLikeAuth ? (
                            <div className="w-full max-w-sm flex flex-col gap-4 text-left">
                                {isJellyfinAuth && (
                                    <button type="button" className={loginSecondaryBtnClass} onClick={handleJellyfinQuickConnect} disabled={isLoading}>
                                        <img src={mediaServerIconUrl} alt="" className="w-5 h-5 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                                        Login with Jellyfin
                                    </button>
                                )}

                                {isJellyfinAuth && quickConnect && (
                                    <div className="w-full rounded-xl border border-plex/30 bg-plex/10 p-4 text-center">
                                        <p className="text-[10px] font-bold text-muted uppercase tracking-[0.14em] mb-2">Quick Connect code</p>
                                        <div className="font-black text-3xl tracking-[0.18em] text-text tabular-nums mb-3">{quickConnect.code}</div>
                                        <p className="text-xs text-muted leading-relaxed">
                                            Approve this code in Jellyfin Quick Connect. This page will finish login automatically.
                                        </p>
                                        {quickConnect.jellyfinUrl && (
                                            <button
                                                type="button"
                                                onClick={handleOpenJellyfinQuickConnect}
                                                className="mt-3 inline-flex items-center justify-center text-xs font-bold text-plex hover:text-text transition"
                                            >
                                                Copy code & open Quick Connect
                                            </button>
                                        )}
                                    </div>
                                )}

                                {isJellyfinAuth && (
                                    <button
                                        type="button"
                                        className="self-center text-xs font-bold text-muted hover:text-text transition"
                                        onClick={() => setShowJellyfinPassword((value) => !value)}
                                    >
                                        {showJellyfinPassword ? 'Hide password login' : 'Use password instead'}
                                    </button>
                                )}

                                {showMediaServerPasswordLogin && (
                                    <form onSubmit={handleJellyfinLogin} className="w-full flex flex-col gap-3 text-left">
                                        <label className="flex flex-col gap-1.5">
                                            <span className="text-[10px] font-bold text-muted uppercase tracking-[0.14em]">{mediaServerLabel} username</span>
                                            <input
                                                value={jellyfinUsername}
                                                onChange={(e) => setJellyfinUsername(e.target.value)}
                                                autoComplete="username"
                                                className="w-full bg-black/25 border border-white/15 rounded-xl px-4 py-3 text-sm text-text outline-none focus:border-plex/70 focus:ring-2 focus:ring-plex/20 transition"
                                                placeholder="Username"
                                                disabled={isLoading}
                                                required
                                            />
                                        </label>
                                        <label className="flex flex-col gap-1.5">
                                            <span className="text-[10px] font-bold text-muted uppercase tracking-[0.14em]">Password</span>
                                            <input
                                                value={jellyfinPassword}
                                                onChange={(e) => setJellyfinPassword(e.target.value)}
                                                type="password"
                                                autoComplete="current-password"
                                                className="w-full bg-black/25 border border-white/15 rounded-xl px-4 py-3 text-sm text-text outline-none focus:border-plex/70 focus:ring-2 focus:ring-plex/20 transition"
                                                placeholder="Password"
                                                disabled={isLoading}
                                                required
                                            />
                                        </label>
                                        <button type="submit" className={loginSecondaryBtnClass} disabled={isLoading || !jellyfinUsername.trim() || !jellyfinPassword}>
                                            <img src={mediaServerIconUrl} alt="" className="w-5 h-5 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                                            Login with {mediaServerLabel}
                                        </button>
                                    </form>
                                )}
                            </div>
                        ) : (
                            <button type="button" className={loginSecondaryBtnClass} onClick={handlePlexLogin} disabled={isLoading}>
                                <img src={PLEX_ICON_URL} alt="" className="w-5 h-5 object-contain opacity-90" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                                Login with Plex
                            </button>
                        )}

                        {!showTrialAccess && !isEmbyLikeAuth && publicConfig?.showPublicLibraryStats !== false && (
                            <div className="w-full mt-10 pt-8 border-t border-white/10">
                                <LivePlexStats />
                            </div>
                        )}
                    </div>
                </div>

                {publicConfig?.showPublicStatusMonitor !== false && <PublicUptimeBanner />}

                {error && !homeSelectUsers && (
                    <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-sm flex items-start gap-3">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-400" />
                        <span>{error}</span>
                    </div>
                )}
            </div>
            <PlexHomeSwitchModal
                open={!!homeSelectUsers}
                users={homeSelectUsers || []}
                rememberUserId={homeSelectRememberUserId}
                showRemember
                rememberDefault
                loginMode
                busy={homeSelectBusy}
                error={error}
                onSelect={handlePlexHomeSelect}
                onClose={handlePlexHomeSelectCancel}
                onUseDifferentAccount={handlePlexHomeSelectCancel}
            />
        </div>
    );
};

const RebuildLibraryCacheButton: React.FC = () => {
    const [status, setStatus] = useState<'idle' | 'starting' | 'building' | 'done' | 'warn' | 'error'>('idle');
    const [lastBuilt, setLastBuilt] = useState<number | null>(null);
    const [lastWarning, setLastWarning] = useState<string | null>(null);

    const applyStatusPayload = (s: any, { finishing = false } = {}) => {
        if (s.lastGeneratedAt) setLastBuilt(s.lastGeneratedAt);
        const warning = String(s.lastWarning || '').trim() || null;
        setLastWarning(warning);
        if (s.isBuilding) {
            setStatus('building');
            return;
        }
        if (!finishing) return;
        if (s.lastError) setStatus('error');
        else if (warning || (Array.isArray(s.lastBuildFailures) && s.lastBuildFailures.length)) setStatus('warn');
        else setStatus('done');
        window.setTimeout(() => setStatus('idle'), 4000);
    };

    const pollBuildStatus = useCallback(async () => {
        try {
            const s: any = await apiFetch('/api/plex/stats/status');
            applyStatusPayload(s, { finishing: true });
        } catch {
            setStatus('error');
        }
    }, []);

    useEffect(() => {
        apiFetch('/api/plex/stats/status').then((s: any) => {
            applyStatusPayload(s, { finishing: false });
        }).catch(() => { });
    }, []);

    usePoll(() => { void pollBuildStatus(); }, status === 'building' ? 3000 : null, { immediate: true });

    const handleRebuild = async () => {
        setStatus('starting');
        try {
            await apiFetch('/api/plex/stats/rebuild', { method: 'POST' });
            setStatus('building');
        } catch {
            setStatus('error');
            setTimeout(() => setStatus('idle'), 3000);
        }
    };

    const isRunning = status === 'building' || status === 'starting';
    return (
        <div className="flex flex-col gap-1.5">
            <button
                onClick={handleRebuild}
                disabled={isRunning}
                className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all border
                    ${status === 'done' ? 'bg-green-500/10 border-green-500/30 text-green-400' :
                        status === 'warn' ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' :
                        status === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-400' :
                            isRunning ? 'bg-white/5 border-white/10 text-muted cursor-not-allowed' :
                                'bg-white/5 border-white/10 text-text hover:bg-white/10'}`}
            >
                {isRunning ? (
                    <><div className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" /> Building Cache...</>
                ) : status === 'done' ? (
                    <><CheckCircle size={14} /> Cache Updated!</>
                ) : status === 'warn' ? (
                    <><AlertCircle size={14} /> Totals kept</>
                ) : status === 'error' ? (
                    <><AlertCircle size={14} /> Build Failed</>
                ) : (
                    <><RefreshCw size={14} /> Rebuild Library Cache</>
                )}
            </button>
            {lastBuilt && (
                <p className="text-[10px] text-muted text-center">
                    Last built: {formatPortalDateTime(lastBuilt)}
                </p>
            )}
            {lastWarning && status !== 'building' && status !== 'starting' && (
                <p className="text-[10px] text-amber-300/90 text-center leading-snug">{lastWarning}</p>
            )}
        </div>
    );
};

export { WrapUpModal } from './shared/WrapUpModal';


export const DiscoverPosterCard: React.FC<{
    item: { title: string; thumb?: string; thumbUrl?: string; posterFallbackUrl?: string; plexUrl: string; tags?: string[]; year?: number | string; parentTitle?: string; ratingKey?: string };
    aspect?: '2/3' | 'square' | '16/9';
    overlay?: React.ReactNode;
    variant?: 'discover' | 'home';
    className?: string;
    footer?: React.ReactNode;
    showQualityBadges?: boolean;
    posterOnlyLink?: boolean;
    onPosterClick?: () => void;
    onPosterHover?: () => void;
    quickActions?: Array<{
        id: string;
        label: string;
        tone?: 'default' | 'danger';
        onClick: () => void | Promise<void>;
    }>;
    posterWidth?: number;
    posterHeight?: number;
    posterQuality?: number;
    /** Skip the hover scale. That transform resamples the bitmap and softens hero art. */
    disableImageScale?: boolean;
    frameClassName?: string;
    loading?: 'lazy' | 'eager';
    fetchPriority?: 'high' | 'low' | 'auto';
}> = ({ item, aspect, overlay, variant = 'discover', className = 'w-full', footer, showQualityBadges = true, posterOnlyLink = false, onPosterClick, onPosterHover, quickActions, posterWidth = 300, posterHeight, posterQuality, disableImageScale = false, frameClassName = '', loading, fetchPriority }) => {
    const { t } = useDiscoverI18n();
    const resolvedAspect = aspect ?? (
        item?.mediaType === 'music' || item?.type === 'music' ? 'square' : '2/3'
    );
    const resolvedPosterHeight = posterHeight ?? (
        resolvedAspect === 'square'
            ? posterWidth
            : resolvedAspect === '16/9'
                ? Math.round(posterWidth * 9 / 16)
                : Math.round(posterWidth * 1.5)
    );
    const posterShell = `${variant === 'home'
        ? 'player-poster-frame relative rounded-[12px] overflow-hidden bg-background border border-border transition-[border-color] duration-300 group-hover:border-plex/50'
        : 'player-poster-frame relative rounded-[12px] overflow-hidden border border-border group-hover:border-plex transition-colors bg-card'}${frameClassName ? ` ${frameClassName}` : ''}`;

    const remoteThumb = typeof item.thumb === 'string' && /^https?:\/\//i.test(item.thumb);
    const primaryPosterSrc = item.thumbUrl
        ? resolvePortalAssetUrl(item.thumbUrl)
        : remoteThumb
            ? resolvePortalAssetUrl(item.thumb)
            : item.thumb
                ? portalUrl(`/api/plex/image?path=${encodeURIComponent(item.thumb)}&width=${posterWidth}&height=${resolvedPosterHeight}${posterQuality ? `&quality=${posterQuality}` : ''}`)
                : '';
    const fallbackPosterSrc = item.posterFallbackUrl
        ? resolvePortalAssetUrl(item.posterFallbackUrl)
        : '';
    const [quickActionsOpen, setQuickActionsOpen] = useState(false);
    const quickActionsRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (!quickActionsOpen) return;
        const onDocMouseDown = (event: MouseEvent) => {
            if (!quickActionsRef.current) return;
            if (!quickActionsRef.current.contains(event.target as Node)) {
                setQuickActionsOpen(false);
            }
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setQuickActionsOpen(false);
        };
        document.addEventListener('mousedown', onDocMouseDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onDocMouseDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [quickActionsOpen]);

    const hasPoster = !!(primaryPosterSrc || fallbackPosterSrc);
    const hasQuickActions = Array.isArray(quickActions) && quickActions.length > 0;
    const posterInner = (
        <div
            data-tv-poster="1"
            className={`${posterShell} ${resolvedAspect === 'square' ? 'aspect-square' : resolvedAspect === '16/9' ? 'aspect-video' : 'aspect-[2/3]'} w-full`}
        >
            {!hasPoster ? (
                <NoPosterPlaceholder />
            ) : (
                <RetryablePoster
                    src={primaryPosterSrc}
                    fallbackSrc={fallbackPosterSrc}
                    alt={item.title}
                    loading={loading ?? (variant === 'home' ? 'eager' : 'lazy')}
                    fetchPriority={fetchPriority}
                    compactPlaceholder={false}
                    className={`absolute inset-0 h-full w-full object-cover ${variant === 'home' && !disableImageScale ? 'transition-[transform,opacity] duration-300 group-hover:scale-105 group-hover:opacity-80' : ''}`}
                />
            )}
            {hasQuickActions && (
                <div
                    ref={quickActionsRef}
                    className="absolute inset-0 z-10 pointer-events-none"
                >
                    <div className="absolute top-1 left-1 sm:top-1.5 sm:left-1.5 pointer-events-auto">
                        <button
                            type="button"
                            onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setQuickActionsOpen((open) => !open);
                            }}
                            className="inline-flex items-center justify-center p-0.5 leading-none rounded-md bg-black/65 text-white/90 border border-white/20 hover:bg-black/80 hover:text-white transition-colors"
                            aria-label={t('quickActions.menuLabel')}
                            aria-expanded={quickActionsOpen}
                        >
                            <MoreHorizontal className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                        </button>
                    </div>
                    {quickActionsOpen && (
                        <div
                            className="absolute inset-0 bg-black/75 backdrop-blur-[1px] px-2 py-2 flex flex-col justify-end gap-1 pointer-events-auto"
                            onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setQuickActionsOpen(false);
                            }}
                        >
                            {quickActions!.map((action) => (
                                <button
                                    key={action.id}
                                    type="button"
                                    onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        setQuickActionsOpen(false);
                                        void action.onClick();
                                    }}
                                    className={`w-full text-left px-2.5 py-2 rounded-md text-[11px] font-semibold transition-colors ${
                                        action.tone === 'danger'
                                            ? 'text-rose-200 bg-rose-500/20 hover:bg-rose-500/30'
                                            : 'text-white bg-white/10 hover:bg-white/20'
                                    }`}
                                >
                                    {action.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
            {overlay}
            {showQualityBadges && item.tags && item.tags.length > 0 && (
                <div className={`absolute left-1 right-1 flex flex-wrap gap-0.5 pointer-events-none z-20 ${overlay ? 'bottom-7' : 'bottom-1'}`}>
                    {item.tags.map((tag) => (
                        <span key={tag} className="text-[8px] font-bold px-1 py-px rounded bg-black/85 text-white/95 border border-white/15 uppercase tracking-wide">
                            {tag}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );

    const defaultFooter = (
        <div className={`player-poster-caption ${posterOnlyLink ? 'text-base font-semibold' : 'text-xs font-medium'} line-clamp-2 leading-snug text-text ${variant === 'home' ? 'text-left px-1' : 'text-center mt-1'}`}>
            {item.title}
        </div>
    );

    if (posterOnlyLink) {
        const posterWrapper = onPosterClick ? (
            <button
                type="button"
                onClick={onPosterClick}
                onMouseEnter={onPosterHover}
                onFocus={() => {
                    onPosterHover?.();
                }}
                data-tv-item="1"
                data-tv-poster-btn="1"
                data-tv-key={item.ratingKey || undefined}
                className="block w-full text-left border-0 p-0 bg-transparent cursor-pointer outline-none focus:outline-none"
                style={{ color: 'inherit' }}
            >
                {posterInner}
            </button>
        ) : (
            <a
                href={item.plexUrl}
                target="_blank"
                rel="noreferrer"
                onMouseEnter={onPosterHover}
                onFocus={onPosterHover}
                className="block no-underline"
                style={{ textDecoration: 'none', color: 'inherit' }}
            >
                {posterInner}
            </a>
        );

        return (
            <div
                data-tv-poster-card="1"
                className={`flex flex-col gap-2 group outline-none ${className}`}
                style={{ color: 'inherit' }}
            >
                {posterWrapper}
                {footer ?? defaultFooter}
            </div>
        );
    }

    if (onPosterClick && !posterOnlyLink) {
        if (hasQuickActions) {
            return (
                <div
                    role="button"
                    tabIndex={0}
                    data-tv-item="1"
                    onMouseEnter={onPosterHover}
                    onFocus={onPosterHover}
                    onClick={() => onPosterClick()}
                    onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onPosterClick();
                        }
                    }}
                    className={`flex flex-col gap-2 group text-left cursor-pointer ${className}`}
                    style={{ color: 'inherit', textDecoration: 'none' }}
                >
                    {posterInner}
                    {footer ?? defaultFooter}
                </div>
            );
        }
        return (
            <button
                type="button"
                onClick={onPosterClick}
                onMouseEnter={onPosterHover}
                onFocus={onPosterHover}
                data-tv-item="1"
                className={`flex flex-col gap-2 group text-left border-0 p-0 bg-transparent cursor-pointer ${className}`}
                style={{ color: 'inherit', textDecoration: 'none' }}
            >
                {posterInner}
                {footer ?? defaultFooter}
            </button>
        );
    }

    return (
        <a href={item.plexUrl} target="_blank" rel="noreferrer" onMouseEnter={onPosterHover} onFocus={onPosterHover} className={`flex flex-col gap-2 group no-underline ${className}`} style={{ color: 'inherit', textDecoration: 'none' }}>
            {posterInner}
            {footer ?? defaultFooter}
        </a>
    );
};

const discoverViewsOverlay = (views: number) => (
    <div className="absolute inset-x-0 bottom-0 z-10 pointer-events-none bg-gradient-to-t from-black/85 via-black/45 to-transparent pt-6 pb-1.5 px-1.5">
        <span className="text-[10px] font-semibold text-white/90 tracking-wide">
            {views} {views === 1 ? 'view' : 'views'}
        </span>
    </div>
);

const DISCOVER_DESKTOP_ITEM_LIMIT = 20;
const DISCOVER_MOBILE_ITEM_LIMIT = 12;
const RECENTLY_ADDED_ITEM_LIMIT = 100;
const DISCOVER_LIMIT_OPTIONS = [
    { value: '12', label: '12' },
    { value: '20', label: '20' },
    { value: '25', label: '25' },
    { value: '50', label: '50' },
    { value: '100', label: '100' },
    { value: '150', label: '150' },
    { value: '200', label: '200' },
    { value: '250', label: '250' },
];

const TrendingDiscoverSection: React.FC<{ title: string; items: any[]; limit: number; showQualityBadges?: boolean; useScrollRevealAnimations?: boolean; onItemClick?: (item: any) => void; gridSize?: PosterGridValue }> = ({ title, items, limit, showQualityBadges = true, useScrollRevealAnimations, onItemClick, gridSize = DEFAULT_POSTER_GRID_SCALE }) => {
    if (!items?.length) return null;
    return (
        <ScrollReveal enabled={!!useScrollRevealAnimations} className="flex flex-col">
            <h3 className="text-plex text-sm uppercase tracking-[2px] mb-6 font-bold border-b border-white/10 pb-2">{title}</h3>
            <div className={upgraderPosterGridClass(gridSize)} style={upgraderPosterGridStyle(gridSize)}>
                {items.slice(0, limit).map((item, i) => (
                    <DiscoverPosterCard
                        key={i}
                        item={{ ...item, plexUrl: item.plexUrl || '#' }}
                        overlay={discoverViewsOverlay(item.views)}
                        showQualityBadges={showQualityBadges}
                        onPosterClick={onItemClick ? () => onItemClick(item) : undefined}
                    />
                ))}
            </div>
        </ScrollReveal>
    );
};

const moveDashboardItem = <T extends string,>(items: T[], from: number, direction: -1 | 1): T[] => {
    const to = from + direction;
    if (from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
};

const moveDashboardItemTo = <T extends string,>(items: T[], from: number, to: number): T[] => {
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
};

const PortalLayoutRow: React.FC<{
    label: string;
    description?: string;
    hidden: boolean;
    first: boolean;
    last: boolean;
    draggable?: boolean;
    selected?: boolean;
    size?: DashboardWidgetSize;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onToggle: () => void;
    onSelect?: () => void;
    onDragStart?: () => void;
    onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
    onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
    onSizeChange?: (size: DashboardWidgetSize) => void;
}> = ({ label, description, hidden, first, last, draggable, selected, size, onMoveUp, onMoveDown, onToggle, onSelect, onDragStart, onDragOver, onDrop, onSizeChange }) => (
    <div
        draggable={draggable}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onClick={onSelect}
        onKeyDown={(event) => {
            if (!onSelect) return;
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect();
            }
        }}
        role={onSelect ? 'button' : undefined}
        tabIndex={onSelect ? 0 : undefined}
        className={`flex flex-col sm:flex-row sm:items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors outline-none ${draggable ? 'cursor-pointer active:cursor-grabbing' : ''} ${selected ? 'border-plex/70 bg-plex/10 ring-1 ring-plex/40' : hidden ? 'border-border/30 bg-background/20 opacity-70' : 'border-border/50 bg-background/40 hover:border-plex/35 hover:bg-background/55'}`}
    >
        <div className="flex items-center gap-2 min-w-0 flex-1">
        <div className="flex flex-col gap-1 shrink-0">
            <button
                type="button"
                onClick={(event) => {
                    event.stopPropagation();
                    onMoveUp();
                }}
                disabled={first}
                className="p-1 rounded-md text-muted hover:text-text hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed"
                aria-label={`Move ${label} up`}
            >
                <ChevronUp className="w-4 h-4" />
            </button>
            <button
                type="button"
                onClick={(event) => {
                    event.stopPropagation();
                    onMoveDown();
                }}
                disabled={last}
                className="p-1 rounded-md text-muted hover:text-text hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed"
                aria-label={`Move ${label} down`}
            >
                <ChevronDown className="w-4 h-4" />
            </button>
        </div>
        <div className="min-w-0 flex-1">
            <p className={`font-semibold truncate ${hidden ? 'text-muted line-through' : 'text-text'}`}>{label}</p>
            <p className="text-xs text-muted truncate mt-0.5">{selected ? 'Selected - click another row to move it there.' : (description || 'Click to pick up, then click another row to move.')}</p>
        </div>
        </div>
        {onSizeChange && !hidden && (
            <div className="grid grid-cols-4 gap-1 rounded-lg border border-border/60 bg-background/30 p-1 shrink-0">
                {(['compact', 'normal', 'wide', 'full'] as DashboardWidgetSize[]).map((option) => (
                    <button
                        key={option}
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            onSizeChange(option);
                        }}
                        className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase transition-colors ${
                            (size || 'normal') === option ? 'bg-plex text-black' : 'text-muted hover:text-text hover:bg-white/10'
                        }`}
                    >
                        {option === 'compact' ? 'S' : option === 'normal' ? 'M' : option === 'wide' ? 'L' : 'XL'}
                    </button>
                ))}
            </div>
        )}
        <button
            type="button"
            onClick={(event) => {
                event.stopPropagation();
                onToggle();
            }}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-bold transition-colors shrink-0 ${
                hidden
                    ? 'border-plex/40 bg-plex/10 text-plex hover:bg-plex/20'
                    : 'border-border/60 bg-white/5 text-muted hover:text-text hover:border-white/20'
            }`}
        >
            {hidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            {hidden ? 'Add' : 'Hide'}
        </button>
    </div>
);

const PortalWidgetEditorModal: React.FC<{
    layout: DashboardLayoutConfig;
    onChange: (layout: DashboardLayoutConfig) => void;
    onSave: () => void;
    onClose: () => void;
    saving: boolean;
    homeCustomModules?: HomeCustomModule[];
}> = ({ layout, onChange, onSave, onClose, saving, homeCustomModules = [] }) => {
    const [movingItem, setMovingItem] = useState<{ list: 'sections' | 'main' | 'recent'; index: number } | null>(null);
    const normalizeLayout = (next: DashboardLayoutConfig) => normalizeSectionLayout(next, { homeCustomModules });
    const sectionLabel = (id: DashboardSectionId) => (
        isHomeCustomModuleSectionId(id)
            ? getHomeCustomModuleLabel(id, homeCustomModules)
            : DASHBOARD_SECTION_LABELS[id as BuiltInDashboardSectionId]
    );

    const reorderList = (list: 'sections' | 'main' | 'recent', targetIndex: number, source = movingItem) => {
        if (!source || source.list !== list || source.index === targetIndex) return;
        if (list === 'sections') {
            onChange(normalizeLayout({ ...layout, sections: moveDashboardItemTo(layout.sections, source.index, targetIndex) }));
            return;
        }
        const items = list === 'main' ? layout.mainGridOrder : layout.recentlyAddedOrder;
        const next = moveDashboardItemTo(items, source.index, targetIndex);
        onChange(normalizeLayout(list === 'main' ? { ...layout, mainGridOrder: next } : { ...layout, recentlyAddedOrder: next }));
    };

    const selectOrMove = (list: 'sections' | 'main' | 'recent', index: number) => {
        if (!movingItem) {
            setMovingItem({ list, index });
            return;
        }
        if (movingItem.list !== list) {
            setMovingItem({ list, index });
            return;
        }
        if (movingItem.index === index) {
            setMovingItem(null);
            return;
        }
        reorderList(list, index, movingItem);
        setMovingItem(null);
    };

    const toggleSection = (id: DashboardSectionId) => {
        const hiddenSections = layout.hiddenSections.includes(id)
            ? layout.hiddenSections.filter((sectionId) => sectionId !== id)
            : [...layout.hiddenSections, id];
        onChange(normalizeLayout({ ...layout, hiddenSections }));
    };

    const toggleWidget = (id: DashboardWidgetId) => {
        const hiddenWidgets = layout.hiddenWidgets.includes(id)
            ? layout.hiddenWidgets.filter((widgetId) => widgetId !== id)
            : [...layout.hiddenWidgets, id];
        onChange(normalizeLayout({ ...layout, hiddenWidgets }));
    };

    const moveSection = (index: number, direction: -1 | 1) => {
        onChange(normalizeLayout({ ...layout, sections: moveDashboardItem(layout.sections, index, direction) }));
    };

    const moveMainWidget = (index: number, direction: -1 | 1) => {
        onChange(normalizeLayout({ ...layout, mainGridOrder: moveDashboardItem(layout.mainGridOrder, index, direction) }));
    };

    const moveRecentWidget = (index: number, direction: -1 | 1) => {
        onChange(normalizeLayout({ ...layout, recentlyAddedOrder: moveDashboardItem(layout.recentlyAddedOrder, index, direction) }));
    };

    const setWidgetSize = (id: DashboardWidgetId, size: DashboardWidgetSize) => {
        const widgetSizes = { ...(layout.widgetSizes || {}) };
        if (size === 'normal') delete widgetSizes[id];
        else widgetSizes[id] = size;
        onChange(normalizeLayout({ ...layout, widgetSizes }));
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <div className="w-full max-w-5xl max-h-[90vh] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl flex flex-col">
                <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border">
                    <div>
                        <h2 className="text-xl font-black text-text">Portal Widgets</h2>
                        <p className="text-sm text-muted mt-1">Move, hide, and add portal widgets for everyone.</p>
                    </div>
                    <button type="button" onClick={onClose} className="p-2 rounded-lg text-muted hover:text-text hover:bg-white/10">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="overflow-y-auto p-5 space-y-6">
                    <section>
                        <div className="flex items-center justify-between gap-3 mb-3">
                            <h3 className="text-sm font-bold uppercase tracking-wider text-muted">Page sections</h3>
                            <button
                                type="button"
                                onClick={() => onChange({ ...DEFAULT_DASHBOARD_LAYOUT })}
                                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-xs font-bold text-muted hover:text-text hover:border-plex/40 transition-colors"
                            >
                                <RefreshCw className="w-4 h-4" />
                                Reset
                            </button>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                            {layout.sections.map((id, index) => (
                                <PortalLayoutRow
                                    key={id}
                                    label={sectionLabel(id)}
                                    hidden={layout.hiddenSections.includes(id)}
                                    first={index === 0}
                                    last={index === layout.sections.length - 1}
                                    draggable
                                    selected={movingItem?.list === 'sections' && movingItem.index === index}
                                    onSelect={() => selectOrMove('sections', index)}
                                    onDragStart={() => setMovingItem({ list: 'sections', index })}
                                    onDragOver={(event) => event.preventDefault()}
                                    onDrop={(event) => {
                                        event.preventDefault();
                                        reorderList('sections', index);
                                        setMovingItem(null);
                                    }}
                                    onMoveUp={() => moveSection(index, -1)}
                                    onMoveDown={() => moveSection(index, 1)}
                                    onToggle={() => toggleSection(id)}
                                />
                            ))}
                        </div>
                    </section>

                    <section>
                        <h3 className="text-sm font-bold uppercase tracking-wider text-muted mb-3">Main widgets</h3>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                            {layout.mainGridOrder.map((id: MainGridWidgetId, index) => (
                                <PortalLayoutRow
                                    key={id}
                                    label={MAIN_GRID_WIDGET_META[id].label}
                                    description="Drag to move. Resize with S, M, L, XL."
                                    hidden={layout.hiddenWidgets.includes(id)}
                                    first={index === 0}
                                    last={index === layout.mainGridOrder.length - 1}
                                    draggable
                                    size={layout.widgetSizes?.[id] || 'normal'}
                                    selected={movingItem?.list === 'main' && movingItem.index === index}
                                    onSelect={() => selectOrMove('main', index)}
                                    onDragStart={() => setMovingItem({ list: 'main', index })}
                                    onDragOver={(event) => event.preventDefault()}
                                    onDrop={(event) => {
                                        event.preventDefault();
                                        reorderList('main', index);
                                        setMovingItem(null);
                                    }}
                                    onMoveUp={() => moveMainWidget(index, -1)}
                                    onMoveDown={() => moveMainWidget(index, 1)}
                                    onToggle={() => toggleWidget(id)}
                                    onSizeChange={(size) => setWidgetSize(id, size)}
                                />
                            ))}
                        </div>
                    </section>

                    <section>
                        <h3 className="text-sm font-bold uppercase tracking-wider text-muted mb-3">Recently added widgets</h3>
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
                            {layout.recentlyAddedOrder.map((id: RecentlyAddedWidgetId, index) => (
                                <PortalLayoutRow
                                    key={id}
                                    label={RECENTLY_ADDED_WIDGET_META[id]}
                                    hidden={layout.hiddenWidgets.includes(id)}
                                    first={index === 0}
                                    last={index === layout.recentlyAddedOrder.length - 1}
                                    draggable
                                    size={layout.widgetSizes?.[id] || 'full'}
                                    selected={movingItem?.list === 'recent' && movingItem.index === index}
                                    onSelect={() => selectOrMove('recent', index)}
                                    onDragStart={() => setMovingItem({ list: 'recent', index })}
                                    onDragOver={(event) => event.preventDefault()}
                                    onDrop={(event) => {
                                        event.preventDefault();
                                        reorderList('recent', index);
                                        setMovingItem(null);
                                    }}
                                    onMoveUp={() => moveRecentWidget(index, -1)}
                                    onMoveDown={() => moveRecentWidget(index, 1)}
                                    onToggle={() => toggleWidget(id)}
                                    onSizeChange={(size) => setWidgetSize(id, size)}
                                />
                            ))}
                        </div>
                    </section>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3 px-5 py-4 border-t border-border bg-background/40">
                    <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-muted hover:text-text hover:border-white/20 transition-colors">
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onSave}
                        disabled={saving}
                        className="inline-flex items-center justify-center gap-2 px-5 py-2 rounded-lg bg-plex text-black font-bold hover:bg-plex/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                    >
                        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                        Save Widgets
                    </button>
                </div>
            </div>
        </div>
    );
};

export const UserDashboard: React.FC<{
    sessionInfo: any;
    publicConfig?: any;
    onLogout: () => void;
    refreshSession: () => void;
    onViewAdmin: () => void;
    onViewStatus: () => void;
    onViewDashboard: () => void;
    onViewSettings?: () => void;
    onViewLogs?: () => void;
    onViewCollexions?: () => void;
    onViewScanner?: () => void;
    onViewSpotifySync?: () => void;
    onViewMediaAutomation?: () => void;
    onViewRequests?: (reviewId?: number) => void;
    onPendingRequestsChange?: () => void;
    onNavigate?: (route: any, options?: { path?: string; hash?: string; reviewId?: number }) => void;
}> = ({
    sessionInfo,
    publicConfig,
    onLogout,
    refreshSession,
    onViewAdmin,
    onViewStatus,
    onViewDashboard,
    onViewSettings,
    onViewLogs,
    onViewCollexions,
    onViewScanner,
    onViewSpotifySync,
    onViewMediaAutomation,
    onViewRequests,
    onPendingRequestsChange,
    onNavigate,
}) => {
    const { t } = useDiscoverI18n();
    const [isLoading, setIsLoading] = useState(false);
    const [toast, setToast] = useState<ToastMessage | null>(null);
    const [analytics, setAnalytics] = useState<any>(null);
    const [analyticsLoading, setAnalyticsLoading] = useState(true);
    const [serverStats, setServerStats] = useState<any>(null);
    const [dashboardData, setDashboardData] = useState<any>(null);
    const [bazarrWidgets, setBazarrWidgets] = useState<any>(null);
    const [serverDataLoading, setServerDataLoading] = useState(true);
    const [topContentPage, setTopContentPage] = useState(0);
    const homeCustomModules = Array.isArray(sessionInfo?.homeCustomModules) ? sessionInfo.homeCustomModules : [];
    const [dashboardLayoutDraft, setDashboardLayoutDraft] = useState<DashboardLayoutConfig>(() => normalizeSectionLayout(publicConfig?.dashboardLayout, { homeCustomModules }));
    const [layoutEditorOpen, setLayoutEditorOpen] = useState(false);
    const [layoutSaving, setLayoutSaving] = useState(false);
    const [inlineWidgetEditing, setInlineWidgetEditing] = useState(false);
    const topWatchedPageSize = (dashboardLayoutDraft.topWatchedRows || DEFAULT_DASHBOARD_LAYOUT.topWatchedRows || 2) * 2;
    const [recentHistoryPage, setRecentHistoryPage] = useState(0);
    const recentHistoryPageSize = (dashboardLayoutDraft.recentHistoryRows || DEFAULT_DASHBOARD_LAYOUT.recentHistoryRows || 6);
    const [analyticsDays, setAnalyticsDaysState] = useState<number | 'all'>(() => readPersistedAnalyticsDays());
    const setAnalyticsDays = (value: number | 'all') => {
        persistAnalyticsDays(value);
        setAnalyticsDaysState(value);
    };
    const [analyticsDaysOpen, setAnalyticsDaysOpen] = useState(false);
    const [wrapUpDaysOpen, setWrapUpDaysOpen] = useState(false);
    const [analyticsError, setAnalyticsError] = useState<string | null>(null);
    const [reportItem, setReportItem] = useState<any>(null);
    const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
    const [shareWrapUpOpen, setShareWrapUpOpen] = useState(false);
    const [recapWrapUpOpen, setRecapWrapUpOpen] = useState(false);
    const [recentLimit, setRecentLimit] = useState(24);
    const [detailsItem, setDetailsItem] = useState<any>(null);
    const [wrapUpAchievements, setWrapUpAchievements] = useState<any>(null);
    const [wrapUpAchievementsRank, setWrapUpAchievementsRank] = useState<number | null>(null);
    const [wrapUpAchievementsSeed, setWrapUpAchievementsSeed] = useState(() => Date.now());
    const [homeRefreshing, setHomeRefreshing] = useState(false);
    const [homeLastUpdatedAt, setHomeLastUpdatedAt] = useState<number | null>(null);
    const homeRefreshingRef = useRef(false);

    const user = sessionInfo.account;
    const wrapUpSubjectId = String(
        sessionInfo?.impersonation?.targetUserId
        || user?.id
        || sessionInfo?.session?.id
        || sessionInfo?.session?.username
        || 'anon',
    );
    const [showNowPlayingCompanion, setShowNowPlayingCompanion] = useState<boolean>(() => (
        readNowPlayingCompanionEnabled(wrapUpSubjectId)
    ));
    // Members can hide Now Playing in Preferences; admins honor the same switch.
    const nowPlayingEnabled = !user || user.showDiscoverNowPlaying !== false;
    const { session: nowPlaying, others: nowPlayingOthers } = useNowPlaying(nowPlayingEnabled);
    const nowPlayingHeroArt = useNowPlayingHeroArt(nowPlaying);
    const showQualityBadges = publicConfig?.showPosterQualityBadges !== false;
    const mediaServerType = String(publicConfig?.mediaServerType || 'plex').toLowerCase();
    const homeNowPlayingCompanionEnabled = publicConfig?.homeNowPlayingCompanionEnabled !== false;
    const isJellyfinPortal = mediaServerType === 'jellyfin' || mediaServerType === 'emby';

    useEffect(() => {
        setShowNowPlayingCompanion(readNowPlayingCompanionEnabled(wrapUpSubjectId));
    }, [wrapUpSubjectId]);

    const toggleNowPlayingCompanion = useCallback((enabled: boolean) => {
        setShowNowPlayingCompanion(enabled);
        writeNowPlayingCompanionEnabled(wrapUpSubjectId, enabled);
    }, [wrapUpSubjectId]);

    useEffect(() => {
        setDashboardLayoutDraft(normalizeSectionLayout(publicConfig?.dashboardLayout, { homeCustomModules }));
    }, [publicConfig?.dashboardLayout, homeCustomModules]);

    const resolveHomeImage = (thumbUrl: string | null | undefined, fallback = logoUrl()) => {
        if (!thumbUrl) return fallback;
        if (thumbUrl.startsWith('http://') || thumbUrl.startsWith('https://') || thumbUrl.startsWith('/api/')) {
            return resolvePortalAssetUrl(thumbUrl);
        }
        return sizedPlexImageUrl(thumbUrl, 256, 256);
    };
    const heroBg = publicConfig?.backgroundImageUrl
        ? resolvePortalAssetUrl(publicConfig.backgroundImageUrl)
        : resolveHomeImage(
            dashboardData?.recentShows?.[0]?.artUrl ||
            dashboardData?.recentShows?.[0]?.thumbUrl ||
            dashboardData?.recentMovies?.[0]?.artUrl ||
            dashboardData?.recentMovies?.[0]?.thumbUrl ||
            dashboardData?.recentMusic?.[0]?.artUrl ||
            dashboardData?.recentMusic?.[0]?.thumbUrl,
            ''
        );

    const buildJellyfinHomeAnalytics = (data: any) => {
        const topMovies = Array.isArray(data?.topMovies) ? data.topMovies : [];
        const topShows = Array.isArray(data?.topShows) ? data.topShows : [];
        const topMusic = Array.isArray(data?.topMusic) ? data.topMusic : [];
        const topWatched = [...topShows, ...topMovies, ...topMusic].sort((a: any, b: any) => (b.plays || 0) - (a.plays || 0));
        const peakHours = Array.isArray(data?.peakHours) ? data.peakHours : [];
        const peakHour = peakHours.reduce((best: number, value: number, hour: number) => value > (peakHours[best] || 0) ? hour : best, 0);
        const dayOfWeekCounts = data?.dayOfWeekCounts && Object.keys(data.dayOfWeekCounts).length > 0
            ? data.dayOfWeekCounts
            : Object.entries(data?.heatmapData || {}).reduce((counts: Record<number, number>, [dateKey, count]) => {
                const date = new Date(`${dateKey}T00:00:00`);
                if (!Number.isNaN(date.getTime())) {
                    const day = date.getDay();
                    counts[day] = (counts[day] || 0) + (Number(count) || 0);
                }
                return counts;
            }, { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 });
        const topDayEntry = Object.entries(dayOfWeekCounts)
            .map(([day, count]) => ({ day: Number(day), count: Number(count) || 0 }))
            .sort((a, b) => b.count - a.count)[0];
        const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const moviesCount = data?.jellystatInsights?.moviePlays || topMovies.reduce((sum: number, item: any) => sum + (item.plays || 0), 0);
        const showsCount = data?.jellystatInsights?.tvPlays || topShows.reduce((sum: number, item: any) => sum + (item.plays || 0), 0);
        const musicCount = data?.jellystatInsights?.musicPlays || topMusic.reduce((sum: number, item: any) => sum + (item.plays || 0), 0);
        const topMovie = topMovies[0] || null;
        const topBinge = topShows[0] || null;
        const topLibraries = Array.isArray(data?.topLibraries) ? data.topLibraries : [];

        return {
            totalPlays: data?.totalPlaybacks || data?.jellystatInsights?.totalPlays || 0,
            moviesCount,
            showsCount,
            musicCount,
            topWatched,
            recentHistory: [],
            topMovie: topMovie ? { ...topMovie, artUrl: topMovie.thumbUrl } : null,
            topBinge: topBinge ? { ...topBinge, artUrl: topBinge.thumbUrl } : null,
            peakHour,
            avgHour: peakHour,
            timeOfDay: peakHour >= 5 && peakHour < 12 ? 'Early Bird' : peakHour >= 12 && peakHour < 18 ? 'Afternoon Watcher' : peakHour >= 18 ? 'Evening Streamer' : 'Night Owl',
            popularDay: topDayEntry && topDayEntry.count > 0 ? daysOfWeek[topDayEntry.day] : 'Recent Activity',
            dayOfWeekCounts,
            favoriteLibrary: topLibraries[0]?.title || 'None',
            topLibraries,
            mediaPreference: moviesCount > showsCount ? 'Movie Fan' : 'TV Binger',
            watchStyle: topWatched.length >= 10 ? 'Explorer' : 'Focused',
            uniqueTitles: topWatched.length,
            streamingHabit: 'Jellyfin Viewer',
            weekdayPlays: data?.totalPlaybacks || 0,
            weekendPlays: 0,
            leaderboardRank: data?.leaderboardRank || null,
            totalActiveUsers: data?.totalActiveUsers || 0,
            myPlaysOnLeaderboard: data?.myPlaysOnLeaderboard ?? null,
            myXp: data?.myXp ?? null,
            myLevel: data?.myLevel ?? null,
            myLevelProgress: data?.myLevelProgress ?? null,
            leaderboardNeighbourhood: data?.leaderboardNeighbourhood || [],
            leaderboardSource: data?.leaderboardSource || 'period_plays',
            leaderboardMetric: data?.leaderboardMetric || 'plays',
            periodLeaderboardRank: data?.periodLeaderboardRank ?? null,
            periodPlaysOnLeaderboard: data?.periodPlaysOnLeaderboard ?? null,
            periodActiveUsers: data?.periodActiveUsers ?? null,
            compare: data?.compare || null,
            libraryHealth: data?.libraryHealth || null,
            heatmapData: data?.heatmapData || null,
            period: String(analyticsDays),
        };
    };
    const handleRequestInvite = async (): Promise<boolean> => {
        setIsLoading(true);
        try {
            await apiFetch('/api/users/request-invite', { method: 'POST' });
            setToast({ id: 1, message: 'Invite requested successfully! Check your email.', type: 'success' });
            refreshSession();
            return true;
        } catch (e: any) {
            setToast({ id: 1, message: e.message || 'Failed to request invite', type: 'error' });
            return false;
        } finally {
            setIsLoading(false);
        }
    };

    // Auto-request invite if user is totally new — retry if the first attempt fails.
    useEffect(() => {
        if (!user && !isLoading && !sessionInfo.session.isAdmin) {
            if (sessionStorage.getItem('autoInviteSucceeded') === 'true') return;
            if (sessionStorage.getItem('autoInviteRequested') === 'true') return;
            sessionStorage.setItem('autoInviteRequested', 'true');
            handleRequestInvite().then((ok) => {
                if (ok) sessionStorage.setItem('autoInviteSucceeded', 'true');
                else sessionStorage.removeItem('autoInviteRequested');
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const analyticsFetchGenRef = useRef(0);
    const analyticsLoadingGenRef = useRef(0);

    const wrapUpClientCacheKey = (days: number | string) => `smp.wrapup.analytics.v4:${wrapUpSubjectId}:${days}`;
    const readWrapUpClientCache = (days: number | string) => {
        try {
            const raw = sessionStorage.getItem(wrapUpClientCacheKey(days));
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed?.payload || typeof parsed.at !== 'number') return null;
            // Keep session warm for up to 6 hours; server SWR still refreshes.
            if (Date.now() - parsed.at > 6 * 60 * 60 * 1000) return null;
            if (parsed.payload.period && String(parsed.payload.period) !== String(days)) return null;
            return parsed.payload;
        } catch {
            return null;
        }
    };
    const writeWrapUpClientCache = (days: number | string, payload: any) => {
        try {
            if (!payload || payload.error) return;
            sessionStorage.setItem(wrapUpClientCacheKey(days), JSON.stringify({ at: Date.now(), payload }));
        } catch {
            /* quota / private mode */
        }
    };

    const fetchAnalytics = useCallback(async ({ silent = false } = {}) => {
        if (!sessionInfo?.session?.isAdmin && !user) {
            if (!silent) setAnalyticsLoading(false);
            return;
        }
        const gen = ++analyticsFetchGenRef.current;
        const cachedLocal = !isJellyfinPortal ? readWrapUpClientCache(analyticsDays) : null;
        try {
            if (!silent) {
                analyticsLoadingGenRef.current = gen;
                if (cachedLocal) {
                    // Instant paint from last visit while network refresh runs.
                    setAnalytics(cachedLocal);
                    setAnalyticsLoading(false);
                    setAnalyticsError(null);
                } else {
                    setAnalyticsLoading(true);
                    setAnalyticsError(null);
                }
            }
            const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timeoutId = controller
                ? window.setTimeout(() => controller.abort(), 90_000)
                : null;
            let res: any;
            try {
                res = isJellyfinPortal
                    ? buildJellyfinHomeAnalytics(await apiFetch(`/api/jellystat/analytics?days=${analyticsDays}`, controller ? { signal: controller.signal } : undefined))
                    : await apiFetch(`/api/plex/analytics/me?days=${analyticsDays}`, controller ? { signal: controller.signal } : undefined);
            } finally {
                if (timeoutId != null) window.clearTimeout(timeoutId);
            }
            if (gen !== analyticsFetchGenRef.current) return;
            if (res?.period && String(res.period) !== String(analyticsDays)) return;
            setAnalytics(res);
            writeWrapUpClientCache(analyticsDays, res);
            if (!silent) {
                setTopContentPage(0);
                setRecentHistoryPage(0);
                setWrapUpAchievementsSeed(Date.now());
            }
        } catch (e: any) {
            if (gen !== analyticsFetchGenRef.current) return;
            if (!silent) {
                // Keep stale client cache visible if the refresh failed.
                if (!cachedLocal) {
                    const aborted = e?.name === 'AbortError' || /aborted/i.test(String(e?.message || ''));
                    const message = aborted
                        ? 'Wrap-Up timed out — try again in a moment.'
                        : (e?.message || 'Failed to load your analytics');
                    setAnalyticsError(message);
                    setAnalytics(null);
                    setToast({ id: Date.now(), message, type: 'error' });
                }
            }
        } finally {
            // Clear loading for the request that turned it on, even if a silent poll superseded it.
            if (!silent && analyticsLoadingGenRef.current === gen) {
                analyticsLoadingGenRef.current = 0;
                setAnalyticsLoading(false);
            }
        }
    }, [user, sessionInfo?.session?.isAdmin, analyticsDays, isJellyfinPortal, wrapUpSubjectId]);

    useEffect(() => {
        void fetchAnalytics();
    }, [fetchAnalytics]);

    // Achievements Wrap-Up row: paint all-time instantly (snapshot cache), then overlay period XP.
    // Do not wait for /analytics/me — that double-gated the row behind the slowest Home request.
    useEffect(() => {
        if (!sessionInfo?.navFeatures?.achievements) {
            setWrapUpAchievements(null);
            setWrapUpAchievementsRank(null);
            return;
        }
        if (!sessionInfo?.session?.isAdmin && !user) return;

        let cancelled = false;
        const daysQs = analyticsDays === 'all' ? 'all' : String(analyticsDays || 30);
        const cacheKey = `smp.wrapup.achievements.v2:${wrapUpSubjectId}:${daysQs}`;

        const readCache = () => {
            try {
                const raw = sessionStorage.getItem(cacheKey);
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                if (!parsed?.payload || typeof parsed.at !== 'number') return null;
                if (Date.now() - parsed.at > 6 * 60 * 60 * 1000) return null;
                return parsed.payload;
            } catch {
                return null;
            }
        };
        const writeCache = (payload: any) => {
            try {
                if (!payload?.enabled) return;
                sessionStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), payload }));
            } catch {
                /* ignore */
            }
        };

        const cached = readCache();
        if (cached) {
            setWrapUpAchievements(cached);
            if (cached._rank != null) setWrapUpAchievementsRank(cached._rank);
        }

        const loadRank = async (me: any) => {
            if (!me?.leaderboardEnabled || me.leaderboardOptOut) {
                if (!cancelled) setWrapUpAchievementsRank(null);
                return null;
            }
            const lb = await apiFetch('/api/achievements/leaderboard?limit=100').catch(() => null);
            if (cancelled) return null;
            const mine = Array.isArray(lb?.entries) ? lb.entries.find((entry: any) => entry?.isMe) : null;
            const rank = Number(mine?.rank);
            const nextRank = Number.isFinite(rank) && rank > 0 ? rank : null;
            setWrapUpAchievementsRank(nextRank);
            return nextRank;
        };

        const load = async () => {
            try {
                // Phase 1 — all-time from achievements snapshot (usually instant / cacheable).
                const me = await apiFetchShared('/api/achievements/me?view=summary').catch(() => null);
                if (cancelled) return;
                if (!me?.enabled) {
                    setWrapUpAchievements(null);
                    setWrapUpAchievementsRank(null);
                    return;
                }
                setWrapUpAchievements((prev: any) => {
                    // Keep any period fields we already had from cache until phase 2.
                    if (prev && (prev.periodXp != null || prev.periodDays != null)) {
                        return {
                            ...me,
                            periodDays: prev.periodDays,
                            periodXp: prev.periodXp,
                            periodBreakdown: prev.periodBreakdown,
                            priorPeriodXp: prev.priorPeriodXp,
                            periodXpDelta: prev.periodXpDelta,
                            periodBadgesEarned: prev.periodBadgesEarned,
                            periodStats: prev.periodStats,
                        };
                    }
                    return me;
                });

                const rank = await loadRank(me);

                // Phase 2 — period overlay (can scrape history; must not block the row).
                if (daysQs === 'all') {
                    writeCache({ ...me, _rank: rank });
                    return;
                }
                const period = await apiFetch(
                    `/api/achievements/me?view=summary&days=${encodeURIComponent(daysQs)}`,
                ).catch(() => null);
                if (cancelled || !period?.enabled) return;
                const merged = {
                    ...me,
                    ...period,
                    // Prefer phase-1 all-time xp/level; keep period fields from phase 2.
                    xp: me.xp,
                    level: me.level,
                    levelProgress: me.levelProgress,
                    breakdown: me.breakdown,
                    stats: me.stats,
                    earnedCount: me.earnedCount,
                    totalBadges: me.totalBadges,
                    recentEarned: me.recentEarned,
                    nextUnlocks: me.nextUnlocks,
                    periodDays: period.periodDays,
                    periodXp: period.periodXp,
                    periodBreakdown: period.periodBreakdown,
                    priorPeriodXp: period.priorPeriodXp,
                    periodXpDelta: period.periodXpDelta,
                    periodBadgesEarned: period.periodBadgesEarned,
                    periodStats: period.periodStats,
                    _rank: rank,
                };
                setWrapUpAchievements(merged);
                writeCache(merged);
            } catch {
                if (!cancelled && !cached) {
                    setWrapUpAchievements(null);
                    setWrapUpAchievementsRank(null);
                }
            }
        };
        void load();
        return () => { cancelled = true; };
    }, [
        sessionInfo?.navFeatures?.achievements,
        sessionInfo?.session?.isAdmin,
        user,
        analyticsDays,
        wrapUpSubjectId,
    ]);

    const wrapUpAchievementsForDisplay = useMemo(() => {
        if (!wrapUpAchievements) return null;
        const snapshotXp = Number(analytics?.myXp);
        const snapshotLevel = Number(analytics?.myLevel);
        if (analytics?.leaderboardSource !== 'achievements' || !(snapshotXp > 0)) {
            return wrapUpAchievements;
        }
        return {
            ...wrapUpAchievements,
            xp: snapshotXp,
            level: snapshotLevel > 0 ? snapshotLevel : wrapUpAchievements.level,
            levelProgress: analytics?.myLevelProgress || wrapUpAchievements.levelProgress,
        };
    }, [wrapUpAchievements, analytics?.myXp, analytics?.myLevel, analytics?.myLevelProgress, analytics?.leaderboardSource]);

    usePoll(() => { void fetchAnalytics({ silent: true }); }, 5 * 60 * 1000, { immediate: false });

    useEffect(() => {
        const onRefresh = () => { void fetchAnalytics({ silent: true }); };
        window.addEventListener('focus', onRefresh);
        const onVisibility = () => {
            if (document.visibilityState === 'visible') onRefresh();
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.removeEventListener('focus', onRefresh);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [fetchAnalytics]);

    useEffect(() => {
        if (!analytics?.topWatched?.length) return;
        const maxPage = Math.max(0, Math.ceil(analytics.topWatched.length / topWatchedPageSize) - 1);
        setTopContentPage((p) => Math.min(p, maxPage));
    }, [topWatchedPageSize, analytics?.topWatched?.length]);

    useEffect(() => {
        if (!analytics?.recentHistory?.length) return;
        const maxPage = Math.max(0, Math.ceil(analytics.recentHistory.length / recentHistoryPageSize) - 1);
        setRecentHistoryPage((p) => Math.min(p, maxPage));
    }, [recentHistoryPageSize, analytics?.recentHistory?.length]);

    const fetchHomeDashboard = useCallback(async () => {
        try {
            const [dashboardRes, bazarrRes] = await Promise.all([
                apiFetch(`${isJellyfinPortal ? '/api/jellyfin/dashboard' : '/api/plex/dashboard'}?limit=${RECENTLY_ADDED_ITEM_LIMIT}`),
                sessionInfo?.session?.isAdmin
                    ? apiFetch('/api/bazarr/widgets').catch(() => null)
                    : Promise.resolve(null),
            ]);
            setDashboardData(dashboardRes);
            if (bazarrRes) setBazarrWidgets(bazarrRes);
            setHomeLastUpdatedAt(Date.now());
        } catch (e) {
            console.error('Failed to refresh dashboard data', e);
        }
    }, [isJellyfinPortal, sessionInfo?.session?.isAdmin]);

    const fetchServerStats = useCallback(async () => {
        if (isJellyfinPortal) {
            setServerStats({ provider: 'jellyfin' });
            setServerDataLoading(false);
            return;
        }
        try {
            const res = await apiFetch('/api/plex/stats');
            setServerStats(res);
        } catch (e) {
            console.error('Failed to fetch server stats', e);
        } finally {
            setServerDataLoading(false);
        }
    }, [isJellyfinPortal]);

    useEffect(() => {
        void fetchServerStats();
        void fetchHomeDashboard();
    }, [fetchServerStats, fetchHomeDashboard]);

    usePoll(() => { void fetchHomeDashboard(); }, 5 * 60 * 1000, { immediate: false });

    usePoll(() => { void fetchServerStats(); }, serverStats?.isBuilding ? 5000 : null, { immediate: false });

    const refreshHome = useCallback(async () => {
        if (homeRefreshingRef.current) return;
        homeRefreshingRef.current = true;
        setHomeRefreshing(true);
        try {
            await Promise.all([
                fetchHomeDashboard(),
                fetchServerStats(),
                fetchAnalytics({ silent: true }),
            ]);
        } finally {
            homeRefreshingRef.current = false;
            setHomeRefreshing(false);
        }
    }, [fetchHomeDashboard, fetchServerStats, fetchAnalytics]);

    const { pullPx } = usePullToRefresh(refreshHome, { enabled: true, busy: homeRefreshing });

    useEffect(() => {
        if (!isJellyfinPortal || !analytics?.libraryHealth) return;
        setServerStats((current: any) => ({
            ...(current || {}),
            provider: 'jellyfin',
            ...analytics.libraryHealth,
        }));
    }, [isJellyfinPortal, analytics?.libraryHealth]);

    const handleRelink = async () => {
        setIsLoading(true);
        try {
            await apiFetch('/api/users/relink', { method: 'POST' });
            setToast({ id: 2, message: 'Account re-linked! Check your email for the invite.', type: 'success' });
            refreshSession();
        } catch (e: any) {
            setToast({ id: 2, message: e.message || 'Failed to re-link account', type: 'error' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleSaveDashboardLayout = async () => {
        setLayoutSaving(true);
        try {
            const result = await apiFetch('/api/config/dashboard-layout', {
                method: 'POST',
                body: JSON.stringify({ dashboardLayout: dashboardLayoutDraft }),
            });
            const nextLayout = normalizeSectionLayout(result?.dashboardLayout || dashboardLayoutDraft, { homeCustomModules });
            setDashboardLayoutDraft(nextLayout);
            setToast({ id: Date.now(), message: 'Portal widgets saved.', type: 'success' });
            setLayoutEditorOpen(false);
            setInlineWidgetEditing(false);
        } catch (e: any) {
            setToast({ id: Date.now(), message: e.message || 'Failed to save portal widgets', type: 'error' });
        } finally {
            setLayoutSaving(false);
        }
    };

    const updateDashboardLayoutDraft = (next: DashboardLayoutConfig | ((layout: DashboardLayoutConfig) => DashboardLayoutConfig)) => {
        setDashboardLayoutDraft((current) => normalizeSectionLayout(typeof next === 'function' ? next(current) : next, { homeCustomModules }));
    };

    const toggleDashboardSection = (id: DashboardSectionId) => {
        updateDashboardLayoutDraft((layout) => ({
            ...layout,
            hiddenSections: layout.hiddenSections.includes(id)
                ? layout.hiddenSections.filter((sectionId) => sectionId !== id)
                : [...layout.hiddenSections, id],
        }));
    };

    const toggleDashboardWidget = (id: DashboardWidgetId) => {
        updateDashboardLayoutDraft((layout) => ({
            ...layout,
            hiddenWidgets: layout.hiddenWidgets.includes(id)
                ? layout.hiddenWidgets.filter((widgetId) => widgetId !== id)
                : [...layout.hiddenWidgets, id],
        }));
    };

    const moveDashboardSection = (id: DashboardSectionId, direction: -1 | 1) => {
        updateDashboardLayoutDraft((layout) => ({
            ...layout,
            sections: moveDashboardItem(layout.sections, layout.sections.indexOf(id), direction),
        }));
    };

    const reorderDashboardSection = (sourceId: DashboardSectionId, targetId: DashboardSectionId) => {
        updateDashboardLayoutDraft((layout) => ({
            ...layout,
            sections: moveDashboardItemTo(layout.sections, layout.sections.indexOf(sourceId), layout.sections.indexOf(targetId)),
        }));
    };

    const moveDashboardMainWidget = (id: MainGridWidgetId, direction: -1 | 1) => {
        updateDashboardLayoutDraft((layout) => ({
            ...layout,
            mainGridOrder: moveDashboardItem(layout.mainGridOrder, layout.mainGridOrder.indexOf(id), direction),
        }));
    };

    const reorderDashboardMainWidget = (sourceId: MainGridWidgetId, targetId: MainGridWidgetId) => {
        updateDashboardLayoutDraft((layout) => ({
            ...layout,
            mainGridOrder: moveDashboardItemTo(layout.mainGridOrder, layout.mainGridOrder.indexOf(sourceId), layout.mainGridOrder.indexOf(targetId)),
        }));
    };

    const moveDashboardRecentWidget = (id: RecentlyAddedWidgetId, direction: -1 | 1) => {
        updateDashboardLayoutDraft((layout) => ({
            ...layout,
            recentlyAddedOrder: moveDashboardItem(layout.recentlyAddedOrder, layout.recentlyAddedOrder.indexOf(id), direction),
        }));
    };

    const reorderDashboardRecentWidget = (sourceId: RecentlyAddedWidgetId, targetId: RecentlyAddedWidgetId) => {
        updateDashboardLayoutDraft((layout) => ({
            ...layout,
            recentlyAddedOrder: moveDashboardItemTo(layout.recentlyAddedOrder, layout.recentlyAddedOrder.indexOf(sourceId), layout.recentlyAddedOrder.indexOf(targetId)),
        }));
    };

    const setDashboardWidgetSize = (id: DashboardWidgetId, size: DashboardWidgetSize) => {
        updateDashboardLayoutDraft((layout) => {
            const widgetSizes = { ...(layout.widgetSizes || {}) };
            if (size === 'normal') delete widgetSizes[id];
            else widgetSizes[id] = size;
            return { ...layout, widgetSizes };
        });
    };

    const daysLeft = user?.expiryDate ? getDaysUntilExpiry(user.expiryDate) : null;
    const progressPct = getAccessProgressPct(user?.expiryDate || null, user?.joiningDate || null);
    const isExpired = daysLeft !== null && daysLeft < 0;
    const isExpiringSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7;
    const isRevoked = user?.plexAccessStatus === 'revoked';
    const isPending = user?.plexAccessStatus?.toLowerCase() === 'pending';

    const wrapUpDaysOptions = useMemo(
        () => ANALYTICS_PERIOD_OPTIONS.map((opt) => ({
            ...opt,
            label: periodLabel(opt.value, t),
        })),
        [t],
    );

    const layoutCtx = useMemo(() => ({
        isAdmin: !!sessionInfo.session.isAdmin,
        hasUser: !!user,
        referralEnabled: !!publicConfig?.referralEnabled,
        requestsQueueEnabled: !!sessionInfo?.navFeatures?.requestsQueue,
        collexionsEnabled: !!sessionInfo?.navFeatures?.collexions,
        scannerHomeWidgetEnabled: !!sessionInfo?.navFeatures?.scannerHomeWidget,
        spotifySyncHomeWidgetEnabled: !!sessionInfo?.navFeatures?.spotifySyncHomeWidget,
        mediaAutomationHomeWidgetEnabled: !!sessionInfo?.navFeatures?.mediaAutomationHomeWidget,
        achievementsEnabled: !!sessionInfo?.navFeatures?.achievements,
        achievementsHomeWidgetEnabled: publicConfig?.achievementsHomeWidgetEnabled !== false,
        mediaServerType: publicConfig?.mediaServerType || 'plex',
        homeCustomModules,
    }), [sessionInfo.session.isAdmin, user, publicConfig?.referralEnabled, publicConfig?.mediaServerType, publicConfig?.achievementsHomeWidgetEnabled, sessionInfo?.navFeatures?.requestsQueue, sessionInfo?.navFeatures?.collexions, sessionInfo?.navFeatures?.scannerHomeWidget, sessionInfo?.navFeatures?.spotifySyncHomeWidget, sessionInfo?.navFeatures?.mediaAutomationHomeWidget, sessionInfo?.navFeatures?.achievements, homeCustomModules]);

    const widgetDeps = useMemo(() => ({
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
        analytics,
        analyticsLoading,
        analyticsDays,
        analyticsDaysOpen,
        setAnalyticsDays,
        setAnalyticsDaysOpen,
        showQualityBadges,
        dashboardData,
        bazarrWidgets,
        handleRelink,
        onViewAdmin,
        onNavigate,
        onViewSettings,
        onViewLogs,
        onViewCollexions,
        onViewScanner,
        onViewSpotifySync,
        onViewMediaAutomation,
        onViewRequests,
        onPendingRequestsChange,
        setToast,
        DiscoverPosterCard,
        RebuildLibraryCacheButton,
    }), [
        t, sessionInfo, publicConfig, user, isRevoked, isExpiringSoon, daysLeft, progressPct,
        serverStats, serverDataLoading, analytics, analyticsLoading, analyticsDays, analyticsDaysOpen,
        showQualityBadges, dashboardData, bazarrWidgets, onViewAdmin, onNavigate, onViewSettings, onViewLogs, onViewCollexions, onViewScanner, onViewSpotifySync, onViewMediaAutomation, onViewRequests, onPendingRequestsChange,
    ]);

    const renderMainGridWidget = useMemo(() => createMainGridWidgetRenderer(widgetDeps), [widgetDeps]);
    const renderPendingRequests = useMemo(() => createPendingRequestsSectionRenderer(widgetDeps), [widgetDeps]);
    const renderScanner = useMemo(() => createScannerSectionRenderer(widgetDeps), [widgetDeps]);
    const renderSpotifySync = useMemo(() => createSpotifySyncSectionRenderer(widgetDeps), [widgetDeps]);
    const renderMediaAutomation = useMemo(() => createMediaAutomationSectionRenderer(widgetDeps), [widgetDeps]);
    const renderBazarrTools = useMemo(() => createBazarrToolsSectionRenderer(widgetDeps), [widgetDeps]);
    const renderRecentlyAddedWidget = useMemo(() => createRecentlyAddedWidgetRenderer(widgetDeps), [widgetDeps]);

    return (
        <div className="w-full flex flex-col gap-3 md:gap-4">
            <Loader isLoading={isLoading} isCinematic={!!publicConfig?.useCinematicLoading} />
            {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
            {(pullPx > 0 || homeRefreshing) ? (
                <div
                    className="flex items-center justify-center overflow-hidden transition-[height] duration-150"
                    style={{ height: homeRefreshing ? 36 : Math.max(24, pullPx) }}
                    aria-hidden="true"
                >
                    <RefreshCw className={`w-5 h-5 text-plex ${homeRefreshing || pullPx >= 72 ? 'animate-spin' : ''}`} />
                </div>
            ) : null}
            {layoutEditorOpen && (
                <PortalWidgetEditorModal
                    layout={dashboardLayoutDraft}
                    onChange={updateDashboardLayoutDraft}
                    homeCustomModules={homeCustomModules}
                    onSave={handleSaveDashboardLayout}
                    onClose={() => setLayoutEditorOpen(false)}
                    saving={layoutSaving}
                />
            )}

            {/* Massive Hero Banner */}
            <div className="home-hero-banner relative w-full rounded-2xl overflow-hidden shadow-2xl bg-card border border-border">
                {/* Blurred Background */}
                <div className="absolute inset-0 bg-background overflow-hidden">
                    {nowPlayingHeroArt ? (
                        <HomeHeroPlaybackBackdrop artUrl={nowPlayingHeroArt} />
                    ) : publicConfig?.useTrendingSlideshow && publicConfig?.trendingBackgrounds?.length > 0 ? (
                        <>
                            <div className="absolute inset-0 opacity-100">
                                <SlideshowBackground
                                    backgrounds={publicConfig.trendingBackgrounds}
                                    intervalSeconds={publicConfig.trendingSlideshowInterval}
                                    opacity={1}
                                    smartFocus
                                />
                            </div>
                            <div className="home-hero-scrim absolute inset-0 bg-gradient-to-t from-card via-card/50 to-transparent" />
                            <div className="absolute inset-0 bg-gradient-to-r from-card via-card/20 to-transparent" />
                            <div className="absolute inset-0 bg-black/10" />
                        </>
                    ) : dashboardData?.recentMovies?.length > 0 ? (
                        <HomeHeroMovieBackdrop movies={dashboardData.recentMovies} />
                    ) : heroBg ? (
                        <>
                            <div
                                className="absolute inset-0 bg-cover bg-center opacity-30 md:blur-2xl md:scale-110"
                                style={{ backgroundImage: `url(${heroBg})` }}
                            />
                            <div className="home-hero-scrim absolute inset-0 bg-gradient-to-t from-card via-card/80 to-transparent" />
                            <div className="absolute inset-0 bg-gradient-to-r from-card via-card/40 to-transparent" />
                        </>
                    ) : (
                        <>
                            <div className="home-hero-scrim absolute inset-0 bg-gradient-to-t from-card via-card/80 to-transparent" />
                            <div className="absolute inset-0 bg-gradient-to-r from-card via-card/40 to-transparent" />
                        </>
                    )}
                </div>

                {false && sessionInfo.session.isAdmin && (
                    <div className="absolute top-4 right-4 z-20 flex flex-wrap justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => setInlineWidgetEditing((value) => !value)}
                            className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-bold backdrop-blur-md transition-colors shadow-lg ${inlineWidgetEditing ? 'border-plex/70 bg-plex text-black' : 'border-white/15 bg-black/45 text-text hover:border-plex/50 hover:text-plex'}`}
                        >
                            <Settings className="w-4 h-4" />
                            {inlineWidgetEditing ? 'Editing Widgets' : 'Edit Widgets'}
                        </button>
                        {inlineWidgetEditing && (
                            <button
                                type="button"
                                onClick={handleSaveDashboardLayout}
                                disabled={layoutSaving}
                                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-emerald-400/40 bg-emerald-500/20 text-emerald-100 text-sm font-bold backdrop-blur-md hover:bg-emerald-500/30 disabled:opacity-60 transition-colors shadow-lg"
                            >
                                {layoutSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                                Save
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setLayoutEditorOpen(true)}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-white/15 bg-black/45 text-text text-sm font-bold backdrop-blur-md hover:border-plex/50 hover:text-plex transition-colors shadow-lg"
                        >
                            List
                        </button>
                    </div>
                )}

                <div className="absolute top-3 right-3 md:top-4 md:right-4 z-20 flex flex-col items-end gap-1">
                    <button
                        type="button"
                        onClick={() => { void refreshHome(); }}
                        disabled={homeRefreshing}
                        aria-label={t('homeDashboard.refreshAria')}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-white/15 bg-black/45 text-text text-xs md:text-sm font-bold backdrop-blur-md hover:border-plex/50 hover:text-plex disabled:opacity-60 transition-colors shadow-lg"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${homeRefreshing ? 'animate-spin' : ''}`} />
                        {t('homeDashboard.refresh')}
                    </button>
                    {homeLastUpdatedAt ? (
                        <span className="text-[10px] font-bold uppercase tracking-widest text-white/70 drop-shadow-md px-1">
                            {t('homeDashboard.updatedAt', { time: formatTime(new Date(homeLastUpdatedAt)) })}
                        </span>
                    ) : null}
                </div>

                <div className={`relative pt-14 px-4 md:pt-32 md:px-12 flex flex-col items-center md:items-start text-center md:text-left z-10 ${nowPlaying ? 'pb-12 md:pb-16' : 'pb-5 md:pb-12'}`}>
                    <div className="flex flex-col md:flex-row items-center md:items-center gap-3 md:gap-6">
                        {/* Avatar */}
                        {(() => {
                            const thumbUrl = user?.thumb || sessionInfo.session.thumb || (sessionInfo.session.isAdmin ? sessionInfo.adminThumb : null);
                            if (thumbUrl) {
                                return (
                                    <div className="relative">
                                        <img
                                            src={resolveHomeImage(thumbUrl)}
                                            alt={sessionInfo.session.username}
                                            className="relative w-20 h-20 md:w-32 md:h-32 rounded-full object-cover border-4 border-plex shadow-2xl bg-card"
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).style.display = 'none';
                                                (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                                                (e.target as HTMLImageElement).nextElementSibling?.classList.add('flex');
                                            }}
                                        />
                                        <div className={`hidden relative w-20 h-20 md:w-32 md:h-32 rounded-full bg-gradient-to-br from-plex/40 to-plex/10 border-4 border-plex items-center justify-center text-plex font-black text-4xl md:text-5xl shadow-2xl overflow-hidden`}>
                                            {sessionInfo.session.username?.[0]?.toUpperCase() || '?'}
                                        </div>
                                    </div>
                                );
                            }
                            return (
                                <div className="relative">
                                    <div className={`relative w-20 h-20 md:w-32 md:h-32 rounded-full bg-gradient-to-br from-plex/40 to-plex/10 border-4 border-plex items-center justify-center text-plex font-black text-4xl md:text-5xl flex shadow-2xl overflow-hidden`}>
                                        {sessionInfo.session.username?.[0]?.toUpperCase() || '?'}
                                    </div>
                                </div>
                            );
                        })()}

                        <div className="pb-1 md:pb-2 overflow-visible min-w-0 max-w-full">
                            <p className="text-plex text-xs md:text-sm uppercase tracking-[0.2em] md:tracking-[4px] font-bold mb-1 drop-shadow-md">
                                {(() => {
                                    const hour = new Date().getHours();
                                    if (hour >= 5 && hour < 12) return 'Good Morning';
                                    if (hour >= 12 && hour < 17) return 'Good Afternoon';
                                    if (hour >= 17 && hour < 22) return 'Good Evening';
                                    return 'Good Night';
                                })()}
                            </p>
                            <h1
                                className="text-4xl md:text-5xl font-black text-text leading-normal pb-0.5"
                                style={{ fontSize: 'clamp(1.35rem, 6.5vw, 3rem)', wordBreak: 'break-word' }}
                            >
                                {sessionInfo.session.username}
                            </h1>
                            {(sessionInfo.session.isAdmin || wrapUpAchievementsForDisplay) && (
                                <div className="mt-3 flex flex-wrap items-center justify-center md:justify-start gap-2">
                                    {sessionInfo.session.isAdmin && (
                                        <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-black bg-plex/20 text-plex border border-plex/40 uppercase tracking-widest">
                                            Server Admin
                                        </span>
                                    )}
                                    {wrapUpAchievementsForDisplay && (
                                        <>
                                            <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-black bg-black/40 text-text border border-white/20 uppercase tracking-widest backdrop-blur-sm">
                                                Lv {Number(wrapUpAchievementsForDisplay.level) || 1}
                                            </span>
                                            <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-black bg-black/40 text-plex border border-plex/35 uppercase tracking-widest backdrop-blur-sm font-mono tabular-nums">
                                                {(Number(wrapUpAchievementsForDisplay.xp) || 0).toLocaleString()} XP
                                            </span>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {nowPlaying ? (
                    <DiscoverNowPlayingStrip
                        session={nowPlaying}
                        others={nowPlayingOthers}
                        onNavigate={(path) => onNavigate?.('discovery', { path })}
                        onOpenProfile={(id) => goToProfile(onNavigate, id)}
                    />
                ) : null}
            </div>

            {nowPlaying && homeNowPlayingCompanionEnabled && showNowPlayingCompanion ? (
                <NowPlayingCompanionPanel
                    session={nowPlaying}
                    userKey={wrapUpSubjectId}
                    mediaServerType={mediaServerType}
                    onNavigate={(path) => onNavigate?.('discovery', { path })}
                    onToast={(message, type = 'success') => setToast({
                        id: Date.now(),
                        message,
                        type,
                    })}
                />
            ) : null}
            {nowPlaying && homeNowPlayingCompanionEnabled && !showNowPlayingCompanion ? (
                <div className="mt-3 flex justify-end">
                    <button
                        type="button"
                        onClick={() => toggleNowPlayingCompanion(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-400/30 bg-emerald-500/15 text-emerald-100 text-xs font-bold hover:bg-emerald-500/25 transition-colors"
                    >
                        {t('homeDashboard.nowPlayingCompanion.actions.enableCompanion')}
                    </button>
                </div>
            ) : null}

            {selectedMetric && analytics && (
                <WrapUpModal
                    metric={selectedMetric}
                    analytics={analytics}
                    days={analyticsDays}
                    onClose={() => setSelectedMetric(null)}
                    onOpenProfile={(id) => {
                        setSelectedMetric(null);
                        onNavigate?.('profile', { path: `/profile/${encodeURIComponent(id)}` });
                    }}
                />
            )}
            {shareWrapUpOpen && analytics && (
                <ShareWrapUpModal
                    analytics={analytics}
                    days={analyticsDays}
                    serverName={sessionInfo?.serverName || 'StreamPilot'}
                    username={sessionInfo?.session?.username || user?.username}
                    onClose={() => setShareWrapUpOpen(false)}
                    onToast={(message, type) => setToast({ id: Date.now(), message, type })}
                />
            )}
            {recapWrapUpOpen && analytics && (
                <WrapUpRecapModal
                    analytics={analytics}
                    days={analyticsDays}
                    loading={analyticsLoading}
                    onClose={() => setRecapWrapUpOpen(false)}
                    onDaysChange={(value) => setAnalyticsDays(value)}
                />
            )}

            <DetailsModal item={detailsItem} onClose={() => setDetailsItem(null)} />

            <UserDashboardLayout
                layoutConfig={dashboardLayoutDraft}
                layoutCtx={layoutCtx}
                homeCustomModules={homeCustomModules}
                renderCustomModule={(module) => (
                    <HomeCustomModuleSection module={module} isAdmin={!!sessionInfo.session.isAdmin} />
                )}
                renderMainGridWidget={renderMainGridWidget}
                renderPendingRequests={renderPendingRequests}
                renderScanner={renderScanner}
                renderSpotifySync={renderSpotifySync}
                renderMediaAutomation={renderMediaAutomation}
                renderBazarrTools={renderBazarrTools}
                renderRecentlyAddedWidget={renderRecentlyAddedWidget}
                recentlyAddedLoading={serverDataLoading}
                hasDashboardData={!!dashboardData}
                renderRecentlyAddedSkeleton={() => <HomeRecentlyAddedSkeleton />}
                renderWrapUp={() => (
                    <>
                        {/* Personal Wrap-Up */}
                        {(sessionInfo.session.isAdmin || user) && analyticsLoading && !analytics && (
                            <WrapUpCardsSkeleton />
                        )}
                        {(sessionInfo.session.isAdmin || user) && analyticsError && !analytics && (
                            <div className="glass-card p-4 md:p-5 shadow-xl border border-red-500/30 bg-red-500/5">
                                <p className="text-red-300 text-sm font-medium">{analyticsError}</p>
                            </div>
                        )}
                        {(sessionInfo.session.isAdmin || user) && analytics && (
                            <div className="glass-card p-4 md:p-5 shadow-xl">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 md:mb-4">
                                    <div className="min-w-0">
                                        <h3 className="text-lg md:text-xl font-bold text-text">{t('wrapUp.title')}</h3>
                                        {analytics.compare?.totalPlays && formatWrapUpDelta(analytics.compare.totalPlays, t) ? (
                                            <p className="text-xs text-muted mt-0.5">
                                                {t('wrapUp.vsPrior', {
                                                    delta: formatWrapUpDelta(analytics.compare.totalPlays, t) as string,
                                                    period: wrapUpPriorPeriodLabel(analytics.compare.previousPeriodDays || analyticsDays, t),
                                                })}
                                            </p>
                                        ) : null}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {analytics.compare ? (
                                            <button
                                                type="button"
                                                onClick={() => setRecapWrapUpOpen(true)}
                                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-white/5 border border-white/15 text-text hover:border-plex/50 hover:text-plex transition-colors shadow-sm"
                                            >
                                                <Sparkles className="w-4 h-4 flex-shrink-0" />
                                                {t('wrapUp.recap')}
                                            </button>
                                        ) : null}
                                        <button
                                            type="button"
                                            onClick={() => setShareWrapUpOpen(true)}
                                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-plex/10 border border-plex/30 text-plex hover:bg-plex/20 transition-colors shadow-sm"
                                        >
                                            <Share2 className="w-4 h-4 flex-shrink-0" />
                                            {analyticsDays === 365 ? t('wrapUp.yearInReview') : t('wrapUp.share')}
                                        </button>
                                        <PeriodDropdown
                                            value={analyticsDays}
                                            open={wrapUpDaysOpen}
                                            onToggle={() => setWrapUpDaysOpen(!wrapUpDaysOpen)}
                                            onClose={() => setWrapUpDaysOpen(false)}
                                            onChange={(value) => setAnalyticsDays(value as number | 'all')}
                                            options={wrapUpDaysOptions}
                                            fallbackLabel={t('wrapUp.last7Days')}
                                            buttonClassName="flex items-center gap-2 bg-background border border-border/50 rounded-lg px-3 py-1.5 text-sm font-medium text-text focus:outline-none hover:border-plex/50 transition-colors cursor-pointer shadow-sm"
                                        />
                                    </div>
                                </div>
                                <div className="relative">
                                    {analyticsLoading && analytics.period != null && String(analytics.period) !== String(analyticsDays) ? (
                                        <div className="absolute inset-0 z-10 bg-background/55 backdrop-blur-[1px] flex items-center justify-center rounded-xl min-h-[12rem]">
                                            <Loader2 className="w-8 h-8 text-plex animate-spin" />
                                        </div>
                                    ) : null}
                                    <div className={analyticsLoading && analytics.period != null && String(analytics.period) !== String(analyticsDays) ? 'opacity-40 pointer-events-none' : undefined}>
                                        <WrapUpCardGrid analytics={analytics} interactive onCardClick={setSelectedMetric} minCardHeight={112} />
                                        {analytics.heatmapData && (
                                            <div className="mt-6 pt-6 border-t border-white/10 min-w-0">
                                                <h4 className="text-xs uppercase tracking-widest text-muted font-bold mb-4 flex items-center gap-2">
                                                    <Calendar className="w-4 h-4 text-plex" />{' '}
                                                    {analyticsDays === 'all'
                                                        ? t('wrapUp.activityAllTime')
                                                        : t('wrapUp.activityLastDays', { days: analyticsDays })}
                                                </h4>
                                                <ActivityHeatmap data={analytics.heatmapData} />
                                            </div>
                                        )}
                                    </div>
                                </div>
                                {wrapUpAchievementsForDisplay && (
                                    <AchievementsWrapUpSpotlight
                                        me={wrapUpAchievementsForDisplay}
                                        rank={wrapUpAchievementsRank}
                                        seed={wrapUpAchievementsSeed}
                                        minCardHeight={112}
                                        onOpenAchievements={() => {
                                            window.history.pushState({}, '', portalUrl('/achievements'));
                                            window.dispatchEvent(new PopStateEvent('popstate'));
                                        }}
                                    />
                                )}
                            </div>
                        )}
                    </>
                )}
                renderBecauseYouWatched={() => (
                    <BecauseYouWatchedHomeRail
                        t={t}
                        DiscoverPosterCard={DiscoverPosterCard}
                        onNavigate={onNavigate}
                        enabled={userAllowsHomeBecauseYouWatched(user)}
                    />
                )}
                renderWatchRowLeft={() => {
                    if (!(sessionInfo.session.isAdmin || user)) return null;
                    if (analyticsLoading && !analytics?.recentHistory?.length) {
                        return (
                            <div className="glass-card p-4 md:p-5 shadow-xl flex flex-col justify-center min-h-[11rem] w-full" aria-busy="true">
                                <h3 className="text-lg md:text-xl font-bold text-text">{t('wrapUp.recentlyWatched')}</h3>
                                <p className="text-sm text-muted mt-2">{t('common.refreshing')}</p>
                            </div>
                        );
                    }
                    if (!analytics?.recentHistory?.length) {
                        return (
                            <div className="glass-card p-4 md:p-5 shadow-xl flex flex-col justify-center min-h-[11rem] w-full">
                                <h3 className="text-lg md:text-xl font-bold text-text">{t('wrapUp.recentlyWatched')}</h3>
                                <p className="text-sm text-muted mt-2 leading-relaxed">{t('homeDashboard.emptyRecentlyWatched')}</p>
                            </div>
                        );
                    }
                    return (
                        <div className="glass-card p-4 md:p-5 shadow-xl flex flex-col h-full w-full min-h-0">
                            <div className="flex items-center justify-between mb-3 md:mb-4 flex-shrink-0">
                                <h3 className="text-lg md:text-xl font-bold text-text">{t('wrapUp.recentlyWatched')}</h3>
                                {analytics.recentHistory.length > recentHistoryPageSize && (
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => setRecentHistoryPage(p => Math.max(0, p - 1))}
                                            disabled={recentHistoryPage === 0}
                                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-text"
                                        >
                                            <ChevronUp className="w-4 h-4 -rotate-90" />
                                        </button>
                                        <span className="text-xs text-muted font-medium w-8 text-center">
                                            {recentHistoryPage + 1} / {Math.ceil(analytics.recentHistory.length / recentHistoryPageSize)}
                                        </span>
                                        <button
                                            onClick={() => setRecentHistoryPage(p => Math.min(Math.ceil(analytics.recentHistory.length / recentHistoryPageSize) - 1, p + 1))}
                                            disabled={recentHistoryPage >= Math.ceil(analytics.recentHistory.length / recentHistoryPageSize) - 1}
                                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-text"
                                        >
                                            <ChevronDown className="w-4 h-4 -rotate-90" />
                                        </button>
                                    </div>
                                )}
                            </div>
                            <div className="relative flex flex-col flex-1 min-h-0 overflow-y-auto custom-scrollbar pl-8 pr-2 pt-2 pb-2">
                                {/* Vertical Line */}
                                <div className="absolute left-[15px] top-6 bottom-6 w-[2px] bg-white/5 rounded-full" />
                                
                                {analytics.recentHistory.slice(recentHistoryPage * recentHistoryPageSize, (recentHistoryPage + 1) * recentHistoryPageSize).map((item: any, idx: number) => (
                                    <div key={idx} className="relative flex items-center py-2.5 group">
                                        {/* Timeline Node */}
                                        <div className="absolute -left-[21px] w-[10px] h-[10px] rounded-full bg-white/20 group-hover:bg-plex group-hover:scale-[1.6] group-hover:shadow-[0_0_15px_rgba(229,160,13,0.8)] transition-all duration-300 z-10" />
                                        
                                        <button onClick={() => setDetailsItem(item)} className="flex items-center flex-1 min-w-0 gap-4 p-2.5 -my-2.5 rounded-2xl hover:bg-white/5 transition-colors border-0 bg-transparent text-left cursor-pointer outline-none w-full relative group">
                                            <div className={`w-10 sm:w-12 ${item.type === 'track' ? 'aspect-square' : 'aspect-[2/3]'} rounded-md overflow-hidden bg-black/50 flex-shrink-0 shadow-lg border border-white/5 group-hover:border-plex/40 transition-colors`}>
                                                {item.thumbUrl ? (
                                                    <img
                                                        src={item.type === 'track'
                                                            ? sizedPlexImageUrl(item.thumbUrl, 240, 240)
                                                            : sizedPlexImageUrl(item.thumbUrl, 240, 360)}
                                                        alt={item.title}
                                                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center">
                                                        <PlaySquare className="w-5 h-5 text-muted/50" />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0 flex flex-col justify-center">
                                                <p className="text-sm text-muted truncate">
                                                    {item.type === 'track' ? 'Listened to' : 'Watched'}{' '}
                                                    <span className="font-bold text-text group-hover:text-plex transition-colors">{item.title}</span>
                                                </p>
                                                {item.episodeTitle && <p className="text-[11px] font-semibold text-muted/70 truncate mt-0.5">{item.episodeTitle}</p>}
                                                <div className="flex items-center gap-1.5 mt-1.5">
                                                    <Clock className="w-3 h-3 text-plex/80" />
                                                    <p className="text-[10px] font-mono font-bold text-muted/60 uppercase tracking-wider">{formatPortalDateTime(item.viewedAt)}</p>
                                                </div>
                                            </div>
                                        </button>
                                        <button
                                            onClick={(e) => { e.preventDefault(); setReportItem(item); }}
                                            className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 p-2.5 ml-2 text-muted hover:text-red-400 hover:bg-red-400/10 rounded-xl transition-all focus:outline-none flex-shrink-0"
                                            title="Report a playback issue"
                                        >
                                            <AlertTriangle className="w-[18px] h-[18px]" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                }}
                renderWatchRowRight={() => {
                    if (!(sessionInfo.session.isAdmin || user)) return null;
                    if (analyticsLoading) return <TopWatchedGridSkeleton />;
                    if (!(analytics && analytics.totalPlays > 0 && analytics.topWatched && analytics.topWatched.length > 0)) {
                        return (
                            <div className="glass-card p-4 md:p-5 shadow-xl flex flex-col justify-center min-h-[11rem] w-full">
                                <h3 className="text-lg md:text-xl font-bold text-text">{t('homeDashboard.mostWatched')}</h3>
                                <p className="text-sm text-muted mt-2 leading-relaxed">{t('homeDashboard.emptyMostWatched')}</p>
                            </div>
                        );
                    }
                    return (
                        <div className="glass-card p-4 md:p-5 shadow-xl flex flex-col h-full w-full min-h-0">
                            <div className="flex flex-wrap items-center justify-between gap-3 mb-3 md:mb-4 flex-shrink-0">
                                <div>
                                    <h3 className="text-lg md:text-xl font-bold text-text mb-0.5">{t('homeDashboard.mostWatched')}</h3>
                                    <p className="text-muted text-sm">{t('homeDashboard.mostWatchedSubtitle', { count: analytics.totalPlays })}</p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    {analytics.topWatched.length > topWatchedPageSize && (
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => setTopContentPage(p => Math.max(0, p - 1))}
                                                disabled={topContentPage === 0}
                                                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-text"
                                            >
                                                <ChevronUp className="w-4 h-4 -rotate-90" />
                                            </button>
                                            <span className="text-xs text-muted font-medium w-8 text-center">
                                                {topContentPage + 1} / {Math.ceil(analytics.topWatched.length / topWatchedPageSize)}
                                            </span>
                                            <button
                                                onClick={() => setTopContentPage(p => Math.min(Math.ceil(analytics.topWatched.length / topWatchedPageSize) - 1, p + 1))}
                                                disabled={topContentPage >= Math.ceil(analytics.topWatched.length / topWatchedPageSize) - 1}
                                                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-text"
                                            >
                                                <ChevronDown className="w-4 h-4 -rotate-90" />
                                            </button>
                                        </div>
                                    )}
                                    <PeriodDropdown
                                        value={analyticsDays}
                                        open={analyticsDaysOpen}
                                        onToggle={() => setAnalyticsDaysOpen(!analyticsDaysOpen)}
                                        onClose={() => setAnalyticsDaysOpen(false)}
                                        onChange={(value) => setAnalyticsDays(value as number | 'all')}
                                        options={wrapUpDaysOptions}
                                        fallbackLabel={t('wrapUp.last7Days')}
                                        buttonClassName="flex items-center gap-2 bg-background border border-border/50 rounded-lg px-3 py-1.5 text-sm font-medium text-text focus:outline-none hover:border-plex/50 transition-colors cursor-pointer shadow-sm"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1 min-h-0 content-start">
                                {analytics.topWatched.slice(topContentPage * topWatchedPageSize, (topContentPage + 1) * topWatchedPageSize).map((item: any) => {
                                    const isMusic = String(item.type || '').toLowerCase() === 'track';
                                    const discoveryPath = titleDiscoveryPath(item);
                                    const openDiscovery = discoveryPath && onNavigate
                                        ? () => onNavigate('discovery', { path: discoveryPath })
                                        : undefined;
                                    return (
                                        <WatchHistoryMediaCard
                                            key={item.key || item.title}
                                            item={item}
                                            actionLabel={isMusic ? t('profilePage.listenedLabel') : t('profilePage.watchedLabel')}
                                            subtitle={item.plays > 0 ? t('profilePage.plays', { count: item.plays }) : (item.episodeTitle || null)}
                                            when={formatWatchHistoryWhen(item.lastViewedAt || item.viewedAt, t)}
                                            onOpen={openDiscovery}
                                            href={!openDiscovery ? (item.plexUrl || null) : null}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    );
                }}
            />

            {reportItem && (
                <ReportIssueModal item={reportItem} onClose={() => setReportItem(null)} />
            )}
        </div>
    );
};

const ServiceCustomSelect = ({ value, onChange, options }: { value: string, onChange: (val: string) => void, options: { id: string, name: string }[] }) => {
    const [isOpen, setIsOpen] = useState(false);
    const selected = options.find(o => o.id === value);

    return (
        <div className="relative flex-1 md:flex-none md:w-64">
            <button
                type="button"
                className="w-full bg-black/20 border border-border hover:border-white/20 rounded-lg px-4 py-2.5 text-text outline-none flex items-center justify-between transition-colors"
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className="truncate">{selected ? selected.name : '-- Choose a service --'}</span>
                <svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)}></div>
                    <div className="absolute top-full left-0 right-0 mt-2 bg-[#1a1f2e] border border-border rounded-lg shadow-2xl z-50 overflow-hidden max-h-60 overflow-y-auto">
                        {options.map(option => (
                            <button
                                key={option.id}
                                className={`w-full text-left px-4 py-3 text-sm hover:bg-white/10 transition-colors ${value === option.id ? 'bg-plex/10 text-plex font-bold' : 'text-text'}`}
                                onClick={() => {
                                    onChange(option.id);
                                    setIsOpen(false);
                                }}
                            >
                                {option.name}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

export const StatusDashboard: React.FC<{ onBack: () => void, isAdmin: boolean, isPublic?: boolean }> = ({ onBack, isAdmin, isPublic }) => {
    const { t } = useDiscoverI18n();
    const [statusData, setStatusData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
    const [activeTab, setActiveTab] = useState<'overview' | 'history' | 'analytics'>('overview');
    const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
    const [period, setPeriod] = useState<StatusPeriod>('90d');

    const displayStatus = (value: string) => ({
        online: t('statusPage.status.online'),
        degraded: t('statusPage.status.degraded'),
        offline: t('statusPage.status.offline'),
        unknown: t('statusPage.status.unknown'),
    }[value] || t('statusPage.status.unknown'));

    const fetchStatus = useCallback(async () => {
        try {
            const data = await apiFetch('/api/status');
            setStatusData(data);
            setHasError(false);
        } catch (e) {
            console.error(e);
            setHasError(true);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        void fetchStatus();
    }, [fetchStatus]);

    usePoll(() => { void fetchStatus(); }, 15_000);

    useEffect(() => {
        if (statusData && !selectedServiceId) {
            const nextServices = statusData.config?.services || [];
            if (nextServices.length > 0) {
                setSelectedServiceId(nextServices[0].id);
            }
        }
    }, [statusData, selectedServiceId]);

    if (isLoading || !statusData) {
        return (
            <DashboardPageShell>
                <DashboardHero
                    accent="emerald"
                    eyebrow={t('statusPage.page.eyebrow')}
                    title={t('statusPage.page.title')}
                    description={t('statusPage.page.description')}
                    icon={<Activity className="h-3.5 w-3.5" />}
                    actions={isPublic ? (
                        <button
                            type="button"
                            onClick={onBack}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-white/5 hover:text-text"
                        >
                            <ChevronLeft className="h-4 w-4" /> {t('common.back')}
                        </button>
                    ) : undefined}
                />
                {hasError ? (
                    <div className="rounded-2xl border border-white/10 bg-black/25 p-8 text-center">
                        <p className="text-status-expired mb-4">{t('statusPage.errors.loadFailed')}</p>
                        <button type="button" onClick={() => void fetchStatus()} className="rounded-xl bg-plex px-4 py-2 font-bold text-background">
                            {t('common.retry')}
                        </button>
                    </div>
                ) : (
                    <Loader isLoading={true} />
                )}
            </DashboardPageShell>
        );
    }

    const { config, healthData } = statusData;
    const services = config?.services || [];
    const groups = config?.groups || [];
    const serviceIds = services.map((s: any) => s.id);
    const statusCounts = services.reduce((acc: any, service: any) => {
        const status = healthData[service.id]?.currentStatus || 'unknown';
        acc.total += 1;
        acc[status] = (acc[status] || 0) + 1;
        return acc;
    }, { total: 0, online: 0, degraded: 0, offline: 0, unknown: 0 });
    const fleetPct = fleetUptimeForPeriod(healthData, serviceIds, period);
    const periodLabel = STATUS_PERIODS.find((p) => p.id === period)?.label || period;
    const selectedService = services.find((s: any) => s.id === selectedServiceId) || services[0];
    const selectedHealth = selectedService ? healthData[selectedService.id] : null;
    const selectedStats = periodStats(selectedHealth, period);
    const selectedBars = barsForPeriod(selectedHealth, period);
    const selectedLatencySeries = latencySeriesForPeriod(selectedHealth, period);
    const knownGroupIds = new Set((groups || []).map((group: any) => String(group?.id ?? '')));
    const ungroupedServices = (services || []).filter((service: any) => {
        const groupId = service?.groupId;
        if (groupId == null || groupId === '') return true;
        return !knownGroupIds.has(String(groupId));
    });
    const overviewGroups = [
        ...(Array.isArray(groups) ? groups : []),
        ...(ungroupedServices.length
            ? [{ id: '__ungrouped__', name: t('statusPage.labels.ungrouped'), order: 9999 }]
            : []),
    ];

    const barClassForTone = (tone: string) => {
        if (tone === 'online') return 'bg-status-active hover:shadow-[0_0_8px_rgba(35,134,54,0.6)]';
        if (tone === 'offline') return 'bg-status-expired hover:shadow-[0_0_8px_rgba(218,54,51,0.6)]';
        if (tone === 'degraded') return 'bg-status-expiring hover:shadow-[0_0_8px_rgba(210,153,34,0.6)]';
        return 'bg-border';
    };

    const heightForTone = (tone: string) => {
        if (tone === 'online') return 'h-full';
        if (tone === 'degraded') return 'h-2/3';
        if (tone === 'offline') return 'h-1/3';
        return 'h-1/5';
    };

    const statusTabs = [
        { id: 'overview' as const, label: t('statusPage.tabs.overview'), icon: Monitor },
        { id: 'history' as const, label: t('statusPage.tabs.history'), icon: Clock },
        { id: 'analytics' as const, label: t('statusPage.tabs.analytics'), icon: LucideLineChart },
    ];

    return (
        <DashboardPageShell>
            <DashboardHero
                accent="emerald"
                eyebrow={t('statusPage.page.eyebrow')}
                title={t('statusPage.page.title')}
                description={(
                    <>
                        {t('statusPage.summary.online', { online: statusCounts.online, total: statusCounts.total })}
                        {statusCounts.offline > 0 ? (
                            <span className="text-status-expired"> · {t('statusPage.summary.offline', { count: statusCounts.offline })}</span>
                        ) : null}
                        {' · '}{t('statusPage.summary.fleetUptime', { period: periodLabel, value: fleetPct.toFixed(1) })}
                    </>
                )}
                icon={<Activity className="h-3.5 w-3.5" />}
                secondaryBlob
                actions={(
                    <>
                        {isPublic ? (
                            <button
                                type="button"
                                onClick={onBack}
                                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-white/5 hover:text-text"
                            >
                                <ChevronLeft className="h-4 w-4" /> {t('statusPage.actions.back')}
                            </button>
                        ) : null}
                        <div className="flex flex-wrap gap-1 rounded-xl border border-white/10 bg-black/20 p-1">
                            {STATUS_PERIODS.map((p) => (
                                <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => setPeriod(p.id)}
                                    className={`rounded-lg px-3.5 py-2 text-xs font-bold uppercase tracking-wider transition-all border-none outline-none cursor-pointer ${
                                        period === p.id ? 'bg-plex text-background shadow-md shadow-plex/25' : 'bg-transparent text-muted hover:text-text hover:bg-white/5'
                                    }`}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={() => void fetchStatus()}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-white/5 hover:text-text"
                        >
                            <RefreshCw className="h-4 w-4" /> {t('statusPage.actions.refresh')}
                        </button>
                    </>
                )}
            />

            <div className="md:hidden">
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-muted">
                    {t('statusPage.labels.section')}
                </label>
                <CustomSelect
                    id="status-section-select"
                    value={activeTab}
                    onChange={(val) => setActiveTab(val as typeof activeTab)}
                    options={statusTabs.map((tab) => {
                        const Icon = tab.icon;
                        return {
                            label: tab.label,
                            value: tab.id,
                            icon: <Icon className="h-4 w-4" />,
                        };
                    })}
                />
            </div>

            <DashboardSubnav className="mb-1">
                {statusTabs.map((tab) => {
                    const Icon = tab.icon;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap transition-colors border-none outline-none cursor-pointer ${dashboardSubnavLinkClass(activeTab === tab.id)}`}
                        >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span>{tab.label}</span>
                        </button>
                    );
                })}
            </DashboardSubnav>

            <main className="user-content">
                {activeTab === 'overview' && (
                    <>
                        <div className="mb-6 grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-5">
                            <DashboardStatCard
                                label={t('statusPage.labels.services')}
                                value={statusCounts.total}
                                icon={<Monitor className="h-4 w-4 text-sky-300" />}
                                glow={dashboardGlowClass('sky')}
                            />
                            <DashboardStatCard
                                label={t('statusPage.status.online')}
                                value={statusCounts.online}
                                icon={<CheckCircle className="h-4 w-4 text-emerald-300" />}
                                glow={dashboardGlowClass('emerald')}
                                valueClassName="text-status-active"
                            />
                            <DashboardStatCard
                                label={t('statusPage.status.degraded')}
                                value={statusCounts.degraded}
                                icon={<AlertTriangle className="h-4 w-4 text-amber-300" />}
                                glow={dashboardGlowClass('amber')}
                                valueClassName="text-status-expiring"
                            />
                            <DashboardStatCard
                                label={t('statusPage.status.offline')}
                                value={statusCounts.offline}
                                icon={<AlertCircle className="h-4 w-4 text-rose-300" />}
                                glow={dashboardGlowClass('rose')}
                                valueClassName="text-status-expired"
                            />
                            <DashboardStatCard
                                label={t('statusPage.labels.periodUptime', { period: periodLabel })}
                                value={`${fleetPct.toFixed(1)}%`}
                                icon={<TrendingUp className="h-4 w-4 text-plex" />}
                                glow={dashboardGlowClass('plex')}
                                valueClassName="text-plex"
                            />
                        </div>

                        {!isPublic && <StatusSpeedTest />}

                        {config.announcement && config.announcement.enabled && (
                            <div className="status-announcement">
                                {config.announcement.message}
                            </div>
                        )}

                        {groups.length === 0 && (
                            <DashboardPanel title={t('statusPage.empty.noServicesTitle')} subtitle={t('statusPage.empty.noServicesSubtitle')}>
                                <div className="flex flex-col items-center justify-center p-8 text-center">
                                    <Activity className="mb-4 h-12 w-12 text-muted opacity-50" />
                                    <p className="max-w-md text-muted">
                                        {t('statusPage.empty.blank')}
                                        {isAdmin ? (
                                            <>
                                                {' '}{t('statusPage.empty.adminHint')}
                                            </>
                                        ) : (
                                            <>
                                                {' '}{t('statusPage.empty.memberHint')}
                                            </>
                                        )}
                                    </p>
                                </div>
                            </DashboardPanel>
                        )}

                        {overviewGroups.map((group: any) => {
                            const groupServices = group.id === '__ungrouped__'
                                ? ungroupedServices
                                : services.filter((s: any) => s.groupId === group.id);
                            if (groupServices.length === 0) return null;
                            return (
                                <DashboardPanel
                                    key={group.id}
                                    title={group.name}
                                    subtitle={t('statusPage.labels.groupSummary', { count: groupServices.length, period: periodLabel })}
                                    className="mb-6"
                                >
                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                                        {groupServices.map((service: any, index: number) => {
                                            const health = healthData[service.id] || { currentStatus: 'unknown', uptimePercentage: 100, dailyHistory: {} };
                                            const uptime = uptimeForPeriod(health, period);
                                            const bars = barsForPeriod(health, period);
                                            const latency = health.lastLatency;
                                            const avgLatency = periodStats(health, period).latency.avg;
                                            const rangeLeft = period === '24h'
                                                ? t('statusPage.relative.hoursAgo', { count: 24 })
                                                : period === '7d'
                                                    ? t('statusPage.relative.daysAgo', { count: 7 })
                                                    : period === '30d'
                                                        ? t('statusPage.relative.daysAgo', { count: 30 })
                                                        : t('statusPage.relative.daysAgo', { count: 90 });
                                            return (
                                                <div key={service.id} className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/20 p-4 md:p-5 flex flex-col gap-4 animate-fade-in transition-all duration-300 hover:-translate-y-0.5 hover:border-emerald-400/25 hover:shadow-lg hover:shadow-emerald-500/5" style={{ animationFillMode: 'both', animationDelay: `${index * 75}ms` }}>
                                                    <div className="flex justify-between items-start mb-2 gap-3">
                                                        <div className="flex items-start gap-3 min-w-0 flex-1">
                                                            <StatusServiceIcon service={service} />
                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                                                    <h4 className="font-bold text-text text-lg leading-tight break-words" title={service.name}>{service.name}</h4>
                                                                    {isAdmin && service.visibleToUsers === false ? (
                                                                        <span className="rounded-full border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] font-semibold text-muted" title={t('statusPage.labels.adminOnlyHint')}>
                                                                            {t('statusPage.labels.adminOnly')}
                                                                        </span>
                                                                    ) : null}
                                                                </div>
                                                                {service.description && <p className="text-xs text-muted mt-0.5 line-clamp-2">{service.description}</p>}
                                                            </div>
                                                        </div>
                                                        <span className={`shrink-0 px-3 py-1 rounded-full text-[0.65rem] uppercase tracking-wider font-bold border flex items-center gap-1.5 shadow-lg transition-all duration-300 ${health.currentStatus === 'online' ? 'bg-status-active/10 text-status-active border-status-active/30 shadow-[0_0_10px_rgba(35,134,54,0.3)]' : health.currentStatus === 'offline' ? 'bg-status-expired/10 text-[#D32F2F] border-[#D32F2F]/30 shadow-[0_0_10px_rgba(211,47,47,0.3)] animate-pulse' : 'bg-status-expiring/10 text-status-expiring border-status-expiring/30 shadow-[0_0_10px_rgba(210,153,34,0.3)]'}`}>
                                                            {health.currentStatus === 'online' && <span className="w-1.5 h-1.5 rounded-full bg-status-active animate-pulse shadow-[0_0_5px_rgba(35,134,54,0.8)]" />}
                                                            {health.currentStatus === 'offline' && <span className="w-1.5 h-1.5 rounded-full bg-[#D32F2F] animate-ping" />}
                                                            {health.currentStatus === 'degraded' && <span className="w-1.5 h-1.5 rounded-full bg-status-expiring animate-pulse shadow-[0_0_5px_rgba(210,153,34,0.8)]" />}
                                                            {displayStatus(health.currentStatus || 'unknown')}
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted font-medium">
                                                        <span>{t('statusPage.labels.uptimeValue', { period: periodLabel, value: uptime.pct.toFixed(1) })}</span>
                                                        <span>{t('statusPage.labels.latencyValue', { value: formatLatencyMs(latency) })}
                                                            {avgLatency != null && <span className="text-muted font-normal"> {t('statusPage.labels.average', { value: formatLatencyMs(avgLatency) })}</span>}
                                                        </span>
                                                    </div>
                                                    <div className="flex gap-[2px] h-12 mt-auto items-end pt-4 group/bars relative">
                                                        {bars.map((bar, i) => {
                                                            const tone = statusToneFromPct(bar.pct);
                                                            const title = bar.pct == null
                                                                ? `${bar.label}: ${t('statusPage.empty.noData')}`
                                                                : `${bar.label}: ${bar.pct.toFixed(1)}% ${t('statusPage.analytics.uptime')}${bar.avgLatency != null ? ` · ${formatLatencyMs(bar.avgLatency)} ${t('statusPage.labels.average')}` : ''}`;
                                                            return (
                                                                <div
                                                                    key={bar.key}
                                                                    className={`flex-1 rounded-sm transition-all duration-300 hover:opacity-100 opacity-60 cursor-pointer animate-fade-in ${barClassForTone(tone)} ${heightForTone(tone)}`}
                                                                    style={{ animationFillMode: 'both', animationDelay: `${Math.min(i, 40) * 10}ms` }}
                                                                    title={title}
                                                                />
                                                            );
                                                        })}
                                                    </div>
                                                    <div className="flex justify-between text-[10px] text-muted font-bold tracking-wider mt-1 opacity-50 uppercase">
                                                        <span>{rangeLeft}</span>
                                                        <span className="text-center flex-1 tabular-nums">{uptime.pct.toFixed(1)}%</span>
                                                        <span>Now</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </DashboardPanel>
                            );
                        })}
                    </>
                )}

                {activeTab === 'history' && (
                    <div className="flex flex-col gap-6 animate-fade-in">
                        {services.map((service: any) => {
                            const health = healthData[service.id];
                            const rows = historyRowsForPeriod(health, period);
                            const incidents = incidentsForPeriod(health, period);
                            return (
                                <DashboardPanel
                                    key={service.id}
                                    title={service.name}
                                    subtitle={t('statusPage.history.subtitle', { period: periodLabel })}
                                    badge={(
                                        <div className="flex items-center gap-2">
                                            {isAdmin && service.visibleToUsers === false ? (
                                                <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted" title={t('statusPage.labels.adminOnlyHint')}>
                                                    {t('statusPage.labels.adminOnly')}
                                                </span>
                                            ) : null}
                                            <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted">
                                                {periodLabel}
                                            </span>
                                        </div>
                                    )}
                                >
                                    <div className="overflow-x-auto rounded-xl border border-white/5">
                                        <table className="w-full text-left border-collapse">
                                            <thead className="bg-black/40 border-b border-border text-muted text-xs uppercase tracking-wider">
                                                <tr>
                                                    <th className="px-6 py-4 font-bold whitespace-nowrap">{period === '24h' || period === '7d' ? t('statusPage.history.hourUtc') : t('statusPage.history.date')}</th>
                                                    <th className="px-6 py-4 font-bold whitespace-nowrap">{t('statusPage.history.uptimePercent')}</th>
                                                    <th className="px-6 py-4 font-bold whitespace-nowrap">{t('statusPage.history.checks')}</th>
                                                    {(period === '24h' || period === '7d') && (
                                                        <th className="px-6 py-4 font-bold whitespace-nowrap">{t('statusPage.history.averageLatency')}</th>
                                                    )}
                                                    <th className="px-6 py-4 font-bold text-right whitespace-nowrap">{t('statusPage.history.status')}</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border/50">
                                                {rows.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={period === '24h' || period === '7d' ? 5 : 4} className="px-6 py-8 text-center text-muted text-sm">
                                                            {t('statusPage.empty.noHistory')}
                                                        </td>
                                                    </tr>
                                                ) : rows.map((row) => {
                                                    const tone = statusToneFromPct(row.pct);
                                                    return (
                                                        <tr key={row.key} className="hover:bg-white/5 transition-colors">
                                                            <td className="px-6 py-4 font-medium whitespace-nowrap text-text">{row.label}</td>
                                                            <td className="px-6 py-4 font-mono whitespace-nowrap text-muted">{row.pct.toFixed(2)}%</td>
                                                            <td className="px-6 py-4 text-muted text-sm whitespace-nowrap">{row.up} / {row.total} checks</td>
                                                            {(period === '24h' || period === '7d') && (
                                                                <td className="px-6 py-4 text-muted text-sm whitespace-nowrap tabular-nums">{formatLatencyMs(row.avgLatency)}</td>
                                                            )}
                                                            <td className="px-6 py-4 text-right whitespace-nowrap">
                                                                <span className={`px-2.5 py-1 rounded-full text-[10px] uppercase font-bold tracking-widest border ${tone === 'online' ? 'bg-status-active/10 text-status-active border-status-active/30' : tone === 'degraded' ? 'bg-status-expiring/10 text-status-expiring border-status-expiring/30' : tone === 'offline' ? 'bg-status-expired/10 text-status-expired border-status-expired/30' : 'bg-white/5 text-muted border-border'}`}>
                                                                    {tone === 'online' ? t('statusPage.status.healthy') : tone === 'degraded' ? t('statusPage.status.degraded') : tone === 'offline' ? t('statusPage.status.outage') : t('statusPage.status.unknown')}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="border-t border-border/50 p-4 bg-black/10">
                                        <h4 className="text-xs font-bold uppercase tracking-widest text-muted mb-3">{t('statusPage.incidents.title', { period: periodLabel })}</h4>
                                        {incidents.length === 0 ? (
                                            <p className="text-sm text-muted">{t('statusPage.empty.noIncidents')}</p>
                                        ) : (
                                            <div className="overflow-x-auto">
                                                <table className="w-full text-left border-collapse text-sm">
                                                    <thead className="text-muted text-[10px] uppercase tracking-wider">
                                                        <tr>
                                                            <th className="pb-2 pr-4 font-bold">{t('statusPage.incidents.started')}</th>
                                                            <th className="pb-2 pr-4 font-bold">{t('statusPage.incidents.ended')}</th>
                                                            <th className="pb-2 pr-4 font-bold">{t('statusPage.incidents.duration')}</th>
                                                            <th className="pb-2 font-bold text-right">{t('statusPage.incidents.severity')}</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-border/40">
                                                        {incidents.map((incident) => {
                                                            const duration = incident.endedAt != null
                                                                ? (incident.durationMs ?? Math.max(0, incident.endedAt - incident.startedAt))
                                                                : Math.max(0, Date.now() - incident.startedAt);
                                                            const severityTone = incident.to === 'offline' ? 'offline' : 'degraded';
                                                            const severity = severityTone === 'offline' ? t('statusPage.status.offline') : t('statusPage.status.degraded');
                                                            return (
                                                                <tr key={incident.id}>
                                                                    <td className="py-2.5 pr-4 text-text whitespace-nowrap">{formatDateTime(new Date(incident.startedAt).toISOString())}</td>
                                                                    <td className="py-2.5 pr-4 text-muted whitespace-nowrap">{incident.endedAt != null ? formatDateTime(new Date(incident.endedAt).toISOString()) : t('statusPage.incidents.ongoing')}</td>
                                                                    <td className="py-2.5 pr-4 text-muted tabular-nums">{formatDurationShort(duration)}</td>
                                                                    <td className="py-2.5 text-right">
                                                                        <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-widest border ${severityTone === 'offline' ? 'bg-status-expired/10 text-status-expired border-status-expired/30' : 'bg-status-expiring/10 text-status-expiring border-status-expiring/30'}`}>
                                                                            {severity}
                                                                        </span>
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                </DashboardPanel>
                            );
                        })}
                    </div>
                )}

                {activeTab === 'analytics' && (
                    <div className="flex flex-col gap-6 animate-fade-in">
                        {services.length > 1 && (
                            <div className="flex flex-wrap gap-2 rounded-xl border border-white/10 bg-black/20 p-1">
                                {services.map((service: any) => (
                                    <button
                                        key={service.id}
                                        type="button"
                                        onClick={() => setSelectedServiceId(service.id)}
                                        className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors border-none outline-none cursor-pointer ${
                                            selectedService?.id === service.id
                                                ? 'bg-plex text-background shadow-md shadow-plex/25'
                                                : 'bg-transparent text-muted hover:bg-white/5 hover:text-text'
                                        }`}
                                    >
                                        {service.name}
                                    </button>
                                ))}
                            </div>
                        )}

                        {selectedService && (
                            <>
                                <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
                                    <DashboardStatCard label={t('statusPage.analytics.uptime')} value={`${selectedStats.pct.toFixed(2)}%`} icon={<TrendingUp className="h-4 w-4 text-emerald-300" />} glow={dashboardGlowClass('emerald')} />
                                    <DashboardStatCard label={t('statusPage.analytics.checks')} value={selectedStats.total.toLocaleString()} icon={<Activity className="h-4 w-4 text-sky-300" />} glow={dashboardGlowClass('sky')} />
                                    <DashboardStatCard label={t('statusPage.analytics.averageLatency')} value={formatLatencyMs(selectedStats.latency.avg)} icon={<Clock className="h-4 w-4 text-plex" />} glow={dashboardGlowClass('plex')} />
                                    <DashboardStatCard label={t('statusPage.analytics.p95Latency')} value={formatLatencyMs(selectedStats.latency.p95)} icon={<Clock className="h-4 w-4 text-violet-300" />} glow={dashboardGlowClass('violet')} />
                                    <DashboardStatCard label={t('statusPage.analytics.incidents')} value={String(selectedStats.incidentCount)} icon={<AlertTriangle className="h-4 w-4 text-amber-300" />} glow={dashboardGlowClass('amber')} />
                                    <DashboardStatCard label={t('statusPage.analytics.longestOutage')} value={formatDurationShort(selectedStats.longestOutageMs)} icon={<AlertCircle className="h-4 w-4 text-rose-300" />} glow={dashboardGlowClass('rose')} />
                                    <DashboardStatCard label={t('statusPage.analytics.healthyStreak')} value={selectedStats.currentStreakHours ? `${selectedStats.currentStreakHours}h` : '—'} icon={<CheckCircle className="h-4 w-4 text-emerald-300" />} glow={dashboardGlowClass('emerald')} />
                                    <DashboardStatCard label={t('statusPage.analytics.worstDay')} value={selectedStats.worstDay ? `${selectedStats.worstDay.pct.toFixed(1)}%` : '—'} icon={<Calendar className="h-4 w-4 text-muted" />} glow={dashboardGlowClass('muted')} />
                                </div>

                                <DashboardPanel
                                    title={t('statusPage.analytics.uptimeTrend', { name: selectedService.name })}
                                    subtitle={t('statusPage.analytics.rollingUptime', { period: periodLabel })}
                                >
                                    <div className="relative h-64 md:h-80 flex items-end gap-1 w-full pl-12 pr-4 md:pr-8">
                                        <div className="absolute inset-0 pl-12 pr-4 md:pr-8 flex flex-col justify-between pointer-events-none pb-8">
                                            {['100%', '75%', '50%', '25%', '0%'].map((label) => (
                                                <div key={label} className={`w-full border-t ${label === '0%' ? 'border-white/20' : 'border-white/5'} h-0 relative`}>
                                                    <span className="absolute -left-12 -top-2.5 text-xs font-mono text-muted/50 w-10 text-right">{label}</span>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="w-full h-full flex items-end gap-[2px] pb-8 z-10">
                                            {selectedBars.map((bar) => {
                                                const pct = bar.pct ?? 0;
                                                const hasData = bar.pct != null && bar.total > 0;
                                                return (
                                                    <div key={bar.key} className="flex-1 flex flex-col justify-end h-full relative group/chart cursor-crosshair">
                                                        <div
                                                            className={`w-full rounded-t-sm transition-all duration-300 opacity-80 group-hover/chart:opacity-100 ${
                                                                !hasData ? 'bg-white/10' : pct >= 99 ? 'bg-status-active' : pct >= 90 ? 'bg-status-expiring' : 'bg-status-expired'
                                                            }`}
                                                            style={{ height: `${Math.max(1, hasData ? pct : 1)}%` }}
                                                        />
                                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 p-3 bg-card border border-border shadow-2xl text-white text-xs rounded-lg whitespace-nowrap opacity-0 group-hover/chart:opacity-100 pointer-events-none transition-opacity z-50 flex flex-col items-center">
                                                            <strong className="text-plex mb-1 tracking-wider uppercase text-[10px]">{bar.label}</strong>
                                                            <span className="text-lg font-mono font-bold">{hasData ? `${pct.toFixed(2)}%` : t('statusPage.empty.noData')}</span>
                                                            {bar.avgLatency != null && (
                                                                <span className="text-muted mt-0.5">{t('statusPage.labels.average', { value: formatLatencyMs(bar.avgLatency) })}</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <div className="flex justify-between px-12 text-[10px] font-bold uppercase tracking-widest text-muted mt-2">
                                        <span>{period === '24h' ? t('statusPage.relative.hoursAgo', { count: 24 }) : t('statusPage.relative.periodAgo', { period: periodLabel })}</span>
                                        <span>{t('statusPage.relative.now')}</span>
                                    </div>
                                </DashboardPanel>

                                <DashboardPanel
                                    title={t('statusPage.analytics.latencyTitle', { name: selectedService.name })}
                                    subtitle={t('statusPage.analytics.averageResponseTime', { period: periodLabel })}
                                >
                                    {selectedLatencySeries.some((p) => p.avg != null) ? (
                                        <div className="h-56 md:h-72 w-full">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <AreaChart data={selectedLatencySeries.filter((p) => p.avg != null)} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                                                    <XAxis dataKey="label" tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} interval="preserveStartEnd" minTickGap={28} />
                                                    <YAxis tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} width={48} tickFormatter={(v) => `${v}ms`} />
                                                    <RechartsTooltip
                                                        contentStyle={{ background: 'var(--card, #1a1a1a)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
                                                        labelStyle={{ color: '#e5a00d' }}
                                                        formatter={(value: any) => [formatLatencyMs(Number(value)), t('statusPage.analytics.averageLatency')]}
                                                    />
                                                    <Area type="monotone" dataKey="avg" stroke="#e5a00d" fill="rgba(229,160,13,0.2)" strokeWidth={2} />
                                                </AreaChart>
                                            </ResponsiveContainer>
                                        </div>
                                    ) : (
                                        <p className="text-center text-muted text-sm py-12">
                                            {t('statusPage.empty.latencyHistory')}
                                        </p>
                                    )}
                                    {selectedStats.bestDay && selectedStats.worstDay && period !== '24h' && (
                                        <div className="mt-6 flex flex-wrap justify-center gap-6 text-sm text-muted">
                                            <span>{t('statusPage.analytics.best', { value: selectedStats.bestDay.key, pct: selectedStats.bestDay.pct.toFixed(1) })}</span>
                                            <span>{t('statusPage.analytics.worst', { value: selectedStats.worstDay.key, pct: selectedStats.worstDay.pct.toFixed(1) })}</span>
                                        </div>
                                    )}
                                </DashboardPanel>
                            </>
                        )}
                    </div>
                )}
            </main>
        </DashboardPageShell>
    );
};
const StreamSpecCard: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1.5">{label}</p>
        {children}
    </div>
);

const DashboardTitleLink: React.FC<{
    ratingKey?: string | null;
    onOpen?: (ratingKey: string) => void;
    className?: string;
    children: React.ReactNode;
}> = ({ ratingKey, onOpen, className = '', children }) => {
    const key = String(ratingKey || '').trim();
    if (!key || !onOpen) {
        return <span className={className}>{children}</span>;
    }
    return (
        <button
            type="button"
            onClick={(event) => {
                event.stopPropagation();
                onOpen(key);
            }}
            className={`block max-w-full text-left ${className} hover:text-plex`.trim()}
        >
            {children}
        </button>
    );
};

const StreamDetailsModal: React.FC<{ session: any, onClose: () => void, isAdmin?: boolean, onKilled?: () => void, providerLabel?: string, onOpenProfile?: (accountId: string) => void, onOpenTitle?: (ratingKey: string) => void }> = ({ session, onClose, isAdmin, onKilled, providerLabel = 'Plex', onOpenProfile, onOpenTitle }) => {
    const [killReason, setKillReason] = useState('');
    const [isKilling, setIsKilling] = useState(false);
    const [showKillConfirm, setShowKillConfirm] = useState(false);
    const sessionPosterSrc = session.thumbUrl
        ? resolvePortalAssetUrl(session.thumbUrl)
        : (session.thumb
            ? portalUrl(`/api/plex/image?path=${encodeURIComponent(session.thumb)}&width=400&height=600`)
            : '');
    const sessionFallbackPosterSrc = session.posterFallbackUrl ? resolvePortalAssetUrl(session.posterFallbackUrl) : '';
    const sessionUserThumbSrc = session.userThumb ? resolvePortalAssetUrl(session.userThumb) : 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
    const geo = isAdmin && session.geo && Number.isFinite(Number(session.geo.latitude)) && Number.isFinite(Number(session.geo.longitude))
        ? session.geo
        : null;
    const geoLat = geo ? Number(geo.latitude) : NaN;
    const geoLon = geo ? Number(geo.longitude) : NaN;
    const mapPad = 0.35;
    const osmEmbedUrl = geo
        ? `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(
            `${geoLon - mapPad},${geoLat - mapPad},${geoLon + mapPad},${geoLat + mapPad}`,
        )}&layer=mapnik&marker=${encodeURIComponent(`${geoLat},${geoLon}`)}`
        : '';
    const googleMapsUrl = geo
        ? `https://www.google.com/maps?q=${encodeURIComponent(`${geoLat},${geoLon}`)}`
        : '';

    // Lock background scroll while the sheet is open (esp. important on mobile).
    useEffect(() => {
        const scrollY = window.scrollY;
        const { body, documentElement } = document;
        const prev = {
            overflow: body.style.overflow,
            position: body.style.position,
            top: body.style.top,
            left: body.style.left,
            right: body.style.right,
            width: body.style.width,
            htmlOverflow: documentElement.style.overflow,
        };
        body.style.overflow = 'hidden';
        body.style.position = 'fixed';
        body.style.top = `-${scrollY}px`;
        body.style.left = '0';
        body.style.right = '0';
        body.style.width = '100%';
        documentElement.style.overflow = 'hidden';
        return () => {
            body.style.overflow = prev.overflow;
            body.style.position = prev.position;
            body.style.top = prev.top;
            body.style.left = prev.left;
            body.style.right = prev.right;
            body.style.width = prev.width;
            documentElement.style.overflow = prev.htmlOverflow;
            window.scrollTo(0, scrollY);
        };
    }, []);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const showTitle = session.grandparentTitle || session.title;
    const episodeLine = session.grandparentTitle
        ? [
            session.title,
            session.type === 'episode' && session.season !== undefined
                ? `S${String(session.season).padStart(2, '0')}E${String(session.episode).padStart(2, '0')}`
                : null,
        ].filter(Boolean).join(' · ')
        : (session.type === 'episode' && session.season !== undefined
            ? `S${String(session.season).padStart(2, '0')}E${String(session.episode).padStart(2, '0')}`
            : '');
    const progressPct = Math.min(100, Math.max(0, Number(session.progress) || 0));
    const resolutionLabel = session.resolution
        ? (String(session.resolution).includes('p') || String(session.resolution).includes('k')
            ? String(session.resolution).toUpperCase()
            : `${session.resolution}p`)
        : null;
    const isLocal = session.sessionLocation === 'lan';
    const bandwidthLabel = Number.isFinite(Number(session.bandwidth))
        ? `${(Number(session.bandwidth) / 1000).toFixed(1)} Mbps`
        : null;

    const handleKill = async () => {
        setIsKilling(true);
        try {
            const res = await apiFetch('/api/streams/kill', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: session.sessionId, reason: killReason })
            });
            if (res.error) {
                alert(res.error);
            } else {
                onClose();
                if (onKilled) onKilled();
            }
        } catch (e: any) {
            alert('Failed to kill stream');
        } finally {
            setIsKilling(false);
        }
    };

    return ReactDOM.createPortal(
        <div
            className="fixed inset-x-0 top-0 z-[300] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm animate-fade-in overscroll-none bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] sm:inset-0 sm:bottom-0"
            onClick={onClose}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="stream-details-title"
                className="relative w-full sm:max-w-2xl lg:max-w-3xl max-h-full sm:max-h-[85vh] bg-card border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden overscroll-contain"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start gap-4 p-5 border-b border-white/10 bg-black/20 shrink-0">
                    <div className="w-[4.5rem] h-[6.75rem] sm:w-24 sm:h-36 rounded-xl overflow-hidden flex-shrink-0 bg-black/40 border border-white/10 shadow-lg">
                        {sessionPosterSrc || sessionFallbackPosterSrc ? (
                            <RetryablePoster
                                src={sessionPosterSrc}
                                fallbackSrc={sessionFallbackPosterSrc}
                                alt=""
                                compactPlaceholder
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <NoPosterPlaceholder compact />
                        )}
                    </div>

                    <div className="min-w-0 flex-1 pt-0.5">
                        {session.user && (
                            session.accountId && onOpenProfile ? (
                            <button
                                type="button"
                                onClick={() => onOpenProfile(String(session.accountId))}
                                className="inline-flex items-center gap-2 mb-2 rounded-full border border-white/10 bg-white/5 pl-1 pr-2.5 py-1 hover:border-plex/40"
                            >
                                <img
                                    src={sessionUserThumbSrc}
                                    alt=""
                                    className="w-5 h-5 rounded-full object-cover"
                                    onError={(e) => { e.currentTarget.src = 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y'; }}
                                />
                                <span className="text-[11px] font-bold text-white/80 truncate max-w-[10rem]">{session.user}</span>
                            </button>
                            ) : (
                            <div className="inline-flex items-center gap-2 mb-2 rounded-full border border-white/10 bg-white/5 pl-1 pr-2.5 py-1">
                                <img
                                    src={sessionUserThumbSrc}
                                    alt=""
                                    className="w-5 h-5 rounded-full object-cover"
                                    onError={(e) => { e.currentTarget.src = 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y'; }}
                                />
                                <span className="text-[11px] font-bold text-white/80 truncate max-w-[10rem]">{session.user}</span>
                            </div>
                            )
                        )}
                        <h2 id="stream-details-title" className="text-xl sm:text-2xl font-black text-text leading-tight tracking-tight">
                            <DashboardTitleLink
                                ratingKey={session.grandparentTitle ? session.grandparentRatingKey : session.ratingKey}
                                onOpen={onOpenTitle}
                                className="text-left"
                            >
                                {showTitle}
                            </DashboardTitleLink>
                        </h2>
                        {episodeLine ? (
                            <p className="text-sm text-muted mt-1 leading-snug">
                                <DashboardTitleLink ratingKey={session.ratingKey} onOpen={onOpenTitle} className="text-left">
                                    {episodeLine}
                                </DashboardTitleLink>
                            </p>
                        ) : null}

                        <div className="flex flex-wrap gap-1.5 mt-3">
                            {resolutionLabel && (
                                <span className="text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wide bg-white/10 text-white/80 border border-white/10">
                                    {resolutionLabel}
                                </span>
                            )}
                            <span className={`text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wide border ${
                                isLocal
                                    ? 'bg-status-active/15 text-status-active border-status-active/25'
                                    : 'bg-plex/15 text-plex border-plex/30'
                            }`}>
                                {isLocal ? 'Local' : 'Remote'}
                            </span>
                            <span className={`text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wide border ${
                                session.isTranscoding
                                    ? 'bg-status-expiring/15 text-status-expiring border-status-expiring/25'
                                    : 'bg-status-active/15 text-status-active border-status-active/25'
                            }`}>
                                {session.isTranscoding ? 'Transcode' : 'Direct Play'}
                            </span>
                            {session.state && session.state !== 'playing' && (
                                <span className="text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wide bg-white/10 text-white/70 border border-white/10">
                                    {session.state}
                                </span>
                            )}
                        </div>

                        {progressPct > 0 && (
                            <div className="mt-3.5 max-w-md">
                                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                                    <div className="h-full rounded-full bg-plex transition-all" style={{ width: `${progressPct}%` }} />
                                </div>
                                <p className="text-[10px] text-muted mt-1.5 font-medium">{Math.round(progressPct)}% watched</p>
                            </div>
                        )}
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 rounded-full hover:bg-white/10 text-white/45 hover:text-white transition-colors shrink-0"
                        aria-label="Close"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain custom-scrollbar p-5 flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-2.5">
                        {session.playerTitle ? (
                            <StreamSpecCard label="Player">
                                <p className="text-sm font-semibold text-text truncate" title={session.playerTitle}>{session.playerTitle}</p>
                                <p className="text-xs text-muted truncate mt-0.5" title={session.playerProduct}>{session.playerProduct || '—'}</p>
                            </StreamSpecCard>
                        ) : null}
                        <StreamSpecCard label="Network">
                            <p className="text-sm font-semibold text-text font-mono tracking-tight truncate">
                                {isAdmin ? (session.playerAddress || 'Unknown IP') : 'Hidden'}
                            </p>
                            {bandwidthLabel && <p className="text-xs text-muted mt-0.5 truncate">{bandwidthLabel}</p>}
                        </StreamSpecCard>
                        <StreamSpecCard label="Video">
                            <p className="text-sm font-semibold text-text uppercase tracking-wide truncate">
                                {session.videoCodec || 'Unknown'}
                                {session.videoProfile ? ` · ${session.videoProfile}` : ''}
                            </p>
                            {session.transcodeVideoDecision === 'transcode' && (
                                <p className="text-[10px] text-status-expiring font-bold mt-1">Transcoding</p>
                            )}
                        </StreamSpecCard>
                        <StreamSpecCard label="Audio">
                            <p className="text-sm font-semibold text-text uppercase tracking-wide truncate">
                                {session.audioCodec || 'Unknown'}
                                {session.audioChannels ? ` · ${session.audioChannels}ch` : ''}
                            </p>
                            {session.transcodeAudioDecision === 'transcode' && (
                                <p className="text-[10px] text-status-expiring font-bold mt-1">Transcoding</p>
                            )}
                        </StreamSpecCard>
                    </div>

                    {geo && osmEmbedUrl && (
                        <div className="rounded-xl overflow-hidden border border-white/10 bg-white/[0.03]">
                            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 border-b border-white/10">
                                <div className="min-w-0 flex items-center gap-2">
                                    <MapPin className="w-3.5 h-3.5 text-plex shrink-0" />
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-text truncate">{geo.label}</p>
                                        <p className="text-[10px] text-muted">Approximate location from IP</p>
                                    </div>
                                </div>
                                <a
                                    href={googleMapsUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-bold text-plex hover:text-plex-hover transition-colors"
                                >
                                    <ExternalLink className="w-3 h-3" />
                                    Google Maps
                                </a>
                            </div>
                            {/* Crop OSM’s dense attribution strip on small screens */}
                            <div className="relative w-full h-36 sm:h-44 overflow-hidden">
                                <iframe
                                    title={`Approximate location: ${geo.label}`}
                                    src={osmEmbedUrl}
                                    className="absolute inset-0 w-full h-[calc(100%+28px)] border-0"
                                    loading="lazy"
                                    referrerPolicy="no-referrer-when-downgrade"
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer sits above the mobile bottom nav (overlay stops above it) */}
                <div className="shrink-0 border-t border-white/10 bg-black/30 p-4 sm:p-5">
                    {isAdmin && session.sessionId && showKillConfirm ? (
                        <div className="flex flex-col gap-2 rounded-xl border border-red-500/25 bg-red-500/10 p-3">
                            <input
                                type="text"
                                placeholder="Reason (optional)"
                                value={killReason}
                                onChange={e => setKillReason(e.target.value)}
                                className="w-full bg-black/30 border border-red-500/30 rounded-lg px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:border-red-500"
                            />
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={handleKill}
                                    disabled={isKilling}
                                    className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold py-2.5 rounded-xl transition-colors text-sm disabled:opacity-50"
                                >
                                    {isKilling ? 'Terminating…' : 'Confirm terminate'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowKillConfirm(false)}
                                    className="px-4 bg-white/10 hover:bg-white/15 text-white font-bold py-2.5 rounded-xl transition-colors text-sm"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col sm:flex-row gap-2.5">
                            {isAdmin && session.sessionId && (
                                <button
                                    type="button"
                                    onClick={() => setShowKillConfirm(true)}
                                    className="w-full sm:flex-1 bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 font-bold py-3 rounded-xl transition-colors text-sm inline-flex items-center justify-center gap-2"
                                >
                                    <X className="w-4 h-4" /> Terminate Stream
                                </button>
                            )}
                            <a
                                href={session.plexUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="w-full sm:flex-1 bg-plex hover:bg-plex-hover text-background font-bold text-center py-3 rounded-xl transition-colors text-sm inline-flex items-center justify-center gap-2"
                            >
                                Open in {providerLabel}
                            </a>
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
};

const EMPTY_STREAM_MESSAGES = [
    "Nobody is watching... the server can finally breathe.",
    "0 streams active. The hard drives are enjoying a well-earned nap.",
    "The popcorn is ready. The audience is missing.",
    "All quiet on the streaming front.",
    "The server is awake. The humans are not.",
    "No one is streaming... the GPUs are confused.",
    "No streams detected. Suspicious behaviour.",
    "Everyone left. The server is binge-watching itself.",
    "No one is watching. Somewhere, a movie is feeling ignored.",
    "No active viewers. Time to dust off the virtual popcorn machine.",
    "The only thing streaming right now is disappointment.",
    "The server is ready. The couch is empty.",
    "The media centre is open 24/7. The viewers are not.",
    "The server has 10,000 movies and nobody pressed play.",
    "No active sessions. The bandwidth is feeling useless.",
    "The server is fully loaded and emotionally unavailable.",
    "The Plex goblins are idle.",
    "The server is bored. Please entertain it.",
    "No viewers detected. Initiating dramatic silence.",
    "The hard drives are spinning... for nothing.",
    "Even the thumbnails are getting lonely."
];

const EmptyStreamsMessage: React.FC = () => {
    const [msg] = useState(() => EMPTY_STREAM_MESSAGES[Math.floor(Math.random() * EMPTY_STREAM_MESSAGES.length)]);
    return <div className="text-center text-muted p-8 border border-dashed border-border rounded-xl mt-4 w-full">{msg}</div>;
};

type AdminOpsSnapshot = {
    checkedAt: number;
    fleetUptime24h: number | null;
    serviceCount: number;
    unhealthyCount: number;
    offlineCount: number;
    unhealthyNames: string[];
    requestPending: number;
    requestEngineConnected: boolean;
    notificationUnread: number;
    notificationTotal: number;
    failingJobs: number;
    runningJobs: number;
};

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
                                                            <span className={`font-bold text-right ${session.isTranscoding ? 'text-status-expiring' : 'text-status-active'}`}>
                                                                {session.isTranscoding ? 'Transcode' : 'Direct Play'}
                                                            </span>
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

export const MaintenanceDashboard: React.FC = () => {
    const { t } = useDiscoverI18n();
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [maintenanceFeatureEnabled, setMaintenanceFeatureEnabled] = useState(false);
    const [overview, setOverview] = useState<any>(null);
    const [runs, setRuns] = useState<any[]>([]);
    const [previewGroups, setPreviewGroups] = useState<any[]>([]);
    const [rules, setRules] = useState<any[]>([]);
    const [overviewInsights, setOverviewInsights] = useState<{
        totalMatches: number;
        uniqueMatches: number;
        estimatedReclaimGB: number;
        libraries: Array<{ libraryTitle: string; count: number; reclaimGB: number }>;
        rules: Array<{ ruleId: string; ruleName: string; totalMatches: number; reclaimGB: number }>;
    }>({
        totalMatches: 0,
        uniqueMatches: 0,
        estimatedReclaimGB: 0,
        libraries: [],
        rules: []
    });
    const [preferences, setPreferences] = useState<any>({
        global: { dryRunByDefault: true, maxActionsPerRun: 25, requireConfirmForDestructive: true },
        exclusions: { ratingKeys: [], titles: [], libraries: [] }
    });
    const [candidateRuleId, setCandidateRuleId] = useState<string>('');
    const [candidateItems, setCandidateItems] = useState<any[]>([]);
    const [candidateSearch, setCandidateSearch] = useState('');
    const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
    const [libraryJsonInput, setLibraryJsonInput] = useState('');
    const [libraryItems, setLibraryItems] = useState<any[]>([]);
    const [libraryOptions, setLibraryOptions] = useState<Array<{ id: string; title: string; count: number }>>([]);
    const [libraryBrowseId, setLibraryBrowseId] = useState('all');
    const [libraryBrowseSearch, setLibraryBrowseSearch] = useState('');
    const [libraryBrowsePage, setLibraryBrowsePage] = useState(1);
    const [libraryBrowseLimit] = useState(48);
    const [libraryBrowseTotal, setLibraryBrowseTotal] = useState(0);
    const [libraryBrowseLoading, setLibraryBrowseLoading] = useState(false);
    const [selectedExcludeKeys, setSelectedExcludeKeys] = useState<string[]>([]);
    const [exclusionsSummary, setExclusionsSummary] = useState<{ ratingKeys: any[]; titles: any[]; libraries: any[] }>({ ratingKeys: [], titles: [], libraries: [] });
    const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
    const [storageSummary, setStorageSummary] = useState<any>(null);
    const [storageSummaryLoading, setStorageSummaryLoading] = useState(false);
    const [loading, setLoading] = useState(true);
    const [activeSection, setActiveSection] = useState(() => {
        const hash = window.location.hash.replace('#', '');
        if (hash.startsWith('maintenance-')) {
            const section = hash.replace('maintenance-', '');
            if (section === 'overlays') return 'overview';
            return section;
        }
        return 'overview';
    });

    const addToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
        setToasts(t => pushToast(t, message, type));
    }, []);
    const isMaintenanceDisabledError = useCallback((error: any) => {
        const msg = String(error?.message || '');
        return msg.includes('Maintenance Experimental Mode is disabled');
    }, []);

    const sections = [
        { id: 'overview', label: t('maintenance.sections.overview') },
        { id: 'exclusions', label: t('maintenance.sections.exclusions') },
        { id: 'rules', label: t('maintenance.sections.rules') },
        { id: 'collections', label: t('maintenance.sections.collections') },
        { id: 'candidates', label: t('maintenance.sections.candidates') },
        { id: 'calendar', label: t('maintenance.sections.calendar') },
        { id: 'storage', label: t('maintenance.sections.storage') },
        { id: 'library', label: t('maintenance.sections.library') },
        { id: 'settings', label: t('maintenance.sections.settings') },
        { id: 'runs', label: t('maintenance.sections.logs') }
    ];

    useEffect(() => {
        window.location.hash = `maintenance-${activeSection}`;
    }, [activeSection]);

    useEffect(() => {
        if (activeSection !== 'calendar') {
            setSelectedCalendarDate(null);
        }
    }, [activeSection]);

    const loadOverview = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const configData = await apiFetch('/api/config');
            const isEnabled = !!configData?.settings?.maintenanceExperimentalEnabled;
            setMaintenanceFeatureEnabled(isEnabled);
            if (!isEnabled) {
                return;
            }
            const [indexData, runsData, previewData, rulesData, prefData] = await Promise.all([
                apiFetch('/api/maintenance/index'),
                apiFetch('/api/maintenance/runs'),
                apiFetch('/api/maintenance/preview', {
                    method: 'POST',
                    body: JSON.stringify({ limit: 30, includeArrDiagnostics: true })
                }),
                apiFetch('/api/maintenance/rules'),
                apiFetch('/api/maintenance/preferences')
            ]);
            setOverview(indexData || null);
            setRuns(Array.isArray(runsData) ? runsData : []);
            setPreviewGroups(Array.isArray(previewData?.previews) ? previewData.previews : []);
            setRules(Array.isArray(rulesData) ? rulesData : []);
            setPreferences(prefData || {
                global: { dryRunByDefault: true, maxActionsPerRun: 25, requireConfirmForDestructive: true },
                exclusions: { ratingKeys: [], titles: [], libraries: [] }
            });
            const previewAll = Array.isArray(previewData?.previews) ? previewData.previews : [];
            const uniqueItems = new Map<string, any>();
            const libraryMap: Record<string, { libraryTitle: string; count: number; reclaimGB: number }> = {};
            const ruleInsights = previewAll.map((preview: any) => {
                const sample = Array.isArray(preview?.sample) ? preview.sample : [];
                let ruleReclaim = 0;
                sample.forEach((item: any) => {
                    if (item?.excluded) return;
                    const ratingKey = String(item?.ratingKey || '');
                    if (ratingKey && !uniqueItems.has(ratingKey)) uniqueItems.set(ratingKey, item);
                    const size = Number(item?.sizeGB || 0);
                    ruleReclaim += size;
                    const libraryTitle = item?.libraryTitle || t('maintenance.labels.unknownLibrary');
                    if (!libraryMap[libraryTitle]) libraryMap[libraryTitle] = { libraryTitle, count: 0, reclaimGB: 0 };
                    libraryMap[libraryTitle].count += 1;
                    libraryMap[libraryTitle].reclaimGB += size;
                });
                return {
                    ruleId: String(preview?.ruleId || ''),
                    ruleName: preview?.ruleName || t('maintenance.labels.unnamedRule'),
                    totalMatches: Number(preview?.remainingCount ?? preview?.totalMatches ?? sample.length ?? 0),
                    reclaimGB: ruleReclaim
                };
            });
            const uniqueValues = Array.from(uniqueItems.values());
            const estimatedReclaimGB = uniqueValues.reduce((sum: number, item: any) => sum + Number(item?.sizeGB || 0), 0);
            const totalMatches = ruleInsights.reduce((sum: number, rule: any) => sum + Number(rule.totalMatches || 0), 0);
            setOverviewInsights({
                totalMatches,
                uniqueMatches: uniqueValues.length,
                estimatedReclaimGB,
                libraries: Object.values(libraryMap).sort((a, b) => b.reclaimGB - a.reclaimGB),
                rules: ruleInsights.sort((a: any, b: any) => b.reclaimGB - a.reclaimGB)
            });
        } catch (e: any) {
            if (isMaintenanceDisabledError(e)) {
                setMaintenanceFeatureEnabled(false);
                return;
            }
            addToast(e.message || t('maintenance.errors.loadOverview'), 'error');
        } finally {
            if (!silent) setLoading(false);
        }
    }, [addToast, isMaintenanceDisabledError, t]);

    useEffect(() => {
        loadOverview();
    }, [loadOverview]);

    useEffect(() => {
        if (!rules.length) {
            setCandidateRuleId('');
            setCandidateItems([]);
            return;
        }
        if (!candidateRuleId || !rules.some((rule: any) => rule.id === candidateRuleId)) {
            setCandidateRuleId(rules[0].id);
        }
    }, [rules, candidateRuleId]);

    const fetchCandidatesForRule = useCallback(async (ruleId: string) => {
        if (!maintenanceFeatureEnabled) {
            setCandidateItems([]);
            return;
        }
        if (!ruleId) {
            setCandidateItems([]);
            return;
        }
        setIsLoadingCandidates(true);
        try {
            const payload = await apiFetch('/api/maintenance/preview', {
                method: 'POST',
                body: JSON.stringify({
                    ruleId,
                    includeAll: true,
                    includeArrDiagnostics: true
                })
            });
            const previews = Array.isArray(payload?.previews) ? payload.previews : [];
            const selected = previews.find((preview: any) => preview.ruleId === ruleId);
            setCandidateItems((selected?.sample || []).map((item: any) => ({ ...item, _ruleId: selected?.ruleId, _ruleName: selected?.ruleName })));
        } catch (e: any) {
            if (isMaintenanceDisabledError(e)) {
                setMaintenanceFeatureEnabled(false);
                return;
            }
            addToast(e.message || t('maintenance.errors.loadCandidates'), 'error');
        } finally {
            setIsLoadingCandidates(false);
        }
    }, [addToast, isMaintenanceDisabledError, maintenanceFeatureEnabled, t]);

    useEffect(() => {
        if (maintenanceFeatureEnabled && (activeSection === 'candidates' || activeSection === 'storage' || activeSection === 'calendar')) {
            fetchCandidatesForRule(candidateRuleId);
        }
    }, [activeSection, candidateRuleId, fetchCandidatesForRule, maintenanceFeatureEnabled]);

    const saveAllRules = async (nextRules: any[]) => {
        await apiFetch('/api/maintenance/rules', { method: 'POST', body: JSON.stringify(nextRules) });
        setRules(nextRules);
    };

    const savePreferences = async (nextPrefs: any) => {
        const response = await apiFetch('/api/maintenance/preferences', { method: 'POST', body: JSON.stringify(nextPrefs) });
        setPreferences(response?.preferences || nextPrefs);
    };

    const loadExclusionsSummary = useCallback(async () => {
        if (!maintenanceFeatureEnabled) return;
        try {
            const payload = await apiFetch('/api/maintenance/exclusions/summary');
            setExclusionsSummary({
                ratingKeys: Array.isArray(payload?.ratingKeys) ? payload.ratingKeys : [],
                titles: Array.isArray(payload?.titles) ? payload.titles : [],
                libraries: Array.isArray(payload?.libraries) ? payload.libraries : []
            });
        } catch (e: any) {
            if (isMaintenanceDisabledError(e)) {
                setMaintenanceFeatureEnabled(false);
                return;
            }
            addToast(e.message || t('maintenance.errors.loadExclusions'), 'error');
        }
    }, [addToast, isMaintenanceDisabledError, maintenanceFeatureEnabled, t]);

    const refreshExclusionsSummaryQuietly = useCallback(() => {
        loadExclusionsSummary().catch(() => { });
    }, [loadExclusionsSummary]);

    const updateRatingKeyExclusions = async (nextKeys: string[]) => {
        const next = {
            ...preferences,
            exclusions: { ...(preferences.exclusions || {}), ratingKeys: nextKeys }
        };
        await savePreferences(next);
        refreshExclusionsSummaryQuietly();
    };

    const loadLibraryBrowse = useCallback(async () => {
        if (!maintenanceFeatureEnabled) return;
        setLibraryBrowseLoading(true);
        try {
            const params = new URLSearchParams({
                libraryId: libraryBrowseId,
                search: libraryBrowseSearch,
                page: String(libraryBrowsePage),
                limit: String(libraryBrowseLimit),
                includeExcluded: 'true'
            });
            const payload = await apiFetch(`/api/maintenance/library-items?${params.toString()}`);
            setLibraryItems(Array.isArray(payload?.items) ? payload.items : []);
            setLibraryOptions(Array.isArray(payload?.libraries) ? payload.libraries : []);
            setLibraryBrowseTotal(Number(payload?.total || 0));
        } catch (e: any) {
            if (isMaintenanceDisabledError(e)) {
                setMaintenanceFeatureEnabled(false);
                return;
            }
            addToast(e.message || t('maintenance.errors.loadLibrary'), 'error');
        } finally {
            setLibraryBrowseLoading(false);
        }
    }, [addToast, isMaintenanceDisabledError, libraryBrowseId, libraryBrowseLimit, libraryBrowsePage, libraryBrowseSearch, maintenanceFeatureEnabled, t]);

    const loadStorageSummary = useCallback(async (ruleId?: string) => {
        if (!maintenanceFeatureEnabled) return;
        setStorageSummaryLoading(true);
        try {
            const query = ruleId ? `?ruleId=${encodeURIComponent(ruleId)}` : '';
            const payload = await apiFetch(`/api/maintenance/storage-summary${query}`);
            setStorageSummary(payload || null);
        } catch (e: any) {
            if (isMaintenanceDisabledError(e)) {
                setMaintenanceFeatureEnabled(false);
                return;
            }
            addToast(e.message || t('maintenance.errors.loadStorage'), 'error');
        } finally {
            setStorageSummaryLoading(false);
        }
    }, [addToast, isMaintenanceDisabledError, maintenanceFeatureEnabled, t]);

    useEffect(() => {
        if (maintenanceFeatureEnabled && activeSection === 'exclusions') {
            loadExclusionsSummary();
        }
    }, [activeSection, loadExclusionsSummary, maintenanceFeatureEnabled]);

    useEffect(() => {
        if (maintenanceFeatureEnabled && activeSection === 'exclusions') {
            loadLibraryBrowse();
        }
    }, [activeSection, libraryBrowseId, libraryBrowsePage, libraryBrowseSearch, loadLibraryBrowse, maintenanceFeatureEnabled]);

    useEffect(() => {
        if (maintenanceFeatureEnabled && activeSection === 'storage') {
            loadStorageSummary(candidateRuleId || undefined);
        }
    }, [activeSection, candidateRuleId, maintenanceFeatureEnabled, loadStorageSummary]);

    const filteredCandidates = candidateItems.filter((item: any) => {
        if (!candidateSearch.trim()) return true;
        const q = candidateSearch.trim().toLowerCase();
        return `${item.title || ''} ${item.libraryTitle || ''}`.toLowerCase().includes(q);
    });
    const selectedCandidateRule = useMemo(
        () => rules.find((rule: any) => rule.id === candidateRuleId) || null,
        [rules, candidateRuleId]
    );

    const excludedRatingKeySet = useMemo(
        () => new Set((preferences?.exclusions?.ratingKeys || []).map((v: string) => String(v))),
        [preferences?.exclusions?.ratingKeys]
    );

    const formatReclaimSizeFromGB = (sizeGB: number) => {
        const safeGB = Math.max(0, Number(sizeGB || 0));
        if (safeGB >= 1024) {
            return `${Math.ceil(safeGB / 1024)} TB`;
        }
        if (safeGB >= 1) {
            return `${Math.ceil(safeGB)} GB`;
        }
        return `${Math.ceil(safeGB * 1024)} MB`;
    };

    const getEligibilityTooltip = (item: any) => {
        const daysUntilEligible = Math.max(0, Number(item?.daysUntilEligible || 0));
        const watchDays = Number(item?.daysSinceLastWatch);
        const addedDays = Number(item?.daysSinceAdded);
        const base = daysUntilEligible > 0
            ? t('maintenance.calendar.notEligibleYet', { count: daysUntilEligible })
            : t('maintenance.calendar.eligibilityNowTooltip');
        if (Number.isFinite(watchDays) && watchDays >= 0) {
            return `${base} ${t('maintenance.calendar.lastWatched', { count: watchDays })}`;
        }
        if (Number.isFinite(addedDays) && addedDays >= 0) {
            return `${base} ${t('maintenance.calendar.addedDaysAgo', { count: addedDays })}`;
        }
        return base;
    };

    const ELIGIBLE_NOW_KEY = 'eligible-now';
    const calendarEligibility = useMemo(() => {
        const graceDays = Math.max(0, Number(selectedCandidateRule?.graceDays || 0));
        const createdAtMs = Date.parse(String(selectedCandidateRule?.createdAt || ''));
        const hasRuleCreatedAt = Number.isFinite(createdAtMs);
        const daysSinceRuleCreated = hasRuleCreatedAt
            ? Math.max(0, Math.floor((Date.now() - createdAtMs) / (24 * 60 * 60 * 1000)))
            : graceDays;
        const daysUntilEligible = Math.max(0, graceDays - daysSinceRuleCreated);
        const nowItems: any[] = [];
        const byDay = new Map<string, any[]>();
        filteredCandidates.forEach((item: any) => {
            if (item?.excluded) return;
            if (daysUntilEligible <= 0) {
                nowItems.push({ ...item, daysUntilEligible: 0, eligibleDate: null });
                return;
            }
            const etaDate = new Date(Date.now() + (daysUntilEligible * 24 * 60 * 60 * 1000));
            const dateKey = etaDate.toISOString().split('T')[0];
            const enriched = { ...item, daysUntilEligible, eligibleDate: dateKey };
            if (!byDay.has(dateKey)) byDay.set(dateKey, []);
            byDay.get(dateKey)?.push(enriched);
        });
        const laterByDay = Array.from(byDay.entries())
            .sort((a, b) => (a[0] < b[0] ? -1 : 1))
            .map(([date, items]) => ({
                date,
                items,
                count: items.length,
                reclaimGB: items.reduce((sum: number, item: any) => sum + Number(item.sizeGB || 0), 0),
                preview: items.slice(0, 4),
                minDaysUntil: Math.min(...items.map((item: any) => Number(item.daysUntilEligible || 0)))
            }));
        return {
            graceDays,
            daysSinceRuleCreated,
            daysUntilEligible,
            eligibleNow: nowItems.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''))),
            eligibleLaterByDay: laterByDay
        };
    }, [filteredCandidates, selectedCandidateRule?.createdAt, selectedCandidateRule?.graceDays]);

    const selectedCalendarGroup = useMemo(() => {
        if (!selectedCalendarDate) return null;
        if (selectedCalendarDate === ELIGIBLE_NOW_KEY) {
            const items = calendarEligibility.eligibleNow;
            return {
                date: ELIGIBLE_NOW_KEY,
                title: t('maintenance.calendar.eligibleNow'),
                items,
                count: items.length,
                reclaimGB: items.reduce((sum: number, item: any) => sum + Number(item.sizeGB || 0), 0)
            };
        }
        const day = calendarEligibility.eligibleLaterByDay.find((group) => group.date === selectedCalendarDate);
        if (!day) return null;
        return {
            ...day,
            title: new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
        };
    }, [calendarEligibility, selectedCalendarDate, t]);

    const renderScaffoldPage = (title: string, description: string, bullets: string[]) => (
        <div className="glass-card-sm p-5">
            <h3 className="text-xl font-bold text-plex mb-2">{title}</h3>
            <p className="text-sm text-muted mb-4">{description}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {bullets.map((item) => (
                    <div key={item} className="bg-black/20 border border-border rounded-lg px-3 py-2 text-sm text-text">
                        {item}
                    </div>
                ))}
            </div>
        </div>
    );

    return (
        <div className="w-full flex flex-col">
            <Loader isLoading={loading} />
            <ToastContainer toasts={toasts} setToasts={setToasts} />
            <header className="page-header">
                <h1 className="page-title">{t('maintenance.page.title')}</h1>
            </header>
            <div className="w-full flex flex-col p-0 md:p-8 bg-transparent md:glass-card rounded-none md:rounded-2xl border-0 md:border shadow-none">
                <div className="md:hidden mb-3">
                    <label className="text-[10px] text-muted font-bold uppercase tracking-wider mb-1 block">{t('maintenance.labels.modulePage')}</label>
                    <CustomSelect
                        value={activeSection}
                        onChange={(value) => setActiveSection(value)}
                        compact
                        className="w-full"
                        options={sections.map((section) => ({ label: section.label, value: section.id }))}
                    />
                </div>
                <div className="md:grid md:grid-cols-[280px_minmax(0,1fr)] md:gap-6">
                    <aside className="hidden md:block glass-card-sm p-3 h-fit sticky top-20">
                        <p className="text-muted text-xs uppercase tracking-wider font-bold mb-2 px-2">{t('maintenance.labels.modulePages')}</p>
                        <div className="space-y-1">
                            {sections.map((section) => (
                                <button
                                    key={section.id}
                                    type="button"
                                    onClick={() => setActiveSection(section.id)}
                                    className={`w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${activeSection === section.id ? 'bg-plex text-background' : 'text-muted hover:text-text hover:bg-white/5'}`}
                                >
                                    {section.label}
                                </button>
                            ))}
                        </div>
                    </aside>
                    <div className="overflow-y-auto flex-grow mb-4 custom-scrollbar space-y-4 md:pr-2">
                        {!maintenanceFeatureEnabled && (
                            <div className="glass-card-sm border-yellow-500/30 p-5">
                                <h3 className="text-xl font-bold text-plex mb-2">{t('maintenance.page.disabledTitle')}</h3>
                                <p className="text-sm text-muted mb-3">{t('maintenance.page.disabledDescription')}</p>
                                <p className="text-xs text-muted">{t('maintenance.page.disabledHint')}</p>
                                <button
                                    type="button"
                                    onClick={() => { window.location.href = portalUrl('/settings#cleaner'); }}
                                    className="mt-3 px-3 py-1.5 bg-plex text-background rounded-md text-xs font-semibold hover:bg-plex-hover transition-colors"
                                >
                                    {t('notifications.openSettings')}
                                </button>
                            </div>
                        )}
                        {maintenanceFeatureEnabled && (
                            <>
                                {activeSection === 'overview' && (
                                    <div className="space-y-4">
                                        <div className="glass-card-sm p-5">
                                            <h3 className="text-xl font-bold text-plex mb-2">{t('maintenance.page.controlCenter')}</h3>
                                            <p className="text-sm text-muted mb-4">{t('maintenance.page.controlCenterDescription')}</p>
                                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                                <div className="bg-background/30 rounded-lg p-3 border border-white/5">
                                                    <p className="text-xs text-muted">{t('maintenance.labels.indexedMedia')}</p>
                                                    <p className="text-2xl font-bold text-text">{overview?.itemCount || 0}</p>
                                                </div>
                                                <div className="bg-background/30 rounded-lg p-3 border border-white/5">
                                                    <p className="text-xs text-muted">{t('maintenance.labels.requestRecords')}</p>
                                                    <p className="text-2xl font-bold text-text">{overview?.requestItemCount || 0}</p>
                                                </div>
                                                <div className="bg-background/30 rounded-lg p-3 border border-white/5">
                                                    <p className="text-xs text-muted">{t('maintenance.overview.rulesWithMatches')}</p>
                                                    <p className="text-2xl font-bold text-text">{previewGroups.filter((p: any) => (p.totalMatches || 0) > 0).length}</p>
                                                </div>
                                                <div className="bg-background/30 rounded-lg p-3 border border-white/5">
                                                    <p className="text-xs text-muted">{t('maintenance.overview.totalRuns')}</p>
                                                    <p className="text-2xl font-bold text-text">{runs.length}</p>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="glass-card-sm p-5 space-y-4">
                                            <h4 className="font-bold text-text">{t('maintenance.overview.reclaimImpact')}</h4>
                                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                                <div className="bg-background/30 rounded-lg p-3 border border-white/5">
                                                    <p className="text-xs text-muted">{t('maintenance.overview.totalMatched')}</p>
                                                    <p className="text-2xl font-bold text-text">{overviewInsights.totalMatches}</p>
                                                </div>
                                                <div className="bg-background/30 rounded-lg p-3 border border-white/5">
                                                    <p className="text-xs text-muted">{t('maintenance.overview.uniqueCandidates')}</p>
                                                    <p className="text-2xl font-bold text-text">{overviewInsights.uniqueMatches}</p>
                                                </div>
                                                <div className="bg-background/30 rounded-lg p-3 border border-white/5">
                                                    <p className="text-xs text-muted">{t('maintenance.overview.estimatedReclaim')}</p>
                                                    <p className="text-2xl font-bold text-text">{formatReclaimSizeFromGB(overviewInsights.estimatedReclaimGB)}</p>
                                                </div>
                                                <div className="bg-background/30 rounded-lg p-3 border border-white/5">
                                                    <p className="text-xs text-muted">{t('maintenance.labels.topImpactLibrary')}</p>
                                                    <p className="text-sm font-bold text-text line-clamp-2">{overviewInsights.libraries[0]?.libraryTitle || '—'}</p>
                                                    <p className="text-xs text-muted mt-1">{overviewInsights.libraries[0] ? formatReclaimSizeFromGB(overviewInsights.libraries[0].reclaimGB) : t('maintenance.labels.noData')}</p>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                                <div className="bg-background/30 rounded-lg p-3 border border-white/5">
                                                    <p className="text-xs text-muted font-bold uppercase tracking-wider mb-2">{t('maintenance.overview.topLibraries')}</p>
                                                    <div className="space-y-1.5 max-h-52 overflow-y-auto custom-scrollbar pr-1">
                                                        {overviewInsights.libraries.slice(0, 8).map((lib) => (
                                                            <div key={`overview-lib-${lib.libraryTitle}`} className="flex items-center justify-between text-xs bg-background/30 border border-white/5 rounded px-2 py-1.5">
                                                                <span className="text-text line-clamp-1">{lib.libraryTitle}</span>
                                                                <span className="text-muted ml-2 whitespace-nowrap">{formatReclaimSizeFromGB(lib.reclaimGB)} · {lib.count}</span>
                                                            </div>
                                                        ))}
                                                        {!overviewInsights.libraries.length && <p className="text-xs text-muted">{t('maintenance.candidates.noResults')}</p>}
                                                    </div>
                                                </div>
                                                <div className="bg-background/30 rounded-lg p-3 border border-white/5">
                                                    <p className="text-xs text-muted font-bold uppercase tracking-wider mb-2">{t('maintenance.overview.topRules')}</p>
                                                    <div className="space-y-1.5 max-h-52 overflow-y-auto custom-scrollbar pr-1">
                                                        {overviewInsights.rules.slice(0, 8).map((rule) => (
                                                            <div key={`overview-rule-${rule.ruleId}`} className="flex items-center justify-between text-xs bg-background/30 border border-white/5 rounded px-2 py-1.5">
                                                                <span className="text-text line-clamp-1">{rule.ruleName}</span>
                                                                <span className="text-muted ml-2 whitespace-nowrap">{formatReclaimSizeFromGB(rule.reclaimGB)} · {rule.totalMatches}</span>
                                                            </div>
                                                        ))}
                                                        {!overviewInsights.rules.length && <p className="text-xs text-muted">{t('maintenance.candidates.noRules')}</p>}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                {activeSection === 'rules' && <LibraryMaintenancePanel addToast={addToast} onRulesUpdated={() => loadOverview(true)} />}
                                {activeSection === 'collections' && (
                                    <div className="glass-card-sm p-5 space-y-3">
                                        <h3 className="text-xl font-bold text-plex">{t('maintenance.collections.title')}</h3>
                                        <p className="text-sm text-muted">{t('maintenance.collections.description')}</p>
                                        <div className="space-y-2">
                                            {rules.map((rule: any) => (
                                                <div key={`collection-${rule.id}`} className="bg-background/30 border border-white/5 rounded-lg p-3">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <p className="font-semibold text-text text-sm">{rule.name || t('maintenance.labels.unnamedRule')}</p>
                                                        <label className="text-xs text-muted flex items-center gap-2">
                                                            <input
                                                                type="checkbox"
                                                                checked={rule?.collection?.enabled !== false}
                                                                onChange={async (e) => {
                                                                    const next = rules.map((r: any) => r.id === rule.id ? { ...r, collection: { ...(r.collection || {}), enabled: e.target.checked } } : r);
                                                                    setRules(next);
                                                                    await saveAllRules(next);
                                                            addToast(t('maintenance.collections.settingsUpdated'));
                                                                }}
                                                            />
                                                            {t('maintenance.collections.enabled')}
                                                        </label>
                                                    </div>
                                                    <input
                                                        className="appearance-none text-[16px] leading-5 mt-2 w-full p-2 rounded border border-border bg-card text-text text-[16px]"
                                                        value={rule?.collection?.nameTemplate || 'Leaving Soon - {{ruleName}}'}
                                                        onChange={(e) => {
                                                            const next = rules.map((r: any) => r.id === rule.id ? { ...r, collection: { ...(r.collection || {}), nameTemplate: e.target.value } } : r);
                                                            setRules(next);
                                                        }}
                                                        onBlur={async (e) => {
                                                            const next = rules.map((r: any) => r.id === rule.id
                                                                ? { ...r, collection: { ...(r.collection || {}), nameTemplate: e.target.value } }
                                                                : r);
                                                            setRules(next);
                                                            await saveAllRules(next);
                                                            addToast(t('maintenance.collections.templateSaved'));
                                                        }}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {activeSection === 'candidates' && (
                                    <div className="glass-card-sm p-3 md:p-5 space-y-3">
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <h3 className="text-xl font-bold text-plex">{t('maintenance.candidates.title')}</h3>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    className="appearance-none text-[16px] leading-5 p-2 rounded border border-border bg-card text-text text-[16px]"
                                                    placeholder={t('maintenance.candidates.searchPlaceholder')}
                                                    value={candidateSearch}
                                                    onChange={(e) => setCandidateSearch(e.target.value)}
                                                />
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {rules.map((rule: any) => (
                                                <button
                                                    key={`candidate-rule-tab-${rule.id}`}
                                                    type="button"
                                                    onClick={() => setCandidateRuleId(rule.id)}
                                                    className={`px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors ${candidateRuleId === rule.id ? 'bg-plex text-background border-plex' : 'bg-background/30 text-text border-white/5 hover:border-plex/40'}`}
                                                >
                                                    {rule.name || t('maintenance.labels.unnamedRule')}
                                                </button>
                                            ))}
                                            {!rules.length && <p className="text-sm text-muted">{t('maintenance.candidates.noRules')}</p>}
                                        </div>
                                        {selectedCandidateRule && (
                                            <p className="text-xs text-muted">
                                                {t('maintenance.candidates.showing', { name: selectedCandidateRule.name || t('maintenance.labels.unnamedRule') })}
                                            </p>
                                        )}
                                        {isLoadingCandidates ? <p className="text-sm text-muted">{t('maintenance.candidates.loading')}</p> : (
                                            <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7 gap-2 md:gap-3 max-h-[620px] overflow-y-auto custom-scrollbar pr-1">
                                                {filteredCandidates.map((item: any) => (
                                                    <div key={`candidate-${item._ruleId || candidateRuleId}-${item.ratingKey}`} className={`bg-background/30 border rounded-lg overflow-hidden ${item.excluded ? 'border-red-500/50 opacity-70' : 'border-white/5'}`}>
                                                        <div className="aspect-[2/3] bg-black/40 relative">
                                                            {item.thumb ? (
                                                                <img src={portalUrl(`/api/plex/image?path=${encodeURIComponent(item.thumb)}&width=220&height=330`)} alt={item.title} loading="lazy" className="w-full h-full object-cover" />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center text-xs text-muted">{t('maintenance.labels.noPoster')}</div>
                                                            )}
                                                            {item.excluded ? (
                                                                <span className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded bg-red-600/95 text-white font-bold">
                                                                    {t('maintenance.exclusions.excluded')}
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                        <div className="p-2">
                                                            <p className="text-xs text-text line-clamp-2">{item.title}</p>
                                                            <p className="text-[11px] text-muted mt-1">{item.libraryTitle || t('maintenance.labels.unknownLibrary')}</p>
                                                            <div className="flex flex-wrap gap-1 mt-1">
                                                                {item.arrResolvable ? (
                                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-300">
                                                                        {item.arrInstanceName || item.arrType || 'ARR'}
                                                                    </span>
                                                                ) : item.excluded ? null : (
                                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-300">{t('maintenance.labels.unmapped')}</span>
                                                                )}
                                                                {item.arrAmbiguous && (
                                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">{t('maintenance.labels.ambiguous')}</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                                {!filteredCandidates.length && <p className="text-sm text-muted col-span-full">{t('maintenance.candidates.noResults')}</p>}
                                            </div>
                                        )}
                                    </div>
                                )}
                                {activeSection === 'runs' && (
                                    <div className="glass-card-sm p-5 space-y-3">
                                        <h3 className="text-xl font-bold text-plex">{t('maintenance.runs.title')}</h3>
                                        <div className="space-y-2 max-h-[620px] overflow-y-auto custom-scrollbar pr-1">
                                            {runs.map((run: any) => (
                                                <details key={`run-${run.id}`} className="bg-background/30 border border-white/5 rounded-lg p-3">
                                                    <summary className="cursor-pointer list-none">
                                                        <div className="flex items-center justify-between gap-3">
                                                            <div>
                                                                <p className="text-sm font-semibold text-text">{run.ruleName}</p>
                                                                <p className="text-xs text-muted">{new Date(run.startedAt).toLocaleString()} · {run.dryRun ? t('maintenance.runs.dryRun') : t('maintenance.runs.destructive')}</p>
                                                            </div>
                                                            <span className="text-[11px] px-2 py-1 rounded bg-border text-muted">{run.status}</span>
                                                        </div>
                                                    </summary>
                                                    <div className="mt-3 text-xs text-muted">
                                                        {t('maintenance.runs.summary', { matched: run.totals?.matched || 0, processed: run.totals?.processed || 0, deleted: run.totals?.deleted || 0, skipped: run.totals?.skipped || 0, failed: run.totals?.failed || 0 })}
                                                    </div>
                                                    {Array.isArray(run.preflight?.warnings) && run.preflight.warnings.length > 0 && (
                                                        <div className="mt-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1">
                                                            {run.preflight.warnings.join(' ')}
                                                        </div>
                                                    )}
                                                    <div className="mt-2 max-h-52 overflow-y-auto custom-scrollbar pr-1 space-y-1">
                                                        {(run.outcomes || []).slice(0, 120).map((outcome: any, idx: number) => (
                                                            <div key={`outcome-${run.id}-${idx}`} className="text-xs bg-background/30 border border-white/5 rounded px-2 py-1">
                                                                {(outcome.title || outcome.type || 'Item')} · {outcome.status || (outcome.success ? 'success' : 'info')}
                                                                {outcome.arrInstanceName ? ` · ${outcome.arrInstanceName}` : ''}
                                                                {outcome.reason ? ` · ${outcome.reason}` : ''}
                                                                {outcome.arrWarning ? ` · ${outcome.arrWarning}` : ''}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </details>
                                            ))}
                                            {!runs.length && <p className="text-sm text-muted">{t('maintenance.runs.noRuns')}</p>}
                                        </div>
                                    </div>
                                )}
                                {activeSection === 'calendar' && (
                                    <div className="glass-card-sm p-5 space-y-3">
                                        <h3 className="text-xl font-bold text-plex">{t('maintenance.calendar.title')}</h3>
                                        <p className="text-sm text-muted">{t('maintenance.calendar.description')}</p>
                                        <div className="flex flex-wrap gap-2">
                                            {rules.map((rule: any) => (
                                                <button
                                                    key={`calendar-rule-tab-${rule.id}`}
                                                    type="button"
                                                    onClick={() => setCandidateRuleId(rule.id)}
                                                    className={`px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors ${candidateRuleId === rule.id ? 'bg-plex text-background border-plex' : 'bg-background/30 text-text border-white/5 hover:border-plex/40'}`}
                                                >
                                                    {rule.name || t('maintenance.labels.unnamedRule')}
                                                </button>
                                            ))}
                                        </div>
                                        {selectedCandidateRule && (
                                            <p className="text-xs text-muted">
                                                {t('maintenance.calendar.currentRule')} <span className="text-text font-semibold">{selectedCandidateRule.name || t('maintenance.labels.unnamedRule')}</span> · {t('maintenance.calendar.graceDays')}: <span className="text-text font-semibold">{calendarEligibility.graceDays}</span> · {t('maintenance.calendar.ruleAge')}: <span className="text-text font-semibold">{calendarEligibility.daysSinceRuleCreated}</span> {t('maintenance.calendar.titleCount')}
                                            </p>
                                        )}
                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                            <button
                                                type="button"
                                                onClick={() => setSelectedCalendarDate(ELIGIBLE_NOW_KEY)}
                                                className="text-left bg-background/30 border border-white/5 rounded-lg p-3 hover:border-plex/50 transition-colors"
                                                title={t('maintenance.calendar.eligibilityNowTooltip')}
                                            >
                                                <p className="text-xs text-muted">{t('maintenance.calendar.eligibleNow')}</p>
                                                <p className="text-2xl font-bold text-text mt-1">{calendarEligibility.eligibleNow.length}</p>
                                                <p className="text-[11px] text-muted mt-1">{t('maintenance.calendar.reclaimNow', { value: formatReclaimSizeFromGB(calendarEligibility.eligibleNow.reduce((sum: number, item: any) => sum + Number(item.sizeGB || 0), 0)) })}</p>
                                            </button>
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3" title={t('maintenance.calendar.futureDatesTooltip')}>
                                                <p className="text-xs text-muted">{t('maintenance.calendar.eligibleLaterDays')}</p>
                                                <p className="text-2xl font-bold text-text mt-1">{calendarEligibility.eligibleLaterByDay.length}</p>
                                            </div>
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3" title={t('maintenance.calendar.waitingTooltip')}>
                                                <p className="text-xs text-muted">{t('maintenance.calendar.laterTitles')}</p>
                                                <p className="text-2xl font-bold text-text mt-1">{calendarEligibility.eligibleLaterByDay.reduce((sum: number, day: any) => sum + Number(day.count || 0), 0)}</p>
                                            </div>
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3" title={t('maintenance.calendar.delayedReclaimTooltip')}>
                                                <p className="text-xs text-muted">{t('maintenance.calendar.laterReclaim')}</p>
                                                <p className="text-2xl font-bold text-text mt-1">{formatReclaimSizeFromGB(calendarEligibility.eligibleLaterByDay.reduce((sum: number, day: any) => sum + Number(day.reclaimGB || 0), 0))}</p>
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <p className="text-xs uppercase tracking-wider text-muted font-bold" title={t('maintenance.calendar.datesTooltip')}>{t('maintenance.calendar.eligibleLaterByDate')}</p>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 max-h-[700px] overflow-y-auto custom-scrollbar pr-1">
                                            {calendarEligibility.eligibleLaterByDay.slice(0, 120).map((day) => {
                                                const dateLabel = new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                                                return (
                                                    <button
                                                        key={`calendar-day-${day.date}`}
                                                        type="button"
                                                        onClick={() => setSelectedCalendarDate(day.date)}
                                                        className="text-left bg-background/30 border border-white/5 rounded-lg p-3 hover:border-plex/50 hover:bg-black/30 transition-colors"
                                                    >
                                                        <div className="flex items-center justify-between gap-2">
                                                            <p className="text-sm font-semibold text-text">{dateLabel}</p>
                                                            <span className="text-[11px] px-2 py-0.5 rounded bg-plex/20 text-plex font-semibold" title={t('maintenance.calendar.dateTitleCount')}>{day.count}</span>
                                                        </div>
                                                        <p className="text-[11px] text-muted mt-1">{day.minDaysUntil} {t('maintenance.calendar.daysUntilEligible')} · {formatReclaimSizeFromGB(day.reclaimGB)} {t('maintenance.labels.reclaim')}</p>
                                                        <div className="mt-2 flex -space-x-2">
                                                            {day.preview.map((item: any, idx: number) => (
                                                                <div key={`calendar-preview-${day.date}-${item.ratingKey}-${idx}`} className="w-8 h-8 rounded-full overflow-hidden border border-white/5 bg-black/50" title={`${item.title || t('maintenance.labels.unknownTitle')} • ${getEligibilityTooltip(item)}`}>
                                                                    {item.thumb ? (
                                                                        <img
                                                                            src={portalUrl(`/api/plex/image?path=${encodeURIComponent(item.thumb)}&width=64&height=64`)}
                                                                            alt={item.title}
                                                                            className="w-full h-full object-cover"
                                                                            loading="lazy"
                                                                        />
                                                                    ) : (
                                                                        <div className="w-full h-full" />
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                            {!calendarEligibility.eligibleLaterByDay.length && <p className="text-sm text-muted col-span-full">{t('maintenance.calendar.noDelayedDates')}</p>}
                                        </div>
                                    </div>
                                )}
                                {activeSection === 'calendar' && selectedCalendarGroup && (
                                    <div className="fixed inset-0 z-[1500] bg-black/70 backdrop-blur-[1px] flex items-center justify-center p-3 md:p-6" onClick={() => setSelectedCalendarDate(null)}>
                                        <div className="w-full max-w-6xl max-h-[86vh] bg-card/80 backdrop-blur-md border border-white/5 rounded-xl shadow-2xl p-4 md:p-5 overflow-y-auto custom-scrollbar" onClick={(e) => e.stopPropagation()}>
                                            <div className="flex items-start justify-between gap-3 mb-3">
                                                <div>
                                                    <h4 className="text-xl font-bold text-plex">
                                                        {selectedCalendarGroup.title || new Date(`${selectedCalendarGroup.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                                                    </h4>
                                                    <p className="text-sm text-muted mt-1" title={selectedCalendarGroup.date === ELIGIBLE_NOW_KEY ? t('maintenance.calendar.nowDetail') : t('maintenance.calendar.laterDetail')}>
                                                        {selectedCalendarGroup.count} {t('maintenance.calendar.titleCount')} · {formatReclaimSizeFromGB(selectedCalendarGroup.reclaimGB)} {t('maintenance.labels.reclaim')}
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    className="px-3 py-1.5 bg-border text-text rounded-md text-sm font-semibold hover:bg-opacity-80"
                                                    onClick={() => setSelectedCalendarDate(null)}
                                                >
                                                    {t('maintenance.labels.close')}
                                                </button>
                                            </div>
                                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7 gap-3">
                                                {selectedCalendarGroup.items.map((item: any, idx: number) => (
                                                    <div key={`calendar-modal-item-${selectedCalendarGroup.date}-${item.ratingKey}-${idx}`} className="bg-background/30 border border-white/5 rounded-lg overflow-hidden" title={getEligibilityTooltip(item)}>
                                                        <div className="aspect-[2/3] bg-black/40">
                                                            {item.thumb ? (
                                                                <img
                                                                    src={portalUrl(`/api/plex/image?path=${encodeURIComponent(item.thumb)}&width=240&height=360`)}
                                                                    alt={item.title}
                                                                    loading="lazy"
                                                                    className="w-full h-full object-cover"
                                                                />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center text-xs text-muted">{t('maintenance.labels.noPoster')}</div>
                                                            )}
                                                        </div>
                                                        <div className="p-2">
                                                            <p className="text-xs text-text line-clamp-2">{item.title}</p>
                                                            <p className="text-[11px] text-muted mt-1">{item.libraryTitle || t('maintenance.labels.unknownLibrary')}</p>
                                                            <p className="text-[11px] text-muted mt-1" title={t('maintenance.calendar.eligibilityDetailTooltip')}>
                                                                {t('maintenance.calendar.lastWatch')} {Number.isFinite(Number(item.daysSinceLastWatch)) ? `${Number(item.daysSinceLastWatch)}${t('maintenance.calendar.ago')}` : t('maintenance.calendar.notAvailable')} · {t('maintenance.calendar.added')} {Number.isFinite(Number(item.daysSinceAdded)) ? `${Number(item.daysSinceAdded)}${t('maintenance.calendar.ago')}` : t('maintenance.calendar.notAvailable')}
                                                            </p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}
                                {activeSection === 'storage' && (
                                    <div className="glass-card-sm p-5 space-y-4">
                                        <h3 className="text-xl font-bold text-plex">{t('maintenance.storage.title')}</h3>
                                        <p className="text-sm text-muted">{t('maintenance.storage.description')}</p>
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                className="px-3 py-1.5 bg-border text-text rounded-md text-xs font-semibold hover:bg-opacity-80"
                                                onClick={() => loadStorageSummary(candidateRuleId || undefined)}
                                            >
                                                {storageSummaryLoading ? t('maintenance.storage.refreshing') : t('maintenance.storage.refreshSummary')}
                                            </button>
                                            {selectedCandidateRule && (
                                                <p className="text-xs text-muted">{t('maintenance.storage.ruleScope')} <span className="text-text font-semibold">{selectedCandidateRule.name || t('maintenance.labels.unnamedRule')}</span></p>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3">
                                                <p className="text-xs text-muted">{t('maintenance.storage.librarySizeBefore')}</p>
                                                <p className="text-2xl font-bold text-text">{formatReclaimSizeFromGB(Number(storageSummary?.totals?.beforeGB || 0))}</p>
                                            </div>
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3">
                                                <p className="text-xs text-muted">{t('maintenance.storage.projectedReclaim')}</p>
                                                <p className="text-2xl font-bold text-text">{formatReclaimSizeFromGB(Number(storageSummary?.totals?.reclaimGB || 0))}</p>
                                            </div>
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3">
                                                <p className="text-xs text-muted">{t('maintenance.storage.projectedSizeAfter')}</p>
                                                <p className="text-2xl font-bold text-text">{formatReclaimSizeFromGB(Number(storageSummary?.totals?.afterGB || 0))}</p>
                                            </div>
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3">
                                                <p className="text-xs text-muted">{t('maintenance.storage.reclaimPercent')}</p>
                                                <p className="text-2xl font-bold text-text">{Number(storageSummary?.totals?.reclaimPercent || 0).toFixed(1)}%</p>
                                            </div>
                                        </div>
                                        <div className="bg-background/30 border border-white/5 rounded-lg p-3">
                                            <div className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_1fr] gap-2 px-2 py-1 text-[11px] uppercase tracking-wider text-muted font-bold border-b border-border">
                                                <span>{t('maintenance.labels.library')}</span>
                                                <span className="text-right">{t('maintenance.labels.before')}</span>
                                                <span className="text-right">{t('maintenance.labels.reclaim')}</span>
                                                <span className="text-right">{t('maintenance.labels.after')}</span>
                                                <span className="text-right">{t('maintenance.labels.matched')}</span>
                                            </div>
                                            <div className="max-h-[420px] overflow-y-auto custom-scrollbar pr-1 space-y-1 mt-2">
                                                {(storageSummary?.libraries || []).map((row: any) => (
                                                    <div key={`storage-row-${row.libraryTitle}`} className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_1fr] gap-2 px-2 py-2 text-sm bg-background/30 border border-white/5 rounded-lg items-center">
                                                        <span className="text-text line-clamp-1">{row.libraryTitle}</span>
                                                        <span className="text-muted text-right">{formatReclaimSizeFromGB(Number(row.totalSizeGB || 0))}</span>
                                                        <span className="text-right text-plex font-semibold">{formatReclaimSizeFromGB(Number(row.reclaimGB || 0))}</span>
                                                        <span className="text-muted text-right">{formatReclaimSizeFromGB(Number(row.afterSizeGB || 0))}</span>
                                                        <span className="text-muted text-right">{row.matchedItems || 0}</span>
                                                    </div>
                                                ))}
                                                {!storageSummaryLoading && !(storageSummary?.libraries || []).length && (
                                                    <p className="text-sm text-muted px-2 py-2">{t('maintenance.storage.noSummary')}</p>
                                                )}
                                                {storageSummaryLoading && <p className="text-sm text-muted px-2 py-2">{t('maintenance.storage.loading')}</p>}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3">
                                                <p className="text-xs text-muted">Total Indexed Items</p>
                                                <p className="text-xl font-bold text-text">{Number(storageSummary?.totals?.items || 0)}</p>
                                            </div>
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3">
                                                <p className="text-xs text-muted">{t('maintenance.storage.matchedItems')}</p>
                                                <p className="text-xl font-bold text-text">{Number(storageSummary?.totals?.matchedItems || 0)}</p>
                                            </div>
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3">
                                                <p className="text-xs text-muted">Libraries Covered</p>
                                                <p className="text-xl font-bold text-text">{Number(storageSummary?.totals?.libraries || 0)}</p>
                                            </div>
                                        </div>
                                        {storageSummary?.rulesConsidered?.length > 0 && (
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3">
                                                <p className="text-xs text-muted font-bold uppercase tracking-wider mb-2">{t('maintenance.storage.rulesIncluded')}</p>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {storageSummary.rulesConsidered.map((rule: any) => (
                                                        <span key={`storage-rule-${rule.id}`} className="px-2 py-1 rounded bg-border text-xs text-text">{rule.name || t('maintenance.labels.unnamedRule')}</span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                                {activeSection === 'library' && (
                                    <div className="glass-card-sm p-5 space-y-3">
                                        <h3 className="text-xl font-bold text-plex">{t('maintenance.library.title')}</h3>
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                className="px-3 py-2 bg-border text-text rounded-md text-sm font-semibold"
                                                onClick={() => {
                                                    const blob = new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' });
                                                    const url = URL.createObjectURL(blob);
                                                    const a = document.createElement('a');
                                                    a.href = url;
                                                    a.download = `maintenance-rules-${Date.now()}.json`;
                                                    a.click();
                                                    URL.revokeObjectURL(url);
                                                    addToast(t('maintenance.library.exportDownloaded'));
                                                }}
                                            >
                                                {t('maintenance.library.export')}
                                            </button>
                                            <button
                                                type="button"
                                                className="px-3 py-2 bg-plex text-background rounded-md text-sm font-semibold"
                                                onClick={async () => {
                                                    try {
                                                        const parsed = JSON.parse(libraryJsonInput || '[]');
                                                        if (!Array.isArray(parsed)) throw new Error(t('maintenance.library.arrayRequired'));
                                                        await saveAllRules(parsed);
                                                        addToast(t('maintenance.library.importSaved'));
                                                    } catch (e: any) {
                                                        addToast(e.message || t('maintenance.library.invalidJson'), 'error');
                                                    }
                                                }}
                                            >
                                                {t('maintenance.library.import')}
                                            </button>
                                        </div>
                                        <textarea
                                            className="appearance-none text-[16px] leading-5 w-full min-h-[240px] p-3 rounded-lg border border-border bg-card text-text text-[16px] font-mono"
                                            placeholder={t('maintenance.library.placeholder')}
                                            value={libraryJsonInput}
                                            onChange={(e) => setLibraryJsonInput(e.target.value)}
                                        />
                                    </div>
                                )}
                                {activeSection === 'exclusions' && (
                                    <div className="glass-card-sm p-4 md:p-5 space-y-3">
                                        <h3 className="text-xl font-bold text-plex">{t('maintenance.exclusions.title')}</h3>
                                        <p className="text-sm text-muted">{t('maintenance.exclusions.description')}</p>
                                        <div className="bg-background/30 border border-white/5 rounded-lg p-3 md:p-4 space-y-2.5">
                                            <div className="min-w-0 md:w-[220px] h-9">
                                                <CustomSelect
                                                    value={libraryBrowseId}
                                                    onChange={(value) => {
                                                        setLibraryBrowseId(value);
                                                        setLibraryBrowsePage(1);
                                                    }}
                                                    options={[
                                                        { label: t('maintenance.exclusions.allLibraries'), value: 'all' },
                                                        ...libraryOptions.map((library) => ({
                                                            label: `${library.title} (${library.count})`,
                                                            value: library.id
                                                        }))
                                                    ]}
                                                />
                                            </div>
                                            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center mt-1">
                                                <input
                                                    className="appearance-none text-[16px] leading-5 h-9 px-2.5 rounded border border-border bg-card text-text text-[16px] min-w-0"
                                                    placeholder={t('maintenance.exclusions.searchPlaceholder')}
                                                    value={libraryBrowseSearch}
                                                    onChange={(e) => {
                                                        setLibraryBrowseSearch(e.target.value);
                                                        setLibraryBrowsePage(1);
                                                    }}
                                                />
                                                <button type="button" className="h-9 px-3 bg-border text-text rounded-md text-xs md:text-sm font-semibold whitespace-nowrap" onClick={loadLibraryBrowse}>{t('maintenance.exclusions.refresh')}</button>
                                            </div>
                                            <div className="grid grid-cols-[minmax(0,1fr)_auto] md:flex md:flex-wrap items-center gap-2">
                                                <button
                                                    type="button"
                                                    className="h-9 px-3 bg-border text-text rounded-md text-xs md:text-sm font-semibold whitespace-nowrap"
                                                    onClick={() => setSelectedExcludeKeys(libraryItems.map((item: any) => String(item.ratingKey || '')).filter(Boolean))}
                                                    disabled={!libraryItems.length}
                                                >
                                                    {t('maintenance.exclusions.selectPage')}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="h-9 px-3 bg-plex text-background rounded-md text-xs md:text-sm font-semibold whitespace-nowrap"
                                                    onClick={async () => {
                                                        if (!selectedExcludeKeys.length) {
                                                            addToast(t('maintenance.exclusions.selectToExclude'), 'error');
                                                            return;
                                                        }
                                                        const merged = Array.from(new Set([...(preferences?.exclusions?.ratingKeys || []).map((v: string) => String(v)), ...selectedExcludeKeys]));
                                                        await updateRatingKeyExclusions(merged);
                                                        setSelectedExcludeKeys([]);
                                                        addToast(t('maintenance.exclusions.excludedSelected', { count: selectedExcludeKeys.length }));
                                                    }}
                                                >
                                                    {t('maintenance.exclusions.excludeSelected', { count: selectedExcludeKeys.length })}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="h-9 w-9 flex items-center justify-center bg-red-500/15 border border-red-500/40 text-red-300 rounded-md hover:bg-red-500/25 transition-colors"
                                                    onClick={() => setSelectedExcludeKeys([])}
                                                    title={t('maintenance.exclusions.clearSelection')}
                                                    aria-label={t('maintenance.exclusions.clearSelection')}
                                                >
                                                    <X className="w-3.5 h-3.5 md:w-4 md:h-4" />
                                                </button>
                                                <button
                                                    type="button"
                                                    className="col-span-2 md:col-auto h-9 px-3 bg-border text-text rounded-md text-xs md:text-sm font-semibold whitespace-nowrap"
                                                    onClick={async () => {
                                                        if (!selectedExcludeKeys.length) {
                                                            addToast(t('maintenance.exclusions.selectToUnexclude'), 'error');
                                                            return;
                                                        }
                                                        const removedCount = selectedExcludeKeys.length;
                                                        const remaining = (preferences?.exclusions?.ratingKeys || []).map((v: string) => String(v)).filter((key: string) => !selectedExcludeKeys.includes(key));
                                                        await updateRatingKeyExclusions(remaining);
                                                        setSelectedExcludeKeys([]);
                                                        addToast(t('maintenance.exclusions.removedSelected', { count: removedCount }));
                                                    }}
                                                >
                                                    {t('maintenance.exclusions.removeSelected')}
                                                </button>
                                                <p className="col-span-2 text-[11px] md:text-xs text-muted w-full md:w-auto md:ml-auto md:text-right">{t('maintenance.exclusions.showing', { shown: libraryItems.length, total: libraryBrowseTotal, page: libraryBrowsePage })}</p>
                                            </div>
                                            {libraryBrowseLoading ? (
                                                <p className="text-sm text-muted">{t('maintenance.exclusions.loading')}</p>
                                            ) : (
                                                <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-8 gap-2 md:gap-3 max-h-[1240px] overflow-y-auto custom-scrollbar pr-1">
                                                    {libraryItems.map((item: any) => {
                                                        const key = String(item.ratingKey || '');
                                                        const selected = selectedExcludeKeys.includes(key);
                                                        const excluded = item.excluded || excludedRatingKeySet.has(key);
                                                        const toggleQuickExclude = async (event: React.MouseEvent) => {
                                                            event.preventDefault();
                                                            event.stopPropagation();
                                                            const currentKeys = (preferences?.exclusions?.ratingKeys || []).map((v: string) => String(v));
                                                            const nextKeys = excluded ? currentKeys.filter((v: string) => v !== key) : Array.from(new Set([...currentKeys, key]));
                                                            await updateRatingKeyExclusions(nextKeys);
                                                            addToast(excluded ? t('maintenance.exclusions.removed', { title: item.title }) : t('maintenance.exclusions.excludedTitle', { title: item.title }));
                                                        };
                                                        return (
                                                            <div
                                                                key={`exclude-item-${key}`}
                                                                className={`relative w-full border rounded-lg overflow-hidden transition-all ${selected ? 'border-plex bg-plex/5 shadow-[0_0_0_1px_rgba(229,160,13,0.35)]' : 'border-white/5'} ${excluded ? 'ring-1 ring-red-500/60' : ''}`}
                                                            >
                                                                <button
                                                                    type="button"
                                                                    className="w-full text-left"
                                                                    aria-pressed={selected}
                                                                    onClick={() => {
                                                                        setSelectedExcludeKeys((prev) => prev.includes(key) ? prev.filter((v) => v !== key) : [...prev, key]);
                                                                    }}
                                                                >
                                                                    <div className="aspect-[2/3] bg-black/40 relative">
                                                                        {item.thumb ? (
                                                                            <img src={portalUrl(`/api/plex/image?path=${encodeURIComponent(item.thumb)}&width=220&height=330`)} alt={item.title} loading="lazy" className="w-full h-full object-cover" />
                                                                        ) : (
                                                                        <div className="w-full h-full flex items-center justify-center text-xs text-muted">{t('maintenance.labels.noPoster')}</div>
                                                                        )}
                                                                        {selected && (
                                                                            <>
                                                                                <div className="absolute inset-0 bg-plex/20 pointer-events-none" />
                                                                                <div className="absolute top-2 left-2 w-6 h-6 rounded-full bg-plex text-background flex items-center justify-center shadow-md pointer-events-none">
                                                                                    <Check className="w-3.5 h-3.5" strokeWidth={3} />
                                                                                </div>
                                                                            </>
                                                                        )}
                                                                        {excluded && (
                                                                            <span className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded bg-red-600/95 text-white font-bold pointer-events-none">
                                                                                {t('maintenance.exclusions.excluded')}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <p className="px-2 pt-2 text-xs text-text line-clamp-2">{item.title}</p>
                                                                </button>
                                                                <div className="px-2 pb-2 pt-1 flex items-center justify-between gap-2 min-h-[2rem]">
                                                                    <p className="text-[11px] text-muted truncate">{item.libraryTitle}</p>
                                                                    <button
                                                                        type="button"
                                                                        className={`text-[10px] font-semibold shrink-0 whitespace-nowrap transition-colors ${excluded ? 'text-muted hover:text-text' : 'text-plex hover:text-plex-hover'}`}
                                                                        onClick={toggleQuickExclude}
                                                                    >
                                                                        {excluded ? t('maintenance.exclusions.unexclude') : t('maintenance.exclusions.exclude')}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                    {!libraryItems.length && <p className="text-sm text-muted col-span-full">{t('maintenance.exclusions.noTitles')}</p>}
                                                </div>
                                            )}
                                            <div className="flex items-center justify-between">
                                                <button
                                                    type="button"
                                                    className="px-3 py-1.5 bg-border text-text rounded-md text-sm font-semibold disabled:opacity-50"
                                                    disabled={libraryBrowsePage <= 1}
                                                    onClick={() => setLibraryBrowsePage((p) => Math.max(1, p - 1))}
                                                >
                                                    {t('maintenance.labels.previous')}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="px-3 py-1.5 bg-border text-text rounded-md text-sm font-semibold disabled:opacity-50"
                                                    disabled={(libraryBrowsePage * libraryBrowseLimit) >= libraryBrowseTotal}
                                                    onClick={() => setLibraryBrowsePage((p) => p + 1)}
                                                >
                                                    {t('maintenance.labels.next')}
                                                </button>
                                            </div>
                                        </div>
                                        <div className="bg-background/30 border border-white/5 rounded-lg p-3 space-y-3">
                                            <h4 className="text-sm font-bold text-text">{t('maintenance.exclusions.currentResolved')}</h4>
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                                <div className="bg-background/30 border border-white/5 rounded-lg p-3 space-y-2">
                                                    <p className="text-xs font-bold text-muted uppercase tracking-wider">{t('maintenance.exclusions.ratingKeyTitles')}</p>
                                                    <div className="space-y-2 max-h-52 overflow-y-auto custom-scrollbar pr-1">
                                                        {exclusionsSummary.ratingKeys.map((entry: any) => (
                                                            <div key={`resolved-key-${entry.ratingKey}`} className="flex items-center gap-2 bg-background/30 border border-white/5 rounded-md p-2">
                                                                <div className="w-10 h-14 rounded overflow-hidden bg-black/40 flex-shrink-0">
                                                                    {entry.thumb ? (
                                                                        <img src={portalUrl(`/api/plex/image?path=${encodeURIComponent(entry.thumb)}&width=80&height=120`)} alt={entry.title} className="w-full h-full object-cover" />
                                                                    ) : (
                                                                        <div className="w-full h-full flex items-center justify-center text-[9px] text-muted">{t('maintenance.labels.noPoster')}</div>
                                                                    )}
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <p className="text-xs text-text line-clamp-2">{entry.title}</p>
                                                                    <p className="text-[10px] text-muted line-clamp-1">{entry.libraryTitle || entry.ratingKey}</p>
                                                                </div>
                                                            </div>
                                                        ))}
                                                        {!exclusionsSummary.ratingKeys.length && <p className="text-xs text-muted">{t('maintenance.exclusions.noRatingKeys')}</p>}
                                                    </div>
                                                </div>
                                                <div className="bg-background/30 border border-white/5 rounded-lg p-3 space-y-2">
                                                    <p className="text-xs font-bold text-muted uppercase tracking-wider">{t('maintenance.exclusions.titleTerms')}</p>
                                                    <div className="space-y-1.5 max-h-52 overflow-y-auto custom-scrollbar pr-1">
                                                        {exclusionsSummary.titles.map((entry: any) => (
                                                            <div key={`resolved-title-${entry.title}`} className="bg-background/30 border border-white/5 rounded-md px-2 py-1.5">
                                                                <p className="text-xs text-text line-clamp-1">{entry.title}</p>
                                                                <p className="text-[10px] text-muted">{entry.matchCount} indexed match(es)</p>
                                                            </div>
                                                        ))}
                                                        {!exclusionsSummary.titles.length && <p className="text-xs text-muted">{t('maintenance.exclusions.noTitleTerms')}</p>}
                                                    </div>
                                                </div>
                                                <div className="bg-background/30 border border-white/5 rounded-lg p-3 space-y-2">
                                                    <p className="text-xs font-bold text-muted uppercase tracking-wider">{t('maintenance.exclusions.libraries')}</p>
                                                    <div className="space-y-1.5 max-h-52 overflow-y-auto custom-scrollbar pr-1">
                                                        {exclusionsSummary.libraries.map((entry: any) => (
                                                            <div key={`resolved-library-${entry.libraryTitle}`} className="bg-background/30 border border-white/5 rounded-md px-2 py-1.5">
                                                                <p className="text-xs text-text line-clamp-1">{entry.libraryTitle}</p>
                                                                <p className="text-[10px] text-muted">{entry.matchCount} indexed item(s)</p>
                                                            </div>
                                                        ))}
                                                        {!exclusionsSummary.libraries.length && <p className="text-xs text-muted">{t('maintenance.exclusions.noLibraries')}</p>}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                            <div>
                                                <label className="text-xs text-muted font-bold uppercase">{t('maintenance.exclusions.advancedTitle')}</label>
                                                <textarea
                                                    className="appearance-none text-[16px] leading-5 w-full min-h-[180px] p-3 rounded-lg border border-border bg-card text-text text-[16px]"
                                                    value={(preferences?.exclusions?.titles || []).join('\n')}
                                                    onChange={(e) => setPreferences((prev: any) => ({ ...prev, exclusions: { ...(prev.exclusions || {}), titles: e.target.value.split('\n').map(v => v.trim()).filter(Boolean) } }))}
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs text-muted font-bold uppercase">{t('maintenance.exclusions.advancedLibrary')}</label>
                                                <textarea
                                                    className="appearance-none text-[16px] leading-5 w-full min-h-[180px] p-3 rounded-lg border border-border bg-card text-text text-[16px]"
                                                    value={(preferences?.exclusions?.libraries || []).join('\n')}
                                                    onChange={(e) => setPreferences((prev: any) => ({ ...prev, exclusions: { ...(prev.exclusions || {}), libraries: e.target.value.split('\n').map(v => v.trim()).filter(Boolean) } }))}
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs text-muted font-bold uppercase">{t('maintenance.exclusions.advancedRating')}</label>
                                                <textarea
                                                    className="appearance-none text-[16px] leading-5 w-full min-h-[180px] p-3 rounded-lg border border-border bg-card text-text text-[16px]"
                                                    value={(preferences?.exclusions?.ratingKeys || []).join('\n')}
                                                    onChange={(e) => setPreferences((prev: any) => ({ ...prev, exclusions: { ...(prev.exclusions || {}), ratingKeys: e.target.value.split('\n').map(v => v.trim()).filter(Boolean) } }))}
                                                />
                                            </div>
                                        </div>
                                        <button type="button" className="px-3 py-2 bg-plex text-background rounded-md text-sm font-semibold" onClick={async () => { await savePreferences(preferences); await loadExclusionsSummary(); addToast(t('maintenance.exclusions.saved')); }}>
                                            {t('maintenance.exclusions.saved')}
                                        </button>
                                    </div>
                                )}
                                {activeSection === 'settings' && (
                                    <div className="glass-card-sm p-5 space-y-4">
                                        <h3 className="text-xl font-bold text-plex">{t('maintenance.settings.title')}</h3>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3">
                                                <label className="text-xs text-muted font-bold uppercase block mb-2">{t('maintenance.settings.defaultDryRun')}</label>
                                                <label className="text-sm text-muted flex items-center gap-2">
                                                    <input type="checkbox" checked={!!preferences?.global?.dryRunByDefault} onChange={(e) => setPreferences((prev: any) => ({ ...prev, global: { ...(prev.global || {}), dryRunByDefault: e.target.checked } }))} />
                                                    {t('maintenance.settings.enableByDefault')}
                                                </label>
                                            </div>
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3">
                                                <label className="text-xs text-muted font-bold uppercase block mb-2">{t('maintenance.settings.maxActions')}</label>
                                                <input type="number" min={1} className="appearance-none text-[16px] leading-5 w-full p-2 rounded border border-border bg-card text-text text-[16px]" value={preferences?.global?.maxActionsPerRun || 25} onChange={(e) => setPreferences((prev: any) => ({ ...prev, global: { ...(prev.global || {}), maxActionsPerRun: Math.max(1, Number(e.target.value) || 1) } }))} />
                                            </div>
                                            <div className="bg-background/30 border border-white/5 rounded-lg p-3">
                                                <label className="text-xs text-muted font-bold uppercase block mb-2">{t('maintenance.settings.requireConfirm')}</label>
                                                <label className="text-sm text-muted flex items-center gap-2">
                                                    <input type="checkbox" checked={!!preferences?.global?.requireConfirmForDestructive} onChange={(e) => setPreferences((prev: any) => ({ ...prev, global: { ...(prev.global || {}), requireConfirmForDestructive: e.target.checked } }))} />
                                                    {t('maintenance.settings.required')}
                                                </label>
                                            </div>
                                        </div>
                                        <button type="button" className="px-3 py-2 bg-plex text-background rounded-md text-sm font-semibold" onClick={async () => { await savePreferences(preferences); addToast(t('maintenance.settings.saved')); }}>
                                            {t('maintenance.settings.save')}
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};


interface NavigationProps {
    currentRoute: string;
    onNavigate: (
        route: 'admin' | 'user' | 'status' | 'dashboard' | 'settings' | 'logs' | 'analytics' | 'downloads' | 'mediastack' | 'maintenance' | 'upgrader' | 'collexions' | 'spotify-sync' | 'scanner' | 'media-automation' | 'poster-sets' | 'overlays' | 'editions' | 'watch-sync' | 'requests' | 'discovery' | 'about' | 'achievements' | 'support' | 'chat' | 'preferences' | 'profile' | 'external',
        options?: { hash?: string; reviewId?: number; path?: string },
    ) => void;
    onLogout: () => void;
    onSessionRefresh?: () => Promise<void> | void;
    isAdmin: boolean;
    serverName: string;
    adminThumb?: string | null;
    customLogoUrl?: string | null;
    requestUrl: string;
    navOrder: string[];
    navHiddenKeys?: string[];
    memberNavOrder?: string[];
    memberNavHiddenKeys?: string[];
    navFeatures?: NavFeatureFlags;
    appVersion?: string;
    activeTheme: string;
    setActiveTheme: (theme: string) => void;
    pendingRequestCount?: number;
    supportUnreadCount?: number;
    chatUnreadCount?: number;
    watchingCount?: number;
    downloadCount?: number;
    mediaAutomationActiveCount?: number;
    showDashboardWatchingBadge?: boolean;
    sessionInfo?: any;
    mediaServerType?: string;
    sidebarIdentityPosition?: 'top' | 'bottom';
    externalTabId?: string | null;
    openApplets?: OpenAppletSession[];
    onCloseApplet?: (id: string) => void;
}

export const Navigation: React.FC<NavigationProps> = ({ currentRoute, onNavigate, onLogout, onSessionRefresh, isAdmin, serverName, adminThumb, customLogoUrl, requestUrl, navOrder, navHiddenKeys, memberNavOrder, memberNavHiddenKeys, navFeatures, appVersion, activeTheme, setActiveTheme, pendingRequestCount = 0, supportUnreadCount = 0, chatUnreadCount = 0, watchingCount = 0, downloadCount = 0, mediaAutomationActiveCount = 0, showDashboardWatchingBadge = false, sessionInfo, mediaServerType = 'plex', sidebarIdentityPosition = 'bottom', externalTabId = null, openApplets = [], onCloseApplet }) => {
    const { t } = useDiscoverI18n();
    const resolveNavAvatar = (thumb?: string | null) => {
        const raw = String(thumb || '').trim();
        if (!raw) return '';
        if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('/api/')) {
            return resolvePortalAssetUrl(raw);
        }
        return portalUrl(`/api/plex/image?path=${encodeURIComponent(raw)}&width=256&height=256`);
    };
    const brandIcon = customLogoUrl
        ? resolvePortalAssetUrl(customLogoUrl)
        : (resolveNavAvatar(adminThumb) || logoUrl());
    const providerName = String(mediaServerType || 'plex').toLowerCase() === 'jellyfin'
        ? 'Jellyfin'
        : String(mediaServerType || 'plex').toLowerCase() === 'emby'
            ? 'Emby'
            : 'Plex';
    const profile = sessionInfo?.account || sessionInfo?.session || {};
    const profileName = profile?.username || sessionInfo?.session?.username || 'Profile';
    const profileEmail = profile?.email || sessionInfo?.session?.email || '';
    const profileThumb = sessionInfo?.session?.thumb || profile?.thumb || (isAdmin ? adminThumb : null);
    const profileIcon = resolveNavAvatar(profileThumb) || DEFAULT_USER_AVATAR;
    const serverIcon = (customLogoUrl || isAdmin) ? brandIcon : profileIcon;
    const usingBrandWordmark = Boolean(customLogoUrl) || /\/(?:static\/)?logo\.(png|jpg|jpeg|webp)(?:\?|$)/i.test(String(serverIcon || ''));
    const onProfileImageError = (event: React.SyntheticEvent<HTMLImageElement>) => {
        const image = event.currentTarget;
        if (image.dataset.fallback === '1') return;
        image.dataset.fallback = '1';
        image.src = DEFAULT_USER_AVATAR;
    };
    const onIdentityImageError = (event: React.SyntheticEvent<HTMLImageElement>) => {
        if (customLogoUrl || isAdmin) {
            event.currentTarget.src = logoUrl();
            return;
        }
        onProfileImageError(event);
    };
    useEffect(() => {
        updateFavicon(brandIcon);
    }, [brandIcon]);

    const [mobileThemeOpen, setMobileThemeOpen] = useState(false);
    const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
    const [firefoxMobileNav] = useState(() => isFirefoxMobileClient());
    const firefoxNavBarRef = useRef<HTMLDivElement>(null);
    const [profileOpen, setProfileOpen] = useState(false);
    const [homeSwitchOpen, setHomeSwitchOpen] = useState(false);
    const [homeSwitchUsers, setHomeSwitchUsers] = useState<any[]>([]);
    const [homeSwitchCurrentId, setHomeSwitchCurrentId] = useState<string | null>(null);
    const [homeSwitchAvailable, setHomeSwitchAvailable] = useState(false);
    const [homeSwitchBusy, setHomeSwitchBusy] = useState(false);
    const [homeSwitchError, setHomeSwitchError] = useState('');
    const [homeSwitchRememberUserId, setHomeSwitchRememberUserId] = useState<string | null>(null);
    const [profileAchievements, setProfileAchievements] = useState<any>(null);
    const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [installHelpOpen, setInstallHelpOpen] = useState(false);
    const [installBannerDismissed, setInstallBannerDismissed] = useState(() => {
        try {
            return localStorage.getItem('portal.pwa.installBannerDismissed.v1') === '1';
        } catch {
            return false;
        }
    });
    const [isInstalledApp, setIsInstalledApp] = useState(() => (
        typeof window !== 'undefined'
        && (window.matchMedia?.('(display-mode: standalone)').matches
            || window.matchMedia?.('(display-mode: fullscreen)').matches
            || (navigator as any).standalone === true)
    ));
    const [installToasts, setInstallToasts] = useState<ToastMessage[]>([]);
    const addInstallToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
        setInstallToasts((prev) => pushToast(prev, message, type));
    }, []);

    const loadPlexHomeProfiles = useCallback(async () => {
        if (String(mediaServerType || 'plex').toLowerCase() !== 'plex') {
            setHomeSwitchAvailable(false);
            return { available: false, users: [] as any[] };
        }
        if (sessionInfo?.impersonation?.active) {
            setHomeSwitchAvailable(false);
            return { available: false, users: [] as any[] };
        }
        try {
            const data = await apiFetch('/api/auth/plex/home-profiles');
            const users = Array.isArray(data?.users) ? data.users : [];
            const available = !!data?.available && users.length > 1;
            setHomeSwitchUsers(users);
            setHomeSwitchCurrentId(data?.currentUserId || null);
            setHomeSwitchRememberUserId(data?.rememberUserId || null);
            setHomeSwitchAvailable(available);
            return { available, users };
        } catch {
            setHomeSwitchAvailable(false);
            return { available: false, users: [] as any[] };
        }
    }, [mediaServerType, sessionInfo?.impersonation?.active, sessionInfo?.session?.plexId]);

    useEffect(() => {
        void loadPlexHomeProfiles();
    }, [loadPlexHomeProfiles]);

    const openPlexHomeSwitcher = useCallback(async () => {
        setHomeSwitchError('');
        setHomeSwitchOpen(true);
        const result = await loadPlexHomeProfiles();
        if (!result.available) {
            setHomeSwitchOpen(false);
            onNavigate('profile');
        }
    }, [loadPlexHomeProfiles, onNavigate]);

    const handlePlexHomeAvatarClick = useCallback(() => {
        if (homeSwitchAvailable) {
            void openPlexHomeSwitcher();
            return;
        }
        onNavigate('profile');
    }, [homeSwitchAvailable, openPlexHomeSwitcher, onNavigate]);

    const handlePlexHomeSwitch = useCallback(async (user: { id: string }, pin: string | undefined, remember: boolean) => {
        setHomeSwitchBusy(true);
        setHomeSwitchError('');
        try {
            await apiFetch('/api/auth/plex/home-profiles/switch', {
                method: 'POST',
                body: JSON.stringify({
                    userId: user.id,
                    remember: remember === true,
                    ...(pin ? { pin } : {}),
                }),
            });
            window.location.reload();
        } catch (e: any) {
            setHomeSwitchError(e?.message || 'Could not switch Plex Home profile.');
            setHomeSwitchBusy(false);
        }
    }, []);
    useFirefoxMobileNavShell({ barRef: firefoxNavBarRef, enabled: firefoxMobileNav });
    const mobileThemeRef = useRef<HTMLDivElement>(null);
    const [mobileThemePos, setMobileThemePos] = useState<{ top: number; right: number } | null>(null);
    const isFirefoxMobile = typeof navigator !== 'undefined'
        && /Firefox/i.test(navigator.userAgent)
        && /Mobile|Android|iPhone|iPad/i.test(navigator.userAgent);
    const isAndroidChrome = typeof navigator !== 'undefined'
        && /Android/i.test(navigator.userAgent)
        && /Chrome|CriOS|EdgA|SamsungBrowser/i.test(navigator.userAgent)
        && !/Firefox/i.test(navigator.userAgent);
    const isIosSafari = typeof navigator !== 'undefined'
        && /iPhone|iPad|iPod/i.test(navigator.userAgent)
        && /WebKit/i.test(navigator.userAgent)
        && !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Android/i.test(navigator.userAgent);
    const showInstallNudge = !isInstalledApp && !installBannerDismissed && (!!installPrompt || isIosSafari || isFirefoxMobile);
    const [installDiag, setInstallDiag] = useState<string[] | null>(null);

    const dismissInstallBanner = useCallback(() => {
        setInstallBannerDismissed(true);
        try {
            localStorage.setItem('portal.pwa.installBannerDismissed.v1', '1');
        } catch {
            /* ignore */
        }
    }, []);

    const clearInstallBannerDismiss = useCallback(() => {
        setInstallBannerDismissed(false);
        try {
            localStorage.removeItem('portal.pwa.installBannerDismissed.v1');
        } catch {
            /* ignore */
        }
    }, []);

    useEffect(() => {
        if (!profileOpen) return;
        if (!navFeatures?.achievements) {
            setProfileAchievements(null);
            return;
        }
        let cancelled = false;
        apiFetchShared('/api/achievements/me?view=summary')
            .then((data) => {
                if (!cancelled) setProfileAchievements(data);
            })
            .catch(() => {
                if (!cancelled) setProfileAchievements(null);
            });
        return () => { cancelled = true; };
    }, [profileOpen, navFeatures?.achievements]);

    useEffect(() => {
        const handleBeforeInstallPrompt = (event: Event) => {
            event.preventDefault();
            setInstallPrompt(event as BeforeInstallPromptEvent);
        };
        const handleInstalled = () => {
            setIsInstalledApp(true);
            setInstallPrompt(null);
            setInstallHelpOpen(false);
            dismissInstallBanner();
            addInstallToast(t('pwa.install.successBody', { server: serverName }), 'success');
        };
        const syncInstalledState = () => {
            const installed = window.matchMedia?.('(display-mode: standalone)').matches
                || window.matchMedia?.('(display-mode: fullscreen)').matches
                || (navigator as any).standalone === true;
            setIsInstalledApp(!!installed);
            if (installed) dismissInstallBanner();
        };
        syncInstalledState();
        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.addEventListener('appinstalled', handleInstalled);
        const standaloneMq = window.matchMedia?.('(display-mode: standalone)');
        standaloneMq?.addEventListener?.('change', syncInstalledState);
        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleInstalled);
            standaloneMq?.removeEventListener?.('change', syncInstalledState);
        };
    }, [addInstallToast, dismissInstallBanner, serverName, t]);

    useEffect(() => {
        if (!installHelpOpen) {
            setInstallDiag(null);
            return;
        }
        let cancelled = false;
        (async () => {
            const notes: string[] = [];
            const secure = window.isSecureContext || ['localhost', '127.0.0.1'].includes(window.location.hostname);
            if (!secure || window.location.protocol !== 'https:') {
                if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
                    notes.push('Site is not HTTPS — Firefox will not install a PWA over plain HTTP. Open the portal via your HTTPS URL (reverse proxy / tunnel), not http://IP:port.');
                }
            }
            try {
                if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && !/Firefox/i.test(navigator.userAgent || '')) {
                    try {
                        const regs = await navigator.serviceWorker.getRegistrations();
                        if (!regs.length) {
                            notes.push('No service worker registered yet — Chrome Android needs one for Install (not just Create shortcut). Reload once over HTTPS and try again.');
                        } else if (!navigator.serviceWorker.controller) {
                            notes.push('Service worker is registered but not controlling this page yet — reload once, then retry Install.');
                        }
                    } catch {
                        // ignore SW probe failures
                    }
                }
                const manifestLink = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
                const manifestHref = manifestLink?.href || portalUrl('/manifest.webmanifest');
                const manifestRes = await fetch(manifestHref, { credentials: 'same-origin', cache: 'no-store' });
                if (!manifestRes.ok) {
                    notes.push(`Manifest failed to load (${manifestRes.status}).`);
                } else {
                    const manifest = await manifestRes.json();
                    const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
                    if (!manifest.name && !manifest.short_name) notes.push('Manifest is missing a name.');
                    if (!manifest.start_url) notes.push('Manifest is missing start_url.');
                    if (!icons.length) notes.push('Manifest has no icons.');
                    for (const icon of icons.slice(0, 3)) {
                        try {
                            const iconUrl = new URL(String(icon.src || ''), window.location.href).toString();
                            const iconRes = await fetch(iconUrl, { credentials: 'same-origin', cache: 'no-store' });
                            if (!iconRes.ok) {
                                notes.push(`Icon failed (${icon.sizes || '?'}): ${iconRes.status}`);
                                continue;
                            }
                            const type = (iconRes.headers.get('content-type') || '').toLowerCase();
                            if (type && !type.includes('image/')) {
                                notes.push(`Icon is not an image (${icon.sizes || '?'}): ${type}`);
                            }
                        } catch {
                            notes.push(`Icon could not be fetched (${icon.sizes || '?'}).`);
                        }
                    }
                    if (!notes.length) {
                        if (isAndroidChrome && !installPrompt) {
                            notes.push('Chrome has not marked this visit installable yet. Stay on the portal over HTTPS for ~30 seconds, tap once, reload, then try again. Or use More → Install App after Chrome fires the install prompt.');
                        }
                        notes.push('Manifest and icons look OK. Chrome Android: use the in-app Install button (top bar / More menu), or browser menu ⋮ → Install app. Firefox: menu ⋮ → Install. If you only see Create shortcut / Add to Home screen, open the portal over HTTPS, reload once, and clear site data if it still will not Install.');
                    }
                }
            } catch {
                notes.push('Could not verify the web app manifest from this device.');
            }
            if (!cancelled) setInstallDiag(notes);
        })();
        return () => { cancelled = true; };
    }, [installHelpOpen, installPrompt, isAndroidChrome]);

    const handleInstallApp = async () => {
        if (isInstalledApp) {
            addInstallToast(t('pwa.install.openInstalled'), 'success');
            return;
        }
        // Firefox / iOS / most non-Chromium browsers never fire beforeinstallprompt —
        // always show manual install steps instead of appearing to do nothing.
        if (!installPrompt || isFirefoxMobile || isIosSafari) {
            setInstallHelpOpen(true);
            return;
        }
        const promptEvent = installPrompt;
        setInstallPrompt(null);
        dismissInstallBanner();
        try {
            await promptEvent.prompt();
            const choice = await promptEvent.userChoice;
            if (choice.outcome === 'accepted') {
                setIsInstalledApp(true);
                addInstallToast(t('pwa.install.successBody', { server: serverName }), 'success');
            } else {
                // User dismissed the browser prompt — keep banner quiet for this device.
                dismissInstallBanner();
            }
        } catch {
            setInstallHelpOpen(true);
        }
    };
    const handleInstallAppRef = useRef(handleInstallApp);
    handleInstallAppRef.current = handleInstallApp;

    useEffect(() => {
        const onOpenInstall = () => { void handleInstallAppRef.current(); };
        window.addEventListener('portal-open-install', onOpenInstall);
        return () => window.removeEventListener('portal-open-install', onOpenInstall);
    }, []);

    useEffect(() => {
        if (!mobileThemeOpen) { setMobileThemePos(null); return; }
        if (mobileThemeRef.current) {
            const rect = mobileThemeRef.current.getBoundingClientRect();
            setMobileThemePos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
        }
    }, [mobileThemeOpen]);

    useEffect(() => {
        if (!mobileThemeOpen) return;
        const handler = (e: MouseEvent) => {
            if (mobileThemeRef.current && !mobileThemeRef.current.contains(e.target as Node)) {
                setMobileThemeOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [mobileThemeOpen]);

    const customNavTabs: CustomNavTab[] = Array.isArray(sessionInfo?.customNavTabs) ? sessionInfo.customNavTabs : [];
    const [appletsOpen, setAppletsOpen] = useState(false);
    const [desktopNavIconsOnly, setDesktopNavIconsOnly] = useState(() => {
        const iconsOnly = readDesktopNavIconsOnly();
        writeDesktopNavIconsOnly(iconsOnly);
        return iconsOnly;
    });
    const appletsButtonRef = useRef<HTMLButtonElement>(null);
    const appletAccountKey = useMemo(() => getAppletPaletteAccountKey(sessionInfo), [sessionInfo]);
    const [paletteOrderIds, setPaletteOrderIds] = useState<string[]>([]);
    const paletteOrderAccountRef = useRef('');

    useEffect(() => {
        if (!sessionInfo) return;
        if (paletteOrderAccountRef.current === appletAccountKey) return;
        paletteOrderAccountRef.current = appletAccountKey;
        setPaletteOrderIds(readAppletPaletteOrder(appletAccountKey));
    }, [sessionInfo, appletAccountKey]);

    useEffect(() => {
        setAppletsOpen(false);
    }, [currentRoute, externalTabId]);

    const navItemsConfig: Record<string, { label: string; icon: React.FC<any>; route: string; adminOnly: boolean; beta?: boolean; alpha?: boolean; href?: string; onClick?: (e: any) => void; customTabId?: string; logoUrl?: string }> = useMemo(() => {
        const config: Record<string, { label: string; icon: React.FC<any>; route: string; adminOnly: boolean; beta?: boolean; alpha?: boolean; href?: string; onClick?: (e: any) => void; customTabId?: string; logoUrl?: string }> = {
        'home': { label: t('navigation.home'), icon: Home, route: 'user', adminOnly: false },
        'users': { label: t('navigation.users'), icon: Users, route: 'users', adminOnly: true },
        'discover': { label: t('navigation.dashboard'), icon: Film, route: 'dashboard', adminOnly: false },
        'status': { label: t('navigation.status'), icon: Activity, route: 'status', adminOnly: false },
        'logs': { label: t('navigation.logs'), icon: FileText, route: 'logs', adminOnly: true },
        'analytics': { label: t('navigation.analytics'), icon: BarChart3, route: 'analytics', adminOnly: false },
        'achievements': { label: t('navigation.achievements'), icon: Trophy, route: 'achievements', adminOnly: false },
        'chat': { label: t('navigation.chat'), icon: MessageSquare, route: 'chat', adminOnly: false },
        'support': { label: t('navigation.support'), icon: LifeBuoy, route: 'support', adminOnly: false },
        'downloads': { label: t('navigation.downloads'), icon: DownloadCloud, route: 'downloads', adminOnly: false },
        'mediastack': { label: t('navigation.calendar'), icon: Calendar, route: 'mediastack', adminOnly: false },
        'maintenance': { label: t('navigation.cleaner'), icon: Shield, route: 'maintenance', adminOnly: true },
        'upgrader': { label: t('navigation.upgrader'), icon: ArrowUpCircle, route: 'upgrader', adminOnly: true },
        'collexions': { label: t('navigation.collexions'), icon: Layers, route: 'collexions', adminOnly: true },
        'spotify-sync': { label: t('navigation.spotifySync'), icon: Music, route: 'spotify-sync', adminOnly: true, beta: true },
        'scanner': { label: t('navigation.scanner'), icon: Radar, route: 'scanner', adminOnly: true },
        'media-automation': { label: t('navigation.mediaAutomation'), icon: Cpu, route: 'media-automation', adminOnly: true },
        'poster-sets': { label: t('navigation.posterSets'), icon: ImageIcon, route: 'poster-sets', adminOnly: true, beta: true },
        'overlays': { label: t('navigation.overlays'), icon: Layers, route: 'overlays', adminOnly: true },
        'editions': { label: t('navigation.editions'), icon: Film, route: 'editions', adminOnly: true },
        'watch-sync': { label: t('navigation.watchSync'), icon: Clapperboard, route: 'watch-sync', adminOnly: true },
        'requests': { label: t('navigation.requests'), icon: ClipboardList, route: 'requests', adminOnly: true },
        'request': { label: t('navigation.discoverRequest'), icon: Sparkles, route: 'discovery', adminOnly: false },
        'media-player': { label: t('navigation.mediaPlayer'), icon: PlayCircle, route: 'media-player', adminOnly: false, alpha: true },
        'about': { label: t('navigation.about'), icon: Info, route: 'about', adminOnly: false },
        'profile': { label: t('navigation.profile'), icon: User, route: 'profile', adminOnly: false },
        'preferences': { label: t('navigation.preferences'), icon: SlidersHorizontal, route: 'preferences', adminOnly: false },
        'settings': { label: t('navigation.settings'), icon: Settings, route: 'settings', adminOnly: true },
        'logout': { label: t('navigation.logout'), icon: LogOut, route: '', adminOnly: false, onClick: onLogout },
        };
        for (const tab of customNavTabs) {
            if (!tab?.enabled) continue;
            const key = customNavTabKey(tab.id);
            const Icon = resolveCustomNavIcon(tab.icon);
            if (tab.openMode === 'embed') {
                config[key] = {
                    label: tab.name,
                    icon: Icon,
                    route: 'external',
                    adminOnly: !!tab.adminOnly,
                    customTabId: tab.id,
                    logoUrl: tab.logoUrl,
                };
            } else if (tab.openMode === 'newTab') {
                config[key] = {
                    label: tab.name,
                    icon: Icon,
                    route: '',
                    adminOnly: !!tab.adminOnly,
                    href: tab.url,
                    logoUrl: tab.logoUrl,
                };
            } else {
                config[key] = {
                    label: tab.name,
                    icon: Icon,
                    route: '',
                    adminOnly: !!tab.adminOnly,
                    onClick: () => { window.location.href = tab.url; },
                    logoUrl: tab.logoUrl,
                };
            }
        }
        const navItemIcons = sessionInfo?.navItemIcons && typeof sessionInfo.navItemIcons === 'object'
            ? sessionInfo.navItemIcons
            : {};
        for (const [key, item] of Object.entries(config)) {
            const override = navItemIcons[key];
            if (!override || typeof override !== 'object') continue;
            if (override.icon) item.icon = resolveCustomNavIcon(override.icon);
            if (override.logoUrl) item.logoUrl = override.logoUrl;
        }
        return config;
    }, [customNavTabs, onLogout, t, sessionInfo?.navItemIcons]);
    const normalizedNavOrder = useMemo(() => {
        const order = isAdmin
            ? ensureCompleteNavOrder(navOrder)
            : resolveMemberNavOrder(memberNavOrder, navOrder, customNavTabs);
        const hiddenKeys = isAdmin ? navHiddenKeys : (memberNavHiddenKeys ?? navHiddenKeys);
        return filterNavOrder(order, { isAdmin, features: navFeatures, hiddenKeys, customTabs: customNavTabs });
    }, [navOrder, navHiddenKeys, memberNavOrder, memberNavHiddenKeys, isAdmin, navFeatures, customNavTabs]);

    const visibleApplets = useMemo(
        () => sortCustomNavTabsByNavOrder(
            customNavTabs.filter((tab) => (
                canAccessCustomNavTab(tab, isAdmin)
                && normalizedNavOrder.includes(customNavTabKey(tab.id))
            )),
            normalizedNavOrder,
        ),
        [customNavTabs, isAdmin, normalizedNavOrder],
    );

    const paletteApplets = useMemo(
        () => applyAppletPaletteOrder(visibleApplets, paletteOrderIds),
        [visibleApplets, paletteOrderIds],
    );

    const handlePaletteOrderChange = useCallback((orderIds: string[]) => {
        setPaletteOrderIds(orderIds);
        writeAppletPaletteOrder(appletAccountKey, orderIds);
    }, [appletAccountKey]);

    const desktopNavOrder = useMemo(() => buildDesktopNavOrder(normalizedNavOrder, {
        display: sessionInfo?.customNavDisplay,
        hasVisibleApplets: visibleApplets.length > 0,
    }), [normalizedNavOrder, sessionInfo?.customNavDisplay, visibleApplets.length]);

    const isNavCurrent = (key: string, route: string, customTabId?: string) => {
        if (customTabId) return currentRoute === 'external' && externalTabId === customTabId;
        return ['admin', 'user'].includes(currentRoute) && key === 'home' ? true : currentRoute === route;
    };

    const getNavBadgeCount = (key: string) => {
        if (key === 'request') return pendingRequestCount;
        if (key === 'support') return supportUnreadCount;
        if (key === 'chat') return chatUnreadCount;
        if (key === 'discover' && showDashboardWatchingBadge) return watchingCount;
        if (key === 'downloads') return downloadCount;
        if (key === 'media-automation') return mediaAutomationActiveCount;
        return 0;
    };

    const navListRef = useRef<HTMLDivElement>(null);
    const navCompressStepRef = useRef(0);
    const navCompressSignatureRef = useRef('');
    const navMinCompressStepRef = useRef(0);
    const navTriedExpandRef = useRef(false);
    const navListBoxRef = useRef({ width: 0, height: 0 });
    const [navCompressStep, setNavCompressStep] = useState(0);
    const [navCompressEpoch, setNavCompressEpoch] = useState(0);
    const [navListLayoutTick, setNavListLayoutTick] = useState(0);
    const skipDesktopNavCollapseEffect = useRef(true);
    useEffect(() => {
        writeDesktopNavIconsOnly(desktopNavIconsOnly);
        if (skipDesktopNavCollapseEffect.current) {
            skipDesktopNavCollapseEffect.current = false;
            return;
        }
        setNavCompressEpoch((epoch) => epoch + 1);
        window.dispatchEvent(new Event('resize'));
    }, [desktopNavIconsOnly]);

    const desktopNavKeySignature = useMemo(() => (
        desktopNavOrder.join('|')
    ), [desktopNavOrder]);

    /** Nav link styles — stay readable; logo steps first, then these three. */
    const DESKTOP_NAV_STYLES = [
        { gap: 'gap-2.5', px: 'px-3', py: 'py-1.5', text: 'text-[15px]', icon: 'w-5 h-5' },
        { gap: 'gap-2', px: 'px-3', py: 'py-0.5', text: 'text-sm', icon: 'w-[18px] h-[18px]' },
        { gap: 'gap-1.5', px: 'px-2.5', py: 'py-0.5', text: 'text-[13px]', icon: 'w-4 h-4' },
    ];
    /** Logo / identity — shrinks before nav text gets crushed. */
    const IDENTITY_STYLES = [
        {
            customWrap: 'w-[6.9rem]',
            customImg: 'max-w-[6.9rem] max-h-[5.75rem]',
            round: 'w-[5.75rem] h-[5.75rem]',
            title: 'text-[1.3rem]',
            showPortal: true,
            logoMb: 'mb-2',
            sectionTop: 'pb-2 mb-2',
            sectionBottom: 'pt-2 mt-2',
        },
        {
            customWrap: 'w-[5.25rem]',
            customImg: 'max-w-[5.25rem] max-h-[4.25rem]',
            round: 'w-[4.5rem] h-[4.5rem]',
            title: 'text-[1.15rem]',
            showPortal: true,
            logoMb: 'mb-1.5',
            sectionTop: 'pb-1.5 mb-1.5',
            sectionBottom: 'pt-1.5 mt-1.5',
        },
        {
            customWrap: 'w-[4rem]',
            customImg: 'max-w-[4rem] max-h-[3.25rem]',
            round: 'w-[3.5rem] h-[3.5rem]',
            title: 'text-base',
            showPortal: false,
            logoMb: 'mb-1',
            sectionTop: 'pb-1 mb-1',
            sectionBottom: 'pt-1 mt-1',
        },
        {
            customWrap: 'w-[3.25rem]',
            customImg: 'max-w-[3.25rem] max-h-[2.5rem]',
            round: 'w-[3rem] h-[3rem]',
            title: 'text-sm',
            showPortal: false,
            logoMb: 'mb-0.5',
            sectionTop: 'pb-1 mb-0.5',
            sectionBottom: 'pt-1 mt-0.5',
        },
    ];
    /** Shrink the logo fully before tightening nav labels, so leftover height stays on the items. */
    const NAV_STYLE_BY_STEP = [0, 0, 0, 0, 1, 2];
    const IDENTITY_STYLE_BY_STEP = [0, 1, 2, 3, 3, 3];
    const MAX_NAV_COMPRESS_STEP = NAV_STYLE_BY_STEP.length - 1;

    // One density step per committed layout. Measuring in rAF before React paints
    // the smaller styles raced to max compression (tiny labels + a large gap).
    // After shrinking, step back up when the larger size actually fits.
    useLayoutEffect(() => {
        const nav = navListRef.current;
        if (!nav) return;
        if (desktopNavIconsOnly) return;

        const layoutSignature = `${desktopNavKeySignature}|${sidebarIdentityPosition}|${navCompressEpoch}|${desktopNavIconsOnly ? 'icons' : 'full'}`;
        if (layoutSignature !== navCompressSignatureRef.current) {
            navCompressSignatureRef.current = layoutSignature;
            navMinCompressStepRef.current = 0;
            navTriedExpandRef.current = false;
            if (navCompressStep !== 0) {
                navCompressStepRef.current = 0;
                setNavCompressStep(0);
                return;
            }
        }

        // Flex child may not have a real height yet; compressing from that always hits max.
        if (nav.clientHeight < 32) return;

        const overflow = nav.scrollHeight - nav.clientHeight;
        if (overflow > 1 && navCompressStep < MAX_NAV_COMPRESS_STEP) {
            if (navTriedExpandRef.current) {
                navMinCompressStepRef.current = navCompressStep + 1;
                navTriedExpandRef.current = false;
            }
            const next = navCompressStep + 1;
            navCompressStepRef.current = next;
            setNavCompressStep(next);
            return;
        }

        if (overflow <= 1 && navCompressStep > navMinCompressStepRef.current) {
            navTriedExpandRef.current = true;
            const next = navCompressStep - 1;
            navCompressStepRef.current = next;
            setNavCompressStep(next);
            return;
        }

        navTriedExpandRef.current = false;
    }, [desktopNavKeySignature, sidebarIdentityPosition, navCompressEpoch, navCompressStep, navListLayoutTick, MAX_NAV_COMPRESS_STEP, desktopNavIconsOnly]);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onResize = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                setNavCompressEpoch((epoch) => epoch + 1);
            }, 200);
        };
        window.addEventListener('resize', onResize);

        const nav = navListRef.current;
        let observer: ResizeObserver | undefined;
        if (nav && typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver(() => {
                const width = nav.clientWidth;
                const height = nav.clientHeight;
                const prev = navListBoxRef.current;
                if (Math.abs(width - prev.width) < 2 && Math.abs(height - prev.height) < 2) return;
                navListBoxRef.current = { width, height };
                setNavListLayoutTick((tick) => tick + 1);
            });
            observer.observe(nav);
        }

        return () => {
            if (timer) clearTimeout(timer);
            window.removeEventListener('resize', onResize);
            observer?.disconnect();
        };
    }, []);

    const compressStep = Math.min(Math.max(navCompressStep, 0), MAX_NAV_COMPRESS_STEP);
    const navStyleIndex = desktopNavIconsOnly ? 0 : NAV_STYLE_BY_STEP[compressStep];
    const identityStyleIndex = desktopNavIconsOnly ? 3 : IDENTITY_STYLE_BY_STEP[compressStep];
    const desktopNavDensity = DESKTOP_NAV_STYLES[navStyleIndex];
    const identityDensity = IDENTITY_STYLES[identityStyleIndex];

    const NAV_BETA_NOTICE_KEYS: Record<string, string> = {
        'spotify-sync': 'spotifySyncPage.betaNotice',
        'poster-sets': 'posterSetsPage.betaNotice',
    };
    const NAV_ALPHA_NOTICE_KEYS: Record<string, string> = {
        'media-player': 'mediaPlayerPage.alphaNotice',
    };

    const renderNavAction = (
        key: string,
        item: { label: string; icon: React.FC<any>; route: string; href?: string; onClick?: (e: any) => void; customTabId?: string; beta?: boolean; alpha?: boolean; logoUrl?: string },
        options: { compactLabel?: string; mobile?: boolean; isCurrent: boolean; badgeCount?: number },
    ) => {
        const Icon = item.icon;
        const label = options.compactLabel || item.label;
        const badgeCount = options.badgeCount || 0;
        const betaTitle = item.beta
            ? t(NAV_BETA_NOTICE_KEYS[item.route] || 'spotifySyncPage.betaNotice')
            : '';
        const alphaTitle = item.alpha
            ? t(NAV_ALPHA_NOTICE_KEYS[item.route] || 'mediaPlayerPage.alphaNotice')
            : '';
        const statusBadge = item.alpha
            ? <AlphaBadge title={alphaTitle} />
            : item.beta
                ? <BetaBadge title={betaTitle} />
                : null;
        // Bottom-bar slots are too narrow for label + ALPHA/BETA; pin the chip on the icon
        // (same pattern as the More drawer) so it stays inside the nav chrome.
        const mobileStatusBadge = item.alpha
            ? (
                <AlphaBadge
                    title={alphaTitle}
                    className="absolute -bottom-1 left-1/2 z-[1] -translate-x-1/2 px-1 py-0 text-[6px] leading-none"
                />
            )
            : item.beta
                ? (
                    <BetaBadge
                        title={betaTitle}
                        className="absolute -bottom-1 left-1/2 z-[1] -translate-x-1/2 px-1 py-0 text-[6px] leading-none"
                    />
                )
                : null;
        const desktopDensity = options.mobile ? null : desktopNavDensity;
        const iconsOnly = !options.mobile && desktopNavIconsOnly;
        const logoSrc = item.logoUrl ? resolvePortalAssetUrl(item.logoUrl) : '';
        const iconClass = options.mobile ? 'w-5 h-5' : (desktopDensity?.icon || 'w-5 h-5');
        const mark = logoSrc ? (
            <img src={logoSrc} alt="" className={`${iconClass} object-contain flex-shrink-0`} />
        ) : (
            <Icon className={`${iconClass} flex-shrink-0`} />
        );
        const baseClass = options.mobile
            ? `relative flex flex-col items-center justify-center gap-0.5 h-full flex-1 min-w-0 px-0.5 text-center text-[0.6rem] sm:text-[0.65rem] transition-colors overflow-visible ${options.isCurrent ? 'text-plex font-bold' : 'text-muted hover:text-text'}`
            : iconsOnly
                ? `relative flex w-full items-center justify-center px-0 py-1.5 no-underline rounded-lg transition-colors ${options.isCurrent ? 'nav-item-active' : 'text-muted hover:bg-white/5 hover:text-text'}`
                : `flex w-full items-center ${desktopDensity?.gap || 'gap-2.5'} ${desktopDensity?.px || 'px-3'} ${desktopDensity?.py || 'py-1.5'} no-underline rounded-lg transition-colors ${desktopDensity?.text || 'text-[15px]'} font-medium ${options.isCurrent ? 'nav-item-active' : 'text-muted hover:bg-white/5 hover:text-text'}`;

        if (item.href) {
            return (
                <a
                    key={key}
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    title={label}
                    aria-label={label}
                    className={options.mobile ? baseClass : (
                        iconsOnly
                            ? `${baseClass} text-muted hover:bg-white/5 hover:text-text`
                            : `flex w-full items-center ${desktopDensity?.gap || 'gap-2.5'} ${desktopDensity?.px || 'px-3'} ${desktopDensity?.py || 'py-1.5'} text-muted no-underline rounded-lg transition-colors ${desktopDensity?.text || 'text-[15px]'} font-medium hover:bg-white/5 hover:text-text`
                    )}
                >
                    {mark}
                    {iconsOnly ? <span className="sr-only">{label}</span> : <> {label}</>}
                </a>
            );
        }

        const handleActivate = () => {
            if (options.mobile) setMobileMoreOpen(false);
            if (item.customTabId) {
                onNavigate('external', { path: `/external/${encodeURIComponent(item.customTabId)}` });
                return;
            }
            if (item.onClick) item.onClick({ preventDefault: () => {} });
            else if (item.route) onNavigate(item.route as any);
        };

        return (
            <button
                key={key}
                type="button"
                className={`${baseClass} bg-transparent border-0 cursor-pointer`}
                onClick={handleActivate}
                title={iconsOnly ? label : undefined}
                aria-label={iconsOnly ? label : undefined}
            >
                <span className={`relative shrink-0 ${options.mobile && mobileStatusBadge ? 'mb-1' : ''}`}>
                    {mark}
                    {options.mobile ? mobileStatusBadge : null}
                    {badgeCount > 0 && (options.mobile || iconsOnly) && (
                        <span className="absolute -top-1 -right-1.5 min-w-[14px] h-3.5 px-0.5 rounded-full bg-plex text-background text-[8px] font-bold flex items-center justify-center leading-none">
                            {badgeCount > 9 ? '9+' : badgeCount}
                        </span>
                    )}
                </span>
                {options.mobile ? (
                    <span className="truncate max-w-full leading-tight">{label}</span>
                ) : iconsOnly ? (
                    <span className="sr-only">{label}</span>
                ) : (
                    <span className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="truncate">{label}</span>
                        {statusBadge}
                        {badgeCount > 0 && (
                            <span className="ml-auto min-w-[1.15rem] h-[18px] px-1.5 rounded-full bg-plex text-background text-[10px] font-bold flex items-center justify-center shrink-0">
                                {badgeCount > 99 ? '99+' : badgeCount}
                            </span>
                        )}
                    </span>
                )}
                {options.mobile && options.isCurrent && (
                    <div className="absolute bottom-0.5 w-1.5 h-1.5 rounded-full bg-plex shadow-[0_0_5px_rgba(229,160,13,0.8)]" />
                )}
            </button>
        );
    };

    const renderServerIdentity = (placement: 'top' | 'bottom') => {
        const sectionClass = `flex flex-col items-center w-full shrink-0 ${placement === 'top' ? identityDensity.sectionTop : identityDensity.sectionBottom} border-white/10 ${placement === 'top' ? 'border-b' : 'border-t'}`;
        const logoActiveClass = desktopNavIconsOnly && currentRoute === 'profile'
            ? 'ring-2 ring-plex/60 ring-offset-2 ring-offset-[rgb(var(--color-card))]'
            : '';

        const identityContent = (
            <>
                <div className={`relative ${identityDensity.logoMb} ${usingBrandWordmark ? `${identityDensity.customWrap} flex items-center justify-center` : ''}`}>
                    {usingBrandWordmark ? (
                        <img
                            src={serverIcon}
                            alt="Server Logo"
                            className={`${identityDensity.customImg} object-contain drop-shadow-[0_0_24px_rgba(0,0,0,0.75)] ${logoActiveClass}`}
                            onError={(e) => {
                                (e.target as HTMLImageElement).src = logoUrl();
                            }}
                        />
                    ) : (
                        <>
                            <div className="absolute inset-0 bg-plex blur-[29px] opacity-20 rounded-full"></div>
                            <div className="absolute -inset-1 rounded-full bg-gradient-to-tr from-plex via-amber-300 to-orange-600 opacity-60"></div>
                            <div className={`relative ${identityDensity.round} rounded-full p-[3px] shadow-2xl bg-card ${logoActiveClass}`}>
                                <div className="w-full h-full rounded-full overflow-hidden bg-background">
                                    <img
                                        src={serverIcon}
                                        alt="Server Logo"
                                        className="w-full h-full object-cover"
                                        onError={onIdentityImageError}
                                    />
                                </div>
                            </div>
                        </>
                    )}
                </div>

                <div className={`flex flex-col items-center text-center px-2 ${desktopNavIconsOnly ? 'sr-only' : ''}`}>
                    <h2 className={`${identityDensity.title} font-black text-text tracking-tight leading-tight line-clamp-2`}>
                        {serverName}
                    </h2>
                    {identityDensity.showPortal && (
                        <div className="mt-1 flex items-center gap-2">
                            <div className="h-px w-6 bg-gradient-to-r from-transparent to-plex/50"></div>
                            <span className="text-[10px] uppercase tracking-[0.3em] text-plex font-bold">
                                Portal
                            </span>
                            <div className="h-px w-6 bg-gradient-to-l from-transparent to-plex/50"></div>
                        </div>
                    )}
                </div>
            </>
        );

        if (desktopNavIconsOnly) {
            return (
                <button
                    type="button"
                    onClick={() => onNavigate('profile')}
                    title={profileName}
                    aria-label={profileName}
                    className={`${sectionClass} p-0 bg-transparent border-0 cursor-pointer hover:opacity-90 transition-opacity`}
                >
                    {identityContent}
                </button>
            );
        }

        return (
            <div className={sectionClass}>
                {identityContent}
            </div>
        );
    };

    return (
        <>
            <ToastContainer toasts={installToasts} setToasts={setInstallToasts} />

            {/* Mobile Top Nav — height grows with safe-area so content clears the iOS status bar in PWA */}
            <div className="md:hidden fixed top-0 left-0 right-0 z-50 nav-shell border-b shadow-lg pt-[env(safe-area-inset-top,0px)] overflow-visible">
                <div className="h-16 flex items-center justify-between gap-2 page-x min-w-0 overflow-hidden">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    <img
                        src={serverIcon}
                        alt="Logo"
                        className={`shrink-0 ${usingBrandWordmark ? 'h-8 w-auto max-w-[7.5rem] object-contain' : 'w-8 h-8 rounded-full object-cover'}`}
                        onError={onIdentityImageError}
                    />
                    <span className="font-bold text-text uppercase tracking-widest text-xs truncate">{serverName}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                    <InAppNotificationsBell
                        onNavigate={(route, options) => onNavigate(route as any, options)}
                        className="overflow-visible"
                        buttonClassName="relative w-8 h-8 flex items-center justify-center rounded-md border border-border text-muted hover:border-plex/50 hover:text-text transition-all overflow-visible"
                    />
                    <div className="relative" ref={mobileThemeRef}>
                        <button
                            onClick={() => setMobileThemeOpen(v => !v)}
                            className={`w-8 h-8 flex items-center justify-center rounded-md border transition-all ${mobileThemeOpen ? 'border-plex text-plex ring-1 ring-plex' : 'border-border text-muted hover:border-plex/50 hover:text-text'}`}
                            title="Change theme"
                        >
                            <Palette className="w-3.5 h-3.5" />
                        </button>
                        {mobileThemeOpen && mobileThemePos && ReactDOM.createPortal(
                            <div
                                style={{ position: 'fixed', top: mobileThemePos.top, right: mobileThemePos.right, zIndex: 99999 }}
                                className="bg-card border border-border rounded-lg shadow-2xl py-1 min-w-[140px]"
                            >
                                {[
                                    { label: 'Dynamic (Chameleon)', value: 'dynamic' },
                                    { label: 'Plex Dark', value: 'plex' },
                                    { label: 'Sleek Slate', value: 'slate' },
                                    { label: 'Nordic Frost', value: 'nordic' },
                                    { label: 'Jellyfin Purple', value: 'jellyfin' },
                                    { label: 'Emerald Green', value: 'emerald' },
                                    { label: 'Neon Midnight', value: 'midnight' },
                                    { label: 'Crimson Red', value: 'crimson' },
                                    { label: 'Deep Amethyst', value: 'amethyst' },
                                    { label: 'Sunset Orange', value: 'sunset' },
                                    { label: 'Ocean Teal', value: 'ocean' },
                                    { label: 'Rose Pink', value: 'rose' },
                                    { label: 'Royal Blue', value: 'royal' },
                                    { label: 'Graphite', value: 'graphite' },
                                    { label: 'Cyber Lime', value: 'cyberlime' },
                                    { label: 'Aurora', value: 'aurora' },
                                ].map(opt => (
                                    <div
                                        key={opt.value}
                                        className={`px-4 py-2.5 cursor-pointer text-sm whitespace-nowrap transition-colors ${activeTheme === opt.value ? 'bg-plex/10 text-plex font-bold' : 'text-text hover:bg-border/40'}`}
                                        onMouseDown={e => { e.preventDefault(); setActiveTheme(opt.value); setMobileThemeOpen(false); }}
                                    >
                                        {opt.label}
                                    </div>
                                ))}
                            </div>,
                            document.body
                        )}
                    </div>
                    {isAdmin && (
                        <button onClick={(e) => { e.preventDefault(); onNavigate('logs'); }} className={`w-8 h-8 flex items-center justify-center rounded-md border border-border text-muted hover:border-plex/50 hover:text-text transition-colors ${currentRoute === 'logs' ? 'text-plex border-plex/50' : ''}`}>
                            <FileText className="w-4 h-4" />
                        </button>
                    )}
                    {!isInstalledApp && (
                        <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); void handleInstallApp(); }}
                            className={`w-8 h-8 inline-flex items-center justify-center rounded-md border transition-colors ${
                                installPrompt
                                    ? 'border-plex/50 bg-plex/15 text-plex'
                                    : 'border-border text-muted hover:border-plex/40 hover:text-text'
                            }`}
                            title={t('pwa.install.button')}
                            aria-label={t('pwa.install.button')}
                        >
                            <MonitorSmartphone className="w-3.5 h-3.5 shrink-0" />
                        </button>
                    )}
                    {homeSwitchAvailable && (
                        <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); void openPlexHomeSwitcher(); }}
                            className="w-8 h-8 flex items-center justify-center rounded-md border border-border text-muted hover:border-plex/50 hover:text-text transition-colors overflow-hidden"
                            title="Switch profile"
                            aria-label="Switch profile"
                        >
                            <img
                                src={profileIcon}
                                alt=""
                                className="w-full h-full object-cover"
                                onError={onProfileImageError}
                            />
                        </button>
                    )}
                    <button onClick={(e) => { e.preventDefault(); onLogout(); }} className="w-8 h-8 flex items-center justify-center rounded-md border border-border text-muted hover:border-red-500/50 hover:text-red-500 transition-colors">
                        <LogOut className="w-4 h-4" />
                    </button>
                </div>
                </div>
            </div>


            {/* Desktop Sidebar */}
            <div className="hidden md:flex relative shrink-0 sticky top-0 self-start h-dvh z-20">
            <div className={`flex flex-col h-full nav-shell border-r py-2.5 shadow-2xl overflow-hidden transition-[width,padding] duration-200 ${desktopNavIconsOnly ? 'w-[4.5rem] px-1.5' : 'w-72 px-5'}`}>
                {sidebarIdentityPosition === 'top' && renderServerIdentity('top')}

                <div
                    ref={navListRef}
                    className={`sidebar-nav-scroll flex flex-col justify-start min-h-0 flex-1 ${navStyleIndex > 0 ? 'gap-0' : 'gap-0.5'} py-0.5`}
                    data-nav-density={compressStep}
                >
                    {desktopNavOrder.map((key) => {
                        if (key === APPLETS_NAV_KEY) {
                            const isCurrent = currentRoute === 'external'
                                && visibleApplets.some((tab) => tab.id === externalTabId);
                            const desktopDensity = desktopNavDensity;
                            return (
                                <React.Fragment key={key}>
                                    <button
                                        ref={appletsButtonRef}
                                        type="button"
                                        className={desktopNavIconsOnly
                                            ? `relative flex w-full items-center justify-center px-0 py-1.5 bg-transparent border-0 cursor-pointer no-underline rounded-lg transition-colors ${isCurrent || appletsOpen ? 'nav-item-active' : 'text-muted hover:bg-white/5 hover:text-text'}`
                                            : `flex w-full items-center ${desktopDensity?.gap || 'gap-2.5'} ${desktopDensity?.px || 'px-3'} ${desktopDensity?.py || 'py-1.5'} bg-transparent border-0 cursor-pointer no-underline rounded-lg transition-colors ${desktopDensity?.text || 'text-[15px]'} font-medium ${isCurrent || appletsOpen ? 'nav-item-active' : 'text-muted hover:bg-white/5 hover:text-text'}`}
                                        onClick={() => setAppletsOpen((open) => !open)}
                                        aria-expanded={appletsOpen}
                                        aria-haspopup="dialog"
                                        title={desktopNavIconsOnly ? t('navigation.applets') : undefined}
                                        aria-label={t('navigation.applets')}
                                    >
                                        <AppWindow className={`${desktopDensity?.icon || 'w-5 h-5'} flex-shrink-0`} />
                                        {desktopNavIconsOnly
                                            ? <span className="sr-only">{t('navigation.applets')}</span>
                                            : <span className="truncate">{t('navigation.applets')}</span>}
                                    </button>
                                    {appletsOpen ? (
                                        <AppletsPalette
                                            tabs={paletteApplets}
                                            openIds={openApplets.map((session) => session.id)}
                                            activeId={externalTabId}
                                            anchorRef={appletsButtonRef}
                                            onClose={() => setAppletsOpen(false)}
                                            onOrderChange={handlePaletteOrderChange}
                                            onCloseSession={onCloseApplet ? (tab) => onCloseApplet(tab.id) : undefined}
                                            onActivate={(tab) => {
                                                setAppletsOpen(false);
                                                if (tab.openMode === 'embed') {
                                                    const existing = openApplets.find((session) => session.id === tab.id);
                                                    onNavigate('external', {
                                                        path: existing
                                                            ? buildArrPortalEmbedHref(existing.id, existing.embedPath)
                                                            : `/external/${encodeURIComponent(tab.id)}`,
                                                    });
                                                    return;
                                                }
                                                if (tab.openMode === 'newTab') {
                                                    window.open(tab.url, '_blank', 'noopener,noreferrer');
                                                    return;
                                                }
                                                window.location.href = tab.url;
                                            }}
                                        />
                                    ) : null}
                                </React.Fragment>
                            );
                        }
                        const item = navItemsConfig[key];
                        if (!item) return null;
                        if (key === 'logs') return null;
                        const isCurrent = item.customTabId
                            ? isNavCurrent(key, item.route, item.customTabId)
                            : (item.route ? isNavCurrent(key, item.route) : false);
                        const labelOverride = key === 'mediastack' ? t('navigation.calendar') : item.label;
                        return renderNavAction(key, { ...item, label: labelOverride }, { isCurrent, badgeCount: getNavBadgeCount(key) });
                    })}
                </div>

                {sidebarIdentityPosition !== 'top' && renderServerIdentity('bottom')}

                {desktopNavIconsOnly ? (
                    <div className="mt-1 pt-1 border-t border-white/10 shrink-0 w-full flex flex-col items-center gap-1.5">
                        <button
                            type="button"
                            onClick={handlePlexHomeAvatarClick}
                            className={`w-9 h-9 rounded-full overflow-hidden border transition-all ${homeSwitchAvailable ? 'border-plex/40 hover:border-plex hover:ring-2 hover:ring-plex/30' : 'border-white/10 hover:border-plex/40'}`}
                            title={homeSwitchAvailable ? 'Switch profile' : profileName}
                            aria-label={homeSwitchAvailable ? 'Switch profile' : profileName}
                        >
                            <img
                                src={profileIcon}
                                alt=""
                                className="w-full h-full object-cover"
                                onError={onProfileImageError}
                            />
                        </button>
                        <InAppNotificationsBell
                            onNavigate={(route, options) => onNavigate(route as any, options)}
                            className="overflow-visible"
                            placement="up"
                            buttonClassName="relative w-9 h-9 flex items-center justify-center rounded-xl border border-white/10 bg-white/5 text-muted hover:text-text hover:border-plex/40 hover:bg-white/10 transition-all overflow-visible"
                        />
                    </div>
                ) : (
                <div className={`${identityStyleIndex >= 3 ? 'mt-1 pt-1' : 'mt-2 pt-2'} border-t border-white/10 shrink-0 w-full min-w-0`}>
                    <div className="grid grid-cols-[minmax(0,1fr)_2.75rem] gap-1.5 items-stretch w-full min-w-0">
                        <div
                            className={`min-w-0 flex items-center gap-0.5 rounded-xl border bg-white/5 hover:border-plex/40 transition-all overflow-hidden ${currentRoute === 'profile' ? 'border-plex/50 bg-plex/10' : 'border-white/10'}`}
                        >
                            <button
                                type="button"
                                onClick={handlePlexHomeAvatarClick}
                                className={`flex-shrink-0 rounded-full p-0.5 ml-1 ${homeSwitchAvailable ? 'ring-1 ring-plex/40 hover:ring-plex' : ''}`}
                                title={homeSwitchAvailable ? 'Switch profile' : profileName}
                                aria-label={homeSwitchAvailable ? 'Switch profile' : profileName}
                            >
                                <img
                                    src={profileIcon}
                                    alt=""
                                    className="w-7 h-7 rounded-full object-cover bg-background/60 border border-white/10"
                                    onError={onProfileImageError}
                                />
                            </button>
                            <button
                                type="button"
                                onClick={() => onNavigate('profile')}
                                className="min-w-0 flex flex-1 items-center gap-1.5 py-1 pl-1 pr-0 text-left overflow-hidden hover:bg-white/10 transition-colors"
                            >
                                <div className="min-w-0 flex-1 overflow-hidden">
                                    <p className="text-xs font-bold text-text truncate">{profileName}</p>
                                    <p className="text-[9px] uppercase tracking-wider text-muted truncate">{providerName} Profile</p>
                                </div>
                            </button>
                            <button
                                type="button"
                                onClick={() => setProfileOpen(true)}
                                className="flex-shrink-0 p-2 mr-0.5 rounded-lg text-plex hover:bg-white/10 transition-colors"
                                title="Change theme"
                                aria-label="Change theme"
                            >
                                <Palette className="w-3.5 h-3.5" />
                            </button>
                        </div>
                        <InAppNotificationsBell
                            onNavigate={(route, options) => onNavigate(route as any, options)}
                            className="min-w-0 w-full self-stretch overflow-visible"
                            placement="up"
                            buttonClassName="relative w-full h-full flex items-center justify-center rounded-xl border border-white/10 bg-white/5 text-muted hover:text-text hover:border-plex/40 hover:bg-white/10 transition-all overflow-visible"
                        />
                    </div>
                    <div className="mt-1 flex flex-col items-center gap-0.5">
                        {appVersion && (
                            <div className="text-[10px] text-white/50 font-mono tracking-wider opacity-80 hover:opacity-100 transition-opacity">
                                {appVersion}
                            </div>
                        )}
                    </div>
                </div>
                )}
            </div>
            <button
                type="button"
                className="absolute top-1/2 -translate-y-1/2 left-full z-30 flex h-14 w-4 items-center justify-center rounded-r-md border border-l-0 border-white/15 bg-[rgb(var(--color-card))] text-muted shadow-lg hover:bg-white/10 hover:text-text"
                onClick={() => setDesktopNavIconsOnly((current) => !current)}
                title={desktopNavIconsOnly ? t('navigation.expandNav') : t('navigation.collapseNav')}
                aria-label={desktopNavIconsOnly ? t('navigation.expandNav') : t('navigation.collapseNav')}
                aria-pressed={desktopNavIconsOnly}
            >
                {desktopNavIconsOnly
                    ? <ChevronRight className="w-3.5 h-3.5" />
                    : <ChevronLeft className="w-3.5 h-3.5" />}
            </button>
            </div>

            <PlexHomeSwitchModal
                open={homeSwitchOpen}
                users={homeSwitchUsers}
                currentUserId={homeSwitchCurrentId}
                rememberUserId={homeSwitchRememberUserId}
                showRemember
                rememberDefault={!!homeSwitchRememberUserId}
                busy={homeSwitchBusy}
                error={homeSwitchError}
                onSelect={handlePlexHomeSwitch}
                onClose={() => { if (!homeSwitchBusy) setHomeSwitchOpen(false); }}
                onViewProfile={() => {
                    setHomeSwitchOpen(false);
                    onNavigate('profile');
                }}
            />

            {profileOpen && (
                <div className="hidden md:block fixed inset-0 z-[80]" aria-modal="true" role="dialog">
                    <button
                        type="button"
                        className="absolute inset-0 bg-black/35 cursor-default"
                        aria-label="Close profile modal"
                        onClick={() => setProfileOpen(false)}
                    />
                    <div
                        className={`absolute bottom-4 rounded-2xl border border-border shadow-2xl overflow-hidden animate-fade-in ${desktopNavIconsOnly ? 'left-[4.75rem] w-64 max-w-[16rem]' : 'left-5 w-[calc(18rem-2.5rem)] max-w-[calc(18rem-2.5rem)]'}`}
                        style={{ backgroundColor: '#12141a' }}
                    >
                        <div
                            className="absolute inset-0"
                            style={{ backgroundColor: 'rgb(var(--color-card))' }}
                            aria-hidden
                        />
                        <div className="relative z-[1]">
                        <div className="p-4 border-b border-border/70">
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <img
                                        src={profileIcon}
                                        alt={`${profileName} profile`}
                                        className="w-11 h-11 flex-shrink-0 rounded-full object-cover bg-background/60 border border-white/10"
                                        onError={onProfileImageError}
                                    />
                                    <div className="min-w-0">
                                        <p className="text-base font-black text-text truncate">{profileName}</p>
                                        <p className="text-[10px] uppercase tracking-[0.2em] text-plex font-bold mt-0.5">{providerName} Profile</p>
                                        {profileEmail && <p className="text-xs text-muted truncate mt-1">{profileEmail}</p>}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setProfileOpen(false)}
                                    className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-white/5 transition-colors shrink-0"
                                    aria-label="Close profile modal"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        <div className="p-4 space-y-4">
                            {navFeatures?.achievements && profileAchievements?.showOnProfile !== false && (
                                <ProfileBadgeRack
                                    earned={profileAchievements?.earned || []}
                                    level={profileAchievements?.level}
                                    xp={profileAchievements?.xp}
                                    max={16}
                                    onOpenAll={() => {
                                        setProfileOpen(false);
                                        onNavigate('achievements' as any);
                                    }}
                                />
                            )}
                            <div>
                            <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-muted font-bold">
                                <Palette className="w-3.5 h-3.5 text-plex" />
                                Theme
                            </div>
                            <CustomSelect
                                value={activeTheme}
                                onChange={setActiveTheme}
                                compact={true}
                                className="w-full"
                                options={[
                                    { label: 'Dynamic (Chameleon)', value: 'dynamic' },
                                    { label: 'Plex Dark', value: 'plex' },
                                    { label: 'Sleek Slate', value: 'slate' },
                                    { label: 'Nordic Frost', value: 'nordic' },
                                    { label: 'Jellyfin Purple', value: 'jellyfin' },
                                    { label: 'Emerald Green', value: 'emerald' },
                                    { label: 'Neon Midnight', value: 'midnight' },
                                    { label: 'Crimson Red', value: 'crimson' },
                                    { label: 'Deep Amethyst', value: 'amethyst' },
                                    { label: 'Sunset Orange', value: 'sunset' },
                                    { label: 'Ocean Teal', value: 'ocean' },
                                    { label: 'Rose Pink', value: 'rose' },
                                    { label: 'Royal Blue', value: 'royal' },
                                    { label: 'Graphite', value: 'graphite' },
                                    { label: 'Cyber Lime', value: 'cyberlime' },
                                    { label: 'Aurora', value: 'aurora' },
                                ]}
                            />
                            </div>
                            {homeSwitchAvailable && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setProfileOpen(false);
                                        void openPlexHomeSwitcher();
                                    }}
                                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-plex/30 bg-plex/10 px-4 py-3 text-sm font-bold text-plex hover:bg-plex/20 hover:border-plex/50 transition-colors"
                                >
                                    <Users className="w-4 h-4" />
                                    Switch profile
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => {
                                    setProfileOpen(false);
                                    onLogout();
                                }}
                                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200 hover:bg-red-500/20 hover:border-red-400/50 transition-colors"
                            >
                                <LogOut className="w-4 h-4" />
                                {t('navigation.logout')}
                            </button>
                        </div>
                        </div>
                    </div>
                </div>
            )}

            {installHelpOpen && (
                <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm animate-fade-in flex items-center justify-center p-4" aria-modal="true" role="dialog">
                    <button
                        type="button"
                        className="absolute inset-0 cursor-default"
                        aria-label={t('pwa.install.closeHelp')}
                        onClick={() => setInstallHelpOpen(false)}
                    />
                    <div className="relative w-full max-w-sm rounded-2xl border border-border bg-card shadow-2xl p-5">
                        <div className="flex items-start justify-between gap-3 mb-4">
                            <div className="flex items-center gap-3">
                                <div className="w-11 h-11 rounded-xl bg-plex/10 border border-plex/25 flex items-center justify-center text-plex">
                                    <MonitorSmartphone className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-black text-text">{t('pwa.install.helpTitle')}</h3>
                                    <p className="text-xs text-muted">{t('pwa.install.helpSubtitle', { server: serverName })}</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setInstallHelpOpen(false)}
                                className="p-2 rounded-lg text-muted hover:text-text hover:bg-white/5 transition-colors"
                                aria-label={t('pwa.install.closeHelp')}
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <p className="text-sm text-muted leading-relaxed">
                            {isIosSafari
                                ? t('pwa.install.helpIos')
                                : isFirefoxMobile
                                    ? t('pwa.install.helpFirefox')
                                    : isAndroidChrome
                                        ? t('pwa.install.helpAndroidChrome')
                                        : t('pwa.install.helpGeneric')}
                        </p>
                        {installDiag && (
                            <ul className="mt-4 space-y-2 rounded-xl border border-border bg-background/40 p-3 text-xs text-muted">
                                {installDiag.map((note) => (
                                    <li key={note} className="leading-relaxed">• {note}</li>
                                ))}
                            </ul>
                        )}
                        {!installDiag && installHelpOpen && (
                            <p className="mt-4 text-xs text-muted">{t('pwa.install.checking')}</p>
                        )}
                        {isFirefoxMobile && (
                            <button
                                type="button"
                                onClick={async () => {
                                    clearInstallBannerDismiss();
                                    try {
                                        if ('serviceWorker' in navigator) {
                                            const regs = await navigator.serviceWorker.getRegistrations();
                                            await Promise.all(regs.map((reg) => reg.unregister()));
                                        }
                                        if ('caches' in window) {
                                            const keys = await caches.keys();
                                            await Promise.all(keys.map((key) => caches.delete(key)));
                                        }
                                    } catch { /* ignore */ }
                                    window.location.reload();
                                }}
                                className="mt-3 w-full inline-flex items-center justify-center rounded-xl border border-border px-4 py-3 text-sm font-bold text-text hover:bg-white/5 transition-colors"
                            >
                                {t('pwa.install.resetReload')}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setInstallHelpOpen(false)}
                            className="mt-3 w-full inline-flex items-center justify-center rounded-xl bg-plex px-4 py-3 text-sm font-bold text-background hover:bg-plex-hover transition-colors"
                        >
                            {t('pwa.install.done')}
                        </button>
                    </div>
                </div>
            )}

            {/* Mobile install nudge — Chromium prompt or iOS/Firefox A2HS guidance. */}
            {showInstallNudge && (
                <div className="md:hidden fixed left-3 right-3 z-[90] rounded-2xl border border-plex/40 bg-card/95 shadow-2xl backdrop-blur-md px-3 py-2.5 flex items-center gap-2"
                    style={{ bottom: 'calc(4.25rem + env(safe-area-inset-bottom, 0px))' }}
                >
                    <div className="w-9 h-9 rounded-xl bg-plex/15 border border-plex/30 flex items-center justify-center text-plex shrink-0">
                        <MonitorSmartphone className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-text truncate">{t('pwa.install.bannerTitle', { server: serverName })}</p>
                        <p className="text-[11px] text-muted">{t('pwa.install.bannerSubtitle')}</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => void handleInstallApp()}
                        className="shrink-0 rounded-xl bg-plex px-3 py-2 text-xs font-bold text-background"
                    >
                        {installPrompt ? t('pwa.install.button') : t('pwa.install.howTo')}
                    </button>
                    <button
                        type="button"
                        onClick={dismissInstallBanner}
                        className="shrink-0 p-1.5 rounded-lg text-muted hover:text-text"
                        aria-label={t('pwa.install.dismiss')}
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            {/* Mobile Bottom Nav
                Chrome / PWA Chromium: plain fixed bottom:0 (do not change).
                Firefox mobile: dock bar to visualViewport bottom (Firefox-only hook). */}
            {(() => {
                const maxPrimary = MOBILE_NAV_PRIMARY_SLOTS;
                const showMore = normalizedNavOrder.length > maxPrimary;
                const primary = showMore ? normalizedNavOrder.slice(0, maxPrimary) : normalizedNavOrder;
                const navButtons = (
                    <>
                        {primary.map((key) => {
                            const item = navItemsConfig[key];
                            if (!item) return null;
                            const isCurrent = item.customTabId
                            ? isNavCurrent(key, item.route, item.customTabId)
                            : (item.route ? isNavCurrent(key, item.route) : false);
                            const labelOverride = key === 'mediastack'
                                ? t('navigation.calendar')
                                : key === 'request'
                                    ? t('navigation.request')
                                    : key === 'media-player'
                                        ? t('navigation.mediaPlayerShort')
                                        : item.label;
                            return renderNavAction(key, { ...item, label: labelOverride }, { mobile: true, isCurrent, compactLabel: labelOverride, badgeCount: getNavBadgeCount(key) });
                        })}
                        {showMore && (
                            <button
                                type="button"
                                className={`relative flex flex-col items-center justify-center gap-1 h-full flex-1 min-w-[4.25rem] px-1 text-center text-[0.65rem] transition-colors bg-transparent border-0 ${
                                    mobileMoreOpen ? 'text-plex font-bold' : 'text-muted hover:text-text'
                                }`}
                                onClick={() => setMobileMoreOpen((open) => !open)}
                            >
                                <span className="relative shrink-0">
                                    <MoreHorizontal className="w-5 h-5" />
                                </span>
                                <span>{t('navigation.more')}</span>
                            </button>
                        )}
                    </>
                );
                const navInner = (
                    <div className="flex items-center justify-between w-full h-16 px-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))]">
                        {navButtons}
                    </div>
                );

                if (firefoxMobileNav && typeof document !== 'undefined') {
                    // Portal to body so no ancestor creates a fixed containing block.
                    // Hook sets top from visualViewport; bleed fills any gesture-bar gap.
                    return ReactDOM.createPortal(
                        <div
                            ref={firefoxNavBarRef}
                            className="md:hidden fixed left-0 w-screen max-w-none nav-shell border-t z-[310] pb-[env(safe-area-inset-bottom,0px)]"
                            style={{ bottom: 0 }}
                        >
                            {navInner}
                            <div
                                className="absolute left-0 w-screen max-w-none nav-shell pointer-events-none"
                                style={{ top: '100%', height: 120, borderTop: 'none' }}
                                aria-hidden="true"
                            />
                        </div>,
                        document.body
                    );
                }

                return (
                    <div className="md:hidden fixed bottom-0 left-0 right-0 w-full nav-shell border-t z-[310] pb-[env(safe-area-inset-bottom)]">
                        {navInner}
                    </div>
                );
            })()}

            {/* Mobile More Drawer — above bottom nav (incl. Firefox body-portaled bar) */}
            {mobileMoreOpen && (
                <div className="md:hidden fixed inset-0 z-[320] bg-black/60 backdrop-blur-sm animate-fade-in flex flex-col justify-end" onClick={() => setMobileMoreOpen(false)}>
                    <div className="bg-card border-t border-border rounded-t-2xl animate-slide-up" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-4 border-b border-white/5">
                            <h3 className="font-bold text-text">{t('navigation.moreMenu')}</h3>
                            <button className="text-muted hover:text-text p-1 bg-white/5 rounded-full" onClick={() => setMobileMoreOpen(false)}><X className="w-5 h-5" /></button>
                        </div>
                        <div className="p-5 grid grid-cols-4 gap-4">
                            {(() => {
                                const maxPrimary = MOBILE_NAV_PRIMARY_SLOTS;
                                const secondary = normalizedNavOrder.length > maxPrimary ? normalizedNavOrder.slice(maxPrimary) : [];
                                return secondary.map(key => {
                                    const item = navItemsConfig[key];
                                    if (!item) return null;
                                    const isCurrent = item.customTabId
                            ? isNavCurrent(key, item.route, item.customTabId)
                            : (item.route ? isNavCurrent(key, item.route) : false);
                                    const labelOverride = key === 'mediastack' ? t('navigation.calendar') : key === 'request' ? t('navigation.request') : item.label;
                                    const handleActivate = () => {
                                        setMobileMoreOpen(false);
                                        if (item.customTabId) {
                                            onNavigate('external', { path: `/external/${encodeURIComponent(item.customTabId)}` });
                                            return;
                                        }
                                        if (item.href) window.open(item.href, '_blank');
                                        else if (item.onClick) item.onClick({ preventDefault: () => {} });
                                        else if (item.route) onNavigate(item.route as any);
                                    };
                                    const badgeCount = getNavBadgeCount(key);
                                    const betaTitle = item.beta
                                        ? t(NAV_BETA_NOTICE_KEYS[item.route] || 'spotifySyncPage.betaNotice')
                                        : '';
                                    const alphaTitle = item.alpha
                                        ? t(NAV_ALPHA_NOTICE_KEYS[item.route] || 'mediaPlayerPage.alphaNotice')
                                        : '';
                                    return (
                                        <button key={key} onClick={handleActivate} className="flex flex-col items-center gap-2 relative bg-transparent border-0">
                                            <div className={`relative w-[3.25rem] h-[3.25rem] rounded-full flex items-center justify-center transition-colors ${isCurrent ? 'bg-plex text-background shadow-[0_0_15px_rgba(229,160,13,0.35)]' : 'bg-background/50 text-text hover:bg-white/10 border border-white/5'}`}>
                                                <item.icon className="w-6 h-6" />
                                                {item.alpha ? (
                                                    <AlphaBadge
                                                        title={alphaTitle}
                                                        className="absolute -bottom-1.5 left-1/2 z-[1] -translate-x-1/2 px-1 py-0 text-[7px] leading-none"
                                                    />
                                                ) : item.beta ? (
                                                    <BetaBadge
                                                        title={betaTitle}
                                                        className="absolute -bottom-1.5 left-1/2 z-[1] -translate-x-1/2 px-1 py-0 text-[7px] leading-none"
                                                    />
                                                ) : null}
                                            </div>
                                            {badgeCount > 0 && (
                                                <span className="absolute -top-1 -right-1 w-[18px] h-[18px] rounded-full bg-plex text-background text-[10px] font-bold flex items-center justify-center leading-none">
                                                    {badgeCount > 9 ? '9+' : badgeCount}
                                                </span>
                                            )}
                                            <span className={`text-[10px] text-center w-full truncate px-1 ${isCurrent ? 'text-plex font-bold' : 'text-muted'}`}>{labelOverride}</span>
                                        </button>
                                    );
                                });
                            })()}
                            {!isInstalledApp && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setMobileMoreOpen(false);
                                        void handleInstallApp();
                                    }}
                                    className="flex flex-col items-center gap-2 relative bg-transparent border-0"
                                >
                                    <div className="w-[3.25rem] h-[3.25rem] rounded-full flex items-center justify-center transition-colors bg-background/50 text-text hover:bg-white/10 border border-white/5">
                                        <MonitorSmartphone className="w-6 h-6" />
                                    </div>
                                    <span className="text-[10px] text-center w-full truncate px-1 text-muted">{t('pwa.install.button')}</span>
                                </button>
                            )}
                        </div>
                        <div className="pb-[calc(env(safe-area-inset-bottom)+1rem)]"></div>
                    </div>
                </div>
            )}
        </>
    );
};

export const PublicInviteClaim: React.FC<{ code: string }> = ({ code }) => {
    const [info, setInfo] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [claimed, setClaimed] = useState(false);
    const [isClaiming, setIsClaiming] = useState(false);

    useEffect(() => {
        apiFetch(`/api/invites/${code}/info`).then(setInfo).catch(e => setError(e.message || 'Invalid invite link'));
    }, [code]);

    const handleClaim = useCallback(async (token: string) => {
        setIsClaiming(true);
        try {
            await apiFetch(`/api/invites/${code}/claim`, {
                method: 'POST',
                body: JSON.stringify({ pinId: token })
            });
            setClaimed(true);
        } catch (e: any) {
            setError(e.message || 'Failed to claim invite');
        } finally {
            setIsClaiming(false);
        }
    }, [code]);

    useEffect(() => {
        const hash = window.location.hash;
        if (hash.startsWith('#auth/')) {
            const token = hash.split('/')[1];
            if (token) {
                window.location.hash = ''; // clear hash
                handleClaim(token);
            }
        }
    }, [handleClaim]);

    const handlePlexLogin = async () => {
        setIsClaiming(true);
        setError(null);
        try {
            const data = await apiFetch('/api/auth/plex/login', { method: 'POST' });
            const clientId = data.clientIdentifier || data.clientId || '';
            const forwardUrl = window.location.origin + portalUrl('/invite/' + code) + '#auth/' + data.id;
            const authUrl = `https://app.plex.tv/auth#?clientID=${encodeURIComponent(clientId)}&code=${data.code}&context[device][product]=StreamPilot&forwardUrl=${encodeURIComponent(forwardUrl)}`;
            window.location.href = authUrl;
        } catch (error) {
            setError('Failed to initiate Plex login');
            setIsClaiming(false);
        }
    };

    if (error) return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center max-w-md w-full animate-fade-in mx-auto px-4 mt-20">
            <div className="bg-red-500/10 border border-red-500/30 p-8 rounded-2xl w-full">
                <h2 className="text-2xl font-bold text-red-500 mb-4">Invite Error</h2>
                <p className="text-text">{error}</p>
                <a href={portalUrl('/')} className="mt-6 inline-block text-plex hover:underline font-bold">Return to Home</a>
            </div>
        </div>
    );

    if (claimed) return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center max-w-md w-full animate-fade-in mx-auto px-4 mt-20">
            <div className="bg-green-500/10 border border-green-500/30 p-8 rounded-2xl w-full">
                <h2 className="text-3xl font-bold text-green-500 mb-4">Success!</h2>
                <p className="text-text mb-6">You have successfully claimed your invite to <strong className="text-plex">{info?.serverName}</strong>. Check your email or open Plex to accept the shared server invite!</p>
                <a href={portalUrl('/')} className="inline-block px-6 py-3 bg-plex text-background font-bold rounded-lg hover:bg-plex-hover transition-colors shadow-lg">Go to Dashboard</a>
            </div>
        </div>
    );

    if (!info) return <Loader isLoading={true} />;

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center max-w-lg w-full animate-fade-in mx-auto px-4 mt-20">
            <div className="relative mb-8 flex justify-center w-full max-w-lg px-2">
                {!(info.customLoginLogoUrl || info.customLogoUrl || info.thumb) ? (
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-16 bg-plex/20 rounded-full blur-[50px] pointer-events-none" />
                ) : (
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-plex rounded-full blur-[50px] opacity-20 pointer-events-none" />
                )}
                <LoginBrandMark
                    size="lg"
                    src={info.customLoginLogoUrl || info.customLogoUrl || info.thumb
                        ? resolvePortalAssetUrl(info.customLoginLogoUrl || info.customLogoUrl || info.thumb)
                        : null}
                    circleFrame={Boolean(info.customLoginLogoUrl || info.customLogoUrl || info.thumb) && info.loginLogoCircleFrame !== false}
                    className="drop-shadow-[0_0_15px_rgba(229,160,13,0.25)]"
                />
            </div>

            <h1 className="text-4xl md:text-5xl font-bold text-text mb-4">You've been invited!</h1>
            <p className="text-xl text-muted mb-8 leading-relaxed">
                You have been invited to join <strong className="text-plex">{info.serverName}</strong> for a period of <strong className="text-plex">{info.durationDays} days</strong>.
            </p>

            {info.showPublicLibraryStats !== false && (
                <div className="w-full mb-8">
                    <LivePlexStats />
                </div>
            )}

            <button
                onClick={handlePlexLogin}
                disabled={isClaiming}
                className="w-full max-w-sm px-6 py-4 bg-plex text-background text-lg font-bold rounded-xl hover:bg-plex-hover transition-all transform hover:scale-105 active:scale-95 shadow-lg shadow-plex/20 flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {!isClaiming ? (
                    <img src={PLEX_ICON_URL} alt="" className="w-6 h-6 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                ) : null}
                {isClaiming ? 'Claiming...' : 'Sign in with Plex to Claim'}
            </button>
            <p className="mt-6 text-sm text-muted">You will be redirected to Plex.tv to securely authenticate your account.</p>
        </div>
    );
};
