import crypto from 'crypto';

export const createActivityStore = ({
    store,
    maxEntries = 1000,
    clock = () => Date.now(),
    onActivity,
} = {}) => {
    if (!store?.read || !store?.update) throw new Error('store is required');
    const normalize = (value) => ({
        version: 1,
        entries: Array.isArray(value?.entries) ? value.entries : [],
    });
    const append = async (input = {}) => {
        const entry = {
            id: crypto.randomUUID(),
            type: String(input.type || 'info'),
            ...(input.jobId == null ? {} : { jobId: String(input.jobId) }),
            message: String(input.message || ''),
            data: input.data && typeof input.data === 'object' ? input.data : {},
            at: new Date(clock()).toISOString(),
        };
        await store.update((raw) => {
            const state = normalize(raw);
            state.entries.unshift(entry);
            state.entries.length = Math.min(state.entries.length, maxEntries);
            return state;
        });
        await onActivity?.(entry);
        return entry;
    };
    const list = async ({ limit = 100, jobId } = {}) => {
        const entries = normalize(await store.read()).entries;
        return entries
            .filter((entry) => jobId == null || entry.jobId === String(jobId))
            .slice(0, Math.max(1, Number(limit) || 100));
    };
    const clear = () => store.write({ version: 1, entries: [] });
    return { append, list, clear };
};

export default createActivityStore;
