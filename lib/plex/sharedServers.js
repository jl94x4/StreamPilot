/**
 * Server-scoped tokens for shared Plex friends.
 * plex.tv /shared_servers lists each friend's accessToken for this machine;
 * Continue Watching then uses that token, same as python-plexapi switchUser.
 */

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

const asList = (value) => {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
};

export const normalizePlexSharedServer = (raw = {}) => {
    if (!raw || typeof raw !== 'object') return null;
    const userID = firstAttr(raw, ['userID', 'userId', 'invitedId']);
    const accessToken = String(firstAttr(raw, ['accessToken', 'authToken', 'token']) || '').trim();
    if (!userID && !raw.username && !raw.email) return null;
    return {
        id: String(raw.id || '').trim(),
        userID: userID ? String(userID).trim() : '',
        username: String(raw.username || raw.title || '').trim(),
        email: String(raw.email || '').trim(),
        title: String(raw.title || raw.username || '').trim(),
        accessToken,
    };
};

export const parsePlexSharedServers = (payload) => {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload.map(normalizePlexSharedServer).filter(Boolean);
    if (typeof payload !== 'object') return [];
    const candidates = [
        payload.MediaContainer?.SharedServer,
        payload.MediaContainer?.sharedServer,
        payload.SharedServer,
        payload.sharedServers,
    ];
    for (const candidate of candidates) {
        if (candidate == null) continue;
        const list = asList(candidate).map(normalizePlexSharedServer).filter(Boolean);
        if (list.length) return list;
    }
    return [];
};

export const parsePlexSharedServersXml = (xml = '') => {
    const text = String(xml || '');
    if (!text.includes('<')) return [];
    const users = [];
    const re = /<SharedServer\b([^>]*)\/?>/gi;
    let match;
    while ((match = re.exec(text))) {
        const user = normalizePlexSharedServer(parseXmlAttributes(match[1]));
        if (user) users.push(user);
    }
    return users;
};

/** Friends + Home users on plex.tv /api/users, with this machine's server accessToken. */
export const parsePlexUsersServerTokensXml = (xml = '', machineId = '') => {
    const want = String(machineId || '').trim();
    const text = String(xml || '');
    if (!text.includes('<User')) return [];
    const users = [];
    const userRe = /<User\b([^>]*)>([\s\S]*?)<\/User>/gi;
    let match;
    while ((match = userRe.exec(text))) {
        const attrs = parseXmlAttributes(match[1]);
        const body = match[2] || '';
        let token = String(attrs.accessToken || attrs.authToken || '').trim();
        const serverRe = /<Server\b([^>]*)\/?>/gi;
        let serverMatch;
        while ((serverMatch = serverRe.exec(body))) {
            const server = parseXmlAttributes(serverMatch[1]);
            const mid = String(server.machineIdentifier || '').trim();
            if (want && mid && mid !== want) continue;
            const serverToken = String(server.accessToken || server.authToken || '').trim();
            if (serverToken) {
                token = serverToken;
                break;
            }
        }
        if (!token) continue;
        const user = normalizePlexSharedServer({
            ...attrs,
            userID: attrs.userID || attrs.userId || attrs.id,
            accessToken: token,
        });
        if (user?.accessToken) users.push(user);
    }
    return users;
};

const mergeSharedServerTokens = (...lists) => {
    const byId = new Map();
    for (const list of lists) {
        for (const row of Array.isArray(list) ? list : []) {
            if (!row?.accessToken) continue;
            const key = String(row.userID || row.email || row.username || '').trim();
            if (!key || byId.has(key)) continue;
            byId.set(key, row);
        }
    }
    return [...byId.values()];
};

const sessionIdentityIds = (sessionUser = {}, localUser = {}) => (
    [
        localUser?.plexId,
        localUser?.id,
        localUser?.uuid,
        sessionUser?.plexId,
        sessionUser?.id,
        sessionUser?.uuid,
    ]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
);

const sessionIdentityNames = (sessionUser = {}, localUser = {}) => (
    [
        localUser?.username,
        localUser?.email,
        localUser?.title,
        sessionUser?.username,
        sessionUser?.email,
        sessionUser?.title,
    ]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
);

export const matchPlexSharedServerForSession = (shares = [], sessionUser = {}, localUser = {}) => {
    const list = (Array.isArray(shares) ? shares : []).filter((row) => row?.accessToken);
    const ids = sessionIdentityIds(sessionUser, localUser);
    for (const share of list) {
        if (ids.includes(String(share.userID || ''))) return share;
    }
    const names = sessionIdentityNames(sessionUser, localUser);
    if (!names.length) return null;
    const named = list.filter((share) => {
        const username = String(share.username || '').trim().toLowerCase();
        const email = String(share.email || '').trim().toLowerCase();
        const title = String(share.title || '').trim().toLowerCase();
        return names.includes(username) || names.includes(email) || names.includes(title);
    });
    return named.length === 1 ? named[0] : null;
};

const SHARED_TOKEN_CACHE_MS = 10 * 60 * 1000;

export const fetchPlexSharedServers = async (token, machineId, { fetchImpl = fetch, headers = {} } = {}) => {
    const id = String(machineId || '').trim();
    const owner = String(token || '').trim();
    if (!id || !owner) return [];
    const authHeaders = { ...headers };
    if (!authHeaders['X-Plex-Token'] && !authHeaders['x-plex-token']) {
        authHeaders['X-Plex-Token'] = owner;
    }
    const url = `https://plex.tv/api/servers/${encodeURIComponent(id)}/shared_servers`;
    const res = await fetchImpl(url, { headers: authHeaders });
    let fromShares = [];
    if (res?.ok) {
        const raw = await res.text();
        try {
            const parsed = JSON.parse(raw);
            fromShares = parsePlexSharedServers(parsed);
        } catch {
            fromShares = [];
        }
        if (!fromShares.length) fromShares = parsePlexSharedServersXml(raw);
    }

    let fromUsers = [];
    try {
        const usersRes = await fetchImpl('https://plex.tv/api/users', { headers: authHeaders });
        if (usersRes?.ok) {
            fromUsers = parsePlexUsersServerTokensXml(await usersRes.text(), id);
        }
    } catch {
        fromUsers = [];
    }
    return mergeSharedServerTokens(fromShares, fromUsers);
};

/** Owner-token lookup of a friend's server-scoped token for Continue Watching. */
export const resolvePlexSharedServerMemberToken = async ({
    ownerToken,
    machineId,
    sessionUser = {},
    localUser = {},
    fetchImpl = fetch,
    headers = {},
    cache,
    now = Date.now,
    fetchShares = fetchPlexSharedServers,
    cacheTtlMs = SHARED_TOKEN_CACHE_MS,
} = {}) => {
    const owner = String(ownerToken || '').trim();
    const serverId = String(machineId || '').trim();
    if (!owner || !serverId) return '';
    const cacheKey = String(localUser?.id || sessionUser?.id || sessionUser?.plexId || localUser?.plexId || '').trim();
    if (cache && cacheKey) {
        const hit = cache.get(cacheKey);
        if (hit?.token && Number(now()) - Number(hit.at || 0) < Number(cacheTtlMs || SHARED_TOKEN_CACHE_MS)) {
            return String(hit.token);
        }
    }
    const shares = await fetchShares(owner, serverId, { fetchImpl, headers }).catch(() => []);
    const match = matchPlexSharedServerForSession(shares, sessionUser, localUser);
    const token = String(match?.accessToken || '').trim();
    if (!token || token === owner) return '';
    if (cache && cacheKey) cache.set(cacheKey, { token, at: Number(now()) });
    return token;
};
