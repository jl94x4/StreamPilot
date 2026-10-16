import React from 'react';
import { Pause, Play } from 'lucide-react';
import type { NowPlayingOther, NowPlayingSession } from '../shared/useNowPlaying';
import { goToProfile } from '../profile/helpers';
import { useDiscoverI18n } from './i18n';

type Props = {
    session: NowPlayingSession;
    others?: NowPlayingOther[];
    onNavigate?: (path: string) => void;
    onOpenProfile?: (accountId: string) => void;
    /** Extra classes on the outer absolute wrapper. */
    className?: string;
};

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Trakt-style thin green Now Playing bar.
 * The full strip width is the item runtime; the brighter fill is watch progress.
 */
export const DiscoverNowPlayingStrip: React.FC<Props> = ({ session, others = [], onNavigate, onOpenProfile, className = '' }) => {
    const { t } = useDiscoverI18n();
    const hasTmdb = Number.isFinite(Number(session.tmdbId)) && Number(session.tmdbId) > 0;
    const basePath = hasTmdb
        ? `/discovery/${session.mediaType}/${session.tmdbId}`
        : null;
    const season = Number(session.season);
    const episode = Number(session.episode);
    const hasSeason = session.mediaType === 'tv' && Number.isFinite(season) && season > 0;
    const hasEpisode = hasSeason && Number.isFinite(episode) && episode > 0;
    const paused = String(session.state || '').toLowerCase() === 'paused';
    const progress = Math.min(100, Math.max(0, Number(session.progress) || 0));

    const goShow = (event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (basePath && onNavigate) onNavigate(basePath);
    };

    const goSeason = (event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (basePath && hasSeason && onNavigate) onNavigate(`${basePath}?season=${season}`);
    };

    const goEpisode = (event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (basePath && hasSeason && onNavigate) {
            const qs = new URLSearchParams({ season: String(season) });
            if (hasEpisode) qs.set('episode', String(episode));
            onNavigate(`${basePath}?${qs.toString()}`);
        }
    };

    const linkClass = basePath && onNavigate
        ? 'font-semibold text-white hover:underline underline-offset-2 decoration-white/80'
        : 'font-semibold text-white';

    return (
        <div
            className={`absolute bottom-0 inset-x-0 z-20 rounded-b-2xl overflow-hidden ${className}`.trim()}
            role="status"
            aria-live="polite"
            aria-label={`${paused ? t('nowPlaying.paused') : t('nowPlaying.watching')}: ${session.title}${hasSeason ? `, ${t('nowPlaying.season', { number: season })}` : ''}${hasEpisode ? `, ${t('nowPlaying.episode', { number: episode })}` : ''}, ${Math.round(progress)}%`}
        >
            <div className="relative h-full min-h-[2rem] sm:min-h-[2.25rem] bg-emerald-950/90 text-white">
                {/* Full-strip progress: width = % through the item */}
                <div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500 to-emerald-400 transition-[width] duration-500 ease-out"
                    style={{ width: `${progress}%` }}
                    aria-hidden
                />
                <div
                    className="absolute inset-y-0 right-0 bg-emerald-950/50"
                    style={{ left: `${progress}%` }}
                    aria-hidden
                />
                <div className="relative flex items-center justify-center gap-x-1.5 gap-y-0.5 flex-wrap px-3 sm:px-4 py-1.5 sm:py-2 text-[11px] sm:text-xs text-center min-h-[2rem] sm:min-h-[2.25rem]">
                    <span className="inline-flex items-center gap-1 shrink-0 font-bold uppercase tracking-wider text-white drop-shadow-sm">
                        {paused ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 fill-current" />}
                        {paused ? t('nowPlaying.paused') : t('nowPlaying.watching')}
                    </span>
                    <span className="text-white/70 shrink-0">·</span>
                    <button type="button" className={`${linkClass} truncate max-w-[min(100%,18rem)] drop-shadow-sm`} onClick={goShow}>
                        {session.title}
                    </button>
                    {hasSeason && (
                        <>
                            <span className="text-white/70">·</span>
                            <button type="button" className={`${linkClass} drop-shadow-sm`} onClick={goSeason}>
                                {t('nowPlaying.season', { number: season })}
                            </button>
                        </>
                    )}
                    {hasEpisode && (
                        <>
                            <span className="text-white/70">·</span>
                            <button type="button" className={`${linkClass} drop-shadow-sm`} onClick={goEpisode}>
                                {t('nowPlaying.episode', { number: episode })}
                                {session.episodeTitle ? (
                                    <span className="font-normal text-white/90">
                                        {` — ${session.episodeTitle}`}
                                    </span>
                                ) : null}
                            </button>
                        </>
                    )}
                    {hasSeason && hasEpisode && (
                        <span className="hidden sm:inline shrink-0 font-mono text-white/90 tabular-nums drop-shadow-sm">
                            {`· S${pad(season)}E${pad(episode)}`}
                        </span>
                    )}
                    <span className="hidden md:inline shrink-0 font-mono text-white/80 tabular-nums drop-shadow-sm">
                        {`· ${Math.round(progress)}%`}
                    </span>
                    {others.length ? (
                        <>
                            <span className="text-white/70 shrink-0">·</span>
                            <span className="text-white/85 drop-shadow-sm">
                                {t('nowPlaying.with')}
                                {' '}
                                {others.map((peer, index) => {
                                    const canOpen = !!peer.accountId && peer.username.toLowerCase() !== 'anonymous';
                                    const open = (event: React.MouseEvent) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        if (!canOpen || !peer.accountId) return;
                                        if (onOpenProfile) onOpenProfile(peer.accountId);
                                        else goToProfile(undefined, peer.accountId, peer.username);
                                    };
                                    return (
                                        <span key={`${peer.accountId || peer.username}-${index}`}>
                                            {index > 0 ? ', ' : ''}
                                            {canOpen ? (
                                                <button type="button" className={linkClass} onClick={open}>
                                                    {peer.username}
                                                </button>
                                            ) : (
                                                <span>{peer.username}</span>
                                            )}
                                        </span>
                                    );
                                })}
                            </span>
                        </>
                    ) : null}
                </div>
            </div>
        </div>
    );
};

export default DiscoverNowPlayingStrip;
