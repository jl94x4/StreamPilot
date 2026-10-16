/**
 * Portal-backed Media Player app (Capacitor) runtime config.
 * Play Store build: every user enters their own StreamPilot portal URL. Never assume a single host.
 */

declare global {
    interface Window {
        __PLEX_CLIENT__?: {
            portalBaseUrl?: string;
            sessionToken?: string;
            isTv?: boolean;
            nativePlayer?: boolean;
            appVersion?: string;
            appVersionCode?: number | string;
        };
        /** Defined in plex-client/index.html — CSS-zoom to ~1920 desktop density on leanback. */
        __SMP_APPLY_TV_SCALE__?: () => void;
        __SMP_MARK_TV__?: () => void;
        __SMP_MARK_PHONE__?: () => void;
    }
}

import { mirrorAuthToNativeStorage } from './authPersistence';
import { STORAGE_AUTH_MODE, STORAGE_PLEX_HOME_USER, STORAGE_PLEX_OWNER_TOKEN, STORAGE_PORTAL, STORAGE_TOKEN } from './configStorageKeys';

/** Desktop-like CSS layout width used by native TV density (MainActivity). */
export const TV_LAYOUT_WIDTH = 1920;

const trimSlash = (value: string) => String(value || '').replace(/\/+$/, '');

/** Normalize user-entered portal URL (Play Store: any StreamPilot host). */
export const normalizePortalBaseUrl = (raw: string): { ok: true; url: string } | { ok: false; error: string } => {
    let value = String(raw || '').trim();
    if (!value) return { ok: false, error: 'Enter your StreamPilot URL' };
    if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        return { ok: false, error: 'That does not look like a valid URL' };
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { ok: false, error: 'Use an http:// or https:// portal address' };
    }
    if (!parsed.hostname) return { ok: false, error: 'Missing hostname' };
    const path = parsed.pathname.replace(/\/+$/, '');
    const origin = `${parsed.protocol}//${parsed.host}`;
    const withBase = path && path !== '/' ? `${origin}${path}` : origin;
    return { ok: true, url: trimSlash(withBase) };
};

export const isPlexClientApp = (): boolean => {
    if (typeof window === 'undefined') return false;
    if (window.__PLEX_CLIENT__) return true;
    try {
        return document.documentElement?.dataset?.plexClient === '1';
    } catch {
        return false;
    }
};

/** APK versionName injected at web build and overwritten from PackageInfo on device. */
export const getPlexClientAppVersion = (): string => {
    if (typeof window === 'undefined') return '';
    try {
        const fromWindow = String(window.__PLEX_CLIENT__?.appVersion || '').trim();
        if (fromWindow) return fromWindow;
    } catch {
        /* ignore */
    }
    try {
        return String(process.env.PLEX_CLIENT_APP_VERSION || '').trim();
    } catch {
        return '';
    }
};

export const readStoredPortalBaseUrl = (): string => {
    try {
        return trimSlash(localStorage.getItem(STORAGE_PORTAL) || '');
    } catch {
        return '';
    }
};

export const writeStoredPortalBaseUrl = (url: string) => {
    try {
        const next = trimSlash(url);
        if (next) localStorage.setItem(STORAGE_PORTAL, next);
        else localStorage.removeItem(STORAGE_PORTAL);
        void mirrorAuthToNativeStorage(STORAGE_PORTAL, next);
        if (typeof window !== 'undefined') {
            window.__PLEX_CLIENT__ = {
                ...(window.__PLEX_CLIENT__ || {}),
                portalBaseUrl: next || undefined,
            };
        }
    } catch {
        /* ignore */
    }
};

export const readStoredSessionToken = (): string => {
    try {
        return String(localStorage.getItem(STORAGE_TOKEN) || '').trim();
    } catch {
        return '';
    }
};

export const writeStoredSessionToken = (token: string) => {
    try {
        const next = String(token || '').trim();
        if (next) localStorage.setItem(STORAGE_TOKEN, next);
        else localStorage.removeItem(STORAGE_TOKEN);
        void mirrorAuthToNativeStorage(STORAGE_TOKEN, next);
        if (typeof window !== 'undefined') {
            window.__PLEX_CLIENT__ = {
                ...(window.__PLEX_CLIENT__ || {}),
                sessionToken: next || undefined,
            };
        }
    } catch {
        /* ignore */
    }
};

export const clearPlexClientSession = () => {
    writeStoredSessionToken('');
};

export const clearPlexClientPortal = () => {
    writeStoredSessionToken('');
    writeStoredPortalBaseUrl('');
    try {
        localStorage.removeItem(STORAGE_PLEX_OWNER_TOKEN);
        localStorage.removeItem(STORAGE_PLEX_HOME_USER);
        void mirrorAuthToNativeStorage(STORAGE_PLEX_OWNER_TOKEN, '');
        void mirrorAuthToNativeStorage(STORAGE_PLEX_HOME_USER, '');
    } catch {
        /* ignore */
    }
};

export type PlexClientAuthMode = 'plex' | 'portal';

export const readAuthMode = (): PlexClientAuthMode | '' => {
    try {
        const value = String(localStorage.getItem(STORAGE_AUTH_MODE) || '').trim();
        if (value === 'plex' || value === 'portal') return value;
    } catch {
        /* ignore */
    }
    return '';
};

export const writeAuthMode = (mode: PlexClientAuthMode) => {
    try {
        localStorage.setItem(STORAGE_AUTH_MODE, mode);
        void mirrorAuthToNativeStorage(STORAGE_AUTH_MODE, mode);
    } catch {
        /* ignore */
    }
};

/** Direct Plex account, with no StreamPilot portal in the middle. */
export const isPlexDirectMode = (): boolean => {
    if (!isPlexClientApp()) return false;
    const mode = readAuthMode();
    if (mode === 'portal') return false;
    if (mode === 'plex') return true;
    return !readStoredPortalBaseUrl();
};

export const getPortalBaseUrl = (): string => {
    if (typeof window === 'undefined') return '';
    if (isPlexDirectMode()) return '';
    const stored = readStoredPortalBaseUrl();
    if (stored) return stored;
    const fromWindow = trimSlash(window.__PLEX_CLIENT__?.portalBaseUrl || '');
    if (fromWindow) return fromWindow;
    return '';
};

export const getSessionToken = (): string => {
    if (typeof window === 'undefined') return '';
    const fromWindow = String(window.__PLEX_CLIENT__?.sessionToken || '').trim();
    if (fromWindow) return fromWindow;
    return readStoredSessionToken();
};

/** Leanback / Android TV detection — input layer; density is applied natively in MainActivity. */
export const isAndroidTvUi = (): boolean => {
    if (typeof window === 'undefined') return false;
    if (window.__PLEX_CLIENT__?.isTv === true) return true;
    try {
        if (document.documentElement?.dataset?.tv === '1') return true;
        const ua = navigator.userAgent || '';
        if (/Android/i.test(ua) && /TV|BRAVIA|AFT|GoogleTV|Android TV|SHIELD/i.test(ua)) return true;
        if (
            /Android/i.test(ua)
            && typeof navigator.maxTouchPoints === 'number'
            && navigator.maxTouchPoints === 0
            && Math.max(window.screen?.width || 0, window.screen?.height || 0) >= 720
        ) {
            return true;
        }
    } catch {
        /* ignore */
    }
    return false;
};

const markTvUi = () => {
    try {
        delete document.documentElement.dataset.phone;
        delete document.documentElement.dataset.phoneNative;
        document.documentElement.dataset.tv = '1';
        document.documentElement.dataset.plexClient = '1';
        window.__PLEX_CLIENT__ = {
            ...(window.__PLEX_CLIENT__ || {}),
            isTv: true,
        };
        document.documentElement.style.fontSize = '20px';
        if (typeof window.__SMP_MARK_TV__ === 'function') {
            window.__SMP_MARK_TV__();
        } else if (typeof window.__SMP_APPLY_TV_SCALE__ === 'function') {
            window.__SMP_APPLY_TV_SCALE__();
        }
    } catch {
        /* ignore */
    }
};

/** Phone / tablet touch UI — not Android TV. Independent of CSS viewport width. */
export const isPhoneUi = (): boolean => {
    if (typeof window === 'undefined') return false;
    if (isAndroidTvUi()) return false;
    try {
        if (document.documentElement?.dataset?.phone === '1') return true;
        if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return true;
        if (window.matchMedia('(max-width: 767px)').matches) return true;
        const ua = navigator.userAgent || '';
        if (/Android/i.test(ua) && (/Mobile/i.test(ua) || /; wv\)/.test(ua))) return true;
        if (/iPhone|iPod/i.test(ua)) return true;
    } catch {
        /* ignore */
    }
    return false;
};

export const markPhoneUi = () => {
    if (typeof window === 'undefined' || isAndroidTvUi()) return;
    try {
        if (typeof window.__SMP_MARK_PHONE__ === 'function') {
            window.__SMP_MARK_PHONE__();
            return;
        }
        if (isPhoneUi()) document.documentElement.dataset.phone = '1';
        else delete document.documentElement.dataset.phone;
    } catch {
        /* ignore */
    }
};

type DeviceUiPlugin = {
    getInfo: () => Promise<{ isTv?: boolean; widthPixels?: number; heightPixels?: number; density?: number }>;
};

/** Ask native leanback detection, then apply TV CSS density (zoom). */
export const detectAndApplyTvUi = async (): Promise<boolean> => {
    if (typeof window === 'undefined') return false;
    try {
        const { Capacitor, registerPlugin } = await import('@capacitor/core');
        if (Capacitor.isNativePlatform()) {
            const DeviceUi = registerPlugin<DeviceUiPlugin>('DeviceUi');
            const info = await DeviceUi.getInfo();
            if (info?.isTv) markTvUi();
        }
    } catch {
        /* web / plugin missing */
    }
    const tv = isAndroidTvUi();
    if (tv) markTvUi();
    else markPhoneUi();
    return tv;
};

export const bootstrapPlexClientConfig = () => {
    if (typeof window === 'undefined') return;
    const portalBaseUrl = getPortalBaseUrl();
    const sessionToken = getSessionToken();
    window.__PLEX_CLIENT__ = {
        ...(window.__PLEX_CLIENT__ || {}),
        portalBaseUrl: portalBaseUrl || undefined,
        sessionToken: sessionToken || undefined,
        isTv: window.__PLEX_CLIENT__?.isTv ?? isAndroidTvUi(),
        nativePlayer: window.__PLEX_CLIENT__?.nativePlayer ?? true,
    };
    try {
        document.documentElement.dataset.plexClient = '1';
        if (window.__PLEX_CLIENT__.isTv) markTvUi();
        else markPhoneUi();
    } catch {
        /* ignore */
    }
};
