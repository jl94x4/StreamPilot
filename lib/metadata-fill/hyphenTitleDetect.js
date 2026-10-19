/**
 * Detect movies whose TMDB title keeps hyphens that Plex stripped
 * (e.g. Plex "Zombies" vs TMDB "Z-O-M-B-I-E-S").
 */

export const normalizeCompareTitle = (value) => String(value || '').trim().toLowerCase();

export const tmdbTitleHasHyphen = (tmdbTitle) => String(tmdbTitle || '').includes('-');

/**
 * @param {{ plexTitle?: string|null, tmdbTitle?: string|null }} input
 * @returns {{ needs: boolean, plexTitle: string, tmdbTitle: string }}
 */
export const needsHyphenTitleFix = ({ plexTitle = '', tmdbTitle = '' } = {}) => {
    const plex = String(plexTitle || '').trim();
    const tmdb = String(tmdbTitle || '').trim();
    if (!tmdb || !tmdbTitleHasHyphen(tmdb)) {
        return { needs: false, plexTitle: plex, tmdbTitle: tmdb };
    }
    if (!plex) {
        return { needs: true, plexTitle: plex, tmdbTitle: tmdb };
    }
    if (normalizeCompareTitle(plex) === normalizeCompareTitle(tmdb)) {
        return { needs: false, plexTitle: plex, tmdbTitle: tmdb };
    }
    return { needs: true, plexTitle: plex, tmdbTitle: tmdb };
};

export default needsHyphenTitleFix;
