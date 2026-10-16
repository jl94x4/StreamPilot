import type { PosterSetsWatch } from './types';

export type WatchArtSlot = 'posters' | 'title_cards' | 'backgrounds';

const FILTER_TO_SLOT: Record<string, WatchArtSlot> = {
    show_cover: 'posters',
    season_cover: 'posters',
    title_card: 'title_cards',
    background: 'backgrounds',
};

const ALL_WATCH_SLOTS: WatchArtSlot[] = ['posters', 'title_cards', 'backgrounds'];

export const watchArtSlots = (watch?: {
    setKind?: string | null;
    mediuxFilters?: string[] | null;
} | null): Set<WatchArtSlot> => {
    const slots = new Set<WatchArtSlot>();
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

export const watchesOverlapArtSlots = (
    left?: { setKind?: string | null; mediuxFilters?: string[] | null } | null,
    right?: { setKind?: string | null; mediuxFilters?: string[] | null } | null,
) => {
    const other = watchArtSlots(right);
    for (const slot of watchArtSlots(left)) {
        if (other.has(slot)) return true;
    }
    return false;
};

export const formatWatchArtSlots = (slots: Iterable<WatchArtSlot> | Set<WatchArtSlot>) => {
    const list = [...slots];
    const labels: Record<WatchArtSlot, string> = {
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

export const overlappingTitleWatches = (
    watches: PosterSetsWatch[],
    incoming: {
        url?: string | null;
        title?: string | null;
        tmdbId?: string | null;
        setKind?: string | null;
        mediuxFilters?: string[] | null;
        plexHint?: { ratingKey?: string | null } | null;
    },
    sameTitle: (watch: PosterSetsWatch) => boolean,
) => {
    const incomingUrl = String(incoming.url || '').trim();
    return watches.filter((watch) => {
        const url = String(watch.url || '').trim();
        if (incomingUrl && url === incomingUrl) return false;
        if (!sameTitle(watch)) return false;
        return watchesOverlapArtSlots(watch, incoming);
    });
};
