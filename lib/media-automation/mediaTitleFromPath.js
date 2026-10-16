/**
 * Guess a show/movie title from a Media Automation source path so job
 * notifications can look up a TMDB poster.
 */

const VIDEO_EXT = /\.(mkv|mp4|avi|m4v|mov|wmv|ts|m2ts|webm)$/i;
const YEAR_RE = /\b((?:19|20)\d{2})\b/;
const SEASON_FOLDER_RE = /^(?:season|series|specials)[\s._-]*(\d{0,2})$/i;
const SCENE_TAGS_RE = /\b(?:\d{3,4}p|4k|8k|uhd|sdr|hdr(?:10)?|dv|dolby|vision|web[- ]?dl|webrip|bluray|blu[- ]?ray|hdtv|hdrip|dvdrip|remux|x264|x265|h264|h265|hevc|av1|aac|ac3|eac3|dts(?:[- ]?hd)?|truehd|atmos|10bit|8bit|proper|repack|internal|extended|unrated|directors?[- ]?cut|multi|dual|audio|nf|amzn|dsnp|hulu|atvp|imax)\b/ig;

const firstNonEmpty = (...values) => {
    for (const value of values) {
        const text = String(value || '').trim();
        if (text) return text;
    }
    return '';
};

export const cleanMediaTitle = (value = '') => String(value || '')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/[._]+/g, ' ')
    .replace(SCENE_TAGS_RE, ' ')
    .replace(/[-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const pathParts = (filePath = '') => String(filePath || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);

const stemFromBasename = (basename = '') => {
    const name = String(basename || '');
    return VIDEO_EXT.test(name) ? name.replace(VIDEO_EXT, '') : name.replace(/\.[^.]+$/, '');
};

const yearFrom = (value = '') => {
    const match = YEAR_RE.exec(String(value || ''));
    return match ? match[1] : '';
};

const titleWithoutYear = (value = '') => cleanMediaTitle(
    String(value || '').replace(YEAR_RE, ' '),
);

const folderTitle = (parts = []) => {
    if (parts.length < 2) return '';
    const parent = parts[parts.length - 2] || '';
    if (SEASON_FOLDER_RE.test(parent) && parts.length >= 3) {
        return titleWithoutYear(parts[parts.length - 3]);
    }
    return titleWithoutYear(parent);
};

export const parseMediaTitleFromPath = (filePath = '') => {
    const parts = pathParts(filePath);
    const basename = parts[parts.length - 1] || String(filePath || '').replace(/\\/g, '/').split('/').pop() || '';
    const stem = stemFromBasename(basename);
    const folder = folderTitle(parts);
    const year = yearFrom(stem) || yearFrom(folder) || yearFrom(parts[parts.length - 3] || '');

    const episodeMatch = /^(.*?)[\s._-]*[Ss](\d{1,2})[Ee](\d{1,3})(?:\b|[\s._-])/.exec(stem)
        || /^(.*?)[\s._-]*(\d{1,2})x(\d{1,3})\b/.exec(stem);
    if (episodeMatch) {
        const fromFile = titleWithoutYear(episodeMatch[1]);
        return {
            mediaType: 'tv',
            title: fromFile || folder,
            year: yearFrom(episodeMatch[1]) || year,
            seasonNumber: Number(episodeMatch[2]),
            episodeNumber: Number(episodeMatch[3]),
        };
    }

    const parent = parts[parts.length - 2] || '';
    const seasonFolder = SEASON_FOLDER_RE.exec(parent);
    if (seasonFolder) {
        const seasonNumber = seasonFolder[1] ? Number(seasonFolder[1]) : null;
        return {
            mediaType: 'tv',
            title: folder || titleWithoutYear(stem),
            year,
            seasonNumber: Number.isFinite(seasonNumber) ? seasonNumber : null,
            episodeNumber: null,
        };
    }

    return {
        mediaType: 'movie',
        title: titleWithoutYear(stem) || folder,
        year,
        seasonNumber: null,
        episodeNumber: null,
    };
};

/** Compact size label for activity / push copy (e.g. "800 MB"). */
export const formatBytesLabel = (value) => {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 ** 2) {
        const kb = bytes / 1024;
        return `${kb >= 10 ? Math.round(kb) : kb.toFixed(1)} KB`;
    }
    if (bytes < 1024 ** 3) {
        const mb = bytes / (1024 ** 2);
        return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
    }
    const gb = bytes / (1024 ** 3);
    return `${gb >= 10 ? gb.toFixed(1) : gb.toFixed(2)} GB`;
};

export const buildCompletedJobMessage = (fileName, outputBytes) => {
    const name = String(fileName || '').trim() || 'media';
    const label = formatBytesLabel(outputBytes);
    return label ? `Completed ${name} [${label}]` : `Completed ${name}`;
};

export const sourcePathFromJobActivity = (entry = {}) => {
    const data = entry?.data && typeof entry.data === 'object' ? entry.data : {};
    const fromData = firstNonEmpty(data.sourcePath, data.output, data.deliveredPath);
    if (fromData) return fromData;
    const message = String(entry?.message || '');
    const match = /^(?:Completed|Dry-run planned|Started|Queued|Kept original)\s+(.+)$/i.exec(message);
    if (!match) return '';
    let name = String(match[1] || '').trim();
    // Drop trailing output-size tag from completed copy: " [800 MB]"
    name = name.replace(/\s+\[[\d.]+\s*[KMGT]?B\]\s*$/i, '').trim();
    // Drop trailing notes like " (pipeline output mode is Dry run)"
    const parenIdx = name.search(/\s+\(/);
    if (parenIdx >= 0) name = name.slice(0, parenIdx).trim();
    return name;
};

export const resolveJobNotifySourcePath = async (entry = {}, getJob) => {
    const fromEntry = sourcePathFromJobActivity(entry);
    if (fromEntry) return fromEntry;
    const jobId = entry?.jobId;
    if (!jobId || typeof getJob !== 'function') return '';
    try {
        const job = await getJob(jobId);
        return firstNonEmpty(job?.sourcePath, job?.path);
    } catch {
        return '';
    }
};

export default parseMediaTitleFromPath;
