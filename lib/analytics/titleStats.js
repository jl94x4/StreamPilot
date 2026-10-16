/**
 * Roll watch-history rows for a single library title into stats, users, and charts.
 */

const unixSeconds = (value) => {
    const raw = Number(value) || 0;
    if (raw <= 0) return 0;
    return raw > 9999999999 ? Math.round(raw / 1000) : raw;
};

const platformLabel = (row) => {
    const platform = String(row?.platform || '').trim();
    if (platform) return platform;
    const player = String(row?.player || '').trim();
    if (player) return player;
    return 'Unknown';
};

export const rollupPlatformPlays = (rows = [], { limit = 8 } = {}) => {
    const counts = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
        if (!row) continue;
        const label = platformLabel(row);
        counts.set(label, (counts.get(label) || 0) + 1);
    }
    const ranked = [...counts.entries()]
        .map(([platform, plays]) => ({ platform, plays }))
        .sort((a, b) => b.plays - a.plays || a.platform.localeCompare(b.platform));
    if (ranked.length <= limit) return ranked;
    const head = ranked.slice(0, limit);
    const otherPlays = ranked.slice(limit).reduce((sum, row) => sum + row.plays, 0);
    if (otherPlays) head.push({ platform: 'Other', plays: otherPlays });
    return head;
};

export const aggregateTitleHistory = (rows = []) => {
    const usersMap = new Map();
    const byMonth = new Map();
    const byHour = Array.from({ length: 24 }, () => 0);
    let totalSeconds = 0;
    let lastWatchedAt = 0;

    for (const row of Array.isArray(rows) ? rows : []) {
        if (!row) continue;
        const user = String(row.user || 'Unknown').trim() || 'Unknown';
        const date = unixSeconds(row.date);
        const duration = Math.max(0, Number(row.duration) || 0);
        totalSeconds += duration;
        if (date > lastWatchedAt) lastWatchedAt = date;

        const entry = usersMap.get(user.toLowerCase()) || {
            user,
            userThumb: row.userThumb || null,
            plays: 0,
            totalSeconds: 0,
            lastWatchedAt: 0,
        };
        entry.plays += 1;
        entry.totalSeconds += duration;
        if (date >= entry.lastWatchedAt) {
            entry.lastWatchedAt = date;
            entry.user = user;
            if (row.userThumb) entry.userThumb = row.userThumb;
        }
        usersMap.set(user.toLowerCase(), entry);

        if (date) {
            const d = new Date(date * 1000);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            byMonth.set(key, (byMonth.get(key) || 0) + 1);
            byHour[d.getHours()] += 1;
        }
    }

    return {
        stats: {
            plays: Array.isArray(rows) ? rows.length : 0,
            uniqueUsers: usersMap.size,
            totalSeconds,
            lastWatchedAt: lastWatchedAt || null,
        },
        users: [...usersMap.values()].sort((a, b) => b.plays - a.plays || b.lastWatchedAt - a.lastWatchedAt),
        byMonth: [...byMonth.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([month, plays]) => ({ month, plays })),
        byHour: byHour.map((plays, hour) => ({ hour, plays })),
        byPlatform: rollupPlatformPlays(rows),
    };
};

const asIndex = (value) => {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

const childKey = (row, kind) => {
    if (kind === 'season') {
        const key = String(row?.parentRatingKey || '').trim();
        if (key) return key;
        const index = asIndex(row?.seasonNumber);
        return index == null ? '' : `season:${index}`;
    }
    const key = String(row?.ratingKey || '').trim();
    if (key) return key;
    const index = asIndex(row?.episodeNumber);
    return index == null ? '' : `episode:${index}`;
};

const rowMatchesChild = (row, child, kind) => {
    if (!row || !child) return false;
    const childRatingKey = String(child.ratingKey || '').trim();
    if (kind === 'season') {
        const parentKey = String(row.parentRatingKey || '').trim();
        if (childRatingKey && parentKey) return parentKey === childRatingKey;
        const index = asIndex(child.index);
        return index != null && asIndex(row.seasonNumber) === index;
    }
    const episodeKey = String(row.ratingKey || '').trim();
    if (childRatingKey && episodeKey) return episodeKey === childRatingKey;
    const index = asIndex(child.index);
    return index != null && asIndex(row.episodeNumber) === index;
};

export const synthesizeTitleChildren = (history = [], { kind } = {}) => {
    if (kind !== 'season' && kind !== 'episode') return [];
    const map = new Map();
    for (const row of Array.isArray(history) ? history : []) {
        if (!row) continue;
        const key = childKey(row, kind);
        if (!key) continue;
        const existing = map.get(key);
        if (existing) continue;
        if (kind === 'season') {
            const index = asIndex(row.seasonNumber);
            map.set(key, {
                ratingKey: String(row.parentRatingKey || '').trim(),
                title: row.parentTitle || (index === 0 ? 'Specials' : index != null ? `Season ${index}` : 'Season'),
                type: 'season',
                index,
                thumb: null,
                leafCount: null,
            });
            continue;
        }
        const index = asIndex(row.episodeNumber);
        map.set(key, {
            ratingKey: String(row.ratingKey || '').trim(),
            title: row.episodeTitle || row.title || (index != null ? `Episode ${index}` : 'Episode'),
            type: 'episode',
            index,
            parentIndex: asIndex(row.seasonNumber),
            thumb: null,
            leafCount: null,
        });
    }
    return [...map.values()].filter((child) => child.ratingKey);
};

export const rollupTitleChildren = (children = [], history = [], { kind } = {}) => {
    if (kind !== 'season' && kind !== 'episode') return [];
    const rows = Array.isArray(history) ? history : [];
    const list = (Array.isArray(children) ? children : []).filter(Boolean);
    return list.map((child) => {
        let plays = 0;
        let lastWatchedAt = 0;
        const users = new Set();
        for (const row of rows) {
            if (!rowMatchesChild(row, child, kind)) continue;
            plays += 1;
            const date = unixSeconds(row.date);
            if (date > lastWatchedAt) lastWatchedAt = date;
            users.add(String(row.user || 'Unknown').trim().toLowerCase() || 'unknown');
        }
        return {
            ratingKey: String(child.ratingKey || '').trim(),
            title: child.title || '',
            type: child.type || kind,
            index: asIndex(child.index),
            parentIndex: asIndex(child.parentIndex),
            thumb: child.thumb || null,
            leafCount: asIndex(child.leafCount),
            plays,
            uniqueUsers: users.size,
            lastWatchedAt: lastWatchedAt || null,
        };
    }).sort((a, b) => {
        const ai = a.index == null ? Number.POSITIVE_INFINITY : a.index;
        const bi = b.index == null ? Number.POSITIVE_INFINITY : b.index;
        return ai - bi || String(a.title).localeCompare(String(b.title));
    });
};
