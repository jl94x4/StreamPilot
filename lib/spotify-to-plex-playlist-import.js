export const SPOTIFY_MEDIA_KINDS = ['playlist', 'album', 'artist', 'track'];
export const ARTIST_ALBUM_IMPORT_LIMIT = 30;

const SPOTIFY_ID_RE = /^[A-Za-z0-9]{10,}$/;
const SPOTIFY_URI_RE = /^spotify:(playlist|album|artist|track):([A-Za-z0-9]+)/i;

const skipPathSegment = (part) => {
    const value = String(part || '').toLowerCase();
    return !value || value.startsWith('intl-') || value === 'embed' || value === 'open';
};

export const parseSpotifyMediaLink = (input) => {
    const raw = String(input || '').trim();
    if (!raw) return null;
    const uri = raw.match(SPOTIFY_URI_RE);
    if (uri) {
        const kind = uri[1].toLowerCase();
        const id = uri[2];
        if (!SPOTIFY_MEDIA_KINDS.includes(kind) || !SPOTIFY_ID_RE.test(id)) return null;
        return { kind, id, uri: `spotify:${kind}:${id}` };
    }
    let url;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    if (host !== 'open.spotify.com' && host !== 'play.spotify.com') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    let index = 0;
    while (index < parts.length && skipPathSegment(parts[index])) index += 1;
    const kind = String(parts[index] || '').toLowerCase();
    const id = String(parts[index + 1] || '').split('?')[0];
    if (!SPOTIFY_MEDIA_KINDS.includes(kind) || !SPOTIFY_ID_RE.test(id)) return null;
    return { kind, id, uri: `spotify:${kind}:${id}` };
};

export const uniqueAlbumsFromArtistPages = (albums = [], { limit = ARTIST_ALBUM_IMPORT_LIMIT } = {}) => {
    const cap = Math.max(1, Number(limit) || ARTIST_ALBUM_IMPORT_LIMIT);
    const seen = new Set();
    const out = [];
    for (const album of Array.isArray(albums) ? albums : []) {
        const id = String(album?.id || '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const image = Array.isArray(album?.images)
            ? String(album.images[0]?.url || '')
            : String(album?.image || '');
        out.push({
            id,
            title: String(album.title || album.name || id),
            image,
            uri: `spotify:album:${id}`,
        });
        if (out.length >= cap) break;
    }
    return out;
};

export const resolveSpotifyLinkImports = async (search, {
    fetchArtist = null,
    fetchArtistAlbums = null,
    fetchTrack = null,
    albumLimit = ARTIST_ALBUM_IMPORT_LIMIT,
} = {}) => {
    const parsed = parseSpotifyMediaLink(search);
    if (!parsed) {
        const error = new Error('Paste a Spotify playlist, album, or artist link.');
        error.status = 400;
        throw error;
    }
    if (parsed.kind === 'playlist' || parsed.kind === 'album') {
        return {
            kind: parsed.kind,
            title: parsed.kind === 'album' ? 'album' : 'playlist',
            searches: [{ search: parsed.uri, id: parsed.id, kind: parsed.kind }],
        };
    }
    if (parsed.kind === 'track') {
        if (typeof fetchTrack !== 'function') {
            const error = new Error('Track links need Spotify credentials to find the album.');
            error.status = 400;
            throw error;
        }
        const track = await fetchTrack(parsed.id);
        const albumId = String(track?.album?.id || '').trim();
        if (!albumId) {
            const error = new Error('Could not find the album for that Spotify track.');
            error.status = 400;
            throw error;
        }
        return {
            kind: 'album',
            title: String(track.album?.name || 'album'),
            searches: [{ search: `spotify:album:${albumId}`, id: albumId, kind: 'album' }],
        };
    }
    if (typeof fetchArtistAlbums !== 'function') {
        const error = new Error('Artist pages need Spotify credentials to load albums.');
        error.status = 400;
        throw error;
    }
    const [artist, albums] = await Promise.all([
        typeof fetchArtist === 'function' ? fetchArtist(parsed.id) : Promise.resolve(null),
        fetchArtistAlbums(parsed.id),
    ]);
    const unique = uniqueAlbumsFromArtistPages(albums, { limit: albumLimit });
    const name = String(artist?.name || 'this artist');
    if (!unique.length) {
        const error = new Error(`No albums found for ${name}.`);
        error.status = 404;
        throw error;
    }
    return {
        kind: 'artist',
        title: name,
        searches: unique.map((album) => ({
            search: album.uri,
            id: album.id,
            kind: 'album',
            title: album.title,
        })),
    };
};

export const summarizeSpotifyLinkImport = ({ kind, title, addedIds = [], skippedIds = [] } = {}) => {
    const added = addedIds.length;
    const skipped = skippedIds.length;
    if (kind === 'artist') {
        const name = title || 'artist';
        if (added && skipped) return `Added ${added} albums from ${name} (${skipped} already saved).`;
        if (added) return `Added ${added} album${added === 1 ? '' : 's'} from ${name}.`;
        return `${skipped} album${skipped === 1 ? '' : 's'} from ${name} already saved.`;
    }
    const noun = kind === 'album' ? 'Album' : 'Playlist';
    if (added) return `${noun} added — matching tracks in Plex…`;
    return `${noun} already saved — matching tracks in Plex…`;
};

export const likedSongsItemId = (userId) => `liked-${String(userId || '').trim()}`;

export const isAlreadyAddedError = (message) => /already added/i.test(String(message || ''));

export const asItemArray = (data) => {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.playlists)) return data.playlists;
    return [];
};

export const fetchSpotifyAccountPlaylistPages = async (fetchPage, { limit = 50, maxPages = 40 } = {}) => {
    const all = [];
    const seen = new Set();
    const pageSize = Math.max(1, Number(limit) || 50);
    const pages = Math.max(1, Number(maxPages) || 40);
    for (let page = 0; page < pages; page += 1) {
        const offset = page * pageSize;
        const data = await fetchPage({ limit: pageSize, offset });
        const items = asItemArray(data);
        let added = 0;
        for (const item of items) {
            const id = String(item?.id || item?.uri || '');
            if (!id || seen.has(id)) continue;
            seen.add(id);
            all.push(item);
            added += 1;
        }
        const total = Number(data?.total);
        if (items.length < pageSize) break;
        if (Number.isFinite(total) && all.length >= total) break;
        if (!added) break;
    }
    return all;
};

export const savedItemIdSet = (items) => new Set(
    asItemArray(items).map((item) => String(item?.id || '')).filter(Boolean),
);

export const buildLikedSongsPlaylist = (user = {}, { savedIds } = {}) => {
    const userId = String(user.id || '').trim();
    const name = String(user.name || user.label || userId).trim() || userId;
    const id = likedSongsItemId(userId);
    return {
        id,
        title: 'Liked Songs',
        liked: true,
        private: true,
        owner: name,
        userId,
        image: '',
        search: `${name}:liked`,
        added: savedIds instanceof Set ? savedIds.has(id) : false,
        kind: 'liked',
    };
};

export const normalizeSpotifyAccountPlaylists = (raw, { user = {}, savedIds } = {}) => {
    const saved = savedIds instanceof Set ? savedIds : savedItemIdSet(savedIds);
    const userId = String(user.id || '').trim();
    const playlists = asItemArray(raw)
        .filter((item) => item && (item.id || item.uri))
        .map((item) => {
            const id = String(item.id || '').trim();
            return {
                id,
                title: String(item.title || item.name || id),
                liked: false,
                private: !!item.private,
                owner: String(item.owner || ''),
                userId: String(item.user_id || userId),
                image: String(item.image || ''),
                search: `spotify:playlist:${id}`,
                added: item.added === true || saved.has(id),
                kind: 'playlist',
            };
        });
    if (!userId) return playlists;
    return [buildLikedSongsPlaylist(user, { savedIds: saved }), ...playlists];
};

export const normalizeSpotifyAccountAlbums = (raw, { savedIds } = {}) => {
    const saved = savedIds instanceof Set ? savedIds : savedItemIdSet(savedIds);
    return asItemArray(raw)
        .filter((item) => item && (item.id || item.uri || item.album?.id))
        .map((item) => {
            const album = item.album && typeof item.album === 'object' ? item.album : item;
            const id = String(album.id || item.id || '').trim();
            const artists = Array.isArray(album.artists)
                ? album.artists.map((artist) => (typeof artist === 'string' ? artist : String(artist?.name || ''))).filter(Boolean)
                : [];
            return {
                id,
                title: String(album.title || album.name || id),
                liked: false,
                private: false,
                owner: artists.join(', ') || String(item.artist || 'Album'),
                userId: '',
                image: String(album.image || album.images?.[0]?.url || item.image || ''),
                search: `spotify:album:${id}`,
                added: item.added === true || saved.has(id),
                kind: 'album',
            };
        })
        .filter((item) => item.id);
};

export const SPOTIFY_EDITORIAL_ID_PREFIX = '37i9dQZF1';

export const isSpotifyOwnedPlaylist = (item = {}) => {
    const ownerId = String(item?.owner?.id || item?.ownerId || '').trim().toLowerCase();
    const ownerName = String(
        typeof item?.owner === 'string'
            ? item.owner
            : (item?.owner?.display_name || item?.owner?.name || ''),
    ).trim().toLowerCase();
    const id = String(item?.id || '').trim();
    return ownerId === 'spotify' || ownerName === 'spotify' || id.startsWith(SPOTIFY_EDITORIAL_ID_PREFIX);
};

export const normalizeSpotifySearchPlaylists = (raw, { savedIds } = {}) => {
    const saved = savedIds instanceof Set ? savedIds : savedItemIdSet(savedIds);
    const items = Array.isArray(raw)
        ? raw
        : (Array.isArray(raw?.playlists?.items) ? raw.playlists.items : asItemArray(raw));
    const playlists = items
        .filter((item) => item && (item.id || item.uri))
        .map((item) => {
            const id = String(item.id || '').trim();
            const owner = typeof item.owner === 'string'
                ? item.owner
                : String(item.owner?.display_name || item.owner?.name || '');
            return {
                id,
                title: String(item.title || item.name || id),
                liked: false,
                private: item.public === false || !!item.private,
                owner,
                userId: '',
                image: String(item.image || item.images?.[0]?.url || ''),
                search: `spotify:playlist:${id}`,
                added: item.added === true || saved.has(id),
                kind: 'playlist',
                editorial: isSpotifyOwnedPlaylist(item) || owner.toLowerCase() === 'spotify',
            };
        })
        .filter((item) => item.id);
    playlists.sort((a, b) => Number(!!b.editorial) - Number(!!a.editorial));
    return playlists;
};

export const mergeCatalogPlaylists = (local = [], catalog = []) => {
    const seen = new Set();
    const out = [];
    for (const item of [...local, ...catalog]) {
        const id = String(item?.id || '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(item);
    }
    return out;
};

export const mergeSpotifyAccountLibrary = ({ playlists = [], albums = [] } = {}) => {
    const seen = new Set();
    const out = [];
    for (const item of [...playlists, ...albums]) {
        const id = String(item?.id || '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(item);
    }
    return out;
};

export const buildSavedItemAddBody = (playlist) => ({
    search: String(playlist?.search || '').trim(),
    ...(playlist?.userId ? { user_id: String(playlist.userId) } : {}),
});

export const importSavedItemsFromSpotifyLink = async ({
    search,
    userId = '',
    postSavedItem,
    listSavedItems,
    fetchArtist,
    fetchArtistAlbums,
    fetchTrack,
    albumLimit = ARTIST_ALBUM_IMPORT_LIMIT,
} = {}) => {
    if (typeof postSavedItem !== 'function') throw new Error('Saved-item writer is missing.');
    const resolved = await resolveSpotifyLinkImports(search, {
        fetchArtist,
        fetchArtistAlbums,
        fetchTrack,
        albumLimit,
    });
    const addedIds = [];
    const skippedIds = [];
    const errors = [];
    for (const entry of resolved.searches) {
        try {
            await postSavedItem({
                search: entry.search,
                ...(userId ? { user_id: String(userId) } : {}),
            });
            addedIds.push(entry.id);
        } catch (error) {
            if (isAlreadyAddedError(error?.message)) skippedIds.push(entry.id);
            else errors.push(error);
        }
    }
    if (!addedIds.length && !skippedIds.length) {
        throw errors[0] || new Error('Could not save that Spotify link.');
    }
    const items = typeof listSavedItems === 'function' ? asItemArray(await listSavedItems()) : [];
    return {
        ok: true,
        kind: resolved.kind,
        title: resolved.title,
        items,
        addedIds,
        skippedIds,
        syncIds: [...addedIds, ...skippedIds],
        failed: errors.length,
        message: summarizeSpotifyLinkImport({
            kind: resolved.kind,
            title: resolved.title,
            addedIds,
            skippedIds,
        }),
    };
};
