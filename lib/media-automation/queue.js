import {
    JOB_PHASES,
    JOB_STATES,
    TERMINAL_JOB_STATES,
    createMediaJob,
    transitionJob,
} from './models.js';

const initialState = () => ({ version: 1, jobs: [] });
const iso = (value = Date.now()) => new Date(value).toISOString();
const sortJobs = (jobs, priorityBias = 0) => jobs.sort((a, b) => (
    (Number(b.priority || 0) + Number(priorityBias || 0)) - (Number(a.priority || 0) + Number(priorityBias || 0))
    || String(a.createdAt).localeCompare(String(b.createdAt))
));

const jobTags = (job) => (
    Array.isArray(job?.metadata?.tags)
        ? job.metadata.tags.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)
        : []
);

const matchesClaimTags = (job, tags) => {
    const wanted = Array.isArray(tags)
        ? tags.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)
        : [];
    if (!wanted.length) return true;
    const have = jobTags(job);
    return have.some((tag) => wanted.includes(tag));
};

export const createDurableJobQueue = ({ store, clock = () => Date.now(), onTerminal } = {}) => {
    if (!store?.read || !store?.update) throw new Error('[media-automation/queue] store is required');
    const emitTerminal = async (job) => {
        if (!job || !TERMINAL_JOB_STATES.includes(job.state)) return job;
        try {
            await onTerminal?.(job);
        } catch {
            // History persistence must not break queue transitions.
        }
        return job;
    };

    const normalize = (state) => ({
        ...initialState(),
        ...(state && typeof state === 'object' ? state : {}),
        jobs: Array.isArray(state?.jobs) ? state.jobs.map((job) => ({
            ...job,
            lane: job.lane === 'gpu' ? 'gpu' : 'cpu',
            fingerprint: job.fingerprint || null,
            phase: job.phase || (job.state === JOB_STATES.RUNNING ? JOB_PHASES.STARTING : job.state),
            progress: {
                percent: 0,
                outTimeUs: 0,
                etaSeconds: null,
                speed: null,
                fps: null,
                ...(job.progress || {}),
            },
        })) : [],
    });

    const list = async ({ states } = {}) => {
        const jobs = normalize(await store.read()).jobs;
        const allowed = states ? new Set(states) : null;
        return jobs.filter((job) => !allowed || allowed.has(job.state));
    };

    const get = async (id) => (await list()).find((job) => job.id === String(id)) || null;

    const enqueue = async (input) => {
        let selected;
        await store.update((raw) => {
            const state = normalize(raw);
            const key = String(input?.dedupeKey || input?.sourcePath || '');
            const fingerprint = String(input?.fingerprint || '').trim() || null;
            const sourcePath = String(input?.sourcePath || '').trim();
            const pipelineId = String(input?.pipelineId || '');
            const existing = state.jobs.find((job) => {
                if (TERMINAL_JOB_STATES.includes(job.state)) return false;
                if (key && job.dedupeKey === key) return true;
                return !!(
                    fingerprint
                    && job.fingerprint
                    && job.sourcePath === sourcePath
                    && job.fingerprint === fingerprint
                    && String(job.pipelineId || '') === pipelineId
                );
            });
            if (existing) {
                selected = existing;
                return state;
            }
            selected = createMediaJob(input, new Date(clock()));
            state.jobs.push(selected);
            return state;
        });
        return selected;
    };

    const recoverRunning = async ({ forceAll = false } = {}) => {
        const now = clock();
        const recovered = [];
        const leaseError = forceAll
            ? { code: 'WORKER_RESTART', message: 'Worker process restarted; job recovered' }
            : { code: 'LEASE_EXPIRED', message: 'Worker lease expired; job recovered' };
        await store.update((raw) => {
            const state = normalize(raw);
            state.jobs = state.jobs.map((job) => {
                if (job.state !== JOB_STATES.RUNNING) return job;
                if (!forceAll && Date.parse(job.leaseExpiresAt) > now) return job;
                // Cancel requested while the worker died — do not re-queue the encode.
                if (job.cancelRequested) {
                    const next = transitionJob(job, JOB_STATES.CANCELLED, {
                        cancelRequested: true,
                        leaseOwner: null,
                        leaseExpiresAt: null,
                        heartbeatAt: null,
                        finishedAt: iso(now),
                        phase: JOB_PHASES.CANCELLED,
                        error: { code: 'ABORT_ERR', message: 'Job cancelled' },
                    }, new Date(now));
                    recovered.push(next);
                    return next;
                }
                const retry = job.attempts < job.maxAttempts;
                const next = transitionJob(job, retry ? JOB_STATES.QUEUED : JOB_STATES.FAILED, {
                    leaseOwner: null,
                    leaseExpiresAt: null,
                    heartbeatAt: null,
                    availableAt: iso(now),
                    error: leaseError,
                    finishedAt: retry ? null : iso(now),
                    phase: retry ? JOB_PHASES.QUEUED : JOB_PHASES.FAILED,
                }, new Date(now));
                recovered.push(next);
                return next;
            });
            return state;
        });
        for (const job of recovered) await emitTerminal(job);
        return recovered;
    };

    /** Requeue/fail RUNNING jobs whose lease has expired (worker died mid-encode). */
    const recoverExpired = () => recoverRunning({ forceAll: false });

    /**
     * After a process/container restart every RUNNING job is orphaned — no ffmpeg is left.
     * Clear them immediately so Active does not show frozen ghosts and concurrency can refill.
     */
    const recoverOrphanedRunning = () => recoverRunning({ forceAll: true });

    const claim = async ({
        workerId,
        leaseMs = 120_000,
        lane,
        tags,
        priorityBias = 0,
        workerGroupId = null,
        maxRunning = null,
    } = {}) => {
        if (!workerId) throw new Error('workerId is required');
        const now = clock();
        let claimed = null;
        await store.update((raw) => {
            const state = normalize(raw);
            if (maxRunning != null && Number.isFinite(Number(maxRunning))) {
                const limit = Math.max(0, Math.round(Number(maxRunning)));
                const running = state.jobs.filter((job) => (
                    job.state === JOB_STATES.RUNNING
                    && (!lane || job.lane === lane)
                )).length;
                if (running >= limit) return state;
            }
            const candidates = sortJobs(state.jobs.filter((job) => (
                job.state === JOB_STATES.QUEUED
                && Date.parse(job.availableAt || 0) <= now
                && !job.cancelRequested
                && (!lane || job.lane === lane)
                && matchesClaimTags(job, tags)
            )), priorityBias);
            const job = candidates[0];
            if (!job) return state;
            const claimedMeta = {
                ...(job.metadata || {}),
                workerGroupId: workerGroupId == null ? (job.metadata?.workerGroupId || null) : String(workerGroupId),
                claimPriorityBias: Number(priorityBias) || 0,
            };
            const timeline = Array.isArray(claimedMeta.timeline) ? [...claimedMeta.timeline] : [];
            if (timeline[timeline.length - 1]?.phase !== JOB_PHASES.STARTING) {
                timeline.push({ phase: JOB_PHASES.STARTING, at: iso(now) });
                if (timeline.length > 48) timeline.splice(0, timeline.length - 48);
            }
            claimed = transitionJob(job, JOB_STATES.RUNNING, {
                attempts: Number(job.attempts || 0) + 1,
                leaseOwner: String(workerId),
                leaseExpiresAt: iso(now + leaseMs),
                heartbeatAt: iso(now),
                startedAt: job.startedAt || iso(now),
                error: null,
                phase: JOB_PHASES.STARTING,
                metadata: { ...claimedMeta, timeline },
            }, new Date(now));
            state.jobs = state.jobs.map((entry) => entry.id === job.id ? claimed : entry);
            return state;
        });
        return claimed;
    };

    const mutateClaimed = async (id, workerId, mutator) => {
        let output = null;
        await store.update((raw) => {
            const state = normalize(raw);
            state.jobs = state.jobs.map((job) => {
                if (job.id !== String(id)) return job;
                if (job.state !== JOB_STATES.RUNNING || job.leaseOwner !== String(workerId)) {
                    throw new Error('Job lease is not owned by this worker');
                }
                output = mutator(job);
                return output;
            });
            return state;
        });
        if (!output) throw new Error(`Job not found: ${id}`);
        return output;
    };

    const heartbeat = (id, workerId, leaseMs = 120_000) => {
        const now = clock();
        return mutateClaimed(id, workerId, (job) => ({
            ...job,
            heartbeatAt: iso(now),
            leaseExpiresAt: iso(now + leaseMs),
            updatedAt: iso(now),
        }));
    };

    const truncateStderr = (value, maxLines = 40) => {
        const text = String(value || '').trim();
        if (!text) return undefined;
        const lines = text.split(/\r?\n/).filter(Boolean);
        return lines.slice(-Math.max(1, maxLines)).join('\n').slice(0, 16_000);
    };

    const withTimeline = (job, phase, nowMs) => {
        if (phase == null || phase === '') return job.metadata || {};
        const timeline = Array.isArray(job.metadata?.timeline) ? [...job.metadata.timeline] : [];
        const last = timeline[timeline.length - 1];
        if (last?.phase === String(phase)) return job.metadata || {};
        timeline.push({ phase: String(phase), at: iso(nowMs) });
        if (timeline.length > 48) timeline.splice(0, timeline.length - 48);
        return { ...(job.metadata || {}), timeline };
    };

    const updateProgress = (id, workerId, { phase, progress, plan } = {}) => {
        const now = clock();
        return mutateClaimed(id, workerId, (job) => ({
            ...job,
            phase: phase == null ? job.phase : String(phase),
            progress: progress == null ? job.progress : { ...job.progress, ...progress },
            plan: plan === undefined ? job.plan : plan,
            metadata: phase == null ? (job.metadata || {}) : withTimeline(job, phase, now),
            updatedAt: iso(now),
        }));
    };

    const complete = async (id, workerId, result = {}) => {
        const now = clock();
        const job = await mutateClaimed(id, workerId, (entry) => transitionJob(entry, JOB_STATES.SUCCEEDED, {
            result,
            phase: JOB_PHASES.COMPLETED,
            progress: { ...entry.progress, percent: 100, etaSeconds: 0 },
            leaseOwner: null,
            leaseExpiresAt: null,
            heartbeatAt: null,
            finishedAt: iso(now),
            metadata: withTimeline(entry, JOB_PHASES.COMPLETED, now),
        }, new Date(now)));
        await emitTerminal(job);
        return job;
    };

    const fail = async (id, workerId, error, { retryDelayMs = 60_000 } = {}) => {
        const now = clock();
        const stderr = truncateStderr(error?.stderr);
        const job = await mutateClaimed(id, workerId, (entry) => {
            const retry = entry.attempts < entry.maxAttempts && !entry.cancelRequested;
            const nextPhase = retry ? JOB_PHASES.QUEUED : JOB_PHASES.FAILED;
            return transitionJob(entry, retry ? JOB_STATES.QUEUED : JOB_STATES.FAILED, {
                error: {
                    code: String(error?.code || 'JOB_FAILED'),
                    message: String(error?.message || error || 'Job failed'),
                    ...(stderr ? { stderr } : {}),
                },
                availableAt: iso(now + (retry ? retryDelayMs : 0)),
                leaseOwner: null,
                leaseExpiresAt: null,
                heartbeatAt: null,
                finishedAt: retry ? null : iso(now),
                phase: nextPhase,
                metadata: withTimeline(entry, nextPhase, now),
            }, new Date(now));
        });
        await emitTerminal(job);
        return job;
    };

    const requestCancel = async (id) => {
        let output = null;
        await store.update((raw) => {
            const state = normalize(raw);
            state.jobs = state.jobs.map((job) => {
                if (job.id !== String(id) || TERMINAL_JOB_STATES.includes(job.state)) return job;
                const now = new Date(clock());
                output = job.state === JOB_STATES.QUEUED
                    ? transitionJob(job, JOB_STATES.CANCELLED, {
                        cancelRequested: true,
                        finishedAt: now.toISOString(),
                        phase: JOB_PHASES.CANCELLED,
                    }, now)
                    : {
                        ...job,
                        cancelRequested: true,
                        updatedAt: now.toISOString(),
                        phase: job.phase || JOB_PHASES.PROCESSING,
                        metadata: {
                            ...(job.metadata || {}),
                            cancelRequestedAt: now.toISOString(),
                        },
                    };
                return output;
            });
            return state;
        });
        await emitTerminal(output);
        return output;
    };

    /** Force a running/orphaned job into cancelled when no in-process worker will observe abort. */
    const forceCancelRunning = async (id) => {
        let output = null;
        await store.update((raw) => {
            const state = normalize(raw);
            state.jobs = state.jobs.map((job) => {
                if (job.id !== String(id) || job.state !== JOB_STATES.RUNNING) return job;
                const now = new Date(clock());
                output = transitionJob(job, JOB_STATES.CANCELLED, {
                    cancelRequested: true,
                    leaseOwner: null,
                    leaseExpiresAt: null,
                    heartbeatAt: null,
                    finishedAt: now.toISOString(),
                    phase: JOB_PHASES.CANCELLED,
                    error: { code: 'ABORT_ERR', message: 'Job cancelled' },
                }, now);
                return output;
            });
            return state;
        });
        await emitTerminal(output);
        return output;
    };

    const retry = async (id, { resetAttempts = false, availableAt, forceCpu = false } = {}) => {
        let output = null;
        await store.update((raw) => {
            const state = normalize(raw);
            state.jobs = state.jobs.map((job) => {
                if (job.id !== String(id)) return job;
                if (![JOB_STATES.FAILED, JOB_STATES.CANCELLED].includes(job.state)) {
                    throw new Error('Only failed or cancelled jobs can be retried');
                }
                const now = new Date(clock());
                const metadata = { ...(job.metadata || {}) };
                if (forceCpu) metadata.forceHardware = 'cpu';
                else if (metadata.forceHardware === 'cpu') delete metadata.forceHardware;
                const timeline = Array.isArray(metadata.timeline) ? [...metadata.timeline] : [];
                timeline.push({ phase: JOB_PHASES.QUEUED, at: now.toISOString() });
                if (timeline.length > 48) timeline.splice(0, timeline.length - 48);
                metadata.timeline = timeline;
                output = transitionJob(job, JOB_STATES.QUEUED, {
                    attempts: resetAttempts ? 0 : job.attempts,
                    availableAt: availableAt || now.toISOString(),
                    cancelRequested: false,
                    error: null,
                    result: null,
                    finishedAt: null,
                    phase: JOB_PHASES.QUEUED,
                    lane: forceCpu ? 'cpu' : job.lane,
                    metadata,
                    progress: { percent: 0, outTimeUs: 0, etaSeconds: null, speed: null, fps: null },
                }, now);
                return output;
            });
            return state;
        });
        if (!output) throw new Error(`Job not found: ${id}`);
        return output;
    };

    const cancelClaimed = async (id, workerId) => {
        const now = new Date(clock());
        const job = await mutateClaimed(id, workerId, (entry) => transitionJob(entry, JOB_STATES.CANCELLED, {
            cancelRequested: true,
            phase: JOB_PHASES.CANCELLED,
            leaseOwner: null,
            leaseExpiresAt: null,
            heartbeatAt: null,
            finishedAt: now.toISOString(),
        }, now));
        await emitTerminal(job);
        return job;
    };

    const prune = async ({ olderThanMs = 30 * 86_400_000 } = {}) => {
        const cutoff = clock() - olderThanMs;
        let removed = 0;
        await store.update((raw) => {
            const state = normalize(raw);
            state.jobs = state.jobs.filter((job) => {
                const drop = TERMINAL_JOB_STATES.includes(job.state) && Date.parse(job.finishedAt || 0) < cutoff;
                if (drop) removed += 1;
                return !drop;
            });
            return state;
        });
        return removed;
    };

    const setPriority = async (id, priority) => {
        const nextPriority = Number.isFinite(Number(priority)) ? Math.max(0, Math.min(999, Math.round(Number(priority)))) : 0;
        let output = null;
        await store.update((raw) => {
            const state = normalize(raw);
            state.jobs = state.jobs.map((job) => {
                if (job.id !== String(id) || TERMINAL_JOB_STATES.includes(job.state)) return job;
                output = {
                    ...job,
                    priority: nextPriority,
                    updatedAt: iso(clock()),
                };
                return output;
            });
            return state;
        });
        if (!output) {
            const existing = await get(id);
            if (existing && TERMINAL_JOB_STATES.includes(existing.state)) {
                throw new Error(`Cannot change priority on a finished job (${existing.state})`);
            }
            throw new Error(`Queued job not found: ${id}`);
        }
        return output;
    };

    const skip = async (id, reason = 'skipped') => {
        let output = null;
        await store.update((raw) => {
            const state = normalize(raw);
            state.jobs = state.jobs.map((job) => {
                if (job.id !== String(id) || TERMINAL_JOB_STATES.includes(job.state)) return job;
                const now = new Date(clock());
                if (job.state === JOB_STATES.QUEUED) {
                    output = transitionJob(job, JOB_STATES.CANCELLED, {
                        cancelRequested: true,
                        finishedAt: now.toISOString(),
                        phase: JOB_PHASES.CANCELLED,
                        error: {
                            code: 'SKIPPED',
                            message: String(reason || 'skipped'),
                        },
                        metadata: {
                            ...(job.metadata || {}),
                            skipped: true,
                            skipReason: String(reason || 'skipped'),
                        },
                    }, now);
                } else {
                    output = {
                        ...job,
                        cancelRequested: true,
                        updatedAt: now.toISOString(),
                        metadata: {
                            ...(job.metadata || {}),
                            skipped: true,
                            skipReason: String(reason || 'skipped'),
                        },
                        error: {
                            code: 'SKIPPED',
                            message: String(reason || 'skipped'),
                        },
                    };
                }
                return output;
            });
            return state;
        });
        await emitTerminal(output);
        return output;
    };

    /** Cancel queued jobs immediately; mark running jobs cancelRequested. Optionally limit to ids. */
    const cancelMany = async ({ ids } = {}) => {
        const allow = Array.isArray(ids) && ids.length
            ? new Set(ids.map((id) => String(id)))
            : null;
        const cancelled = [];
        await store.update((raw) => {
            const state = normalize(raw);
            state.jobs = state.jobs.map((job) => {
                if (TERMINAL_JOB_STATES.includes(job.state)) return job;
                if (allow && !allow.has(String(job.id))) return job;
                const now = new Date(clock());
                const next = job.state === JOB_STATES.QUEUED
                    ? transitionJob(job, JOB_STATES.CANCELLED, {
                        cancelRequested: true,
                        finishedAt: now.toISOString(),
                        phase: JOB_PHASES.CANCELLED,
                    }, now)
                    : {
                        ...job,
                        cancelRequested: true,
                        updatedAt: now.toISOString(),
                    };
                cancelled.push(next);
                return next;
            });
            return state;
        });
        return cancelled;
    };

    /** Remove finished jobs from the queue store. Optionally limit to ids. */
    const removeMany = async ({ ids, terminalOnly = true } = {}) => {
        const allow = Array.isArray(ids) && ids.length
            ? new Set(ids.map((id) => String(id)))
            : null;
        let removed = 0;
        await store.update((raw) => {
            const state = normalize(raw);
            state.jobs = state.jobs.filter((job) => {
                if (allow && !allow.has(String(job.id))) return true;
                if (terminalOnly && !TERMINAL_JOB_STATES.includes(job.state)) return true;
                removed += 1;
                return false;
            });
            return state;
        });
        return removed;
    };

    /** Re-queue failed/cancelled jobs. Optionally limit to ids. */
    const retryMany = async ({ ids, resetAttempts = true, forceCpu = false } = {}) => {
        const allow = Array.isArray(ids) && ids.length
            ? new Set(ids.map((id) => String(id)))
            : null;
        const retried = [];
        await store.update((raw) => {
            const state = normalize(raw);
            state.jobs = state.jobs.map((job) => {
                if (![JOB_STATES.FAILED, JOB_STATES.CANCELLED].includes(job.state)) return job;
                if (allow && !allow.has(String(job.id))) return job;
                const now = new Date(clock());
                const metadata = { ...(job.metadata || {}) };
                if (forceCpu) metadata.forceHardware = 'cpu';
                const timeline = Array.isArray(metadata.timeline) ? [...metadata.timeline] : [];
                timeline.push({ phase: JOB_PHASES.QUEUED, at: now.toISOString() });
                if (timeline.length > 48) timeline.splice(0, timeline.length - 48);
                metadata.timeline = timeline;
                const next = transitionJob(job, JOB_STATES.QUEUED, {
                    attempts: resetAttempts ? 0 : job.attempts,
                    availableAt: now.toISOString(),
                    cancelRequested: false,
                    error: null,
                    result: null,
                    finishedAt: null,
                    phase: JOB_PHASES.QUEUED,
                    lane: forceCpu ? 'cpu' : job.lane,
                    metadata,
                    progress: { percent: 0, outTimeUs: 0, etaSeconds: null, speed: null, fps: null },
                }, now);
                retried.push(next);
                return next;
            });
            return state;
        });
        return retried;
    };

    /** Cancel still-queued jobs that belong to a scan batch. */
    const cancelQueuedByScanBatch = async (scanBatchId) => {
        const batchId = String(scanBatchId || '').trim();
        if (!batchId) return [];
        const cancelled = [];
        await store.update((raw) => {
            const state = normalize(raw);
            state.jobs = state.jobs.map((job) => {
                if (job.state !== JOB_STATES.QUEUED) return job;
                if (String(job.metadata?.scanBatchId || '') !== batchId) return job;
                const now = new Date(clock());
                const next = transitionJob(job, JOB_STATES.CANCELLED, {
                    cancelRequested: true,
                    finishedAt: now.toISOString(),
                    phase: JOB_PHASES.CANCELLED,
                    metadata: withTimeline(job, JOB_PHASES.CANCELLED, now.getTime()),
                }, now);
                cancelled.push(next);
                return next;
            });
            return state;
        });
        for (const job of cancelled) await emitTerminal(job);
        return cancelled;
    };

    return {
        list,
        get,
        enqueue,
        recoverExpired,
        recoverOrphanedRunning,
        claim,
        heartbeat,
        updateProgress,
        complete,
        fail,
        retry,
        requestCancel,
        forceCancelRunning,
        cancelClaimed,
        setPriority,
        skip,
        prune,
        cancelMany,
        removeMany,
        retryMany,
        cancelQueuedByScanBatch,
    };
};

export default createDurableJobQueue;
