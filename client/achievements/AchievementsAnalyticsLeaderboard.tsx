import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Award, Loader2, Medal, Sparkles, Trophy,
} from 'lucide-react';
import {
    Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis, Cell,
} from 'recharts';
import { apiFetch } from '../shared/api';
import { logoUrl } from '../shared/basePath';
import { tAchievements, useAchievementsI18n } from './i18n';

type LeaderboardEntry = {
    rank: number;
    accountId?: string;
    username: string;
    xp: number;
    level: number;
    earnedCount: number;
    isMe?: boolean;
    thumb?: string | null;
};

type Props = {
    resolveAvatar: (thumb: string | null | undefined, w?: number, h?: number) => string;
    resolveThumbForUsername?: (username: string) => string | null | undefined;
    isAdmin: boolean;
    onUserClick: (u: { id?: string; username: string; thumb?: string | null }) => void;
};

const CHART_COLORS = ['#e5a00d', '#a78bfa', '#38bdf8', '#34d399', '#f472b6', '#fb923c', '#94a3b8', '#f87171', '#c084fc', '#2dd4bf'];

const shortName = (name: string, max = 10) => {
    const s = String(name || '');
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

export const AchievementsAnalyticsLeaderboard: React.FC<Props> = ({
    resolveAvatar,
    resolveThumbForUsername,
    onUserClick,
}) => {
    const { locale, tAchievements } = useAchievementsI18n();
    const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [enabled, setEnabled] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const prevRef = useRef<LeaderboardEntry[]>([]);

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const pull = async (initial: boolean) => {
            if (initial) {
                setLoading(true);
                setError(null);
            }
            try {
                const data = await apiFetch('/api/achievements/leaderboard?limit=100');
                if (cancelled) return;
                setEnabled(data?.enabled !== false);
                setEntries(Array.isArray(data?.entries) ? data.entries : []);
                const nextSyncing = !!data?.syncing;
                setSyncing(nextSyncing);
                if (nextSyncing) {
                    timer = setTimeout(() => { void pull(false); }, 4000);
                }
            } catch (e: any) {
                if (!cancelled && initial) setError(e?.message || tAchievements('analytics.error'));
            } finally {
                if (!cancelled && initial) setLoading(false);
            }
        };

        void pull(true);
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, []);

    useEffect(() => {
        prevRef.current = entries;
    }, [entries]);

    const byXp = entries;
    const byBadges = useMemo(
        () => [...entries].sort((a, b) => (b.earnedCount - a.earnedCount) || (b.xp - a.xp)),
        [entries],
    );
    const byLevel = useMemo(
        () => [...entries].sort((a, b) => (b.level - a.level) || (b.xp - a.xp)),
        [entries],
    );

    const top3 = byXp.slice(0, 3);
    const rest = byXp.slice(3, 12);
    const maxXp = Math.max(...byXp.map((u) => u.xp || 0), 1);

    const highlights = useMemo(() => {
        const topXp = byXp[0] || null;
        const topBadges = byBadges[0] || null;
        const topLevel = byLevel[0] || null;
        return [
            {
                key: 'xp',
                label: tAchievements('analytics.mostXp'),
                icon: Sparkles,
                accent: 'text-plex border-plex/40 bg-plex/10',
                user: topXp,
                value: topXp ? `${topXp.xp.toLocaleString()} XP` : '—',
                sub: topXp ? tAchievements('page.level', { level: topXp.level }) : '',
            },
            {
                key: 'badges',
                label: tAchievements('analytics.topBadgeHolder'),
                icon: Award,
                accent: 'text-fuchsia-300 border-fuchsia-400/40 bg-fuchsia-500/10',
                user: topBadges,
                value: topBadges ? tAchievements('common.badgeCount', { count: topBadges.earnedCount }) : '—',
                sub: topBadges ? `${topBadges.xp.toLocaleString()} XP` : '',
            },
            {
                key: 'level',
                label: tAchievements('analytics.highestLevel'),
                icon: Medal,
                accent: 'text-sky-300 border-sky-400/40 bg-sky-500/10',
                user: topLevel,
                value: topLevel ? tAchievements('page.level', { level: topLevel.level }) : '—',
                sub: topLevel ? tAchievements('common.badgeCount', { count: topLevel.earnedCount }) : '',
            },
        ];
    }, [byXp, byBadges, byLevel, locale]);

    const xpChart = useMemo(
        () => byXp.slice(0, 10).map((u) => ({ name: shortName(u.username), full: u.username, value: u.xp })),
        [byXp],
    );
    const levelChart = useMemo(
        () => byLevel.slice(0, 10).map((u) => ({ name: shortName(u.username), full: u.username, value: u.level })),
        [byLevel],
    );
    const badgeChart = useMemo(
        () => byBadges.slice(0, 10).map((u) => ({ name: shortName(u.username), full: u.username, value: u.earnedCount })),
        [byBadges],
    );

    const thumbFor = (entry: LeaderboardEntry | null | undefined) => {
        if (!entry) return null;
        return entry.thumb || resolveThumbForUsername?.(entry.username) || null;
    };

    const getRankDelta = (username: string, currentRank: number) => {
        const prev = prevRef.current;
        if (!prev?.length) return null;
        const prevIdx = prev.findIndex((u) => u.username === username);
        if (prevIdx === -1) return { type: 'new' as const };
        const diff = prevIdx - (currentRank - 1);
        if (diff > 0) return { type: 'up' as const, val: diff };
        if (diff < 0) return { type: 'down' as const, val: Math.abs(diff) };
        return null;
    };

    const openUser = (entry: LeaderboardEntry | null | undefined) => {
        if (!entry?.accountId) return;
        onUserClick({
            id: entry.accountId,
            username: entry.username,
            thumb: thumbFor(entry),
        });
    };

    const renderPodiumCard = (user: LeaderboardEntry, rank: number) => {
        const delta = getRankDelta(user.username, rank);
        const isFirst = rank === 1;
        const heightClass = isFirst ? 'h-48' : 'h-40';
        const ringClass = isFirst
            ? 'ring-2 ring-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.3)]'
            : rank === 2
                ? 'ring-1 ring-slate-300'
                : 'ring-1 ring-amber-700';

        return (
            <div
                onClick={() => openUser(user)}
                className={`flex flex-col items-center justify-end bg-card/80 border border-border rounded-xl p-4 relative ${user.accountId ? 'cursor-pointer hover:bg-black/30 hover:border-plex/40' : ''} transition-all group w-full ${heightClass} ${ringClass}`}
            >
                {isFirst && <div className="absolute -top-6 text-4xl animate-[crown-pulse_2s_ease-in-out_infinite]">👑</div>}
                {!isFirst && <div className="absolute -top-4 text-3xl">{rank === 2 ? '🥈' : '🥉'}</div>}

                <img
                    src={resolveAvatar(thumbFor(user), 80, 80)}
                    alt={user.username}
                    onError={(e) => { (e.target as HTMLImageElement).src = logoUrl(); }}
                    className={`rounded-full object-cover mb-2 border-2 ${isFirst ? 'w-20 h-20 border-yellow-500' : 'w-16 h-16 border-border'} bg-card`}
                />
                <span className="font-bold text-text group-hover:text-plex transition-colors truncate w-full text-center">
                    {user.username}{user.isMe ? ` ${tAchievements('dossier.you')}` : ''}
                </span>
                <span className="text-xs text-muted font-mono mt-1">{user.xp.toLocaleString()} XP</span>
                <span className="text-[10px] text-muted/80 font-mono">
                    {tAchievements('analytics.levelBadgeLine', { level: user.level, count: user.earnedCount })}
                </span>

                {delta && (
                    <div className="absolute -right-2 -top-2">
                        {delta.type === 'new' && <span className="bg-plex text-black text-[9px] font-bold px-1.5 py-0.5 rounded-full">{tAchievements('analytics.newRank')}</span>}
                        {delta.type === 'up' && <span className="bg-green-500/20 text-green-400 text-[10px] font-bold px-1.5 py-0.5 rounded">↑{delta.val}</span>}
                        {delta.type === 'down' && <span className="bg-red-500/20 text-red-400 text-[10px] font-bold px-1.5 py-0.5 rounded">↓{delta.val}</span>}
                    </div>
                )}
            </div>
        );
    };

    const chartTooltipStyle: React.CSSProperties = {
        backgroundColor: 'rgba(17, 19, 21, 0.96)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 8,
        color: '#f5f5f5',
        fontSize: 12,
        fontWeight: 600,
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        padding: '8px 10px',
    };
    const chartTooltipLabelStyle: React.CSSProperties = {
        color: '#f5f5f5',
        marginBottom: 4,
        fontWeight: 700,
    };
    const chartTooltipItemStyle: React.CSSProperties = {
        color: '#e5e7eb',
        padding: 0,
    };
    const chartCursor = { fill: 'rgba(229, 160, 13, 0.12)' };

    const title = (
        <div className="flex flex-col gap-1">
            <h2 className="text-xl font-bold text-text uppercase tracking-wider flex items-center gap-2">
                <Trophy className="text-plex w-5 h-5" /> {tAchievements('analytics.hallOfFame')}
            </h2>
            <p className="text-xs text-muted">{tAchievements('analytics.subtitle')}</p>
        </div>
    );

    if (loading) {
        return (
            <div className="w-full flex flex-col gap-4">
                {title}
                <div className="glass-card p-10 flex items-center justify-center gap-3 text-muted text-sm">
                    <Loader2 className="w-5 h-5 animate-spin text-plex" /> {tAchievements('analytics.syncingXp')}
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="w-full flex flex-col gap-4">
                {title}
                <p className="text-sm text-red-300">{error}</p>
            </div>
        );
    }

    if (!enabled || !entries.length) {
        return (
            <div className="w-full flex flex-col gap-4">
                {title}
                <p className="text-sm text-muted">
                    {!enabled
                        ? tAchievements('analytics.leaderboardOff')
                        : tAchievements('analytics.noRankingsYet')}
                </p>
            </div>
        );
    }

    return (
        <div className="w-full flex flex-col gap-6">
            {title}
            {syncing ? (
                <p className="flex items-center gap-2 text-xs text-muted">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-plex" />
                    {tAchievements('analytics.syncingXp')}
                </p>
            ) : null}

            {/* Same podium + ranked list layout as the classic plays Hall of Fame */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {top3.length > 0 && (
                    <div className="lg:col-span-1 flex flex-col justify-center h-full pt-8 lg:pt-0">
                        <div className="flex items-end justify-center gap-2 sm:gap-4">
                            {top3[1] && <div className="flex-1 max-w-[120px]">{renderPodiumCard(top3[1], 2)}</div>}
                            <div className="flex-1 max-w-[140px] z-10">{renderPodiumCard(top3[0], 1)}</div>
                            {top3[2] && <div className="flex-1 max-w-[120px]">{renderPodiumCard(top3[2], 3)}</div>}
                        </div>
                    </div>
                )}

                <div className="lg:col-span-2 flex flex-col gap-2 justify-center">
                    {rest.map((user, idx) => {
                        const rank = idx + 4;
                        const delta = getRankDelta(user.username, rank);
                        const pct = Math.max(2, (user.xp / maxXp) * 100);
                        const hasFire = user.xp >= maxXp * 0.4 && user.xp > 0;

                        return (
                            <div
                                key={`${user.accountId || user.username}-${rank}`}
                                onClick={() => openUser(user)}
                                className={`flex items-center gap-3 sm:gap-4 bg-black/20 p-2 sm:p-3 rounded-lg border border-border/50 ${user.accountId ? 'cursor-pointer hover:bg-black/40 hover:border-plex/50' : ''} transition-colors group relative overflow-hidden`}
                            >
                                <div className="absolute left-0 top-0 bottom-0 bg-plex/10" style={{ width: `${pct}%` }} />
                                <div className="w-6 text-center font-bold text-muted group-hover:text-text z-10">#{rank}</div>
                                <img
                                    src={resolveAvatar(thumbFor(user), 40, 40)}
                                    onError={(e) => { (e.target as HTMLImageElement).src = logoUrl(); }}
                                    className="w-8 h-8 rounded-full border border-border z-10 bg-card flex-shrink-0 object-cover"
                                    alt=""
                                />
                                <div className="flex-1 flex items-center gap-2 z-10 min-w-0">
                                    <span className="font-bold text-text truncate group-hover:text-plex transition-colors">
                                        {user.username}{user.isMe ? ` ${tAchievements('dossier.you')}` : ''}
                                    </span>
                                    {hasFire && <span className="text-sm" title={tAchievements('analytics.hotStreak')}>🔥</span>}
                                </div>
                                <div className="flex items-center gap-3 z-10 flex-shrink-0">
                                    {delta && (
                                        <div className="w-8 sm:w-10 text-right">
                                            {delta.type === 'new' && <span className="bg-plex/20 text-plex text-[9px] font-bold px-1.5 py-0.5 rounded">{tAchievements('analytics.newRank')}</span>}
                                            {delta.type === 'up' && <span className="text-green-400 text-xs font-bold">↑{delta.val}</span>}
                                            {delta.type === 'down' && <span className="text-red-400 text-xs font-bold">↓{delta.val}</span>}
                                        </div>
                                    )}
                                    <div className="min-w-[5.5rem] sm:min-w-[8rem] text-right font-mono text-xs sm:text-sm whitespace-nowrap">
                                        <span className="text-plex font-bold">{user.xp.toLocaleString()}</span>
                                        <span className="text-muted hidden sm:inline"> XP</span>
                                        <span className="block text-[10px] text-muted">
                                            {tAchievements('analytics.levelBadgeLine', { level: user.level, count: user.earnedCount })}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    {!rest.length && byXp.length <= 3 && (
                        <p className="text-sm text-muted px-1">{tAchievements('analytics.podiumOnly')}</p>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {highlights.map((h) => {
                    const Icon = h.icon;
                    return (
                        <button
                            key={h.key}
                            type="button"
                            disabled={!h.user?.accountId}
                            onClick={() => openUser(h.user)}
                            className={`text-left rounded-xl border p-3.5 transition-colors ${h.accent} ${h.user?.accountId ? 'hover:brightness-110 cursor-pointer' : 'cursor-default'}`}
                        >
                            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-bold opacity-80 mb-2">
                                <Icon className="w-3.5 h-3.5" /> {h.label}
                            </div>
                            <div className="flex items-center gap-2.5 min-w-0">
                                {h.user ? (
                                    <img
                                        src={resolveAvatar(thumbFor(h.user), 40, 40)}
                                        alt=""
                                        onError={(e) => { (e.target as HTMLImageElement).src = logoUrl(); }}
                                        className="w-9 h-9 rounded-full border border-white/15 object-cover bg-card shrink-0"
                                    />
                                ) : null}
                                <div className="min-w-0">
                                    <p className="text-base font-black truncate">{h.user?.username || '—'}</p>
                                    <p className="text-sm font-mono font-bold mt-0.5">{h.value}</p>
                                    {h.sub ? <p className="text-[11px] text-muted mt-0.5 font-mono">{h.sub}</p> : null}
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="glass-card p-4 flex flex-col gap-3 min-h-[240px]">
                    <h3 className="text-sm font-bold text-muted uppercase tracking-wider flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-plex" /> {tAchievements('analytics.xpLeaders')}
                    </h3>
                    <div className="flex-1 min-h-[180px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={xpChart} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" horizontal={false} />
                                <XAxis type="number" stroke="#ffffff40" fontSize={10} />
                                <YAxis type="category" dataKey="name" width={72} stroke="#ffffff40" fontSize={10} />
                                <RechartsTooltip
                                    cursor={chartCursor}
                                    contentStyle={chartTooltipStyle}
                                    labelStyle={chartTooltipLabelStyle}
                                    itemStyle={chartTooltipItemStyle}
                                    formatter={(value: any) => [tAchievements('analytics.xpValue', { value: Number(value).toLocaleString() }), 'XP']}
                                    labelFormatter={(_, payload: any) => payload?.[0]?.payload?.full || ''}
                                />
                                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                                    {xpChart.map((_, i) => (
                                        <Cell key={`xp-${i}`} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="glass-card p-4 flex flex-col gap-3 min-h-[240px]">
                    <h3 className="text-sm font-bold text-muted uppercase tracking-wider flex items-center gap-2">
                        <Medal className="w-4 h-4 text-sky-400" /> {tAchievements('analytics.highestLevel')}
                    </h3>
                    <div className="flex-1 min-h-[180px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={levelChart} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" horizontal={false} />
                                <XAxis type="number" stroke="#ffffff40" fontSize={10} allowDecimals={false} />
                                <YAxis type="category" dataKey="name" width={72} stroke="#ffffff40" fontSize={10} />
                                <RechartsTooltip
                                    cursor={chartCursor}
                                    contentStyle={chartTooltipStyle}
                                    labelStyle={chartTooltipLabelStyle}
                                    itemStyle={chartTooltipItemStyle}
                                    formatter={(value: any) => [tAchievements('analytics.levelValue', { value }), tAchievements('analytics.levelLabel')]}
                                    labelFormatter={(_, payload: any) => payload?.[0]?.payload?.full || ''}
                                />
                                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                                    {levelChart.map((_, i) => (
                                        <Cell key={`lv-${i}`} fill={CHART_COLORS[(i + 2) % CHART_COLORS.length]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="glass-card p-4 flex flex-col gap-3 min-h-[240px]">
                    <h3 className="text-sm font-bold text-muted uppercase tracking-wider flex items-center gap-2">
                        <Award className="w-4 h-4 text-fuchsia-400" /> {tAchievements('analytics.badgeCountChart')}
                    </h3>
                    <div className="flex-1 min-h-[180px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={badgeChart} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" horizontal={false} />
                                <XAxis type="number" stroke="#ffffff40" fontSize={10} allowDecimals={false} />
                                <YAxis type="category" dataKey="name" width={72} stroke="#ffffff40" fontSize={10} />
                                <RechartsTooltip
                                    cursor={chartCursor}
                                    contentStyle={chartTooltipStyle}
                                    labelStyle={chartTooltipLabelStyle}
                                    itemStyle={chartTooltipItemStyle}
                                    formatter={(value: any) => [tAchievements('analytics.badgeValue', { value }), tAchievements('xp.stat.badges')]}
                                    labelFormatter={(_, payload: any) => payload?.[0]?.payload?.full || ''}
                                />
                                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                                    {badgeChart.map((_, i) => (
                                        <Cell key={`bd-${i}`} fill={CHART_COLORS[(i + 4) % CHART_COLORS.length]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    );
};
