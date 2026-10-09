import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { resolvePortalAssetUrl } from '../shared/basePath';
import {
    formatHomeHeroBackdropPosition,
    prefetchHeroFocalPoints,
    resolveHeroFocalPoint,
} from '../shared/imageFocalPoint';
import { useDiscoverI18n } from './host';
import { PlayerClearLogo } from './PlayerClearLogo';
import { PlayerBackdropImage } from './PlayerBackdropImage';
import { plexBackdropPreviewUrl, plexBackdropUrl, plexLogoUrl, prefetchPlayerImages } from './playerUtils';
import type { PlayerItem, PlayerPlayOptions } from './types';

export type HomeHeroSlide = {
    ratingKey: string;
    title: string;
    type: string;
    year?: number | null;
    summary?: string;
    thumb?: string | null;
    art?: string | null;
    logo?: string | null;
    backdropUrl?: string | null;
    posterUrl?: string | null;
    tmdbId?: number | null;
    canPlay?: boolean;
    serverId?: string | null;
};

type Props = {
    items: HomeHeroSlide[];
    effectiveMode?: string | null;
    active?: boolean;
    onOpenItem: (item: PlayerItem) => void;
    onPlay: (item: PlayerItem, opts?: PlayerPlayOptions) => void;
};

const heroMediaKindLabel = (
    type: string | undefined,
    translate: (key: string) => string,
): string => {
    const kind = String(type || '').toLowerCase();
    if (kind === 'show' || kind === 'episode' || kind === 'season') {
        return translate('mediaPlayerPage.searchShows');
    }
    if (kind === 'movie') return translate('mediaPlayerPage.searchMovies');
    return '';
};

/** Capacitor <img> needs absolute portal URL + access_token (rail posters already do this). */
const heroBackdropSrc = (slide: HomeHeroSlide): string => {
    if (slide.art) return plexBackdropUrl(slide.art);
    if (slide.backdropUrl) return plexBackdropUrl(slide.backdropUrl);
    if (slide.thumb) return plexBackdropUrl(slide.thumb);
    if (slide.posterUrl) return plexBackdropUrl(slide.posterUrl) || resolvePortalAssetUrl(slide.posterUrl);
    return '';
};

const heroBackdropPreviewSrc = (slide: HomeHeroSlide): string => {
    if (slide.art) return plexBackdropPreviewUrl(slide.art);
    if (slide.backdropUrl) return plexBackdropPreviewUrl(slide.backdropUrl);
    if (slide.thumb) return plexBackdropPreviewUrl(slide.thumb);
    return '';
};

const slideDistance = (index: number, other: number, total: number) => {
    if (total <= 1) return 0;
    const raw = Math.abs(index - other);
    return Math.min(raw, total - raw);
};

const SLIDE_MS_MIN = 10000;
const SLIDE_MS_MAX = 25000;
const SWIPE_MIN_DX = 48;

const nextHeroSlideMs = () => (
    SLIDE_MS_MIN + Math.floor(Math.random() * (SLIDE_MS_MAX - SLIDE_MS_MIN + 1))
);

const toPlayerItem = (slide: HomeHeroSlide): PlayerItem => ({
    ratingKey: slide.ratingKey,
    title: slide.title,
    type: slide.type || 'movie',
    year: slide.year,
    summary: slide.summary,
    thumb: slide.thumb,
    art: slide.art,
    logo: slide.logo,
    tmdbId: slide.tmdbId,
    canPlay: slide.canPlay !== false,
    serverId: slide.serverId,
});

const logoReadyCache = new Map<string, boolean>();
const LOGO_READY_CACHE_CAP = 40;

const rememberLogoReady = (url: string, ok: boolean) => {
    if (!ok) return;
    if (logoReadyCache.size >= LOGO_READY_CACHE_CAP) {
        const oldest = logoReadyCache.keys().next().value;
        if (oldest) logoReadyCache.delete(oldest);
    }
    logoReadyCache.set(url, true);
};

const HeroTitle: React.FC<{ slide: HomeHeroSlide }> = ({ slide }) => {
    const logoUrl = plexLogoUrl(slide.logo);
    const [logoFailed, setLogoFailed] = useState(false);
    const [logoReady, setLogoReady] = useState(() => Boolean(logoUrl && logoReadyCache.get(logoUrl)));

    useEffect(() => {
        setLogoFailed(false);
        if (!logoUrl) {
            setLogoFailed(true);
            setLogoReady(false);
            return undefined;
        }
        if (logoReadyCache.get(logoUrl)) {
            setLogoReady(true);
            return undefined;
        }
        setLogoReady(false);
        let cancelled = false;
        const img = new Image();
        const finish = (ok: boolean) => {
            if (cancelled) return;
            if (ok && img.naturalWidth > 0) {
                rememberLogoReady(logoUrl, true);
                setLogoReady(true);
            } else {
                setLogoFailed(true);
            }
        };
        img.onload = () => finish(true);
        img.onerror = () => finish(false);
        img.src = logoUrl;
        if (img.complete) finish(img.naturalWidth > 0);
        return () => { cancelled = true; };
    }, [logoUrl, slide.ratingKey]);

    const showLogo = Boolean(logoUrl) && !logoFailed && logoReady;
    if (showLogo) {
        return (
            <PlayerClearLogo
                src={logoUrl}
                alt={slide.title}
                className="player-home-hero-logo max-h-14 w-auto max-w-[min(100%,18rem)] object-contain object-left drop-shadow-[0_12px_36px_rgba(0,0,0,0.65)] max-md:max-h-11 max-md:max-w-[min(100%,14rem)] sm:max-h-24 sm:max-w-[min(100%,32rem)] lg:max-h-[6.5rem]"
            />
        );
    }
    return (
        <h2 className="player-home-hero-title text-2xl font-black tracking-tight text-white sm:text-4xl lg:text-5xl">
            {slide.title}
        </h2>
    );
};

const isTvShell = () => {
    try {
        return document.documentElement?.dataset?.tv === '1'
            || window.__PLEX_CLIENT__?.isTv === true;
    } catch {
        return false;
    }
};

export const MediaPlayerHomeHero: React.FC<Props> = ({ items, effectiveMode, active = true, onOpenItem, onPlay }) => {
    const { t } = useDiscoverI18n();
    const modeKey = String(effectiveMode || 'trending_week').trim() || 'trending_week';
    const modeEyebrowKey = `mediaPlayerPage.homeHeroEyebrowModes.${modeKey}`;
    const modeEyebrow = t(modeEyebrowKey);
    const eyebrow = modeEyebrow === modeEyebrowKey
        ? t('mediaPlayerPage.homeHeroEyebrow')
        : modeEyebrow;
    const [index, setIndex] = useState(0);
    const [paused, setPaused] = useState(false);
    const [tvShell, setTvShell] = useState(() => isTvShell());
    const [docVisible, setDocVisible] = useState(() => (
        typeof document === 'undefined' || document.visibilityState !== 'hidden'
    ));
    const swipeRef = useRef<{ x: number; y: number } | null>(null);
    const heroBtnRef = useRef<HTMLButtonElement | null>(null);
    const [focalPos, setFocalPos] = useState<Record<string, string>>({});
    const pageActive = active && docVisible;

    useEffect(() => {
        setTvShell(isTvShell());
    }, []);

    useEffect(() => {
        const onVisibility = () => {
            setDocVisible(document.visibilityState !== 'hidden');
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, []);

    const slides = Array.isArray(items) ? items.filter((row) => row?.ratingKey && row?.title) : [];
    const slideKey = slides.map((row) => row.ratingKey).join('|');
    const backdropKey = slides.map((row) => heroBackdropSrc(row)).join('|');

    useEffect(() => {
        setIndex(0);
        setFocalPos({});
    }, [slideKey]);

    useEffect(() => {
        if (!pageActive || paused || slides.length < 2) return undefined;
        const timer = window.setTimeout(() => {
            setIndex((current) => (current + 1) % slides.length);
        }, nextHeroSlideMs());
        return () => window.clearTimeout(timer);
    }, [index, pageActive, paused, slides.length]);

    useEffect(() => {
        if (!pageActive || !slides.length) return undefined;
        const previewUrls = slides
            .filter((_, slideIndex) => slideDistance(index, slideIndex, slides.length) <= 2)
            .map((slide) => heroBackdropPreviewSrc(slide) || heroBackdropSrc(slide))
            .filter(Boolean);
        const fullUrls = slides
            .filter((_, slideIndex) => slideDistance(index, slideIndex, slides.length) === 0)
            .map((slide) => heroBackdropSrc(slide))
            .filter(Boolean);

        prefetchPlayerImages([...previewUrls, ...fullUrls], 4);
        prefetchHeroFocalPoints([...previewUrls, ...fullUrls]);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- slides rebuilt each render
    }, [backdropKey, index, pageActive, slides.length]);

    useEffect(() => {
        const btn = heroBtnRef.current;
        if (!btn) return undefined;
        const onCycle = (event: Event) => {
            const delta = Number((event as CustomEvent<{ delta?: number }>).detail?.delta || 0);
            if (!delta) return;
            setIndex((current) => (current + delta + slides.length) % slides.length);
            setPaused(true);
        };
        const onPlayHold = () => {
            const slide = slides[Math.min(index, Math.max(0, slides.length - 1))];
            if (!slide || slide.canPlay === false) return;
            onPlay(toPlayerItem(slide));
        };
        btn.addEventListener('smp-tv-hero-cycle', onCycle);
        btn.addEventListener('smp-tv-hero-play', onPlayHold);
        return () => {
            btn.removeEventListener('smp-tv-hero-cycle', onCycle);
            btn.removeEventListener('smp-tv-hero-play', onPlayHold);
        };
    }, [index, onPlay, slides, tvShell]);

    useEffect(() => {
        if (!pageActive || !slides.length) return undefined;
        const near = slides.filter((_, slideIndex) => slideDistance(index, slideIndex, slides.length) <= 1);
        let cancelled = false;
        near.forEach((slide) => {
            if (focalPos[slide.ratingKey]) return;
            const url = tvShell
                ? (heroBackdropPreviewSrc(slide) || heroBackdropSrc(slide))
                : (heroBackdropSrc(slide) || heroBackdropPreviewSrc(slide));
            if (!url) return;
            void resolveHeroFocalPoint(url).then((focal) => {
                if (cancelled) return;
                const position = formatHomeHeroBackdropPosition(focal);
                setFocalPos((prev) => (prev[slide.ratingKey] ? prev : { ...prev, [slide.ratingKey]: position }));
            });
        });
        return () => { cancelled = true; };
    }, [focalPos, index, pageActive, slides, tvShell]);

    if (!slides.length) return null;

    const currentSlide = slides[Math.min(index, slides.length - 1)];
    const go = (delta: number) => {
        if (slides.length < 2) return;
        setIndex((current) => (current + delta + slides.length) % slides.length);
        setPaused(true);
    };

    const onTouchStart = (event: React.TouchEvent) => {
        if (slides.length < 2) return;
        const touch = event.touches[0];
        if (!touch) return;
        swipeRef.current = { x: touch.clientX, y: touch.clientY };
        setPaused(true);
    };

    const onTouchEnd = (event: React.TouchEvent) => {
        const start = swipeRef.current;
        swipeRef.current = null;
        setPaused(false);
        if (!start || slides.length < 2) return;
        const touch = event.changedTouches[0];
        if (!touch) return;
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (Math.abs(dx) < SWIPE_MIN_DX) return;
        if (Math.abs(dx) < Math.abs(dy) * 1.15) return;
        go(dx < 0 ? 1 : -1);
    };

    const onTouchCancel = () => {
        swipeRef.current = null;
        setPaused(false);
    };

    const metaBits = [currentSlide.year, heroMediaKindLabel(currentSlide.type, t)].filter(Boolean);

    const copy = (
        <div className="player-home-hero-copy-inner max-w-2xl">
            <HeroTitle key={currentSlide.ratingKey} slide={currentSlide} />
            {metaBits.length ? (
                <div className="player-home-hero-meta mt-3 flex flex-wrap items-center gap-2 max-md:hidden">
                    {metaBits.map((bit) => (
                        <span
                            key={String(bit)}
                            className="player-home-hero-chip inline-flex items-center rounded-full border border-white/15 bg-white/[0.08] px-2.5 py-1 text-[11px] font-bold tracking-wide text-white/85 backdrop-blur-sm sm:text-xs"
                        >
                            {bit}
                        </span>
                    ))}
                </div>
            ) : null}
            {currentSlide.summary ? (
                <p className="player-home-hero-summary mt-3 hidden max-w-xl text-sm leading-relaxed text-white/78 sm:line-clamp-3">
                    {currentSlide.summary}
                </p>
            ) : null}
        </div>
    );

    const dots = (
        <div className="player-home-hero-dots flex items-center gap-1.5">
            {slides.map((slide, slideIndex) => (
                tvShell ? (
                    <span
                        key={slide.ratingKey}
                        aria-hidden
                        className={`h-1 rounded-full transition-all duration-300 ${
                            slideIndex === index ? 'w-7 bg-white' : 'w-1.5 bg-white/30'
                        }`}
                    />
                ) : (
                    <button
                        key={slide.ratingKey}
                        type="button"
                        tabIndex={-1}
                        aria-label={`${slide.title}`}
                        aria-current={slideIndex === index ? 'true' : undefined}
                        onClick={() => setIndex(slideIndex)}
                        className={`h-1 rounded-full transition-all duration-300 ${
                            slideIndex === index ? 'w-7 bg-white' : 'w-1.5 bg-white/30 hover:bg-white/55'
                        }`}
                    />
                )
            ))}
        </div>
    );

    return (
        <section
            data-tv-page-top="1"
            className="player-home-hero relative touch-pan-y overflow-hidden rounded-[1.35rem] border border-white/[0.08] bg-[#07090d] shadow-none max-md:rounded-[1.1rem]"
            onMouseEnter={() => { if (!tvShell) setPaused(true); }}
            onMouseLeave={() => { if (!tvShell) setPaused(false); }}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchCancel}
            aria-roledescription="carousel"
            aria-label={eyebrow}
        >
            <div
                className="player-home-hero-stage relative aspect-[21/9] min-h-[280px] max-h-[460px] w-full overflow-hidden sm:min-h-[340px] sm:max-h-[520px] max-md:aspect-[16/9] max-md:min-h-[12.25rem] max-md:max-h-[34vh]"
            >
                {slides.map((slide, slideIndex) => {
                    const visible = slideIndex === index;
                    const dist = slideDistance(index, slideIndex, slides.length);
                    const loadPreview = dist <= 2;
                    const loadFull = dist <= 1;
                    const backdropSrc = loadFull ? heroBackdropSrc(slide) : '';
                    const previewSrc = loadPreview ? heroBackdropPreviewSrc(slide) : '';
                    const showArt = Boolean(backdropSrc || previewSrc);
                    const objectPosition = focalPos[slide.ratingKey] || '62% 32%';
                    return (
                        <div
                            key={slide.ratingKey}
                            className={`player-hero-slide absolute inset-0 overflow-hidden transition-opacity duration-700 ease-out ${visible ? 'is-active opacity-100' : 'pointer-events-none opacity-0'}`}
                            aria-hidden={!visible}
                        >
                            {showArt ? (
                                <div className={`player-hero-art ${visible ? 'is-active' : ''}`}>
                                    <PlayerBackdropImage
                                        src={backdropSrc || previewSrc}
                                        previewSrc={backdropSrc ? previewSrc : ''}
                                        className="player-hero-intact h-full w-full object-cover"
                                        style={{ objectPosition }}
                                        fetchPriority={visible ? 'high' : 'low'}
                                    />
                                </div>
                            ) : (
                                <div className="h-full w-full bg-gradient-to-br from-zinc-800 to-zinc-950" />
                            )}
                            <div className="player-hero-scrim" />
                            <div className="player-hero-grain" aria-hidden />
                        </div>
                    );
                })}

                {tvShell ? (
                    <button
                        ref={heroBtnRef}
                        type="button"
                        data-tv-item="1"
                        data-tv-home-hero="1"
                        data-tv-key="home-hero"
                        data-tv-hero-index={String(index)}
                        data-tv-hero-count={String(slides.length)}
                        onClick={() => onOpenItem(toPlayerItem(currentSlide))}
                        onFocus={() => setPaused(true)}
                        onBlur={() => setPaused(false)}
                        className="absolute inset-0 z-10 flex flex-col justify-end gap-4 p-6 text-left outline-none sm:p-7 lg:p-8"
                        aria-label={currentSlide.title}
                    >
                        <div className="player-home-hero-eyebrow-row">
                            <span className="player-home-hero-eyebrow-mark" aria-hidden />
                            <p className="player-home-hero-eyebrow shrink-0 text-sm font-bold uppercase tracking-[0.22em] text-amber-300/95">
                                {eyebrow}
                            </p>
                        </div>
                        <div className="player-home-hero-copy min-h-0">
                            <div
                                key={currentSlide.ratingKey}
                                className={tvShell ? 'smp-tv-hero-copy-enter' : undefined}
                            >
                                {copy}
                            </div>
                        </div>
                        <div className="player-home-hero-footer flex items-end gap-4">
                            {dots}
                        </div>
                    </button>
                ) : (
                    <div className="absolute inset-0 z-10 flex flex-col justify-end gap-3 p-4 sm:gap-4 sm:p-6 lg:p-8 max-md:gap-2 max-md:p-3.5 max-md:pb-3.5">
                        <div className="player-home-hero-eyebrow-row max-md:hidden">
                            <span className="player-home-hero-eyebrow-mark" aria-hidden />
                            <p className="player-home-hero-eyebrow shrink-0 text-sm font-bold uppercase tracking-[0.22em] text-amber-300/95 max-md:text-[11px] max-md:tracking-[0.18em]">
                                {eyebrow}
                            </p>
                        </div>
                        <div className="player-home-hero-copy min-h-0">
                            {copy}
                            <div className="player-hero-actions mt-4 flex flex-wrap items-center gap-2.5 max-md:mt-2.5">
                                {currentSlide.canPlay !== false ? (
                                    <button
                                        type="button"
                                        onClick={() => onPlay(toPlayerItem(currentSlide))}
                                        className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-bold text-zinc-950 shadow-[0_10px_30px_rgba(0,0,0,0.35)] transition hover:bg-white/90 max-md:h-10 max-md:bg-plex max-md:px-4 max-md:text-zinc-950 max-md:hover:bg-plex-hover"
                                    >
                                        <Play className="h-4 w-4 fill-current" />
                                        {t('mediaPlayerPage.homeHeroPlay')}
                                    </button>
                                ) : null}
                                <button
                                    type="button"
                                    onClick={() => onOpenItem(toPlayerItem(currentSlide))}
                                    className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 text-sm font-bold text-white backdrop-blur-md transition hover:bg-white/16 max-md:h-10 max-md:px-4"
                                >
                                    {t('mediaPlayerPage.homeHeroOpen')}
                                </button>
                            </div>
                            <div className="mt-4 flex items-center justify-between gap-3 max-md:mt-2.5">
                                {dots}
                                {slides.length > 1 ? (
                                    <div className="player-hero-arrows flex items-center gap-1.5 max-md:hidden">
                                        <button
                                            type="button"
                                            tabIndex={-1}
                                            onClick={() => go(-1)}
                                            className="rounded-full border border-white/15 bg-black/40 p-2.5 text-white/85 backdrop-blur hover:bg-black/60 hover:text-white"
                                            aria-label={t('mediaPlayerPage.homeHeroPrev')}
                                        >
                                            <ChevronLeft className="h-4 w-4" />
                                        </button>
                                        <button
                                            type="button"
                                            tabIndex={-1}
                                            onClick={() => go(1)}
                                            className="rounded-full border border-white/15 bg-black/40 p-2.5 text-white/85 backdrop-blur hover:bg-black/60 hover:text-white"
                                            aria-label={t('mediaPlayerPage.homeHeroNext')}
                                        >
                                            <ChevronRight className="h-4 w-4" />
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
};
