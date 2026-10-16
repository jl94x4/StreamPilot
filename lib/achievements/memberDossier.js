/**
 * Build a privacy-aware, boast-friendly member dossier for the leaderboard modal.
 */

import { getBadgeDefinitionMap, listBadgeDefinitions } from './definitions.js';
import { evaluateAchievements, pickNextUnlocks } from './evaluate.js';
import { normalizeXpWeights } from './xp.js';
import { dedupeAchievementSnapshots } from './identity.js';

const RARITY_RANK = Object.freeze({
    legendary: 4,
    epic: 3,
    rare: 2,
    common: 1,
});

const MS_DAY = 24 * 60 * 60 * 1000;

const publicPeer = (user, rank, {
    obfuscate = false,
    viewerAccountId = null,
    thumb = null,
} = {}) => {
    if (!user) return null;
    const isMe = viewerAccountId != null && String(user.accountId) === String(viewerAccountId);
    return {
        accountId: obfuscate && !isMe ? undefined : user.accountId,
        username: obfuscate && !isMe ? `Viewer ${rank}` : (user.username || `User ${rank}`),
        rank,
        xp: Number(user.xp) || 0,
        level: Number(user.level) || 1,
        earnedCount: Number(user.earnedCount) || 0,
        thumb: obfuscate && !isMe ? null : (thumb || user.thumb || null),
        isMe,
    };
};

const badgeFromDef = (def, earnedAt = null, extra = {}) => ({
    id: def.id,
    name: def.name,
    description: def.description,
    icon: def.icon,
    category: def.category,
    rarity: def.rarity || 'common',
    metric: def.metric,
    threshold: Number(def.threshold) || 0,
    earnedAt,
    ...extra,
});

const classTitleFor = ({ rank, rankDelta, level, firstUnlockCount }) => {
    if (rank === 1) return { id: 'sovereign', label: 'Sovereign', blurb: 'Holding the crown of the board.' };
    if (rank <= 3) return { id: 'podium', label: 'Podium threat', blurb: 'Breathing down the leader’s neck.' };
    if (rank <= 10) return { id: 'elite', label: 'Top-ten elite', blurb: 'Inside the exclusive chase pack.' };
    if ((rankDelta || 0) >= 3) return { id: 'climber', label: 'Hot climber', blurb: 'Rocketing up the ranks lately.' };
    if (firstUnlockCount >= 10) return { id: 'pioneer', label: 'Badge pioneer', blurb: 'Often first to plant the flag.' };
    if ((level || 1) >= 40) return { id: 'veteran', label: 'Hall veteran', blurb: 'Deep XP scars and staying power.' };
    if ((level || 1) >= 20) return { id: 'regular', label: 'Dedicated regular', blurb: 'Always in the mix.' };
    return { id: 'contender', label: 'Contender', blurb: 'Building momentum one watch at a time.' };
};

const signatureFrom = (stats = {}, breakdown = {}) => {
    const parts = Object.entries(breakdown || {})
        .map(([key, value]) => [key, Number(value) || 0])
        .filter(([, value]) => value > 0)
        .sort((a, b) => b[1] - a[1]);
    if (parts.length) {
        const [key, value] = parts[0];
        return { kind: 'xp', key, value, label: key };
    }
    const binge = Number(stats.bingeMax) || 0;
    if (binge >= 20) return { kind: 'binge', key: 'bingeMax', value: binge, label: 'bingeMax' };
    const streak = Number(stats.longestStreak) || 0;
    if (streak >= 7) return { kind: 'streak', key: 'longestStreak', value: streak, label: 'longestStreak' };
    const hours = Number(stats.hoursWatched) || 0;
    if (hours > 0) return { kind: 'hours', key: 'hoursWatched', value: hours, label: 'hoursWatched' };
    return null;
};

/**
 * Sorted visible leaderboard users (opt-in only).
 */
export const listBoardUsers = (state) => (
    dedupeAchievementSnapshots(
        Object.values(state?.users || {}).filter((u) => u && !u.leaderboardOptOut),
    ).sort((a, b) => (Number(b.xp) || 0) - (Number(a.xp) || 0)
        || (Number(b.earnedCount) || 0) - (Number(a.earnedCount) || 0)
        || String(a.accountId).localeCompare(String(b.accountId)))
);

/**
 * Canonical Home / wrap-up "Server Rank" from Achievements XP (all-time).
 * Period-based plays leaderboards stay available separately for analytics filters.
 */
export const buildAchievementsHomeRankContext = (state, {
    accountId = null,
    obfuscate = false,
    usernameMap = {},
} = {}) => {
    const board = listBoardUsers(state);
    if (!board.length) return null;

    const accountKey = accountId != null ? String(accountId) : '';
    const myIdx = accountKey
        ? board.findIndex((user) => String(user.accountId) === accountKey)
        : -1;
    const names = usernameMap && typeof usernameMap === 'object' ? usernameMap : {};

    if (myIdx < 0) {
        return {
            leaderboardRank: null,
            totalActiveUsers: board.length,
            myPlaysOnLeaderboard: null,
            myXp: null,
            myLevel: null,
            leaderboardNeighbourhood: [],
            leaderboardSource: 'achievements',
            leaderboardMetric: 'xp',
        };
    }

    const me = board[myIdx];
    const rank = myIdx + 1;
    const start = Math.max(0, myIdx - 2);
    const end = Math.min(board.length - 1, myIdx + 2);
    const neighbourhood = board.slice(start, end + 1).map((user, index) => {
        const entryRank = start + index + 1;
        const isMe = String(user.accountId) === accountKey;
        const realName = user.username
            || names[String(user.accountId)]
            || `User ${entryRank}`;
        const xp = Number(user.xp) || 0;
        return {
            rank: entryRank,
            // Keep `plays` populated with XP so older UI still renders a number.
            plays: xp,
            xp,
            level: Number(user.level) || 1,
            isMe,
            username: obfuscate && !isMe ? `Viewer ${entryRank}` : realName,
            accountId: obfuscate && !isMe ? undefined : user.accountId,
        };
    });

    return {
        leaderboardRank: rank,
        totalActiveUsers: board.length,
        myPlaysOnLeaderboard: Number(me.xp) || 0,
        myXp: Number(me.xp) || 0,
        myLevel: Number(me.level) || 1,
        leaderboardNeighbourhood: neighbourhood,
        leaderboardSource: 'achievements',
        leaderboardMetric: 'xp',
    };
};

/**
 * Earliest earner accountId per badge id.
 */
export const buildFirstUnlockIndex = (users = []) => {
    const earliest = new Map();
    for (const user of users) {
        if (!user || user.leaderboardOptOut) continue;
        for (const [badgeId, badge] of Object.entries(user.badges || {})) {
            if (!badge?.earnedAt || badge?.revokedAt) continue;
            const at = String(badge.earnedAt);
            const prev = earliest.get(badgeId);
            if (!prev || at < prev.earnedAt) {
                earliest.set(badgeId, { accountId: String(user.accountId), earnedAt: at });
            }
        }
    }
    return earliest;
};

/**
 * @returns {object|null}
 */
export const buildMemberDossier = (state, {
    accountId = null,
    rank = null,
    viewerAccountId = null,
    obfuscate = false,
    thumbByAccountId = null,
    weights = null,
} = {}) => {
    const board = listBoardUsers(state);
    if (!board.length) return null;

    let index = -1;
    if (accountId != null && String(accountId).trim()) {
        index = board.findIndex((u) => String(u.accountId) === String(accountId));
    } else if (rank != null && Number(rank) > 0) {
        index = Math.min(board.length, Math.max(1, Math.floor(Number(rank)))) - 1;
        if (index < 0 || index >= board.length) index = -1;
    }
    if (index < 0) return null;

    const user = board[index];
    const currentRank = index + 1;
    const isMe = viewerAccountId != null && String(user.accountId) === String(viewerAccountId);
    const thumbs = thumbByAccountId && typeof thumbByAccountId === 'object' ? thumbByAccountId : {};
    const thumb = thumbs[String(user.accountId)] || user.thumb || null;

    const defs = getBadgeDefinitionMap();
    const firstIndex = buildFirstUnlockIndex(board);

    const earnedBadges = [];
    const rarityBreakdown = { legendary: 0, epic: 0, rare: 0, common: 0 };
    let firstUnlockCount = 0;
    const firstUnlockSamples = [];
    const nowMs = Date.now();
    let badgesLast7d = 0;
    let badgesLast30d = 0;

    for (const [badgeId, badge] of Object.entries(user.badges || {})) {
        if (!badge?.earnedAt || badge?.revokedAt) continue;
        const def = defs.get(String(badgeId));
        if (!def) continue;
        const rarity = String(def.rarity || 'common');
        if (rarityBreakdown[rarity] != null) rarityBreakdown[rarity] += 1;
        else rarityBreakdown.common += 1;

        const row = badgeFromDef(def, badge.earnedAt);
        earnedBadges.push(row);

        const first = firstIndex.get(String(badgeId));
        if (first && String(first.accountId) === String(user.accountId)) {
            firstUnlockCount += 1;
            if (firstUnlockSamples.length < 5) firstUnlockSamples.push(row);
        }

        const at = Date.parse(badge.earnedAt);
        if (Number.isFinite(at)) {
            if (nowMs - at <= 7 * MS_DAY) badgesLast7d += 1;
            if (nowMs - at <= 30 * MS_DAY) badgesLast30d += 1;
        }
    }

    earnedBadges.sort((a, b) => String(b.earnedAt || '').localeCompare(String(a.earnedAt || '')));
    const lastBadge = earnedBadges[0] || null;

    const trophyCase = [...earnedBadges]
        .sort((a, b) => (RARITY_RANK[b.rarity] || 0) - (RARITY_RANK[a.rarity] || 0)
            || String(b.earnedAt || '').localeCompare(String(a.earnedAt || '')))
        .slice(0, 5);

    const evaluation = evaluateAchievements({
        stats: user.stats || {},
        previousBadges: user.badges || {},
        weights: normalizeXpWeights(weights),
        disabledBadgeIds: [],
        seasons: [],
    });
    const closest = pickNextUnlocks(evaluation.locked, 4).map((b) => ({
        id: b.id,
        name: b.name,
        icon: b.icon,
        rarity: b.rarity,
        threshold: b.threshold,
        progress: b.progress,
        progressPct: b.progressPct,
        metric: b.metric,
    }));

    const aboveUser = index > 0 ? board[index - 1] : null;
    const belowUser = index < board.length - 1 ? board[index + 1] : null;
    const above = publicPeer(aboveUser, index, {
        obfuscate, viewerAccountId, thumb: aboveUser ? thumbs[String(aboveUser.accountId)] : null,
    });
    const below = publicPeer(belowUser, index + 2, {
        obfuscate, viewerAccountId, thumb: belowUser ? thumbs[String(belowUser.accountId)] : null,
    });

    // Biggest threat: nearest hunter below with the fiercest recent unlock rate.
    let threat = null;
    const hunters = board.slice(index + 1, index + 4);
    for (let i = 0; i < hunters.length; i += 1) {
        const hunter = hunters[i];
        let recent = 0;
        for (const badge of Object.values(hunter.badges || {})) {
            if (!badge?.earnedAt || badge?.revokedAt) continue;
            const at = Date.parse(badge.earnedAt);
            if (Number.isFinite(at) && nowMs - at <= 14 * MS_DAY) recent += 1;
        }
        const gap = Math.max(0, (Number(user.xp) || 0) - (Number(hunter.xp) || 0));
        const score = recent * 1000 - gap;
        if (!threat || score > threat.score) {
            threat = {
                score,
                recentBadges14d: recent,
                xpGap: gap,
                peer: publicPeer(hunter, index + 2 + i, {
                    obfuscate,
                    viewerAccountId,
                    thumb: thumbs[String(hunter.accountId)] || hunter.thumb || null,
                }),
            };
        }
    }

    const boardRank = Number(user.boardRank) || currentRank;
    const boardRankPrevious = Number(user.boardRankPrevious) || boardRank;
    const rankDelta = boardRankPrevious - boardRank; // + climbed, - dropped

    const breakdown = user.breakdown && typeof user.breakdown === 'object' && !Array.isArray(user.breakdown)
        ? user.breakdown
        : evaluation.breakdown;

    return {
        accountId: obfuscate && !isMe ? undefined : user.accountId,
        username: obfuscate && !isMe ? `Viewer ${currentRank}` : (user.username || `User ${currentRank}`),
        thumb: obfuscate && !isMe ? null : thumb,
        isMe,
        rank: currentRank,
        previousRank: boardRankPrevious,
        rankDelta,
        boardSize: board.length,
        xp: Number(user.xp) || 0,
        level: Number(user.level) || levelFromSafe(user),
        earnedCount: Number(user.earnedCount) || earnedBadges.length,
        totalBadges: Number(user.totalBadges) || listBadgeDefinitions().length,
        classTitle: classTitleFor({
            rank: currentRank,
            rankDelta,
            level: Number(user.level) || 1,
            firstUnlockCount,
        }),
        lastBadge,
        trophyCase,
        rarityBreakdown,
        firstUnlocks: {
            count: firstUnlockCount,
            samples: firstUnlockSamples,
        },
        closest,
        rivals: {
            above: above ? {
                ...above,
                xpGap: Math.max(0, (Number(above.xp) || 0) - (Number(user.xp) || 0)),
            } : null,
            below: below ? {
                ...below,
                xpGap: Math.max(0, (Number(user.xp) || 0) - (Number(below.xp) || 0)),
            } : null,
        },
        threat: threat?.peer ? {
            ...threat.peer,
            xpGap: threat.xpGap,
            recentBadges14d: threat.recentBadges14d,
        } : null,
        momentum: {
            badgesLast7d,
            badgesLast30d,
            recentBadges: earnedBadges.slice(0, 6),
        },
        signature: signatureFrom(user.stats || {}, breakdown || {}),
        updatedAt: user.updatedAt || null,
    };
};

const levelFromSafe = (user) => Number(user?.level) || 1;

/**
 * Persist rank movement when the public board is generated.
 * Only rewrites when someone actually changed place.
 */
export const applyRankTrace = (state, orderedAccountIds = []) => {
    const now = new Date().toISOString();
    let changed = false;
    orderedAccountIds.forEach((accountId, index) => {
        const key = String(accountId || '').trim();
        if (!key) return;
        const user = state?.users?.[key];
        if (!user) return;
        const rank = index + 1;
        const prev = Number(user.boardRank);
        if (!Number.isFinite(prev) || prev <= 0) {
            user.boardRank = rank;
            user.boardRankPrevious = rank;
            user.boardRankAt = now;
            changed = true;
            return;
        }
        if (prev !== rank) {
            user.boardRankPrevious = prev;
            user.boardRank = rank;
            user.boardRankAt = now;
            changed = true;
        }
    });
    return changed;
};
