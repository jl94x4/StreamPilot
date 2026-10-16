import crypto from 'crypto';
import fs from 'fs/promises';

/** Coarse durable job states persisted on the queue. */
export const JOB_STATES = Object.freeze({
    QUEUED: 'queued',
    RUNNING: 'running',
    SUCCEEDED: 'succeeded',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
    /** Plan aliases kept for API/UI compatibility. */
    COMPLETED: 'succeeded',
    CANCELED: 'cancelled',
});

/** Fine-grained processing phases while a job is running. */
export const JOB_PHASES = Object.freeze({
    QUEUED: 'queued',
    STARTING: 'starting',
    PROBING: 'probing',
    PLANNING: 'planning',
    PLANNED: 'planned',
    PROCESSING: 'processing',
    VERIFYING: 'verifying',
    COMMITTING: 'committing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
});

export const TERMINAL_JOB_STATES = Object.freeze([
    JOB_STATES.SUCCEEDED,
    JOB_STATES.FAILED,
    JOB_STATES.CANCELLED,
]);

const TRANSITIONS = Object.freeze({
    [JOB_STATES.QUEUED]: new Set([JOB_STATES.RUNNING, JOB_STATES.CANCELLED]),
    [JOB_STATES.RUNNING]: new Set([JOB_STATES.QUEUED, JOB_STATES.SUCCEEDED, JOB_STATES.FAILED, JOB_STATES.CANCELLED]),
    [JOB_STATES.SUCCEEDED]: new Set(),
    [JOB_STATES.FAILED]: new Set([JOB_STATES.QUEUED]),
    [JOB_STATES.CANCELLED]: new Set([JOB_STATES.QUEUED]),
});

export const canTransitionJob = (from, to) => TRANSITIONS[from]?.has(to) === true;

export const transitionJob = (job, state, patch = {}, now = new Date()) => {
    if (!job || typeof job !== 'object') throw new TypeError('job is required');
    if (!canTransitionJob(job.state, state)) {
        throw new Error(`Invalid job transition: ${job.state} -> ${state}`);
    }
    return {
        ...job,
        ...patch,
        id: job.id,
        state,
        updatedAt: now.toISOString(),
    };
};

/**
 * Stable fingerprint for dedupe: size + mtime + inode (when available).
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export const fingerprintSourceFile = async (filePath) => {
    const stat = await fs.stat(filePath);
    const inode = Number.isFinite(Number(stat.ino)) ? String(stat.ino) : '0';
    return `${stat.size}:${Math.round(Number(stat.mtimeMs) || 0)}:${inode}`;
};

export const buildJobDedupeKey = ({ sourcePath, fingerprint, pipelineId, ruleId } = {}) => {
    const pathKey = String(sourcePath || '').trim();
    const print = String(fingerprint || '').trim() || 'unknown';
    const pipeline = pipelineId == null ? (ruleId == null ? 'auto' : String(ruleId)) : String(pipelineId);
    return `${pathKey}::${print}::${pipeline}`;
};

export const createMediaJob = (input = {}, now = new Date()) => {
    const sourcePath = String(input.sourcePath || '').trim();
    if (!sourcePath) throw new Error('sourcePath is required');
    const timestamp = now.toISOString();
    const fingerprint = String(input.fingerprint || '').trim() || null;
    return {
        id: String(input.id || crypto.randomUUID()),
        dedupeKey: String(input.dedupeKey || buildJobDedupeKey({
            sourcePath,
            fingerprint,
            pipelineId: input.pipelineId,
            ruleId: input.ruleId,
        })),
        sourcePath,
        fingerprint,
        libraryRoot: String(input.libraryRoot || ''),
        libraryId: input.libraryId == null ? null : String(input.libraryId),
        pipelineId: input.pipelineId == null ? null : String(input.pipelineId),
        pipelineName: String(input.pipelineName || input.metadata?.pipeline?.name || '').trim() || null,
        ruleId: input.ruleId == null ? null : String(input.ruleId),
        lane: input.lane === 'gpu' ? 'gpu' : 'cpu',
        state: JOB_STATES.QUEUED,
        phase: JOB_PHASES.QUEUED,
        progress: {
            percent: 0,
            outTimeUs: 0,
            etaSeconds: null,
            speed: null,
            fps: null,
        },
        priority: Number.isFinite(Number(input.priority)) ? Number(input.priority) : 0,
        attempts: 0,
        maxAttempts: Math.max(1, Number(input.maxAttempts) || 3),
        availableAt: input.availableAt || timestamp,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        cancelRequested: false,
        plan: input.plan && typeof input.plan === 'object' ? input.plan : null,
        metadata: (() => {
            const metadata = input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {};
            if (!Array.isArray(metadata.timeline) || metadata.timeline.length === 0) {
                metadata.timeline = [{ phase: JOB_PHASES.QUEUED, at: timestamp }];
            }
            return metadata;
        })(),
        result: null,
        error: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        startedAt: null,
        finishedAt: null,
    };
};
