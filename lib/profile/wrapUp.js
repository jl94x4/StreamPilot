/**
 * Subject-scoped wrap-up for profile payloads.
 * Home's personal analytics builder fills titles/habits; this module merges
 * that with achievement snapshot counts and trims it for peer viewers.
 */

import { filterRecentlyWatchedHistory } from './recentWatched.js';

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const timeOfDayFromHour = (peakHour) => {
    if (peakHour >= 5 && peakHour < 12) return 'Early Bird';
    if (peakHour >= 12 && peakHour < 18) return 'Afternoon Watcher';
    if (peakHour >= 18) return 'Evening Streamer';
    return 'Night Owl';
};

const asNumber = (value) => Number(value) || 0;

/** Plex is unix seconds; some clients/Tautulli rows arrive as unix ms. */
export const historyViewedAtSeconds = (value) => {
    const n = Number(value) || 0;
    if (n <= 0) return 0;
    return n > 9_999_999_999 ? Math.floor(n / 1000) : Math.floor(n);
};

export const filterHistoryByUnixWindow = (items, { startSec = 0, endSec = Number.POSITIVE_INFINITY } = {}) => (
    (Array.isArray(items) ? items : []).filter((item) => {
        const at = historyViewedAtSeconds(item?.viewedAt);
        return at >= startSec && at < endSec;
    })
);

const contentKeyOf = (item) => {
    if (item.type === 'episode') return String(item.grandparentKey || item.grandparentTitle || item.ratingKey || item.title);
    if (item.type === 'track') return String(item.parentKey || item.parentTitle || item.ratingKey || item.title);
    return String(item.ratingKey || item.key || item.title);
};
const contentTitleOf = (item) => {
    if (item.type === 'episode') return item.grandparentTitle || item.parentTitle || item.title;
    if (item.type === 'track') return item.parentTitle || item.grandparentTitle || item.title;
    return item.title;
};
const contentTypeOf = (item) => {
    if (item.type === 'episode') return 'show';
    if (item.type === 'track') return 'track';
    return item.type || 'movie';
};

const slimCompareTitle = (item = null) => {
    if (!item || typeof item !== 'object' || !item.title) return null;
    return { title: String(item.title), plays: asNumber(item.plays) };
};

const titleKey = (item) => String(item?.title || '').trim().toLowerCase();

const titlesDiffer = (current, previous) => {
    const a = titleKey(current);
    const b = titleKey(previous);
    return Boolean(a && b && a !== b);
};

const genreTagsOf = (item) => {
    const fromGenre = Array.isArray(item?.Genre)
        ? item.Genre.map((row) => row?.tag || row?.name || row)
        : [];
    const fromGenres = Array.isArray(item?.genres) ? item.genres : [];
    return [...fromGenre, ...fromGenres]
        .map((tag) => String(tag || '').trim())
        .filter(Boolean);
};

const is4kHistoryItem = (item) => {
    const res = String(item?.videoResolution || item?.Media?.[0]?.videoResolution || '').toLowerCase();
    if (res === '4k' || res === '2160' || res.includes('2160')) return true;
    return Number(item?.width) >= 3840;
};

const durationHoursOf = (item) => {
    const value = Number(item?.duration) || 0;
    if (value <= 0) return 0;
    return value > 100000 ? value / 3_600_000 : value / 3600;
};

const swapOf = (current, previous) => (
    titlesDiffer(current, previous)
        ? { from: slimCompareTitle(previous), to: slimCompareTitle(current) }
        : null
);

export const wrapUpDelta = (current, previous) => {
    const currentVal = asNumber(current);
    const previousVal = Math.max(0, asNumber(previous));
    const absolute = currentVal - previousVal;
    const percent = previousVal > 0 ? Number(((absolute / previousVal) * 100).toFixed(1)) : null;
    return { current: currentVal, previous: previousVal, absolute, percent };
};

export const summarizeWrapUpHistoryWindow = (historyItems = []) => {
    const items = Array.isArray(historyItems) ? historyItems : [];
    const contentCounts = {};
    let moviesCount = 0;
    let showsCount = 0;
    let musicCount = 0;
    let hoursWatched = 0;
    for (const item of items) {
        hoursWatched += durationHoursOf(item);
        if (item.type === 'movie') moviesCount += 1;
        else if (item.type === 'episode') showsCount += 1;
        else if (item.type === 'track') musicCount += 1;
        const key = contentKeyOf(item);
        if (!key) continue;
        if (!contentCounts[key]) {
            contentCounts[key] = { title: contentTitleOf(item), type: contentTypeOf(item), plays: 0 };
        }
        contentCounts[key].plays += 1;
        const title = contentTitleOf(item);
        if (title) contentCounts[key].title = title;
    }
    const ranked = Object.values(contentCounts).sort((a, b) => b.plays - a.plays);
    return {
        totalPlays: items.length,
        hoursWatched: Math.round(hoursWatched * 10) / 10,
        moviesCount,
        showsCount,
        musicCount,
        uniqueTitles: ranked.length,
        topMovie: slimCompareTitle(ranked.find((row) => row.type === 'movie')),
        topBinge: slimCompareTitle(ranked.find((row) => row.type === 'show')),
    };
};

export const buildWrapUpHighlights = (currentItems = [], previousItems = [], {
    current = null,
    previous = null,
    dayOfWeekCounts = null,
} = {}) => {
    const currentSummary = current || summarizeWrapUpHistoryWindow(currentItems);
    const previousSummary = previous || summarizeWrapUpHistoryWindow(previousItems);
    const swaps = {
        topMovie: swapOf(currentSummary.topMovie, previousSummary.topMovie),
        topBinge: swapOf(currentSummary.topBinge, previousSummary.topBinge),
    };

    const previousKeys = new Set((previousItems || []).map(contentKeyOf).filter(Boolean));
    const newTitleKeys = new Set();
    for (const item of currentItems || []) {
        const key = contentKeyOf(item);
        if (key && !previousKeys.has(key)) newTitleKeys.add(key);
    }

    const previousGenres = new Set(
        (previousItems || []).flatMap(genreTagsOf).map((tag) => tag.toLowerCase()),
    );
    const newGenre = [...new Set((currentItems || []).flatMap(genreTagsOf))]
        .find((tag) => tag && !previousGenres.has(tag.toLowerCase())) || null;

    const nights = {};
    for (const item of currentItems || []) {
        const at = historyViewedAtSeconds(item.viewedAt);
        if (!at) continue;
        const date = new Date(at * 1000).toISOString().slice(0, 10);
        if (!nights[date]) nights[date] = { date, plays: 0, hours: 0 };
        nights[date].plays += 1;
        nights[date].hours += durationHoursOf(item);
    }
    const longest = Object.values(nights).sort((a, b) => b.plays - a.plays || b.hours - a.hours)[0];
    const longestNight = longest && longest.plays >= 4
        ? { date: longest.date, plays: longest.plays, hours: Math.round(longest.hours * 10) / 10 }
        : null;

    let dominantDay = null;
    const counts = dayOfWeekCounts && typeof dayOfWeekCounts === 'object' ? dayOfWeekCounts : {};
    const total = Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0);
    if (total >= 8) {
        const best = Object.entries(counts).sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))[0];
        const percent = best ? Math.round(((Number(best[1]) || 0) / total) * 100) : 0;
        if (percent >= 50) {
            dominantDay = { day: DAYS_OF_WEEK[Number(best[0])] || 'Unknown', percent };
        }
    }

    return {
        swaps,
        newTitles: newTitleKeys.size,
        newGenre,
        first4k: (currentItems || []).some(is4kHistoryItem) && !(previousItems || []).some(is4kHistoryItem),
        longestNight,
        dominantDay,
        hoursWatched: currentSummary.hoursWatched || 0,
    };
};

export const buildWrapUpCompare = (current = null, previous = null, periodDays, extras = {}) => {
    if (!current || !previous || periodDays == null || String(periodDays) === 'all') return null;
    const highlights = extras.currentItems
        ? buildWrapUpHighlights(extras.currentItems, extras.previousItems || [], {
            current,
            previous,
            dayOfWeekCounts: extras.dayOfWeekCounts,
        })
        : {
            swaps: {
                topMovie: swapOf(current.topMovie, previous.topMovie),
                topBinge: swapOf(current.topBinge, previous.topBinge),
            },
            newTitles: 0,
            newGenre: null,
            first4k: false,
            longestNight: null,
            dominantDay: null,
            hoursWatched: asNumber(current.hoursWatched),
        };
    return {
        previousPeriodDays: String(periodDays),
        totalPlays: wrapUpDelta(current.totalPlays, previous.totalPlays),
        uniqueTitles: wrapUpDelta(current.uniqueTitles, previous.uniqueTitles),
        moviesCount: wrapUpDelta(current.moviesCount, previous.moviesCount),
        showsCount: wrapUpDelta(current.showsCount, previous.showsCount),
        musicCount: wrapUpDelta(current.musicCount, previous.musicCount),
        previous: {
            totalPlays: asNumber(previous.totalPlays),
            topMovie: slimCompareTitle(previous.topMovie),
            topBinge: slimCompareTitle(previous.topBinge),
        },
        swaps: highlights.swaps,
        highlights,
    };
};

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const formatWrapUpNewsletterHtml = (analytics = null) => {
    const compare = analytics?.compare;
    if (!compare?.totalPlays) return '';
    const plays = asNumber(analytics.totalPlays);
    if (plays <= 0 && asNumber(compare.totalPlays.previous) <= 0) return '';
    const abs = asNumber(compare.totalPlays.absolute);
    const pct = compare.totalPlays.percent;
    const delta = pct != null
        ? `${abs >= 0 ? '+' : ''}${pct}% vs last month`
        : (abs > 0 && !compare.totalPlays.previous ? 'new this month' : `${abs >= 0 ? '+' : ''}${abs} vs last month`);
    const binge = analytics.topBinge?.title || compare.swaps?.topBinge?.to?.title;
    const wasBinge = compare.swaps?.topBinge?.from?.title;
    const movie = analytics.topMovie?.title || compare.swaps?.topMovie?.to?.title;
    const bits = [
        `You watched <strong>${plays}</strong> streams this month (${delta}).`,
        binge ? `Top binge: <strong>${escapeHtml(binge)}</strong>${wasBinge ? ` (was ${escapeHtml(wasBinge)})` : ''}.` : '',
        movie ? `Top movie: <strong>${escapeHtml(movie)}</strong>.` : '',
    ].filter(Boolean);
    return `
                        <tr>
                            <td style="padding: 0 30px 20px 30px;">
                                <div style="padding: 18px 20px; background-color: rgba(234, 179, 8, 0.08); border: 1px solid rgba(234, 179, 8, 0.25); border-radius: 12px;">
                                    <p style="margin: 0 0 6px 0; color: #eab308; font-family: Helvetica, Arial, sans-serif; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; font-weight: 700;">Your month</p>
                                    <p style="margin: 0; color: #e5e7eb; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.55;">${bits.join(' ')}</p>
                                </div>
                            </td>
                        </tr>`;
};

const slimHistoryItem = (item = {}) => ({
    title: item.title || '',
    episodeTitle: item.episodeTitle || null,
    viewedAt: item.viewedAt || null,
    thumbUrl: item.thumbUrl || null,
    type: item.type || null,
});

const slimTitle = (item = null) => {
    if (!item || typeof item !== 'object') return null;
    return {
        title: item.title || '',
        type: item.type || null,
        plays: asNumber(item.plays),
        thumbUrl: item.thumbUrl || null,
        artUrl: item.artUrl || null,
        year: item.year || null,
        plexUrl: item.plexUrl || null,
    };
};

const slimNeighbour = (row = {}, obfuscate = false) => {
    const isMe = !!row.isMe;
    if (obfuscate && !isMe) {
        return {
            rank: row.rank,
            plays: row.plays,
            xp: row.xp,
            isMe: false,
            username: `Viewer ${row.rank}`,
        };
    }
    return {
        rank: row.rank,
        plays: row.plays,
        xp: row.xp,
        isMe,
        username: row.username,
        accountId: row.accountId,
    };
};

export const mergeProfileWrapUp = (snapshot = null, personal = null, identityXp) => {
    if (!snapshot && !personal) return null;
    if (!personal) return snapshot;
    const snap = snapshot && typeof snapshot === 'object' ? snapshot : {};
    return {
        ...snap,
        ...personal,
        totalPlays: Math.max(asNumber(snap.totalPlays), asNumber(personal.totalPlays)),
        hoursWatched: asNumber(snap.hoursWatched) || asNumber(personal.hoursWatched) || 0,
        uniqueTitles: asNumber(snap.uniqueTitles) || asNumber(personal.uniqueTitles) || 0,
        moviesCount: asNumber(snap.moviesCount) || asNumber(personal.moviesCount) || 0,
        showsCount: asNumber(snap.showsCount) || asNumber(personal.showsCount) || 0,
        musicCount: asNumber(snap.musicCount) || asNumber(personal.musicCount) || 0,
        leaderboardRank: snap.leaderboardRank ?? personal.leaderboardRank ?? null,
        totalActiveUsers: snap.totalActiveUsers || personal.totalActiveUsers || 0,
        leaderboardSource: snap.leaderboardSource || personal.leaderboardSource || 'achievements',
        leaderboardMetric: snap.leaderboardMetric || personal.leaderboardMetric || 'xp',
        myXp: identityXp ?? personal.myXp ?? snap.myXp,
        currentStreak: asNumber(snap.currentStreak) || asNumber(personal.currentStreak) || 0,
        longestStreak: asNumber(snap.longestStreak) || asNumber(personal.longestStreak) || 0,
        bingeMax: asNumber(snap.bingeMax) || asNumber(personal.bingeMax) || 0,
        activeDays: asNumber(snap.activeDays) || asNumber(personal.activeDays) || 0,
        period: personal.period || snap.period || 'last365',
    };
};

const uniqueRecentHistory = (items = [], limit = 4) => {
    const out = [];
    const seen = new Set();
    for (const item of Array.isArray(items) ? items : []) {
        const key = String(item?.title || '').trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(slimHistoryItem(item));
        if (out.length >= limit) break;
    }
    return out;
};

export const trimWrapUpForProfile = (payload, { isSelf = false, viewerIsAdmin = false, obfuscate = false } = {}) => {
    if (!payload || typeof payload !== 'object') return null;
    const includeFullHistory = !!(isSelf || viewerIsAdmin);
    const historyLimit = includeFullHistory ? 20 : 4;
    const listLimit = includeFullHistory ? 12 : 5;
    const recentHistory = uniqueRecentHistory(payload.recentHistory, historyLimit);
    const neighbourhood = Array.isArray(payload.leaderboardNeighbourhood)
        ? payload.leaderboardNeighbourhood.map((row) => slimNeighbour(row, obfuscate && !viewerIsAdmin))
        : [];
    return {
        totalPlays: asNumber(payload.totalPlays),
        hoursWatched: asNumber(payload.hoursWatched),
        moviesCount: asNumber(payload.moviesCount),
        showsCount: asNumber(payload.showsCount),
        musicCount: asNumber(payload.musicCount),
        uniqueTitles: asNumber(payload.uniqueTitles),
        weekdayPlays: asNumber(payload.weekdayPlays),
        weekendPlays: asNumber(payload.weekendPlays),
        peakHour: payload.peakHour ?? null,
        avgHour: payload.avgHour ?? null,
        timeOfDay: payload.timeOfDay || null,
        popularDay: payload.popularDay || null,
        favoriteLibrary: payload.favoriteLibrary || null,
        mediaPreference: payload.mediaPreference || null,
        watchStyle: payload.watchStyle || null,
        streamingHabit: payload.streamingHabit || null,
        topMovie: slimTitle(payload.topMovie),
        topBinge: slimTitle(payload.topBinge),
        topMovies: Array.isArray(payload.topMovies) ? payload.topMovies.slice(0, listLimit).map(slimTitle) : [],
        topShows: Array.isArray(payload.topShows) ? payload.topShows.slice(0, listLimit).map(slimTitle) : [],
        topWatched: Array.isArray(payload.topWatched) ? payload.topWatched.slice(0, listLimit).map(slimTitle) : [],
        topMusic: Array.isArray(payload.topMusic) ? payload.topMusic.slice(0, listLimit).map(slimTitle) : [],
        topLibraries: Array.isArray(payload.topLibraries)
            ? payload.topLibraries.slice(0, 5).map((row) => ({ title: row.title || '', plays: asNumber(row.plays) }))
            : [],
        dayOfWeekCounts: payload.dayOfWeekCounts || null,
        hourDistribution: Array.isArray(payload.hourDistribution) ? payload.hourDistribution.slice(0, 24) : null,
        heatmapData: includeFullHistory ? (payload.heatmapData || null) : null,
        recentHistory,
        leaderboardRank: payload.leaderboardRank ?? null,
        totalActiveUsers: asNumber(payload.totalActiveUsers),
        leaderboardSource: payload.leaderboardSource || null,
        leaderboardMetric: payload.leaderboardMetric || null,
        leaderboardNeighbourhood: neighbourhood,
        myXp: payload.myXp ?? null,
        myPlaysOnLeaderboard: payload.myPlaysOnLeaderboard ?? null,
        period: payload.period || 'last365',
        source: payload.source || null,
        compare: payload.compare || null,
        swaps: payload.swaps || payload.compare?.swaps || null,
    };
};

export const wrapUpFromHistoryItems = (historyItems = []) => {
    const nowSec = Math.floor(Date.now() / 1000);
    const yearAgo = nowSec - (365 * 24 * 60 * 60);
    const twoYearsAgo = nowSec - (730 * 24 * 60 * 60);
    const allItems = Array.isArray(historyItems) ? historyItems : [];
    const items = filterHistoryByUnixWindow(allItems, { startSec: yearAgo })
        .sort((a, b) => historyViewedAtSeconds(b.viewedAt) - historyViewedAtSeconds(a.viewedAt));
    const priorItems = filterHistoryByUnixWindow(allItems, { startSec: twoYearsAgo, endSec: yearAgo });
    if (!items.length) {
        const priorSummary = summarizeWrapUpHistoryWindow(priorItems);
        return {
            totalPlays: 0,
            topLibraries: [],
            topWatched: [],
            topMusic: [],
            recentHistory: [],
            period: 'last365',
            compare: buildWrapUpCompare(
                {
                    totalPlays: 0, moviesCount: 0, showsCount: 0, musicCount: 0, uniqueTitles: 0,
                },
                priorSummary,
                365,
                { currentItems: [], previousItems: priorItems },
            ),
        };
    }

    const hourDistribution = new Array(24).fill(0);
    const dayOfWeekCounts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    const contentCounts = {};
    let moviesCount = 0;
    let showsCount = 0;
    let musicCount = 0;
    let hoursWatched = 0;

    for (const item of items) {
        const viewed = new Date(historyViewedAtSeconds(item.viewedAt) * 1000);
        const hour = Number.isNaN(viewed.getTime()) ? 0 : viewed.getHours();
        const day = Number.isNaN(viewed.getTime()) ? 0 : viewed.getDay();
        hourDistribution[hour] += 1;
        dayOfWeekCounts[day] += 1;
        hoursWatched += durationHoursOf(item);
        if (item.type === 'movie') moviesCount += 1;
        else if (item.type === 'episode') showsCount += 1;
        else if (item.type === 'track') musicCount += 1;

        const key = contentKeyOf(item);
        if (!contentCounts[key]) {
            contentCounts[key] = {
                key,
                title: contentTitleOf(item),
                type: contentTypeOf(item),
                plays: 0,
                lastViewedAt: 0,
            };
        }
        contentCounts[key].plays += 1;
        const viewedAt = historyViewedAtSeconds(item.viewedAt);
        if (viewedAt >= contentCounts[key].lastViewedAt) {
            contentCounts[key].lastViewedAt = viewedAt;
            contentCounts[key].title = contentTitleOf(item);
        }
    }

    const ranked = Object.values(contentCounts).sort((a, b) => b.plays - a.plays || b.lastViewedAt - a.lastViewedAt);
    const topMovies = ranked.filter((row) => row.type === 'movie').slice(0, 5);
    const topShows = ranked.filter((row) => row.type === 'show').slice(0, 5);
    const topMusic = ranked.filter((row) => row.type === 'track').slice(0, 5);
    const peakHour = hourDistribution.reduce((best, count, hour) => (
        count > hourDistribution[best] ? hour : best
    ), 0);
    const topDayEntry = Object.entries(dayOfWeekCounts)
        .map(([day, count]) => ({ day: Number(day), count: Number(count) || 0 }))
        .sort((a, b) => b.count - a.count)[0];
    const totalPlays = items.length;
    const weekendPlays = dayOfWeekCounts[0] + dayOfWeekCounts[6];
    const weekdayPlays = totalPlays - weekendPlays;
    let mediaPreference = 'Mixed Bag';
    if (totalPlays > 0) {
        if (moviesCount / totalPlays >= 0.6) mediaPreference = 'Movie Buff';
        else if (showsCount / totalPlays >= 0.6) mediaPreference = 'TV Show Binger';
        else if (musicCount / totalPlays >= 0.6) mediaPreference = 'Music Lover';
    }
    let watchStyle = 'Explorer';
    const uniqueTitles = ranked.length;
    if (totalPlays > 0 && uniqueTitles > 0) {
        if (totalPlays / uniqueTitles > 3) watchStyle = 'Comfort Binger';
        else if (totalPlays / uniqueTitles > 1.5) watchStyle = 'Loyal Fan';
    }
    let streamingHabit = 'Balanced Streamer';
    if (totalPlays > 0) {
        if (weekendPlays / totalPlays >= 0.5) streamingHabit = 'Weekend Warrior';
        else if (weekdayPlays / totalPlays >= 0.8) streamingHabit = 'Weekday Streamer';
    }

    const recentHistory = filterRecentlyWatchedHistory(items, { limit: 20 }).map((item) => ({
        title: contentTitleOf(item),
        episodeTitle: item.type === 'episode' || item.type === 'track' ? item.title : null,
        viewedAt: item.viewedAt,
        type: item.type,
        thumbUrl: null,
    }));

    return {
        totalPlays,
        hoursWatched,
        moviesCount,
        showsCount,
        musicCount,
        uniqueTitles,
        weekdayPlays,
        weekendPlays,
        peakHour,
        avgHour: peakHour,
        timeOfDay: timeOfDayFromHour(peakHour),
        popularDay: topDayEntry?.count > 0 ? DAYS_OF_WEEK[topDayEntry.day] : 'Unknown',
        favoriteLibrary: 'None',
        mediaPreference,
        watchStyle,
        streamingHabit,
        topMovie: topMovies[0] || null,
        topBinge: topShows[0] || null,
        topMovies,
        topShows,
        topWatched: ranked.filter((row) => row.type !== 'track').slice(0, 12),
        topMusic,
        topLibraries: [],
        dayOfWeekCounts,
        hourDistribution,
        recentHistory,
        period: 'last365',
        source: 'jellyfin',
        compare: buildWrapUpCompare(
            {
                totalPlays,
                moviesCount,
                showsCount,
                musicCount,
                uniqueTitles,
                topMovie: topMovies[0] || null,
                topBinge: topShows[0] || null,
            },
            summarizeWrapUpHistoryWindow(priorItems),
            365,
            { currentItems: items, previousItems: priorItems, dayOfWeekCounts },
        ),
    };
};
