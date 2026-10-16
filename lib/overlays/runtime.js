import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import {
    loadOverlaysConfig,
    saveOverlaysConfig,
    loadOverlaysLog,
    loadOverlaysEpisodeLog,
    listOverlayPresets,
    OVERLAYS_DIR,
    OVERLAYS_LOG_PATH,
    OVERLAYS_EPISODE_LOG_PATH,
    OVERLAYS_RECENTLY_ADDED_LOG_PATH,
    OVERLAYS_LIVE_LOG_PATH,
    OVERLAYS_TOP10_LOG_PATH,
    OVERLAYS_KOMETA_LOG_PATH,
    OVERLAYS_PREVIEW_DIR,
    OVERLAYS_BACKUPS_DIR,
    OVERLAYS_CUSTOM_PRESETS_DIR,
} from './config.js';
import {
    OVERLAYS_ASSETS_DIR,
    buildOverlaysCliConfig,
    killActiveOverlaysWorker,
    overlaysRunLockAlive,
    isOverlaysQuietCommand,
    overlaysWorkerReady,
    runOverlaysCli,
} from './runner.js';

const MAX_ACTIVITY = 200;
const MAX_QUEUE = 25;
const OVERLAYS_ACTIVITY_PATH = path.join(OVERLAYS_DIR, 'activity.json');
const OVERLAYS_QUEUE_PATH = path.join(OVERLAYS_DIR, 'job-queue.json');

/** @type {Array<{ at: number, level: string, message: string }>} */
export let activity = [];

/** @type {Array<{ id: string, command: string, options: object, enqueuedAt: string }>} */
export let jobQueue = [];

export let runState = {
    running: false,
    paused: false,
    command: null,
    startedAt: null,
    lastError: null,
    cancelled: false,
    /** @type {'ok' | 'error' | 'cancelled' | null} */
    lastOutcome: null,
};

const persistActivity = () => {
    try {
        fsSync.mkdirSync(OVERLAYS_DIR, { recursive: true });
        fsSync.writeFileSync(
            OVERLAYS_ACTIVITY_PATH,
            `${JSON.stringify(activity.slice(0, MAX_ACTIVITY), null, 2)}\n`,
            'utf8',
        );
    } catch {
        /* best-effort */
    }
};

const loadActivityFromDisk = () => {
    try {
        if (!fsSync.existsSync(OVERLAYS_ACTIVITY_PATH)) return;
        const raw = JSON.parse(fsSync.readFileSync(OVERLAYS_ACTIVITY_PATH, 'utf8'));
        if (!Array.isArray(raw)) return;
        activity = raw
            .filter((row) => row && typeof row === 'object')
            .map((row) => ({
                at: Number(row.at) || Date.now(),
                level: String(row.level || 'info'),
                message: String(row.message || '').slice(0, 500),
            }))
            .slice(0, MAX_ACTIVITY);
    } catch {
        /* ignore corrupt */
    }
};

const persistQueue = () => {
    try {
        fsSync.mkdirSync(OVERLAYS_DIR, { recursive: true });
        fsSync.writeFileSync(
            OVERLAYS_QUEUE_PATH,
            `${JSON.stringify(jobQueue, null, 2)}\n`,
            'utf8',
        );
    } catch {
        /* best-effort */
    }
};

const loadQueueFromDisk = () => {
    try {
        if (!fsSync.existsSync(OVERLAYS_QUEUE_PATH)) return;
        const raw = JSON.parse(fsSync.readFileSync(OVERLAYS_QUEUE_PATH, 'utf8'));
        if (!Array.isArray(raw)) return;
        jobQueue = raw
            .filter((row) => row && typeof row === 'object' && String(row.command || '').trim())
            .map((row) => ({
                id: String(row.id || randomUUID()),
                command: String(row.command || '').trim(),
                options: row.options && typeof row.options === 'object' ? row.options : {},
                enqueuedAt: String(row.enqueuedAt || new Date().toISOString()),
            }))
            .slice(0, MAX_QUEUE);
    } catch {
        /* ignore corrupt */
    }
};

loadActivityFromDisk();
loadQueueFromDisk();

export const pushActivity = (message, level = 'info') => {
    activity.unshift({
        at: Date.now(),
        level,
        message: String(message || '').slice(0, 500),
    });
    if (activity.length > MAX_ACTIVITY) activity.length = MAX_ACTIVITY;
    persistActivity();
};

export const getJobQueueSnapshot = () => jobQueue.map((job, index) => ({
    id: job.id,
    command: job.command,
    enqueuedAt: job.enqueuedAt,
    position: index + 1,
    onlyRatingKeys: Array.isArray(job.options?.onlyRatingKeys) ? job.options.onlyRatingKeys : undefined,
    onlyCollectionRatingKeys: Array.isArray(job.options?.onlyCollectionRatingKeys)
        ? job.options.onlyCollectionRatingKeys
        : undefined,
    runBundle: job.options?.runBundle || null,
    kometaScope: job.options?.kometaScope || null,
    previewMode: job.options?.previewMode ?? null,
}));

export const clearJobQueue = () => {
    const cleared = jobQueue.length;
    jobQueue = [];
    persistQueue();
    if (cleared) pushActivity(`Cleared ${cleared} queued overlay job(s)`, 'warn');
    return { ok: true, cleared };
};

export const cancelQueuedJob = (jobId) => {
    const id = String(jobId || '').trim();
    if (!id) return { ok: false, removed: false };
    const before = jobQueue.length;
    const removedJob = jobQueue.find((j) => j.id === id) || null;
    jobQueue = jobQueue.filter((j) => j.id !== id);
    persistQueue();
    const removed = before !== jobQueue.length;
    if (removed && removedJob) {
        pushActivity(`Removed queued ${removedJob.command} from the queue`, 'warn');
    }
    return { ok: true, removed, jobId: id };
};

const overlaysBusy = () => Boolean(runState.running || overlaysRunLockAlive());

export const getPortalPlex = async (loadPortalConfig, resolvePlex) => {
    if (typeof resolvePlex === 'function') {
        return resolvePlex();
    }
    const portal = typeof loadPortalConfig === 'function' ? await loadPortalConfig() : {};
    return {
        base_url: portal.plexServerUrl || portal.plexUrl || '',
        token: portal.plexToken || '',
    };
};

export const getOverlaysRuntimeStatus = async () => {
    // Rehydrate in-memory state when a worker pid is still alive (e.g. after a Node hiccup).
    if (!runState.running) {
        const lock = overlaysRunLockAlive();
        if (lock && !isOverlaysQuietCommand(lock.command)) {
            runState = {
                ...runState,
                running: true,
                command: lock.command || runState.command,
                startedAt: lock.startedAt || runState.startedAt,
                lastError: null,
                cancelled: false,
                lastOutcome: null,
            };
        }
    } else if (isOverlaysQuietCommand(runState.command)) {
        // Defensive: never leave the UI stuck on a quiet helper command.
        runState = {
            ...runState,
            running: false,
            command: null,
            startedAt: null,
        };
    }

    const config = await loadOverlaysConfig();
    const log = await loadOverlaysLog();
    const episodeLog = await loadOverlaysEpisodeLog();
    const presets = await listOverlayPresets(OVERLAYS_ASSETS_DIR, OVERLAYS_CUSTOM_PRESETS_DIR);
    const episodeEntries = Object.keys(episodeLog).filter((k) => !String(k).startsWith('season:'));
    const previewOnlyShows = Object.values(log).filter((e) => e && typeof e === 'object' && e.preview_only).length;
    const previewOnlyEpisodes = Object.entries(episodeLog)
        .filter(([k, e]) => !String(k).startsWith('season:') && e && typeof e === 'object' && e.preview_only)
        .length;
    const previewOnlySeasons = Object.entries(episodeLog)
        .filter(([k, e]) => String(k).startsWith('season:') && e && typeof e === 'object' && e.preview_only)
        .length;
    return {
        ok: true,
        workerReady: overlaysWorkerReady(),
        config,
        logCount: Object.keys(log).length,
        episodeLogCount: episodeEntries.length,
        previewOnlyShows,
        previewOnlyEpisodes,
        previewOnlySeasons,
        running: runState.running,
        command: runState.command,
        startedAt: runState.startedAt,
        lastError: runState.lastError,
        lastOutcome: runState.lastOutcome,
        lastRunAt: config.lastRunAt,
        recentlyAddedLastRunAt: config.recentlyAddedLastRunAt,
        kometaLastRunAt: config.kometaLastRunAt,
        lastRunSummary: config.lastRunSummary,
        coreLastRunSummary: config.coreLastRunSummary,
        recentlyLastRunSummary: config.recentlyLastRunSummary,
        kometaLastRunSummary: config.kometaLastRunSummary,
        collectionsLastRunSummary: config.collectionsLastRunSummary,
        queue: getJobQueueSnapshot(),
        queueLength: jobQueue.length,
        paths: {
            dir: OVERLAYS_DIR,
            log: OVERLAYS_LOG_PATH,
            episodeLog: OVERLAYS_EPISODE_LOG_PATH,
            preview: OVERLAYS_PREVIEW_DIR,
            backups: OVERLAYS_BACKUPS_DIR,
            assets: OVERLAYS_ASSETS_DIR,
            customPresets: OVERLAYS_CUSTOM_PRESETS_DIR,
        },
        presets,
        activity: activity.slice(0, 80),
    };
};

export const listOverlaysShows = async () => {
    const log = await loadOverlaysLog();
    const shows = Object.entries(log).map(([ratingKey, entry]) => ({
        ratingKey,
        title: entry?.title || ratingKey,
        library: entry?.library || '',
        timestamp: entry?.timestamp || null,
        previewOnly: Boolean(entry?.preview_only),
        seasonIndex: entry?.seasonIndex ?? null,
        presetId: entry?.presetId || null,
        overlayMode: 'new-season',
    }));

    const extraLogs = [
        { path: OVERLAYS_RECENTLY_ADDED_LOG_PATH, overlayMode: 'recently' },
        { path: OVERLAYS_LIVE_LOG_PATH, overlayMode: 'live' },
        { path: OVERLAYS_TOP10_LOG_PATH, overlayMode: 'top10' },
    ];
    for (const { path: logPath, overlayMode } of extraLogs) {
        let extra = {};
        try {
            const raw = await fs.readFile(logPath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) extra = parsed;
        } catch {
            extra = {};
        }
        for (const [ratingKey, entry] of Object.entries(extra)) {
            shows.push({
                ratingKey,
                title: entry?.title || ratingKey,
                library: entry?.library || '',
                timestamp: entry?.timestamp || null,
                previewOnly: Boolean(entry?.preview_only),
                seasonIndex: entry?.seasonIndex ?? null,
                presetId: entry?.presetId || null,
                overlayMode,
            });
        }
    }

    shows.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
    return { ok: true, shows, total: shows.length };
};

export const listOverlaysKometa = async () => {
    let log = {};
    try {
        const raw = await fs.readFile(OVERLAYS_KOMETA_LOG_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) log = parsed;
    } catch {
        log = {};
    }
    const items = Object.entries(log).map(([ratingKey, entry]) => ({
        ratingKey,
        title: entry?.title || ratingKey,
        library: entry?.library || '',
        itemType: entry?.itemType || '',
        timestamp: entry?.timestamp || null,
        previewOnly: Boolean(entry?.preview_only),
        families: entry?.families && typeof entry.families === 'object' ? entry.families : {},
        hasBackup: Boolean(entry?.hasBackup),
        orphanBackup: false,
    }));
    const seen = new Set(items.map((row) => String(row.ratingKey)));
    // Mid-run timeout orphans: stamped + backed up, but log never flushed.
    const kometaBackupRoot = path.join(OVERLAYS_BACKUPS_DIR, 'kometa');
    try {
        const dirs = await fs.readdir(kometaBackupRoot, { withFileTypes: true });
        for (const dirent of dirs) {
            if (!dirent.isDirectory()) continue;
            const ratingKey = String(dirent.name || '').trim();
            if (!ratingKey || seen.has(ratingKey)) continue;
            try {
                await fs.access(path.join(kometaBackupRoot, ratingKey, 'poster.png'));
            } catch {
                continue;
            }
            items.push({
                ratingKey,
                title: ratingKey,
                library: '',
                itemType: '',
                timestamp: null,
                previewOnly: false,
                families: {},
                hasBackup: true,
                orphanBackup: true,
            });
        }
    } catch {
        /* no backup dir yet */
    }
    items.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
    return { ok: true, items, total: items.length };
};

export const listOverlaysEpisodes = async () => {
    const log = await loadOverlaysEpisodeLog();
    const rows = [];
    for (const [ratingKey, entry] of Object.entries(log)) {
        if (String(ratingKey).startsWith('season:')) continue;
        rows.push({
            ratingKey,
            title: entry?.title || ratingKey,
            showTitle: entry?.showTitle || '',
            showKey: entry?.showKey || '',
            library: entry?.library || '',
            timestamp: entry?.timestamp || null,
            airedAt: entry?.airedAt || null,
            seasonIndex: entry?.seasonIndex ?? null,
            episodeIndex: entry?.episodeIndex ?? null,
            previewOnly: Boolean(entry?.preview_only),
            presetId: entry?.presetId || 'new-episode',
            kind: 'episode',
        });
    }

    const groups = new Map();
    for (const row of rows) {
        const day = String(row.airedAt || '').slice(0, 10);
        const showKey = String(row.showKey || row.showTitle || '');
        const season = row.seasonIndex;
        if (!showKey || season == null || day.length < 10) continue;
        const gid = `${showKey}|${season}|${day}`;
        if (!groups.has(gid)) groups.set(gid, []);
        groups.get(gid).push(row.ratingKey);
    }
    const bingeIds = new Set();
    for (const [gid, keys] of groups.entries()) {
        if (keys.length >= 3) {
            for (const key of keys) bingeIds.add(key);
            for (const row of rows) {
                if (keys.includes(row.ratingKey)) row.bingeGroupId = gid;
            }
        }
    }
    for (const row of rows) {
        if (!row.bingeGroupId) row.bingeGroupId = null;
    }

    rows.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
    return {
        ok: true,
        episodes: rows,
        total: rows.length,
        bingeGroupCount: [...groups.values()].filter((keys) => keys.length >= 3).length,
    };
};

export const createOverlaysRunHelpers = (deps = {}) => {
    const {
        loadPortalConfig,
        resolvePlex,
        markTaskStart,
        markTaskEnd,
        systemJob,
    } = deps;

    let pumping = false;

    const pumpQueue = () => {
        if (pumping) return;
        if (overlaysBusy()) return;
        const next = jobQueue.shift();
        if (!next) {
            persistQueue();
            return;
        }
        persistQueue();
        pumping = true;
        pushActivity(`Starting queued ${next.command} (${jobQueue.length} still waiting)…`);
        void startCommand(next.command, next.options || {})
            .catch((error) => {
                pushActivity(error?.message || `Queued ${next.command} failed to start`, 'error');
            })
            .finally(() => {
                pumping = false;
                // If start failed before execute claimed the slot, try the next item.
                if (!overlaysBusy() && jobQueue.length) {
                    setImmediate(() => pumpQueue());
                }
            });
    };

    const prepareRun = async (command, { previewMode, runBundle, kometaScope, onlyCollectionRatingKeys, onlyRatingKeys, lastRunKey } = {}) => {
        const alreadyClaimed = Boolean(
            runState.running
            && String(runState.command || '') === String(command || ''),
        );
        if ((runState.running || overlaysRunLockAlive()) && !alreadyClaimed) {
            throw Object.assign(new Error('An Overlays run is already in progress.'), { status: 409 });
        }
        const overlaysConfig = await loadOverlaysConfig();
        if (overlaysConfig.enabled === false) {
            throw Object.assign(new Error('Overlays module is disabled in its settings.'), { status: 400 });
        }
        const portal = typeof loadPortalConfig === 'function' ? await loadPortalConfig() : {};
        const plex = await getPortalPlex(loadPortalConfig, resolvePlex);
        if (!plex?.base_url || !plex?.token) {
            throw Object.assign(new Error('Configure Plex under Settings → Media Player first.'), { status: 400 });
        }
        if (!overlaysWorkerReady()) {
            throw Object.assign(new Error('Overlays worker is not installed (overlays/cli.py missing).'), { status: 500 });
        }

        const onlyKeys = Array.isArray(onlyCollectionRatingKeys)
            ? onlyCollectionRatingKeys.map((k) => String(k || '').trim()).filter(Boolean)
            : [];
        const onlyTitleKeys = Array.isArray(onlyRatingKeys)
            ? onlyRatingKeys.map((k) => String(k || '').trim()).filter(Boolean)
            : [];

        const cliConfig = await buildOverlaysCliConfig(plex, {
            ...overlaysConfig,
            ...(previewMode === true ? { previewMode: true } : {}),
            ...(previewMode === false ? { previewMode: false } : {}),
            ...(runBundle ? { runBundle } : {}),
            ...(kometaScope ? { kometaScope } : {}),
            ...(onlyKeys.length ? { onlyCollectionRatingKeys: onlyKeys } : {}),
            ...(onlyTitleKeys.length ? { onlyRatingKeys: onlyTitleKeys } : {}),
        }, portal);

        if (!alreadyClaimed) {
            runState = {
                running: true,
                paused: false,
                command,
                startedAt: new Date().toISOString(),
                lastError: null,
                cancelled: false,
                lastOutcome: null,
            };
            pushActivity(`Starting ${command}…`);
            if (systemJob && typeof markTaskStart === 'function') markTaskStart(systemJob);
        } else {
            pushActivity(`Starting ${command}…`);
            if (systemJob && typeof markTaskStart === 'function' && !systemJob.running) {
                markTaskStart(systemJob);
            }
        }

        const execute = async () => {
            try {
                const isLayer = /kometa|collections/i.test(String(command || ''));
                const result = await runOverlaysCli(command, { config: cliConfig }, {
                    // Layer passes can legitimately run for hours on large libraries.
                    timeoutMs: isLayer ? 6 * 60 * 60_000 : 30 * 60_000,
                    idleTimeoutMs: isLayer ? 45 * 60_000 : null,
                    onProgress: (event) => pushActivity(event.message || ''),
                });

                if (result.cancelled || runState.cancelled) {
                    runState.lastError = null;
                    runState.lastOutcome = 'cancelled';
                    pushActivity('Overlays run cancelled', 'warn');
                    if (systemJob && typeof markTaskEnd === 'function') {
                        markTaskEnd(systemJob, Object.assign(new Error('cancelled'), { cancelled: true }));
                    }
                    return { ok: false, cancelled: true, logs: result.logs || [] };
                }

                if (!result.ok) {
                    const err = new Error(result.error || 'Overlays run failed');
                    runState.lastError = err.message;
                    runState.lastOutcome = 'error';
                    pushActivity(err.message, 'error');
                    if (systemJob && typeof markTaskEnd === 'function') markTaskEnd(systemJob, err);
                    throw Object.assign(err, { status: 500, logs: result.logs });
                }

                const summary = result.result || {};
                const stampKey = lastRunKey
                    || (String(command).includes('kometa') ? 'kometaLastRunAt'
                        : String(command).includes('recently') ? 'recentlyAddedLastRunAt'
                            : 'lastRunAt');
                const effectiveBundle = runBundle
                    || (String(command).includes('collections') ? 'collections'
                        : String(command).includes('recently') ? 'recently'
                            : String(command).includes('kometa') ? 'kometa'
                                : 'core');
                const bundleSummaryKey = effectiveBundle === 'recently' ? 'recentlyLastRunSummary'
                    : effectiveBundle === 'collections' ? 'collectionsLastRunSummary'
                        : effectiveBundle === 'kometa' ? 'kometaLastRunSummary'
                            : 'coreLastRunSummary';
                const summaryPayload = {
                    command,
                    runBundle: summary.runBundle || effectiveBundle || null,
                    kometaScope: summary.kometaScope || kometaScope || null,
                    added: summary.added ?? null,
                    removed: summary.removed ?? null,
                    converted: summary.converted ?? null,
                    refreshed: summary.refreshed ?? null,
                    skipped: summary.skipped ?? null,
                    totalWithOverlays: summary.totalWithOverlays ?? null,
                    eligible: summary.eligible ?? summary.eligibleCount ?? null,
                    episodesAdded: summary.episodesAdded ?? null,
                    episodesRemoved: summary.episodesRemoved ?? null,
                    episodesRefreshed: summary.episodesRefreshed ?? null,
                    episodesEligible: summary.episodesEligible ?? null,
                    episodesTotal: summary.episodesTotal ?? null,
                    showsPromoted: summary.showsPromoted ?? null,
                    episodesPromoted: summary.episodesPromoted ?? null,
                    seasonsPromoted: summary.seasonsPromoted ?? null,
                    wouldAddCount: summary.wouldAddCount ?? null,
                    wouldRemoveCount: summary.wouldRemoveCount ?? null,
                    wouldConvertCount: summary.wouldConvertCount ?? null,
                    mediaAdded: summary.mediaAdded ?? null,
                    statusAdded: summary.statusAdded ?? null,
                    ratingsAdded: summary.ratingsAdded ?? null,
                    networkAdded: summary.networkAdded ?? null,
                    kometaAdded: summary.kometaAdded ?? null,
                    kometaRemoved: summary.kometaRemoved ?? null,
                    kometaSkipped: summary.kometaSkipped ?? null,
                    kometaTotal: summary.kometaTotal ?? null,
                    kometaEligible: summary.kometaEligible ?? null,
                    kometaFamilyCounts: summary.kometaFamilyCounts ?? null,
                    recentlyAddedAdded: summary.recentlyAddedAdded ?? summary.recentlyAdded ?? null,
                    recentlyAddedRemoved: summary.recentlyAddedRemoved ?? null,
                    recentlyAddedSkipped: summary.recentlyAddedSkipped ?? null,
                    recentlyAddedEligible: summary.recentlyAddedEligible ?? null,
                    previewMode: summary.previewMode ?? previewMode ?? overlaysConfig.previewMode,
                    previewDir: summary.previewDir ?? null,
                    errors: summary.errors || [],
                    finishedAt: summary.finishedAt || new Date().toISOString(),
                };
                await saveOverlaysConfig({
                    [stampKey]: new Date().toISOString(),
                    lastRunSummary: summaryPayload,
                    ...(bundleSummaryKey ? { [bundleSummaryKey]: summaryPayload } : {}),
                });
                runState.lastOutcome = 'ok';
                const eligibleLabel = summary.eligible ?? summary.eligibleCount;
                if (command === 'promote') {
                    pushActivity(
                        `Finished promote — shows ${summary.showsPromoted ?? 0}, `
                            + `episodes ${summary.episodesPromoted ?? 0}, `
                            + `season stamps ${summary.seasonsPromoted ?? 0}`,
                    );
                } else if (/kometa|collections/i.test(String(command || ''))) {
                    pushActivity(
                        `Finished ${command} — layer +${summary.kometaAdded ?? 0}/−${summary.kometaRemoved ?? 0}`
                            + (summary.kometaSkipped ? ` (${summary.kometaSkipped} skipped)` : ''),
                    );
                } else if (/recently/i.test(String(command || ''))) {
                    pushActivity(
                        `Finished ${command} — recently added +${summary.recentlyAddedAdded ?? summary.recentlyAdded ?? 0}/`
                            + `−${summary.recentlyAddedRemoved ?? 0}`,
                    );
                } else if (command === 'scan' || command === 'reconcile') {
                    pushActivity(`Finished ${command} — eligible ${eligibleLabel ?? 0}`);
                } else {
                    pushActivity(
                        `Finished ${command} — shows +${summary.added ?? 0}/−${summary.removed ?? 0}, `
                            + `episodes +${summary.episodesAdded ?? 0}/−${summary.episodesRemoved ?? 0}`,
                    );
                }
                if (systemJob && typeof markTaskEnd === 'function') markTaskEnd(systemJob, null);
                return { ok: true, result: summary, logs: result.logs };
            } catch (error) {
                if (runState.cancelled || error?.cancelled) {
                    runState.lastError = null;
                    runState.lastOutcome = 'cancelled';
                    return { ok: false, cancelled: true };
                }
                if (!runState.lastError) {
                    runState.lastError = error.message || String(error);
                    runState.lastOutcome = 'error';
                    pushActivity(runState.lastError, 'error');
                    if (systemJob && typeof markTaskEnd === 'function') markTaskEnd(systemJob, error);
                }
                throw error;
            } finally {
                runState.running = false;
                runState.command = null;
                runState.cancelled = false;
                setImmediate(() => pumpQueue());
            }
        };

        return { execute, command };
    };

    /** Await the full worker run (scheduler / maintenance). */
    const runCommand = async (command, options = {}) => {
        const { execute } = await prepareRun(command, options);
        return execute();
    };

    /** Kick off Preview/Run and return immediately so Stop + status polling work. */
    const startCommand = async (command, options = {}) => {
        const { execute, command: started } = await prepareRun(command, options);
        void execute().catch(() => {
            /* errors recorded on runState / activity */
        });
        return { ok: true, started: true, queued: false, command: started };
    };

    /**
     * Start now, or append to the server-side FIFO queue when a job is already running.
     * Survives browser refresh/close — queue is persisted on disk.
     */
    const enqueueOrStart = async (command, options = {}) => {
        if (overlaysBusy()) {
            if (jobQueue.length >= MAX_QUEUE) {
                throw Object.assign(
                    new Error(`Overlays queue is full (${MAX_QUEUE} jobs). Stop or clear the queue first.`),
                    { status: 429 },
                );
            }
            const job = {
                id: randomUUID(),
                command: String(command || '').trim(),
                options: { ...options },
                enqueuedAt: new Date().toISOString(),
            };
            jobQueue.push(job);
            persistQueue();
            pushActivity(`Queued ${job.command} — position ${jobQueue.length}`);
            return {
                ok: true,
                started: false,
                queued: true,
                position: jobQueue.length,
                jobId: job.id,
                command: job.command,
                queueLength: jobQueue.length,
            };
        }
        return startCommand(command, options);
    };

    const stopCommand = ({ clearQueue = false } = {}) => {
        runState.cancelled = true;
        const killed = killActiveOverlaysWorker();
        runState.running = false;
        runState.command = null;
        runState.lastError = null;
        runState.lastOutcome = killed ? 'cancelled' : runState.lastOutcome;
        let cleared = 0;
        if (clearQueue) {
            cleared = clearJobQueue().cleared;
        }
        pushActivity(
            killed
                ? (cleared ? `Stopped overlays worker and cleared ${cleared} queued job(s)` : 'Stopped active overlays worker')
                : (cleared ? `Cleared ${cleared} queued job(s)` : 'No active worker to stop'),
            killed || cleared ? 'warn' : 'info',
        );
        // If we only stopped the current job, the next queued item starts automatically.
        if (!clearQueue) {
            setImmediate(() => pumpQueue());
        }
        return { ok: true, killed, cleared };
    };

    // Resume any persisted queue after portal restart (only when nothing is already running).
    setImmediate(() => pumpQueue());

    return {
        runCommand,
        startCommand,
        enqueueOrStart,
        stopCommand,
        killActiveOverlaysWorker,
        pumpQueue,
    };
};
