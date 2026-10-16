import type { HomeCustomModule } from './types';
import {
    canAccessHomeCustomModule,
    isHomeCustomModuleSectionId,
    normalizeDashboardSectionIds,
    parseHomeCustomModuleSectionId,
} from './homeCustomModules';

export type BuiltInDashboardSectionId = 'wrapUp' | 'mainGrid' | 'pendingRequests' | 'watchRow' | 'scanner' | 'spotifySync' | 'mediaAutomation' | 'recentlyAdded' | 'bazarrTools';

export type DashboardSectionId = BuiltInDashboardSectionId | `customModule:${string}`;

export type MainGridWidgetId =
    | 'adminBadge'
    | 'accessStatus'
    | 'tempAccessSetup'
    | 'quickActions'
    | 'expiringMembers'
    | 'announcement'
    | 'referral'
    | 'support'
    | 'libraryStats'
    | 'collexions'
    | 'analytics'
    | 'achievements'
    | 'homeNotifications';

export type RecentlyAddedWidgetId = 'recentMovies' | 'recentShows' | 'recentMusic';

export type DashboardWidgetId = MainGridWidgetId | RecentlyAddedWidgetId;
export type DashboardWidgetSize = 'compact' | 'normal' | 'wide' | 'full';

export interface DashboardLayoutConfig {
    version: 1;
    sections: DashboardSectionId[];
    mainGridOrder: MainGridWidgetId[];
    recentlyAddedOrder: RecentlyAddedWidgetId[];
    hiddenSections: DashboardSectionId[];
    hiddenWidgets: DashboardWidgetId[];
    widgetSizes: Partial<Record<DashboardWidgetId, DashboardWidgetSize>>;
    widgetColumns: Partial<Record<DashboardWidgetId, number>>;
    recentHistoryRows?: number;
    topWatchedRows?: number;
}

export const DASHBOARD_SECTION_LABELS: Record<DashboardSectionId, string> = {
    wrapUp: 'Personal Wrap-Up',
    mainGrid: 'Main dashboard grid',
    pendingRequests: 'Pending Requests',
    watchRow: 'Recently / Most Watched',
    scanner: 'Scanner',
    spotifySync: 'Spotify Sync',
    mediaAutomation: 'Media Automation',
    recentlyAdded: 'Recently Added rows',
    bazarrTools: 'Bazarr Subtitle Tools',
};

export const MAIN_GRID_WIDGET_META: Record<MainGridWidgetId, { label: string; column: 'left' | 'right'; adminOnly?: boolean; userOnly?: boolean }> = {
    adminBadge: { label: 'Server Admin badge', column: 'left', adminOnly: true },
    quickActions: { label: 'Quick Actions', column: 'left', adminOnly: true },
    expiringMembers: { label: 'Expiring members this week', column: 'left', adminOnly: true },
    accessStatus: { label: 'Access status & expiry', column: 'left', userOnly: true },
    tempAccessSetup: { label: 'Temp access setup spinner', column: 'left', userOnly: true },
    announcement: { label: 'Announcement banner', column: 'left' },
    referral: { label: 'Invite Friends / referral', column: 'left', userOnly: true },
    support: { label: 'Need Help / contact', column: 'left', userOnly: true },
    libraryStats: { label: 'Server Library Size', column: 'right' },
    collexions: { label: 'ColleXions', column: 'right', adminOnly: true },
    analytics: { label: 'Your Analytics', column: 'right' },
    achievements: { label: 'Achievements XP', column: 'left' },
    homeNotifications: { label: 'Notifications', column: 'left' },
};

export const RECENTLY_ADDED_WIDGET_META: Record<RecentlyAddedWidgetId, string> = {
    recentMovies: 'Recently Added Movies',
    recentShows: 'Recently Added TV Shows',
    recentMusic: 'Recently Added Music',
};

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayoutConfig = {
    version: 1,
    sections: ['wrapUp', 'mainGrid', 'pendingRequests', 'watchRow', 'scanner', 'spotifySync', 'mediaAutomation', 'recentlyAdded', 'bazarrTools'],
    mainGridOrder: [
        'adminBadge',
        'quickActions',
        'expiringMembers',
        'achievements',
        'homeNotifications',
        'accessStatus',
        'announcement',
        'referral',
        'support',
        'libraryStats',
        'collexions',
        'analytics',
    ],
    recentlyAddedOrder: ['recentMovies', 'recentShows', 'recentMusic'],
    hiddenSections: [],
    hiddenWidgets: [],
    widgetSizes: {},
    widgetColumns: {},
    recentHistoryRows: 7,
    topWatchedRows: 2,
};

const ALL_SECTIONS: BuiltInDashboardSectionId[] = ['wrapUp', 'mainGrid', 'pendingRequests', 'watchRow', 'scanner', 'spotifySync', 'mediaAutomation', 'recentlyAdded', 'bazarrTools'];
const ALL_MAIN_GRID: MainGridWidgetId[] = Object.keys(MAIN_GRID_WIDGET_META) as MainGridWidgetId[];
const ALL_RECENTLY_ADDED: RecentlyAddedWidgetId[] = ['recentMovies', 'recentShows', 'recentMusic'];
const ALL_WIDGETS: DashboardWidgetId[] = [...ALL_MAIN_GRID, ...ALL_RECENTLY_ADDED];
const ALL_WIDGET_SIZES: DashboardWidgetSize[] = ['compact', 'normal', 'wide', 'full'];

const uniqueValid = <T extends string>(values: unknown, allowed: T[], fallback: T[], fillMissing = true): T[] => {
    if (!Array.isArray(values)) return [...fallback];
    const seen = new Set<T>();
    const result: T[] = [];
    values.forEach((value) => {
        if (typeof value !== 'string') return;
        const id = value as T;
        if (!allowed.includes(id) || seen.has(id)) return;
        seen.add(id);
        result.push(id);
    });
    if (fillMissing) {
        allowed.forEach((id, defaultIndex) => {
            if (seen.has(id)) return;
            let insertAt = result.length;
            for (let i = defaultIndex - 1; i >= 0; i -= 1) {
                const prevIdx = result.indexOf(allowed[i]);
                if (prevIdx >= 0) {
                    insertAt = prevIdx + 1;
                    break;
                }
            }
            if (insertAt === result.length) {
                for (let i = defaultIndex + 1; i < allowed.length; i += 1) {
                    const nextIdx = result.indexOf(allowed[i]);
                    if (nextIdx >= 0) {
                        insertAt = nextIdx;
                        break;
                    }
                }
            }
            result.splice(insertAt, 0, id);
            seen.add(id);
        });
    }
    return result;
};

const normalizeWidgetSizes = (values: unknown): Partial<Record<DashboardWidgetId, DashboardWidgetSize>> => {
    if (!values || typeof values !== 'object') return {};
    const result: Partial<Record<DashboardWidgetId, DashboardWidgetSize>> = {};
    Object.entries(values as Record<string, unknown>).forEach(([key, value]) => {
        if (!ALL_WIDGETS.includes(key as DashboardWidgetId)) return;
        if (!ALL_WIDGET_SIZES.includes(value as DashboardWidgetSize)) return;
        if (value !== 'normal') result[key as DashboardWidgetId] = value as DashboardWidgetSize;
    });
    return result;
};

const normalizeWidgetColumns = (values: unknown): Partial<Record<DashboardWidgetId, number>> => {
    if (!values || typeof values !== 'object') return {};
    const result: Partial<Record<DashboardWidgetId, number>> = {};
    Object.entries(values as Record<string, unknown>).forEach(([key, value]) => {
        if (!ALL_WIDGETS.includes(key as DashboardWidgetId)) return;
        const column = Math.max(1, Math.min(12, Math.floor(Number(value))));
        if (Number.isFinite(column)) result[key as DashboardWidgetId] = column;
    });
    return result;
};

const migrateDashboardSections = (sections: DashboardSectionId[]): DashboardSectionId[] => {
    const next = sections.filter((id, index) => !ALL_SECTIONS.includes(id as BuiltInDashboardSectionId) || id !== 'pendingRequests' || sections.indexOf('pendingRequests') === index);
    const mainGridIndex = next.indexOf('mainGrid');
    if (!next.includes('pendingRequests') && mainGridIndex >= 0) {
        next.splice(mainGridIndex + 1, 0, 'pendingRequests');
    } else if (!next.includes('pendingRequests')) {
        next.push('pendingRequests');
    }
    // Only seed missing sections — never force-reorder saved Home Layout order.
    if (!next.includes('scanner')) {
        const ra = next.indexOf('recentlyAdded');
        if (ra >= 0) next.splice(ra, 0, 'scanner');
        else next.push('scanner');
    }
    if (!next.includes('mediaAutomation')) {
        const scannerIndex = next.indexOf('scanner');
        const recentlyAddedIndex = next.indexOf('recentlyAdded');
        const insertAt = scannerIndex >= 0 ? scannerIndex + 1 : recentlyAddedIndex;
        if (insertAt >= 0) next.splice(insertAt, 0, 'mediaAutomation');
        else next.push('mediaAutomation');
    }
    if (!next.includes('spotifySync')) {
        const scannerIndex = next.indexOf('scanner');
        const mediaAutomationIndex = next.indexOf('mediaAutomation');
        const insertAt = scannerIndex >= 0 ? scannerIndex + 1 : mediaAutomationIndex;
        if (insertAt >= 0) next.splice(insertAt, 0, 'spotifySync');
        else next.push('spotifySync');
    }
    if (!next.includes('bazarrTools')) next.push('bazarrTools');
    return next;
};

/** Move Achievements under Quick Actions when it still sits in the old right-column default. */
const migrateMainGridOrder = (order: MainGridWidgetId[]): MainGridWidgetId[] => {
    const achIdx = order.indexOf('achievements');
    const qaIdx = order.indexOf('quickActions');
    if (achIdx < 0 || qaIdx < 0) return order;
    if (achIdx === qaIdx + 1) return order;
    const analyticsIdx = order.indexOf('analytics');
    const looksLikeOldDefault =
        achIdx === order.length - 1
        || (analyticsIdx >= 0 && achIdx === analyticsIdx + 1);
    if (!looksLikeOldDefault) return order;
    const next = order.filter((id) => id !== 'achievements');
    next.splice(next.indexOf('quickActions') + 1, 0, 'achievements');
    return next;
};

export type NormalizeDashboardLayoutOptions = {
    homeCustomModules?: HomeCustomModule[];
};

export const normalizeDashboardLayout = (raw: unknown, options: NormalizeDashboardLayoutOptions = {}): DashboardLayoutConfig => {
    const moduleIds = new Set(
        (options.homeCustomModules || [])
            .filter((module) => module.enabled)
            .map((module) => String(module.id)),
    );
    const input = raw && typeof raw === 'object' ? (raw as Partial<DashboardLayoutConfig>) : {};
    return {
        version: 1,
        sections: migrateDashboardSections(
            normalizeDashboardSectionIds(input.sections, ALL_SECTIONS, DEFAULT_DASHBOARD_LAYOUT.sections, moduleIds) as DashboardSectionId[],
        ),
        mainGridOrder: migrateMainGridOrder(
            uniqueValid(input.mainGridOrder, ALL_MAIN_GRID, DEFAULT_DASHBOARD_LAYOUT.mainGridOrder),
        ),
        recentlyAddedOrder: uniqueValid(input.recentlyAddedOrder, ALL_RECENTLY_ADDED, DEFAULT_DASHBOARD_LAYOUT.recentlyAddedOrder),
        hiddenSections: normalizeDashboardSectionIds(input.hiddenSections, ALL_SECTIONS, [], moduleIds, { fillMissingBuiltIn: false }) as DashboardSectionId[],
        hiddenWidgets: uniqueValid(input.hiddenWidgets, ALL_WIDGETS, [], false),
        widgetSizes: normalizeWidgetSizes(input.widgetSizes),
        widgetColumns: normalizeWidgetColumns(input.widgetColumns),
        recentHistoryRows: typeof input.recentHistoryRows === 'number' ? input.recentHistoryRows : DEFAULT_DASHBOARD_LAYOUT.recentHistoryRows,
        topWatchedRows: typeof input.topWatchedRows === 'number' ? input.topWatchedRows : DEFAULT_DASHBOARD_LAYOUT.topWatchedRows,
    };
};

export type DashboardLayoutContext = {
    isAdmin: boolean;
    hasUser: boolean;
    referralEnabled?: boolean;
    requestsQueueEnabled?: boolean;
    collexionsEnabled?: boolean;
    scannerHomeWidgetEnabled?: boolean;
    spotifySyncHomeWidgetEnabled?: boolean;
    mediaAutomationHomeWidgetEnabled?: boolean;
    achievementsEnabled?: boolean;
    achievementsHomeWidgetEnabled?: boolean;
    mediaServerType?: string;
    homeCustomModules?: HomeCustomModule[];
};

export const isMainGridWidgetAvailable = (id: MainGridWidgetId, ctx: DashboardLayoutContext): boolean => {
    const meta = MAIN_GRID_WIDGET_META[id];
    if (meta.adminOnly && !ctx.isAdmin) return false;
    if (meta.userOnly && ctx.isAdmin) return false;
    if (id === 'referral' && !ctx.referralEnabled) return false;
    if (id === 'tempAccessSetup') {
        if (ctx.isAdmin || ctx.hasUser) return false;
        if (String(ctx.mediaServerType || 'plex').toLowerCase() !== 'plex') return false;
    }
    if (id === 'accessStatus' && (ctx.isAdmin || !ctx.hasUser)) return false;
    if (id === 'adminBadge' && !ctx.isAdmin) return false;
    if (id === 'quickActions' && !ctx.isAdmin) return false;
    if (id === 'collexions') {
        if (!ctx.collexionsEnabled) return false;
        // Collexions is a Plex-only integration.
        if (String(ctx.mediaServerType || 'plex').toLowerCase() !== 'plex') return false;
    }
    if (id === 'analytics') {
        if (!['jellyfin', 'emby'].includes(String(ctx.mediaServerType || '').toLowerCase())) return false;
    }
    if (id === 'achievements') {
        if (!ctx.achievementsEnabled) return false;
        if (ctx.achievementsHomeWidgetEnabled === false) return false;
    }
    return true;
};

export const resolveMainGridWidgets = (layout: DashboardLayoutConfig, ctx: DashboardLayoutContext): MainGridWidgetId[] =>
    layout.mainGridOrder.filter(
        (id) => !layout.hiddenWidgets.includes(id) && isMainGridWidgetAvailable(id, ctx)
    );

export const splitMainGridForDesktop = (widgets: MainGridWidgetId[]) => ({
    left: widgets.filter((id) => MAIN_GRID_WIDGET_META[id].column === 'left'),
    right: widgets.filter((id) => MAIN_GRID_WIDGET_META[id].column === 'right'),
});

export const resolveRecentlyAddedWidgets = (layout: DashboardLayoutConfig): RecentlyAddedWidgetId[] =>
    layout.recentlyAddedOrder.filter((id) => !layout.hiddenWidgets.includes(id));

export const isDashboardSectionAvailable = (id: DashboardSectionId, ctx: DashboardLayoutContext): boolean => {
    if (isHomeCustomModuleSectionId(id)) {
        const moduleId = parseHomeCustomModuleSectionId(id);
        const module = ctx.homeCustomModules?.find((entry) => String(entry.id) === moduleId);
        return canAccessHomeCustomModule(module, !!ctx.isAdmin);
    }
    if (id === 'pendingRequests') return !!ctx.isAdmin;
    if (id === 'bazarrTools') return !!ctx.isAdmin;
    if (id === 'scanner') return !!ctx.isAdmin && !!ctx.scannerHomeWidgetEnabled;
    if (id === 'spotifySync') return !!ctx.isAdmin && !!ctx.spotifySyncHomeWidgetEnabled;
    if (id === 'mediaAutomation') return !!ctx.isAdmin && !!ctx.mediaAutomationHomeWidgetEnabled;
    return true;
};

export const resolveDashboardSections = (layout: DashboardLayoutConfig, ctx?: DashboardLayoutContext): DashboardSectionId[] =>
    layout.sections.filter(
        (id) => !layout.hiddenSections.includes(id) && (!ctx || isDashboardSectionAvailable(id, ctx))
    );

export const normalizeSectionLayout = (raw: unknown, options: NormalizeDashboardLayoutOptions = {}): DashboardLayoutConfig => {
    const normalized = normalizeDashboardLayout(raw, options);
    const input = raw && typeof raw === 'object' ? (raw as Partial<DashboardLayoutConfig>) : null;
    if (!input || !Array.isArray(input.hiddenSections)) {
        return { ...normalized, hiddenSections: [] };
    }
    if (normalized.hiddenSections.length >= normalized.sections.length) {
        return { ...normalized, hiddenSections: [] };
    }
    if (normalized.hiddenWidgets.length >= ALL_WIDGETS.length) {
        return { ...normalized, hiddenWidgets: [] };
    }
    return normalized;
};

export const SECTION_PREVIEW_META: Record<
    DashboardSectionId,
    { shortLabel: string; description: string; previewClass: string }
> = {
    wrapUp: {
        shortLabel: 'Wrap-Up',
        description: 'Personal stats cards',
        previewClass: 'h-14',
    },
    mainGrid: {
        shortLabel: 'Main grid',
        description: 'Admin/actions left · library stats right',
        previewClass: 'h-20',
    },
    pendingRequests: {
        shortLabel: 'Pending requests',
        description: 'Approve media requests from home (admin)',
        previewClass: 'h-12',
    },
    watchRow: {
        shortLabel: 'Watch history',
        description: 'Recently watched & most watched',
        previewClass: 'h-16',
    },
    scanner: {
        shortLabel: 'Scanner',
        description: 'Full-width library refresh status',
        previewClass: 'h-14',
    },
    spotifySync: {
        shortLabel: 'Spotify Sync',
        description: 'Playlist sync sidecar status',
        previewClass: 'h-14',
    },
    mediaAutomation: {
        shortLabel: 'Media Automation',
        description: 'Native processing queue and worker status',
        previewClass: 'h-14',
    },
    recentlyAdded: {
        shortLabel: 'Recently added',
        description: 'Movies, shows & music rows',
        previewClass: 'h-12',
    },
    bazarrTools: {
        shortLabel: 'Bazarr',
        description: 'Subtitle automation widget',
        previewClass: 'h-12',
    },
};
