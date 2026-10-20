import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fetchMediaPlayerScreensaver, fetchMediaPlayerWatchlist } from './api';
import { plexBackdropUrl, plexLogoUrl } from './playerUtils';
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

const shuffleInPlace = <T,>(list: T[]): T[] => {
    for (let i = list.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = list[i];
        list[i] = list[j];
        list[j] = tmp;
    }
    return list;
};

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
            item.art || item.heroArt || (item as { backdropUrl?: string }).backdropUrl || item.thumb || '',
        ).trim();
        if (!art) continue;
        const artUrl = plexBackdropUrl(art);
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
    return shuffleInPlace(out);
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
};

/**
 * TV Home idle ambient: cycles art from the chosen screensaver pool with a large
 * bottom-left clock. Any remote key / pointer dismisses and resets the idle timer.
 * Advances crossfade from the real previous slide to a random other slide.
 */
export const PlayerTvScreensaver: React.FC<Props> = ({
    enabled,
    continueWatchingItems,
    recommendedItems = [],
    source,
    sourceLabel,
}) => {
    const [remoteItems, setRemoteItems] = useState<PlayerItem[]>([]);
    const fetchGen = useRef(0);

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
            apply(continueWatchingItems);
            return () => { cancelled = true; };
        }
        if (source === 'recommended' && recommendedItems.length) {
            apply(recommendedItems);
            return () => { cancelled = true; };
        }
        if (source === 'watchlist') {
            void fetchMediaPlayerWatchlist(true)
                .then((data) => apply(data?.items || []))
                .catch(() => apply(continueWatchingItems));
            return () => { cancelled = true; };
        }

        void fetchMediaPlayerScreensaver(source)
            .then((data) => {
                const items = data?.items || [];
                apply(items.length ? items : continueWatchingItems);
            })
            .catch(() => apply(continueWatchingItems));

        return () => { cancelled = true; };
    }, [continueWatchingItems, enabled, recommendedItems, source]);

    const poolItems = useMemo(() => {
        if (source === 'continue_watching') return continueWatchingItems;
        if (source === 'recommended' && recommendedItems.length && !remoteItems.length) {
            return recommendedItems;
        }
        return remoteItems.length ? remoteItems : continueWatchingItems;
    }, [continueWatchingItems, recommendedItems, remoteItems, source]);

    const poolKey = useMemo(() => poolFingerprint(poolItems), [poolItems]);
    const poolItemsRef = useRef(poolItems);
    poolItemsRef.current = poolItems;

    // Only reshuffle when the underlying titles/art actually change — not on every
    // Home re-render with a fresh array identity.
    const slides = useMemo(
        () => slidesFromItems(poolItemsRef.current),
        [poolKey],
    );
    const slidesRef = useRef(slides);
    slidesRef.current = slides;

    const [active, setActive] = useState(false);
    const [clock, setClock] = useState(() => formatClock(new Date()));
    const [frame, setFrame] = useState<{
        current: Slide;
        outgoing: Slide | null;
        gen: number;
    } | null>(null);
    const currentKeyRef = useRef('');

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
                const pool = slidesRef.current;
                if (!pool.length) return;
                const start = pool[Math.floor(Math.random() * pool.length)];
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

        const onActivity = () => {
            if (cancelled) return;
            if (document.visibilityState === 'hidden') return;
            dismiss();
        };

        armIdle();
        window.addEventListener('keydown', onActivity, true);
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
            window.removeEventListener('keydown', onActivity, true);
            window.removeEventListener('pointerdown', onActivity, true);
            window.removeEventListener('wheel', onActivity, true);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [enabled, slides.length]);

    // Advance: fade out the slide that is actually on screen, not array[index-1].
    useEffect(() => {
        if (!active || slides.length <= 1) return undefined;
        const id = window.setInterval(() => {
            const pool = slidesRef.current;
            if (pool.length <= 1) return;
            const currentKey = currentKeyRef.current;
            const currentIdx = Math.max(0, pool.findIndex((row) => row.key === currentKey));
            let nextIdx = Math.floor(Math.random() * (pool.length - 1));
            if (nextIdx >= currentIdx) nextIdx += 1;
            const next = pool[nextIdx];
            const outgoing = pool[currentIdx] || pool.find((row) => row.key === currentKey) || null;
            currentKeyRef.current = next.key;
            setFrame((prev) => ({
                current: next,
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

    // If the pool reshuffles while active, keep showing a valid current slide.
    useEffect(() => {
        if (!active || !slides.length) return;
        const stillThere = slides.some((row) => row.key === currentKeyRef.current);
        if (stillThere) return;
        const start = slides[Math.floor(Math.random() * slides.length)];
        currentKeyRef.current = start.key;
        setFrame({ current: start, outgoing: null, gen: 0 });
    }, [active, slides]);

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

    return (
        <div
            className="player-tv-screensaver"
            data-tv-screensaver="1"
            aria-hidden
        >
            {outgoing ? (
                <div
                    key={`out-${outgoing.key}-${gen}`}
                    className="player-tv-screensaver-slide player-tv-screensaver-slide--exit"
                    style={{ backgroundImage: `url(${outgoing.artUrl})` }}
                />
            ) : null}
            <div
                key={`cur-${current.key}-${gen}`}
                className={`player-tv-screensaver-slide${outgoing ? ' player-tv-screensaver-slide--enter' : ''}`}
                style={{ backgroundImage: `url(${current.artUrl})` }}
            />
            <div className="player-tv-screensaver-scrim" />
            <div className="player-tv-screensaver-footer">
                {watermark ? (
                    <p className="player-tv-screensaver-watermark">{watermark}</p>
                ) : null}
                <p className="player-tv-screensaver-clock">{clock}</p>
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
    );
};
