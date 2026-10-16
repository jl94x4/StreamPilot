import crypto from 'crypto';

export const createScanHistoryStore = ({
    store,
    maxEntries = 50,
    clock = () => Date.now(),
} = {}) => {
    if (!store?.read || !store?.update) throw new Error('store is required');
    const normalize = (value) => ({
        version: 1,
        entries: Array.isArray(value?.entries) ? value.entries : [],
        progress: value?.progress && typeof value.progress === 'object' ? value.progress : null,
    });

    const setProgress = async (progress) => {
        await store.update((raw) => {
            const state = normalize(raw);
            state.progress = progress
                ? {
                    // Default true for live updates; callers may pass running:false or null to finish.
                    running: progress.running !== false,
                    discovered: Number(progress.discovered) || 0,
                    enqueued: Number(progress.enqueued) || 0,
                    skipped: Number(progress.skipped) || 0,
                    errors: Number(progress.errors) || 0,
                    currentPath: progress.currentPath ? String(progress.currentPath) : null,
                    percent: progress.percent == null ? null : Number(progress.percent),
                    totalEstimate: progress.totalEstimate == null ? null : Number(progress.totalEstimate),
                    scanBatchId: progress.scanBatchId == null ? null : String(progress.scanBatchId),
                    startedAt: progress.startedAt || state.progress?.startedAt || new Date(clock()).toISOString(),
                    updatedAt: new Date(clock()).toISOString(),
                }
                : null;
            return state;
        });
        return progress;
    };

    const getProgress = async () => normalize(await store.read()).progress;

    const record = async (result = {}) => {
        const entry = {
            id: crypto.randomUUID(),
            at: result.at || new Date(clock()).toISOString(),
            discovered: Number(result.discovered) || 0,
            enqueued: Number(result.enqueued) || 0,
            skipped: Number(result.skipped) || 0,
            errors: Array.isArray(result.errors) ? result.errors.slice(0, 50) : [],
            skippedDetails: Array.isArray(result.skippedDetails) ? result.skippedDetails.slice(0, 50) : [],
        };
        await store.update((raw) => {
            const state = normalize(raw);
            state.entries.unshift(entry);
            state.entries.length = Math.min(state.entries.length, maxEntries);
            state.progress = null;
            return state;
        });
        return entry;
    };

    const list = async ({ limit = 20 } = {}) => (
        normalize(await store.read()).entries.slice(0, Math.max(1, Number(limit) || 20))
    );

    return { setProgress, getProgress, record, list };
};

export default createScanHistoryStore;
