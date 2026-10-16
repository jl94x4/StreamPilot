/**
 * Per-item sidebar marks for native nav keys (Lucide name and/or image URL).
 * Uploaded images reuse custom-tab logo storage under ids like `nav-home`.
 */

import { customTabLogoPublicPath, isAllowedCustomNavIcon, normalizeLogoUrl } from './custom-nav-tabs.js';

export const NATIVE_NAV_ICON_KEYS = new Set([
    'home',
    'discover',
    'request',
    'media-player',
    'analytics',
    'achievements',
    'chat',
    'support',
    'users',
    'downloads',
    'upgrader',
    'collexions',
    'spotify-sync',
    'scanner',
    'media-automation',
    'poster-sets',
    'overlays',
    'editions',
    'watch-sync',
    'mediastack',
    'requests',
    'status',
    'maintenance',
    'about',
    'profile',
    'preferences',
    'settings',
    'logs',
    'logout',
]);

const LOGO_ID_PREFIX = 'nav-';

export const isNativeNavIconKey = (key) => NATIVE_NAV_ICON_KEYS.has(String(key || '').trim());

export const navItemIconLogoId = (key) => {
    const id = String(key || '').trim();
    if (!isNativeNavIconKey(id)) return '';
    return `${LOGO_ID_PREFIX}${id}`;
};

export const navItemIconLogoPublicPath = (key) => {
    const id = navItemIconLogoId(key);
    return id ? customTabLogoPublicPath(id) : '';
};

const normalizeOptionalIcon = (value) => {
    const icon = String(value || '').trim();
    if (icon === 'ImageIcon') return 'Image';
    return isAllowedCustomNavIcon(icon) ? icon : '';
};

export const sanitizeNavItemIcons = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result = {};
    for (const [rawKey, raw] of Object.entries(value)) {
        const key = String(rawKey || '').trim();
        if (!isNativeNavIconKey(key) || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const icon = normalizeOptionalIcon(raw.icon);
        const logoUrl = normalizeLogoUrl(raw.logoUrl);
        if (!icon && !logoUrl) continue;
        result[key] = {
            ...(icon ? { icon } : {}),
            ...(logoUrl ? { logoUrl } : {}),
        };
    }
    return result;
};
