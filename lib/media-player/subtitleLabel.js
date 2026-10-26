/** Short format names for Plex subtitle codecs, as Plex's own apps show them. */
const SUBTITLE_FORMATS = {
    pgs: 'PGS',
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
 * "English Forced (PGS)": Plex's display title, with Forced and the format added when
 * the server left them out, so PGS and SRT tracks of one language can be told apart.
 */
export const subtitleTrackLabel = (stream) => {
    const display = String(stream?.displayTitle || stream?.extendedDisplayTitle || '').trim();
    const language = String(stream?.language || stream?.languageTag || stream?.languageCode || '').trim();
    const format = subtitleFormatName(stream?.codec);
    const forced = stream?.forced === true || stream?.forced === 1 || stream?.forced === '1';
    let base = display.replace(/\s*\(([^)]*)\)\s*$/, (whole, inner) => (
        format && inner.toLowerCase().includes(format.toLowerCase()) ? '' : whole
    )).trim() || language || 'Subtitle';
    if (forced && !/forced/i.test(base)) base = `${base} Forced`;
    return format ? `${base} (${format})` : base;
};
