/**
 * Normalize TMDB combined credits into a full filmography (not just "known for").
 */

export const PERSON_CREDIT_ENRICH_CHUNK = 120;

const titleOf = (item) => String(item?.title || item?.name || '').trim();

export const personCreditKey = (item) => {
    const mediaType = String(item?.mediaType || item?.media_type || '').toLowerCase() === 'tv' ? 'tv' : 'movie';
    const id = Number(item?.tmdbId ?? item?.id);
    if (!Number.isFinite(id) || id <= 0) return null;
    return `${mediaType}:${id}`;
};

export const personCreditDate = (item) => {
    const raw = String(item?.releaseDate || item?.firstAirDate || item?.release_date || item?.first_air_date || '').trim();
    if (!raw) return 0;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
};

export const personCreditYear = (item) => {
    const year = String(item?.releaseDate || item?.firstAirDate || item?.release_date || item?.first_air_date || '').slice(0, 4);
    return /^\d{4}$/.test(year) ? year : '';
};

const creditScore = (item) => {
    const hasPoster = !!(item?.posterPath || item?.poster_path);
    const hasRole = !!(String(item?.character || item?.job || '').trim());
    return (hasPoster ? 2 : 0) + (hasRole ? 1 : 0);
};

export const dedupePersonCredits = (rows = []) => {
    const best = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
        if (!row || !titleOf(row)) continue;
        const key = personCreditKey(row);
        if (!key) continue;
        const prev = best.get(key);
        if (!prev || creditScore(row) > creditScore(prev)) best.set(key, row);
    }
    return [...best.values()].sort((a, b) => {
        const dateDelta = personCreditDate(b) - personCreditDate(a);
        if (dateDelta) return dateDelta;
        return titleOf(a).localeCompare(titleOf(b));
    });
};

export const splitPersonCredits = (creditsData = {}) => ({
    cast: dedupePersonCredits(creditsData.cast),
    crew: dedupePersonCredits(creditsData.crew),
});

export const mergeEnrichedPersonCredits = (current = [], enrichedChunk = []) => {
    if (!Array.isArray(current) || !current.length) return current;
    if (!Array.isArray(enrichedChunk) || !enrichedChunk.length) return current;
    const byKey = new Map();
    for (const item of enrichedChunk) {
        const key = personCreditKey(item);
        if (key) byKey.set(key, item);
    }
    if (!byKey.size) return current;
    return current.map((item) => byKey.get(personCreditKey(item)) || item);
};

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

export const splitBiography = (bio = '') => {
    const trimmed = String(bio || '').trim();
    if (!trimmed) return { first: '', rest: '', hasMore: false };
    const paragraphs = trimmed.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
    if (paragraphs.length <= 1) {
        return { first: paragraphs[0] || trimmed, rest: '', hasMore: false };
    }
    return {
        first: paragraphs[0],
        rest: paragraphs.slice(1).join('\n\n'),
        hasMore: true,
    };
};

const personDateParts = (raw) => {
    const match = String(raw || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
};

export const formatPersonDate = (raw, locale = 'en') => {
    const parts = personDateParts(raw);
    if (!parts) return String(raw || '').trim();
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    if (Number.isNaN(date.getTime())) return String(raw || '').trim();
    try {
        return new Intl.DateTimeFormat(locale || 'en', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            timeZone: 'UTC',
        }).format(date);
    } catch {
        return String(raw || '').trim();
    }
};

export const personAgeYears = (birthday, until = null) => {
    const birth = personDateParts(birthday);
    if (!birth) return null;
    const end = personDateParts(until) || (() => {
        const now = new Date();
        return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
    })();
    let age = end.year - birth.year;
    if (end.month < birth.month || (end.month === birth.month && end.day < birth.day)) age -= 1;
    return age >= 0 ? age : null;
};
