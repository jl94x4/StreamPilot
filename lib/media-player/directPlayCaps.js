/**
 * Shared Direct Play capability rules for portal (/file) and APK plexDirect.
 * Keep browser vs native codec sets in one place so paths do not disagree.
 *
 * Native (Android TV / ExoPlayer) aims to match official Plex Android TV:
 * Direct Play AAC/AC3/EAC3(+Atmos JOC)/FLAC/Opus/MP3 and (with Bitstream) TrueHD/DTS.
 */

const asArray = (value) => {
    if (Array.isArray(value)) return value;
    if (value == null) return [];
    return [value];
};

const STREAM_VIDEO = 1;
const STREAM_AUDIO = 2;

const BROWSER_DIRECT_CONTAINERS = new Set(['mp4', 'mov', 'm4v', 'mp3', 'm4a', 'aac', 'flac']);
const BROWSER_DIRECT_VIDEO = new Set(['h264', 'avc', 'avc1']);
const BROWSER_HEVC_VIDEO = new Set(['hevc', 'h265', 'hev1', 'hvc1']);
const BROWSER_DIRECT_AUDIO = new Set(['aac', 'mp3', 'mp4a', 'flac']);
const BROWSER_AC3_AUDIO = new Set(['ac3', 'eac3', 'ac-3', 'ec-3', 'eac3_joc', 'ec+3']);
/** Containers official Plex Android TV commonly Direct Plays. */
const NATIVE_DIRECT_CONTAINERS = new Set([
    'mp4', 'mov', 'm4v', 'mkv', 'webm',
    'm2ts', 'mts', 'ts', 'mpegts', 'mpeg', 'mpg', 'vob',
    'avi', 'asf', 'wmv', 'flv', '3gp',
    'mp3', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'aiff', 'wma', 'mp2',
]);
const NATIVE_DIRECT_VIDEO = new Set(['h264', 'avc', 'avc1', 'hevc', 'h265', 'hev1', 'hvc1', 'av1', 'vp9', 'mpeg2video', 'mpeg2', 'mpeg1video', 'mpeg4', 'vc1', 'wmv3']);
const NATIVE_DIRECT_AUDIO = new Set([
    'aac', 'mp3', 'mp4a', 'mp2',
    'ac3', 'eac3', 'ac-3', 'ec-3', 'eac3_joc', 'ec+3',
    'flac', 'alac', 'opus', 'vorbis', 'pcm', 'pcm_s16le', 'pcm_s24le', 'pcm_bluray', 'lpcm',
    'wma', 'wmav2',
    // Bitstream / HDMI passthrough (gated by audioPassthrough)
    'truehd', 'mlp', 'dca', 'dts', 'dtsc', 'dtsh', 'dtshd', 'dtsma', 'dtsl',
]);
/** HDMI bitstream / passthrough codecs — may be disabled via audioPassthrough=false. */
const BITSTREAM_AUDIO = new Set([
    'truehd', 'mlp', 'dca', 'dts', 'dtsc', 'dtsh', 'dtshd', 'dtsma', 'dtsl',
]);

/** Codecs Exo/Plex accept when remuxing (Direct Stream) without audio convert. */
export const NATIVE_COPY_AUDIO_CODECS = 'aac,mp3,ac3,eac3,eac3_joc,flac,opus,mp4a';

const IMAGE_SUBTITLE_CODECS = new Set(['pgs', 'vobsub', 'dvd', 'dvdsub', 'image', 'bluray', 'dvbsub', 'xsub']);

export const subtitleCodecNeedsBurn = (codec) => IMAGE_SUBTITLE_CODECS.has(String(codec || '').toLowerCase());

/**
 * Canonicalize Plex audio codec labels so EAC3/Atmos aliases match the Direct Play set.
 * EAC3 / EAC3-JOC are never treated as Bitstream-only — official Plex Direct Plays them.
 */
export const normalizeAudioCodec = (codec) => {
    const raw = String(codec || '').trim().toLowerCase();
    if (!raw) return '';
    if (raw === 'eac3_joc' || raw === 'ec+3' || (raw.includes('joc') && /eac3|ec-3|atmos|ddp|dd\+/.test(raw))) {
        return 'eac3_joc';
    }
    if (
        raw === 'eac3'
        || raw === 'ec-3'
        || raw === 'e-ac-3'
        || raw === 'ddp'
        || raw === 'dd+'
        || raw.includes('eac3')
        || raw.includes('ec-3')
        || raw.includes('e-ac-3')
    ) {
        return 'eac3';
    }
    if (raw === 'ac3' || raw === 'ac-3' || raw === 'dd') return 'ac3';
    if (raw === 'truehd' || raw === 'mlp' || raw.includes('truehd')) return 'truehd';
    if (raw === 'dca' || raw === 'dts' || raw.startsWith('dts') || raw === 'dtsc') {
        if (raw === 'dtshd' || raw === 'dtsma' || raw === 'dtsh' || raw === 'dtsl') return raw;
        return raw === 'dca' ? 'dca' : (raw.startsWith('dts') ? raw : 'dts');
    }
    if (raw === 'mp4a') return 'aac';
    if (raw === 'pcm_s16le' || raw === 'pcm_s24le' || raw === 'pcm_bluray' || raw === 'lpcm') return 'pcm';
    return raw;
};

export const isBitstreamAudioCodec = (codec) => {
    const id = normalizeAudioCodec(codec);
    return BITSTREAM_AUDIO.has(id) || BITSTREAM_AUDIO.has(String(codec || '').toLowerCase());
};

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

export const profileAllowsAudioCodec = (profile, codec) => {
    const raw = String(codec || '').trim().toLowerCase();
    if (!raw) return true;
    if (profile.audioCodecs.has(raw)) return true;
    const norm = normalizeAudioCodec(raw);
    if (norm && profile.audioCodecs.has(norm)) return true;
    // EAC3 family shares Direct Play with every alias official Plex accepts.
    if (norm === 'eac3' || norm === 'eac3_joc') {
        return ['eac3', 'eac3_joc', 'ec-3', 'ec+3', 'e-ac-3'].some((id) => profile.audioCodecs.has(id));
    }
    if (norm === 'ac3') {
        return ['ac3', 'ac-3'].some((id) => profile.audioCodecs.has(id));
    }
    if (norm === 'truehd') {
        return ['truehd', 'mlp'].some((id) => profile.audioCodecs.has(id));
    }
    if (norm === 'pcm') {
        return ['pcm', 'pcm_s16le', 'pcm_s24le', 'pcm_bluray', 'lpcm'].some((id) => profile.audioCodecs.has(id));
    }
    return false;
};

export const normalizePlaybackCaps = (raw = {}) => {
    const client = normalizePlaybackClient(raw.client || raw.platform);
    const native = client !== 'web';
    const allowHevc = flagEnabled(raw, ['canPlayHevc', 'allowHevc', 'hevc'], native);
    const allowAc3 = flagEnabled(raw, ['canPlayAc3', 'allowAc3', 'ac3'], native);
    const textSubtitles = flagEnabled(raw, ['textSubtitles', 'canPlayTextSubtitles', 'textSubs'], native);
    // Default off: TrueHD/DTS Direct Play aborts MediaCodec on many TVs without HDMI passthrough.
    // Users can opt in via Settings → Bitstream audio. EAC3/AC3 are never gated by this.
    const audioPassthrough = flagEnabled(raw, ['audioPassthrough', 'passthrough'], false);
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
    // allowAc3 only gates browser profiles — never strip AC3/EAC3 from native Exo.
    if (!native) {
        if (allowAc3) for (const id of BROWSER_AC3_AUDIO) audioCodecs.add(id);
        else for (const id of BROWSER_AC3_AUDIO) audioCodecs.delete(id);
    } else {
        for (const id of BROWSER_AC3_AUDIO) audioCodecs.add(id);
    }
    if (!audioPassthrough) {
        for (const id of BITSTREAM_AUDIO) audioCodecs.delete(id);
    }
    return {
        client,
        allowHevc,
        allowAc3,
        textSubtitles,
        audioPassthrough,
        containers,
        videoCodecs,
        audioCodecs,
        audioStreamId: String(raw.audioStreamId || raw.audioStreamID || ''),
        subtitleStreamId: String(raw.subtitleStreamId || raw.subtitleStreamID || ''),
        mediaIndex: Math.max(0, Math.floor(Number(raw.mediaIndex) || 0)),
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

const selectedMedia = (meta, mediaIndex = 0) => {
    const list = asArray(meta?.Media);
    return list[mediaIndex] || list[0] || {};
};

const firstPart = (media) => asArray(media?.Part)[0] || {};

const partStreams = (media) => asArray(firstPart(media).Stream);

/**
 * Whether HTTP Direct Play is allowed for this media + track selection.
 * Portal /file and APK plexDirect both use this so decisions stay aligned.
 */
export const canHttpDirectPlay = (meta = {}, caps = {}) => {
    const profile = normalizePlaybackCaps(caps);
    const media = selectedMedia(meta, profile.mediaIndex);
    const part = firstPart(media);
    if (!String(part.id || part.key || '').trim()) return false;
    const streams = partStreams(media);
    const subId = String(profile.subtitleStreamId || caps.subtitleStreamId || '').replace(/\D/g, '');
    if (subId) {
        const sub = streams.find((row) => String(row?.id || '') === subId);
        if (!sub) {
            // Unknown track: browsers cannot Direct Play with a forced sub id.
            // Native keeps Direct Play — Exo selects text tracks without a rebuild.
            if (!profile.textSubtitles) return false;
        } else if (!profile.textSubtitles || subtitleCodecNeedsBurn(sub.codec)) {
            return false;
        }
    }
    const container = String(part.container || media.container || '').toLowerCase();
    if (!profile.containers.has(container)) return false;
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
    const acodec = normalizeAudioCodec(audio.codec || media.audioCodec || '');
    const hasVideo = Boolean(vcodec) || streams.some((row) => Number(row?.streamType) === STREAM_VIDEO);
    if (hasVideo && vcodec && !profile.videoCodecs.has(vcodec)) return false;
    if (acodec && !profileAllowsAudioCodec(profile, acodec)) return false;
    return true;
};

/** Whether a subtitle stream should force burn-in HLS (image-based). */
export const subtitleNeedsBurnIn = (stream) => {
    if (!stream) return false;
    return subtitleCodecNeedsBurn(stream.codec);
};
