import crypto from 'crypto';

export const createCatalogStore = ({ store, kind = 'item', clock = () => Date.now() } = {}) => {
    if (!store?.read || !store?.update) throw new Error('store is required');
    const normalize = (value) => ({
        version: 1,
        items: Array.isArray(value?.items) ? value.items : [],
    });
    const list = async () => normalize(await store.read()).items;
    const get = async (id) => (await list()).find((item) => item.id === String(id)) || null;
    const create = async (input = {}) => {
        let created;
        await store.update((raw) => {
            const state = normalize(raw);
            const now = new Date(clock()).toISOString();
            created = {
                ...input,
                id: String(input.id || crypto.randomUUID()),
                createdAt: now,
                updatedAt: now,
            };
            if (state.items.some((item) => item.id === created.id)) {
                throw new Error(`${kind} already exists: ${created.id}`);
            }
            state.items.push(created);
            return state;
        });
        return created;
    };
    const update = async (id, patch = {}) => {
        let updated = null;
        await store.update((raw) => {
            const state = normalize(raw);
            state.items = state.items.map((item) => {
                if (item.id !== String(id)) return item;
                updated = {
                    ...item,
                    ...patch,
                    id: item.id,
                    createdAt: item.createdAt,
                    updatedAt: new Date(clock()).toISOString(),
                };
                return updated;
            });
            return state;
        });
        return updated;
    };
    const remove = async (id) => {
        let removed = false;
        await store.update((raw) => {
            const state = normalize(raw);
            const before = state.items.length;
            state.items = state.items.filter((item) => item.id !== String(id));
            removed = state.items.length !== before;
            return state;
        });
        return removed;
    };
    return { kind, list, get, create, update, remove };
};

export default createCatalogStore;
