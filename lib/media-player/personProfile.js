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

/** Exact name only. Never fall back to a more popular person with a different name. */
export const pickTmdbPersonMatch = (results = [], { name = '', knownTitles = [] } = {}) => {
    const want = foldPersonName(name);
    if (!want) return null;
    const titles = new Set((Array.isArray(knownTitles) ? knownTitles : [])
        .map((row) => foldPersonName(row))
        .filter(Boolean));
    const people = (Array.isArray(results) ? results : [])
        .filter(isPersonSearchResult)
        .filter((row) => foldPersonName(row?.name) === want);
    if (!people.length) return null;
    let best = null;
    let bestScore = -1;
    for (const row of people) {
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

/** Plex people / Role Guid values such as tmdb://person/11962. */
export const pickPersonTmdbId = (meta = {}) => {
    const values = [];
    const push = (value) => {
        const raw = String(value || '').trim();
        if (raw) values.push(raw);
    };
    if (Array.isArray(meta?.Guid)) {
        for (const entry of meta.Guid) push(entry?.id || entry);
    }
    push(meta?.guid);
    push(meta?.key);
    for (const raw of values) {
        const match = String(raw).match(/(?:tmdb|themoviedb):\/\/(?:person\/)?(\d+)/i);
        if (match) {
            const id = Number(match[1]);
            if (Number.isFinite(id) && id > 0) return id;
        }
    }
    return null;
};

export const pickPersonTmdbIdFromCredits = (metas = [], { actorId, name } = {}) => {
    const wantId = String(actorId || '').trim();
    const wantName = String(name || '').trim().toLowerCase();
    for (const meta of Array.isArray(metas) ? metas : []) {
        const roles = [].concat(meta?.Role || []);
        for (const role of roles) {
            const id = role?.id != null ? String(role.id) : '';
            const tag = String(role?.tag || '').trim();
            const idMatch = wantId && (id === wantId || tag === wantId);
            const nameMatch = wantName && tag.toLowerCase() === wantName;
            if (!idMatch && !nameMatch) continue;
            const found = pickPersonTmdbId(role);
            if (found) return found;
        }
    }
    return null;
};

export const toPlayerPersonProfile = (details = {}) => {
    const name = String(details?.name || '').trim();
    if (!name) return null;
    const birthday = String(details.birthday || '').trim() || null;
    const deathday = String(details.deathday || '').trim() || null;
    const tmdbId = Number(details.id ?? details.tmdbId);
    return {
        name,
        tmdbId: Number.isFinite(tmdbId) && tmdbId > 0 ? tmdbId : null,
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
    tmdbId: givenTmdbId,
    tmdbApiKey,
    fetchImpl,
    language = 'en',
} = {}) => {
    const query = String(name || '').trim();
    const key = String(tmdbApiKey || '').trim();
    if (!key || key === '********') return null;
    const providedId = Number(givenTmdbId);
    if ((!query && !(Number.isFinite(providedId) && providedId > 0))) return null;
    try {
        const client = createTmdbClient({
            tmdbApiKey: key,
            language,
            fetchImpl,
            timeoutMs: 6000,
        });
        let tmdbId = Number.isFinite(providedId) && providedId > 0 ? providedId : 0;
        if (!tmdbId) {
            const searched = typeof client.searchPeople === 'function'
                ? await client.searchPeople(query, { language })
                : await client.search(query, { language });
            const results = Array.isArray(searched?.results) ? searched.results : [];
            const match = pickTmdbPersonMatch(results, { name: query, knownTitles });
            tmdbId = Number(match?.id);
        }
        if (!Number.isFinite(tmdbId) || tmdbId <= 0) return null;
        const details = await client.person(tmdbId, { language });
        const profile = toPlayerPersonProfile(details);
        if (!profile) return null;
        const want = foldPersonName(query);
        if (want && foldPersonName(profile.name) !== want && !(Number.isFinite(providedId) && providedId > 0)) {
            return null;
        }
        return { ...profile, tmdbId };
    } catch {
        return null;
    }
};
