import type { PlayerItem } from './types';

/**
 * Turns the titles a person has watched into the numbers on the Insights page.
 *
 * Plex only gives the server owner a real play log, so every profile's stats are built from what
 * each title says about itself: how many times it was played, when it was last watched, how long it
 * runs, its genres. That is enough for totals and favourites; times of day and months describe when
 * a title was LAST watched (one point per title), not every play.
 */

const DEFAULT_EPISODE_MS = 45 * 60_000;
const HOUR_MS = 3_600_000;

export type InsightRow = { name: string; titles: number; hours: number };
export type InsightFavourite = { item: PlayerItem; episodes: number; plays: number; hours: number };
export type InsightFact = { id: string; value: string; detail: string; params?: Record<string, string | number> };

export type WatchInsights = {
    titles: number;
    movies: number;
    shows: number;
    showsFinished: number;
    showsInProgress: number;
    episodes: number;
    rewatches: number;
    hours: number;
    days: number;
    genres: InsightRow[];
    decades: Array<{ label: string; titles: number }>;
    studios: Array<{ name: string; titles: number }>;
    weekdays: number[];
    /** Morning 5-12, afternoon 12-17, evening 17-22, night 22-5. */
    partsOfDay: number[];
    months: Array<{ key: string; label: string; titles: number }>;
    topShows: InsightFavourite[];
    topRewatched: InsightFavourite[];
    topRated: InsightFavourite[];
    facts: InsightFact[];
    peakWeekday: number | null;
    peakPart: number | null;
};

const num = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};

const isShow = (item: PlayerItem) => String(item.type || '') === 'show';
const isMovie = (item: PlayerItem) => String(item.type || '') === 'movie';

/** Times watched and the time that took, for one title. */
export const watchedFor = (item: PlayerItem) => {
    if (isShow(item)) {
        const episodes = Math.max(0, num(item.viewedLeafCount) || (item.watched ? num(item.leafCount) : 0));
        const each = num(item.durationMs) > 0 ? num(item.durationMs) : DEFAULT_EPISODE_MS;
        return { episodes, plays: episodes, ms: episodes * each };
    }
    const plays = Math.max(1, num((item as { viewCount?: number }).viewCount) || 1);
    return { episodes: 0, plays, ms: plays * num(item.durationMs) };
};

const partOfDay = (hour: number) => {
    if (hour >= 5 && hour < 12) return 0;
    if (hour >= 12 && hour < 17) return 1;
    if (hour >= 17 && hour < 22) return 2;
    return 3;
};

const peak = (values: number[]) => {
    let best = -1;
    let at: number | null = null;
    values.forEach((value, index) => {
        if (value > best) {
            best = value;
            at = index;
        }
    });
    return best > 0 ? at : null;
};

const round1 = (value: number) => Math.round(value * 10) / 10;

export const buildWatchInsights = (
    rawItems: PlayerItem[],
    opts: { now?: number; locale?: string } = {},
): WatchInsights => {
    const now = opts.now ?? Date.now();
    const locale = opts.locale || 'en';
    // One row per title; only things actually watched.
    const seen = new Set<string>();
    const items: PlayerItem[] = [];
    for (const item of rawItems) {
        if (!(isMovie(item) || isShow(item))) continue;
        if (!(num(item.lastViewedAt) > 0)) continue;
        const key = `${item.serverId || ''}:${item.ratingKey}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
    }

    const genreMap = new Map<string, InsightRow>();
    const decadeMap = new Map<number, number>();
    const studioMap = new Map<string, number>();
    const weekdays = new Array<number>(7).fill(0);
    const partsOfDay = new Array<number>(4).fill(0);
    const monthCounts = new Map<string, number>();
    const favourites: InsightFavourite[] = [];
    let totalMs = 0;
    let episodes = 0;
    let movies = 0;
    let shows = 0;
    let showsFinished = 0;
    let showsInProgress = 0;
    let rewatches = 0;

    for (const item of items) {
        const { episodes: eps, plays, ms } = watchedFor(item);
        totalMs += ms;
        if (isMovie(item)) {
            movies += 1;
            if (plays > 1) rewatches += 1;
        } else {
            shows += 1;
            episodes += eps;
            const total = num(item.leafCount);
            if (total > 0 && eps >= total) showsFinished += 1;
            else showsInProgress += 1;
        }
        favourites.push({ item, episodes: eps, plays, hours: ms / HOUR_MS });

        for (const genre of Array.isArray(item.genres) ? item.genres : []) {
            const name = String(genre || '').trim();
            if (!name) continue;
            const row = genreMap.get(name) || { name, titles: 0, hours: 0 };
            row.titles += 1;
            row.hours += ms / HOUR_MS;
            genreMap.set(name, row);
        }
        const year = num(item.year);
        if (year >= 1900) decadeMap.set(Math.floor(year / 10) * 10, (decadeMap.get(Math.floor(year / 10) * 10) || 0) + 1);
        const studio = String(item.studio || '').trim();
        if (studio) studioMap.set(studio, (studioMap.get(studio) || 0) + 1);

        const at = new Date(num(item.lastViewedAt));
        weekdays[at.getDay()] += 1;
        partsOfDay[partOfDay(at.getHours())] += 1;
        const monthKey = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}`;
        monthCounts.set(monthKey, (monthCounts.get(monthKey) || 0) + 1);
    }

    // The last twelve months, oldest first, empty months included.
    const months: WatchInsights['months'] = [];
    const base = new Date(now);
    for (let back = 11; back >= 0; back -= 1) {
        const d = new Date(base.getFullYear(), base.getMonth() - back, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        months.push({ key, label: d.toLocaleDateString(locale, { month: 'short' }), titles: monthCounts.get(key) || 0 });
    }

    const genres = [...genreMap.values()].sort((a, b) => b.hours - a.hours || b.titles - a.titles).slice(0, 6)
        .map((row) => ({ ...row, hours: round1(row.hours) }));
    const decades = [...decadeMap.entries()].sort((a, b) => a[0] - b[0]).map(([decade, titles]) => ({ label: `${decade}s`, titles }));
    const studios = [...studioMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, titles]) => ({ name, titles }));

    const topShows = favourites.filter((row) => isShow(row.item) && row.episodes > 0)
        .sort((a, b) => b.hours - a.hours).slice(0, 8);
    const topRewatched = favourites.filter((row) => isMovie(row.item) && row.plays > 1)
        .sort((a, b) => b.plays - a.plays || num(b.item.lastViewedAt) - num(a.item.lastViewedAt)).slice(0, 8);
    const topRated = favourites.filter((row) => num(row.item.userRating) > 0)
        .sort((a, b) => num(b.item.userRating) - num(a.item.userRating) || num(b.item.lastViewedAt) - num(a.item.lastViewedAt)).slice(0, 8);

    const hours = round1(totalMs / HOUR_MS);
    const peakWeekday = peak(weekdays);
    const peakPart = peak(partsOfDay);

    // Fun facts: only the ones the data can back up.
    const facts: InsightFact[] = [];
    if (hours >= 24) facts.push({ id: 'days', value: String(round1(hours / 24)), detail: 'insightsFactDays' });
    const movieRows = favourites.filter((row) => isMovie(row.item));
    const dated = movieRows.filter((row) => num(row.item.year) >= 1900);
    if (dated.length) {
        const oldest = dated.reduce((a, b) => (num(b.item.year) < num(a.item.year) ? b : a));
        facts.push({ id: 'oldest', value: String(oldest.item.year), detail: oldest.item.title || '' });
    }
    const timed = movieRows.filter((row) => num(row.item.durationMs) > 0);
    if (timed.length) {
        const longest = timed.reduce((a, b) => (num(b.item.durationMs) > num(a.item.durationMs) ? b : a));
        const minutes = Math.round(num(longest.item.durationMs) / 60_000);
        facts.push({ id: 'longest', value: `${Math.floor(minutes / 60)}h ${minutes % 60}m`, detail: longest.item.title || '' });
    }
    if (topShows[0]) {
        facts.push({ id: 'binge', value: topShows[0].item.title || '', detail: String(topShows[0].episodes) });
    }
    if (topRewatched[0]) {
        facts.push({ id: 'rewatch', value: topRewatched[0].item.title || '', detail: String(topRewatched[0].plays) });
    }
    const busiest = [...monthCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (busiest && busiest[1] > 1) {
        const [year, month] = busiest[0].split('-').map(Number);
        facts.push({
            id: 'busiestMonth',
            value: new Date(year, month - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' }),
            detail: String(busiest[1]),
        });
    }
    if (genres[0]) facts.push({ id: 'topGenre', value: genres[0].name, detail: String(genres[0].titles) });

    return {
        titles: items.length,
        movies,
        shows,
        showsFinished,
        showsInProgress,
        episodes,
        rewatches,
        hours,
        days: round1(hours / 24),
        genres,
        decades,
        studios,
        weekdays,
        partsOfDay,
        months,
        topShows,
        topRewatched,
        topRated,
        facts,
        peakWeekday,
        peakPart,
    };
};
