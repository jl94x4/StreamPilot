import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchMediaPlayerScreensaver, fetchMediaPlayerWatchlist } from './api';
import { buildPlayDeck } from './screensaverDeck.js';
import { formatPlayerDuration, isWeakTvDevice, plexImageUrl, plexLogoUrl, plexScreensaverBackdropUrl } from './playerUtils';
import { PlayerClearLogo } from './PlayerClearLogo';
import type {
    PlayerScreensaverClockPos,
    PlayerScreensaverClockSize,
    PlayerScreensaverDim,
    PlayerScreensaverInfo,
    PlayerScreensaverSource,
    PlayerScreensaverStyle,
    PlayerScreensaverTransition,
} from './playerSettings';
import type { PlayerItem } from './types';

const IDLE_MS = 120_000;
const SLIDE_MS = 14_000;
const CROSSFADE_MS = 1400;

const formatClock = (date: Date) => {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
};

/** A few pixels each slide so the clock does not sit on the same OLED pixels. */
const CLOCK_NUDGES = [
    { x: 0, y: 0 },
    { x: 16, y: -10 },
    { x: -12, y: 14 },
    { x: 20, y: 8 },
    { x: -18, y: -8 },
    { x: 10, y: 16 },
    { x: -8, y: 6 },
    { x: 14, y: -14 },
];

type Slide = {
    key: string;
    artUrl: string;
    title: string;
    logoUrl: string;
    /** Year, rating, runtime and genres on one line (Spotlight, Gallery). */
    meta: string;
    summary: string;
    /** Small poster for the Poster wall. */
    posterUrl: string;
    /** The title behind the picture: Up on the remote opens it. */
    item: PlayerItem;
};

const metaLineFor = (item: PlayerItem) => [
    item.year ? String(item.year) : '',
    item.contentRating ? String(item.contentRating) : '',
    item.durationMs ? formatPlayerDuration(item.durationMs) : '',
    Array.isArray(item.genres) ? item.genres.slice(0, 3).join(', ') : '',
].filter(Boolean).join('   ·   ');

const posterFor = (item: PlayerItem) => {
    const thumb = item.type === 'episode'
        ? String((item as { grandparentThumb?: string }).grandparentThumb || item.thumb || '')
        : String(item.thumb || '');
    return thumb ? plexImageUrl(thumb, 300, 450) : '';
};

const slidesFromItems = (items: PlayerItem[]): Slide[] => {
    const seen = new Set<string>();
    const out: Slide[] = [];
    for (const item of items) {
        // The real background first. heroArt is the designed 16:9 card (title and logo baked in, often a
        // dark or mostly empty picture): Continue Watching movies carry it, and starting on it gave
        // black screensaver slides. It is only used when there is no background at all.
        const art = String(
            (item as { backdropArt?: string | null }).backdropArt
            || (item as { backdropUrl?: string }).backdropUrl
            || item.art
            || item.heroArt
            || item.thumb
            || '',
        ).trim();
        if (!art) continue;
        const artUrl = plexScreensaverBackdropUrl(art);
        if (!artUrl) continue;
        const dedupe = String(
            item.grandparentRatingKey
            || (item.type === 'episode' ? item.showTitle : '')
            || item.ratingKey
            || '',
        ).trim() || artUrl;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        out.push({
            key: dedupe,
            artUrl,
            title: String(item.showTitle || item.title || '').trim(),
            logoUrl: plexLogoUrl(item.logo) || '',
            meta: metaLineFor(item),
            summary: String(item.tagline || item.summary || '').trim().slice(0, 320),
            posterUrl: posterFor(item),
            item,
        });
        if (out.length >= 24) break;
    }
    return out;
};

const poolFingerprint = (items: PlayerItem[]) => (
    items
        .map((item) => `${item.ratingKey || ''}:${item.art || item.thumb || ''}`)
        .filter(Boolean)
        .join('|')
);

type Props = {
    /** When false, screensaver never activates (e.g. left Home). */
    enabled: boolean;
    /** Continue Watching fallback / default pool. */
    continueWatchingItems: PlayerItem[];
    /** Because-you-watched hub items for the Recommended source. */
    recommendedItems?: PlayerItem[];
    source: PlayerScreensaverSource;
    /** Localized label shown as a watermark above the clock. */
    sourceLabel: string;
    /** Nudge the clock on each slide. Off leaves it stationary. */
    shiftClock?: boolean;
    /** Idle time before it starts (Settings → Screensaver delay). */
    delayMs?: number;
    /** How long each picture stays up. */
    slideMs?: number;
    /** Crossfading art, slow pan and zoom, a framed Gallery, a Spotlight, a Poster wall or a clock. */
    look?: PlayerScreensaverStyle;
    /** What appears with the art. */
    info?: PlayerScreensaverInfo;
    clockPos?: PlayerScreensaverClockPos;
    clockSize?: PlayerScreensaverClockSize;
    dim?: PlayerScreensaverDim;
    transition?: PlayerScreensaverTransition;
    /** Show the picture source above the clock. */
    showSource?: boolean;
    /** Up on the remote while the screensaver is showing opens that title. */
    onOpenItem?: (item: PlayerItem) => void;
};

/** useTvRemote fires this when the native Back arrives while the screensaver is up. */
export const TV_SCREENSAVER_DISMISS_EVENT = 'smp-tv-screensaver-dismiss';

/**
 * TV Home idle ambient: cycles art from the chosen screensaver pool with a large
 * bottom-left clock. Any remote key / pointer dismisses and resets the idle timer.
 * Play order is always a shuffled deck, for every screensaver source.
 * Each new pass is shuffled again and does not open on the slide that just played.
 */
export const PlayerTvScreensaver: React.FC<Props> = ({
    enabled,
    continueWatchingItems,
    recommendedItems = [],
    source,
    sourceLabel,
    shiftClock = false,
    delayMs = IDLE_MS,
    slideMs = SLIDE_MS,
    look = 'slideshow',
    info = 'title',
    clockPos = 'bottomLeft',
    clockSize = 'medium',
    dim = 'medium',
    transition = 'fade',
    showSource = true,
    onOpenItem,
}) => {
    const onOpenItemRef = useRef(onOpenItem);
    onOpenItemRef.current = onOpenItem;
    const [remoteItems, setRemoteItems] = useState<PlayerItem[]>([]);
    const fetchGen = useRef(0);
    const continueWatchingRef = useRef(continueWatchingItems);
    continueWatchingRef.current = continueWatchingItems;
    const recommendedRef = useRef(recommendedItems);
    recommendedRef.current = recommendedItems;

    useEffect(() => {
        if (!enabled) return undefined;
        const gen = fetchGen.current + 1;
        fetchGen.current = gen;
        let cancelled = false;

        const apply = (items: PlayerItem[]) => {
            if (cancelled || fetchGen.current !== gen) return;
            setRemoteItems(Array.isArray(items) ? items : []);
        };

        if (source === 'continue_watching') {
            // Start on the Home row straight away, then swap in the screensaver pool: it carries
            // each show's current background (the Home cards can hold art from an earlier load).
            // An empty or failed pool keeps the Home row, never another library.
            apply(continueWatchingRef.current);
            void fetchMediaPlayerScreensaver(source)
                .then((data) => {
                    const items = data?.items || [];
                    if (items.length) apply(items);
                })
                .catch(() => undefined);
            return () => { cancelled = true; };
        }
        if (source === 'recommended' && recommendedRef.current.length) apply(recommendedRef.current);

        const load = source === 'watchlist'
            ? fetchMediaPlayerWatchlist(true).then((data) => data?.items || [])
            : fetchMediaPlayerScreensaver(source).then((data) => data?.items || []);
        void load
            .then((items) => {
                if (items.length) apply(items);
                else apply(continueWatchingRef.current);
            })
            .catch(() => {
                apply(continueWatchingRef.current);
            });

        return () => { cancelled = true; };
    }, [
        enabled,
        source,
        source === 'continue_watching'
            ? continueWatchingItems.map((item) => item.ratingKey || '').join('|')
            : '',
    ]);

    // The pool is otherwise fetched once per session, so a background changed on a show since then
    // kept showing the old picture. Each time the screensaver starts, quietly pull a fresh pool.
    const activeForRefresh = useRef(false);
    const [activeFlag, setActiveFlag] = useState(false);
    useEffect(() => {
        if (!enabled || !activeFlag || activeForRefresh.current) return undefined;
        if (source === 'watchlist' || source === 'recommended') return undefined;
        activeForRefresh.current = true;
        let cancelled = false;
        void fetchMediaPlayerScreensaver(source)
            .then((data) => {
                const items = data?.items || [];
                if (!cancelled && items.length) setRemoteItems(items);
            })
            .catch(() => undefined);
        return () => { cancelled = true; };
    }, [enabled, activeFlag, source]);
    useEffect(() => {
        if (!activeFlag) activeForRefresh.current = false;
    }, [activeFlag]);

    const poolItems = useMemo(() => {
        if (remoteItems.length) return remoteItems;
        if (source === 'recommended' && recommendedItems.length) return recommendedItems;
        return continueWatchingItems;
    }, [continueWatchingItems, recommendedItems, remoteItems, source]);

    const poolKey = useMemo(() => poolFingerprint(poolItems), [poolItems]);
    const poolItemsRef = useRef(poolItems);
    poolItemsRef.current = poolItems;

    // Slides whose picture failed to load are left out for the rest of the session: a broken one
    // showed as a black screen. The "pool changed" effect below then moves on to another slide.
    const [brokenKeys, setBrokenKeys] = useState<string[]>([]);
    // Pool contents only. Play order is a fresh shuffle each time the screensaver starts.
    const slides = useMemo(
        () => slidesFromItems(poolItemsRef.current).filter((slide) => !brokenKeys.includes(slide.key)),
        [poolKey, brokenKeys],
    );
    const slidesRef = useRef(slides);
    slidesRef.current = slides;

    const [active, setActive] = useState(false);
    const activeRef = useRef(false);
    activeRef.current = active;
    useEffect(() => { setActiveFlag(active); }, [active]);
    const [clock, setClock] = useState(() => formatClock(new Date()));
    const [frame, setFrame] = useState<{
        current: Slide;
        outgoing: Slide | null;
        gen: number;
    } | null>(null);
    const currentKeyRef = useRef('');
    const deckRef = useRef<Slide[]>([]);
    const deckIndexRef = useRef(0);

    const freshSlide = (slide: Slide | null | undefined): Slide | null => {
        if (!slide) return null;
        return slidesRef.current.find((row) => row.key === slide.key) || slide;
    };

    const startDeck = (avoidKey = '') => {
        const deck = buildPlayDeck(slidesRef.current, avoidKey) as Slide[];
        deckRef.current = deck;
        deckIndexRef.current = 0;
        return deck[0] ? freshSlide(deck[0]) : null;
    };

    useEffect(() => {
        if (!enabled || slides.length === 0) {
            setActive(false);
            setFrame(null);
            currentKeyRef.current = '';
            return undefined;
        }

        let idleTimer = 0;
        let cancelled = false;

        const clearIdle = () => {
            if (idleTimer) window.clearTimeout(idleTimer);
            idleTimer = 0;
        };

        const armIdle = () => {
            clearIdle();
            idleTimer = window.setTimeout(() => {
                if (cancelled) return;
                // Watching a trailer full screen is not idle.
                if (document.documentElement.dataset.trailerExpanded === '1') {
                    armIdle();
                    return;
                }
                const start = startDeck('');
                if (!start) return;
                currentKeyRef.current = start.key;
                setFrame({ current: start, outgoing: null, gen: 0 });
                setActive(true);
            }, delayMs);
        };

        const dismiss = () => {
            setActive(false);
            setFrame(null);
            currentKeyRef.current = '';
            armIdle();
        };

        // Native Back can follow the WebView keydown; useTvRemote treats a Back this
        // soon after closing as part of the same press (see SCREENSAVER_BACK_GRACE_MS).
        const markClosed = () => {
            try {
                document.documentElement.dataset.tvScreensaverClosedAt = String(Date.now());
            } catch {
                /* ignore */
            }
        };

        // Any key leaves the screensaver, but only closes it: the press (Back, Select, arrows)
        // must not also navigate or press whatever was focused on the page underneath.
        let swallowKeyUp = '';
        const onKeyDown = (event: KeyboardEvent) => {
            if (cancelled || document.visibilityState === 'hidden') return;
            if (activeRef.current) {
                if ((event.key === 'ArrowUp' || event.keyCode === 38) && onOpenItemRef.current) {
                    const shown = slidesRef.current.find((row) => row.key === currentKeyRef.current);
                    if (shown) {
                        const open = onOpenItemRef.current;
                        event.preventDefault();
                        event.stopImmediatePropagation();
                        swallowKeyUp = event.key || String(event.keyCode);
                        markClosed();
                        dismiss();
                        window.setTimeout(() => open(shown.item), 0);
                        return;
                    }
                }
                event.preventDefault();
                event.stopImmediatePropagation();
                swallowKeyUp = event.key || String(event.keyCode);
                markClosed();
            }
            dismiss();
        };
        const onKeyUp = (event: KeyboardEvent) => {
            if (!swallowKeyUp || (event.key || String(event.keyCode)) !== swallowKeyUp) return;
            swallowKeyUp = '';
            event.preventDefault();
            event.stopImmediatePropagation();
        };
        const onActivity = () => {
            if (cancelled) return;
            if (document.visibilityState === 'hidden') return;
            dismiss();
        };
        const onBackDismiss = () => {
            if (cancelled || !activeRef.current) return;
            markClosed();
            dismiss();
        };

        armIdle();
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('keyup', onKeyUp, true);
        window.addEventListener(TV_SCREENSAVER_DISMISS_EVENT, onBackDismiss);
        window.addEventListener('pointerdown', onActivity, true);
        window.addEventListener('wheel', onActivity, { capture: true, passive: true });
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') {
                setActive(false);
                setFrame(null);
                currentKeyRef.current = '';
                clearIdle();
                return;
            }
            armIdle();
        };
        document.addEventListener('visibilitychange', onVisibility);

        return () => {
            cancelled = true;
            clearIdle();
            window.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('keyup', onKeyUp, true);
            window.removeEventListener(TV_SCREENSAVER_DISMISS_EVENT, onBackDismiss);
            window.removeEventListener('pointerdown', onActivity, true);
            window.removeEventListener('wheel', onActivity, true);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [enabled, slides.length, delayMs]);

    // Walk the shuffled deck. A finished pass is shuffled again and does not
    // repeat the slide that just played. Source order is never the play order.
    useEffect(() => {
        if (!active || slides.length <= 1) return undefined;
        const id = window.setInterval(() => {
            const pool = slidesRef.current;
            if (pool.length <= 1) return;
            const currentKey = currentKeyRef.current;
            const outgoing = pool.find((row) => row.key === currentKey) || null;
            const inPool = (slide: Slide | null | undefined) => (
                slide ? pool.find((row) => row.key === slide.key) || null : null
            );
            let deck = deckRef.current;
            let nextIndex = deckIndexRef.current + 1;
            let next: Slide | null = null;
            while (nextIndex < deck.length && !next) {
                const candidate = inPool(deck[nextIndex]);
                if (candidate && candidate.key !== currentKey) next = candidate;
                else nextIndex += 1;
            }
            if (!next) {
                next = startDeck(currentKey);
                nextIndex = 0;
                if (next && next.key === currentKey) return;
            }
            if (!next) return;
            deckIndexRef.current = nextIndex;
            currentKeyRef.current = next.key;
            setFrame((prev) => ({
                current: next as Slide,
                outgoing: outgoing || prev?.current || null,
                gen: (prev?.gen || 0) + 1,
            }));
        }, slideMs);
        return () => window.clearInterval(id);
    }, [active, slides.length, slideMs]);

    // Drop the outgoing layer after the crossfade finishes.
    useEffect(() => {
        if (!frame?.outgoing) return undefined;
        const timer = window.setTimeout(() => {
            setFrame((prev) => (prev ? { ...prev, outgoing: null } : prev));
        }, CROSSFADE_MS);
        return () => window.clearTimeout(timer);
    }, [frame?.gen, frame?.outgoing]);

    // If the pool reshuffles while active, keep the same title but pick up a new background.
    useEffect(() => {
        if (!active || !slides.length) return;
        const match = slides.find((row) => row.key === currentKeyRef.current);
        if (!match) {
            const start = startDeck('');
            if (!start) return;
            currentKeyRef.current = start.key;
            setFrame({ current: start, outgoing: null, gen: 0 });
            return;
        }
        setFrame((prev) => {
            if (prev?.current?.key === match.key && prev.current.artUrl === match.artUrl) return prev;
            return {
                current: match,
                outgoing: prev?.current && prev.current.artUrl !== match.artUrl ? prev.current : null,
                gen: (prev?.gen || 0) + 1,
            };
        });
    }, [active, slides]);

    useEffect(() => {
        if (!active || !frame?.current) return undefined;
        const upcoming = deckRef.current[deckIndexRef.current + 1];
        const url = upcoming
            ? (slides.find((row) => row.key === upcoming.key)?.artUrl || upcoming.artUrl)
            : '';
        if (!url || url === frame.current.artUrl) return undefined;
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
        return undefined;
    }, [active, frame, slides]);

    useEffect(() => {
        if (!active) return undefined;
        const tick = () => setClock(formatClock(new Date()));
        tick();
        const id = window.setInterval(tick, 1000);
        return () => window.clearInterval(id);
    }, [active]);

    if (!active || !frame?.current) return null;

    const { current, gen } = frame;
    // An instant swap has no outgoing picture to fade out.
    const outgoing = transition === 'instant' ? null : frame.outgoing;
    const watermark = showSource ? String(sourceLabel || '').trim() : '';
    const clockNudge = shiftClock ? CLOCK_NUDGES[Math.abs(gen) % CLOCK_NUDGES.length] : null;

    const isClockStyle = look === 'clock';
    const isWall = look === 'posters';
    const isGallery = look === 'gallery';
    const isSpotlight = look === 'spotlight';
    // Gallery and Spotlight keep the bottom-left for the picture's details: the clock goes top right.
    const pos: PlayerScreensaverClockPos = isClockStyle
        ? 'bottomLeft'
        : ((isGallery || isSpotlight) && clockPos === 'bottomLeft' ? 'topRight' : clockPos);
    const showClock = isClockStyle || pos !== 'off';
    const clockInFooter = showClock && pos === 'bottomLeft';
    const clockFloats = showClock && pos !== 'bottomLeft' && pos !== 'off';
    const showTitle = !isClockStyle && !isWall && info !== 'clock';
    const showDetails = showTitle && (info === 'details' || isSpotlight);

    const clockBlock = (
        <>
            {watermark ? <p className="player-tv-screensaver-watermark">{watermark}</p> : null}
            <p
                className="player-tv-screensaver-clock"
                style={clockNudge ? { transform: `translate(${clockNudge.x}px, ${clockNudge.y}px)` } : undefined}
            >
                {clock}
            </p>
        </>
    );

    const picture = (
        <>
            {outgoing ? (
                <img
                    key={`out-${outgoing.key}-${gen}`}
                    alt=""
                    className="player-tv-screensaver-slide player-tv-screensaver-slide--exit"
                    src={outgoing.artUrl}
                    draggable={false}
                />
            ) : null}
            <img
                key={`cur-${current.key}-${gen}`}
                alt=""
                className={`player-tv-screensaver-slide${outgoing ? ' player-tv-screensaver-slide--enter' : ''}${
                    look === 'panZoom' ? (gen % 2 ? ' player-tv-screensaver-slide--pan-b' : ' player-tv-screensaver-slide--pan-a') : ''
                }`}
                src={current.artUrl}
                draggable={false}
                onError={() => setBrokenKeys((prev) => (prev.includes(current.key) ? prev : [...prev, current.key]))}
            />
        </>
    );

    // Poster wall: a few rows of posters drifting in opposite directions. Fewer on a slow stick.
    const wallPosters = isWall ? slides.filter((slide) => slide.posterUrl) : [];
    const weak = isWall && isWeakTvDevice();
    const wallRows = weak ? 2 : 3;
    // Half a row (one copy) must be wider than the screen, or the loop shows a gap: 28vh posters
    // are about 0.19 of the screen height wide each, so ten always cover it.
    const perRow = 10;
    const wall = isWall ? (
        <div className="player-tv-screensaver-wall" aria-hidden>
            {Array.from({ length: wallRows }, (_, rowIndex) => {
                const row = wallPosters.length
                    ? Array.from({ length: perRow }, (_, i) => wallPosters[(rowIndex * 3 + i) % wallPosters.length])
                    : [];
                return (
                    <div
                        key={rowIndex}
                        className={`player-tv-screensaver-wall-row${rowIndex % 2 ? ' is-reverse' : ''}`}
                        style={{ '--ss-row-ms': `${70_000 + rowIndex * 14_000}ms` } as React.CSSProperties}
                    >
                        {[...row, ...row].map((slide, i) => (
                            <img key={`${slide.key}-${i}`} alt="" className="player-tv-screensaver-wall-poster" src={slide.posterUrl} draggable={false} />
                        ))}
                    </div>
                );
            })}
        </div>
    ) : null;

    const infoBlock = showTitle ? (
        <>
            {current.logoUrl ? (
                <PlayerClearLogo
                    src={current.logoUrl}
                    alt={current.title}
                    className="player-tv-screensaver-logo"
                    growSmall
                />
            ) : current.title ? (
                <p className="player-tv-screensaver-title">{current.title}</p>
            ) : null}
            {showDetails && current.meta ? <p className="player-tv-screensaver-meta">{current.meta}</p> : null}
            {showDetails && current.summary ? <p className="player-tv-screensaver-summary">{current.summary}</p> : null}
        </>
    ) : null;

    // Portal to <body>: inside Home a parent stacking context let the nav rail draw on top.
    // --ss-slide-ms: pan and zoom lasts exactly one picture (its direction alternates per slide).
    return createPortal((
        <div
            className={`player-tv-screensaver player-tv-screensaver--${look} player-tv-screensaver--dim-${dim} player-tv-screensaver--size-${clockSize}${
                transition === 'instant' ? ' player-tv-screensaver--instant' : ''
            }`}
            data-tv-screensaver="1"
            aria-hidden
            style={{ '--ss-slide-ms': `${slideMs}ms` } as React.CSSProperties}
        >
            {isWall ? wall : (isGallery ? <div className="player-tv-screensaver-frame">{picture}</div> : picture)}
            <div className="player-tv-screensaver-scrim" />
            {onOpenItem ? (
                <div className="player-tv-screensaver-up" aria-hidden>
                    <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 15l7-7 7 7" />
                    </svg>
                </div>
            ) : null}
            {clockFloats ? (
                <div className={`player-tv-screensaver-float player-tv-screensaver-float--${pos}`}>{clockBlock}</div>
            ) : null}
            <div className="player-tv-screensaver-footer">
                {clockInFooter ? clockBlock : null}
                {infoBlock}
            </div>
        </div>
    ), document.body);
};
