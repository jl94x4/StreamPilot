/**
 * Slim Servarr catalog rows kept in RAM for Discover / availability matching.
 * Full /api/v3/movie and /api/v3/series payloads include images, file graphs, and
 * nested metadata that balloon RSS on large libraries.
 */

const leanAlternateTitles = (raw = []) => {
    if (!Array.isArray(raw) || !raw.length) return [];
    const out = [];
    for (const alt of raw) {
        const title = String(alt?.title || alt?.sceneName || (typeof alt === 'string' ? alt : '') || '').trim();
        if (!title) continue;
        out.push({
            title,
            sceneName: alt?.sceneName ? String(alt.sceneName) : undefined,
        });
        if (out.length >= 24) break;
    }
    return out;
};

const leanSeason = (season = {}) => {
    const seasonNumber = Number(season?.seasonNumber);
    if (!Number.isFinite(seasonNumber)) return null;
    const stats = season?.statistics || {};
    return {
        seasonNumber,
        monitored: season?.monitored !== false,
        statistics: {
            episodeFileCount: Number(stats.episodeFileCount) || 0,
            episodeCount: Number(stats.episodeCount) || 0,
            totalEpisodeCount: Number(stats.totalEpisodeCount) || 0,
            percentOfEpisodes: Number(stats.percentOfEpisodes) || 0,
        },
    };
};

/** Radarr movie → fields needed for badge matching + cache snapshots. */
export const leanRadarrMovie = (movie = {}) => {
    if (!movie || typeof movie !== 'object') return null;
    const hasFile = movie.hasFile === true
        || Number(movie.movieFileId) > 0
        || !!(movie.movieFile && (movie.movieFile.id || movie.movieFile.relativePath));
    return {
        id: Number(movie.id) || null,
        tmdbId: Number(movie.tmdbId) || 0,
        imdbId: movie.imdbId ? String(movie.imdbId) : '',
        title: String(movie.title || ''),
        originalTitle: movie.originalTitle ? String(movie.originalTitle) : '',
        year: Number(movie.year) || 0,
        releaseDate: movie.releaseDate ? String(movie.releaseDate) : '',
        hasFile,
        movieFileId: Number(movie.movieFileId) || 0,
    };
};

/** Sonarr series → fields needed for catalog indexes + list-path status. */
export const leanSonarrSeries = (series = {}) => {
    if (!series || typeof series !== 'object') return null;
    const stats = series.statistics || {};
    const seasons = Array.isArray(series.seasons)
        ? series.seasons.map(leanSeason).filter(Boolean)
        : [];
    return {
        id: Number(series.id) || null,
        tmdbId: Number(series.tmdbId) || 0,
        tvdbId: Number(series.tvdbId) || 0,
        title: String(series.title || ''),
        sortTitle: series.sortTitle ? String(series.sortTitle) : '',
        year: Number(series.year) || 0,
        firstAired: series.firstAired ? String(series.firstAired) : '',
        premiereDate: series.premiereDate ? String(series.premiereDate) : '',
        status: series.status ? String(series.status) : '',
        nextAiring: series.nextAiring || null,
        nextAiringUtc: series.nextAiringUtc || null,
        alternateTitles: leanAlternateTitles(series.alternateTitles),
        statistics: {
            episodeFileCount: Number(stats.episodeFileCount) || 0,
            episodeCount: Number(stats.episodeCount) || 0,
            totalEpisodeCount: Number(stats.totalEpisodeCount) || 0,
            percentOfEpisodes: Number(stats.percentOfEpisodes) || 0,
        },
        seasons,
    };
};

/** Lidarr artist → fields needed for music availability badges. */
export const leanLidarrArtist = (artist = {}) => {
    if (!artist || typeof artist !== 'object') return null;
    const stats = artist.statistics || {};
    return {
        id: Number(artist.id) || null,
        foreignArtistId: artist.foreignArtistId ? String(artist.foreignArtistId) : '',
        statistics: {
            trackFileCount: Number(stats.trackFileCount) || 0,
            albumCount: Number(stats.albumCount) || 0,
            totalAlbumCount: Number(stats.totalAlbumCount) || 0,
        },
    };
};

export const leanRadarrMovieList = (list = []) => (
    (Array.isArray(list) ? list : []).map(leanRadarrMovie).filter(Boolean)
);

export const leanSonarrSeriesList = (list = []) => (
    (Array.isArray(list) ? list : []).map(leanSonarrSeries).filter(Boolean)
);

export const leanLidarrArtistList = (list = []) => (
    (Array.isArray(list) ? list : []).map(leanLidarrArtist).filter(Boolean)
);

export default {
    leanRadarrMovie,
    leanSonarrSeries,
    leanLidarrArtist,
    leanRadarrMovieList,
    leanSonarrSeriesList,
    leanLidarrArtistList,
};
