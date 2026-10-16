import { apiFetch } from '../shared/api';
import type {
    MediaAutomationActivity,
    MediaAutomationAnalyzeResult,
    MediaAutomationCapabilities,
    MediaAutomationHistoryEntry,
    MediaAutomationHostMetrics,
    MediaAutomationJob,
    MediaAutomationLibrary,
    MediaAutomationPendingTest,
    MediaAutomationPipeline,
    MediaAutomationPipelinePreview,
    MediaAutomationScanHistoryEntry,
    MediaAutomationStatus,
} from './types';

const ROOT = '/api/media-automation';

export type MediaAutomationBrowseEntry = {
    name: string;
    path: string;
    type: 'root' | 'directory' | 'file';
};

export type MediaAutomationBrowseResult = {
    ok?: boolean;
    path?: string | null;
    parent?: string | null;
    root?: string | null;
    roots?: string[];
    entries?: MediaAutomationBrowseEntry[];
    total?: number;
    offset?: number;
    limit?: number;
    hasMore?: boolean;
    query?: string;
    message?: string;
    error?: string;
};

const asList = <T,>(value: unknown, keys: string[]): T[] => {
    if (Array.isArray(value)) return value as T[];
    if (!value || typeof value !== 'object') return [];
    const record = value as Record<string, unknown>;
    for (const key of keys) {
        if (Array.isArray(record[key])) return record[key] as T[];
    }
    return [];
};

const json = (value: unknown): RequestInit => ({
    method: 'POST',
    body: JSON.stringify(value),
});

export type MediaAutomationEstimate = {
    filePath: string;
    pipelineId?: string | number | null;
    adapter?: string | null;
    adapterLabel?: string | null;
    sampleSeconds: number;
    sampleStartSeconds?: number;
    sampleBytes: number;
    durationSeconds: number;
    sourceBytes: number;
    estimatedOutputBytes: number;
    estimatedBytesSaved: number;
    estimatedSavingsPercent: number | null;
};

export const mediaAutomationApi = {
    status: () => apiFetch(`${ROOT}/status`) as Promise<MediaAutomationStatus>,
    capabilities: () => apiFetch(`${ROOT}/capabilities`) as Promise<MediaAutomationCapabilities>,
    metrics: () => apiFetch(`${ROOT}/metrics`) as Promise<MediaAutomationHostMetrics>,
    jobs: async (limit = 1000) => asList<MediaAutomationJob>(
        await apiFetch(`${ROOT}/jobs?limit=${limit}`),
        ['jobs', 'items', 'results'],
    ),
    getJob: async (id: string | number) => {
        const response = await apiFetch(`${ROOT}/jobs/${encodeURIComponent(id)}`) as { job?: MediaAutomationJob };
        return response.job || null;
    },
    jobLogs: async (id: string | number, limit = 100) => asList<MediaAutomationActivity>(
        await apiFetch(`${ROOT}/jobs/${encodeURIComponent(id)}/logs?limit=${limit}`),
        ['entries', 'logs', 'activity', 'items'],
    ),
    activity: async (limit = 500) => asList<MediaAutomationActivity>(
        await apiFetch(`${ROOT}/activity?limit=${limit}`),
        ['activity', 'events', 'items', 'results'],
    ),
    history: async (options: { limit?: number; state?: string; q?: string } = {}) => {
        const params = new URLSearchParams();
        params.set('limit', String(options.limit ?? 200));
        if (options.state) params.set('state', options.state);
        if (options.q) params.set('q', options.q);
        const response = await apiFetch(`${ROOT}/history?${params}`) as {
            history?: MediaAutomationHistoryEntry[];
            entries?: MediaAutomationHistoryEntry[];
            savings?: MediaAutomationStatus['savings'];
        };
        return {
            entries: asList<MediaAutomationHistoryEntry>(response, ['history', 'entries', 'items']),
            savings: response.savings || null,
        };
    },
    clearHistory: (libraryId?: string | number | null) => apiFetch(`${ROOT}/history/clear`, json({
        libraryId: libraryId == null || String(libraryId).trim() === '' ? null : String(libraryId),
    })) as Promise<{ ok?: boolean; removed?: number; remaining?: number; libraryId?: string | null }>,
    scanHistory: async (limit = 20) => asList<MediaAutomationScanHistoryEntry>(
        await apiFetch(`${ROOT}/scan-history?limit=${limit}`),
        ['entries', 'scans', 'items'],
    ),
    browse: (path = '', options: {
        files?: boolean;
        extensions?: string[];
        limit?: number;
        offset?: number;
        q?: string;
    } = {}) => {
        const params = new URLSearchParams();
        if (path) params.set('path', path);
        if (options.files) params.set('files', '1');
        if (options.extensions?.length) params.set('extensions', options.extensions.join(','));
        if (Number.isFinite(options.limit)) params.set('limit', String(options.limit));
        if (Number.isFinite(options.offset) && Number(options.offset) > 0) params.set('offset', String(options.offset));
        if (options.q) params.set('q', options.q);
        const query = params.toString();
        return apiFetch(`${ROOT}/browse${query ? `?${query}` : ''}`) as Promise<MediaAutomationBrowseResult>;
    },
    libraries: async () => asList<MediaAutomationLibrary>(
        await apiFetch(`${ROOT}/libraries`),
        ['libraries', 'items', 'results'],
    ),
    pipelines: async () => asList<MediaAutomationPipeline>(
        await apiFetch(`${ROOT}/pipelines`),
        ['pipelines', 'items', 'results'],
    ),
    enqueue: (path: string, pipelineId?: string | number) => apiFetch(`${ROOT}/enqueue`, json({ path, pipelineId })),
    enqueueMany: (paths: string[], pipelineId?: string | number) => apiFetch(`${ROOT}/enqueue`, json({ paths, pipelineId })),
    analyze: (options: {
        libraryId?: string | number | null;
        pipelineId?: string | number | null;
        force?: boolean;
        limit?: number;
        minSizeBytes?: number;
        rootPath?: string | null;
    } = {}) => apiFetch(`${ROOT}/analyze`, json(options)) as Promise<MediaAutomationAnalyzeResult>,
    testWorker: () => apiFetch(`${ROOT}/worker/test`, json({})),
    control: (action: string) => apiFetch(`${ROOT}/control`, json({ action })),
    scanNow: (options: { preview?: boolean; planOnly?: boolean; libraryId?: string | number | null } = {}) =>
        apiFetch(`${ROOT}/scan`, json(options)),
    cancelScan: (options: { clearQueued?: boolean } = {}) =>
        apiFetch(`${ROOT}/scan/cancel`, json({ clearQueued: options.clearQueued !== false })),
    denyPaths: (paths: string[]) => apiFetch(`${ROOT}/path-deny`, json({ paths })),
    testPending: (path: string) => apiFetch(`${ROOT}/pending/test`, json({ path })) as Promise<MediaAutomationPendingTest>,
    cancelJob: (id: string | number) => apiFetch(`${ROOT}/jobs/${encodeURIComponent(id)}/cancel`, json({})),
    bulkCancelJobs: (ids?: Array<string | number>) => apiFetch(`${ROOT}/jobs/bulk`, json({
        action: 'cancel',
        ...(ids?.length ? { ids } : {}),
    })),
    bulkRemoveJobs: (ids?: Array<string | number>) => apiFetch(`${ROOT}/jobs/bulk`, json({
        action: 'remove',
        terminalOnly: true,
        ...(ids?.length ? { ids } : {}),
    })),
    bulkRetryJobs: (ids?: Array<string | number>, options: { forceCpu?: boolean } = {}) => apiFetch(`${ROOT}/jobs/bulk`, json({
        action: 'retry',
        resetAttempts: true,
        forceCpu: options.forceCpu === true,
        ...(ids?.length ? { ids } : {}),
    })),
    skipJob: (id: string | number, reason = 'skipped') => apiFetch(`${ROOT}/jobs/${encodeURIComponent(id)}/skip`, json({ reason })),
    setPriority: (id: string | number, priority: number) => apiFetch(`${ROOT}/jobs/${encodeURIComponent(id)}/priority`, json({ priority })),
    retryJob: (id: string | number, options: { forceCpu?: boolean } = {}) =>
        apiFetch(`${ROOT}/jobs/${encodeURIComponent(id)}/retry`, json({ forceCpu: options.forceCpu === true })),
    estimate: (
        path: string,
        pipelineId?: string | number | null,
        sampleSeconds?: number,
        options: { libraryId?: string | number | null; libraryRoot?: string | null } = {},
    ) => apiFetch(
        `${ROOT}/estimate`,
        json({
            path,
            pipelineId: pipelineId ?? null,
            ...(sampleSeconds ? { sampleSeconds } : {}),
            libraryId: options.libraryId ?? null,
            libraryRoot: options.libraryRoot ?? null,
        }),
    ) as Promise<{ ok?: boolean; estimate?: MediaAutomationEstimate; error?: string }>,
    createLibrary: (library: MediaAutomationLibrary) => apiFetch(`${ROOT}/libraries`, json(library)),
    updateLibrary: (id: string | number, library: MediaAutomationLibrary) => apiFetch(`${ROOT}/libraries/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(library),
    }),
    deleteLibrary: (id: string | number) => apiFetch(`${ROOT}/libraries/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    createPipeline: (pipeline: MediaAutomationPipeline) => apiFetch(`${ROOT}/pipelines`, json(pipeline)),
    updatePipeline: (id: string | number, pipeline: MediaAutomationPipeline) => apiFetch(`${ROOT}/pipelines/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(pipeline),
    }),
    deletePipeline: (id: string | number) => apiFetch(`${ROOT}/pipelines/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    testLibrary: (id: string | number) => apiFetch(`${ROOT}/libraries/${encodeURIComponent(id)}/test`, json({})),
    previewPipeline: (id: string | number, path: string) => apiFetch(
        `${ROOT}/pipelines/${encodeURIComponent(id)}/preview`,
        json({ path }),
    ) as Promise<MediaAutomationPipelinePreview>,
    testPipeline: (id: string | number, path: string) => apiFetch(
        `${ROOT}/pipelines/${encodeURIComponent(id)}/test`,
        json({ path }),
    ),
};
