import { apiFetch } from '../shared/api';

export type WatchSyncDirections = {
    watched: boolean;
    ratings: boolean;
    collection?: boolean;
    watchlist: boolean;
};

export type WatchSyncConfig = {
    clientId: string;
    clientSecretSet: boolean;
    connected: boolean;
    username: string;
    tokenExpiresAt: string;
    plexToTrakt: {
        watched: boolean;
        ratings: boolean;
        collection: boolean;
        watchlist: boolean;
    };
    traktToPlex: {
        watched: boolean;
        ratings: boolean;
        watchlist: boolean;
    };
    libraryIds: string[];
    scheduleEnabled: boolean;
    intervalHours: number;
    liveWatchEnabled: boolean;
    lastRunAt: string;
    lastRun: {
        at: string;
        ok: boolean;
        summary?: Record<string, number>;
    } | null;
};

export type WatchSyncStatus = {
    running: boolean;
    startedAt: string;
    progress: string;
    error: string;
    log: string[];
    connected: boolean;
    username: string;
    lastRun: WatchSyncConfig['lastRun'];
    lastRunAt: string;
    scheduleEnabled: boolean;
    intervalHours: number;
    cache?: WatchSyncCache;
    live?: {
        enabled: boolean;
        error: string;
        current: { title: string; progress: number; action: string } | null;
    };
};

export type WatchSyncCache = {
    movies: number;
    episodes: number;
    shows: number;
    watchlist: number;
    entries: number;
    updatedAt: string;
};

export type WatchSyncLibrary = { id: string; title: string; type: string };

export const fetchWatchSyncStatus = () => apiFetch('/api/watch-sync/status') as Promise<WatchSyncStatus>;

export const fetchWatchSyncConfig = () => apiFetch('/api/watch-sync/config') as Promise<{
    config: WatchSyncConfig;
    device: { userCode: string; verificationUrl: string; expiresAt: string; interval: number } | null;
}>;

export const saveWatchSyncConfig = (config: Record<string, unknown>) => apiFetch('/api/watch-sync/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
}) as Promise<{ config: WatchSyncConfig }>;

export const startWatchSyncConnect = () => apiFetch('/api/watch-sync/connect/start', { method: 'POST' }) as Promise<{
    device: { userCode: string; verificationUrl: string; expiresAt: string; interval: number };
}>;

export const pollWatchSyncConnect = () => apiFetch('/api/watch-sync/connect/poll', { method: 'POST' }) as Promise<{
    pending: boolean;
    error?: string;
    config?: WatchSyncConfig;
}>;

export const disconnectWatchSync = () => apiFetch('/api/watch-sync/disconnect', { method: 'POST' }) as Promise<{ config: WatchSyncConfig }>;

export const fetchWatchSyncLibraries = () => apiFetch('/api/watch-sync/libraries') as Promise<{ libraries: WatchSyncLibrary[] }>;

export const startWatchSync = () => apiFetch('/api/watch-sync/sync', { method: 'POST' });

export const cancelWatchSync = () => apiFetch('/api/watch-sync/cancel', { method: 'POST' });

export const clearWatchSyncCache = () => apiFetch('/api/watch-sync/cache/clear', { method: 'POST' }) as Promise<{ cache: WatchSyncCache }>;

export const testWatchSync = () => apiFetch('/api/watch-sync/test', { method: 'POST' }) as Promise<{ ok: boolean; username?: string; plex?: string }>;
