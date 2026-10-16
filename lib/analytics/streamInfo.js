/**
 * Map Tautulli get_stream_data into source vs stream rows for the history modal.
 */

const blank = (value) => {
    if (value == null) return null;
    const text = String(value).trim();
    return text ? text : null;
};

const prettyLabel = (value) => {
    const raw = blank(value);
    if (!raw) return null;
    return raw.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
};

const codec = (value) => {
    const raw = blank(value);
    return raw ? raw.toUpperCase() : null;
};

const prettyDecision = (value) => {
    const raw = String(value || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
    if (!raw) return null;
    if (raw === 'copy' || raw === 'direct stream') return 'Direct Stream';
    if (raw === 'direct play' || raw === 'directplay') return 'Direct Play';
    if (raw.includes('transcode')) return 'Transcode';
    return prettyLabel(raw);
};

const decisionTone = (value) => {
    const raw = String(value || '').toLowerCase();
    if (raw.includes('transcode')) return 'transcode';
    if (raw.includes('copy') || raw.includes('direct stream')) return 'copy';
    if (raw.includes('direct')) return 'direct';
    return null;
};

const kbps = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return `${Math.round(n)} kbps`;
};

const resolution = (value) => {
    const raw = blank(value);
    if (!raw) return null;
    if (/^\d+$/.test(raw)) return `${raw}p`;
    return raw;
};

const decisionOrValue = (decision, value, formatValue = blank) => {
    const nextDecision = prettyDecision(decision);
    const nextValue = formatValue(value);
    if (!nextDecision) return nextValue;
    if (nextDecision === 'Direct Play') return nextDecision;
    if (!nextValue || nextValue.toLowerCase() === nextDecision.toLowerCase()) return nextDecision;
    return `${nextDecision} · ${nextValue}`;
};

const cell = (label, source, stream, streamDecision) => ({
    label,
    source: source || null,
    stream: stream || null,
    streamTone: decisionTone(streamDecision),
});

const sectionHasValues = (section) => (
    Array.isArray(section?.rows) && section.rows.some((row) => row.source || row.stream)
);

export const mapTautulliStreamData = (raw = {}) => {
    const media = {
        id: 'media',
        label: 'Media',
        rows: [
            cell('Bitrate', kbps(raw.bitrate), kbps(raw.stream_bitrate)),
            cell(
                'Resolution',
                resolution(raw.video_full_resolution || raw.video_resolution),
                resolution(raw.stream_video_full_resolution || raw.stream_video_resolution),
            ),
            cell('Quality', null, prettyLabel(raw.quality_profile) || blank(raw.quality_profile)),
            cell(
                'Container',
                blank(raw.container),
                decisionOrValue(raw.stream_container_decision, raw.stream_container),
                raw.stream_container_decision,
            ),
        ],
    };
    const video = {
        id: 'video',
        label: 'Video',
        rows: [
            cell(
                'Codec',
                codec(raw.video_codec),
                decisionOrValue(raw.stream_video_decision, raw.stream_video_codec, codec),
                raw.stream_video_decision,
            ),
            cell('Bitrate', kbps(raw.video_bitrate), kbps(raw.stream_video_bitrate)),
            cell('Width', blank(raw.video_width), blank(raw.stream_video_width)),
            cell('Height', blank(raw.video_height), blank(raw.stream_video_height)),
            cell('Framerate', blank(raw.video_framerate), blank(raw.stream_video_framerate)),
            cell('Dynamic Range', codec(raw.video_dynamic_range), codec(raw.stream_video_dynamic_range)),
            cell('Aspect Ratio', blank(raw.aspect_ratio), null),
        ],
    };
    const audio = {
        id: 'audio',
        label: 'Audio',
        rows: [
            cell(
                'Codec',
                codec(raw.audio_codec),
                decisionOrValue(raw.stream_audio_decision, raw.stream_audio_codec, codec),
                raw.stream_audio_decision,
            ),
            cell('Bitrate', kbps(raw.audio_bitrate), kbps(raw.stream_audio_bitrate)),
            cell('Channels', blank(raw.audio_channels), blank(raw.stream_audio_channels)),
            cell('Language', prettyLabel(raw.audio_language), prettyLabel(raw.stream_audio_language)),
        ],
    };
    const subtitles = {
        id: 'subtitles',
        label: 'Subtitles',
        rows: [
            cell(
                'Codec',
                codec(raw.subtitle_codec),
                decisionOrValue(raw.stream_subtitle_decision, raw.stream_subtitle_codec, codec),
                raw.stream_subtitle_decision,
            ),
            cell('Language', prettyLabel(raw.subtitle_language), prettyLabel(raw.stream_subtitle_language)),
        ],
    };

    const sections = [media, video, audio, subtitles]
        .map((section) => ({
            ...section,
            rows: section.rows.filter((row) => row.source || row.stream),
        }))
        .filter(sectionHasValues);

    const showTitle = blank(raw.grandparent_title);
    const episodeTitle = blank(raw.title);
    const title = showTitle
        ? [showTitle, episodeTitle].filter(Boolean).join(' - ')
        : episodeTitle;

    return {
        title: title || null,
        mediaType: blank(raw.media_type),
        sections,
    };
};
