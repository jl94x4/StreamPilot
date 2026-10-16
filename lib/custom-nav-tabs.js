import { isAppletPresetLogoUrl } from './applet-preset-logos.js';

const CUSTOM_NAV_KEY_PREFIX = 'custom:';
export const MAX_CUSTOM_NAV_TABS = 20;
const ALLOWED_OPEN_MODES = new Set(['embed', 'sameTab', 'newTab']);
const ALLOWED_ICONS = new Set([
    'Globe', 'ExternalLink', 'Server', 'Monitor', 'Gamepad2', 'Music', 'Film', 'Tv',
    'BookOpen', 'Database', 'Cloud', 'Home', 'Link', 'Box', 'Cpu', 'HardDrive', 'Radio',
    'Cast', 'Headphones', 'Camera', 'Shield', 'Zap', 'Star', 'Heart', 'Bookmark',
    'LayoutDashboard', 'AppWindow', 'Layers', 'Activity', 'Download', 'MessageSquare',
    'Users', 'User', 'BarChart3', 'Trophy', 'LifeBuoy', 'DownloadCloud', 'Calendar',
    'ArrowUpCircle', 'Radar', 'ClipboardList', 'Sparkles', 'Info', 'SlidersHorizontal',
    'Settings', 'LogOut', 'FileText', 'Image', 'Clapperboard',
]);

export const isAllowedCustomNavIcon = (value) => ALLOWED_ICONS.has(String(value || '').trim());

export const customNavTabKey = (id) => `${CUSTOM_NAV_KEY_PREFIX}${String(id || '').trim()}`;

export const parseCustomNavTabKey = (key) => {
    const raw = String(key || '');
    if (!raw.startsWith(CUSTOM_NAV_KEY_PREFIX)) return null;
    const id = raw.slice(CUSTOM_NAV_KEY_PREFIX.length).trim();
    return id || null;
};

export const isCustomNavTabKey = (key) => !!parseCustomNavTabKey(key);

const isSafeCustomNavUrl = (url) => {
    const value = String(url || '').trim();
    if (!value) return false;
    if (/^(javascript|data|vbscript):/i.test(value)) return false;
    if (value.startsWith('/')) return true;
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
};

const normalizeOpenMode = (value) => {
    const mode = String(value || '').trim();
    return ALLOWED_OPEN_MODES.has(mode) ? mode : 'embed';
};

const normalizeIcon = (value) => {
    const icon = String(value || '').trim();
    return ALLOWED_ICONS.has(icon) ? icon : 'Globe';
};

export const normalizeLogoUrl = (value) => {
    const url = String(value || '').trim();
    if (!url) return '';
    if (/^(javascript|data|vbscript):/i.test(url)) return '';
    const pathOnly = url.split('?')[0];
    if (/^\/api\/branding\/custom-tab\/[A-Za-z0-9_-]+$/.test(pathOnly)) return pathOnly;
    if (isAppletPresetLogoUrl(pathOnly)) return pathOnly;
    try {
        const parsed = new URL(url);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return url.slice(0, 500);
    } catch {
        return '';
    }
    return '';
};

const makeId = () => (
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
);

export const normalizeCustomNavTabs = (tabs, existing = []) => {
    const source = Array.isArray(tabs) ? tabs : (Array.isArray(existing) ? existing : []);
    const seen = new Set();
    const result = [];
    for (const raw of source) {
        if (!raw || typeof raw !== 'object') continue;
        const id = String(raw.id || '').trim() || makeId();
        if (seen.has(id)) continue;
        const name = String(raw.name || '').trim();
        const url = String(raw.url || '').trim();
        if (!name || !isSafeCustomNavUrl(url)) continue;
        seen.add(id);
        const description = String(raw.description || '').trim().slice(0, 240);
        result.push({
            id,
            name: name.slice(0, 80),
            description: description || undefined,
            url,
            icon: normalizeIcon(raw.icon),
            openMode: normalizeOpenMode(raw.openMode),
            adminOnly: !!raw.adminOnly,
            enabled: raw.enabled !== false,
            logoUrl: normalizeLogoUrl(raw.logoUrl) || undefined,
            showPaletteLabel: raw.showPaletteLabel !== false,
        });
        if (result.length >= MAX_CUSTOM_NAV_TABS) break;
    }
    return result;
};

export const sanitizeCustomNavTabsForSession = (tabs = []) => (
    normalizeCustomNavTabs(tabs).map((tab) => ({ ...tab }))
);

export const APPLETS_NAV_KEY = 'applets';

export const normalizeCustomNavDisplay = (value) => (
    String(value || '').trim().toLowerCase() === 'applets' ? 'applets' : 'links'
);

export const customTabLogoPublicPath = (tabId) => {
    const id = String(tabId || '').trim();
    return id ? `/api/branding/custom-tab/${encodeURIComponent(id)}` : '';
};

/** Desktop sidebar: hide individual custom tabs and pin Applets above Settings. */
export const buildDesktopNavOrder = (order = [], { display = 'links', hasVisibleApplets = false } = {}) => {
    const keys = (Array.isArray(order) ? order : []).filter((key) => key !== 'logs' && key !== APPLETS_NAV_KEY);
    if (normalizeCustomNavDisplay(display) !== 'applets') return keys;
    const withoutCustom = keys.filter((key) => !isCustomNavTabKey(key));
    if (!hasVisibleApplets) return withoutCustom;
    const anchor = withoutCustom.includes('settings') ? 'settings' : 'logout';
    const anchorIdx = withoutCustom.indexOf(anchor);
    if (anchorIdx < 0) return [...withoutCustom, APPLETS_NAV_KEY];
    return [...withoutCustom.slice(0, anchorIdx), APPLETS_NAV_KEY, ...withoutCustom.slice(anchorIdx)];
};

export const pruneNavOrderCustomKeys = (order = [], tabs = []) => {
    const enabledIds = new Set(
        normalizeCustomNavTabs(tabs)
            .filter((tab) => tab.enabled)
            .map((tab) => customNavTabKey(tab.id)),
    );
    return (Array.isArray(order) ? order : []).filter((key) => (
        !isCustomNavTabKey(key) || enabledIds.has(String(key))
    ));
};
