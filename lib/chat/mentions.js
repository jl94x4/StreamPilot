/** Parse and resolve @username mentions in chat messages. */

const MENTION_PATTERN = /(?:^|[\s([{>])@([a-zA-Z0-9][a-zA-Z0-9._-]{1,31})/g;

export const parseMentionUsernames = (text) => {
    const names = new Set();
    const raw = String(text || '');
    let match;
    MENTION_PATTERN.lastIndex = 0;
    while ((match = MENTION_PATTERN.exec(raw)) !== null) {
        const name = String(match[1] || '').trim();
        if (name) names.add(name.toLowerCase());
    }
    return [...names];
};

export const buildMentionLookup = (users = []) => {
    const lookup = new Map();
    for (const user of Array.isArray(users) ? users : []) {
        const username = String(user?.username || '').trim();
        const id = String(user?.id || '').trim();
        if (!username || !id) continue;
        lookup.set(username.toLowerCase(), {
            userId: id,
            username,
            displayName: username,
            avatar: user?.thumb || user?.avatar || '',
        });
    }
    return lookup;
};

export const resolveMentions = (text, users = []) => {
    const lookup = buildMentionLookup(users);
    const resolved = [];
    const seen = new Set();
    for (const key of parseMentionUsernames(text)) {
        const hit = lookup.get(key);
        if (!hit || seen.has(hit.userId)) continue;
        seen.add(hit.userId);
        resolved.push({ userId: hit.userId, username: hit.username });
    }
    return resolved;
};

export const listMentionableUsers = (users = [], query = '', limit = 12) => {
    const q = String(query || '').trim().toLowerCase();
    const take = Math.max(1, Math.min(24, Number(limit) || 12));
    const rows = [];
    for (const user of Array.isArray(users) ? users : []) {
        const username = String(user?.username || '').trim();
        const id = String(user?.id || '').trim();
        if (!username || !id) continue;
        if (q && !username.toLowerCase().includes(q)) continue;
        rows.push({
            id,
            username,
            displayName: username,
            avatar: user?.thumb || user?.avatar || '',
        });
        if (rows.length >= take) break;
    }
    rows.sort((a, b) => a.username.localeCompare(b.username));
    return rows;
};

export const mapMentions = (mentions = []) => (
    Array.isArray(mentions)
        ? mentions
            .map((row) => ({
                userId: String(row?.userId || row?.id || ''),
                username: String(row?.username || ''),
            }))
            .filter((row) => row.userId && row.username)
        : []
);
