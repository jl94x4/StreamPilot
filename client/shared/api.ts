import { portalUrl } from './basePath';
import {
    DISCOVER_LOCALE_HEADER,
    readDiscoverUiLocale,
} from '../discovery/i18n/types';

/** Sent on every API call so mutating routes can reject cross-site CSRF. */
export const PORTAL_CSRF_HEADER = 'X-Requested-With';
export const PORTAL_CSRF_VALUE = 'ServerManagerPortal';

const needsDiscoverMetadataLocale = (url: string) => {
    const path = String(url || '');
    return path.includes('/api/discovery/proxy')
        || path.includes('/api/discovery/search')
        || path.includes('/api/discovery/trending');
};

const discoverLocaleHeaders = (url: string): HeadersInit => {
    if (!needsDiscoverMetadataLocale(url)) return {};
    try {
        return {
            [DISCOVER_LOCALE_HEADER]: readDiscoverUiLocale(),
        };
    } catch {
        return {};
    }
};

const plexClientAuthHeaders = (): HeadersInit => {
    try {
        const token = String(window.__PLEX_CLIENT__?.sessionToken || '').trim();
        if (!token) return {};
        return { Authorization: `Bearer ${token}` };
    } catch {
        return {};
    }
};

const isPlexClientRequest = () => {
    try {
        return !!(window.__PLEX_CLIENT__?.portalBaseUrl || window.__PLEX_CLIENT__);
    } catch {
        return false;
    }
};

export const portalRequestHeaders = (extra: HeadersInit = {}): HeadersInit => ({
    'Content-Type': 'application/json',
    Accept: 'application/json',
    [PORTAL_CSRF_HEADER]: PORTAL_CSRF_VALUE,
    ...plexClientAuthHeaders(),
    ...extra,
});

const jsonErrorMessage = (text: string) => {
    try {
        const data = JSON.parse(text);
        return String(data?.error || data?.message || '').trim();
    } catch {
        return '';
    }
};

export const apiErrorMessage = (status: number, text = '') => {
    const fromJson = jsonErrorMessage(text);
    if (fromJson) return fromJson;
    if (status === 502 || status === 504) return 'The server took too long to respond.';
    if (status >= 500) return `Server error (${status}).`;
    return `Request failed with status ${status}`;
};

export const apiFetch = async (url: string, options: RequestInit = {}) => {
    const directApp = typeof window !== 'undefined' && (
        !!window.__PLEX_CLIENT__ || document.documentElement?.dataset?.plexClient === '1'
    );
    if (directApp) {
        const pathOnly = String(url || '').split('?')[0].replace(/\/+$/, '');
        // Trivia is Wikipedia-backed on-device — do not depend on portal TMDB/request-app config.
        const forceDirectFact = pathOnly === '/api/discovery/fact';
        const { isPlexDirectMode } = await import('../plex-client/config');
        if (forceDirectFact || isPlexDirectMode()) {
            const { handlePlexDirectRequest } = await import('../plex-client/plexDirect');
            return handlePlexDirectRequest(url, options);
        }
    }
    const crossOriginPortal = isPlexClientRequest();
    const response = await fetch(portalUrl(url), {
        credentials: crossOriginPortal ? 'omit' : 'same-origin',
        ...options,
        cache: 'no-store',
        headers: portalRequestHeaders({
            ...discoverLocaleHeaders(url),
            ...(options.headers || {}),
        }),
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(apiErrorMessage(response.status, text));
    }
    if (response.status === 204) return;
    return response.json();
};

/** Deduplicate concurrent identical GETs (Home Wrap-Up + achievements widget). */
const inflightGets = new Map<string, Promise<any>>();
export const apiFetchShared = (url: string, options: RequestInit = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    if (method !== 'GET' || options.body) return apiFetch(url, options);
    const existing = inflightGets.get(url);
    if (existing) return existing;
    const pending = apiFetch(url, options).finally(() => {
        inflightGets.delete(url);
    });
    inflightGets.set(url, pending);
    return pending;
};
