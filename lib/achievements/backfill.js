import { buildStatsFromHistoryItems, buildStatsFromAnalyticsPayload } from './stats.js';
import { evaluateAchievements, snapshotFromEvaluation } from './evaluate.js';
import { loadAchievementsState, saveAchievementsState } from './store.js';
import { normalizeXpWeights } from './xp.js';
import { mapJellyfinPlayedItemsToHistory } from './jellyfinMap.js';
import { enrichHistoryGenres, warmLibraryGenreCache } from './enrichGenres.js';
import { buildPlexLibraryGenreMap } from './plexGenreIndex.js';
import { GENRE_ENRICHMENT_VERSION, snapshotNeedsGenreRescore } from './genres.js';
import { estimateUnlockTimestamps } from './unlockTimes.js';
import { achievementIdentityKey, preferAchievementSnapshot, pruneAchievementAliasSnapshots } from './identity.js';
import { achievementsLeaderboardSwr } from '../page-swr-cache.js';
import { identityFromPortalUser, loadPortalRequestRecords, countMediaRequestsForIdentity } from './requestCounts.js';

const BACKFILL_THROTTLE_MS = 30 * 60 * 1000;
const PLEX_HISTORY_CAP = 75000;

let inFlight = null;
let lastCompletedAt = 0;
let lastResult = null;

export const getAchievementsBackfillStatus = () => ({
    inFlight: !!inFlight,
    lastCompletedAt: lastCompletedAt || null,
    lastResult,
    throttleMs: BACKFILL_THROTTLE_MS,
});

export const achievementsBackfillNeedsWork = ({
    force = false,
    lastCompletedAt: completedAt = 0,
    throttleMs = BACKFILL_THROTTLE_MS,
    missingCount = 0,
    sourceChanged = false,
} = {}) => {
    if (force || sourceChanged || Number(missingCount) > 0) return true;
    return Date.now() - (Number(completedAt) || 0) > throttleMs;
};

export const summarizeAchievementsBackfill = (result) => {
    if (!result) return null;
    if (result.ok === false) return result.reason || 'failed';
    if (result.skipped) {
        if (result.reason === 'fresh') return 'Skipped — snapshots already current (use Force run to rescore now).';
        return `Skipped (${result.reason}).`;
    }
    const scored = Number(result.processed) || 0;
    const source = result.historySource ? ` via ${result.historySource}` : '';
    return `Scored ${scored} member${scored === 1 ? '' : 's'}${source}.`;
};

const norm = (v) => String(v || '').trim().toLowerCase();

const shouldSkipPortalUser = (user) => {
    if (!user) return true;
    const status = String(user.plexAccessStatus || user.status || '').toLowerCase();
    if (status === 'revoked' || status === 'deleted' || status === 'banned') return true;
    return false;
};

const targetQuality = (user, accountId, accounts = []) => {
    let score = 0;
    const id = String(accountId || '');
    if (id === '1') score += 20;
    if ((Array.isArray(accounts) ? accounts : []).some((account) => String(account?.id) === id)) score += 8;
    const username = String(user?.username || user?.email || '');
    if (username && !/\s*\([^)]*\)\s*$/.test(username)) score += 4;
    if (user?.plexAccountId) score += 2;
    return score;
};

/**
 * Map portal users.json entries → media-server account ids for achievements scoring.
 */
export const resolvePortalAchievementTargets = (users = [], {
    mediaServerType = 'plex',
    plexAccounts = [],
    adminPlexId = null,
} = {}) => {
    const list = Array.isArray(users) ? users : [];
    const accounts = Array.isArray(plexAccounts) ? plexAccounts : [];
    const candidates = [];
    const seen = new Set();

    for (const user of list) {
        if (shouldSkipPortalUser(user)) continue;
        const username = user.username || user.email || null;
        let accountId = null;

        if (['jellyfin', 'emby'].includes(String(mediaServerType || '').toLowerCase())) {
            accountId = user.jellyfinId || user.embyId || null;
        } else {
            if (user.plexAccountId) accountId = String(user.plexAccountId);
            if (!accountId && accounts.length) {
                const byName = accounts.find((a) => norm(a.name) === norm(user.username));
                if (byName) accountId = String(byName.id);
            }
            if (!accountId && user.email && accounts.length) {
                const byEmail = accounts.find((a) => (
                    norm(a.name) === norm(user.email)
                    || norm(a.email) === norm(user.email)
                    || norm(a.name) === norm(String(user.email).split('@')[0])
                ));
                if (byEmail) accountId = String(byEmail.id);
            }
            // Some portals store the local Plex account id in plexId.
            if (!accountId && user.plexId) {
                const plexId = String(user.plexId);
                if (accounts.some((a) => String(a.id) === plexId)) accountId = plexId;
                else if (/^\d+$/.test(plexId) && !accounts.length) accountId = plexId;
            }
            // Last resort: portal user id when it is a numeric Plex account id.
            if (!accountId && user.id && /^\d+$/.test(String(user.id))) {
                const id = String(user.id);
                if (!accounts.length || accounts.some((a) => String(a.id) === id)) accountId = id;
            }
            // Map the portal owner's global plex.tv ID to local PMS owner account "1"
            if (adminPlexId && accountId === String(adminPlexId)) {
                accountId = '1';
            }
        }

        if (!accountId) continue;
        const key = String(accountId);
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({
            accountId: key,
            username: username ? String(username) : `User ${key}`,
            quality: targetQuality(user, key, accounts),
        });
    }

    const byIdentity = new Map();
    for (const candidate of candidates) {
        const identity = achievementIdentityKey(candidate);
        const prev = byIdentity.get(identity);
        if (!prev) {
            byIdentity.set(identity, candidate);
            continue;
        }
        if (candidate.quality !== prev.quality) {
            if (candidate.quality > prev.quality) byIdentity.set(identity, candidate);
            continue;
        }
        if (preferAchievementSnapshot(candidate, prev) < 0) byIdentity.set(identity, candidate);
    }

    return [...byIdentity.values()].map(({ accountId, username }) => ({ accountId, username }));
};

const groupPlexHistoryByAccount = (historyItems = []) => {
    const byAccount = new Map();
    for (const item of historyItems || []) {
        const accountId = String(
            item?.accountID
            ?? item?.AccountID
            ?? item?.accountId
            ?? item?.User?.id
            ?? '',
        ).trim();
        if (!accountId) continue;
        if (!byAccount.has(accountId)) byAccount.set(accountId, []);
        byAccount.get(accountId).push(item);
    }
    return byAccount;
};

const scoreTarget = ({
    target,
    historyItems,
    previous,
    config,
    thumb = null,
    forceUnlockTimestamps = false,
    mediaRequests = 0,
}) => {
    const timeZone = config.portalTimezone || process.env.PORTAL_TIMEZONE || process.env.TZ || 'UTC';
    const minPercentComplete = Number(config.achievementsMinPercentComplete) || 0;
    const weights = normalizeXpWeights(config.achievementsXpWeights);
    const seasons = Array.isArray(config.achievementsSeasons) ? config.achievementsSeasons : [];
    const disabledBadgeIds = config.achievementsDisabledBadgeIds;
    const stats = historyItems?.length
        ? buildStatsFromHistoryItems(historyItems, { timeZone, minPercentComplete, mediaRequests })
        : buildStatsFromAnalyticsPayload({}, { mediaRequests });
    stats.mediaRequests = Number(mediaRequests) || 0;
    const unlockTimestamps = historyItems?.length
        ? estimateUnlockTimestamps(historyItems, {
            timeZone,
            minPercentComplete,
            weights,
            seasons,
            disabledBadgeIds,
        })
        : {};
    const evaluation = evaluateAchievements({
        stats,
        previousBadges: previous?.badges || {},
        weights,
        disabledBadgeIds,
        seasons,
        unlockTimestamps,
        forceUnlockTimestamps: !!forceUnlockTimestamps,
    });
    const snapshot = snapshotFromEvaluation(target.accountId, target.username, evaluation, {
        leaderboardOptOut: !!previous?.leaderboardOptOut,
        genreEnrichmentVersion: GENRE_ENRICHMENT_VERSION,
    });
    if (Array.isArray(previous?.seenUnlockIds)) snapshot.seenUnlockIds = previous.seenUnlockIds;
    if (Array.isArray(previous?.pinnedBadgeIds)) snapshot.pinnedBadgeIds = previous.pinnedBadgeIds;
    if (previous?.muteUnlockToasts != null) snapshot.muteUnlockToasts = previous.muteUnlockToasts;
    const resolvedThumb = thumb || previous?.thumb || null;
    if (resolvedThumb) snapshot.thumb = resolvedThumb;
    return snapshot;
};

const thumbFromPlexAccount = (account) => {
    if (!account) return null;
    return account.thumb || account.image || null;
};

const buildThumbLookup = (plexAccounts = [], portalUsers = [], adminThumb = null) => {
    const byId = {};
    for (const acc of plexAccounts || []) {
        const id = String(acc?.id || '').trim();
        const thumb = thumbFromPlexAccount(acc);
        if (id && thumb) byId[id] = thumb;
    }
    for (const user of portalUsers || []) {
        const id = String(user?.plexAccountId || user?.plexId || '').trim();
        const thumb = user?.thumb || null;
        if (id && thumb && !byId[id]) byId[id] = thumb;
    }
    // Owner/admin plex.tv thumb — PMS /accounts often leaves local id "1" without an avatar.
    if (adminThumb && !byId['1']) byId['1'] = adminThumb;
    return byId;
};

/**
 * Ensure every resolvable portal user has an achievements snapshot.
 * Plex: one full history pull + group by account (fast).
 * Jellyfin/Emby: per-user played items (concurrency-limited).
 *
 * Single-flight + throttle so leaderboard traffic does not stampede the media server.
 */
export const ensurePortalAchievementsBackfill = async (deps = {}, opts = {}) => {
    const {
        loadFile,
        CONFIG_PATH,
        USERS_PATH,
        getPlexConnectionUri,
        fetchPlexServerAccounts,
        fetchAllPlexHistory,
        fetchPlexAccountHistory,
        fetchJellyfinPlayedItems,
        fetchPlexMetadataGenres,
        fetchPlexJson,
        fetchTautulliUserHistoryItems,
        getAdminProfile,
        log = () => {},
    } = deps;
    const force = !!opts.force;

    if (inFlight) return inFlight;

    const run = (async () => {
        const config = await loadFile(CONFIG_PATH, {});
        if (!config?.achievementsEnabled) {
            return { ok: false, reason: 'disabled', processed: 0 };
        }
        if (config.achievementsLeaderboardEnabled === false) {
            return { ok: false, reason: 'leaderboard-disabled', processed: 0 };
        }

        const historySource = (
            config.watchHistorySource === 'tautulli'
            && config.tautulliUrl
            && config.tautulliApiKey
        ) ? 'tautulli' : 'plex';

        const state = await loadAchievementsState();
        const users = await loadFile(USERS_PATH, []);
        const mediaServerType = String(config.mediaServerType || 'plex').toLowerCase();
        let plexAccounts = [];

        if (mediaServerType === 'plex') {
            const uri = await getPlexConnectionUri(config);
            if (uri && typeof fetchPlexServerAccounts === 'function') {
                const acc = await fetchPlexServerAccounts(uri, config);
                plexAccounts = acc?.list || [];
            }
        }

        const adminPlexId = String(config.adminPlexId || '').trim();
        const targets = resolvePortalAchievementTargets(users, { mediaServerType, plexAccounts, adminPlexId });
        if (!targets.length) {
            return { ok: true, processed: 0, reason: 'no-targets' };
        }

        let adminThumb = null;
        if (typeof getAdminProfile === 'function') {
            try {
                const profile = await getAdminProfile(config);
                adminThumb = profile?.thumb || null;
            } catch {
                adminThumb = null;
            }
        }
        const thumbByAccountId = buildThumbLookup(plexAccounts, users, adminThumb);

        const missing = targets.filter((t) => !state.users?.[String(t.accountId)]);
        const sourceChanged = state.historySource && state.historySource !== historySource;
        const stale = Date.now() - lastCompletedAt > BACKFILL_THROTTLE_MS;
        const genreStaleTargets = targets.filter((t) => (
            snapshotNeedsGenreRescore(state.users?.[String(t.accountId)])
        ));
        const needsWork = achievementsBackfillNeedsWork({
            force,
            lastCompletedAt,
            missingCount: missing.length,
            sourceChanged,
        });
        if (!needsWork) {
            const prunedUsers = pruneAchievementAliasSnapshots(state.users || {}, {
                targets,
                portalUsers: users,
                adminPlexId,
            });
            const pruneAccountIds = Object.keys(state.users || {}).filter((id) => !prunedUsers[id]);
            if (pruneAccountIds.length) {
                await saveAchievementsState({
                    ...state,
                    users: prunedUsers,
                    historySource,
                    pruneAccountIds,
                });
                achievementsLeaderboardSwr.clear();
                log(`[achievements] Pruned ${pruneAccountIds.length} duplicate ranking snapshot(s).`);
                lastResult = { ok: true, processed: 0, pruned: pruneAccountIds.length, reason: 'fresh-pruned', at: Date.now() };
                return lastResult;
            }
            lastResult = { ok: true, processed: 0, skipped: true, reason: 'fresh', at: Date.now() };
            return lastResult;
        }

        // Prefer filling gaps always; full refresh on throttle/force/source change.
        // Also rescore snapshots captured before genre enrichment actually worked.
        const toScore = (force || stale || sourceChanged)
            ? targets
            : [...new Map([...missing, ...genreStaleTargets].map((t) => [String(t.accountId), t])).values()];
        log(`[achievements] Backfilling ${toScore.length} portal user(s) via ${historySource} (${missing.length} missing${sourceChanged ? ', source changed' : ''}${genreStaleTargets.length ? `, ${genreStaleTargets.length} genre-stale` : ''})…`);

        const nextUsers = { ...(state.users || {}) };
        const usernameByAccountId = Object.fromEntries(
            targets.map((t) => [String(t.accountId), t.username]),
        );
        const plexNameByAccountId = Object.fromEntries(
            (plexAccounts || [])
                .filter((a) => a?.id != null && a?.name)
                .map((a) => [String(a.id), String(a.name)]),
        );
        const portalByAccountId = {};
        for (const user of users || []) {
            for (const rawId of [user?.plexAccountId, user?.plexId, user?.id]) {
                const id = String(rawId || '').trim();
                if (!id) continue;
                if (!portalByAccountId[id]) portalByAccountId[id] = user;
            }
        }

        let plexUriForFallback = null;
        let libraryGenreMap = null;
        let libraryGenreMapPromise = null;
        const ensurePlexUri = async () => {
            if (plexUriForFallback) return plexUriForFallback;
            if (typeof getPlexConnectionUri !== 'function') return null;
            plexUriForFallback = await getPlexConnectionUri(config).catch(() => null);
            return plexUriForFallback;
        };
        const ensureLibraryGenreMap = async (uri) => {
            if (libraryGenreMap) return libraryGenreMap;
            if (libraryGenreMapPromise) return libraryGenreMapPromise;
            libraryGenreMapPromise = (async () => {
                if (!uri || typeof fetchPlexJson !== 'function') {
                    libraryGenreMap = {};
                    return libraryGenreMap;
                }
                libraryGenreMap = await warmLibraryGenreCache(
                    () => buildPlexLibraryGenreMap((pathQuery) => fetchPlexJson(uri, config, pathQuery)),
                    { force: !!force },
                ).catch(() => null) || {};
                return libraryGenreMap;
            })();
            return libraryGenreMapPromise;
        };
        const enrichItems = async (items, uri, maxLookups) => {
            if (!items?.length) return items || [];
            const prefetched = await ensureLibraryGenreMap(uri);
            if (typeof fetchPlexMetadataGenres !== 'function' && !prefetched) return items;
            return enrichHistoryGenres(
                items,
                fetchPlexMetadataGenres
                    ? (ratingKey) => fetchPlexMetadataGenres(uri, config, ratingKey)
                    : async () => [],
                { maxLookups, prefetched },
            );
        };
        const historyViaPlexAccount = async (accountId) => {
            if (typeof fetchPlexAccountHistory !== 'function') return [];
            const uri = await ensurePlexUri();
            if (!uri) return [];
            try {
                let items = await fetchPlexAccountHistory(uri, config, accountId, {
                    maxItems: 100000,
                });
                if (items?.length) {
                    items = await enrichItems(items, uri, 800);
                }
                return items || [];
            } catch {
                return [];
            }
        };

        const requestRecords = await loadPortalRequestRecords();

        const commitScore = (target, historyItems, previous) => {
            const portal = portalByAccountId[String(target.accountId)] || {};
            const mediaRequests = countMediaRequestsForIdentity(
                requestRecords,
                identityFromPortalUser(portal, target.accountId),
            );
            const snapshot = scoreTarget({
                target,
                historyItems,
                previous,
                config,
                thumb: thumbByAccountId[String(target.accountId)] || null,
                forceUnlockTimestamps: !!force,
                mediaRequests,
            });
            const prevXp = Number(previous?.xp) || 0;
            const nextXp = Number(snapshot?.xp) || 0;
            // Never clobber a real score with an empty history miss (bad Tautulli match, API blip).
            if (prevXp > 0 && nextXp <= 0 && !(historyItems && historyItems.length)) {
                return {
                    ...previous,
                    username: target.username || previous.username,
                    thumb: thumbByAccountId[String(target.accountId)] || previous.thumb || null,
                };
            }
            return snapshot;
        };

        if (historySource === 'tautulli' && typeof fetchTautulliUserHistoryItems === 'function') {
            const concurrency = 2;
            let cursor = 0;
            let unmatched = 0;
            const workers = Array.from({ length: concurrency }, async () => {
                while (cursor < toScore.length) {
                    const idx = cursor;
                    cursor += 1;
                    const target = toScore[idx];
                    const prev = nextUsers[String(target.accountId)] || {};
                    const portal = portalByAccountId[String(target.accountId)] || {};
                    const plexAccountName = plexNameByAccountId[String(target.accountId)]
                        || target.username
                        || portal.username
                        || null;
                    let items = [];
                    try {
                        items = await fetchTautulliUserHistoryItems(config, {
                            username: target.username || portal.username,
                            email: portal.email,
                            plexAccountName,
                            accountID: target.accountId,
                            maxItems: 100000,
                        });
                    } catch {
                        items = [];
                    }
                    // Tautulli get_history usually has no Genre tags. Without a Plex metadata
                    // lookup, genreMovies_* / genreShows_* stay at 0 and those badges never unlock.
                    if (items.length) {
                        const uri = await ensurePlexUri();
                        if (uri) items = await enrichItems(items, uri, 800);
                    }
                    if (!items.length) {
                        unmatched += 1;
                        items = await historyViaPlexAccount(target.accountId);
                    }
                    nextUsers[String(target.accountId)] = commitScore(target, items, prev);
                }
            });
            await Promise.all(workers);
            if (unmatched > 0) {
                log(`[achievements] Tautulli unmatched/empty for ${unmatched} user(s); used Plex account history fallback where possible.`);
            }
        } else if (mediaServerType === 'plex' && typeof fetchAllPlexHistory === 'function') {
            const uri = await getPlexConnectionUri(config);
            if (!uri) {
                return { ok: false, reason: 'no-plex', processed: 0 };
            }
            let historyItems = await fetchAllPlexHistory(uri, config, { maxItems: PLEX_HISTORY_CAP });
            if (historyItems?.length) {
                historyItems = await enrichItems(historyItems, uri, 2500);
            }
            const byAccount = groupPlexHistoryByAccount(historyItems);
            for (const target of toScore) {
                const prev = nextUsers[String(target.accountId)] || {};
                const items = byAccount.get(String(target.accountId)) || [];
                nextUsers[String(target.accountId)] = commitScore(target, items, prev);
            }
        } else if (['jellyfin', 'emby'].includes(mediaServerType) && typeof fetchJellyfinPlayedItems === 'function') {
            const concurrency = 2;
            let cursor = 0;
            const workers = Array.from({ length: concurrency }, async () => {
                while (cursor < toScore.length) {
                    const idx = cursor;
                    cursor += 1;
                    const target = toScore[idx];
                    const prev = nextUsers[String(target.accountId)] || {};
                    let items = [];
                    try {
                        const raw = await fetchJellyfinPlayedItems(config, target.accountId);
                        items = mapJellyfinPlayedItemsToHistory(raw);
                    } catch {
                        items = [];
                    }
                    nextUsers[String(target.accountId)] = commitScore(target, items, prev);
                }
            });
            await Promise.all(workers);
        } else {
            for (const target of toScore) {
                const prev = nextUsers[String(target.accountId)] || {};
                nextUsers[String(target.accountId)] = commitScore(target, [], prev);
            }
        }

        // Refresh thumbs on existing snapshots even when we only scored a subset.
        for (const target of targets) {
            const key = String(target.accountId);
            const snap = nextUsers[key];
            if (!snap) continue;
            const thumb = thumbByAccountId[key];
            if (thumb && snap.thumb !== thumb) nextUsers[key] = { ...snap, thumb };
            if (!snap.username && usernameByAccountId[key]) {
                nextUsers[key] = { ...nextUsers[key], username: usernameByAccountId[key] };
            }
        }

        const prunedUsers = pruneAchievementAliasSnapshots(nextUsers, {
            targets,
            portalUsers: users,
            adminPlexId,
        });
        const pruneAccountIds = [...new Set([
            ...Object.keys(state.users || {}),
            ...Object.keys(nextUsers),
        ])].filter((id) => !prunedUsers[id]);

        await saveAchievementsState({
            ...state,
            users: prunedUsers,
            historySource,
            pruneAccountIds,
        });
        achievementsLeaderboardSwr.clear();
        lastCompletedAt = Date.now();
        lastResult = { ok: true, processed: toScore.length, missingBefore: missing.length, historySource, at: lastCompletedAt };
        log(`[achievements] Backfill complete (${toScore.length} scored via ${historySource}).`);
        return lastResult;
    })();

    inFlight = run.finally(() => {
        inFlight = null;
    });
    return inFlight;
};
