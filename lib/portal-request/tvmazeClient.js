/**
 * TVmaze public API client (no key). Used as Metadata Fill fallback.
 * https://www.tvmaze.com/api — CC BY-SA; identify with a clear User-Agent.
 */

const TVMAZE_API_BASE = 'https://api.tvmaze.com';

const stripHtml = (value) => {
    let text = String(value || '');
    // Repeat until stable so nested/partial tags cannot survive one pass.
    for (let i = 0; i < 5; i += 1) {
        const next = text
            .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
            .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n')
            .replace(/<\/?[a-z][^>]*>/gi, '');
        if (next === text) break;
        text = next;
    }
    return text
        .replace(/&nbsp;/gi, ' ')
        .replace(/&quot;/gi, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
};

/**
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 */
export const createTvmazeClient = ({ fetchImpl = fetch } = {}) => {
    const headers = {
        Accept: 'application/json',
        'User-Agent': 'StreamPilot-MetadataFill/1.0 (+https://github.com/jl94x4/StreamPilot)',
    };

    const getJson = async (path) => {
        const res = await fetchImpl(`${TVMAZE_API_BASE}${path}`, { headers });
        if (res.status === 404) return null;
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            const err = new Error(`TVmaze HTTP ${res.status}: ${body.slice(0, 160)}`);
            err.status = res.status;
            throw err;
        }
        return res.json();
    };

    /**
     * Resolve TVmaze show id from TVDB and/or IMDb.
     * @returns {Promise<number|null>}
     */
    const lookupShowId = async ({ tvdbId = null, imdbId = null } = {}) => {
        const tvdb = Number(tvdbId);
        if (Number.isFinite(tvdb) && tvdb > 0) {
            const show = await getJson(`/lookup/shows?thetvdb=${encodeURIComponent(tvdb)}`).catch(() => null);
            const id = Number(show?.id);
            if (Number.isFinite(id) && id > 0) return id;
        }
        const imdb = String(imdbId || '').trim();
        if (/^tt\d+$/i.test(imdb)) {
            const show = await getJson(`/lookup/shows?imdb=${encodeURIComponent(imdb)}`).catch(() => null);
            const id = Number(show?.id);
            if (Number.isFinite(id) && id > 0) return id;
        }
        return null;
    };

    /**
     * Episode by TVmaze show id + season + episode number.
     * @returns {Promise<{ title: string|null, summary: string|null, originallyAvailableAt: string|null, source: string }|null>}
     */
    const getEpisodeByShowId = async (showId, seasonNumber, episodeNumber) => {
        const id = Number(showId);
        const season = Number(seasonNumber);
        const episode = Number(episodeNumber);
        if (!Number.isFinite(id) || id <= 0) return null;
        if (!Number.isFinite(season) || !Number.isFinite(episode)) return null;

        const raw = await getJson(
            `/shows/${id}/episodebynumber?season=${encodeURIComponent(season)}&number=${encodeURIComponent(episode)}`,
        ).catch(() => null);
        if (!raw) return null;

        const airdate = String(raw.airdate || '').trim().slice(0, 10);
        return {
            title: String(raw.name || '').trim() || null,
            summary: stripHtml(raw.summary) || null,
            originallyAvailableAt: /^\d{4}-\d{2}-\d{2}$/.test(airdate) ? airdate : null,
            seasonNumber: season,
            episodeNumber: episode,
            source: 'tvmaze',
            raw,
        };
    };

    /**
     * @param {{ tvdbId?: string|number|null, imdbId?: string|null, seasonNumber: number, episodeNumber: number }} ids
     */
    const getEpisode = async (ids = {}) => {
        const showId = await lookupShowId({ tvdbId: ids.tvdbId, imdbId: ids.imdbId });
        if (!showId) return null;
        return getEpisodeByShowId(showId, ids.seasonNumber, ids.episodeNumber);
    };

    return {
        enabled: true,
        lookupShowId,
        getEpisodeByShowId,
        getEpisode,
        stripHtml,
    };
};

export default createTvmazeClient;
