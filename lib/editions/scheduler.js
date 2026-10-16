import { loadEditionsConfig } from './config.js';
import { createEditionsRunHelpers, runState, waitForEditionsJob } from './runtime.js';

let timer = null;
let started = false;
let startedAt = Date.now();

const hoursFromConfig = (config) => {
    const n = Number(config?.scheduleHours);
    return Number.isFinite(n) ? Math.max(0, n) : 6;
};

export const startEditionsScheduler = (deps = {}) => {
    if (started) return;
    started = true;
    startedAt = Date.now();

    const { startCommand } = createEditionsRunHelpers({
        ...deps,
        systemJob: deps.systemJob || null,
    });

    const tick = async () => {
        try {
            const portal = typeof deps.loadPortalConfig === 'function'
                ? await deps.loadPortalConfig()
                : {};
            if (!portal?.editionsEnabled) return;
            if (String(portal.mediaServerType || 'plex').toLowerCase() !== 'plex') return;

            const config = await loadEditionsConfig();
            const hours = hoursFromConfig(config);
            if (!hours) {
                if (deps.systemJob) deps.systemJob.nextRun = null;
                return;
            }

            if (runState.running) return;

            const intervalMs = hours * 60 * 60 * 1000;
            const lastMs = config.lastFullRunAt ? Date.parse(config.lastFullRunAt) : startedAt;
            const dueAt = (Number.isFinite(lastMs) ? lastMs : startedAt) + intervalMs;
            if (deps.systemJob) {
                deps.systemJob.nextRun = new Date(dueAt).toISOString();
            }
            if (Date.now() < dueAt) return;

            if (typeof deps.log === 'function') {
                deps.log(`[editions] Scheduled process-all starting (every ${hours}h)`);
            }
            await startCommand('process-all');
            await waitForEditionsJob();
            if (deps.systemJob) {
                deps.systemJob.nextRun = new Date(Date.now() + intervalMs).toISOString();
            }
        } catch (error) {
            const msg = error?.message || String(error);
            if (/already running/i.test(msg)) return;
            if (typeof deps.log === 'function') {
                deps.log(`[editions] Scheduled process-all failed: ${msg}`);
            }
        }
    };

    timer = setInterval(() => { void tick(); }, 15 * 60 * 1000);
    setTimeout(() => { void tick(); }, 120_000);
    void loadEditionsConfig().then((config) => {
        if (!deps.systemJob) return;
        const hours = hoursFromConfig(config);
        const lastMs = config.lastFullRunAt ? Date.parse(config.lastFullRunAt) : 0;
        if (config.lastFullRunAt) deps.systemJob.lastRun = config.lastFullRunAt;
        if (hours && Number.isFinite(lastMs) && lastMs) {
            const dueAt = lastMs + hours * 60 * 60 * 1000;
            deps.systemJob.nextRun = new Date(dueAt > Date.now() ? dueAt : Date.now() + 120_000).toISOString();
            return;
        }
        deps.systemJob.nextRun = new Date(Date.now() + (hours || 6) * 60 * 60 * 1000).toISOString();
    }).catch(() => {
        if (deps.systemJob) {
            deps.systemJob.nextRun = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
        }
    });
};

export const stopEditionsScheduler = () => {
    if (timer) clearInterval(timer);
    timer = null;
    started = false;
};

export const runEditionsScheduledJob = async (deps = {}) => {
    const { startCommand } = createEditionsRunHelpers({
        ...deps,
        systemJob: deps.systemJob || null,
    });
    await startCommand('process-all');
    await waitForEditionsJob();
};
