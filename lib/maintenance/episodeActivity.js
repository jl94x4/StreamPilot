/**
 * Show-level episode recency for Cleaner rules.
 * "Days Since Added" is the show's first library add; these fields use the
 * latest episode air date / file-add date instead.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const parseTimestampMs = (value) => {
    if (value == null || value === '') return null;
    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 0 && value < 1e12 ? value * 1000 : value;
    }
    const raw = String(value).trim();
    if (!raw) return null;
    if (/^\d+(\.\d+)?$/.test(raw)) {
        const n = Number(raw);
        if (!Number.isFinite(n)) return null;
        return n > 0 && n < 1e12 ? n * 1000 : n;
    }
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
};

export const daysSinceTimestamp = (timestamp, now = Date.now()) => {
    const ms = parseTimestampMs(timestamp);
    if (ms == null) return null;
    return Math.floor((now - ms) / MS_PER_DAY);
};

export const emptyShowEpisodeActivity = () => ({
    lastEpisodeAiredAt: null,
    lastEpisodeAddedAt: null,
    daysSinceLastEpisodeAired: null,
    daysSinceLastEpisodeAdded: null,
});

/**
 * @param {Array<{ originallyAvailableAt?: unknown, airDate?: unknown, premiereDate?: unknown, addedAt?: unknown, dateCreated?: unknown }>} episodes
 */
export const summarizeShowEpisodeActivity = (episodes = [], { now = Date.now() } = {}) => {
    let lastAiredMs = null;
    let lastAddedMs = null;
    const list = Array.isArray(episodes) ? episodes : [];
    for (const episode of list) {
        if (!episode || typeof episode !== 'object') continue;
        const aired = parseTimestampMs(
            episode.originallyAvailableAt ?? episode.airDate ?? episode.premiereDate,
        );
        const added = parseTimestampMs(episode.addedAt ?? episode.dateCreated);
        if (aired != null && aired <= now && (lastAiredMs == null || aired > lastAiredMs)) {
            lastAiredMs = aired;
        }
        if (added != null && (lastAddedMs == null || added > lastAddedMs)) {
            lastAddedMs = added;
        }
    }
    return {
        lastEpisodeAiredAt: lastAiredMs ? new Date(lastAiredMs).toISOString() : null,
        lastEpisodeAddedAt: lastAddedMs ? new Date(lastAddedMs).toISOString() : null,
        daysSinceLastEpisodeAired: daysSinceTimestamp(lastAiredMs, now),
        daysSinceLastEpisodeAdded: daysSinceTimestamp(lastAddedMs, now),
    };
};

export const applyShowEpisodeActivity = (show, summary = emptyShowEpisodeActivity()) => {
    if (!show || typeof show !== 'object') return show;
    show.lastEpisodeAiredAt = summary.lastEpisodeAiredAt ?? null;
    show.lastEpisodeAddedAt = summary.lastEpisodeAddedAt ?? null;
    show.daysSinceLastEpisodeAired = summary.daysSinceLastEpisodeAired ?? null;
    show.daysSinceLastEpisodeAdded = summary.daysSinceLastEpisodeAdded ?? null;
    return show;
};

export default summarizeShowEpisodeActivity;
