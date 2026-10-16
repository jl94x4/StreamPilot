import { stripBasePath } from '../shared/basePath';

export const DASHBOARD_TITLE_SEARCH_KEY = 'dashboardLibrarySearch';

export const dashboardTitleKeyFromPath = (pathname?: string) => {
    const path = stripBasePath(pathname || (typeof window !== 'undefined' ? window.location.pathname : ''));
    const match = path.match(/^\/dashboard\/title\/([^/?#]+)/i);
    if (!match) return '';
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return match[1];
    }
};

export const dashboardTitlePath = (ratingKey: string | number) => (
    `/dashboard/title/${encodeURIComponent(String(ratingKey || '').trim())}`
);

export const readDashboardSearchQuery = () => {
    try {
        return sessionStorage.getItem(DASHBOARD_TITLE_SEARCH_KEY) || '';
    } catch {
        return '';
    }
};

export const writeDashboardSearchQuery = (query: string) => {
    try {
        const trimmed = String(query || '').trim();
        if (trimmed) sessionStorage.setItem(DASHBOARD_TITLE_SEARCH_KEY, trimmed);
        else sessionStorage.removeItem(DASHBOARD_TITLE_SEARCH_KEY);
    } catch {
        /* ignore */
    }
};
