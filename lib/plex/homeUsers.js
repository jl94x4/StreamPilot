/**
 * Plex Home profile list + switch helpers (Who's watching?).
 * Managed Home users have no plex.tv login; apps switch after the owner authenticates.
 */

import { fetchPlexSharedServers } from './sharedServers.js';

const truthy = (value) => {
    if (value === true || value === 1) return true;
    const raw = String(value || '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
};

const firstAttr = (attrs, names) => {
    for (const name of names) {
        if (attrs[name] != null && String(attrs[name]).trim() !== '') return attrs[name];
    }
    return null;
};

const parseXmlAttributes = (tag) => {
    const attrs = {};
    const re = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let match;
    while ((match = re.exec(String(tag || '')))) {
        attrs[match[1]] = match[3] != null ? match[3] : match[4];
    }
    return attrs;
};

export const normalizePlexHomeUser = (raw = {}) => {
    if (!raw || typeof raw !== 'object') return null;
    const id = firstAttr(raw, ['id', 'userID', 'userId', 'uuid']);
    if (id == null || String(id).trim() === '') return null;
    const title = String(
        firstAttr(raw, ['title', 'friendlyName', 'username', 'name']) || 'Plex User',
    ).trim();
    return {
        id: String(id).trim(),
        uuid: raw.uuid ? String(raw.uuid).trim() : '',
        title,
        username: String(raw.username || '').trim(),
        email: String(raw.email || '').trim(),
        thumb: String(raw.thumb || raw.avatar || '').trim() || null,
        restricted: truthy(raw.restricted),
        admin: truthy(raw.admin),
        guest: truthy(raw.guest),
        // `protected` is the 4-digit Home PIN. `hasPassword` only means the plex.tv account has a password.
        protected: truthy(raw.protected),
        authToken: String(raw.authToken || raw.authenticationToken || '').trim(),
    };
};

export const toPublicPlexHomeUser = (user) => {
    if (!user) return null;
    return {
        id: user.id,
        uuid: user.uuid || '',
        title: user.title,
        thumb: user.thumb,
        restricted: !!user.restricted,
        admin: !!user.admin,
        protected: !!user.protected,
    };
};

const asUserList = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    return [value];
};

export const parsePlexHomeUsers = (payload) => {
    if (!payload) return [];
    if (Array.isArray(payload)) {
        return payload.map(normalizePlexHomeUser).filter(Boolean);
    }
    if (typeof payload !== 'object') return [];

    const candidates = [
        payload.users,
        payload.User,
        payload.user,
        payload.MediaContainer?.User,
        payload.MediaContainer?.user,
        payload.MediaContainer?.users,
        payload.mediaContainer?.User,
    ];
    for (const candidate of candidates) {
        if (candidate == null) continue;
        const list = asUserList(candidate).map(normalizePlexHomeUser).filter(Boolean);
        if (list.length) return list;
    }
    return [];
};

export const parsePlexHomeUsersXml = (xml = '') => {
    const text = String(xml || '');
    if (!text.includes('<')) return [];
    const users = [];
    const re = /<User\b([^>]*)\/?>/gi;
    let match;
    while ((match = re.exec(text))) {
        const user = normalizePlexHomeUser(parseXmlAttributes(match[1]));
        if (user) users.push(user);
    }
    return users;
};

export const shouldOfferPlexHomeSelect = (users = []) => (
    Array.isArray(users) && users.length > 1
);

export const isSamePlexHomeUser = (user, targetId) => {
    const want = String(targetId || '').trim();
    if (!user || !want) return false;
    return [user.id, user.uuid, user.plexId]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .includes(want);
};

export const findRememberedPlexHomeUser = (users, rememberedUserId) => {
    const want = String(rememberedUserId || '').trim();
    if (!want || !Array.isArray(users)) return null;
    return users.find((user) => isSamePlexHomeUser(user, want)) || null;
};

const sessionIdentityIds = (sessionUser = {}, localUser = {}) => (
    [
        localUser?.plexId,
        localUser?.id,
        localUser?.uuid,
        localUser?.plexAccountId,
        sessionUser?.plexId,
        sessionUser?.id,
        sessionUser?.uuid,
        sessionUser?.plexAccountId,
    ]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
);

const sessionIdentityNames = (sessionUser = {}, localUser = {}) => (
    [
        localUser?.username,
        localUser?.title,
        sessionUser?.username,
        sessionUser?.title,
    ]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
);

/** Map a portal session to a Plex Home profile (id/uuid first, unique name as fallback). */
export const matchPlexHomeUserForSession = (homeUsers = [], sessionUser = {}, localUser = {}) => {
    const list = Array.isArray(homeUsers) ? homeUsers : [];
    const ids = sessionIdentityIds(sessionUser, localUser);
    for (const user of list) {
        if (ids.some((id) => isSamePlexHomeUser(user, id))) return user;
    }
    const names = sessionIdentityNames(sessionUser, localUser);
    if (!names.length) return null;
    const named = list.filter((user) => {
        if (user?.admin) return false;
        const title = String(user?.title || '').trim().toLowerCase();
        const username = String(user?.username || '').trim().toLowerCase();
        return names.includes(title) || names.includes(username);
    });
    return named.length === 1 ? named[0] : null;
};

const HOME_SWITCH_CACHE_MS = 10 * 60 * 1000;

const homeUserIdentityIds = (user = {}) => (
    [user?.id, user?.uuid, user?.plexId]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
);

export const shareTokenForHomeUser = (shares = [], homeUser = {}) => {
    const ids = new Set(homeUserIdentityIds(homeUser));
    if (!ids.size) return '';
    const hit = (Array.isArray(shares) ? shares : []).find((share) => (
        share?.accessToken && ids.has(String(share.userID || '').trim())
    ));
    return String(hit?.accessToken || '').trim();
};

/** Owner-token switch so managed Home users get their own Continue Watching. */
export const resolvePlexHomeMemberToken = async ({
    ownerToken,
    machineId,
    sessionUser = {},
    localUser = {},
    pin,
    fetchImpl = fetch,
    headers = {},
    cache,
    now = Date.now,
    fetchHomeUsers = fetchPlexHomeUsers,
    switchUser = switchPlexHomeUser,
    fetchShares = fetchPlexSharedServers,
    cacheTtlMs = HOME_SWITCH_CACHE_MS,
} = {}) => {
    const owner = String(ownerToken || '').trim();
    if (!owner) return '';
    const cacheKey = String(localUser?.id || sessionUser?.id || sessionUser?.plexId || localUser?.plexId || '').trim();
    if (cache && cacheKey) {
        const hit = cache.get(cacheKey);
        if (hit?.token && Number(now()) - Number(hit.at || 0) < Number(cacheTtlMs || HOME_SWITCH_CACHE_MS)) {
            return String(hit.token);
        }
    }
    const homeUsers = await fetchHomeUsers(owner, { fetchImpl, headers }).catch(() => []);
    const match = matchPlexHomeUserForSession(homeUsers, sessionUser, localUser);
    if (!match || match.admin) return '';

    const listed = String(match.authToken || '').trim();
    if (listed && listed !== owner) {
        if (cache && cacheKey) cache.set(cacheKey, { token: listed, at: Number(now()) });
        return listed;
    }

    const switched = await switchUser({
        token: owner,
        userId: match.id,
        pin,
        fetchImpl,
        headers,
    });
    const switchedToken = String(switched?.authToken || '').trim();
    if (switched?.ok && !switched?.needsPin && switchedToken && switchedToken !== owner) {
        if (cache && cacheKey) cache.set(cacheKey, { token: switchedToken, at: Number(now()) });
        return switchedToken;
    }

    const serverId = String(machineId || '').trim();
    if (serverId) {
        const shares = await fetchShares(owner, serverId, { fetchImpl, headers }).catch(() => []);
        const sharedToken = shareTokenForHomeUser(shares, match);
        if (sharedToken && sharedToken !== owner) {
            if (cache && cacheKey) cache.set(cacheKey, { token: sharedToken, at: Number(now()) });
            return sharedToken;
        }
    }
    return '';
};

export const sessionCanUsePlexHomeSwitch = ({ isAdmin, plexHomeUser, hasOwnerToken } = {}) => (
    !!(isAdmin || plexHomeUser || hasOwnerToken)
);

export const sessionIsPlexHomeProfile = (users, sessionUser) => {
    if (!sessionUser) return false;
    const ids = [sessionUser.plexId, sessionUser.id, sessionUser.uuid]
        .map((value) => String(value || '').trim())
        .filter(Boolean);
    if (!ids.length || !Array.isArray(users)) return false;
    return users.some((user) => ids.some((id) => isSamePlexHomeUser(user, id)));
};

export const extractSwitchAuthToken = (payload, xml = '') => {
    if (payload && typeof payload === 'object') {
        const token = payload.authToken
            || payload.authenticationToken
            || payload.user?.authToken
            || payload.user?.authenticationToken
            || payload.User?.authToken
            || payload.User?.authenticationToken;
        if (token) return String(token).trim();
    }
    const text = String(xml || '');
    const match = text.match(/\b(?:authenticationToken|authToken)="([^"]+)"/i);
    return match ? String(match[1]).trim() : '';
};

export const fetchPlexHomeUsers = async (token, { fetchImpl = fetch, headers = {} } = {}) => {
    const authHeaders = { ...headers };
    if (token && !authHeaders['X-Plex-Token'] && !authHeaders['x-plex-token']) {
        authHeaders['X-Plex-Token'] = String(token);
    }
    const tryUrl = async (url) => {
        const res = await fetchImpl(url, { headers: authHeaders });
        if (!res.ok) return [];
        const raw = await res.text();
        try {
            const parsed = JSON.parse(raw);
            const users = parsePlexHomeUsers(parsed);
            if (users.length) return users;
        } catch {
            // XML fallback
        }
        return parsePlexHomeUsersXml(raw);
    };

    const v2 = await tryUrl('https://plex.tv/api/v2/home/users').catch(() => []);
    if (v2.length) return v2;
    return tryUrl('https://plex.tv/api/home/users').catch(() => []);
};

export const switchPlexHomeUser = async ({
    token,
    userId,
    uuid,
    pin,
    fetchImpl = fetch,
    headers = {},
} = {}) => {
    const id = String(userId || '').trim();
    const userUuid = String(uuid || '').trim();
    if (!id && !userUuid) return { ok: false, needsPin: false, authToken: '' };

    const params = new URLSearchParams();
    const pinValue = String(pin || '').trim();
    if (pinValue) params.set('pin', pinValue);
    const qs = params.toString();
    const urls = [];
    if (userUuid) urls.push(`https://plex.tv/api/v2/home/users/${encodeURIComponent(userUuid)}/switch`);
    if (id && id !== userUuid) urls.push(`https://plex.tv/api/home/users/${encodeURIComponent(id)}/switch`);
    if (id && !userUuid) urls.push(`https://plex.tv/api/home/users/${encodeURIComponent(id)}/switch`);
    const authHeaders = { ...headers };
    if (token && !authHeaders['X-Plex-Token'] && !authHeaders['x-plex-token']) {
        authHeaders['X-Plex-Token'] = String(token);
    }

    let sawPinReject = false;
    for (const base of urls) {
        const url = `${base}${qs ? `?${qs}` : ''}`;
        const res = await fetchImpl(url, { method: 'POST', headers: authHeaders });
        const raw = await res.text().catch(() => '');
        if (res.status === 401 || res.status === 403) {
            sawPinReject = true;
            continue;
        }
        if (!res.ok) continue;
        let payload = null;
        try { payload = JSON.parse(raw); } catch { payload = null; }
        const authToken = extractSwitchAuthToken(payload, raw);
        if (authToken) return { ok: true, needsPin: false, authToken };
    }
    return { ok: false, needsPin: sawPinReject, authToken: '' };
};
