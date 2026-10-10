/** Plex JSON → PlayerItem. Copy this file when splitting Media Player out of StreamPilot. */
import { extractTmdbIdFromPlexItem } from '../discovery-because-you-watched.js';

const asInt = (value) => {
    const next = Number(value);
    return Number.isFinite(next) ? next : null;
};

/** Resume point in ms. Newer PMS puts it on UserState unless includeUserState=1 flattens it. */
export const plexViewOffsetMs = (meta = {}) => {
    const direct = asInt(meta?.viewOffset);
    if (direct) return direct;
    const raw = meta?.UserState || meta?.userState;
    const user = Array.isArray(raw) ? raw[0] : raw;
    if (!user || typeof user !== 'object') return 0;
    return asInt(user.viewOffset) || asInt(user.viewOffsetMs) || 0;
};

const asArray = (value) => {
    if (Array.isArray(value)) return value;
    if (value == null) return [];
    return [value];
};

/** Relative PMS path only — strips server:// URIs used on smart collections. */
export const safePlexLibraryPath = (value) => {
    let raw = String(value || '').trim();
    const libraryIdx = raw.indexOf('/library/');
    const hubsIdx = raw.indexOf('/hubs/');
    const idx = libraryIdx >= 0 ? libraryIdx : hubsIdx;
    if (idx > 0) raw = raw.slice(idx);
    if (!raw.startsWith('/library/') && !raw.startsWith('/hubs/')) return '';
    if (raw.includes('\\') || raw.includes('..') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return '';
    return raw;
};

/** Image paths only — drop query/hash tokens while keeping /thumb/123 cache stamps. */
const safePlexImagePath = (value) => {
    const path = safePlexLibraryPath(value);
    if (!path) return '';
    return path.split('#')[0].split('?')[0];
};

const ALLOWED_REMOTE_POSTER_HOSTS = new Set([
    'metadata-static.plex.tv',
    'meta.plex.tv',
    'images.plex.tv',
    'provider-static.plex.tv',
    'image.tmdb.org',
    'www.themoviedb.org',
]);

const safeRemotePosterUrl = (value) => {
    const raw = String(value || '').trim();
    if (!/^https:\/\//i.test(raw)) return '';
    try {
        const parsed = new URL(raw);
        if (parsed.protocol !== 'https:') return '';
        const host = String(parsed.hostname || '').toLowerCase();
        if (!ALLOWED_REMOTE_POSTER_HOSTS.has(host) && !host.endsWith('.plex.tv')) return '';
        parsed.searchParams.delete('X-Plex-Token');
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return '';
    }
};

const isPosterImageRow = (row = {}) => {
    const type = String(row?.type || '').toLowerCase();
    const alt = String(row?.alt || '').toLowerCase();
    if (type === 'background' || type === 'art' || type === 'clearlogo' || type === 'logo') return false;
    if (!type && !alt) return true;
    return type === 'coverposter'
        || type === 'poster'
        || type === 'coverart'
        || alt === 'coverposter'
        || alt === 'poster';
};

/** Poster path for cards — PMS paths, plex.tv/TMDB URLs, or a numeric synthesized thumb. */
export const pickPlayerThumb = (meta = {}) => {
    const candidates = [meta.thumb, meta.parentThumb, meta.grandparentThumb];
    for (const candidate of candidates) {
        const path = safePlexImagePath(candidate);
        if (path) return path;
        const remote = safeRemotePosterUrl(candidate);
        if (remote) return remote;
    }
    for (const row of asArray(meta.Image)) {
        if (!isPosterImageRow(row)) continue;
        const raw = String(row?.url || row?.key || '').trim();
        const path = safePlexImagePath(raw);
        if (path) return path;
        const remote = safeRemotePosterUrl(raw);
        if (remote) return remote;
    }
    const type = String(meta.type ?? '').trim().toLowerCase();
    // Season thumbs are often omitted. A synthesized `/thumb` 404s and flashes "Poster Not Found".
    if (type === 'season' || type === '3') return null;
    const ratingKey = String(meta.ratingKey || '').trim();
    // Related hubs sometimes send plex GUID keys (`5d776…`). Digits-only synthesis 404s.
    if (/^\d+$/.test(ratingKey)) return `/library/metadata/${ratingKey}/thumb`;
    return null;
};

export const withPlexContainerParams = (path, token, { start = 0, size = 500 } = {}) => {
    const raw = String(path || '');
    const qIndex = raw.indexOf('?');
    const pathname = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
    const params = new URLSearchParams(qIndex >= 0 ? raw.slice(qIndex + 1) : '');
    params.set('X-Plex-Container-Start', String(Math.max(0, start)));
    params.set('X-Plex-Container-Size', String(Math.max(1, size)));
    if (token) params.set('X-Plex-Token', String(token));
    return `${pathname}?${params.toString()}`;
};

export const plexContainerItems = (payload) => {
    const mc = payload?.MediaContainer || {};
    const nested = asArray(mc.Metadata).flatMap((row) => [
        ...asArray(row?.Children?.Metadata),
        ...asArray(row?.Children?.Directory),
    ]);
    return [
        ...asArray(mc.Metadata),
        ...asArray(mc.Directory),
        ...asArray(mc.Hub).flatMap((hub) => [...asArray(hub?.Metadata), ...asArray(hub?.Directory)]),
        ...nested,
    ];
};

/** Movies/shows inside a collection — skip the collection row itself. */
export const collectionChildItems = (payload, collectionRatingKey = '') => {
    const want = String(collectionRatingKey || '');
    const seen = new Set();
    return plexContainerItems(payload).filter((row) => {
        const key = String(row?.ratingKey || '').trim();
        if (!key || seen.has(key)) return false;
        if (want && key === want) return false;
        if (String(row?.type || '').toLowerCase() === 'collection') return false;
        seen.add(key);
        return true;
    });
};

const childrenPathFromKey = (key) => {
    const path = safePlexLibraryPath(key);
    if (!path) return '';
    if (path.includes('?') || /\/(?:children|items)\/?$/i.test(path)) return path;
    return `${path.replace(/\/$/, '')}/children`;
};

export const collectionChildPaths = (meta = {}, ratingKey = '') => {
    const id = String(ratingKey || meta.ratingKey || '').trim();
    const sectionId = String(meta.librarySectionID || '').replace(/\D/g, '');
    const index = meta.index != null && String(meta.index).trim() !== '' ? String(meta.index).trim() : '';
    const paths = [];
    const add = (value) => {
        const next = String(value || '').trim();
        if (!next || paths.includes(next)) return;
        paths.push(next);
    };
    add(childrenPathFromKey(meta.key));
    if (id) {
        add(`/library/metadata/${id}/children`);
        add(`/library/collections/${id}/children`);
    }
    add(safePlexLibraryPath(meta.content));
    if (sectionId && id) add(`/library/sections/${sectionId}/all?collection=${encodeURIComponent(id)}`);
    if (sectionId && index && index !== id) add(`/library/sections/${sectionId}/all?collection=${encodeURIComponent(index)}`);
    return paths;
};

/** Series TMDB id for TV seasons; otherwise the title's TMDB id. */
export const pickPlayerTmdbId = (meta = {}) => {
    const type = String(meta.type || '').toLowerCase();
    const source = {
        ...meta,
        type: type === 'season' ? 'episode' : type,
        Guid: asArray(meta.Guid),
    };
    const tmdbId = extractTmdbIdFromPlexItem(source);
    return Number.isFinite(tmdbId) && tmdbId > 0 ? tmdbId : null;
};

/** Show TMDB id only — never the episode/season leaf id. */
export const pickPlayerShowTmdbId = (meta = {}) => {
    const type = String(meta.type || '').toLowerCase();
    if (type !== 'episode' && type !== 'season') return pickPlayerTmdbId(meta);
    const id = extractTmdbIdFromPlexItem({
        type: 'episode',
        grandparentGuid: meta.grandparentGuid,
        parentGuid: type === 'season' ? (meta.parentGuid || meta.guid) : meta.parentGuid,
        Guid: [],
        guid: '',
    });
    return Number.isFinite(id) && id > 0 ? id : null;
};

const LOGO_IMAGE_TYPES = new Set(['clearlogo', 'logo']);

const ALLOWED_REMOTE_LOGO_HOSTS = new Set([
    'metadata-static.plex.tv',
    'meta.plex.tv',
    'images.plex.tv',
    'image.tmdb.org',
    'www.themoviedb.org',
]);

const safeRemoteLogoUrl = (value) => {
    const raw = String(value || '').trim();
    if (!/^https:\/\//i.test(raw)) return '';
    try {
        const parsed = new URL(raw);
        if (parsed.protocol !== 'https:') return '';
        const host = String(parsed.hostname || '').toLowerCase();
        if (!ALLOWED_REMOTE_LOGO_HOSTS.has(host) && !host.endsWith('.plex.tv')) return '';
        return parsed.toString();
    } catch {
        return '';
    }
};

export const pickPlayerLogo = (meta = {}) => {
    const images = asArray(meta.Image);
    for (const row of images) {
        const type = String(row?.type || '').toLowerCase();
        const alt = String(row?.alt || '').toLowerCase();
        const raw = String(row?.url || row?.key || '').trim();
        const path = safePlexLibraryPath(raw);
        const isLogo = LOGO_IMAGE_TYPES.has(type)
            || alt === 'clearlogo'
            || alt === 'logo'
            || path.toLowerCase().includes('/clearlogo')
            || /\/clearlogo(?:\/|$|\?)/i.test(raw);
        if (!isLogo) continue;
        if (path) return path;
        const remote = safeRemoteLogoUrl(raw);
        if (remote) return remote;
    }
    // Image payload present but no clearLogo → do not invent a path (avoids 404/500).
    if (images.length > 0) return null;

    const kind = String(meta.type || '');
    const ratingKey = String(meta.ratingKey || '').replace(/\D/g, '');
    if ((kind === 'movie' || kind === 'show') && ratingKey) {
        return `/library/metadata/${ratingKey}/clearLogo`;
    }
    const parentKey = String(meta.grandparentRatingKey || meta.parentRatingKey || '').replace(/\D/g, '');
    if ((kind === 'episode' || kind === 'season') && parentKey) {
        return `/library/metadata/${parentKey}/clearLogo`;
    }
    return null;
};

/** Plex theme audio is `/library/metadata/{id}/theme` — never a filesystem path. */
export const isPlayerThemePath = (value) => {
    const path = safePlexLibraryPath(value);
    const pathname = path.split('?')[0];
    return /^\/library\/metadata\/\d+\/theme$/i.test(pathname);
};

export const pickPlayerThemePath = (meta = {}) => {
    for (const value of [meta.theme, meta.grandparentTheme, meta.parentTheme]) {
        const path = safePlexLibraryPath(value);
        if (!isPlayerThemePath(path)) continue;
        const qIndex = path.indexOf('?');
        const pathname = qIndex >= 0 ? path.slice(0, qIndex) : path;
        const params = new URLSearchParams(qIndex >= 0 ? path.slice(qIndex + 1) : '');
        params.delete('X-Plex-Token');
        const qs = params.toString();
        return qs ? `${pathname}?${qs}` : pathname;
    }
    return '';
};

export const pickPlayerThemeKey = (meta = {}) => {
    const match = String(pickPlayerThemePath(meta) || '').match(/\/library\/metadata\/(\d+)\/theme/i);
    return match?.[1] || '';
};

export const buildPlayerThemeSrc = (ratingKey) => {
    const key = String(ratingKey || '').replace(/\D/g, '');
    return key ? `/api/media-player/theme/${encodeURIComponent(key)}` : '';
};

const mapPeople = (list, limit = 20) => {
    if (!Array.isArray(list)) return [];
    return list.slice(0, limit).map((row) => ({
        id: row?.id != null ? String(row.id) : String(row?.tag || ''),
        name: String(row?.tag || '').trim(),
        role: String(row?.role || '').trim(),
        thumb: pickPersonThumb(row),
    })).filter((row) => row.name);
};

/** Normalize cast/crew photos — PMS absolute URLs → relative; keep public plex.tv hosts. */
export const pickPersonThumb = (row = {}) => {
    const raw = String(row?.thumb || '').trim();
    if (!raw) return null;
    const libraryPath = safePlexImagePath(raw);
    if (libraryPath) return libraryPath;
    try {
        const url = new URL(raw);
        if (url.protocol !== 'https:') return null;
        const host = url.hostname.toLowerCase();
        const allowed = host === 'metadata-static.plex.tv'
            || host === 'images.plex.tv'
            || host === 'provider-static.plex.tv'
            || host.endsWith('.plex.tv');
        if (!allowed) return null;
        url.searchParams.delete('X-Plex-Token');
        url.hash = '';
        return url.toString();
    } catch {
        return null;
    }
};

/** Studio ids and names Plex will accept as `?studio=` / `?network=` filters. */
export const studioQueryValues = (studioKey, name) => {
    const id = String(studioKey || '').trim();
    const tag = String(name || '').trim();
    const values = [];
    if (id) values.push(id);
    if (tag && tag.toLowerCase() !== id.toLowerCase()) values.push(tag);
    return values;
};

/** Normalize labels so "Apple TV+", "AppleTV", "Apple TV Plus" compare equal. */
export const normalizeStudioMatchKey = (value = '') => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[.+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const STUDIO_MATCH_ALIASES = {
    netflix: 'netflix',
    'netflix original': 'netflix',
    'netflix originals': 'netflix',
    disney: 'disney',
    'disney plus': 'disney',
    disneyplus: 'disney',
    apple: 'apple tv',
    appletv: 'apple tv',
    'apple tv': 'apple tv',
    'apple tv plus': 'apple tv',
    'apple tv+': 'apple tv',
    prime: 'prime video',
    'prime video': 'prime video',
    amazon: 'prime video',
    'amazon prime': 'prime video',
    'amazon prime video': 'prime video',
    hulu: 'hulu',
    hbo: 'hbo',
    'hbo max': 'hbo',
    max: 'hbo',
    paramount: 'paramount',
    'paramount plus': 'paramount',
    paramountplus: 'paramount',
    peacock: 'peacock',
    'peacock premium': 'peacock',
    starz: 'starz',
    showtime: 'showtime',
    amc: 'amc',
    'amc plus': 'amc',
    lionsgate: 'lionsgate',
    'lions gate': 'lionsgate',
};

export const studioMatchAlias = (value = '') => {
    const normalized = normalizeStudioMatchKey(value);
    return STUDIO_MATCH_ALIASES[normalized] || normalized;
};

export const studioNamesMatch = (a, b) => {
    const left = studioMatchAlias(a);
    const right = studioMatchAlias(b);
    if (!left || !right) return false;
    return left === right || left.includes(right) || right.includes(left);
};

/**
 * Expand studio/network query values for Plex.
 * Prefers display names over TMDB catalog ids (those rarely match Plex tag ids),
 * and merges keys/titles from Plex facet directories when labels match.
 */
export const expandStudioQueryValues = (studioKey, name, facetOptions = []) => {
    const tag = String(name || '').trim();
    const id = String(studioKey || '').trim();
    const out = [];
    const seen = new Set();
    const push = (value) => {
        const next = String(value || '').trim();
        if (!next || seen.has(next)) return;
        seen.add(next);
        out.push(next);
    };

    // Name first — streaming logos often pass TMDB network ids that are not Plex keys.
    if (tag) push(tag);
    if (id && (!tag || id.toLowerCase() !== tag.toLowerCase())) push(id);

    for (const opt of [].concat(facetOptions || [])) {
        const title = String(opt?.title || '').trim();
        const key = String(opt?.key || '').trim();
        if (!title && !key) continue;
        if (
            studioNamesMatch(title, tag)
            || studioNamesMatch(title, id)
            || studioNamesMatch(key, tag)
            || (id && key === id)
        ) {
            push(key);
            push(title);
        }
    }
    return out;
};

const studioKeyFromTag = (row = {}) => {
    const filter = String(row?.filter || '');
    const fromFilter = filter.match(/(?:^|[?&])(?:studio|network)=([^&]+)/i);
    if (fromFilter?.[1]) {
        try {
            return decodeURIComponent(fromFilter[1]);
        } catch {
            return fromFilter[1];
        }
    }
    if (row?.id != null && String(row.id).trim() !== '') return String(row.id);
    return String(row?.tag || row?.title || '').trim();
};

/** Actor ids and names Plex will accept as `?actor=` filters. */
export const actorQueryValues = (actorId, name) => {
    const id = String(actorId || '').trim();
    const tag = String(name || '').trim();
    const values = [];
    if (id) values.push(id);
    if (tag && tag.toLowerCase() !== id.toLowerCase()) values.push(tag);
    return values;
};

/** True when a hubs/search row is a person / actor / director credit. */
export const isPlexPersonSearchHit = (meta = {}) => {
    const type = String(meta?.type || '').trim().toLowerCase();
    if (['movie', 'show', 'episode', 'season', 'artist', 'album', 'track', 'playlist', 'collection'].includes(type)) {
        return false;
    }
    if (type === 'actor' || type === 'person' || type === 'director' || type === 'writer' || type === 'producer') {
        return true;
    }
    const key = String(meta?.key || '').toLowerCase();
    return /\/library\/people\//i.test(key) || /\/library\/metadata\/\d+\/people\//i.test(key);
};

/** True when a search hub itself is a people/credits bucket. */
export const isPlexPeopleSearchHub = (hub = {}) => {
    const identifier = String(hub?.hubIdentifier || hub?.type || '').trim().toLowerCase();
    if (/^(actor|person|people|cast|director|writer)(\.|$)/i.test(identifier)) return true;
    const title = String(hub?.title || '').trim().toLowerCase();
    return /^(actors?|people|persons?|cast|directors?|writers?)$/i.test(title);
};

/** Map a Plex people/actor search hit into a player item that opens the bio page. */
export const mapPlayerPersonSearchHit = (meta = {}, { serverIdentifier = '' } = {}) => {
    const id = String(meta.ratingKey || meta.id || '').trim();
    const name = String(meta.tag || meta.title || meta.name || '').trim();
    if (!id && !name) return null;
    const ratingKey = id || name;
    return {
        ratingKey,
        title: name || ratingKey,
        type: 'person',
        year: null,
        summary: '',
        thumb: pickPersonThumb(meta),
        art: null,
        logo: null,
        canPlay: false,
        watched: false,
        viewOffsetMs: 0,
        serverId: serverIdentifier || null,
        personId: id || name,
        personName: name || id,
    };
};

export const pickPersonFromMetadata = (metas, { actorId, name } = {}) => {
    const wantId = String(actorId || '').trim();
    const wantName = String(name || '').trim().toLowerCase();
    let person = { id: wantId, name: name || wantId, thumb: null };
    for (const meta of Array.isArray(metas) ? metas : []) {
        for (const role of asArray(meta.Role)) {
            const id = role?.id != null ? String(role.id) : '';
            const tag = String(role?.tag || '').trim();
            const idMatch = wantId && (id === wantId || tag === wantId);
            const nameMatch = wantName && tag.toLowerCase() === wantName;
            if (!idMatch && !nameMatch) continue;
            person = {
                id: id || wantId || tag,
                name: tag || person.name,
                thumb: pickPersonThumb(role) || person.thumb,
            };
            if (person.thumb) return person;
        }
    }
    return person;
};

const mapTags = (list) => {
    if (!Array.isArray(list)) return [];
    return list.map((row) => String(row?.tag || '').trim()).filter(Boolean);
};

const collectionRatingKeyFromTag = (row = {}) => {
    const fromRatingKey = String(row?.ratingKey || '').replace(/\D/g, '');
    if (fromRatingKey) return fromRatingKey;
    const filter = String(row?.filter || '');
    const fromFilter = filter.match(/(?:^|[?&])collection=(\d+)/i);
    if (fromFilter?.[1]) return fromFilter[1];
    const fromPath = String(row?.key || '').match(/\/(?:collections|metadata)\/(\d+)/i);
    if (fromPath?.[1]) return fromPath[1];
    return String(row?.id || '').replace(/\D/g, '');
};

export const mapCollectionItems = (list) => {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    return list.map((row) => {
        const title = String(row?.tag || row?.title || '').trim();
        if (!title) return null;
        const ratingKey = collectionRatingKeyFromTag(row);
        const key = ratingKey || title.toLowerCase();
        if (seen.has(key)) return null;
        seen.add(key);
        return { ratingKey, title };
    }).filter(Boolean);
};

const fileNameOnly = (file) => {
    const raw = String(file || '').replace(/\\/g, '/');
    const base = raw.split('/').filter(Boolean).pop() || '';
    if (!base || base === '.' || base === '..') return '';
    return base;
};

const scoreNumber = (value) => {
    const next = Number(value);
    return Number.isFinite(next) ? next : null;
};

const toPercent = (value) => {
    const next = scoreNumber(value);
    if (next == null) return null;
    if (next <= 10) return Math.round(next * 10);
    return Math.round(next);
};

export const pickPlayerExternalIds = (meta = {}) => {
    const ids = { imdb: null, tmdb: pickPlayerTmdbId(meta), tvdb: null };
    const blobs = [meta.guid, ...asArray(meta.Guid).map((row) => row?.id || row)];
    for (const raw of blobs) {
        const id = String(raw || '');
        const imdb = id.match(/imdb:\/\/(tt\d+)/i);
        if (imdb) ids.imdb = imdb[1];
        const tvdb = id.match(/(?:thetvdb|tvdb):\/\/(\d+)/i);
        if (tvdb) ids.tvdb = tvdb[1];
    }
    return ids;
};

export const mapPlayerRatings = (meta = {}) => {
    const ids = pickPlayerExternalIds(meta);
    const out = {
        imdb: null,
        rottenTomatoes: null,
        popcorn: null,
        tmdb: null,
    };
    const take = (key, payload) => {
        if (out[key] || payload?.value == null) return;
        out[key] = payload;
    };
    for (const row of asArray(meta.Rating)) {
        const image = String(row?.image || '').toLowerCase();
        const value = scoreNumber(row?.value);
        if (value == null) continue;
        if (image.includes('imdb')) {
            take('imdb', { value, percent: toPercent(value), url: ids.imdb ? `https://www.imdb.com/title/${ids.imdb}/` : null });
        } else if (image.includes('themoviedb') || image.includes('tmdb')) {
            take('tmdb', {
                value,
                percent: toPercent(value),
                url: ids.tmdb ? `https://www.themoviedb.org/${String(meta.type || '') === 'show' ? 'tv' : 'movie'}/${ids.tmdb}` : null,
            });
        } else if (image.includes('rottentomatoes')) {
            if (image.includes('upright') || image.includes('spilled') || image.includes('popcorn') || row.type === 'audience') {
                take('popcorn', { value, percent: toPercent(value), fresh: image.includes('upright') || (!image.includes('spilled') && value >= 6) });
            } else {
                take('rottenTomatoes', { value, percent: toPercent(value), fresh: image.includes('ripe') || (!image.includes('rotten') && value >= 6) });
            }
        }
    }
    const ratingImage = String(meta.ratingImage || '').toLowerCase();
    const audienceImage = String(meta.audienceRatingImage || '').toLowerCase();
    if (ratingImage.includes('imdb')) {
        take('imdb', { value: scoreNumber(meta.rating), percent: toPercent(meta.rating), url: ids.imdb ? `https://www.imdb.com/title/${ids.imdb}/` : null });
    }
    if (audienceImage.includes('rottentomatoes') || audienceImage.includes('upright') || audienceImage.includes('popcorn')) {
        take('popcorn', { value: scoreNumber(meta.audienceRating), percent: toPercent(meta.audienceRating), fresh: !audienceImage.includes('spilled') });
    }
    if (ratingImage.includes('rottentomatoes')) {
        take('rottenTomatoes', { value: scoreNumber(meta.rating), percent: toPercent(meta.rating), fresh: ratingImage.includes('ripe') });
    }
    return out;
};

export const mapPlayerMediaInfo = (meta = {}) => asArray(meta.Media).map((media, mediaIndex) => {
    const parts = asArray(media.Part).map((part, partIndex) => {
        const streams = asArray(part.Stream);
        const video = streams.find((row) => Number(row?.streamType) === STREAM_VIDEO) || {};
        const audios = streams.filter((row) => Number(row?.streamType) === STREAM_AUDIO);
        const subs = streams.filter((row) => Number(row?.streamType) === STREAM_SUBTITLE);
        return {
            id: String(part.id || `${mediaIndex}-${partIndex}`),
            fileName: fileNameOnly(part.file),
            size: asInt(part.size),
            container: part.container || media.container || null,
            durationMs: asInt(part.duration) || asInt(media.duration),
            video: {
                codec: video.codec || media.videoCodec || null,
                bitrate: asInt(video.bitrate) || asInt(media.bitrate),
                width: asInt(video.width) || asInt(media.width),
                height: asInt(video.height) || asInt(media.height),
                resolution: media.videoResolution || null,
                scanType: video.scanType || null,
                frameRate: String(video.frameRate || media.videoFrameRate || '') || null,
                profile: video.profile || media.videoProfile || null,
                level: video.level != null && video.level !== '' ? String(video.level) : null,
                bitDepth: asInt(video.bitDepth),
                chromaLocation: video.chromaLocation || null,
                codedHeight: asInt(video.codedHeight),
                displayTitle: video.displayTitle || null,
                aspectRatio: media.aspectRatio != null ? String(media.aspectRatio) : null,
            },
            audio: audios.map((row) => ({
                id: row.id != null ? String(row.id) : null,
                codec: row.codec || null,
                channels: asInt(row.channels),
                language: row.language || row.languageTag || null,
                languageTag: String(row?.languageTag || row?.languageCode || '').trim() || null,
                displayTitle: row.displayTitle || streamLabel(row, 'Audio'),
                bitrate: asInt(row.bitrate),
                samplingRate: asInt(row.samplingRate),
                channelLayout: row.audioChannelLayout || row.channelLayout || null,
                selected: row.selected === true || row.selected === 1,
            })),
            subtitles: subs.map((row) => ({
                id: row.id != null ? String(row.id) : null,
                language: row.language || row.languageTag || null,
                languageTag: String(row?.languageTag || row?.languageCode || '').trim() || null,
                codec: row.codec || null,
                displayTitle: row.displayTitle || streamLabel(row, 'Subtitles'),
                selected: row.selected === true || row.selected === 1,
                forced: row.forced === true || row.forced === 1,
            })),
        };
    });
    return {
        id: String(media.id || mediaIndex),
        container: media.container || null,
        bitrate: asInt(media.bitrate),
        width: asInt(media.width),
        height: asInt(media.height),
        videoResolution: media.videoResolution || null,
        scanType: parts[0]?.video?.scanType || null,
        videoCodec: media.videoCodec || null,
        audioCodec: media.audioCodec || null,
        audioChannels: asInt(media.audioChannels),
        durationMs: asInt(media.duration),
        parts,
    };
}).filter((row) => row.parts.length || row.videoCodec);

const markerType = (row = {}) => String(row?.type || row?.markerType || '').toLowerCase();

export const mapPlayerMarkers = (meta = {}) => {
    const out = { intro: null, credits: null };
    for (const row of asArray(meta.Marker)) {
        const startMs = asInt(row?.startTimeOffset);
        const endMs = asInt(row?.endTimeOffset);
        if (startMs == null || endMs == null || endMs <= startMs) continue;
        const type = markerType(row);
        const marker = { startMs, endMs };
        if ((type === 'intro' || type === 'introend') && !out.intro) out.intro = marker;
        if ((type === 'credits' || type === 'credit' || type === 'creditsend') && !out.credits) out.credits = marker;
    }
    return out;
};

const resolutionScanLetter = (scanType, existing) => {
    const tagged = String(existing || '').toLowerCase().match(/^(\d+)\s*([pi])$/);
    if (tagged) return tagged[2];
    const scan = String(scanType || '').toLowerCase();
    if (scan.startsWith('i') || scan.includes('interlace')) return 'i';
    return 'p';
};

export const mapPlayerVersions = (meta = {}) => asArray(meta.Media).map((media, mediaIndex) => {
    const part = asArray(media.Part)[0] || {};
    const video = asArray(part.Stream).find((row) => Number(row?.streamType) === STREAM_VIDEO) || {};
    const height = asInt(media.height);
    const res = String(media.videoResolution || '').toLowerCase();
    const scanType = String(video.scanType || '');
    const letter = resolutionScanLetter(scanType, res);
    let resolution = '';
    if (res.includes('4k') || res.includes('2160') || (height && height >= 2160)) resolution = '4K';
    else if (res.includes('1080') || (height && height >= 1080)) resolution = `1080${letter}`;
    else if (res.includes('720') || (height && height >= 720)) resolution = `720${letter}`;
    else if (res.includes('576') || (height && height >= 576)) resolution = `576${letter}`;
    else if (res.includes('480') || (height && height >= 480)) resolution = `480${letter}`;
    else if (/^\d+$/.test(res)) resolution = `${res}${letter}`;
    else if (res || height) resolution = res || `${height}${letter}`;
    const codec = String(media.videoCodec || '').toUpperCase();
    const container = String(media.container || part.container || '').toUpperCase();
    const title = String(media.title || media.displayTitle || '').trim();
    const label = title || [resolution, codec, container].filter(Boolean).join(' · ') || `Version ${mediaIndex + 1}`;
    return {
        id: String(mediaIndex),
        mediaIndex,
        label,
        resolution: resolution || null,
        scanType: scanType || null,
        videoCodec: media.videoCodec || null,
        audioCodec: media.audioCodec || null,
        container: media.container || part.container || null,
        bitrate: asInt(media.bitrate),
        width: asInt(media.width),
        height,
    };
}).filter((row) => row.label);

export const pickMediaIndex = (value, meta = {}) => {
    const list = asArray(meta?.Media);
    if (!list.length) return 0;
    const next = Math.floor(Number(value));
    if (!Number.isFinite(next)) return 0;
    return Math.min(list.length - 1, Math.max(0, next));
};

export const withSelectedMedia = (meta = {}, mediaIndex = 0) => {
    const list = asArray(meta?.Media);
    if (!list.length) return meta;
    const idx = pickMediaIndex(mediaIndex, meta);
    return { ...meta, Media: [list[idx] || list[0]] };
};

export const itemIsWatched = (meta = {}) => {
    const type = String(meta.type || '');
    if (type === 'show' || type === 'season') {
        const leaf = asInt(meta.leafCount) || 0;
        const viewed = uniqueViewedLeafCount(meta);
        return leaf > 0 && viewed >= leaf;
    }
    return (asInt(meta.viewCount) || 0) > 0;
};

/** Unique watched episodes — never counts a rewatch, never exceeds the episode total. */
export const uniqueViewedLeafCount = (meta = {}) => {
    const leaf = Math.max(0, asInt(meta.leafCount) || 0);
    const unviewed = asInt(meta.unviewedLeafCount);
    if (unviewed != null) return Math.max(0, Math.min(leaf, leaf - Math.max(0, unviewed)));
    const viewed = asInt(meta.viewedLeafCount) || 0;
    return leaf > 0 ? Math.max(0, Math.min(leaf, viewed)) : Math.max(0, viewed);
};

export const mapPlayerFilterOptions = (payload) => asArray(payload?.MediaContainer?.Directory).map((dir) => ({
    key: String(dir?.key || dir?.id || dir?.tag || dir?.title || ''),
    title: String(dir?.title || dir?.tag || dir?.key || ''),
})).filter((row) => row.key);

export const mapPlayerPlaylist = (meta = {}, config = {}) => {
    const item = mapPlayerItem({ ...meta, type: 'playlist' }, config);
    return {
        ...item,
        playlistType: String(meta.playlistType || meta.type || 'video'),
        smart: meta.smart === true || Number(meta.smart) === 1,
        leafCount: asInt(meta.leafCount) || asInt(meta.size) || item.leafCount,
        canPlay: false,
    };
};

export const plexPlaylistUri = (serverIdentifier, ratingKey) => (
    `server://${serverIdentifier}/com.plexapp.plugins.library/library/metadata/${ratingKey}`
);

export const resolvePlayOffsetMs = (requested, fallback, durationMs) => {
    if (requested == null || requested === '') {
        return clampPlayOffsetMs(fallback, durationMs);
    }
    const n = Number(requested);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return clampPlayOffsetMs(n, durationMs);
};

export const mapPlayerItemDetails = (meta = {}, config = {}) => {
    const item = mapPlayerItem(meta, config);
    return {
        ...item,
        ratings: mapPlayerRatings(meta),
        mediaInfo: mapPlayerMediaInfo(meta),
        versions: mapPlayerVersions(meta),
        markers: mapPlayerMarkers(meta),
        externalIds: pickPlayerExternalIds(meta),
    };
};

/**
 * Episodes/seasons often carry episode-level TMDB ids and empty studio tags.
 * Prefer the parent show for network/streaming lookups and overview logos.
 */
export const applyShowMetaToPlayerChild = (item = {}, mappedShow = {}) => {
    if (!item || !mappedShow) return item;
    if (!item.showTitle) item.showTitle = mappedShow.title;
    // Always prefer the show studio/network label for TV children.
    if (mappedShow.studio) item.studio = mappedShow.studio;
    if (mappedShow.studioKey) item.studioKey = mappedShow.studioKey;
    if (!item.librarySectionID) item.librarySectionID = mappedShow.librarySectionID;
    if (!item.countries?.length) item.countries = mappedShow.countries;
    if (!item.collections?.length) item.collections = mappedShow.collections;
    if (!item.collectionItems?.length) item.collectionItems = mappedShow.collectionItems;
    const episodeCast = Array.isArray(item.cast) ? item.cast : [];
    const showCast = Array.isArray(mappedShow.cast) ? mappedShow.cast : [];
    const showNames = new Set(showCast.map((row) => String(row.name || '').toLowerCase()));
    item.guestStars = episodeCast.filter((row) => !showNames.has(String(row.name || '').toLowerCase()));
    if (item.type === 'episode' && showCast.length) {
        const seen = new Set(episodeCast.map((row) => String(row.name || '').toLowerCase()));
        item.cast = [
            ...episodeCast,
            ...showCast.filter((row) => !seen.has(String(row.name || '').toLowerCase())),
        ];
    } else if (!item.cast?.length) {
        item.cast = showCast;
    }
    // Always prefer the series TMDB id — episode Guid ids break /tv/{id} lookups.
    if (mappedShow.tmdbId) {
        item.tmdbId = mappedShow.tmdbId;
        item.showTmdbId = mappedShow.tmdbId;
    } else if (mappedShow.showTmdbId) {
        item.showTmdbId = mappedShow.showTmdbId;
    }
    item.externalIds = {
        imdb: item.externalIds?.imdb || mappedShow.externalIds?.imdb || null,
        tmdb: mappedShow.externalIds?.tmdb || mappedShow.tmdbId || item.showTmdbId || item.externalIds?.tmdb || item.tmdbId || null,
        tvdb: item.externalIds?.tvdb || mappedShow.externalIds?.tvdb || null,
    };
    if (!item.thumb && mappedShow.thumb) item.thumb = mappedShow.thumb;
    if (!item.art && (mappedShow.art || mappedShow.thumb)) item.art = mappedShow.art || mappedShow.thumb;
    if (!item.logo && mappedShow.logo) item.logo = mappedShow.logo;
    if (!item.themeKey && mappedShow.themeKey) item.themeKey = mappedShow.themeKey;
    if (!item.genres?.length) item.genres = mappedShow.genres;
    if (!item.contentRating) item.contentRating = mappedShow.contentRating;
    const ratingsEmpty = !item.ratings || Object.values(item.ratings).every((row) => !row);
    if (ratingsEmpty && mappedShow.ratings) item.ratings = mappedShow.ratings;
    if (item.type === 'season') {
        if (!item.summary) item.summary = mappedShow.summary;
        if (!item.tagline) item.tagline = mappedShow.tagline;
        if (!item.directorPeople?.length) item.directorPeople = mappedShow.directorPeople;
        if (!item.writerPeople?.length) item.writerPeople = mappedShow.writerPeople;
        if (!item.producers?.length) item.producers = mappedShow.producers;
    }
    return item;
};

const STREAM_VIDEO = 1;
const STREAM_AUDIO = 2;
const STREAM_SUBTITLE = 3;

export const DEFAULT_PLAYER_QUALITY_ID = '1080-12';
export const ORIGINAL_PLAYER_QUALITY_ID = 'original';

export const PLAYER_QUALITY_PRESETS = [
    { id: '1080-20', label: '1080p · 20 Mbps', height: 1080, videoResolution: '1920x1080', maxVideoBitrate: 20000, videoQuality: 100 },
    { id: '1080-12', label: '1080p · 12 Mbps', height: 1080, videoResolution: '1920x1080', maxVideoBitrate: 12000, videoQuality: 90 },
    { id: '1080-8', label: '1080p · 8 Mbps', height: 1080, videoResolution: '1920x1080', maxVideoBitrate: 8000, videoQuality: 80 },
    { id: '720-4', label: '720p · 4 Mbps', height: 720, videoResolution: '1280x720', maxVideoBitrate: 4000, videoQuality: 70 },
    { id: '720-2', label: '720p · 2 Mbps', height: 720, videoResolution: '1280x720', maxVideoBitrate: 2000, videoQuality: 60 },
    { id: '480-1.5', label: '480p · 1.5 Mbps', height: 480, videoResolution: '854x480', maxVideoBitrate: 1500, videoQuality: 50 },
    { id: '360-0.7', label: '360p · 0.7 Mbps', height: 360, videoResolution: '640x360', maxVideoBitrate: 720, videoQuality: 40 },
];

const firstMedia = (meta) => asArray(meta?.Media)[0] || {};
const firstPart = (media) => asArray(media?.Part)[0] || {};
const mediaStreams = (meta) => asArray(firstPart(firstMedia(meta)).Stream);

const BROWSER_DIRECT_CONTAINERS = new Set(['mp4', 'mov', 'm4v', 'mp3', 'm4a', 'aac', 'flac']);
const BROWSER_DIRECT_VIDEO = new Set(['h264', 'avc', 'avc1']);
const BROWSER_HEVC_VIDEO = new Set(['hevc', 'h265', 'hev1', 'hvc1']);
const BROWSER_DIRECT_AUDIO = new Set(['aac', 'mp3', 'mp4a', 'flac']);
const BROWSER_AC3_AUDIO = new Set(['ac3', 'eac3', 'ac-3', 'ec-3']);
const NATIVE_DIRECT_CONTAINERS = new Set([
    'mp4', 'mov', 'm4v', 'mkv', 'webm',
    'mp3', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'aiff', 'wma', 'mp2',
]);
const NATIVE_DIRECT_VIDEO = new Set(['h264', 'avc', 'avc1', 'hevc', 'h265', 'hev1', 'hvc1', 'av1', 'vp9']);
const NATIVE_DIRECT_AUDIO = new Set([
    'aac', 'mp3', 'mp4a', 'ac3', 'eac3', 'ac-3', 'ec-3', 'eac3_joc', 'ec+3',
    'flac', 'alac', 'opus',
    'truehd', 'mlp', 'dca', 'dts', 'dtsc', 'dtsh', 'dtshd', 'dtsma', 'dtsl',
]);

export const sourceVideoCodec = (meta = {}) => {
    const media = firstMedia(meta);
    const video = mediaStreams(meta).find((row) => Number(row?.streamType) === STREAM_VIDEO) || {};
    return String(video.codec || media.videoCodec || '').toLowerCase();
};

export const isHevcVideo = (meta = {}) => BROWSER_HEVC_VIDEO.has(sourceVideoCodec(meta));

const codecSet = (raw, fallback) => {
    if (!Array.isArray(raw) || !raw.length) return new Set(fallback);
    const next = new Set();
    for (const value of raw.slice(0, 40)) {
        const id = String(value || '').trim().toLowerCase();
        if (id) next.add(id);
    }
    return next.size ? next : new Set(fallback);
};

const flagEnabled = (raw, keys, fallback) => {
    for (const key of keys) {
        const value = raw?.[key];
        if (value === true || value === 1 || value === '1' || value === 'true') return true;
        if (value === false || value === 0 || value === '0' || value === 'false') return false;
    }
    return fallback;
};

export const normalizePlaybackClient = (value) => {
    const raw = String(value || 'web').trim().toLowerCase();
    if (raw === 'android' || raw === 'ios') return raw;
    if (raw === 'native') return 'android';
    return 'web';
};

export const normalizePlaybackCaps = (raw = {}) => {
    const client = normalizePlaybackClient(raw.client || raw.platform);
    const native = client !== 'web';
    const allowHevc = flagEnabled(raw, ['canPlayHevc', 'allowHevc', 'hevc'], native);
    const allowAc3 = flagEnabled(raw, ['canPlayAc3', 'allowAc3', 'ac3'], native);
    const textSubtitles = flagEnabled(raw, ['textSubtitles', 'canPlayTextSubtitles', 'textSubs'], native);
    const containers = codecSet(raw.containers, native ? NATIVE_DIRECT_CONTAINERS : BROWSER_DIRECT_CONTAINERS);
    const videoCodecs = codecSet(raw.videoCodecs, native ? NATIVE_DIRECT_VIDEO : [
        ...BROWSER_DIRECT_VIDEO,
        ...(allowHevc ? BROWSER_HEVC_VIDEO : []),
    ]);
    const audioCodecs = codecSet(raw.audioCodecs, native ? NATIVE_DIRECT_AUDIO : [
        ...BROWSER_DIRECT_AUDIO,
        ...(allowAc3 ? BROWSER_AC3_AUDIO : []),
    ]);
    if (allowHevc) for (const id of BROWSER_HEVC_VIDEO) videoCodecs.add(id);
    else for (const id of BROWSER_HEVC_VIDEO) videoCodecs.delete(id);
    if (allowAc3) for (const id of BROWSER_AC3_AUDIO) audioCodecs.add(id);
    else for (const id of BROWSER_AC3_AUDIO) audioCodecs.delete(id);
    return {
        client,
        allowHevc,
        allowAc3,
        textSubtitles,
        containers,
        videoCodecs,
        audioCodecs,
        audioStreamId: String(raw.audioStreamId || raw.audioStreamID || ''),
        subtitleStreamId: String(raw.subtitleStreamId || raw.subtitleStreamID || ''),
    };
};

/** Merge query caps with ExoPlayer User-Agent so /file/ is not treated as a browser. */
export const playbackCapsFromRequest = (req = {}) => {
    const query = req.query || {};
    const ua = String(req.get?.('user-agent') || req.headers?.['user-agent'] || '').toLowerCase();
    const nativeUa = /smp-mediaplayer|streampilot-mediaplayer|exoplayer|android tv/.test(ua);
    const client = query.client || query.platform || (nativeUa ? 'android' : undefined);
    return normalizePlaybackCaps({
        ...query,
        client,
        audioStreamId: query.audioStreamId || query.audioStreamID || '',
        subtitleStreamId: query.subtitleStreamId || query.subtitleStreamID || '',
    });
};

const IMAGE_SUBTITLE_CODECS = new Set(['pgs', 'vobsub', 'dvd', 'dvdsub', 'image', 'bluray', 'dvbsub', 'xsub']);

export const subtitleCodecNeedsBurn = (codec) => IMAGE_SUBTITLE_CODECS.has(String(codec || '').toLowerCase());

export const canHttpDirectPlay = (meta = {}, caps = {}) => {
    const profile = normalizePlaybackCaps(caps);
    const subId = String(profile.subtitleStreamId || caps.subtitleStreamId || '').replace(/\D/g, '');
    if (subId) {
        const sub = mediaStreams(meta).find((row) => String(row?.id || '') === subId);
        if (!profile.textSubtitles || subtitleCodecNeedsBurn(sub?.codec)) return false;
    }
    const media = firstMedia(meta);
    const part = firstPart(media);
    if (!String(part.id || '').replace(/\D/g, '')) return false;
    const container = String(part.container || media.container || '').toLowerCase();
    if (!profile.containers.has(container)) return false;
    const streams = mediaStreams(meta);
    const video = streams.find((row) => Number(row?.streamType) === STREAM_VIDEO) || {};
    const requestedAudio = String(profile.audioStreamId || caps.audioStreamId || caps.audioStreamID || '').replace(/\D/g, '');
    const audioStreams = streams.filter((row) => Number(row?.streamType) === STREAM_AUDIO);
    const audio = (requestedAudio
        ? audioStreams.find((row) => String(row?.id || '').replace(/\D/g, '') === requestedAudio)
        : null)
        || audioStreams.find((row) => row.selected === true || row.selected === 1)
        || audioStreams[0]
        || {};
    const vcodec = String(video.codec || media.videoCodec || '').toLowerCase();
    const acodec = String(audio.codec || media.audioCodec || '').toLowerCase();
    if (vcodec && !profile.videoCodecs.has(vcodec)) return false;
    if (acodec && !profile.audioCodecs.has(acodec)) return false;
    return true;
};

export const isAudioOnlyPlexMeta = (meta = {}) => {
    const streams = mediaStreams(meta);
    const video = streams.find((row) => Number(row?.streamType) === STREAM_VIDEO);
    const media = firstMedia(meta);
    return !String(video?.codec || media.videoCodec || '').trim();
};

export const pickPlayerPartId = (meta = {}) => String(firstPart(firstMedia(meta)).id || '').replace(/\D/g, '');

export const mapPlayerPlaybackSource = (meta = {}) => {
    const media = firstMedia(meta);
    const video = mediaStreams(meta).find((row) => Number(row?.streamType) === STREAM_VIDEO) || {};
    return {
        videoCodec: String(video.codec || media.videoCodec || '') || null,
        audioCodec: String(media.audioCodec || '') || null,
        container: String(media.container || firstPart(media).container || '') || null,
        height: asInt(video.height) || asInt(media.height),
        width: asInt(video.width) || asInt(media.width),
        videoResolution: media.videoResolution || null,
        bitrate: asInt(video.bitrate) || asInt(media.bitrate),
    };
};

export const mapPlayerPlaybackMode = ({ useDirectFile = false, copyOriginal = true, qualityId = '' } = {}) => {
    if (useDirectFile) return 'directPlay';
    if (String(qualityId) === ORIGINAL_PLAYER_QUALITY_ID && copyOriginal) return 'directStream';
    return 'transcode';
};

export const buildPlayerFileSrc = (ratingKey, opts = {}) => {
    const profile = normalizePlaybackCaps(opts);
    const qs = new URLSearchParams();
    if (isPlaySessionId(opts.sessionId)) qs.set('session', String(opts.sessionId));
    if (Number(opts.offsetMs) > 0) qs.set('offset', String(Math.floor(Number(opts.offsetMs))));
    if (profile.client !== 'web') qs.set('client', profile.client);
    if (profile.allowHevc) qs.set('hevc', '1');
    if (profile.allowAc3) qs.set('ac3', '1');
    if (profile.textSubtitles && profile.client !== 'web') qs.set('textSubs', '1');
    if (Number(opts.mediaIndex) > 0) qs.set('mediaIndex', String(Math.floor(Number(opts.mediaIndex))));
    if (String(opts.audioStreamId || '').replace(/\D/g, '')) {
        qs.set('audioStreamID', String(opts.audioStreamId).replace(/\D/g, ''));
    }
    return `/api/media-player/file/${encodeURIComponent(ratingKey)}?${qs}`;
};

export const withPlaybackAccessToken = (src, token) => {
    const t = String(token || '').trim();
    if (!t || !src) return src;
    if (/[?&]access_token=/.test(src)) return src;
    return `${src}${src.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(t)}`;
};

/** HLS URL ExoPlayer can follow when Direct Play is not possible (never JSON 409). */
export const buildPlayerHlsFallbackSrc = (ratingKey, query = {}) => (
    buildPlayerHlsSrc(ratingKey, {
        sessionId: query.session,
        offsetMs: Number(query.offset) || 0,
        qualityId: isPlayerQualityId(query.quality) ? query.quality : ORIGINAL_PLAYER_QUALITY_ID,
        audioStreamId: query.audioStreamID || query.audioStreamId,
        subtitleStreamId: query.subtitleStreamID || query.subtitleStreamId,
        resume: true,
        copy: query.copy !== '0',
        mediaIndex: query.mediaIndex,
    })
);

const streamLabel = (stream, fallback) => {
    const display = String(stream?.displayTitle || stream?.extendedDisplayTitle || stream?.title || '').trim();
    if (display) return display;
    const language = String(stream?.language || stream?.languageTag || stream?.languageCode || '').trim();
    const codec = String(stream?.codec || '').trim().toUpperCase();
    return [language || fallback, codec].filter(Boolean).join(' · ') || fallback;
};

export const sourceVideoHeight = (meta = {}) => {
    const media = firstMedia(meta);
    const video = mediaStreams(meta).find((row) => Number(row?.streamType) === STREAM_VIDEO) || {};
    const height = asInt(video.height) || asInt(media.height);
    if (height) return height;
    const res = String(media.videoResolution || '').toLowerCase();
    if (res.includes('4k') || res.includes('2160')) return 2160;
    if (res.includes('1080')) return 1080;
    if (res.includes('720')) return 720;
    if (res.includes('480')) return 480;
    if (res.includes('576')) return 576;
    return 0;
};

const streamLanguageTag = (row) => (
    String(row?.languageTag || row?.languageCode || '').trim() || null
);

export const mapPlayerAudioTracks = (meta = {}) => mediaStreams(meta)
    .filter((row) => Number(row?.streamType) === STREAM_AUDIO && row?.id != null)
    .map((row) => ({
        id: String(row.id),
        label: streamLabel(row, 'Audio'),
        language: String(row.language || row.languageTag || row.languageCode || '').trim() || null,
        languageTag: streamLanguageTag(row),
        codec: String(row.codec || '').trim() || null,
        channels: asInt(row.channels),
        selected: row.selected === true || row.selected === 1,
    }));

export const mapPlayerSubtitles = (meta = {}) => mediaStreams(meta)
    .filter((row) => Number(row?.streamType) === STREAM_SUBTITLE && row?.id != null)
    .map((row) => ({
        id: String(row.id),
        label: streamLabel(row, 'Subtitles'),
        language: String(row.language || row.languageTag || row.languageCode || '').trim() || null,
        languageTag: streamLanguageTag(row),
        codec: String(row.codec || '').trim() || null,
        forced: row.forced === true || row.forced === 1,
        selected: row.selected === true || row.selected === 1,
    }));

export const mapPlayerQualities = (meta = {}) => {
    const height = Math.min(sourceVideoHeight(meta) || 1080, 1080);
    const list = PLAYER_QUALITY_PRESETS.filter((row) => row.height <= height);
    const transcode = (list.length ? list : PLAYER_QUALITY_PRESETS.slice(-1)).map((row) => ({
        id: row.id,
        label: row.label,
        videoResolution: row.videoResolution,
        maxVideoBitrate: row.maxVideoBitrate,
        videoQuality: row.videoQuality,
    }));
    return [
        { id: ORIGINAL_PLAYER_QUALITY_ID, label: 'Original', videoResolution: '', maxVideoBitrate: 0, videoQuality: 100 },
        ...transcode,
    ];
};

export const isPlayerQualityId = (value) => (
    String(value || '') === ORIGINAL_PLAYER_QUALITY_ID
    || PLAYER_QUALITY_PRESETS.some((row) => row.id === String(value || ''))
);

const toTranscodeAttempt = (row) => ({
    directPlay: '0',
    directStream: '0',
    directStreamAudio: '0',
    videoCodec: 'h264',
    audioCodec: 'aac',
    videoResolution: row.videoResolution,
    maxVideoBitrate: String(row.maxVideoBitrate),
    videoQuality: String(row.videoQuality),
});

export const transcodeSettingsForQuality = (qualityId) => {
    if (String(qualityId || '') === ORIGINAL_PLAYER_QUALITY_ID) {
        const fallback = PLAYER_QUALITY_PRESETS.find((row) => row.id === DEFAULT_PLAYER_QUALITY_ID);
        // Copy video+audio first (seconds). AAC remux is only for TrueHD/DTS —
        // putting it first made Plex wait on the first transcoded HLS segment.
        return [
            { copy: true, directPlay: '0', directStream: '1', directStreamAudio: '1' },
            { copy: true, directPlay: '0', directStream: '1', directStreamAudio: '0', audioCodec: 'aac', maxAudioChannels: '2' },
            fallback ? toTranscodeAttempt(fallback) : null,
        ].filter(Boolean);
    }
    const selected = PLAYER_QUALITY_PRESETS.find((row) => row.id === String(qualityId || ''))
        || PLAYER_QUALITY_PRESETS.find((row) => row.id === DEFAULT_PLAYER_QUALITY_ID);
    const fallback = PLAYER_QUALITY_PRESETS.find((row) => row.height < selected.height);
    return [selected, fallback].filter(Boolean).map(toTranscodeAttempt);
};

export const PLAYER_SUBTITLE_MODES = ['off', 'forced', 'always'];

export const PLAYER_WATCHED_TICK_POSITIONS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];

export const isPlayerWatchedTickPosition = (value) => PLAYER_WATCHED_TICK_POSITIONS.includes(String(value || ''));

export const PLAYER_CONTINUE_WATCHING_LAYOUTS = ['poster', 'title'];

export const isPlayerContinueWatchingLayout = (value) => (
    PLAYER_CONTINUE_WATCHING_LAYOUTS.includes(String(value || ''))
);

export const PLAYER_CONTINUE_WATCHING_SORTS = ['releaseDate', 'plex', 'recentlyWatched', 'title'];

export const isPlayerContinueWatchingSort = (value) => (
    PLAYER_CONTINUE_WATCHING_SORTS.includes(String(value || ''))
);

const continueWatchingUnixMs = (value) => {
    const n = Number(value) || 0;
    if (n <= 0) return 0;
    return n > 1e12 ? n : n * 1000;
};

const continueWatchingReleaseMs = (item) => {
    const raw = item?.originallyAvailableAt;
    if (raw != null && raw !== '') {
        if (typeof raw === 'number' && Number.isFinite(raw)) return continueWatchingUnixMs(raw);
        const parsed = Date.parse(String(raw));
        if (Number.isFinite(parsed)) return parsed;
    }
    // Episode `year` is the show premiere year, so it would clump a whole series together.
    if (String(item?.type || '') !== 'episode') {
        const year = Number(item?.year);
        if (year >= 1900 && year <= 2100) return Date.UTC(year, 0, 1);
    }
    return continueWatchingUnixMs(item?.addedAt);
};

const continueWatchingViewedMs = (item) => continueWatchingUnixMs(item?.lastViewedAt);

const continueWatchingTitleKey = (item) => String(item?.showTitle || item?.title || '').trim();

export const sortContinueWatchingItems = (items, sort) => {
    const list = Array.isArray(items) ? items : [];
    const mode = isPlayerContinueWatchingSort(sort) ? sort : 'releaseDate';
    if (mode === 'plex' || list.length < 2) return list.slice();
    const ranked = list.map((item, index) => ({ item, index }));
    ranked.sort((a, b) => {
        if (mode === 'title') {
            const cmp = continueWatchingTitleKey(a.item).localeCompare(
                continueWatchingTitleKey(b.item),
                undefined,
                { sensitivity: 'base' },
            );
            return cmp || a.index - b.index;
        }
        const av = mode === 'recentlyWatched'
            ? continueWatchingViewedMs(a.item)
            : continueWatchingReleaseMs(a.item);
        const bv = mode === 'recentlyWatched'
            ? continueWatchingViewedMs(b.item)
            : continueWatchingReleaseMs(b.item);
        return (bv - av) || a.index - b.index;
    });
    return ranked.map((row) => row.item);
};

const continueWatchingItemKey = (item) => String(item?.ratingKey || '').trim();

/** Keep the first Continue Watching order; only append titles that were not on screen yet. */
export const stabilizeContinueWatchingOrder = (items, sort, previousKeys) => {
    const sorted = sortContinueWatchingItems(items, sort);
    const prior = Array.isArray(previousKeys)
        ? previousKeys.map((key) => String(key || '').trim()).filter(Boolean)
        : [];
    if (!prior.length) {
        return { items: sorted, keys: sorted.map(continueWatchingItemKey).filter(Boolean) };
    }
    const byKey = new Map();
    for (const item of sorted) {
        const key = continueWatchingItemKey(item);
        if (key && !byKey.has(key)) byKey.set(key, item);
    }
    const seen = new Set();
    const kept = [];
    for (const key of prior) {
        const item = byKey.get(key);
        if (!item || seen.has(key)) continue;
        seen.add(key);
        kept.push(item);
    }
    const extras = sorted.filter((item) => {
        const key = continueWatchingItemKey(item);
        return !!key && !seen.has(key);
    });
    const next = kept.concat(extras);
    return { items: next, keys: next.map(continueWatchingItemKey).filter(Boolean) };
};

export const DEFAULT_PLAYER_SETTINGS = {
    mixLibraries: false,
    autoplayNext: true,
    stillWatchingAfter: 3,
    showContinueWatching: true,
    continueWatchingLayout: 'poster',
    showPlaylists: true,
    showWatchlist: true,
    defaultQualityId: 'auto',
    audioLanguage: '',
    subtitleMode: 'forced',
    autoSkipIntro: false,
    autoSkipCredits: false,
    playThemeTunes: true,
    serviceLogoPlates: true,
    showEpisodeFilePills: true,
    watchedTickPosition: 'top-right',
    phoneOverviewPoster: false,
    homeRowOrder: [],
    libraryNavOrder: [],
    hideWatchedFromRecents: false,
    reduceMotion: false,
};

export const PLAYER_HOME_ROW_IDS = ['continueWatching', 'recents'];
export const MIXED_RECENT_HOME_ROW_IDS = ['recent:movie', 'recent:show', 'recent:artist'];

export const isPlayerHomeRowId = (value) => {
    const id = String(value || '').trim();
    if (id === 'continueWatching' || id === 'recents' || id === 'playlists' || id === 'libraries') return true;
    return /^recent:[A-Za-z0-9._-]{1,64}$/.test(id);
};

export const isPlayerLibraryKey = (value) => /^[A-Za-z0-9._-]{1,64}$/.test(String(value || '').trim());

export const normalizeLibraryNavOrder = (raw) => {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const out = [];
    for (const value of raw) {
        const id = String(value || '').trim();
        if (!isPlayerLibraryKey(id) || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out.slice(0, 40);
};

export const normalizeHomeRowOrder = (raw) => {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const out = [];
    for (const value of raw) {
        const id = String(value || '').trim();
        if (!isPlayerHomeRowId(id) || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out.slice(0, 40);
};

export const libraryNavOrderFromHomeRows = (homeRowOrder) => {
    const mixed = new Set(MIXED_RECENT_HOME_ROW_IDS);
    const keys = [];
    for (const id of normalizeHomeRowOrder(homeRowOrder)) {
        if (!id.startsWith('recent:') || mixed.has(id)) continue;
        keys.push(id.slice('recent:'.length));
    }
    return normalizeLibraryNavOrder(keys);
};

export const collapseHomeRowOrder = (order) => {
    const seen = new Set();
    const out = [];
    for (const raw of normalizeHomeRowOrder(order)) {
        const id = raw.startsWith('recent:') ? 'recents' : raw === 'libraries' ? '' : raw;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
};

export const applyLibraryNavOrder = (libraries = [], order = []) => {
    const list = Array.isArray(libraries) ? libraries.filter((row) => row && String(row.key || '').trim()) : [];
    const byKey = new Map(list.map((row) => [String(row.key), row]));
    const seen = new Set();
    const out = [];
    for (const key of normalizeLibraryNavOrder(order)) {
        const row = byKey.get(key);
        if (!row || seen.has(key)) continue;
        seen.add(key);
        out.push(row);
    }
    for (const row of list) {
        const key = String(row.key);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(row);
    }
    return out;
};

const normalizeLibraryMediaType = (value) => {
    const type = String(value || '').trim().toLowerCase();
    if (type === 'show' || type === 'tv' || type === 'episode' || type === 'season') return 'show';
    if (type === 'artist' || type === 'album' || type === 'track' || type === 'music' || type === 'audio') return 'artist';
    if (type === 'movie' || type === 'film') return 'movie';
    return null;
};

/** Classify a home hub so library nav order can regroup movie / TV / music rows. */
export const classifyPlayerHomeHub = (hub = {}) => {
    const blob = `${hub.identifier || ''} ${hub.title || ''}`.toLowerCase();
    if (/continue\s*watch|ondeck|on[.\s_-]?deck|in[.\s_-]?progress/.test(blob)) return 'continueWatching';
    if (hub.playlistRatingKey || /playlist/.test(blob)) return 'playlist';
    if (/(^|[.\s_-])(tv|show)([.\s_-]|$)/.test(blob) || /\b(series|episode)\b/.test(blob)) return 'show';
    if (/(^|[.\s_-])(music|artist|album|track|audio)([.\s_-]|$)/.test(blob)) return 'artist';
    if (/(^|[.\s_-])(movie|film)([.\s_-]|$)/.test(blob)) return 'movie';
    const counts = { movie: 0, show: 0, artist: 0 };
    for (const item of hub.items || []) {
        const kind = normalizeLibraryMediaType(item?.type);
        if (kind) counts[kind] += 1;
    }
    const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (ranked[0]?.[1]) return ranked[0][0];
    return 'other';
};

const dominantLibrarySectionId = (items = []) => {
    const counts = new Map();
    for (const item of items) {
        const id = String(item?.librarySectionID || '').trim();
        if (!id) continue;
        counts.set(id, (counts.get(id) || 0) + 1);
    }
    let best = null;
    let bestCount = 0;
    for (const [id, count] of counts) {
        if (count > bestCount) {
            best = id;
            bestCount = count;
        }
    }
    return best;
};

/**
 * Reorder Plex home hubs to follow library sidebar order.
 * Continue Watching stays first; playlists/unknown stay last; typed rows follow nav.
 */
export const applyLibraryNavOrderToHubs = (hubs = [], libraries = [], order = []) => {
    const list = Array.isArray(hubs) ? hubs.filter(Boolean) : [];
    if (list.length < 2) return list.slice();
    const orderedLibraries = applyLibraryNavOrder(libraries, order);
    if (!orderedLibraries.length) return list.slice();

    const libraryRank = new Map();
    const typeRank = new Map();
    orderedLibraries.forEach((library, index) => {
        const key = String(library.key || '').trim();
        if (key) libraryRank.set(key, index);
        const kind = normalizeLibraryMediaType(library.type);
        if (kind && !typeRank.has(kind)) typeRank.set(kind, index);
    });

    const rankFor = (hub, index) => {
        const kind = classifyPlayerHomeHub(hub);
        if (kind === 'continueWatching') return [-2, 0, index];
        if (kind === 'playlist') return [1, 0, index];
        if (kind === 'other') return [1, 1, index];

        const sectionId = dominantLibrarySectionId(hub.items || []);
        if (sectionId && libraryRank.has(sectionId)) {
            return [0, libraryRank.get(sectionId), index];
        }
        if (typeRank.has(kind)) {
            return [0, typeRank.get(kind), index];
        }
        return [1, 2, index];
    };

    return list
        .map((hub, index) => ({ hub, index, rank: rankFor(hub, index) }))
        .sort((a, b) => (
            a.rank[0] - b.rank[0]
            || a.rank[1] - b.rank[1]
            || a.rank[2] - b.rank[2]
        ))
        .map((row) => row.hub);
};

export const applyHomeRowOrder = (ids = [], order = []) => {
    const wanted = [];
    const seenWanted = new Set();
    for (const value of ids) {
        const id = String(value || '').trim();
        if (!id || seenWanted.has(id)) continue;
        seenWanted.add(id);
        wanted.push(id);
    }
    const seen = new Set();
    const out = [];
    for (const id of collapseHomeRowOrder(order)) {
        if (!seenWanted.has(id) || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    for (const id of wanted) {
        if (seen.has(id)) continue;
        out.push(id);
    }
    return out;
};

export const defaultHomeRowIds = () => [...PLAYER_HOME_ROW_IDS];

const AUDIO_LANGUAGE_ALIASES = {
    en: ['en', 'eng', 'english'],
    es: ['es', 'spa', 'spanish', 'español', 'espanol'],
    fr: ['fr', 'fra', 'fre', 'french', 'français', 'francais'],
    de: ['de', 'deu', 'ger', 'german', 'deutsch'],
    it: ['it', 'ita', 'italian', 'italiano'],
    pt: ['pt', 'por', 'portuguese', 'português', 'portugues'],
    ja: ['ja', 'jpn', 'japanese'],
    ko: ['ko', 'kor', 'korean'],
    zh: ['zh', 'chi', 'zho', 'cmn', 'yue', 'chinese', 'mandarin', 'cantonese'],
    ru: ['ru', 'rus', 'russian'],
    nl: ['nl', 'nld', 'dut', 'dutch', 'nederlands'],
    pl: ['pl', 'pol', 'polish', 'polski'],
    sv: ['sv', 'swe', 'swedish', 'svenska'],
    no: ['no', 'nor', 'nb', 'nn', 'norwegian', 'norsk'],
    da: ['da', 'dan', 'danish', 'dansk'],
    fi: ['fi', 'fin', 'finnish', 'suomi'],
    ar: ['ar', 'ara', 'arabic'],
    hi: ['hi', 'hin', 'hindi'],
    tr: ['tr', 'tur', 'turkish'],
    cs: ['cs', 'ces', 'cze', 'czech'],
    hu: ['hu', 'hun', 'hungarian'],
    th: ['th', 'tha', 'thai'],
    vi: ['vi', 'vie', 'vietnamese'],
    uk: ['uk', 'ukr', 'ukrainian'],
    el: ['el', 'ell', 'gre', 'greek'],
    he: ['he', 'heb', 'hebrew'],
    id: ['id', 'ind', 'indonesian'],
    ro: ['ro', 'ron', 'rum', 'romanian'],
};

const normalizeLang = (value) => String(value || '').trim().toLowerCase().replace(/_/g, '-');

export const playerLanguageMatches = (trackLanguage, preferred) => {
    const pref = normalizeLang(preferred);
    if (!pref) return false;
    const lang = normalizeLang(trackLanguage);
    if (!lang) return false;
    const prefBase = pref.split('-')[0];
    const langBase = lang.split('-')[0];
    if (lang === pref || langBase === prefBase) return true;
    const aliases = AUDIO_LANGUAGE_ALIASES[prefBase] || [prefBase];
    return aliases.includes(lang) || aliases.includes(langBase);
};

const trackMatchesLanguage = (track, preferred) => (
    playerLanguageMatches(track?.languageTag, preferred)
    || playerLanguageMatches(track?.language, preferred)
);

export const isPlayerDefaultQualityId = (value) => (
    String(value || '') === 'auto' || isPlayerQualityId(value)
);

export const normalizePlayerSettings = (raw = {}) => {
    const quality = String(raw.defaultQualityId || 'auto');
    const audioLanguage = normalizeLang(raw.audioLanguage);
    const subtitleMode = String(raw.subtitleMode || DEFAULT_PLAYER_SETTINGS.subtitleMode);
    return {
        mixLibraries: raw.mixLibraries === true,
        autoplayNext: raw.autoplayNext !== false,
        stillWatchingAfter: (() => { const n = Number(raw.stillWatchingAfter); if (!Number.isFinite(n)) return 3; return Math.min(20, Math.max(0, Math.floor(n))); })(),
        showContinueWatching: raw.showContinueWatching !== false,
        continueWatchingLayout: isPlayerContinueWatchingLayout(raw.continueWatchingLayout)
            ? String(raw.continueWatchingLayout)
            : 'poster',
        showPlaylists: raw.showPlaylists !== false,
        showWatchlist: raw.showWatchlist !== false,
        continueWatchingSort: isPlayerContinueWatchingSort(raw.continueWatchingSort)
            ? String(raw.continueWatchingSort)
            : 'releaseDate',
        defaultQualityId: isPlayerDefaultQualityId(quality) ? quality : 'auto',
        audioLanguage: /^[a-z]{2}(?:-[a-z]{2})?$/.test(audioLanguage) ? audioLanguage : '',
        subtitleMode: PLAYER_SUBTITLE_MODES.includes(subtitleMode) ? subtitleMode : 'forced',
        autoSkipIntro: raw.autoSkipIntro === true,
        autoSkipCredits: raw.autoSkipCredits === true,
        playThemeTunes: raw.playThemeTunes !== false,
        serviceLogoPlates: raw.serviceLogoPlates !== false,
        showEpisodeFilePills: raw.showEpisodeFilePills !== false,
        watchedTickPosition: isPlayerWatchedTickPosition(raw.watchedTickPosition)
            ? String(raw.watchedTickPosition)
            : 'top-right',
        phoneOverviewPoster: raw.phoneOverviewPoster === true,
        homeRowOrder: collapseHomeRowOrder(raw.homeRowOrder),
        libraryNavOrder: normalizeLibraryNavOrder(
            Array.isArray(raw.libraryNavOrder) && raw.libraryNavOrder.length
                ? raw.libraryNavOrder
                : libraryNavOrderFromHomeRows(raw.homeRowOrder),
        ),
        hideWatchedFromRecents: raw.hideWatchedFromRecents === true,
        reduceMotion: raw.reduceMotion === true,
    };
};

export const pickPlayerAudioStreamId = (audioTracks = [], audioLanguage = '') => {
    const preferred = String(audioLanguage || '').trim();
    if (preferred) {
        const match = audioTracks.find((row) => trackMatchesLanguage(row, preferred));
        if (match?.id) return match.id;
    }
    return (audioTracks.find((row) => row.selected) || audioTracks[0] || null)?.id || null;
};

/** Prefer an audio track ExoPlayer can decode when Direct Playing on Android TV. */
export const pickDirectPlayAudioStreamId = (meta = {}, caps = {}) => {
    const profile = normalizePlaybackCaps(caps);
    if (profile.client === 'web') return '';
    const streams = mediaStreams(meta).filter((row) => Number(row?.streamType) === STREAM_AUDIO);
    if (!streams.length) return '';
    const playable = (row) => {
        const codec = String(row?.codec || '').toLowerCase();
        return codec && profile.audioCodecs.has(codec);
    };
    const selected = streams.find((row) => row.selected === true || row.selected === 1) || streams[0];
    if (playable(selected)) return String(selected.id || '').replace(/\D/g, '');
    const fallback = streams.find((row) => playable(row));
    return fallback ? String(fallback.id || '').replace(/\D/g, '') : '';
};

export const pickPlayerSubtitleStreamId = (subtitles = [], subtitleMode = 'forced', audioLanguage = '', opts = {}) => {
    const mode = PLAYER_SUBTITLE_MODES.includes(String(subtitleMode || '')) ? String(subtitleMode) : 'forced';
    if (mode === 'off' || !subtitles.length) return null;
    const allowImage = opts.allowImageSubtitles !== false;
    const pool = allowImage
        ? subtitles
        : subtitles.filter((row) => !subtitleCodecNeedsBurn(row?.codec));
    if (!pool.length) return null;
    const langMatch = (row) => !audioLanguage || trackMatchesLanguage(row, audioLanguage);
    if (mode === 'forced') {
        return (pool.find((row) => row.forced && langMatch(row))
            || pool.find((row) => row.forced)
            || null)?.id || null;
    }
    return (pool.find((row) => !row.forced && langMatch(row))
        || pool.find((row) => langMatch(row))
        || pool.find((row) => row.selected)
        || pool[0]
        || null)?.id || null;
};

export const mapPlayerPlaybackOptions = (meta = {}, prefs = {}) => {
    const qualities = mapPlayerQualities(meta);
    const audioTracks = mapPlayerAudioTracks(meta);
    const subtitles = mapPlayerSubtitles(meta);
    const settings = normalizePlayerSettings(prefs);
    const preferredQuality = qualities.find((row) => row.id === ORIGINAL_PLAYER_QUALITY_ID)
        || qualities.find((row) => row.id === DEFAULT_PLAYER_QUALITY_ID)
        || qualities[0]
        || null;
    return {
        qualities,
        qualityId: preferredQuality?.id || DEFAULT_PLAYER_QUALITY_ID,
        audioTracks,
        audioStreamId: pickPlayerAudioStreamId(audioTracks, settings.audioLanguage),
        subtitles,
        subtitleStreamId: pickPlayerSubtitleStreamId(subtitles, settings.subtitleMode, settings.audioLanguage, {
            allowImageSubtitles: prefs.allowImageSubtitles !== false,
        }),
    };
};

export const buildPlayerHlsSrc = (ratingKey, {
    sessionId = '',
    offsetMs = 0,
    qualityId = '',
    audioStreamId = '',
    subtitleStreamId = '',
    resume = false,
    copy = true,
    mediaIndex = 0,
} = {}) => {
    const qs = new URLSearchParams();
    if (isPlaySessionId(sessionId)) qs.set('session', String(sessionId));
    if (Number(offsetMs) > 0) qs.set('offset', String(Math.floor(Number(offsetMs))));
    if (resume) qs.set('resume', '1');
    if (isPlayerQualityId(qualityId)) qs.set('quality', String(qualityId));
    if (copy === false) qs.set('copy', '0');
    if (Number(mediaIndex) > 0) qs.set('mediaIndex', String(Math.floor(Number(mediaIndex))));
    if (String(audioStreamId || '').replace(/\D/g, '')) qs.set('audioStreamID', String(audioStreamId).replace(/\D/g, ''));
    if (String(subtitleStreamId || '').replace(/\D/g, '')) qs.set('subtitleStreamID', String(subtitleStreamId).replace(/\D/g, ''));
    return `/api/media-player/hls/${encodeURIComponent(ratingKey)}/master.m3u8?${qs}`;
};

/** Plex type ids/names → player type. Trailers/extras play as clips. */
export const normalizePlayerItemType = (meta = {}) => {
    const raw = String(meta?.type ?? '').trim().toLowerCase();
    if (raw === '1') return 'movie';
    if (raw === '2') return 'show';
    if (raw === '3') return 'season';
    if (raw === '4') return 'episode';
    // Plex type 5 = trailer, 12 = clip — both are playable extras.
    if (raw === '5' || raw === '12' || raw === 'trailer' || raw === 'clip') return 'clip';
    if (raw === '8' || raw === 'artist') return 'artist';
    if (raw === '9' || raw === 'album') return 'album';
    if (raw === '10' || raw === 'track') return 'track';
    if (meta?.extraType != null || String(meta?.subtype || '').trim()) return 'clip';
    return String(meta?.type || '');
};

export const isPlayablePlayerType = (type = '') => {
    const kind = String(type || '').toLowerCase();
    return kind === 'movie'
        || kind === 'episode'
        || kind === 'show'
        || kind === 'season'
        || kind === 'clip'
        || kind === 'trailer'
        || kind === 'track'
        || kind === 'album'
        || kind === 'artist';
};

/** Raw Plex metadata that can start playback (movies, episodes, trailers/extras). */
export const isPlayablePlexMeta = (meta = {}) => (
    isPlayablePlayerType(normalizePlayerItemType(meta))
);

export const mapPlayerItem = (meta = {}, { serverIdentifier = '' } = {}) => {
    const type = normalizePlayerItemType(meta);
    const ratingKey = String(meta.ratingKey || '').trim();
    const key = meta.key || (ratingKey ? `/library/metadata/${ratingKey}` : '');
    const plexUrl = serverIdentifier && key
        ? `https://app.plex.tv/desktop/#!/server/${serverIdentifier}/details?key=${encodeURIComponent(key)}`
        : null;
    const genres = mapTags(meta.Genre);
    const studioTag = asArray(meta.Studio)[0] || asArray(meta.Network)[0];
    const studioName = meta.studio || mapTags(meta.Studio)[0] || mapTags(meta.Network)[0] || '';
    const studioKey = studioKeyFromTag(studioTag) || studioName;
    const librarySectionID = String(meta.librarySectionID || '').replace(/\D/g, '') || null;
    const showTitle = type === 'season' || type === 'album'
        ? (meta.parentTitle || meta.grandparentTitle || null)
        : (meta.grandparentTitle || null);
    const seasonTitle = type === 'episode' || type === 'track'
        ? (meta.parentTitle || null)
        : (type === 'season' ? (meta.title || null) : null);
    return {
        ratingKey,
        title: meta.title || meta.grandparentTitle || 'Untitled',
        showTitle,
        seasonTitle,
        type,
        year: meta.year || null,
        summary: meta.summary || '',
        tagline: meta.tagline || '',
        studio: studioName,
        studioKey,
        thumb: pickPlayerThumb(meta),
        art: safePlexImagePath(meta.art)
            || safePlexImagePath(meta.grandparentArt)
            || safePlexImagePath(meta.parentArt)
            || null,
        logo: pickPlayerLogo(meta),
        themeKey: pickPlayerThemeKey(meta),
        durationMs: asInt(meta.duration),
        viewOffsetMs: plexViewOffsetMs(meta),
        index: asInt(meta.index),
        parentIndex: asInt(meta.parentIndex),
        leafCount: asInt(meta.leafCount),
        childCount: asInt(meta.childCount),
        parentRatingKey: meta.parentRatingKey ? String(meta.parentRatingKey) : null,
        grandparentRatingKey: meta.grandparentRatingKey ? String(meta.grandparentRatingKey) : null,
        librarySectionID,
        contentRating: meta.contentRating || null,
        audienceRating: asInt(meta.audienceRating) || asInt(meta.rating),
        userRating: Number(meta.userRating) > 0 ? Number(meta.userRating) : null,
        originallyAvailableAt: meta.originallyAvailableAt || null,
        tmdbId: pickPlayerTmdbId(meta),
        showTmdbId: pickPlayerShowTmdbId(meta),
        genres,
        countries: mapTags(meta.Country),
        collections: mapTags(meta.Collection),
        collectionItems: mapCollectionItems(meta.Collection),
        directors: mapTags(meta.Director),
        writers: mapTags(meta.Writer),
        directorPeople: mapPeople(meta.Director, 8),
        writerPeople: mapPeople(meta.Writer, 8),
        producers: mapPeople(meta.Producer, 8),
        cast: mapPeople(meta.Role),
        addedAt: asInt(meta.addedAt),
        lastViewedAt: asInt(meta.lastViewedAt),
        viewedLeafCount: uniqueViewedLeafCount(meta),
        extraType: meta.extraType != null ? String(meta.extraType) : null,
        extraSubtype: meta.subtype ? String(meta.subtype) : null,
        viewCount: asInt(meta.viewCount) || 0,
        watched: itemIsWatched(meta),
        plexUrl,
        canPlay: isPlayablePlayerType(type),
        versions: mapPlayerVersions(meta),
    };
};

export const mapPlayerHubs = (hubs = [], config = {}) => asArray(hubs)
    .map((hub) => ({
        title: String(hub?.title || hub?.hubIdentifier || 'Related'),
        identifier: String(hub?.hubIdentifier || hub?.key || hub?.title || ''),
        items: asArray(hub?.Metadata).concat(asArray(hub?.Directory))
            .map((row) => mapPlayerItem(row, config))
            .filter((row) => row.ratingKey),
        hubKey: hubKeyFromPlexHub(hub) || null,
        collectionRatingKey: collectionRatingKeyFromHub(hub) || null,
        playlistRatingKey: playlistRatingKeyFromHub(hub) || null,
        randomOrder: isRandomOrderSource(hub) || undefined,
    }))
    .map((hub) => {
        if (!hub.randomOrder || hub.items.length < 2) return hub;
        return {
            ...hub,
            hubKey: hub.hubKey ? withPlexSortParam(hub.hubKey, 'random') : hub.hubKey,
            items: shuffleRows(hub.items),
        };
    })
    .filter((hub) => hub.items.length);

/** Plex movie/show id used to load the designed 16:9 coverArt. Episodes use the show. */
export const plexHeroUuidFromMeta = (meta = {}) => {
    const type = String(meta.type || '').toLowerCase();
    const preferred = (type === 'episode' || type === 'season')
        ? [meta.grandparentGuid, meta.parentGuid, meta.guid]
        : [meta.guid, meta.grandparentGuid, meta.parentGuid];
    const tagged = asArray(meta.Guid).map((row) => row?.id);
    for (const raw of preferred.concat(tagged)) {
        const match = String(raw || '').match(/plex:\/\/(?:movie|show)\/([a-z0-9]+)/i);
        if (match) return match[1];
    }
    return '';
};

const largestProviderImage = (images, type) => {
    const rows = asArray(images)
        .filter((image) => String(image?.type || '') === type && String(image?.url || '').trim());
    rows.sort((a, b) => (Number(b?.width) || Number(b?.height) || 0) - (Number(a?.width) || Number(a?.height) || 0));
    return String(rows[0]?.url || '').trim();
};

/** Official hero card from metadata.provider.plex.tv. Background art is a different image. */
export const coverArtUrlFromProvider = (payload) => {
    const container = payload?.MediaContainer || payload || {};
    const rows = asArray(container.Metadata).concat(asArray(container.Directory));
    return largestProviderImage(rows[0]?.Image, 'coverArt');
};

/** Replex hero card: Plex coverArt only. Background and clearLogo are different images. */
export const heroAssetsFromProvider = (payload) => {
    const still = coverArtUrlFromProvider(payload);
    if (!still) return null;
    return { still, logo: '' };
};

/** True when a hub or collection is sorted with Plex's random order. */
export const isRandomOrderSource = (value) => {
    if (value && typeof value === 'object') {
        const ident = String(value.hubIdentifier || value.identifier || '');
        if (/(^|[.\-_])random([.\-_]|$)/i.test(ident)) return true;
    }
    let text = typeof value === 'string' ? value : JSON.stringify(value || '');
    for (let pass = 0; pass < 2; pass += 1) {
        try {
            const next = decodeURIComponent(text);
            if (next === text) break;
            text = next;
        } catch {
            break;
        }
    }
    return /\bsort\W{0,6}random\b/i.test(text)
        || /\bcollectionsort\W{0,6}random\b/i.test(text);
};

/** Keep an existing query, but add sort= when Plex random/title order needs to follow. */
export const withPlexSortParam = (path, sort) => {
    const raw = String(path || '').trim();
    const want = String(sort || '').trim();
    if (!raw || !want) return raw;
    const split = raw.match(/^([^/]+)::(\/.+)$/);
    const prefix = split ? `${split[1]}::` : '';
    const rest = split ? split[2] : raw;
    const qIndex = rest.indexOf('?');
    const pathname = qIndex >= 0 ? rest.slice(0, qIndex) : rest;
    const params = new URLSearchParams(qIndex >= 0 ? rest.slice(qIndex + 1) : '');
    if (want.toLowerCase() === 'random' || !params.get('sort')) params.set('sort', want);
    return `${prefix}${pathname}?${params.toString()}`;
};

export const shuffleRows = (rows) => {
    const copy = rows.slice();
    for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1));
        const current = copy[index];
        copy[index] = copy[swap];
        copy[swap] = current;
    }
    return copy;
};

/** Pinned home rows with this collection label render as widescreen hero cards. */
export const isHeroRowLabel = (value) => /^(heros|heroes)$/i.test(String(value || '').trim());

export const collectionMetaHasHeroLabel = (meta = {}) => {
    const rows = [].concat(meta?.Label || meta?.label || []);
    return rows.some((row) => isHeroRowLabel(typeof row === 'string' ? row : (row?.tag || row?.title || '')));
};

/** Mark collection hubs whose Plex label is Heros or Heroes. Other rows stay posters. */
export const markHeroCollectionHubs = async (hubs = [], loadCollection) => {
    const list = Array.isArray(hubs) ? hubs : [];
    const ids = [...new Set(list.map((hub) => String(hub?.collectionRatingKey || '')).filter(Boolean))];
    const hero = new Set();
    const random = new Set();
    await Promise.all(ids.map(async (id) => {
        try {
            const meta = await loadCollection(id);
            if (collectionMetaHasHeroLabel(meta)) hero.add(id);
            if (isRandomOrderSource(meta)) random.add(id);
        } catch {
            /* A missing collection stays a poster row. */
        }
    }));
    if (!hero.size && !random.size) return list;
    return list.map((hub) => {
        const id = String(hub?.collectionRatingKey || '');
        const heroRow = hero.has(id);
        const randomOrder = random.has(id) || Boolean(hub?.randomOrder);
        if (!heroRow && !randomOrder) return hub;
        const next = {
            ...hub,
            ...(heroRow ? { heroRow: true } : {}),
            ...(randomOrder ? { randomOrder: true } : {}),
        };
        if (randomOrder && next.hubKey) next.hubKey = withPlexSortParam(next.hubKey, 'random');
        if (randomOrder && Array.isArray(next.items) && next.items.length > 1) {
            next.items = shuffleRows(next.items);
        }
        return next;
    });
};

export const collectionRatingKeyFromHub = (hub = {}) => {
    const blob = [hub.key, hub.hubKey, hub.hubIdentifier].map((value) => String(value || '')).join(' ');
    if (!/collection/i.test(blob)) return '';
    const match = blob.match(/\/library\/collections\/(\d+)/i)
        || blob.match(/collection[./_-](\d+)/i);
    return match?.[1] || '';
};

export const playlistRatingKeyFromHub = (hub = {}) => {
    const blob = [hub.key, hub.hubKey, hub.hubIdentifier, hub.type].map((value) => String(value || '')).join(' ');
    if (!/playlist/i.test(blob)) return '';
    const match = blob.match(/\/playlists\/(\d+)/i);
    return match?.[1] || '';
};

/** Relative PMS list path for a hub. Keeps Plex sort= so View All matches the row. */
export const hubKeyFromPlexHub = (hub = {}) => {
    const path = safePlexLibraryPath(hub.key || hub.hubKey);
    if (!path) return '';
    const qIndex = path.indexOf('?');
    if (qIndex < 0) return path;
    const pathname = path.slice(0, qIndex);
    const sort = String(new URLSearchParams(path.slice(qIndex + 1)).get('sort') || '').trim();
    return sort ? `${pathname}?sort=${encodeURIComponent(sort)}` : pathname;
};

export const mapPlayerHomeHubs = (hubs = [], config = {}) => {
    const seen = new Set();
    const out = [];
    for (const hub of asArray(hubs)) {
        const identifier = String(hub?.hubIdentifier || hub?.key || hub?.title || '').trim();
        if (!identifier || seen.has(identifier)) continue;
        const seenItems = new Set();
        const items = asArray(hub?.Metadata)
            .map((meta) => mapLibraryHubItem(meta, hub, config))
            .filter((row) => {
                const key = row.dedupeKey || row.ratingKey;
                if (!key || seenItems.has(key)) return false;
                seenItems.add(key);
                return true;
            });
        if (!items.length) continue;
        seen.add(identifier);
        const randomOrder = isRandomOrderSource(hub) || undefined;
        let hubKey = hubKeyFromPlexHub(hub) || null;
        if (randomOrder && hubKey) hubKey = withPlexSortParam(hubKey, 'random');
        out.push({
            title: String(hub?.title || identifier || 'Hub'),
            identifier,
            items: randomOrder && items.length > 1 ? shuffleRows(items.slice(0, 24)) : items.slice(0, 24),
            hubKey,
            collectionRatingKey: collectionRatingKeyFromHub(hub) || null,
            playlistRatingKey: playlistRatingKeyFromHub(hub) || null,
            randomOrder,
        });
    }
    return out;
};

/** One home row per title. Later pinned rows with the same name append their titles. */
export const mergeSameTitleHomeHubs = (hubs = []) => {
    const order = [];
    const groups = new Map();
    for (const hub of asArray(hubs)) {
        const key = String(hub?.title || '').trim().toLowerCase();
        if (!key) continue;
        if (!groups.has(key)) {
            groups.set(key, []);
            order.push(key);
        }
        groups.get(key).push(hub);
    }
    return order.map((key) => {
        const group = groups.get(key);
        const randomOrder = group.some((hub) => hub?.randomOrder);
        if (group.length === 1) {
            const hub = group[0];
            if (!randomOrder || !Array.isArray(hub.items) || hub.items.length < 2) return hub;
            return { ...hub, items: shuffleRows(hub.items) };
        }
        const seen = new Set();
        const items = [];
        for (const hub of group) {
            for (const item of asArray(hub?.items)) {
                const id = String(item?.dedupeKey || item?.ratingKey || '');
                if (!id || seen.has(id)) continue;
                seen.add(id);
                items.push(item);
            }
        }
        const first = group[0];
        return {
            ...first,
            heroRow: group.some((hub) => hub?.heroRow) || undefined,
            randomOrder: randomOrder || undefined,
            items: randomOrder ? shuffleRows(items) : items,
        };
    });
};

/** Plex extras may live at MediaContainer.Metadata, .Video, or nested Extras.Metadata. */
export const isPlayerExtraMeta = (meta = {}) => {
    const type = String(meta?.type ?? '').trim().toLowerCase();
    return type === 'clip'
        || type === 'trailer'
        || type === '5'
        || type === '12'
        || meta?.extraType != null
        || String(meta?.subtype || '').trim() !== '';
};

export const listPlayerExtraMetas = (payload = {}) => {
    const container = payload?.MediaContainer || payload || {};
    const top = asArray(container.Metadata).concat(asArray(container.Video));
    const nested = top.flatMap((row) => asArray(row?.Extras?.Metadata).concat(asArray(row?.Extras?.Video)));
    if (nested.length) return nested.filter(isPlayerExtraMeta);
    const extras = top.filter(isPlayerExtraMeta);
    return extras.length ? extras : [];
};

export const mapPlayerExtras = (list = [], config = {}) => asArray(list)
    .map((meta) => mapPlayerItem({
        ...meta,
        ratingKey: String(meta.ratingKey || '').trim()
            || String(meta.key || '').match(/\/metadata\/([^/?]+)/)?.[1]
            || '',
        // Force clip so Plex "trailer" type (and numeric 5) always plays.
        type: 'clip',
        extraType: meta.extraType != null
            ? meta.extraType
            : (String(meta.type || '').toLowerCase() === 'trailer' || String(meta.type) === '5' ? 1 : meta.extraType),
        subtype: meta.subtype || (String(meta.type || '').toLowerCase() === 'trailer' ? 'trailer' : meta.subtype),
    }, config))
    .filter((row) => row.ratingKey);

/** Recently Added TV: show poster + show title, but keep the episode key so open/play hits that episode. */
export const mapRecentlyAddedItem = (meta = {}, section = {}, config = {}) => {
    if (section?.type === 'movie') {
        return mapPlayerItem({ ...meta, type: 'movie' }, config);
    }
    const item = mapPlayerItem(meta, config);
    if (item.type !== 'episode' && item.type !== 'season') return item;
    const showKey = String(
        item.type === 'season'
            ? (meta.parentRatingKey || item.parentRatingKey || meta.grandparentRatingKey || item.grandparentRatingKey)
            : (meta.grandparentRatingKey || item.grandparentRatingKey)
        || '',
    ).replace(/\D/g, '');
    // Never use the episode still — recently-added often omits grandparentThumb.
    const showThumb = (showKey ? `/library/metadata/${showKey}/thumb` : '')
        || safePlexImagePath(meta.grandparentThumb)
        || safePlexImagePath(meta.parentThumb)
        || null;
    return {
        ...item,
        title: meta.grandparentTitle || meta.parentTitle || item.title,
        thumb: showThumb,
        cardAspect: '2/3',
        dedupeKey: item.grandparentRatingKey || item.parentRatingKey || item.ratingKey,
    };
};

export const isLibraryContinueWatchingHub = (hub = {}) => {
    const blob = [
        hub.hubIdentifier,
        hub.identifier,
        hub.context,
        hub.title,
        hub.key,
        hub.hubKey,
    ].map((value) => String(value || '')).join(' ');
    return /continue\s*watch|ondeck|on[.\s_-]?deck|in[.\s_-]?progress/i.test(blob);
};

const libraryHubBlob = (hub = {}) => `${hub.identifier || ''} ${hub.hubIdentifier || ''} ${hub.title || ''}`;

const libraryItemHead = (items = []) => (
    (Array.isArray(items) ? items : []).slice(0, 8).map((row) => row?.ratingKey || '').join('|')
);

/**
 * Library Home must not stop at Continue Watching. Plex section hubs often arrive
 * without Metadata unless includeMeta=1, and a non-empty On Deck row used to
 * suppress the Recently Added fallback entirely.
 */
export const assembleLibraryHomeHubs = ({
    sectionHubs = [],
    onDeckItems = [],
    recentItems = [],
    newestItems = [],
    sectionKey = '',
    config = {},
} = {}) => {
    const hubs = [];
    const seen = new Set();
    const sectionPath = String(sectionKey || '').replace(/\D/g, '');
    const push = (identifier, title, items, hubKey = '', extra = {}) => {
        const id = String(identifier || title || '').trim();
        if (!id || seen.has(id)) return;
        const seenItems = new Set();
        let rows = (Array.isArray(items) ? items : []).filter((row) => {
            const key = row?.dedupeKey || row?.ratingKey;
            if (!key || seenItems.has(key)) return false;
            seenItems.add(key);
            return true;
        }).slice(0, 24);
        if (!rows.length) return;
        seen.add(id);
        const randomOrder = Boolean(extra.randomOrder)
            || isRandomOrderSource({ key: hubKey, hubIdentifier: id });
        if (randomOrder && rows.length > 1) rows = shuffleRows(rows);
        const key = hubKeyFromPlexHub({ key: hubKey }) || hubKey || null;
        hubs.push({
            title: String(title || id),
            identifier: id,
            items: rows,
            hubKey: randomOrder && key ? withPlexSortParam(key, 'random') : key,
            collectionRatingKey: collectionRatingKeyFromHub({ key: key || '', hubIdentifier: id }) || null,
            playlistRatingKey: playlistRatingKeyFromHub({ key: key || '', hubIdentifier: id }) || null,
            randomOrder: randomOrder || undefined,
        });
    };

    if (Array.isArray(onDeckItems) && onDeckItems.length) {
        push(
            'continueWatching',
            'Continue Watching',
            onDeckItems,
            sectionPath ? `/library/sections/${sectionPath}/onDeck` : '/library/onDeck',
        );
    }

    for (const hub of asArray(sectionHubs)) {
        const identifier = String(hub?.hubIdentifier || hub?.key || hub?.title || '').trim();
        if (!identifier) continue;
        if (isLibraryContinueWatchingHub(hub) || isLibraryContinueWatchingHub({ identifier, title: hub?.title })) continue;
        const items = asArray(hub?.Metadata)
            .map((meta) => mapLibraryHubItem(meta, hub, config))
            .filter((row) => row.ratingKey);
        push(identifier, hub?.title || identifier, items, hubKeyFromPlexHub(hub), {
            randomOrder: isRandomOrderSource(hub),
        });
    }

    const hasKind = (pattern) => hubs.some((hub) => pattern.test(libraryHubBlob(hub)));
    if (!hasKind(/recently\s*added|recentlyadded/i)) {
        push(
            'recentlyAdded',
            'Recently Added',
            recentItems,
            sectionPath ? `/library/sections/${sectionPath}/recentlyAdded` : '',
        );
    }
    const newestHead = libraryItemHead(newestItems);
    const displayedRecent = hubs.find((hub) => /recently\s*added|recentlyadded/i.test(libraryHubBlob(hub)));
    const recentHead = libraryItemHead(displayedRecent?.items?.length ? displayedRecent.items : recentItems);
    if (!hasKind(/recently\s*released|recentlyreleased|\bnewest\b/i) && newestHead && newestHead !== recentHead) {
        push(
            'recentlyReleased',
            'Recently Released',
            newestItems,
            sectionPath ? `/library/sections/${sectionPath}/newest` : '',
        );
    }

    return dedupeLibraryContinueWatchingHubs(hubs);
};

export const dedupeLibraryContinueWatchingHubs = (hubs = []) => {
    let keptContinue = false;
    return (Array.isArray(hubs) ? hubs : []).filter((hub) => {
        if (!isLibraryContinueWatchingHub(hub)) return true;
        if (keptContinue) return false;
        keptContinue = true;
        return true;
    });
};

/** Keep pin order, but never show another user's On Deck. */
export const withMemberContinueWatching = (hubs = [], continueWatching = [], { keepWhenEmpty = false } = {}) => {
    const items = (Array.isArray(continueWatching) ? continueWatching : []).filter((row) => row?.ratingKey);
    const list = Array.isArray(hubs) ? hubs.filter((hub) => !isLibraryContinueWatchingHub(hub)) : [];
    if (!items.length) return keepWhenEmpty ? (Array.isArray(hubs) ? hubs.slice() : []) : list;
    const original = (Array.isArray(hubs) ? hubs : []).find((hub) => isLibraryContinueWatchingHub(hub));
    const cwHub = {
        title: original?.title || 'Continue Watching',
        identifier: original?.identifier || 'home.continueWatching',
        items,
        hubKey: original?.hubKey || '/library/onDeck',
        collectionRatingKey: null,
        playlistRatingKey: null,
    };
    const idx = (Array.isArray(hubs) ? hubs : []).findIndex((hub) => isLibraryContinueWatchingHub(hub));
    if (idx < 0) return [cwHub, ...list];
    const next = list.slice();
    next.splice(idx, 0, cwHub);
    return next;
};

export const mapLibraryHubItem = (meta = {}, hub = {}, config = {}) => {
    const ident = String(hub.hubIdentifier || hub.context || hub.key || '');
    if (meta.type === 'episode' && /ondeck|continue/i.test(ident)) {
        return mapContinueWatchingItem(meta, config);
    }
    if ((meta.type === 'episode' || meta.type === 'season') && /recent/i.test(ident)) {
        return mapRecentlyAddedItem(meta, { type: 'show' }, config);
    }
    return mapPlayerItem(meta, config);
};

export const PLAYER_LIBRARY_SORT_IDS = new Set([
    'addedAt:desc',
    'titleSort',
    'titleSort:desc',
    'year:desc',
    'originallyAvailableAt:desc',
    'audienceRating:desc',
    'lastViewedAt:desc',
    'viewCount:desc',
    'random',
]);

export const nextEpisodeInList = (episodes = [], currentRatingKey = '') => {
    const current = String(currentRatingKey || '');
    const idx = (Array.isArray(episodes) ? episodes : []).findIndex((row) => String(row?.ratingKey || '') === current);
    if (idx < 0) return null;
    return episodes[idx + 1] || null;
};

export const previousEpisodeInList = (episodes = [], currentRatingKey = '') => {
    const current = String(currentRatingKey || '');
    const idx = (Array.isArray(episodes) ? episodes : []).findIndex((row) => String(row?.ratingKey || '') === current);
    if (idx <= 0) return null;
    return episodes[idx - 1] || null;
};

/** On Deck cards should look like library posters, not episode stills.
 *  Default: show poster. Admin option: season poster (`mediaPlayerContinueWatchingSeasonPoster`). */
export const mapContinueWatchingItem = (meta = {}, config = {}) => {
    const item = mapPlayerItem(meta, config);
    if (item.type !== 'episode') return item;
    const episodeTitle = String(meta.title || item.title || '').trim() || null;
    const episodeThumb = safePlexImagePath(meta.thumb)
        || (item.ratingKey ? `/library/metadata/${item.ratingKey}/thumb` : item.thumb);
    const preferSeason = config?.mediaPlayerContinueWatchingSeasonPoster === true;
    const posterThumb = preferSeason
        ? (safePlexImagePath(meta.parentThumb) || safePlexImagePath(meta.grandparentThumb) || item.thumb)
        : (safePlexImagePath(meta.grandparentThumb) || safePlexImagePath(meta.parentThumb) || item.thumb);
    return {
        ...item,
        episodeTitle,
        episodeThumb,
        title: meta.grandparentTitle || item.title,
        thumb: posterThumb,
        cardAspect: '2/3',
    };
};

export const mapPlayerSection = (dir = {}) => ({
    key: String(dir.key || ''),
    title: dir.title || 'Library',
    type: dir.type || '',
    agent: dir.agent || '',
    thumb: dir.thumb || dir.composite || null,
});

const PLAYER_AVATAR_HOSTS = new Set([
    'plex.tv',
    'www.plex.tv',
    'gravatar.com',
    'www.gravatar.com',
]);

/** Public or portal-proxied avatar only — never a Plex token URL. */
export const safePlayerAvatarUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.startsWith('/api/plex/image') || raw.startsWith('/api/jellyfin/user-image')) return raw;
    try {
        const url = new URL(raw);
        if (url.protocol !== 'https:') return '';
        const host = url.hostname.toLowerCase();
        if (PLAYER_AVATAR_HOSTS.has(host) || host.endsWith('.plex.tv')) {
            url.searchParams.delete('X-Plex-Token');
            url.hash = '';
            return url.toString();
        }
    } catch {
        /* relative library path */
    }
    const path = safePlexLibraryPath(raw);
    if (!path) return '';
    const pathname = path.split('?')[0];
    return `/api/plex/image?path=${encodeURIComponent(pathname)}&width=160&height=160`;
};

export const mapPlayerProfile = (raw = {}) => {
    const username = String(raw.username || raw.title || raw.name || '').trim();
    return {
        username,
        thumb: safePlayerAvatarUrl(raw.thumb) || null,
        isAdmin: raw.isAdmin === true,
    };
};

export const isAllowedPlexProxyUrl = (target, plexOrigin) => {
    try {
        const origin = new URL(plexOrigin);
        const url = new URL(target, origin);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
        if (url.username || url.password) return false;
        if (url.hostname !== origin.hostname) return false;
        const originPort = origin.port || (origin.protocol === 'https:' ? '443' : '80');
        const urlPort = url.port || (url.protocol === 'https:' ? '443' : '80');
        return urlPort === originPort;
    } catch {
        return false;
    }
};

export const isHlsPlaylist = (body) => /^\s*#EXTM3U/m.test(String(body || ''));

export const clampPlayOffsetMs = (offsetMs, durationMs) => {
    const offset = Math.max(0, Number(offsetMs) || 0);
    const duration = Math.max(0, Number(durationMs) || 0);
    if (offset < 5000) return 0;
    if (duration && offset > Math.max(0, duration - 15000)) return 0;
    if (duration && (offset >= duration * 0.9 || offset > Math.max(0, duration - 15000))) return 0;
    return offset;
};

export const rewritePlexUrlToOrigin = (target, plexOrigin, baseUrl = plexOrigin) => {
    const origin = new URL(plexOrigin);
    const url = new URL(target, baseUrl || plexOrigin);
    url.protocol = origin.protocol;
    url.host = origin.host;
    return stripPlexTokenFromUrl(url.toString());
};

export const stripPlexTokenFromUrl = (target) => {
    const url = new URL(target);
    url.searchParams.delete('X-Plex-Token');
    url.searchParams.delete('x-plex-token');
    return url.toString();
};

export const rewritePlaylistUrls = (body, plexOrigin, proxyPrefix, playlistUrl = plexOrigin, accessToken = '') => {
    const baseUrl = playlistUrl || plexOrigin;
    const token = String(accessToken || '').trim();
    const withAuth = (proxyUrl) => {
        if (!token) return proxyUrl;
        const join = proxyUrl.includes('?') ? '&' : '?';
        return `${proxyUrl}${join}access_token=${encodeURIComponent(token)}`;
    };
    const lines = String(body || '').split(/\r?\n/);
    return lines.map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (trimmed.startsWith('#')) {
            return line.replace(/URI="([^"]+)"/gi, (_, uri) => {
                const absolute = rewritePlexUrlToOrigin(uri, plexOrigin, baseUrl);
                return `URI="${withAuth(`${proxyPrefix}${encodeURIComponent(absolute)}`)}"`;
            });
        }
        const absolute = rewritePlexUrlToOrigin(trimmed, plexOrigin, baseUrl);
        return withAuth(`${proxyPrefix}${encodeURIComponent(absolute)}`);
    }).join('\n');
};

export const TIMELINE_STATES = new Set(['playing', 'paused', 'buffering', 'stopped']);

export const isPlaySessionId = (value) => {
    const id = String(value || '').trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return true;
    if (/^smp-[\w.-]{6,64}$/i.test(id)) return true;
    return /^plex-\d{1,16}$/i.test(id);
};
export const buildPlexTimelineParams = ({
    ratingKey,
    state,
    timeMs = 0,
    durationMs = 0,
    sessionId = '',
    audioStreamId = '',
    subtitleStreamId = '',
} = {}) => {
    const params = new URLSearchParams({
        ratingKey: String(ratingKey || ''),
        key: `/library/metadata/${ratingKey}`,
        identifier: 'com.plexapp.plugins.library',
        state: TIMELINE_STATES.has(String(state || '')) ? String(state) : 'playing',
        time: String(Math.max(0, Math.floor(Number(timeMs) || 0))),
        duration: String(Math.max(0, Math.floor(Number(durationMs) || 0))),
        playbackTime: String(Math.max(0, Math.floor(Number(timeMs) || 0))),
        type: 'video',
        hasMDE: '1',
    });
    if (isPlaySessionId(sessionId)) params.set('X-Plex-Session-Identifier', String(sessionId));
    const audioId = String(audioStreamId || '').replace(/\D/g, '');
    if (audioId) params.set('audioStreamID', audioId);
    params.set('subtitleStreamID', String(subtitleStreamId || '').replace(/\D/g, '') || '0');
    return params;
};
