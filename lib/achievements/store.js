import fs from 'fs/promises';
import crypto from 'crypto';
import { ACHIEVEMENTS_STATE_PATH } from '../data-paths.js';
import { applyRankTrace } from './memberDossier.js';
import { dedupeAchievementSnapshots } from './identity.js';

const emptyState = () => ({
    version: 1,
    users: {},
    historySource: 'plex',
    updatedAt: null,
});

/** Serialize concurrent load/save so /me + backfill never interleave mid-write. */
let writeChain = Promise.resolve();

const serialize = (operation) => {
    const current = writeChain.then(operation, operation);
    writeChain = current.catch(() => {});
    return current;
};

const writeJsonAtomic = async (filePath, value) => {
    await fs.mkdir(filePath.replace(/[/\\][^/\\]+$/, ''), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const payload = `${JSON.stringify(value, null, 2)}\n`;
    await fs.writeFile(temporary, payload, 'utf8');
    try {
        await fs.rename(temporary, filePath);
    } finally {
        await fs.rm(temporary, { force: true }).catch(() => {});
    }
};

export const loadAchievementsState = async () => {
    try {
        const raw = await fs.readFile(ACHIEVEMENTS_STATE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return emptyState();
        if (!parsed.users || typeof parsed.users !== 'object') parsed.users = {};
        if (!parsed.historySource) parsed.historySource = 'plex';
        return parsed;
    } catch {
        return emptyState();
    }
};

const mergeUsersByUpdatedAt = (baseUsers = {}, incomingUsers = {}) => {
    const merged = { ...(baseUsers || {}) };
    for (const [id, snap] of Object.entries(incomingUsers || {})) {
        if (!snap || typeof snap !== 'object') continue;
        const prev = merged[id];
        if (!prev) {
            merged[id] = snap;
            continue;
        }
        const prevAt = Date.parse(prev.updatedAt || '') || 0;
        const nextAt = Date.parse(snap.updatedAt || '') || 0;
        if (nextAt >= prevAt) {
            merged[id] = { ...prev, ...snap };
        }
    }
    return merged;
};

export const saveAchievementsState = async (state) => serialize(async () => {
    const fresh = await loadAchievementsState();
    const merged = mergeUsersByUpdatedAt(fresh.users, state?.users);
    for (const rawId of Array.isArray(state?.pruneAccountIds) ? state.pruneAccountIds : []) {
        const key = String(rawId || '').trim();
        if (key) delete merged[key];
    }
    const next = {
        version: 1,
        users: merged,
        historySource: (state?.historySource === 'tautulli' || state?.historySource === 'plex')
            ? state.historySource
            : (fresh.historySource === 'tautulli' ? 'tautulli' : 'plex'),
        updatedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(ACHIEVEMENTS_STATE_PATH, next);
    return next;
});

export const upsertUserAchievementSnapshot = async (snapshot) => {
    if (!snapshot?.accountId) throw new Error('accountId required');
    return serialize(async () => {
        const state = await loadAchievementsState();
        const prev = state.users[String(snapshot.accountId)] || {};
        state.users[String(snapshot.accountId)] = {
            ...prev,
            ...snapshot,
            leaderboardOptOut: snapshot.leaderboardOptOut ?? prev.leaderboardOptOut ?? false,
            muteUnlockToasts: snapshot.muteUnlockToasts ?? prev.muteUnlockToasts ?? false,
            pinnedBadgeIds: Array.isArray(snapshot.pinnedBadgeIds)
                ? snapshot.pinnedBadgeIds.map(String).filter(Boolean).slice(0, 3)
                : (Array.isArray(prev.pinnedBadgeIds) ? prev.pinnedBadgeIds.map(String).filter(Boolean).slice(0, 3) : []),
        };
        await writeJsonAtomic(ACHIEVEMENTS_STATE_PATH, {
            version: 1,
            users: state.users,
            historySource: state.historySource === 'tautulli' ? 'tautulli' : 'plex',
            updatedAt: new Date().toISOString(),
        });
        return state.users[String(snapshot.accountId)];
    });
};

export const setLeaderboardOptOut = async (accountId, optOut) => {
    return serialize(async () => {
        const state = await loadAchievementsState();
        const key = String(accountId);
        const prev = state.users[key] || { accountId: key, xp: 0, level: 1, badges: {} };
        prev.leaderboardOptOut = !!optOut;
        prev.updatedAt = new Date().toISOString();
        state.users[key] = prev;
        await writeJsonAtomic(ACHIEVEMENTS_STATE_PATH, {
            version: 1,
            users: state.users,
            historySource: state.historySource === 'tautulli' ? 'tautulli' : 'plex',
            updatedAt: new Date().toISOString(),
        });
        return prev;
    });
};

export const setMuteUnlockToasts = async (accountId, mute) => {
    return serialize(async () => {
        const state = await loadAchievementsState();
        const key = String(accountId);
        const prev = state.users[key] || { accountId: key, xp: 0, level: 1, badges: {} };
        prev.muteUnlockToasts = !!mute;
        prev.updatedAt = new Date().toISOString();
        state.users[key] = prev;
        await writeJsonAtomic(ACHIEVEMENTS_STATE_PATH, {
            version: 1,
            users: state.users,
            historySource: state.historySource === 'tautulli' ? 'tautulli' : 'plex',
            updatedAt: new Date().toISOString(),
        });
        return prev;
    });
};

export const setPinnedBadgeIds = async (accountId, badgeIds = []) => {
    return serialize(async () => {
        const state = await loadAchievementsState();
        const key = String(accountId);
        const prev = state.users[key] || { accountId: key, xp: 0, level: 1, badges: {} };
        const next = Array.isArray(badgeIds)
            ? [...new Set(badgeIds.map((id) => String(id || '').trim()).filter(Boolean))].slice(0, 3)
            : [];
        prev.pinnedBadgeIds = next;
        prev.updatedAt = new Date().toISOString();
        state.users[key] = prev;
        await writeJsonAtomic(ACHIEVEMENTS_STATE_PATH, {
            version: 1,
            users: state.users,
            historySource: state.historySource === 'tautulli' ? 'tautulli' : 'plex',
            updatedAt: new Date().toISOString(),
        });
        return prev;
    });
};

export const persistLeaderboardRankTrace = async (orderedAccountIds = []) => {
    return serialize(async () => {
        const state = await loadAchievementsState();
        const changed = applyRankTrace(state, orderedAccountIds);
        if (!changed) return false;
        await writeJsonAtomic(ACHIEVEMENTS_STATE_PATH, {
            version: 1,
            users: state.users,
            historySource: state.historySource === 'tautulli' ? 'tautulli' : 'plex',
            updatedAt: new Date().toISOString(),
        });
        return true;
    });
};

export const ackAchievementUnlocks = async (accountId, badgeIds = []) => {
    return serialize(async () => {
        const state = await loadAchievementsState();
        const key = String(accountId);
        const prev = state.users[key] || { accountId: key, xp: 0, level: 1, badges: {} };
        const seen = new Set(Array.isArray(prev.seenUnlockIds) ? prev.seenUnlockIds.map(String) : []);
        for (const id of badgeIds || []) {
            const value = String(id || '').trim();
            if (value) seen.add(value);
        }
        // Also mark every currently earned badge id so backfills don't re-toast.
        for (const [id, badge] of Object.entries(prev.badges || {})) {
            if (badge?.earnedAt && !badge?.revokedAt) seen.add(String(id));
        }
        prev.seenUnlockIds = [...seen];
        prev.updatedAt = new Date().toISOString();
        state.users[key] = prev;
        await writeJsonAtomic(ACHIEVEMENTS_STATE_PATH, {
            version: 1,
            users: state.users,
            historySource: state.historySource === 'tautulli' ? 'tautulli' : 'plex',
            updatedAt: new Date().toISOString(),
        });
        return prev.seenUnlockIds;
    });
};

export const buildLeaderboard = (state, {
    limit = 50,
    obfuscate = false,
    viewerAccountId = null,
    thumbByAccountId = null,
    thumbByUsername = null,
} = {}) => {
    const thumbs = thumbByAccountId && typeof thumbByAccountId === 'object' ? thumbByAccountId : {};
    const thumbsByName = thumbByUsername && typeof thumbByUsername === 'object' ? thumbByUsername : {};
    const norm = (v) => String(v || '').trim().toLowerCase();
    const users = dedupeAchievementSnapshots(
        Object.values(state?.users || {}).filter((u) => u && !u.leaderboardOptOut),
        { preferAccountId: viewerAccountId },
    ).sort((a, b) => (Number(b.xp) || 0) - (Number(a.xp) || 0) || (Number(b.earnedCount) || 0) - (Number(a.earnedCount) || 0));

    return users.slice(0, Math.max(1, Math.min(200, limit))).map((user, index) => {
        const rank = index + 1;
        const isMe = viewerAccountId != null && String(user.accountId) === String(viewerAccountId);
        const username = obfuscate && !isMe
            ? `Viewer ${rank}`
            : (user.username || `User ${rank}`);
        const accountKey = String(user.accountId || '');
        const rawThumb = user.thumb
            || thumbs[accountKey]
            || thumbsByName[norm(user.username)]
            || null;
        return {
            rank,
            accountId: isMe || !obfuscate ? user.accountId : undefined,
            username,
            xp: Number(user.xp) || 0,
            level: Number(user.level) || 1,
            earnedCount: Number(user.earnedCount) || 0,
            isMe,
            // Hide avatars for obfuscated viewers (keep yours).
            thumb: (obfuscate && !isMe) ? null : (rawThumb || null),
            // + climbed / − dropped since last observed change
            rankDelta: (() => {
                const current = Number(user.boardRank) || rank;
                const previous = Number(user.boardRankPrevious) || current;
                return previous - current;
            })(),
        };
    });
};
