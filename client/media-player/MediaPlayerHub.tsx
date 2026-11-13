import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import {
    DiscoverGridSizeSelect,
    discoveryTheme,
    homeRailPosterDensity,
    PosterGridSkeleton,
    posterGridScaleRem,
    upgraderPosterGridClass,
    upgraderPosterGridStyle,
    useDiscoverGridSize,
    useDiscoverI18n,
} from './host';
import { fetchMediaPlayerHub, setMediaPlayerWatched } from './api';
import { PLAYER_SCROLL_ID } from './paths';
import { PlayerPosterCard } from './PlayerPosterCard';
import { PlayerTvStatusPanel } from './PlayerTvStatusPanel';
import { classifyPlayerHomeHub, stabilizeContinueWatchingOrder } from './playerSettings';
import { hideWatchedPlayerItems, withShowPoster } from './playerUtils';
import { usePlayerSettings } from './usePlayerSettings';
import type { PlayerItem, PlayerPlayOptions } from './types';

/** Posters the row already showed, handed over when its View more opens this page. */
const hubSeeds = new Map<string, PlayerItem[]>();
export const seedHubItems = (path: string, items: PlayerItem[] | null | undefined) => {
    if (path && items?.length) hubSeeds.set(path, items);
};

type Props = {
    path: string;
    title?: string;
    identifier?: string;
    onBack: () => void;
    onOpenItem: (item: PlayerItem) => void;
    onPlay: (item: PlayerItem, opts?: PlayerPlayOptions) => void;
};

const isTvShell = () => {
    try {
        return document.documentElement?.dataset?.tv === '1'
            || window.__PLEX_CLIENT__?.isTv === true;
    } catch {
        return false;
    }
};

export const MediaPlayerHub: React.FC<Props> = ({
    path,
    title: titleHint = '',
    identifier = '',
    onBack,
    onOpenItem,
    onPlay,
}) => {
    const { t } = useDiscoverI18n();
    const [settings] = usePlayerSettings();
    const [gridSize, setGridSize] = useDiscoverGridSize();
    const [title, setTitle] = useState(titleHint || t('common.viewMore'));
    // Start with the row's own posters so the page is never blank; the full list replaces them.
    const [items, setItems] = useState<PlayerItem[]>(() => hubSeeds.get(path) || []);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const tvShell = isTvShell();
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const limitRef = useRef(0);
    const sentinelRef = useRef<HTMLDivElement | null>(null);
    const itemCountRef = useRef(0);

    useEffect(() => {
        limitRef.current = 0;
        setHasMore(false);
    }, [path]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        const seed = hubSeeds.get(path);
        if (seed?.length) setItems(seed);
        fetchMediaPlayerHub(path, { title: titleHint, identifier })
            .then((data) => {
                if (cancelled) return;
                setTitle(data.title || titleHint || t('common.viewMore'));
                const full = data.items || [];
                setItems(full.length || !seed?.length ? full : seed);
                setHasMore(data.hasMore === true);
                setError(null);
                hubSeeds.delete(path);
            })
            .catch((err) => {
                if (cancelled) return;
                setError(String(err?.message || t('mediaPlayerPage.loadError')));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [path, titleHint, identifier, t]);

    itemCountRef.current = items.length;

    // Near the bottom: ask for a bigger window (600, 1200, 2000 titles) and swap the list in.
    useEffect(() => {
        const node = sentinelRef.current;
        if (!node || !hasMore || loading || loadingMore || typeof IntersectionObserver === 'undefined') return undefined;
        const observer = new IntersectionObserver((entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            observer.disconnect();
            const limit = limitRef.current ? Math.min(2000, limitRef.current * 2) : 600;
            limitRef.current = limit;
            setLoadingMore(true);
            fetchMediaPlayerHub(path, { title: titleHint, identifier, limit })
                .then((data) => {
                    const next = data.items || [];
                    if (next.length > itemCountRef.current) setItems(next);
                    setHasMore(data.hasMore === true && next.length > itemCountRef.current && limit < 2000);
                })
                .catch(() => setHasMore(false))
                .finally(() => setLoadingMore(false));
        }, { root: document.getElementById(PLAYER_SCROLL_ID), rootMargin: '0px 0px 900px 0px' });
        observer.observe(node);
        return () => observer.disconnect();
    }, [hasMore, loading, loadingMore, items.length, path, titleHint, identifier]);

    const continueWatchingHub = classifyPlayerHomeHub({
        identifier,
        title: `${titleHint} ${title}`,
    }) === 'continueWatching'
        || /on[.\s_-]?deck/i.test(String(path || ''));
    const recentHub = /recently\s*added|recentlyadded/i.test(`${identifier} ${titleHint} ${title} ${path}`);
    // Posters, like the Home rows: an episode shows its show's poster, not a small still.
    const shownItems = (continueWatchingHub
        ? stabilizeContinueWatchingOrder(items, settings.continueWatchingSort).items
        : (recentHub && settings.hideWatchedFromRecents ? hideWatchedPlayerItems(items) : items)
    ).map(withShowPoster);
    // TV: every card the width of a Home row poster, whatever the grid-size setting says.
    const tvCardRem = posterGridScaleRem(homeRailPosterDensity(gridSize));
    const gridStyle = tvShell
        ? {
            gridTemplateColumns: `repeat(auto-fill, calc(${tvCardRem}rem / var(--tv-text-scale, 1)))`,
            gap: '1rem',
        }
        : upgraderPosterGridStyle(gridSize);

    const toggleWatched = async (item: PlayerItem) => {
        const next = !item.watched;
        setItems((prev) => prev.map((row) => (
            row.ratingKey === item.ratingKey ? { ...row, watched: next } : row
        )));
        try {
            await setMediaPlayerWatched(item.ratingKey, next, item);
        } catch {
            setItems((prev) => prev.map((row) => (
                row.ratingKey === item.ratingKey ? { ...row, watched: item.watched } : row
            )));
        }
    };

    if (tvShell && error) {
        return (
            <PlayerTvStatusPanel
                title={error}
                onRetry={() => {
                    setError(null);
                    setLoading(true);
                    fetchMediaPlayerHub(path, { title: titleHint, identifier })
                        .then((data) => {
                            setTitle(data.title || titleHint || t('common.viewMore'));
                            setItems(data.items || []);
                            setError(null);
                        })
                        .catch((err) => setError(String(err?.message || t('mediaPlayerPage.loadError'))))
                        .finally(() => setLoading(false));
                }}
                onBack={onBack}
            />
        );
    }

    return (
        <div className="flex flex-col gap-5 pb-8" data-tv-grid-top={tvShell ? '1' : undefined}>
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    {!tvShell ? (
                        <button
                            type="button"
                            onClick={onBack}
                            className="player-page-back mb-2 inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-text"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            {t('mediaPlayerPage.back')}
                        </button>
                    ) : null}
                    <h1 className={`${discoveryTheme.heading}${tvShell ? ' text-white' : ''}`}>{title}</h1>
                </div>
                {!tvShell ? (
                    <DiscoverGridSizeSelect value={gridSize} onChange={setGridSize} />
                ) : null}
            </div>

            {loading && !shownItems.length ? (
                <PosterGridSkeleton
                    className={upgraderPosterGridClass(gridSize)}
                    style={gridStyle}
                    {...(tvShell ? { count: 24, variant: 'home' as const } : {})}
                />
            ) : error && !shownItems.length ? (
                <div className={discoveryTheme.emptyState}>
                    <p className={discoveryTheme.emptyTitle}>{error}</p>
                </div>
            ) : !shownItems.length ? (
                <div className={discoveryTheme.emptyState}>
                    <p className={discoveryTheme.emptyTitle}>{t('mediaPlayerPage.emptyLibrary')}</p>
                </div>
            ) : (
                <div
                    className={upgraderPosterGridClass(gridSize)}
                    style={gridStyle}
                    data-tv-rail={tvShell ? '1' : undefined}
                    data-tv-poster-rail={tvShell ? '1' : undefined}
                >
                    {shownItems.map((item, index) => (
                        <PlayerPosterCard
                            key={item.ratingKey}
                            item={item}
                            aspect="2/3"
                            imagePriority={index < 12}
                            onOpenItem={onOpenItem}
                            onPlay={onPlay}
                            onToggleWatched={toggleWatched}
                        />
                    ))}
                </div>
            )}
            {hasMore || loadingMore ? <div ref={sentinelRef} aria-hidden className="h-8 w-full" /> : null}
        </div>
    );
};
