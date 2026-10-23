import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchMediaPlayerScreensaver, fetchMediaPlayerWatchlist } from './api';
import { buildPlayDeck } from './screensaverDeck.js';
import { plexLogoUrl, plexScreensaverBackdropUrl } from './playerUtils';
import { PlayerClearLogo } from './PlayerClearLogo';
import type { PlayerScreensaverSource } from './playerSettings';
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
};

const slidesFromItems = (items: PlayerItem[]): Slide[] => {
    const seen = new Set<string>();
    const out: Slide[] = [];
    for (const item of items) {
        const art = String(
            (item as { backdropArt?: string | null }).backdropArt
            || item.heroArt
            || (item as { backdropUrl?: string }).backdropUrl
            || item.art
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
}) => {
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
            // The Home row is the user's Continue Watching. The screensaver endpoint
            // can substitute another library when On Deck is slow.
            apply(continueWatchingRef.current);
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

    const poolItems = useMemo(() => {
        if (remoteItems.length) return remoteItems;
        if (source === 'recommended' && recommendedItems.length) return recommendedItems;
        return continueWatchingItems;
    }, [continueWatchingItems, recommendedItems, remoteItems, source]);

    const poolKey = useMemo(() => poolFingerprint(poolItems), [poolItems]);
    const poolItemsRef = useRef(poolItems);
    poolItemsRef.current = poolItems;

    // Pool contents only. Play order is a fresh shuffle each time the screensaver starts.
    const slides = useMemo(
        () => slidesFromItems(poolItemsRef.current),
        [poolKey],
    );
    const slidesRef = useRef(slides);
    slidesRef.current = slides;

    const [active, setActive] = useState(false);
    const activeRef = useRef(false);
    activeRef.current = active;
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
                const start = startDeck('');
                if (!start) return;
                currentKeyRef.current = start.key;
                setFrame({ current: start, outgoing: null, gen: 0 });
                setActive(true);
            }, IDLE_MS);
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
    }, [enabled, slides.length]);

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
        }, SLIDE_MS);
        return () => window.clearInterval(id);
    }, [active, slides.length]);

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

    const { current, outgoing, gen } = frame;
    const watermark = String(sourceLabel || '').trim();
    const clockNudge = shiftClock ? CLOCK_NUDGES[Math.abs(gen) % CLOCK_NUDGES.length] : null;

    // Portal to <body>: inside Home a parent stacking context let the nav rail draw on top.
    return createPortal((
        <div
            className="player-tv-screensaver"
            data-tv-screensaver="1"
            aria-hidden
        >
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
                className={`player-tv-screensaver-slide${outgoing ? ' player-tv-screensaver-slide--enter' : ''}`}
                src={current.artUrl}
                draggable={false}
            />
            <div className="player-tv-screensaver-scrim" />
            <div className="player-tv-screensaver-footer">
                {watermark ? (
                    <p className="player-tv-screensaver-watermark">{watermark}</p>
                ) : null}
                <p
                    className="player-tv-screensaver-clock"
                    style={clockNudge ? { transform: `translate(${clockNudge.x}px, ${clockNudge.y}px)` } : undefined}
                >
                    {clock}
                </p>
                {current.logoUrl ? (
                    <PlayerClearLogo
                        src={current.logoUrl}
                        alt={current.title}
                        className="player-tv-screensaver-logo"
                    />
                ) : current.title ? (
                    <p className="player-tv-screensaver-title">{current.title}</p>
                ) : null}
            </div>
        </div>
    ), document.body);
};
