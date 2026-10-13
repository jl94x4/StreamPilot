/**
 * Resumable library-wide Metadata Fill scan (manual start).
 */

import { createPlexMetadataClient } from './plexWrite.js';
import { fillOneEpisode } from './job.js';
import {
    MAX_SCAN_PREVIEW,
    readLibraryScanState,
    writeLibraryScanState,
} from './store.js';
import { getMetadataFillOptions } from './settings.js';

let running = false;

const emptyStats = () => ({
    scanned: 0,
    needingFill: 0,
    previewed: 0,
    filled: 0,
    skipped: 0,
    failed: 0,
});

export const getLibraryScanStatus = async () => {
    const state = await readLibraryScanState();
    return { ...state, inProcess: running };
};

export const cancelLibraryScan = async () => {
    const state = await readLibraryScanState();
    if (state.status !== 'running') {
        return { ok: true, status: state.status, message: 'Scan is not running.' };
    }
    const next = await writeLibraryScanState({
        ...state,
        cancelRequested: true,
    });
    return { ok: true, status: next.status, cancelRequested: true };
};

const bump = (stats, key, n = 1) => {
    stats[key] = (Number(stats[key]) || 0) + n;
};

/**
 * Start or resume a library scan. Returns immediately; work continues in-process.
 */
export const startLibraryScan = async ({
    config,
    baseUrl,
    token,
    rewrite = [],
    dryRun = true,
    resume = false,
    libraryKeys = null,
    fetchImpl = fetch,
} = {}) => {
    if (running) {
        const state = await readLibraryScanState();
        return { ok: false, reason: 'already-running', state };
    }

    let state = await readLibraryScanState();
    const canResume = resume
        && state.cursor
        && (state.status === 'interrupted' || state.status === 'cancelled' || state.status === 'running');

    const options = getMetadataFillOptions(config);
    const selectedKeys = Array.isArray(libraryKeys) && libraryKeys.length
        ? libraryKeys.map((k) => String(k).replace(/\D/g, '')).filter(Boolean)
        : options.libraryKeys;

    if (!canResume) {
        state = {
            status: 'running',
            dryRun: !!dryRun,
            cancelRequested: false,
            cursor: { libraryIndex: 0, showStart: 0, showRatingKey: null, episodeIndex: 0 },
            stats: emptyStats(),
            preview: [],
            libraries: [],
            selectedLibraryKeys: selectedKeys,
            startedAt: new Date().toISOString(),
            finishedAt: null,
            error: null,
            updatedAt: null,
        };
    } else {
        state = {
            ...state,
            status: 'running',
            dryRun: dryRun !== undefined ? !!dryRun : !!state.dryRun,
            cancelRequested: false,
            finishedAt: null,
            error: null,
        };
    }

    state = await writeLibraryScanState(state);
    running = true;

    void runLibraryScanLoop({
        config,
        baseUrl,
        token,
        rewrite,
        fetchImpl,
    }).catch(async (error) => {
        running = false;
        const cur = await readLibraryScanState();
        await writeLibraryScanState({
            ...cur,
            status: 'interrupted',
            error: error?.message || String(error),
        });
    });

    return { ok: true, started: true, resumed: !!canResume, state };
};

const runLibraryScanLoop = async ({
    config,
    baseUrl,
    token,
    rewrite,
    fetchImpl,
}) => {
    const plex = createPlexMetadataClient({ baseUrl, token, fetchImpl, rewrite });
    let state = await readLibraryScanState();

    try {
        if (!state.libraries?.length) {
            let libraries = await plex.listTvLibraries();
            const selected = Array.isArray(state.selectedLibraryKeys)
                ? state.selectedLibraryKeys.map((k) => String(k).replace(/\D/g, '')).filter(Boolean)
                : [];
            if (selected.length) {
                const want = new Set(selected);
                libraries = libraries.filter((lib) => want.has(String(lib.key).replace(/\D/g, '')));
            }
            state.libraries = libraries;
            state = await writeLibraryScanState(state);
        }

        const cursor = state.cursor || {
            libraryIndex: 0,
            showStart: 0,
            showRatingKey: null,
            episodeIndex: 0,
        };

        for (let li = cursor.libraryIndex || 0; li < state.libraries.length; li += 1) {
            state = await readLibraryScanState();
            if (state.cancelRequested) {
                await writeLibraryScanState({
                    ...state,
                    status: 'cancelled',
                    cursor: { ...cursor, libraryIndex: li },
                    finishedAt: new Date().toISOString(),
                });
                running = false;
                return;
            }

            const library = state.libraries[li];
            let showStart = li === (cursor.libraryIndex || 0) ? (cursor.showStart || 0) : 0;
            let pageSize = 40;

            while (true) {
                state = await readLibraryScanState();
                if (state.cancelRequested) {
                    await writeLibraryScanState({
                        ...state,
                        status: 'cancelled',
                        cursor: {
                            libraryIndex: li,
                            showStart,
                            showRatingKey: null,
                            episodeIndex: 0,
                        },
                        finishedAt: new Date().toISOString(),
                    });
                    running = false;
                    return;
                }

                const page = await plex.listLibraryShows(library.key, {
                    start: showStart,
                    size: pageSize,
                });
                if (!page.items.length) break;

                for (let si = 0; si < page.items.length; si += 1) {
                    const show = page.items[si];
                    const absoluteShowStart = showStart + si;

                    // Resume mid-show if we were interrupted on this show.
                    let episodeStart = 0;
                    if (
                        li === (cursor.libraryIndex || 0)
                        && absoluteShowStart === (cursor.showStart || 0)
                        && String(cursor.showRatingKey || '') === String(show.ratingKey)
                    ) {
                        episodeStart = Number(cursor.episodeIndex) || 0;
                    } else if (
                        li === (cursor.libraryIndex || 0)
                        && absoluteShowStart < (cursor.showStart || 0)
                    ) {
                        continue;
                    }

                    state = await readLibraryScanState();
                    if (state.cancelRequested) {
                        await writeLibraryScanState({
                            ...state,
                            status: 'cancelled',
                            cursor: {
                                libraryIndex: li,
                                showStart: absoluteShowStart,
                                showRatingKey: show.ratingKey,
                                episodeIndex: episodeStart,
                            },
                            finishedAt: new Date().toISOString(),
                        });
                        running = false;
                        return;
                    }

                    const episodes = await plex.listShowEpisodes(show.ratingKey, {
                        needingFillOnly: true,
                    });
                    const stats = { ...(state.stats || emptyStats()) };

                    for (let ei = episodeStart; ei < episodes.length; ei += 1) {
                        const episode = episodes[ei];
                        bump(stats, 'scanned');
                        bump(stats, 'needingFill');

                        try {
                            const result = await fillOneEpisode({
                                config,
                                plex,
                                episode,
                                source: state.dryRun ? 'library-scan-preview' : 'library-scan',
                                dryRun: !!state.dryRun,
                                enqueueRetry: !state.dryRun,
                                // Preview rows live on scan.preview; avoid flooding activity.json.
                                logActivity: !state.dryRun,
                            });
                            if (result?.dryRun) {
                                bump(stats, 'previewed');
                                const previewRow = {
                                    ratingKey: result.ratingKey,
                                    showTitle: result.showTitle || show.title,
                                    seasonNumber: result.seasonNumber,
                                    episodeNumber: result.episodeNumber,
                                    title: result.title,
                                    airDate: result.airDate,
                                    summaryWritten: result.summaryWritten,
                                    sources: result.sources,
                                    before: result.before,
                                    after: result.after,
                                    fields: result.fields,
                                };
                                state.preview = [...(state.preview || []), previewRow]
                                    .slice(-MAX_SCAN_PREVIEW);
                            } else if (result?.skipped) {
                                bump(stats, 'skipped');
                            } else if (result?.ok) {
                                bump(stats, 'filled');
                            } else {
                                bump(stats, 'failed');
                            }
                        } catch (error) {
                            bump(stats, 'failed');
                        }

                        state = await writeLibraryScanState({
                            ...state,
                            status: 'running',
                            stats,
                            cursor: {
                                libraryIndex: li,
                                showStart: absoluteShowStart,
                                showRatingKey: show.ratingKey,
                                episodeIndex: ei + 1,
                                libraryTitle: library.title,
                                showTitle: show.title,
                            },
                        });

                        // Yield so API can cancel / status can refresh.
                        await new Promise((r) => setTimeout(r, 0));

                        state = await readLibraryScanState();
                        if (state.cancelRequested) {
                            await writeLibraryScanState({
                                ...state,
                                status: 'cancelled',
                                finishedAt: new Date().toISOString(),
                            });
                            running = false;
                            return;
                        }
                    }

                    // Finished this show — advance cursor past it.
                    state = await writeLibraryScanState({
                        ...state,
                        cursor: {
                            libraryIndex: li,
                            showStart: absoluteShowStart + 1,
                            showRatingKey: null,
                            episodeIndex: 0,
                            libraryTitle: library.title,
                            showTitle: show.title,
                        },
                    });
                }

                showStart += page.items.length;
                if (showStart >= (page.totalSize || showStart)) break;
                if (page.items.length < pageSize) break;
            }

            // Next library
            cursor.libraryIndex = li + 1;
            cursor.showStart = 0;
            cursor.showRatingKey = null;
            cursor.episodeIndex = 0;
        }

        state = await readLibraryScanState();
        await writeLibraryScanState({
            ...state,
            status: 'completed',
            finishedAt: new Date().toISOString(),
            cancelRequested: false,
        });
    } catch (error) {
        const cur = await readLibraryScanState();
        await writeLibraryScanState({
            ...cur,
            status: 'interrupted',
            error: error?.message || String(error),
        });
        throw error;
    } finally {
        running = false;
    }
};

/**
 * Apply previously previewed (dry-run) rows by ratingKey.
 */
export const applyLibraryScanPreview = async ({
    config,
    baseUrl,
    token,
    rewrite = [],
    ratingKeys = null,
    fetchImpl = fetch,
} = {}) => {
    const state = await readLibraryScanState();
    const preview = Array.isArray(state.preview) ? state.preview : [];
    const want = Array.isArray(ratingKeys) && ratingKeys.length
        ? new Set(ratingKeys.map((k) => String(k)))
        : null;
    const targets = want
        ? preview.filter((row) => want.has(String(row.ratingKey)))
        : preview;
    if (!targets.length) {
        return { ok: false, reason: 'no-preview-rows', applied: 0 };
    }

    const plex = createPlexMetadataClient({ baseUrl, token, fetchImpl, rewrite });
    const results = [];
    for (const row of targets) {
        const episode = await plex.getMetadata(row.ratingKey).catch(() => null);
        if (!episode) {
            results.push({ ok: false, ratingKey: row.ratingKey, reason: 'episode-not-found' });
            continue;
        }
        try {
            results.push(await fillOneEpisode({
                config,
                plex,
                episode,
                source: 'library-scan-apply',
                dryRun: false,
            }));
        } catch (error) {
            results.push({
                ok: false,
                ratingKey: row.ratingKey,
                reason: error?.message || String(error),
            });
        }
    }

    return {
        ok: true,
        applied: results.filter((r) => r?.ok && !r.skipped).length,
        skipped: results.filter((r) => r?.skipped).length,
        failed: results.filter((r) => r && r.ok === false).length,
        results,
    };
};

/** @internal */
export const _resetLibraryScanForTests = () => {
    running = false;
};
