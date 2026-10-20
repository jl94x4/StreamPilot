/**
 * Bridge to native in-app offline downloads (phone APK only).
 * Capacitor is loaded dynamically so portal Docker/esbuild does not need @capacitor/core.
 */
import { isAndroidTvUi, isPhoneUi } from './config';

export type MediaDownloadStatus = 'queued' | 'downloading' | 'complete' | 'error' | 'cancelled';

export type MediaDownloadItem = {
    id: string;
    ratingKey: string;
    title: string;
    type: string;
    serverId?: string;
    plexGuid?: string;
    fileName?: string;
    filePath?: string;
    thumbPath?: string;
    thumbUrl?: string;
    bytes?: number;
    totalBytes?: number;
    status: MediaDownloadStatus | string;
    createdAt?: number;
    error?: string;
    localUrl?: string;
};

export type MediaDownloadStartOpts = {
    url: string;
    headers?: Record<string, string>;
    ratingKey: string;
    title?: string;
    type?: string;
    serverId?: string;
    plexGuid?: string;
    fileName?: string;
    thumbUrl?: string;
    bytes?: number;
};

type CapMediaDownloadsPlugin = {
    isAvailable(): Promise<{ value: boolean }>;
    list(): Promise<{ items: MediaDownloadItem[] }>;
    get(opts: { id?: string; ratingKey?: string }): Promise<{ item: MediaDownloadItem | null }>;
    start(opts: Record<string, unknown>): Promise<{ item: MediaDownloadItem }>;
    cancel(opts: { id: string }): Promise<{ ok: boolean }>;
    delete(opts: { id?: string; ratingKey?: string }): Promise<{ ok: boolean }>;
    getLocalUrl(opts: { id?: string; ratingKey?: string }): Promise<{ url: string; item?: MediaDownloadItem }>;
    addListener(event: string, cb: (data: MediaDownloadItem) => void): Promise<{ remove: () => void }> | { remove: () => void };
};

let capPlugin: CapMediaDownloadsPlugin | null = null;
let installPromise: Promise<void> | null = null;
const listeners = new Set<(item: MediaDownloadItem) => void>();

const loadCapacitorCore = async (): Promise<{
    Capacitor: { isNativePlatform: () => boolean };
    registerPlugin: <T>(name: string) => T;
} | null> => {
    try {
        return await import('@capacitor/core');
    } catch {
        return null;
    }
};

const mapItem = (row: any): MediaDownloadItem | null => {
    if (!row || typeof row !== 'object') return null;
    const id = String(row.id || '').trim();
    const ratingKey = String(row.ratingKey || '').trim();
    if (!id && !ratingKey) return null;
    return {
        id,
        ratingKey,
        title: String(row.title || 'Download'),
        type: String(row.type || 'movie'),
        serverId: row.serverId ? String(row.serverId) : '',
        plexGuid: row.plexGuid ? String(row.plexGuid) : '',
        fileName: row.fileName ? String(row.fileName) : '',
        filePath: row.filePath ? String(row.filePath) : '',
        thumbPath: row.thumbPath ? String(row.thumbPath) : '',
        thumbUrl: row.thumbUrl ? String(row.thumbUrl) : '',
        bytes: Number(row.bytes) || 0,
        totalBytes: Number(row.totalBytes) || 0,
        status: String(row.status || 'queued'),
        createdAt: Number(row.createdAt) || 0,
        error: row.error ? String(row.error) : '',
        localUrl: row.localUrl ? String(row.localUrl) : '',
    };
};

const emit = (item: MediaDownloadItem | null) => {
    if (!item) return;
    for (const listener of listeners) {
        try { listener(item); } catch { /* ignore */ }
    }
};

/** True on phone Capacitor builds (not TV, not browser-only). */
export const isMediaDownloadsSupported = (): boolean => {
    if (typeof window === 'undefined') return false;
    if (isAndroidTvUi()) return false;
    if (!isPhoneUi() && document.documentElement?.dataset?.phoneNative !== '1') return false;
    return !!window.__PLEX_CLIENT__;
};

export const installMediaDownloadsBridge = () => {
    if (typeof window === 'undefined') return;
    if (installPromise) return;
    installPromise = (async () => {
        const cap = await loadCapacitorCore();
        if (!cap?.Capacitor?.isNativePlatform?.() || !cap.registerPlugin) return;
        const plugin = cap.registerPlugin<CapMediaDownloadsPlugin>('MediaDownloads');
        capPlugin = plugin;
        const wire = async (event: string) => {
            try {
                await plugin.addListener(event, (data) => {
                    emit(mapItem(data));
                });
            } catch {
                /* ignore */
            }
        };
        void wire('progress');
        void wire('complete');
        void wire('error');
    })();
};

const ensurePlugin = async (): Promise<CapMediaDownloadsPlugin | null> => {
    installMediaDownloadsBridge();
    await installPromise;
    return capPlugin;
};

export const mediaDownloadsAvailable = async (): Promise<boolean> => {
    if (!isMediaDownloadsSupported()) return false;
    const plugin = await ensurePlugin();
    if (!plugin) return false;
    try {
        const result = await plugin.isAvailable();
        return !!result?.value;
    } catch {
        return false;
    }
};

export const listMediaDownloads = async (): Promise<MediaDownloadItem[]> => {
    const plugin = await ensurePlugin();
    if (!plugin) return [];
    try {
        const result = await plugin.list();
        return (result?.items || []).map(mapItem).filter(Boolean) as MediaDownloadItem[];
    } catch {
        return [];
    }
};

export const getMediaDownload = async (opts: { id?: string; ratingKey?: string }): Promise<MediaDownloadItem | null> => {
    const plugin = await ensurePlugin();
    if (!plugin) return null;
    try {
        const result = await plugin.get(opts);
        return mapItem(result?.item);
    } catch {
        return null;
    }
};

export const startMediaDownload = async (opts: MediaDownloadStartOpts): Promise<MediaDownloadItem | null> => {
    const plugin = await ensurePlugin();
    if (!plugin) throw new Error('Downloads are only available in the phone app.');
    const result = await plugin.start({
        url: opts.url,
        headers: opts.headers || {},
        ratingKey: opts.ratingKey,
        title: opts.title || 'Download',
        type: opts.type || 'movie',
        serverId: opts.serverId || '',
        plexGuid: opts.plexGuid || '',
        fileName: opts.fileName || '',
        thumbUrl: opts.thumbUrl || '',
        bytes: opts.bytes || 0,
    });
    const item = mapItem(result?.item);
    if (item) emit(item);
    return item;
};

export const cancelMediaDownload = async (id: string): Promise<boolean> => {
    const plugin = await ensurePlugin();
    if (!plugin || !id) return false;
    try {
        const result = await plugin.cancel({ id });
        return !!result?.ok;
    } catch {
        return false;
    }
};

export const deleteMediaDownload = async (opts: { id?: string; ratingKey?: string }): Promise<boolean> => {
    const plugin = await ensurePlugin();
    if (!plugin) return false;
    try {
        const result = await plugin.delete(opts);
        return !!result?.ok;
    } catch {
        return false;
    }
};

export const getMediaDownloadLocalUrl = async (opts: { id?: string; ratingKey?: string }): Promise<string> => {
    const plugin = await ensurePlugin();
    if (!plugin) return '';
    try {
        const result = await plugin.getLocalUrl(opts);
        return String(result?.url || '').trim();
    } catch {
        return '';
    }
};

export const onMediaDownloadChange = (listener: (item: MediaDownloadItem) => void): (() => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};
