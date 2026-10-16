import { portalUrl } from '../shared/basePath';

const languageNames = typeof Intl !== 'undefined'
    ? new Intl.DisplayNames(['en'], { type: 'language' })
    : null;
const regionNames = typeof Intl !== 'undefined'
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null;

export type CombinedRatings = {
    rt?: {
        criticsScore?: number | null;
        criticsRating?: string | null;
        audienceScore?: number | null;
        audienceRating?: string | null;
        url?: string | null;
    } | null;
    imdb?: {
        criticsScore?: number | null;
        criticsScoreCount?: number | null;
        url?: string | null;
    } | null;
};

const CREW_JOB_PRIORITY = [
    'Director',
    'Creator',
    'Screenplay',
    'Writer',
    'Story',
    'Executive Producer',
    'Producer',
    'Editor',
    'Director of Photography',
    'Original Music Composer',
];

export const formatMediaCurrency = (value?: number | null): string | null => {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
    }).format(amount).replace(/([A-Z]{2})\$/, '$1 $');
};

export const formatLanguageName = (code?: string | null): string | null => {
    const normalized = String(code || '').trim().toLowerCase();
    if (!normalized) return null;
    try {
        return languageNames?.of(normalized) || normalized.toUpperCase();
    } catch {
        return normalized.toUpperCase();
    }
};

export const formatCountryName = (country: { iso_3166_1?: string; name?: string } | string): string => {
    if (typeof country === 'string') {
        const code = country.trim().toUpperCase();
        if (!code) return '';
        try {
            return regionNames?.of(code) || code;
        } catch {
            return code;
        }
    }
    if (country?.name) return country.name;
    return formatCountryName(country?.iso_3166_1 || '');
};

export const formatDetailDate = (value?: string | null): string | null => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value.substring(0, 10);
    return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
};

export const sortKeyCrew = (crew: any[] = []) => {
    const priority = new Map(CREW_JOB_PRIORITY.map((job, index) => [job, index]));
    return [...crew].sort((a, b) => {
        const left = priority.get(a?.job) ?? 100;
        const right = priority.get(b?.job) ?? 100;
        if (left !== right) return left - right;
        return String(a?.job || '').localeCompare(String(b?.job || ''));
    });
};

export const pickTrailerUrl = (videos: any[] | undefined): string | null => {
    const list = Array.isArray(videos) ? videos : [];
    const trailer = list.find((video) => video?.type === 'Trailer' && video?.site === 'YouTube')
        || list.find((video) => video?.site === 'YouTube');
    if (!trailer) return null;
    if (trailer.url) return trailer.url;
    if (trailer.key) return `https://www.youtube.com/watch?v=${trailer.key}`;
    return null;
};

export const buildExternalLinks = (
    mediaType: 'movie' | 'tv',
    details: any,
    ratings?: CombinedRatings | null,
) => {
    const id = Number(details?.id ?? details?.tmdbId);
    const externalIds = details?.externalIds || {};
    const imdbId = externalIds.imdbId || details?.imdbId || null;
    const tvdbId = externalIds.tvdbId || details?.tvdbId || null;
    const links: { key: string; label: string; url: string }[] = [];

    if (Number.isFinite(id) && id > 0) {
        links.push({
            key: 'tmdb',
            label: 'TMDB',
            url: mediaType === 'movie'
                ? `https://www.themoviedb.org/movie/${id}`
                : `https://www.themoviedb.org/tv/${id}`,
        });
    }
    if (imdbId) {
        links.push({
            key: 'imdb',
            label: 'IMDb',
            url: `https://www.imdb.com/title/${imdbId}/`,
        });
    }
    if (tvdbId) {
        links.push({
            key: 'tvdb',
            label: 'TVDB',
            url: `https://www.thetvdb.com/?tab=series&id=${tvdbId}`,
        });
    }
    if (ratings?.rt?.url) {
        links.push({ key: 'rt', label: 'Rotten Tomatoes', url: ratings.rt.url });
    }
    if (ratings?.imdb?.url && !links.some((link) => link.key === 'imdb')) {
        links.push({ key: 'imdb', label: 'IMDb', url: ratings.imdb.url });
    }

    return links;
};

export type MediaFactRow = {
    key: string;
    label: string;
    value: string;
    people?: { id: number; name: string }[];
};

export type ProductionStudio = {
    id: number;
    name: string;
};

export const getProductionStudios = (details: any): ProductionStudio[] => (
    (Array.isArray(details?.productionCompanies) ? details.productionCompanies : [])
        .map((company: any) => ({
            id: Number(company?.id),
            name: String(company?.name || '').trim(),
        }))
        .filter((company) => company.name && Number.isFinite(company.id) && company.id > 0)
);

export const buildMediaFactRows = (
    mediaType: 'movie' | 'tv',
    details: any,
): MediaFactRow[] => {
    const rows: MediaFactRow[] = [];

    if (details?.status) {
        rows.push({ key: 'status', label: 'Production status', value: String(details.status) });
    }

    if (mediaType === 'movie') {
        const releaseDate = formatDetailDate(details?.releaseDate);
        if (releaseDate) rows.push({ key: 'release', label: 'Release date', value: releaseDate });
    } else {
        const premiere = formatDetailDate(details?.firstAirDate);
        if (premiere) rows.push({ key: 'premiere', label: 'First aired', value: premiere });
        const lastAired = formatDetailDate(details?.lastAirDate);
        if (lastAired) rows.push({ key: 'last-aired', label: 'Last aired', value: lastAired });
        const creators = (Array.isArray(details?.createdBy) ? details.createdBy : [])
            .map((person: any) => ({
                id: Number(person?.id),
                name: String(person?.name || '').trim(),
            }))
            .filter((person) => person.name && Number.isFinite(person.id) && person.id > 0);
        if (creators.length) {
            rows.push({
                key: 'created-by',
                label: 'Created by',
                value: creators.map((person) => person.name).join(', '),
                people: creators,
            });
        }
    }

    if (mediaType === 'movie') {
        const revenue = formatMediaCurrency(details?.revenue);
        if (revenue) rows.push({ key: 'revenue', label: 'Revenue', value: revenue });
        const budget = formatMediaCurrency(details?.budget);
        if (budget) rows.push({ key: 'budget', label: 'Budget', value: budget });
    }

    const language = formatLanguageName(details?.originalLanguage);
    if (language) rows.push({ key: 'language', label: 'Original language', value: language });

    const countries = (Array.isArray(details?.productionCountries) ? details.productionCountries : [])
        .map((country: any) => formatCountryName(country))
        .filter(Boolean);
    if (countries.length) {
        rows.push({
            key: 'countries',
            label: countries.length === 1 ? 'Production country' : 'Production countries',
            value: countries.join(', '),
        });
    }

    const originalTitle = details?.originalTitle || details?.originalName;
    const displayTitle = details?.title || details?.name;
    if (originalTitle && originalTitle !== displayTitle) {
        rows.push({ key: 'original-title', label: 'Original title', value: String(originalTitle) });
    }

    if (mediaType === 'tv' && details?.episodeRunTime?.length) {
        const runtime = Number(details.episodeRunTime[0]);
        if (runtime > 0) {
            rows.push({ key: 'episode-runtime', label: 'Episode runtime', value: `${runtime} min` });
        }
    }

    return rows;
};

/** Fetch RT/IMDb combined ratings via portal backend (Seerr ratingscombined + fallbacks). */
export const fetchCombinedRatings = async (
    mediaType: 'movie' | 'tv',
    mediaId: number,
): Promise<CombinedRatings | null> => {
    const path = `/api/discovery/ratings/${mediaType}/${mediaId}`;
    try {
        const response = await fetch(portalUrl(path), {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
        });
        if (response.status === 404) return {};
        if (!response.ok) return null;
        const data = await response.json();
        if (data?.error) return null;
        return data;
    } catch {
        return null;
    }
};
