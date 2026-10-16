/** Local PMS owner account. Cloud plex.tv ids are never this value. */
export const PLEX_OWNER_LOCAL_ACCOUNT_ID = '1';

const norm = (v) => String(v || '').trim().toLowerCase();

export const isPlexOwnerLocalAccountId = (id) => (
    String(id || '').trim() === PLEX_OWNER_LOCAL_ACCOUNT_ID
);

export const collectPlexIdentityIds = (...users) => (
    users.flatMap((user) => [user?.plexId, user?.id]
        .filter(Boolean)
        .map((id) => String(id).trim())
        .filter(Boolean))
);

/**
 * True only when a plex.tv cloud id matches the configured server owner.
 * Never trust leftover `isAdmin` flags — those can be stamped onto members.
 */
export const isPlexCloudOwnerIdentity = ({
    sessionUser,
    portalUser,
    adminCloudId,
    impersonating = false,
} = {}) => {
    if (impersonating) return false;
    const ownerId = String(adminCloudId || '').trim();
    if (!ownerId) return false;
    return collectPlexIdentityIds(sessionUser, portalUser).includes(ownerId);
};

/**
 * Plex owner check for portal user rows.
 * If the row has a plex.tv id that is not adminPlexId, leftover isAdmin is ignored.
 */
export const isPlexServerOwnerUser = (user = {}, config = {}) => {
    if (!user) return false;
    const adminCloudId = String(config?.adminPlexId || '').trim();
    const ids = collectPlexIdentityIds(user);
    if (adminCloudId && ids.includes(adminCloudId)) return true;
    if (adminCloudId && ids.length && !ids.includes(adminCloudId)) return false;
    return user.isAdmin === true;
};

export const usableStoredPlexAccountId = (stored, { isOwner = false, adminCloudId = '' } = {}) => {
    const id = String(stored || '').trim();
    if (!id) return null;
    if (adminCloudId && id === String(adminCloudId).trim()) return null;
    if (!isOwner && isPlexOwnerLocalAccountId(id)) return null;
    return id;
};

export const matchLocalPlexAccountId = (accounts, sessionUser, {
    allowOwnerAccount = false,
    adminCloudId = '',
} = {}) => {
    const list = Array.isArray(accounts) ? accounts : [];
    const accept = (account) => {
        if (!account || account.id == null) return false;
        const id = String(account.id);
        if (!allowOwnerAccount && isPlexOwnerLocalAccountId(id)) return false;
        if (adminCloudId && id === String(adminCloudId).trim()) return false;
        return true;
    };

    const sessionNames = [
        sessionUser?.username,
        sessionUser?.title,
        sessionUser?.friendlyName,
    ].map(norm).filter(Boolean);
    if (sessionNames.length) {
        const byName = list.find((account) => (
            accept(account) && sessionNames.includes(norm(account.name))
        ));
        if (byName) return String(byName.id);
    }

    if (sessionUser?.email) {
        const byEmail = list.find((account) => accept(account) && (
            norm(account.name) === norm(sessionUser.email)
            || norm(account.email) === norm(sessionUser.email)
        ));
        if (byEmail) return String(byEmail.id);
    }

    if (sessionUser?.plexId) {
        const byPlexId = list.find((account) => (
            accept(account) && String(account.id) === String(sessionUser.plexId)
        ));
        if (byPlexId) return String(byPlexId.id);
    }

    return null;
};

export const pickOwnerLocalPlexAccountId = (accounts, sessionUser, adminCloudId = '') => {
    const list = Array.isArray(accounts) ? accounts : [];
    const home = list.find((account) => isPlexOwnerLocalAccountId(account?.id))
        || list.find((account) => sessionUser?.username && norm(account.name) === norm(sessionUser.username))
        || list[0];
    if (home?.id != null) {
        const homeId = String(home.id);
        if (adminCloudId && homeId === String(adminCloudId).trim()) return PLEX_OWNER_LOCAL_ACCOUNT_ID;
        return homeId;
    }
    return PLEX_OWNER_LOCAL_ACCOUNT_ID;
};

/**
 * Pure local PMS accountID picker used by wrap-up / analytics.
 * Non-owners never receive account "1" or the owner's cloud plex.tv id.
 */
export const resolveLocalPlexAccountIdFromParts = ({
    isOwner = false,
    storedAccountId = null,
    adminCloudId = '',
    accounts = [],
    sessionUser = null,
} = {}) => {
    const stored = usableStoredPlexAccountId(storedAccountId, { isOwner, adminCloudId });
    if (!isOwner && stored) return stored;
    if (isOwner) return pickOwnerLocalPlexAccountId(accounts, sessionUser, adminCloudId);
    if (stored) return stored;
    return matchLocalPlexAccountId(accounts, sessionUser, {
        allowOwnerAccount: false,
        adminCloudId,
    });
};

export const shortcutPortalPlexAccountId = ({
    sessionUser,
    portalUser,
    adminCloudId,
    impersonating = false,
} = {}) => {
    const isOwner = isPlexCloudOwnerIdentity({
        sessionUser,
        portalUser,
        adminCloudId,
        impersonating,
    });
    const stored = usableStoredPlexAccountId(portalUser?.plexAccountId, { isOwner, adminCloudId });
    if (stored) return stored;
    if (isOwner) return PLEX_OWNER_LOCAL_ACCOUNT_ID;
    return null;
};

export const isTautulliAdminUser = (user) => {
    if (!user) return false;
    const flag = user.is_admin;
    return flag === true || flag === 1 || flag === '1';
};

export const shouldSkipTautulliAdminUser = (accountID) => (
    !isPlexOwnerLocalAccountId(accountID)
);
