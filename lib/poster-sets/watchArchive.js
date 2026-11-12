/**
 * Small durable side-state for Watching:
 *  - recently replaced / removed watches (so a replace can be undone for a week)
 *  - "pause all watchers until ..." state
 * Deliberately independent of watches.js so watches.js can archive without a circular import.
 */
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { ensurePosterSetsDir, POSTER_SETS_DIR } from './config.js';

const ARCHIVE_PATH = path.join(POSTER_SETS_DIR, 'watch-replaced.json');
const PAUSE_PATH = path.join(POSTER_SETS_DIR, 'watch-pause.json');
export const ARCHIVE_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const ARCHIVE_MAX = 200;

const readJson = async (file, fallback) => {
    try {
        return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
        return fallback;
    }
};

const writeJson = async (file, value) => {
    await ensurePosterSetsDir();
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(value)}\n`, 'utf8');
    await fs.rename(tmp, file);
};

let chain = Promise.resolve();
const locked = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
};

const freshEntries = (entries, now = Date.now()) => (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.watch && now - Date.parse(entry.removedAt || 0) < ARCHIVE_KEEP_MS);

/** Keep a copy of a watch that is being replaced or removed so it can be brought back. */
export const archiveRemovedWatch = (watch, { reason = 'replaced', replacedByTitle = null, replacedByUrl = null } = {}) => locked(async () => {
    if (!watch?.url) return null;
    const entries = freshEntries(await readJson(ARCHIVE_PATH, []));
    const entry = {
        id: crypto.randomUUID(),
        removedAt: new Date().toISOString(),
        reason,
        replacedByTitle: replacedByTitle || null,
        replacedByUrl: replacedByUrl || null,
        watch,
    };
    await writeJson(ARCHIVE_PATH, [entry, ...entries].slice(0, ARCHIVE_MAX));
    return entry;
});

export const listArchivedWatches = async () => freshEntries(await readJson(ARCHIVE_PATH, []));

export const takeArchivedWatch = (id) => locked(async () => {
    const entries = freshEntries(await readJson(ARCHIVE_PATH, []));
    const hit = entries.find((entry) => entry.id === String(id));
    if (!hit) return null;
    await writeJson(ARCHIVE_PATH, entries.filter((entry) => entry.id !== hit.id));
    return hit;
});

export const getWatchPause = async () => {
    const state = await readJson(PAUSE_PATH, {});
    const until = Date.parse(state?.until || '');
    if (!Number.isFinite(until) || until <= Date.now()) return { paused: false, until: null };
    return { paused: true, until: new Date(until).toISOString() };
};

export const setWatchPause = async ({ days = 0 } = {}) => {
    const count = Math.max(0, Math.min(90, Number(days) || 0));
    if (!count) {
        await writeJson(PAUSE_PATH, {});
        return { paused: false, until: null };
    }
    const until = new Date(Date.now() + count * 24 * 60 * 60 * 1000).toISOString();
    await writeJson(PAUSE_PATH, { until });
    return { paused: true, until };
};
