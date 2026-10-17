/**
 * Resumable clearlogo coverage scan for movie + show libraries.
 */

import { createPlexMetadataClient } from './plexWrite.js';
import { pickBestClearLogoCandidate } from './clearlogoDetect.js';
import {
    MAX_CLEARLOGO_PREVIEW,
    appendMetadataFillLog,
    readClearlogoScanState,
    writeClearlogoScanState,
} from './store.js';

let running = false;
let cancelFlag = false;

const emptyStats = () => ({
    scanned: 0,
    hasLogo: 0,
    available: 0,
    none: 0,
    applied: 0,
    skipped: 0,
    failed: 0,
});

const bump = (stats, key, n = 1) => {
    stats[key] = (Number(stats[key]) || 0) + n;
};

const isCancelRequested = (state = null) => (
    cancelFlag || !!(state && state.cancelRequested)
);

const persistProgress = async (patch = {}) => {
    const latest = await readClearlogoScanState();
    const cancelled = isCancelRequested(latest);
    const next = await writeClearlogoScanState({
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

const previewThumbCandidates = (candidates = [], limit = 4) => (
    (Array.isArray(candidates) ? candidates : [])
        .slice(0, limit)
        .map((row) => ({
            ratingKey: row.ratingKey,
            provider: row.provider || '',
            thumb: row.thumb || '',
            selected: !!row.selected,
        }))
);

export const getClearlogoScanStatus = async () => {
    const state = await readClearlogoScanState();
    return {
        ...state,
        inProcess: running,
        cancelRequested: isCancelRequested(state),
    };
};

export const cancelClearlogoScan = async () => {
    cancelFlag = true;
    const state = await readClearlogoScanState();
    if (!running && state.status !== 'running') {
        return { ok: true, status: state.status, message: 'Clearlogo scan is not running.' };
    }
    const next = await writeClearlogoScanState({
        ...state,
        cancelRequested: true,
    });
    return { ok: true, status: next.status, cancelRequested: true };
};

export const startClearlogoScan = async ({
    baseUrl,
    token,
    rewrite = [],
    dryRun = true,
    resume = false,
    libraryKeys = null,
    fetchImpl = fetch,
} = {}) => {
    if (running) {
        const state = await readClearlogoScanState();
        return { ok: false, reason: 'already-running', state };
    }

    let state = await readClearlogoScanState();
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

    state = await writeClearlogoScanState(state);
    cancelFlag = false;
    running = true;

    void runClearlogoScanLoop({
        baseUrl,
        token,
        rewrite,
        fetchImpl,
    }).catch(async (error) => {
        running = false;
        cancelFlag = false;
        const cur = await readClearlogoScanState();
        await writeClearlogoScanState({
            ...cur,
            status: 'interrupted',
            error: error?.message || String(error),
        });
    });

    return { ok: true, started: true, resumed: !!canResume, state };
};

const runClearlogoScanLoop = async ({
    baseUrl,
    token,
    rewrite,
    fetchImpl,
}) => {
    const plex = createPlexMetadataClient({ baseUrl, token, fetchImpl, rewrite });
    let state = await readClearlogoScanState();

    try {
        if (!state.libraries?.length) {
            let libraries = await plex.listMovieAndShowLibraries();
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
            const mediaType = String(lib?.type || '') === 'show' ? 'show' : 'movie';
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
                    mediaType,
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
                    try {
                        const coverage = await plex.inspectClearLogoCoverage(item.ratingKey, {
                            type: mediaType,
                        });
                        bump(stats, coverage.status === 'hasLogo'
                            ? 'hasLogo'
                            : (coverage.status === 'available' ? 'available' : 'none'));

                        if (coverage.status === 'available' || coverage.status === 'none') {
                            const best = coverage.status === 'available'
                                ? pickBestClearLogoCandidate(coverage.candidates)
                                : null;
                            const row = {
                                ratingKey: String(item.ratingKey),
                                title: String(item.title || ''),
                                year: item.year || null,
                                type: mediaType,
                                libraryKey: String(lib.key),
                                libraryTitle,
                                thumb: item.thumb || null,
                                status: coverage.status,
                                candidateCount: coverage.count,
                                candidates: previewThumbCandidates(coverage.candidates),
                                bestCandidate: best
                                    ? {
                                        ratingKey: best.ratingKey,
                                        provider: best.provider || '',
                                        thumb: best.thumb || '',
                                    }
                                    : null,
                                applied: false,
                                dryRun: !!state.dryRun,
                            };
                            preview = [...preview, row].slice(-MAX_CLEARLOGO_PREVIEW);

                            if (state.dryRun === false && coverage.status === 'available' && best?.ratingKey) {
                                try {
                                    await plex.selectClearLogo(item.ratingKey, best.ratingKey, {
                                        type: mediaType,
                                        unlock: true,
                                    });
                                    bump(stats, 'applied');
                                    row.applied = true;
                                    row.status = 'applied';
                                    await appendMetadataFillLog({
                                        ok: true,
                                        kind: 'clearlogo',
                                        ratingKey: item.ratingKey,
                                        title: item.title,
                                        libraryTitle,
                                        type: mediaType,
                                        dryRun: false,
                                        candidate: best.ratingKey,
                                        provider: best.provider || '',
                                    });
                                } catch (applyError) {
                                    bump(stats, 'failed');
                                    row.error = applyError?.message || String(applyError);
                                    await appendMetadataFillLog({
                                        ok: false,
                                        kind: 'clearlogo',
                                        ratingKey: item.ratingKey,
                                        title: item.title,
                                        libraryTitle,
                                        type: mediaType,
                                        error: row.error,
                                    });
                                }
                            }
                        }
                    } catch (error) {
                        bump(stats, 'failed');
                        preview = [...preview, {
                            ratingKey: String(item.ratingKey || ''),
                            title: String(item.title || ''),
                            year: item.year || null,
                            type: mediaType,
                            libraryKey: String(lib.key),
                            libraryTitle,
                            status: 'failed',
                            candidateCount: 0,
                            candidates: [],
                            error: error?.message || String(error),
                        }].slice(-MAX_CLEARLOGO_PREVIEW);
                    }

                    const tick = await persistProgress({
                        status: 'running',
                        stats: { ...stats },
                        preview,
                        cursor: {
                            libraryIndex,
                            itemStart,
                            libraryTitle,
                            title: item.title,
                        },
                    });
                    state = tick.state;
                    if (tick.cancelled) {
                        running = false;
                        cancelFlag = false;
                        return;
                    }
                }

                itemStart += items.length;
                if (itemStart >= (Number(page.totalSize) || 0) || items.length < pageSize) {
                    break;
                }
            }

            itemStart = 0;
        }

        await persistProgress({
            status: 'done',
            stats,
            preview,
            cursor: { libraryIndex: libraries.length, itemStart: 0 },
            finishedAt: new Date().toISOString(),
            cancelRequested: false,
        });
    } catch (error) {
        const cur = await readClearlogoScanState();
        await writeClearlogoScanState({
            ...cur,
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
 * Apply clearlogos for preview rows (or explicit ratingKeys) that are still `available`.
 */
export const applyClearlogoScanPreview = async ({
    baseUrl,
    token,
    rewrite = [],
    ratingKeys = null,
    fetchImpl = fetch,
} = {}) => {
    const plex = createPlexMetadataClient({ baseUrl, token, fetchImpl, rewrite });
    const state = await readClearlogoScanState();
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
        const type = String(row.type || '') === 'show' ? 'show' : 'movie';
        const logoKey = String(row.bestCandidate?.ratingKey || '').trim();
        try {
            let candidateKey = logoKey;
            if (!candidateKey) {
                const coverage = await plex.inspectClearLogoCoverage(key, { type });
                const best = pickBestClearLogoCandidate(coverage.candidates);
                candidateKey = best?.ratingKey || '';
            }
            if (!candidateKey) {
                bump(stats, 'skipped');
                results.push({ ratingKey: key, ok: true, skipped: true, reason: 'no-candidates' });
                continue;
            }
            await plex.selectClearLogo(key, candidateKey, { type, unlock: true });
            bump(stats, 'applied');
            bump(stats, 'available', -1);
            bump(stats, 'hasLogo');
            const idx = preview.findIndex((p) => String(p.ratingKey) === key);
            if (idx >= 0) {
                preview[idx] = {
                    ...preview[idx],
                    status: 'applied',
                    applied: true,
                    error: null,
                };
            }
            await appendMetadataFillLog({
                ok: true,
                kind: 'clearlogo',
                ratingKey: key,
                title: row.title,
                libraryTitle: row.libraryTitle,
                type,
                dryRun: false,
                candidate: candidateKey,
            });
            results.push({ ratingKey: key, ok: true, applied: true, candidate: candidateKey });
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
                kind: 'clearlogo',
                ratingKey: key,
                title: row.title,
                error: error?.message || String(error),
            });
            results.push({
                ratingKey: key,
                ok: false,
                error: error?.message || String(error),
            });
        }
    }

    // Clamp available after decrements.
    stats.available = Math.max(0, Number(stats.available) || 0);

    const next = await writeClearlogoScanState({
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
