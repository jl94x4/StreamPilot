/** Short format names for Plex subtitle codecs, as Plex's own apps show them. */
const SUBTITLE_FORMATS = {
    pgs: 'PGS',
    hdmv: 'PGS',
    hdmv_pgs_subtitle: 'PGS',
    srt: 'SRT',
    subrip: 'SRT',
    ass: 'ASS',
    ssa: 'SSA',
    vobsub: 'VobSub',
    dvd_subtitle: 'VobSub',
    dvdsub: 'VobSub',
    mov_text: 'TX3G',
    tx3g: 'TX3G',
    webvtt: 'VTT',
    vtt: 'VTT',
    smi: 'SMI',
    eia_608: 'CC',
    eia_708: 'CC',
};

export const subtitleFormatName = (codec) => {
    const raw = String(codec || '').trim().toLowerCase();
    if (!raw) return '';
    return SUBTITLE_FORMATS[raw] || raw.toUpperCase();
};

/**
 * Plex may put the format in codec, format, or Matroska codecID (S_HDMV/PGS).
 */
export const subtitleCodecFromStream = (stream) => {
    const codec = String(stream?.codec || stream?.format || '').trim().toLowerCase();
    if (codec) {
        if (codec.includes('pgs') || codec === 'hdmv') return 'pgs';
        return codec;
    }
    const id = String(stream?.codecID || stream?.codecId || '').toLowerCase();
    if (/pgs|hdmv/.test(id)) return 'pgs';
    if (/vobsub|dvd/.test(id)) return 'vobsub';
    if (/\bass\b|\bssa\b/.test(id)) return 'ass';
    if (/utf-?8|subrip|\bsrt\b/.test(id)) return 'srt';
    if (/webvtt|\bvtt\b/.test(id)) return 'vtt';
    if (/dvb/.test(id)) return 'dvbsub';
    if (/mov_text|tx3g/.test(id)) return 'tx3g';
    return '';
};

/** Plex streamType 3, or a row whose codec/codecID is a subtitle format (PGS via S_HDMV/PGS). */
export const isSubtitleStreamRow = (stream) => {
    const type = Number(stream?.streamType ?? stream?.StreamType);
    if (type === 3) return true;
    if (type === 1 || type === 2) return false;
    const codec = subtitleCodecFromStream(stream);
    return /^(pgs|hdmv|vobsub|dvd|dvb|ass|ssa|srt|subrip|webvtt|vtt|mov_text|tx3g)/i.test(codec)
        || /pgs|vobsub|hdmv/i.test(String(stream?.codecID || stream?.codecId || ''));
};

/**
 * "English Forced (PGS)": Plex's display title, with Forced and the format added when
 * the server left them out, so PGS and SRT tracks of one language can be told apart.
 */
export const subtitleTrackLabel = (stream) => {
    const display = String(stream?.displayTitle || stream?.extendedDisplayTitle || '').trim();
    const language = String(stream?.language || stream?.languageTag || stream?.languageCode || '').trim();
    const format = subtitleFormatName(subtitleCodecFromStream(stream) || stream?.codec);
    const forced = stream?.forced === true || stream?.forced === 1 || stream?.forced === '1';
    let base = display.replace(/\s*\(([^)]*)\)\s*$/, (whole, inner) => (
        format && inner.toLowerCase().includes(format.toLowerCase()) ? '' : whole
    )).trim() || language || 'Subtitle';
    if (forced && !/forced/i.test(base)) base = `${base} Forced`;
    return format ? `${base} (${format})` : base;
};
