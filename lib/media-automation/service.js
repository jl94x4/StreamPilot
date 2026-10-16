import path from 'path';
import { normalizeMediaAutomationConfig, shouldPauseEncodingForLibraryScan } from './config.js';
import { createAtomicJsonStore } from './store.js';
import { createDurableJobQueue } from './queue.js';
import { createMediaProcessor } from './processor.js';
import { createMediaScheduler } from './scheduler.js';
import { createCatalogStore } from './catalog.js';
import { createActivityStore } from './activity.js';
import { createHistoryStore, historyEntryToJob } from './history.js';
import { createScanHistoryStore } from './scan-history.js';
import { createMediaPluginRegistry } from './plugins.js';
import { createMediaLibraryWatcher } from './watcher.js';
import { isQuietHoursActive } from './quiet-hours.js';

export const createMediaAutomation = ({
    dataDir,
    queuePath,
    getConfig = async () => ({}),
    logger = console,
    clock,
    probe,
    detectCapabilities,
    runner,
    workerId,
    registry = createMediaPluginRegistry(),
    onActivity,
    resolveDeliveryNaming,
    onMediaCommitted,
    getActiveStreamCount,
    getWatchStats,
    setWorkerPaused,
} = {}) => {
    const filePath = queuePath || (dataDir ? path.join(path.resolve(dataDir), 'queue.json') : '');
    if (!filePath) throw new Error('[media-automation] dataDir or queuePath is required');
    const rootDir = dataDir ? path.resolve(dataDir) : path.dirname(path.resolve(filePath));
    const normalizedConfig = async () => normalizeMediaAutomationConfig(await getConfig());
    const history = createHistoryStore({
        clock,
        store: createAtomicJsonStore({
            filePath: path.join(rootDir, 'history.json'),
            defaultValue: { version: 1, entries: [] },
        }),
    });
    const scanHistory = createScanHistoryStore({
        clock,
        store: createAtomicJsonStore({
            filePath: path.join(rootDir, 'scan-history.json'),
            defaultValue: { version: 1, entries: [], progress: null },
        }),
    });
    const store = createAtomicJsonStore({
        filePath,
        defaultValue: { version: 1, jobs: [] },
    });
    const queue = createDurableJobQueue({
        store,
        clock,
        onTerminal: (job) => history.record(job),
    });
    const libraries = createCatalogStore({
        kind: 'library',
        clock,
        store: createAtomicJsonStore({
            filePath: path.join(rootDir, 'libraries.json'),
            defaultValue: { version: 1, items: [] },
        }),
    });
    const pipelines = createCatalogStore({
        kind: 'pipeline',
        clock,
        store: createAtomicJsonStore({
            filePath: path.join(rootDir, 'pipelines.json'),
            defaultValue: { version: 1, items: [] },
        }),
    });
    const activity = createActivityStore({
        clock,
        onActivity,
        store: createAtomicJsonStore({
            filePath: path.join(rootDir, 'activity.json'),
            defaultValue: { version: 1, entries: [] },
        }),
    });
    const processor = createMediaProcessor({
        queue,
        getConfig: normalizedConfig,
        logger,
        probe,
        detectCapabilities,
        runner,
        workerId,
        libraries,
        pipelines,
        registry,
        activity,
        scanHistory,
        history,
        resolveDeliveryNaming,
        onMediaCommitted,
        getWatchStats,
    });
    const scheduler = createMediaScheduler({
        processor,
        getConfig: normalizedConfig,
        logger,
        clock,
        scanHistory,
        getActiveStreamCount,
        getQueuedCount: async () => {
            const jobs = await queue.list();
            return jobs.filter((job) => job.state === 'queued').length;
        },
        clearQueuedByScanBatch: (scanBatchId) => queue.cancelQueuedByScanBatch(scanBatchId),
        onLibraryScanBegin: async (options = {}) => {
            const settings = await normalizedConfig();
            if (!shouldPauseEncodingForLibraryScan(settings, options)) return;
            if (typeof setWorkerPaused !== 'function') return;
            if (settings.workerPaused === true) return;
            await setWorkerPaused(true);
            await activity.append({
                type: 'worker.pause',
                message: 'Encoding paused for library scan — press Start when you want queued jobs to run',
                data: { reason: 'pause-encoding-on-scan', source: options.source || 'manual' },
            });
        },
    });
    const watcher = createMediaLibraryWatcher({
        getConfig: normalizedConfig,
        listLibraries: () => libraries.list(),
        enqueuePath: (filePathValue, options) => processor.enqueuePath(filePathValue, options),
        onActivity: (entry) => activity.append(entry),
        logger,
    });

    const scanNow = async (options = {}) => {
        const result = await scheduler.scanNow(options);
        if (result) {
            const dry = result.preview || result.planOnly;
            if (dry && options.planOnly) {
                await activity.append({
                    type: 'library.scan.plan-only',
                    message: `Plan-only scan: ${result.wouldEnqueue || 0} would enqueue, ${result.wouldSkip || 0} would skip`,
                    data: result,
                });
            } else if (!dry) {
                await activity.append({
                    type: result.cancelled ? 'library.scan.cancelled' : 'library.scan.completed',
                    message: result.cancelled
                        ? `Library scan cancelled: ${result.enqueued || 0} queued, ${result.skipped || 0} skipped before stop`
                        : `Library scan finished: ${result.enqueued || 0} queued, ${result.skipped || 0} skipped`,
                    data: result,
                });
            }
        }
        return result;
    };

    const cancelScan = async ({ clearQueued = false } = {}) => {
        const result = await scheduler.cancelScan({ clearQueued });
        if (result?.cancelled || result?.progressCleared) {
            await activity.append({
                type: 'library.scan.cancel-requested',
                message: result?.cancelled
                    ? (clearQueued
                        ? `Library scan cancel requested (clearing queued jobs from batch)`
                        : 'Library scan cancel requested')
                    : 'Cleared stuck scan progress',
                data: result,
            });
        }
        return result;
    };

    let bootstrapped = false;

    const start = async () => {
        // Cold start only: after a container/process restart every RUNNING row is orphaned.
        // Soft re-entry (Save Settings, Start button) must NOT reclaim live encodes.
        if (!bootstrapped) {
            try {
                const orphaned = await queue.recoverOrphanedRunning();
                if (orphaned.length) {
                    logger.warn?.(
                        `[media-automation] recovered ${orphaned.length} orphaned running job(s) after restart`,
                    );
                }
            } catch (error) {
                logger.warn?.(`[media-automation] orphan recovery failed: ${error.message}`);
                await queue.recoverExpired();
            }
            bootstrapped = true;
        } else {
            try {
                await queue.recoverExpired();
            } catch (error) {
                logger.warn?.(`[media-automation] lease recovery failed: ${error.message}`);
            }
        }
        await scheduler.start();
        // Watcher setup on large remote mounts must not block portal startup.
        void watcher.start().catch((error) => {
            logger.warn?.(`[media-automation] watcher start failed: ${error.message}`);
        });
        return api;
    };
    const stop = async () => {
        scheduler.stop();
        await watcher.stop();
        // Allow a later enable/start to treat leftover RUNNING rows as orphans again.
        bootstrapped = false;
    };
    const status = async () => {
        const jobs = await queue.list();
        const settings = await normalizedConfig();
        const schedulerStatus = scheduler.status();
        const watcherStatus = watcher.status();
        let scanProgress = await scanHistory.getProgress();
        // Self-heal sticky banners left by older builds / plan-only scans that never cleared progress.
        if (scanProgress?.running && !schedulerStatus.scanning) {
            try {
                await scanHistory.setProgress(null);
            } catch {
                // Best-effort cleanup.
            }
            scanProgress = null;
        }
        const recentScans = await scanHistory.list({ limit: 10 });
        const savings1d = await history.aggregates({ days: 1 });
        const savings7d = await history.aggregates({ days: 7 });
        const savings30d = await history.aggregates({ days: 30 });
        const historyTotals = await history.totals();
        const deliveryTargets = (settings.deliveryTargets || []).filter((target) => target.enabled !== false);
        return {
            ...schedulerStatus,
            watch: watcherStatus,
            libraryScanEnabled: settings.libraryScanEnabled !== false,
            libraryWatchEnabled: settings.libraryWatchEnabled !== false,
            libraryScanIntervalMinutes: settings.libraryScanIntervalMinutes,
            outputMode: settings.outputMode,
            dryRun: !!settings.dryRun || settings.outputMode === 'dry-run',
            hardwareAcceleration: settings.hardwareAcceleration,
            fallbackHardware: settings.fallback?.hardware || 'cpu',
            quietHoursEnabled: settings.quietHoursEnabled === true,
            quietHoursStart: settings.quietHoursStart,
            quietHoursEnd: settings.quietHoursEnd,
            quietHoursDays: settings.quietHoursDays || [],
            quietHoursActive: isQuietHoursActive(settings),
            pauseWhenStreamingEnabled: settings.pauseWhenStreamingEnabled === true,
            pauseWhenStreamingLanes: settings.pauseWhenStreamingLanes || 'gpu',
            arrRescanEnabled: settings.arrRescanEnabled === true,
            scannerRefreshEnabled: settings.scannerRefreshEnabled === true,
            plexRescanEnabled: settings.plexRescanEnabled === true,
            minSavingsPercent: settings.minSavingsPercent || 0,
            minReclaimGb: settings.minReclaimGb || 0,
            minSourceGb: settings.minSourceGb || 0,
            sampleGateEnabled: settings.sampleGateEnabled === true,
            replaceQualityGuard: settings.replaceQualityGuard !== false,
            audioOnlyIfVideoMatches: settings.audioOnlyIfVideoMatches === true,
            dolbyVisionHandling: settings.dolbyVisionHandling || 'skip',
            hdr10Handling: settings.hdr10Handling || 'preserve',
            workerPaused: settings.workerPaused !== false,
            pauseEncodingOnScan: settings.pauseEncodingOnScan !== false,
            autoPauseQueueDepth: settings.autoPauseQueueDepth || 0,
            minFreeDiskGb: settings.minFreeDiskGb ?? 20,
            pathDenyList: settings.pathDenyList || [],
            notifyOnScanComplete: settings.notifyOnScanComplete === true,
            notifyOnFailBurst: settings.notifyOnFailBurst === true,
            workerGroups: settings.workerGroups || [],
            deliveryTargets,
            scanProgress,
            recentScans,
            // Durable counters — survive clearing finished jobs from the queue.
            completedJobs: historyTotals.completed,
            failedJobs: historyTotals.failed,
            savings: {
                '1d': savings1d,
                '7d': savings7d,
                '30d': savings30d,
            },
            metrics: {
                processed24h: savings1d.completed,
                failed24h: savings1d.failed,
                cancelled24h: savings1d.cancelled || 0,
                successRate24h: (savings1d.completed + savings1d.failed + (savings1d.cancelled || 0)) > 0
                    ? Math.round((savings1d.completed / (savings1d.completed + savings1d.failed + (savings1d.cancelled || 0))) * 100)
                    : null,
                bytesIn24h: savings1d.bytesIn,
                bytesOut24h: savings1d.bytesOut,
                bytesSaved24h: savings1d.bytesSaved,
                encodeMs24h: savings1d.encodeMs,
                bytesSaved7d: savings7d.bytesSaved,
                encodeMs7d: savings7d.encodeMs,
                bytesSaved30d: savings30d.bytesSaved,
                encodeMs30d: savings30d.encodeMs,
            },
            lanes: {
                cpu: {
                    ...schedulerStatus.lanes.cpu,
                    queued: jobs.filter((job) => job.state === 'queued' && job.lane === 'cpu').length,
                    running: jobs.filter((job) => job.state === 'running' && job.lane === 'cpu').length,
                },
                gpu: {
                    ...schedulerStatus.lanes.gpu,
                    queued: jobs.filter((job) => job.state === 'queued' && job.lane === 'gpu').length,
                    running: jobs.filter((job) => job.state === 'running' && job.lane === 'gpu').length,
                },
            },
            jobs,
        };
    };
    const reloadLibraries = async () => {
        await scheduler.refreshScanSchedule().catch((error) => {
            logger.warn?.(`[media-automation] scan schedule refresh failed: ${error.message}`);
        });
        // Never let watcher setup (large remote mounts) fail library CRUD.
        return watcher.reload().catch((error) => {
            logger.warn?.(`[media-automation] watcher reload failed: ${error.message}`);
            return { watching: false, roots: [], error: error.message };
        });
    };

    const api = {
        start,
        stop,
        status,
        scanNow,
        cancelScan,
        processNow: processor.processOne,
        enqueuePath: processor.enqueuePath,
        cancelJob: processor.cancel,
        estimate: processor.estimate,
        analyze: processor.analyze,
        cancelJobs: processor.cancelMany,
        removeJobs: queue.removeMany,
        retryJobs: queue.retryMany,
        retryJob: queue.retry,
        setJobPriority: queue.setPriority,
        skipJob: queue.skip,
        listJobs: queue.list,
        getJob: async (id) => {
            const live = await queue.get(id);
            if (live) return live;
            const archived = await history.get(id);
            return historyEntryToJob(archived);
        },
        pruneJobs: queue.prune,
        queue,
        libraries,
        pipelines,
        activity,
        history,
        scanHistory,
        plugins: registry,
        listActivity: activity.list,
        listHistory: history.list,
        historyAggregates: history.aggregates,
        historyTotals: history.totals,
        clearHistory: history.clear,
        listScanHistory: scanHistory.list,
        recordActivity: activity.append,
        processor,
        scheduler,
        watcher,
        reloadLibraries,
        store,
    };
    return api;
};

export default createMediaAutomation;
