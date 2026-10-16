/**
 * Genre helpers for achievements — best-effort from history metadata.
 */

/** Canonical genres and label aliases (Plex / Jellyfin / TMDB naming quirks). */
export const GENRE_CATALOG = [
    { id: 'action', label: 'Action', aliases: ['action', 'accion', 'ação', 'azione', '액션'], icon: '💥', movieName: 'Action Hero', showName: 'Action Marathon' },
    { id: 'adventure', label: 'Adventure', aliases: ['adventure', 'aventure', 'aventura', 'abenteuer', 'avventura'], icon: '🧭', movieName: 'Trailblazer', showName: 'Quest Mode' },
    { id: 'animation', label: 'Animation', aliases: ['animation', 'animated', 'animacion', 'animación', 'animação', 'zeichentrick', 'animazione'], icon: '🖌️', movieName: 'Toon Ticket', showName: 'Toon Time' },
    { id: 'anime', label: 'Anime', aliases: ['anime'], icon: '🍥', movieName: 'Anime Frame', showName: 'Anime Arc' },
    { id: 'biography', label: 'Biography', aliases: ['biography', 'biographical', 'biographie', 'biografia', 'biografía', 'biografie'], icon: '📕', movieName: 'Life Story', showName: 'Real Lives' },
    { id: 'comedy', label: 'Comedy', aliases: ['comedy', 'sitcom', 'slapstick', 'comedie', 'comédie', 'comedia', 'comédia', 'komodie', 'komödie', 'commedia'], icon: '😂', movieName: 'Comedy Club', showName: 'Laugh Track' },
    { id: 'crime', label: 'Crime', aliases: ['crime', 'policier', 'krimi', 'crimen', 'policiaco', 'poliziesco'], icon: '🕵️', movieName: 'Case File', showName: 'Crime Scene' },
    { id: 'documentary', label: 'Documentary', aliases: ['documentary', 'docuseries', 'documentaire', 'documental', 'documentario', 'documentário', 'dokumentation', 'dokumentarfilm'], icon: '🎥', movieName: 'True Lens', showName: 'Doc Hours' },
    { id: 'drama', label: 'Drama', aliases: ['drama', 'drame', 'dramma'], icon: '🎭', movieName: 'Stage Lights', showName: 'Drama Desk' },
    { id: 'family', label: 'Family', aliases: ['family', 'children', 'kids', 'childrens', 'familial', 'famille', 'familia', 'família', 'familie', 'famiglia'], icon: '👨‍👩‍👧‍👦', movieName: 'Family Night', showName: 'Family Room' },
    { id: 'fantasy', label: 'Fantasy', aliases: ['fantasy', 'fantastique', 'fantasia', 'fantasía', 'fantasie', 'fantastico'], icon: '🧙', movieName: 'Spellbound', showName: 'Realm Hopper' },
    { id: 'history', label: 'History', aliases: ['history', 'historical', 'histoire', 'historique', 'historia', 'histórico', 'geschichte', 'historisch', 'storia', 'storico'], icon: '🏛️', movieName: 'History Buff', showName: 'Timeline' },
    { id: 'horror', label: 'Horror', aliases: ['horror', 'horreur', 'epouvante', 'épouvante', 'terror', 'orrore'], icon: '👻', movieName: 'Scream Queen', showName: 'Chills' },
    { id: 'music', label: 'Music', aliases: ['music', 'musical', 'musique', 'musica', 'música', 'musik'], icon: '🎶', movieName: 'Soundtrack', showName: 'Music Series' },
    { id: 'mystery', label: 'Mystery', aliases: ['mystery', 'mystere', 'mystère', 'misterio', 'mistério', 'mistero'], icon: '🧩', movieName: 'Whodunit', showName: 'Clue Crew' },
    { id: 'romance', label: 'Romance', aliases: ['romance', 'romantic', 'romantique', 'romantico', 'romántico', 'liebesfilm'], icon: '💞', movieName: 'Heartstrings', showName: 'Shipper' },
    { id: 'scifi', label: 'Sci-Fi', aliases: ['sci-fi', 'sci fi', 'science fiction', 'science-fiction', 'sciencefiction', 'scifi', 'sf', 'ciencia ficcion', 'ciencia ficción', 'ficcao cientifica', 'ficção científica', 'fantascienza'], icon: '🚀', movieName: 'Warp Drive', showName: 'Outer Limits' },
    { id: 'sport', label: 'Sport', aliases: ['sport', 'sports', 'deporte', 'esporte', 'sportivo'], icon: '🏆', movieName: 'Game Day', showName: 'Sports Desk' },
    { id: 'thriller', label: 'Thriller', aliases: ['thriller', 'suspense', 'suspenso', 'suspenseful'], icon: '🔪', movieName: 'Edge of Seat', showName: 'Suspense Hour' },
    { id: 'war', label: 'War', aliases: ['war', 'guerre', 'guerra', 'krieg', 'belica', 'bélica', 'war & politics', 'war and politics'], icon: '🪖', movieName: 'Front Line', showName: 'War Stories' },
    { id: 'western', label: 'Western', aliases: ['western'], icon: '🤠', movieName: 'High Noon', showName: 'Frontier' },
];

const foldGenreKey = (raw) => String(raw || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .trim();

const aliasToId = (() => {
    const map = new Map();
    const add = (label, id) => {
        const key = foldGenreKey(label);
        if (key) map.set(key, id);
    };
    for (const genre of GENRE_CATALOG) {
        add(genre.id, genre.id);
        add(genre.label, genre.id);
        for (const alias of genre.aliases) add(alias, genre.id);
    }
    return map;
})();

export const normalizeGenreId = (raw) => {
    const key = foldGenreKey(raw);
    if (!key) return null;
    return aliasToId.get(key) || null;
};

/** Split TMDB/Plex compound tags like "Sci-Fi & Fantasy" / "Action/Adventure". */
export const splitGenreLabel = (label) => {
    const raw = String(label || '').trim();
    if (!raw) return [];
    const parts = raw.split(/(?:\s*[&/,|·•]\s*|\s+(?:and|et|y|e)\s+)/i)
        .map((part) => part.trim())
        .filter(Boolean);
    if (parts.length <= 1) return [raw];
    return [raw, ...parts];
};

/** Pull genre tags from a Plex/Jellyfin-like history or metadata row. */
export const extractGenreLabels = (item) => {
    if (!item || typeof item !== 'object') return [];
    const out = [];
    const seen = new Set();
    const push = (val) => {
        if (val == null) return;
        if (typeof val === 'string') {
            for (const chunk of String(val).split(/[,|]/)) {
                const t = chunk.trim();
                if (!t) continue;
                const key = foldGenreKey(t);
                if (!key || seen.has(key)) continue;
                seen.add(key);
                out.push(t);
            }
            return;
        }
        if (typeof val === 'object') {
            const t = String(val.tag || val.Name || val.name || val.Genre || '').trim();
            if (!t) return;
            const key = foldGenreKey(t);
            if (!key || seen.has(key)) return;
            seen.add(key);
            out.push(t);
        }
    };

    if (Array.isArray(item.Genre)) item.Genre.forEach(push);
    else if (item.Genre) push(item.Genre);
    if (Array.isArray(item.Genres)) item.Genres.forEach(push);
    if (Array.isArray(item.genres)) item.genres.forEach(push);
    else if (item.genres) push(item.genres);
    if (typeof item.genre === 'string') push(item.genre);
    if (Array.isArray(item.genre)) item.genre.forEach(push);

    // Episode rows sometimes only carry show genres on nested objects.
    if (item.grandparentGenre) push(item.grandparentGenre);
    if (Array.isArray(item.grandparentGenres)) item.grandparentGenres.forEach(push);

    return out;
};

export const extractCanonicalGenreIds = (item) => {
    const ids = new Set();
    for (const label of extractGenreLabels(item)) {
        for (const part of splitGenreLabel(label)) {
            const id = normalizeGenreId(part);
            if (id) ids.add(id);
        }
    }
    return [...ids];
};

export const ratingKeyFromHistoryItem = (item) => {
    const type = String(item?.type || '').toLowerCase();
    if (type === 'movie') {
        const key = String(item.ratingKey || '').trim();
        if (key && /^\d+$/.test(key)) return key;
        const fromPath = String(item.key || '').match(/\/(\d+)(?:\?|$)/);
        return fromPath?.[1] || null;
    }
    if (type === 'episode') {
        const show = String(item.grandparentRatingKey || '').trim();
        if (show && /^\d+$/.test(show)) return show;
        const fromGp = String(item.grandparentKey || '').match(/\/(\d+)(?:\?|$)/);
        if (fromGp?.[1]) return fromGp[1];
        const ep = String(item.ratingKey || '').trim();
        return ep && /^\d+$/.test(ep) ? ep : null;
    }
    return null;
};

export const itemNeedsGenreEnrichment = (item) => {
    const type = String(item?.type || '').toLowerCase();
    if (type !== 'movie' && type !== 'episode') return false;
    return extractCanonicalGenreIds(item).length === 0;
};

export const mergeGenreTagsOntoItem = (item, tags = []) => {
    if (!item || typeof item !== 'object') return item;
    const incoming = (Array.isArray(tags) ? tags : [tags]).map((tag) => String(tag || '').trim()).filter(Boolean);
    if (!incoming.length) return item;
    const existing = extractGenreLabels(item);
    const merged = [];
    const seen = new Set();
    for (const label of [...existing, ...incoming]) {
        const key = foldGenreKey(label);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push(label);
    }
    item.Genre = merged.map((tag) => ({ tag }));
    return item;
};

export const genreMovieMetric = (genreId) => `genreMovies_${genreId}`;
export const genreShowMetric = (genreId) => `genreShows_${genreId}`;

export const emptyGenreStatFields = () => {
    const fields = { genreTagsSeen: 0 };
    for (const g of GENRE_CATALOG) {
        fields[genreMovieMetric(g.id)] = 0;
        fields[genreShowMetric(g.id)] = 0;
    }
    return fields;
};

/** Bump when genre scoring/enrichment behavior changes so stale 0/10 snapshots rescore. */
export const GENRE_ENRICHMENT_VERSION = 2;

export const snapshotNeedsGenreRescore = (snapshot) => {
    if ((Number(snapshot?.genreEnrichmentVersion) || 0) >= GENRE_ENRICHMENT_VERSION) return false;
    const stats = snapshot?.stats || {};
    return (Number(stats.uniqueMovies) || 0) + (Number(stats.uniqueShows) || 0) > 0;
};
