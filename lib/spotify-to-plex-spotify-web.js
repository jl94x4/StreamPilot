const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com';
/** Spotify `/v1/search` now 400s with "Invalid limit" above 10 (docs still say 50). */
export const SPOTIFY_SEARCH_LIMIT = 10;

export const createSpotifyWebClient = ({
    clientId,
    clientSecret,
    fetchImpl = fetch,
    now = () => Date.now(),
} = {}) => {
    const id = String(clientId || '').trim();
    const secret = String(clientSecret || '').trim();
    if (!id || !secret) throw new Error('Spotify API client id and secret are required.');

    let accessToken = '';
    let expiresAt = 0;

    const getAccessToken = async () => {
        if (accessToken && now() < expiresAt - 15_000) return accessToken;
        const basic = Buffer.from(`${id}:${secret}`).toString('base64');
        const response = await fetchImpl(TOKEN_URL, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${basic}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: 'grant_type=client_credentials',
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.access_token) {
            const error = new Error(data?.error_description || data?.error || 'Spotify token request failed.');
            error.status = response.status || 502;
            throw error;
        }
        accessToken = String(data.access_token);
        expiresAt = now() + (Number(data.expires_in) || 3600) * 1000;
        return accessToken;
    };

    const apiGet = async (path) => {
        const token = await getAccessToken();
        const url = `${API_BASE}${String(path || '').startsWith('/') ? path : `/${path}`}`;
        const response = await fetchImpl(url, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(data?.error?.message || data?.error || `Spotify HTTP ${response.status}`);
            error.status = response.status;
            throw error;
        }
        return data;
    };

    const getArtist = (artistId) => apiGet(`/v1/artists/${encodeURIComponent(artistId)}`);

    const getTrack = (trackId) => apiGet(`/v1/tracks/${encodeURIComponent(trackId)}`);

    const getArtistAlbums = async (artistId, { limit = 50, maxPages = 4 } = {}) => {
        const albums = [];
        const pageSize = Math.min(50, Math.max(1, Number(limit) || 50));
        const pages = Math.max(1, Number(maxPages) || 4);
        for (let page = 0; page < pages; page += 1) {
            const offset = page * pageSize;
            const data = await apiGet(
                `/v1/artists/${encodeURIComponent(artistId)}/albums?include_groups=album,single&limit=${pageSize}&offset=${offset}`,
            );
            const items = Array.isArray(data?.items) ? data.items : [];
            albums.push(...items);
            if (items.length < pageSize) break;
            if (Number.isFinite(Number(data?.total)) && albums.length >= Number(data.total)) break;
        }
        return albums;
    };

    const searchPlaylists = async (query, { limit = SPOTIFY_SEARCH_LIMIT } = {}) => {
        const q = String(query || '').trim();
        if (!q) return [];
        const pageSize = Math.min(SPOTIFY_SEARCH_LIMIT, Math.max(1, Number(limit) || SPOTIFY_SEARCH_LIMIT));
        const terms = /\bowner:/i.test(q) ? [q] : [q, `${q} owner:spotify`];
        const pages = await Promise.all(terms.map((term) => (
            apiGet(`/v1/search?q=${encodeURIComponent(term)}&type=playlist&limit=${pageSize}`)
        )));
        const seen = new Set();
        const out = [];
        for (const page of pages) {
            const items = Array.isArray(page?.playlists?.items) ? page.playlists.items : [];
            for (const item of items) {
                const id = String(item?.id || '').trim();
                if (!id || seen.has(id)) continue;
                seen.add(id);
                out.push(item);
            }
        }
        return out;
    };

    return { getAccessToken, apiGet, getArtist, getTrack, getArtistAlbums, searchPlaylists };
};
