/**
 * Count portal media requests for achievement XP.
 */

import { REQUESTS_DIR } from '../data-paths.js';
import { createJsonRequestStore } from '../portal-request/requestStore.js';

const norm = (value) => String(value || '').trim().toLowerCase();

const collectIdentityKeys = (identity = {}) => {
    const ids = new Set();
    const names = new Set();
    for (const value of [
        identity.portalUserId,
        identity.accountId,
        identity.plexAccountId,
        identity.plexId,
        identity.id,
        identity.userId,
        identity.jellyfinId,
        identity.embyId,
    ]) {
        const key = String(value || '').trim();
        if (key) ids.add(key);
    }
    for (const value of [identity.username, identity.email, identity.plexAccountName]) {
        const key = norm(value);
        if (key) names.add(key);
    }
    return { ids, names };
};

export const requestMatchesIdentity = (record = {}, identity = {}) => {
    const { ids, names } = collectIdentityKeys(identity);
    if (!ids.size && !names.size) return false;

    if (ids.has(String(record.userId || '').trim())) return true;

    const meta = record.meta && typeof record.meta === 'object' ? record.meta : {};
    const requestedBy = record.requestedBy && typeof record.requestedBy === 'object'
        ? record.requestedBy
        : {};

    for (const value of [
        meta.requestedByPlexId,
        meta.requestedById,
        requestedBy.id,
        requestedBy.plexId,
        requestedBy.plexAccountId,
    ]) {
        if (ids.has(String(value || '').trim())) return true;
    }

    for (const value of [
        meta.requestedByEmail,
        meta.requestedByName,
        requestedBy.email,
        requestedBy.displayName,
        requestedBy.username,
    ]) {
        if (names.has(norm(value))) return true;
    }
    return false;
};

export const countMediaRequestsForIdentity = (records = [], identity = {}) => (
    (Array.isArray(records) ? records : []).filter((record) => requestMatchesIdentity(record, identity)).length
);

export const identityFromPortalUser = (user = {}, accountId = null) => ({
    portalUserId: user?.id,
    id: user?.id,
    accountId,
    plexAccountId: user?.plexAccountId || accountId,
    plexId: user?.plexId,
    jellyfinId: user?.jellyfinId,
    embyId: user?.embyId,
    username: user?.username,
    email: user?.email,
});

let requestListCache = { at: 0, records: null };
const REQUEST_LIST_CACHE_MS = 15 * 1000;

export const loadPortalRequestRecords = async () => {
    const now = Date.now();
    if (requestListCache.records && now - requestListCache.at < REQUEST_LIST_CACHE_MS) {
        return requestListCache.records;
    }
    try {
        const store = createJsonRequestStore({ dataDir: REQUESTS_DIR });
        const records = await store.list();
        requestListCache = { at: now, records: Array.isArray(records) ? records : [] };
        return requestListCache.records;
    } catch {
        requestListCache = { at: now, records: [] };
        return [];
    }
};

export const findPortalUserForAccount = (users = [], accountId = null, identity = {}) => {
    const list = Array.isArray(users) ? users : [];
    const ids = new Set([
        accountId,
        identity.accountId,
        identity.portalUserId,
        identity.plexAccountId,
        identity.plexId,
        identity.id,
    ].map((value) => String(value || '').trim()).filter(Boolean));
    const names = new Set([identity.username, identity.email].map((value) => norm(value)).filter(Boolean));
    return list.find((user) => {
        for (const value of [user?.id, user?.plexAccountId, user?.plexId, user?.jellyfinId, user?.embyId]) {
            if (ids.has(String(value || '').trim())) return true;
        }
        if (names.has(norm(user?.username)) || names.has(norm(user?.email))) return true;
        return false;
    }) || null;
};

export const mediaRequestCountFor = async ({ users = [], accountId = null, identity = {}, records = null } = {}) => {
    const list = records || await loadPortalRequestRecords();
    const portalUser = findPortalUserForAccount(users, accountId, identity);
    return countMediaRequestsForIdentity(list, {
        ...identityFromPortalUser(portalUser || {}, accountId),
        ...identity,
        accountId: accountId || identity.accountId,
    });
};
