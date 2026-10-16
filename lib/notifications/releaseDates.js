/**
 * Prefer digital → theatrical → physical release dates (Phase 4 / #89).
 * TMDB release type ids: 1 premiere, 2 limited theatrical, 3 theatrical, 4 digital, 5 physical, 6 TV.
 */

export const RELEASE_DATE_PREFERENCES = ['digital', 'theatrical', 'physical', 'tmdb'];

export const normalizeReleaseDatePreference = (raw = 'digital') => {
    const value = String(raw || 'digital').trim().toLowerCase();
    return RELEASE_DATE_PREFERENCES.includes(value) ? value : 'digital';
};

const sliceDate = (value) => {
    const text = String(value || '').trim();
    if (!text) return null;
    const date = text.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
};

const TYPE_LABELS = {
    digital: 'Digital release',
    theatrical: 'Theatrical release',
    physical: 'Physical release',
    tmdb: 'Release date',
    first_air: 'First air date',
};

export const extractRegionReleaseDates = (releases = {}, region = 'US') => {
    const results = Array.isArray(releases?.results)
        ? releases.results
        : (Array.isArray(releases) ? releases : []);
    const wanted = String(region || 'US').toUpperCase();
    const match = results.find((row) => String(row?.iso_3166_1 || '').toUpperCase() === wanted)
        || results.find((row) => String(row?.iso_3166_1 || '').toUpperCase() === 'US')
        || results[0]
        || null;
    const dates = Array.isArray(match?.release_dates) ? match.release_dates : [];
    const findTypes = (...types) => {
        for (const type of types) {
            const hit = dates.find((entry) => Number(entry?.type) === type && entry?.release_date);
            const sliced = sliceDate(hit?.release_date);
            if (sliced) return sliced;
        }
        return null;
    };
    return {
        theatrical: findTypes(3, 2),
        digital: findTypes(4),
        physical: findTypes(5),
    };
};

export const pickPreferredRelease = ({
    preference = 'digital',
    releases = null,
    releaseDate = null,
    firstAirDate = null,
    region = 'US',
} = {}) => {
    const air = sliceDate(firstAirDate);
    if (air) {
        return {
            date: air,
            type: 'first_air',
            label: TYPE_LABELS.first_air,
            candidates: { first_air: air, tmdb: air },
        };
    }

    const pref = normalizeReleaseDatePreference(preference);
    const extracted = extractRegionReleaseDates(releases, region);
    const tmdb = sliceDate(releaseDate);
    const candidates = {
        digital: extracted.digital,
        theatrical: extracted.theatrical,
        physical: extracted.physical,
        tmdb,
    };

    if (pref === 'tmdb' && tmdb) {
        return { date: tmdb, type: 'tmdb', label: TYPE_LABELS.tmdb, candidates };
    }

    const order = pref === 'theatrical'
        ? ['theatrical', 'digital', 'physical', 'tmdb']
        : (pref === 'physical'
            ? ['physical', 'digital', 'theatrical', 'tmdb']
            : ['digital', 'theatrical', 'physical', 'tmdb']);

    for (const key of order) {
        if (candidates[key]) {
            return {
                date: candidates[key],
                type: key,
                label: TYPE_LABELS[key] || 'Release date',
                candidates,
            };
        }
    }
    return null;
};

/** True when the calendar date is strictly after today (UTC day). */
export const isFutureReleaseDate = (isoDate, now = new Date()) => {
    const date = sliceDate(isoDate);
    if (!date) return false;
    const releaseMs = Date.parse(`${date}T00:00:00.000Z`);
    if (!Number.isFinite(releaseMs)) return false;
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return releaseMs > today;
};

export const formatReleaseDateLabel = (isoDate) => {
    const date = sliceDate(isoDate);
    if (!date) return '';
    try {
        return new Intl.DateTimeFormat('en', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC',
        }).format(new Date(`${date}T00:00:00.000Z`));
    } catch {
        return date;
    }
};

export default pickPreferredRelease;
