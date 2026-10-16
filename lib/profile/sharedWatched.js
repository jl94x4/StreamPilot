/**
 * Titles both viewer and subject appear on in the analytics cache.
 * Viewer maps on topMovies/topShows are keyed by Plex/Jellyfin account ids.
 */

const asIdSet = (values = []) => new Set(
    (Array.isArray(values) ? values : [values])
        .map((value) => String(value || '').trim())
        .filter(Boolean),
);

const pickAnalyticsWindow = (cache = {}) => {
    if (!cache || typeof cache !== 'object') return {};
    return cache.all || cache[365] || cache[180] || cache[90] || cache[30] || {};
};

const viewerKeyIn = (viewers, ids) => {
    if (!viewers || typeof viewers !== 'object') return null;
    for (const key of Object.keys(viewers)) {
        if (ids.has(String(key))) return key;
    }
    return null;
};

const slimTitle = (item, kind, viewerKey, subjectKey) => {
    const viewers = item?.viewers || {};
    return {
        title: String(item?.title || '').trim(),
        kind,
        thumbUrl: item?.thumbUrl || null,
        plexUrl: item?.plexUrl || null,
        viewerPlays: Number(viewers[viewerKey]?.plays) || 0,
        subjectPlays: Number(viewers[subjectKey]?.plays) || 0,
    };
};

export const sharedWatchedFromAnalytics = ({
    cache = {},
    viewerIds = [],
    subjectIds = [],
    limit = 6,
} = {}) => {
    const viewerSet = asIdSet(viewerIds);
    const subjectSet = asIdSet(subjectIds);
    if (!viewerSet.size || !subjectSet.size) return [];
    const same = [...viewerSet].some((id) => subjectSet.has(id));
    if (same) return [];

    const window = pickAnalyticsWindow(cache);
    const movies = Array.isArray(window.topMovies) ? window.topMovies : [];
    const shows = Array.isArray(window.topShows) ? window.topShows : [];
    const hits = [];

    for (const item of movies) {
        const viewerKey = viewerKeyIn(item?.viewers, viewerSet);
        const subjectKey = viewerKeyIn(item?.viewers, subjectSet);
        if (!viewerKey || !subjectKey) continue;
        const row = slimTitle(item, 'movie', viewerKey, subjectKey);
        if (row.title) hits.push(row);
    }
    for (const item of shows) {
        const viewerKey = viewerKeyIn(item?.viewers, viewerSet);
        const subjectKey = viewerKeyIn(item?.viewers, subjectSet);
        if (!viewerKey || !subjectKey) continue;
        const row = slimTitle(item, 'tv', viewerKey, subjectKey);
        if (row.title) hits.push(row);
    }

    hits.sort((a, b) => (
        (b.viewerPlays + b.subjectPlays) - (a.viewerPlays + a.subjectPlays)
        || a.title.localeCompare(b.title)
    ));
    const seen = new Set();
    const unique = [];
    for (const row of hits) {
        const key = `${row.kind}:${row.title.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(row);
        if (unique.length >= limit) break;
    }
    return unique;
};

export default sharedWatchedFromAnalytics;
