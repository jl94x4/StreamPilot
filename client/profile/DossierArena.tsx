import React, { useMemo } from 'react';
import {
    Crosshair, Flag, Flame, Shield, Swords, Target, Zap,
} from 'lucide-react';
import { DashboardPanel } from '../shared/dashboard/DashboardChrome';
import { useAchievementsI18n, tAchievements as tAchievementsStatic } from '../achievements/i18n';
import { badgeBarPercent } from '../achievements/badgeFamilies';
import { useDiscoverI18n } from '../discovery/i18n';
import { goToProfile } from './helpers';

const formatXpLabel = (key: string, translate = tAchievementsStatic) => {
    const mapped = translate(`xp.source.${key}`);
    return mapped.startsWith('xp.source.') ? key : mapped;
};

type Peer = {
    accountId?: string | number | null;
    username?: string;
    rank?: number;
    xpGap?: number;
    recentBadges14d?: number;
};

type Props = {
    achievements: any;
    onNavigate: (route: string, options?: { path?: string }) => void;
    onOpenBadge?: (badgeId: string) => void;
};

const PeerCard: React.FC<{
    peer: Peer | null | undefined;
    label: string;
    gapKey: string;
    empty: React.ReactNode;
    onNavigate: Props['onNavigate'];
    accent?: boolean;
}> = ({ peer, label, gapKey, empty, onNavigate, accent }) => {
    const { tAchievements } = useAchievementsI18n();
    if (!peer) return <>{empty}</>;
    const className = `rounded-xl px-3 py-2.5 text-left w-full transition-colors ${
        accent
            ? 'border border-plex/25 bg-plex/10 hover:border-plex/50'
            : 'border border-white/10 bg-white/[0.03] hover:border-plex/35'
    }`;
    const body = (
        <>
            <p className={`text-[10px] uppercase tracking-wide font-bold ${accent ? 'text-plex' : 'text-muted'}`}>{label}</p>
            <p className="text-sm font-bold text-text mt-0.5 truncate">
                #{peer.rank} {peer.username}
            </p>
            <p className="text-xs text-muted mt-1 font-mono">
                {tAchievements(gapKey, { xp: Number(peer.xpGap || 0).toLocaleString() })}
            </p>
        </>
    );
    if (peer.accountId) {
        return (
            <button type="button" className={className} onClick={() => goToProfile(onNavigate, peer.accountId)}>
                {body}
            </button>
        );
    }
    return <div className={className}>{body}</div>;
};

export const DossierArena: React.FC<Props> = ({ achievements, onNavigate, onOpenBadge }) => {
    const { t } = useDiscoverI18n();
    const { tAchievements } = useAchievementsI18n();
    const rivals = achievements?.rivals || {};
    const lastBadge = achievements?.lastBadge;
    const firstUnlocks = achievements?.firstUnlocks;
    const signature = achievements?.signature;
    const threat = achievements?.threat;
    const closest = Array.isArray(achievements?.closest) ? achievements.closest : [];
    const momentum = achievements?.momentum;
    const rarityBars = useMemo(() => {
        const rb = achievements?.rarityBreakdown || {};
        const total = Math.max(1, Object.values(rb).reduce((sum: number, n: any) => sum + (Number(n) || 0), 0) as number);
        return (['legendary', 'epic', 'rare', 'common'] as const).map((key) => ({
            key,
            count: Number(rb[key]) || 0,
            pct: Math.round(((Number(rb[key]) || 0) / total) * 100),
        }));
    }, [achievements?.rarityBreakdown]);

    const hasArena = !!(
        rivals.above
        || rivals.below
        || lastBadge
        || Number(firstUnlocks?.count) > 0
        || signature
        || threat
        || closest.length
        || Number(momentum?.badgesLast7d) > 0
        || Number(momentum?.badgesLast30d) > 0
        || rarityBars.some((row) => row.count > 0)
    );
    if (!hasArena) return null;

    return (
        <DashboardPanel title={t('profilePage.arena')} subtitle={t('profilePage.arenaHint')}>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className="rounded-2xl border border-white/10 bg-black/25 p-4 space-y-3">
                    <p className="text-[10px] uppercase tracking-[0.22em] text-muted font-bold flex items-center gap-1.5">
                        <Swords className="w-3.5 h-3.5 text-plex" />
                        {tAchievements('dossier.rivalArena')}
                    </p>
                    <PeerCard
                        peer={rivals.above}
                        label={tAchievements('dossier.hunt')}
                        gapKey="dossier.xpGapAhead"
                        onNavigate={onNavigate}
                        accent
                        empty={(
                            <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-100 font-semibold flex items-center gap-2">
                                <Shield className="w-4 h-4" />
                                {tAchievements('dossier.holdingCrown')}
                            </div>
                        )}
                    />
                    <PeerCard
                        peer={rivals.below}
                        label={tAchievements('dossier.defend')}
                        gapKey="dossier.xpGapBehind"
                        onNavigate={onNavigate}
                        empty={<p className="text-xs text-muted">{tAchievements('dossier.noHunter')}</p>}
                    />
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/25 p-4 space-y-3">
                    <p className="text-[10px] uppercase tracking-[0.22em] text-muted font-bold flex items-center gap-1.5">
                        <Flag className="w-3.5 h-3.5 text-plex" />
                        {tAchievements('dossier.lastBadge')}
                    </p>
                    {lastBadge ? (
                        <button
                            type="button"
                            onClick={() => lastBadge.id && onOpenBadge?.(String(lastBadge.id))}
                            className="w-full text-left rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 hover:border-plex/35"
                        >
                            <p className="text-lg leading-none">{lastBadge.icon || '🏅'}</p>
                            <p className="mt-1.5 text-sm font-bold text-text truncate">{lastBadge.name}</p>
                            <p className="text-[10px] uppercase tracking-widest text-muted mt-0.5">{lastBadge.rarity}</p>
                        </button>
                    ) : (
                        <p className="text-sm text-muted">{tAchievements('dossier.noBadges')}</p>
                    )}
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                        <p className="text-[10px] uppercase tracking-wide text-muted font-bold">
                            {tAchievements('dossier.firstBlood')}
                        </p>
                        <p className="mt-1 text-xl font-black text-text">{Number(firstUnlocks?.count) || 0}</p>
                        <p className="text-[11px] text-muted mt-0.5">{tAchievements('dossier.firstBloodHint')}</p>
                    </div>
                    {(Number(momentum?.badgesLast7d) > 0 || Number(momentum?.badgesLast30d) > 0) ? (
                        <p className="text-[11px] text-muted flex items-center gap-1.5">
                            <Flame className="w-3.5 h-3.5 text-plex" />
                            {tAchievements('dossier.momentum', {
                                week: Number(momentum?.badgesLast7d) || 0,
                                month: Number(momentum?.badgesLast30d) || 0,
                            })}
                        </p>
                    ) : null}
                </div>

                <div className="rounded-2xl border border-rose-400/25 bg-gradient-to-br from-rose-500/10 to-black/30 p-4 space-y-3">
                    <p className="text-[10px] uppercase tracking-[0.22em] text-rose-100/80 font-bold flex items-center gap-1.5">
                        <Crosshair className="w-3.5 h-3.5" />
                        {tAchievements('dossier.threat')}
                    </p>
                    {threat ? (
                        threat.accountId ? (
                            <button
                                type="button"
                                onClick={() => goToProfile(onNavigate, threat.accountId)}
                                className="w-full text-left"
                            >
                                <p className="text-lg font-black text-text truncate hover:text-plex">
                                    #{threat.rank} {threat.username}
                                </p>
                                <p className="text-sm text-muted leading-relaxed mt-1">
                                    {tAchievements('dossier.threatBlurb', {
                                        xp: Number(threat.xpGap || 0).toLocaleString(),
                                        n: Number(threat.recentBadges14d) || 0,
                                    })}
                                </p>
                            </button>
                        ) : (
                            <>
                                <p className="text-lg font-black text-text truncate">
                                    #{threat.rank} {threat.username}
                                </p>
                                <p className="text-sm text-muted leading-relaxed">
                                    {tAchievements('dossier.threatBlurb', {
                                        xp: Number(threat.xpGap || 0).toLocaleString(),
                                        n: Number(threat.recentBadges14d) || 0,
                                    })}
                                </p>
                            </>
                        )
                    ) : (
                        <p className="text-sm text-muted">{tAchievements('dossier.threatNone')}</p>
                    )}
                    {signature ? (
                        <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5">
                            <p className="text-[10px] uppercase tracking-wide text-muted font-bold flex items-center gap-1.5">
                                <Zap className="w-3.5 h-3.5 text-plex" />
                                {tAchievements('dossier.signature')}
                            </p>
                            <p className="text-sm font-bold text-text mt-1">
                                {formatXpLabel(String(signature.label || signature.key), tAchievements)}
                            </p>
                            <p className="text-xs font-mono text-plex mt-0.5">
                                {Number(signature.value || 0).toLocaleString()}
                                {signature.kind === 'xp' ? ' XP' : ''}
                            </p>
                        </div>
                    ) : null}
                </div>
            </div>

            {rarityBars.some((row) => row.count > 0) ? (
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
            ) : null}

            {closest.length ? (
                <div className="mt-4">
                    <h4 className="text-[10px] uppercase tracking-[0.22em] text-muted font-bold mb-2.5 flex items-center gap-1.5">
                        <Target className="w-3.5 h-3.5 text-plex" />
                        {tAchievements('dossier.closest')}
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {closest.slice(0, 4).map((badge: any) => (
                            <button
                                key={badge.id}
                                type="button"
                                onClick={() => onOpenBadge?.(String(badge.id))}
                                className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-left hover:border-plex/35 transition-colors"
                            >
                                <div className="flex items-start gap-2.5">
                                    <span className="text-xl leading-none">{badge.icon || '🎯'}</span>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-bold text-text truncate">{badge.name}</p>
                                        <p className="text-[11px] text-muted mt-0.5">
                                            {Math.round(badgeBarPercent(badge))}%
                                        </p>
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}
        </DashboardPanel>
    );
};

export default DossierArena;
