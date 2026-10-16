/**
 * Durable Poster Sets apply queue.
 * Jobs survive restarts; paused accepts new items without processing.
 */
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { ensurePosterSetsDir, POSTER_SETS_DIR } from './config.js';

export const POSTER_SETS_QUEUE_PATH = path.join(POSTER_SETS_DIR, 'queue.json');

const MAX_QUEUE_JOBS = 200;
const MAX_LOGS = 300;

const emptyState = () => ({
    version: 1,
    paused: false,
    jobs: [],
});

const isEmptyJsonFile = (raw) => !String(raw || '').trim();

const backupCorruptQueueFile = async (reason) => {
    try {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = `${POSTER_SETS_QUEUE_PATH}.corrupt-${stamp}`;
        await fs.rename(POSTER_SETS_QUEUE_PATH, backupPath);
        console.warn(`[poster-sets] reset corrupt queue file (${reason}) → ${backupPath}`);
    } catch {
        try {
            await fs.unlink(POSTER_SETS_QUEUE_PATH);
        } catch {
            /* ignore */
        }
    }
};

const serializeJob = (job) => ({
    id: String(job.id),
    type: job.type || 'apply',
    state: job.state || 'queued',
    createdAt: job.createdAt || null,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    lastProgressAt: job.lastProgressAt || null,
    error: job.error || null,
    result: job.result || null,
    input: job.input || null,
    logs: Array.isArray(job.logs) ? job.logs.slice(-MAX_LOGS) : [],
});

let writeChain = Promise.resolve();

const withQueueLock = (fn) => {
    const run = writeChain.then(() => fn());
    writeChain = run.catch((error) => {
        console.error('[poster-sets] queue write failed:', error?.message || error);
    });
    return run;
};

export const loadPosterSetsQueue = async () => {
    await ensurePosterSetsDir();
    try {
        const raw = await fs.readFile(POSTER_SETS_QUEUE_PATH, 'utf8');
        if (isEmptyJsonFile(raw)) {
            await backupCorruptQueueFile('empty file');
            return emptyState();
        }
        const parsed = JSON.parse(raw);
        const jobs = Array.isArray(parsed?.jobs) ? parsed.jobs.map(serializeJob).filter((j) => j.id) : [];
        return {
            version: 1,
            paused: Boolean(parsed?.paused),
            jobs: jobs.slice(0, MAX_QUEUE_JOBS),
        };
    } catch (error) {
        if (error?.code === 'ENOENT') return emptyState();
        if (error instanceof SyntaxError || String(error?.message || '').includes('JSON')) {
            await backupCorruptQueueFile(error.message || 'invalid json');
            return emptyState();
        }
        throw error;
    }
};

export const savePosterSetsQueue = async (state) => {
    await ensurePosterSetsDir();
    const next = {
        version: 1,
        paused: Boolean(state?.paused),
        jobs: (Array.isArray(state?.jobs) ? state.jobs : [])
            .map(serializeJob)
            .filter((j) => j.id)
            .slice(0, MAX_QUEUE_JOBS),
    };
    const payload = `${JSON.stringify(next, null, 2)}\n`;
    const tempPath = `${POSTER_SETS_QUEUE_PATH}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, payload, 'utf8');
    await fs.rename(tempPath, POSTER_SETS_QUEUE_PATH);
    return next;
};

export const updatePosterSetsQueue = async (mutator) => withQueueLock(async () => {
    const current = await loadPosterSetsQueue();
    const next = await mutator({ ...current, jobs: [...current.jobs] }) || current;
    return savePosterSetsQueue(next);
});

export const createQueuedJob = (type, input = null) => ({
    id: crypto.randomUUID(),
    type,
    state: 'queued',
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    logs: [],
    result: null,
    error: null,
    input: input || null,
});

export const enqueuePosterSetsJob = async (type, input = null) => {
    const job = createQueuedJob(type, input);
    await updatePosterSetsQueue((state) => {
        state.jobs = [job, ...state.jobs.filter((item) => item.id !== job.id)];
        return state;
    });
    return job;
};

export const getPosterSetsQueueJob = async (id) => {
    const state = await loadPosterSetsQueue();
    return state.jobs.find((job) => job.id === String(id)) || null;
};

export const setPosterSetsQueuePaused = async (paused) => {
    const state = await updatePosterSetsQueue((current) => {
        current.paused = Boolean(paused);
        return current;
    });
    return state;
};

export const cancelPosterSetsQueueJob = async (id) => {
    let cancelled = null;
    await updatePosterSetsQueue((state) => {
        state.jobs = state.jobs.map((job) => {
            if (job.id !== String(id)) return job;
            if (job.state !== 'queued') return job;
            cancelled = {
                ...job,
                state: 'cancelled',
                finishedAt: new Date().toISOString(),
                error: 'Cancelled while queued',
            };
            return cancelled;
        });
        return state;
    });
    return cancelled;
};

/** Stop a running apply (marks cancelled; caller should kill the worker if active). */
export const stopPosterSetsRunningJob = async (id) => {
    let stopped = null;
    await updatePosterSetsQueue((state) => {
        state.jobs = state.jobs.map((job) => {
            if (job.id !== String(id)) return job;
            if (job.state !== 'running') return job;
            stopped = {
                ...job,
                state: 'cancelled',
                finishedAt: new Date().toISOString(),
                error: 'Stopped by user',
            };
            return stopped;
        });
        return state;
    });
    return stopped;
};

/** Re-queue a failed or cancelled job with the same input. */
export const retryPosterSetsQueueJob = async (id) => {
    const state = await loadPosterSetsQueue();
    const job = state.jobs.find((item) => item.id === String(id));
    if (!job) return null;
    if (!['failed', 'cancelled', 'warning'].includes(String(job.state || ''))) return null;
    return enqueuePosterSetsJob(job.type || 'apply', job.input || null);
};

/** Cancel every waiting queue item and remove them from the active queue list. */
export const clearPosterSetsQueuedJobs = async () => {
    const cancelledJobs = [];
    const state = await updatePosterSetsQueue((current) => {
        const now = new Date().toISOString();
        const kept = [];
        for (const job of current.jobs || []) {
            if (job.state === 'queued') {
                cancelledJobs.push({
                    ...job,
                    state: 'cancelled',
                    finishedAt: now,
                    error: 'Cancelled while queued (cancel all)',
                });
                continue;
            }
            kept.push(job);
        }
        current.jobs = kept;
        return current;
    });
    return {
        state,
        cancelled: cancelledJobs.length,
        cancelledIds: cancelledJobs.map((job) => job.id),
        cancelledJobs,
    };
};

export const clearPosterSetsFinishedQueue = async () => {
    const state = await updatePosterSetsQueue((current) => {
        current.jobs = current.jobs.filter((job) => (
            job.state === 'queued' || job.state === 'running'
        ));
        return current;
    });
    return state;
};

/** Remove one finished (failed/succeeded/cancelled) queue row. Leaves queued/running alone. */
export const dismissPosterSetsQueueJob = async (id) => {
    let removed = null;
    const state = await updatePosterSetsQueue((current) => {
        current.jobs = current.jobs.filter((job) => {
            if (job.id !== String(id)) return true;
            if (job.state === 'queued' || job.state === 'running') return true;
            removed = job;
            return false;
        });
        return current;
    });
    return { removed, state };
};

export const clearPosterSetsFailedQueue = async () => {
    let removed = 0;
    const state = await updatePosterSetsQueue((current) => {
        const next = [];
        for (const job of current.jobs || []) {
            if (['failed', 'error'].includes(String(job.state || '').toLowerCase())) {
                removed += 1;
                continue;
            }
            next.push(job);
        }
        current.jobs = next;
        return current;
    });
    return { removed, state };
};

/** On boot: re-queue orphaned running jobs so they aren't stuck forever. */
export const recoverPosterSetsQueue = async () => {
    const recovered = [];
    await updatePosterSetsQueue((state) => {
        state.jobs = state.jobs.map((job) => {
            if (job.state !== 'running') return job;
            const next = {
                ...job,
                state: 'queued',
                startedAt: null,
                error: null,
                logs: [
                    ...(Array.isArray(job.logs) ? job.logs : []),
                    { at: new Date().toISOString(), message: 'Re-queued after portal restart' },
                ].slice(-MAX_LOGS),
            };
            recovered.push(next.id);
            return next;
        });
        return state;
    });
    return recovered;
};

export const patchPosterSetsQueueJob = async (id, patch) => {
    let updated = null;
    await updatePosterSetsQueue((state) => {
        state.jobs = state.jobs.map((job) => {
            if (job.id !== String(id)) return job;
            updated = serializeJob({ ...job, ...patch, id: job.id });
            return updated;
        });
        return state;
    });
    return updated;
};

export const claimNextPosterSetsJob = async () => {
    let claimed = null;
    await updatePosterSetsQueue((state) => {
        if (state.paused) return state;
        if (state.jobs.some((job) => job.state === 'running')) return state;
        const oldest = state.jobs
            .filter((job) => job.state === 'queued')
            .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))[0];
        if (!oldest) return state;
        claimed = {
            ...oldest,
            state: 'running',
            startedAt: new Date().toISOString(),
            lastProgressAt: new Date().toISOString(),
            logs: [
                ...(Array.isArray(oldest.logs) ? oldest.logs : []),
                { at: new Date().toISOString(), message: 'Started apply…' },
            ].slice(-MAX_LOGS),
        };
        state.jobs = state.jobs.map((job) => (job.id === claimed.id ? claimed : job));
        return state;
    });
    return claimed;
};

export const queueStats = (state) => {
    const jobs = Array.isArray(state?.jobs) ? state.jobs : [];
    return {
        paused: Boolean(state?.paused),
        queued: jobs.filter((j) => j.state === 'queued').length,
        running: jobs.filter((j) => j.state === 'running').length,
        succeeded: jobs.filter((j) => j.state === 'succeeded').length,
        warning: jobs.filter((j) => j.state === 'warning').length,
        failed: jobs.filter((j) => j.state === 'failed').length,
        cancelled: jobs.filter((j) => j.state === 'cancelled').length,
        pending: jobs.filter((j) => j.state === 'queued' || j.state === 'running').length,
    };
};
