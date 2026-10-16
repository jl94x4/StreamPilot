/**
 * Poster + requester helpers for in-app request notifications.
 */

const TMDB_THUMB_SIZE = 'w185';

const firstNonEmpty = (...values) => {
    for (const value of values) {
        const text = String(value || '').trim();
        if (text) return text;
    }
    return '';
};

const emailLocalPart = (value) => {
    const raw = String(value || '').trim();
    if (!raw || !raw.includes('@')) return raw;
    return raw.split('@')[0] || raw;
};

const TV_MEDIA_TYPES = new Set(['tv', 'show', 'series', 'anime', '2']);
const MUSIC_MEDIA_TYPES = new Set(['music', 'album', 'artist']);
const MOVIE_MEDIA_TYPES = new Set(['movie', 'film', '1']);

export const resolveMediaType = (record = {}) => {
    const raw = String(
        record.mediaType ?? record.type ?? record.media?.mediaType ?? record.media?.type ?? '',
    ).toLowerCase().trim();
    if (TV_MEDIA_TYPES.has(raw)) return 'tv';
    if (MUSIC_MEDIA_TYPES.has(raw)) return 'music';
    if (MOVIE_MEDIA_TYPES.has(raw)) return 'movie';
    if (record.firstAirDate || record.media?.firstAirDate) return 'tv';
    if (record.seasons === 'all' || (Array.isArray(record.seasons) && record.seasons.length)) return 'tv';
    if (record.mbid || record.albumMbid || record.media?.mbid) return 'music';
    return 'movie';
};

export const buildNotificationPosterUrl = (source = {}, size = TMDB_THUMB_SIZE) => {
    const raw = firstNonEmpty(source.posterUrl, source.posterPath);
    if (raw) {
        if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
        const path = raw.startsWith('/') ? raw : `/${raw}`;
        return `https://image.tmdb.org/t/p/${size}${path}`;
    }
    if (resolveMediaType(source) === 'music') {
        const mbid = firstNonEmpty(source.albumMbid, source.mbid);
        if (mbid) {
            return `https://coverartarchive.org/release-group/${encodeURIComponent(mbid)}/front-250`;
        }
    }
    return '';
};

export const resolveRequesterDisplayName = (record = {}, user = null) => {
    const name = firstNonEmpty(
        user?.username,
        user?.displayName,
        record?.requestedBy?.username,
        record?.requestedBy?.displayName,
        record?.meta?.requestedByName,
        emailLocalPart(user?.email),
        emailLocalPart(record?.requestedBy?.email),
        emailLocalPart(record?.meta?.requestedByEmail),
    );
    return name || 'Someone';
};

export const rewriteAnonymousRequestBody = (body, username) => {
    const text = String(body || '');
    if (!text) return text;
    const name = String(username || '').trim();
    let next = text;
    if (name) {
        next = next.replace(/^A user (?:has )?requested /i, `${name} has requested `);
    }
    if (!/ has requested /i.test(next)) {
        next = next.replace(/^(.+?) requested /i, (_, who) => `${name || who} has requested `);
    }
    return next;
};

export const inAppRequestMeta = (record = {}, extra = {}) => {
    const mediaType = resolveMediaType(record);
    const posterUrl = buildNotificationPosterUrl(record) || null;
    return {
        requestId: record?.id ?? null,
        tmdbId: record?.tmdbId || null,
        mbid: record?.mbid || record?.albumMbid || null,
        mediaType,
        posterPath: record?.posterPath || null,
        posterUrl,
        skipWebPush: true,
        ...extra,
    };
};

const requesterFromRecord = (record = {}, users = []) => {
    const fromDto = firstNonEmpty(
        record?.requestedBy?.username,
        record?.requestedBy?.displayName,
    );
    if (fromDto) return fromDto;
    const list = Array.isArray(users) ? users : [];
    const user = list.find((entry) => (
        String(entry?.id) === String(record.userId)
        || (record?.meta?.requestedByEmail && String(entry?.email || '').toLowerCase() === String(record.meta.requestedByEmail).toLowerCase())
        || (record?.meta?.requestedByName && String(entry?.username || '').toLowerCase() === String(record.meta.requestedByName).toLowerCase())
    )) || null;
    return resolveRequesterDisplayName(record, user);
};

export const enrichInAppNotificationItems = async (items, { getRequest, loadUsers } = {}) => {
    if (!Array.isArray(items) || !items.length || typeof getRequest !== 'function') {
        return Array.isArray(items) ? items : [];
    }
    const ids = [...new Set(items
        .map((item) => item?.meta?.requestId)
        .filter((id) => id != null && String(id).trim() !== '')
        .map((id) => String(id)))];
    if (!ids.length) return items;

    const users = typeof loadUsers === 'function' ? await loadUsers() : [];
    const records = new Map();
    await Promise.all(ids.map(async (id) => {
        try {
            const record = await getRequest(id);
            if (record) records.set(String(id), record);
        } catch {
            // ignore missing / seerr-only ids
        }
    }));

    return items.map((item) => {
        const record = records.get(String(item?.meta?.requestId || ''));
        if (!record) return item;
        const media = inAppRequestMeta(record, { skipWebPush: item?.meta?.skipWebPush });
        const nextMeta = {
            ...(item.meta && typeof item.meta === 'object' ? item.meta : {}),
            ...media,
            posterUrl: item?.meta?.posterUrl || media.posterUrl,
            posterPath: item?.meta?.posterPath || media.posterPath,
        };
        const requester = requesterFromRecord(record, users);
        return {
            ...item,
            body: rewriteAnonymousRequestBody(item.body, requester),
            meta: nextMeta,
        };
    });
};

export default {
    buildNotificationPosterUrl,
    resolveRequesterDisplayName,
    rewriteAnonymousRequestBody,
    inAppRequestMeta,
    enrichInAppNotificationItems,
};
