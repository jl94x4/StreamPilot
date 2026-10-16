/**
 * Collapse duplicate achievement snapshots for the same person
 * (local PMS id vs plex.tv id, leftover admin aliases, matching display names).
 */

const norm = (value) => String(value || '').trim().toLowerCase();

export const achievementIdentityKey = (user = {}) => {
    const raw = norm(user.username);
    if (!raw) return `id:${String(user.accountId || '').trim()}`;
    const base = raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
    return base || raw;
};

const numericId = (accountId) => {
    const raw = String(accountId || '').trim();
    if (!/^\d+$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
};

const thumbKey = (user = {}) => {
    const raw = String(user.thumb || '').trim();
    if (!raw) return '';
    if (/gravatar\.com|00000000000000000000000000000000/i.test(raw)) return '';
    return raw;
};

/** Return < 0 when `a` should win over `b`. */
export const preferAchievementSnapshot = (a = {}, b = {}, preferAccountId = null) => {
    const prefer = preferAccountId != null ? String(preferAccountId) : '';
    if (prefer) {
        const aHit = String(a.accountId) === prefer;
        const bHit = String(b.accountId) === prefer;
        if (aHit !== bHit) return aHit ? -1 : 1;
    }
    if (String(a.accountId) === '1' && String(b.accountId) !== '1') return -1;
    if (String(b.accountId) === '1' && String(a.accountId) !== '1') return 1;
    const xpDelta = (Number(b.xp) || 0) - (Number(a.xp) || 0);
    if (xpDelta) return xpDelta;
    const earnedDelta = (Number(b.earnedCount) || 0) - (Number(a.earnedCount) || 0);
    if (earnedDelta) return earnedDelta;
    const aNum = numericId(a.accountId);
    const bNum = numericId(b.accountId);
    if (aNum != null && bNum != null && aNum !== bNum) return aNum - bNum;
    return String(a.accountId || '').localeCompare(String(b.accountId || ''));
};

const pickWinner = (current, candidate, preferAccountId) => (
    !current || preferAchievementSnapshot(candidate, current, preferAccountId) < 0
        ? candidate
        : current
);

export const dedupeAchievementSnapshots = (users = [], { preferAccountId = null } = {}) => {
    const byIdentity = new Map();
    for (const user of Array.isArray(users) ? users : []) {
        if (!user) continue;
        const key = achievementIdentityKey(user);
        byIdentity.set(key, pickWinner(byIdentity.get(key), user, preferAccountId));
    }

    const byThumb = new Map();
    const noThumb = [];
    for (const user of byIdentity.values()) {
        const thumb = thumbKey(user);
        if (!thumb) {
            noThumb.push(user);
            continue;
        }
        byThumb.set(thumb, pickWinner(byThumb.get(thumb), user, preferAccountId));
    }

    const seen = new Set();
    const unique = [];
    for (const user of [...byThumb.values(), ...noThumb]) {
        const id = String(user.accountId || '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        unique.push(user);
    }
    return unique;
};

export const pruneAchievementAliasSnapshots = (usersMap = {}, {
    targets = [],
    portalUsers = [],
    adminPlexId = '',
} = {}) => {
    const next = { ...(usersMap && typeof usersMap === 'object' ? usersMap : {}) };
    const keep = new Set((Array.isArray(targets) ? targets : []).map((target) => String(target.accountId || '').trim()).filter(Boolean));
    const adminId = String(adminPlexId || '').trim();
    if (adminId && keep.has('1')) delete next[adminId];

    for (const user of Array.isArray(portalUsers) ? portalUsers : []) {
        const aliases = [user?.plexAccountId, user?.plexId, user?.id]
            .map((id) => String(id || '').trim())
            .filter(Boolean);
        if (adminId && aliases.includes(adminId)) aliases.push('1');
        const canonical = aliases.find((id) => keep.has(id));
        if (!canonical) continue;
        for (const id of aliases) {
            if (id !== canonical) delete next[id];
        }
    }

    const winners = new Map();
    for (const [id, snap] of Object.entries(next)) {
        const key = achievementIdentityKey(snap || {});
        const currentId = winners.get(key);
        if (!currentId) {
            winners.set(key, id);
            continue;
        }
        const keepNew = keep.has(id);
        const keepOld = keep.has(currentId);
        if (keepNew !== keepOld) {
            if (keepNew) winners.set(key, id);
            continue;
        }
        if (preferAchievementSnapshot(snap, next[currentId]) < 0) winners.set(key, id);
    }
    for (const id of Object.keys(next)) {
        const key = achievementIdentityKey(next[id] || {});
        if (winners.get(key) !== id) delete next[id];
    }
    return next;
};

export default {
    achievementIdentityKey,
    preferAchievementSnapshot,
    dedupeAchievementSnapshots,
    pruneAchievementAliasSnapshots,
};
