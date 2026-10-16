import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { ChevronLeft, ChevronRight, Loader2, Sparkles, X } from 'lucide-react';
import { useDiscoverI18n } from '../discovery/i18n';
import { WRAP_UP_RECAP_PERIODS } from './analyticsPeriodOptions';
import { resolvePortalAssetUrl } from './basePath';
import { formatWrapUpDelta, periodLabel, wrapUpPriorPeriodLabel } from './WrapUpCards';
import { lockBackgroundScroll } from './lockBackgroundScroll';

type Slide = {
    key: string;
    kicker: string;
    title: string;
    body?: string;
    extra?: string[];
    art?: string[];
    poster?: string;
};

const FALLBACK_ART = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&q=80&w=1200';

const posterOf = (item: any): string => resolvePortalAssetUrl(item?.artUrl || item?.thumbUrl) || '';

const collectArtwork = (analytics: any): string[] => {
    const seen = new Set<string>();
    const urls: string[] = [];
    const push = (item: any) => {
        const url = posterOf(item);
        if (!url || seen.has(url)) return;
        seen.add(url);
        urls.push(url);
    };
    push(analytics?.topBinge);
    push(analytics?.topMovie);
    (analytics?.topShows || []).forEach(push);
    (analytics?.topMovies || []).forEach(push);
    (analytics?.recentHistory || []).forEach(push);
    return urls;
};

const RecapBackdrop: React.FC<{ art?: string[]; poster?: string }> = ({ art = [], poster }) => {
    const hero = poster || art[0] || FALLBACK_ART;
    const tiles = (art.length ? art : [hero]).slice(0, 6);
    return (
        <div className="absolute inset-0 overflow-hidden">
            {tiles.length >= 4 ? (
                <div className="absolute inset-0 grid grid-cols-3 grid-rows-2">
                    {tiles.slice(0, 6).map((src) => (
                        <img key={src} src={src} alt="" className="w-full h-full object-cover" />
                    ))}
                </div>
            ) : (
                <img src={hero} alt="" className="absolute inset-0 w-full h-full object-cover scale-105" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/25" />
            <div className="absolute inset-0 bg-gradient-to-br from-plex/20 via-transparent to-black/40" />
        </div>
    );
};

export const WrapUpRecapModal: React.FC<{
    analytics: any;
    days: number | string;
    loading?: boolean;
    onClose: () => void;
    onDaysChange?: (days: number) => void;
}> = ({ analytics, days, loading = false, onClose, onDaysChange }) => {
    const { t } = useDiscoverI18n();
    const [index, setIndex] = useState(0);
    const artwork = useMemo(() => collectArtwork(analytics), [analytics]);

    useEffect(() => lockBackgroundScroll(), []);
    useEffect(() => { setIndex(0); }, [days]);

    const slides = useMemo<Slide[]>(() => {
        const compare = analytics?.compare || {};
        const highlights = compare.highlights || {};
        const period = periodLabel(days, t);
        const prior = wrapUpPriorPeriodLabel(compare.previousPeriodDays || days, t);
        const delta = formatWrapUpDelta(compare.totalPlays, t);
        const bingeArt = posterOf(analytics?.topBinge);
        const movieArt = posterOf(analytics?.topMovie);
        const list: Slide[] = [{
            key: 'intro',
            kicker: period,
            title: t('wrapUp.title'),
            body: delta
                ? t('wrapUp.vsPrior', { delta, period: prior })
                : `${analytics?.totalPlays || 0} ${t('wrapUp.totalStreams').toLowerCase()}`,
            art: artwork,
        }];

        if (delta || Number(analytics?.totalPlays) > 0) {
            list.push({
                key: 'streams',
                kicker: t('wrapUp.recapStreams'),
                title: String(analytics?.totalPlays || 0),
                body: delta ? t('wrapUp.vsPrior', { delta, period: prior }) : t('wrapUp.totalStreams'),
                art: artwork,
            });
        }

        if (analytics?.topBinge?.title) {
            list.push({
                key: 'binge',
                kicker: t('wrapUp.recapBinge'),
                title: analytics.topBinge.title,
                body: compare.swaps?.topBinge?.from?.title
                    ? t('wrapUp.wasTitle', { title: compare.swaps.topBinge.from.title })
                    : t('wrapUp.episodePlays', { count: analytics.topBinge.plays || 0 }),
                poster: bingeArt,
                art: bingeArt ? [bingeArt, ...artwork] : artwork,
            });
        }

        if (analytics?.topMovie?.title) {
            list.push({
                key: 'movie',
                kicker: t('wrapUp.recapMovie'),
                title: analytics.topMovie.title,
                body: compare.swaps?.topMovie?.from?.title
                    ? t('wrapUp.wasTitle', { title: compare.swaps.topMovie.from.title })
                    : t('wrapUp.plays', { count: analytics.topMovie.plays || 0 }),
                poster: movieArt,
                art: movieArt ? [movieArt, ...artwork] : artwork,
            });
        }

        const extras = [
            Number(highlights.newTitles) > 0 ? t('wrapUp.newTitlesCount', { count: highlights.newTitles }) : '',
            highlights.newGenre ? t('wrapUp.newGenre', { genre: highlights.newGenre }) : '',
            highlights.first4k ? t('wrapUp.first4k') : '',
            highlights.longestNight
                ? t('wrapUp.longestNight', {
                    plays: highlights.longestNight.plays,
                    date: highlights.longestNight.date,
                })
                : '',
            highlights.dominantDay
                ? t('wrapUp.mostlyOnDay', {
                    day: highlights.dominantDay.day,
                    percent: highlights.dominantDay.percent,
                })
                : '',
        ].filter(Boolean);
        if (extras.length) {
            list.push({
                key: 'firsts',
                kicker: t('wrapUp.recapFirsts'),
                title: extras[0],
                extra: extras.slice(1),
                art: artwork,
            });
        }

        list.push({
            key: 'close',
            kicker: period,
            title: t('wrapUp.recapDoneTitle'),
            body: t('wrapUp.recapDoneBody'),
            art: artwork,
            poster: bingeArt || movieArt,
        });
        return list;
    }, [analytics, artwork, days, t]);

    useEffect(() => {
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
            if (event.key === 'ArrowRight') setIndex((value) => Math.min(slides.length - 1, value + 1));
            if (event.key === 'ArrowLeft') setIndex((value) => Math.max(0, value - 1));
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose, slides.length]);

    const safeIndex = Math.min(index, Math.max(0, slides.length - 1));
    const slide = slides[safeIndex];
    const isLast = safeIndex >= slides.length - 1;
    const selectedDays = Number(days) || 7;

    return ReactDOM.createPortal(
        <div className="fixed inset-0 z-[350] flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="absolute inset-0 bg-black/90" onClick={onClose} />
            <div
                className="relative w-full max-w-lg h-[min(100dvh,100svh)] sm:h-auto sm:max-h-[85vh] sm:min-h-[36rem] bg-black border-0 sm:border sm:border-white/10 rounded-none sm:rounded-3xl overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] flex flex-col"
                onClick={(event) => event.stopPropagation()}
            >
                <RecapBackdrop art={slide?.art} poster={slide?.poster} />
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 z-20 text-white/80 hover:text-white bg-black/40 hover:bg-black/60 border border-white/15 rounded-full p-2"
                    aria-label="Close"
                >
                    <X className="w-4 h-4" />
                </button>

                {onDaysChange ? (
                    <div className="relative z-10 px-4 pt-[max(3.25rem,calc(env(safe-area-inset-top)+2.5rem))] pb-2">
                        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                            {WRAP_UP_RECAP_PERIODS.map((value) => {
                                const active = selectedDays === value;
                                return (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => onDaysChange(value)}
                                        className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-black tracking-wide border ${
                                            active
                                                ? 'bg-plex text-black border-plex'
                                                : 'bg-black/40 text-white/80 border-white/15'
                                        }`}
                                    >
                                        {value === 365 ? '1y' : `${value}d`}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ) : null}

                <div className="relative z-10 flex-1 min-h-0 flex flex-col justify-end px-6 sm:px-8 pb-4">
                    {slide?.poster && (slide.key === 'binge' || slide.key === 'movie') ? (
                        <img
                            src={slide.poster}
                            alt=""
                            className="w-28 sm:w-36 aspect-[2/3] object-cover rounded-xl border border-white/20 shadow-[0_20px_50px_rgba(0,0,0,0.55)] mb-5"
                        />
                    ) : (
                        <Sparkles className="w-8 h-8 text-plex mb-4 drop-shadow-lg" />
                    )}
                    <p className="text-[11px] uppercase tracking-[0.22em] font-black text-plex mb-2 drop-shadow-md">{slide?.kicker}</p>
                    <h2 className="text-3xl sm:text-4xl font-black text-white leading-tight mb-3 drop-shadow-lg">{slide?.title}</h2>
                    {slide?.body ? <p className="text-sm sm:text-base text-white/80 max-w-sm leading-relaxed">{slide.body}</p> : null}
                    {slide?.extra?.map((line) => (
                        <p key={line} className="text-sm text-white/70 mt-2">{line}</p>
                    ))}
                </div>

                {loading ? (
                    <div className="absolute inset-0 z-30 bg-black/50 flex items-center justify-center">
                        <Loader2 className="w-8 h-8 text-plex animate-spin" />
                    </div>
                ) : null}

                <div className="relative z-10 px-4 sm:px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] flex flex-col-reverse sm:flex-row sm:items-center gap-3 border-t border-white/10 bg-black/35 backdrop-blur-md">
                    <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 sm:gap-3">
                        <button
                            type="button"
                            onClick={() => setIndex((value) => Math.max(0, value - 1))}
                            disabled={safeIndex === 0}
                            className="inline-flex items-center justify-center gap-1 px-3 py-2.5 rounded-xl text-sm font-medium border border-white/15 text-white disabled:opacity-30"
                        >
                            <ChevronLeft className="w-4 h-4" />
                            {t('wrapUp.recapBack')}
                        </button>
                        <button
                            type="button"
                            onClick={() => (isLast ? onClose() : setIndex((value) => Math.min(slides.length - 1, value + 1)))}
                            className="inline-flex items-center justify-center gap-1 px-3 py-2.5 rounded-xl text-sm font-bold bg-plex text-black"
                        >
                            {isLast ? t('wrapUp.recapDone') : t('wrapUp.recapNext')}
                            {!isLast && <ChevronRight className="w-4 h-4" />}
                        </button>
                    </div>
                    <div className="flex justify-center gap-1.5 sm:ml-auto">
                        {slides.map((item, slideIndex) => (
                            <span
                                key={item.key}
                                className={`h-1.5 rounded-full ${slideIndex === safeIndex ? 'w-6 bg-plex' : 'w-1.5 bg-white/30'}`}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
};
