import React, { useEffect, useMemo, useState } from 'react';
import {
    ArrowLeft,
    ChevronRight,
    Layers,
    ListVideo,
    Calendar,
    Clock,
    Play,
    Users,
    BarChart3,
    History,
    Pause,
    CheckCircle2,
    Circle,
} from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip } from 'recharts';
import { apiFetch } from '../shared/api';
import { portalUrl } from '../shared/basePath';
import { formatPortalDateTimeCompact, formatTime, toPortalDate } from '../shared/format';
import {
    DashboardHero,
    DashboardPageShell,
    DashboardPanel,
    DashboardStatCard,
    dashboardGlowClass,
} from '../shared/dashboard/DashboardChrome';
import { HistoryStreamInfoModal } from './HistoryStreamInfoModal';

type TitleHistoryRow = {
    id?: string | null;
    user?: string;
    userThumb?: string | null;
    date?: number;
    duration?: number;
    playDuration?: number | null;
    mediaDuration?: number | null;
    player?: string | null;
    platform?: string | null;
    product?: string | null;
    title?: string | null;
    episodeTitle?: string | null;
    seasonNumber?: number | null;
    episodeNumber?: number | null;
    startedAt?: number | null;
    stoppedAt?: number | null;
    pausedSeconds?: number | null;
    percentComplete?: number | null;
    watchedStatus?: number | null;
    transcodeDecision?: string | null;
    ipAddress?: string | null;
    location?: string | null;
    ratingKey?: string | null;
    parentRatingKey?: string | null;
};

type TitleUserRow = {
    user: string;
    userThumb?: string | null;
    plays: number;
    totalSeconds: number;
    lastWatchedAt?: number | null;
};

type TitleChildRow = {
    ratingKey: string;
    title: string;
    type?: string;
    index?: number | null;
    parentIndex?: number | null;
    thumb?: string | null;
    leafCount?: number | null;
    plays: number;
    uniqueUsers: number;
    lastWatchedAt?: number | null;
};

type TitleAnalyticsPayload = {
    item?: {
        ratingKey?: string;
        title?: string;
        type?: string;
        year?: number | string | null;
        thumb?: string | null;
        plexUrl?: string | null;
        summary?: string | null;
        index?: number | null;
        parentIndex?: number | null;
        parentRatingKey?: string | null;
        parentTitle?: string | null;
        grandparentRatingKey?: string | null;
        grandparentTitle?: string | null;
    };
    source?: 'tautulli' | 'plex';
    childKind?: 'season' | 'episode' | null;
    children?: TitleChildRow[];
    stats?: {
        plays?: number;
        uniqueUsers?: number;
        totalSeconds?: number;
        lastWatchedAt?: number | null;
    };
    users?: TitleUserRow[];
    history?: TitleHistoryRow[];
    byMonth?: Array<{ month: string; plays: number }>;
    byPlatform?: Array<{ platform: string; plays: number }>;
    error?: string;
};

const formatHours = (seconds = 0) => {
    const hrs = Math.max(0, Number(seconds) || 0) / 3600;
    if (hrs >= 10) return hrs.toFixed(0);
    if (hrs >= 1) return hrs.toFixed(1);
    const mins = Math.round((Number(seconds) || 0) / 60);
    return mins ? `${mins}m` : '0';
};

const formatHm = (seconds?: number | null) => {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    if (!total) return '0m';
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    if (mins > 0) return `${mins}m`;
    return `${total}s`;
};

const formatClock = (value?: number | string | null) => {
    const date = toPortalDate(value);
    return date ? formatTime(date) : '—';
};

const formatSeasonEpisode = (season?: number | null, episode?: number | null) => {
    const s = season != null && Number.isFinite(Number(season)) ? Number(season) : null;
    const e = episode != null && Number.isFinite(Number(episode)) ? Number(episode) : null;
    if (s == null && e == null) return null;
    if (s != null && e != null) return `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`;
    if (s != null) return `S${String(s).padStart(2, '0')}`;
    return `E${String(e).padStart(2, '0')}`;
};

const prettyStream = (value?: string | null) => {
    const raw = String(value || '').replace(/[_-]+/g, ' ').trim();
    if (!raw) return null;
    return raw.replace(/\b\w/g, (char) => char.toUpperCase());
};

const streamBadgeClass = (value?: string | null) => {
    const raw = String(value || '').toLowerCase();
    if (raw.includes('transcode')) return 'border-amber-400/30 bg-amber-500/15 text-amber-200';
    if (raw.includes('direct stream') || raw === 'copy') return 'border-sky-400/30 bg-sky-500/15 text-sky-200';
    if (raw.includes('direct')) return 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200';
    return 'border-white/10 bg-white/5 text-muted';
};

const formatMonthLabel = (month: string) => {
    const [year, mm] = String(month || '').split('-');
    if (!year || !mm) return month;
    const date = new Date(Number(year), Number(mm) - 1, 1);
    return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
};

const userThumbSrc = (thumb?: string | null) => plexThumbSrc(thumb, 64, 64);

const plexThumbSrc = (thumb?: string | null, width = 300, height = 450) => {
    if (!thumb) return '';
    if (thumb.startsWith('http') || thumb.startsWith('/api/')) return thumb;
    return portalUrl(`/api/plex/image?path=${encodeURIComponent(thumb)}&width=${width}&height=${height}`);
};

const childLabel = (row: TitleChildRow) => {
    if (row.index === 0) return row.title && !/^season\s*0$/i.test(row.title) ? row.title : 'Specials';
    return row.title || (row.index != null ? `Season ${row.index}` : 'Season');
};

const chartTooltipStyle = {
    background: '#111',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 12,
};
const chartTooltipCursor = { fill: 'rgba(255,255,255,0.05)' };

export const TitleAnalyticsPage: React.FC<{
    ratingKey: string;
    onBack: () => void;
    onViewUser?: (username: string) => void;
    onOpenTitle?: (ratingKey: string) => void;
}> = ({ ratingKey, onBack, onViewUser, onOpenTitle }) => {
    const [data, setData] = useState<TitleAnalyticsPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [historyPage, setHistoryPage] = useState(1);
    const [usersPage, setUsersPage] = useState(1);
    const [childrenPage, setChildrenPage] = useState(1);
    const [streamRow, setStreamRow] = useState<TitleHistoryRow | null>(null);
    const pageSize = 25;
    const usersPageSize = 10;

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        setHistoryPage(1);
        setUsersPage(1);
        setChildrenPage(1);
        setStreamRow(null);
        apiFetch(`/api/plex/analytics/title/${encodeURIComponent(ratingKey)}`)
            .then((res) => {
                if (cancelled) return;
                if (res?.error) {
                    setError(String(res.error));
                    setData(null);
                    return;
                }
                setData(res);
            })
            .catch((err: any) => {
                if (!cancelled) setError(err?.message || 'Failed to load title analytics');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [ratingKey]);

    const history = data?.history || [];
    const users = data?.users || [];
    const children = data?.children || [];
    const childKind = data?.childKind === 'episode' ? 'episode' : data?.childKind === 'season' ? 'season' : null;
    const childrenPageSize = childKind === 'episode' ? 24 : 12;
    const stats = data?.stats || {};
    const item = data?.item || {};
    const itemType = String(item.type || '').toLowerCase();
    const pageCount = Math.max(1, Math.ceil(history.length / pageSize));
    const pageRows = useMemo(() => {
        const start = (historyPage - 1) * pageSize;
        return history.slice(start, start + pageSize);
    }, [history, historyPage]);
    const usersPageCount = Math.max(1, Math.ceil(users.length / usersPageSize));
    const pageUsers = useMemo(() => {
        const start = (usersPage - 1) * usersPageSize;
        return users.slice(start, start + usersPageSize);
    }, [users, usersPage]);
    const childrenPageCount = Math.max(1, Math.ceil(children.length / childrenPageSize));
    const pageChildren = useMemo(() => {
        const start = (childrenPage - 1) * childrenPageSize;
        return children.slice(start, start + childrenPageSize);
    }, [children, childrenPage, childrenPageSize]);

    const chartData = (data?.byMonth || []).map((row) => ({
        ...row,
        label: formatMonthLabel(row.month),
    }));
    const platformChartData = data?.byPlatform || [];

    const isEpisode = itemType === 'episode';
    const posterSrc = item.thumb
        ? plexThumbSrc(item.thumb, isEpisode ? 640 : 600, isEpisode ? 360 : 900)
        : '';
    const showCrumbKey = itemType === 'season' ? item.parentRatingKey : item.grandparentRatingKey;
    const showCrumbTitle = itemType === 'season' ? item.parentTitle : item.grandparentTitle;
    const seasonCrumbKey = itemType === 'episode' ? item.parentRatingKey : null;
    const seasonCrumbTitle = itemType === 'episode'
        ? (item.parentTitle || (item.parentIndex != null ? `Season ${item.parentIndex}` : 'Season'))
        : null;
    const typeLabel = itemType ? itemType.toUpperCase() : null;
    const openTitle = (key?: string | null) => {
        const next = String(key || '').trim();
        if (next && onOpenTitle) onOpenTitle(next);
    };

    return (
        <DashboardPageShell>
            <DashboardHero
                accent="plex"
                eyebrow={showCrumbTitle || 'Library title'}
                title={item.title || (loading ? 'Loading…' : 'Title')}
                description={
                    [typeLabel, item.year, data?.source === 'tautulli' ? 'Tautulli history' : data?.source === 'plex' ? 'Plex history' : null]
                        .filter(Boolean)
                        .join(' · ')
                    || 'Everyone who watched this title on the server.'
                }
                icon={<BarChart3 className="h-3.5 w-3.5" />}
                actions={(
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={onBack}
                            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm font-bold text-text transition-colors hover:bg-white/5"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            Back to search
                        </button>
                        {item.plexUrl ? (
                            <a
                                href={item.plexUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-2 rounded-xl bg-plex px-4 py-2.5 text-sm font-bold text-background transition-colors hover:bg-plex-hover"
                            >
                                <Play className="h-4 w-4" />
                                View in Plex
                            </a>
                        ) : null}
                    </div>
                )}
            />

            {error ? (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>
            ) : null}

            {showCrumbKey || seasonCrumbKey ? (
                <nav className="flex flex-wrap items-center gap-1.5 text-sm">
                    {showCrumbKey ? (
                        <button
                            type="button"
                            onClick={() => openTitle(showCrumbKey)}
                            className="font-bold text-plex hover:underline"
                        >
                            {showCrumbTitle || 'Show'}
                        </button>
                    ) : null}
                    {seasonCrumbKey ? (
                        <>
                            <ChevronRight className="h-3.5 w-3.5 text-muted" />
                            <button
                                type="button"
                                onClick={() => openTitle(seasonCrumbKey)}
                                className="font-bold text-text hover:text-plex hover:underline"
                            >
                                {seasonCrumbTitle}
                            </button>
                        </>
                    ) : itemType === 'season' ? (
                        <>
                            <ChevronRight className="h-3.5 w-3.5 text-muted" />
                            <span className="text-muted">{item.title || 'Season'}</span>
                        </>
                    ) : null}
                    {itemType === 'episode' ? (
                        <>
                            <ChevronRight className="h-3.5 w-3.5 text-muted" />
                            <span className="text-muted">
                                {[formatSeasonEpisode(item.parentIndex, item.index), item.title].filter(Boolean).join(' · ')}
                            </span>
                        </>
                    ) : null}
                </nav>
            ) : null}

            <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
                <div className={`shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-black/30 shadow-xl ${isEpisode ? 'w-full max-w-xl lg:w-[28rem]' : 'w-36 sm:w-44'}`}>
                    {posterSrc ? (
                        <img
                            src={posterSrc}
                            alt={item.title || (isEpisode ? 'Episode still' : 'Poster')}
                            className={`${isEpisode ? 'aspect-video' : 'aspect-[2/3]'} w-full object-cover`}
                        />
                    ) : (
                        <div className={`flex ${isEpisode ? 'aspect-video' : 'aspect-[2/3]'} items-center justify-center text-xs font-bold uppercase tracking-widest text-muted`}>No art</div>
                    )}
                </div>
                {item.summary ? (
                    <p className="min-w-0 flex-1 text-sm leading-relaxed text-muted">{item.summary}</p>
                ) : (
                    <p className="min-w-0 flex-1 text-sm text-muted">
                        {loading ? 'Loading watch history…' : 'Server-wide plays, who watched it, and the full history for this title.'}
                    </p>
                )}
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <DashboardStatCard
                    label="Plays"
                    value={loading ? '…' : Number(stats.plays || 0).toLocaleString()}
                    icon={<Play className="h-4 w-4 text-plex" />}
                    glow={dashboardGlowClass('plex')}
                />
                <DashboardStatCard
                    label="Watchers"
                    value={loading ? '…' : Number(stats.uniqueUsers || 0).toLocaleString()}
                    icon={<Users className="h-4 w-4 text-emerald-300" />}
                    glow={dashboardGlowClass('emerald')}
                />
                <DashboardStatCard
                    label="Watch time"
                    value={loading ? '…' : formatHours(stats.totalSeconds)}
                    hint={Number(stats.totalSeconds || 0) >= 3600 ? 'hours' : 'minutes'}
                    icon={<Clock className="h-4 w-4 text-amber-300" />}
                    glow={dashboardGlowClass('amber')}
                />
                <DashboardStatCard
                    label="Last watched"
                    value={loading ? '…' : (stats.lastWatchedAt ? formatPortalDateTimeCompact(stats.lastWatchedAt) : '—')}
                    icon={<Calendar className="h-4 w-4 text-sky-300" />}
                    glow={dashboardGlowClass('sky')}
                />
            </div>

            {!loading && childKind && children.length ? (
                <DashboardPanel
                    title={childKind === 'episode' ? 'Episodes' : 'Seasons'}
                    subtitle={
                        childKind === 'episode'
                            ? `${children.length} ${children.length === 1 ? 'episode' : 'episodes'} in this season`
                            : `${children.length} ${children.length === 1 ? 'season' : 'seasons'} in this show`
                    }
                    badge={(
                        <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted">
                            {childKind === 'episode' ? <ListVideo className="h-3 w-3" /> : <Layers className="h-3 w-3" />}
                            {children.length}
                        </span>
                    )}
                >
                    <div className="space-y-3">
                        {childKind === 'season' ? (
                            <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,11rem))] justify-start gap-3">
                                {pageChildren.map((row) => (
                                    <button
                                        key={row.ratingKey}
                                        type="button"
                                        onClick={() => openTitle(row.ratingKey)}
                                        className="group min-w-0 text-left"
                                    >
                                        <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
                                            {row.thumb ? (
                                                <img
                                                    src={plexThumbSrc(row.thumb, 600, 900)}
                                                    alt=""
                                                    className="aspect-[2/3] w-full object-cover transition-transform group-hover:scale-[1.03]"
                                                />
                                            ) : (
                                                <div className="flex aspect-[2/3] items-center justify-center text-[10px] font-bold uppercase tracking-widest text-muted">No art</div>
                                            )}
                                        </div>
                                        <div className="mt-2 truncate text-sm font-bold text-text group-hover:text-plex">
                                            {childLabel(row)}
                                        </div>
                                        <div className="text-[11px] text-muted">
                                            {row.plays} {row.plays === 1 ? 'play' : 'plays'}
                                            {row.leafCount ? ` · ${row.leafCount} ep` : ''}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
                                {pageChildren.map((row) => {
                                    const code = formatSeasonEpisode(row.parentIndex ?? item.index, row.index);
                                    const episodeNumber = row.index != null && Number.isFinite(Number(row.index))
                                        ? `Episode ${Number(row.index)}`
                                        : code;
                                    return (
                                        <button
                                            key={row.ratingKey}
                                            type="button"
                                            onClick={() => openTitle(row.ratingKey)}
                                            className="group min-w-0 text-left"
                                        >
                                            <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
                                                {row.thumb ? (
                                                    <img
                                                        src={plexThumbSrc(row.thumb, 640, 360)}
                                                        alt=""
                                                        className="aspect-video w-full object-cover transition-transform group-hover:scale-[1.03]"
                                                    />
                                                ) : (
                                                    <div className="flex aspect-video items-center justify-center text-[10px] font-bold uppercase tracking-widest text-muted">No art</div>
                                                )}
                                            </div>
                                            <div className="mt-2 truncate text-sm font-bold text-text group-hover:text-plex">
                                                {row.title || episodeNumber || 'Episode'}
                                            </div>
                                            <div className="truncate text-[11px] text-muted">
                                                {[episodeNumber, `${row.plays} ${row.plays === 1 ? 'play' : 'plays'}`].filter(Boolean).join(' · ')}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        {childrenPageCount > 1 ? (
                            <div className="flex items-center justify-between text-xs text-muted">
                                <button
                                    type="button"
                                    disabled={childrenPage <= 1}
                                    onClick={() => setChildrenPage((page) => Math.max(1, page - 1))}
                                    className="rounded-lg border border-white/10 px-3 py-1.5 font-bold disabled:opacity-40"
                                >
                                    Previous
                                </button>
                                <span>Page {childrenPage} of {childrenPageCount}</span>
                                <button
                                    type="button"
                                    disabled={childrenPage >= childrenPageCount}
                                    onClick={() => setChildrenPage((page) => Math.min(childrenPageCount, page + 1))}
                                    className="rounded-lg border border-white/10 px-3 py-1.5 font-bold disabled:opacity-40"
                                >
                                    Next
                                </button>
                            </div>
                        ) : null}
                    </div>
                </DashboardPanel>
            ) : null}

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <DashboardPanel title="Who watched" subtitle={`${users.length} ${users.length === 1 ? 'person' : 'people'} on this server`}>
                    {loading ? (
                        <p className="py-6 text-center text-sm text-muted">Loading watchers…</p>
                    ) : users.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted">No watch history for this title yet.</p>
                    ) : (
                        <div className="space-y-3">
                            <div className="divide-y divide-white/5">
                                {pageUsers.map((row) => (
                                    <button
                                        key={row.user}
                                        type="button"
                                        onClick={() => onViewUser?.(row.user)}
                                        className="flex w-full min-w-0 items-center gap-3 px-1 py-2.5 text-left transition-colors hover:bg-white/5"
                                    >
                                        {row.userThumb ? (
                                            <img src={userThumbSrc(row.userThumb)} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                                        ) : (
                                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-plex/20 text-[10px] font-bold uppercase text-plex">
                                                {row.user.slice(0, 2)}
                                            </div>
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-sm font-bold text-text">{row.user}</div>
                                            <div className="text-[11px] text-muted">
                                                {row.lastWatchedAt ? formatPortalDateTimeCompact(row.lastWatchedAt) : '—'}
                                            </div>
                                        </div>
                                        <div className="shrink-0 text-right">
                                            <div className="text-sm font-black tabular-nums text-text">{row.plays}</div>
                                            <div className="text-[10px] uppercase tracking-wider text-muted">plays</div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                            {usersPageCount > 1 ? (
                                <div className="flex items-center justify-between text-xs text-muted">
                                    <button
                                        type="button"
                                        disabled={usersPage <= 1}
                                        onClick={() => setUsersPage((page) => Math.max(1, page - 1))}
                                        className="rounded-lg border border-white/10 px-3 py-1.5 font-bold disabled:opacity-40"
                                    >
                                        Previous
                                    </button>
                                    <span>Page {usersPage} of {usersPageCount}</span>
                                    <button
                                        type="button"
                                        disabled={usersPage >= usersPageCount}
                                        onClick={() => setUsersPage((page) => Math.min(usersPageCount, page + 1))}
                                        className="rounded-lg border border-white/10 px-3 py-1.5 font-bold disabled:opacity-40"
                                    >
                                        Next
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    )}
                </DashboardPanel>

                <DashboardPanel title="Plays over time" subtitle="Monthly plays and platform views from server history">
                    {loading ? (
                        <p className="py-6 text-center text-sm text-muted">Loading chart…</p>
                    ) : chartData.length === 0 && platformChartData.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted">Not enough history to chart yet.</p>
                    ) : (
                        <div className="space-y-6">
                            {chartData.length ? (
                                <div>
                                    <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted">Monthly plays</p>
                                    <div className="h-56 pt-1">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                                                <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
                                                <YAxis allowDecimals={false} tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
                                                <RechartsTooltip
                                                    cursor={chartTooltipCursor}
                                                    contentStyle={chartTooltipStyle}
                                                    labelStyle={{ color: '#fff' }}
                                                    itemStyle={{ color: '#fff' }}
                                                />
                                                <Bar dataKey="plays" fill="rgb(var(--color-plex))" radius={[6, 6, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            ) : null}
                            {platformChartData.length ? (
                                <div>
                                    <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted">Platform views</p>
                                    <div className="h-56 pt-1">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={platformChartData} margin={{ top: 8, right: 8, left: -16, bottom: 8 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                                                <XAxis
                                                    dataKey="platform"
                                                    interval={0}
                                                    tick={{ fill: '#9ca3af', fontSize: 10 }}
                                                    axisLine={false}
                                                    tickLine={false}
                                                    tickFormatter={(value: string) => (String(value).length > 10 ? `${String(value).slice(0, 9)}…` : String(value))}
                                                />
                                                <YAxis allowDecimals={false} tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
                                                <RechartsTooltip
                                                    cursor={chartTooltipCursor}
                                                    contentStyle={chartTooltipStyle}
                                                    labelStyle={{ color: '#fff' }}
                                                    itemStyle={{ color: '#fff' }}
                                                />
                                                <Bar dataKey="plays" fill="rgb(56 189 248)" radius={[6, 6, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    )}
                </DashboardPanel>
            </div>

            <DashboardPanel
                title="Watch history"
                subtitle={data?.source === 'tautulli'
                    ? `${history.length} ${history.length === 1 ? 'play' : 'plays'} across the server · click a player for stream info`
                    : `${history.length} ${history.length === 1 ? 'play' : 'plays'} across the server`}
                badge={(
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-200">
                        <History className="h-3 w-3" />
                        {history.length}
                    </span>
                )}
            >
                {loading ? (
                    <p className="py-6 text-center text-sm text-muted">Loading history…</p>
                ) : history.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted">Nobody has watched this title on the server yet.</p>
                ) : (
                    <div className="space-y-3">
                        <div className="overflow-x-auto rounded-xl border border-white/10 custom-scrollbar">
                            <table className="w-full min-w-[1180px] border-collapse text-left">
                                <thead>
                                    <tr className="border-b border-white/10 bg-black/30 text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                                        <th className="whitespace-nowrap px-3 py-2.5 font-bold">Date</th>
                                        <th className="whitespace-nowrap px-3 py-2.5 font-bold">User</th>
                                        <th className="whitespace-nowrap px-3 py-2.5 font-bold">IP Address</th>
                                        <th className="whitespace-nowrap px-3 py-2.5 font-bold">Platform</th>
                                        <th className="whitespace-nowrap px-3 py-2.5 font-bold">Product</th>
                                        <th className="whitespace-nowrap px-3 py-2.5 font-bold">Player</th>
                                        <th className="px-3 py-2.5 font-bold">Title</th>
                                        <th className="whitespace-nowrap px-3 py-2.5 font-bold">Started</th>
                                        <th className="whitespace-nowrap px-3 py-2.5 font-bold">Paused</th>
                                        <th className="whitespace-nowrap px-3 py-2.5 font-bold">Stopped</th>
                                        <th className="whitespace-nowrap px-3 py-2.5 font-bold">Duration</th>
                                        <th className="whitespace-nowrap px-3 py-2.5 font-bold">Stream</th>
                                        <th className="w-10 px-3 py-2.5 font-bold"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {pageRows.map((row, index) => {
                                        const seasonEpisode = formatSeasonEpisode(row.seasonNumber, row.episodeNumber);
                                        const stream = prettyStream(row.transcodeDecision);
                                        const watched = row.watchedStatus === 1;
                                        const partial = row.watchedStatus === 0 || (row.percentComplete != null && row.percentComplete < 100 && !watched);
                                        return (
                                            <tr key={`${row.user}-${row.date}-${index}`} className="bg-black/10 text-xs text-muted hover:bg-white/5">
                                                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-text/80">
                                                    {row.date ? formatPortalDateTimeCompact(row.date) : '—'}
                                                </td>
                                                <td className="px-3 py-2.5">
                                                    <button
                                                        type="button"
                                                        onClick={() => row.user && onViewUser?.(row.user)}
                                                        className="flex min-w-0 max-w-[11rem] items-center gap-2 text-left"
                                                    >
                                                        {row.userThumb ? (
                                                            <img src={userThumbSrc(row.userThumb)} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
                                                        ) : (
                                                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold uppercase text-muted">
                                                                {(row.user || '?').slice(0, 2)}
                                                            </div>
                                                        )}
                                                        <span className="truncate text-sm font-bold text-text hover:text-plex">{row.user || 'Unknown'}</span>
                                                    </button>
                                                </td>
                                                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px]" title={row.location || undefined}>
                                                    {row.ipAddress || '—'}
                                                </td>
                                                <td className="whitespace-nowrap px-3 py-2.5 text-text/80">{row.platform || '—'}</td>
                                                <td className="whitespace-nowrap px-3 py-2.5">{row.product || '—'}</td>
                                                <td className="max-w-[10rem] truncate px-3 py-2.5 text-text/80">
                                                    <button
                                                        type="button"
                                                        onClick={() => setStreamRow(row)}
                                                        className="max-w-full truncate text-left hover:text-plex"
                                                        title={row.player ? `Stream info · ${row.player}` : 'Stream info'}
                                                    >
                                                        {row.player || '—'}
                                                    </button>
                                                </td>
                                                <td className="max-w-[18rem] px-3 py-2.5">
                                                    {row.ratingKey && onOpenTitle && String(row.ratingKey) !== String(ratingKey) ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => openTitle(row.ratingKey)}
                                                            className="block max-w-full truncate text-left font-medium text-text/90 hover:text-plex"
                                                            title={row.title || undefined}
                                                        >
                                                            {row.title || '—'}
                                                        </button>
                                                    ) : (
                                                        <div className="truncate font-medium text-text/90" title={row.title || undefined}>{row.title || '—'}</div>
                                                    )}
                                                    {seasonEpisode || row.episodeTitle ? (
                                                        <div className="truncate text-[11px] text-muted">
                                                            {seasonEpisode ? <span className="mr-1.5 font-mono text-plex">{seasonEpisode}</span> : null}
                                                            {row.episodeTitle && row.episodeTitle !== row.title ? row.episodeTitle : null}
                                                        </div>
                                                    ) : null}
                                                </td>
                                                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px]">{formatClock(row.startedAt)}</td>
                                                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px]">
                                                    {row.pausedSeconds ? (
                                                        <span className="inline-flex items-center gap-1 text-amber-200">
                                                            <Pause className="h-3 w-3" />
                                                            {formatHm(row.pausedSeconds)}
                                                        </span>
                                                    ) : '0m'}
                                                </td>
                                                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px]">{formatClock(row.stoppedAt)}</td>
                                                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-text/80">
                                                    {formatHm(row.playDuration ?? row.duration)}
                                                    {row.percentComplete != null && row.percentComplete < 100 ? (
                                                        <span className="ml-1.5 text-amber-300">{row.percentComplete}%</span>
                                                    ) : null}
                                                </td>
                                                <td className="whitespace-nowrap px-3 py-2.5">
                                                    {stream ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => setStreamRow(row)}
                                                            className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider hover:border-plex/50 ${streamBadgeClass(row.transcodeDecision)}`}
                                                            title="Stream info"
                                                        >
                                                            {stream}
                                                        </button>
                                                    ) : '—'}
                                                </td>
                                                <td className="px-3 py-2.5 text-center">
                                                    {watched ? (
                                                        <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-300" aria-label="Watched" />
                                                    ) : (
                                                        <Circle className={`mx-auto h-4 w-4 ${partial ? 'text-amber-300' : 'text-muted/50'}`} aria-label={partial ? 'Partial' : 'Not watched'} />
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {pageCount > 1 ? (
                            <div className="flex items-center justify-between text-xs text-muted">
                                <button
                                    type="button"
                                    disabled={historyPage <= 1}
                                    onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}
                                    className="rounded-lg border border-white/10 px-3 py-1.5 font-bold disabled:opacity-40"
                                >
                                    Previous
                                </button>
                                <span>Page {historyPage} of {pageCount}</span>
                                <button
                                    type="button"
                                    disabled={historyPage >= pageCount}
                                    onClick={() => setHistoryPage((page) => Math.min(pageCount, page + 1))}
                                    className="rounded-lg border border-white/10 px-3 py-1.5 font-bold disabled:opacity-40"
                                >
                                    Next
                                </button>
                            </div>
                        ) : null}
                    </div>
                )}
            </DashboardPanel>
            <HistoryStreamInfoModal row={streamRow} onClose={() => setStreamRow(null)} />
        </DashboardPageShell>
    );
};
