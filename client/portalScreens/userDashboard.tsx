import { AlertTriangle,Calendar,ChevronDown,ChevronUp,Clock,Eye,EyeOff,Loader2,PlaySquare,RefreshCw,Settings,Share2,Sparkles,X } from 'lucide-react';
import React,{ useCallback,useEffect,useMemo,useRef,useState } from 'react';

import { DiscoverNowPlayingStrip } from '../discovery/DiscoverNowPlayingStrip';
import { useDiscoverI18n } from '../discovery/i18n';
import { BecauseYouWatchedHomeRail } from '../home/BecauseYouWatchedHomeRail';
import { userAllowsHomeBecauseYouWatched } from '../home/becauseYouWatchedPref.js';
import { HomeCustomModuleSection } from '../home/HomeCustomModuleSection';
import { HomeHeroMovieBackdrop } from '../home/HomeHeroMovieBackdrop';
import { HomeHeroPlaybackBackdrop,useNowPlayingHeroArt } from '../home/HomeHeroPlaybackBackdrop';
import { NowPlayingCompanionPanel } from '../home/NowPlayingCompanionPanel';
import { UserDashboardLayout } from '../home/UserDashboardLayout';
import { createBazarrToolsSectionRenderer,createMainGridWidgetRenderer,createMediaAutomationSectionRenderer,createPendingRequestsSectionRenderer,createRecentlyAddedWidgetRenderer,createScannerSectionRenderer,createSpotifySyncSectionRenderer } from '../home/userDashboardWidgetRenderers';
import { goToProfile,titleDiscoveryPath } from '../profile/helpers';
import { ActivityHeatmap } from '../shared/ActivityHeatmap';
import { ANALYTICS_PERIOD_OPTIONS,persistAnalyticsDays,readPersistedAnalyticsDays } from '../shared/analyticsPeriodOptions';
import { apiFetch,apiFetchShared } from '../shared/api';
import { logoUrl,portalUrl,resolvePortalAssetUrl } from '../shared/basePath';
import {
DASHBOARD_SECTION_LABELS,
DEFAULT_DASHBOARD_LAYOUT,
MAIN_GRID_WIDGET_META,
RECENTLY_ADDED_WIDGET_META,
normalizeSectionLayout,
type BuiltInDashboardSectionId,
type DashboardLayoutConfig,
type DashboardSectionId,
type DashboardWidgetId,
type DashboardWidgetSize,
type MainGridWidgetId,
type RecentlyAddedWidgetId,
} from '../shared/dashboardLayout';
import { formatPortalDateTime,formatTime,getAccessProgressPct,getDaysUntilExpiry } from '../shared/format';
import { getHomeCustomModuleLabel,isHomeCustomModuleSectionId } from '../shared/homeCustomModules';
import { PeriodDropdown } from '../shared/PeriodDropdown';
import { sizedPlexImageUrl } from '../shared/plexImageUrl';
import { DEFAULT_POSTER_GRID_SCALE,upgraderPosterGridClass,upgraderPosterGridStyle,type PosterGridValue } from '../shared/portalLayout';
import { ShareWrapUpModal } from '../shared/ShareWrapUp';
import {
HomeRecentlyAddedSkeleton,
TopWatchedGridSkeleton,
WrapUpCardsSkeleton
} from '../shared/skeletons';
import { SlideshowBackground } from '../shared/theme';
import { Loader,Toast } from '../shared/toast';
import type { HomeCustomModule,ToastMessage } from '../shared/types';
import { ScrollReveal } from '../shared/ui';
import { useNowPlaying } from '../shared/useNowPlaying';
import { usePoll } from '../shared/usePoll';
import { usePullToRefresh } from '../shared/usePullToRefresh';
import { WatchHistoryMediaCard,formatWatchHistoryWhen } from '../shared/WatchHistoryMediaCard';
import { AchievementsWrapUpSpotlight,WrapUpCardGrid,formatWrapUpDelta,periodLabel,wrapUpPriorPeriodLabel } from '../shared/WrapUpCards';
import { WrapUpModal } from '../shared/WrapUpModal';
import { WrapUpRecapModal } from '../shared/WrapUpRecapModal';
import { DetailsModal } from './analytics';
import { ReportIssueModal,readNowPlayingCompanionEnabled,writeNowPlayingCompanionEnabled } from './common';
import { DiscoverPosterCard,discoverViewsOverlay } from './discoverCard';
import { RebuildLibraryCacheButton } from './login';


export const DISCOVER_DESKTOP_ITEM_LIMIT = 20;
export const DISCOVER_MOBILE_ITEM_LIMIT = 12;
const RECENTLY_ADDED_ITEM_LIMIT = 100;
export const DISCOVER_LIMIT_OPTIONS = [
    { value: '12', label: '12' },
    { value: '20', label: '20' },
    { value: '25', label: '25' },
    { value: '50', label: '50' },
    { value: '100', label: '100' },
    { value: '150', label: '150' },
    { value: '200', label: '200' },
    { value: '250', label: '250' },
];

export const TrendingDiscoverSection: React.FC<{ title: string; items: any[]; limit: number; showQualityBadges?: boolean; useScrollRevealAnimations?: boolean; onItemClick?: (item: any) => void; gridSize?: PosterGridValue }> = ({ title, items, limit, showQualityBadges = true, useScrollRevealAnimations, onItemClick, gridSize = DEFAULT_POSTER_GRID_SCALE }) => {
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
        if (list === 'main') {
            onChange(normalizeLayout({ ...layout, mainGridOrder: moveDashboardItemTo(layout.mainGridOrder, source.index, targetIndex) }));
            return;
        }
        onChange(normalizeLayout({ ...layout, recentlyAddedOrder: moveDashboardItemTo(layout.recentlyAddedOrder, source.index, targetIndex) }));
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

    const wrapUpClientCacheKey = (days: number | string) => `smp.wrapup.analytics.v5:${wrapUpSubjectId}:${days}`;
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
