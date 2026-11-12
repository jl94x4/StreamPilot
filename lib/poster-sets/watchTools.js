/**
 * Watching housekeeping: duplicate finder, export / import, undo of a replace.
 */
import {
    MAX_WATCHES,
    deletePosterSetsWatch,
    listPosterSetsWatches,
    serializeWatch,
    updatePosterSetsWatches,
} from './watches.js';
import { archiveRemovedWatch, takeArchivedWatch } from './watchArchive.js';
import { findSameTitleWatches, watchesShareTitle } from './watchTitle.js';

const recency = (watch) => Date.parse(watch.lastAppliedAt || watch.updatedAt || watch.createdAt || 0) || 0;

/** Groups of watches that share a show/movie (should be one each since the one-set rule). */
export const findDuplicateWatchGroups = (watches) => {
    const list = Array.isArray(watches) ? watches : [];
    const used = new Set();
    const groups = [];
    for (const watch of list) {
        if (used.has(watch.id)) continue;
        const group = [watch, ...findSameTitleWatches(list.filter((other) => !used.has(other.id)), watch)];
        if (group.length < 2) continue;
        for (const member of group) used.add(member.id);
        groups.push(group.sort((a, b) => (Number(b.locked) - Number(a.locked)) || (recency(b) - recency(a))));
    }
    return groups;
};

/** Keeps the locked watch (else the most recently applied) of every group and archives the rest. */
export const resolveDuplicateWatches = async () => {
    const groups = findDuplicateWatchGroups(await listPosterSetsWatches());
    let removed = 0;
    for (const [keep, ...rest] of groups) {
        for (const extra of rest) {
            if (extra.locked) continue;
            const deleted = await deletePosterSetsWatch(extra.id);
            if (!deleted) continue;
            removed += 1;
            await archiveRemovedWatch(deleted, {
                reason: 'duplicate',
                replacedByTitle: keep.title || null,
                replacedByUrl: keep.url || null,
            }).catch(() => undefined);
        }
    }
    return { groups: groups.length, removed };
};

export const exportWatches = async () => ({
    app: 'streampilot-poster-sets',
    kind: 'watching',
    version: 1,
    exportedAt: new Date().toISOString(),
    watches: await listPosterSetsWatches(),
});

/** Adds watches from an export. Existing sets and titles that are already watched are left alone. */
export const importWatches = async (payload) => {
    const incoming = Array.isArray(payload?.watches) ? payload.watches : [];
    if (!incoming.length) {
        const error = new Error('That file has no watched sets in it.');
        error.status = 400;
        throw error;
    }
    let added = 0;
    let skippedSame = 0;
    let skippedTitle = 0;
    await updatePosterSetsWatches((state) => {
        for (const raw of incoming.slice(0, MAX_WATCHES)) {
            if (state.watches.length >= MAX_WATCHES) break;
            const watch = serializeWatch(raw || {});
            if (!watch.id || !watch.url) continue;
            if (state.watches.some((existing) => existing.url === watch.url || existing.id === watch.id)) {
                skippedSame += 1;
                continue;
            }
            if (state.watches.some((existing) => watchesShareTitle(existing, watch))) {
                skippedTitle += 1;
                continue;
            }
            state.watches = [watch, ...state.watches];
            added += 1;
        }
        return state;
    });
    return { added, skippedSame, skippedTitle };
};

/** Brings back a replaced watch, putting whatever replaced it into the undo list instead. */
export const restoreArchivedWatch = async (id) => {
    const entry = await takeArchivedWatch(id);
    if (!entry) {
        const error = new Error('That watch can no longer be restored.');
        error.status = 404;
        throw error;
    }
    const restored = serializeWatch({ ...entry.watch, lastError: null });
    const current = await listPosterSetsWatches();
    for (const other of findSameTitleWatches(current, restored)) {
        const deleted = await deletePosterSetsWatch(other.id);
        if (deleted) {
            await archiveRemovedWatch(deleted, {
                reason: 'replaced',
                replacedByTitle: restored.title || null,
                replacedByUrl: restored.url || null,
            }).catch(() => undefined);
        }
    }
    await updatePosterSetsWatches((state) => {
        if (!state.watches.some((watch) => watch.url === restored.url)) {
            state.watches = [{ ...restored, updatedAt: new Date().toISOString() }, ...state.watches];
        }
        return state;
    });
    return restored;
};
