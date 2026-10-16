/**
 * Periodic Poster Sets watcher — re-scrape watched sets and enqueue new / newly-matched assets.
 */
import { loadPosterSetsConfig, posterSetsWatchProviderAllowed } from './config.js';
import { runPosterSetsCli } from './runner.js';
import { enqueuePosterSetsJob } from './queue.js';
import { appendPosterSetsAudit } from './audit.js';
import {
    listPosterSetsWatches,
    mergeLibraryHints,
    patchPosterSetsWatch,
    replaceSameTitleWatches,
    upsertPosterSetsWatch,
} from './watches.js';
import { setKindFromFilters } from './watchTitle.js';
import { libraryHintsFromAssets } from './title-watch.js';
import { explainPosterSetsPageError } from './upstreamErrors.js';
import { JOB_IDS, markJobComplete, markJobStart } from '../boot-schedule.js';

let watcherTimer = null;
let watcherBusy = false;
let enqueueApplyFn = null;
let notifyDigestFn = null;
/** Live status for Check-all / periodic passes (surfaced in Logs + API). */
let watcherPassStatus = {
    running: false,
    startedAt: null,
    finishedAt: null,
    lastProgressAt: null,
    total: 0,
    checked: 0,
    queued: 0,
    assetsQueued: 0,
    currentTitle: null,
    lastError: null,
    forceAll: false,
};

const asWatchError = (error, watch) => explainPosterSetsPageError(
    error?.message || String(error || ''),
    watch?.url,
);

/** No progress for this long ⇒ treat as stuck (hung scrape / dead async). */
const WATCHER_STALE_MS = 15 * 60 * 1000;
/** Absolute ceiling for one pass (81 watches × scrape can be long). */
const WATCHER_MAX_MS = 3 * 60 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const isPosterSetsWatcherBusy = () => watcherBusy;

export const getPosterSetsWatcherPassStatus = () => {
    const status = { ...watcherPassStatus, busy: watcherBusy };
    const anchor = status.lastProgressAt || status.startedAt;
    if (status.busy && anchor) {
        const age = Date.now() - new Date(anchor).getTime();
        status.stale = Number.isFinite(age) && age >= WATCHER_STALE_MS;
        status.ageMs = Number.isFinite(age) ? age : null;
    } else {
        status.stale = false;
        status.ageMs = null;
    }
    return status;
};

/** Clear a stuck busy flag (e.g. after a crashed/hung Check-all). */
export const resetPosterSetsWatcherBusy = (reason = 'manual-reset') => {
    const wasBusy = watcherBusy || watcherPassStatus.running;
    watcherBusy = false;
    watcherPassStatus = {
        ...watcherPassStatus,
        running: false,
        finishedAt: new Date().toISOString(),
        lastProgressAt: new Date().toISOString(),
        currentTitle: null,
        lastError: wasBusy ? `Watcher reset (${reason})` : watcherPassStatus.lastError,
    };
    return { ok: true, wasBusy, status: getPosterSetsWatcherPassStatus() };
};

/** If a pass has been silent too long, clear busy so Check-all can run again. */
export const clearStalePosterSetsWatcherIfNeeded = (reason = 'stale-timeout') => {
    if (!watcherBusy) return { cleared: false, status: getPosterSetsWatcherPassStatus() };
    const status = getPosterSetsWatcherPassStatus();
    const startedMs = status.startedAt ? Date.now() - new Date(status.startedAt).getTime() : 0;
    if (status.stale || (Number.isFinite(startedMs) && startedMs >= WATCHER_MAX_MS)) {
        return { cleared: true, ...resetPosterSetsWatcherBusy(reason) };
    }
    return { cleared: false, status };
};

export const setPosterSetsEnqueueApply = (fn) => {
    enqueueApplyFn = typeof fn === 'function' ? fn : null;
};

/** Injected from portal boot — typically sendGotifyAlert wrapper. */
export const setPosterSetsNotifyDigest = (fn) => {
    notifyDigestFn = typeof fn === 'function' ? fn : null;
};

const inspectSetAssets = async (url, mediuxFilters) => {
    const config = await loadPosterSetsConfig();
    const run = await runPosterSetsCli('inspect', {
        config: {
            ...config,
            mediux_filters: Array.isArray(mediuxFilters) && mediuxFilters.length
                ? mediuxFilters
                : config.mediux_filters,
        },
        url,
        mediuxFilters,
    }, { timeoutMs: 180_000 });
    if (!run.ok) {
        const error = new Error(run.error || 'Failed to inspect set');
        error.logs = run.logs;
        throw error;
    }
    return run.result || {};
};

const asIdList = (value) => (
    Array.isArray(value)
        ? [...new Set(value.map((id) => String(id || '').trim()).filter(Boolean))]
        : []
);

const libraryHintsPatch = (watch, assets) => {
    const list = Array.isArray(assets) ? assets : [];
    const matched = list.filter((asset) => asset?.matched === true);
    const extra = libraryHintsFromAssets(matched.length ? matched : list);
    if (!extra.length) return {};
    return { libraryHints: mergeLibraryHints(watch.libraryHints, extra) };
};

const assetSeasonNumber = (asset) => {
    const season = asset?.season;
    if (season === 'Cover' || season === 'Backdrop' || season == null || season === '') return null;
    const num = Number(season);
    return Number.isFinite(num) ? num : null;
};

/** Season poster / title cards for a given season (Sonarr import path). */
export const assetTargetsSeason = (asset, seasonNumber) => {
    if (!Number.isFinite(Number(seasonNumber))) return false;
    const want = Number(seasonNumber);
    const season = assetSeasonNumber(asset);
    if (season === want) return true;
    // Specials
    if (want === 0 && (asset?.season === 0 || asset?.season === '0')) return true;
    return false;
};

/**
 * Assets the watcher should apply now:
 * - brand-new set IDs that already match in the library
 * - Sonarr season import: force that season's covers/title cards
 * - assets that newly matched in Plex since the last check (season landed)
 *
 * Never re-queue everything already matched — that caused the Check-all storm.
 * Quiet baselines (first pin / heal) record current matches without queueing.
 */
export const pickWatchApplyIds = (assets, {
    knownAssetIds = [],
    lastMatchedAssetIds = [],
    seasonNumber = null,
    isFirstCheck = false,
    forceSeason = false,
    quietBaseline = false,
} = {}) => {
    const list = Array.isArray(assets) ? assets : [];
    const known = new Set(asIdList(knownAssetIds));
    const lastMatched = new Set(asIdList(lastMatchedAssetIds));
    const wantSeason = seasonNumber != null && Number.isFinite(Number(seasonNumber))
        ? Number(seasonNumber)
        : null;
    const allIds = list.map((asset) => String(asset?.id || '').trim()).filter(Boolean);
    const matchedIds = list
        .filter((asset) => asset?.matched === true && asset?.id)
        .map((asset) => String(asset.id).trim())
        .filter(Boolean);

    if (isFirstCheck || quietBaseline) {
        return {
            queueIds: [],
            newIds: [],
            pendingIds: [],
            knownAssetIds: allIds,
            appliedAssetIds: matchedIds,
            lastMatchedAssetIds: matchedIds,
        };
    }

    const newIds = [];
    const pendingIds = [];
    for (const asset of list) {
        const id = String(asset?.id || '').trim();
        if (!id) continue;
        const matched = asset?.matched === true;

        if (!known.has(id)) {
            // New on the set: only queue once it matches in the library (unless ARR force).
            if (matched) newIds.push(id);
            else if (forceSeason && wantSeason != null && assetTargetsSeason(asset, wantSeason)) {
                newIds.push(id);
            }
            continue;
        }

        if (forceSeason && wantSeason != null && assetTargetsSeason(asset, wantSeason)) {
            pendingIds.push(id);
            continue;
        }

        // Newly available in Plex since last check (e.g. season just imported).
        if (matched && !lastMatched.has(id)) {
            pendingIds.push(id);
        }
    }

    return {
        queueIds: [...new Set([...newIds, ...pendingIds])],
        newIds: [...new Set(newIds)],
        pendingIds: [...new Set(pendingIds)],
        knownAssetIds: null,
        appliedAssetIds: null,
        lastMatchedAssetIds: matchedIds,
        matchedIds,
    };
};

/** Tracking v3: lastMatchedAssetIds drives season-later applies without mass re-queue. */
export const WATCH_ASSET_TRACKING_VERSION = 3;

export const checkPosterSetsWatch = async (watch, { enqueue = true, seasonNumber = null } = {}) => {
    if (!watch?.url) throw new Error('Watch URL is required');
    const config = await loadPosterSetsConfig();
    if (!posterSetsWatchProviderAllowed(config, watch)) {
        return { ok: true, skipped: true, reason: 'provider_disabled' };
    }
    const inspected = await inspectSetAssets(watch.url, watch.mediuxFilters);
    const assets = Array.isArray(inspected.assets) ? inspected.assets : [];
    const assetIds = assets.map((asset) => String(asset.id || '').trim()).filter(Boolean);
    const knownList = asIdList(watch.knownAssetIds);
    const lastMatchedList = asIdList(watch.lastMatchedAssetIds);
    // matched === null on every asset means Plex match check was skipped/failed —
    // in that case we must not rewrite lastMatched or we lose new-season detection.
    const hasMatchData = assets.some((asset) => asset?.matched === true || asset?.matched === false);
    const matchedIds = assets
        .filter((asset) => asset?.matched === true && asset?.id)
        .map((asset) => String(asset.id).trim())
        .filter(Boolean);
    const isFirstCheck = knownList.length === 0;
    const wantSeason = seasonNumber != null && Number.isFinite(Number(seasonNumber))
        ? Number(seasonNumber)
        : null;
    const trackingVersion = Number(watch.assetTrackingVersion) || 1;
    // One-time quiet heal for pre-v3 watches: seed lastMatched without enqueueing.
    // Do NOT trigger on empty lastMatched — a watch with no library matches yet must
    // keep detecting "newly matched" once the title lands on Plex.
    const needsQuietBaseline = !isFirstCheck && trackingVersion < WATCH_ASSET_TRACKING_VERSION;

    const picked = pickWatchApplyIds(assets, {
        knownAssetIds: knownList,
        lastMatchedAssetIds: lastMatchedList,
        seasonNumber: wantSeason,
        isFirstCheck,
        forceSeason: wantSeason != null,
        quietBaseline: needsQuietBaseline,
    });

    const setMeta = inspected.setMeta || {
        provider: watch.provider,
        setId: watch.setId,
        url: watch.url,
        title: watch.title,
        user: watch.user,
        tmdbId: watch.tmdbId,
        tvdbId: watch.tvdbId,
        thumbUrl: watch.thumbUrl,
        assetCount: assetIds.length,
    };

    const idPatch = {
        tmdbId: setMeta.tmdbId || watch.tmdbId || null,
        tvdbId: setMeta.tvdbId || watch.tvdbId || null,
    };

    if (isFirstCheck || needsQuietBaseline) {
        // ARR force during baseline still applies that season.
        let queueIds = [];
        if (enqueue && wantSeason != null) {
            queueIds = assets
                .filter((asset) => assetTargetsSeason(asset, wantSeason))
                .map((asset) => String(asset?.id || '').trim())
                .filter(Boolean);
            queueIds = [...new Set(queueIds)];
            if (queueIds.length) {
                const jobInput = {
                    url: watch.url,
                    selectedIds: queueIds,
                    selectedCount: queueIds.length,
                    setMeta,
                    watchId: watch.id,
                    mediuxFilters: watch.mediuxFilters,
                    source: 'watch',
                    seasonNumber: wantSeason,
                    ...(watch.plexHint ? { plexHint: watch.plexHint } : {}),
                };
                if (enqueueApplyFn) await enqueueApplyFn('apply', jobInput);
                else await enqueuePosterSetsJob('apply', jobInput);
            }
        }

        // Without match data we can't seed a truthful baseline; defer so the next
        // check with a working Plex connection does it (otherwise everything the
        // library matches later would look "new" and storm the queue).
        if (!hasMatchData) {
            const deferred = await patchPosterSetsWatch(watch.id, {
                title: setMeta.title || watch.title,
                user: setMeta.user || watch.user,
                thumbUrl: setMeta.thumbUrl || watch.thumbUrl || '',
                setId: setMeta.setId || watch.setId,
                ...idPatch,
                ...libraryHintsPatch(watch, assets),
                lastCheckedAt: new Date().toISOString(),
                lastError: 'Library match check unavailable — baseline deferred',
                lastNewCount: queueIds.length,
            });
            return {
                watch: deferred,
                newIds: [],
                pendingIds: queueIds,
                queueIds,
                assetIds,
                queued: queueIds.length > 0,
                baseline: true,
                baselineDeferred: true,
                setMeta,
                quietBaseline: needsQuietBaseline,
            };
        }

        const patched = await patchPosterSetsWatch(watch.id, {
            knownAssetIds: picked.knownAssetIds || assetIds,
            // Quiet heals keep real upload history; only a brand-new watch seeds it.
            ...(isFirstCheck ? { appliedAssetIds: picked.appliedAssetIds || matchedIds } : {}),
            lastMatchedAssetIds: picked.lastMatchedAssetIds || matchedIds,
            assetTrackingVersion: WATCH_ASSET_TRACKING_VERSION,
            title: setMeta.title || watch.title,
            user: setMeta.user || watch.user,
            thumbUrl: setMeta.thumbUrl || watch.thumbUrl || '',
            setId: setMeta.setId || watch.setId,
            ...idPatch,
            ...libraryHintsPatch(watch, assets),
            lastCheckedAt: new Date().toISOString(),
            lastError: null,
            lastNewCount: queueIds.length,
        });
        return {
            watch: patched,
            newIds: [],
            pendingIds: queueIds,
            queueIds,
            assetIds,
            queued: queueIds.length > 0,
            baseline: true,
            setMeta,
            quietBaseline: needsQuietBaseline,
        };
    }

    const queueIds = picked.queueIds || [];
    let queued = false;
    if (enqueue && queueIds.length) {
        const jobInput = {
            url: watch.url,
            selectedIds: queueIds,
            selectedCount: queueIds.length,
            setMeta,
            watchId: watch.id,
            mediuxFilters: watch.mediuxFilters,
            source: 'watch',
            ...(watch.plexHint ? { plexHint: watch.plexHint } : {}),
            ...(wantSeason != null ? { seasonNumber: wantSeason } : {}),
        };
        if (enqueueApplyFn) {
            await enqueueApplyFn('apply', jobInput);
        } else {
            await enqueuePosterSetsJob('apply', jobInput);
        }
        queued = true;
    }

    const patched = await patchPosterSetsWatch(watch.id, {
        title: setMeta.title || watch.title,
        user: setMeta.user || watch.user,
        thumbUrl: setMeta.thumbUrl || watch.thumbUrl || '',
        setId: setMeta.setId || watch.setId,
        knownAssetIds: [...new Set([...knownList, ...assetIds])],
        // Never clobber lastMatched when the Plex match check was skipped —
        // that's what makes seasons look "already handled" or storm later.
        ...(hasMatchData ? { lastMatchedAssetIds: picked.lastMatchedAssetIds || matchedIds } : {}),
        assetTrackingVersion: WATCH_ASSET_TRACKING_VERSION,
        ...idPatch,
        ...libraryHintsPatch(watch, assets),
        lastCheckedAt: new Date().toISOString(),
        lastError: hasMatchData ? null : 'Library match check unavailable — new-season detection paused',
        lastNewCount: queueIds.length,
    });

    return {
        watch: patched,
        newIds: picked.newIds || [],
        pendingIds: picked.pendingIds || [],
        queueIds,
        assetIds,
        queued,
        baseline: false,
        setMeta,
    };
};

export const markWatchAssetsApplied = async (watchId, assetIds = []) => {
    if (!watchId || !assetIds?.length) return null;
    const watch = (await listPosterSetsWatches()).find((item) => item.id === String(watchId));
    if (!watch) return null;
    const ids = asIdList(assetIds);
    const known = [...new Set([...(watch.knownAssetIds || []), ...ids])];
    const applied = [...new Set([...(watch.appliedAssetIds || []), ...ids])];
    const lastMatched = [...new Set([...(watch.lastMatchedAssetIds || []), ...ids])];
    return patchPosterSetsWatch(watchId, {
        knownAssetIds: known,
        appliedAssetIds: applied,
        lastMatchedAssetIds: lastMatched,
        assetTrackingVersion: Math.max(Number(watch.assetTrackingVersion) || 1, WATCH_ASSET_TRACKING_VERSION),
        lastAppliedAt: new Date().toISOString(),
        lastError: null,
        lastNewCount: 0,
    });
};

/**
 * Force-queue artwork from a pin after library rematch / lost Plex art.
 * - entire: full set apply (same as Discover “queue entire”)
 * - matched: only assets currently (or last) matched in the library
 */
export const reapplyPosterSetsWatch = async (watch, { mode = 'entire' } = {}) => {
    if (!watch?.url) throw new Error('Watch URL is required');
    const modeNorm = String(mode || '').trim().toLowerCase() === 'matched' ? 'matched' : 'entire';

    let setMeta = {
        provider: watch.provider,
        setId: watch.setId,
        url: watch.url,
        title: watch.title,
        user: watch.user,
        tmdbId: watch.tmdbId,
        tvdbId: watch.tvdbId,
        thumbUrl: watch.thumbUrl,
        assetCount: Array.isArray(watch.knownAssetIds) ? watch.knownAssetIds.length : null,
    };
    let queueIds = null;

    if (modeNorm === 'matched') {
        const inspected = await inspectSetAssets(watch.url, watch.mediuxFilters);
        const assets = Array.isArray(inspected.assets) ? inspected.assets : [];
        const hasMatchData = assets.some((asset) => asset?.matched === true || asset?.matched === false);
        const matchedIds = assets
            .filter((asset) => asset?.matched === true && asset?.id)
            .map((asset) => String(asset.id).trim())
            .filter(Boolean);
        const lastMatchedList = asIdList(watch.lastMatchedAssetIds);
        queueIds = hasMatchData && matchedIds.length
            ? matchedIds
            : lastMatchedList;
        if (!queueIds.length) {
            const error = new Error(
                'No matched library assets for this set. Try Entire set after rematching the title in Plex.',
            );
            error.status = 400;
            throw error;
        }
        setMeta = inspected.setMeta || {
            ...setMeta,
            assetCount: assets.length || setMeta.assetCount,
        };
    } else {
        try {
            const inspected = await inspectSetAssets(watch.url, watch.mediuxFilters);
            const assets = Array.isArray(inspected.assets) ? inspected.assets : [];
            setMeta = inspected.setMeta || {
                ...setMeta,
                assetCount: assets.length || setMeta.assetCount,
            };
        } catch {
            /* still queue full apply with pin metadata */
        }
        queueIds = null;
    }

    const jobInput = {
        url: watch.url,
        selectedIds: queueIds,
        selectedCount: queueIds?.length || null,
        setMeta,
        watchId: watch.id,
        mediuxFilters: watch.mediuxFilters,
        source: 'watch',
        reapply: true,
        ...(watch.plexHint ? { plexHint: watch.plexHint } : {}),
    };

    let job = null;
    if (enqueueApplyFn) {
        job = await enqueueApplyFn('apply', jobInput);
    } else {
        job = await enqueuePosterSetsJob('apply', jobInput);
    }

    const patched = await patchPosterSetsWatch(watch.id, {
        title: setMeta.title || watch.title,
        user: setMeta.user || watch.user,
        thumbUrl: setMeta.thumbUrl || watch.thumbUrl || '',
        setId: setMeta.setId || watch.setId,
        tmdbId: setMeta.tmdbId || watch.tmdbId || null,
        tvdbId: setMeta.tvdbId || watch.tvdbId || null,
        lastCheckedAt: new Date().toISOString(),
        lastError: null,
        lastNewCount: queueIds?.length || 0,
    });

    return {
        watch: patched,
        mode: modeNorm,
        queued: true,
        selectedCount: queueIds?.length ?? null,
        jobId: job?.id || null,
        job: job || null,
        setMeta,
    };
};

/**
 * Mark only assets that actually uploaded. Falls back to selectedIds when the
 * worker did not return per-asset rows (older results).
 */
export const resolveAppliedAssetIdsFromResult = (selectedIds = [], result = null) => {
    const selected = asIdList(selectedIds);
    const rows = Array.isArray(result?.results) ? result.results : [];
    if (!rows.length) {
        // Only trust selectedIds when something actually uploaded.
        return Number(result?.uploaded) > 0 ? selected : [];
    }

    const okRows = rows.filter((row) => row && row.ok);
    if (!okRows.length) return [];

    const fromIds = okRows
        .map((row) => String(row.id || row.assetId || '').trim())
        .filter(Boolean);
    if (fromIds.length) return [...new Set(fromIds)];

    // Python upload_* results don't include asset fingerprints — if every selected
    // asset uploaded (uploaded === attempted), mark them all; otherwise mark none
    // so unmatched seasons can retry.
    const uploaded = Number(result?.uploaded);
    const attempted = Number(result?.attempted);
    if (Number.isFinite(uploaded) && Number.isFinite(attempted) && attempted > 0 && uploaded >= attempted) {
        return selected;
    }
    if (Number.isFinite(uploaded) && uploaded > 0 && selected.length === 1) {
        return selected;
    }
    // Partial: keep selected IDs that we can't map out of applied so seasons retry.
    // Prefer marking nothing over poisoning the watch with failed season covers.
    return [];
};

const ALLOWED_FILTERS = new Set(['title_card', 'background', 'season_cover', 'show_cover']);

const filterFromListedAsset = (asset) => {
    const explicit = String(asset?.fileType || asset?.file_type || '').trim().toLowerCase();
    if (explicit === 'backdrop' || explicit === 'background') return 'background';
    if (ALLOWED_FILTERS.has(explicit)) return explicit;
    if (asset?.season === 'Backdrop') return 'background';
    if (String(asset?.kind || '') !== 'show') return null;
    const season = asset?.season;
    const episode = asset?.episode;
    if (season === 'Cover') return 'show_cover';
    if (episode === 'Cover' || episode == null || episode === '') return 'season_cover';
    return 'title_card';
};

const filtersFromSelectedAssets = (assets, selectedIds) => {
    const wanted = new Set((selectedIds || []).map((id) => String(id)));
    if (!wanted.size) return [];
    const filters = new Set();
    for (const asset of assets || []) {
        if (!wanted.has(String(asset?.id || ''))) continue;
        const filter = filterFromListedAsset(asset);
        if (filter) filters.add(filter);
    }
    return [...ALLOWED_FILTERS].filter((id) => filters.has(id));
};

const mergeWatchFilters = (left, right) => (
    [...ALLOWED_FILTERS].filter((id) => left.includes(id) || right.includes(id))
);

const resolveWatchFilters = async ({
    target,
    existing,
    mediuxFilters,
    selectedIds,
    config,
}) => {
    const pendingSelected = asIdList(selectedIds);
    const fromClient = Array.isArray(mediuxFilters)
        ? mediuxFilters.map((item) => String(item || '').trim()).filter((item) => ALLOWED_FILTERS.has(item))
        : [];
    let derived = [];
    if (!fromClient.length && pendingSelected.length) {
        try {
            const inspected = await inspectSetAssets(target, config.mediux_filters);
            derived = filtersFromSelectedAssets(inspected.assets, pendingSelected);
        } catch {
            /* keep defaults */
        }
    }
    const incoming = fromClient.length ? fromClient : derived;
    const existingFilters = Array.isArray(existing?.mediuxFilters) && existing.mediuxFilters.length
        ? existing.mediuxFilters
        : [];
    if (existingFilters.length && incoming.length) return mergeWatchFilters(existingFilters, incoming);
    if (incoming.length) return incoming;
    if (existingFilters.length) return existingFilters;
    return config.mediux_filters;
};

const isWatchableSetUrl = (raw) => {
    const url = String(raw || '').trim();
    if (!url || url.startsWith('#') || url.startsWith('//')) return false;
    return /^https?:\/\//i.test(url);
};

/** Set URLs from a bulk queue item (paste list, url array, or CLI outcomes). */
export const collectBulkWatchUrls = (input = {}, result = {}) => {
    const urls = [];
    const seen = new Set();
    const push = (raw) => {
        const url = String(raw || '').trim();
        if (!url || seen.has(url) || !isWatchableSetUrl(url)) return;
        seen.add(url);
        urls.push(url);
    };
    for (const item of Array.isArray(input?.urls) ? input.urls : []) push(item);
    if (input?.text) {
        for (const line of String(input.text).split(/\r?\n/)) push(line);
    }
    if (!urls.length) {
        for (const item of Array.isArray(result?.outcomes) ? result.outcomes : []) push(item?.url);
    }
    return urls;
};

/** Pin every bulk-list set on Watching after the bulk job finishes. */
export const autoWatchFromBulkJob = async ({ input, result } = {}) => {
    const config = await loadPosterSetsConfig();
    if (!config.autoWatchOnApply) return [];
    const urls = collectBulkWatchUrls(input, result);
    if (!urls.length) return [];
    const outcomes = Array.isArray(result?.outcomes) ? result.outcomes : [];
    const pinned = [];
    for (const url of urls) {
        const outcome = outcomes.find((item) => String(item?.url || '').trim() === url) || null;
        const setMeta = outcome?.setMeta || outcome?.set_meta || null;
        const missing = outcome ? isMissingLibraryApplyResult(outcome) : false;
        try {
            const watch = missing
                ? await autoWatchFromMissingLibrary({ url, setMeta })
                : await autoWatchFromApply({ url, setMeta });
            if (watch) pinned.push(watch);
        } catch {
            /* keep going — one bad set should not skip the rest */
        }
    }
    return pinned;
};

const isMissingLibraryMessage = (value) => {
    const msg = String(value || '').toLowerCase();
    return msg.includes('not found in any library')
        || msg.includes('collection not found in any library')
        || msg.includes('no titles found for')
        || msg.includes('no titles in a matching collection');
};

/** True when every attempted upload failed because the title is not in Plex yet. */
export const isMissingLibraryApplyResult = (result) => {
    if (!result || typeof result !== 'object') return false;
    const rows = Array.isArray(result.results) ? result.results : [];
    if (rows.length) {
        const attempted = rows.filter((row) => row && (row.ok === true || row.ok === false));
        if (!attempted.length) return false;
        return attempted.every((row) => !row.ok && isMissingLibraryMessage(row.message));
    }
    const outcomes = Array.isArray(result.outcomes) ? result.outcomes : [];
    if (outcomes.length) {
        return outcomes.every((outcome) => isMissingLibraryApplyResult(outcome));
    }
    return isMissingLibraryMessage(result.error);
};

export const missingLibraryApplyAdvice = (title, { pinned = false } = {}) => {
    const label = String(title || '').trim() || 'This title';
    if (pinned) {
        return `${label} is not on your media server yet. Pinned on Watching — will auto-apply when it is added.`;
    }
    return `${label} is not on your media server yet.`;
};

export const autoWatchFromApply = async ({ url, setMeta, selectedIds, mediuxFilters, plexHint } = {}) => {
    const target = String(url || setMeta?.url || '').trim();
    if (!target) return null;
    const config = await loadPosterSetsConfig();
    if (!config.autoWatchOnApply) return null;
    const existing = (await listPosterSetsWatches()).find((watch) => watch.url === target);
    const appliedSelected = asIdList(selectedIds);
    let known = [
        ...(existing?.knownAssetIds || []),
        ...appliedSelected,
    ];
    let applied = [
        ...(existing?.appliedAssetIds || []),
        ...appliedSelected,
    ];

    let lastMatched = [
        ...(existing?.lastMatchedAssetIds || []),
        ...appliedSelected,
    ];

    let watchFilters = await resolveWatchFilters({
        target,
        existing,
        mediuxFilters,
        selectedIds,
        config,
    });

    let inspectedAssets = [];

    // New watches: fingerprint the whole set as "known" so future creator uploads
    // are detected, but only mark successfully applied IDs as applied — so season
    // covers that weren't uploaded yet can still queue when the season lands on Plex.
    if (!existing) {
        try {
            const inspected = await inspectSetAssets(target, watchFilters);
            inspectedAssets = Array.isArray(inspected.assets) ? inspected.assets : [];
            const ids = inspectedAssets.map((asset) => String(asset.id || '').trim()).filter(Boolean);
            if (ids.length) known = ids;
            const matchedIds = inspectedAssets
                .filter((asset) => asset?.matched === true && asset?.id)
                .map((asset) => String(asset.id));
            applied = [...new Set([...appliedSelected, ...matchedIds])];
            lastMatched = [...new Set([...appliedSelected, ...matchedIds])];
        } catch {
            /* fall back to selectedIds only */
        }
    }

    const hintAssets = inspectedAssets.filter((asset) => asset?.matched === true);
    const libraryHints = libraryHintsFromAssets(hintAssets.length ? hintAssets : inspectedAssets);

    const saved = await upsertPosterSetsWatch({
        url: target,
        provider: setMeta?.provider || existing?.provider,
        setId: setMeta?.setId || existing?.setId,
        title: setMeta?.title || existing?.title,
        user: setMeta?.user || existing?.user,
        tmdbId: setMeta?.tmdbId || existing?.tmdbId,
        tvdbId: setMeta?.tvdbId || existing?.tvdbId,
        thumbUrl: setMeta?.thumbUrl || existing?.thumbUrl || '',
        setKind: setKindFromFilters(watchFilters),
        mediuxFilters: watchFilters,
        knownAssetIds: known,
        appliedAssetIds: applied,
        lastMatchedAssetIds: lastMatched,
        assetTrackingVersion: WATCH_ASSET_TRACKING_VERSION,
        enabled: true,
        lastAppliedAt: new Date().toISOString(),
        lastError: null,
        plexHint: plexHint || existing?.plexHint || null,
        ...(libraryHints.length ? { libraryHints } : {}),
    });
    try { await replaceSameTitleWatches(saved); } catch { /* keep the new pin */ }
    return saved;
};

/** Pin a set for auto-apply when a queue apply fails because the title is not in Plex yet. */
export const autoWatchFromMissingLibrary = async ({
    url,
    setMeta,
    selectedIds,
    mediuxFilters,
    plexHint,
} = {}) => {
    const target = String(url || setMeta?.url || '').trim();
    if (!target) return null;
    const config = await loadPosterSetsConfig();
    if (!config.autoWatchOnApply) return null;

    const existing = (await listPosterSetsWatches()).find((watch) => watch.url === target);
    const pendingSelected = asIdList(selectedIds);
    const watchFilters = await resolveWatchFilters({
        target,
        existing,
        mediuxFilters,
        selectedIds,
        config,
    });

    let known = [...(existing?.knownAssetIds || [])];
    const applied = [...(existing?.appliedAssetIds || [])];
    let lastMatched = [...(existing?.lastMatchedAssetIds || [])];

    if (!existing) {
        try {
            const inspected = await inspectSetAssets(target, watchFilters);
            const ids = (inspected.assets || []).map((asset) => String(asset.id || '').trim()).filter(Boolean);
            if (ids.length) known = pendingSelected.length ? pendingSelected : ids;
            lastMatched = [];
        } catch {
            if (pendingSelected.length) known = pendingSelected;
            lastMatched = [];
        }
    } else if (pendingSelected.length) {
        known = [...new Set([...known, ...pendingSelected])];
    }

    const saved = await upsertPosterSetsWatch({
        url: target,
        provider: setMeta?.provider || existing?.provider,
        setId: setMeta?.setId || existing?.setId,
        title: setMeta?.title || existing?.title,
        user: setMeta?.user || existing?.user,
        tmdbId: setMeta?.tmdbId || existing?.tmdbId,
        tvdbId: setMeta?.tvdbId || existing?.tvdbId,
        thumbUrl: setMeta?.thumbUrl || existing?.thumbUrl || '',
        setKind: setKindFromFilters(watchFilters),
        mediuxFilters: watchFilters,
        knownAssetIds: known,
        appliedAssetIds: applied,
        lastMatchedAssetIds: lastMatched,
        assetTrackingVersion: WATCH_ASSET_TRACKING_VERSION,
        enabled: true,
        lastError: 'Waiting for title in library — will auto-apply when available.',
        plexHint: plexHint || existing?.plexHint || null,
    });
    try { await replaceSameTitleWatches(saved); } catch { /* keep the new pin */ }
    return saved;
};

const normalizeTitleKey = (value) => String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const idsEqual = (a, b) => {
    const left = a != null ? String(a).trim() : '';
    const right = b != null ? String(b).trim() : '';
    return Boolean(left && right && left === right);
};

/** TPDB watch titles carry a year ("Ted Lasso (2020)"); Sonarr sends bare titles. */
const titleKeyParts = (value) => {
    const key = normalizeTitleKey(value);
    const match = key.match(/^(.*?)\s+((?:19|20)\d{2})$/);
    if (match && match[1]) return { key, base: match[1].trim(), year: Number(match[2]) };
    return { key, base: key, year: null };
};

export const matchPosterSetsWatchesForSeries = (watches, { title, tmdbId, tvdbId, year } = {}) => {
    const list = Array.isArray(watches) ? watches.filter((watch) => watch?.enabled !== false) : [];
    const byTvdb = tvdbId
        ? list.filter((watch) => idsEqual(watch.tvdbId, tvdbId))
        : [];
    if (byTvdb.length) return byTvdb;
    const byTmdb = tmdbId
        ? list.filter((watch) => idsEqual(watch.tmdbId, tmdbId))
        : [];
    if (byTmdb.length) return byTmdb;
    const target = titleKeyParts(title);
    if (!target.key) return [];
    const wantYear = Number.isFinite(Number(year)) ? Number(year) : target.year;
    return list.filter((watch) => {
        const own = titleKeyParts(watch.title);
        if (!own.key) return false;
        if (own.key === target.key) return true;
        if (own.base !== target.base) return false;
        // Same base title where only one side carries a year, or the years agree.
        if (own.year != null && wantYear != null) return own.year === wantYear;
        return true;
    });
};

export const checkPosterSetsWatchesForSeries = async ({
    title,
    tmdbId,
    tvdbId,
    year,
    seasonNumber,
    notify = true,
} = {}) => {
    const all = await listPosterSetsWatches();
    const matched = matchPosterSetsWatchesForSeries(all, { title, tmdbId, tvdbId, year });
    let checked = 0;
    let queued = 0;
    let assetsQueued = 0;
    const errors = [];
    for (const watch of matched) {
        try {
            const result = await checkPosterSetsWatch(watch, {
                enqueue: true,
                seasonNumber: seasonNumber != null && Number.isFinite(Number(seasonNumber))
                    ? Number(seasonNumber)
                    : null,
            });
            checked += 1;
            if (result.queued) {
                queued += 1;
                assetsQueued += Array.isArray(result.queueIds) ? result.queueIds.length : 0;
            }
            // Title-matched watches often lack ids (TPDB sets) — stamp them so
            // future Sonarr imports match by tvdb/tmdb directly.
            if ((tvdbId && !watch.tvdbId) || (tmdbId && !watch.tmdbId)) {
                try {
                    await patchPosterSetsWatch(watch.id, {
                        ...(tvdbId && !watch.tvdbId ? { tvdbId } : {}),
                        ...(tmdbId && !watch.tmdbId ? { tmdbId } : {}),
                    });
                } catch { /* ignore */ }
            }
        } catch (error) {
            const message = asWatchError(error, watch);
            errors.push({ id: watch.id, error: message });
            try {
                await patchPosterSetsWatch(watch.id, {
                    lastCheckedAt: new Date().toISOString(),
                    lastError: message,
                });
            } catch {
                /* ignore */
            }
        }
        await sleep(500);
    }

    // Always leave a trace in Logs → Audit — silent no-match runs are undebuggable.
    try {
        const seasonLabel = Number.isFinite(Number(seasonNumber)) ? ` S${Number(seasonNumber)}` : '';
        await appendPosterSetsAudit({
            action: 'watch_check',
            source: 'watcher',
            title: `Sonarr import — ${String(title || '').trim() || 'Unknown series'}${seasonLabel}`,
            checked,
            queued,
            assetsQueued,
            state: errors.length ? 'partial' : (queued ? 'queued' : 'idle'),
            error: errors.length ? `${errors.length} watch check error(s)` : null,
            detail: matched.length
                ? `Matched ${matched.length} watch(es); queued ${queued} watch(es) / ${assetsQueued} asset(s).`
                : `No pinned sets matched this import (tvdb ${tvdbId || '—'}, tmdb ${tmdbId || '—'}, title "${String(title || '').trim() || '—'}").`,
            at: new Date().toISOString(),
        });
    } catch { /* ignore audit failures */ }

    if (notify && queued > 0 && notifyDigestFn) {
        const label = String(title || '').trim() || 'Show';
        const season = Number.isFinite(Number(seasonNumber)) ? ` S${Number(seasonNumber)}` : '';
        try {
            await notifyDigestFn({
                title: 'Poster Sets · Sonarr import',
                message: `ARR import → ${assetsQueued} asset${assetsQueued === 1 ? '' : 's'} queued for ${label}${season} (${queued} watch${queued === 1 ? '' : 'es'}).`,
                checked,
                queued,
                assetsQueued,
            });
        } catch {
            /* ignore */
        }
    }

    return {
        ok: true,
        matched: matched.length,
        checked,
        queued,
        assetsQueued,
        seasonNumber: Number.isFinite(Number(seasonNumber)) ? Number(seasonNumber) : null,
        errors,
    };
};

export const runPosterSetsWatcherPass = async ({
    forceAll = false,
    notify = true,
    onProgress = null,
} = {}) => {
    if (watcherBusy) {
        return { ok: true, skipped: true, reason: 'busy', checked: 0, queued: 0, assetsQueued: 0 };
    }
    watcherBusy = true;
    let ledgerStarted = false;
    const startedAt = new Date().toISOString();
    try {
        const config = await loadPosterSetsConfig();
        if (!config.watchersEnabled && !forceAll) {
            return { ok: true, skipped: true, reason: 'disabled', checked: 0, queued: 0, assetsQueued: 0 };
        }
        const hours = Math.max(1, Number(config.watchIntervalHours) || 6);
        await markJobStart(JOB_IDS.posterSetsWatcher, { intervalMs: hours * 60 * 60 * 1000 }).catch(() => {});
        ledgerStarted = true;
        const watches = (await listPosterSetsWatches()).filter((watch) => watch.enabled);
        let checked = 0;
        let queued = 0;
        let assetsQueued = 0;
        const errors = [];
        watcherPassStatus = {
            running: true,
            startedAt,
            finishedAt: null,
            lastProgressAt: startedAt,
            total: watches.length,
            checked: 0,
            queued: 0,
            assetsQueued: 0,
            currentTitle: null,
            lastError: null,
            forceAll: Boolean(forceAll),
        };
        if (typeof onProgress === 'function') {
            try { await onProgress({ ...watcherPassStatus }); } catch { /* ignore */ }
        }

        for (const watch of watches) {
            watcherPassStatus = {
                ...watcherPassStatus,
                currentTitle: watch.title || watch.url || watch.id,
            };
            try {
                const result = await checkPosterSetsWatch(watch, { enqueue: true });
                checked += 1;
                if (result.queued) {
                    queued += 1;
                    assetsQueued += Array.isArray(result.queueIds) ? result.queueIds.length : 0;
                }
            } catch (error) {
                checked += 1;
                const message = asWatchError(error, watch);
                errors.push({ id: watch.id, error: message });
                watcherPassStatus = {
                    ...watcherPassStatus,
                    lastError: message,
                };
                try {
                    await patchPosterSetsWatch(watch.id, {
                        lastCheckedAt: new Date().toISOString(),
                        lastError: message,
                    });
                } catch {
                    /* ignore */
                }
            }
            watcherPassStatus = {
                ...watcherPassStatus,
                checked,
                queued,
                assetsQueued,
                lastProgressAt: new Date().toISOString(),
            };
            if (typeof onProgress === 'function' && (checked === 1 || checked === watches.length || checked % 5 === 0)) {
                try { await onProgress({ ...watcherPassStatus }); } catch { /* ignore */ }
            }
            // Gentle pacing so MediUX/TPDB aren't hammered.
            await sleep(750);
        }
        const summary = { ok: true, checked, queued, assetsQueued, errors };
        if (
            notify
            && config.notifyOnWatcherDigest !== false
            && queued > 0
            && notifyDigestFn
        ) {
            try {
                await notifyDigestFn({
                    title: 'Poster Sets watcher',
                    message: `${queued} watch${queued === 1 ? '' : 'es'} had new art; ${assetsQueued} asset${assetsQueued === 1 ? '' : 's'} queued.`,
                    checked,
                    queued,
                    assetsQueued,
                });
            } catch {
                /* never fail the pass on notify */
            }
        }
        return summary;
    } finally {
        watcherBusy = false;
        watcherPassStatus = {
            ...watcherPassStatus,
            running: false,
            finishedAt: new Date().toISOString(),
            currentTitle: null,
        };
        if (ledgerStarted) {
            await markJobComplete(JOB_IDS.posterSetsWatcher).catch(() => {});
        }
    }
};

export const startPosterSetsWatcher = (opts = {}) => {
    if (watcherTimer) return;
    const resolveFirstDelay = typeof opts.resolveFirstPassDelayMs === 'function'
        ? opts.resolveFirstPassDelayMs
        : async () => 20_000;
    const arm = async () => {
        try {
            await runPosterSetsWatcherPass();
        } catch {
            /* keep alive */
        }
        try {
            const config = await loadPosterSetsConfig();
            const hours = Math.max(1, Number(config.watchIntervalHours) || 6);
            if (watcherTimer) clearInterval(watcherTimer);
            if (watcherTimer) clearTimeout(watcherTimer);
            watcherTimer = setInterval(() => { void arm(); }, hours * 60 * 60 * 1000);
            watcherTimer.unref?.();
        } catch {
            watcherTimer = setInterval(() => { void arm(); }, 6 * 60 * 60 * 1000);
            watcherTimer.unref?.();
        }
    };
    // First pass: boot-aware delay (skip-if-fresh) so a restart does not re-scrape immediately.
    void Promise.resolve()
        .then(() => resolveFirstDelay())
        .then((delayMs) => {
            const wait = Math.max(0, Number(delayMs) || 0);
            watcherTimer = setTimeout(() => { void arm(); }, wait);
            watcherTimer.unref?.();
        })
        .catch(() => {
            watcherTimer = setTimeout(() => { void arm(); }, 20_000);
            watcherTimer.unref?.();
        });
};

export const stopPosterSetsWatcher = () => {
    if (watcherTimer) clearInterval(watcherTimer);
    if (watcherTimer) clearTimeout(watcherTimer);
    watcherTimer = null;
};
