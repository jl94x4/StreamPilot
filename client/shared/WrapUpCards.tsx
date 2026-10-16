import React, { useMemo } from 'react';
import {
    Trophy, PlayCircle, Tv, Clapperboard, Clock, Calendar, Layers, PieChart, Compass, Coffee,
    Award, Flame, Gauge, Medal, Sparkles, Star, Target, type LucideIcon,
} from 'lucide-react';
import { formatStreamingHour } from './format';
import { portalUrl } from './basePath';
import { useDiscoverI18n } from '../discovery/i18n';
import type { DiscoverTranslate } from '../discovery/i18n/types';

export const periodLabel = (days: number | string, t?: DiscoverTranslate) => {
    const translate = t || ((key: string, vars?: Record<string, string | number>) => {
        if (key === 'wrapUp.allTime') return 'All Time';
        if (key === 'wrapUp.last7Days') return 'Last 7 Days';
        if (key === 'wrapUp.last30Days') return 'Last 30 Days';
        if (key === 'wrapUp.last60Days') return 'Last 60 Days';
        if (key === 'wrapUp.last90Days') return 'Last 90 Days';
        if (key === 'wrapUp.last120Days') return 'Last 120 Days';
        if (key === 'wrapUp.last180Days') return 'Last 180 Days';
        if (key === 'wrapUp.last365Days') return 'Last 365 Days';
        if (key === 'wrapUp.lastNDays') return `Last ${vars?.days ?? days} Days`;
        return key;
    });
    if (days === 'all') return translate('wrapUp.allTime');
    if (days === 7) return translate('wrapUp.last7Days');
    if (days === 30) return translate('wrapUp.last30Days');
    if (days === 60) return translate('wrapUp.last60Days');
    if (days === 90) return translate('wrapUp.last90Days');
    if (days === 120) return translate('wrapUp.last120Days');
    if (days === 180) return translate('wrapUp.last180Days');
    if (days === 365) return translate('wrapUp.last365Days');
    return translate('wrapUp.lastNDays', { days: Number(days) || 0 });
};

export const isYearInReviewPeriod = (days: number | string) => String(days) === '365';

export const wrapUpPriorPeriodLabel = (days: number | string | null | undefined, t?: DiscoverTranslate) => {
    const translate = t || ((key: string, vars?: Record<string, string | number>) => {
        if (key === 'wrapUp.priorPeriod7') return 'the previous 7 days';
        if (key === 'wrapUp.priorPeriod30') return 'last month';
        if (key === 'wrapUp.priorPeriod60') return 'the previous 60 days';
        if (key === 'wrapUp.priorPeriod90') return 'the previous 90 days';
        if (key === 'wrapUp.priorPeriod120') return 'the previous 120 days';
        if (key === 'wrapUp.priorPeriod180') return 'the previous 180 days';
        if (key === 'wrapUp.priorPeriod365') return 'last year';
        if (key === 'wrapUp.priorPeriodN') return `the previous ${vars?.days ?? days} days`;
        return key;
    });
    const value = String(days ?? '');
    if (value === '7') return translate('wrapUp.priorPeriod7');
    if (value === '30') return translate('wrapUp.priorPeriod30');
    if (value === '60') return translate('wrapUp.priorPeriod60');
    if (value === '90') return translate('wrapUp.priorPeriod90');
    if (value === '120') return translate('wrapUp.priorPeriod120');
    if (value === '180') return translate('wrapUp.priorPeriod180');
    if (value === '365') return translate('wrapUp.priorPeriod365');
    return translate('wrapUp.priorPeriodN', { days: value || 0 });
};

export const formatWrapUpDelta = (delta: { absolute?: number; percent?: number | null; previous?: number } | null | undefined, t?: DiscoverTranslate) => {
    if (!delta) return null;
    const absolute = Number(delta.absolute) || 0;
    const previous = Number(delta.previous) || 0;
    if (absolute === 0 && previous === 0) return null;
    const translate = t || ((key: string) => (key === 'wrapUp.compareNew' ? 'New' : key));
    if (delta.percent != null && Number.isFinite(Number(delta.percent))) {
        const sign = absolute >= 0 ? '+' : '';
        return `${sign}${delta.percent}%`;
    }
    if (previous === 0 && absolute > 0) return translate('wrapUp.compareNew');
    const sign = absolute >= 0 ? '+' : '';
    return `${sign}${absolute}`;
};

const WrapUpDeltaChip: React.FC<{ delta?: { absolute?: number; percent?: number | null; previous?: number } | null; t?: DiscoverTranslate }> = ({ delta, t }) => {
    const label = formatWrapUpDelta(delta, t);
    if (!label) return null;
    const isUp = (Number(delta?.absolute) || 0) >= 0;
    return (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold tracking-wide ${isUp ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
            {label}
        </span>
    );
};

const FALLBACK_IMAGES = {
    rank: 'https://images.unsplash.com/photo-1755039466834-3322b29dc45e?auto=format&fit=crop&q=80&w=600',
    streams: 'https://images.unsplash.com/photo-1593784991095-a205069470b6?auto=format&fit=crop&q=80&w=600',
    binge: 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?auto=format&fit=crop&q=80&w=600',
    movie: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&q=80&w=600',
    time: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&q=80&w=600',
    day: 'https://images.unsplash.com/photo-1506784983877-45594efa4cbe?auto=format&fit=crop&q=80&w=600',
    library: 'https://images.unsplash.com/photo-1636750570049-aec176ca3784?auto=format&fit=crop&q=80&w=600',
    profile: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&q=80&w=600',
    style: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&q=80&w=600',
    habit: 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?auto=format&fit=crop&q=80&w=600',
    achievements: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&q=80&w=600',
    xp: 'https://images.unsplash.com/photo-1636750570049-aec176ca3784?auto=format&fit=crop&q=80&w=600',
    streak: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&q=80&w=600',
    badges: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&q=80&w=600',
};

export type WrapUpCardDef = {
    metric: string;
    label: string;
    bgImage: string;
    icon: LucideIcon;
    value: React.ReactNode;
    subValue?: React.ReactNode;
    delta?: React.ReactNode;
    valueClassName?: string;
};

const resolveCardImage = (url: string) => portalUrl(url);

export const buildWrapUpCards = (analytics: any, t?: DiscoverTranslate): WrapUpCardDef[] => {
    const translate = t || ((key: string, vars?: Record<string, string | number>) => {
        const fallbacks: Record<string, string> = {
            'wrapUp.serverRank': 'Server Rank',
            'wrapUp.serverRankOverall': 'Overall',
            'wrapUp.totalStreams': 'Total Streams',
            'wrapUp.topBinge': 'Top Binge',
            'wrapUp.topMovie': 'Top Movie',
            'wrapUp.timeOfDay': 'Time of Day',
            'wrapUp.topDay': 'Top Day',
            'wrapUp.topLibrary': 'Top Library',
            'wrapUp.mediaProfile': 'Media Profile',
            'wrapUp.watchStyle': 'Watch Style',
            'wrapUp.streamingHabit': 'Streaming Habit',
            'wrapUp.notRankedYet': 'Not ranked yet',
            'wrapUp.topPctOfUsers': `Top ${vars?.pct ?? ''}% of users`,
            'wrapUp.nothingYet': 'Nothing yet',
            'wrapUp.wasTitle': `was ${vars?.title ?? ''}`,
            'wrapUp.episodePlays': `${vars?.count ?? 0} episodes`,
            'wrapUp.plays': `${vars?.count ?? 0} plays`,
            'wrapUp.peakTime': `Peak Time: ${vars?.time ?? ''}`,
            'wrapUp.streamsCount': `${vars?.count ?? 0} streams`,
            'wrapUp.none': 'None',
            'wrapUp.prefersMovies': 'Prefers Movies',
            'wrapUp.prefersTvShows': 'Prefers TV Shows',
            'wrapUp.uniqueTitles': `${vars?.count ?? 0} unique titles`,
            'wrapUp.unknown': 'Unknown',
            'wrapUp.mixedBag': 'Mixed Bag',
            'wrapUp.achievementsTitle': 'Achievements',
            'wrapUp.achievementsHint': 'All-time XP progress',
            'wrapUp.level': 'Level',
            'wrapUp.totalXp': 'Total XP',
            'wrapUp.periodXp': 'Period XP',
            'wrapUp.periodXpSub': 'In selected range',
            'wrapUp.periodXpVsPrior': '{delta} vs prior period',
            'wrapUp.periodBadges': 'Badges this period',
            'wrapUp.periodBadgesSub': 'Unlocked in range',
            'wrapUp.xpToNext': 'XP to Next Level',
            'wrapUp.badges': 'Badges',
            'wrapUp.latestBadge': 'Latest Badge',
            'wrapUp.achievementsRank': 'Achievements Rank',
            'wrapUp.currentStreak': 'Current Streak',
            'wrapUp.longestStreak': 'Longest Streak',
            'wrapUp.hoursWatched': 'Hours Watched',
            'wrapUp.activeDays': 'Active Days',
            'wrapUp.topXpSource': 'Top XP Source',
            'wrapUp.uniqueCatalog': 'Unique Titles',
            'wrapUp.intoLevel': '{into} / {need} XP',
            'wrapUp.pctToLevel': '{pct}% to Lv {level}',
            'wrapUp.badgesCount': '{earned} / {total}',
            'wrapUp.badgesPct': '{pct}% complete',
            'wrapUp.levelXpSummary': 'Lv {level} · {xp} XP',
            'wrapUp.daysCount': '{count} days',
            'wrapUp.hoursCount': '{count} hrs',
            'wrapUp.noBadgesYet': 'None yet',
            'wrapUp.xpFrom': '{xp} XP from this',
            'wrapUp.moviesAndShows': '{movies} movies · {shows} shows',
            'wrapUp.breakdown.uniqueMovies': 'Unique movies',
            'wrapUp.breakdown.uniqueShows': 'Unique shows',
            'wrapUp.breakdown.uniqueMusic': 'Unique music',
            'wrapUp.breakdown.moviePlays': 'Movie plays',
            'wrapUp.breakdown.episodePlays': 'Episode plays',
            'wrapUp.breakdown.trackPlays': 'Track plays',
            'wrapUp.breakdown.totalPlays': 'Total plays',
            'wrapUp.breakdown.activeDays': 'Active days',
            'wrapUp.breakdown.longestStreak': 'Longest streak',
            'wrapUp.breakdown.weekendPlays': 'Weekend plays',
            'wrapUp.breakdown.hoursWatched': 'Hours watched',
        };
        return fallbacks[key] || key;
    });
    const dayCounts = Object.values(analytics?.dayOfWeekCounts || {})
        .map((value) => Number(value) || 0)
        .filter((value) => Number.isFinite(value));
    const topDayStreams = dayCounts.length > 0 ? Math.max(...dayCounts) : 0;
    const leaderboardRank = Number(analytics?.leaderboardRank);
    const totalActiveUsers = Number(analytics?.totalActiveUsers) || 0;
    const hasRank = Number.isFinite(leaderboardRank) && leaderboardRank > 0;
    const rankPct = hasRank && totalActiveUsers > 0
        ? Math.max(1, Math.round((leaderboardRank / totalActiveUsers) * 100))
        : null;
    const isXpRank = analytics?.leaderboardSource === 'achievements' || analytics?.leaderboardMetric === 'xp';
    const rankSub = [
        isXpRank ? translate('wrapUp.serverRankOverall') : null,
        rankPct ? translate('wrapUp.topPctOfUsers', { pct: rankPct }) : null,
    ].filter(Boolean).join(' · ') || undefined;

    return [
        {
            metric: 'Server Rank',
            label: translate('wrapUp.serverRank'),
            bgImage: FALLBACK_IMAGES.rank,
            icon: Trophy,
            valueClassName: 'text-xl md:text-2xl font-black leading-none',
            value: hasRank ? (
                <><span className="text-plex text-lg md:text-xl mr-0.5">#</span>{leaderboardRank}</>
            ) : translate('wrapUp.notRankedYet'),
            subValue: rankSub,
        },
        {
            metric: 'Total Streams',
            label: translate('wrapUp.totalStreams'),
            bgImage: FALLBACK_IMAGES.streams,
            icon: PlayCircle,
            valueClassName: 'text-xl md:text-2xl font-black leading-none',
            value: analytics.totalPlays || 0,
            subValue: (
                <span className="flex gap-2 justify-center flex-wrap items-center">
                    <span>🎬 {analytics.moviesCount || 0}</span>
                    <span>📺 {analytics.showsCount || 0}</span>
                    {(analytics.musicCount || 0) > 0 && <span>🎵 {analytics.musicCount}</span>}
                    <WrapUpDeltaChip delta={analytics.compare?.totalPlays} t={translate} />
                </span>
            ),
        },
        {
            metric: 'Top Binge',
            label: translate('wrapUp.topBinge'),
            bgImage: analytics.topBinge?.artUrl || analytics.topBinge?.thumbUrl || FALLBACK_IMAGES.binge,
            icon: Tv,
            valueClassName: 'text-sm font-bold line-clamp-2 leading-tight',
            value: analytics.topBinge?.title || translate('wrapUp.nothingYet'),
            subValue: (
                <span className="flex flex-col items-center gap-0.5">
                    <span>{translate('wrapUp.episodePlays', { count: analytics.topBinge?.plays || 0 })}</span>
                    {analytics.compare?.swaps?.topBinge?.from?.title ? (
                        <span className="text-[10px] font-semibold text-white/55 normal-case tracking-normal">
                            {translate('wrapUp.wasTitle', { title: analytics.compare.swaps.topBinge.from.title })}
                        </span>
                    ) : null}
                </span>
            ),
        },
        {
            metric: 'Top Movie',
            label: translate('wrapUp.topMovie'),
            bgImage: analytics.topMovie?.artUrl || analytics.topMovie?.thumbUrl || FALLBACK_IMAGES.movie,
            icon: Clapperboard,
            valueClassName: 'text-sm font-bold line-clamp-2 leading-tight',
            value: analytics.topMovie?.title || translate('wrapUp.nothingYet'),
            subValue: (
                <span className="flex flex-col items-center gap-0.5">
                    <span>{translate('wrapUp.plays', { count: analytics.topMovie?.plays || 0 })}</span>
                    {analytics.compare?.swaps?.topMovie?.from?.title ? (
                        <span className="text-[10px] font-semibold text-white/55 normal-case tracking-normal">
                            {translate('wrapUp.wasTitle', { title: analytics.compare.swaps.topMovie.from.title })}
                        </span>
                    ) : null}
                </span>
            ),
        },
        {
            metric: 'Time of Day',
            label: translate('wrapUp.timeOfDay'),
            bgImage: FALLBACK_IMAGES.time,
            icon: Clock,
            valueClassName: 'text-sm font-bold leading-tight',
            value: analytics.timeOfDay || translate('wrapUp.unknown'),
            subValue: translate('wrapUp.peakTime', { time: formatStreamingHour(analytics.peakHour ?? analytics.avgHour) }),
        },
        {
            metric: 'Top Day',
            label: translate('wrapUp.topDay'),
            bgImage: FALLBACK_IMAGES.day,
            icon: Calendar,
            valueClassName: 'text-sm font-bold leading-tight',
            value: analytics.popularDay || translate('wrapUp.unknown'),
            subValue: translate('wrapUp.streamsCount', { count: topDayStreams }),
        },
        {
            metric: 'Top Library',
            label: translate('wrapUp.topLibrary'),
            bgImage: FALLBACK_IMAGES.library,
            icon: Layers,
            valueClassName: 'text-sm font-bold line-clamp-2 leading-tight',
            value: analytics.favoriteLibrary || translate('wrapUp.none'),
            subValue: translate('wrapUp.plays', { count: analytics.topLibraries?.[0]?.plays || 0 }),
        },
        {
            metric: 'Media Profile',
            label: translate('wrapUp.mediaProfile'),
            bgImage: FALLBACK_IMAGES.profile,
            icon: PieChart,
            valueClassName: 'text-sm font-bold leading-tight',
            value: analytics.mediaPreference || translate('wrapUp.mixedBag'),
            subValue: analytics.moviesCount > analytics.showsCount
                ? translate('wrapUp.prefersMovies')
                : translate('wrapUp.prefersTvShows'),
        },
        {
            metric: 'Watch Style',
            label: translate('wrapUp.watchStyle'),
            bgImage: FALLBACK_IMAGES.style,
            icon: Compass,
            valueClassName: 'text-sm font-bold leading-tight',
            value: analytics.watchStyle || translate('wrapUp.unknown'),
            subValue: (
                <span className="flex gap-1.5 justify-center items-center flex-wrap">
                    <span>{translate('wrapUp.uniqueTitles', { count: analytics.uniqueTitles || 0 })}</span>
                    <WrapUpDeltaChip delta={analytics.compare?.uniqueTitles} t={translate} />
                </span>
            ),
        },
        {
            metric: 'Streaming Habit',
            label: translate('wrapUp.streamingHabit'),
            bgImage: FALLBACK_IMAGES.habit,
            icon: Coffee,
            valueClassName: 'text-sm font-bold leading-tight',
            value: analytics.streamingHabit || translate('wrapUp.unknown'),
            subValue: `${analytics.weekdayPlays || 0} WD • ${analytics.weekendPlays || 0} WE`,
        },
    ];
};

const mulberry32 = (seed: number) => {
    let a = seed >>> 0 || 1;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

const shuffleWithSeed = <T,>(items: T[], seed: number): T[] => {
    const next = [...items];
    const rand = mulberry32(seed);
    for (let i = next.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
    }
    return next;
};

const achievementsTranslateFallback = (key: string, vars?: Record<string, string | number>) => {
    const fallbacks: Record<string, string> = {
        'wrapUp.level': 'Level',
        'wrapUp.totalXp': 'Total XP',
        'wrapUp.periodXp': 'Period XP',
        'wrapUp.periodXpSub': 'In selected range',
        'wrapUp.periodXpVsPrior': '{delta} vs prior period',
        'wrapUp.periodBadges': 'Badges this period',
        'wrapUp.periodBadgesSub': 'Unlocked in range',
        'wrapUp.xpToNext': 'XP to Next Level',
        'wrapUp.badges': 'Badges',
        'wrapUp.latestBadge': 'Latest Badge',
        'wrapUp.achievementsRank': 'Achievements Rank',
        'wrapUp.currentStreak': 'Current Streak',
        'wrapUp.longestStreak': 'Longest Streak',
        'wrapUp.hoursWatched': 'Hours Watched',
        'wrapUp.activeDays': 'Active Days',
        'wrapUp.topXpSource': 'Top XP Source',
        'wrapUp.uniqueCatalog': 'Unique Titles',
        'wrapUp.intoLevel': `${vars?.into ?? 0} / ${vars?.need ?? 0} XP`,
        'wrapUp.pctToLevel': `${vars?.pct ?? 0}% to Lv ${vars?.level ?? 0}`,
        'wrapUp.badgesCount': `${vars?.earned ?? 0} / ${vars?.total ?? 0}`,
        'wrapUp.badgesPct': `${vars?.pct ?? 0}% complete`,
        'wrapUp.levelXpSummary': `Lv ${vars?.level ?? 0} · ${vars?.xp ?? 0} XP`,
        'wrapUp.daysCount': `${vars?.count ?? 0} days`,
        'wrapUp.hoursCount': `${vars?.count ?? 0} hrs`,
        'wrapUp.noBadgesYet': 'None yet',
        'wrapUp.xpFrom': `${vars?.xp ?? 0} XP from this`,
        'wrapUp.moviesAndShows': `${vars?.movies ?? 0} movies · ${vars?.shows ?? 0} shows`,
        'wrapUp.notRankedYet': 'Not ranked yet',
        'wrapUp.breakdown.uniqueMovies': 'Unique movies',
        'wrapUp.breakdown.uniqueShows': 'Unique shows',
        'wrapUp.breakdown.uniqueMusic': 'Unique music',
        'wrapUp.breakdown.moviePlays': 'Movie plays',
        'wrapUp.breakdown.episodePlays': 'Episode plays',
        'wrapUp.breakdown.trackPlays': 'Track plays',
        'wrapUp.breakdown.totalPlays': 'Total plays',
        'wrapUp.breakdown.activeDays': 'Active days',
        'wrapUp.breakdown.longestStreak': 'Longest streak',
        'wrapUp.breakdown.weekendPlays': 'Weekend plays',
        'wrapUp.breakdown.hoursWatched': 'Hours watched',
    };
    return fallbacks[key] || key;
};

/** Always Level + Total XP; pin Period XP when present; fill remaining from seeded pool. */
export const buildAchievementsWrapUpCards = (
    me: any,
    opts: { seed?: number; rank?: number | null; t?: DiscoverTranslate; limit?: number } = {},
): WrapUpCardDef[] => {
    const translate = opts.t || achievementsTranslateFallback;
    const cardLimit = Math.max(1, Math.min(12, Number(opts.limit) || 5));
    const lp = me?.levelProgress || {};
    const stats = me?.stats || {};
    const breakdown = me?.breakdown || {};
    const recent = Array.isArray(me?.recentEarned) ? me.recentEarned : [];
    const latest = recent[0];
    const level = Number(me?.level) || 1;
    const xp = Number(me?.xp) || 0;
    const periodXpRaw = me?.periodXp;
    const periodDays = me?.periodDays;
    const hasPeriodXp = periodXpRaw != null
        && Number.isFinite(Number(periodXpRaw))
        && periodDays != null
        && String(periodDays) !== 'all';
    const periodXp = hasPeriodXp ? Number(periodXpRaw) : 0;
    const earnedCount = Number(me?.earnedCount) || 0;
    const totalBadges = Number(me?.totalBadges) || 0;
    const into = Number(lp.xpIntoLevel) || 0;
    const need = Number(lp.xpForNextLevel) || 0;
    const progressPct = Math.min(100, Math.max(0, Number(lp.progressPct) || 0));
    const rank = opts.rank != null && Number.isFinite(Number(opts.rank)) ? Number(opts.rank) : null;

    const topBreakdown = Object.entries(breakdown)
        .map(([key, value]) => [key, Number(value) || 0] as const)
        .filter(([, value]) => value > 0)
        .sort((a, b) => b[1] - a[1])[0];

    const pinned: WrapUpCardDef[] = [
        {
            metric: 'Achievements Level',
            label: translate('wrapUp.level'),
            bgImage: FALLBACK_IMAGES.achievements,
            icon: Medal,
            valueClassName: 'text-xl md:text-2xl font-black leading-none',
            value: level,
            subValue: translate('wrapUp.intoLevel', { into, need }),
        },
        {
            metric: 'Achievements XP',
            label: translate('wrapUp.totalXp'),
            bgImage: FALLBACK_IMAGES.xp,
            icon: Sparkles,
            valueClassName: 'text-xl md:text-2xl font-black leading-none',
            value: xp.toLocaleString(),
            subValue: translate('wrapUp.pctToLevel', { pct: progressPct, level: level + 1 }),
        },
    ];

    if (hasPeriodXp) {
        const delta = me?.periodXpDelta;
        const hasDelta = delta != null && Number.isFinite(Number(delta));
        const d = hasDelta ? Number(delta) : 0;
        pinned.push({
            metric: 'Achievements Period XP',
            label: translate('wrapUp.periodXp'),
            bgImage: FALLBACK_IMAGES.xp,
            icon: Target,
            valueClassName: 'text-xl md:text-2xl font-black leading-none',
            value: periodXp.toLocaleString(),
            subValue: hasDelta
                ? translate('wrapUp.periodXpVsPrior', {
                    delta: `${d > 0 ? '+' : ''}${d.toLocaleString()}`,
                })
                : translate('wrapUp.periodXpSub'),
        });
        const periodBadges = Number(me?.periodBadgesEarned);
        if (Number.isFinite(periodBadges) && periodBadges > 0) {
            pinned.push({
                metric: 'Achievements Period Badges',
                label: translate('wrapUp.periodBadges'),
                bgImage: FALLBACK_IMAGES.badges,
                icon: Award,
                valueClassName: 'text-xl md:text-2xl font-black leading-none',
                value: periodBadges,
                subValue: translate('wrapUp.periodBadgesSub'),
            });
        }
    }

    const pool: WrapUpCardDef[] = [
        {
            metric: 'Achievements XP Next',
            label: translate('wrapUp.xpToNext'),
            bgImage: FALLBACK_IMAGES.xp,
            icon: Target,
            valueClassName: 'text-xl md:text-2xl font-black leading-none',
            value: Math.max(0, need - into).toLocaleString(),
            subValue: translate('wrapUp.intoLevel', { into, need }),
        },
        {
            metric: 'Achievements Badges',
            label: translate('wrapUp.badges'),
            bgImage: FALLBACK_IMAGES.badges,
            icon: Award,
            valueClassName: 'text-xl md:text-2xl font-black leading-none',
            value: translate('wrapUp.badgesCount', { earned: earnedCount, total: totalBadges }),
            subValue: translate('wrapUp.badgesPct', {
                pct: Math.round(totalBadges ? (earnedCount / totalBadges) * 100 : 0),
            }),
        },
        {
            metric: 'Achievements Latest Badge',
            label: translate('wrapUp.latestBadge'),
            bgImage: FALLBACK_IMAGES.badges,
            icon: Star,
            valueClassName: 'text-sm font-bold line-clamp-2 leading-tight',
            value: latest
                ? `${latest.icon || '🏅'} ${latest.name || translate('wrapUp.noBadgesYet')}`
                : translate('wrapUp.noBadgesYet'),
            subValue: latest?.rarity ? String(latest.rarity) : undefined,
        },
        {
            metric: 'Achievements Current Streak',
            label: translate('wrapUp.currentStreak'),
            bgImage: FALLBACK_IMAGES.streak,
            icon: Flame,
            valueClassName: 'text-xl md:text-2xl font-black leading-none',
            value: Number(stats.currentStreak) || 0,
            subValue: translate('wrapUp.daysCount', { count: Number(stats.currentStreak) || 0 }),
        },
        {
            metric: 'Achievements Longest Streak',
            label: translate('wrapUp.longestStreak'),
            bgImage: FALLBACK_IMAGES.streak,
            icon: Flame,
            valueClassName: 'text-xl md:text-2xl font-black leading-none',
            value: Number(stats.longestStreak) || 0,
            subValue: translate('wrapUp.daysCount', { count: Number(stats.longestStreak) || 0 }),
        },
        {
            metric: 'Achievements Hours',
            label: translate('wrapUp.hoursWatched'),
            bgImage: FALLBACK_IMAGES.time,
            icon: Clock,
            valueClassName: 'text-xl md:text-2xl font-black leading-none',
            value: Number(stats.hoursWatched) || 0,
            subValue: translate('wrapUp.hoursCount', { count: Number(stats.hoursWatched) || 0 }),
        },
        {
            metric: 'Achievements Active Days',
            label: translate('wrapUp.activeDays'),
            bgImage: FALLBACK_IMAGES.day,
            icon: Calendar,
            valueClassName: 'text-xl md:text-2xl font-black leading-none',
            value: Number(stats.activeDays) || 0,
            subValue: translate('wrapUp.daysCount', { count: Number(stats.activeDays) || 0 }),
        },
        {
            metric: 'Achievements Unique',
            label: translate('wrapUp.uniqueCatalog'),
            bgImage: FALLBACK_IMAGES.style,
            icon: Compass,
            valueClassName: 'text-xl md:text-2xl font-black leading-none',
            value: (Number(stats.uniqueMovies) || 0) + (Number(stats.uniqueShows) || 0),
            subValue: translate('wrapUp.moviesAndShows', {
                movies: Number(stats.uniqueMovies) || 0,
                shows: Number(stats.uniqueShows) || 0,
            }),
        },
    ];

    if (rank != null && rank > 0) {
        pool.push({
            metric: 'Achievements Rank',
            label: translate('wrapUp.achievementsRank'),
            bgImage: FALLBACK_IMAGES.rank,
            icon: Trophy,
            valueClassName: 'text-xl md:text-2xl font-black leading-none',
            value: (
                <><span className="text-plex text-lg md:text-xl mr-0.5">#</span>{rank}</>
            ),
            subValue: translate('wrapUp.levelXpSummary', { level, xp: xp.toLocaleString() }),
        });
    }

    if (topBreakdown) {
        const [key, value] = topBreakdown;
        pool.push({
            metric: 'Achievements Top XP',
            label: translate('wrapUp.topXpSource'),
            bgImage: FALLBACK_IMAGES.profile,
            icon: Gauge,
            valueClassName: 'text-sm font-bold line-clamp-2 leading-tight',
            value: translate(`wrapUp.breakdown.${key}`),
            subValue: translate('wrapUp.xpFrom', { xp: value }),
        });
    }

    const rotateCount = Math.max(0, cardLimit - pinned.length);
    const seeded = shuffleWithSeed(pool, Number(opts.seed) || Date.now());
    return [...pinned, ...seeded.slice(0, rotateCount)];
};

type WrapUpCardGridProps = {
    analytics?: any;
    cards?: WrapUpCardDef[];
    interactive?: boolean;
    onCardClick?: (metric: string) => void;
    minCardHeight?: number;
    className?: string;
    valueClassName?: string;
    /** Hide cards at/after this index from md+ (mobile-only extras). */
    desktopMaxCards?: number | null;
    /** Stable layout for html2canvas export — avoids line-clamp/SVG bleed on some browsers */
    variant?: 'default' | 'export';
};

const exportValueClassName = 'text-sm font-bold leading-normal';

const exportSubValue = (card: WrapUpCardDef, analytics: any): React.ReactNode => {
    if (card.metric === 'Total Streams') {
        const parts = [
            `Movies ${analytics.moviesCount || 0}`,
            `TV ${analytics.showsCount || 0}`,
        ];
        if ((analytics.musicCount || 0) > 0) parts.push(`Music ${analytics.musicCount}`);
        const delta = formatWrapUpDelta(analytics.compare?.totalPlays);
        if (delta) parts.push(delta);
        return parts.join(' · ');
    }
    return card.subValue;
};

const isLargeMetric = (metric: string) => (
    metric === 'Server Rank'
    || metric === 'Total Streams'
    || metric.startsWith('Achievements')
);

export const WrapUpCardGrid: React.FC<WrapUpCardGridProps> = ({
    analytics,
    cards: cardsProp,
    interactive = false,
    onCardClick,
    minCardHeight,
    className = '',
    valueClassName: defaultValueClassName = 'text-sm font-bold leading-tight',
    desktopMaxCards = null,
    variant = 'default',
}) => {
    const { t } = useDiscoverI18n();
    const cards = cardsProp || buildWrapUpCards(analytics, t);
    const isExport = variant === 'export';
    const resolvedMinHeight = minCardHeight ?? (isExport ? 128 : 112);
    const gridClass = isExport
        ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3'
        : `grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5 md:gap-3 ${className}`;

    return (
        <div className={gridClass} data-wrap-up-export-grid={isExport ? '' : undefined}>
            {cards.map((card, index) => {
                const Icon = card.icon;
                const valueClass = isExport
                    ? (isLargeMetric(card.metric)
                        ? 'text-xl md:text-2xl font-black leading-normal'
                        : exportValueClassName)
                    : (card.valueClassName || defaultValueClassName);
                const subValue = isExport ? exportSubValue(card, analytics) : card.subValue;
                const bgImage = resolveCardImage(card.bgImage);
                const desktopHidden = (
                    !isExport
                    && desktopMaxCards != null
                    && Number.isFinite(desktopMaxCards)
                    && index >= Number(desktopMaxCards)
                );
                return (
                    <div
                        key={card.metric}
                        data-wrap-up-card=""
                        onClick={interactive && onCardClick ? () => onCardClick(card.metric) : undefined}
                        className={`wrap-up-card rounded-xl relative border border-border/50 flex flex-col ${isExport ? 'isolate min-h-[108px] sm:min-h-[128px]' : 'overflow-hidden'} ${interactive ? 'cursor-pointer hover:ring-2 hover:ring-plex/50 transition-all group' : ''} ${desktopHidden ? 'md:hidden' : ''}`}
                        style={isExport ? undefined : { minHeight: `${resolvedMinHeight}px` }}
                    >
                        {isExport ? (
                            <>
                                <div className="absolute inset-0 z-0 overflow-hidden rounded-xl">
                                    <img
                                        src={bgImage}
                                        alt=""
                                        crossOrigin="anonymous"
                                        className={`absolute inset-0 w-full h-full object-cover opacity-60 ${interactive ? 'transition-transform duration-700 group-hover:scale-110' : ''}`}
                                    />
                                    <div className="absolute inset-0 bg-black/60" />
                                </div>
                                <div className="relative z-10 p-3 md:p-4 flex-1 flex flex-col items-center justify-center text-center">
                                    <div className="mb-2 flex h-6 w-6 flex-shrink-0 items-center justify-center">
                                        <Icon className="h-6 w-6 text-plex" />
                                    </div>
                                    <p className="text-gray-300 text-[10px] uppercase tracking-widest font-bold mb-1">{card.label}</p>
                                    <p
                                        className={`text-white mb-1 w-full px-0.5 overflow-visible ${valueClass}`}
                                        style={{ lineHeight: 1.35, WebkitLineClamp: 'unset' }}
                                    >
                                        {card.value}
                                    </p>
                                    {subValue && (
                                        <p className={`text-[10px] font-bold tracking-wider ${card.metric === 'Top Binge' || card.metric === 'Top Movie' ? 'text-plex' : 'text-gray-400'}`}>{subValue}</p>
                                    )}
                                    {card.delta ? <div className="mt-1">{card.delta}</div> : null}
                                </div>
                            </>
                        ) : (
                            <>
                                <img
                                    key={bgImage}
                                    src={bgImage}
                                    alt=""
                                    className={`wrap-up-card-bg absolute inset-0 w-full h-full object-cover z-0 opacity-55 ${interactive ? 'transition-transform duration-700 group-hover:scale-110' : ''}`}
                                />
                                <div className="wrap-up-card-scrim absolute inset-0 bg-black/65 z-10" />
                                <div className="relative z-20 p-3 md:p-4 flex-1 flex flex-col items-center justify-center text-center">
                                    <Icon className="w-5 h-5 md:w-6 md:h-6 text-plex mb-1.5 md:mb-2 flex-shrink-0" />
                                    <p className="wrap-up-card-label text-[10px] uppercase tracking-widest font-bold mb-1 text-white/70">
                                        {card.label}
                                    </p>
                                    <p className={`wrap-up-card-value text-white mb-1 ${valueClass}`}>
                                        {card.value}
                                    </p>
                                    {subValue && (
                                        <p className={`wrap-up-card-sub text-[10px] font-bold tracking-wider ${card.metric === 'Top Binge' || card.metric === 'Top Movie' ? 'text-plex' : 'text-white/55'}`}>
                                            {subValue}
                                        </p>
                                    )}
                                    {card.delta ? <div className="mt-1">{card.delta}</div> : null}
                                </div>
                            </>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export const AchievementsWrapUpSpotlight: React.FC<{
    me: any;
    rank?: number | null;
    seed: number;
    onOpenAchievements?: () => void;
    minCardHeight?: number;
}> = ({ me, rank = null, seed, onOpenAchievements, minCardHeight = 112 }) => {
    const { t } = useDiscoverI18n();
    const cards = useMemo(
        // Build 6 so mobile can fill a 2×3 grid; 6th is another seeded/random pool card.
        () => buildAchievementsWrapUpCards(me, { seed, rank, t, limit: 6 }),
        [me, rank, seed, t],
    );
    if (!me || !cards.length) return null;
    return (
        <div className="mt-6 pt-6 border-t border-white/10 space-y-3">
            <div className="flex items-center justify-between gap-3">
                <h4 className="text-xs uppercase tracking-widest text-muted font-bold flex items-center gap-2">
                    <Award className="w-4 h-4 text-plex" />
                    {t('wrapUp.achievementsTitle')}
                </h4>
                <p className="text-[10px] text-muted font-semibold">
                    {me?.periodXp != null && me?.periodDays != null && String(me.periodDays) !== 'all'
                        ? t('wrapUp.achievementsHintPeriod')
                        : t('wrapUp.achievementsHint')}
                </p>
            </div>
            <WrapUpCardGrid
                cards={cards}
                interactive={!!onOpenAchievements}
                onCardClick={onOpenAchievements ? () => onOpenAchievements() : undefined}
                minCardHeight={minCardHeight}
                desktopMaxCards={5}
            />
        </div>
    );
};
