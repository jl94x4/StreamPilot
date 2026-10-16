/** TMDB keyword used by Seerr / Overseerr / Jellyseerr for anime routing. */
export const TMDB_ANIME_KEYWORD_ID = 210024;
/** TMDB genre id for Animation (TV and movies). */
export const TMDB_ANIMATION_GENRE_ID = 16;

const ANIM_FOLDER_RE = /(?:^|[\\/_\-\s])(?:anime|animes|animation|animés|animé)(?:$|[\\/_\-\s])/i;

const asList = (value) => (Array.isArray(value) ? value : []);

const keywordEntries = (value) => {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.results)) return value.results;
    if (Array.isArray(value?.keywords)) return value.keywords;
    return [];
};

const genreId = (entry) => Number(entry?.id ?? entry);
const genreName = (entry) => String(entry?.name || (typeof entry === 'string' ? entry : '')).toLowerCase();
const keywordId = (entry) => Number(entry?.id ?? entry);
const keywordName = (entry) => String(entry?.name || (typeof entry === 'string' ? entry : '')).toLowerCase();

export const hasAnimeKeyword = (keywords = []) => keywordEntries(keywords).some((entry) => (
    keywordId(entry) === TMDB_ANIME_KEYWORD_ID
    || keywordName(entry) === 'anime'
));

export const hasAnimationGenre = (genres = []) => asList(genres).some((entry) => (
    genreId(entry) === TMDB_ANIMATION_GENRE_ID
    || /animat/.test(genreName(entry))
));

export const isJapaneseOrigin = (details = {}) => {
    const language = String(details.originalLanguage || details.original_language || '').toLowerCase();
    if (language === 'ja' || language === 'jpn') return true;
    const countries = asList(details.originCountry || details.origin_country);
    return countries.some((entry) => String(entry || '').toUpperCase() === 'JP');
};

/**
 * Whether this title should use the anime quality profile / root folder.
 * Japanese anime only — Western cartoons (Adventure Time, Pixar) stay on the standard folder.
 * Live-action Japanese TV is also excluded unless TMDB tagged it with the anime keyword.
 */
export const detectAnimeMedia = (details = {}, { mediaType } = {}) => {
    if (details?.isAnime === true) return true;
    if (hasAnimeKeyword(details?.keywords)) return true;
    const type = String(mediaType || details?.mediaType || '').toLowerCase();
    if (type !== 'tv' && type !== 'movie') return false;
    return hasAnimationGenre(details?.genres) && isJapaneseOrigin(details);
};

const normalizeFolderPath = (path) => String(path || '').trim().replace(/[\\/]+$/, '');

const matchFolderPath = (wanted, folders = []) => {
    const needle = normalizeFolderPath(wanted);
    if (!needle) return '';
    const list = asList(folders);
    const hit = list.find((folder) => normalizeFolderPath(folder?.path) === needle);
    return hit?.path || '';
};

export const inferAnimeRootFolderPath = (rootFolders = []) => {
    const hit = asList(rootFolders).find((folder) => ANIM_FOLDER_RE.test(String(folder?.path || '').toLowerCase()));
    return hit?.path || null;
};

export const resolveAnimeAwareRootFolder = ({
    isAnime = false,
    activeAnimeDirectory = '',
    activeDirectory = '',
    rootFolders = [],
} = {}) => {
    const folders = asList(rootFolders);
    if (isAnime) {
        const configured = matchFolderPath(activeAnimeDirectory, folders) || String(activeAnimeDirectory || '').trim();
        if (configured) return configured;
        const named = inferAnimeRootFolderPath(folders);
        if (named) return named;
    }
    return matchFolderPath(activeDirectory, folders)
        || String(activeDirectory || '').trim()
        || folders[0]?.path
        || '';
};
