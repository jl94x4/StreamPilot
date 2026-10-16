import type { LibraryRecentItem } from './libraryRecent';
import type { PosterSetsSearchTitle } from './types';

const stripDiacritics = (value: string) =>
    String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '');

/** Align with server-side poster title normalization for consistent matching. */
export const normalizeTitleMatchKey = (value: string): string => {
    let text = stripDiacritics(value).toLowerCase().trim();
    text = text.replace(/\(\s*(?:\d{4}|n\/a)\s*\)\s*$/i, '');
    text = text.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    return text;
};

const LEADING_ARTICLES = new Set(['the', 'a', 'an']);

const normalizeMediaType = (value?: string | null): 'show' | 'movie' | null => {
    const raw = String(value || '').toLowerCase();
    if (raw === 'show' || raw === 'tv' || raw === 'series') return 'show';
    if (raw === 'movie' || raw === 'film') return 'movie';
    return null;
};

const titleTokens = (value: string): string[] =>
    normalizeTitleMatchKey(value).split(' ').filter(Boolean);

const tokensWithoutLeadingArticle = (value: string): string[] => {
    const tokens = titleTokens(value);
    if (tokens.length > 1 && LEADING_ARTICLES.has(tokens[0])) return tokens.slice(1);
    return tokens;
};

/** Strip pack/collection noise so "Sugar (2024) Set" compares as "Sugar". */
export const normalizeSetTitleForMatch = (value: string): string => (
    normalizeTitleMatchKey(value)
        .replace(/\b(19|20)\d{2}\b/g, ' ')
        .replace(/\b(set|poster set|posters|collection|boxset|box set|pack|title cards?)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
);

const tokensContainPhrase = (haystack: string[], needle: string[]): boolean => {
    if (!needle.length || needle.length > haystack.length) return false;
    for (let i = 0; i <= haystack.length - needle.length; i += 1) {
        if (needle.every((token, index) => haystack[i + index] === token)) return true;
    }
    return false;
};

const mediaTypeMatches = (libraryItem: LibraryRecentItem, candidate: PosterSetsSearchTitle): boolean => {
    const candMedia = normalizeMediaType(candidate.mediaType);
    return !candMedia || candMedia === libraryItem.mediaType;
};

/** Auto-match requires an exact year when the library item has one.
 *  Movies: ±1 for festival vs theatrical.
 *  Shows: wider window — Plex often stores the latest season year while catalogs use premiere year
 *  (e.g. Sugar S2 → library 2026, MediUX/TPDB "Sugar (2024)").
 */
export const yearMatchTolerance = (mediaType?: string | null): number => {
    const raw = String(mediaType || '').toLowerCase();
    if (raw === 'show' || raw === 'tv' || raw === 'series') return 5;
    return 1;
};

export const strictYearMatches = (
    libraryYear: number | null | undefined,
    candidateYear: number | null | undefined,
    options?: { tolerance?: number },
): boolean => {
    if (libraryYear == null) return true;
    if (candidateYear == null) return false;
    const tolerance = Number.isFinite(Number(options?.tolerance))
        ? Math.max(0, Number(options?.tolerance))
        : 1;
    return Math.abs(libraryYear - candidateYear) <= tolerance;
};

/**
 * True when catalog title is the same work — not a longer/shorter variant
 * (e.g. "Furious" must not match "Furious Attack").
 */
export const strictTitleMatches = (libraryTitle: string, candidateTitle: string): boolean => {
    const libKey = normalizeTitleMatchKey(libraryTitle);
    const candKey = normalizeTitleMatchKey(candidateTitle);
    if (!libKey || !candKey) return false;
    if (libKey === candKey) return true;

    const libTokens = tokensWithoutLeadingArticle(libraryTitle);
    const candTokens = tokensWithoutLeadingArticle(candidateTitle);
    if (!libTokens.length || !candTokens.length) return false;

    // Same words, optional leading article difference only.
    if (libTokens.length === candTokens.length) {
        return libTokens.every((token, index) => token === candTokens[index]);
    }

    return false;
};

/**
 * Poster set cards must belong to the library work.
 * "The Python Hunt" must not accept "Monty Python Collection" just because "Python" overlaps.
 */
export const setTitleMatchesWork = (workTitle: string, setTitle: string): boolean => {
    const workTokens = tokensWithoutLeadingArticle(workTitle);
    const setTokens = tokensWithoutLeadingArticle(normalizeSetTitleForMatch(setTitle));
    if (!workTokens.length || !setTokens.length) return false;
    if (strictTitleMatches(workTitle, normalizeSetTitleForMatch(setTitle))) return true;
    // Single-word works must be the whole set title after noise strip ("Python" ≠ "Monty Python").
    if (workTokens.length === 1) {
        return setTokens.length === 1 && setTokens[0] === workTokens[0];
    }
    // Multi-word: require the full work title as a contiguous phrase in the set title.
    return tokensContainPhrase(setTokens, workTokens);
};

export const catalogTitleMatchesWork = (
    work: { title: string; year?: number | null; mediaType?: string | null },
    candidate: { title?: string | null; year?: number | null; mediaType?: string | null },
    options?: { yearRequired?: boolean },
): boolean => {
    if (!candidate?.title) return false;
    if (!strictTitleMatches(work.title, candidate.title)) return false;
    const media = normalizeMediaType(candidate.mediaType);
    const wantMedia = normalizeMediaType(work.mediaType);
    if (media && wantMedia && media !== wantMedia) return false;
    if (work.year == null) return true;
    if (candidate.year == null) return options?.yearRequired === false;
    return strictYearMatches(work.year, candidate.year, {
        tolerance: yearMatchTolerance(work.mediaType),
    });
};

export const filterSetsForWork = <T extends { title?: string | null }>(
    sets: T[],
    workTitle: string,
): T[] => {
    const list = Array.isArray(sets) ? sets : [];
    if (!workTitle.trim()) return list;
    const filtered = list.filter((set) => setTitleMatchesWork(workTitle, String(set?.title || '')));
    // TPDB set cards often show creator handles (@user) — don't discard a whole title page.
    if (filtered.length === 0 && list.length > 0) return list;
    return filtered;
};

const rankTitleCandidate = (
    libraryItem: LibraryRecentItem,
    candidate: PosterSetsSearchTitle,
): number => {
    let score = 0;
    if (strictTitleMatches(libraryItem.title, candidate.title)) score += 100;
    if (libraryItem.year != null && candidate.year != null) {
        const delta = Math.abs(libraryItem.year - candidate.year);
        const slack = yearMatchTolerance(libraryItem.mediaType);
        if (delta === 0) score += 50;
        else if (delta <= slack) score += Math.max(10, 40 - delta * 6);
        else score -= 40;
    } else if (strictYearMatches(
        libraryItem.year,
        candidate.year ?? null,
        { tolerance: yearMatchTolerance(libraryItem.mediaType) },
    )) {
        score += 50;
    }

    const candMedia = normalizeMediaType(candidate.mediaType);
    if (candMedia) score += candMedia === libraryItem.mediaType ? 20 : -100;

    const sourceCount = candidate.sources?.length || (candidate.provider ? 1 : 0);
    score += Math.min(sourceCount, 2) * 3;

    return score;
};

const isStrictAutoMatch = (
    libraryItem: LibraryRecentItem,
    candidate: PosterSetsSearchTitle,
): boolean => (
    mediaTypeMatches(libraryItem, candidate)
    && strictTitleMatches(libraryItem.title, candidate.title)
    && strictYearMatches(
        libraryItem.year,
        candidate.year ?? null,
        { tolerance: yearMatchTolerance(libraryItem.mediaType) },
    )
);

/** True when a loaded catalog title still looks like the library item (guards wrong TMDB hits). */
export const catalogTitleMatchesLibraryItem = (
    libraryItem: Pick<LibraryRecentItem, 'title' | 'year' | 'mediaType'>,
    catalogTitle?: Pick<PosterSetsSearchTitle, 'title' | 'year' | 'mediaType'> | null,
): boolean => {
    if (!catalogTitle?.title) return false;
    return catalogTitleMatchesWork(libraryItem, catalogTitle);
};

/**
 * Pick a single catalog title from search results using library name, year, and media type.
 * Returns null when matches are ambiguous or no exact title(+year) hit exists.
 */
export const pickAutoMatchedTitle = (
    libraryItem: LibraryRecentItem,
    titles: PosterSetsSearchTitle[],
): PosterSetsSearchTitle | null => {
    if (!titles.length) return null;

    const viable = titles.filter((title) => mediaTypeMatches(libraryItem, title));
    const pool = viable.length ? viable : titles;
    const showDrift = yearMatchTolerance(libraryItem.mediaType);

    // Prefer exact year, then near drift, for a unique title match.
    const exactYear = pool.filter((title) => (
        mediaTypeMatches(libraryItem, title)
        && strictTitleMatches(libraryItem.title, title.title)
        && strictYearMatches(libraryItem.year, title.year ?? null, { tolerance: 0 })
    ));
    if (exactYear.length === 1) return exactYear[0];
    if (exactYear.length > 1) return null;

    const nearYear = pool.filter((title) => (
        mediaTypeMatches(libraryItem, title)
        && strictTitleMatches(libraryItem.title, title.title)
        && strictYearMatches(libraryItem.year, title.year ?? null, { tolerance: 1 })
    ));
    if (nearYear.length === 1) return nearYear[0];
    if (nearYear.length > 1) {
        // Prefer closest year when multiple festival/theatrical variants exist.
        return [...nearYear].sort((a, b) => {
            const aDelta = Math.abs(Number(a.year) - Number(libraryItem.year));
            const bDelta = Math.abs(Number(b.year) - Number(libraryItem.year));
            return aDelta - bDelta;
        })[0] || null;
    }

    // Returning series: Plex year trails the premiere year by more than ±1.
    if (showDrift > 1) {
        const drifted = pool.filter((title) => (
            mediaTypeMatches(libraryItem, title)
            && strictTitleMatches(libraryItem.title, title.title)
            && strictYearMatches(libraryItem.year, title.year ?? null, { tolerance: showDrift })
        ));
        if (drifted.length === 1) return drifted[0];
        if (drifted.length > 1 && libraryItem.year != null) {
            // Prefer premiere-or-earlier years (candidate <= library), then closest.
            return [...drifted].sort((a, b) => {
                const aYear = Number(a.year);
                const bYear = Number(b.year);
                const aFuture = aYear > Number(libraryItem.year) ? 1 : 0;
                const bFuture = bYear > Number(libraryItem.year) ? 1 : 0;
                if (aFuture !== bFuture) return aFuture - bFuture;
                return Math.abs(aYear - Number(libraryItem.year)) - Math.abs(bYear - Number(libraryItem.year));
            })[0] || null;
        }
    }

    // When the library item has no year, allow a unique exact title match.
    if (libraryItem.year == null) {
        const exactTitle = pool.filter((title) => (
            strictTitleMatches(libraryItem.title, title.title)
            && mediaTypeMatches(libraryItem, title)
        ));
        if (exactTitle.length === 1) return exactTitle[0];
        if (exactTitle.length > 1) return null;
    }

    return null;
};

/** Sort search titles for manual pick lists — best title+year matches first. */
export const rankSearchTitlesForLibraryItem = (
    libraryItem: LibraryRecentItem,
    titles: PosterSetsSearchTitle[],
): PosterSetsSearchTitle[] => (
    [...titles].sort((a, b) => rankTitleCandidate(libraryItem, b) - rankTitleCandidate(libraryItem, a))
);
