import { createTmdbClient } from '../portal-request/tmdbClient.js';

const foldPersonName = (value) => String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const isPersonSearchResult = (row) => {
    const type = String(row?.mediaType || row?.media_type || '').toLowerCase();
    return type === 'person' || (!type && !!(row?.profilePath || row?.profile_path));
};

/** Prefer an exact name match, then overlap with titles already on the server. */
export const pickTmdbPersonMatch = (results = [], { name = '', knownTitles = [] } = {}) => {
    const want = foldPersonName(name);
    const titles = new Set((Array.isArray(knownTitles) ? knownTitles : [])
        .map((row) => foldPersonName(row))
        .filter(Boolean));
    const people = (Array.isArray(results) ? results : []).filter(isPersonSearchResult);
    const named = want
        ? people.filter((row) => foldPersonName(row?.name) === want)
        : people;
    const pool = named.length ? named : people;
    let best = null;
    let bestScore = -1;
    for (const row of pool) {
        const known = [].concat(row?.knownFor || row?.known_for || []);
        const overlap = known.filter((item) => titles.has(foldPersonName(item?.title || item?.name))).length;
        const popularity = Number(row?.popularity) || 0;
        const score = (overlap * 1000) + popularity;
        if (score > bestScore) {
            best = row;
            bestScore = score;
        }
    }
    return best;
};

export const toPlayerPersonProfile = (details = {}) => {
    const name = String(details?.name || '').trim();
    if (!name) return null;
    const birthday = String(details.birthday || '').trim() || null;
    const deathday = String(details.deathday || '').trim() || null;
    return {
        name,
        biography: String(details.biography || '').trim() || null,
        birthday,
        deathday,
        knownForDepartment: details.knownForDepartment || details.known_for_department || null,
        placeOfBirth: details.placeOfBirth || details.place_of_birth || null,
        placeOfDeath: details.placeOfDeath || details.place_of_death || null,
        profilePath: details.profilePath || details.profile_path || null,
    };
};

export const resolvePlayerPersonProfile = async ({
    name,
    knownTitles = [],
    tmdbApiKey,
    fetchImpl,
    language = 'en',
} = {}) => {
    const query = String(name || '').trim();
    const key = String(tmdbApiKey || '').trim();
    if (!query || !key || key === '********') return null;
    try {
        const client = createTmdbClient({
            tmdbApiKey: key,
            language,
            fetchImpl,
            timeoutMs: 6000,
        });
        const searched = typeof client.searchPeople === 'function'
            ? await client.searchPeople(query, { language })
            : await client.search(query, { language });
        const results = Array.isArray(searched?.results) ? searched.results : [];
        const match = pickTmdbPersonMatch(results, { name: query, knownTitles });
        const tmdbId = Number(match?.id);
        if (!Number.isFinite(tmdbId) || tmdbId <= 0) return null;
        const details = await client.person(tmdbId, { language });
        return toPlayerPersonProfile(details);
    } catch {
        return null;
    }
};
