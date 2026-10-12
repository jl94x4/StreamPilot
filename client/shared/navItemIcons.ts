import { customTabLogoPublicPath, resolveCustomNavIcon } from './customNavTabs';
import type { LucideIcon } from 'lucide-react';

export type NavItemIconMark = {
    icon?: string;
    logoUrl?: string;
};

export type NavItemIconsMap = Record<string, NavItemIconMark>;

/** Default Lucide names matching the built-in sidebar items in screens.tsx. */
export const DEFAULT_NAV_ITEM_ICONS: Record<string, string> = {
    home: 'Home',
    users: 'Users',
    discover: 'Film',
    status: 'Activity',
    logs: 'FileText',
    analytics: 'BarChart3',
    achievements: 'Trophy',
    chat: 'MessageSquare',
    support: 'LifeBuoy',
    downloads: 'DownloadCloud',
    mediastack: 'Calendar',
    maintenance: 'Shield',
    upgrader: 'ArrowUpCircle',
    collexions: 'Layers',
    'spotify-sync': 'Music',
    'metadata-fill': 'Wand2',
    scanner: 'Radar',
    'media-automation': 'Cpu',
    'poster-sets': 'Image',
    overlays: 'Layers',
    editions: 'Film',
    'watch-sync': 'Clapperboard',
    requests: 'ClipboardList',
    request: 'Sparkles',
    'media-player': 'PlayCircle',
    about: 'Info',
    profile: 'User',
    preferences: 'SlidersHorizontal',
    settings: 'Settings',
    logout: 'LogOut',
};

export const navItemIconLogoId = (key: string) => {
    const id = String(key || '').trim();
    return id ? `nav-${id}` : '';
};

export const navItemIconLogoPublicPath = (key: string) => {
    const id = navItemIconLogoId(key);
    return id ? customTabLogoPublicPath(id) : '';
};

export const isNativeNavIconKey = (key: string) => (
    Object.prototype.hasOwnProperty.call(DEFAULT_NAV_ITEM_ICONS, String(key || '').trim())
);

export const resolveNavItemIconName = (key: string, mark?: NavItemIconMark | null) => {
    const override = String(mark?.icon || '').trim();
    if (override) return override;
    return DEFAULT_NAV_ITEM_ICONS[key] || 'Globe';
};

export const resolveNavItemLucideIcon = (key: string, mark?: NavItemIconMark | null): LucideIcon => (
    resolveCustomNavIcon(resolveNavItemIconName(key, mark))
);

export const upsertNavItemIcon = (
    current: NavItemIconsMap,
    key: string,
    patch: Partial<NavItemIconMark>,
): NavItemIconsMap => {
    const prev = current[key] || {};
    const icon = patch.icon !== undefined ? String(patch.icon || '').trim() : (prev.icon || '');
    const logoUrl = patch.logoUrl !== undefined ? String(patch.logoUrl || '').trim() : (prev.logoUrl || '');
    const next: NavItemIconsMap = { ...current };
    if (!icon && !logoUrl) {
        delete next[key];
        return next;
    }
    next[key] = {
        ...(icon ? { icon } : {}),
        ...(logoUrl ? { logoUrl } : {}),
    };
    return next;
};
