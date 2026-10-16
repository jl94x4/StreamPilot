import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Film, Loader2 } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { ModalPortal } from '../shared/ModalPortal';
import { NoPosterPlaceholder } from '../shared/NoPosterPlaceholder';
import { useDiscoverI18n, translateDiscoverStatus } from './i18n';
import { resolveTmdbImageUrl } from './tmdbImageUrl';

type SeasonEpisode = {
    id: number;
    airDate?: string | null;
    episodeNumber?: number;
    name?: string;
    overview?: string;
    seasonNumber?: number;
    stillPath?: string | null;
    voteAverage?: number;
};

type SeasonPayload = {
    name?: string;
    overview?: string;
    seasonNumber?: number;
    posterPath?: string | null;
    episodes?: SeasonEpisode[];
};

type Props = {
    open: boolean;
    mediaId: number;
    showTitle: string;
    showYear?: string;
    showPosterPath?: string | null;
    seasonNumber: number;
    seasonName: string;
    episodeCount?: number;
    statusLabel?: string;
    onClose: () => void;
};

const formatAirDate = (value?: string | null, locale = 'en') => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
};

const episodeCode = (seasonNumber?: number, episodeNumber?: number) => {
    if (seasonNumber == null || episodeNumber == null) return null;
    return `S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`;
};

const formatSeasonName = (
    name: string | undefined,
    seasonNumber: number,
    t: ReturnType<typeof useDiscoverI18n>['t'],
) => {
    const raw = String(name || '').trim();
    if (raw === 'Specials') return t('common.specials');
    const seasonMatch = raw.match(/^Season\s+(\d+)$/i);
    if (seasonMatch) return t('common.seasonN', { number: seasonMatch[1] });
    return raw || t('common.seasonN', { number: seasonNumber });
};

export const SeasonEpisodesModal: React.FC<Props> = ({
    open,
    mediaId,
    showTitle,
    showYear,
    showPosterPath,
    seasonNumber,
    seasonName,
    episodeCount,
    statusLabel,
    onClose,
}) => {
    const { t, locale } = useDiscoverI18n();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [season, setSeason] = useState<SeasonPayload | null>(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onCloseRef.current();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    useEffect(() => {
        if (!open || !mediaId || !Number.isFinite(seasonNumber)) {
            setSeason(null);
            setError(null);
            setLoading(false);
            return;
        }

        let cancelled = false;
        setLoading(true);
        setError(null);
        setSeason(null);

        (async () => {
            try {
                const data = await apiFetch(`/api/discovery/proxy/tv/${mediaId}/season/${seasonNumber}`);
                if (cancelled) return;
                if (data?.error) throw new Error(data.error);
                setSeason(data as SeasonPayload);
            } catch (err: any) {
                if (cancelled) return;
                setError(err?.message || t('episodes.loadFailed'));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [open, mediaId, seasonNumber, locale]);

    const episodes = Array.isArray(season?.episodes) ? season.episodes : [];
    const headerPoster = season?.posterPath || showPosterPath;
    const headerPosterUrl = resolveTmdbImageUrl(headerPoster, 'w185');
    const displaySeasonName = formatSeasonName(season?.name || seasonName, seasonNumber, t);
    const totalEpisodes = episodes.length || episodeCount || 0;

    return (
        <ModalPortal open={open}>
            <div className="fixed inset-x-0 top-0 z-[340] flex min-h-0 items-stretch justify-center p-0 sm:items-center sm:p-6 md:p-12 bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] sm:inset-0">
                <button
                    type="button"
                    aria-label={t('episodes.closeAria')}
                    className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                    onClick={onClose}
                />
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="season-episodes-modal-title"
                    className="relative w-full max-w-5xl h-full min-h-0 sm:h-[90vh] bg-card border-none sm:border border-border/80 shadow-2xl flex flex-col overflow-hidden rounded-none sm:rounded-2xl mx-auto"
                >
                    <div className="px-4 sm:px-5 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] pb-4 sm:pt-4 border-b border-border/60 space-y-4 shrink-0">
                        <button
                            type="button"
                            onClick={onClose}
                            className="inline-flex items-center gap-1.5 min-h-11 px-2 py-2 -ml-2 rounded-lg hover:bg-white/10 text-muted hover:text-text text-sm font-bold transition-colors"
                        >
                            <ChevronLeft className="w-4 h-4" />
                            {t('episodes.backToShow')}
                        </button>

                        <div className="flex items-start gap-4">
                            <div className="w-16 h-24 rounded-lg overflow-hidden bg-white/5 shrink-0 border border-white/10">
                                {headerPosterUrl ? (
                                    <img src={headerPosterUrl} alt="" className="w-full h-full object-cover" />
                                ) : (
                                    <NoPosterPlaceholder compact />
                                )}
                            </div>
                            <div className="min-w-0 flex-1">
                                <h3 id="season-episodes-modal-title" className="text-lg font-bold text-text">
                                    {showTitle}
                                </h3>
                                <p className="text-xs text-muted mt-1">
                                    {displaySeasonName}
                                    {showYear ? ` · ${showYear}` : ''}
                                    {totalEpisodes > 0 ? ` · ${t('common.episodeCount', { count: totalEpisodes })}` : ''}
                                </p>
                                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                                    <span className="px-2 py-1 rounded-full bg-white/5 border border-white/10 text-muted font-semibold">
                                        {displaySeasonName}
                                    </span>
                                    {statusLabel ? (
                                        <span className="px-2 py-1 rounded-full bg-green-500/10 border border-green-500/30 text-green-200 font-semibold">
                                            {translateDiscoverStatus(t, statusLabel)}
                                        </span>
                                    ) : null}
                                </div>
                                {loading ? (
                                    <p className="text-[11px] text-muted mt-2 flex items-center gap-1.5">
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        {t('episodes.loading')}
                                    </p>
                                ) : null}
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto min-h-0">
                        {error ? (
                            <div className="p-8 text-center text-sm text-red-300">{error}</div>
                        ) : loading ? (
                            <div className="p-12 flex items-center justify-center">
                                <Loader2 className="w-7 h-7 text-plex animate-spin" />
                            </div>
                        ) : !episodes.length ? (
                            <div className="p-8 text-center text-sm text-muted">{t('episodes.empty')}</div>
                        ) : (
                            <div className="divide-y divide-border/40">
                                {episodes.map((episode) => {
                                    const code = episodeCode(episode.seasonNumber ?? seasonNumber, episode.episodeNumber);
                                    const airDate = formatAirDate(episode.airDate, locale);
                                    const stillUrl = episode.stillPath
                                        ? `https://image.tmdb.org/t/p/w300${episode.stillPath}`
                                        : '';
                                    return (
                                        <div
                                            key={episode.id}
                                            className="group flex flex-col sm:flex-row items-start gap-4 p-4 sm:p-5 hover:bg-white/[0.02] transition-colors"
                                        >
                                            <div className={`rounded-xl overflow-hidden bg-white/5 shrink-0 flex items-center justify-center relative ${
                                                stillUrl
                                                    ? 'w-full sm:w-48 aspect-video shadow-lg'
                                                    : 'hidden sm:flex sm:w-48 sm:aspect-video'
                                            }`}>
                                                {stillUrl ? (
                                                    <img
                                                        src={stillUrl}
                                                        alt=""
                                                        className="w-full h-full object-cover bg-black/40"
                                                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                                    />
                                                ) : (
                                                    <span className="text-xs text-muted/40 font-medium inline-flex items-center gap-1.5">
                                                        <Film className="w-4 h-4" />
                                                        {t('episodes.noImage')}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="min-w-0 flex-1 flex flex-col justify-center">
                                                <div className="flex flex-wrap items-center gap-3">
                                                    {code ? (
                                                        <span className="text-xs font-bold px-2 py-1 rounded-md bg-white/10 text-text shadow-sm">
                                                            {code}
                                                        </span>
                                                    ) : null}
                                                    <h4 className="text-base font-bold text-text truncate group-hover:text-plex transition-colors">
                                                        {episode.name || t('common.episodeN', { number: episode.episodeNumber ?? '' })}
                                                    </h4>
                                                    {airDate ? (
                                                        <span className="text-xs text-muted ml-auto shrink-0 font-medium">
                                                            {airDate}
                                                        </span>
                                                    ) : null}
                                                </div>
                                                {episode.overview ? (
                                                    <p className="text-sm text-muted/90 mt-2 leading-relaxed line-clamp-4">
                                                        {episode.overview}
                                                    </p>
                                                ) : (
                                                    <p className="text-sm text-muted/50 mt-2 italic">{t('episodes.noSynopsis')}</p>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </ModalPortal>
    );
};
