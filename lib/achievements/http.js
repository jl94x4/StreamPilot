import {
    ACHIEVEMENT_CATEGORIES,
    ackAchievementUnlocks,
    buildLeaderboard,
    buildStatsFromAnalyticsPayload,
    buildStatsFromHistoryItems,
    computeBadgeUnlockXp,
    computeXpBreakdown,
    countBadgeDefinitions,
    DEFAULT_XP_WEIGHTS,
    evaluateAchievements,
    filterHistoryByDays,
    getBadgeDefinitionMap,
    isTautulliWatchHistorySource,
    listActiveSpotlightSeasons,
    listBadgeDefinitions,
    loadAchievementsState,
    normalizeAchievementsConfig,
    normalizeXpWeights,
    setLeaderboardOptOut,
    setMuteUnlockToasts,
    setPinnedBadgeIds,
    snapshotFromEvaluation,
    upsertUserAchievementSnapshot,
    estimateUnlockTimestamps,
    buildMemberDossier,
    persistLeaderboardRankTrace,
    listBoardUsers,
    XP_WEIGHT_LABELS,
    achievementIdentityKey,
    dedupeAchievementSnapshots,
} from './index.js';
import { mediaRequestCountFor } from './requestCounts.js';
import { applyMemberNamePrivacyToRows } from '../privacy/memberPrivacy.js';
import { ensurePortalAchievementsBackfill, getAchievementsBackfillStatus } from './backfill.js';
import { mapJellyfinPlayedItemsToHistory } from './jellyfinMap.js';
import { enrichHistoryGenres, warmLibraryGenreCache } from './enrichGenres.js';
import { buildPlexLibraryGenreMap } from './plexGenreIndex.js';
import {
    GENRE_ENRICHMENT_VERSION,
    snapshotNeedsGenreRescore,
} from './genres.js';
import {
    achievementsPeriodSwr,
    achievementsLeaderboardSwr,
    achievementsThumbsSwr,
    ACHIEVEMENTS_PERIOD_FRESH_MS,
    ACHIEVEMENTS_PERIOD_STALE_MS,
    ACHIEVEMENTS_LEADERBOARD_FRESH_MS,
    ACHIEVEMENTS_LEADERBOARD_STALE_MS,
    ACHIEVEMENTS_THUMBS_FRESH_MS,
    ACHIEVEMENTS_THUMBS_STALE_MS,
} from '../page-swr-cache.js';

/**
 * Mount achievements HTTP routes.
 * deps must provide auth middleware and media-server helpers used by analytics.
 */
export const registerAchievementsRoutes = (app, deps) => {
    const {
        requireAuth,
        requireMember,
        requireAdmin,
        loadFile,
        saveFile,
        CONFIG_PATH,
        USERS_PATH,
        resolveCurrentAdmin,
        getPlexConnectionUri,
        resolveLocalPlexAccountId,
        fetchPlexAccountHistory,
        fetchAllPlexHistory,
        fetchPlexServerAccounts,
        shouldObfuscateAnalyticsViewers,
        resolvePortalAccountId,
        fetchJellyfinPlayedItems,
        fetchPlexMetadataGenres,
        fetchTautulliUserHistoryItems,
        fetchTautulliTimezone,
        getAdminProfile,
        log,
        fetchPlexJson,
    } = deps;

    const isEnabled = async () => {
        const config = await loadFile(CONFIG_PATH, {});
        return !!config.achievementsEnabled;
    };

    const seasonsFromConfig = (config = {}) => (
        Array.isArray(config.achievementsSeasons) ? config.achievementsSeasons : []
    );

    const resolveTimeZone = async (config) => {
        if (typeof fetchTautulliTimezone === 'function') {
            try {
                const tz = await fetchTautulliTimezone(config);
                if (tz) return String(tz);
            } catch {
                /* fall through */
            }
        }
        return String(config.portalTimezone || process.env.PORTAL_TIMEZONE || process.env.TZ || 'UTC');
    };

    const normName = (v) => String(v || '').trim().toLowerCase();

    /** Resolve a usable avatar URL for achievements (Plex /accounts often lacks the owner thumb). */
    const resolveThumbForAccount = async (req, config, accountId, identity = {}) => {
        const username = identity.username || req?.user?.username || null;
        const fromSession = req?.user?.thumb || null;
        if (fromSession) return fromSession;

        try {
            const mediaServerType = String(config.mediaServerType || 'plex').toLowerCase();
            if (mediaServerType === 'plex' && typeof fetchPlexServerAccounts === 'function') {
                const uri = await getPlexConnectionUri(config);
                if (uri) {
                    const acc = await fetchPlexServerAccounts(uri, config);
                    const byId = accountId ? acc?.map?.[String(accountId)] : null;
                    if (byId?.thumb) return byId.thumb;
                    if (username) {
                        const match = (acc?.list || []).find((a) => normName(a.name) === normName(username));
                        if (match?.thumb) return match.thumb;
                    }
                }
            }
            if (USERS_PATH) {
                const users = await loadFile(USERS_PATH, []);
                const hit = (users || []).find((u) => (
                    (accountId && String(u?.plexAccountId || '') === String(accountId))
                    || (username && normName(u?.username) === normName(username))
                ));
                if (hit?.thumb) return hit.thumb;
            }
            if (req?.user?.isAdmin && typeof getAdminProfile === 'function') {
                const profile = await getAdminProfile(config);
                if (profile?.thumb) return profile.thumb;
            }
        } catch {
            /* ignore */
        }
        return null;
    };

    const buildLiveThumbLookup = async (config) => {
        const { value } = await achievementsThumbsSwr.get(
            `thumbs:${String(config.mediaServerType || 'plex')}`,
            async () => {
                const thumbByAccountId = {};
                const thumbByUsername = {};
                const users = USERS_PATH ? await loadFile(USERS_PATH, []) : [];
                const mediaServerType = String(config.mediaServerType || 'plex').toLowerCase();
                if (mediaServerType === 'plex' && typeof fetchPlexServerAccounts === 'function') {
                    const uri = await getPlexConnectionUri(config);
                    if (uri) {
                        const acc = await fetchPlexServerAccounts(uri, config);
                        for (const account of acc?.list || []) {
                            const id = String(account?.id || '').trim();
                            const thumb = account?.thumb || null;
                            if (id && thumb) thumbByAccountId[id] = thumb;
                            const name = normName(account?.name);
                            if (name && thumb) thumbByUsername[name] = thumb;
                        }
                    }
                }
                for (const user of users || []) {
                    const id = String(user?.plexAccountId || '').trim();
                    const thumb = user?.thumb || null;
                    if (id && thumb && !thumbByAccountId[id]) thumbByAccountId[id] = thumb;
                    const name = normName(user?.username);
                    if (name && thumb && !thumbByUsername[name]) thumbByUsername[name] = thumb;
                }
                if (typeof getAdminProfile === 'function') {
                    const profile = await getAdminProfile(config).catch(() => null);
                    if (profile?.thumb) {
                        if (!thumbByAccountId['1']) thumbByAccountId['1'] = profile.thumb;
                    }
                }
                return { thumbByAccountId, thumbByUsername };
            },
            { freshMs: ACHIEVEMENTS_THUMBS_FRESH_MS, staleMs: ACHIEVEMENTS_THUMBS_STALE_MS },
        );
        return {
            thumbByAccountId: { ...(value?.thumbByAccountId || {}) },
            thumbByUsername: { ...(value?.thumbByUsername || {}) },
        };
    };

    const resolveAccountContext = async (req) => {
        const config = await loadFile(CONFIG_PATH, {});
        req.user.isAdmin = !!(req.user?.actor && req.user?.impersonatingUserId)
            ? false
            : await resolveCurrentAdmin(req.user, config);
        let accountId = null;
        const username = req.user?.username || req.user?.email || null;
        const email = req.user?.email || null;
        const mediaServerType = String(config.mediaServerType || 'plex').toLowerCase();

        if (typeof resolvePortalAccountId === 'function') {
            accountId = await resolvePortalAccountId(req, config);
        } else if (mediaServerType === 'plex') {
            const uri = await getPlexConnectionUri(config);
            if (uri) accountId = await resolveLocalPlexAccountId(config, uri, req.user);
        }

        return { config, accountId, username, email, mediaServerType };
    };

    const gatherHistoryAndStats = async (req, config, accountId, identity = {}, opts = {}) => {
        const mediaServerType = String(config.mediaServerType || 'plex').toLowerCase();
        const maxItems = Math.max(1000, Number(opts.maxItems) || 25000);
        const genreLookups = Math.max(0, Number(opts.genreLookups) || 0);
        const timeZone = opts.timeZone || await resolveTimeZone(config);
        const statsOpts = {
            timeZone,
            minPercentComplete: Number(config.achievementsMinPercentComplete) || 0,
        };

        const maybeEnrich = async (historyItems, lookups = genreLookups) => {
            let items = historyItems || [];
            const maxLookups = Math.max(0, Number(lookups) || 0);
            const uri = typeof getPlexConnectionUri === 'function'
                ? await getPlexConnectionUri(config).catch(() => null)
                : null;
            if (!uri) return items;

            let prefetched = null;
            if (typeof fetchPlexJson === 'function') {
                prefetched = await warmLibraryGenreCache(
                    () => buildPlexLibraryGenreMap((pathQuery) => fetchPlexJson(uri, config, pathQuery)),
                ).catch(() => null);
            }
            items = await enrichHistoryGenres(
                items,
                fetchPlexMetadataGenres
                    ? (ratingKey) => fetchPlexMetadataGenres(uri, config, ratingKey)
                    : async () => [],
                { maxLookups, prefetched },
            );
            return items;
        };

        const attachRequestCount = async (stats) => {
            try {
                const users = typeof loadFile === 'function' ? await loadFile(USERS_PATH, []) : [];
                stats.mediaRequests = await mediaRequestCountFor({
                    users,
                    accountId,
                    identity: {
                        username: identity.username || req?.user?.username,
                        email: identity.email || req?.user?.email,
                        portalUserId: req?.user?.id,
                        plexId: req?.user?.plexId,
                        plexAccountId: accountId,
                    },
                });
            } catch {
                stats.mediaRequests = Number(stats.mediaRequests) || 0;
            }
            return stats;
        };
        const finish = async (payload) => {
            if (payload?.stats) await attachRequestCount(payload.stats);
            return payload;
        };

        if (mediaServerType === 'plex' && accountId) {
            if (isTautulliWatchHistorySource(config) && typeof fetchTautulliUserHistoryItems === 'function') {
                try {
                    let historyItems = await fetchTautulliUserHistoryItems(config, {
                        username: identity.username || req?.user?.username,
                        email: identity.email || req?.user?.email,
                        plexAccountName: identity.plexAccountName || identity.username,
                        accountID: accountId,
                        maxItems,
                    });
                    if (historyItems?.length) {
                        // Tautulli rows rarely include genres; look them up on Plex like the Plex history path.
                        historyItems = await maybeEnrich(historyItems, Math.max(genreLookups, 800));
                        return finish({
                            historyItems,
                            stats: buildStatsFromHistoryItems(historyItems, statsOpts),
                            timeZone,
                        });
                    }
                } catch (e) {
                    if (typeof log === 'function') {
                        log(`[achievements] Tautulli history failed, falling back to Plex: ${e?.message || e}`);
                    }
                }
            }

            const uri = await getPlexConnectionUri(config);
            if (!uri) {
                return finish({ historyItems: [], stats: buildStatsFromAnalyticsPayload({}, statsOpts), timeZone });
            }
            let historyItems = await fetchPlexAccountHistory(uri, config, accountId, { maxItems });
            historyItems = await maybeEnrich(historyItems || []);
            return finish({
                historyItems,
                stats: buildStatsFromHistoryItems(historyItems || [], statsOpts),
                timeZone,
            });
        }

        if (['jellyfin', 'emby'].includes(mediaServerType) && accountId && typeof fetchJellyfinPlayedItems === 'function') {
            try {
                const items = await fetchJellyfinPlayedItems(config, accountId);
                if (Array.isArray(items) && items.length) {
                    const historyItems = mapJellyfinPlayedItemsToHistory(items);
                    return finish({
                        historyItems,
                        stats: buildStatsFromHistoryItems(historyItems, statsOpts),
                        timeZone,
                    });
                }
            } catch {
                /* fall through */
            }
        }
        return finish({ historyItems: [], stats: buildStatsFromAnalyticsPayload({}, statsOpts), timeZone });
    };

    const resolveToastIds = (evaluation, prev = {}) => {
        const seen = new Set(Array.isArray(prev.seenUnlockIds) ? prev.seenUnlockIds.map(String) : []);
        const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        const candidates = (evaluation.earned || []).filter((b) => {
            if (!b?.id || seen.has(String(b.id))) return false;
            const at = Date.parse(b.earnedAt || '');
            if (!Number.isFinite(at)) return !seen.size;
            return at >= weekAgo || !seen.size;
        });
        // First visit with a huge catalog: silently skip toast spam.
        if (!seen.size && candidates.length > 8) return [];
        return candidates.map((b) => String(b.id));
    };

    const slimBadge = (b) => ({
        id: b.id,
        name: b.name,
        description: b.description,
        icon: b.icon,
        category: b.category,
        rarity: b.rarity,
        progress: b.progress,
        threshold: b.threshold,
        progressPct: b.progressPct,
        earned: b.earned,
        earnedAt: b.earnedAt,
    });

    const buildMePayload = (config, accountId, username, evaluation, prev = {}, extra = {}) => {
        const compact = !!extra.compact;
        const earnedSorted = [...evaluation.earned].sort((a, b) => String(b.earnedAt || '').localeCompare(String(a.earnedAt || '')));
        const newlyEarnedIds = Array.isArray(extra.newlyEarnedIds)
            ? extra.newlyEarnedIds
            : resolveToastIds(evaluation, prev);
        const base = {
            enabled: true,
            accountId: accountId ? String(accountId) : null,
            xp: evaluation.xp,
            level: evaluation.level,
            levelProgress: evaluation.levelProgress,
            breakdown: evaluation.breakdown,
            stats: evaluation.stats,
            earnedCount: evaluation.earnedCount,
            totalBadges: evaluation.totalBadges,
            recentEarned: earnedSorted.slice(0, 8).map(slimBadge),
            nextUnlocks: evaluation.nextUnlocks || [],
            newlyEarnedIds,
            categories: ACHIEVEMENT_CATEGORIES,
            leaderboardEnabled: config.achievementsLeaderboardEnabled !== false,
            leaderboardOptOut: !!prev.leaderboardOptOut,
            notifyOnUnlock: prev.muteUnlockToasts !== true,
            pinnedBadgeIds: Array.isArray(prev.pinnedBadgeIds)
                ? prev.pinnedBadgeIds.map(String).filter(Boolean).slice(0, 3)
                : [],
            activeSeasons: listActiveSpotlightSeasons(config.achievementsSeasons || []),
            showOnProfile: config.achievementsShowOnProfile !== false,
            homeWidgetEnabled: config.achievementsHomeWidgetEnabled !== false,
            watchHistorySource: config.watchHistorySource === 'tautulli' ? 'tautulli' : 'plex',
        };
        if (!compact) {
            base.badges = evaluation.badgeResults;
            base.earned = earnedSorted;
        } else {
            base.earned = earnedSorted.slice(0, 24).map(slimBadge);
        }
        const { compact: _c, newlyEarnedIds: _n, ...restExtra } = extra;
        return { ...base, ...restExtra };
    };

    const ME_CACHE_MS = 15 * 60 * 1000;
    const refreshJobs = new Map();
    const snapshotEvalCache = new Map();
    const SNAPSHOT_EVAL_CACHE_MAX_ENTRIES = 128;

    const evaluateFromSnapshot = (accountId, prev, config) => {
        const key = String(accountId);
        const updatedAt = String(prev?.updatedAt || '');
        const hit = snapshotEvalCache.get(key);
        if (hit && hit.updatedAt === updatedAt) return hit.evaluation;
        const evaluation = evaluateAchievements({
            stats: prev.stats || {},
            previousBadges: prev.badges || {},
            weights: normalizeXpWeights(config.achievementsXpWeights),
            disabledBadgeIds: config.achievementsDisabledBadgeIds,
            seasons: seasonsFromConfig(config),
        });
        if (!snapshotEvalCache.has(key) && snapshotEvalCache.size >= SNAPSHOT_EVAL_CACHE_MAX_ENTRIES) {
            const oldest = snapshotEvalCache.keys().next().value;
            if (oldest !== undefined) snapshotEvalCache.delete(oldest);
        }
        snapshotEvalCache.set(key, { updatedAt, evaluation });
        return evaluation;
    };

    const scheduleMeRefresh = (accountId, username, email, config) => {
        const key = String(accountId);
        if (refreshJobs.has(key)) return;
        const job = (async () => {
            try {
                const state = await loadAchievementsState();
                const prev = state.users?.[key] || {};
                const { historyItems, stats, timeZone } = await gatherHistoryAndStats(null, config, accountId, {
                    username,
                    email,
                    plexAccountName: username,
                }, { maxItems: 50000, genreLookups: 800 });
                const unlockTimestamps = historyItems?.length
                    ? estimateUnlockTimestamps(historyItems, {
                        timeZone,
                        minPercentComplete: Number(config.achievementsMinPercentComplete) || 0,
                        weights: normalizeXpWeights(config.achievementsXpWeights),
                        seasons: seasonsFromConfig(config),
                        disabledBadgeIds: config.achievementsDisabledBadgeIds,
                    })
                    : {};
                const evaluation = evaluateAchievements({
                    stats,
                    previousBadges: prev.badges || {},
                    weights: normalizeXpWeights(config.achievementsXpWeights),
                    disabledBadgeIds: config.achievementsDisabledBadgeIds,
                    seasons: seasonsFromConfig(config),
                    unlockTimestamps,
                });
                const snapshot = snapshotFromEvaluation(accountId, username, evaluation, {
                    leaderboardOptOut: !!prev.leaderboardOptOut,
                    genreEnrichmentVersion: GENRE_ENRICHMENT_VERSION,
                });
                if (prev.thumb) snapshot.thumb = prev.thumb;
                else {
                    const liveThumb = await resolveThumbForAccount(
                        { user: { username, email, thumb: null, isAdmin: false } },
                        config,
                        accountId,
                        { username, email },
                    ).catch(() => null);
                    if (liveThumb) snapshot.thumb = liveThumb;
                }
                if (Array.isArray(prev.seenUnlockIds)) snapshot.seenUnlockIds = prev.seenUnlockIds;
                if (Array.isArray(prev.pinnedBadgeIds)) snapshot.pinnedBadgeIds = prev.pinnedBadgeIds;
                if (prev.muteUnlockToasts != null) snapshot.muteUnlockToasts = prev.muteUnlockToasts;
                await upsertUserAchievementSnapshot(snapshot);
            } catch (e) {
                if (typeof log === 'function') log(`[achievements] Background /me refresh failed: ${e?.message || e}`);
            } finally {
                refreshJobs.delete(key);
            }
        })();
        refreshJobs.set(key, job);
    };

    const runLeaderboardBackfill = async (opts = {}) => {
        try {
            return await ensurePortalAchievementsBackfill({
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
                log,
            }, { force: !!opts.force });
        } catch (e) {
            if (typeof log === 'function') log(`[achievements] Leaderboard backfill failed: ${e?.message || e}`);
            return { ok: false, reason: e?.message || 'error', processed: 0 };
        }
    };

    app.get('/api/achievements/meta', requireAuth, requireMember, async (req, res) => {
        const config = await loadFile(CONFIG_PATH, {});
        const normalized = normalizeAchievementsConfig(config);
        const payload = {
            enabled: normalized.achievementsEnabled,
            leaderboardEnabled: normalized.achievementsLeaderboardEnabled,
            homeWidgetEnabled: normalized.achievementsHomeWidgetEnabled,
            showOnProfile: normalized.achievementsShowOnProfile,
            totalBadges: countBadgeDefinitions(),
            categories: ACHIEVEMENT_CATEGORIES,
            watchHistorySource: normalized.watchHistorySource,
            xpWeights: normalizeXpWeights(normalized.achievementsXpWeights),
            defaultXpWeights: DEFAULT_XP_WEIGHTS,
            xpWeightLabels: XP_WEIGHT_LABELS,
            disabledBadgeIds: normalized.achievementsDisabledBadgeIds,
        };
        if (String(req.query.catalog || '') === '1') {
            payload.catalog = listBadgeDefinitions().map((b) => ({
                id: b.id,
                name: b.name,
                icon: b.icon,
                category: b.category,
            }));
        }
        res.json(payload);
    });

    app.get('/api/achievements/me', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await isEnabled())) {
                return res.status(404).json({ error: 'Achievements are disabled.' });
            }
            const { config, accountId, username, email } = await resolveAccountContext(req);
            const compact = String(req.query.view || '') === 'summary' || String(req.query.compact || '') === '1';
            const daysParam = req.query.days;
            const wantPeriod = daysParam != null && String(daysParam) !== '';

            if (!accountId) {
                return res.json({
                    enabled: true,
                    accountId: null,
                    xp: 0,
                    level: 1,
                    earnedCount: 0,
                    totalBadges: countBadgeDefinitions(),
                    badges: [],
                    earned: [],
                    nextUnlocks: [],
                    categories: ACHIEVEMENT_CATEGORIES,
                    leaderboardEnabled: config.achievementsLeaderboardEnabled !== false,
                    leaderboardOptOut: false,
                    showOnProfile: config.achievementsShowOnProfile !== false,
                    watchHistorySource: config.watchHistorySource === 'tautulli' ? 'tautulli' : 'plex',
                });
            }

            const forceFresh = String(req.query.fresh || '') === '1';
            const state = await loadAchievementsState();
            const prev = state.users?.[String(accountId)] || {};
            const updatedMs = prev.updatedAt ? Date.parse(prev.updatedAt) : 0;
            const cacheAge = updatedMs ? Date.now() - updatedMs : Number.POSITIVE_INFINITY;
            const hasSnapshot = !!(prev.stats && prev.badges && Number.isFinite(updatedMs));
            const snapshotFresh = hasSnapshot && cacheAge < ME_CACHE_MS;

            const attachPeriod = async (payload, historyItems, timeZone, evaluation = null) => {
                if (!wantPeriod) return payload;
                const periodItems = filterHistoryByDays(historyItems || [], daysParam);
                const periodStats = buildStatsFromHistoryItems(periodItems, {
                    timeZone,
                    minPercentComplete: Number(config.achievementsMinPercentComplete) || 0,
                });
                const weights = normalizeXpWeights(config.achievementsXpWeights);
                const { parts } = computeXpBreakdown(periodStats, weights);
                const daysNum = parseInt(String(daysParam), 10);
                const periodStartMs = String(daysParam) === 'all'
                    ? 0
                    : (Date.now() - ((Number.isFinite(daysNum) ? daysNum : 30) * 24 * 60 * 60 * 1000));
                const earnedList = evaluation?.earned || payload.earned || payload.recentEarned || [];
                const periodBadgeList = earnedList.filter((b) => {
                    const at = Date.parse(b?.earnedAt || '');
                    return Number.isFinite(at) && at >= periodStartMs;
                });
                parts.badgeUnlocks = computeBadgeUnlockXp(periodBadgeList, weights.badgeUnlocks);
                const xp = Object.values(parts).reduce((sum, value) => sum + (Number(value) || 0), 0);

                let priorPeriodXp = null;
                if (Number.isFinite(daysNum) && daysNum > 0 && String(daysParam) !== 'all') {
                    const nowSec = Math.floor(Date.now() / 1000);
                    const currentAfter = nowSec - (daysNum * 24 * 60 * 60);
                    const priorAfter = nowSec - (daysNum * 2 * 24 * 60 * 60);
                    const priorItems = (historyItems || []).filter((item) => {
                        const at = Number(item?.viewedAt) || 0;
                        return at >= priorAfter && at < currentAfter;
                    });
                    const priorStats = buildStatsFromHistoryItems(priorItems, {
                        timeZone,
                        minPercentComplete: Number(config.achievementsMinPercentComplete) || 0,
                    });
                    const priorParts = computeXpBreakdown(priorStats, weights).parts;
                    const priorBadgeList = earnedList.filter((b) => {
                        const at = Date.parse(b?.earnedAt || '');
                        return Number.isFinite(at) && at >= priorAfter * 1000 && at < currentAfter * 1000;
                    });
                    priorParts.badgeUnlocks = computeBadgeUnlockXp(priorBadgeList, weights.badgeUnlocks);
                    priorPeriodXp = Object.values(priorParts).reduce((sum, value) => sum + (Number(value) || 0), 0);
                }

                const periodBadgesEarned = periodBadgeList.length;

                return {
                    ...payload,
                    periodDays: daysParam === 'all' ? 'all' : Number(daysParam) || daysParam,
                    periodXp: xp,
                    periodBreakdown: parts,
                    priorPeriodXp,
                    periodXpDelta: priorPeriodXp == null ? null : xp - priorPeriodXp,
                    periodBadgesEarned,
                    periodStats: {
                        totalPlays: periodStats.totalPlays,
                        hoursWatched: periodStats.hoursWatched,
                        activeDays: periodStats.activeDays,
                        uniqueTitles: periodStats.uniqueTitles,
                    },
                };
            };

            const needsGenreRescore = snapshotNeedsGenreRescore(prev);

            // Fast path: serve last snapshot immediately, refresh in background.
            // Stale snapshots still paint instantly — only a hard miss waits on history.
            // Genre stats stuck at 0 after a history-without-tags snapshot must rescore live.
            if (!forceFresh && hasSnapshot && !wantPeriod && !needsGenreRescore) {
                const cachedEval = evaluateFromSnapshot(accountId, prev, config);
                if (!snapshotFresh) scheduleMeRefresh(accountId, username, email, config);
                return res.json(buildMePayload(config, accountId, username, cachedEval, prev, {
                    compact,
                    newlyEarnedIds: resolveToastIds(cachedEval, prev),
                    cached: true,
                    refreshing: !snapshotFresh,
                }));
            }

            if (!forceFresh && wantPeriod && hasSnapshot && !needsGenreRescore) {
                const cachedEval = evaluateFromSnapshot(accountId, prev, config);
                const basePayload = buildMePayload(config, accountId, username, cachedEval, prev, {
                    compact,
                    newlyEarnedIds: resolveToastIds(cachedEval, prev),
                    cached: true,
                    refreshing: !snapshotFresh,
                });
                const periodKey = `${accountId}:${String(daysParam)}`;
                const { value: periodOverlay } = await achievementsPeriodSwr.get(
                    periodKey,
                    async () => {
                        const { historyItems, timeZone } = await gatherHistoryAndStats(req, config, accountId, {
                            username,
                            email,
                            plexAccountName: username,
                        }, { maxItems: 50000, genreLookups: 0 });
                        const withPeriod = await attachPeriod(basePayload, historyItems, timeZone, cachedEval);
                        return {
                            periodDays: withPeriod.periodDays,
                            periodXp: withPeriod.periodXp,
                            periodBreakdown: withPeriod.periodBreakdown,
                            priorPeriodXp: withPeriod.priorPeriodXp,
                            periodXpDelta: withPeriod.periodXpDelta,
                            periodBadgesEarned: withPeriod.periodBadgesEarned,
                            periodStats: withPeriod.periodStats,
                        };
                    },
                    { freshMs: ACHIEVEMENTS_PERIOD_FRESH_MS, staleMs: ACHIEVEMENTS_PERIOD_STALE_MS },
                );
                if (!snapshotFresh) scheduleMeRefresh(accountId, username, email, config);
                return res.json({ ...basePayload, ...(periodOverlay || {}) });
            }

            const { historyItems, stats, timeZone } = await gatherHistoryAndStats(req, config, accountId, {
                username,
                email,
                plexAccountName: username,
            }, { maxItems: wantPeriod ? 50000 : 25000, genreLookups: compact ? 400 : 800 });

            const unlockTimestamps = historyItems?.length
                ? estimateUnlockTimestamps(historyItems, {
                    timeZone,
                    minPercentComplete: Number(config.achievementsMinPercentComplete) || 0,
                    weights: normalizeXpWeights(config.achievementsXpWeights),
                    seasons: seasonsFromConfig(config),
                    disabledBadgeIds: config.achievementsDisabledBadgeIds,
                })
                : {};
            const evaluation = evaluateAchievements({
                stats,
                previousBadges: prev.badges || {},
                weights: normalizeXpWeights(config.achievementsXpWeights),
                disabledBadgeIds: config.achievementsDisabledBadgeIds,
                seasons: seasonsFromConfig(config),
                unlockTimestamps,
            });
            const snapshot = snapshotFromEvaluation(accountId, username, evaluation, {
                leaderboardOptOut: !!prev.leaderboardOptOut,
                genreEnrichmentVersion: GENRE_ENRICHMENT_VERSION,
            });
            if (prev.thumb) snapshot.thumb = prev.thumb;
            else {
                const liveThumb = await resolveThumbForAccount(req, config, accountId, { username, email });
                if (liveThumb) snapshot.thumb = liveThumb;
            }
            if (Array.isArray(prev.seenUnlockIds)) snapshot.seenUnlockIds = prev.seenUnlockIds;
            if (Array.isArray(prev.pinnedBadgeIds)) snapshot.pinnedBadgeIds = prev.pinnedBadgeIds;
            if (prev.muteUnlockToasts != null) snapshot.muteUnlockToasts = prev.muteUnlockToasts;
            await upsertUserAchievementSnapshot(snapshot);

            let payload = buildMePayload(config, accountId, username, evaluation, prev, {
                compact,
                cached: false,
                refreshing: false,
            });
            payload = await attachPeriod(payload, historyItems, timeZone, evaluation);
            res.json(payload);
        } catch (e) {
            res.status(500).json({ error: e.message || 'Achievements error' });
        }
    });

    app.post('/api/achievements/me/ack-unlocks', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await isEnabled())) {
                return res.status(404).json({ error: 'Achievements are disabled.' });
            }
            const { accountId } = await resolveAccountContext(req);
            if (!accountId) return res.status(400).json({ error: 'No account id' });
            const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
            const seenUnlockIds = await ackAchievementUnlocks(accountId, ids);
            res.json({ ok: true, seenUnlockIds });
        } catch (e) {
            res.status(500).json({ error: e.message || 'Ack failed' });
        }
    });

    app.get('/api/achievements/leaderboard', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await isEnabled())) {
                return res.status(404).json({ error: 'Achievements are disabled.' });
            }
            const config = await loadFile(CONFIG_PATH, {});
            if (config.achievementsLeaderboardEnabled === false) {
                return res.json({ enabled: false, entries: [] });
            }

            const { accountId } = await resolveAccountContext(req);
            const obfuscate = shouldObfuscateAnalyticsViewers
                ? shouldObfuscateAnalyticsViewers(req.user, config)
                : false;
            const limit = parseInt(String(req.query.limit || '50'), 10) || 50;
            const boardKey = `lb:named:${limit}`;
            const thumbsKey = `thumbs:${String(config.mediaServerType || 'plex')}`;
            const { value } = await achievementsLeaderboardSwr.get(
                boardKey,
                async () => {
                    const state = await loadAchievementsState();
                    const peeked = achievementsThumbsSwr.peek(thumbsKey);
                    void buildLiveThumbLookup(config);
                    const entries = buildLeaderboard(state, {
                        limit,
                        obfuscate: false,
                        viewerAccountId: null,
                        thumbByAccountId: peeked?.value?.thumbByAccountId || {},
                        thumbByUsername: peeked?.value?.thumbByUsername || {},
                    });
                    const orderedIds = listBoardUsers(state)
                        .slice(0, Math.max(1, Math.min(200, limit)))
                        .map((u) => u.accountId);
                    void persistLeaderboardRankTrace(orderedIds).catch(() => null);
                    return { entries };
                },
                { freshMs: ACHIEVEMENTS_LEADERBOARD_FRESH_MS, staleMs: ACHIEVEMENTS_LEADERBOARD_STALE_MS },
            );

            const viewerIdentity = achievementIdentityKey({
                username: req.user?.username || req.user?.email,
                accountId,
            });
            const entries = dedupeAchievementSnapshots(
                Array.isArray(value?.entries) ? value.entries : [],
                { preferAccountId: accountId },
            )
                .sort((a, b) => (Number(b.xp) || 0) - (Number(a.xp) || 0)
                    || (Number(b.earnedCount) || 0) - (Number(a.earnedCount) || 0))
                .map((entry, index) => {
                    const rank = index + 1;
                    const isMe = (accountId != null && String(entry.accountId) === String(accountId))
                        || (!!viewerIdentity && !viewerIdentity.startsWith('id:')
                            && achievementIdentityKey(entry) === viewerIdentity);
                    const ranked = { ...entry, rank, isMe };
                    if (!obfuscate) return ranked;
                    return {
                        ...ranked,
                        accountId: isMe ? entry.accountId : undefined,
                        username: isMe ? (entry.username || 'You') : `Viewer ${rank}`,
                        thumb: isMe ? entry.thumb : null,
                    };
                });
            const viewerThumb = req.user?.thumb || null;
            if (viewerThumb) {
                for (const entry of entries) {
                    if (entry.isMe) entry.thumb = viewerThumb;
                }
            }

            const portalUsers = await loadFile(USERS_PATH, []);
            const privateEntries = applyMemberNamePrivacyToRows(entries, portalUsers, {
                obfuscate,
                viewerIsAdmin: !!req.user?.isAdmin,
            });

            res.json({
                enabled: true,
                entries: privateEntries,
                populated: true,
                syncing: !!getAchievementsBackfillStatus().inFlight,
            });
        } catch (e) {
            res.status(500).json({ error: e.message || 'Leaderboard error' });
        }
    });

    app.get('/api/achievements/dossier', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await isEnabled())) {
                return res.status(404).json({ error: 'Achievements are disabled.' });
            }
            const config = await loadFile(CONFIG_PATH, {});
            if (config.achievementsLeaderboardEnabled === false) {
                return res.status(404).json({ error: 'Leaderboard is disabled.' });
            }

            const { accountId: viewerAccountId } = await resolveAccountContext(req);
            const obfuscate = shouldObfuscateAnalyticsViewers
                ? shouldObfuscateAnalyticsViewers(req.user, config)
                : false;

            const queryAccountId = String(req.query.accountId || '').trim() || null;
            const queryRank = req.query.rank != null ? parseInt(String(req.query.rank), 10) : null;
            if (!queryAccountId && !(Number.isFinite(queryRank) && queryRank > 0)) {
                return res.status(400).json({ error: 'accountId or rank required' });
            }

            const state = await loadAchievementsState();
            const { thumbByAccountId } = await buildLiveThumbLookup(config);
            const dossier = buildMemberDossier(state, {
                accountId: queryAccountId,
                rank: queryRank,
                viewerAccountId,
                obfuscate,
                thumbByAccountId,
                weights: config.achievementsXpWeights,
            });
            if (!dossier) return res.status(404).json({ error: 'Member not found on the leaderboard' });
            res.json(dossier);
        } catch (e) {
            res.status(500).json({ error: e.message || 'Dossier error' });
        }
    });

    app.post('/api/achievements/me/opt-out', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await isEnabled())) {
                return res.status(404).json({ error: 'Achievements are disabled.' });
            }
            const { accountId } = await resolveAccountContext(req);
            if (!accountId) return res.status(400).json({ error: 'No account id' });
            const updated = await setLeaderboardOptOut(accountId, !!req.body?.optOut);
            try {
                const users = await loadFile(USERS_PATH, []);
                const username = String(req.user?.username || '').trim().toLowerCase();
                const idx = users.findIndex((user) => {
                    if (!user) return false;
                    const ids = [user.id, user.plexId, user.plexAccountId, user.jellyfinId]
                        .map((value) => String(value || '').trim())
                        .filter(Boolean);
                    if (ids.includes(String(accountId))) return true;
                    return username && String(user.username || '').trim().toLowerCase() === username;
                });
                if (idx >= 0) {
                    users[idx].privacyShowAchievements = !updated.leaderboardOptOut;
                    if (typeof saveFile === 'function' && USERS_PATH) {
                        await saveFile(USERS_PATH, users);
                    }
                }
            } catch {
                /* portal user sync is best-effort */
            }
            res.json({ ok: true, leaderboardOptOut: !!updated.leaderboardOptOut });
        } catch (e) {
            res.status(500).json({ error: e.message || 'Opt-out failed' });
        }
    });

    app.post('/api/achievements/me/notify', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await isEnabled())) {
                return res.status(404).json({ error: 'Achievements are disabled.' });
            }
            const { accountId } = await resolveAccountContext(req);
            if (!accountId) return res.status(400).json({ error: 'No account id' });
            const notifyOnUnlock = req.body?.notifyOnUnlock !== false;
            const updated = await setMuteUnlockToasts(accountId, !notifyOnUnlock);
            res.json({ ok: true, notifyOnUnlock: updated.muteUnlockToasts !== true });
        } catch (e) {
            res.status(500).json({ error: e.message || 'Notify preference failed' });
        }
    });

    app.post('/api/achievements/me/pins', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await isEnabled())) {
                return res.status(404).json({ error: 'Achievements are disabled.' });
            }
            const { accountId } = await resolveAccountContext(req);
            if (!accountId) return res.status(400).json({ error: 'No account id' });
            const updated = await setPinnedBadgeIds(accountId, req.body?.ids || req.body?.pinnedBadgeIds || []);
            res.json({ ok: true, pinnedBadgeIds: updated.pinnedBadgeIds || [] });
        } catch (e) {
            res.status(500).json({ error: e.message || 'Pin update failed' });
        }
    });

    app.get('/api/achievements/badge/:badgeId', requireAuth, requireMember, async (req, res) => {
        try {
            if (!(await isEnabled())) {
                return res.status(404).json({ error: 'Achievements are disabled.' });
            }
            const badgeId = String(req.params.badgeId || '').trim();
            const def = getBadgeDefinitionMap().get(badgeId);
            if (!def) return res.status(404).json({ error: 'Badge not found' });

            const config = await loadFile(CONFIG_PATH, {});
            const state = await loadAchievementsState();
            const users = Object.values(state.users || {});
            const holders = [];
            for (const user of users) {
                const badge = user?.badges?.[badgeId];
                if (!badge?.earnedAt || badge?.revokedAt || user?.leaderboardOptOut) continue;
                holders.push({
                    accountId: user.accountId,
                    username: user.username || 'Member',
                    xp: Number(user.xp) || 0,
                    level: Number(user.level) || 1,
                    earnedAt: badge.earnedAt,
                    thumb: user.thumb || null,
                });
            }
            holders.sort((a, b) => String(a.earnedAt).localeCompare(String(b.earnedAt)));
            const uniqueHolders = [];
            const seenHolders = new Set();
            for (const holder of holders) {
                const key = achievementIdentityKey(holder);
                if (seenHolders.has(key)) continue;
                seenHolders.add(key);
                uniqueHolders.push(holder);
            }

            const { accountId } = await resolveAccountContext(req);
            const obfuscate = shouldObfuscateAnalyticsViewers
                ? shouldObfuscateAnalyticsViewers(req.user, config)
                : false;
            const me = accountId ? state.users?.[String(accountId)] : null;
            const mine = me?.badges?.[badgeId] || null;
            const progress = Number(me?.stats?.[def.metric] ?? me?.stats?.level ?? 0) || 0;
            const threshold = Number(def.threshold) || 0;
            const boardUsers = listBoardUsers(state);
            const earliestHolders = uniqueHolders.slice(0, 8).map((holder, index) => {
                const isMe = accountId != null && String(holder.accountId) === String(accountId);
                if (!obfuscate || isMe) return holder;
                return {
                    ...holder,
                    accountId: undefined,
                    username: `Viewer ${index + 1}`,
                    thumb: null,
                };
            });

            res.json({
                id: def.id,
                name: def.name,
                description: def.description,
                icon: def.icon,
                category: def.category,
                rarity: def.rarity,
                metric: def.metric,
                threshold,
                activeFrom: def.activeFrom || null,
                activeUntil: def.activeUntil || null,
                seasonActive: true,
                unlockCount: uniqueHolders.length,
                totalUsers: boardUsers.length,
                you: {
                    earned: !!(mine?.earnedAt && !mine?.revokedAt),
                    earnedAt: mine?.earnedAt || null,
                    progress,
                    progressPct: threshold > 0 ? Math.min(100, Math.round((progress / threshold) * 100)) : 0,
                    pinned: Array.isArray(me?.pinnedBadgeIds) && me.pinnedBadgeIds.map(String).includes(badgeId),
                },
                earliestHolders,
                seasons: seasonsFromConfig(config).filter((s) => Array.isArray(s.badgeIds) && s.badgeIds.map(String).includes(badgeId)),
            });
        } catch (e) {
            res.status(500).json({ error: e.message || 'Badge lookup failed' });
        }
    });

    app.get('/api/achievements/admin/user/:accountId/audit', requireAuth, requireAdmin, async (req, res) => {
        try {
            if (!(await isEnabled())) {
                return res.status(404).json({ error: 'Achievements are disabled.' });
            }
            const config = await loadFile(CONFIG_PATH, {});
            const state = await loadAchievementsState();
            const snap = state.users?.[String(req.params.accountId)];
            if (!snap) return res.status(404).json({ error: 'No achievements snapshot for user' });
            const breakdown = snap.breakdown && typeof snap.breakdown === 'object' && !Array.isArray(snap.breakdown)
                ? snap.breakdown
                : (Array.isArray(snap.breakdown) && snap.breakdown.length
                    ? Object.fromEntries(snap.breakdown.map((row) => [row.key || row.metric || row.id, Number(row.xp ?? row.value ?? row.points) || 0]))
                    : computeXpBreakdown(snap.stats || {}, normalizeXpWeights(config.achievementsXpWeights)).parts);
            res.json({
                accountId: snap.accountId,
                username: snap.username,
                xp: Number(snap.xp) || 0,
                level: Number(snap.level) || 1,
                earnedCount: Number(snap.earnedCount) || 0,
                totalBadges: Number(snap.totalBadges) || countBadgeDefinitions(),
                updatedAt: snap.updatedAt || null,
                watchHistorySource: config.watchHistorySource === 'tautulli' ? 'tautulli' : 'plex',
                leaderboardOptOut: !!snap.leaderboardOptOut,
                muteUnlockToasts: !!snap.muteUnlockToasts,
                pinnedBadgeIds: Array.isArray(snap.pinnedBadgeIds) ? snap.pinnedBadgeIds : [],
                stats: snap.stats || {},
                breakdown,
                recentBadges: Object.entries(snap.badges || {})
                    .filter(([, b]) => b?.earnedAt && !b?.revokedAt)
                    .map(([id, b]) => ({ id, earnedAt: b.earnedAt }))
                    .sort((a, b) => String(b.earnedAt).localeCompare(String(a.earnedAt)))
                    .slice(0, 12),
            });
        } catch (e) {
            res.status(500).json({ error: e.message || 'Audit failed' });
        }
    });

    app.get('/api/achievements/user/:accountId', requireAuth, requireAdmin, async (req, res) => {
        try {
            if (!(await isEnabled())) {
                return res.status(404).json({ error: 'Achievements are disabled.' });
            }
            const state = await loadAchievementsState();
            const snap = state.users?.[String(req.params.accountId)];
            if (!snap) return res.status(404).json({ error: 'No achievements snapshot for user' });
            res.json(snap);
        } catch (e) {
            res.status(500).json({ error: e.message || 'Achievements error' });
        }
    });

    app.get('/api/achievements/admin/backfill', requireAuth, requireAdmin, async (_req, res) => {
        res.json({
            ...getAchievementsBackfillStatus(),
            enabled: !!(await isEnabled()),
        });
    });

    app.post('/api/achievements/admin/backfill', requireAuth, requireAdmin, async (req, res) => {
        try {
            if (!(await isEnabled())) {
                return res.status(404).json({ error: 'Achievements are disabled.' });
            }
            const force = req.body?.force !== false;
            const result = await ensurePortalAchievementsBackfill({
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
                log,
            }, { force });
            res.json({ ok: true, result, status: getAchievementsBackfillStatus() });
        } catch (e) {
            res.status(500).json({ error: e.message || 'Backfill failed' });
        }
    });

    app.get('/api/achievements/admin/insights', requireAuth, requireAdmin, async (_req, res) => {
        try {
            if (!(await isEnabled())) {
                return res.status(404).json({ error: 'Achievements are disabled.' });
            }
            const state = await loadAchievementsState();
            const users = Object.values(state.users || {});
            const defs = listBadgeDefinitions();
            const unlockCounts = Object.fromEntries(defs.map((d) => [d.id, 0]));
            for (const user of users) {
                const badges = user?.badges || {};
                for (const [id, badge] of Object.entries(badges)) {
                    if (badge?.earnedAt && !badge?.revokedAt && unlockCounts[id] != null) {
                        unlockCounts[id] += 1;
                    }
                }
            }
            const ranked = defs.map((d) => ({
                id: d.id,
                name: d.name,
                category: d.category,
                icon: d.icon,
                unlocks: unlockCounts[d.id] || 0,
            })).sort((a, b) => a.unlocks - b.unlocks || a.name.localeCompare(b.name));

            res.json({
                userSnapshots: users.length,
                totalBadges: defs.length,
                neverUnlocked: ranked.filter((r) => r.unlocks === 0).slice(0, 40),
                rarest: ranked.filter((r) => r.unlocks > 0).slice(0, 20),
                mostCommon: [...ranked].sort((a, b) => b.unlocks - a.unlocks).slice(0, 20),
            });
        } catch (e) {
            res.status(500).json({ error: e.message || 'Insights error' });
        }
    });

    return {
        runLeaderboardBackfill,
        getAchievementsBackfillStatus,
    };
};
