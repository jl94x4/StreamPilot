import path from 'path';
import { createRewriter } from '../rewrite.js';
import { normalizeArrServiceKind } from '../../arr-notify-identity.js';

const posixDir = (...parts) => {
    const joined = path.posix.join(...parts.map((p) => String(p || '').replace(/\\/g, '/')));
    return joined;
};

const collectSonarrEpisodeFiles = (event = {}) => ([
    ...(Array.isArray(event.episodeFiles) ? event.episodeFiles : []),
    ...(Array.isArray(event.EpisodeFiles) ? event.EpisodeFiles : []),
    ...(event.episodeFile ? [event.episodeFile] : []),
    ...(event.EpisodeFile ? [event.EpisodeFile] : []),
    ...(Array.isArray(event.deletedFiles) ? event.deletedFiles : []),
    ...(Array.isArray(event.DeletedFiles) ? event.DeletedFiles : []),
]);

/**
 * @param {object} event Sonarr webhook body
 * @returns {string[]} folder paths (before rewrite)
 */
export const pathsFromSonarrEvent = (event) => {
    const type = String(event?.eventType || event?.EventType || '');
    if (/^test$/i.test(type)) return [];

    const seriesPath = event?.series?.path || event?.series?.Path;
    const destinationPath = event?.destinationPath || event?.DestinationPath;

    if (/^(Download|EpisodeFileDelete)$/i.test(type)) {
        const folders = collectSonarrEpisodeFiles(event)
            .map((file) => {
                const fullPath = file?.path || file?.Path;
                if (fullPath) return path.posix.dirname(String(fullPath).replace(/\\/g, '/'));
                const rel = file?.relativePath || file?.RelativePath;
                if (rel && seriesPath) return path.posix.dirname(posixDir(seriesPath, rel));
                return '';
            })
            .filter(Boolean);
        if (folders.length) return [...new Set(folders)];
        // Sonarr v4 "On Import Complete" / batch payloads use episodeFiles[].
        // Fall back to destination or series path so a valid import is never dropped.
        if (destinationPath) return [String(destinationPath).replace(/\\/g, '/')];
        if (seriesPath) return [String(seriesPath).replace(/\\/g, '/')];
        throw Object.assign(new Error('Required fields missing'), { status: 400 });
    }
    if (/^SeriesDelete$/i.test(type)) {
        if (!seriesPath) throw Object.assign(new Error('Required fields missing'), { status: 400 });
        return [String(seriesPath).replace(/\\/g, '/')];
    }
    if (/^Rename$/i.test(type)) {
        if (!seriesPath) throw Object.assign(new Error('Required fields missing'), { status: 400 });
        const renamed = event?.renamedEpisodeFiles || event?.RenamedEpisodeFiles || [];
        const seen = new Set();
        const paths = [];
        for (const file of renamed) {
            const previousPath = file.previousPath || file.PreviousPath;
            const relativePath = file.relativePath || file.RelativePath;
            const currentPath = file.path || file.Path;
            if (previousPath) {
                const prev = path.posix.dirname(String(previousPath).replace(/\\/g, '/'));
                if (!seen.has(prev)) { seen.add(prev); paths.push(prev); }
            }
            if (currentPath) {
                const cur = path.posix.dirname(String(currentPath).replace(/\\/g, '/'));
                if (!seen.has(cur)) { seen.add(cur); paths.push(cur); }
            } else if (relativePath) {
                const cur = path.posix.dirname(posixDir(seriesPath, relativePath));
                if (!seen.has(cur)) { seen.add(cur); paths.push(cur); }
            }
        }
        if (paths.length) return paths;
        return [String(seriesPath).replace(/\\/g, '/')];
    }
    return [];
};

/**
 * @param {object} event Radarr webhook body
 */
export const pathsFromRadarrEvent = (event) => {
    const type = String(event?.eventType || event?.EventType || '');
    if (/^test$/i.test(type)) return [];

    const folder = event?.movie?.folderPath || event?.movie?.FolderPath || event?.movie?.path || event?.movie?.Path;
    if (/^(Download|MovieFileDelete)$/i.test(type)) {
        const files = [
            ...(Array.isArray(event.movieFiles) ? event.movieFiles : []),
            ...(Array.isArray(event.MovieFiles) ? event.MovieFiles : []),
            ...(event.movieFile ? [event.movieFile] : []),
            ...(event.MovieFile ? [event.MovieFile] : []),
            ...(Array.isArray(event.deletedFiles) ? event.deletedFiles : []),
            ...(Array.isArray(event.DeletedFiles) ? event.DeletedFiles : []),
        ];
        const folders = files
            .map((file) => {
                const fullPath = file?.path || file?.Path;
                if (fullPath) return path.posix.dirname(String(fullPath).replace(/\\/g, '/'));
                const rel = file?.relativePath || file?.RelativePath;
                if (rel && folder) return path.posix.dirname(posixDir(folder, rel));
                return '';
            })
            .filter(Boolean);
        if (folders.length) return [...new Set(folders)];
        if (folder) return [String(folder).replace(/\\/g, '/')];
        throw Object.assign(new Error('Required fields missing'), { status: 400 });
    }
    if (/^(MovieDelete|Rename)$/i.test(type)) {
        if (!folder) throw Object.assign(new Error('Required fields missing'), { status: 400 });
        return [String(folder).replace(/\\/g, '/')];
    }
    return [];
};

/**
 * Lidarr webhook — mirror Autoscan: track folder from artist + track file.
 * @param {object} event
 */
export const pathsFromLidarrEvent = (event) => {
    const type = String(event?.eventType || event?.EventType || '');
    if (/^test$/i.test(type)) return [];

    if (/^(Download|AlbumDownload|TrackFileDelete|Retag|TrackRetag)$/i.test(type)) {
        const artistPath = event?.artist?.path || event?.artist?.Path;
        const files = [
            ...(Array.isArray(event?.trackFiles) ? event.trackFiles : []),
            ...(Array.isArray(event?.TrackFiles) ? event.TrackFiles : []),
            ...(event?.trackFile ? [event.trackFile] : []),
            ...(event?.TrackFile ? [event.TrackFile] : []),
            ...(Array.isArray(event?.deletedFiles) ? event.deletedFiles : []),
            ...(Array.isArray(event?.DeletedFiles) ? event.DeletedFiles : []),
        ];
        const folders = files
            .map((file) => {
                const fullPath = file?.path || file?.Path;
                if (fullPath) return path.posix.dirname(String(fullPath).replace(/\\/g, '/'));
                const rel = file?.relativePath || file?.RelativePath;
                if (rel && artistPath) return path.posix.dirname(posixDir(artistPath, rel));
                return '';
            })
            .filter(Boolean);
        if (folders.length) return [...new Set(folders)];
        // Current Lidarr imports normally include trackFiles[].path. Fall back to
        // the artist folder for older payloads so a valid import is never dropped.
        if (artistPath) return [String(artistPath).replace(/\\/g, '/')];
        throw Object.assign(new Error('Required Lidarr path fields missing'), { status: 400 });
    }
    if (/^(ArtistDelete|AlbumDelete|Rename)$/i.test(type)) {
        const artistPath = event?.artist?.path || event?.artist?.Path;
        if (!artistPath) throw Object.assign(new Error('Required fields missing'), { status: 400 });
        return [String(artistPath).replace(/\\/g, '/')];
    }
    return [];
};

/**
 * Classify an ARR webhook into a human-readable reason for queue/activity UI.
 * @param {'sonarr'|'radarr'|'lidarr'|string} kind
 * @param {object} event
 */
export const classifyArrEvent = (kind, event = {}) => {
    const eventType = String(event?.eventType || event?.EventType || '');
    const isUpgrade = !!(event?.isUpgrade ?? event?.IsUpgrade);
    let action = 'refresh';
    let reason = eventType || 'Library refresh';

    if (/^(Download|AlbumDownload)$/i.test(eventType)) {
        if (isUpgrade) {
            action = 'upgrade';
            reason = 'Upgrade';
        } else {
            action = 'import';
            reason = 'Import';
        }
    } else if (/^Grab$/i.test(eventType)) {
        action = 'grab';
        reason = 'Grab';
    } else if (/^ApplicationUpdate$/i.test(eventType)) {
        action = 'app-update';
        reason = 'Application update';
    } else if (/^ManualInteractionRequired$/i.test(eventType)) {
        action = 'manual-interaction';
        reason = extractArrDownloadStatusMessage(event) || 'Manual interaction required';
    } else if (/^(EpisodeFileDelete|MovieFileDelete|TrackFileDelete)$/i.test(eventType)) {
        action = 'file-delete';
        reason = 'File deleted';
    } else if (/^SeriesDelete$/i.test(eventType)) {
        action = 'series-delete';
        reason = 'Series deleted';
    } else if (/^MovieDelete$/i.test(eventType)) {
        action = 'movie-delete';
        reason = 'Movie deleted';
    } else if (/^ArtistDelete$/i.test(eventType)) {
        action = 'artist-delete';
        reason = 'Artist deleted';
    } else if (/^AlbumDelete$/i.test(eventType)) {
        action = 'album-delete';
        reason = 'Album deleted';
    } else if (/^Rename$/i.test(eventType)) {
        action = 'rename';
        reason = 'Rename';
    } else if (/^(Retag|TrackRetag)$/i.test(eventType)) {
        action = 'retag';
        reason = 'Track retagged';
    } else if (/^Test$/i.test(eventType)) {
        action = 'test';
        reason = 'Test';
    }

    let title = '';
    const k = String(kind || '').toLowerCase();
    if (k === 'sonarr') {
        title = String(event?.series?.title || event?.series?.Title || '').trim();
        const ep = event?.episodes?.[0] || event?.Episodes?.[0];
        if (ep) {
            const sn = ep.seasonNumber ?? ep.SeasonNumber;
            const en = ep.episodeNumber ?? ep.EpisodeNumber;
            const epTitle = ep.title || ep.Title;
            if (sn != null && en != null) {
                title = `${title || 'Episode'} · S${String(sn).padStart(2, '0')}E${String(en).padStart(2, '0')}${epTitle ? ` - ${epTitle}` : ''}`;
            }
        }
    } else if (k === 'radarr') {
        title = String(event?.movie?.title || event?.movie?.Title || '').trim();
        const year = event?.movie?.year || event?.movie?.Year;
        if (title && year) title = `${title} (${year})`;
    } else if (k === 'lidarr') {
        title = String(event?.artist?.name || event?.artist?.Name || '').trim();
        const album = event?.album?.title || event?.albums?.[0]?.title;
        if (title && album) title = `${title} · ${album}`;
    }

    if (action === 'app-update') {
        title = formatArrApplicationUpdateTitle(kind, event);
    }

    const firstEpisodeFile = event?.episodeFiles?.[0] || event?.EpisodeFiles?.[0] || event?.episodeFile || event?.EpisodeFile;
    const firstMovieFile = event?.movieFiles?.[0] || event?.MovieFiles?.[0] || event?.movieFile || event?.MovieFile;
    const release = event.release || event.Release || {};
    const filename = extractArrReleaseFilename(event);
    const quality =
        firstEpisodeFile?.quality?.quality?.name
        || firstEpisodeFile?.quality
        || firstEpisodeFile?.Quality
        || firstMovieFile?.quality?.quality?.name
        || firstMovieFile?.quality
        || firstMovieFile?.Quality
        || event?.trackFile?.quality?.quality?.name
        || event?.trackFiles?.[0]?.quality
        || event?.TrackFiles?.[0]?.Quality
        || event?.trackFile?.quality
        || event?.TrackFile?.Quality
        || firstEpisodeFile?.quality?.Quality?.Name
        || firstMovieFile?.quality?.Quality?.Name
        || qualityName(release.quality || release.Quality)
        || '';

    const artwork = extractArrWebhookArtwork(kind, event);

    return {
        eventType,
        action,
        reason,
        isUpgrade,
        title: title || undefined,
        filename: filename || undefined,
        quality: quality ? String(quality) : undefined,
        instanceName: extractArrInstanceName(kind, event),
        serviceKind: normalizeArrServiceKind(kind, extractArrInstanceName(kind, event)),
        mediaType: artwork.mediaType,
        tmdbId: artwork.tmdbId,
        tvdbId: artwork.tvdbId,
        posterUrl: artwork.posterUrl,
    };
};

/** Arr instance name from the webhook, falling back to Sonarr / Radarr / Lidarr. */
export const extractArrInstanceName = (kind, event = {}) => {
    const named = String(event.instanceName || event.InstanceName || '').trim();
    if (named) return named;
    const k = String(kind || '').toLowerCase();
    if (k === 'radarr') return 'Radarr';
    if (k === 'lidarr') return 'Lidarr';
    if (k === 'sonarr') return 'Sonarr';
    return 'Scanner';
};

const firstHttpUrl = (...values) => {
    for (const value of values) {
        const raw = String(value || '').trim();
        if (/^https?:\/\//i.test(raw)) return raw;
    }
    return '';
};

export const isPublicArtworkUrl = (url = '') => {
    const raw = String(url || '').trim();
    if (!/^https?:\/\//i.test(raw)) return false;
    if (/\/mediacover\//i.test(raw)) return false;
    try {
        const host = new URL(raw).hostname.toLowerCase();
        if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') return false;
        if (/(^|\.)(sonarr|radarr|lidarr)(\d*)?(\.|$)/i.test(host) && !/(tmdb|thetvdb|fanart|servarr|coverartarchive)/i.test(host)) {
            return false;
        }
    } catch {
        return false;
    }
    return true;
};

const imageList = (entity = {}) => {
    if (Array.isArray(entity.images)) return entity.images;
    if (Array.isArray(entity.Images)) return entity.Images;
    return [];
};

/** Pull series/movie/artist poster + ids from an ARR webhook payload. */
export const extractArrWebhookArtwork = (kind, event = {}) => {
    const k = String(kind || '').toLowerCase();
    let entity = {};
    let mediaType = 'tv';
    if (k === 'radarr') {
        entity = event.movie || event.Movie || {};
        mediaType = 'movie';
    } else if (k === 'lidarr') {
        entity = event.artist || event.Artist || {};
        mediaType = 'music';
    } else {
        entity = event.series || event.Series || {};
        mediaType = 'tv';
    }
    const album = k === 'lidarr' ? (event.album || event.Album || {}) : {};
    const images = imageList(entity).length ? imageList(entity) : imageList(album);
    const coverType = (img) => String(img?.coverType || img?.CoverType || '').toLowerCase();
    const poster = images.find((img) => coverType(img) === 'poster')
        || images.find((img) => coverType(img) === 'cover')
        || images.find((img) => firstHttpUrl(img?.remoteUrl, img?.RemoteUrl, img?.url, img?.Url))
        || null;
    const posterUrl = firstHttpUrl(poster?.remoteUrl, poster?.RemoteUrl, poster?.url, poster?.Url);
    const tmdbRaw = entity.tmdbId ?? entity.TmdbId ?? entity.tmdbID;
    const tvdbRaw = entity.tvdbId ?? entity.TvdbId ?? entity.tvDbId;
    const tmdbId = Number(tmdbRaw);
    const tvdbId = Number(tvdbRaw);
    return {
        mediaType,
        posterUrl: isPublicArtworkUrl(posterUrl) ? posterUrl : undefined,
        tmdbId: Number.isFinite(tmdbId) && tmdbId > 0 ? tmdbId : undefined,
        tvdbId: Number.isFinite(tvdbId) && tvdbId > 0 ? tvdbId : undefined,
    };
};

const DELETE_ACTIONS = new Set([
    'file-delete',
    'series-delete',
    'movie-delete',
    'artist-delete',
    'album-delete',
]);

/** Map a classified ARR action to a Settings → Notifications scanner event. */
export const scannerActivityNotifyEvent = (action) => {
    const value = String(action || '');
    if (value === 'grab') return 'scanner_grab';
    if (value === 'import') return 'scanner_import';
    if (value === 'upgrade') return 'scanner_upgrade';
    if (value === 'app-update') return 'scanner_update';
    if (value === 'manual-interaction') return 'scanner_interaction';
    if (DELETE_ACTIONS.has(value)) return 'scanner_deleted';
    return null;
};

export const PATHLESS_SCANNER_SUCCESS_ACTIONS = new Set(['grab', 'app-update', 'manual-interaction']);

export const isPathlessScannerSuccessAction = (action) => (
    PATHLESS_SCANNER_SUCCESS_ACTIONS.has(String(action || ''))
);

export const isScannerActivityNotifyEnabled = (config = {}, event = '') => {
    if (event === 'scanner_grab') return config.scannerNotifyGrab === true;
    if (event === 'scanner_import') return config.scannerNotifyImport === true;
    if (event === 'scanner_upgrade') return config.scannerNotifyUpgrade === true;
    if (event === 'scanner_deleted') return config.scannerNotifyDeleted === true;
    if (event === 'scanner_update') return config.scannerNotifyUpdate === true;
    if (event === 'scanner_interaction') return config.scannerNotifyInteraction === true;
    return false;
};

const qualityName = (quality) => {
    if (quality == null || quality === '') return '';
    if (typeof quality === 'string' || typeof quality === 'number') return String(quality).trim();
    if (typeof quality === 'object') {
        const name = quality.quality?.name || quality.Quality?.Name || quality.name || quality.Name;
        return name ? String(name).trim() : '';
    }
    return '';
};

const formatArrApplicationUpdateTitle = (kind, event = {}) => {
    const k = String(kind || '').toLowerCase();
    const instance = String(event.instanceName || event.InstanceName || '').trim()
        || (k === 'radarr' ? 'Radarr' : k === 'lidarr' ? 'Lidarr' : 'Sonarr');
    const previous = String(event.previousVersion || event.PreviousVersion || '').trim();
    const next = String(
        event.newVersion || event.NewVersion || event.currentVersion || event.CurrentVersion || '',
    ).trim();
    const message = String(event.message || event.Message || '').trim();
    if (message) return message;
    if (previous && next) return `${instance} ${previous} → ${next}`;
    if (next) return `${instance} ${next}`;
    return instance;
};

const extractArrDownloadStatusMessage = (event = {}) => {
    const items = [
        ...(Array.isArray(event.downloadStatusMessages) ? event.downloadStatusMessages : []),
        ...(Array.isArray(event.DownloadStatusMessages) ? event.DownloadStatusMessages : []),
    ];
    for (const item of items) {
        const messages = item?.messages || item?.Messages || [];
        for (const message of messages) {
            const text = String(message || '').trim();
            if (text) return text;
        }
    }
    return String(event.downloadStatus || event.DownloadStatus || '').trim();
};

/** NZB/torrent name from a Sonarr/Radarr/Lidarr Grab payload. */
export const extractArrReleaseFilename = (event = {}) => {
    const release = event.release || event.Release || {};
    const downloadInfo = event.downloadInfo || event.DownloadInfo || {};
    const candidates = [
        release.releaseTitle,
        release.ReleaseTitle,
        release.title,
        release.Title,
        downloadInfo.title,
        downloadInfo.Title,
        event.releaseTitle,
        event.ReleaseTitle,
    ];
    for (const value of candidates) {
        const name = String(value || '').trim();
        if (name) return name;
    }
    return '';
};

/** Compact title for scanner push/in-app copy: `Show · S01E01 - Episode [HDTV-1080p]`. */
export const formatScannerNotifyTitle = (meta = {}, scan = null) => {
    const name = String(meta.title || '').trim().replace(/\s+[—–]\s+/g, ' - ');
    const quality = qualityName(meta.quality);
    if (name && quality) return `${name} [${quality}]`;
    if (name) return name;
    const fallback = String(scan?.folder || meta.reason || 'Library item').trim();
    return fallback || 'Library item';
};

export const buildScansFromPaths = (paths, {
    priority = 0,
    source = 'trigger',
    rewrite = [],
    eventType,
    action,
    reason,
    title,
    quality,
    isUpgrade,
} = {}) => {
    const rewriter = createRewriter(rewrite);
    const now = new Date().toISOString();
    return (paths || [])
        .map((p) => String(p || '').trim())
        .filter(Boolean)
        .map((folder) => ({
            folder: rewriter(folder),
            priority: Number(priority) || 0,
            time: now,
            source,
            eventType: eventType || undefined,
            action: action || undefined,
            reason: reason || undefined,
            title: title || undefined,
            quality: quality || undefined,
            isUpgrade: !!isUpgrade || undefined,
        }));
};
