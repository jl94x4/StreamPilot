import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fetchMediaPlayerScreensaver, fetchMediaPlayerWatchlist } from './api';
import { plexBackdropUrl, plexLogoUrl } from './playerUtils';
import { PlayerClearLogo } from './PlayerClearLogo';
import type { PlayerScreensaverSource } from './playerSettings';
import type { PlayerItem } from './types';

const IDLE_MS = 120_000;
const SLIDE_MS = 14_000;

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

const randomOtherIndex = (current: number, length: number) => {
    if (length <= 1) return 0;
    let next = Math.floor(Math.random() * (length - 1));
    if (next >= current) next += 1;
    return next;
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
 * Slide order is shuffled; advances pick a random other slide (not sequential).
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

    const slides = useMemo(() => slidesFromItems(poolItems), [poolItems]);

    const [active, setActive] = useState(false);
    const [index, setIndex] = useState(0);
    const [clock, setClock] = useState(() => formatClock(new Date()));

    useEffect(() => {
        if (!enabled || slides.length === 0) {
            setActive(false);
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
                setIndex(Math.floor(Math.random() * slides.length));
                setActive(true);
            }, IDLE_MS);
        };

        const dismiss = () => {
            setActive(false);
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

    useEffect(() => {
        if (!active || slides.length <= 1) return undefined;
        const id = window.setInterval(() => {
            setIndex((n) => randomOtherIndex(n, slides.length));
        }, SLIDE_MS);
        return () => window.clearInterval(id);
    }, [active, slides.length]);

    useEffect(() => {
        if (!active) return undefined;
        const tick = () => setClock(formatClock(new Date()));
        tick();
        const id = window.setInterval(tick, 1000);
        return () => window.clearInterval(id);
    }, [active]);

    if (!active || !slides.length) return null;

    const current = slides[index % slides.length];
    const prev = slides[(index + slides.length - 1) % slides.length];
    const watermark = String(sourceLabel || '').trim();

    return (
        <div
            className="player-tv-screensaver"
            data-tv-screensaver="1"
            aria-hidden
        >
            {slides.length > 1 ? (
                <div
                    key={`prev-${prev.key}-${index}`}
                    className="player-tv-screensaver-slide player-tv-screensaver-slide--exit"
                    style={{ backgroundImage: `url(${prev.artUrl})` }}
                />
            ) : null}
            <div
                key={`cur-${current.key}-${index}`}
                className="player-tv-screensaver-slide player-tv-screensaver-slide--enter"
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
