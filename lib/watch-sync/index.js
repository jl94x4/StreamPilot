import { createPlexLibrary } from './plex.js';
import { createTraktClient } from './trakt.js';
import {
    clearWatchSyncSnapshot,
    loadWatchSyncConfig,
    loadWatchSyncSnapshot,
    mergeWatchSyncConfig,
    publicWatchSyncConfig,
    saveWatchSyncConfig,
    summarizeWatchSyncSnapshot,
} from './config.js';
import { getLiveWatchStatus } from './watcher.js';
import {
    getDeviceAuth,
    getWatchSyncRuntime,
    pollDeviceAuth,
    requestWatchSyncCancel,
    startDeviceAuth,
    startWatchSyncJob,
} from './runtime.js';

export const createWatchSyncRouter = ({
    Router,
    requireAdmin,
    requireWatchSync,
    resolvePlex,
    markTaskStart,
    markTaskEnd,
    systemJob,
    log,
    fetchImpl,
}) => {
    const router = Router();
    const deps = {
        resolvePlex,
        markTaskStart,
        markTaskEnd,
        systemJob,
        log,
        fetchImpl,
    };

    router.use(requireAdmin, requireWatchSync);

    router.get('/status', async (_req, res) => {
        const config = await loadWatchSyncConfig();
        const cache = summarizeWatchSyncSnapshot(await loadWatchSyncSnapshot());
        res.json({
            ...getWatchSyncRuntime(),
            connected: !!config.accessToken,
            username: config.username,
            lastRun: config.lastRun,
            lastRunAt: config.lastRunAt,
            scheduleEnabled: config.scheduleEnabled,
            intervalHours: config.intervalHours,
            cache,
            live: getLiveWatchStatus(),
        });
    });

    router.get('/config', async (_req, res) => {
        const config = await loadWatchSyncConfig();
        res.json({
            config: publicWatchSyncConfig(config),
            device: getDeviceAuth(),
        });
    });

    router.put('/config', async (req, res) => {
        const current = await loadWatchSyncConfig();
        const saved = await saveWatchSyncConfig(mergeWatchSyncConfig(current, req.body || {}));
        res.json({ config: publicWatchSyncConfig(saved) });
    });

    router.post('/disconnect', async (_req, res) => {
        const current = await loadWatchSyncConfig();
        const saved = await saveWatchSyncConfig(mergeWatchSyncConfig(current, {
            accessToken: '',
            refreshToken: '',
            tokenExpiresAt: '',
            username: '',
        }));
        res.json({ config: publicWatchSyncConfig(saved) });
    });

    router.get('/libraries', async (_req, res) => {
        try {
            const plexConn = await resolvePlex();
            const plex = createPlexLibrary({ fetchImpl: fetchImpl || fetch });
            const libraries = await plex.libraries(plexConn.base_url, plexConn.token);
            res.json({ libraries });
        } catch (error) {
            res.status(error.status || 400).json({ error: error.message || 'Failed to list Plex libraries' });
        }
    });

    router.post('/connect/start', async (_req, res) => {
        try {
            const config = await loadWatchSyncConfig();
            if (!config.clientId || !config.clientSecret) {
                return res.status(400).json({ error: 'Save a Trakt client ID and client secret first.' });
            }
            const device = await startDeviceAuth(config);
            res.json({ device });
        } catch (error) {
            res.status(error.status || 400).json({ error: error.message || 'Failed to start Trakt activation' });
        }
    });

    router.post('/connect/poll', async (_req, res) => {
        try {
            const config = await loadWatchSyncConfig();
            const result = await pollDeviceAuth(config, (next) => saveWatchSyncConfig(mergeWatchSyncConfig(config, next)));
            res.json(result);
        } catch (error) {
            res.status(error.status || 400).json({ error: error.message || 'Failed to check Trakt activation' });
        }
    });

    router.post('/test', async (_req, res) => {
        try {
            const config = await loadWatchSyncConfig();
            if (!config.accessToken) return res.status(400).json({ error: 'Connect Trakt first.' });
            const trakt = createTraktClient({ fetchImpl: fetchImpl || fetch });
            const live = await trakt.refreshIfNeeded(config, (next) => saveWatchSyncConfig(mergeWatchSyncConfig(config, next)));
            const username = await trakt.settings(live);
            if (username && username !== live.username) {
                await saveWatchSyncConfig(mergeWatchSyncConfig(live, { username }));
            }
            const plexConn = await resolvePlex();
            res.json({ ok: true, username: username || live.username, plex: plexConn.base_url });
        } catch (error) {
            res.status(error.status || 400).json({ error: error.message || 'Connection test failed' });
        }
    });

    router.post('/sync', async (_req, res) => {
        try {
            const started = await startWatchSyncJob(deps, 'manual');
            res.json(started);
        } catch (error) {
            res.status(error.status || 400).json({ error: error.message || 'Failed to start sync' });
        }
    });

    router.post('/cancel', async (_req, res) => {
        res.json({ ok: requestWatchSyncCancel() });
    });

    router.post('/cache/clear', async (_req, res) => {
        if (getWatchSyncRuntime().running) {
            return res.status(409).json({ error: 'Wait until the current sync finishes before clearing the cache.' });
        }
        const snapshot = await clearWatchSyncSnapshot();
        res.json({ cache: summarizeWatchSyncSnapshot(snapshot) });
    });

    return router;
};
