/**
 * Minimal TheTVDB API v4 client for Discover poster fallbacks.
 * Requires config.tvdbApiKey (same key used by Settings → Test TVDB).
 */

const TVDB_API_BASE = 'https://api4.thetvdb.com/v4';
const TVDB_ARTWORKS_BASE = 'https://artworks.thetvdb.com';
/** Series poster artwork type id (see /artwork/types). */
const SERIES_POSTER_TYPE = 2;
const TOKEN_TTL_MS = 25 * 24 * 60 * 60 * 1000;
const POSTER_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MISS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** @type {{ key: string, token: string, at: number } | null} */
let tokenCache = null;
/** @type {Map<number, { at: number, url: string | null }>} */
const posterByTvdbId = new Map();
const POSTER_CACHE_MAX_ENTRIES = 500;

const prunePosterCache = () => {
    const t = now();
    for (const [key, entry] of posterByTvdbId.entries()) {
        if (!entry) {
            posterByTvdbId.delete(key);
            continue;
        }
        const ttl = entry.url ? POSTER_CACHE_TTL_MS : MISS_CACHE_TTL_MS;
        if (t - entry.at >= ttl) posterByTvdbId.delete(key);
    }
    while (posterByTvdbId.size > POSTER_CACHE_MAX_ENTRIES) {
        const oldest = posterByTvdbId.keys().next().value;
        if (oldest === undefined) break;
        posterByTvdbId.delete(oldest);
    }
};

const now = () => Date.now();

const absoluteArtworkUrl = (image) => {
    const raw = String(image || '').trim();
    if (!raw) return null;
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    if (raw.startsWith('/')) return `${TVDB_ARTWORKS_BASE}${raw}`;
    return `${TVDB_ARTWORKS_BASE}/${raw.replace(/^banners\//, 'banners/')}`;
};

const pickBestPoster = (artworks = []) => {
    const list = Array.isArray(artworks) ? artworks : [];
    const posters = list.filter((art) => {
        const type = Number(art?.type);
        if (Number.isFinite(type) && type > 0 && type !== SERIES_POSTER_TYPE) return false;
        const w = Number(art?.width) || 0;
        const h = Number(art?.height) || 0;
        // Prefer portrait / square poster shapes when dimensions exist.
        if (w > 0 && h > 0 && w > h * 1.15) return false;
        return !!(art?.image || art?.thumbnail);
    });
    const ranked = (posters.length ? posters : list)
        .filter((art) => art?.image || art?.thumbnail)
        .slice()
        .sort((a, b) => (Number(b?.score) || 0) - (Number(a?.score) || 0));
    const best = ranked[0];
    return absoluteArtworkUrl(best?.image || best?.thumbnail);
};

export const createTvdbClient = (config = {}, { fetchImpl = fetch } = {}) => {
    const apiKey = String(config?.tvdbApiKey || '').trim();

    const getToken = async () => {
        if (!apiKey) return null;
        if (tokenCache && tokenCache.key === apiKey && now() - tokenCache.at < TOKEN_TTL_MS) {
            return tokenCache.token;
        }
        const loginRes = await fetchImpl(`${TVDB_API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ apikey: apiKey }),
        });
        if (!loginRes.ok) return null;
        const payload = await loginRes.json().catch(() => null);
        const token = String(payload?.data?.token || '').trim();
        if (!token) return null;
        tokenCache = { key: apiKey, token, at: now() };
        return token;
    };

    /**
     * @param {number|string} tvdbId
     * @returns {Promise<string|null>} Absolute poster URL or null
     */
    const getSeriesPosterUrl = async (tvdbId) => {
        const id = Number(tvdbId);
        if (!apiKey || !Number.isFinite(id) || id <= 0) return null;

        const cached = posterByTvdbId.get(id);
        if (cached) {
            const ttl = cached.url ? POSTER_CACHE_TTL_MS : MISS_CACHE_TTL_MS;
            if (now() - cached.at < ttl) return cached.url;
            posterByTvdbId.delete(id);
        }

        try {
            const token = await getToken();
            if (!token) {
                posterByTvdbId.set(id, { at: now(), url: null });
                prunePosterCache();
                return null;
            }

            const headers = {
                Accept: 'application/json',
                Authorization: `Bearer ${token}`,
            };

            // Prefer typed poster artworks; fall back to series default image.
            const artRes = await fetchImpl(
                `${TVDB_API_BASE}/series/${id}/artworks?type=${SERIES_POSTER_TYPE}`,
                { headers },
            );
            if (artRes.ok) {
                const artPayload = await artRes.json().catch(() => null);
                const artList = Array.isArray(artPayload?.data)
                    ? artPayload.data
                    : (artPayload?.data?.artworks || []);
                const fromArt = pickBestPoster(artList);
                if (fromArt) {
                    posterByTvdbId.set(id, { at: now(), url: fromArt });
                    prunePosterCache();
                    return fromArt;
                }
            }

            const seriesRes = await fetchImpl(`${TVDB_API_BASE}/series/${id}`, { headers });
            if (seriesRes.ok) {
                const seriesPayload = await seriesRes.json().catch(() => null);
                const fromSeries = absoluteArtworkUrl(seriesPayload?.data?.image);
                if (fromSeries) {
                    posterByTvdbId.set(id, { at: now(), url: fromSeries });
                    prunePosterCache();
                    return fromSeries;
                }
            }

            posterByTvdbId.set(id, { at: now(), url: null });
            prunePosterCache();
            return null;
        } catch {
            posterByTvdbId.set(id, { at: now(), url: null });
            prunePosterCache();
            return null;
        }
    };

    /**
     * Episode by series TVDB id + season + episode number.
     * @returns {Promise<{ title: string|null, summary: string|null, originallyAvailableAt: string|null, source: string }|null>}
     */
    const getEpisode = async (tvdbSeriesId, seasonNumber, episodeNumber) => {
        const seriesId = Number(tvdbSeriesId);
        const season = Number(seasonNumber);
        const episode = Number(episodeNumber);
        if (!apiKey || !Number.isFinite(seriesId) || seriesId <= 0) return null;
        if (!Number.isFinite(season) || !Number.isFinite(episode)) return null;

        try {
            const token = await getToken();
            if (!token) return null;
            const headers = {
                Accept: 'application/json',
                Authorization: `Bearer ${token}`,
            };

            // Prefer season-filtered list when the server supports it.
            const seasonUrl = `${TVDB_API_BASE}/series/${seriesId}/episodes/default`
                + `?page=0&season=${encodeURIComponent(season)}`;
            let list = [];
            const seasonRes = await fetchImpl(seasonUrl, { headers });
            if (seasonRes.ok) {
                const payload = await seasonRes.json().catch(() => null);
                list = Array.isArray(payload?.data?.episodes)
                    ? payload.data.episodes
                    : (Array.isArray(payload?.data) ? payload.data : []);
            }

            if (!list.length) {
                // Page through default episodes (cap pages).
                for (let page = 0; page < 20; page += 1) {
                    const pageUrl = `${TVDB_API_BASE}/series/${seriesId}/episodes/default?page=${page}`;
                    const pageRes = await fetchImpl(pageUrl, { headers });
                    if (!pageRes.ok) break;
                    const payload = await pageRes.json().catch(() => null);
                    const rows = Array.isArray(payload?.data?.episodes)
                        ? payload.data.episodes
                        : (Array.isArray(payload?.data) ? payload.data : []);
                    if (!rows.length) break;
                    list = list.concat(rows);
                    const next = payload?.links?.next;
                    if (next == null || next === page) break;
                }
            }

            const match = list.find((row) => {
                const s = Number(row?.seasonNumber ?? row?.season);
                const n = Number(row?.number ?? row?.episodeNumber);
                return s === season && n === episode;
            });
            if (!match) return null;

            const aired = String(match.aired || match.firstAired || match.airDate || '').trim();
            return {
                title: String(match.name || match.episodeName || '').trim() || null,
                summary: String(match.overview || match.summary || '').trim() || null,
                originallyAvailableAt: aired ? aired.slice(0, 10) : null,
                seasonNumber: season,
                episodeNumber: episode,
                source: 'tvdb',
                raw: match,
            };
        } catch {
            return null;
        }
    };

    return {
        enabled: !!apiKey,
        getSeriesPosterUrl,
        getEpisode,
    };
};
