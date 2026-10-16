import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Award, Calendar, CalendarCheck, ChevronLeft, ChevronRight, Clapperboard, Clock, Disc3,
    Film, Flame, Lock, Music2, Sparkles, Trophy, X, Info, Medal, Target,
    Gauge, PlayCircle, ChevronDown, Share2, Bell, BellOff, Pin,
    ArrowDownRight, ArrowUpRight, Minus, Swords, Crosshair, Shield, Gift, Sun, Send,
    CheckCircle2, Tv, type LucideIcon,
} from 'lucide-react';
import { apiFetch, apiFetchShared } from '../shared/api';
import { logoUrl, portalUrl, resolvePortalAssetUrl } from '../shared/basePath';
import { ModalPortal } from '../shared/ModalPortal';
import { ToastContainer, pushToast, type ToastMessage } from '../shared/toast';
import { ShareAchievementsModal } from '../shared/ShareAchievements';
import { tAchievements, useAchievementsI18n } from './i18n';
import { groupBadgesIntoFamilies, badgeBarPercent, familyBarPercent, type BadgeFamily } from './badgeFamilies';
import { BadgeDetailDrawer } from './BadgeDetailDrawer';
import { UnlockCelebration } from './UnlockCelebration';
import { LeaderboardDossierModal } from './LeaderboardDossierModal';

const LEADERBOARD_PAGE_SIZE = 10;
const LEADERBOARD_FETCH_LIMIT = 100;
const ME_URL = '/api/achievements/me';
const ME_SUMMARY_URL = '/api/achievements/me?view=summary';
const ME_REFRESH_POLL_MS = 3500;

const mergeMePayload = (prev: any, next: any) => {
    if (!next) return prev;
    if (!prev) return next;
    const hasCatalog = Array.isArray(next.badges) && next.badges.length > 0;
    if (hasCatalog) return { ...prev, ...next };
    return {
        ...prev,
        ...next,
        badges: prev.badges,
        earned: Array.isArray(prev.earned) && prev.earned.length
            ? prev.earned
            : next.earned,
    };
};

const BREAKDOWN_META: Record<string, { icon: LucideIcon; statKey?: string; tipKey: string }> = {
    uniqueMovies: { icon: Film, tipKey: 'xp.tip.uniqueMovies', statKey: 'uniqueMovies' },
    uniqueShows: { icon: Clapperboard, tipKey: 'xp.tip.uniqueShows', statKey: 'uniqueShows' },
    uniqueMusic: { icon: Disc3, tipKey: 'xp.tip.uniqueMusic', statKey: 'uniqueMusic' },
    moviePlays: { icon: PlayCircle, tipKey: 'xp.tip.moviePlays', statKey: 'moviePlays' },
    episodePlays: { icon: Clapperboard, tipKey: 'xp.tip.episodePlays', statKey: 'episodePlays' },
    trackPlays: { icon: Music2, tipKey: 'xp.tip.trackPlays', statKey: 'trackPlays' },
    totalPlays: { icon: Gauge, tipKey: 'xp.tip.totalPlays', statKey: 'totalPlays' },
    activeDays: { icon: Calendar, tipKey: 'xp.tip.activeDays', statKey: 'activeDays' },
    dailyWatches: { icon: CalendarCheck, tipKey: 'xp.tip.dailyWatches', statKey: 'dailyWatches' },
    currentStreak: { icon: Flame, tipKey: 'xp.tip.currentStreak', statKey: 'currentStreak' },
    longestStreak: { icon: Flame, tipKey: 'xp.tip.longestStreak', statKey: 'longestStreak' },
    weekendPlays: { icon: Sparkles, tipKey: 'xp.tip.weekendPlays', statKey: 'weekendPlays' },
    movieFinishes: { icon: CheckCircle2, tipKey: 'xp.tip.movieFinishes', statKey: 'movieFinishes' },
    episodeFinishes: { icon: Tv, tipKey: 'xp.tip.episodeFinishes', statKey: 'episodeFinishes' },
    trackFinishes: { icon: Disc3, tipKey: 'xp.tip.trackFinishes', statKey: 'trackFinishes' },
    bingeSessions: { icon: Tv, tipKey: 'xp.tip.bingeSessions', statKey: 'bingeSessions' },
    minutesWatched: { icon: Clock, tipKey: 'xp.tip.minutesWatched', statKey: 'minutesWatched' },
    hoursWatched: { icon: Clock, tipKey: 'xp.tip.hoursWatched', statKey: 'hoursWatched' },
    sundayMinutes: { icon: Sun, tipKey: 'xp.tip.sundayMinutes', statKey: 'sundayMinutes' },
    mediaRequests: { icon: Send, tipKey: 'xp.tip.mediaRequests', statKey: 'mediaRequests' },
    badgeUnlocks: { icon: Gift, tipKey: 'xp.tip.badgeUnlocks', statKey: 'earnedCount' },
};

const formatLabel = (key: string, translate = tAchievements) => translate(`xp.source.${key}`) !== `xp.source.${key}`
    ? translate(`xp.source.${key}`)
    : key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

const resolveLeaderboardAvatar = (thumb: string | null | undefined, width = 64, height = 64) => {
    if (!thumb) return logoUrl();
    if (thumb.startsWith('http://') || thumb.startsWith('https://') || thumb.startsWith('/api/')) {
        return resolvePortalAssetUrl(thumb);
    }
    return portalUrl(`/api/plex/image?path=${encodeURIComponent(thumb)}&width=${width}&height=${height}`);
};

const rarityClass = (rarity: string) => {
    if (rarity === 'legendary') return 'border-amber-400/50 bg-amber-500/10 text-amber-100';
    if (rarity === 'epic') return 'border-fuchsia-400/40 bg-fuchsia-500/10 text-fuchsia-100';
    if (rarity === 'rare') return 'border-sky-400/40 bg-sky-500/10 text-sky-100';
    return 'border-white/10 bg-white/[0.03] text-text';
};

export const BadgeTile: React.FC<{
    badge: any;
    compact?: boolean;
    onClick?: () => void;
}> = ({ badge, compact, onClick }) => {
    const { tAchievements } = useAchievementsI18n();
    const earned = !!badge?.earned;
    return (
        <button
            type="button"
            onClick={onClick}
            className={`text-left rounded-xl border transition-colors ${rarityClass(badge?.rarity)} ${
                earned ? '' : 'opacity-55 grayscale'
            } ${compact ? 'p-2.5' : 'p-3'} hover:border-plex/40`}
        >
            <div className="flex items-start gap-2.5">
                <span className={`${compact ? 'text-xl' : 'text-2xl'} leading-none`}>{badge?.icon || '🏅'}</span>
                <div className="min-w-0 flex-1">
                    <p className={`font-bold truncate ${compact ? 'text-xs' : 'text-sm'}`}>{badge?.name}</p>
                    {!compact && (
                        <p className="text-[11px] text-muted mt-0.5 line-clamp-2">{badge?.description}</p>
                    )}
                    <div className="mt-2 h-1.5 rounded-full bg-black/40 overflow-hidden">
                        <div
                            className={`h-full rounded-full ${earned ? 'bg-plex' : 'bg-white/25'}`}
                            style={{ width: `${badgeBarPercent(badge)}%` }}
                        />
                    </div>
                    <p className="mt-1 text-[10px] text-muted font-mono">
                        {earned ? tAchievements('badge.earned') : `${badge?.progress ?? 0} / ${badge?.threshold ?? 0}`}
                    </p>
                </div>
                {!earned && <Lock className="w-3.5 h-3.5 text-muted shrink-0 mt-0.5" />}
            </div>
        </button>
    );
};

export const LadderFamilyCard: React.FC<{
    family: BadgeFamily;
    expanded: boolean;
    onToggle: () => void;
    onBadgeClick?: (badge: any) => void;
}> = ({ family, expanded, onToggle, onBadgeClick }) => {
    const { tAchievements } = useAchievementsI18n();
    const focus = family.focus;
    const next = family.next;
    const complete = family.earnedCount >= family.totalCount && family.totalCount > 0;
    const progressPct = familyBarPercent(family);
    return (
        <div className={`rounded-xl border transition-colors ${complete ? 'border-plex/30 bg-plex/5' : rarityClass(focus?.rarity)}`}>
            <button type="button" onClick={onToggle} className="w-full text-left p-3.5">
                <div className="flex items-start gap-2.5">
                    <span className="text-2xl leading-none">{family.icon}</span>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <p className="text-sm font-bold truncate">{family.label}</p>
                                <p className="text-[11px] text-muted mt-0.5 line-clamp-1">
                                    {complete
                                        ? tAchievements('ladder.complete')
                                        : next
                                            ? tAchievements('ladder.nextAt', {
                                                name: next.name || '',
                                                threshold: next.threshold ?? 0,
                                            })
                                            : (focus?.description || '')}
                                </p>
                            </div>
                            <ChevronDown className={`w-4 h-4 text-muted shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2 text-[10px] font-mono text-muted">
                            <span>{tAchievements('ladder.tiers', { earned: family.earnedCount, total: family.totalCount })}</span>
                            <span className="tabular-nums">
                                {family.currentValue.toLocaleString()}
                                {next ? ` / ${Number(next.threshold || 0).toLocaleString()}` : ''}
                            </span>
                        </div>
                        <div className="mt-1.5 h-1.5 rounded-full bg-black/40 overflow-hidden">
                            <div className="h-full rounded-full bg-plex" style={{ width: `${progressPct}%` }} />
                        </div>
                    </div>
                </div>
            </button>
            {expanded && (
                <div className="px-3 pb-3 grid grid-cols-1 gap-1.5 border-t border-white/5 pt-2">
                    {family.tiers.map((tier) => (
                        <button
                            type="button"
                            key={tier.id}
                            onClick={(e) => {
                                e.stopPropagation();
                                onBadgeClick?.(tier);
                            }}
                            className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-left w-full hover:ring-1 hover:ring-plex/30 ${
                                tier.earned ? 'bg-plex/10 text-text' : 'bg-black/20 text-muted'
                            }`}
                        >
                            <span>{tier.icon || '▫️'}</span>
                            <span className="min-w-0 flex-1 truncate font-semibold">{tier.name}</span>
                            <span className="font-mono tabular-nums shrink-0">{tier.threshold}</span>
                            {tier.earned ? (
                                <span className="text-plex text-[10px] font-bold shrink-0">{tAchievements('badge.earned')}</span>
                            ) : (
                                <Lock className="w-3 h-3 shrink-0 opacity-50" />
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export const ProfileBadgeRack: React.FC<{
    earned: any[];
    level?: number;
    xp?: number;
    onOpenAll?: () => void;
    onBadgeClick?: (badgeId: string) => void;
    max?: number;
}> = ({ earned, level, xp, onOpenAll, onBadgeClick, max = 12 }) => {
    const { tAchievements } = useAchievementsI18n();
    const shown = (earned || []).slice(0, max);
    if (!shown.length && level == null) return null;
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-muted font-bold">
                    <Award className="w-3.5 h-3.5 text-plex" />
                    {tAchievements('profile.title')}
                    {level != null && (
                        <span className="normal-case tracking-normal text-plex font-black">{tAchievements('common.levelShort', { level })}</span>
                    )}
                </div>
                {onOpenAll && (
                    <button
                        type="button"
                        onClick={onOpenAll}
                        className="text-[11px] font-semibold text-plex hover:underline inline-flex items-center gap-0.5"
                    >
                        {tAchievements('profile.all')} <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>
            {xp != null && (
                <p className="text-[11px] text-muted font-mono">
                    {Number(xp).toLocaleString()} XP · {tAchievements('common.badgeCount', { count: earned?.length || 0 })}
                </p>
            )}
            <div className="flex flex-wrap gap-1.5">
                {shown.map((badge) => {
                    const inner = badge.icon || '🏅';
                    const title = `${badge.name}${badge.description ? ` — ${badge.description}` : ''}`;
                    const className = 'inline-flex items-center justify-center w-9 h-9 rounded-lg border border-white/10 bg-black/30 text-lg hover:border-plex/40 hover:scale-105 transition-transform';
                    if (onBadgeClick && badge.id) {
                        return (
                            <button
                                key={badge.id}
                                type="button"
                                title={title}
                                onClick={() => onBadgeClick(String(badge.id))}
                                className={className}
                            >
                                {inner}
                            </button>
                        );
                    }
                    return (
                        <span key={badge.id} title={title} className={className}>
                            {inner}
                        </span>
                    );
                })}
                {!shown.length && (
                    <p className="text-xs text-muted">{tAchievements('profile.empty')}</p>
                )}
            </div>
        </div>
    );
};

export const XpBreakdownModal: React.FC<{
    open: boolean;
    onClose: () => void;
    breakdown?: Record<string, number>;
    stats?: Record<string, number>;
    xp?: number;
    levelProgress?: any;
    earnedCount?: number;
    totalBadges?: number;
    nextUnlocks?: any[];
}> = ({
    open,
    onClose,
    breakdown,
    stats,
    xp = 0,
    levelProgress,
    earnedCount = 0,
    totalBadges = 0,
    nextUnlocks = [],
}) => {
    const { tAchievements } = useAchievementsI18n();
    if (!open) return null;

    const level = Number(levelProgress?.level) || 1;
    const into = Number(levelProgress?.xpIntoLevel) || 0;
    const need = Math.max(1, Number(levelProgress?.xpForNextLevel) || 1);
    const progressPct = Math.min(100, Math.max(0, Number(levelProgress?.progressPct) || Math.round((into / need) * 100)));
    const remaining = Math.max(0, need - into);
    const totalXp = Number(xp) || 0;

    const rows = Object.entries(breakdown || {})
        .map(([key, value]) => [key, Number(value) || 0] as const)
        .filter(([, value]) => value > 0)
        .sort((a, b) => b[1] - a[1]);
    const zeroRows = Object.entries(breakdown || {})
        .map(([key, value]) => [key, Number(value) || 0] as const)
        .filter(([, value]) => value <= 0)
        .sort((a, b) => a[0].localeCompare(b[0]));
    const partsSum = rows.reduce((sum, [, value]) => sum + value, 0) || totalXp || 1;
    const topKey = rows[0]?.[0];
    const topShare = rows[0] ? Math.round((rows[0][1] / partsSum) * 100) : 0;

    const activity = [
        { key: 'hours', label: tAchievements('xp.stat.hours'), value: Number(stats?.hoursWatched) || 0, icon: Clock },
        { key: 'streak', label: tAchievements('xp.stat.streak'), value: Number(stats?.longestStreak) || 0, icon: Flame },
        { key: 'active', label: tAchievements('xp.stat.activeDays'), value: Number(stats?.activeDays) || 0, icon: Calendar },
        { key: 'unique', label: tAchievements('xp.stat.unique'), value: (Number(stats?.uniqueMovies) || 0) + (Number(stats?.uniqueShows) || 0), icon: Film },
        { key: 'plays', label: tAchievements('xp.stat.plays'), value: Number(stats?.totalPlays) || 0, icon: PlayCircle },
        { key: 'badges', label: tAchievements('xp.stat.badges'), value: earnedCount, icon: Award, sub: totalBadges ? `/ ${totalBadges}` : undefined },
    ];

    return (
        <ModalPortal open={open}>
            <div className="fixed inset-x-0 top-0 z-[340] flex items-end sm:items-center justify-center p-0 sm:p-5 bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] sm:inset-0 sm:bottom-0">
                <button type="button" className="absolute inset-0 bg-black/75 backdrop-blur-[2px]" aria-label={tAchievements('common.close')} onClick={onClose} />
                <div
                    className="relative isolate w-full sm:max-w-3xl max-h-[min(92vh,100%)] sm:max-h-[88vh] flex flex-col rounded-t-3xl sm:rounded-3xl border border-white/10 shadow-[0_24px_80px_rgba(0,0,0,0.55)] overflow-hidden"
                    style={{ backgroundColor: '#12141a' }}
                >
                    <div
                        className="absolute inset-0"
                        style={{ backgroundColor: 'rgb(var(--color-card))' }}
                        aria-hidden
                    />
                    <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-40 bg-gradient-to-b from-plex/20 via-plex/5 to-[rgb(var(--color-card))]" />

                    <div className="relative z-[1] flex min-h-0 flex-1 flex-col">
                    <div className="relative flex items-start justify-between gap-3 px-5 sm:px-7 pt-5 sm:pt-6 pb-4 border-b border-white/8 shrink-0">
                        <div className="min-w-0">
                            <p className="text-[10px] uppercase tracking-[0.28em] text-plex font-bold mb-1.5">
                                {tAchievements('xp.eyebrow')}
                            </p>
                            <h3 className="text-xl sm:text-2xl font-black text-text flex items-center gap-2.5">
                                <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-plex/15 border border-plex/30">
                                    <Sparkles className="w-4 h-4 text-plex" />
                                </span>
                                {tAchievements('page.xpBreakdown')}
                            </h3>
                            <p className="text-sm text-muted mt-1.5 max-w-xl leading-relaxed">
                                {tAchievements('xp.subtitle')}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label={tAchievements('common.close')}
                            className="p-2.5 rounded-xl text-muted hover:text-text hover:bg-white/5 border border-transparent hover:border-white/10 transition-colors shrink-0"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="relative flex-1 overflow-y-auto custom-scrollbar px-5 sm:px-7 py-5 space-y-6">
                        {/* Level overview */}
                        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] p-4 sm:p-5">
                            <div className="flex flex-col sm:flex-row sm:items-end gap-4 sm:gap-6">
                                <div className="shrink-0">
                                    <p className="text-[10px] uppercase tracking-[0.22em] text-muted font-bold">
                                        {tAchievements('page.level', { level })}
                                    </p>
                                    <p className="text-3xl sm:text-4xl font-black text-text font-mono tabular-nums mt-1">
                                        {totalXp.toLocaleString()}
                                        <span className="text-base sm:text-lg font-bold text-muted ml-1.5">XP</span>
                                    </p>
                                    {topKey && (
                                        <p className="text-xs text-muted mt-2">
                                            {tAchievements('xp.topSource', {
                                                source: formatLabel(topKey, tAchievements),
                                                pct: topShare,
                                            })}
                                        </p>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0 space-y-2">
                                    <div className="flex items-center justify-between gap-3 text-xs">
                                        <span className="text-muted font-semibold">
                                            {tAchievements('xp.progressTo', { level: level + 1 })}
                                        </span>
                                        <span className="font-mono text-plex font-bold tabular-nums">
                                            {progressPct}%
                                        </span>
                                    </div>
                                    <div className="h-3 rounded-full bg-black/50 border border-white/10 overflow-hidden">
                                        <div
                                            className="h-full rounded-full bg-gradient-to-r from-plex/80 to-plex shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] transition-all"
                                            style={{ width: `${progressPct}%` }}
                                        />
                                    </div>
                                    <div className="flex items-center justify-between gap-3 text-[11px] font-mono text-muted tabular-nums">
                                        <span>{tAchievements('page.toNext', { into, need })}</span>
                                        <span className="text-text/80 font-semibold">
                                            {tAchievements('xp.remaining', { xp: remaining.toLocaleString() })}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Activity snapshot */}
                        <div>
                            <h4 className="text-[10px] uppercase tracking-[0.22em] text-muted font-bold mb-3">
                                {tAchievements('xp.activityTitle')}
                            </h4>
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                                {activity.map((item) => {
                                    const Icon = item.icon;
                                    return (
                                        <div
                                            key={item.key}
                                            className="rounded-xl border border-white/8 bg-black/25 px-3 py-2.5 min-w-0"
                                        >
                                            <div className="flex items-center gap-1.5 text-muted mb-1">
                                                <Icon className="w-3.5 h-3.5 text-plex/80 shrink-0" />
                                                <span className="text-[10px] uppercase tracking-wide font-semibold truncate">
                                                    {item.label}
                                                </span>
                                            </div>
                                            <p className="text-lg font-black text-text font-mono tabular-nums leading-none">
                                                {Number(item.value).toLocaleString()}
                                                {item.sub ? (
                                                    <span className="text-[11px] text-muted font-semibold ml-1">{item.sub}</span>
                                                ) : null}
                                            </p>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Contribution bars */}
                        <div>
                            <div className="flex items-end justify-between gap-3 mb-3">
                                <h4 className="text-[10px] uppercase tracking-[0.22em] text-muted font-bold">
                                    {tAchievements('xp.sourcesTitle')}
                                </h4>
                                <p className="text-[11px] text-muted hidden sm:block">
                                    {tAchievements('xp.sourcesHint')}
                                </p>
                            </div>
                            <div className="space-y-2.5">
                                {rows.map(([key, value], index) => {
                                    const meta = BREAKDOWN_META[key] || { icon: Info, tipKey: '', statKey: undefined };
                                    const Icon = meta.icon;
                                    const pct = Math.round((value / partsSum) * 100);
                                    const barPct = Math.max(3, Math.round((value / (rows[0]?.[1] || value || 1)) * 100));
                                    const rawStat = meta.statKey ? Number(stats?.[meta.statKey]) || 0 : null;
                                    return (
                                        <div
                                            key={key}
                                            className={`rounded-xl border px-3.5 py-3 ${
                                                index === 0
                                                    ? 'border-plex/35 bg-plex/10'
                                                    : 'border-white/8 bg-black/20'
                                            }`}
                                        >
                                            <div className="flex items-start gap-3">
                                                <span className={`mt-0.5 inline-flex items-center justify-center w-9 h-9 rounded-xl border shrink-0 ${
                                                    index === 0
                                                        ? 'border-plex/40 bg-plex/15 text-plex'
                                                        : 'border-white/10 bg-white/5 text-muted'
                                                }`}>
                                                    <Icon className="w-4 h-4" />
                                                </span>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <p className="text-sm font-bold text-text truncate">
                                                                {formatLabel(key, tAchievements)}
                                                            </p>
                                                            <p className="text-[11px] text-muted mt-0.5 line-clamp-2">
                                                                {tAchievements(meta.tipKey)}
                                                                {rawStat != null ? (
                                                                    <span className="text-text/70"> · {tAchievements('xp.statCount', { count: rawStat.toLocaleString() })}</span>
                                                                ) : null}
                                                            </p>
                                                        </div>
                                                        <div className="text-right shrink-0">
                                                            <p className="text-sm font-black font-mono text-text tabular-nums">
                                                                +{value.toLocaleString()}
                                                            </p>
                                                            <p className="text-[10px] font-semibold text-plex tabular-nums mt-0.5">
                                                                {pct}%
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="mt-2.5 h-2 rounded-full bg-black/45 border border-white/5 overflow-hidden">
                                                        <div
                                                            className={`h-full rounded-full ${
                                                                index === 0 ? 'bg-plex' : 'bg-white/35'
                                                            }`}
                                                            style={{ width: `${barPct}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                                {!rows.length && (
                                    <p className="text-sm text-muted py-6 text-center border border-dashed border-white/10 rounded-xl">
                                        {tAchievements('xp.empty')}
                                    </p>
                                )}
                            </div>

                            {!!zeroRows.length && (
                                <details className="mt-4 group">
                                    <summary className="cursor-pointer text-xs font-semibold text-muted hover:text-text list-none flex items-center gap-2">
                                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/25 group-open:bg-plex" />
                                        {tAchievements('xp.zeroSources', { count: zeroRows.length })}
                                    </summary>
                                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                        {zeroRows.map(([key]) => (
                                            <div key={key} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-black/15 px-3 py-2 text-xs">
                                                <span className="text-muted truncate">{formatLabel(key, tAchievements)}</span>
                                                <span className="font-mono text-muted/70">+0</span>
                                            </div>
                                        ))}
                                    </div>
                                </details>
                            )}
                        </div>

                        {/* Closest unlocks */}
                        {Array.isArray(nextUnlocks) && nextUnlocks.length > 0 && (
                            <div>
                                <h4 className="text-[10px] uppercase tracking-[0.22em] text-muted font-bold mb-3 flex items-center gap-2">
                                    <Target className="w-3.5 h-3.5 text-plex" />
                                    {tAchievements('xp.nextGoals')}
                                </h4>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                    {nextUnlocks.slice(0, 3).map((badge: any) => (
                                        <div key={badge.id} className="rounded-xl border border-white/8 bg-black/25 px-3 py-2.5">
                                            <div className="flex items-start gap-2">
                                                <span className="text-lg leading-none">{badge.icon || '🏅'}</span>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-sm font-bold truncate">{badge.name}</p>
                                                    <div className="mt-2 h-1.5 rounded-full bg-black/40 overflow-hidden">
                                                        <div
                                                            className="h-full rounded-full bg-plex/80"
                                                            style={{ width: `${badgeBarPercent(badge)}%` }}
                                                        />
                                                    </div>
                                                    <p className="mt-1 text-[10px] text-muted font-mono tabular-nums">
                                                        {badge.progress ?? 0} / {badge.threshold ?? 0}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <p className="text-[11px] text-muted/80 leading-relaxed border-t border-white/5 pt-4 flex items-start gap-2">
                            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-plex/70" />
                            {tAchievements('xp.footnote')}
                        </p>
                    </div>
                    </div>
                </div>
            </div>
        </ModalPortal>
    );
};

export const AchievementsDashboard: React.FC<{
    sessionInfo?: any;
    onNavigate?: (route: string, options?: { path?: string }) => void;
}> = ({ sessionInfo = null, onNavigate }) => {
    const { tAchievements } = useAchievementsI18n();
    const [data, setData] = useState<any>(null);
    const [board, setBoard] = useState<any[] | null>(null);
    const [boardPage, setBoardPage] = useState(0);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [catalogReady, setCatalogReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const celebratedRef = useRef<Set<string>>(new Set());
    const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dataRef = useRef<any>(null);
    const [category, setCategory] = useState('all');
    const [showEarnedOnly, setShowEarnedOnly] = useState(false);
    const [expandLadders, setExpandLadders] = useState(false);
    const [expandedFamilies, setExpandedFamilies] = useState<Record<string, boolean>>({});
    const [breakdownOpen, setBreakdownOpen] = useState(false);
    const [shareOpen, setShareOpen] = useState(false);
    const [optOutBusy, setOptOutBusy] = useState(false);
    const [notifyBusy, setNotifyBusy] = useState(false);
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [selectedBadgeId, setSelectedBadgeId] = useState<string | null>(null);
    const [dossierQuery, setDossierQuery] = useState<{ accountId?: string | number | null; rank?: number | null } | null>(null);
    const [pinBusy, setPinBusy] = useState(false);
    const [celebrationBadges, setCelebrationBadges] = useState<any[]>([]);

    const openMemberProfile = (entry: { accountId?: string | number | null; username?: string | null; rank?: number | null } | null) => {
        if (!entry) return;
        const accountId = String(entry.accountId || '').trim();
        const username = String(entry.username || '').trim();
        const anonymous = !username || /^viewer\s+\d+$/i.test(username) || username.toLowerCase() === 'anonymous';
        if ((accountId || (!anonymous && username)) && onNavigate) {
            onNavigate('profile', { path: `/profile/${encodeURIComponent(accountId || username)}` });
            return;
        }
        setDossierQuery(
            entry.accountId != null
                ? { accountId: entry.accountId }
                : { rank: entry.rank },
        );
    };

    const sessionThumb = useMemo(() => {
        const session = sessionInfo?.session || {};
        return session.thumb
            || sessionInfo?.account?.thumb
            || (session.isAdmin ? sessionInfo?.adminThumb : null)
            || null;
    }, [sessionInfo]);

    const avatarForEntry = (entry: any) => {
        const thumb = entry?.thumb || (entry?.isMe ? sessionThumb : null);
        return resolveLeaderboardAvatar(thumb, 72, 72);
    };

    const applyMe = (me: any) => {
        if (!me) return;
        setData((prev: any) => {
            const next = mergeMePayload(prev, me);
            dataRef.current = next;
            return next;
        });
        setRefreshing(!!me.refreshing);
        if (Array.isArray(me.badges)) setCatalogReady(true);
    };

    const celebrateFrom = (me: any) => {
        const newly = Array.isArray(me?.newlyEarnedIds)
            ? me.newlyEarnedIds.map(String).filter(Boolean)
            : [];
        if (!newly.length) return;
        const unseen = newly.filter((id: string) => !celebratedRef.current.has(id));
        if (!unseen.length) return;
        unseen.forEach((id: string) => celebratedRef.current.add(id));
        if (me?.notifyOnUnlock !== false) {
            const pool = [
                ...(me.earned || []),
                ...(me.badges || []),
                ...(dataRef.current?.earned || []),
                ...(dataRef.current?.badges || []),
            ];
            const unlocked = unseen.map((id: string) => (
                pool.find((b: any) => String(b?.id) === id)
                || { id, name: id, icon: '🏅' }
            ));
            setCelebrationBadges(unlocked);
            if (unseen.length === 1) {
                const badge = unlocked[0];
                setToasts((prev) => pushToast(prev, tAchievements('toast.unlockedOne', { name: badge?.name || unseen[0] }), 'success'));
            } else {
                setToasts((prev) => pushToast(prev, tAchievements('toast.unlockedMany', { count: unseen.length }), 'success'));
            }
        }
        void apiFetch('/api/achievements/me/ack-unlocks', {
            method: 'POST',
            body: JSON.stringify({ ids: newly }),
        }).catch(() => null);
    };

    const scheduleRefreshPoll = (shouldPoll: boolean) => {
        if (pollTimerRef.current) {
            clearTimeout(pollTimerRef.current);
            pollTimerRef.current = null;
        }
        if (!shouldPoll) return;
        pollTimerRef.current = setTimeout(() => {
            pollTimerRef.current = null;
            void apiFetch(ME_URL).then((fresh) => {
                applyMe(fresh);
                celebrateFrom(fresh);
            }).catch(() => null);
        }, ME_REFRESH_POLL_MS);
    };

    const load = useCallback(async () => {
        setError(null);
        if (!dataRef.current) setLoading(true);
        try {
            const lbPromise = apiFetchShared(`/api/achievements/leaderboard?limit=${LEADERBOARD_FETCH_LIMIT}`).catch(() => null);
            void lbPromise.then((lb) => {
                if (Array.isArray(lb?.entries)) {
                    setBoard(lb.entries);
                    setBoardPage(0);
                }
            });
            const summaryPromise = apiFetchShared(ME_SUMMARY_URL).then((summary) => {
                applyMe(summary);
                setLoading(false);
                celebrateFrom(summary);
                if (summary?.refreshing) scheduleRefreshPoll(true);
                return summary;
            });
            const mePromise = apiFetchShared(ME_URL).then((me) => {
                applyMe(me);
                setLoading(false);
                celebrateFrom(me);
                scheduleRefreshPoll(!!me?.refreshing);
                return me;
            });

            const [summary, me] = await Promise.all([
                summaryPromise.catch(() => null),
                mePromise,
            ]);

            if (me?.leaderboardEnabled !== false && summary?.leaderboardEnabled !== false) {
                const lb = await lbPromise;
                setBoard(Array.isArray(lb?.entries) ? lb.entries : []);
                setBoardPage(0);
            } else {
                setBoard([]);
                setBoardPage(0);
            }
        } catch (e: any) {
            if (!dataRef.current) {
                setError(e?.message || tAchievements('page.error'));
                setLoading(false);
            }
        }
    }, []);

    useEffect(() => () => {
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const categories = data?.categories || [];
    const badges = useMemo(() => {
        let list = Array.isArray(data?.badges) ? data.badges : [];
        if (category !== 'all') list = list.filter((b: any) => b.category === category);
        if (showEarnedOnly) list = list.filter((b: any) => b.earned);
        return list;
    }, [data, category, showEarnedOnly]);

    const families = useMemo(() => {
        const grouped = groupBadgesIntoFamilies(badges);
        if (!showEarnedOnly) return grouped;
        return grouped.filter((f) => f.earnedCount > 0);
    }, [badges, showEarnedOnly]);

    const boardRows = board || [];
    const boardPageCount = Math.max(1, Math.ceil(boardRows.length / LEADERBOARD_PAGE_SIZE));
    const safeBoardPage = Math.min(boardPage, boardPageCount - 1);
    const pageEntries = useMemo(
        () => boardRows.slice(
            safeBoardPage * LEADERBOARD_PAGE_SIZE,
            safeBoardPage * LEADERBOARD_PAGE_SIZE + LEADERBOARD_PAGE_SIZE,
        ),
        [boardRows, safeBoardPage],
    );

    const rivals = useMemo(() => {
        const myIdx = boardRows.findIndex((e) => e?.isMe);
        if (myIdx < 0) return { above: null as any, below: null as any, me: null as any };
        const me = boardRows[myIdx];
        const above = myIdx > 0 ? boardRows[myIdx - 1] : null;
        const below = myIdx < boardRows.length - 1 ? boardRows[myIdx + 1] : null;
        return { above, below, me };
    }, [boardRows]);

    const pinnedIds = useMemo(
        () => (Array.isArray(data?.pinnedBadgeIds) ? data.pinnedBadgeIds.map(String) : []),
        [data?.pinnedBadgeIds],
    );

    const pinnedBadges = useMemo(() => {
        if (!pinnedIds.length) return [] as any[];
        const pool = [
            ...(Array.isArray(data?.badges) ? data.badges : []),
            ...(Array.isArray(data?.nextUnlocks) ? data.nextUnlocks : []),
            ...(Array.isArray(data?.earned) ? data.earned : []),
        ];
        return pinnedIds.map((id) => pool.find((b: any) => String(b?.id) === id)).filter(Boolean);
    }, [data, pinnedIds]);

    const spotlightSeasons = useMemo(() => {
        const seasons = Array.isArray(data?.activeSeasons) ? data.activeSeasons : [];
        if (!seasons.length) return [] as any[];
        const pool = Array.isArray(data?.badges) ? data.badges : [];
        return seasons.map((season: any) => ({
            ...season,
            badges: (Array.isArray(season.badgeIds) ? season.badgeIds : [])
                .map((id: string) => pool.find((b: any) => String(b?.id) === String(id)))
                .filter(Boolean)
                .slice(0, 6),
        })).filter((s: any) => s.badges.length > 0 || s.name);
    }, [data]);

    const selectedLocalBadge = useMemo(() => {
        if (!selectedBadgeId) return null;
        const pool = [
            ...(Array.isArray(data?.badges) ? data.badges : []),
            ...(Array.isArray(data?.nextUnlocks) ? data.nextUnlocks : []),
            ...(Array.isArray(data?.earned) ? data.earned : []),
        ];
        return pool.find((b: any) => String(b?.id) === selectedBadgeId) || null;
    }, [data, selectedBadgeId]);

    const togglePin = async (badgeId: string) => {
        const id = String(badgeId);
        const next = pinnedIds.includes(id)
            ? pinnedIds.filter((x) => x !== id)
            : [...pinnedIds, id].slice(0, 3);
        setPinBusy(true);
        try {
            const res = await apiFetch('/api/achievements/me/pins', {
                method: 'POST',
                body: JSON.stringify({ ids: next }),
            });
            const saved = Array.isArray(res?.pinnedBadgeIds) ? res.pinnedBadgeIds.map(String) : next;
            setData((prev: any) => (prev ? { ...prev, pinnedBadgeIds: saved } : prev));
        } catch {
            setToasts((prev) => pushToast(prev, tAchievements('drawer.pinFailed'), 'error'));
        } finally {
            setPinBusy(false);
        }
    };

    const myRank = rivals.me?.rank ?? null;

    const toggleOptOut = async () => {
        if (!data) return;
        setOptOutBusy(true);
        try {
            const next = !data.leaderboardOptOut;
            await apiFetch('/api/achievements/me/opt-out', {
                method: 'POST',
                body: JSON.stringify({ optOut: next }),
            });
            await load();
        } catch {
            /* ignore */
        } finally {
            setOptOutBusy(false);
        }
    };

    const toggleNotify = async () => {
        if (!data) return;
        setNotifyBusy(true);
        try {
            const next = data.notifyOnUnlock === false;
            await apiFetch('/api/achievements/me/notify', {
                method: 'POST',
                body: JSON.stringify({ notifyOnUnlock: next }),
            });
            setData((prev: any) => (prev ? { ...prev, notifyOnUnlock: next } : prev));
        } catch {
            /* ignore */
        } finally {
            setNotifyBusy(false);
        }
    };

    if (loading) {
        return (
            <div className="w-full py-10 text-center text-muted text-sm">
                {tAchievements('page.loading')}
            </div>
        );
    }

    if (error) {
        return (
            <div className="w-full py-10 text-center text-red-300 text-sm">
                {error}
            </div>
        );
    }

    const lp = data?.levelProgress || {};

    return (
        <div className="w-full space-y-6 animate-fade-in pb-8">
            <ToastContainer toasts={toasts} setToasts={setToasts} />
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                <div>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-plex font-bold mb-1">{tAchievements('page.eyebrow')}</p>
                    <h1 className="text-3xl font-black text-text flex items-center gap-2">
                        <Trophy className="w-8 h-8 text-plex" /> {tAchievements('page.title')}
                        {refreshing && (
                            <span className="text-[10px] uppercase tracking-widest font-bold text-muted border border-white/10 rounded-full px-2 py-0.5">
                                {tAchievements('page.refreshing')}
                            </span>
                        )}
                    </h1>
                    <p className="text-sm text-muted mt-1">
                        {tAchievements('page.badgesCount', {
                            earned: data?.earnedCount || 0,
                            total: data?.totalBadges || 0,
                            level: data?.level || 1,
                        })}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        disabled={notifyBusy}
                        onClick={() => { void toggleNotify(); }}
                        className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border bg-white/5 text-sm font-semibold hover:border-plex/40 disabled:opacity-50"
                    >
                        {data?.notifyOnUnlock === false
                            ? <BellOff className="w-4 h-4 text-muted" />
                            : <Bell className="w-4 h-4 text-plex" />}
                        {data?.notifyOnUnlock === false
                            ? tAchievements('page.notifyOff')
                            : tAchievements('page.notifyOn')}
                    </button>
                    <button
                        type="button"
                        onClick={() => setShareOpen(true)}
                        className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border bg-white/5 text-sm font-semibold hover:border-plex/40"
                    >
                        <Share2 className="w-4 h-4 text-plex" /> {tAchievements('page.share')}
                    </button>
                    <button
                        type="button"
                        onClick={() => setBreakdownOpen(true)}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-white/5 text-sm font-semibold hover:border-plex/40"
                    >
                        <Sparkles className="w-4 h-4 text-plex" /> {tAchievements('page.xpBreakdown')}
                    </button>
                </div>
            </div>

            <div className="glass-card p-5 space-y-3">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <p className="text-xs text-muted uppercase tracking-widest font-bold">
                            {tAchievements('page.level', { level: lp.level || data?.level })}
                        </p>
                        <p className="text-2xl font-black text-text font-mono">{(data?.xp || 0).toLocaleString()} XP</p>
                    </div>
                    <Medal className="w-10 h-10 text-plex opacity-80" />
                </div>
                <div className="h-2.5 rounded-full bg-black/40 overflow-hidden border border-white/5">
                    <div className="h-full bg-plex rounded-full transition-all" style={{ width: `${lp.progressPct || 0}%` }} />
                </div>
                <p className="text-[11px] text-muted font-mono">
                    {tAchievements('page.toNext', { into: lp.xpIntoLevel || 0, need: lp.xpForNextLevel || 0 })}
                </p>
            </div>

            {spotlightSeasons.length > 0 && (
                <div className="glass-card p-5 space-y-4">
                    <h2 className="text-sm font-bold text-text uppercase tracking-widest flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-plex" />
                        {tAchievements('season.spotlight')}
                    </h2>
                    {spotlightSeasons.map((season: any) => (
                        <div key={season.id || season.name} className="space-y-2">
                            <div className="flex items-baseline justify-between gap-2">
                                <p className="text-sm font-bold text-text">{season.name}</p>
                                {(season.activeFrom || season.activeUntil) && (
                                    <p className="text-[10px] text-muted font-mono shrink-0">
                                        {season.activeFrom || '…'} → {season.activeUntil || '…'}
                                    </p>
                                )}
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                {(season.badges || []).map((badge: any) => (
                                    <BadgeTile
                                        key={badge.id}
                                        badge={badge}
                                        compact
                                        onClick={() => setSelectedBadgeId(String(badge.id))}
                                    />
                                ))}
                                {!(season.badges || []).length && (
                                    <p className="text-xs text-muted col-span-full">{tAchievements('season.emptyBadges')}</p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {pinnedBadges.length > 0 && (
                <div className="glass-card p-5 space-y-3">
                    <h2 className="text-sm font-bold text-text uppercase tracking-widest flex items-center gap-2">
                        <Pin className="w-4 h-4 text-plex" />
                        {tAchievements('page.pinnedGoals')}
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {pinnedBadges.map((badge: any) => (
                            <button
                                type="button"
                                key={badge.id}
                                onClick={() => setSelectedBadgeId(String(badge.id))}
                                className="rounded-xl border border-plex/30 bg-plex/5 px-3 py-2.5 min-w-0 text-left hover:border-plex/50"
                            >
                                <div className="flex items-start gap-2">
                                    <span className="text-xl leading-none">{badge.icon || '🏅'}</span>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-bold truncate">{badge.name}</p>
                                        <div className="mt-2 h-1.5 rounded-full bg-black/40 overflow-hidden">
                                            <div className="h-full rounded-full bg-plex" style={{ width: `${badgeBarPercent(badge)}%` }} />
                                        </div>
                                        <p className="mt-1 text-[10px] text-muted font-mono">
                                            {badge.earned
                                                ? tAchievements('badge.earned')
                                                : `${badge.progress ?? 0} / ${badge.threshold ?? 0}`}
                                        </p>
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {Array.isArray(data?.nextUnlocks) && data.nextUnlocks.length > 0 && (
                <div className="glass-card p-5 space-y-3">
                    <h2 className="text-sm font-bold text-text uppercase tracking-widest flex items-center gap-2">
                        <Target className="w-4 h-4 text-plex" />
                        {tAchievements('page.nextUnlocks')}
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {data.nextUnlocks.map((badge: any) => (
                            <button
                                type="button"
                                key={badge.id}
                                onClick={() => setSelectedBadgeId(String(badge.id))}
                                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 min-w-0 text-left hover:border-plex/40"
                            >
                                <div className="flex items-start gap-2">
                                    <span className="text-xl leading-none">{badge.icon || '🏅'}</span>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-bold truncate flex items-center gap-1.5">
                                            {badge.name}
                                            {pinnedIds.includes(String(badge.id)) && <Pin className="w-3 h-3 text-plex shrink-0" />}
                                        </p>
                                        <p className="text-[11px] text-muted line-clamp-2 mt-0.5">{badge.description}</p>
                                        <div className="mt-2 h-1.5 rounded-full bg-black/40 overflow-hidden">
                                            <div className="h-full rounded-full bg-plex" style={{ width: `${badgeBarPercent(badge)}%` }} />
                                        </div>
                                        <p className="mt-1 text-[10px] text-muted font-mono">
                                            {badge.progress ?? 0} / {badge.threshold ?? 0}
                                        </p>
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {data?.leaderboardEnabled && (
                <div className="glass-card p-5 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                        <h2 className="text-lg font-bold text-text">{tAchievements('page.leaderboard')}</h2>
                        <button
                            type="button"
                            disabled={optOutBusy}
                            onClick={toggleOptOut}
                            className="text-xs font-semibold text-muted hover:text-text"
                        >
                            {data.leaderboardOptOut ? tAchievements('page.showMe') : tAchievements('page.hideMe')}
                        </button>
                    </div>
                    {!board ? (
                        <p className="text-sm text-muted">{tAchievements('page.loading')}</p>
                    ) : !board.length ? (
                        <p className="text-sm text-muted">{tAchievements('page.noRankings')}</p>
                    ) : (
                        <div className="space-y-3">
                            {(rivals.above || rivals.below || rivals.me) && (() => {
                                const myXp = Number(rivals.me?.xp) || 0;
                                const huntXp = rivals.above ? Math.max(0, (Number(rivals.above.xp) || 0) - myXp) : 0;
                                const defendXp = rivals.below ? Math.max(0, myXp - (Number(rivals.below.xp) || 0)) : 0;
                                const huntPct = rivals.above
                                    ? Math.max(4, Math.min(96, Math.round((myXp / Math.max(1, Number(rivals.above.xp) || 1)) * 100)))
                                    : 100;
                                const defendPct = rivals.below
                                    ? Math.max(4, Math.min(96, Math.round(((Number(rivals.below.xp) || 0) / Math.max(1, myXp)) * 100)))
                                    : 0;
                                const openRival = (entry: any) => openMemberProfile(entry);
                                return (
                                <div className="relative overflow-hidden rounded-2xl border border-plex/25 bg-gradient-to-br from-plex/15 via-black/40 to-black/20 p-3.5 sm:p-4">
                                    <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-plex/20 blur-3xl" />
                                    <div className="pointer-events-none absolute -left-6 bottom-0 h-24 w-24 rounded-full bg-rose-500/10 blur-3xl" />
                                    <div className="relative flex items-center justify-between gap-3 mb-3">
                                        <p className="text-[10px] uppercase tracking-[0.28em] font-bold text-plex flex items-center gap-1.5">
                                            <Swords className="w-3.5 h-3.5" />
                                            {tAchievements('page.rivals')}
                                        </p>
                                        {rivals.me?.rank != null && (
                                            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/35 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-text">
                                                <Flame className="w-3 h-3 text-plex" />
                                                #{rivals.me.rank}
                                            </span>
                                        )}
                                    </div>
                                    <div className="relative grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                        {rivals.above ? (
                                            <button
                                                type="button"
                                                onClick={() => openRival(rivals.above)}
                                                className="group text-left rounded-xl border border-plex/35 bg-plex/10 hover:bg-plex/15 hover:border-plex/55 transition-colors px-3 py-3"
                                            >
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <img
                                                        src={avatarForEntry(rivals.above)}
                                                        alt=""
                                                        className="w-11 h-11 rounded-full object-cover border border-plex/50 bg-black/40 shrink-0"
                                                        onError={(e) => { (e.target as HTMLImageElement).src = logoUrl(); }}
                                                    />
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-[10px] uppercase tracking-[0.22em] font-bold text-plex flex items-center gap-1">
                                                            <Crosshair className="w-3 h-3" />
                                                            {tAchievements('dossier.hunt')}
                                                        </p>
                                                        <p className="text-sm font-black text-text truncate mt-0.5">
                                                            #{rivals.above.rank} {rivals.above.username}
                                                        </p>
                                                        <p className="text-[11px] text-muted font-mono mt-0.5 tabular-nums">
                                                            {tAchievements('common.levelShort', { level: rivals.above.level })} · {(Number(rivals.above.xp) || 0).toLocaleString()} XP
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="mt-3">
                                                    <div className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wide">
                                                        <span className="text-plex">{tAchievements('dossier.xpGapAhead', { xp: huntXp.toLocaleString() })}</span>
                                                    </div>
                                                    <div className="mt-1.5 h-2 rounded-full bg-black/50 border border-white/5 overflow-hidden">
                                                        <div
                                                            className="h-full rounded-full bg-gradient-to-r from-plex/70 to-plex shadow-[0_0_12px_rgba(229,160,13,0.35)] transition-all"
                                                            style={{ width: `${huntPct}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            </button>
                                        ) : rivals.me?.rank === 1 ? (
                                            <div className="rounded-xl border border-amber-400/35 bg-gradient-to-br from-amber-500/15 to-black/30 px-3 py-3 flex items-center gap-3">
                                                <span className="inline-flex items-center justify-center w-11 h-11 rounded-full border border-amber-400/40 bg-amber-500/10 text-amber-200 shrink-0">
                                                    <Shield className="w-5 h-5" />
                                                </span>
                                                <div className="min-w-0">
                                                    <p className="text-[10px] uppercase tracking-[0.22em] font-bold text-amber-200/80">{tAchievements('dossier.hunt')}</p>
                                                    <p className="text-sm font-black text-amber-50 mt-0.5">{tAchievements('dossier.holdingCrown')}</p>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-xs text-muted">
                                                {tAchievements('page.rivalNone')}
                                            </div>
                                        )}

                                        {rivals.below ? (
                                            <button
                                                type="button"
                                                onClick={() => openRival(rivals.below)}
                                                className="group text-left rounded-xl border border-rose-400/25 bg-rose-500/10 hover:bg-rose-500/15 hover:border-rose-400/45 transition-colors px-3 py-3"
                                            >
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <img
                                                        src={avatarForEntry(rivals.below)}
                                                        alt=""
                                                        className="w-11 h-11 rounded-full object-cover border border-rose-400/40 bg-black/40 shrink-0"
                                                        onError={(e) => { (e.target as HTMLImageElement).src = logoUrl(); }}
                                                    />
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-[10px] uppercase tracking-[0.22em] font-bold text-rose-200/90 flex items-center gap-1">
                                                            <Shield className="w-3 h-3" />
                                                            {tAchievements('dossier.defend')}
                                                        </p>
                                                        <p className="text-sm font-black text-text truncate mt-0.5">
                                                            #{rivals.below.rank} {rivals.below.username}
                                                        </p>
                                                        <p className="text-[11px] text-muted font-mono mt-0.5 tabular-nums">
                                                            {tAchievements('common.levelShort', { level: rivals.below.level })} · {(Number(rivals.below.xp) || 0).toLocaleString()} XP
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="mt-3">
                                                    <div className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wide">
                                                        <span className="text-rose-200/90">{tAchievements('dossier.xpGapBehind', { xp: defendXp.toLocaleString() })}</span>
                                                    </div>
                                                    <div className="mt-1.5 h-2 rounded-full bg-black/50 border border-white/5 overflow-hidden">
                                                        <div
                                                            className="h-full rounded-full bg-gradient-to-r from-rose-400/80 to-rose-300/70 transition-all"
                                                            style={{ width: `${defendPct}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            </button>
                                        ) : !rivals.above ? null : (
                                            <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 flex items-center gap-3">
                                                <span className="inline-flex items-center justify-center w-11 h-11 rounded-full border border-white/10 bg-white/5 text-muted shrink-0">
                                                    <Shield className="w-5 h-5" />
                                                </span>
                                                <p className="text-sm text-muted">{tAchievements('dossier.noHunter')}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                );
                            })()}
                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                                {pageEntries.map((entry) => {
                                    const delta = Number(entry.rankDelta) || 0;
                                    const DeltaIcon = delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : Minus;
                                    const deltaTone = delta > 0 ? 'text-emerald-300' : delta < 0 ? 'text-rose-300' : 'text-muted/50';
                                    return (
                                    <button
                                        type="button"
                                        key={`${entry.rank}-${entry.username}`}
                                        onClick={() => openMemberProfile(entry)}
                                        title={tAchievements('dossier.openHint')}
                                        className={`rounded-xl px-3 py-2.5 border min-w-0 text-left transition-colors hover:border-plex/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-plex/50 ${
                                            entry.isMe ? 'border-plex/50 bg-plex/10' : 'border-white/5 bg-black/20'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <img
                                                src={avatarForEntry(entry)}
                                                alt=""
                                                className={`w-10 h-10 rounded-full object-cover bg-black/40 shrink-0 border ${
                                                    entry.isMe ? 'border-plex/60' : 'border-white/10'
                                                }`}
                                                onError={(e) => {
                                                    const img = e.target as HTMLImageElement;
                                                    if (entry.isMe && sessionThumb && !img.dataset.fallback) {
                                                        img.dataset.fallback = '1';
                                                        img.src = resolveLeaderboardAvatar(sessionThumb, 72, 72);
                                                        return;
                                                    }
                                                    img.src = logoUrl();
                                                }}
                                            />
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1.5">
                                                    <p className="font-mono font-bold text-plex text-sm">#{entry.rank}</p>
                                                    <DeltaIcon className={`w-3.5 h-3.5 shrink-0 ${deltaTone}`} aria-hidden />
                                                </div>
                                                <p className="text-sm font-bold truncate mt-0.5">
                                                    {entry.username}{entry.isMe ? ` ${tAchievements('dossier.you')}` : ''}
                                                </p>
                                                <p className="text-[10px] text-muted font-mono mt-1 leading-snug truncate">
                                                    {tAchievements('common.levelShort', { level: entry.level })} · {Number(entry.xp).toLocaleString()} XP
                                                </p>
                                                <p className="text-[10px] text-muted font-mono truncate">
                                                    {tAchievements('common.badgeCount', { count: entry.earnedCount })}
                                                </p>
                                            </div>
                                        </div>
                                    </button>
                                    );
                                })}
                            </div>
                            {boardRows.length > LEADERBOARD_PAGE_SIZE && (
                                <div className="flex items-center justify-between gap-3 pt-1">
                                    <button
                                        type="button"
                                        disabled={safeBoardPage <= 0}
                                        onClick={() => setBoardPage((p) => Math.max(0, p - 1))}
                                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted disabled:opacity-40 hover:text-text hover:border-plex/40"
                                    >
                                        <ChevronLeft className="w-3.5 h-3.5" />
                                        {tAchievements('page.prev')}
                                    </button>
                                    <span className="text-xs text-muted font-semibold">
                                        {tAchievements('page.of', {
                                            page: safeBoardPage + 1,
                                            total: boardPageCount,
                                        })}
                                    </span>
                                    <button
                                        type="button"
                                        disabled={safeBoardPage >= boardPageCount - 1}
                                        onClick={() => setBoardPage((p) => Math.min(boardPageCount - 1, p + 1))}
                                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted disabled:opacity-40 hover:text-text hover:border-plex/40"
                                    >
                                        {tAchievements('page.next')}
                                        <ChevronRight className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            <div className="flex flex-wrap gap-2 items-center">
                <button
                    type="button"
                    onClick={() => setCategory('all')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${category === 'all' ? 'border-plex text-plex bg-plex/10' : 'border-border text-muted'}`}
                >
                    {tAchievements('page.all')}
                </button>
                {categories.map((cat: any) => (
                    <button
                        key={cat.id}
                        type="button"
                        onClick={() => setCategory(cat.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${category === cat.id ? 'border-plex text-plex bg-plex/10' : 'border-border text-muted'}`}
                    >
                        {cat.label}
                    </button>
                ))}
                <label className="ml-auto flex items-center gap-2 text-xs text-muted">
                    <input type="checkbox" checked={showEarnedOnly} onChange={(e) => setShowEarnedOnly(e.target.checked)} />
                    {tAchievements('page.earnedOnly')}
                </label>
                <label className="flex items-center gap-2 text-xs text-muted">
                    <input type="checkbox" checked={expandLadders} onChange={(e) => setExpandLadders(e.target.checked)} />
                    {tAchievements('ladder.showAllBadges')}
                </label>
            </div>

            {expandLadders ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {!catalogReady ? (
                        <p className="text-sm text-muted col-span-full">{tAchievements('page.loadingCatalog')}</p>
                    ) : badges.map((badge: any) => (
                        <BadgeTile
                            key={badge.id}
                            badge={badge}
                            onClick={() => setSelectedBadgeId(String(badge.id))}
                        />
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {!catalogReady ? (
                        <p className="text-sm text-muted col-span-full">{tAchievements('page.loadingCatalog')}</p>
                    ) : families.map((family) => (
                        <LadderFamilyCard
                            key={family.key}
                            family={family}
                            expanded={!!expandedFamilies[family.key]}
                            onToggle={() => setExpandedFamilies((prev) => ({
                                ...prev,
                                [family.key]: !prev[family.key],
                            }))}
                            onBadgeClick={(badge) => setSelectedBadgeId(String(badge.id))}
                        />
                    ))}
                </div>
            )}

            <XpBreakdownModal
                open={breakdownOpen}
                onClose={() => setBreakdownOpen(false)}
                breakdown={data?.breakdown}
                stats={data?.stats}
                xp={data?.xp}
                levelProgress={lp}
                earnedCount={data?.earnedCount}
                totalBadges={data?.totalBadges}
                nextUnlocks={data?.nextUnlocks}
            />
            <BadgeDetailDrawer
                badgeId={selectedBadgeId}
                localBadge={selectedLocalBadge}
                pinnedIds={pinnedIds}
                onClose={() => setSelectedBadgeId(null)}
                onTogglePin={(id) => { void togglePin(id); }}
                pinBusy={pinBusy}
            />
            <LeaderboardDossierModal
                query={dossierQuery}
                onClose={() => setDossierQuery(null)}
                onOpenBadge={(badgeId) => {
                    setDossierQuery(null);
                    setSelectedBadgeId(badgeId);
                }}
            />
            {celebrationBadges.length > 0 && (
                <UnlockCelebration
                    badges={celebrationBadges}
                    onClose={() => setCelebrationBadges([])}
                />
            )}
            {shareOpen && (
                <ModalPortal open={shareOpen}>
                    <ShareAchievementsModal
                        me={{
                            ...data,
                            username: sessionInfo?.session?.username || sessionInfo?.account?.username || data?.username,
                        }}
                        serverName={sessionInfo?.serverName || 'StreamPilot'}
                        rank={myRank}
                        onClose={() => setShareOpen(false)}
                        onToast={(message, type) => setToasts((prev) => pushToast(prev, message, type))}
                    />
                </ModalPortal>
            )}
        </div>
    );
};

export const AchievementsHomeWidget: React.FC<{
    summary: any;
    onOpen?: () => void;
}> = ({ summary, onOpen }) => {
    const { tAchievements } = useAchievementsI18n();
    if (!summary) return null;
    const lp = summary.levelProgress || {};
    const recent = (summary.recentEarned || summary.earned?.slice?.(0, 6) || []) as any[];
    const pinnedIds = Array.isArray(summary.pinnedBadgeIds) ? summary.pinnedBadgeIds.map(String) : [];
    const nextPool = Array.isArray(summary.nextUnlocks) ? summary.nextUnlocks : [];
    const earnedPool = Array.isArray(summary.earned) ? summary.earned : [];
    const pinned = pinnedIds
        .map((id: string) => nextPool.find((b: any) => String(b?.id) === id) || earnedPool.find((b: any) => String(b?.id) === id))
        .filter(Boolean)
        .slice(0, 3);
    const next = (pinned.length ? pinned : nextPool.slice(0, 2)) as any[];
    return (
        <button
            type="button"
            onClick={onOpen}
            className="glass-card p-4 md:p-5 shadow-xl w-full text-left hover:border-plex/40 transition-colors border border-transparent"
        >
            <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                    <p className="text-[10px] uppercase tracking-[0.25em] text-plex font-bold">{tAchievements('home.eyebrow')}</p>
                    <p className="text-xl font-black text-text mt-1">{tAchievements('page.level', { level: summary.level || 1 })}</p>
                    <p className="text-xs text-muted font-mono mt-0.5">
                        {(summary.xp || 0).toLocaleString()} XP · {tAchievements('dossier.badgeCount', {
                            earned: summary.earnedCount || 0,
                            total: summary.totalBadges || 0,
                        })}
                    </p>
                </div>
                <Trophy className="w-7 h-7 text-plex" />
            </div>
            <div className="h-2 rounded-full bg-black/40 overflow-hidden mb-3">
                <div className="h-full bg-plex rounded-full" style={{ width: `${lp.progressPct || 0}%` }} />
            </div>
            {next.length > 0 && (
                <div className="mb-3 space-y-1.5">
                    <p className="text-[10px] uppercase tracking-widest text-muted font-bold">
                        {pinned.length ? tAchievements('page.pinnedGoals') : tAchievements('home.next')}
                    </p>
                    {next.map((badge) => (
                        <div key={badge.id} className="flex items-center gap-2 min-w-0">
                            <span className="text-base leading-none">{badge.icon || '🏅'}</span>
                            <div className="min-w-0 flex-1">
                                <p className="text-[11px] font-semibold truncate">{badge.name}</p>
                                <div className="mt-0.5 h-1 rounded-full bg-black/40 overflow-hidden">
                                    <div className="h-full bg-plex/80 rounded-full" style={{ width: `${badgeBarPercent(badge)}%` }} />
                                </div>
                            </div>
                            <span className="text-[10px] text-muted font-mono shrink-0">
                                {badge.earned ? tAchievements('badge.earned') : `${badge.progress ?? 0}/${badge.threshold ?? 0}`}
                            </span>
                        </div>
                    ))}
                </div>
            )}
            <div className="flex flex-wrap gap-1.5">
                {recent.map((b) => (
                    <span key={b.id} className="w-8 h-8 rounded-lg border border-white/10 bg-black/30 flex items-center justify-center text-base" title={b.name}>
                        {b.icon}
                    </span>
                ))}
                {!recent.length && <span className="text-xs text-muted">{tAchievements('home.empty')}</span>}
            </div>
        </button>
    );
};
