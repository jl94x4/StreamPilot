import React, { useEffect, useState } from 'react';
import { Pin, PinOff, X, Lock, Calendar, Trophy, Flag } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { logoUrl, portalUrl, resolvePortalAssetUrl } from '../shared/basePath';
import { ModalPortal } from '../shared/ModalPortal';
import { tAchievements, useAchievementsI18n } from './i18n';
import { badgeBarPercent } from './badgeFamilies';

const rarityClass = (rarity: string) => {
    // Border + text only — never set translucent bg on the panel itself.
    if (rarity === 'legendary') return 'border-amber-400/60 text-amber-100';
    if (rarity === 'epic') return 'border-fuchsia-400/50 text-fuchsia-100';
    if (rarity === 'rare') return 'border-sky-400/50 text-sky-100';
    return 'border-white/10 text-text';
};

/** Soft rarity tint that fades into the same opaque card color (not CSS transparent). */
const rarityWashStyle = (rarity: string): React.CSSProperties => {
    const base = 'rgb(var(--color-card))';
    if (rarity === 'legendary') {
        return { backgroundImage: `linear-gradient(180deg, rgba(245,158,11,0.22) 0%, ${base} 45%)` };
    }
    if (rarity === 'epic') {
        return { backgroundImage: `linear-gradient(180deg, rgba(217,70,239,0.20) 0%, ${base} 45%)` };
    }
    if (rarity === 'rare') {
        return { backgroundImage: `linear-gradient(180deg, rgba(56,189,248,0.18) 0%, ${base} 45%)` };
    }
    return {};
};

const PANEL_SOLID_BG = 'rgb(var(--color-card))';
const PANEL_SOLID_FALLBACK = '#12141a';

const resolveAvatar = (thumb: string | null | undefined) => {
    if (!thumb) return logoUrl();
    if (thumb.startsWith('http://') || thumb.startsWith('https://') || thumb.startsWith('/api/')) {
        return resolvePortalAssetUrl(thumb);
    }
    return portalUrl(`/api/plex/image?path=${encodeURIComponent(thumb)}&width=64&height=64`);
};

type Props = {
    badgeId: string | null;
    localBadge?: any;
    pinnedIds: string[];
    onClose: () => void;
    onTogglePin?: (badgeId: string) => void;
    pinBusy?: boolean;
};

export const BadgeDetailDrawer: React.FC<Props> = ({
    badgeId,
    localBadge,
    pinnedIds,
    onClose,
    onTogglePin,
    pinBusy,
}) => {
    const { tAchievements } = useAchievementsI18n();
    const [detail, setDetail] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!badgeId) {
            setDetail(null);
            setError(null);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        apiFetch(`/api/achievements/badge/${encodeURIComponent(badgeId)}`)
            .then((data) => {
                if (!cancelled) setDetail(data);
            })
            .catch((e: any) => {
                if (!cancelled) {
                    setDetail(null);
                    setError(e?.message || tAchievements('drawer.error'));
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [badgeId]);

    if (!badgeId) return null;

    const badge = detail || localBadge || { id: badgeId };
    const earned = detail?.you?.earned ?? !!localBadge?.earned;
    const earnedAt = detail?.you?.earnedAt || localBadge?.earnedAt || null;
    const progress = detail?.you?.progress ?? localBadge?.progress ?? 0;
    const progressPct = detail?.you?.progressPct ?? localBadge?.progressPct ?? 0;
    const threshold = detail?.threshold ?? localBadge?.threshold ?? 0;
    const pinned = pinnedIds.includes(String(badgeId));
    const unlockCount = Number(detail?.unlockCount) || 0;
    const totalUsers = Math.max(1, Number(detail?.totalUsers) || 1);
    const rarityPct = Math.round((unlockCount / totalUsers) * 100);

    return (
        <ModalPortal open={true}>
            <div className="fixed inset-x-0 top-0 z-[340] flex items-end sm:items-center justify-center p-0 sm:p-5 bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] sm:inset-0 sm:bottom-0">
                <button type="button" className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" aria-label={tAchievements('common.close')} onClick={onClose} />
                <div
                    className={`relative isolate w-full sm:max-w-lg max-h-[min(92vh,100%)] flex flex-col rounded-t-3xl sm:rounded-3xl border overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.55)] ${rarityClass(badge.rarity || 'common')}`}
                    style={{ backgroundColor: PANEL_SOLID_FALLBACK }}
                >
                    {/* Opaque fill first — never use -z so layers stay inside the panel */}
                    <div
                        className="absolute inset-0"
                        style={{ backgroundColor: PANEL_SOLID_BG }}
                        aria-hidden
                    />
                    <div
                        className="pointer-events-none absolute inset-0"
                        style={rarityWashStyle(badge.rarity || 'common')}
                        aria-hidden
                    />
                    <div className="relative z-[1] flex min-h-0 flex-1 flex-col">
                    <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-white/8 shrink-0">
                        <div className="flex items-start gap-3 min-w-0">
                            <span className="text-4xl leading-none">{badge.icon || '🏅'}</span>
                            <div className="min-w-0">
                                <p className="text-[10px] uppercase tracking-[0.22em] text-muted font-bold mb-1">
                                    {(badge.rarity || 'common').toString()}
                                </p>
                                <h3 className="text-xl font-black text-text truncate">{badge.name || badgeId}</h3>
                                <p className="text-sm text-muted mt-1 leading-relaxed">{badge.description}</p>
                            </div>
                        </div>
                        <button type="button" onClick={onClose} aria-label={tAchievements('common.close')} className="p-2 rounded-xl text-muted hover:text-text hover:bg-white/5 shrink-0">
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-5">
                        {loading && <p className="text-sm text-muted">{tAchievements('drawer.loading')}</p>}
                        {error && <p className="text-sm text-red-300">{error}</p>}

                        <div>
                            <div className="flex items-center justify-between gap-2 text-xs mb-2">
                                <span className="text-muted font-semibold">
                                    {earned ? tAchievements('badge.earned') : tAchievements('drawer.progress')}
                                </span>
                                <span className="font-mono tabular-nums text-text">
                                    {earned ? '100%' : `${progress} / ${threshold}`}
                                </span>
                            </div>
                            <div className="h-2.5 rounded-full bg-black/45 overflow-hidden border border-white/5">
                                <div
                                    className={`h-full rounded-full ${earned ? 'bg-plex' : 'bg-white/30'}`}
                                    style={{
                                        width: `${badgeBarPercent({
                                            earned,
                                            progress,
                                            progressPct,
                                            threshold,
                                        })}%`,
                                    }}
                                />
                            </div>
                            {earned && earnedAt && (
                                <p className="mt-2 text-[11px] text-muted flex items-center gap-1.5">
                                    <Calendar className="w-3.5 h-3.5" />
                                    {tAchievements('drawer.earnedAt', { date: new Date(earnedAt).toLocaleString() })}
                                </p>
                            )}
                            {!earned && (
                                <p className="mt-2 text-[11px] text-muted flex items-center gap-1.5">
                                    <Lock className="w-3.5 h-3.5" />
                                    {tAchievements('drawer.locked')}
                                </p>
                            )}
                        </div>

                        <div className="rounded-xl border border-white/10 bg-black/25 px-3.5 py-3">
                            <p className="text-[10px] uppercase tracking-widest font-bold text-muted mb-1">
                                {tAchievements('drawer.rarity')}
                            </p>
                            <p className="text-sm text-text font-semibold">
                                {tAchievements('drawer.holders', { count: unlockCount, pct: rarityPct })}
                            </p>
                        </div>

                        {Array.isArray(detail?.seasons) && detail.seasons.length > 0 && (
                            <div className="rounded-xl border border-white/10 bg-black/25 px-3.5 py-3 space-y-1">
                                <p className="text-[10px] uppercase tracking-widest font-bold text-muted">
                                    {tAchievements('drawer.seasons')}
                                </p>
                                {detail.seasons.map((s: any) => (
                                    <p key={s.id} className="text-xs text-text">
                                        {s.name}
                                        {s.activeFrom || s.activeUntil
                                            ? ` · ${s.activeFrom || '…'} → ${s.activeUntil || '…'}`
                                            : ''}
                                    </p>
                                ))}
                            </div>
                        )}

                        <div>
                            <p className="text-[10px] uppercase tracking-widest font-bold text-muted mb-2 flex items-center gap-1.5">
                                <Flag className="w-3.5 h-3.5 text-plex" />
                                {tAchievements('drawer.rivals')}
                            </p>
                            {(() => {
                                const first = (detail?.earliestHolders || [])[0] || null;
                                if (loading && !first) {
                                    return <p className="text-sm text-muted">{tAchievements('drawer.loading')}</p>;
                                }
                                if (!first) {
                                    return <p className="text-xs text-muted">{tAchievements('drawer.noHolders')}</p>;
                                }
                                return (
                                    <div className="rounded-xl border border-amber-400/30 bg-gradient-to-br from-amber-500/15 to-black/30 px-3 py-3 flex items-center gap-3">
                                        <div className="relative shrink-0">
                                            <img
                                                src={resolveAvatar(first.thumb)}
                                                alt=""
                                                className="w-12 h-12 rounded-full object-cover border border-amber-400/40 bg-black/40"
                                                onError={(e) => { (e.target as HTMLImageElement).src = logoUrl(); }}
                                            />
                                            <span className="absolute -bottom-1 -right-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-400 text-black shadow">
                                                <Trophy className="w-3 h-3" />
                                            </span>
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-amber-200/80">
                                                {tAchievements('drawer.firstUnlocker')}
                                            </p>
                                            <p className="text-sm font-black text-text truncate mt-0.5">{first.username}</p>
                                            <p className="text-[11px] text-muted font-mono mt-0.5 truncate">
                                                {tAchievements('common.levelShort', { level: first.level })}
                                                {first.earnedAt
                                                    ? ` · ${new Date(first.earnedAt).toLocaleString()}`
                                                    : ''}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>

                    {onTogglePin ? (
                    <div className="shrink-0 border-t border-white/8 px-5 py-3 flex items-center gap-2">
                        <button
                            type="button"
                            disabled={pinBusy || (!earned && pinnedIds.length >= 3 && !pinned)}
                            onClick={() => onTogglePin(String(badgeId))}
                            className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-border bg-white/5 text-sm font-semibold hover:border-plex/40 disabled:opacity-50"
                        >
                            {pinned
                                ? <><PinOff className="w-4 h-4" /> {tAchievements('drawer.unpin')}</>
                                : <><Pin className="w-4 h-4 text-plex" /> {tAchievements('drawer.pin')}</>}
                        </button>
                    </div>
                    ) : null}
                    </div>
                </div>
            </div>
        </ModalPortal>
    );
};
