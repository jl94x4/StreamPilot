import { apiFetch, portalRequestHeaders } from '../shared/api';
import { portalUrl } from '../shared/basePath';

const WORKER = '/api/spotify-to-plex/worker';

export const workerFetch = async (path: string, options: RequestInit = {}) => {
    const rel = String(path || '').replace(/^\/+/, '');
    return apiFetch(`${WORKER}/${rel}`, options);
};

export const workerImageUrl = (src?: string | null) => {
    const value = String(src || '').trim();
    if (!value) return '';
    if (value.startsWith('/api/')) {
        return portalUrl(`${WORKER}/${value.replace(/^\/api\//, '')}`);
    }
    return value;
};

export const workerFetchJson = async (path: string, options: RequestInit = {}) => {
    const rel = String(path || '').replace(/^\/+/, '');
    const response = await fetch(portalUrl(`${WORKER}/${rel}`), {
        credentials: 'same-origin',
        ...options,
        headers: portalRequestHeaders({
            ...(options.headers || {}),
        }),
    });
    let data: any = null;
    if (response.status !== 204) {
        data = await response.json().catch(() => ({}));
    }
    if (!response.ok) {
        const err: any = new Error(data?.error || data?.message || data?.msg || `Spotify Sync worker HTTP ${response.status}`);
        err.status = response.status;
        err.data = data;
        throw err;
    }
    return data;
};

/** Adapter for syncSpotifyPlaylistToPlex({ fetchJson }). Caps waits under typical Cloudflare proxy timeouts. */
export const workerJson = async ({
    path,
    method = 'GET',
    body,
    timeoutMs,
}: { path: string; method?: string; body?: unknown; timeoutMs?: number } = { path: '' }) => {
    const rel = String(path || '').replace(/^\/api\//, '');
    const verb = String(method || 'GET').toUpperCase();
    const ms = Math.min(Math.max(1000, Number(timeoutMs) || 90_000), 95_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        return await workerFetchJson(rel, {
            method: verb,
            body: body != null && verb !== 'GET' && verb !== 'HEAD' ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });
    } catch (error: any) {
        if (error?.name === 'AbortError') {
            throw new Error('Spotify Sync worker timed out. Try a smaller playlist, or retry.');
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
};

export const formatWhen = (value?: unknown) => {
    if (value == null || value === '') return '—';
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return formatWhen(record.end ?? record.finishedAt ?? record.timestamp ?? record.start ?? record.date);
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        const ms = value > 0 && value < 1e12 ? value * 1000 : value;
        return new Date(ms).toLocaleString();
    }
    const parsed = Date.parse(String(value));
    if (!Number.isFinite(parsed)) return '—';
    return new Date(parsed).toLocaleString();
};
