import { loadWatchSyncConfig } from './config.js';
import { getWatchSyncRuntime, startWatchSyncJob } from './runtime.js';

let timer = null;
/** Ten minutes after the overlays and five after editions: see lib/editions/scheduler.js. */
const FIRST_CHECK_MS = 10 * 60 * 1000;
let started = false;
let startedAt = Date.now();

export const startWatchSyncScheduler = (deps = {}) => {
    if (started) return;
    started = true;
    startedAt = Date.now();

    const tick = async () => {
        try {
            const portal = typeof deps.loadPortalConfig === 'function'
                ? await deps.loadPortalConfig()
                : {};
            if (!portal?.watchSyncEnabled) return;
            if (String(portal.mediaServerType || 'plex').toLowerCase() !== 'plex') return;
            const config = await loadWatchSyncConfig();
            if (!config.scheduleEnabled) {
                if (deps.systemJob) deps.systemJob.nextRun = null;
                return;
            }
            if (getWatchSyncRuntime().running) return;
            const hours = Math.max(1, Number(config.intervalHours) || 12);
            const intervalMs = hours * 60 * 60 * 1000;
            const lastMs = config.lastRunAt ? Date.parse(config.lastRunAt) : startedAt;
            const dueAt = (Number.isFinite(lastMs) ? lastMs : startedAt) + intervalMs;
            if (deps.systemJob) deps.systemJob.nextRun = new Date(dueAt).toISOString();
            if (Date.now() < dueAt) return;
            if (typeof deps.log === 'function') deps.log(`[watch-sync] Scheduled sync starting (every ${hours}h)`);
            await startWatchSyncJob(deps, 'schedule');
        } catch (error) {
            const message = error?.message || String(error);
            if (/already running/i.test(message)) return;
            if (typeof deps.log === 'function') deps.log(`[watch-sync] Scheduled sync failed: ${message}`);
        }
    };

    // One handle for the first (delayed) check and the 15-minute checks after it.
    timer = setTimeout(() => {
        void tick();
        timer = setInterval(() => { void tick(); }, 15 * 60 * 1000);
    }, FIRST_CHECK_MS);
};

export const watchSyncSchedulerStarted = () => started && !!timer;
