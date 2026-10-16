/**
 * Resolve the signed-in user's current media-server session for Discover "Now Playing".
 */

import { extractTmdbIdFromPlexItem } from '../discovery-because-you-watched.js';

const normalize = (value) => String(value || '').trim().toLowerCase();

/** Plex JSON often returns one Metadata/Account entry as an object, not a 1-item array. */
export const asArray = (value) => {
    if (Array.isArray(value)) return value;
    if (value == null) return [];
    return [value];
};

export const isDiscoverNowPlayingEnabled = (config = {}) => config?.discoverNowPlayingEnabled !== false;

export const userAllowsDiscoverNowPlaying = (user = {}) => user?.showDiscoverNowPlaying !== false;

const pickPlexTmdbId = (metadata = {}) => extractTmdbIdFromPlexItem(metadata);

const pickJellyfinTmdbId = (item = {}) => {
    const providers = item.ProviderIds || {};
    const raw = providers.Tmdb || providers.tmdb || providers.TMDB;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
};

const sessionPlayer = (metadata = {}) => {
    const raw = metadata?.Player;
    if (Array.isArray(raw)) return raw[0] || {};
    return raw || {};
};

export const mapPlexSessionToNowPlaying = (metadata = {}, { thumbBase = '' } = {}) => {
    const type = String(metadata.type || '').toLowerCase();
    const isEpisode = type === 'episode';
    const mediaType = isEpisode ? 'tv' : (type === 'movie' ? 'movie' : null);
    if (!mediaType) return null;

    const season = isEpisode ? Number(metadata.parentIndex) : null;
    const episode = isEpisode ? Number(metadata.index) : null;
    const duration = Number(metadata.duration || 0);
    const viewOffset = Number(metadata.viewOffset || 0);
    const progress = duration > 0 ? Math.min(100, Math.max(0, (viewOffset / duration) * 100)) : 0;
    const tmdbId = pickPlexTmdbId(metadata);
    const title = isEpisode
        ? (metadata.grandparentTitle || metadata.title || 'Unknown show')
        : (metadata.title || 'Unknown movie');
    const thumbPath = metadata.grandparentThumb || metadata.parentThumb || metadata.thumb || '';
    // Prefer show backdrop for episodes so the portal hero matches the series, not an episode still.
    const artPath = isEpisode
        ? (metadata.grandparentArt || metadata.parentArt || metadata.art || '')
        : (metadata.art || metadata.thumb || '');
    const thumbUrl = thumbPath && thumbBase
        ? `${thumbBase}${thumbPath}${thumbPath.includes('?') ? '&' : '?'}X-Plex-Token=`
        : '';

    return {
        mediaType,
        tmdbId: Number.isFinite(tmdbId) && tmdbId > 0 ? tmdbId : null,
        title: String(title),
        episodeTitle: isEpisode ? String(metadata.title || '') : null,
        season: Number.isFinite(season) && season > 0 ? season : null,
        episode: Number.isFinite(episode) && episode > 0 ? episode : null,
        progress,
        state: String(sessionPlayer(metadata).state || metadata.Player?.state || 'playing').toLowerCase(),
        ratingKey: String(metadata.grandparentRatingKey || metadata.ratingKey || ''),
        sourceRatingKey: String(metadata.ratingKey || ''),
        thumbPath: thumbPath || null,
        artPath: artPath || null,
        sessionId: String(
            (Array.isArray(metadata.Session) ? metadata.Session[0]?.id : metadata.Session?.id)
            || metadata.sessionKey
            || '',
        ),
    };
};

export const mapJellyfinSessionToNowPlaying = (session = {}) => {
    const item = session.NowPlayingItem || null;
    if (!item) return null;
    const type = String(item.Type || '');
    const isEpisode = type === 'Episode';
    const isMovie = type === 'Movie';
    if (!isEpisode && !isMovie) return null;

    const playState = session.PlayState || {};
    const runtime = Number(item.RunTimeTicks || 0) / 10000;
    const position = Number(playState.PositionTicks || 0) / 10000;
    const progress = runtime > 0 ? Math.min(100, Math.max(0, (position / runtime) * 100)) : 0;
    const tmdbId = isEpisode
        ? (pickJellyfinTmdbId({ ProviderIds: item.ProviderIds }) // episode may have series in SeriesId only
            || null)
        : pickJellyfinTmdbId(item);

    // Prefer series TMDB for episodes when episode ProviderIds are episode-scoped.
    let seriesTmdb = tmdbId;
    if (isEpisode && item.SeriesId && !seriesTmdb) {
        seriesTmdb = null;
    }

    return {
        mediaType: isEpisode ? 'tv' : 'movie',
        tmdbId: seriesTmdb,
        jellyfinSeriesId: isEpisode ? (item.SeriesId || null) : null,
        jellyfinItemId: item.Id || null,
        // Prefer series art for episodes (hero backdrop); movie uses the item itself.
        artItemId: isEpisode ? (item.SeriesId || item.Id || null) : (item.Id || null),
        title: isEpisode
            ? String(item.SeriesName || item.Name || 'Unknown show')
            : String(item.Name || 'Unknown movie'),
        episodeTitle: isEpisode ? String(item.Name || '') : null,
        season: isEpisode && Number.isFinite(Number(item.ParentIndexNumber))
            ? Number(item.ParentIndexNumber)
            : null,
        episode: isEpisode && Number.isFinite(Number(item.IndexNumber))
            ? Number(item.IndexNumber)
            : null,
        progress,
        state: playState.IsPaused ? 'paused' : 'playing',
        sessionId: String(session.Id || ''),
        providerIds: item.ProviderIds || {},
    };
};

/** Expand plex.tv UUID forms so dashed JWT ids match undashed session/thumb ids. */
export const expandPlexIdVariants = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return [];
    const out = new Set([raw]);
    const nodash = raw.replace(/-/g, '');
    if (nodash && nodash !== raw) out.add(nodash);
    if (/^[a-f0-9]{32}$/i.test(nodash) && nodash.length === 32) {
        out.add(`${nodash.slice(0, 8)}-${nodash.slice(8, 12)}-${nodash.slice(12, 16)}-${nodash.slice(16, 20)}-${nodash.slice(20)}`);
    }
    return [...out];
};

export const plexSessionLocalAccountId = (metadata = {}) => {
    const raw = metadata?.accountID ?? metadata?.accountId ?? metadata?.AccountID;
    if (raw == null || raw === '') return '';
    return String(raw).trim();
};

/** True when Plex tags this row as the PMS owner (local account "1"). */
export const isOwnerPlexSessionMetadata = (metadata = {}) => {
    if (plexSessionLocalAccountId(metadata) === '1') return true;
    const userRaw = metadata.User;
    const user = Array.isArray(userRaw) ? (userRaw[0] || {}) : (userRaw || {});
    return String(user?.id ?? '').trim() === '1';
};

const collectPlexSessionOwnerIds = (metadata = {}) => {
    const userRaw = metadata.User;
    const user = Array.isArray(userRaw) ? (userRaw[0] || {}) : (userRaw || {});
    const accountRaw = metadata.Account;
    const accounts = asArray(accountRaw);
    const player = sessionPlayer(metadata);
    const localAccountId = plexSessionLocalAccountId(metadata);

    const thumb = String(user.thumb || metadata.userThumb || accounts[0]?.thumb || '');
    const thumbIdMatch = thumb.match(/plex\.tv\/users\/([^/]+)\//i)
        || thumb.match(/\/user\/([^/]+)\//i)
        || thumb.match(/[?&]user(?:Id)?=([^&]+)/i);

    return [
        user.id,
        user.uuid,
        localAccountId,
        metadata.accountID,
        metadata.AccountID,
        metadata.accountId,
        player.userID,
        player.userId,
        ...accounts.map((account) => account?.id),
        thumbIdMatch?.[1],
    ]
        .flatMap((value) => expandPlexIdVariants(value))
        .filter(Boolean);
};

export const sessionBelongsToPlexUser = (metadata = {}, {
    accountId = null,
    accountIds = [],
    plexId = null,
    username = '',
    email = '',
    aliases = [],
    isAdmin = false,
} = {}) => {
    // Plex server owners (portal admins) always stream under local PMS account "1".
    // Web/Android often attach a cloud User.id that never matches portal JWT ids.
    if (isAdmin && isOwnerPlexSessionMetadata(metadata)) return true;

    const userRaw = metadata.User;
    const user = Array.isArray(userRaw) ? (userRaw[0] || {}) : (userRaw || {});

    const sessionIds = collectPlexSessionOwnerIds(metadata);
    const idCandidates = [accountId, plexId, ...asArray(accountIds)]
        .flatMap((value) => expandPlexIdVariants(value))
        .filter(Boolean);
    if (sessionIds.some((sessionId) => idCandidates.includes(sessionId))) return true;

    const title = normalize(user.title);
    if (!title) return false;
    const nameCandidates = [username, email, ...asArray(aliases)]
        .map((value) => normalize(value))
        .filter(Boolean);
    if (nameCandidates.some((name) => name === title)) return true;
    // Some clients use "Name (email)" or email-local-part style titles.
    return nameCandidates.some((name) => (
        name.length >= 3
        && (title.includes(name) || name.includes(title))
    ));
};

const isPlayablePlexNowPlayingType = (metadata = {}) => {
    const type = String(metadata?.type || '').toLowerCase();
    return type === 'movie' || type === 'episode';
};

const preferActivePlexSession = (pool = []) => {
    const playing = pool.filter((metadata) => {
        const state = String(sessionPlayer(metadata).state || 'playing').toLowerCase();
        return state === 'playing' || state === 'buffering';
    });
    const prefer = playing.length ? playing : pool;
    return [...prefer].sort((a, b) => Number(b?.viewOffset || 0) - Number(a?.viewOffset || 0))[0] || null;
};

/**
 * Prefer a playable movie/episode session that belongs to the signed-in user.
 * Playing > paused; then highest viewOffset so multi-device setups pick the active one.
 *
 * Server owners often authenticate with a plex.tv cloud id/uuid while PMS tags their
 * live session as local account "1". When identity says isAdmin and no row matches,
 * also try owner account "1" — never fall back to someone else's sole stream.
 */
export const plexSessionTitleKey = (metadata = {}) => {
    const type = String(metadata?.type || '').toLowerCase();
    if (type === 'episode') {
        return `show:${metadata.grandparentRatingKey || metadata.grandparentKey || metadata.grandparentTitle || ''}`;
    }
    if (type === 'movie') {
        return `movie:${metadata.ratingKey || metadata.key || metadata.guid || metadata.title || ''}`;
    }
    return '';
};

export const jellyfinSessionTitleKey = (session = {}) => {
    const item = session?.NowPlayingItem;
    if (!item) return '';
    const type = String(item.Type || '');
    if (type === 'Episode') return `show:${item.SeriesId || item.SeriesName || ''}`;
    if (type === 'Movie') return `movie:${item.Id || item.Name || ''}`;
    return '';
};

const slimPlexOther = (metadata = {}) => {
    const userRaw = metadata.User;
    const user = Array.isArray(userRaw) ? (userRaw[0] || {}) : (userRaw || {});
    return {
        accountId: String(user.id || metadata.accountID || metadata.accountId || '').trim() || null,
        username: String(user.title || '').trim() || 'Member',
        thumb: user.thumb || null,
    };
};

const slimJellyfinOther = (session = {}) => ({
    accountId: String(session.UserId || '').trim() || null,
    username: String(session.UserName || '').trim() || 'Member',
    thumb: null,
});

export const collectOthersWatchingSamePlexTitle = (sessions, mine, identity = {}, limit = 4) => {
    const key = plexSessionTitleKey(mine);
    if (!key || !mine) return [];
    const seen = new Set();
    const others = [];
    for (const session of asArray(sessions)) {
        if (sessionBelongsToPlexUser(session, identity)) continue;
        if (plexSessionTitleKey(session) !== key) continue;
        const row = slimPlexOther(session);
        const dedupe = String(row.accountId || row.username || '').toLowerCase();
        if (!dedupe || seen.has(dedupe)) continue;
        seen.add(dedupe);
        others.push(row);
        if (others.length >= limit) break;
    }
    return others;
};

export const collectOthersWatchingSameJellyfinTitle = (sessions, mine, identity = {}, limit = 4) => {
    const key = jellyfinSessionTitleKey(mine);
    if (!key || !mine) return [];
    const seen = new Set();
    const others = [];
    for (const session of asArray(sessions)) {
        if (!session?.NowPlayingItem) continue;
        if (sessionBelongsToJellyfinUser(session, identity)) continue;
        if (jellyfinSessionTitleKey(session) !== key) continue;
        const row = slimJellyfinOther(session);
        const dedupe = String(row.accountId || row.username || '').toLowerCase();
        if (!dedupe || seen.has(dedupe)) continue;
        seen.add(dedupe);
        others.push(row);
        if (others.length >= limit) break;
    }
    return others;
};

export const pickOwnPlexNowPlayingSession = (sessions, identity = {}) => {
    const list = asArray(sessions);
    let own = list.filter((metadata) => sessionBelongsToPlexUser(metadata, identity));

    if (!own.length && identity?.isAdmin) {
        const ownerIdentity = {
            ...identity,
            isAdmin: false,
            accountId: '1',
            accountIds: [...new Set([...asArray(identity.accountIds), '1', String(identity.accountId || '')].filter(Boolean))],
        };
        own = list.filter((metadata) => (
            isOwnerPlexSessionMetadata(metadata)
            || sessionBelongsToPlexUser(metadata, ownerIdentity)
        ));
    }

    if (!own.length) return null;

    const mappable = own.filter(isPlayablePlexNowPlayingType);
    const pool = mappable.length ? mappable : own;
    return preferActivePlexSession(pool);
};

export const sessionBelongsToJellyfinUser = (session = {}, { jellyfinId = null, username = '' } = {}) => {
    if (jellyfinId && String(session.UserId) === String(jellyfinId)) return true;
    if (username && normalize(session.UserName) === normalize(username)) return true;
    return false;
};

export default {
    asArray,
    expandPlexIdVariants,
    isDiscoverNowPlayingEnabled,
    userAllowsDiscoverNowPlaying,
    mapPlexSessionToNowPlaying,
    mapJellyfinSessionToNowPlaying,
    plexSessionLocalAccountId,
    isOwnerPlexSessionMetadata,
    sessionBelongsToPlexUser,
    pickOwnPlexNowPlayingSession,
    sessionBelongsToJellyfinUser,
    plexSessionTitleKey,
    jellyfinSessionTitleKey,
    collectOthersWatchingSamePlexTitle,
    collectOthersWatchingSameJellyfinTitle,
};
