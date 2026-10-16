import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import test from 'node:test';
import {
    applyJobToTask,
    decideBootRun,
    emptyJob,
    formatDelay,
    getJob,
    markJobComplete,
    markJobFail,
    markJobStart,
    mergeJobWithExternal,
    remainingDelayMs,
    resetBootScheduleForTests,
    setBootSchedulePathForTests,
    setJobCheckpoint,
    wasInterrupted,
} from './boot-schedule.js';

const withTempLedger = async (fn) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'boot-schedule-'));
    const filePath = path.join(dir, 'boot-schedule.json');
    setBootSchedulePathForTests(filePath);
    try {
        await fn(filePath);
    } finally {
        resetBootScheduleForTests();
        await fs.rm(dir, { recursive: true, force: true });
    }
};

test('decideBootRun runs on first boot', () => {
    const decision = decideBootRun(emptyJob('syncPlexUsers'), { intervalMs: 60_000 });
    assert.equal(decision.action, 'run');
    assert.equal(decision.reason, 'first-boot');
    assert.equal(decision.delayMs, 0);
});

test('decideBootRun skips when last success is still inside the interval', () => {
    const now = Date.parse('2026-08-29T12:00:00.000Z');
    const job = {
        ...emptyJob('syncPlexUsers'),
        lastCompletedAt: '2026-08-29T11:10:00.000Z',
        status: 'completed',
    };
    const decision = decideBootRun(job, { intervalMs: 60 * 60 * 1000, now });
    assert.equal(decision.action, 'skip');
    assert.equal(decision.reason, 'fresh');
    assert.equal(decision.delayMs, 10 * 60 * 1000);
    assert.equal(decision.nextRunAt, '2026-08-29T12:10:00.000Z');
});

test('decideBootRun runs when the interval has elapsed', () => {
    const now = Date.parse('2026-08-29T12:00:00.000Z');
    const job = {
        ...emptyJob('syncPlexUsers'),
        lastCompletedAt: '2026-08-29T10:00:00.000Z',
        status: 'completed',
    };
    const decision = decideBootRun(job, { intervalMs: 60 * 60 * 1000, now });
    assert.equal(decision.action, 'run');
    assert.equal(decision.reason, 'due');
});

test('decideBootRun resumes an interrupted job even if last completed is recent', () => {
    const now = Date.parse('2026-08-29T12:00:00.000Z');
    const job = {
        ...emptyJob('backgroundBatch'),
        lastCompletedAt: '2026-08-29T11:50:00.000Z',
        lastStartedAt: '2026-08-29T11:55:00.000Z',
        status: 'running',
    };
    assert.equal(wasInterrupted(job), true);
    const decision = decideBootRun(job, { intervalMs: 60 * 60 * 1000, now });
    assert.equal(decision.action, 'resume');
    assert.equal(decision.reason, 'interrupted');
    assert.equal(decision.delayMs, 0);
});

test('remainingDelayMs and formatDelay', () => {
    const now = Date.parse('2026-08-29T12:00:00.000Z');
    assert.equal(remainingDelayMs('2026-08-29T11:10:00.000Z', 60 * 60 * 1000, now), 10 * 60 * 1000);
    assert.equal(remainingDelayMs(null, 60_000, now), 0);
    assert.equal(formatDelay(5_000), '5s');
    assert.equal(formatDelay(10 * 60 * 1000), '10m');
    assert.equal(formatDelay(90 * 60 * 1000), '1h 30m');
    assert.equal(formatDelay(2 * 60 * 60 * 1000), '2h');
});

test('mergeJobWithExternal prefers newer worker last_run_at and interrupted status', () => {
    const job = {
        ...emptyJob('collexionsPinning'),
        lastCompletedAt: '2026-08-29T10:00:00.000Z',
        status: 'completed',
    };
    const merged = mergeJobWithExternal(job, {
        lastCompletedAt: '2026-08-29T11:00:00.000Z',
        lastStartedAt: '2026-08-29T11:30:00.000Z',
        interrupted: true,
    });
    assert.equal(merged.lastCompletedAt, '2026-08-29T11:00:00.000Z');
    assert.equal(merged.lastStartedAt, '2026-08-29T11:30:00.000Z');
    assert.equal(merged.status, 'running');
    assert.equal(wasInterrupted(merged), true);
});

test('mergeJobWithExternal completes a running ledger when the worker finished', () => {
    const job = {
        ...emptyJob('collexionsPinning'),
        lastStartedAt: '2026-08-29T11:00:00.000Z',
        lastCompletedAt: '2026-08-29T09:00:00.000Z',
        status: 'running',
    };
    const merged = mergeJobWithExternal(job, {
        lastCompletedAt: '2026-08-29T11:30:00.000Z',
        interrupted: false,
    });
    assert.equal(merged.status, 'completed');
    assert.equal(merged.lastCompletedAt, '2026-08-29T11:30:00.000Z');
    assert.equal(wasInterrupted(merged), false);
});

test('applyJobToTask hydrates lastRun and nextRun', () => {
    const task = { id: 'syncPlexUsers', lastRun: null, nextRun: null };
    const now = Date.parse('2026-08-29T12:00:00.000Z');
    applyJobToTask(task, {
        ...emptyJob('syncPlexUsers'),
        lastCompletedAt: '2026-08-29T11:10:00.000Z',
        lastDurationMs: 1200,
        status: 'completed',
    }, { intervalMs: 60 * 60 * 1000, now });
    assert.equal(task.lastRun, '2026-08-29T11:10:00.000Z');
    assert.equal(task.lastDurationMs, 1200);
    assert.equal(task.nextRun, '2026-08-29T12:10:00.000Z');
});

test('mark start/complete/fail persist to disk and support checkpoints', async () => {
    await withTempLedger(async (filePath) => {
        await markJobStart('backgroundBatch', {
            intervalMs: 3600000,
            checkpoint: { completedTaskIds: [] },
        });
        const running = await getJob('backgroundBatch');
        assert.equal(running.status, 'running');
        assert.equal(running.intervalMs, 3600000);
        assert.deepEqual(running.checkpoint, { completedTaskIds: [] });
        assert.ok(running.lastStartedAt);

        await setJobCheckpoint('backgroundBatch', { completedTaskIds: ['syncPlexUsers'] });
        const mid = await getJob('backgroundBatch');
        assert.deepEqual(mid.checkpoint, { completedTaskIds: ['syncPlexUsers'] });

        await markJobComplete('backgroundBatch', { intervalMs: 3600000 });
        const done = await getJob('backgroundBatch');
        assert.equal(done.status, 'completed');
        assert.equal(done.checkpoint, null);
        assert.ok(done.lastCompletedAt);
        assert.equal(done.lastError, null);

        await markJobStart('maintenanceIndex');
        await markJobFail('maintenanceIndex', new Error('plex down'));
        const failed = await getJob('maintenanceIndex');
        assert.equal(failed.status, 'completed');
        assert.equal(failed.lastError, 'plex down');
        assert.ok(failed.lastCompletedAt);

        const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
        assert.equal(raw.version, 1);
        assert.ok(raw.jobs.backgroundBatch);
        assert.ok(raw.jobs.maintenanceIndex);
    });
});
