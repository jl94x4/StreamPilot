/**
 * Title-level watch matching.
 * Strong ids (tmdb / tvdb / Plex rating key) win; title is the fallback when ids are missing.
 * Complementary pins are allowed: posters, title cards, and backdrops can each have their own set.
 */

const asId = (value) => {
    if (value == null || value === false) return '';
    const text = String(value).trim();
    if (!text || text === '0' || text.toLowerCase() === 'null' || text.toLowerCase() === 'none') return '';
    return text;
};

const FILTER_TO_SLOT = {
    show_cover: 'posters',
    season_cover: 'posters',
    title_card: 'title_cards',
    background: 'backgrounds',
};

const ALL_WATCH_SLOTS = ['posters', 'title_cards', 'backgrounds'];

export const normalizeWatchTitleKey = (value) => {
    let text = String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
    text = text.replace(/\(\s*(?:\d{4}|n\/a)\s*\)\s*$/i, '');
    text = text.replace(/\b(set|poster set|posters|title cards?|season posters?|collection|system)\b/g, ' ');
    text = text.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    return text;
};

export const watchesShareTitle = (left, right) => {
    if (!left || !right) return false;
    const aTmdb = asId(left.tmdbId ?? left.tmdb_id);
    const bTmdb = asId(right.tmdbId ?? right.tmdb_id);
    if (aTmdb && bTmdb) return aTmdb === bTmdb;

    const aTvdb = asId(left.tvdbId ?? left.tvdb_id);
    const bTvdb = asId(right.tvdbId ?? right.tvdb_id);
    if (aTvdb && bTvdb) return aTvdb === bTvdb;

    const aKey = asId(left.plexHint?.ratingKey);
    const bKey = asId(right.plexHint?.ratingKey);
    if (aKey && bKey) return aKey === bKey;

    const aTitle = normalizeWatchTitleKey(left.title || left.plexHint?.title);
    const bTitle = normalizeWatchTitleKey(right.title || right.plexHint?.title);
    return Boolean(aTitle && aTitle === bTitle);
};

export const watchArtSlots = (watch) => {
    const slots = new Set();
    const filters = Array.isArray(watch?.mediuxFilters) ? watch.mediuxFilters : [];
    for (const raw of filters) {
        const slot = FILTER_TO_SLOT[String(raw || '').trim().toLowerCase()];
        if (slot) slots.add(slot);
    }
    if (slots.size) return slots;
    const kind = String(watch?.setKind || '').trim().toLowerCase().replace(/-/g, '_');
    if (kind === 'title_card' || kind === 'title_cards') return new Set(['title_cards']);
    if (kind === 'background' || kind === 'backgrounds') return new Set(['backgrounds']);
    if (kind === 'poster' || kind === 'posters') return new Set(['posters']);
    return new Set(ALL_WATCH_SLOTS);
};

export const watchesOverlapArtSlots = (left, right) => {
    const other = watchArtSlots(right);
    for (const slot of watchArtSlots(left)) {
        if (other.has(slot)) return true;
    }
    return false;
};

export const setKindFromFilters = (filters) => {
    const slots = watchArtSlots({ mediuxFilters: filters });
    if (slots.size === 1) return [...slots][0];
    return null;
};

export const filtersWithoutSlots = (filters, slotsToRemove) => {
    const remove = slotsToRemove instanceof Set ? slotsToRemove : new Set(slotsToRemove || []);
    return (Array.isArray(filters) ? filters : []).filter((raw) => {
        const slot = FILTER_TO_SLOT[String(raw || '').trim().toLowerCase()];
        return !slot || !remove.has(slot);
    });
};

export const formatWatchArtSlots = (slots) => {
    const list = [...(slots instanceof Set ? slots : new Set(slots || []))];
    const labels = {
        posters: 'posters',
        title_cards: 'title cards',
        backgrounds: 'backdrops',
    };
    const named = list.map((slot) => labels[slot] || slot);
    if (!named.length || named.length >= ALL_WATCH_SLOTS.length) return 'this title';
    if (named.length === 1) return named[0];
    if (named.length === 2) return `${named[0]} and ${named[1]}`;
    return named.join(', ');
};

export const findSameTitleWatches = (watches, candidate) => {
    if (!candidate) return [];
    const incomingUrl = String(candidate.url || '').trim();
    const incomingId = candidate.id != null ? String(candidate.id) : '';
    return (Array.isArray(watches) ? watches : []).filter((watch) => {
        if (!watch) return false;
        if (incomingId && String(watch.id) === incomingId) return false;
        if (incomingUrl && String(watch.url || '').trim() === incomingUrl) return false;
        return watchesShareTitle(watch, candidate);
    });
};

export const findOverlappingTitleWatches = (watches, candidate) => (
    findSameTitleWatches(watches, candidate).filter((watch) => watchesOverlapArtSlots(watch, candidate))
);
