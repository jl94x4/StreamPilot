import type { PosterSetsWatch } from './types';
import { isLibraryPendingWatchError } from './shared/posterSetsFormat';
import {
    classifyRecentSet,
    RECENT_CATEGORY_ORDER,
    type RecentSetCategory,
} from './shared/posterSetsRecent';

export type PosterSetsWatchGroup = {
    key: string;
    title: string;
    thumbUrl: string;
    watches: PosterSetsWatch[];
    errored: boolean;
    lastCheckedAt: string | null;
};

export type CategorizedPosterSetsWatchGroup = PosterSetsWatchGroup & {
    category: RecentSetCategory;
    landscape: boolean;
};

export const WATCHING_CATEGORY_ORDER = RECENT_CATEGORY_ORDER;

/** Classify a watch for Watching Posters / Title cards / Backgrounds sections. */
export const classifyWatchArt = (
    watch: PosterSetsWatch,
    overrides?: Record<string, RecentSetCategory> | null,
): RecentSetCategory => {
    const forced = overrides?.[watch.id];
    if (forced) return forced;
    return classifyRecentSet({
        title: watch.title,
        setKind: watch.setKind,
        mediuxFilters: watch.mediuxFilters,
    });
};

/**
 * Partition watches by art type, then group within each category so poster +
 * title-card pins for the same show can appear in separate sections.
 */
export const groupPosterSetsWatchesByCategory = (
    watches: PosterSetsWatch[],
    overrides?: Record<string, RecentSetCategory> | null,
): CategorizedPosterSetsWatchGroup[] => {
    const byCategory: Record<RecentSetCategory, PosterSetsWatch[]> = {
        posters: [],
        backgrounds: [],
        title_cards: [],
    };
    for (const watch of watches) {
        byCategory[classifyWatchArt(watch, overrides)].push(watch);
    }
    const out: CategorizedPosterSetsWatchGroup[] = [];
    for (const category of WATCHING_CATEGORY_ORDER) {
        const groups = groupPosterSetsWatches(byCategory[category.id]);
        for (const group of groups) {
            out.push({
                ...group,
                key: `${category.id}:${group.key}`,
                category: category.id,
                landscape: category.landscape,
            });
        }
    }
    return out;
};

/** Normalize show/movie titles for Watching merge (years, pack words, punctuation). */
export const normalizeWatchTitleKey = (value: string) => {
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

const watchRecency = (watch: PosterSetsWatch) => {
    const raw = watch.updatedAt || watch.lastCheckedAt || watch.lastAppliedAt || watch.createdAt;
    if (!raw) return 0;
    const ms = new Date(raw).getTime();
    return Number.isFinite(ms) ? ms : 0;
};

const asId = (value: unknown) => {
    if (value == null || value === false) return '';
    const text = String(value).trim();
    if (!text || text === '0' || text.toLowerCase() === 'null' || text.toLowerCase() === 'none') return '';
    return text;
};

/**
 * Group Watching pins by show/movie.
 * Pre-existing pins often lack tmdbId on one provider — merge transitively via
 * tmdbId, tvdbId, and normalized title so TPDB + MediUX for the same show collapse.
 */
export const groupPosterSetsWatches = (watches: PosterSetsWatch[]): PosterSetsWatchGroup[] => {
    const parent = new Map<string, string>();
    const find = (id: string): string => {
        if (!parent.has(id)) parent.set(id, id);
        const current = parent.get(id)!;
        if (current !== id) parent.set(id, find(current));
        return parent.get(id)!;
    };
    const union = (a: string, b: string) => {
        const rootA = find(a);
        const rootB = find(b);
        if (rootA !== rootB) parent.set(rootA, rootB);
    };

    for (const watch of watches) {
        const watchKey = `watch:${watch.id}`;
        find(watchKey);
        const tmdbId = asId(watch.tmdbId);
        const tvdbId = asId(watch.tvdbId);
        const titleKey = normalizeWatchTitleKey(String(watch.title || ''));
        if (tmdbId) union(watchKey, `tmdb:${tmdbId}`);
        if (tvdbId) union(watchKey, `tvdb:${tvdbId}`);
        if (titleKey) union(watchKey, `title:${titleKey}`);
    }

    const order: string[] = [];
    const groups = new Map<string, PosterSetsWatch[]>();
    for (const watch of watches) {
        const key = find(`watch:${watch.id}`);
        if (!groups.has(key)) {
            groups.set(key, []);
            order.push(key);
        }
        groups.get(key)!.push(watch);
    }

    return order.map((key) => {
        const members = [...(groups.get(key) || [])].sort((a, b) => {
            const provider = String(a.provider || '').localeCompare(String(b.provider || ''));
            if (provider !== 0) return provider;
            const user = String(a.user || '').localeCompare(String(b.user || ''));
            if (user !== 0) return user;
            return watchRecency(b) - watchRecency(a);
        });
        const primary = [...members].sort((a, b) => {
            // Prefer a titled row with a real show name over "Set 12345".
            const aScore = (asId(a.tmdbId) ? 4 : 0)
                + (normalizeWatchTitleKey(String(a.title || '')) && !/^set\s*\d+$/i.test(String(a.title || '').trim()) ? 2 : 0)
                + (watchRecency(a) > 0 ? 1 : 0);
            const bScore = (asId(b.tmdbId) ? 4 : 0)
                + (normalizeWatchTitleKey(String(b.title || '')) && !/^set\s*\d+$/i.test(String(b.title || '').trim()) ? 2 : 0)
                + (watchRecency(b) > 0 ? 1 : 0);
            if (bScore !== aScore) return bScore - aScore;
            return watchRecency(b) - watchRecency(a);
        })[0] || members[0];
        const title = String(primary?.title || primary?.setId || primary?.url || 'Watch').trim();
        const thumbUrl = members.map((watch) => String(watch.thumbUrl || '').trim()).find(Boolean) || '';
        const lastCheckedAt = members
            .map((watch) => watch.lastCheckedAt)
            .filter(Boolean)
            .sort()
            .slice(-1)[0] || null;
        return {
            key,
            title,
            thumbUrl,
            watches: members,
            errored: members.some((watch) => Boolean(watch.lastError) && !isLibraryPendingWatchError(watch.lastError)),
            lastCheckedAt: lastCheckedAt ? String(lastCheckedAt) : null,
        };
    });
};

/** @deprecated Prefer groupPosterSetsWatches — kept for callers that only need a stable key. */
export const posterSetsWatchGroupKey = (watch: PosterSetsWatch) => {
    const tmdbId = asId(watch.tmdbId);
    if (tmdbId) return `tmdb:${tmdbId}`;
    const tvdbId = asId(watch.tvdbId);
    if (tvdbId) return `tvdb:${tvdbId}`;
    const titleKey = normalizeWatchTitleKey(String(watch.title || ''));
    if (titleKey) return `title:${titleKey}`;
    return `id:${watch.id}`;
};
