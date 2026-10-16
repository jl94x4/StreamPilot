import path from 'path';
import chokidar from 'chokidar';

const normalizeExtension = (filePath, extensions) => {
    const ext = path.extname(String(filePath || '')).toLowerCase();
    return extensions.has(ext);
};

/**
 * Watch enabled library roots and enqueue matching media files.
 * Prefer scheduled Scan now / ARR webhooks on large Unraid or remote mounts.
 */
export const createMediaLibraryWatcher = ({
    getConfig,
    listLibraries,
    enqueuePath,
    onActivity,
    logger = console,
} = {}) => {
    if (typeof getConfig !== 'function' || typeof listLibraries !== 'function' || typeof enqueuePath !== 'function') {
        throw new Error('getConfig, listLibraries, and enqueuePath are required');
    }

    let watcher = null;
    let stopped = true;
    let starting = null;
    const pending = new Map();
    let debounceMs = 5000;

    const clearPending = () => {
        for (const timer of pending.values()) clearTimeout(timer);
        pending.clear();
    };

    const closeWatcher = async () => {
        if (!watcher) return;
        const current = watcher;
        watcher = null;
        await current.close().catch(() => {});
    };

    const handleFile = (filePath) => {
        const resolved = path.resolve(String(filePath || ''));
        if (!resolved) return;
        if (pending.has(resolved)) clearTimeout(pending.get(resolved));
        pending.set(resolved, setTimeout(async () => {
            pending.delete(resolved);
            try {
                const settings = await getConfig();
                if (!settings.enabled || settings.libraryWatchEnabled !== true) return;
                const extensions = new Set(
                    (settings.extensions || []).map((entry) => String(entry || '').toLowerCase()),
                );
                if (!normalizeExtension(resolved, extensions)) return;
                const libraries = await listLibraries();
                const library = libraries
                    .filter((entry) => entry?.enabled !== false && entry?.rootPath)
                    .map((entry) => ({
                        ...entry,
                        rootPath: path.resolve(entry.rootPath),
                    }))
                    .filter((entry) => resolved === entry.rootPath || resolved.startsWith(`${entry.rootPath}${path.sep}`))
                    .sort((a, b) => b.rootPath.length - a.rootPath.length)[0];
                if (!library) return;
                const result = await enqueuePath(resolved, {
                    libraryId: library.id,
                    libraryRoot: library.rootPath,
                    pipelineId: library.pipelineId,
                    metadata: { source: 'library.watch' },
                });
                if (result?.enqueued) {
                    await onActivity?.({
                        type: 'library.watch.enqueued',
                        jobId: result.job?.id,
                        message: `Watcher queued ${path.basename(resolved)}`,
                        data: { path: resolved, libraryId: library.id },
                    });
                }
            } catch (error) {
                logger.warn?.(`[media-automation] watch enqueue failed for ${resolved}: ${error.message}`);
                await onActivity?.({
                    type: 'library.watch.error',
                    message: `Watcher failed for ${path.basename(resolved)}: ${error.message}`,
                    data: { path: resolved, error: error.message },
                }).catch(() => {});
            }
        }, debounceMs));
        pending.get(resolved)?.unref?.();
    };

    const stop = async () => {
        stopped = true;
        clearPending();
        const inFlight = starting;
        starting = null;
        if (inFlight) {
            try { await inFlight; } catch { /* ignore */ }
        }
        await closeWatcher();
    };

    const start = async () => {
        if (starting) return starting;
        starting = (async () => {
            try {
                const settings = await getConfig();
                debounceMs = Math.max(500, Number(settings.libraryWatchDebounceMs) || 5000);
                clearPending();
                await closeWatcher();
                stopped = false;
                if (!settings.enabled || settings.libraryWatchEnabled !== true) {
                    return { watching: false, roots: [] };
                }
                const libraries = await listLibraries();
                const roots = [...new Set(
                    libraries
                        .filter((entry) => entry?.enabled !== false && entry?.rootPath)
                        .map((entry) => path.resolve(entry.rootPath)),
                )];
                if (!roots.length) {
                    return { watching: false, roots: [] };
                }
                const usePolling = settings.libraryWatchUsePolling !== false;
                const interval = Math.max(2000, Number(settings.libraryWatchPollIntervalMs) || 15_000);
                // In polling mode chokidar keeps a per-path stat cache for every watched entry,
                // re-stat'd every `interval`. On large libraries most of those paths are never
                // going to match a media extension (posters, .nfo, subtitles, samples, extras),
                // so excluding them here — not just later in handleFile — keeps that cache (and
                // the RSS it holds onto) proportional to the actual media file count instead of
                // every file under the watched roots.
                const watchExtensions = new Set(
                    (settings.extensions || []).map((entry) => String(entry || '').toLowerCase()),
                );
                const next = chokidar.watch(roots, {
                    ignoreInitial: true,
                    followSymlinks: false,
                    ignorePermissionErrors: true,
                    awaitWriteFinish: {
                        stabilityThreshold: Math.min(debounceMs, 2000),
                        pollInterval: 250,
                    },
                    usePolling,
                    interval: usePolling ? interval : undefined,
                    binaryInterval: usePolling ? interval : undefined,
                    ignored: (filePath, stats) => {
                        const base = path.basename(String(filePath || ''));
                        if (base.startsWith('.') || base.endsWith('.partial') || base.endsWith('.tmp')) return true;
                        if (!watchExtensions.size) return false;
                        // chokidar calls this once without `stats` (path-only pre-filter) and again
                        // once the entry has been stat'd. Never reject before we know it isn't a
                        // directory — extension-filtering a directory would stop chokidar descending
                        // into it and silently hide every media file underneath.
                        if (!stats || !stats.isFile()) return false;
                        return !normalizeExtension(filePath, watchExtensions);
                    },
                });
                next.on('add', handleFile);
                next.on('change', handleFile);
                next.on('error', (error) => {
                    logger.warn?.(`[media-automation] watcher error: ${error.message}`);
                    void onActivity?.({
                        type: 'library.watch.error',
                        message: `Watcher error: ${error.message}`,
                        data: { error: error.message },
                    }).catch(() => {});
                });
                if (stopped) {
                    await next.close().catch(() => {});
                    return { watching: false, roots: [] };
                }
                watcher = next;
                logger.info?.(
                    `[media-automation] watching ${roots.length} root(s)${usePolling ? ` (polling ${interval}ms)` : ''}`,
                );
                return { watching: true, roots, usePolling, interval };
            } catch (error) {
                watcher = null;
                logger.warn?.(`[media-automation] watcher failed to start: ${error.message}`);
                await onActivity?.({
                    type: 'library.watch.error',
                    message: `Watcher failed to start: ${error.message}`,
                    data: { error: error.message },
                }).catch(() => {});
                return { watching: false, roots: [], error: error.message };
            } finally {
                starting = null;
            }
        })();
        return starting;
    };

    const reload = async () => start();

    const status = () => ({
        watching: !stopped && !!watcher,
        pending: pending.size,
        roots: watcher
            ? [...(watcher.getWatched?.() ? Object.keys(watcher.getWatched()) : [])]
            : [],
    });

    return { start, stop, reload, status };
};

export default createMediaLibraryWatcher;
