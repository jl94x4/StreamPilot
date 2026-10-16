import { loadOverlaysConfig, saveOverlaysConfig } from './config.js';
import { createOverlaysRunHelpers, pushActivity, runState } from './runtime.js';

const timers = {
    core: null,
    recently: null,
    kometa: null,
};
const started = {
    core: false,
    recently: false,
    kometa: false,
};

const BUNDLE_META = {
    core: {
        commandLive: 'run',
        commandPreview: 'preview',
        lastRunKey: 'lastRunAt',
        scheduleKey: 'scheduleHours',
        label: 'New Season / core',
    },
    recently: {
        commandLive: 'run-recently',
        commandPreview: 'preview-recently',
        lastRunKey: 'recentlyAddedLastRunAt',
        scheduleKey: 'recentlyAddedScheduleHours',
        label: 'Recently Added',
    },
    kometa: {
        commandLive: 'run-kometa',
        commandPreview: 'preview-kometa',
        lastRunKey: 'kometaLastRunAt',
        scheduleKey: 'kometaScheduleHours',
        label: 'Media / Layer',
    },
};

const scheduleHoursFor = (config, key) => {
    const n = Number(config?.[key]);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
};

/**
 * Schedule periodic overlay runs for one bundle (core / recently / kometa).
 */
export const startOverlaysBundleScheduler = (bundle, deps = {}) => {
    const meta = BUNDLE_META[bundle];
    if (!meta || started[bundle]) return;
    started[bundle] = true;

    const { runCommand } = createOverlaysRunHelpers({
        ...deps,
        systemJob: deps.systemJob || null,
    });

    const tick = async () => {
        try {
            if (typeof deps.isFeatureEnabled === 'function') {
                const enabled = await deps.isFeatureEnabled();
                if (!enabled) return;
            }
            const config = await loadOverlaysConfig();
            if (config.enabled === false) return;
            const hours = scheduleHoursFor(config, meta.scheduleKey);
            if (!hours || hours <= 0) return;

            if (runState.running) {
                // Manual Preview/Run in progress — skip quietly (not an error).
                return;
            }

            const last = config[meta.lastRunKey] ? Date.parse(config[meta.lastRunKey]) : 0;
            const intervalMs = hours * 60 * 60 * 1000;
            if (last && Date.now() - last < intervalMs) {
                if (deps.systemJob) {
                    deps.systemJob.nextRun = new Date(last + intervalMs).toISOString();
                    deps.systemJob.lastRun = config[meta.lastRunKey];
                }
                return;
            }

            const preview = config.previewMode === true;
            const command = preview ? meta.commandPreview : meta.commandLive;
            pushActivity(`Scheduled ${meta.label} overlay run starting…`);
            await runCommand(command, {
                previewMode: preview,
                runBundle: bundle,
                lastRunKey: meta.lastRunKey,
            });
            if (deps.systemJob) {
                deps.systemJob.nextRun = new Date(Date.now() + intervalMs).toISOString();
            }
        } catch (error) {
            const msg = error?.message || String(error);
            if (/already in progress/i.test(msg)) return;
            pushActivity(`Scheduled ${meta.label} run failed: ${msg}`, 'error');
        }
    };

    timers[bundle] = setInterval(() => { void tick(); }, 15 * 60 * 1000);
    setTimeout(() => { void tick(); }, 45_000 + (bundle === 'recently' ? 20_000 : bundle === 'kometa' ? 40_000 : 0));

    void loadOverlaysConfig().then((config) => {
        if (!deps.systemJob) return;
        const hours = scheduleHoursFor(config, meta.scheduleKey);
        const last = config?.[meta.lastRunKey] ? Date.parse(config[meta.lastRunKey]) : 0;
        if (hours > 0 && last) {
            const dueAt = last + hours * 60 * 60 * 1000;
            deps.systemJob.lastRun = config[meta.lastRunKey];
            deps.systemJob.nextRun = new Date(dueAt > Date.now() ? dueAt : Date.now() + 45_000).toISOString();
            return;
        }
        deps.systemJob.nextRun = new Date(Date.now() + 45_000).toISOString();
    }).catch(() => {
        if (deps.systemJob) {
            deps.systemJob.nextRun = new Date(Date.now() + 45_000).toISOString();
        }
    });
};

/**
 * Schedule periodic New Season / core overlay runs (compat wrapper).
 */
export const startOverlaysScheduler = (deps = {}) => {
    startOverlaysBundleScheduler('core', deps);
};

export const stopOverlaysScheduler = () => {
    for (const key of Object.keys(timers)) {
        if (timers[key]) clearInterval(timers[key]);
        timers[key] = null;
        started[key] = false;
    }
};

export const runOverlaysScheduledJob = async (deps = {}, bundle = 'core') => {
    const meta = BUNDLE_META[bundle] || BUNDLE_META.core;
    const { runCommand } = createOverlaysRunHelpers(deps);
    const config = await loadOverlaysConfig();
    const preview = config.previewMode === true;
    return runCommand(preview ? meta.commandPreview : meta.commandLive, {
        previewMode: preview,
        runBundle: bundle,
        lastRunKey: meta.lastRunKey,
    });
};

export { saveOverlaysConfig };
