/**
 * Opt-in public profile extras: bio, pins, email, library names.
 * Defaults stay off / empty so nothing leaks until the member chooses.
 */

const MAX_BIO = 280;
const MAX_PINS = 12;

const uniqueIds = (values = []) => {
    const ids = [];
    for (const value of values) {
        const id = String(value || '').trim();
        if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
};

export const sanitizeProfileBio = (value = '') => String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_BIO);

export const normalizeProfilePins = (pins = []) => uniqueIds(Array.isArray(pins) ? pins : [])
    .slice(0, MAX_PINS);

export const profileIdentityKeys = (portalUser = null, accountId = null, snapshot = null) => uniqueIds([
    accountId,
    snapshot?.accountId,
    portalUser?.plexAccountId,
    portalUser?.id,
    portalUser?.plexId,
    portalUser?.jellyfinId,
    portalUser?.jellyfinId ? `jellyfin:${portalUser.jellyfinId}` : '',
]);

export const setProfilePin = (pins = [], accountId = '', pinned = true) => {
    const id = String(accountId || '').trim();
    const current = normalizeProfilePins(pins).filter((value) => value !== id);
    if (!pinned || !id) return current;
    return normalizeProfilePins([id, ...current]);
};

export const libraryNamesForUser = (portalUser = {}, catalog = []) => {
    const ids = Array.isArray(portalUser?.libraryIds)
        ? portalUser.libraryIds.map((value) => String(value)).filter(Boolean)
        : [];
    const list = Array.isArray(catalog) ? catalog : [];
    if (!ids.length) return { all: true, names: [] };
    const names = ids.map((id) => {
        const hit = list.find((row) => String(row?.id) === id || String(row?.key) === id);
        return String(hit?.title || '').trim();
    }).filter(Boolean);
    return { all: false, names };
};

export default {
    sanitizeProfileBio,
    normalizeProfilePins,
    profileIdentityKeys,
    setProfilePin,
    libraryNamesForUser,
};
