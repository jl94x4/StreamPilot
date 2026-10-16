import fs from 'fs';
import {
    ALL_EDITION_MODULES,
    EDITIONS_LOG_PATH,
    buildEditionsCliConfig,
    loadEditionsConfig,
    saveEditionsConfig,
} from './config.js';
import { editionsWorkerReady, killActiveEditionsWorker, runEditionsCli } from './runner.js';

const ACTIVITY_LIMIT = 200;

export const runState = {
    running: false,
    action: null,
    startedAt: null,
    finishedAt: null,
    lastError: null,
    lastResult: null,
    percent: null,
    message: '',
    logs: [],
    cancelRequested: false,
};

let activity = [];
let inFlightJob = null;

const loadActivity = async () => {
    try {
        const raw = await fs.promises.readFile(EDITIONS_LOG_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        activity = Array.isArray(parsed) ? parsed : [];
    } catch {
        activity = [];
    }
};

const persistActivity = async () => {
    try {
        await fs.promises.writeFile(EDITIONS_LOG_PATH, JSON.stringify(activity.slice(0, ACTIVITY_LIMIT), null, 2), 'utf8');
    } catch {
        /* ignore */
    }
};

export const pushActivity = async (entry) => {
    if (!activity.length) await loadActivity();
    activity.unshift({
        at: new Date().toISOString(),
        ...entry,
    });
    activity = activity.slice(0, ACTIVITY_LIMIT);
    await persistActivity();
};

export const getEditionsRuntimeStatus = async () => {
    if (!activity.length) await loadActivity();
    return {
        workerReady: editionsWorkerReady(),
        modulesCatalog: ALL_EDITION_MODULES,
        running: runState.running,
        action: runState.action,
        startedAt: runState.startedAt,
        finishedAt: runState.finishedAt,
        lastError: runState.lastError,
        lastResult: runState.lastResult,
        percent: runState.percent,
        message: runState.message,
        logs: runState.logs.slice(-80),
        activity: activity.slice(0, 40),
        cancelRequested: runState.cancelRequested,
    };
};

export const createEditionsRunHelpers = ({
    loadPortalConfig,
    resolvePlex,
    markTaskStart,
    markTaskEnd,
    systemJob,
}) => {
    const startCommand = async (action, extra = {}) => {
        if (runState.running) {
            throw new Error('An Editions job is already running.');
        }
        const portalConfig = await loadPortalConfig();
        if (String(portalConfig.mediaServerType || 'plex').toLowerCase() !== 'plex') {
            throw new Error('Editions currently supports Plex Media Player settings only.');
        }
        const plex = await resolvePlex();
        if (!plex?.base_url || !plex?.token) {
            throw new Error('Configure Plex server URL and token under Settings → Media Player first.');
        }

        const editionsConfig = await loadEditionsConfig();
        const cliConfig = buildEditionsCliConfig(editionsConfig, plex, portalConfig);
        if (!cliConfig.server.address || !cliConfig.server.token) {
            throw new Error('Plex connection is incomplete.');
        }

        runState.running = true;
        runState.action = action;
        runState.startedAt = new Date().toISOString();
        runState.finishedAt = null;
        runState.lastError = null;
        runState.lastResult = null;
        runState.percent = 0;
        runState.message = `Starting ${action}…`;
        runState.logs = [];
        runState.cancelRequested = false;

        if (typeof markTaskStart === 'function' && systemJob) {
            try { markTaskStart(systemJob); } catch { /* ignore */ }
        }

        const payload = {
            action,
            config: cliConfig,
            ...extra,
        };

        // Fire and forget — status polled by UI.
        inFlightJob = (async () => {
            try {
                const { result, logs } = await runEditionsCli(payload, {
                    onEvent: (event) => {
                        if (event?.type === 'log' && event.message) {
                            runState.logs.push(String(event.message));
                            if (runState.logs.length > 400) runState.logs = runState.logs.slice(-400);
                            runState.message = String(event.message);
                        }
                        if (event?.type === 'progress') {
                            if (event.message) {
                                runState.message = String(event.message);
                                runState.logs.push(String(event.message));
                            }
                            if (Number.isFinite(Number(event.percent))) {
                                runState.percent = Math.max(0, Math.min(100, Number(event.percent)));
                            }
                        }
                        if (event?.type === 'error' && event.message) {
                            runState.lastError = String(event.message);
                        }
                    },
                });
                runState.lastResult = result;
                runState.percent = 100;
                runState.message = result?.ok === false ? 'Completed with errors' : 'Completed';
                if (Array.isArray(logs) && logs.length) {
                    runState.logs = [...runState.logs, ...logs].slice(-400);
                }
                await pushActivity({
                    action,
                    ok: result?.ok !== false,
                    message: runState.message,
                    detail: result || null,
                });
                if (action === 'process-all' && result?.ok !== false) {
                    try {
                        const latest = await loadEditionsConfig();
                        await saveEditionsConfig({
                            ...latest,
                            lastFullRunAt: new Date().toISOString(),
                        });
                    } catch {
                        /* ignore */
                    }
                }
            } catch (error) {
                runState.lastError = error?.message || String(error);
                runState.message = runState.lastError;
                await pushActivity({
                    action,
                    ok: false,
                    message: runState.lastError,
                });
            } finally {
                runState.running = false;
                runState.finishedAt = new Date().toISOString();
                runState.cancelRequested = false;
                inFlightJob = null;
                if (typeof markTaskEnd === 'function' && systemJob) {
                    try {
                        markTaskEnd(systemJob, runState.lastError ? new Error(runState.lastError) : null);
                    } catch { /* ignore */ }
                }
            }
        })();

        return getEditionsRuntimeStatus();
    };

    const runCommand = async (action, extra = {}) => {
        const portalConfig = await loadPortalConfig();
        if (String(portalConfig.mediaServerType || 'plex').toLowerCase() !== 'plex') {
            throw new Error('Editions currently supports Plex Media Player settings only.');
        }
        const plex = await resolvePlex();
        const editionsConfig = await loadEditionsConfig();
        const cliConfig = buildEditionsCliConfig(editionsConfig, plex, portalConfig);
        const { result, logs, events } = await runEditionsCli({
            action,
            config: cliConfig,
            ...extra,
        });
        return { result, logs, events };
    };

    const stopCommand = () => {
        runState.cancelRequested = true;
        runState.message = 'Cancel requested…';
        return killActiveEditionsWorker();
    };

    return { startCommand, runCommand, stopCommand };
};

export const waitForEditionsJob = () => inFlightJob || Promise.resolve();
