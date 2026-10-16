import crypto from 'crypto';

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'canceled', 'completed', 'success']);

const slimJob = (job = {}) => {
    const result = job.result && typeof job.result === 'object' ? job.result : {};
    const output = result.output && typeof result.output === 'object' ? result.output : {};
    return {
        id: String(job.id || crypto.randomUUID()),
        sourcePath: String(job.sourcePath || job.path || ''),
        pipelineId: job.pipelineId == null ? null : String(job.pipelineId),
        pipelineName: String(job.pipelineName || job.metadata?.pipeline?.name || ''),
        libraryId: job.libraryId == null ? null : String(job.libraryId),
        state: String(job.state || 'succeeded'),
        lane: job.lane === 'gpu' ? 'gpu' : 'cpu',
        tags: Array.isArray(job.metadata?.tags) ? job.metadata.tags.map(String) : [],
        createdAt: job.createdAt || null,
        startedAt: job.startedAt || null,
        finishedAt: job.finishedAt || job.completedAt || new Date().toISOString(),
        sourceBytes: Number(result.sourceBytes || result.inputBytes || 0) || 0,
        outputBytes: Number(result.outputBytes || 0) || 0,
        bytesSaved: Number(result.bytesSaved) || Math.max(0, Number(result.sourceBytes || 0) - Number(result.outputBytes || 0)),
        durationMs: Number(result.durationMs || 0) || 0,
        adapter: result.adapter || result.adapterLabel || null,
        adapterLabel: result.adapterLabel || null,
        dryRun: result.dryRun === true,
        finalPath: output.finalPath || job.outputPath || null,
        quarantinedPath: output.quarantinedPath || null,
        delivery: result.delivery || null,
        error: job.error || null,
    };
};

/** Expand a durable history row into the job shape the detail modal expects. */
export const historyEntryToJob = (entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const id = String(entry.id || '').trim();
    if (!id) return null;
    const sourcePath = String(entry.sourcePath || entry.path || '');
    return {
        id,
        sourcePath,
        path: sourcePath,
        pipelineId: entry.pipelineId == null ? null : String(entry.pipelineId),
        pipelineName: String(entry.pipelineName || ''),
        libraryId: entry.libraryId == null ? null : String(entry.libraryId),
        state: String(entry.state || 'succeeded'),
        status: String(entry.state || 'succeeded'),
        phase: String(entry.state || 'succeeded'),
        lane: entry.lane === 'gpu' ? 'gpu' : 'cpu',
        createdAt: entry.createdAt || null,
        startedAt: entry.startedAt || null,
        finishedAt: entry.finishedAt || null,
        completedAt: entry.finishedAt || null,
        attempts: entry.attempts ?? null,
        maxAttempts: entry.maxAttempts ?? null,
        error: entry.error || null,
        archived: true,
        metadata: {
            tags: Array.isArray(entry.tags) ? entry.tags.map(String) : [],
            fromHistory: true,
        },
        result: {
            sourceBytes: Number(entry.sourceBytes || 0) || 0,
            outputBytes: Number(entry.outputBytes || 0) || 0,
            bytesSaved: Number(entry.bytesSaved || 0) || 0,
            durationMs: Number(entry.durationMs || 0) || 0,
            adapter: entry.adapter || null,
            adapterLabel: entry.adapterLabel || null,
            dryRun: entry.dryRun === true,
            delivery: entry.delivery || null,
            output: {
                finalPath: entry.finalPath || null,
                quarantinedPath: entry.quarantinedPath || null,
            },
        },
    };
};

export const createHistoryStore = ({
    store,
    maxEntries = 2000,
    clock = () => Date.now(),
} = {}) => {
    if (!store?.read || !store?.update) throw new Error('store is required');
    const normalize = (value) => ({
        version: 1,
        entries: Array.isArray(value?.entries) ? value.entries : [],
    });

    const record = async (job) => {
        if (!job || !TERMINAL.has(String(job.state || '').toLowerCase())) return null;
        const entry = slimJob(job);
        await store.update((raw) => {
            const state = normalize(raw);
            const existing = state.entries.findIndex((item) => item.id === entry.id);
            if (existing >= 0) state.entries.splice(existing, 1);
            state.entries.unshift(entry);
            state.entries.length = Math.min(state.entries.length, maxEntries);
            return state;
        });
        return entry;
    };

    const get = async (id) => {
        const needle = String(id || '').trim();
        if (!needle) return null;
        const entry = normalize(await store.read()).entries.find((item) => String(item.id) === needle);
        return entry || null;
    };

    const list = async ({ limit = 200, state, q } = {}) => {
        let entries = normalize(await store.read()).entries;
        if (state && state !== 'all') {
            const wanted = String(state).toLowerCase();
            entries = entries.filter((entry) => {
                const value = String(entry.state || '').toLowerCase();
                if (wanted === 'dry-run') return entry.dryRun === true;
                if (wanted === 'completed') return ['succeeded', 'completed', 'success'].includes(value) && !entry.dryRun;
                if (wanted === 'failed') return ['failed', 'error'].includes(value);
                if (wanted === 'cancelled') return ['cancelled', 'canceled'].includes(value);
                return value === wanted;
            });
        }
        if (q) {
            const needle = String(q).toLowerCase();
            entries = entries.filter((entry) => (
                `${entry.sourcePath} ${entry.pipelineName} ${entry.id} ${(entry.tags || []).join(' ')}`
                    .toLowerCase()
                    .includes(needle)
            ));
        }
        return entries.slice(0, Math.max(1, Number(limit) || 200));
    };

    const aggregates = async ({ days = 7 } = {}) => {
        const cutoff = clock() - (Math.max(1, Number(days) || 7) * 86_400_000);
        const entries = normalize(await store.read()).entries.filter((entry) => {
            const at = Date.parse(entry.finishedAt || 0);
            return Number.isFinite(at) && at >= cutoff;
        });
        const completed = entries.filter((entry) => ['succeeded', 'completed', 'success'].includes(String(entry.state || '').toLowerCase()) && !entry.dryRun);
        const failed = entries.filter((entry) => ['failed', 'error'].includes(String(entry.state || '').toLowerCase()));
        const cancelled = entries.filter((entry) => ['cancelled', 'canceled'].includes(String(entry.state || '').toLowerCase()));
        return {
            days: Math.max(1, Number(days) || 7),
            completed: completed.length,
            failed: failed.length,
            cancelled: cancelled.length,
            bytesIn: completed.reduce((sum, entry) => sum + (Number(entry.sourceBytes) || 0), 0),
            bytesOut: completed.reduce((sum, entry) => sum + (Number(entry.outputBytes) || 0), 0),
            bytesSaved: completed.reduce((sum, entry) => sum + (Number(entry.bytesSaved) || 0), 0),
            encodeMs: completed.reduce((sum, entry) => sum + (Number(entry.durationMs) || 0), 0),
        };
    };

    /** Lifetime totals from durable history (survives clearing finished queue jobs). */
    const totals = async () => {
        const entries = normalize(await store.read()).entries;
        const completed = entries.filter((entry) => ['succeeded', 'completed', 'success'].includes(String(entry.state || '').toLowerCase()) && !entry.dryRun);
        const failed = entries.filter((entry) => ['failed', 'error'].includes(String(entry.state || '').toLowerCase()));
        return {
            completed: completed.length,
            failed: failed.length,
            entries: entries.length,
        };
    };

    /**
     * Wipe task history stats.
     * @param {{ libraryId?: string|number|null }} [options]
     *   - omit / null libraryId → clear all history
     *   - libraryId set → remove only that library's entries
     */
    const clear = async ({ libraryId } = {}) => {
        const needle = libraryId == null || String(libraryId).trim() === ''
            ? null
            : String(libraryId).trim();
        let removed = 0;
        let remaining = 0;
        await store.update((raw) => {
            const state = normalize(raw);
            const before = state.entries.length;
            if (!needle) {
                state.entries = [];
            } else {
                state.entries = state.entries.filter((entry) => String(entry.libraryId || '') !== needle);
            }
            removed = before - state.entries.length;
            remaining = state.entries.length;
            return state;
        });
        return { removed, remaining, libraryId: needle };
    };

    return { record, get, list, aggregates, totals, clear };
};

export default createHistoryStore;
