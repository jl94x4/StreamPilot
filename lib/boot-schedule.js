/**
 * Durable last-run ledger so a container/process restart does not treat every
 * job as a first boot. Jobs that finished inside their interval are skipped
 * until due; jobs left `running` are resumed.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { BOOT_SCHEDULE_PATH } from './data-paths.js';

export const JOB_IDS = {
    backgroundBatch: 'backgroundBatch',
    syncPlexUsers: 'syncPlexUsers',
    checkAndSendNotifications: 'checkAndSendNotifications',
    checkAndRevoke: 'checkAndRevoke',
    checkAndSendNewsletter: 'checkAndSendNewsletter',
    checkAndCleanupInactive: 'checkAndCleanupInactive',
    maintenanceRuleRun: 'maintenanceRuleRun',
    achievementsBackfill: 'achievementsBackfill',
    personalAnalyticsWarm: 'personalAnalyticsWarm',
    requestStatusSync: 'requestStatusSync',
    seerrAvailableNotify: 'seerrAvailableNotify',
    seerrPendingNotify: 'seerrPendingNotify',
    maintenanceIndex: 'maintenanceIndex',
    posterSetsWatcher: 'posterSetsWatcher',
    collexionsPinning: 'collexionsPinning',
};

const LEDGER_VERSION = 1;

export const emptyJob = (id) => ({
    id: String(id || ''),
    lastStartedAt: null,
    lastCompletedAt: null,
    lastError: null,
    lastDurationMs: null,
    intervalMs: null,
    status: 'idle',
    checkpoint: null,
});

const emptyLedger = () => ({ version: LEDGER_VERSION, jobs: {} });

let overridePath = null;
let cache = null;
let writeChain = Promise.resolve();

export const bootSchedulePath = () => overridePath || BOOT_SCHEDULE_PATH;

export const setBootSchedulePathForTests = (filePath) => {
    overridePath = filePath || null;
    cache = null;
};

export const resetBootScheduleForTests = () => {
    overridePath = null;
    cache = null;
    writeChain = Promise.resolve();
};

const serialize = (operation) => {
    const current = writeChain.then(operation, operation);
    writeChain = current.catch(() => {});
    return current;
};

export const parseTs = (value) => {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
        // Python `.timestamp()` is seconds; JS Date.now() is ms. Treat small values as seconds.
        return value < 1e12 ? value * 1000 : value;
    }
    const ms = Date.parse(String(value));
    return Number.isFinite(ms) ? ms : null;
};

const normalizeJob = (id, raw) => {
    const base = emptyJob(id);
    if (!raw || typeof raw !== 'object') return base;
    const status = ['idle', 'running', 'completed'].includes(raw.status) ? raw.status : 'idle';
    const intervalMs = Number(raw.intervalMs);
    const lastDurationMs = Number(raw.lastDurationMs);
    return {
        ...base,
        lastStartedAt: raw.lastStartedAt ? String(raw.lastStartedAt) : null,
        lastCompletedAt: raw.lastCompletedAt ? String(raw.lastCompletedAt) : null,
        lastError: raw.lastError != null ? String(raw.lastError) : null,
        lastDurationMs: Number.isFinite(lastDurationMs) ? lastDurationMs : null,
        intervalMs: Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : null,
        status,
        checkpoint: raw.checkpoint && typeof raw.checkpoint === 'object' ? raw.checkpoint : null,
    };
};

const normalizeLedger = (raw) => {
    const ledger = emptyLedger();
    if (!raw || typeof raw !== 'object') return ledger;
    const jobs = raw.jobs && typeof raw.jobs === 'object' ? raw.jobs : {};
    for (const [id, value] of Object.entries(jobs)) {
        ledger.jobs[id] = normalizeJob(id, value);
    }
    return ledger;
};

const writeJsonAtomic = async (filePath, value) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    try {
        await fs.rename(temporary, filePath);
    } finally {
        await fs.rm(temporary, { force: true }).catch(() => {});
    }
};

const loadLedger = async () => {
    if (cache) return cache;
    try {
        const raw = await fs.readFile(bootSchedulePath(), 'utf8');
        cache = normalizeLedger(JSON.parse(raw));
    } catch {
        cache = emptyLedger();
    }
    return cache;
};

const saveLedger = async () => {
    const ledger = cache || emptyLedger();
    await writeJsonAtomic(bootSchedulePath(), ledger);
};

export const wasInterrupted = (job) => {
    if (!job || job.status !== 'running') return false;
    const started = parseTs(job.lastStartedAt);
    if (!started) return false;
    const completed = parseTs(job.lastCompletedAt);
    return !completed || started > completed;
};

/**
 * Decide whether a job should run on process start.
 * first-boot (no lastCompletedAt) → run; still inside interval → skip; left running → resume.
 */
export const decideBootRun = (job, { intervalMs, now = Date.now() } = {}) => {
    const interval = Math.max(0, Number(intervalMs) || Number(job?.intervalMs) || 0);
    if (wasInterrupted(job)) {
        return {
            action: 'resume',
            delayMs: 0,
            reason: 'interrupted',
            nextRunAt: new Date(now).toISOString(),
        };
    }
    const completedMs = parseTs(job?.lastCompletedAt);
    if (!completedMs || interval <= 0) {
        return {
            action: 'run',
            delayMs: 0,
            reason: 'first-boot',
            nextRunAt: new Date(now).toISOString(),
        };
    }
    const dueAt = completedMs + interval;
    if (now >= dueAt) {
        return {
            action: 'run',
            delayMs: 0,
            reason: 'due',
            nextRunAt: new Date(now).toISOString(),
        };
    }
    return {
        action: 'skip',
        delayMs: dueAt - now,
        reason: 'fresh',
        nextRunAt: new Date(dueAt).toISOString(),
    };
};

export const remainingDelayMs = (lastCompletedAt, intervalMs, now = Date.now()) => {
    const completedMs = parseTs(lastCompletedAt);
    const interval = Math.max(0, Number(intervalMs) || 0);
    if (!completedMs || interval <= 0) return 0;
    return Math.max(0, completedMs + interval - now);
};

export const formatDelay = (ms) => {
    const total = Math.max(0, Math.round(Number(ms) || 0));
    const seconds = Math.round(total / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const rem = minutes % 60;
    return rem ? `${hours}h ${rem}m` : `${hours}h`;
};

export const mergeJobWithExternal = (job, {
    lastCompletedAt = null,
    lastStartedAt = null,
    interrupted = false,
} = {}) => {
    const next = normalizeJob(job?.id, job);
    const extCompleted = parseTs(lastCompletedAt);
    const localCompleted = parseTs(next.lastCompletedAt);
    if (extCompleted && (!localCompleted || extCompleted > localCompleted)) {
        next.lastCompletedAt = typeof lastCompletedAt === 'number'
            ? new Date(extCompleted).toISOString()
            : String(lastCompletedAt);
        if (next.status !== 'running') next.status = 'completed';
    }
    const extStarted = parseTs(lastStartedAt);
    const localStarted = parseTs(next.lastStartedAt);
    if (extStarted && (!localStarted || extStarted > localStarted)) {
        next.lastStartedAt = typeof lastStartedAt === 'number'
            ? new Date(extStarted).toISOString()
            : String(lastStartedAt);
    }
    if (interrupted) {
        next.status = 'running';
    } else {
        const started = parseTs(next.lastStartedAt);
        const completed = parseTs(next.lastCompletedAt);
        if (completed && (!started || completed >= started) && next.status === 'running') {
            next.status = 'completed';
        }
    }
    return next;
};

export const applyJobToTask = (task, job, { intervalMs, now = Date.now() } = {}) => {
    if (!task) return task;
    if (job?.lastCompletedAt) task.lastRun = job.lastCompletedAt;
    else if (job?.lastStartedAt) task.lastRun = job.lastStartedAt;
    if (job?.lastDurationMs != null) task.lastDurationMs = job.lastDurationMs;
    if (job?.lastError) task.lastError = job.lastError;
    const decision = decideBootRun(job, { intervalMs, now });
    if (decision.nextRunAt) task.nextRun = decision.nextRunAt;
    return task;
};

export const getJob = async (id) => {
    const ledger = await loadLedger();
    const key = String(id || '');
    return ledger.jobs[key] ? { ...ledger.jobs[key] } : emptyJob(key);
};

export const updateJob = async (id, patch = {}) => serialize(async () => {
    const ledger = await loadLedger();
    const key = String(id || '');
    const prev = ledger.jobs[key] || emptyJob(key);
    const next = normalizeJob(key, { ...prev, ...patch, id: key });
    ledger.jobs[key] = next;
    cache = ledger;
    await saveLedger();
    return { ...next };
});

export const markJobStart = async (id, { intervalMs, checkpoint } = {}) => {
    const patch = {
        lastStartedAt: new Date().toISOString(),
        status: 'running',
        lastError: null,
    };
    if (intervalMs != null) patch.intervalMs = Number(intervalMs);
    if (checkpoint !== undefined) patch.checkpoint = checkpoint;
    return updateJob(id, patch);
};

export const markJobComplete = async (id, { intervalMs, checkpoint = null } = {}) => {
    const prev = await getJob(id);
    const started = parseTs(prev.lastStartedAt);
    const patch = {
        lastCompletedAt: new Date().toISOString(),
        status: 'completed',
        lastError: null,
        lastDurationMs: started ? Date.now() - started : prev.lastDurationMs,
        checkpoint,
    };
    if (intervalMs != null) patch.intervalMs = Number(intervalMs);
    return updateJob(id, patch);
};

export const markJobFail = async (id, error, { intervalMs } = {}) => {
    const prev = await getJob(id);
    const started = parseTs(prev.lastStartedAt);
    const patch = {
        status: 'completed',
        lastCompletedAt: new Date().toISOString(),
        lastError: error?.message || String(error || 'failed'),
        lastDurationMs: started ? Date.now() - started : prev.lastDurationMs,
    };
    if (intervalMs != null) patch.intervalMs = Number(intervalMs);
    return updateJob(id, patch);
};

export const setJobCheckpoint = async (id, checkpoint) => updateJob(id, { checkpoint });
