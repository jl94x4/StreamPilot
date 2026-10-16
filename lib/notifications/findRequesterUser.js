import { resolvePortalUserFromSeerr } from '../portal-request/seerrHistoryImport.js';

/** Resolve a portal users.json row from a request record (portal or Seerr-shaped). */
export const findRequesterUser = (users = [], record = {}) => {
    const list = Array.isArray(users) ? users : [];
    if (!list.length) return null;
    const recordUserId = String(record?.userId || '').trim();
    const byPortalId = recordUserId
        ? list.find((u) => String(u?.id) === recordUserId)
        : null;
    if (byPortalId) return byPortalId;

    const fromSeerr = resolvePortalUserFromSeerr({
        email: record?.meta?.requestedByEmail,
        username: record?.meta?.requestedByName,
        displayName: record?.meta?.requestedByName,
        plexId: record?.meta?.requestedByPlexId,
    }, list);
    if (fromSeerr) return fromSeerr;

    const email = String(record?.meta?.requestedByEmail || '').trim().toLowerCase();
    const name = String(record?.meta?.requestedByName || '').trim().toLowerCase();
    const plexId = String(record?.meta?.requestedByPlexId || recordUserId || '').trim();
    return list.find((u) => (
        (email && u.email && String(u.email).toLowerCase() === email)
        || (name && u.username && String(u.username).toLowerCase() === name)
        || (name && u.displayName && String(u.displayName).toLowerCase() === name)
        || (plexId && (String(u.plexId || '') === plexId || String(u.id || '') === plexId))
    )) || null;
};
