import { type DiscoverView } from '../urlState';
import type { PosterSetsConfig } from '../types';

export type TabId = 'apply' | 'browse' | 'tpdb' | 'library' | 'collections' | 'queue' | 'watches' | 'recent' | 'paste' | 'history' | 'settings';
export type PrimaryTabId = 'library' | 'collections' | 'discover' | 'queue' | 'watches' | 'logs' | 'paste' | 'settings';
export type HistoryFilter = 'all' | 'running' | 'succeeded' | 'warning' | 'failed' | 'audit';

export const DISCOVER_SUB_NAV: Array<{ id: DiscoverView; label: string; internalTab: TabId }> = [
    { id: 'search', label: 'Search', internalTab: 'apply' },
    { id: 'browse', label: 'Browse', internalTab: 'browse' },
    { id: 'tpdb', label: 'TPDB New', internalTab: 'tpdb' },
    { id: 'recent', label: 'Recent', internalTab: 'recent' },
];

export const isDiscoverInternalTab = (id: TabId) => (
    id === 'apply' || id === 'browse' || id === 'tpdb' || id === 'recent'
);
export type SetProvider = 'mediux' | 'posterdb';
export type SearchProvider = 'both' | SetProvider;

export const isTpdbEnabled = (config?: Partial<PosterSetsConfig> | null) => config?.tpdbEnabled !== false;
export const isTpdbSearchEnabled = (config?: Partial<PosterSetsConfig> | null) => (
    isTpdbEnabled(config) && config?.tpdbSearchEnabled !== false
);
export const isMediuxEnabled = (config?: Partial<PosterSetsConfig> | null) => config?.mediuxEnabled !== false;
export const isCopyLibraryTitleEnabled = (config?: Partial<PosterSetsConfig> | null) => (
    config?.copyLibraryTitleEnabled !== false
);

export const enabledSearchProviders = (config?: Partial<PosterSetsConfig> | null): SetProvider[] => {
    const out: SetProvider[] = [];
    if (isMediuxEnabled(config)) out.push('mediux');
    if (isTpdbSearchEnabled(config)) out.push('posterdb');
    return out;
};

export const defaultSearchProvider = (config?: Partial<PosterSetsConfig> | null): SearchProvider => {
    const enabled = enabledSearchProviders(config);
    if (enabled.length === 2) return 'both';
    return enabled[0] || 'both';
};

export const discoverSubNavForConfig = (config?: Partial<PosterSetsConfig> | null) => (
    DISCOVER_SUB_NAV.filter((item) => item.id !== 'tpdb' || isTpdbSearchEnabled(config))
);

export const posterSetsHeroTitle = (config?: Partial<PosterSetsConfig> | null) => {
    const tpdb = isTpdbSearchEnabled(config);
    const mediux = isMediuxEnabled(config);
    if (tpdb && mediux) return 'Artwork from MediUX & ThePosterDB';
    if (tpdb) return 'Artwork from ThePosterDB';
    if (mediux) return 'Artwork from MediUX';
    return 'Artwork from your library';
};

/** Label for the Find search-provider pill (Both / MediUX / ThePosterDB). */
export const posterSetsSearchScopeLabel = (provider?: string | null) => {
    const raw = String(provider || 'both').trim().toLowerCase();
    if (raw === 'posterdb' || raw === 'tpdb' || raw === 'theposterdb') return 'ThePosterDB';
    if (raw === 'mediux') return 'MediUX';
    return 'MediUX and ThePosterDB';
};
