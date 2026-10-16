import { createPlexLibrary } from './plex.js';
import { createTraktClient } from './trakt.js';
import { runWatchSync } from './engine.js';
import {
    loadWatchSyncConfig,
    mergeWatchSyncConfig,
    publicWatchSyncConfig,
    saveWatchSyncConfig,
} from './config.js';

const runtime = {
    running: false,
    startedAt: '',
    progress: '',
    error: '',
    log: [],
    cancelRequested: false,
};

const pushLog = (message) => {
    const line = `${new Date().toISOString()} ${message}`;
    runtime.log = [...runtime.log, line].slice(-200);
    runtime.progress = message;
};

export const getWatchSyncRuntime = () => ({
    running: runtime.running,
    startedAt: runtime.startedAt,
    progress: runtime.progress,
    error: runtime.error,
    cancelRequested: runtime.cancelRequested,
    log: runtime.log.slice(-80),
});

export const requestWatchSyncCancel = () => {
    if (!runtime.running) return false;
    runtime.cancelRequested = true;
    pushLog('Cancel requested');
    return true;
};

let deviceAuth = null;

export const getDeviceAuth = () => {
    if (!deviceAuth) return null;
    if (deviceAuth.expiresAt && Date.parse(deviceAuth.expiresAt) < Date.now()) {
        deviceAuth = null;
        return null;
    }
    return {
        userCode: deviceAuth.userCode,
        verificationUrl: deviceAuth.verificationUrl,
        expiresAt: deviceAuth.expiresAt,
        interval: deviceAuth.interval,
    };
};

export const startDeviceAuth = async (config) => {
    const trakt = createTraktClient();
    const started = await trakt.startDevice(config);
    deviceAuth = {
        ...started,
        expiresAt: new Date(Date.now() + (Number(started.expiresIn) || 600) * 1000).toISOString(),
    };
    return getDeviceAuth();
};

export const pollDeviceAuth = async (config, saveConfig) => {
    if (!deviceAuth?.deviceCode) throw new Error('Start Trakt activation first.');
    const trakt = createTraktClient();
    const result = await trakt.pollDevice(config, deviceAuth.deviceCode);
    if (result.pending) return { pending: true, error: result.error, ...getDeviceAuth() };
    const next = mergeWatchSyncConfig(config, {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken || '',
        tokenExpiresAt: new Date(Date.now() + (Number(result.expiresIn) || 7776000) * 1000).toISOString(),
    });
    let username = '';
    try {
        username = await trakt.settings(next);
    } catch {
        username = '';
    }
    const saved = await saveConfig({ ...next, username });
    deviceAuth = null;
    return { pending: false, config: publicWatchSyncConfig(saved) };
};

export const startWatchSyncJob = async (deps, reason = 'manual') => {
    if (runtime.running) {
        const error = new Error('Watch Sync is already running.');
        error.status = 409;
        throw error;
    }
    runtime.running = true;
    runtime.cancelRequested = false;
    runtime.error = '';
    runtime.startedAt = new Date().toISOString();
    pushLog(`Sync started (${reason})`);

    const work = (async () => {
        try {
            const fetchImpl = deps.fetchImpl || fetch;
            const plex = createPlexLibrary({ fetchImpl });
            const logLine = (message) => {
                const text = String(message || '').replace(/^\[watch-sync\]\s*/, '');
                pushLog(text);
                if (typeof deps.log === 'function') deps.log(`[watch-sync] ${text}`);
            };
            const trakt = createTraktClient({ fetchImpl, log: logLine });
            const config = await loadWatchSyncConfig();
            const plexConn = await deps.resolvePlex();
            const summary = await runWatchSync({
                config,
                saveConfig: async (next) => saveWatchSyncConfig(mergeWatchSyncConfig(await loadWatchSyncConfig(), next)),
                plex,
                trakt,
                plexConn,
                onProgress: logLine,
                shouldCancel: () => runtime.cancelRequested,
                systemJob: deps.systemJob,
                markTaskStart: deps.markTaskStart,
                markTaskEnd: deps.markTaskEnd,
            });
            pushLog('Sync finished');
            return summary;
        } catch (error) {
            runtime.error = error?.message || String(error);
            pushLog(runtime.error);
            if (typeof deps.log === 'function') deps.log(`[watch-sync] ${runtime.error}`);
            throw error;
        } finally {
            runtime.running = false;
            runtime.cancelRequested = false;
        }
    })();

    if (reason === 'schedule') return work;
    void work.catch(() => {});
    return { started: true };
};

export const watchSyncDepsFrom = (deps) => deps;
