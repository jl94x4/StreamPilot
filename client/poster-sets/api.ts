import { apiFetch, PORTAL_CSRF_HEADER, PORTAL_CSRF_VALUE, portalRequestHeaders } from '../shared/api';
import { portalUrl } from '../shared/basePath';
import type {
    PosterSetsAuditEntry,
    PosterSetsBrowseResponse,
    PosterSetsCollectionsResponse,
    PosterSetsConfig,
    PosterSetsJob,
    PosterSetsJobInput,
    PosterSetsPreview,
    PosterSetsQueueResponse,
    PosterSetsQueueStats,
    PosterSetsSearchResult,
    PosterSetsSetMeta,
    PosterSetsStatus,
    PosterSetsTitleStatus,
    PosterSetsWatch,
    PosterSetsWatcherPassStatus,
    PosterSetsWatchStats,
} from './types';

const ROOT = '/api/poster-sets';

export class PosterSetsTitleWatchConflict extends Error {
    code = 'title_watch_exists' as const;
    existing: PosterSetsWatch[];
    incoming: PosterSetsWatch | null;

    constructor(data: {
        error?: string;
        existing?: PosterSetsWatch[];
        incoming?: PosterSetsWatch | null;
    }) {
        super(data.error || 'Already watching a set for this title.');
        this.name = 'PosterSetsTitleWatchConflict';
        this.existing = Array.isArray(data.existing) ? data.existing : [];
        this.incoming = data.incoming || null;
    }
}

export type PosterSetsAddWatchPayload = {
    url: string;
    title?: string;
    user?: string;
    thumbUrl?: string;
    provider?: string;
    setId?: string;
    mediuxFilters?: string[];
    setKind?: string | null;
    tmdbId?: string | null;
    tvdbId?: string | null;
    replaceExisting?: boolean;
};

export type TpdbCacheDiskAudit = {
    scannedAt?: string;
    elapsedMs?: number;
    counts?: {
        titles?: number;
        sets?: number;
        images?: number;
        imageBytes?: number;
    };
    folders?: {
        titles?: string;
        sets?: string;
        images?: string;
        proxyThumbs?: string;
    };
    titles?: {
        files?: number;
        valid?: number;
        invalid?: number;
        unique?: number;
        aliasExtra?: number;
    };
    sets?: {
        files?: number;
        referenced?: number;
        orphan?: number;
        missingFromDisk?: number;
    };
    images?: {
        files?: number;
        referenced?: number;
        orphan?: number;
    };
    proxyThumbs?: {
        files?: number;
        bytes?: number;
        note?: string;
    };
};

const json = (body: unknown) => ({
    method: 'POST' as const,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
});

export type PosterSetsSearchPayload = {
    provider: 'mediux' | 'posterdb' | 'both';
    query?: string;
    titleUrl?: string;
    tmdbId?: string | number;
    tvdbId?: string | number;
    imdbId?: string | number;
    titleHint?: string;
    yearHint?: number | null;
    mediaType?: string;
    mode?: 'title' | 'creator' | 'recent' | 'feed';
    titleSources?: Array<{
        provider: string;
        id?: string;
        url?: string;
        mediaType?: string | null;
        tmdbId?: string | number;
    }>;
    title?: string;
    dupePreference?: 'posterdb' | 'mediux';
    limit?: number;
    batchPages?: number;
    /** Force a live TPDB scrape and merge new sets into the local cache. */
    refresh?: boolean;
};

const readNdjsonStream = async (
    response: Response,
    onEvent: (event: PosterSetsSearchResult & { type?: string }) => void,
    signal?: AbortSignal,
) => {
    if (!response.body) {
        throw new Error('Streaming search is not supported in this browser.');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
        while (true) {
            if (signal?.aborted) {
                await reader.cancel().catch(() => undefined);
                throw new DOMException('Aborted', 'AbortError');
            }
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (signal?.aborted) {
                    await reader.cancel().catch(() => undefined);
                    throw new DOMException('Aborted', 'AbortError');
                }
                const trimmed = line.trim();
                if (!trimmed) continue;
                onEvent(JSON.parse(trimmed) as PosterSetsSearchResult & { type?: string });
            }
        }
        if (buffer.trim()) {
            if (signal?.aborted) {
                await reader.cancel().catch(() => undefined);
                throw new DOMException('Aborted', 'AbortError');
            }
            onEvent(JSON.parse(buffer.trim()) as PosterSetsSearchResult & { type?: string });
        }
    } finally {
        reader.releaseLock();
    }
};

export const posterSetsApi = {
    status: () => apiFetch(`${ROOT}/status`) as Promise<PosterSetsStatus>,
    getConfig: () => apiFetch(`${ROOT}/config`) as Promise<{ config: PosterSetsConfig }>,
    saveConfig: (config: Partial<PosterSetsConfig>) => apiFetch(`${ROOT}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
    }) as Promise<{ ok: boolean; config: PosterSetsConfig }>,
    importPortal: () => apiFetch(`${ROOT}/import-portal`, json({})) as Promise<{
        ok: boolean;
        config: PosterSetsConfig;
        imported?: {
            base_url?: string;
            tv_library?: string[];
            movie_library?: string[];
            librarySource?: string;
        };
        error?: string;
    }>,
    test: (config?: Partial<PosterSetsConfig>) => apiFetch(`${ROOT}/test`, json(config || {})) as Promise<{
        ok: boolean;
        server?: string;
        tvLibraries?: string[];
        movieLibraries?: string[];
        sections?: Array<{ title?: string; type?: string }>;
        logs?: string[];
        error?: string;
        tpdb?: {
            ok?: boolean;
            error?: string;
            warning?: string;
            cloudflare?: boolean;
            via?: string;
            sampleTitle?: string;
        };
    }>,
    importTpdbCookies: (payload: {
        cookies: string;
        userAgent?: string;
        tpdb_username?: string;
        tpdb_password?: string;
    }) => apiFetch(`${ROOT}/tpdb-import-cookies`, json(payload)) as Promise<{
        ok: boolean;
        error?: string;
        cloudflare?: boolean;
        cookieCount?: number;
        hasCfClearance?: boolean;
        via?: string;
        htmlOnly?: boolean;
        warning?: string;
        logs?: string[];
    }>,
    preview: (url: string, options?: { mediuxFilters?: string[] }) => apiFetch(`${ROOT}/preview`, json({
        url,
        ...(options?.mediuxFilters?.length ? { mediuxFilters: options.mediuxFilters } : {}),
    })) as Promise<PosterSetsPreview>,
    search: (payload: PosterSetsSearchPayload, init?: { signal?: AbortSignal }) => (
        apiFetch(`${ROOT}/search`, { ...json(payload), signal: init?.signal }) as Promise<PosterSetsSearchResult>
    ),
    browse: (options?: { refresh?: boolean }) => (
        apiFetch(`${ROOT}/browse`, json({ refresh: Boolean(options?.refresh) })) as Promise<PosterSetsBrowseResponse>
    ),
    collections: (options?: { refresh?: boolean }) => (
        apiFetch(`${ROOT}/collections`, json({ refresh: Boolean(options?.refresh) })) as Promise<PosterSetsCollectionsResponse>
    ),
    /**
     * Creator / recent catalogs stream NDJSON batches (first ~3 source pages, then more).
     * `onBatch` is called with the full merged set list so far.
     */
    searchCatalogStream: async (
        payload: PosterSetsSearchPayload,
        {
            onBatch,
            signal,
        }: {
            onBatch: (event: PosterSetsSearchResult & { type?: string }) => void;
            signal?: AbortSignal;
        },
    ) => {
        const response = await fetch(portalUrl(`${ROOT}/search`), {
            method: 'POST',
            credentials: 'same-origin',
            signal,
            headers: portalRequestHeaders({
                Accept: 'application/x-ndjson, application/json',
                [PORTAL_CSRF_HEADER]: PORTAL_CSRF_VALUE,
            }),
            body: JSON.stringify({
                ...payload,
                mode: payload.mode || 'creator',
                batchPages: payload.batchPages ?? 3,
            }),
        });

        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Search failed' }));
            throw new Error(errorData.error || `Search failed with status ${response.status}`);
        }

        if (!contentType.includes('ndjson')) {
            const data = await response.json() as PosterSetsSearchResult;
            onBatch({ ...data, type: 'result', loading: false });
            return data;
        }

        let finalEvent: PosterSetsSearchResult | null = null;
        await readNdjsonStream(response, (event) => {
            if (event.type === 'error' || event.ok === false) {
                throw new Error(event.error || 'Creator search failed');
            }
            onBatch(event);
            if (event.type === 'result' || event.loading === false) {
                finalEvent = event;
            }
        }, signal);
        return finalEvent;
    },
    searchCreatorStream: (
        payload: PosterSetsSearchPayload,
        options: {
            onBatch: (event: PosterSetsSearchResult & { type?: string }) => void;
            signal?: AbortSignal;
        },
    ) => posterSetsApi.searchCatalogStream({ ...payload, mode: 'creator' }, options),
    apply: (
        url: string,
        selectedIds?: string[],
        setMeta?: PosterSetsSetMeta | null,
        source?: 'manual' | 'bulk' | 'watch',
        mediuxFilters?: string[],
        plexHint?: { ratingKey?: string; title?: string; mediaType?: string } | null,
        selectedAssets?: PosterSetsJobInput['selectedAssets'],
    ) => (
        apiFetch(`${ROOT}/apply`, json({
            url,
            ...(selectedIds?.length ? { selectedIds } : {}),
            ...(setMeta ? { setMeta } : {}),
            ...(source ? { source } : {}),
            ...(mediuxFilters?.length ? { mediuxFilters } : {}),
            ...(plexHint ? { plexHint } : {}),
            ...(selectedAssets?.length ? { selectedAssets } : {}),
        })) as Promise<{ ok: boolean; jobId: string; job: PosterSetsJob; queued?: boolean }>
    ),
    imageUrl: (thumbUrl: string) => `${ROOT}/image?url=${encodeURIComponent(thumbUrl)}`,
    bulk: (payload: { urls?: string[]; text?: string; fromFile?: boolean }) => (
        apiFetch(`${ROOT}/bulk`, json(payload)) as Promise<{ ok: boolean; jobId: string; job: PosterSetsJob; queued?: boolean }>
    ),
    job: (id: string) => apiFetch(`${ROOT}/jobs/${encodeURIComponent(id)}`) as Promise<{ job: PosterSetsJob }>,
    jobs: () => apiFetch(`${ROOT}/jobs`) as Promise<{ ok?: boolean; jobs: PosterSetsJob[] }>,
    queue: () => apiFetch(`${ROOT}/queue`) as Promise<PosterSetsQueueResponse>,
    pauseQueue: (paused: boolean) => apiFetch(`${ROOT}/queue/pause`, json({ paused })) as Promise<{
        ok: boolean;
        paused: boolean;
        stats: PosterSetsQueueStats;
    }>,
    cancelQueueJob: (id: string) => apiFetch(`${ROOT}/queue/cancel/${encodeURIComponent(id)}`, json({})) as Promise<{
        ok: boolean;
        job: PosterSetsJob;
    }>,
    stopQueueJob: (id: string) => apiFetch(`${ROOT}/queue/stop/${encodeURIComponent(id)}`, json({})) as Promise<{
        ok: boolean;
        job: PosterSetsJob;
    }>,
    retryQueueJob: (id: string) => apiFetch(`${ROOT}/queue/retry/${encodeURIComponent(id)}`, json({})) as Promise<{
        ok: boolean;
        job: PosterSetsJob;
    }>,
    dismissQueueJob: (id: string) => apiFetch(`${ROOT}/queue/dismiss/${encodeURIComponent(id)}`, json({})) as Promise<{
        ok: boolean;
        job: PosterSetsJob;
        stats: PosterSetsQueueStats;
        jobs: PosterSetsJob[];
    }>,
    clearFinishedQueue: () => apiFetch(`${ROOT}/queue/clear-finished`, json({})) as Promise<{
        ok: boolean;
        stats: PosterSetsQueueStats;
        jobs: PosterSetsJob[];
    }>,
    clearQueuedJobs: () => apiFetch(`${ROOT}/queue/clear-queued`, json({})) as Promise<{
        ok: boolean;
        cancelled?: number;
        stats: PosterSetsQueueStats;
        jobs: PosterSetsJob[];
    }>,
    watches: () => apiFetch(`${ROOT}/watches`) as Promise<{
        ok?: boolean;
        watches: PosterSetsWatch[];
        stats?: PosterSetsWatchStats;
    }>,
    watchByUrl: (url: string) => apiFetch(`${ROOT}/watches?url=${encodeURIComponent(url)}`) as Promise<{
        ok?: boolean;
        watch: PosterSetsWatch | null;
        watches?: PosterSetsWatch[];
        stats?: PosterSetsWatchStats;
    }>,
    addWatch: async (payload: PosterSetsAddWatchPayload) => {
        const response = await fetch(portalUrl(`${ROOT}/watches`), {
            credentials: 'same-origin',
            ...json(payload),
            headers: portalRequestHeaders(),
        });
        const data = await response.json().catch(() => ({ error: 'Failed to add watch' })) as {
            ok?: boolean;
            watch?: PosterSetsWatch;
            replaced?: PosterSetsWatch[];
            error?: string;
            code?: string;
            existing?: PosterSetsWatch[];
            incoming?: PosterSetsWatch | null;
        };
        if (response.status === 409 && data.code === 'title_watch_exists') {
            throw new PosterSetsTitleWatchConflict(data);
        }
        if (!response.ok) {
            throw new Error(data.error || `Failed to add watch (${response.status})`);
        }
        return data as { ok: boolean; watch: PosterSetsWatch; replaced?: PosterSetsWatch[] };
    },
    patchWatch: (id: string, patch: {
        mediuxFilters?: string[];
        enabled?: boolean;
        title?: string;
        user?: string;
        thumbUrl?: string;
        setKind?: string | null;
        lastError?: null;
    }) => apiFetch(`${ROOT}/watches/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
    }) as Promise<{ ok: boolean; watch: PosterSetsWatch }>,
    toggleWatch: (id: string, enabled?: boolean) => apiFetch(`${ROOT}/watches/${encodeURIComponent(id)}/toggle`, json(
        enabled === undefined ? {} : { enabled },
    )) as Promise<{ ok: boolean; watch: PosterSetsWatch }>,
    checkWatch: (id: string, enqueue = true) => apiFetch(`${ROOT}/watches/${encodeURIComponent(id)}/check`, json({ enqueue })) as Promise<{
        ok: boolean;
        watch?: PosterSetsWatch;
        newIds?: string[];
        queued?: boolean;
        baseline?: boolean;
    }>,
    reapplyWatch: (id: string, mode: 'entire' | 'matched') => (
        apiFetch(`${ROOT}/watches/${encodeURIComponent(id)}/reapply`, json({ mode })) as Promise<{
            ok: boolean;
            watch?: PosterSetsWatch;
            mode?: 'entire' | 'matched';
            queued?: boolean;
            selectedCount?: number | null;
            jobId?: string | null;
            job?: PosterSetsJob | null;
        }>
    ),
    runWatches: () => apiFetch(`${ROOT}/watches/run`, json({})) as Promise<{
        ok: boolean;
        started?: boolean;
        running?: boolean;
        message?: string;
        checked?: number;
        queued?: number;
        assetsQueued?: number;
        errors?: Array<{ id: string; error: string }>;
        error?: string;
        status?: PosterSetsWatcherPassStatus;
    }>,
    watchesRunStatus: () => apiFetch(`${ROOT}/watches/run-status`) as Promise<{
        ok: boolean;
        kickInFlight?: boolean;
        status: PosterSetsWatcherPassStatus;
    }>,
    unlockWatchesRun: () => apiFetch(`${ROOT}/watches/run-unlock`, json({})) as Promise<{
        ok: boolean;
        wasBusy?: boolean;
        kickInFlight?: boolean;
        status: PosterSetsWatcherPassStatus;
    }>,
    deleteWatch: (id: string) => apiFetch(`${ROOT}/watches/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
    }) as Promise<{ ok: boolean; watch: PosterSetsWatch }>,
    clearWatchErrors: () => apiFetch(`${ROOT}/watches/clear-errors`, json({})) as Promise<{
        ok: boolean;
        cleared: number;
        watches: PosterSetsWatch[];
        stats?: PosterSetsWatchStats;
    }>,
    tpdbCacheStatus: () => apiFetch(`${ROOT}/tpdb-cache`) as Promise<{
        ok: boolean;
        cacheEnabled?: boolean;
        prefetchEnabled?: boolean;
        prioritizeFollowedCreators?: boolean;
        paused?: boolean;
        followedPrefetchOnly?: boolean;
        titles?: number;
        sets?: number;
        images?: number;
        imageBytes?: number;
        diskScanning?: boolean;
        rootDir?: string;
        relativeRoot?: string;
        folders?: { titles?: string; sets?: string; images?: string };
        current?: string | null;
        activity?: Array<{
            at: number;
            level: string;
            kind?: string;
            message: string;
            detail?: string | null;
        }>;
        progress?: {
            busy?: boolean;
            warm?: {
                total?: number;
                completed?: number;
                skippedCached?: number;
                failed?: number;
                percent?: number | null;
                etaMs?: number | null;
                elapsedMs?: number | null;
                startedAt?: number | null;
                finishedAt?: number | null;
            };
            hydrate?: {
                total?: number;
                completed?: number;
                percent?: number | null;
                etaMs?: number | null;
                elapsedMs?: number | null;
            };
        };
        hydrate?: {
            queue?: number;
            active?: number;
            lastError?: string | null;
            warmQueue?: number;
            warmActive?: number;
            rateLimit?: { gapMs?: number; cooldownMs?: number; msSinceLastRequest?: number | null };
        };
        libraryContinue?: {
            enabled?: boolean;
            busy?: boolean;
            exhausted?: number;
        };
        dailyRefresh?: {
            hourLocal?: number;
            intervalHours?: number;
            running?: boolean;
            lastRunAt?: string | null;
            nextRunAt?: string | null;
            lastResult?: unknown;
            busy?: boolean;
        };
        audit?: TpdbCacheDiskAudit;
    }>,
    tpdbCacheAuditDisk: () => apiFetch(`${ROOT}/tpdb-cache/audit-disk`, json({})) as Promise<{
        ok: boolean;
        titles?: number;
        sets?: number;
        images?: number;
        imageBytes?: number;
        audit?: TpdbCacheDiskAudit;
        [key: string]: unknown;
    }>,
    clearTpdbCache: () => apiFetch(`${ROOT}/tpdb-cache/clear`, json({})) as Promise<{
        ok: boolean;
        cleared?: { titles?: number; sets?: number; images?: number };
    }>,
    clearMediuxCache: () => apiFetch(`${ROOT}/mediux-cache/clear`, json({})) as Promise<{
        ok: boolean;
        cleared?: { browse?: number; collections?: number };
    }>,
    pauseTpdbCache: () => apiFetch(`${ROOT}/tpdb-cache/pause`, json({})) as Promise<{ ok: boolean; paused?: boolean }>,
    resumeTpdbCache: () => apiFetch(`${ROOT}/tpdb-cache/resume`, json({})) as Promise<{ ok: boolean; paused?: boolean }>,
    stopTpdbCache: () => apiFetch(`${ROOT}/tpdb-cache/stop`, json({})) as Promise<{
        ok: boolean;
        stopped?: boolean;
        droppedTitles?: number;
        droppedSets?: number;
    }>,
    tpdbCacheCoverage: (items: Array<{
        tmdbId?: string | number | null;
        id?: string | number | null;
        title?: string;
        year?: number | null;
        mediaType?: string;
    }>) => apiFetch(`${ROOT}/tpdb-cache/coverage`, json({ items })) as Promise<{
        ok: boolean;
        coverage?: Record<string, { level?: string; setCount?: number }>;
    }>,
    warmTpdbLibraryCache: async (items: Array<{
        tmdbId?: string | number | null;
        id?: string | number | null;
        title?: string;
        year?: number | null;
        mediaType?: string;
    }>, options: {
        force?: boolean;
        skipCached?: boolean;
        followedPrefetchOnly?: boolean;
        followedCreatorsOnly?: boolean;
        fromLibrary?: boolean;
        media?: 'all' | 'movie' | 'show';
        source?: 'full' | 'recent';
    } = {}) => {
        const list = Array.isArray(items) ? items : [];
        // Stay well under reverse-proxy / historical body limits — queue merges across calls.
        const CHUNK = 80;
        let titles = 0;
        let skippedCached = 0;
        let lastMessage = '';
        const payloadExtra = {
            ...(options.force === true || options.skipCached === false ? { force: true } : {}),
            ...(options.followedPrefetchOnly === true ? { followedPrefetchOnly: true } : {}),
            ...(options.followedCreatorsOnly === true ? { followedCreatorsOnly: true } : {}),
            ...(options.followedCreatorsOnly === false ? { followedCreatorsOnly: false } : {}),
            ...(options.fromLibrary === true ? {
                fromLibrary: true,
                media: options.media || 'all',
                source: options.source || 'full',
            } : {}),
        };
        if (options.fromLibrary === true || !list.length) {
            return apiFetch(`${ROOT}/tpdb-cache/warm-library`, json({
                items: list,
                ...payloadExtra,
            })) as Promise<{
                ok: boolean;
                started?: boolean;
                titles?: number;
                skippedCached?: number;
                message?: string;
            }>;
        }
        for (let offset = 0; offset < list.length; offset += CHUNK) {
            const chunk = list.slice(offset, offset + CHUNK);
            const result = await apiFetch(`${ROOT}/tpdb-cache/warm-library`, json({
                items: chunk,
                ...payloadExtra,
            })) as {
                ok: boolean;
                started?: boolean;
                titles?: number;
                skippedCached?: number;
                message?: string;
            };
            titles += Number(result.titles) || 0;
            skippedCached += Number(result.skippedCached) || 0;
            lastMessage = String(result.message || lastMessage);
        }
        return {
            ok: true,
            started: true,
            titles,
            skippedCached,
            message: lastMessage
                || `Queued ${titles} library title(s) for cache build`
                + (skippedCached ? ` (skipped ${skippedCached} already cached).` : '.'),
        };
    },
    audit: (limit = 100) => apiFetch(`${ROOT}/audit?limit=${encodeURIComponent(String(limit))}`) as Promise<{
        ok?: boolean;
        entries: PosterSetsAuditEntry[];
    }>,
    clearFailedAudit: () => apiFetch(`${ROOT}/audit/clear-failed`, json({})) as Promise<{
        ok: boolean;
        removed: number;
        entries: PosterSetsAuditEntry[];
    }>,
    clearFailedJobs: () => apiFetch(`${ROOT}/jobs/clear-failed`, json({})) as Promise<{
        ok: boolean;
        removed: number;
        jobs: PosterSetsJob[];
    }>,
    libraryRecent: (limit = 120, options?: { refresh?: boolean }) => apiFetch(
        `/api/media-server/library/recent?limit=${encodeURIComponent(String(limit))}${options?.refresh ? '&refresh=1' : ''}`,
    ) as Promise<{
        serverType?: string;
        movies?: Array<Record<string, unknown>>;
        shows?: Array<Record<string, unknown>>;
        items?: Array<Record<string, unknown>>;
    }>,
    librarySearch: (query: string, limit = 40, options?: { refresh?: boolean }) => apiFetch(
        `/api/media-server/library/search?q=${encodeURIComponent(query)}&limit=${encodeURIComponent(String(limit))}${options?.refresh ? '&refresh=1' : ''}`,
    ) as Promise<{
        serverType?: string;
        results?: Array<Record<string, unknown>>;
    }>,
    librarySections: (options?: { refresh?: boolean }) => apiFetch(
        `/api/media-server/library/sections${options?.refresh ? '?refresh=1' : ''}`,
    ) as Promise<{ serverType?: string; sections?: Array<{ key: string; title: string; type: string; count?: number }> }>,
    libraryBrowse: (options: {
        section?: string;
        type?: 'movie' | 'show' | '';
        sort?: string;
        cacheStatus?: 'all' | 'cached' | 'uncached';
        start?: number;
        limit?: number;
        refresh?: boolean;
    } = {}) => {
        const params = new URLSearchParams();
        if (options.section) params.set('section', options.section);
        if (options.type) params.set('type', options.type);
        if (options.sort) params.set('sort', options.sort);
        if (options.cacheStatus && options.cacheStatus !== 'all') params.set('cacheStatus', options.cacheStatus);
        if (options.start != null) params.set('start', String(options.start));
        if (options.limit != null) params.set('limit', String(options.limit));
        if (options.refresh) params.set('refresh', '1');
        const qs = params.toString();
        return apiFetch(`/api/media-server/library/browse${qs ? `?${qs}` : ''}`) as Promise<{
            serverType?: string;
            items?: Array<Record<string, unknown>>;
            total?: number;
            sort?: string;
            cacheStatus?: string;
        }>;
    },
    titleStatus: (payload: { title: string; mediaType?: string; ratingKey?: string; tmdbId?: string }) => {
        const params = new URLSearchParams({ title: payload.title });
        if (payload.mediaType) params.set('mediaType', payload.mediaType);
        if (payload.ratingKey) params.set('ratingKey', payload.ratingKey);
        if (payload.tmdbId) params.set('tmdbId', payload.tmdbId);
        return apiFetch(`${ROOT}/title-status?${params.toString()}`) as Promise<PosterSetsTitleStatus & { ok?: boolean }>;
    },
    watchingIndex: () => apiFetch(`${ROOT}/watching-index`) as Promise<{
        ok?: boolean;
        ratingKeys?: string[];
        titleKeys?: string[];
        tmdbIds?: string[];
    }>,
    titleWatch: (payload: {
        title: string;
        mediaType?: string;
        ratingKey?: string;
        setUrl?: string;
        enabled?: boolean;
        setMeta?: PosterSetsSetMeta | null;
        tmdbId?: string;
    }) => apiFetch(`${ROOT}/title-watch`, json(payload)) as Promise<{
        ok: boolean;
        enabled: boolean;
        watch?: PosterSetsWatch | null;
        titleWatch?: PosterSetsTitleStatus['titleWatch'];
    }>,
    resetArt: (payload: {
        ratingKey: string;
        mediaType: 'movie' | 'show';
        scope?: 'poster' | 'seasons' | 'episodes' | 'all' | 'art';
    }) => apiFetch(`${ROOT}/reset-art`, json(payload)) as Promise<{ ok?: boolean; cleared?: number }>,
};
