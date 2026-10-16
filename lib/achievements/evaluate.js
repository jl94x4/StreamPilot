import { isBadgeSeasonActive, listBadgeDefinitions } from './definitions.js';
import { computeBadgeUnlockXp, computeXpBreakdown, levelFromXp, levelProgress, normalizeXpWeights } from './xp.js';

const metricValue = (stats, metric) => {
    if (metric === 'level') return Number(stats?.level) || 1;
    return Math.max(0, Number(stats?.[metric]) || 0);
};

/** Highest earned threshold for a metric — live stats can drop to 0 after a history rebuild. */
export const metricFloorFromBadgeState = (badgeState = {}, metric) => {
    const key = String(metric || '');
    if (!key) return 0;
    let floor = 0;
    for (const def of listBadgeDefinitions()) {
        if (String(def.metric || '') !== key) continue;
        const rec = badgeState?.[def.id];
        if (rec?.earnedAt && !rec?.revokedAt) {
            floor = Math.max(floor, Number(def.threshold) || 0);
        }
    }
    return floor;
};

const applyEarnedMetricFloors = (badgeResults = []) => {
    const floorByMetric = new Map();
    for (const badge of badgeResults) {
        if (!badge?.earned || !badge.metric) continue;
        const prev = floorByMetric.get(badge.metric) || 0;
        floorByMetric.set(badge.metric, Math.max(prev, Number(badge.threshold) || 0));
    }
    for (const badge of badgeResults) {
        const floor = floorByMetric.get(badge.metric) || 0;
        const current = Math.max(Number(badge.progress) || 0, floor);
        const threshold = Number(badge.threshold) || 0;
        badge.progress = current;
        if (badge.earned) {
            badge.progressPct = 100;
        } else if (threshold > 0) {
            badge.progressPct = Math.min(100, Math.round((current / threshold) * 100));
        }
    }
    return badgeResults;
};

/**
 * Evaluate all badge definitions against a stats object.
 * @returns {{ badgeResults: object[], earned: object[], locked: object[], newlyEarnedIds: string[] }}
 */
export const evaluateAchievements = ({
    stats,
    previousBadges = {},
    weights,
    disabledBadgeIds = [],
    seasons = [],
    now = new Date(),
    /** badgeId → ISO time from history replay; preferred over "now" for unlock dates */
    unlockTimestamps = null,
    /** When true (Force backfill), always replace stored earnedAt with history when available */
    forceUnlockTimestamps = false,
} = {}) => {
    const disabled = new Set((disabledBadgeIds || []).map(String));
    const w = normalizeXpWeights(weights);
    let { xp, parts } = computeXpBreakdown({ ...stats, badgeUnlockXp: 0 }, w);
    let level = levelFromXp(xp);
    let progress = levelProgress(xp);
    const enrichedStats = { ...stats, level, xp };

    const nowIso = (now instanceof Date ? now : new Date()).toISOString();
    const historicMap = unlockTimestamps && typeof unlockTimestamps === 'object'
        ? unlockTimestamps
        : null;
    const badgeResults = [];
    const newlyEarnedIds = [];

    const pickEarnedAt = (badgeId, previousIso, { reearned = false } = {}) => {
        const historic = historicMap?.[badgeId] || historicMap?.[String(badgeId)] || null;
        if (historic && Number.isFinite(Date.parse(historic))) {
            if (forceUnlockTimestamps || !previousIso || reearned) return historic;
            // Soft repair: never move unlock time forward unless Force backfill.
            if (Date.parse(historic) < Date.parse(previousIso)) return historic;
        }
        if (previousIso && !reearned) return previousIso;
        return nowIso;
    };

    for (const def of listBadgeDefinitions()) {
        if (disabled.has(def.id)) continue;
        const seasonActive = isBadgeSeasonActive(def, now, seasons);
        const current = metricValue(enrichedStats, def.metric);
        const threshold = Number(def.threshold) || 0;
        const ratio = threshold > 0 ? Math.min(1, current / threshold) : 0;
        const prev = previousBadges?.[def.id];
        const wasEarned = !!(prev && prev.earnedAt && !prev.revokedAt);
        // Seasonal badges are only newly earnable in-window; keep already-earned forever.
        const met = current >= threshold;
        const earned = wasEarned || (met && seasonActive);

        let earnedAt = prev?.earnedAt || null;
        let revokedAt = prev?.revokedAt || null;

        if (earned) {
            if (!wasEarned) {
                earnedAt = pickEarnedAt(def.id, null);
                revokedAt = null;
                newlyEarnedIds.push(def.id);
            } else if (revokedAt) {
                // Re-earned after revoke
                earnedAt = pickEarnedAt(def.id, null, { reearned: true });
                revokedAt = null;
                newlyEarnedIds.push(def.id);
            } else {
                // Already earned — repair stamp from history when possible.
                earnedAt = pickEarnedAt(def.id, earnedAt);
            }
        } else if (wasEarned && def.revocable) {
            revokedAt = nowIso;
        }

        badgeResults.push({
            id: def.id,
            name: def.name,
            description: def.description,
            icon: def.icon,
            category: def.category,
            rarity: def.rarity,
            metric: def.metric,
            threshold,
            progress: current,
            progressPct: Math.round(ratio * 100),
            earned,
            earnedAt,
            revokedAt,
            revocable: !!def.revocable,
            seasonActive,
            activeFrom: def.activeFrom || null,
            activeUntil: def.activeUntil || null,
        });
    }

    applyEarnedMetricFloors(badgeResults);

    const earned = badgeResults.filter((b) => b.earned);
    const locked = badgeResults.filter((b) => !b.earned);
    const badgeUnlockXp = computeBadgeUnlockXp(earned, 1);
    const badgeUnlocks = Math.round(badgeUnlockXp * (Number(w.badgeUnlocks) || 0));
    parts = { ...parts, badgeUnlocks };
    xp = Object.values(parts).reduce((sum, value) => sum + (Number(value) || 0), 0);
    level = levelFromXp(xp);
    progress = levelProgress(xp);
    enrichedStats.level = level;
    enrichedStats.xp = xp;
    enrichedStats.badgeUnlockXp = badgeUnlockXp;

    const badgesState = {};
    for (const badge of badgeResults) {
        if (badge.earnedAt || badge.revokedAt) {
            badgesState[badge.id] = {
                earnedAt: badge.earnedAt,
                revokedAt: badge.revokedAt || null,
                progress: badge.progress,
            };
        }
    }

    return {
        xp,
        level,
        levelProgress: progress,
        breakdown: parts,
        stats: enrichedStats,
        badgeResults,
        earned,
        locked,
        newlyEarnedIds,
        badgesState,
        earnedCount: earned.length,
        totalBadges: badgeResults.length,
        nextUnlocks: pickNextUnlocks(locked, 3),
    };
};

/** Closest incomplete badges — one per metric ladder, highest progress first. */
export const pickNextUnlocks = (locked = [], limit = 3) => {
    const byMetric = new Map();
    for (const badge of locked || []) {
        if (!badge || badge.earned) continue;
        // Prefer in-season badges for "next" goals; out-of-season stay locked but deprioritized.
        if (badge.seasonActive === false) continue;
        const metric = String(badge.metric || badge.id || '');
        if (!metric) continue;
        const prev = byMetric.get(metric);
        if (!prev || (Number(badge.threshold) || 0) < (Number(prev.threshold) || 0)) {
            byMetric.set(metric, badge);
        }
    }
    return [...byMetric.values()]
        .sort((a, b) => (Number(b.progressPct) || 0) - (Number(a.progressPct) || 0)
            || (Number(a.threshold) || 0) - (Number(b.threshold) || 0))
        .slice(0, Math.max(0, limit))
        .map((b) => ({
            id: b.id,
            name: b.name,
            description: b.description,
            icon: b.icon,
            category: b.category,
            rarity: b.rarity,
            metric: b.metric,
            threshold: b.threshold,
            progress: b.progress,
            progressPct: b.progressPct,
            seasonActive: b.seasonActive !== false,
        }));
};

export const snapshotFromEvaluation = (accountId, username, evaluation, opts = {}) => {
    const snap = {
        accountId: String(accountId),
        username: username || null,
        xp: evaluation.xp,
        level: evaluation.level,
        earnedCount: evaluation.earnedCount,
        totalBadges: evaluation.totalBadges,
        badges: evaluation.badgesState,
        stats: evaluation.stats,
        breakdown: evaluation.breakdown,
        leaderboardOptOut: !!opts.leaderboardOptOut,
        updatedAt: new Date().toISOString(),
    };
    if (opts.genreEnrichmentVersion != null) {
        snap.genreEnrichmentVersion = Number(opts.genreEnrichmentVersion) || 0;
    }
    if (Array.isArray(opts.seenUnlockIds)) {
        snap.seenUnlockIds = opts.seenUnlockIds.map(String).filter(Boolean);
    }
    return snap;
};

export { normalizeXpWeights };
