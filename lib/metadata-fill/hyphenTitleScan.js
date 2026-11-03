/**
 * Resumable Plex ↔ TMDB hyphen-title movie scan.
 * Only rewrites locked titles when TMDB’s title contains '-' and differs from Plex.
 */

import { createTmdbClient } from '../portal-request/tmdbClient.js';
import { needsHyphenTitleFix } from './hyphenTitleDetect.js';
import { createPlexMetadataClient, extractTmdbIdFromPlexMeta } from './plexWrite.js';
import {
    appendMetadataFillLog,
    readHyphenTitleScanState,
    retainHyphenTitlePreview,
    writeHyphenTitleScanState,
} from './store.js';

let running = false;
let cancelFlag = false;

const emptyStats = () => ({
    scanned: 0,
    available: 0,
    matched: 0,
    skipped: 0,
    applied: 0,
    failed: 0,
    noTmdbId: 0,
});

const bump = (stats, key, n = 1) => {
    stats[key] = (Number(stats[key]) || 0) + n;
};

const isCancelRequested = (state = null) => (
    cancelFlag || !!(state && state.cancelRequested)
);

const persistProgress = async (patch = {}) => {
    const latest = await readHyphenTitleScanState();
    const cancelled = isCancelRequested(latest);
    const next = await writeHyphenTitleScanState({
        ...latest,
        ...patch,
        preview: patch.preview !== undefined ? patch.preview : latest.preview,
        stats: patch.stats !== undefined ? patch.stats : latest.stats,
        cursor: patch.cursor !== undefined ? patch.cursor : latest.cursor,
        cancelRequested: cancelled || !!patch.cancelRequested,
        status: cancelled ? 'cancelled' : (patch.status || latest.status || 'running'),
        finishedAt: cancelled
            ? (latest.finishedAt || patch.finishedAt || new Date().toISOString())
            : (patch.finishedAt !== undefined ? patch.finishedAt : latest.finishedAt),
    });
    return { state: next, cancelled };
};

const pushPreview = (preview, row) => retainHyphenTitlePreview([...(preview || []), row]);

export const getHyphenTitleScanStatus = async () => {
    const state = await readHyphenTitleScanState();
    return {
        ...state,
        inProcess: running,
        cancelRequested: isCancelRequested(state),
    };
};

export const cancelHyphenTitleScan = async () => {
    cancelFlag = true;
    const state = await readHyphenTitleScanState();
    if (!running && state.status !== 'running') {
        return { ok: true, status: state.status, message: 'Hyphen title scan is not running.' };
    }
    const next = await writeHyphenTitleScanState({
        ...state,
        cancelRequested: true,
    });
    return { ok: true, status: next.status, cancelRequested: true };
};

export const startHyphenTitleScan = async ({
    config = {},
    baseUrl,
    token,
    rewrite = [],
    dryRun = true,
    resume = false,
    libraryKeys = null,
    fetchImpl = fetch,
} = {}) => {
    if (running) {
        const state = await readHyphenTitleScanState();
        return { ok: false, reason: 'already-running', state };
    }

    if (!String(config.tmdbApiKey || '').trim()) {
        return { ok: false, reason: 'tmdb-not-configured', error: 'Configure a TMDB API key first.' };
    }

    let state = await readHyphenTitleScanState();
    const canResume = resume
        && state.cursor
        && (state.status === 'interrupted' || state.status === 'cancelled' || state.status === 'running');

    const selectedKeys = Array.isArray(libraryKeys) && libraryKeys.length
        ? libraryKeys.map((k) => String(k).replace(/\D/g, '')).filter(Boolean)
        : (Array.isArray(state.selectedLibraryKeys) ? state.selectedLibraryKeys : []);

    if (!canResume) {
        state = {
            status: 'running',
            dryRun: !!dryRun,
            cancelRequested: false,
            cursor: { libraryIndex: 0, itemStart: 0 },
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

    state = await writeHyphenTitleScanState(state);
    cancelFlag = false;
    running = true;

    void runHyphenTitleScanLoop({
        config,
        baseUrl,
        token,
        rewrite,
        fetchImpl,
    }).catch(async (error) => {
        running = false;
        cancelFlag = false;
        const cur = await readHyphenTitleScanState();
        await writeHyphenTitleScanState({
            ...cur,
            status: 'interrupted',
            error: error?.message || String(error),
        });
    });

    return { ok: true, started: true, resumed: !!canResume, state };
};

const resolveTmdbTitle = async (tmdb, tmdbId, cache) => {
    const id = String(tmdbId || '').trim();
    if (!id) return null;
    if (cache.has(id)) return cache.get(id);
    try {
        const details = await tmdb.movie(id, { appendToResponse: 'external_ids' });
        const title = String(details?.title || '').trim() || null;
        cache.set(id, title);
        return title;
    } catch {
        cache.set(id, null);
        return null;
    }
};

const runHyphenTitleScanLoop = async ({
    config,
    baseUrl,
    token,
    rewrite,
    fetchImpl,
}) => {
    const plex = createPlexMetadataClient({ baseUrl, token, fetchImpl, rewrite });
    const tmdb = createTmdbClient({ tmdbApiKey: config.tmdbApiKey, fetchImpl });
    const tmdbCache = new Map();
    let state = await readHyphenTitleScanState();

    try {
        if (!state.libraries?.length) {
            let libraries = await plex.listMovieLibraries();
            const selected = Array.isArray(state.selectedLibraryKeys)
                ? state.selectedLibraryKeys.map((k) => String(k).replace(/\D/g, '')).filter(Boolean)
                : [];
            if (selected.length) {
                libraries = libraries.filter((lib) => selected.includes(String(lib.key).replace(/\D/g, '')));
            }
            state.libraries = libraries;
            const persisted = await persistProgress({
                libraries,
                cursor: state.cursor || { libraryIndex: 0, itemStart: 0 },
            });
            state = persisted.state;
            if (persisted.cancelled) {
                running = false;
                cancelFlag = false;
                return;
            }
        }

        const libraries = Array.isArray(state.libraries) ? state.libraries : [];
        let libraryIndex = Number(state.cursor?.libraryIndex) || 0;
        let itemStart = Number(state.cursor?.itemStart) || 0;
        const pageSize = 40;
        const stats = { ...emptyStats(), ...(state.stats || {}) };
        let preview = Array.isArray(state.preview) ? [...state.preview] : [];

        for (; libraryIndex < libraries.length; libraryIndex += 1) {
            if (isCancelRequested(state)) {
                await persistProgress({
                    status: 'cancelled',
                    cancelRequested: true,
                    stats,
                    preview,
                    cursor: { libraryIndex, itemStart },
                    finishedAt: new Date().toISOString(),
                });
                running = false;
                cancelFlag = false;
                return;
            }

            const lib = libraries[libraryIndex];
            const libraryTitle = String(lib?.title || lib?.key || '');

            while (true) {
                if (isCancelRequested()) {
                    await persistProgress({
                        status: 'cancelled',
                        cancelRequested: true,
                        stats,
                        preview,
                        cursor: { libraryIndex, itemStart },
                        finishedAt: new Date().toISOString(),
                    });
                    running = false;
                    cancelFlag = false;
                    return;
                }

                const page = await plex.listLibraryTitles(lib.key, {
                    mediaType: 'movie',
                    start: itemStart,
                    size: pageSize,
                });
                const items = Array.isArray(page.items) ? page.items : [];
                if (!items.length) break;

                for (const item of items) {
                    if (isCancelRequested()) {
                        await persistProgress({
                            status: 'cancelled',
                            cancelRequested: true,
                            stats,
                            preview,
                            cursor: { libraryIndex, itemStart },
                            finishedAt: new Date().toISOString(),
                        });
                        running = false;
                        cancelFlag = false;
                        return;
                    }

                    bump(stats, 'scanned');
                    const plexTitle = String(item.title || '');
                    let tmdbId = String(item.tmdbId || '').trim() || null;
                    if (!tmdbId && item.ratingKey) {
                        try {
                            const meta = await plex.getMetadata(item.ratingKey);
                            tmdbId = extractTmdbIdFromPlexMeta(meta);
                        } catch {
                            tmdbId = null;
                        }
                    }

                    if (!tmdbId) {
                        bump(stats, 'noTmdbId');
                        bump(stats, 'skipped');
                        preview = pushPreview(preview, {
                            ratingKey: String(item.ratingKey),
                            plexTitle,
                            tmdbTitle: null,
                            tmdbId: null,
                            year: item.year || null,
                            thumb: item.thumb || null,
                            libraryKey: String(lib.key),
                            libraryTitle,
                            status: 'noTmdbId',
                            applied: false,
                            dryRun: !!state.dryRun,
                        });
                        continue;
                    }

                    const tmdbTitle = await resolveTmdbTitle(tmdb, tmdbId, tmdbCache);
                    if (!tmdbTitle) {
                        bump(stats, 'skipped');
                        preview = pushPreview(preview, {
                            ratingKey: String(item.ratingKey),
                            plexTitle,
                            tmdbTitle: null,
                            tmdbId,
                            year: item.year || null,
                            thumb: item.thumb || null,
                            libraryKey: String(lib.key),
                            libraryTitle,
                            status: 'skipped',
                            reason: 'tmdb-fetch-failed',
                            applied: false,
                            dryRun: !!state.dryRun,
                        });
                        continue;
                    }

                    const verdict = needsHyphenTitleFix({ plexTitle, tmdbTitle });
                    if (!verdict.needs) {
                        bump(stats, 'matched');
                        // Only sample matched rows that actually have a hyphen on TMDB
                        // (interesting “already fixed”) — otherwise skip storing most matches.
                        if (String(tmdbTitle).includes('-')) {
                            preview = pushPreview(preview, {
                                ratingKey: String(item.ratingKey),
                                plexTitle,
                                tmdbTitle,
                                tmdbId,
                                year: item.year || null,
                                thumb: item.thumb || null,
                                libraryKey: String(lib.key),
                                libraryTitle,
                                status: 'matched',
                                applied: false,
                                dryRun: !!state.dryRun,
                            });
                        }
                        continue;
                    }

                    bump(stats, 'available');
                    const row = {
                        ratingKey: String(item.ratingKey),
                        plexTitle,
                        tmdbTitle,
                        tmdbId,
                        year: item.year || null,
                        thumb: item.thumb || null,
                        libraryKey: String(lib.key),
                        libraryTitle,
                        status: 'available',
                        applied: false,
                        dryRun: !!state.dryRun,
                    };
                    preview = pushPreview(preview, row);

                    if (state.dryRun === false) {
                        try {
                            await plex.writeMovieTitle(item.ratingKey, tmdbTitle, { lock: true });
                            bump(stats, 'applied');
                            bump(stats, 'available', -1);
                            bump(stats, 'matched');
                            row.applied = true;
                            row.status = 'applied';
                            preview = pushPreview(
                                preview.filter((p) => String(p.ratingKey) !== String(item.ratingKey)),
                                row,
                            );
                            await appendMetadataFillLog({
                                ok: true,
                                kind: 'hyphen-title',
                                ratingKey: String(item.ratingKey),
                                title: tmdbTitle,
                                plexTitle,
                                tmdbTitle,
                                tmdbId,
                                libraryTitle,
                                dryRun: false,
                            });
                        } catch (error) {
                            bump(stats, 'failed');
                            row.status = 'failed';
                            row.error = error?.message || String(error);
                            preview = pushPreview(
                                preview.filter((p) => String(p.ratingKey) !== String(item.ratingKey)),
                                row,
                            );
                            await appendMetadataFillLog({
                                ok: false,
                                kind: 'hyphen-title',
                                ratingKey: String(item.ratingKey),
                                title: plexTitle,
                                tmdbTitle,
                                error: error?.message || String(error),
                            });
                        }
                    }
                }

                itemStart += items.length;
                const persisted = await persistProgress({
                    stats,
                    preview,
                    cursor: {
                        libraryIndex,
                        itemStart,
                        libraryTitle,
                        title: items[items.length - 1]?.title || null,
                    },
                });
                state = persisted.state;
                if (persisted.cancelled) {
                    running = false;
                    cancelFlag = false;
                    return;
                }
                if (items.length < pageSize) break;
            }

            itemStart = 0;
        }

        stats.available = Math.max(0, Number(stats.available) || 0);
        await persistProgress({
            status: 'done',
            stats,
            preview,
            cursor: null,
            finishedAt: new Date().toISOString(),
        });
    } catch (error) {
        await persistProgress({
            status: 'interrupted',
            error: error?.message || String(error),
            finishedAt: new Date().toISOString(),
        });
        throw error;
    } finally {
        running = false;
        cancelFlag = false;
    }
};

/**
 * Apply TMDB hyphen titles for preview rows (or explicit ratingKeys) that are still `available`.
 */
export const applyHyphenTitleScanPreview = async ({
    baseUrl,
    token,
    rewrite = [],
    ratingKeys = null,
    fetchImpl = fetch,
} = {}) => {
    const plex = createPlexMetadataClient({ baseUrl, token, fetchImpl, rewrite });
    const state = await readHyphenTitleScanState();
    const want = Array.isArray(ratingKeys) && ratingKeys.length
        ? new Set(ratingKeys.map((k) => String(k).replace(/\D/g, '')).filter(Boolean))
        : null;
    const rows = (Array.isArray(state.preview) ? state.preview : [])
        .filter((row) => row?.status === 'available' && !row?.applied)
        .filter((row) => (!want || want.has(String(row.ratingKey || '').replace(/\D/g, ''))));

    const results = [];
    const stats = { ...emptyStats(), ...(state.stats || {}) };
    const preview = (Array.isArray(state.preview) ? state.preview : []).map((row) => ({ ...row }));

    for (const row of rows) {
        const key = String(row.ratingKey || '').replace(/\D/g, '');
        const tmdbTitle = String(row.tmdbTitle || '').trim();
        if (!key || !tmdbTitle) {
            bump(stats, 'skipped');
            results.push({ ratingKey: key, ok: true, skipped: true, reason: 'missing-title' });
            continue;
        }
        try {
            await plex.writeMovieTitle(key, tmdbTitle, { lock: true });
            bump(stats, 'applied');
            bump(stats, 'available', -1);
            bump(stats, 'matched');
            const idx = preview.findIndex((p) => String(p.ratingKey) === key);
            if (idx >= 0) {
                preview[idx] = {
                    ...preview[idx],
                    status: 'applied',
                    applied: true,
                    plexTitle: tmdbTitle,
                    error: null,
                };
            }
            await appendMetadataFillLog({
                ok: true,
                kind: 'hyphen-title',
                ratingKey: key,
                title: tmdbTitle,
                plexTitle: row.plexTitle,
                tmdbTitle,
                tmdbId: row.tmdbId,
                libraryTitle: row.libraryTitle,
                dryRun: false,
            });
            results.push({ ratingKey: key, ok: true, applied: true, title: tmdbTitle });
        } catch (error) {
            bump(stats, 'failed');
            const idx = preview.findIndex((p) => String(p.ratingKey) === key);
            if (idx >= 0) {
                preview[idx] = {
                    ...preview[idx],
                    error: error?.message || String(error),
                };
            }
            await appendMetadataFillLog({
                ok: false,
                kind: 'hyphen-title',
                ratingKey: key,
                title: row.plexTitle,
                tmdbTitle,
                error: error?.message || String(error),
            });
            results.push({
                ratingKey: key,
                ok: false,
                error: error?.message || String(error),
            });
        }
    }

    stats.available = Math.max(0, Number(stats.available) || 0);

    const next = await writeHyphenTitleScanState({
        ...state,
        stats,
        preview,
    });

    return {
        ok: true,
        applied: results.filter((r) => r.applied).length,
        failed: results.filter((r) => r.ok === false).length,
        skipped: results.filter((r) => r.skipped).length,
        results,
        scan: next,
    };
};
