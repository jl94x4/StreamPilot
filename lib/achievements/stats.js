/**
 * Normalize portal watch history into achievement stats.
 * Works with Plex-like history items and simple analytics aggregates.
 */

import {
    emptyGenreStatFields,
    extractCanonicalGenreIds,
    GENRE_CATALOG,
    genreMovieMetric,
    genreShowMetric,
} from './genres.js';

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

const dayKeyFromUnix = (unixSeconds, timeZone = 'UTC') => zonedParts(unixSeconds, timeZone)?.dayKey || null;

const BINGE_EPISODE_MIN = 3;
const FINISH_PERCENT = 90;

export const durationSecondsFromItem = (item = {}) => {
    const duration = Number(item?.duration) || Number(item?.viewOffset) || 0;
    if (!(duration > 0)) return 0;
    return duration > 100000 ? duration / 1000 : duration;
};

/**
 * Credits-rolled finish. Fail open when Plex history has no completion signal,
 * so a counted play still gets the finish burst. If percent/offset exists, require 90%+.
 */
export const itemLooksFinished = (item = {}, minPercent = 0) => {
    const need = Math.max(FINISH_PERCENT, Number(minPercent) || 0);
    const watchedFlag = Number(item?.watchedStatus);
    if (Number.isFinite(watchedFlag) && watchedFlag >= 1) return true;
    const pct = Number(item?.percentComplete);
    if (Number.isFinite(pct)) return pct >= need;
    const duration = Number(item?.duration) || 0;
    const offset = Number(item?.viewOffset) || 0;
    if (duration > 0 && offset > 0) {
        const durSec = duration > 100000 ? duration / 1000 : duration;
        const offSec = offset > 100000 ? offset / 1000 : offset;
        return durSec > 0 ? ((offSec / durSec) * 100) >= need : false;
    }
    return true;
};

const computeStreaks = (dayKeysSorted, timeZone = 'UTC') => {
    if (!dayKeysSorted.length) return { longestStreak: 0, currentStreak: 0 };
    let longest = 1;
    let run = 1;
    for (let i = 1; i < dayKeysSorted.length; i += 1) {
        const prev = new Date(`${dayKeysSorted[i - 1]}T12:00:00Z`).getTime();
        const cur = new Date(`${dayKeysSorted[i]}T12:00:00Z`).getTime();
        if (cur - prev === 86400000) {
            run += 1;
            longest = Math.max(longest, run);
        } else {
            run = 1;
        }
    }

    const nowParts = zonedParts(Math.floor(Date.now() / 1000), timeZone);
    const today = nowParts?.dayKey;
    const yesterdayParts = zonedParts(Math.floor(Date.now() / 1000) - 86400, timeZone);
    const yesterdayDate = yesterdayParts?.dayKey;
    const last = dayKeysSorted[dayKeysSorted.length - 1];
    let current = 0;
    if (last === today || last === yesterdayDate) {
        current = 1;
        for (let i = dayKeysSorted.length - 1; i > 0; i -= 1) {
            const prev = new Date(`${dayKeysSorted[i - 1]}T12:00:00Z`).getTime();
            const cur = new Date(`${dayKeysSorted[i]}T12:00:00Z`).getTime();
            if (cur - prev === 86400000) current += 1;
            else break;
        }
    }
    return { longestStreak: longest, currentStreak: current };
};

/**
 * @param {Array} historyItems
 * @param {{ timeZone?: string }} [opts]
 */
export const buildStatsFromHistoryItems = (historyItems = [], opts = {}) => {
    const items = Array.isArray(historyItems) ? historyItems : [];
    const timeZone = String(opts.timeZone || 'UTC').trim() || 'UTC';
    const minPercent = Math.min(100, Math.max(0, Number(opts.minPercentComplete) || 0));
    const uniqueMovies = new Set();
    const uniqueShows = new Set();
    const uniqueMusic = new Set();
    const libraries = new Set();
    const showPlayCounts = new Map();
    const dayPlays = new Map();
    const activeDays = new Set();
    const genreMovieSets = Object.fromEntries(GENRE_CATALOG.map((g) => [g.id, new Set()]));
    const genreShowSets = Object.fromEntries(GENRE_CATALOG.map((g) => [g.id, new Set()]));
    const genreTagsSeen = new Set();

    let totalPlays = 0;
    let moviePlays = 0;
    let episodePlays = 0;
    let trackPlays = 0;
    let weekendPlays = 0;
    let weekdayPlays = 0;
    let lateNightPlays = 0;
    let earlyMorningPlays = 0;
    let durationSeconds = 0;
    let sundayDurationSeconds = 0;
    let skippedIncomplete = 0;
    let movieFinishes = 0;
    let episodeFinishes = 0;
    let trackFinishes = 0;
    let sundayMoviePlays = 0;
    let sundayEpisodePlays = 0;
    let sundayTrackPlays = 0;
    const showDayCounts = new Map();

    for (const item of items) {
        const type = String(item?.type || '').toLowerCase();
        const viewedAt = Number(item?.viewedAt) || 0;
        if (!viewedAt && !type) continue;

        if (minPercent > 0) {
            const watchedFlag = Number(item?.watchedStatus);
            const pct = Number(item?.percentComplete);
            const duration = Number(item?.duration) || 0;
            const offset = Number(item?.viewOffset) || 0;
            let passes = false;
            if (Number.isFinite(watchedFlag) && watchedFlag >= 1) passes = true;
            else if (Number.isFinite(pct)) passes = pct >= minPercent;
            else if (duration > 0 && offset > 0) {
                const durSec = duration > 100000 ? duration / 1000 : duration;
                const offSec = offset > 100000 ? offset / 1000 : offset;
                passes = durSec > 0 ? ((offSec / durSec) * 100) >= minPercent : false;
            } else {
                // No completion signal — count the play (fail open) for Plex-native history.
                passes = true;
            }
            if (!passes) {
                skippedIncomplete += 1;
                continue;
            }
        }

        totalPlays += 1;

        const durationSec = durationSecondsFromItem(item);
        if (durationSec > 0) durationSeconds += durationSec;

        const finished = itemLooksFinished(item, minPercent);

        if (item?.librarySectionID != null) libraries.add(String(item.librarySectionID));

        const genreIds = extractCanonicalGenreIds(item);
        for (const gid of genreIds) genreTagsSeen.add(gid);

        if (type === 'movie') {
            moviePlays += 1;
            if (finished) movieFinishes += 1;
            const key = String(item.ratingKey || item.key || item.title || '').trim();
            if (key) {
                uniqueMovies.add(key);
                for (const gid of genreIds) genreMovieSets[gid]?.add(key);
            }
        } else if (type === 'episode') {
            episodePlays += 1;
            if (finished) episodeFinishes += 1;
            const showKey = String(item.grandparentKey || item.grandparentRatingKey || item.grandparentTitle || '').trim();
            if (showKey) {
                uniqueShows.add(showKey);
                showPlayCounts.set(showKey, (showPlayCounts.get(showKey) || 0) + 1);
                for (const gid of genreIds) genreShowSets[gid]?.add(showKey);
            }
        } else if (type === 'track') {
            trackPlays += 1;
            if (finished) trackFinishes += 1;
            const albumKey = String(item.parentKey || item.grandparentKey || item.parentTitle || '').trim();
            if (albumKey) uniqueMusic.add(albumKey);
        }

        if (viewedAt > 0) {
            const zoned = zonedParts(viewedAt, timeZone);
            if (zoned?.dayKey) {
                activeDays.add(zoned.dayKey);
                dayPlays.set(zoned.dayKey, (dayPlays.get(zoned.dayKey) || 0) + 1);
                if (type === 'episode') {
                    const showKey = String(item.grandparentKey || item.grandparentRatingKey || item.grandparentTitle || '').trim();
                    if (showKey) {
                        const bingeKey = `${zoned.dayKey}::${showKey}`;
                        showDayCounts.set(bingeKey, (showDayCounts.get(bingeKey) || 0) + 1);
                    }
                }
            }
            if (zoned) {
                const weekday = zoned.weekday ?? 0;
                if (weekday === 0 || weekday === 6) weekendPlays += 1;
                else weekdayPlays += 1;
                if (weekday === 0) {
                    if (durationSec > 0) sundayDurationSeconds += durationSec;
                    if (type === 'movie') sundayMoviePlays += 1;
                    else if (type === 'episode') sundayEpisodePlays += 1;
                    else if (type === 'track') sundayTrackPlays += 1;
                }
                const hour = zoned.hour ?? 0;
                if (hour < 5) lateNightPlays += 1;
                if (hour >= 5 && hour < 9) earlyMorningPlays += 1;
            }
        }
    }

    const estimatedDuration = durationSeconds <= 0;
    // If no duration metadata, estimate ~40 min per movie / 24 min per ep / 3.5 min per track.
    if (estimatedDuration) {
        durationSeconds = (moviePlays * 40 + episodePlays * 24 + trackPlays * 3.5) * 60;
        sundayDurationSeconds = (sundayMoviePlays * 40 + sundayEpisodePlays * 24 + sundayTrackPlays * 3.5) * 60;
    }

    let bingeSessions = 0;
    for (const count of showDayCounts.values()) {
        if (count >= BINGE_EPISODE_MIN) bingeSessions += 1;
    }

    const sortedDays = [...activeDays].sort();
    const { longestStreak, currentStreak } = computeStreaks(sortedDays, timeZone);
    let bingeMax = 0;
    for (const count of showPlayCounts.values()) bingeMax = Math.max(bingeMax, count);
    let maxDayPlays = 0;
    for (const count of dayPlays.values()) maxDayPlays = Math.max(maxDayPlays, count);

    const hoursWatched = Math.round((durationSeconds / 3600) * 10) / 10;
    const minutesWatched = Math.round(durationSeconds / 60);
    const sundayMinutes = Math.round(sundayDurationSeconds / 60);
    const uniqueTitles = uniqueMovies.size + uniqueShows.size + uniqueMusic.size;

    const genreFields = emptyGenreStatFields();
    genreFields.genreTagsSeen = genreTagsSeen.size;
    for (const g of GENRE_CATALOG) {
        genreFields[genreMovieMetric(g.id)] = genreMovieSets[g.id].size;
        genreFields[genreShowMetric(g.id)] = genreShowSets[g.id].size;
    }

    return {
        totalPlays,
        moviePlays,
        episodePlays,
        trackPlays,
        uniqueMovies: uniqueMovies.size,
        uniqueShows: uniqueShows.size,
        uniqueMusic: uniqueMusic.size,
        uniqueTitles,
        activeDays: activeDays.size,
        longestStreak,
        currentStreak,
        dailyWatches: activeDays.size,
        weekendPlays,
        weekdayPlays,
        bingeMax,
        bingeSessions,
        movieFinishes,
        episodeFinishes,
        trackFinishes,
        maxDayPlays,
        libraryDiversity: libraries.size,
        hoursWatched,
        minutesWatched,
        sundayMinutes,
        mediaRequests: Number(opts.mediaRequests) || 0,
        lateNightPlays,
        earlyMorningPlays,
        balancedMedia: moviePlays >= 10 && episodePlays >= 10 ? 1 : 0,
        musicAndMovies: moviePlays >= 1 && trackPlays >= 1 ? 1 : 0,
        threeMediaTypes: moviePlays >= 1 && episodePlays >= 1 && trackPlays >= 1 ? 1 : 0,
        ...genreFields,
        // filled after XP/level
        level: 1,
    };
};

export const filterHistoryByDays = (historyItems = [], days = 'all') => {
    if (days === 'all' || days == null || days === '') return Array.isArray(historyItems) ? historyItems : [];
    const n = parseInt(String(days), 10);
    if (!Number.isFinite(n) || n <= 0) return Array.isArray(historyItems) ? historyItems : [];
    const after = Math.floor(Date.now() / 1000) - (n * 24 * 60 * 60);
    return (Array.isArray(historyItems) ? historyItems : []).filter((item) => (Number(item?.viewedAt) || 0) >= after);
};

/** Merge partial analytics payload when full history is unavailable. */
export const buildStatsFromAnalyticsPayload = (analytics = {}, opts = {}) => {
    const moviePlays = Number(analytics.moviesCount) || 0;
    const episodePlays = Number(analytics.showsCount) || 0;
    const trackPlays = Number(analytics.musicCount) || 0;
    const totalPlays = Number(analytics.totalPlays) || moviePlays + episodePlays + trackPlays;
    const uniqueTitles = Number(analytics.uniqueTitles) || 0;
    const heatmap = analytics.heatmapData && typeof analytics.heatmapData === 'object'
        ? analytics.heatmapData
        : {};
    const activeDays = Object.keys(heatmap).length;
    const dayValues = Object.values(heatmap).map((v) => Number(v) || 0);
    const maxDayPlays = dayValues.length ? Math.max(...dayValues) : 0;
    const sortedDays = Object.keys(heatmap).sort();
    const { longestStreak, currentStreak } = computeStreaks(sortedDays, opts.timeZone || 'UTC');

    // Prefer unique counts when present; else approximate from play buckets.
    const uniqueMovies = Number(analytics.uniqueMovies) || Math.min(moviePlays, uniqueTitles || moviePlays);
    const uniqueShows = Number(analytics.uniqueShows)
        || Math.min(
            Array.isArray(analytics.topShows) ? analytics.topShows.length : episodePlays,
            uniqueTitles || episodePlays,
        );
    const uniqueMusic = Number(analytics.uniqueMusic)
        || Math.min(
            Array.isArray(analytics.topMusic) ? analytics.topMusic.length : trackPlays,
            uniqueTitles || trackPlays,
        );

    const hoursWatched = Number(analytics.hoursWatched)
        || Math.round(((moviePlays * 40 + episodePlays * 24 + trackPlays * 3.5) / 60) * 10) / 10;
    const minutesWatched = Number(analytics.minutesWatched)
        || Math.round(hoursWatched * 60);

    return {
        totalPlays,
        moviePlays,
        episodePlays,
        trackPlays,
        uniqueMovies,
        uniqueShows,
        uniqueMusic,
        uniqueTitles: uniqueTitles || uniqueMovies + uniqueShows + uniqueMusic,
        activeDays,
        longestStreak,
        currentStreak,
        dailyWatches: activeDays,
        weekendPlays: Number(analytics.weekendPlays) || 0,
        weekdayPlays: Number(analytics.weekdayPlays) || 0,
        bingeMax: Number(analytics.topBinge?.plays) || 0,
        bingeSessions: Number(analytics.bingeSessions) || (Number(analytics.topBinge?.plays) >= 3 ? 1 : 0),
        movieFinishes: Number(analytics.movieFinishes) || uniqueMovies,
        episodeFinishes: Number(analytics.episodeFinishes) || episodePlays,
        trackFinishes: Number(analytics.trackFinishes) || 0,
        maxDayPlays,
        libraryDiversity: Array.isArray(analytics.topLibraries) ? analytics.topLibraries.length : 0,
        hoursWatched,
        minutesWatched,
        sundayMinutes: Number(analytics.sundayMinutes) || 0,
        mediaRequests: Number(analytics.mediaRequests) || Number(opts.mediaRequests) || 0,
        lateNightPlays: 0,
        earlyMorningPlays: 0,
        balancedMedia: moviePlays >= 10 && episodePlays >= 10 ? 1 : 0,
        musicAndMovies: moviePlays >= 1 && trackPlays >= 1 ? 1 : 0,
        threeMediaTypes: moviePlays >= 1 && episodePlays >= 1 && trackPlays >= 1 ? 1 : 0,
        ...emptyGenreStatFields(),
        level: 1,
    };
};
