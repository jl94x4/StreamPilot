import React, { useEffect, useMemo, useState } from 'react';
import {
    ArrowDownRight, ArrowUpRight, Check, ChevronRight, Clock, Copy, Crown, Film, Library, Link2, Lock, LogOut, Mail,
    Minus, Music, Play, Share2, Shield, SlidersHorizontal, Sparkles, Swords, Trophy, Tv, User, UserCheck, UserPlus,
} from 'lucide-react';
import { apiFetch } from '../shared/api';
import { resolvePortalAssetUrl } from '../shared/basePath';
import { daysSinceDate, formatUkDate, getDaysUntilExpiry } from '../shared/format';
import { DashboardPageShell, DashboardPanel } from '../shared/dashboard/DashboardChrome';
import { discoverRowCardWidthClass } from '../shared/portalLayout';
import { ShareWrapUpModal } from '../shared/ShareWrapUp';
import { pushToast, ToastContainer, type ToastMessage } from '../shared/toast';
import { WrapUpCardGrid } from '../shared/WrapUpCards';
import { WrapUpCardsSkeleton } from '../shared/skeletons';
import { WrapUpModal } from '../shared/WrapUpModal';
import { ProfileBadgeRack } from '../achievements/AchievementsDashboard';
import { BadgeDetailDrawer } from '../achievements/BadgeDetailDrawer';
import { useDiscoverI18n } from '../discovery/i18n';
import {
    accessStatusTone,
    goToProfile,
    profileAccountIdFromPath,
    profileShareUrl,
    rarityGlow,
    relativeFromDays,
    requestDiscoveryPath,
    requestPoster,
    resolveAvatar,
    DEFAULT_USER_AVATAR,
    titleDiscoveryPath,
    trophyRarityClass,
} from './helpers';
import { DossierArena } from './DossierArena';
import { formatWatchHistoryWhen, WatchHistoryMediaCard } from '../shared/WatchHistoryMediaCard';

const TASTE_GLOW: Record<string, string> = {
    sky: 'bg-[radial-gradient(circle_at_100%_0%,rgb(56_189_248_/_0.28),transparent_72%)]',
    emerald: 'bg-[radial-gradient(circle_at_100%_0%,rgb(52_211_153_/_0.28),transparent_72%)]',
    violet: 'bg-[radial-gradient(circle_at_100%_0%,rgb(167_139_250_/_0.28),transparent_72%)]',
    plex: 'bg-[radial-gradient(circle_at_100%_0%,rgb(var(--color-plex)_/_0.32),transparent_72%)]',
};

const TasteStatCard: React.FC<{
    label: string;
    value: React.ReactNode;
    hint?: React.ReactNode;
    icon: React.ReactNode;
    glow?: keyof typeof TASTE_GLOW;
    onClick?: () => void;
}> = ({ label, value, hint, icon, glow = 'plex', onClick }) => {
    const body = (
        <>
            <div className={`pointer-events-none absolute inset-0 rounded-[inherit] ${TASTE_GLOW[glow] || TASTE_GLOW.plex}`} />
            {onClick ? (
                <div className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-[radial-gradient(circle_at_0%_100%,rgb(var(--color-plex)_/_0.18),transparent_58%)]" />
            ) : null}
            <div className="relative px-3.5 py-3.5">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">{label}</p>
                        <p className="mt-1.5 text-2xl font-black tabular-nums tracking-tight text-text">{value}</p>
                        {hint ? <p className="mt-1 text-[11px] text-muted">{hint}</p> : null}
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/30 text-text/80">
                        {icon}
                    </div>
                </div>
                {onClick ? (
                    <span className="relative mt-2.5 inline-flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-widest text-plex">
                        Open
                        <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                    </span>
                ) : null}
            </div>
        </>
    );
    const className = `relative isolate overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-black/45 shadow-lg ${
        onClick ? 'group w-full text-left transition-all hover:border-plex/40 hover:shadow-[0_0_24px_rgb(var(--color-plex)_/_0.18)]' : ''
    }`;
    if (onClick) {
        return (
            <button type="button" onClick={onClick} className={className}>
                {body}
            </button>
        );
    }
    return <div className={className}>{body}</div>;
};

const TasteGenreRow: React.FC<{
    label: string;
    icon: React.ReactNode;
    genres: Array<{ id?: string; label?: string; count?: number }>;
    tone: 'sky' | 'emerald';
}> = ({ label, icon, genres, tone }) => {
    if (!Array.isArray(genres) || !genres.length) return null;
    const chip = tone === 'sky'
        ? 'border-sky-400/20 bg-sky-500/10 text-sky-100'
        : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100';
    return (
        <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
                <span className={tone === 'sky' ? 'text-sky-300' : 'text-emerald-300'}>{icon}</span>
                {label}
            </div>
            <div className="flex flex-wrap gap-1.5">
                {genres.map((genre) => (
                    <span
                        key={genre.id || genre.label}
                        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold capitalize ${chip}`}
                    >
                        {genre.label} · {Number(genre.count) || 0}
                    </span>
                ))}
            </div>
        </div>
    );
};

const ProfileAboutTile: React.FC<{
    icon: React.ReactNode;
    label: string;
    children: React.ReactNode;
    glow?: 'plex' | 'sky' | 'violet';
}> = ({ icon, label, children, glow = 'plex' }) => {
    const glowClass = glow === 'sky'
        ? 'bg-[radial-gradient(circle_at_100%_0%,rgb(56_189_248_/_0.18),transparent_68%)]'
        : glow === 'violet'
            ? 'bg-[radial-gradient(circle_at_100%_0%,rgb(167_139_250_/_0.18),transparent_68%)]'
            : 'bg-[radial-gradient(circle_at_100%_0%,rgb(var(--color-plex)_/_0.18),transparent_68%)]';
    return (
        <div className="relative isolate overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-black/40 shadow-lg">
            <div className={`pointer-events-none absolute inset-0 ${glowClass}`} />
            <div className="relative flex items-start gap-3 p-3.5">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/35 text-plex">
                    {icon}
                </span>
                <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">{label}</p>
                    <div className="mt-1 text-sm font-semibold text-text leading-snug break-words">{children}</div>
                </div>
            </div>
        </div>
    );
};

const ProfileFollowingChip: React.FC<{
    peer: any;
    index: number;
    onNavigate: (route: string, options?: { path?: string }) => void;
}> = ({ peer, index, onNavigate }) => {
    const canOpen = !!peer.accountId && String(peer.username || '').toLowerCase() !== 'anonymous';
    const body = (
        <>
            <div className="relative shrink-0">
                <div className="absolute -inset-0.5 rounded-full bg-gradient-to-br from-plex/40 to-transparent opacity-70" />
                <img
                    src={resolveAvatar(peer.thumb, 56)}
                    alt=""
                    className="relative h-9 w-9 rounded-full border border-white/15 object-cover bg-black/40"
                />
            </div>
            <span className="min-w-0 flex-1 truncate text-sm font-bold text-text">{peer.username}</span>
            {canOpen ? <ChevronRight className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-plex" /> : null}
        </>
    );
    const className = 'group inline-flex w-full items-center gap-2.5 rounded-xl border border-white/10 bg-black/25 px-2.5 py-2 text-left transition-all hover:border-plex/35 hover:bg-black/35';
    if (canOpen) {
        return (
            <button
                key={peer.accountId || index}
                type="button"
                onClick={() => goToProfile(onNavigate, peer.accountId, peer.username)}
                className={className}
            >
                {body}
            </button>
        );
    }
    return (
        <div key={peer.accountId || index} className={`${className} text-muted`}>
            {body}
        </div>
    );
};

const ProfileLastWatchedCard: React.FC<{
    item: any;
    index: number;
    onNavigate: (route: string, options?: { path?: string }) => void;
    t: (key: string, vars?: Record<string, string | number>) => string;
}> = ({ item, onNavigate, t }) => {
    const discoveryPath = titleDiscoveryPath(item);
    const isMusic = String(item.type || '').toLowerCase() === 'track';
    return (
        <WatchHistoryMediaCard
            item={item}
            actionLabel={isMusic ? t('profilePage.listenedLabel') : t('profilePage.watchedLabel')}
            subtitle={item.episodeTitle || null}
            when={formatWatchHistoryWhen(item.viewedAt, t)}
            onOpen={discoveryPath ? () => onNavigate('discovery', { path: discoveryPath }) : undefined}
        />
    );
};

type Props = {
    sessionInfo?: any;
    onNavigate: (route: string, options?: { path?: string }) => void;
    onLogout: () => void;
    locationPath?: string;
    onViewAsUser?: (userId: string) => Promise<void>;
};

export const ProfilePage: React.FC<Props> = ({
    sessionInfo,
    onNavigate,
    onLogout,
    locationPath,
    onViewAsUser,
}) => {
    const { t } = useDiscoverI18n();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copiedEmail, setCopiedEmail] = useState(false);
    const [copiedLink, setCopiedLink] = useState(false);
    const [shareWrapUpOpen, setShareWrapUpOpen] = useState(false);
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
    const [selectedBadgeId, setSelectedBadgeId] = useState<string | null>(null);
    const [pinnedIds, setPinnedIds] = useState<string[]>([]);
    const [pinBusy, setPinBusy] = useState(false);
    const [nowPlaying, setNowPlaying] = useState<any>(null);
    const [viewAsBusy, setViewAsBusy] = useState(false);
    const [followBusy, setFollowBusy] = useState(false);
    const accountId = profileAccountIdFromPath(locationPath);
    const mediaServerType = String(sessionInfo?.mediaServerType || 'plex').toLowerCase();
    const isJellyfinPortal = mediaServerType === 'jellyfin' || mediaServerType === 'emby';

    useEffect(() => {
        let cancelled = false;
        const path = accountId
            ? `/api/profile/${encodeURIComponent(accountId)}`
            : '/api/profile/me';
        setLoading(true);
        setError(null);
        apiFetch(path)
            .then((payload) => {
                if (!cancelled) setData(payload);
            })
            .catch((err: any) => {
                if (!cancelled) {
                    setData(null);
                    setError(err?.message || t('profilePage.loadFailed'));
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [accountId, t]);

    useEffect(() => {
        setSelectedMetric(null);
        setSelectedBadgeId(null);
        setCopiedLink(false);
        setShareWrapUpOpen(false);
        setNowPlaying(null);
    }, [accountId, data?.identity?.accountId]);

    useEffect(() => {
        if (!data || data.privacy?.locked) {
            setNowPlaying(null);
            return undefined;
        }
        const isSelfProfile = !!data.viewer?.isSelf;
        const subjectId = String(data.identity?.accountId || accountId || '').trim();
        const subjectName = String(data.identity?.username || '').trim().toLowerCase();
        const nameHidden = !subjectName || subjectName === 'anonymous' || /^viewer\s+\d+$/.test(subjectName);
        if (!subjectId && nameHidden) {
            setNowPlaying(null);
            return undefined;
        }
        let cancelled = false;
        const load = async () => {
            try {
                if (isSelfProfile) {
                    const payload = await apiFetch('/api/streams/now-playing') as {
                        session?: {
                            mediaType?: string;
                            title?: string;
                            episodeTitle?: string | null;
                            progress?: number;
                            state?: string;
                            tmdbId?: number | null;
                        } | null;
                    };
                    if (cancelled) return;
                    const session = payload?.session;
                    if (!session) {
                        setNowPlaying(null);
                        return;
                    }
                    const isTv = session.mediaType === 'tv';
                    setNowPlaying({
                        type: isTv ? 'episode' : 'movie',
                        title: isTv ? (session.episodeTitle || session.title) : session.title,
                        grandparentTitle: isTv ? session.title : null,
                        progress: session.progress,
                        state: session.state,
                        tmdbId: session.tmdbId,
                    });
                    return;
                }
                const payload = await apiFetch(
                    isJellyfinPortal ? '/api/jellyfin/dashboard?limit=5' : '/api/plex/dashboard?limit=5',
                );
                const sessions = Array.isArray(payload?.activeSessions) ? payload.activeSessions : [];
                const hit = sessions.find((session: any) => {
                    const sessionId = String(session?.accountId || '').trim();
                    const sessionName = String(session?.user || '').trim().toLowerCase();
                    if (subjectId && sessionId && sessionId === subjectId) return true;
                    if (nameHidden) return false;
                    return !!sessionName && sessionName === subjectName;
                }) || null;
                if (!cancelled) setNowPlaying(hit);
            } catch {
                if (!cancelled) setNowPlaying(null);
            }
        };
        void load();
        return () => { cancelled = true; };
    }, [accountId, data, isJellyfinPortal]);

    const identity = data?.identity || {};
    const account = data?.account;
    const achievements = data?.achievements;
    const isSelf = !!data?.viewer?.isSelf;
    const heroRarity = achievements?.lastBadge?.rarity || achievements?.trophyCase?.[0]?.rarity || 'common';
    const delta = Number(identity.rankDelta) || 0;
    const RankIcon = delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : Minus;
    const rankTone = delta > 0 ? 'text-emerald-300' : delta < 0 ? 'text-rose-300' : 'text-muted';
    const into = Number(identity.levelProgress?.xpIntoLevel) || 0;
    const need = Math.max(1, Number(identity.levelProgress?.xpForNextLevel) || 1);
    const xpPct = Math.min(100, Math.round((into / need) * 100));
    const joinDate = identity.joiningDate || account?.joiningDate || null;
    const joinUk = formatUkDate(joinDate);
    const joinRelative = relativeFromDays(daysSinceDate(joinDate), t);
    const lastSeenUk = formatUkDate(account?.lastLogin);
    const lastSeenRelative = relativeFromDays(daysSinceDate(account?.lastLogin), t);
    const daysLeft = getDaysUntilExpiry(account?.expiryDate || null);
    const accessStatus = String(account?.plexAccessStatus || 'unknown');
    const accessTone = accessStatusTone(accessStatus);
    const accessHeadline = account?.expiryDate
        ? t('profilePage.expiresOn', { date: formatUkDate(account.expiryDate) })
        : t('profilePage.unlimited');
    const accessSub = account?.expiryDate && daysLeft != null
        ? t('profilePage.daysLeft', { count: Math.max(0, daysLeft) })
        : t('profilePage.noExpiry');

    const copyEmail = async () => {
        const email = String(account?.email || '').trim();
        if (!email) return;
        try {
            await navigator.clipboard.writeText(email);
            setCopiedEmail(true);
            window.setTimeout(() => setCopiedEmail(false), 1800);
        } catch {
            setCopiedEmail(false);
        }
    };

    const copyProfileLink = async () => {
        const url = profileShareUrl(identity.accountId, isSelf);
        try {
            await navigator.clipboard.writeText(url);
            setCopiedLink(true);
            window.setTimeout(() => setCopiedLink(false), 1800);
        } catch {
            setCopiedLink(false);
        }
    };

    const toggleFollow = async () => {
        if (!data?.social?.canPin || followBusy) return;
        const next = !data.social.viewerPinned;
        const target = String(identity.accountId || accountId || '').trim();
        if (!target) return;
        setFollowBusy(true);
        try {
            await apiFetch('/api/profile/pin', {
                method: 'POST',
                body: JSON.stringify({ accountId: target, pinned: next }),
            });
            setData((prev: any) => (prev ? { ...prev, social: { ...prev.social, viewerPinned: next } } : prev));
        } catch (err: any) {
            setToasts((prev) => pushToast(prev, err?.message || t('profilePage.followFailed'), 'error'));
        } finally {
            setFollowBusy(false);
        }
    };

    const wrapAnalytics = data?.watch?.wrapUp || null;
    const wrapUpPending = !!data?.watch?.wrapUpPending && !(wrapAnalytics?.topMovie || wrapAnalytics?.topBinge);
    const canOpenWatchStory = !!(wrapAnalytics && (Number(wrapAnalytics.hoursWatched) > 0 || Number(wrapAnalytics.totalPlays) > 0));
    const recentWatched = useMemo(() => {
        const rows = Array.isArray(wrapAnalytics?.recentHistory) ? wrapAnalytics.recentHistory : [];
        const unique = [];
        const seen = new Set<string>();
        for (const item of rows) {
            const key = String(item?.title || '').trim().toLowerCase();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            unique.push(item);
            if (unique.length >= 4) break;
        }
        return unique;
    }, [wrapAnalytics]);
    const unlocks = Array.isArray(achievements?.earned) ? achievements.earned.slice(0, 8) : [];
    const story = data?.watch?.taste || {};
    const tasteView = useMemo(() => {
        const mix = story.mix || {};
        const mixTotal = Number(mix.total) || 0;
        const pct = (value: number) => (mixTotal > 0 ? Math.round((Number(value) / mixTotal) * 100) : 0);
        const genres = Array.isArray(story.genres) ? story.genres : [];
        return {
            mix,
            mixTotal,
            moviePct: pct(mix.movies),
            showPct: pct(mix.shows),
            musicPct: pct(mix.music),
            hours: Math.round(Number(story.hoursWatched) || 0),
            movieGenres: Array.isArray(story.movieGenres) ? story.movieGenres : genres.filter((genre: any) => genre?.kind === 'movie'),
            showGenres: Array.isArray(story.showGenres) ? story.showGenres : genres.filter((genre: any) => genre?.kind === 'show'),
        };
    }, [story]);

    useEffect(() => {
        if (Array.isArray(data?.achievements?.pinnedBadgeIds)) {
            setPinnedIds(data.achievements.pinnedBadgeIds.map(String));
        }
    }, [data?.achievements?.pinnedBadgeIds]);

    const selectedTrophy = useMemo(() => {
        if (!selectedBadgeId) return null;
        const pool = [
            ...(Array.isArray(achievements?.trophyCase) ? achievements.trophyCase : []),
            ...(Array.isArray(achievements?.earned) ? achievements.earned : []),
        ];
        const found = pool.find((badge: any) => String(badge?.id) === selectedBadgeId);
        return found ? { ...found, earned: true } : { id: selectedBadgeId, earned: true };
    }, [achievements, selectedBadgeId]);

    useEffect(() => {
        if (!selectedBadgeId || !isSelf) return undefined;
        let cancelled = false;
        apiFetch('/api/achievements/me?view=summary')
            .then((me: any) => {
                if (!cancelled && Array.isArray(me?.pinnedBadgeIds)) {
                    setPinnedIds(me.pinnedBadgeIds.map(String));
                }
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [selectedBadgeId, isSelf]);

    const openTitleInDiscover = (item: any, fallbackType?: string) => {
        const path = titleDiscoveryPath({
            ...item,
            title: item?.grandparentTitle || item?.title,
            type: item?.type || item?.kind || fallbackType,
            mediaType: item?.mediaType || item?.kind || item?.type || fallbackType,
        });
        if (path) onNavigate('discovery', { path });
    };

    const handleWrapUpCardClick = (metric: string) => {
        if (metric === 'Top Movie' && wrapAnalytics?.topMovie?.title) {
            openTitleInDiscover(wrapAnalytics.topMovie, 'movie');
            return;
        }
        if (metric === 'Top Binge' && wrapAnalytics?.topBinge?.title) {
            openTitleInDiscover(wrapAnalytics.topBinge, 'show');
            return;
        }
        setSelectedMetric(metric);
    };

    const reloadProfile = () => {
        const path = accountId
            ? `/api/profile/${encodeURIComponent(accountId)}`
            : '/api/profile/me';
        apiFetch(path).then(setData).catch(() => {});
    };

    const togglePin = async (badgeId: string) => {
        const id = String(badgeId);
        const next = pinnedIds.includes(id)
            ? pinnedIds.filter((value) => value !== id)
            : [...pinnedIds, id].slice(0, 3);
        setPinBusy(true);
        try {
            const res = await apiFetch('/api/achievements/me/pins', {
                method: 'POST',
                body: JSON.stringify({ ids: next }),
            });
            const saved = Array.isArray(res?.pinnedBadgeIds) ? res.pinnedBadgeIds.map(String) : next;
            setPinnedIds(saved);
            reloadProfile();
        } catch {
            /* drawer already shows pin control; ignore */
        } finally {
            setPinBusy(false);
        }
    };

    return (
        <DashboardPageShell>
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[rgb(var(--color-card))] shadow-[0_28px_80px_rgba(0,0,0,0.35)]">
                <div className={`pointer-events-none absolute inset-x-0 top-0 h-56 bg-gradient-to-b ${rarityGlow[heroRarity] || rarityGlow.common}`} />
                <div className="pointer-events-none absolute -right-16 top-10 h-48 w-48 rounded-full bg-plex/15 blur-3xl" />
                <div className="relative z-[1] px-5 sm:px-7 pt-6 pb-5">
                    {loading && (
                        <p className="text-sm text-muted py-10 text-center">{t('profilePage.loading')}</p>
                    )}
                    {error && !loading && (
                        <p className="text-sm text-red-300 py-10 text-center">{error}</p>
                    )}
                    {!loading && !error && data && (
                        <div className="flex flex-col lg:flex-row lg:items-end gap-5">
                            <div className="flex items-start gap-4 min-w-0 flex-1">
                                <div className="relative shrink-0">
                                    <div className="absolute -inset-1 rounded-full bg-gradient-to-br from-plex/50 via-amber-400/20 to-transparent blur-sm" />
                                    <img
                                        src={resolveAvatar(identity.thumb, 220)}
                                        alt=""
                                        className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full object-cover border-2 border-white/15 bg-black/40"
                                        onError={(e) => { (e.target as HTMLImageElement).src = DEFAULT_USER_AVATAR; }}
                                    />
                                    {identity.rank ? (
                                        <span className="absolute -bottom-1 -right-1 inline-flex items-center justify-center min-w-[2.25rem] h-8 px-1.5 rounded-full bg-plex text-xs font-black text-black shadow-lg">
                                            #{identity.rank}
                                        </span>
                                    ) : (
                                        <span className="absolute -bottom-1 -right-1 inline-flex items-center justify-center w-8 h-8 rounded-full bg-black/70 border border-white/15 text-plex">
                                            <User className="w-4 h-4" />
                                        </span>
                                    )}
                                </div>
                                <div className="min-w-0 pt-1">
                                    <p className="text-[10px] uppercase tracking-[0.28em] text-plex font-bold mb-1">
                                        {identity.classTitle?.label || identity.provider || t('profilePage.eyebrow')}
                                    </p>
                                    <h1 className="text-3xl sm:text-4xl font-black text-text truncate">
                                        {identity.username || (isSelf ? sessionInfo?.session?.username : '') || t('profilePage.member')}
                                        {identity.isMe ? (
                                            <span className="ml-2 text-sm font-bold text-plex">{t('profilePage.you')}</span>
                                        ) : null}
                                    </h1>
                                    <p className="text-sm text-muted mt-1 leading-snug">
                                        {nowPlaying
                                            ? t('profilePage.watchingNow', { title: nowPlaying.grandparentTitle || nowPlaying.title })
                                            : (identity.classTitle?.blurb || t('profilePage.subtitle', { provider: identity.provider || 'Plex' }))}
                                    </p>
                                    {data.social?.bio ? (
                                        <p className="mt-2 max-w-xl text-sm text-text/90 leading-relaxed">{data.social.bio}</p>
                                    ) : null}
                                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                                        {achievements?.enabled ? (
                                            <>
                                                <span className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-black/25 px-2 py-1 font-mono text-text">
                                                    {t('profilePage.level', { level: identity.level ?? '—' })}
                                                </span>
                                                <span className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-black/25 px-2 py-1 font-mono text-text">
                                                    {(Number(identity.xp) || 0).toLocaleString()} XP
                                                </span>
                                            </>
                                        ) : null}
                                        {identity.rank ? (
                                            <span className={`inline-flex items-center gap-1 rounded-lg border border-white/10 bg-black/25 px-2 py-1 ${rankTone}`}>
                                                <RankIcon className="w-3.5 h-3.5" />
                                                {delta > 0
                                                    ? t('profilePage.climbed', { n: delta })
                                                    : delta < 0
                                                        ? t('profilePage.dropped', { n: Math.abs(delta) })
                                                        : t('profilePage.steady')}
                                            </span>
                                        ) : null}
                                        <span className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-black/25 px-2 py-1 text-muted">
                                            {identity.provider}
                                        </span>
                                    </div>
                                    {achievements?.enabled ? (
                                        <div className="mt-4 max-w-md">
                                            <div className="flex items-center justify-between text-[10px] uppercase tracking-widest font-bold text-muted mb-1.5">
                                                <span>{t('profilePage.xpProgress')}</span>
                                                <span className="font-mono text-text normal-case tracking-normal">
                                                    {into.toLocaleString()} / {need.toLocaleString()}
                                                </span>
                                            </div>
                                            <div className="h-2 rounded-full bg-black/50 border border-white/5 overflow-hidden">
                                                <div
                                                    className="h-full rounded-full bg-gradient-to-r from-plex/80 to-plex shadow-[0_0_12px_rgba(229,160,13,0.35)]"
                                                    style={{ width: `${xpPct}%` }}
                                                />
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                            {data ? (
                                <div className="flex flex-wrap items-center gap-2 shrink-0">
                                    {data.social?.canPin ? (
                                        <button
                                            type="button"
                                            disabled={followBusy}
                                            onClick={() => { void toggleFollow(); }}
                                            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold disabled:opacity-50 ${
                                                data.social.viewerPinned
                                                    ? 'border-plex/40 bg-plex/15 text-plex'
                                                    : 'border-white/10 bg-black/25 text-text hover:border-plex/40'
                                            }`}
                                        >
                                            {data.social.viewerPinned ? <UserCheck className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                                            {data.social.viewerPinned ? t('profilePage.following') : t('profilePage.follow')}
                                        </button>
                                    ) : null}
                                    <button
                                        type="button"
                                        onClick={() => { void copyProfileLink(); }}
                                        className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm font-bold text-text hover:border-plex/40"
                                    >
                                        {copiedLink ? <Check className="w-4 h-4 text-emerald-300" /> : <Link2 className="w-4 h-4 text-plex" />}
                                        {copiedLink ? t('profilePage.linkCopied') : t('profilePage.copyLink')}
                                    </button>
                                    {isSelf ? (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => onNavigate('preferences')}
                                                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm font-bold text-text hover:border-plex/40"
                                            >
                                                <SlidersHorizontal className="w-4 h-4 text-plex" />
                                                {t('navigation.preferences')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={onLogout}
                                                className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-bold text-red-200 hover:bg-red-500/20"
                                            >
                                                <LogOut className="w-4 h-4" />
                                                {t('navigation.logout')}
                                            </button>
                                        </>
                                    ) : (data?.viewer?.isAdmin && account?.id && onViewAsUser) ? (
                                        <button
                                            type="button"
                                            disabled={viewAsBusy}
                                            onClick={() => {
                                                setViewAsBusy(true);
                                                void onViewAsUser(String(account.id)).finally(() => setViewAsBusy(false));
                                            }}
                                            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm font-bold text-text hover:border-plex/40 disabled:opacity-50"
                                        >
                                            <User className="w-4 h-4 text-plex" />
                                            {t('profilePage.viewAsUser')}
                                        </button>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    )}
                </div>
            </div>

            {!loading && !error && data && (
                <>
                    {data.privacy?.privateToPeers && data.viewer?.isAdmin && !isSelf ? (
                        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                            {t('profilePage.privateBanner')}
                        </div>
                    ) : null}

                    {data.privacy?.locked ? (
                        <DashboardPanel title={t('profilePage.privateTitle')}>
                            <div className="flex items-start gap-3 text-sm text-muted">
                                <Lock className="w-5 h-5 text-plex shrink-0 mt-0.5" />
                                <p>{t('profilePage.privateHint', { name: identity.username || t('profilePage.member') })}</p>
                            </div>
                        </DashboardPanel>
                    ) : null}

                    {!data.privacy?.locked && nowPlaying ? (
                        <DashboardPanel title={t('profilePage.currentlyWatching')} subtitle={t('profilePage.currentlyWatchingHint')}>
                            {(() => {
                                const watchingTitle = nowPlaying.grandparentTitle || nowPlaying.title;
                                const watchingPath = titleDiscoveryPath({
                                    title: watchingTitle,
                                    type: nowPlaying.type,
                                    tmdbId: nowPlaying.tmdbId,
                                    mbid: nowPlaying.mbid,
                                });
                                const body = (
                                    <>
                                        {nowPlaying.thumb ? (
                                            <img
                                                src={resolveAvatar(nowPlaying.thumb, 120)}
                                                alt=""
                                                className="w-16 h-24 rounded-lg object-cover border border-white/10 shrink-0"
                                            />
                                        ) : (
                                            <span className="inline-flex w-16 h-24 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-plex shrink-0">
                                                <Play className="w-6 h-6" />
                                            </span>
                                        )}
                                        <div className="min-w-0">
                                            <p className="text-sm font-black text-text truncate">
                                                {watchingTitle}
                                            </p>
                                            {nowPlaying.grandparentTitle && nowPlaying.title ? (
                                                <p className="text-xs text-muted truncate mt-0.5">{nowPlaying.title}</p>
                                            ) : null}
                                            <p className="text-[11px] text-muted mt-1 capitalize">
                                                {nowPlaying.state || 'playing'}
                                                {Number(nowPlaying.progress) > 0 ? ` · ${Math.round(Number(nowPlaying.progress))}%` : ''}
                                            </p>
                                        </div>
                                    </>
                                );
                                const watchingClass = 'flex items-center gap-3 rounded-2xl border border-white/10 bg-black/25 p-3 w-full text-left';
                                return watchingPath ? (
                                    <button
                                        type="button"
                                        onClick={() => onNavigate('discovery', { path: watchingPath })}
                                        className={`${watchingClass} hover:border-plex/40 hover:opacity-90`}
                                    >
                                        {body}
                                    </button>
                                ) : (
                                    <div className={watchingClass}>{body}</div>
                                );
                            })()}
                        </DashboardPanel>
                    ) : null}

                    {(() => {
                        const showAbout = !data.privacy?.locked && !!(data.social && (
                            data.social.email
                            || data.social.libraries
                            || (Array.isArray(data.social.following) && data.social.following.length)
                        ));
                        const showLastWatched = !data.privacy?.locked && recentWatched.length > 0;
                        if (!showAbout && !showLastWatched) return null;
                        const aboutPanel = showAbout ? (
                            <DashboardPanel title={t('profilePage.about')} className="h-full">
                                <div className="relative space-y-3">
                                    {data.social?.email ? (
                                        <ProfileAboutTile
                                            icon={<Mail className="h-4 w-4" />}
                                            label={t('profilePage.publicEmail')}
                                            glow="plex"
                                        >
                                            {data.social.email}
                                        </ProfileAboutTile>
                                    ) : null}
                                    {data.social?.libraries ? (
                                        <ProfileAboutTile
                                            icon={<Library className="h-4 w-4" />}
                                            label={t('profilePage.libraryAccess')}
                                            glow="sky"
                                        >
                                            {data.social.libraries.all
                                                ? t('profilePage.allLibraries')
                                                : (data.social.libraries.names || []).join(' · ')}
                                        </ProfileAboutTile>
                                    ) : null}
                                    {Array.isArray(data.social?.following) && data.social.following.length ? (
                                        <div className="relative isolate overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-black/40 p-3.5 shadow-lg">
                                            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_100%_0%,rgb(167_139_250_/_0.16),transparent_68%)]" />
                                            <div className="relative">
                                                <div className="mb-2.5 flex items-center justify-between gap-2">
                                                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
                                                        {t('profilePage.followingList')}
                                                    </p>
                                                    <span className="rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-[10px] font-bold text-muted">
                                                        {data.social.following.length}
                                                    </span>
                                                </div>
                                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                    {data.social.following.map((peer: any, index: number) => (
                                                        <ProfileFollowingChip
                                                            key={peer.accountId || index}
                                                            peer={peer}
                                                            index={index}
                                                            onNavigate={onNavigate}
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            </DashboardPanel>
                        ) : null;
                        const lastWatchedPanel = showLastWatched ? (
                        <DashboardPanel title={t('profilePage.lastWatched')} subtitle={t('profilePage.lastWatchedHint')} className="h-full min-w-0">
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                {recentWatched.map((item: any, index: number) => (
                                    <ProfileLastWatchedCard
                                        key={`${item.title}-${item.viewedAt || index}`}
                                        item={item}
                                        index={index}
                                        onNavigate={onNavigate}
                                        t={t}
                                    />
                                ))}
                            </div>
                        </DashboardPanel>
                        ) : null;
                        if (showAbout && showLastWatched) {
                            return (
                                <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 items-stretch">
                                    <div className="min-w-0">{aboutPanel}</div>
                                    <div className="min-w-0">{lastWatchedPanel}</div>
                                </div>
                            );
                        }
                        return aboutPanel || lastWatchedPanel;
                    })()}

                    {!data.privacy?.locked && (Number(story.activeDays) > 0 || Number(story.bingeMax) > 0 || Number(story.currentStreak) > 0 || Number(achievements?.firstUnlocks?.count) > 0) ? (
                        <DashboardPanel title={t('profilePage.serverStory')} subtitle={t('profilePage.serverStoryHint')}>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {[
                                    { label: t('profilePage.activeDays'), value: Number(story.activeDays) || 0 },
                                    { label: t('profilePage.currentStreak'), value: Number(story.currentStreak) || 0 },
                                    { label: t('profilePage.longestStreak'), value: Number(story.longestStreak) || 0 },
                                    { label: t('profilePage.longestBinge'), value: Number(story.bingeMax) || 0 },
                                ].filter((row) => row.value > 0).map((row) => (
                                    <div key={row.label} className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5">
                                        <p className="text-[10px] uppercase tracking-widest font-bold text-muted">{row.label}</p>
                                        <p className="mt-1 text-lg font-black text-text">{row.value}</p>
                                    </div>
                                ))}
                            </div>
                            {Number(achievements?.firstUnlocks?.count) > 0 ? (
                                <p className="text-sm text-muted mt-3">
                                    {t('profilePage.firstBloods', { count: Number(achievements.firstUnlocks.count) })}
                                </p>
                            ) : null}
                        </DashboardPanel>
                    ) : null}

                    {!data.privacy?.locked && data.compare ? (
                        <DashboardPanel title={t('profilePage.compare')} subtitle={t('profilePage.compareHint')}>
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                                <span className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/25 px-3 py-2 font-bold">
                                    <Swords className="w-4 h-4 text-plex" />
                                    {Number(data.compare.xpGap) > 0
                                        ? t('profilePage.xpAhead', { n: Math.abs(Number(data.compare.xpGap) || 0).toLocaleString() })
                                        : Number(data.compare.xpGap) < 0
                                            ? t('profilePage.xpBehind', { n: Math.abs(Number(data.compare.xpGap) || 0).toLocaleString() })
                                            : t('profilePage.xpTied')}
                                </span>
                                <span className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/25 px-3 py-2 font-bold">
                                    {t('profilePage.sharedBadges', { count: Number(data.compare.sharedCount) || 0 })}
                                </span>
                            </div>
                            {Array.isArray(data.compare.shared) && data.compare.shared.length ? (
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {data.compare.shared.map((badge: any) => (
                                        <button
                                            key={badge.id}
                                            type="button"
                                            onClick={() => setSelectedBadgeId(String(badge.id))}
                                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/25 px-2.5 py-1.5 text-xs font-bold hover:border-plex/40"
                                        >
                                            <span>{badge.icon || '🏅'}</span>
                                            <span className="truncate max-w-[10rem]">{badge.name}</span>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-muted mt-3">{t('profilePage.noSharedBadges')}</p>
                            )}
                            {Array.isArray(data.compare.sharedWatched) && data.compare.sharedWatched.length ? (
                                <div className="mt-4">
                                    <p className="text-[10px] uppercase tracking-widest font-bold text-muted mb-2">
                                        {t('profilePage.sharedWatched')}
                                    </p>
                                    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                                        {data.compare.sharedWatched.map((item: any) => {
                                            const discoveryPath = titleDiscoveryPath(item);
                                            const body = (
                                                <>
                                                    {item.thumbUrl ? (
                                                        <img
                                                            src={resolvePortalAssetUrl(item.thumbUrl)}
                                                            alt=""
                                                            className="w-20 h-[7.5rem] rounded-lg object-cover border border-white/10"
                                                        />
                                                    ) : (
                                                        <div className="w-20 h-[7.5rem] rounded-lg border border-white/10 bg-black/40" />
                                                    )}
                                                    <p className="mt-1 text-[11px] font-bold text-text truncate">{item.title}</p>
                                                </>
                                            );
                                            return discoveryPath ? (
                                                <button
                                                    key={`${item.kind}-${item.title}`}
                                                    type="button"
                                                    title={item.title}
                                                    onClick={() => onNavigate('discovery', { path: discoveryPath })}
                                                    className="w-20 shrink-0 text-left hover:opacity-90"
                                                >
                                                    {body}
                                                </button>
                                            ) : (
                                                <div
                                                    key={`${item.kind}-${item.title}`}
                                                    className="w-20 shrink-0"
                                                    title={item.title}
                                                >
                                                    {body}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ) : null}
                        </DashboardPanel>
                    ) : null}

                    {!data.privacy?.locked && data.watch?.taste && (Number(data.watch.taste.hoursWatched) > 0 || Number(data.watch.taste.mix?.total) > 0) ? (
                        <DashboardPanel title={t('profilePage.taste')} subtitle={t('profilePage.tasteHint')}>
                            <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[radial-gradient(circle_at_100%_0%,rgb(var(--color-plex)_/_0.12),transparent_46%)]" />
                            <div className="relative space-y-4">
                                {tasteView.mixTotal > 0 ? (
                                    <div>
                                        <div className="flex h-2 overflow-hidden rounded-full border border-white/10 bg-black/40">
                                            {tasteView.moviePct > 0 ? <div className="h-full bg-gradient-to-r from-sky-500 to-sky-300" style={{ width: `${tasteView.moviePct}%` }} /> : null}
                                            {tasteView.showPct > 0 ? <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-300" style={{ width: `${tasteView.showPct}%` }} /> : null}
                                            {tasteView.musicPct > 0 ? <div className="h-full bg-gradient-to-r from-violet-500 to-violet-300" style={{ width: `${tasteView.musicPct}%` }} /> : null}
                                        </div>
                                        <p className="mt-1.5 text-[11px] text-muted">
                                            {[
                                                tasteView.moviePct > 0 ? `${t('mediaType.movies')} ${tasteView.moviePct}%` : null,
                                                tasteView.showPct > 0 ? `${t('mediaType.series')} ${tasteView.showPct}%` : null,
                                                tasteView.musicPct > 0 ? `${t('mediaType.music')} ${tasteView.musicPct}%` : null,
                                            ].filter(Boolean).join(' · ')}
                                        </p>
                                    </div>
                                ) : null}
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                                    <TasteStatCard
                                        label={t('mediaType.movie')}
                                        value={Number(tasteView.mix.movies) || 0}
                                        hint={tasteView.mixTotal > 0 ? t('profilePage.tasteMixPct', { pct: tasteView.moviePct }) : undefined}
                                        icon={<Film className="h-4 w-4 text-sky-300" />}
                                        glow="sky"
                                    />
                                    <TasteStatCard
                                        label={t('mediaType.tv')}
                                        value={Number(tasteView.mix.shows) || 0}
                                        hint={tasteView.mixTotal > 0 ? t('profilePage.tasteMixPct', { pct: tasteView.showPct }) : undefined}
                                        icon={<Tv className="h-4 w-4 text-emerald-300" />}
                                        glow="emerald"
                                    />
                                    <TasteStatCard
                                        label={t('mediaType.music')}
                                        value={Number(tasteView.mix.music) || 0}
                                        hint={tasteView.mixTotal > 0 ? t('profilePage.tasteMixPct', { pct: tasteView.musicPct }) : undefined}
                                        icon={<Music className="h-4 w-4 text-violet-300" />}
                                        glow="violet"
                                    />
                                    <TasteStatCard
                                        label={t('profilePage.tasteWatchStory')}
                                        value={tasteView.hours}
                                        hint={canOpenWatchStory ? t('profilePage.tasteWatchStoryHint') : t('profilePage.hours')}
                                        icon={<Clock className="h-4 w-4 text-plex" />}
                                        glow="plex"
                                        onClick={canOpenWatchStory ? () => setSelectedMetric('Achievements Hours') : undefined}
                                    />
                                </div>
                                {(tasteView.movieGenres.length || tasteView.showGenres.length) ? (
                                    <div className="space-y-3">
                                        <TasteGenreRow
                                            label={t('profilePage.tasteMovies')}
                                            icon={<Film className="h-3.5 w-3.5" />}
                                            genres={tasteView.movieGenres}
                                            tone="sky"
                                        />
                                        <TasteGenreRow
                                            label={t('profilePage.tasteShows')}
                                            icon={<Tv className="h-3.5 w-3.5" />}
                                            genres={tasteView.showGenres}
                                            tone="emerald"
                                        />
                                    </div>
                                ) : null}
                            </div>
                        </DashboardPanel>
                    ) : null}

                    {!data.privacy?.locked && (wrapUpPending || (wrapAnalytics && (Number(wrapAnalytics.totalPlays) > 0 || Number(wrapAnalytics.hoursWatched) > 0 || wrapAnalytics.leaderboardRank))) ? (
                        <DashboardPanel
                            title={t('profilePage.watchStory')}
                            subtitle={t('profilePage.watchStoryHint')}
                            controls={isSelf && wrapAnalytics ? (
                                <button
                                    type="button"
                                    onClick={() => setShareWrapUpOpen(true)}
                                    className="text-sm font-semibold text-plex hover:underline inline-flex items-center gap-1"
                                >
                                    <Share2 className="w-4 h-4" />
                                    {t('profilePage.shareWrapUp')}
                                </button>
                            ) : undefined}
                        >
                            {wrapUpPending ? (
                                <WrapUpCardsSkeleton />
                            ) : (
                                <WrapUpCardGrid
                                    analytics={wrapAnalytics}
                                    desktopMaxCards={10}
                                    interactive
                                    onCardClick={handleWrapUpCardClick}
                                />
                            )}
                        </DashboardPanel>
                    ) : null}

                    {achievements?.showOnProfile ? (
                        <DashboardPanel
                            title={t('profilePage.trophyCase')}
                            subtitle={t('profilePage.trophyHint')}
                            controls={
                                <button
                                    type="button"
                                    onClick={() => onNavigate('achievements')}
                                    className="text-sm font-semibold text-plex hover:underline inline-flex items-center gap-1"
                                >
                                    <Trophy className="w-4 h-4" />
                                    {t('profilePage.openAchievements')}
                                </button>
                            }
                        >
                            <ProfileBadgeRack
                                earned={achievements.earned || achievements.trophyCase || []}
                                level={identity.level}
                                xp={identity.xp}
                                max={16}
                                onOpenAll={() => onNavigate('achievements')}
                                onBadgeClick={(id) => setSelectedBadgeId(id)}
                            />
                            {Array.isArray(achievements.trophyCase) && achievements.trophyCase.length > 0 ? (
                                <div className="mt-4 grid grid-cols-1 sm:grid-cols-5 gap-2">
                                    {achievements.trophyCase.map((badge: any) => (
                                        <button
                                            key={badge.id}
                                            type="button"
                                            onClick={() => setSelectedBadgeId(String(badge.id))}
                                            title={badge.name}
                                            className={`rounded-xl border px-3 py-3 text-center cursor-pointer hover:scale-[1.03] hover:ring-2 hover:ring-plex/40 transition-all ${trophyRarityClass(badge.rarity)}`}
                                        >
                                            <span className="text-3xl leading-none">{badge.icon || '🏅'}</span>
                                            <p className="mt-2 text-xs font-bold text-text truncate">{badge.name}</p>
                                            <p className="text-[10px] uppercase tracking-widest text-muted mt-1">
                                                {badge.pinned ? t('profilePage.pinned') : badge.rarity}
                                            </p>
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                        </DashboardPanel>
                    ) : null}

                    {achievements?.showOnProfile && unlocks.length > 0 ? (
                        <DashboardPanel title={t('profilePage.unlockTimeline')} subtitle={t('profilePage.unlockTimelineHint')}>
                            <div className="flex flex-col gap-1.5">
                                {unlocks.map((badge: any) => (
                                    <button
                                        key={badge.id}
                                        type="button"
                                        onClick={() => setSelectedBadgeId(String(badge.id))}
                                        className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-left hover:border-plex/40"
                                    >
                                        <span className="text-2xl leading-none">{badge.icon || '🏅'}</span>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-bold text-text truncate">{badge.name}</p>
                                            <p className="text-[11px] text-muted mt-0.5 capitalize">{badge.rarity}</p>
                                        </div>
                                        {badge.earnedAt ? (
                                            <span className="text-[11px] font-mono text-muted shrink-0">
                                                {formatUkDate(badge.earnedAt)}
                                            </span>
                                        ) : null}
                                    </button>
                                ))}
                            </div>
                        </DashboardPanel>
                    ) : null}

                    {achievements?.showOnProfile ? (
                        <DossierArena
                            achievements={achievements}
                            onNavigate={onNavigate}
                            onOpenBadge={(id) => setSelectedBadgeId(id)}
                        />
                    ) : null}

                    {account ? (
                        <DashboardPanel title={t('profilePage.account')} subtitle={t('profilePage.accountHint')}>
                            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/25">
                                <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${accessTone.glow}`} />
                                <div className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full bg-plex/15 blur-3xl" />
                                <div className="pointer-events-none absolute -left-10 bottom-0 h-28 w-28 rounded-full bg-amber-400/10 blur-3xl" />
                                <div className="relative p-4 sm:p-5">
                                    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
                                        <div>
                                            <p className="text-[10px] uppercase tracking-[0.28em] font-bold text-plex">
                                                {t('profilePage.memberSince')}
                                            </p>
                                            <p className="mt-1 text-2xl sm:text-3xl font-black text-text tracking-tight">
                                                {joinUk || t('profilePage.unknown')}
                                            </p>
                                            {joinRelative ? (
                                                <p className="mt-1 text-sm text-muted">
                                                    {t('profilePage.onThisServer', { relative: joinRelative })}
                                                </p>
                                            ) : null}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            {account.isAdmin ? (
                                                <span className="inline-flex items-center gap-1 rounded-full border border-plex/40 bg-plex/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-plex">
                                                    <Crown className="w-3 h-3" />
                                                    {t('profilePage.admin')}
                                                </span>
                                            ) : null}
                                            {account.isTrial ? (
                                                <span className="inline-flex items-center rounded-full border border-amber-400/30 bg-amber-500/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-amber-200">
                                                    {t('profilePage.trial')}
                                                </span>
                                            ) : null}
                                            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${accessTone.pill}`}>
                                                {accessStatus}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                                            <p className="text-[10px] uppercase tracking-widest font-bold text-muted flex items-center gap-1.5">
                                                <Shield className={`w-3.5 h-3.5 ${accessTone.icon}`} />
                                                {t('profilePage.access')}
                                            </p>
                                            <p className="mt-2 text-lg font-black text-text">{accessHeadline}</p>
                                            <p className="text-[11px] text-muted mt-0.5">{accessSub}</p>
                                        </div>
                                        <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                                            <p className="text-[10px] uppercase tracking-widest font-bold text-muted flex items-center gap-1.5">
                                                <Clock className="w-3.5 h-3.5 text-plex" />
                                                {t('profilePage.lastLogin')}
                                            </p>
                                            <p className="mt-2 text-lg font-black text-text">
                                                {lastSeenUk || t('profilePage.never')}
                                            </p>
                                            {lastSeenRelative ? (
                                                <p className="text-[11px] text-muted mt-0.5">{lastSeenRelative}</p>
                                            ) : null}
                                        </div>
                                    </div>

                                    {account.email ? (
                                        <div className="mt-3 flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                                            <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-plex/15 text-plex shrink-0">
                                                <Mail className="w-4 h-4" />
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-[10px] uppercase tracking-widest font-bold text-muted">
                                                    {t('profilePage.email')}
                                                </p>
                                                <p className="text-sm font-bold text-text truncate" title={account.email}>
                                                    {account.email}
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={copyEmail}
                                                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-bold text-muted hover:text-text hover:border-plex/40 shrink-0"
                                            >
                                                {copiedEmail ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                                                {copiedEmail ? t('profilePage.copied') : t('profilePage.copyEmail')}
                                            </button>
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        </DashboardPanel>
                    ) : null}

                    {Array.isArray(data.requests?.recent) ? (
                        <DashboardPanel
                            title={t('profilePage.requests')}
                            subtitle={t('profilePage.requestsHint', {
                                total: data.requests.total || 0,
                                pending: data.requests.pending || 0,
                            })}
                            controls={
                                isSelf ? (
                                    <button
                                        type="button"
                                        onClick={() => onNavigate('discovery', { path: '/discovery/requests' })}
                                        className="text-sm font-semibold text-plex hover:underline"
                                    >
                                        {t('profilePage.openRequests')}
                                    </button>
                                ) : null
                            }
                        >
                            {data.requests.recent.length ? (
                                <div className="flex gap-4 overflow-x-auto no-scrollbar pb-1">
                                    {data.requests.recent.map((item: any) => {
                                        const poster = requestPoster(item);
                                        const qualities = Array.isArray(item.qualities) && item.qualities.length
                                            ? item.qualities
                                            : (item.is4k ? ['4K'] : []);
                                        const qualityLabel = qualities.includes('4K') ? qualities.join(' · ') : null;
                                        const discoveryPath = requestDiscoveryPath(item);
                                        const card = (
                                            <>
                                                <div className="aspect-[2/3] rounded-xl overflow-hidden border border-white/10 bg-black/40">
                                                    {poster ? (
                                                        <img src={poster} alt="" className="w-full h-full object-cover" />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center text-muted">
                                                            <Sparkles className="w-8 h-8" />
                                                        </div>
                                                    )}
                                                </div>
                                                <p className="mt-2 text-sm font-bold text-text truncate">{item.title}</p>
                                                <p className="text-xs text-muted truncate">
                                                    {[qualityLabel, item.status || item.mediaType].filter(Boolean).join(' · ')}
                                                </p>
                                            </>
                                        );
                                        return discoveryPath ? (
                                            <button
                                                key={String(item.id || item.title)}
                                                type="button"
                                                onClick={() => onNavigate('discovery', { path: discoveryPath })}
                                                className={`${discoverRowCardWidthClass('xlarge')} shrink-0 text-left hover:opacity-90`}
                                            >
                                                {card}
                                            </button>
                                        ) : (
                                            <div
                                                key={String(item.id || item.title)}
                                                className={`${discoverRowCardWidthClass('xlarge')} shrink-0`}
                                            >
                                                {card}
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <p className="text-sm text-muted">{t('profilePage.noRequests')}</p>
                            )}
                        </DashboardPanel>
                    ) : null}
                </>
            )}
            {selectedMetric && wrapAnalytics ? (
                <WrapUpModal
                    metric={selectedMetric}
                    analytics={wrapAnalytics}
                    days="all"
                    onClose={() => setSelectedMetric(null)}
                    onOpenProfile={(id) => {
                        setSelectedMetric(null);
                        goToProfile(onNavigate, id);
                    }}
                />
            ) : null}
            {shareWrapUpOpen && wrapAnalytics ? (
                <ShareWrapUpModal
                    analytics={wrapAnalytics}
                    days="all"
                    serverName={sessionInfo?.serverName || 'StreamPilot'}
                    username={identity.username || sessionInfo?.session?.username}
                    onClose={() => setShareWrapUpOpen(false)}
                    onToast={(message, type) => setToasts((prev) => pushToast(prev, message, type))}
                />
            ) : null}
            <BadgeDetailDrawer
                badgeId={selectedBadgeId}
                localBadge={selectedTrophy}
                pinnedIds={isSelf ? pinnedIds : []}
                onClose={() => setSelectedBadgeId(null)}
                onTogglePin={isSelf ? (id) => { void togglePin(id); } : undefined}
                pinBusy={pinBusy}
            />
            <ToastContainer toasts={toasts} setToasts={setToasts} />
        </DashboardPageShell>
    );
};

export default ProfilePage;
