import React, { useEffect, useMemo, useState } from 'react';
import {
    ArrowDownRight, ArrowUpRight, Crosshair, Flag, Flame, Minus, Shield,
    Sparkles, Swords, Target, Trophy, X, Zap,
} from 'lucide-react';
import { apiFetch } from '../shared/api';
import { logoUrl, portalUrl, resolvePortalAssetUrl } from '../shared/basePath';
import { ModalPortal } from '../shared/ModalPortal';
import { tAchievements, useAchievementsI18n } from './i18n';
import { badgeBarPercent } from './badgeFamilies';

const PANEL_FALLBACK = '#12141a';
const PANEL_BG = 'rgb(var(--color-card))';

const rarityGlow: Record<string, string> = {
    legendary: 'from-amber-400/35 via-amber-500/10 to-[rgb(var(--color-card))]',
    epic: 'from-fuchsia-400/30 via-fuchsia-500/10 to-[rgb(var(--color-card))]',
    rare: 'from-sky-400/28 via-sky-500/10 to-[rgb(var(--color-card))]',
    common: 'from-white/10 via-white/5 to-[rgb(var(--color-card))]',
};

const rarityChip = (rarity: string) => {
    if (rarity === 'legendary') return 'border-amber-400/50 text-amber-100 bg-amber-500/10';
    if (rarity === 'epic') return 'border-fuchsia-400/45 text-fuchsia-100 bg-fuchsia-500/10';
    if (rarity === 'rare') return 'border-sky-400/45 text-sky-100 bg-sky-500/10';
    return 'border-white/15 text-muted bg-white/5';
};

const resolveAvatar = (thumb: string | null | undefined, size = 160) => {
    if (!thumb) return logoUrl();
    if (thumb.startsWith('http://') || thumb.startsWith('https://') || thumb.startsWith('/api/')) {
        return resolvePortalAssetUrl(thumb);
    }
    return portalUrl(`/api/plex/image?path=${encodeURIComponent(thumb)}&width=${size}&height=${size}`);
};

const formatXpLabel = (key: string, translate = tAchievements) => {
    const mapped = translate(`xp.source.${key}`);
    return mapped.startsWith('xp.source.') ? key : mapped;
};

type DossierQuery = { accountId?: string | number | null; rank?: number | null } | null;

type Props = {
    query: DossierQuery;
    onClose: () => void;
    onOpenBadge?: (badgeId: string) => void;
};

export const LeaderboardDossierModal: React.FC<Props> = ({ query, onClose, onOpenBadge }) => {
    const { tAchievements } = useAchievementsI18n();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const open = !!(query && (query.accountId || query.rank));

    useEffect(() => {
        if (!open) {
            setData(null);
            setError(null);
            return;
        }
        let cancelled = false;
        const params = new URLSearchParams();
        if (query?.accountId != null && String(query.accountId).trim()) {
            params.set('accountId', String(query.accountId));
        } else if (query?.rank != null) {
            params.set('rank', String(query.rank));
        }
        setLoading(true);
        setError(null);
        apiFetch(`/api/achievements/dossier?${params.toString()}`)
            .then((payload) => {
                if (!cancelled) setData(payload);
            })
            .catch((e: any) => {
                if (!cancelled) {
                    setData(null);
                    setError(e?.message || tAchievements('dossier.error'));
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [open, query?.accountId, query?.rank]);

    const heroRarity = data?.trophyCase?.[0]?.rarity || data?.lastBadge?.rarity || 'common';
    const delta = Number(data?.rankDelta) || 0;
    const RankIcon = delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : Minus;
    const rankTone = delta > 0 ? 'text-emerald-300' : delta < 0 ? 'text-rose-300' : 'text-muted';

    const rarityBars = useMemo(() => {
        const rb = data?.rarityBreakdown || {};
        const total = Math.max(1, Object.values(rb).reduce((s: number, n: any) => s + (Number(n) || 0), 0) as number);
        return (['legendary', 'epic', 'rare', 'common'] as const).map((key) => ({
            key,
            count: Number(rb[key]) || 0,
            pct: Math.round(((Number(rb[key]) || 0) / total) * 100),
        }));
    }, [data?.rarityBreakdown]);

    if (!open) return null;

    return (
        <ModalPortal open={open}>
            <div className="fixed inset-x-0 top-0 z-[340] flex items-end sm:items-center justify-center p-0 sm:p-6 bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] sm:inset-0 sm:bottom-0">
                <button type="button" className="absolute inset-0 bg-black/80 backdrop-blur-[3px]" aria-label={tAchievements('common.close')} onClick={onClose} />
                <div
                    className="relative isolate w-full sm:max-w-5xl max-h-[min(94vh,100%)] sm:max-h-[90vh] flex flex-col rounded-t-3xl sm:rounded-3xl border border-white/10 shadow-[0_28px_100px_rgba(0,0,0,0.65)] overflow-hidden animate-[achUnlockPop_0.4s_ease-out]"
                    style={{ backgroundColor: PANEL_FALLBACK }}
                    role="dialog"
                    aria-modal="true"
                    aria-label={tAchievements('dossier.title')}
                >
                    <div className="absolute inset-0" style={{ backgroundColor: PANEL_BG }} aria-hidden />
                    <div className={`pointer-events-none absolute inset-x-0 top-0 h-56 bg-gradient-to-b ${rarityGlow[heroRarity] || rarityGlow.common}`} />
                    <div className="pointer-events-none absolute -right-16 top-10 h-48 w-48 rounded-full bg-plex/15 blur-3xl" />
                    <div className="pointer-events-none absolute -left-10 top-24 h-36 w-36 rounded-full bg-amber-400/10 blur-3xl" />

                    <div className="relative z-[1] flex min-h-0 flex-1 flex-col">
                        <div className="shrink-0 px-5 sm:px-7 pt-5 sm:pt-6 pb-4 border-b border-white/8">
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-3.5 min-w-0">
                                    <div className="relative shrink-0">
                                        <div className="absolute -inset-1 rounded-full bg-gradient-to-br from-plex/50 via-amber-400/20 to-transparent blur-sm" />
                                        <img
                                            src={resolveAvatar(data?.thumb, 160)}
                                            alt=""
                                            className="relative w-16 h-16 sm:w-[4.5rem] sm:h-[4.5rem] rounded-full object-cover border-2 border-white/15 bg-black/40"
                                            onError={(e) => { (e.target as HTMLImageElement).src = logoUrl(); }}
                                        />
                                        <span className="absolute -bottom-1 -right-1 inline-flex items-center justify-center min-w-[2rem] h-7 px-1.5 rounded-full bg-plex text-[11px] font-black text-black shadow-lg">
                                            #{data?.rank || '—'}
                                        </span>
                                    </div>
                                    <div className="min-w-0 pt-0.5">
                                        <p className="text-[10px] uppercase tracking-[0.28em] text-plex font-bold mb-1">
                                            {data?.classTitle?.label || tAchievements('dossier.title')}
                                        </p>
                                        <h3 className="text-xl sm:text-2xl font-black text-text truncate">
                                            {data?.username || '…'}
                                            {data?.isMe ? (
                                                <span className="ml-2 text-sm font-bold text-plex">{tAchievements('dossier.you')}</span>
                                            ) : null}
                                        </h3>
                                        <p className="text-sm text-muted mt-1 leading-snug">
                                            {data?.classTitle?.blurb || tAchievements('dossier.subtitle')}
                                        </p>
                                        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                                            <span className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-black/25 px-2 py-1 font-mono text-text">
                                                {tAchievements('common.levelShort', { level: data?.level ?? '—' })}
                                            </span>
                                            <span className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-black/25 px-2 py-1 font-mono text-text">
                                                {(Number(data?.xp) || 0).toLocaleString()} XP
                                            </span>
                                            <span className={`inline-flex items-center gap-1 rounded-lg border border-white/10 bg-black/25 px-2 py-1 ${rankTone}`}>
                                                <RankIcon className="w-3.5 h-3.5" />
                                                {delta > 0
                                                    ? tAchievements('dossier.climbed', { n: delta })
                                                    : delta < 0
                                                        ? tAchievements('dossier.dropped', { n: Math.abs(delta) })
                                                        : tAchievements('dossier.steady')}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="p-2.5 rounded-xl text-muted hover:text-text hover:bg-white/5 border border-transparent hover:border-white/10 shrink-0"
                                    aria-label={tAchievements('common.close')}
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        <div className="relative flex-1 overflow-y-auto custom-scrollbar px-5 sm:px-7 py-5 space-y-5">
                            {loading && <p className="text-sm text-muted py-8 text-center">{tAchievements('dossier.loading')}</p>}
                            {error && <p className="text-sm text-red-300 py-6 text-center">{error}</p>}

                            {!loading && !error && data && (
                                <>
                                    {/* Spotlight last badge + first-blood stat */}
                                    <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                                        <button
                                            type="button"
                                            disabled={!data.lastBadge?.id}
                                            onClick={() => data.lastBadge?.id && onOpenBadge?.(String(data.lastBadge.id))}
                                            className="sm:col-span-3 text-left rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-black/20 p-4 hover:border-plex/40 transition-colors disabled:opacity-70"
                                        >
                                            <p className="text-[10px] uppercase tracking-[0.22em] text-muted font-bold flex items-center gap-1.5">
                                                <Sparkles className="w-3.5 h-3.5 text-plex" />
                                                {tAchievements('dossier.lastBadge')}
                                            </p>
                                            {data.lastBadge ? (
                                                <div className="mt-3 flex items-start gap-3">
                                                    <span className="text-4xl leading-none">{data.lastBadge.icon || '🏅'}</span>
                                                    <div className="min-w-0">
                                                        <p className="text-base font-black text-text truncate">{data.lastBadge.name}</p>
                                                        <p className={`mt-1 inline-flex text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-md border ${rarityChip(data.lastBadge.rarity)}`}>
                                                            {data.lastBadge.rarity}
                                                        </p>
                                                        <p className="text-xs text-muted mt-2 font-mono">
                                                            {data.lastBadge.earnedAt
                                                                ? new Date(data.lastBadge.earnedAt).toLocaleString()
                                                                : '—'}
                                                        </p>
                                                    </div>
                                                </div>
                                            ) : (
                                                <p className="mt-3 text-sm text-muted">{tAchievements('dossier.noBadges')}</p>
                                            )}
                                        </button>

                                        <div className="sm:col-span-2 rounded-2xl border border-amber-400/25 bg-gradient-to-br from-amber-500/15 to-black/30 p-4 flex flex-col justify-between">
                                            <p className="text-[10px] uppercase tracking-[0.22em] text-amber-100/80 font-bold flex items-center gap-1.5">
                                                <Flag className="w-3.5 h-3.5" />
                                                {tAchievements('dossier.firstBlood')}
                                            </p>
                                            <div className="mt-3">
                                                <p className="text-4xl font-black font-mono text-amber-100 tabular-nums leading-none">
                                                    {Number(data.firstUnlocks?.count) || 0}
                                                </p>
                                                <p className="text-xs text-amber-100/70 mt-2 leading-relaxed">
                                                    {tAchievements('dossier.firstBloodHint')}
                                                </p>
                                            </div>
                                            <div className="mt-3 flex items-center gap-2 text-[11px] text-muted">
                                                <Flame className="w-3.5 h-3.5 text-plex" />
                                                {tAchievements('dossier.momentum', {
                                                    week: Number(data.momentum?.badgesLast7d) || 0,
                                                    month: Number(data.momentum?.badgesLast30d) || 0,
                                                })}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Trophy case */}
                                    <section>
                                        <div className="flex items-end justify-between gap-3 mb-2.5">
                                            <h4 className="text-[10px] uppercase tracking-[0.22em] text-muted font-bold flex items-center gap-1.5">
                                                <Trophy className="w-3.5 h-3.5 text-plex" />
                                                {tAchievements('dossier.trophyCase')}
                                            </h4>
                                            <p className="text-[11px] text-muted">
                                                {tAchievements('dossier.badgeCount', {
                                                    earned: Number(data.earnedCount) || 0,
                                                    total: Number(data.totalBadges) || 0,
                                                })}
                                            </p>
                                        </div>
                                        <div className="grid grid-cols-5 gap-2">
                                            {(data.trophyCase || []).map((badge: any) => (
                                                <button
                                                    key={badge.id}
                                                    type="button"
                                                    onClick={() => onOpenBadge?.(String(badge.id))}
                                                    className={`rounded-xl border px-1.5 py-2.5 text-center hover:scale-[1.03] transition-transform ${rarityChip(badge.rarity)}`}
                                                    title={badge.name}
                                                >
                                                    <span className="text-2xl leading-none block">{badge.icon || '🏅'}</span>
                                                    <span className="mt-1 block text-[9px] font-bold uppercase tracking-wide truncate">{badge.rarity}</span>
                                                </button>
                                            ))}
                                            {!(data.trophyCase || []).length && (
                                                <p className="col-span-5 text-sm text-muted py-4 text-center border border-dashed border-white/10 rounded-xl">
                                                    {tAchievements('dossier.noBadges')}
                                                </p>
                                            )}
                                        </div>
                                        <div className="mt-3 grid grid-cols-4 gap-1.5">
                                            {rarityBars.map((row) => (
                                                <div key={row.key} className="rounded-lg bg-black/25 border border-white/5 px-2 py-1.5">
                                                    <p className="text-[9px] uppercase tracking-wide text-muted font-bold truncate">{row.key}</p>
                                                    <div className="mt-1 h-1 rounded-full bg-black/50 overflow-hidden">
                                                        <div
                                                            className={`h-full rounded-full ${
                                                                row.key === 'legendary' ? 'bg-amber-400'
                                                                    : row.key === 'epic' ? 'bg-fuchsia-400'
                                                                        : row.key === 'rare' ? 'bg-sky-400' : 'bg-white/35'
                                                            }`}
                                                            style={{ width: `${row.pct}%` }}
                                                        />
                                                    </div>
                                                    <p className="mt-1 text-[10px] font-mono text-text/80">{row.count}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </section>

                                    {/* Rivals / threat arena */}
                                    <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div className="rounded-2xl border border-white/10 bg-black/25 p-4 space-y-3">
                                            <p className="text-[10px] uppercase tracking-[0.22em] text-muted font-bold flex items-center gap-1.5">
                                                <Swords className="w-3.5 h-3.5 text-plex" />
                                                {tAchievements('dossier.rivalArena')}
                                            </p>
                                            {data.rivals?.above ? (
                                                <div className="rounded-xl border border-plex/25 bg-plex/10 px-3 py-2.5">
                                                    <p className="text-[10px] uppercase tracking-wide text-plex font-bold">{tAchievements('dossier.hunt')}</p>
                                                    <p className="text-sm font-bold text-text mt-0.5 truncate">
                                                        #{data.rivals.above.rank} {data.rivals.above.username}
                                                    </p>
                                                    <p className="text-xs text-muted mt-1 font-mono">
                                                        {tAchievements('dossier.xpGapAhead', {
                                                            xp: Number(data.rivals.above.xpGap || 0).toLocaleString(),
                                                        })}
                                                    </p>
                                                </div>
                                            ) : (
                                                <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-100 font-semibold flex items-center gap-2">
                                                    <Shield className="w-4 h-4" />
                                                    {tAchievements('dossier.holdingCrown')}
                                                </div>
                                            )}
                                            {data.rivals?.below ? (
                                                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                                                    <p className="text-[10px] uppercase tracking-wide text-muted font-bold">{tAchievements('dossier.defend')}</p>
                                                    <p className="text-sm font-bold text-text mt-0.5 truncate">
                                                        #{data.rivals.below.rank} {data.rivals.below.username}
                                                    </p>
                                                    <p className="text-xs text-muted mt-1 font-mono">
                                                        {tAchievements('dossier.xpGapBehind', {
                                                            xp: Number(data.rivals.below.xpGap || 0).toLocaleString(),
                                                        })}
                                                    </p>
                                                </div>
                                            ) : (
                                                <p className="text-xs text-muted">{tAchievements('dossier.noHunter')}</p>
                                            )}
                                        </div>

                                        <div className="rounded-2xl border border-rose-400/25 bg-gradient-to-br from-rose-500/10 to-black/30 p-4 space-y-3">
                                            <p className="text-[10px] uppercase tracking-[0.22em] text-rose-100/80 font-bold flex items-center gap-1.5">
                                                <Crosshair className="w-3.5 h-3.5" />
                                                {tAchievements('dossier.threat')}
                                            </p>
                                            {data.threat ? (
                                                <>
                                                    <p className="text-lg font-black text-text truncate">
                                                        #{data.threat.rank} {data.threat.username}
                                                    </p>
                                                    <p className="text-sm text-muted leading-relaxed">
                                                        {tAchievements('dossier.threatBlurb', {
                                                            xp: Number(data.threat.xpGap || 0).toLocaleString(),
                                                            n: Number(data.threat.recentBadges14d) || 0,
                                                        })}
                                                    </p>
                                                </>
                                            ) : (
                                                <p className="text-sm text-muted">{tAchievements('dossier.threatNone')}</p>
                                            )}
                                            {data.signature ? (
                                                <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5">
                                                    <p className="text-[10px] uppercase tracking-wide text-muted font-bold flex items-center gap-1.5">
                                                        <Zap className="w-3.5 h-3.5 text-plex" />
                                                        {tAchievements('dossier.signature')}
                                                    </p>
                                                    <p className="text-sm font-bold text-text mt-1">
                                                        {formatXpLabel(String(data.signature.label || data.signature.key), tAchievements)}
                                                    </p>
                                                    <p className="text-xs font-mono text-plex mt-0.5">
                                                        {Number(data.signature.value || 0).toLocaleString()}
                                                        {data.signature.kind === 'xp' ? ' XP' : ''}
                                                    </p>
                                                </div>
                                            ) : null}
                                        </div>
                                    </section>

                                    {/* Closest unlocks */}
                                    <section>
                                        <h4 className="text-[10px] uppercase tracking-[0.22em] text-muted font-bold mb-2.5 flex items-center gap-1.5">
                                            <Target className="w-3.5 h-3.5 text-plex" />
                                            {tAchievements('dossier.closest')}
                                        </h4>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            {(data.closest || []).map((badge: any) => (
                                                <button
                                                    key={badge.id}
                                                    type="button"
                                                    onClick={() => onOpenBadge?.(String(badge.id))}
                                                    className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-left hover:border-plex/35 transition-colors"
                                                >
                                                    <div className="flex items-start gap-2.5">
                                                        <span className="text-xl leading-none">{badge.icon || '🎯'}</span>
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-sm font-bold truncate">{badge.name}</p>
                                                            <div className="mt-2 h-1.5 rounded-full bg-black/45 overflow-hidden">
                                                                <div
                                                                    className="h-full rounded-full bg-plex/85"
                                                                    style={{ width: `${badgeBarPercent(badge)}%` }}
                                                                />
                                                            </div>
                                                            <p className="mt-1 text-[10px] font-mono text-muted tabular-nums">
                                                                {badge.progress ?? 0} / {badge.threshold ?? 0}
                                                                <span className="text-plex font-semibold"> · {badge.progressPct || 0}%</span>
                                                            </p>
                                                        </div>
                                                    </div>
                                                </button>
                                            ))}
                                            {!(data.closest || []).length && (
                                                <p className="sm:col-span-2 text-sm text-muted py-4 text-center border border-dashed border-white/10 rounded-xl">
                                                    {tAchievements('dossier.closestEmpty')}
                                                </p>
                                            )}
                                        </div>
                                    </section>

                                    {/* Recent unlock ribbon */}
                                    {(data.momentum?.recentBadges || []).length > 0 && (
                                        <section>
                                            <h4 className="text-[10px] uppercase tracking-[0.22em] text-muted font-bold mb-2.5">
                                                {tAchievements('dossier.recent')}
                                            </h4>
                                            <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                                                {data.momentum.recentBadges.map((badge: any) => (
                                                    <button
                                                        key={`${badge.id}-${badge.earnedAt}`}
                                                        type="button"
                                                        onClick={() => onOpenBadge?.(String(badge.id))}
                                                        className="shrink-0 w-[7.5rem] rounded-xl border border-white/10 bg-black/25 px-2.5 py-2.5 text-left hover:border-plex/35"
                                                    >
                                                        <span className="text-xl">{badge.icon || '🏅'}</span>
                                                        <p className="text-xs font-bold truncate mt-1">{badge.name}</p>
                                                        <p className="text-[10px] text-muted font-mono mt-0.5">
                                                            {badge.earnedAt ? new Date(badge.earnedAt).toLocaleDateString() : ''}
                                                        </p>
                                                    </button>
                                                ))}
                                            </div>
                                        </section>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </ModalPortal>
    );
};
