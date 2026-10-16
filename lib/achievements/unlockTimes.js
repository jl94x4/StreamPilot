/**
 * Estimate when each badge was first unlocked by replaying watch history in order.
 * Used for accurate "who unlocked first" after leaderboard backfills.
 */

import { listBadgeDefinitions, isBadgeSeasonActive } from './definitions.js';
import {
    extractCanonicalGenreIds,
    GENRE_CATALOG,
    genreMovieMetric,
    genreShowMetric,
} from './genres.js';
import { computeXpBreakdown, levelFromXp, normalizeXpWeights } from './xp.js';
import { durationSecondsFromItem, itemLooksFinished } from './stats.js';

const WEEKDAY_SHORT = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const zonedParts = (unixSeconds, timeZone = 'UTC') => {
    const ms = (Number(unixSeconds) || 0) * 1000;
    if (!ms) return null;
    const date = new Date(ms);
    try {
        const dayKey = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(date);
        const hourRaw = new Intl.DateTimeFormat('en-GB', {
            timeZone,
            hour: '2-digit',
            hourCycle: 'h23',
        }).format(date);
        const hour = Number(String(hourRaw).replace(/\D/g, '').slice(0, 2)) % 24;
        const weekdayLabel = new Intl.DateTimeFormat('en-US', {
            timeZone,
            weekday: 'short',
        }).format(date);
        const weekday = WEEKDAY_SHORT[weekdayLabel] ?? date.getUTCDay();
        return { dayKey, hour: Number.isFinite(hour) ? hour : date.getUTCHours(), weekday };
    } catch {
        return {
            dayKey: date.toISOString().slice(0, 10),
            hour: date.getUTCHours(),
            weekday: date.getUTCDay(),
        };
    }
};

const passesCompletion = (item, minPercent) => {
    if (!(minPercent > 0)) return true;
    const watchedFlag = Number(item?.watchedStatus);
    const pct = Number(item?.percentComplete);
    const duration = Number(item?.duration) || 0;
    const offset = Number(item?.viewOffset) || 0;
    if (Number.isFinite(watchedFlag) && watchedFlag >= 1) return true;
    if (Number.isFinite(pct)) return pct >= minPercent;
    if (duration > 0 && offset > 0) {
        const durSec = duration > 100000 ? duration / 1000 : duration;
        const offSec = offset > 100000 ? offset / 1000 : offset;
        return durSec > 0 ? ((offSec / durSec) * 100) >= minPercent : false;
    }
    return true;
};

const hoursFromState = (state) => {
    const durationSeconds = state.durationSeconds;
    if (durationSeconds > 0) {
        return Math.round((durationSeconds / 3600) * 10) / 10;
    }
    const est = (state.moviePlays * 40 + state.episodePlays * 24 + state.trackPlays * 3.5) * 60;
    return Math.round((est / 3600) * 10) / 10;
};

const minutesFromState = (state) => {
    const durationSeconds = Number(state.durationSeconds) || 0;
    if (durationSeconds > 0) return Math.round(durationSeconds / 60);
    return Math.round(hoursFromState(state) * 60);
};

const metricValueFromState = (state, metric, weights) => {
    if (metric === 'level') {
        const { xp } = computeXpBreakdown({
            uniqueMovies: state.uniqueMovies.size,
            uniqueShows: state.uniqueShows.size,
            uniqueMusic: state.uniqueMusic.size,
            moviePlays: state.moviePlays,
            episodePlays: state.episodePlays,
            trackPlays: state.trackPlays,
            totalPlays: state.totalPlays,
            activeDays: state.activeDays.size,
            dailyWatches: state.activeDays.size,
            currentStreak: state.currentStreak,
            longestStreak: state.longestStreak,
            weekendPlays: state.weekendPlays,
            movieFinishes: state.movieFinishes,
            episodeFinishes: state.episodeFinishes,
            trackFinishes: state.trackFinishes,
            bingeSessions: state.bingeSessions,
            hoursWatched: hoursFromState(state),
            minutesWatched: minutesFromState(state),
            sundayMinutes: state.sundayMinutes,
        }, weights);
        return levelFromXp(xp);
    }
    if (metric === 'uniqueMovies') return state.uniqueMovies.size;
    if (metric === 'uniqueShows') return state.uniqueShows.size;
    if (metric === 'uniqueMusic') return state.uniqueMusic.size;
    if (metric === 'uniqueTitles') {
        return state.uniqueMovies.size + state.uniqueShows.size + state.uniqueMusic.size;
    }
    if (metric === 'activeDays') return state.activeDays.size;
    if (metric === 'longestStreak') return state.longestStreak;
    if (metric === 'currentStreak') return state.currentStreak;
    if (metric === 'hoursWatched') return hoursFromState(state);
    if (metric === 'minutesWatched') return minutesFromState(state);
    if (metric === 'libraryDiversity') return state.libraries.size;
    if (metric === 'bingeMax') return state.bingeMax;
    if (metric === 'maxDayPlays') return state.maxDayPlays;
    if (metric === 'balancedMedia') {
        return state.moviePlays >= 10 && state.episodePlays >= 10 ? 1 : 0;
    }
    if (metric === 'musicAndMovies') {
        return state.moviePlays >= 1 && state.trackPlays >= 1 ? 1 : 0;
    }
    if (metric === 'threeMediaTypes') {
        return state.moviePlays >= 1 && state.episodePlays >= 1 && state.trackPlays >= 1 ? 1 : 0;
    }
    if (metric === 'genreTagsSeen') return state.genreTagsSeen.size;
    if (metric.startsWith('genreMovies_')) {
        const id = metric.slice('genreMovies_'.length);
        return state.genreMovieSets[id]?.size || 0;
    }
    if (metric.startsWith('genreShows_')) {
        const id = metric.slice('genreShows_'.length);
        return state.genreShowSets[id]?.size || 0;
    }
    return Math.max(0, Number(state[metric]) || 0);
};

const tryUnlockDefs = (defs, pending, unlocked, state, weights, seasons, atUnix) => {
    if (!defs?.length) return;
    const atDate = new Date(atUnix * 1000);
    for (const def of defs) {
        const id = String(def.id);
        if (!pending.has(id)) continue;
        const value = metricValueFromState(state, def.metric, weights);
        if (value < (Number(def.threshold) || 0)) continue;
        if (!isBadgeSeasonActive(def, atDate, seasons)) {
            // Met threshold but out of season — keep checking later plays.
            pending.set(id, { def, awaitingSeason: true });
            continue;
        }
        unlocked[id] = atDate.toISOString();
        pending.delete(id);
    }
};

/**
 * @returns {Record<string, string>} badgeId → ISO unlock time
 */
export const estimateUnlockTimestamps = (historyItems = [], opts = {}) => {
    const timeZone = String(opts.timeZone || 'UTC').trim() || 'UTC';
    const minPercent = Math.min(100, Math.max(0, Number(opts.minPercentComplete) || 0));
    const weights = normalizeXpWeights(opts.weights);
    const seasons = Array.isArray(opts.seasons) ? opts.seasons : [];
    const disabled = new Set((opts.disabledBadgeIds || []).map(String));
    const defs = (Array.isArray(opts.definitions) ? opts.definitions : listBadgeDefinitions())
        .filter((d) => d && !disabled.has(String(d.id)));

    const pending = new Map(defs.map((d) => [String(d.id), { def: d, awaitingSeason: false }]));
    const byMetric = new Map();
    for (const d of defs) {
        const metric = String(d.metric || '');
        if (!byMetric.has(metric)) byMetric.set(metric, []);
        byMetric.get(metric).push(d);
    }
    const unlocked = {};
    if (!pending.size) return unlocked;

    const items = (Array.isArray(historyItems) ? historyItems : [])
        .filter((item) => {
            const viewedAt = Number(item?.viewedAt) || 0;
            const type = String(item?.type || '').toLowerCase();
            return viewedAt > 0 && type;
        })
        .sort((a, b) => (Number(a.viewedAt) || 0) - (Number(b.viewedAt) || 0));

    if (!items.length) return unlocked;

    const state = {
        totalPlays: 0,
        moviePlays: 0,
        episodePlays: 0,
        trackPlays: 0,
        weekendPlays: 0,
        weekdayPlays: 0,
        lateNightPlays: 0,
        earlyMorningPlays: 0,
        durationSeconds: 0,
        uniqueMovies: new Set(),
        uniqueShows: new Set(),
        uniqueMusic: new Set(),
        activeDays: new Set(),
        libraries: new Set(),
        showPlayCounts: new Map(),
        dayPlays: new Map(),
        showDayCounts: new Map(),
        genreMovieSets: Object.fromEntries(GENRE_CATALOG.map((g) => [g.id, new Set()])),
        genreShowSets: Object.fromEntries(GENRE_CATALOG.map((g) => [g.id, new Set()])),
        genreTagsSeen: new Set(),
        bingeMax: 0,
        bingeSessions: 0,
        movieFinishes: 0,
        episodeFinishes: 0,
        trackFinishes: 0,
        sundayDurationSeconds: 0,
        sundayMinutes: 0,
        maxDayPlays: 0,
        longestStreak: 0,
        currentStreak: 0,
        streakRun: 0,
        lastStreakDay: null,
    };

    const flushMetrics = (metrics, atUnix) => {
        const seen = new Set();
        for (const metric of metrics) {
            if (seen.has(metric)) continue;
            seen.add(metric);
            tryUnlockDefs(byMetric.get(metric), pending, unlocked, state, weights, seasons, atUnix);
        }
        // Re-check badges waiting for season windows (threshold already met).
        const seasonalWait = [];
        for (const entry of pending.values()) {
            if (entry.awaitingSeason) seasonalWait.push(entry.def);
        }
        if (seasonalWait.length) {
            tryUnlockDefs(seasonalWait, pending, unlocked, state, weights, seasons, atUnix);
        }
    };

    for (const item of items) {
        if (!passesCompletion(item, minPercent)) continue;

        const viewedAt = Number(item.viewedAt) || 0;
        const type = String(item.type || '').toLowerCase();
        const touched = new Set(['totalPlays', 'hoursWatched', 'minutesWatched', 'level', 'uniqueTitles']);

        state.totalPlays += 1;

        const durationSec = durationSecondsFromItem(item);
        if (durationSec > 0) {
            state.durationSeconds += durationSec;
        }
        const finished = itemLooksFinished(item, minPercent);

        if (item?.librarySectionID != null) {
            state.libraries.add(String(item.librarySectionID));
            touched.add('libraryDiversity');
        }

        const genreIds = extractCanonicalGenreIds(item);
        if (genreIds.length) {
            for (const gid of genreIds) state.genreTagsSeen.add(gid);
            touched.add('genreTagsSeen');
        }

        if (type === 'movie') {
            state.moviePlays += 1;
            if (finished) state.movieFinishes += 1;
            touched.add('moviePlays');
            touched.add('balancedMedia');
            touched.add('musicAndMovies');
            touched.add('threeMediaTypes');
            const key = String(item.ratingKey || item.key || item.title || '').trim();
            if (key) {
                state.uniqueMovies.add(key);
                touched.add('uniqueMovies');
                for (const gid of genreIds) {
                    state.genreMovieSets[gid]?.add(key);
                    touched.add(genreMovieMetric(gid));
                }
            }
        } else if (type === 'episode') {
            state.episodePlays += 1;
            if (finished) state.episodeFinishes += 1;
            touched.add('episodePlays');
            touched.add('balancedMedia');
            touched.add('threeMediaTypes');
            const showKey = String(item.grandparentKey || item.grandparentRatingKey || item.grandparentTitle || '').trim();
            if (showKey) {
                state.uniqueShows.add(showKey);
                touched.add('uniqueShows');
                const next = (state.showPlayCounts.get(showKey) || 0) + 1;
                state.showPlayCounts.set(showKey, next);
                if (next > state.bingeMax) {
                    state.bingeMax = next;
                    touched.add('bingeMax');
                }
                for (const gid of genreIds) {
                    state.genreShowSets[gid]?.add(showKey);
                    touched.add(genreShowMetric(gid));
                }
            }
        } else if (type === 'track') {
            state.trackPlays += 1;
            if (finished) state.trackFinishes += 1;
            touched.add('trackPlays');
            touched.add('musicAndMovies');
            touched.add('threeMediaTypes');
            const albumKey = String(item.parentKey || item.grandparentKey || item.parentTitle || '').trim();
            if (albumKey) {
                state.uniqueMusic.add(albumKey);
                touched.add('uniqueMusic');
            }
        }

        const zoned = zonedParts(viewedAt, timeZone);
        if (zoned?.dayKey) {
            const { dayKey, hour, weekday } = zoned;
            if (!state.activeDays.has(dayKey)) {
                state.activeDays.add(dayKey);
                touched.add('activeDays');
                if (state.lastStreakDay) {
                    const prev = new Date(`${state.lastStreakDay}T12:00:00Z`).getTime();
                    const cur = new Date(`${dayKey}T12:00:00Z`).getTime();
                    if (cur - prev === 86400000) state.streakRun += 1;
                    else state.streakRun = 1;
                } else {
                    state.streakRun = 1;
                }
                state.lastStreakDay = dayKey;
                if (state.streakRun > state.longestStreak) {
                    state.longestStreak = state.streakRun;
                    touched.add('longestStreak');
                }
                state.currentStreak = state.streakRun;
                touched.add('currentStreak');
            }
            const dayCount = (state.dayPlays.get(dayKey) || 0) + 1;
            state.dayPlays.set(dayKey, dayCount);
            if (dayCount > state.maxDayPlays) {
                state.maxDayPlays = dayCount;
                touched.add('maxDayPlays');
            }
            if (type === 'episode') {
                const showKey = String(item.grandparentKey || item.grandparentRatingKey || item.grandparentTitle || '').trim();
                if (showKey) {
                    const bingeKey = `${dayKey}::${showKey}`;
                    const bingeCount = (state.showDayCounts.get(bingeKey) || 0) + 1;
                    state.showDayCounts.set(bingeKey, bingeCount);
                    if (bingeCount === 3) {
                        state.bingeSessions += 1;
                    }
                }
            }

            if (weekday === 0) {
                if (durationSec > 0) state.sundayDurationSeconds += durationSec;
                state.sundayMinutes = Math.round(state.sundayDurationSeconds / 60);
            }
            if (weekday === 0 || weekday === 6) {
                state.weekendPlays += 1;
                touched.add('weekendPlays');
            } else {
                state.weekdayPlays += 1;
                touched.add('weekdayPlays');
            }
            if (hour < 5) {
                state.lateNightPlays += 1;
                touched.add('lateNightPlays');
            }
            if (hour >= 5 && hour < 9) {
                state.earlyMorningPlays += 1;
                touched.add('earlyMorningPlays');
            }
        }

        flushMetrics(touched, viewedAt);
        if (!pending.size) break;
    }

    return unlocked;
};
