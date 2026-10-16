/**
 * Per-member privacy overrides.
 * Admin global hide still wins. When the admin allows names, a member can
 * opt out of their own name, player, or achievements without hiding everyone.
 */

export const PRIVACY_DEFAULTS = Object.freeze({
    privacyShowName: true,
    privacyShowPlayer: true,
    privacyShowAchievements: true,
    privacyShowProfile: true,
});

const norm = (value) => String(value || '').trim().toLowerCase();

const stripIdentityIds = (identity = {}) => {
    const next = { ...identity };
    delete next.accountId;
    delete next.plexUserId;
    delete next.jellyfinId;
    delete next.userId;
    return next;
};

export const normalizeHideStreamUsers = (config = {}) => (
    config.hideStreamUsers === true ? 'anonymous' : String(config.hideStreamUsers || 'false')
);

export const adminAllowsMemberNames = (config = {}) => (
    normalizeHideStreamUsers(config) === 'false'
);

export const normalizeMemberPrivacy = (user = {}) => ({
    privacyShowName: user?.privacyShowName !== false,
    privacyShowPlayer: user?.privacyShowPlayer !== false,
    privacyShowAchievements: user?.privacyShowAchievements !== false,
    privacyShowProfile: user?.privacyShowProfile !== false,
});

export const findPortalUserForStream = (users = [], identity = {}) => {
    if (!Array.isArray(users) || !users.length) return null;
    const ids = [
        identity.accountId,
        identity.plexUserId,
        identity.plexId,
        identity.jellyfinId,
        identity.userId,
        identity.id,
    ].map((value) => String(value || '').trim()).filter(Boolean);
    const names = [identity.username, identity.user, identity.title]
        .map(norm)
        .filter((value) => value && value !== 'unknown' && value !== 'unknown user' && value !== 'anonymous');

    return users.find((user) => {
        if (!user) return false;
        const userIds = [
            user.id,
            user.plexId,
            user.plexAccountId,
            user.jellyfinId,
            user.jellyfinId ? `jellyfin:${user.jellyfinId}` : '',
        ].map((value) => String(value || '').trim()).filter(Boolean);
        if (ids.some((id) => userIds.includes(id))) return true;
        const username = norm(user.username);
        return !!(username && names.includes(username));
    }) || null;
};

/**
 * Apply admin global masking, then the subject's own opt-outs.
 * Admins always see the real identity.
 */
export const applyStreamPrivacy = ({
    viewer = {},
    config = {},
    identity = {},
    subjectUser = null,
} = {}) => {
    const mode = normalizeHideStreamUsers(config);
    const viewerIsAdmin = !!viewer?.isAdmin && !(viewer?.actor && viewer?.impersonatingUserId);
    if (viewerIsAdmin) return identity;

    if (mode === 'hidden') {
        return stripIdentityIds({
            ...identity,
            user: null,
            userThumb: null,
            playerTitle: null,
        });
    }
    if (mode === 'anonymous') {
        return stripIdentityIds({
            ...identity,
            user: 'Anonymous',
            userThumb: null,
            playerTitle: 'Anonymous',
        });
    }

    const privacy = normalizeMemberPrivacy(subjectUser || {});
    const next = { ...identity };
    if (!privacy.privacyShowName) {
        next.user = 'Anonymous';
        next.userThumb = null;
        delete next.accountId;
        delete next.plexUserId;
        delete next.jellyfinId;
        delete next.userId;
    }
    if (!privacy.privacyShowPlayer) {
        next.playerTitle = 'Anonymous';
    }
    return next;
};

export const shouldHidePeerName = (subjectUser = null, { viewerIsAdmin = false } = {}) => {
    if (viewerIsAdmin) return false;
    return !normalizeMemberPrivacy(subjectUser).privacyShowName;
};

export const applyMemberNamePrivacyToRows = (rows = [], portalUsers = [], {
    obfuscate = false,
    viewerIsAdmin = false,
} = {}) => {
    if (!Array.isArray(rows) || viewerIsAdmin || obfuscate) return rows;
    return rows.map((row) => {
        if (!row || row.isMe) return row;
        const subject = findPortalUserForStream(portalUsers, {
            user: row.username,
            username: row.username,
            accountId: row.accountId,
            plexUserId: row.accountId,
            userId: row.accountId || row.id,
        });
        if (!shouldHidePeerName(subject)) return row;
        return {
            ...row,
            username: 'Anonymous',
            thumb: null,
            accountId: undefined,
        };
    });
};

export const privacyMaskNowPlayingOthers = ({
    others = [],
    users = [],
    viewer = {},
    config = {},
} = {}) => {
    if (!Array.isArray(others) || !others.length) return [];
    const viewerIsAdmin = !!viewer?.isAdmin && !(viewer?.actor && viewer?.impersonatingUserId);
    const mode = normalizeHideStreamUsers(config);
    if (!viewerIsAdmin && mode === 'hidden') return [];
    return others.slice(0, 4).map((row) => {
        const subject = findPortalUserForStream(users, {
            user: row.username,
            username: row.username,
            accountId: row.accountId,
            plexUserId: row.accountId,
            userId: row.accountId,
        });
        const masked = applyStreamPrivacy({
            viewer,
            config,
            identity: {
                user: row.username,
                userThumb: row.thumb,
                accountId: row.accountId,
            },
            subjectUser: subject,
        });
        const name = String(masked.user || '').trim();
        const anonymous = !name || name.toLowerCase() === 'anonymous';
        const canLink = !anonymous && (
            viewerIsAdmin || normalizeMemberPrivacy(subject || {}).privacyShowProfile
        );
        const accountId = canLink
            ? String(masked.accountId || subject?.plexAccountId || subject?.id || row.accountId || '').trim()
            : '';
        return {
            username: anonymous ? 'Anonymous' : name,
            accountId: accountId || null,
            thumb: masked.userThumb || null,
        };
    });
};

export default {
    PRIVACY_DEFAULTS,
    normalizeHideStreamUsers,
    adminAllowsMemberNames,
    normalizeMemberPrivacy,
    findPortalUserForStream,
    applyStreamPrivacy,
    shouldHidePeerName,
    applyMemberNamePrivacyToRows,
    privacyMaskNowPlayingOthers,
};
