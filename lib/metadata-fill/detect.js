/**
 * Decide whether a Plex episode still needs metadata fill.
 */

const PLACEHOLDER_TITLE = /^(tba|tbc|tbd|n\/?a|unknown|untitled|episode\s*\d+)$/i;

export const normalizeEpisodeTitle = (value) => String(value || '').trim();

export const isPlaceholderTitle = (title) => {
    const text = normalizeEpisodeTitle(title);
    if (!text) return true;
    return PLACEHOLDER_TITLE.test(text);
};

export const isMissingSummary = (summary) => !String(summary || '').trim();

export const isMissingAirDate = (value) => {
    const text = String(value || '').trim();
    if (!text) return true;
    // Plex sometimes stores epoch-zero placeholders.
    if (/^0000-00-00/.test(text) || text.startsWith('1970-01-01')) return true;
    return false;
};

/**
 * @param {{ title?: string, summary?: string, originallyAvailableAt?: string } | null} episode
 * @returns {{ needs: boolean, fields: { title: boolean, summary: boolean, originallyAvailableAt: boolean } }}
 */
export const needsMetadataFill = (episode = {}) => {
    const title = isPlaceholderTitle(episode?.title);
    const summary = isMissingSummary(episode?.summary);
    const originallyAvailableAt = isMissingAirDate(episode?.originallyAvailableAt);
    return {
        needs: title || summary || originallyAvailableAt,
        fields: { title, summary, originallyAvailableAt },
    };
};

export default needsMetadataFill;
