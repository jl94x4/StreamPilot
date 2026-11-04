/**
 * The subtitle a Plex /status/sessions entry is showing, or null when subtitles are off.
 * Sessions list only the streams in use, so a subtitle stream there is the active one
 * (Plex marks it selected; older servers omit the flag).
 */
export const plexSessionSubtitle = (metadata) => {
    const media = Array.isArray(metadata?.Media) ? metadata.Media : [];
    const streams = media.flatMap((m) => (Array.isArray(m?.Part) ? m.Part : []))
        .flatMap((part) => (Array.isArray(part?.Stream) ? part.Stream : []))
        .filter((stream) => Number(stream?.streamType) === 3);
    if (!streams.length) return null;
    const stream = streams.find((s) => s.selected === true || s.selected === 1 || s.selected === '1') || streams[0];
    const code = String(stream.languageTag || stream.languageCode || '').trim();
    const language = String(stream.language || '').trim();
    const decision = String(stream.decision || '').toLowerCase();
    return {
        // Short tag for the card: "ENG", "EN", or just "CC" when Plex has no language.
        code: code ? code.toUpperCase().slice(0, 5) : '',
        label: String(stream.displayTitle || stream.extendedDisplayTitle || language || code || 'Subtitles').trim(),
        forced: stream.forced === true || stream.forced === 1 || stream.forced === '1',
        // Burned into the video by the server (forces a video transcode).
        burn: decision === 'burn',
    };
};
