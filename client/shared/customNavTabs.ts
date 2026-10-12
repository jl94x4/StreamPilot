import {
    Activity,
    AppWindow,
    ArrowUpCircle,
    BarChart3,
    Bookmark,
    BookOpen,
    Box,
    Calendar,
    Camera,
    Cast,
    ClipboardList,
    Cloud,
    Cpu,
    Database,
    Download,
    DownloadCloud,
    ExternalLink,
    FileText,
    Film,
    Gamepad2,
    Globe,
    HardDrive,
    Headphones,
    Heart,
    Home,
    Image,
    Info,
    Layers,
    LayoutDashboard,
    LifeBuoy,
    Link,
    LogOut,
    MessageSquare,
    Monitor,
    Music,
    Radar,
    Radio,
    Server,
    Settings,
    Shield,
    SlidersHorizontal,
    Sparkles,
    Star,
    Trophy,
    Tv,
    User,
    Users,
    Zap,
    Clapperboard,
    Wand2,
    type LucideIcon,
} from 'lucide-react';
import type { CustomNavTab } from './types';
import { portalUrl } from './basePath';

export const CUSTOM_NAV_KEY_PREFIX = 'custom:';

export type CustomNavTabOpenMode = 'embed' | 'sameTab' | 'newTab';

export const CUSTOM_NAV_ICON_OPTIONS = [
    'Globe', 'ExternalLink', 'Server', 'Monitor', 'Gamepad2', 'Music', 'Film', 'Tv',
    'BookOpen', 'Database', 'Cloud', 'Home', 'Link', 'Box', 'Cpu', 'HardDrive', 'Radio',
    'Cast', 'Headphones', 'Camera', 'Shield', 'Zap', 'Star', 'Heart', 'Bookmark',
    'LayoutDashboard', 'AppWindow', 'Layers', 'Activity', 'Download', 'MessageSquare',
    'Users', 'User', 'BarChart3', 'Trophy', 'LifeBuoy', 'DownloadCloud', 'Calendar',
    'ArrowUpCircle', 'Radar', 'ClipboardList', 'Sparkles', 'Info', 'SlidersHorizontal',
    'Settings', 'LogOut', 'FileText', 'Image', 'Clapperboard', 'Wand2',
] as const;

export type CustomNavIconName = typeof CUSTOM_NAV_ICON_OPTIONS[number];

const CUSTOM_NAV_ICON_MAP: Record<CustomNavIconName, LucideIcon> = {
    Globe,
    ExternalLink,
    Server,
    Monitor,
    Gamepad2,
    Music,
    Film,
    Tv,
    BookOpen,
    Database,
    Cloud,
    Home,
    Link,
    Box,
    Cpu,
    HardDrive,
    Radio,
    Cast,
    Headphones,
    Camera,
    Shield,
    Zap,
    Star,
    Heart,
    Bookmark,
    LayoutDashboard,
    AppWindow,
    Layers,
    Activity,
    Download,
    MessageSquare,
    Users,
    User,
    BarChart3,
    Trophy,
    LifeBuoy,
    DownloadCloud,
    Calendar,
    ArrowUpCircle,
    Radar,
    ClipboardList,
    Sparkles,
    Info,
    SlidersHorizontal,
    Settings,
    LogOut,
    FileText,
    Image,
    Clapperboard,
    Wand2,
};

export const customNavTabKey = (id: string) => `${CUSTOM_NAV_KEY_PREFIX}${String(id || '').trim()}`;

export const parseCustomNavTabId = (key: string): string | null => {
    const raw = String(key || '');
    if (!raw.startsWith(CUSTOM_NAV_KEY_PREFIX)) return null;
    const id = raw.slice(CUSTOM_NAV_KEY_PREFIX.length).trim();
    return id || null;
};

export const isCustomNavTabKey = (key: string) => !!parseCustomNavTabId(key);

export const buildCustomNavTabMap = (tabs: CustomNavTab[] = []) => (
    new Map(tabs.map((tab) => [String(tab.id), tab]))
);

export const resolveCustomNavIcon = (iconName?: string | null): LucideIcon => {
    const key = String(iconName || '').trim();
    if (key === 'ImageIcon') return Image;
    return CUSTOM_NAV_ICON_MAP[key as CustomNavIconName] || Globe;
};

export const getCustomNavTabLabel = (key: string, tabs: CustomNavTab[] = []) => {
    const id = parseCustomNavTabId(key);
    if (!id) return key;
    const tab = tabs.find((entry) => String(entry.id) === id);
    return tab?.name || key;
};

export const isCustomNavTabMemberVisible = (key: string, tabMap: Map<string, CustomNavTab>) => {
    const id = parseCustomNavTabId(key);
    if (!id) return false;
    const tab = tabMap.get(id);
    return !!tab && tab.enabled && !tab.adminOnly;
};

export const canAccessCustomNavTab = (tab: CustomNavTab | undefined, isAdmin: boolean) => (
    !!tab && tab.enabled && (!tab.adminOnly || isAdmin)
);

export const insertNavKeyBefore = (order: string[], anchor: string, key: string) => {
    const next = order.filter((entry) => entry !== key);
    const index = next.indexOf(anchor);
    if (index < 0) return [...next, key];
    next.splice(index, 0, key);
    return next;
};

export const removeNavKey = (order: string[], key: string) => (
    order.filter((entry) => entry !== key)
);

export const APPLETS_NAV_KEY = 'applets';

export const isAppletsNavDisplay = (value?: string | null) => String(value || '').trim().toLowerCase() === 'applets';

export const customTabLogoPublicPath = (tabId: string) => {
    const id = String(tabId || '').trim();
    return id ? `/api/branding/custom-tab/${encodeURIComponent(id)}` : '';
};

export const buildDesktopNavOrder = (
    order: string[],
    { display, hasVisibleApplets }: { display?: string | null; hasVisibleApplets: boolean },
) => {
    const keys = (Array.isArray(order) ? order : []).filter((key) => key !== 'logs' && key !== APPLETS_NAV_KEY);
    if (!isAppletsNavDisplay(display)) return keys;
    const withoutCustom = keys.filter((key) => !isCustomNavTabKey(key));
    if (!hasVisibleApplets) return withoutCustom;
    const anchor = withoutCustom.includes('settings') ? 'settings' : 'logout';
    const anchorIdx = withoutCustom.indexOf(anchor);
    if (anchorIdx < 0) return [...withoutCustom, APPLETS_NAV_KEY];
    return [...withoutCustom.slice(0, anchorIdx), APPLETS_NAV_KEY, ...withoutCustom.slice(anchorIdx)];
};

export const createDefaultCustomNavTab = (): CustomNavTab => ({
    id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `tab-${Date.now()}`,
    name: 'New service',
    url: 'https://',
    icon: 'Globe',
    openMode: 'embed',
    adminOnly: false,
    enabled: true,
    showPaletteLabel: true,
});

export type CustomTabEmbedIssue = 'mixed-content' | 'blocked-host' | 'proxy-incompatible';

const BLOCKED_EMBED_HOST_SUFFIXES = [
    'google.com',
    'youtube.com',
    'facebook.com',
    'twitter.com',
    'x.com',
    'instagram.com',
    'microsoft.com',
    'live.com',
    'office.com',
    'apple.com',
];

import { registrableDomainFromHost } from '../../lib/registrable-domain.js';

const registrableDomain = (hostname: string) => registrableDomainFromHost(hostname);

/** HTTPS sibling subdomains (e.g. photos.example.com inside portal.example.com) can iframe directly. */
export const isSameRegistrableDomainHost = (targetHost: string, portalHost: string) => {
    const target = String(targetHost || '').toLowerCase();
    const portal = String(portalHost || '').toLowerCase();
    if (!target || !portal || target === portal) return true;
    const base = registrableDomain(portal);
    return base.length > 0 && target.endsWith(`.${base}`) && registrableDomain(target) === base;
};

/** Immich / SvelteKit apps route on window.location.pathname and cannot run under /api/custom-tab-embed/…. */
export const isDirectEmbedOnlyAppUrl = (url: string) => {
    try {
        const parsed = new URL(String(url || '').trim(), typeof window !== 'undefined' ? window.location.origin : 'https://localhost');
        const host = parsed.hostname.toLowerCase();
        const port = parsed.port;
        if (port === '8888' || port === '2283') return true;
        if (/^photos\./i.test(host)) return true;
        return false;
    } catch {
        return false;
    }
};

/** Apps that send X-Frame-Options: sameorigin even on a sibling HTTPS subdomain. */
export const isFrameOptionsBlockedAppUrl = (url: string) => {
    try {
        const parsed = new URL(String(url || '').trim(), typeof window !== 'undefined' ? window.location.origin : 'https://localhost');
        const host = parsed.hostname.toLowerCase();
        const first = host.split('.')[0] || '';
        if (['sab', 'sabnzbd', 'nzbget'].includes(first)) return true;
        if (host.includes('sabnzbd')) return true;
        return false;
    } catch {
        return false;
    }
};

/**
 * Same-host *arr applets (Sonarr, Radarr, Lidarr, …) iframe directly through the
 * portal path mount, like Sonarr. The embed proxy breaks *arr SPAs (wrong upstream,
 * API paths under /api/custom-tab-embed/…). Use direct embed when HTTPS + same host.
 */
/** Upgrade HTTP sibling subdomains to HTTPS when the portal is served over TLS. */
export const normalizeCustomTabEmbedUrl = (url: string) => {
    const trimmed = String(url || '').trim();
    if (!trimmed) return trimmed;
    try {
        const parsed = new URL(trimmed, typeof window !== 'undefined' ? window.location.origin : 'https://localhost');
        const portalHost = typeof window !== 'undefined' ? window.location.hostname.toLowerCase() : '';
        const targetHost = parsed.hostname.toLowerCase();
        if (
            portalHost
            && parsed.protocol === 'http:'
            && isSameRegistrableDomainHost(targetHost, portalHost)
            && !isPrivateOrLocalHost(trimmed)
        ) {
            parsed.protocol = 'https:';
            return parsed.href;
        }
    } catch {
        return trimmed;
    }
    return trimmed;
};

const wouldNeedEmbedProxy = (
    url: string,
    portalProtocol = typeof window !== 'undefined' ? window.location.protocol : 'https:',
) => {
    try {
        const parsed = new URL(String(url || '').trim(), typeof window !== 'undefined' ? window.location.origin : 'https://localhost');
        if (portalProtocol === 'https:' && parsed.protocol === 'http:') return true;
        const portalHost = typeof window !== 'undefined' ? window.location.hostname.toLowerCase() : '';
        const targetHost = parsed.hostname.toLowerCase();
        if (!portalHost || targetHost === portalHost) return false;
        if (isFrameOptionsBlockedAppUrl(url) && !isDirectEmbedOnlyAppUrl(url)) return true;
        if (
            portalProtocol === 'https:'
            && parsed.protocol === 'https:'
            && isSameRegistrableDomainHost(targetHost, portalHost)
        ) {
            return false;
        }
        return true;
    } catch {
        return false;
    }
};

/** Predict iframe failures before the browser shows a broken embed. */
export const detectCustomTabEmbedIssue = (
    url: string,
    portalProtocol = typeof window !== 'undefined' ? window.location.protocol : 'https:',
): CustomTabEmbedIssue | null => {
    const trimmed = String(url || '').trim();
    if (!trimmed) return null;
    try {
        const parsed = new URL(trimmed, typeof window !== 'undefined' ? window.location.origin : 'https://localhost');
        const host = parsed.hostname.toLowerCase();
        for (const suffix of BLOCKED_EMBED_HOST_SUFFIXES) {
            if (host === suffix || host.endsWith(`.${suffix}`)) return 'blocked-host';
        }
        if (isDirectEmbedOnlyAppUrl(trimmed) && wouldNeedEmbedProxy(trimmed, portalProtocol)) {
            return 'proxy-incompatible';
        }
        if (portalProtocol === 'https:' && parsed.protocol === 'http:') return 'mixed-content';
    } catch {
        return null;
    }
    return null;
};

/** Route embeds through the portal when direct iframe would be blocked. */
export const shouldUseCustomTabEmbedProxy = (url: string): boolean => {
    const normalized = normalizeCustomTabEmbedUrl(url);
    if (detectCustomTabEmbedIssue(normalized) === 'blocked-host') return false;
    if (detectCustomTabEmbedIssue(normalized) === 'proxy-incompatible') return false;
    return wouldNeedEmbedProxy(normalized);
};

export const getCustomTabEmbedProxySrc = (tabId: string) => (
    portalUrl(`/api/custom-tab-embed/${encodeURIComponent(tabId)}/`)
);

export const isPrivateOrLocalHost = (url: string) => {
    try {
        const host = new URL(String(url || '').trim(), 'https://localhost').hostname.toLowerCase();
        return host === 'localhost'
            || host.endsWith('.local')
            || /^192\.168\./.test(host)
            || /^10\./.test(host)
            || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
            || host === '127.0.0.1';
    } catch {
        return false;
    }
};
