/**
 * Shared path/token helpers for move steps and Sonarr-style delivery naming.
 */

const pad2 = (value) => String(Number(value) || 0).padStart(2, '0');

export const sanitizeFileToken = (value) => String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export const qualityFromProbe = (probe = {}) => {
    const stream = (probe.streams || []).find((entry) => entry.codec_type === 'video') || {};
    const height = Number(stream.height || probe.height || 0);
    if (height >= 2160) return '2160p';
    if (height >= 1080) return '1080p';
    if (height >= 720) return '720p';
    if (height > 0) return `${height}p`;
    return '';
};

export const buildNamingContext = ({
    probe = {},
    sourcePath = '',
    seriesTitle = '',
    movieTitle = '',
    seasonNumber = null,
    episodeNumber = null,
    episodeTitle = '',
    year = '',
} = {}) => {
    const basename = String(sourcePath || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
    const stem = basename.replace(/\.[^.]+$/, '');
    const video = (probe.streams || []).find((entry) => entry.codec_type === 'video') || {};
    const audio = (probe.streams || []).find((entry) => entry.codec_type === 'audio') || {};
    const title = seriesTitle || movieTitle || stem;
    const season = seasonNumber == null ? null : Number(seasonNumber);
    const episode = episodeNumber == null ? null : Number(episodeNumber);
    return {
        n: title,
        title,
        series: seriesTitle || title,
        movie: movieTitle || title,
        s00e00: season != null && episode != null ? `S${pad2(season)}E${pad2(episode)}` : '',
        season: season == null ? '' : pad2(season),
        episode: episode == null ? '' : pad2(episode),
        episodeTitle: episodeTitle || '',
        year: year || '',
        quality: qualityFromProbe(probe),
        videoCodec: String(video.codec_name || probe.videoCodec || ''),
        audioCodec: String(audio.codec_name || probe.audioCodec || ''),
        basename,
        stem,
    };
};

export const applyNamingTemplate = (template, context = {}) => {
    const source = String(template || '{stem}');
    return sanitizeFileToken(source.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
        const value = context[key];
        return value == null ? '' : String(value);
    })).replace(/\s+/g, ' ').trim() || sanitizeFileToken(context.stem || context.basename || 'media');
};

export default {
    sanitizeFileToken,
    qualityFromProbe,
    buildNamingContext,
    applyNamingTemplate,
};
