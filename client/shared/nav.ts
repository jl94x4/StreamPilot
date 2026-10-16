export type NavFeatureFlags = {
    maintenance?: boolean;
    upgrader?: boolean;
    collexions?: boolean;
    spotifySync?: boolean;
    spotifySyncHomeWidget?: boolean;
    metadataFill?: boolean;
    scanner?: boolean;
    mediaAutomation?: boolean;
    posterSets?: boolean;
    overlays?: boolean;
    editions?: boolean;
    watchSync?: boolean;
    achievements?: boolean;
    /** Achievements XP/badge leaderboard (requires achievements). Default true when achievements on. */
    achievementsLeaderboard?: boolean;
    support?: boolean;
    request?: boolean;
    requestsQueue?: boolean;
    /** When false, Downloads is hidden from non-admins. Default/undefined = visible. */
    downloads?: boolean;
    /** Community live chat (Discord-style channels). */
    chat?: boolean;
    /** In-portal Plex client (Plex-only, default on). */
    mediaPlayer?: boolean;
};

/** Default sidebar order matching Settings → Layout → Navigation stock layout. */
export const DEFAULT_NAV_ORDER = [
    'home',
    'discover',
    'request',
    'media-player',
    'analytics',
    'users',
    'downloads',
    'upgrader',
    'collexions',
    'spotify-sync',
    'metadata-fill',
    'scanner',
    'media-automation',
    'poster-sets',
    'overlays',
    'editions',
    'watch-sync',
    'mediastack',
    'status',
    // After the usual primary/secondary slots so stock mobile bars stay uncrowded.
    'achievements',
    'chat',
    'support',
    'maintenance',
    'about',
    'profile',
    'preferences',
    'settings',
    'logout',
] as const;

/** Mobile bottom bar shows this many items before the "More" overflow menu. */
export const MOBILE_NAV_PRIMARY_SLOTS = 5;

/** Labels must match the sidebar (`Navigation` in screens.tsx). */
export const NAV_ITEM_LABELS: Record<string, string> = {
    home: 'Home',
    discover: 'Dashboard',
    request: 'Discover & Request',
    'media-player': 'Media Player',
    analytics: 'Analytics',
    achievements: 'Achievements',
    chat: 'Chat',
    support: 'Support',
    users: 'Users',
    downloads: 'Downloads',
    upgrader: 'Upgrader',
    collexions: 'ColleXions',
    'spotify-sync': 'Spotify Sync',
    'metadata-fill': 'Metadata Fill',
    scanner: 'Scanner',
    'media-automation': 'Media Automation',
    'poster-sets': 'Poster Sets',
    overlays: 'Overlays',
    editions: 'Editions',
    'watch-sync': 'Watch Sync',
    mediastack: 'Calendar',
    requests: 'Requests',
    status: 'Status',
    maintenance: 'Cleaner',
    about: 'About',
    profile: 'Profile',
    preferences: 'Preferences',
    settings: 'Settings',
    logs: 'Logs',
    logout: 'Logout',
};

const ADMIN_ONLY_NAV_KEYS = new Set([
    'users',
    'upgrader',
    'collexions',
    'spotify-sync',
    'metadata-fill',
    'scanner',
    'media-automation',
    'poster-sets',
    'overlays',
    'editions',
    'watch-sync',
    'requests',
    'maintenance',
    'settings',
    'logs',
    // Alpha: keep off member nav until playback always uses their Plex identity.
    'media-player',
]);

/** Keys admins see that members never get in their nav (even if present in order). */
export const isAdminOnlyNavKey = (key: string) => ADMIN_ONLY_NAV_KEYS.has(key);

/** Keys that can appear in the members / non-admin nav editor. */
export const isMemberNavKey = (key: string) => !ADMIN_ONLY_NAV_KEYS.has(key);

export const DEFAULT_MEMBER_NAV_ORDER = DEFAULT_NAV_ORDER.filter((key) => isMemberNavKey(key));

export const getNavItemLabel = (key: string, options?: { adminSuffix?: boolean; downloadsMembersVisible?: boolean }) => {
    const base = NAV_ITEM_LABELS[key] || key;
    if (options?.adminSuffix) {
        if (ADMIN_ONLY_NAV_KEYS.has(key)) return `${base} (Admin Only)`;
        if (key === 'downloads' && options.downloadsMembersVisible === false) {
            return `${base} (Admin Only)`;
        }
    }
    return base;
};

const LEGACY_DEFAULT_NAV_ORDERS = [
    ['home', 'discover', 'users', 'status', 'analytics', 'downloads', 'mediastack', 'maintenance', 'request', 'about', 'settings', 'logout'],
    ['home', 'discover', 'users', 'analytics', 'downloads', 'mediastack', 'upgrader', 'requests', 'status', 'maintenance', 'request', 'about', 'logs', 'settings', 'logout'],
    ['home', 'discover', 'status', 'analytics', 'mediastack', 'request', 'about', 'settings', 'logout'],
    ['home', 'discover', 'status', 'analytics', 'request', 'users', 'downloads', 'mediastack', 'maintenance', 'about', 'settings', 'logout'],
    ['home', 'discover', 'request', 'analytics', 'users', 'downloads', 'upgrader', 'mediastack', 'requests', 'status', 'maintenance', 'about', 'settings', 'logout'],
    // Achievements landed early in the first opt-in default and crowded the mobile bar.
    ['home', 'discover', 'request', 'analytics', 'achievements', 'users', 'downloads', 'upgrader', 'collexions', 'scanner', 'media-automation', 'poster-sets', 'mediastack', 'requests', 'status', 'maintenance', 'about', 'settings', 'logout'],
    ['home', 'discover', 'request', 'analytics', 'achievements', 'users', 'downloads', 'upgrader', 'collexions', 'scanner', 'media-automation', 'poster-sets', 'overlays', 'mediastack', 'requests', 'status', 'maintenance', 'about', 'settings', 'logout'],
    // Pre-Preferences page stock order.
    ['home', 'discover', 'request', 'analytics', 'users', 'downloads', 'upgrader', 'collexions', 'scanner', 'media-automation', 'poster-sets', 'overlays', 'mediastack', 'requests', 'status', 'achievements', 'maintenance', 'about', 'settings', 'logout'],
    // Pre-support-tickets stock order.
    ['home', 'discover', 'request', 'analytics', 'users', 'downloads', 'upgrader', 'collexions', 'scanner', 'media-automation', 'poster-sets', 'overlays', 'editions', 'mediastack', 'requests', 'status', 'achievements', 'maintenance', 'about', 'preferences', 'settings', 'logout'],
    // Pre–Discover-tab Review Queue (standalone Requests nav item).
    ['home', 'discover', 'request', 'analytics', 'users', 'downloads', 'upgrader', 'collexions', 'scanner', 'media-automation', 'poster-sets', 'overlays', 'editions', 'mediastack', 'requests', 'status', 'achievements', 'support', 'maintenance', 'about', 'preferences', 'settings', 'logout'],
    // Pre-profile page stock order.
    ['home', 'discover', 'request', 'analytics', 'users', 'downloads', 'upgrader', 'collexions', 'scanner', 'media-automation', 'poster-sets', 'overlays', 'editions', 'mediastack', 'status', 'achievements', 'support', 'maintenance', 'about', 'preferences', 'settings', 'logout'],
];

const sameOrder = (a: string[], b: string[]) => (
    a.length === b.length && a.every((key, index) => key === b[index])
);

/** Upgrade known legacy defaults to the current default without clobbering custom orders. */
export const resolveNavOrder = (order?: string[] | null): string[] => {
    if (!Array.isArray(order) || !order.length) return [...DEFAULT_NAV_ORDER];
    if (LEGACY_DEFAULT_NAV_ORDERS.some((legacy) => sameOrder(order, legacy))) {
        return [...DEFAULT_NAV_ORDER];
    }
    return [...order];
};

/**
 * Merge any missing known nav keys into a saved order using DEFAULT_NAV_ORDER
 * relative positions, so Settings and the sidebar stay in sync.
 */
export const ensureCompleteNavOrder = (order?: string[] | null): string[] => {
    const incoming = Array.isArray(order) ? order.filter(Boolean) : [];
    const result: string[] = [];
    const seen = new Set<string>();

    for (const key of incoming) {
        if (seen.has(key)) continue;
        // Standalone Requests nav is retired — Review Queue is a Discover tab.
        if (key === 'requests') continue;
        seen.add(key);
        result.push(key);
    }

    const insertMissing = (key: string) => {
        if (result.includes(key)) return;
        const defaultIndex = DEFAULT_NAV_ORDER.indexOf(key as typeof DEFAULT_NAV_ORDER[number]);
        if (defaultIndex < 0) {
            result.push(key);
            return;
        }
        for (let i = defaultIndex - 1; i >= 0; i -= 1) {
            const prevIdx = result.indexOf(DEFAULT_NAV_ORDER[i]);
            if (prevIdx >= 0) {
                result.splice(prevIdx + 1, 0, key);
                return;
            }
        }
        for (let i = defaultIndex + 1; i < DEFAULT_NAV_ORDER.length; i += 1) {
            const nextIdx = result.indexOf(DEFAULT_NAV_ORDER[i]);
            if (nextIdx >= 0) {
                result.splice(nextIdx, 0, key);
                return;
            }
        }
        result.push(key);
    };

    for (const key of DEFAULT_NAV_ORDER) {
        insertMissing(key);
    }

    // Keep Logs in the settings editor when it was already saved.
    if (incoming.includes('logs') && !result.includes('logs')) {
        const settingsIdx = result.indexOf('settings');
        if (settingsIdx >= 0) result.splice(settingsIdx, 0, 'logs');
        else result.push('logs');
    }

    return result;
};

const PLACEHOLDER_REQUEST_URLS = new Set([
    'https://yourdomain.com',
    'http://yourdomain.com',
    '',
]);

export const isRequestNavEnabled = (requestAppType?: string | null, requestUrl?: string | null) => {
    if (!requestAppType || requestAppType === 'none') return false;
    const url = String(requestUrl || '').trim();
    if (!url || PLACEHOLDER_REQUEST_URLS.has(url)) return false;
    return true;
};

/** Keys that cannot be hidden via Settings → Layout → Navigation (prevents lockout). */
export const ALWAYS_VISIBLE_NAV_KEYS = new Set(['home', 'settings', 'logout']);

/** Members never see Settings; Home + Logout stay always visible in their layout. */
export const ALWAYS_VISIBLE_MEMBER_NAV_KEYS = new Set(['home', 'logout']);

/** Routes / nav keys expired members may still open (#187). */
export const EXPIRED_PORTAL_ALLOWED_NAV_KEYS = new Set([
    'home',
    'support',
    'chat',
    'preferences',
    'about',
]);

export const EXPIRED_PORTAL_ALLOWED_ROUTES = new Set([
    'expired',
    'user', // home → ExpiredAccessPage
    'support',
    'chat',
    'profile',
    'preferences',
    'about',
]);

export const isExpiredPortalAllowedRoute = (route: string) => (
    EXPIRED_PORTAL_ALLOWED_ROUTES.has(String(route || ''))
);

/** Normalize a saved hidden-keys list; strips always-visible keys.
 *  Pass `customTabs` or `custom:` applet keys are dropped (hide in Layout would no-op). */
export const normalizeNavHiddenKeys = (keys?: string[] | null, customTabs?: Array<{ id: string; enabled?: boolean }>): string[] => {
    if (!Array.isArray(keys)) return [];
    const enabledCustom = new Set(
        (customTabs || [])
            .filter((tab) => tab && tab.enabled !== false)
            .map((tab) => `custom:${String(tab.id).trim()}`),
    );
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of keys) {
        const key = String(raw || '').trim();
        if (!key || ALWAYS_VISIBLE_NAV_KEYS.has(key) || seen.has(key)) continue;
        if (key.startsWith('custom:')) {
            if (!enabledCustom.has(key)) continue;
            seen.add(key);
            result.push(key);
            continue;
        }
        if (!(key in NAV_ITEM_LABELS) && key !== 'logs') continue;
        seen.add(key);
        result.push(key);
    }
    return result;
};

/** Hidden keys for the members layout — only member-visible keys, never Home/Logout. */
export const normalizeMemberNavHiddenKeys = (
    keys?: string[] | null,
    customTabs?: Array<{ id: string; enabled?: boolean; adminOnly?: boolean }>,
): string[] => {
    if (!Array.isArray(keys)) return [];
    const memberCustom = new Set(
        (customTabs || [])
            .filter((tab) => tab && tab.enabled !== false && !tab.adminOnly)
            .map((tab) => `custom:${String(tab.id).trim()}`),
    );
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of keys) {
        const key = String(raw || '').trim();
        if (!key || ALWAYS_VISIBLE_MEMBER_NAV_KEYS.has(key) || seen.has(key)) continue;
        if (key.startsWith('custom:')) {
            if (!memberCustom.has(key)) continue;
            seen.add(key);
            result.push(key);
            continue;
        }
        if (!isMemberNavKey(key)) continue;
        if (!(key in NAV_ITEM_LABELS)) continue;
        seen.add(key);
        result.push(key);
    }
    return result;
};

/**
 * Complete a members-only nav order. Missing member keys are inserted using
 * DEFAULT_MEMBER_NAV_ORDER relative positions.
 */
export const ensureCompleteMemberNavOrder = (
    order?: string[] | null,
    customTabs?: Array<{ id: string; enabled?: boolean; adminOnly?: boolean }>,
): string[] => {
    const incoming = (Array.isArray(order) ? order : []).filter((key) => {
        if (!key) return false;
        if (key.startsWith('custom:')) {
            const id = key.slice('custom:'.length);
            const tab = (customTabs || []).find((entry) => String(entry.id) === id);
            return !!tab && tab.enabled !== false && !tab.adminOnly;
        }
        return isMemberNavKey(key);
    });
    const result: string[] = [];
    const seen = new Set<string>();

    for (const key of incoming) {
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(key);
    }

    const insertMissing = (key: string) => {
        if (result.includes(key)) return;
        const defaultIndex = DEFAULT_MEMBER_NAV_ORDER.indexOf(key as typeof DEFAULT_MEMBER_NAV_ORDER[number]);
        if (defaultIndex < 0) {
            result.push(key);
            return;
        }
        for (let i = defaultIndex - 1; i >= 0; i -= 1) {
            const prevIdx = result.indexOf(DEFAULT_MEMBER_NAV_ORDER[i]);
            if (prevIdx >= 0) {
                result.splice(prevIdx + 1, 0, key);
                return;
            }
        }
        for (let i = defaultIndex + 1; i < DEFAULT_MEMBER_NAV_ORDER.length; i += 1) {
            const nextIdx = result.indexOf(DEFAULT_MEMBER_NAV_ORDER[i]);
            if (nextIdx >= 0) {
                result.splice(nextIdx, 0, key);
                return;
            }
        }
        result.push(key);
    };

    for (const key of DEFAULT_MEMBER_NAV_ORDER) {
        insertMissing(key);
    }

    return result;
};

/** Build a members order from an admin order (keeps relative sequence, drops admin-only keys). */
export const deriveMemberNavOrderFromAdmin = (
    adminOrder?: string[] | null,
    customTabs?: Array<{ id: string; enabled?: boolean; adminOnly?: boolean }>,
): string[] => {
    const fromAdmin = ensureCompleteNavOrder(adminOrder).filter((key) => {
        if (key.startsWith('custom:')) {
            const id = key.slice('custom:'.length);
            const tab = (customTabs || []).find((entry) => String(entry.id) === id);
            return !!tab && tab.enabled !== false && !tab.adminOnly;
        }
        return isMemberNavKey(key);
    });
    return ensureCompleteMemberNavOrder(fromAdmin, customTabs);
};

export const resolveMemberNavOrder = (
    memberOrder?: string[] | null,
    adminOrder?: string[] | null,
    customTabs?: Array<{ id: string; enabled?: boolean; adminOnly?: boolean }>,
): string[] => {
    if (Array.isArray(memberOrder) && memberOrder.length) {
        return ensureCompleteMemberNavOrder(memberOrder, customTabs);
    }
    return deriveMemberNavOrderFromAdmin(adminOrder, customTabs);
};

export const filterNavOrder = (
    order: string[],
    options: {
        isAdmin: boolean;
        features?: NavFeatureFlags;
        hiddenKeys?: string[];
        customTabs?: Array<{ id: string; enabled?: boolean; adminOnly?: boolean }>;
        accessExpired?: boolean;
    },
) => {
    const features = options.features || {};
    const customTabMap = new Map(
        (options.customTabs || [])
            .filter((tab) => tab && tab.enabled !== false)
            .map((tab) => [String(tab.id), tab]),
    );
    const maintenanceEnabled = features.maintenance !== false;
    const upgraderEnabled = !!features.upgrader;
    const collexionsEnabled = !!features.collexions;
    const spotifySyncEnabled = !!features.spotifySync;
    const metadataFillEnabled = !!features.metadataFill;
    const scannerEnabled = !!features.scanner;
    const mediaAutomationEnabled = !!features.mediaAutomation;
    const posterSetsEnabled = !!features.posterSets;
    const overlaysEnabled = !!features.overlays;
    const editionsEnabled = !!features.editions;
    const watchSyncEnabled = !!features.watchSync;
    const achievementsEnabled = !!features.achievements;
    const supportEnabled = features.support !== false;
    const chatEnabled = !!features.chat;
    const mediaPlayerEnabled = features.mediaPlayer !== false;
    const requestsQueueEnabled = !!features.requestsQueue;
    const requestEnabled = features.request !== false || requestsQueueEnabled;
    const hidden = new Set(
        options.isAdmin
            ? normalizeNavHiddenKeys(options.hiddenKeys, options.customTabs)
            : normalizeMemberNavHiddenKeys(options.hiddenKeys, options.customTabs),
    );
    const alwaysVisible = options.isAdmin ? ALWAYS_VISIBLE_NAV_KEYS : ALWAYS_VISIBLE_MEMBER_NAV_KEYS;
    const accessExpired = !!options.accessExpired && !options.isAdmin;

    return (Array.isArray(order) ? order : []).filter((key) => {
        if (accessExpired) {
            if (key === 'logout') return false;
            if (key.startsWith('custom:')) return false;
            if (key === 'home') return true;
            return EXPIRED_PORTAL_ALLOWED_NAV_KEYS.has(key)
                && !(key === 'support' && !supportEnabled)
                && !(key === 'chat' && !chatEnabled);
        }
        if (key.startsWith('custom:')) {
            const id = key.slice('custom:'.length);
            const tab = customTabMap.get(id);
            if (!tab) return false;
            if (tab.adminOnly && !options.isAdmin) return false;
            if (hidden.has(key) && !alwaysVisible.has(key)) return false;
            return true;
        }
        if (key === 'logout' || key === 'logs') return false;
        // Review queue now lives as a Discover & Request tab — never show a standalone nav item.
        if (key === 'requests') return false;
        if (hidden.has(key) && !alwaysVisible.has(key)) return false;
        if ((key === 'users' || key === 'settings' || key === 'maintenance' || key === 'upgrader' || key === 'collexions' || key === 'spotify-sync' || key === 'metadata-fill' || key === 'scanner' || key === 'media-automation' || key === 'poster-sets' || key === 'overlays' || key === 'editions' || key === 'watch-sync') && !options.isAdmin) return false;
        if (key === 'downloads' && !options.isAdmin && features.downloads === false) return false;
        if (key === 'maintenance' && !maintenanceEnabled) return false;
        if (key === 'upgrader' && !upgraderEnabled) return false;
        if (key === 'collexions' && !collexionsEnabled) return false;
        if (key === 'spotify-sync' && !spotifySyncEnabled) return false;
        if (key === 'metadata-fill' && !metadataFillEnabled) return false;
        if (key === 'scanner' && !scannerEnabled) return false;
        if (key === 'media-automation' && !mediaAutomationEnabled) return false;
        if (key === 'poster-sets' && !posterSetsEnabled) return false;
        if (key === 'overlays' && !overlaysEnabled) return false;
        if (key === 'editions' && !editionsEnabled) return false;
        if (key === 'watch-sync' && !watchSyncEnabled) return false;
        if (key === 'achievements' && !achievementsEnabled) return false;
        if (key === 'support' && !supportEnabled) return false;
        if (key === 'chat' && !chatEnabled) return false;
        if (key === 'request' && !requestEnabled) return false;
        if (key === 'media-player' && !mediaPlayerEnabled) return false;
        return true;
    });
};
