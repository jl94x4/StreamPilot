/**
 * Privacy-aware profile payloads for /api/profile/me and /api/profile/:accountId.
 * Peer views never include account secrets; hidden / opt-out peers 404.
 */

import { getBadgeDefinitionMap } from '../achievements/definitions.js';
import { achievementIdentityKey, preferAchievementSnapshot } from '../achievements/identity.js';
import { levelProgress } from '../achievements/xp.js';
import { mergeProfileWrapUp } from './wrapUp.js';

export const PROFILE_UNAVAILABLE = 'Profile not available';

const RARITY_RANK = Object.freeze({
    legendary: 4,
    epic: 3,
    rare: 2,
    common: 1,
});

export const normalizeHideStreamUsers = (config = {}) => (
    config.hideStreamUsers === true ? 'anonymous' : String(config.hideStreamUsers || 'false')
);

export const shouldObfuscateProfilePeers = (viewer = {}, config = {}) => {
    if (viewer?.isAdmin) return false;
    const hideMode = normalizeHideStreamUsers(config);
    if (hideMode === 'anonymous' || hideMode === 'hidden') return true;
    return config.showUsernamesInAnalytics !== true;
};

const isAnonymousProfileKey = (value = '') => {
    const key = String(value || '').trim().toLowerCase();
    return !key || key === 'anonymous' || key === 'unknown' || key === 'unknown user' || /^viewer\s+\d+$/.test(key);
};

export const findPortalUserForAccountId = (users = [], accountId = '') => {
    const key = String(accountId || '').trim();
    if (!key || !Array.isArray(users) || isAnonymousProfileKey(key)) return null;
    const jellyfinBare = key.startsWith('jellyfin:') ? key.slice('jellyfin:'.length) : '';
    const nameKey = key.toLowerCase();
    return users.find((user) => {
        if (!user) return false;
        const ids = [
            user.id,
            user.plexId,
            user.jellyfinId,
            user.plexAccountId,
            user.jellyfinId ? `jellyfin:${user.jellyfinId}` : '',
        ].map((value) => String(value || '').trim()).filter(Boolean);
        if (ids.includes(key)) return true;
        if (jellyfinBare && String(user.jellyfinId || '') === jellyfinBare) return true;
        const username = String(user.username || '').trim().toLowerCase();
        return !!username && username === nameKey;
    }) || null;
};

const uniqueIds = (values = []) => {
    const ids = [];
    for (const value of values) {
        const id = String(value || '').trim();
        if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
};

/**
 * Map a portal / session identity onto the achievements snapshot key.
 * Owner plex.tv ids must not win over local PMS "1", and leftover empty
 * alias snapshots must not beat the real XP row for the same username.
 */
export const resolveAchievementsAccountId = (portalUser, rawId, state = {}, extras = {}) => {
    const snapshots = state?.users && typeof state.users === 'object' ? state.users : {};
    const adminPlexId = String(extras.adminPlexId || '').trim();
    const ids = uniqueIds([
        rawId,
        extras.mergeViewerIds ? extras.viewerAccountId : null,
        portalUser?.plexAccountId,
        portalUser?.id,
        portalUser?.plexId,
        portalUser?.jellyfinId,
        portalUser?.jellyfinId ? `jellyfin:${portalUser.jellyfinId}` : '',
    ]);
    if (adminPlexId && ids.includes(adminPlexId)) ids.push('1');

    const names = new Set();
    for (const value of [extras.username, portalUser?.username]) {
        const key = achievementIdentityKey({ username: value });
        if (key && !key.startsWith('id:')) names.add(key);
    }

    const idHits = [];
    const nameHits = [];
    for (const [key, snap] of Object.entries(snapshots)) {
        if (!snap) continue;
        const idHit = ids.includes(String(key)) || ids.includes(String(snap.accountId || '').trim());
        if (idHit) {
            idHits.push(snap);
            continue;
        }
        if (names.has(achievementIdentityKey(snap))) nameHits.push(snap);
    }
    const pool = idHits.length ? idHits : nameHits;
    let winner = null;
    for (const snap of pool) {
        if (!winner || preferAchievementSnapshot(snap, winner) < 0) winner = snap;
    }
    if (winner) return String(winner.accountId || '').trim() || null;
    return ids[0] || String(rawId || '').trim() || null;
};

const profileRequestGroupKey = (item = {}) => {
    const type = String(item.mediaType || item.type || 'movie').toLowerCase();
    const mbid = String(item.mbid || '').trim();
    if (type === 'music' && mbid) return `music:${mbid}`;
    const tmdbId = Number(item.tmdbId);
    if (Number.isFinite(tmdbId) && tmdbId > 0) return `${type}:${tmdbId}`;
    const title = String(item.title || '').trim().toLowerCase();
    if (title) return `title:${type}:${title}`;
    return `id:${item.id ?? 'unknown'}`;
};

const requestStatusLabel = (item = {}) => {
    if (item.statusLabel) return String(item.statusLabel);
    if (typeof item.status === 'string' && item.status && !/^\d+$/.test(item.status)) return item.status;
    const code = Number(item.status);
    if (code === 1) return 'Pending';
    if (code === 2) return 'Approved';
    if (code === 3) return 'Declined';
    if (code === 4) return 'Failed';
    return item.mediaType || item.type || null;
};

/** One poster per title — HD + 4K rows collapse the way My Requests does. */
export const collapseProfileRequests = (items = [], { limit = 6 } = {}) => {
    const order = [];
    const groups = new Map();
    for (const item of Array.isArray(items) ? items : []) {
        if (!item) continue;
        const key = profileRequestGroupKey(item);
        if (!groups.has(key)) {
            groups.set(key, []);
            order.push(key);
        }
        groups.get(key).push(item);
    }
    const cap = Math.max(1, Number(limit) || 6);
    return order.slice(0, cap).map((key) => {
        const variants = groups.get(key) || [];
        const primary = variants[0] || {};
        const qualities = [...new Set(variants.map((row) => (row.is4k ? '4K' : 'HD')))];
        const tmdbId = Number(
            primary.tmdbId
            || variants.map((row) => Number(row.tmdbId)).find((value) => Number.isFinite(value) && value > 0)
            || 0,
        );
        const mbid = String(primary.mbid || variants.map((row) => row.mbid).find(Boolean) || '').trim() || null;
        return {
            id: primary.id ?? key,
            title: primary.title || primary.mediaTitle || '',
            posterUrl: variants.map((row) => row.posterUrl || row.posterPath || row.image).find(Boolean) || null,
            status: requestStatusLabel(primary),
            mediaType: primary.mediaType || primary.type || null,
            tmdbId: Number.isFinite(tmdbId) && tmdbId > 0 ? tmdbId : null,
            mbid,
            is4k: variants.some((row) => !!row.is4k),
            qualities,
        };
    });
};

export const isSameProfileSubject = ({
    viewer = {},
    viewerAccountId = null,
    subjectAccountId = null,
    portalUser = null,
} = {}) => {
    const viewerIds = [
        viewerAccountId,
        viewer.id,
        viewer.plexId,
        viewer.jellyfinId,
        viewer.plexAccountId,
    ].map((value) => String(value || '').trim()).filter(Boolean);
    const subjectIds = [
        subjectAccountId,
        portalUser?.id,
        portalUser?.plexId,
        portalUser?.jellyfinId,
        portalUser?.plexAccountId,
    ].map((value) => String(value || '').trim()).filter(Boolean);
    return subjectIds.some((id) => viewerIds.includes(id));
};

/**
 * @returns {{ ok: true, obfuscate: boolean, includeAccount: boolean } | { ok: false, status: number, error: string }}
 */
export const decidePeerProfileAccess = ({
    isSelf = false,
    viewerIsAdmin = false,
    hideStreamUsers = 'false',
    showUsernamesInAnalytics = false,
    leaderboardOptOut = false,
    privacyShowName = true,
    privacyShowProfile = true,
} = {}) => {
    if (isSelf || viewerIsAdmin) {
        return {
            ok: true,
            obfuscate: false,
            includeAccount: true,
            hideAchievements: false,
            locked: false,
            privateToPeers: privacyShowProfile === false,
        };
    }
    const hideMode = hideStreamUsers === true ? 'anonymous' : String(hideStreamUsers || 'false');
    if (hideMode === 'hidden') {
        return { ok: false, status: 404, error: PROFILE_UNAVAILABLE };
    }
    if (privacyShowProfile === false) {
        return {
            ok: true,
            obfuscate: false,
            includeAccount: false,
            hideAchievements: true,
            locked: true,
            privateToPeers: true,
        };
    }
    return {
        ok: true,
        obfuscate: hideMode === 'anonymous' || showUsernamesInAnalytics !== true || privacyShowName === false,
        includeAccount: false,
        hideAchievements: !!leaderboardOptOut,
        locked: false,
        privateToPeers: false,
    };
};

export const buildAccountStrip = (user = {}) => {
    if (!user || typeof user !== 'object') return null;
    return {
        email: user.email || '',
        joiningDate: user.joiningDate || null,
        expiryDate: user.expiryDate ?? null,
        lastLogin: user.lastLogin || null,
        plexAccessStatus: user.plexAccessStatus || 'unknown',
        isTrial: !!user.isTrial,
        isAdmin: !!user.isAdmin,
        id: user.id || null,
    };
};

// Snapshot counts/rank only. Title and habit cards come from subject-scoped
// wrap-up (same builder as Home) merged in assembleProfilePayload.
export const statsToWrapUpAnalytics = (stats = {}, dossier = null) => {
    const source = stats && typeof stats === 'object' ? stats : {};
    const rank = Number(dossier?.rank);
    return {
        totalPlays: Number(source.totalPlays) || 0,
        hoursWatched: Number(source.hoursWatched) || 0,
        moviesCount: Number(source.moviePlays) || 0,
        showsCount: Number(source.episodePlays) || 0,
        musicCount: Number(source.trackPlays) || 0,
        uniqueTitles: Number(source.uniqueTitles) || 0,
        uniqueMovies: Number(source.uniqueMovies) || 0,
        uniqueShows: Number(source.uniqueShows) || 0,
        uniqueMusic: Number(source.uniqueMusic) || 0,
        leaderboardRank: Number.isFinite(rank) && rank > 0 ? rank : null,
        totalActiveUsers: Number(dossier?.boardSize) || 0,
        leaderboardSource: 'achievements',
        leaderboardMetric: 'xp',
        currentStreak: Number(source.currentStreak) || 0,
        longestStreak: Number(source.longestStreak) || 0,
        bingeMax: Number(source.bingeMax) || 0,
        activeDays: Number(source.activeDays) || 0,
    };
};

const earnedFromSnapshot = (snapshot = {}) => {
    const defs = getBadgeDefinitionMap();
    const rows = [];
    for (const [badgeId, badge] of Object.entries(snapshot.badges || {})) {
        if (!badge?.earnedAt || badge?.revokedAt) continue;
        const def = defs.get(String(badgeId));
        if (!def) continue;
        rows.push({
            id: def.id,
            name: def.name,
            description: def.description,
            icon: def.icon,
            category: def.category,
            rarity: def.rarity || 'common',
            earnedAt: badge.earnedAt,
        });
    }
    rows.sort((a, b) => String(b.earnedAt || '').localeCompare(String(a.earnedAt || '')));
    return rows;
};

export const trophyCaseFromEarned = (earned = []) => (
    [...earned]
        .sort((a, b) => (RARITY_RANK[b.rarity] || 0) - (RARITY_RANK[a.rarity] || 0)
            || String(b.earnedAt || '').localeCompare(String(a.earnedAt || '')))
        .slice(0, 5)
);

/** Pinned badges first (max 3), then highest-rarity fills to 5. */
export const buildTrophyCase = (earned = [], pinnedIds = []) => {
    const byId = new Map((Array.isArray(earned) ? earned : []).map((badge) => [String(badge?.id || ''), badge]));
    const seen = new Set();
    const pinned = [];
    for (const raw of Array.isArray(pinnedIds) ? pinnedIds : []) {
        const id = String(raw || '').trim();
        if (!id || seen.has(id)) continue;
        const badge = byId.get(id);
        if (!badge) continue;
        seen.add(id);
        pinned.push({ ...badge, pinned: true });
        if (pinned.length >= 3) break;
    }
    const fill = trophyCaseFromEarned(
        (Array.isArray(earned) ? earned : []).filter((badge) => !seen.has(String(badge?.id || ''))),
    ).map((badge) => ({ ...badge, pinned: false }));
    return [...pinned, ...fill].slice(0, 5);
};

const mediaServerLabel = (mediaServerType = 'plex') => {
    const type = String(mediaServerType || 'plex').toLowerCase();
    if (type === 'emby') return 'Emby';
    if (type === 'jellyfin') return 'Jellyfin';
    return 'Plex';
};

const genresFromStats = (source, prefix, kind, limit = 4) => Object.entries(source)
    .filter(([key, value]) => key.startsWith(prefix) && Number(value) > 0)
    .map(([key, value]) => ({
        id: key,
        label: key.replace(prefix, '').replace(/_/g, ' '),
        kind,
        count: Number(value) || 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

const tasteFromStats = (stats = {}) => {
    const source = stats && typeof stats === 'object' ? stats : {};
    const movies = Number(source.moviePlays || source.uniqueMovies) || 0;
    const shows = Number(source.episodePlays || source.uniqueShows) || 0;
    const music = Number(source.trackPlays || source.uniqueMusic) || 0;
    const movieGenres = genresFromStats(source, 'genreMovies_', 'movie');
    const showGenres = genresFromStats(source, 'genreShows_', 'show');
    const genres = [...movieGenres, ...showGenres]
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);
    return {
        hoursWatched: Number(source.hoursWatched) || 0,
        totalPlays: Number(source.totalPlays) || 0,
        uniqueMovies: Number(source.uniqueMovies) || 0,
        uniqueShows: Number(source.uniqueShows) || 0,
        uniqueMusic: Number(source.uniqueMusic) || 0,
        currentStreak: Number(source.currentStreak) || 0,
        longestStreak: Number(source.longestStreak) || 0,
        bingeMax: Number(source.bingeMax) || 0,
        activeDays: Number(source.activeDays) || 0,
        mix: { movies, shows, music, total: movies + shows + music },
        movieGenres,
        showGenres,
        genres,
    };
};

const compareFromSnapshots = (viewerSnap = null, subjectSnap = null, viewerDossier = null, subjectDossier = null) => {
    if (!viewerSnap || !subjectSnap) return null;
    const viewerEarned = new Set(earnedFromSnapshot(viewerSnap).map((badge) => String(badge.id)));
    const subjectEarned = earnedFromSnapshot(subjectSnap);
    const sharedAll = subjectEarned.filter((badge) => viewerEarned.has(String(badge.id)));
    const shared = sharedAll.slice(0, 8);
    const viewerXp = Number(viewerSnap.xp) || 0;
    const subjectXp = Number(subjectSnap.xp) || 0;
    const viewerRank = Number(viewerDossier?.rank) || null;
    const subjectRank = Number(subjectDossier?.rank) || null;
    return {
        xpGap: subjectXp - viewerXp,
        sharedCount: sharedAll.length,
        shared,
        viewerXp,
        subjectXp,
        viewerRank,
        subjectRank,
        rankGap: (viewerRank && subjectRank) ? viewerRank - subjectRank : 0,
    };
};

export const assembleProfilePayload = ({
    isSelf = false,
    viewerIsAdmin = false,
    obfuscate = false,
    includeAccount = false,
    locked = false,
    privateToPeers = false,
    mediaServerType = 'plex',
    portalUser = null,
    subjectAccountId = null,
    dossier = null,
    snapshot = null,
    viewerSnapshot = null,
    viewerDossier = null,
    achievementsEnabled = false,
    showOnProfile = true,
    requests = null,
    sharedWatched = null,
    social = null,
    wrapUp = null,
    wrapUpPending = false,
} = {}) => {
    const rank = Number(dossier?.rank) || null;
    const xp = Number(snapshot?.xp ?? dossier?.xp) || 0;
    const progress = levelProgress(xp);
    const level = Number(progress.level ?? snapshot?.level ?? dossier?.level) || 1;
    const rawUsername = dossier?.username
        || portalUser?.username
        || snapshot?.username
        || 'Member';
    const username = obfuscate && !isSelf
        ? (rank ? `Viewer ${rank}` : 'Member')
        : rawUsername;
    const thumb = obfuscate && !isSelf
        ? null
        : (dossier?.thumb || portalUser?.thumb || snapshot?.thumb || null);

    const snapshotEarned = earnedFromSnapshot(snapshot || {});
    const earned = snapshotEarned.length
        ? snapshotEarned
        : (dossier?.momentum?.recentBadges || []);
    const pinnedIds = Array.isArray(snapshot?.pinnedBadgeIds) ? snapshot.pinnedBadgeIds : [];
    const trophyFromEarned = buildTrophyCase(earned, pinnedIds);
    const trophySource = trophyFromEarned.length
        ? trophyFromEarned
        : (Array.isArray(dossier?.trophyCase) ? dossier.trophyCase.map((badge) => ({ ...badge, pinned: false })) : []);
    const lastBadge = earned[0] || dossier?.lastBadge || null;
    const showTrophies = achievementsEnabled && showOnProfile !== false && !locked;

    const identity = {
        accountId: obfuscate && !isSelf ? undefined : (subjectAccountId || dossier?.accountId || null),
        username,
        thumb,
        provider: mediaServerLabel(mediaServerType),
        isMe: !!isSelf,
        classTitle: dossier?.classTitle || null,
        rank: rank || null,
        previousRank: dossier?.previousRank || null,
        rankDelta: dossier?.rankDelta || 0,
        boardSize: Number(dossier?.boardSize) || 0,
        xp,
        level,
        earnedCount: Number(snapshot?.earnedCount ?? dossier?.earnedCount ?? earned?.length) || 0,
        totalBadges: Number(dossier?.totalBadges ?? snapshot?.totalBadges) || 0,
        levelProgress: progress,
        joiningDate: includeAccount ? (portalUser?.joiningDate || null) : null,
    };

    if (locked && !viewerIsAdmin) {
        return {
            viewer: { isSelf: false, isAdmin: false },
            identity: {
                ...identity,
                accountId: undefined,
                thumb: null,
                classTitle: null,
                rank: null,
                previousRank: null,
                rankDelta: 0,
                boardSize: 0,
                xp: 0,
                level: 1,
                earnedCount: 0,
                totalBadges: 0,
                levelProgress: null,
                joiningDate: null,
            },
            privacy: { locked: true, privateToPeers: true },
            account: null,
            achievements: null,
            watch: null,
            compare: null,
            requests: null,
            social: null,
            features: { achievements: false, requests: false },
            updatedAt: null,
        };
    }

    const achievements = achievementsEnabled ? {
        enabled: true,
        showOnProfile: showTrophies,
        leaderboardOptOut: !!snapshot?.leaderboardOptOut,
        ...(showTrophies ? {
            trophyCase: trophySource,
            pinnedBadgeIds: pinnedIds.map(String).filter(Boolean).slice(0, 3),
            lastBadge,
            earned: earned.slice(0, 16),
            rarityBreakdown: dossier?.rarityBreakdown || null,
            firstUnlocks: dossier?.firstUnlocks || null,
            closest: dossier?.closest || null,
            rivals: dossier?.rivals || null,
            threat: dossier?.threat || null,
            momentum: dossier?.momentum || null,
            signature: dossier?.signature || null,
        } : {}),
    } : null;

    const stats = snapshot?.stats || {};
    const snapshotWrap = statsToWrapUpAnalytics(stats, dossier);
    const watch = {
        wrapUp: mergeProfileWrapUp(snapshotWrap, wrapUp, Number(snapshot?.xp ?? dossier?.xp) || 0),
        wrapUpPending: !!wrapUpPending,
        period: wrapUp?.period || 'last365',
        hoursWatched: Number(stats.hoursWatched) || 0,
        totalPlays: Number(stats.totalPlays) || 0,
        currentStreak: Number(stats.currentStreak) || 0,
        longestStreak: Number(stats.longestStreak) || 0,
        taste: tasteFromStats(stats),
    };

    return {
        viewer: { isSelf: !!isSelf, isAdmin: !!viewerIsAdmin },
        identity,
        privacy: {
            locked: false,
            privateToPeers: !!privateToPeers,
        },
        account: includeAccount ? buildAccountStrip(portalUser || {}) : null,
        achievements,
        watch,
        compare: (!isSelf && viewerSnapshot)
            ? {
                ...compareFromSnapshots(viewerSnapshot, snapshot, viewerDossier, dossier),
                sharedWatched: Array.isArray(sharedWatched) ? sharedWatched : [],
            }
            : null,
        social: social && typeof social === 'object' ? social : null,
        requests: includeAccount && requests ? requests : null,
        features: {
            achievements: !!achievementsEnabled,
            requests: !!(includeAccount && requests),
        },
        updatedAt: snapshot?.updatedAt || dossier?.updatedAt || null,
    };
};

export default assembleProfilePayload;
