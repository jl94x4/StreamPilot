/**
 * Best-effort Plex-style subtitle auto-sync: correlate external SRT cue starts
 * with server voice-activity speech onsets and pick a delay offset (−5s…+5s).
 */

export const parseSrtCueStartsMs = (srtText) => {
    const starts = [];
    const re = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->/g;
    let match;
    while ((match = re.exec(srtText)) && starts.length < 80) {
        const h = Number(match[1]) || 0;
        const m = Number(match[2]) || 0;
        const s = Number(match[3]) || 0;
        const ms = Number(String(match[4] || '0').padEnd(3, '0').slice(0, 3)) || 0;
        starts.push(((h * 60 + m) * 60 + s) * 1000 + ms);
    }
    return starts;
};

/** Rising edges / speech onsets from a dense activity bitmap (10ms/sample). */
export const speechOnsetsFromBitmap = (bytes, sampleMs = 10) => {
    const onsets = [];
    let prev = false;
    for (let i = 0; i < bytes.length && onsets.length < 400; i++) {
        const active = bytes[i] > 0;
        if (active && !prev) onsets.push(i * sampleMs);
        prev = active;
    }
    return onsets;
};

export const speechOnsetsFromIntervals = (intervals) => {
    const onsets = [];
    for (const row of intervals || []) {
        const start = Number(row.startMs ?? row.start);
        if (Number.isFinite(start) && start >= 0) onsets.push(Math.floor(start));
        if (onsets.length >= 400) break;
    }
    return onsets;
};

/**
 * Score offsets so cue starts land near speech onsets (within 350ms).
 * Returns 0 when confidence is too low.
 */
export const computeSubtitleSyncOffsetMs = (cueStartsMs, speechOnsetsMs) => {
    const cues = (cueStartsMs || []).filter((n) => Number.isFinite(n) && n >= 0).slice(0, 50);
    const speech = (speechOnsetsMs || []).filter((n) => Number.isFinite(n) && n >= 0).slice(0, 400);
    if (cues.length < 4 || speech.length < 4) return 0;

    let best = 0;
    let bestHits = -1;
    let bestError = Number.POSITIVE_INFINITY;
    for (let offset = -5000; offset <= 5000; offset += 100) {
        let hits = 0;
        let errorSum = 0;
        for (const cue of cues) {
            const target = cue + offset;
            let nearest = Number.POSITIVE_INFINITY;
            for (const onset of speech) {
                const d = Math.abs(onset - target);
                if (d < nearest) nearest = d;
            }
            if (nearest <= 250) {
                hits += 1;
                errorSum += nearest;
            }
        }
        const meanError = hits ? errorSum / hits : Number.POSITIVE_INFINITY;
        if (hits > bestHits || (hits === bestHits && meanError < bestError)) {
            bestHits = hits;
            bestError = meanError;
            best = offset;
        }
    }
    return bestHits >= Math.max(3, Math.floor(cues.length * 0.35)) ? best : 0;
};
