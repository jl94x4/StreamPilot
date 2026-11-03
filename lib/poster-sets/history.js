import path from 'path';
import { ensurePosterSetsDir, POSTER_SETS_DIR, readPosterSetsJson, writePosterSetsJson } from './config.js';

export const POSTER_SETS_HISTORY_PATH = path.join(POSTER_SETS_DIR, 'history.json');
const MAX_HISTORY = 100;
const MAX_LOGS_PER_ENTRY = 300;

const serializeJob = (job) => {
    const logs = Array.isArray(job?.logs) ? job.logs.slice(-MAX_LOGS_PER_ENTRY) : [];
    return {
        id: String(job.id),
        type: job.type || 'apply',
        state: job.state || 'unknown',
        createdAt: job.createdAt || null,
        finishedAt: job.finishedAt || null,
        error: job.error || null,
        result: job.result || null,
        input: job.input || null,
        logs,
    };
};

export const loadPosterSetsHistory = async () => {
    await ensurePosterSetsDir();
    const parsed = await readPosterSetsJson(POSTER_SETS_HISTORY_PATH, 'history');
    if (!parsed) return [];
    const entries = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.entries) ? parsed.entries : []);
    return entries.map(serializeJob).filter((entry) => entry.id);
};

export const savePosterSetsHistory = async (entries) => {
    await ensurePosterSetsDir();
    const next = (Array.isArray(entries) ? entries : [])
        .map(serializeJob)
        .filter((entry) => entry.id)
        .slice(0, MAX_HISTORY);
    await writePosterSetsJson(POSTER_SETS_HISTORY_PATH, next);
    return next;
};

export const upsertPosterSetsHistory = async (job) => {
    const entry = serializeJob(job);
    if (!entry.id) return [];
    const existing = await loadPosterSetsHistory();
    const without = existing.filter((item) => item.id !== entry.id);
    return savePosterSetsHistory([entry, ...without]);
};

export const isFailedPosterSetsHistoryState = (state) => (
    ['failed', 'error'].includes(String(state || '').toLowerCase())
);

export const clearFailedPosterSetsHistory = async () => {
    const existing = await loadPosterSetsHistory();
    const kept = existing.filter((entry) => !isFailedPosterSetsHistoryState(entry.state));
    const removed = existing.length - kept.length;
    const entries = removed ? await savePosterSetsHistory(kept) : existing;
    return { removed, entries };
};
