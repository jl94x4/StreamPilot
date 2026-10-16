import { apiFetch, portalRequestHeaders } from '../shared/api';
import { portalUrl } from '../shared/basePath';
import { DEFAULT_CONFIG } from './constants';
import type { AppConfig, AppStatus, HistoryResponse, PinEvent, PlexCollection } from './types';

const base = (path: string) => {
    const clean = path.startsWith('/') ? path : `/${path}`;
    return `/api/collexions${clean}`;
};

/** Match portal Collexions BFF long-op proxy budget (10 min). */
const COLLEXIONS_LONG_MS = 600_000;

type CollexionsFetchInit = Omit<RequestInit, 'signal'>;

/** Collexions BFF fetch with optional abort signal (used by withTimeout). */
const cx = (path: string, init: CollexionsFetchInit = {}) =>
    (signal: AbortSignal) => apiFetch(base(path), { ...init, signal });

const withTimeout = async <T,>(
    task: (signal: AbortSignal) => Promise<T>,
    ms: number,
    label: string,
): Promise<T> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            task(controller.signal),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    controller.abort();
                    reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
                }, ms);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
};

export type CollexionsHealth = {
    ok: boolean;
    enabled: boolean;
    autostart: boolean;
    embedded?: { bundledAvailable?: boolean; running?: boolean; pid?: number | null };
    worker: {
        ok: boolean;
        reachable: boolean;
        error: string | null;
        detail: null | {
            ok: boolean;
            script?: string;
            plex?: { ok: boolean; error?: string | null };
            config?: { library_count?: number; dry_run?: boolean };
            issues?: string[];
        };
    };
    issues: string[];
};

export const collexionsImageUrl = (
    rawUrl: string,
    size: { width?: number; height?: number } = {},
) => {
    if (!rawUrl) return '';
    if (rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) return rawUrl;

    let path = rawUrl;
    if (path.startsWith('http://') || path.startsWith('https://')) {
        try {
            path = new URL(path).pathname;
        } catch {
            /* keep original */
        }
    }
    const q = path.indexOf('?');
    if (q >= 0) path = path.slice(0, q);
    if (!path.startsWith('/')) path = `/${path}`;

    // Use the portal Plex image proxy (transcoded + 24h browser cache) — one hop,
    // much faster than full-res through the Collexions Flask proxy.
    const width = size.width ?? 320;
    const height = size.height ?? 480;
    return portalUrl(
        `/api/plex/image?path=${encodeURIComponent(path)}&width=${width}&height=${height}`,
    );
};

class CollexionsApiService {
    async getAuthStatus(): Promise<{ is_setup: boolean; needs_onboarding?: boolean; portal_mode?: boolean }> {
        return withTimeout(cx('/auth/status'), 8000, 'Connecting to Collexions');
    }

    /** Portal + worker health (never hangs more than ~8s). */
    async getHealth(): Promise<CollexionsHealth> {
        return withTimeout(cx('/health'), 8000, 'Collexions health check');
    }

    /** Real portal Plex/TMDB values for seeding Collexions (admin-only; not masked). */
    async getPortalDefaults(): Promise<{
        plex_url: string;
        plex_token: string;
        tmdb_api_key: string;
        mediaServerType?: string;
        sources: { plex: boolean; tmdb: boolean; trakt: boolean; mdblist: boolean };
    }> {
        return withTimeout(cx('/portal-defaults'), 10000, 'Portal defaults');
    }

    async getConfig(): Promise<AppConfig> {
        const data = await withTimeout(cx('/config'), 10000, 'Loading config');
        return { ...DEFAULT_CONFIG, ...(data || {}) };
    }

    async saveConfig(config: AppConfig): Promise<void> {
        await withTimeout(
            cx('/config', { method: 'POST', body: JSON.stringify(config) }),
            COLLEXIONS_LONG_MS,
            'Saving config',
        );
    }

    /** Validate draft config against the worker (Plex reachability + library names). Does not save. */
    async validateConfig(config: AppConfig): Promise<{
        ok: boolean;
        errors: string[];
        warnings: string[];
        available_libraries?: string[];
    }> {
        return withTimeout(
            cx('/config/validate', { method: 'POST', body: JSON.stringify(config) }),
            COLLEXIONS_LONG_MS,
            'Validating config',
        );
    }

    async getStatus(): Promise<AppStatus> {
        try {
            return await withTimeout(cx('/status'), 8000, 'Status');
        } catch {
            return { status: 'Offline', last_update: '', next_run_timestamp: 0 };
        }
    }

    /** Home widget: last/next run + last-cycle pin count vs slots. */
    async getSummary(): Promise<{
        status: string;
        last_update: string;
        last_run_at?: string | null;
        next_run_timestamp?: number;
        pinned_count?: number | null;
        labeled_count?: number;
        pin_slots?: number;
    }> {
        return withTimeout(cx('/summary'), 20000, 'Collexions summary');
    }

    async getLogs(): Promise<string> {
        try {
            const response = await fetch(portalUrl(`${base('/logs')}?_=${Date.now()}`), {
                credentials: 'same-origin',
                cache: 'no-store',
                headers: portalRequestHeaders(),
            });
            if (!response.ok) throw new Error('Failed to load logs');
            return await response.text();
        } catch {
            return 'Backend is offline. Logs unavailable.';
        }
    }

    async clearLogs(): Promise<void> {
        await apiFetch(base('/logs/clear'), { method: 'POST', body: '{}' });
    }

    async getHistory(limit?: number): Promise<HistoryResponse> {
        const params = new URLSearchParams();
        if (limit) params.append('limit', String(limit));
        const qs = params.toString();
        const data = await withTimeout(
            cx(`/history${qs ? `?${qs}` : ''}`),
            15000,
            'History',
        );
        if (Array.isArray(data)) {
            return {
                events: data,
                total_count: data.length,
                unique_count: new Set(data.map((e: any) => e.collectionName)).size,
            };
        }
        return data;
    }

    async saveHistory(events: PinEvent[]): Promise<void> {
        await apiFetch(base('/history'), { method: 'POST', body: JSON.stringify(events) });
    }

    async runNow(): Promise<void> {
        await withTimeout(cx('/run', { method: 'POST', body: '{}' }), 60000, 'Start service');
    }

    async stopScript(): Promise<void> {
        await withTimeout(cx('/stop', { method: 'POST', body: '{}' }), 15000, 'Stop service');
    }

    async getCollections(forceRefresh = false, opts?: { light?: boolean }): Promise<PlexCollection[]> {
        // Do not wipe the gallery cache before listing — the worker serves a stale list
        // immediately and refreshes in the background (avoids Cloudflare HTTP 524).
        const params = new URLSearchParams();
        if (forceRefresh) params.append('refresh', 'true');
        // Default light=true on the worker — skip visibility() for fast first paint
        if (opts?.light === false) params.append('light', 'false');
        const qs = params.toString();
        const data = await withTimeout(
            cx(`/collections${qs ? `?${qs}` : ''}`),
            COLLEXIONS_LONG_MS,
            'Scanning Plex libraries',
        );
        if (data && typeof data === 'object' && !Array.isArray(data)) return data.collections || [];
        return data || [];
    }

    async getCollectionItems(ratingKey: string): Promise<{
        ratingKey: string;
        title: string;
        count: number;
        items: Array<{ ratingKey: string; title: string; type: string; library: string }>;
    }> {
        const key = String(ratingKey || '').trim();
        return withTimeout(
            cx(`/collections/${encodeURIComponent(key)}/items`),
            COLLEXIONS_LONG_MS,
            'Loading collection items',
        );
    }

    async resolveCollectionPins(
        items: Array<{ title: string; library: string }>,
    ): Promise<Record<string, boolean>> {
        if (!items.length) return {};
        const data = await withTimeout(
            cx('/collections/resolve-pins', {
                method: 'POST',
                body: JSON.stringify({ items }),
            }),
            COLLEXIONS_LONG_MS,
            'Resolving pin status',
        );
        return (data && data.pins) || {};
    }

    async bulkPinCollections(
        action: 'pin' | 'unpin' | 'delete',
        items: Array<{ title: string; library: string }>,
    ): Promise<{ success: boolean; ok_count: number; results: Array<{ ok: boolean; title: string; library: string; error?: string }> }> {
        const label = action === 'pin' ? 'Bulk pin' : action === 'unpin' ? 'Bulk unpin' : 'Bulk delete';
        return withTimeout(
            cx('/collections/bulk', {
                method: 'POST',
                body: JSON.stringify({ action, items }),
            }),
            COLLEXIONS_LONG_MS,
            label,
        );
    }

    async getTrending(): Promise<any[]> {
        try {
            return await apiFetch(base('/trending'));
        } catch {
            return [];
        }
    }

    async searchLibrary(library: string, query: string, genre?: string, year?: string): Promise<any[]> {
        const params = new URLSearchParams({ library, query });
        if (genre) params.append('genre', genre);
        if (year) params.append('year', year);
        return apiFetch(base(`/search/local?${params.toString()}`));
    }

    async searchExternal(query: string, type: 'movie' | 'tv'): Promise<any[]> {
        return withTimeout(
            cx(`/search/external?query=${encodeURIComponent(query)}&type=${type}`),
            90000,
            'External search',
        );
    }

    async getTmdbGenres(type: 'movie' | 'tv'): Promise<any[]> {
        return apiFetch(base(`/tmdb/genres?type=${type}`));
    }

    async discoverTmdb(params: Record<string, any>): Promise<any[]> {
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.append(key, String(value));
            }
        });
        return apiFetch(base(`/search/discover?${searchParams.toString()}`));
    }

    async createCollection(library: string, title: string, items: string[], sort_order = 'custom'): Promise<any> {
        return apiFetch(base('/collections/create'), {
            method: 'POST',
            body: JSON.stringify({ library, title, items, sort_order }),
        });
    }

    async createFromExternal(
        library: string,
        title: string,
        items: any[],
        sort_order = 'custom',
        auto_sync = false,
        source_type?: string,
        source_id?: string,
    ): Promise<any> {
        return apiFetch(base('/collections/create-from-external'), {
            method: 'POST',
            body: JSON.stringify({ library, title, items, sort_order, auto_sync, source_type, source_id }),
        });
    }

    async getTemplates(): Promise<{
        templates: Array<{
            id: string;
            name: string;
            description: string;
            category: string;
            media: string;
            source_type: string;
            source_id: string;
            default_sort: string;
            requires: string[];
            available: boolean;
        }>;
        categories: Array<{ id: string; label: string }>;
        keys: { tmdb: boolean; trakt: boolean };
    }> {
        return withTimeout(cx('/templates'), 15000, 'Templates');
    }

    async searchFranchises(query: string): Promise<Array<{
        id: number;
        name: string;
        overview: string;
        poster: string | null;
        source_type: string;
        source_id: string;
        film_count?: number | null;
    }>> {
        return withTimeout(
            cx(`/templates/franchise-search?q=${encodeURIComponent(query)}`),
            30000,
            'Franchise search',
        );
    }

    async createFromTemplate(payload: {
        library: string;
        template_id?: string;
        title?: string;
        source_type?: string;
        source_id?: string;
        sort_order?: string;
        auto_sync?: boolean;
    }): Promise<{ success: boolean; matched?: number; total?: number; job_id?: string; title?: string; error?: string }> {
        return withTimeout(
            cx('/templates/create', { method: 'POST', body: JSON.stringify(payload) }),
            COLLEXIONS_LONG_MS,
            'Creating collection',
        );
    }

    async getJobs(): Promise<any> {
        return apiFetch(base('/jobs'));
    }

    async getJobPreview(id: string): Promise<{
        success: boolean;
        error?: string;
        name?: string;
        library?: string;
        source_type?: string;
        source_id?: string;
        source_count?: number;
        matched?: Array<{
            title?: string;
            plex_title?: string;
            year?: number | string | null;
            rating_key?: string;
            tmdb_id?: string;
            status?: string;
            reason?: string;
        }>;
        unmatched?: Array<{ title?: string; tmdb_id?: string; year?: number | string | null }>;
        excluded?: Array<{ title?: string; tmdb_id?: string; rating_key?: string }>;
        extras?: Array<{ title?: string; plex_title?: string; rating_key?: string; year?: number | null }>;
        unexpected?: Array<{ title?: string; plex_title?: string; rating_key?: string; year?: number | null }>;
    }> {
        return withTimeout(cx(`/jobs/preview?id=${encodeURIComponent(id)}`), COLLEXIONS_LONG_MS, 'Job preview');
    }

    async updateJobItems(payload: {
        id: string;
        exclude_tmdb_ids?: string[];
        exclude_rating_keys?: string[];
        remove_rating_keys?: string[];
        add_rating_keys?: string[];
        extra_rating_keys?: string[];
        apply?: boolean;
    }): Promise<{ success: boolean; error?: string; matched?: number; added?: number; removed?: number }> {
        return withTimeout(
            cx('/jobs/items', { method: 'POST', body: JSON.stringify(payload) }),
            COLLEXIONS_LONG_MS,
            'Updating collection items',
        );
    }

    async runJobNow(idOrPayload: string | { id?: string; ids?: string[]; all?: boolean }): Promise<any> {
        const payload = typeof idOrPayload === 'string' ? { id: idOrPayload } : idOrPayload;
        return withTimeout(
            cx('/jobs/run', { method: 'POST', body: JSON.stringify(payload) }),
            COLLEXIONS_LONG_MS,
            payload.all ? 'Running all sync jobs' : 'Running sync job',
        );
    }

    async getJobRunProgress(): Promise<{
        running: boolean;
        total: number;
        done: number;
        failed: number;
        current: string;
        currentId: string;
        percent: number;
    }> {
        const raw = await withTimeout(cx('/jobs/progress'), 8000, 'Job progress') as Record<string, unknown>;
        return {
            running: Boolean(raw?.running),
            total: Number(raw?.total || 0),
            done: Number(raw?.done || 0),
            failed: Number(raw?.failed || 0),
            current: String(raw?.current || ''),
            currentId: String(raw?.current_id || ''),
            percent: Number(raw?.percent || 0),
        };
    }

    async updateJob(payload: { id?: string; ids?: string[]; all?: boolean; sort_order?: string; auto_sync?: boolean }): Promise<any> {
        return withTimeout(
            cx('/jobs/update', { method: 'POST', body: JSON.stringify(payload) }),
            COLLEXIONS_LONG_MS,
            'Updating job',
        );
    }

    async deleteJob(id: string): Promise<any> {
        return apiFetch(base('/jobs/delete'), { method: 'POST', body: JSON.stringify({ id }) });
    }

    async getTraktList(url: string): Promise<any[]> {
        return apiFetch(base(`/trakt/list?url=${encodeURIComponent(url)}`));
    }

    async searchTraktLists(query: string): Promise<Array<{
        name: string;
        description: string;
        username: string;
        slug: string;
        url: string;
        item_count?: number | null;
        likes?: number | null;
        trakt_id?: number | null;
        score?: number | null;
    }>> {
        return withTimeout(
            cx(`/trakt/lists/search?q=${encodeURIComponent(query)}`),
            30000,
            'Trakt list search',
        );
    }

    async getMdbList(url: string): Promise<any[]> {
        return apiFetch(base(`/mdblist/list?url=${encodeURIComponent(url)}`));
    }

    async pinCollection(title: string, library: string): Promise<void> {
        await apiFetch(base('/collections/pin'), { method: 'POST', body: JSON.stringify({ title, library }) });
    }

    async unpinCollection(title: string, library: string): Promise<void> {
        await apiFetch(base('/collections/unpin'), { method: 'POST', body: JSON.stringify({ title, library }) });
    }

    async deleteCollection(title: string, library: string, ratingKey?: string): Promise<{ success: boolean; removed_jobs?: string[] }> {
        return apiFetch(base('/collections/delete'), {
            method: 'POST',
            body: JSON.stringify({ title, library, ratingKey }),
        });
    }

    async fixCollectionArt(
        library: string,
        title?: string,
        force = false,
    ): Promise<{ success: boolean; ok_count?: number; results?: Array<{ title: string; library: string; ok: boolean }> }> {
        return withTimeout(
            cx('/collections/fix-art', {
                method: 'POST',
                body: JSON.stringify({ library, title, force }),
            }),
            COLLEXIONS_LONG_MS,
            'Fixing collection art',
        );
    }

    async scanCollectionWebHealth(library?: string, deep = true): Promise<{
        success: boolean;
        scanned?: number;
        libraries?: string[];
        deep?: boolean;
        suspects?: Array<{
            title: string;
            library: string;
            ratingKey?: string;
            smart?: boolean;
            issues: string[];
        }>;
        errors?: string[];
        error?: string;
    }> {
        const params = new URLSearchParams();
        if (library) params.set('library', library);
        if (deep) params.set('deep', '1');
        const q = params.toString() ? `?${params.toString()}` : '';
        return withTimeout(
            cx(`/collections/web-health${q}`),
            COLLEXIONS_LONG_MS,
            'Scanning collections for Plex Web crashes',
        );
    }

    async repairCollectionsWeb(library?: string): Promise<{
        success: boolean;
        started?: boolean;
        running?: boolean;
        phase?: string;
        scanned?: number;
        purged?: number;
        pruned?: number;
        converted?: number;
        posters?: number;
        libraries?: string[];
        results?: Array<{ library: string; scanned: number; purged: number; pruned: number; converted?: number; posters?: number }>;
        errors?: string[];
        error?: string;
    }> {
        return withTimeout(
            cx('/collections/repair-web', {
                method: 'POST',
                body: JSON.stringify(library ? { library } : {}),
            }),
            30_000,
            'Starting Plex Collections tab repair',
        );
    }

    async repairCollectionsWebStatus(): Promise<{
        success: boolean;
        started?: boolean;
        running?: boolean;
        phase?: string;
        scanned?: number;
        purged?: number;
        pruned?: number;
        converted?: number;
        posters?: number;
        libraries?: string[];
        results?: Array<{ library: string; scanned: number; purged: number; pruned: number; converted?: number; posters?: number }>;
        errors?: string[];
        error?: string;
    }> {
        return withTimeout(
            cx('/collections/repair-web'),
            20_000,
            'Checking Collections tab repair',
        );
    }

    async getPlexLibraries(): Promise<any[]> {
        return apiFetch(base('/plex/libraries'));
    }

    async getManagedHubs(library: string): Promise<{
        library: string;
        library_type: string;
        section_id: number | string;
        hubs: Array<{
            identifier: string;
            title: string;
            promoted_to_recommended: boolean;
            promoted_to_home: boolean;
            promoted_to_shared: boolean;
            deletable: boolean;
            is_collection: boolean;
        }>;
    }> {
        return withTimeout(
            cx(`/hubs?library=${encodeURIComponent(library)}`),
            COLLEXIONS_LONG_MS,
            'Loading hubs',
        );
    }

    async moveManagedHub(
        library: string,
        identifier: string,
        after: string | null,
    ): Promise<{ success: boolean; hubs?: any[]; error?: string }> {
        return withTimeout(
            cx('/hubs/move', {
                method: 'POST',
                body: JSON.stringify({ library, identifier, after }),
            }),
            COLLEXIONS_LONG_MS,
            'Reordering hub',
        );
    }

    async updateHubVisibility(
        library: string,
        identifier: string,
        visibility: { recommended?: boolean; home?: boolean; shared?: boolean },
    ): Promise<{ success: boolean; hub?: any; error?: string }> {
        return withTimeout(
            cx('/hubs/visibility', {
                method: 'POST',
                body: JSON.stringify({ library, identifier, ...visibility }),
            }),
            COLLEXIONS_LONG_MS,
            'Updating hub visibility',
        );
    }
}

export const api = new CollexionsApiService();
