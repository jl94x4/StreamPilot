import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
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
import { fetchMediaPlayerHeroArt, fetchMediaPlayerHub, setMediaPlayerWatched } from './api';
import { PLAYER_SCROLL_ID } from './paths';
import { PlayerPosterCard } from './PlayerPosterCard';
import { PlayerTvStatusPanel } from './PlayerTvStatusPanel';
import { classifyPlayerHomeHub, stabilizeContinueWatchingOrder } from './playerSettings';
import { heroRowCardItem, hideWatchedPlayerItems, withShowPoster } from './playerUtils';
import { usePlayerSettings } from './usePlayerSettings';
import type { PlayerItem, PlayerPlayOptions } from './types';

/** Posters the row already showed, handed over when its View more opens this page. */
const hubSeeds = new Map<string, PlayerItem[]>();
export const seedHubItems = (path: string, items: PlayerItem[] | null | undefined) => {
    if (path && items?.length) hubSeeds.set(path, items);
};

/** Rows labelled Heroes show 16:9 tiles on Home; their View more page keeps them. Keyed by hub path or collection key. */
const HERO_GRID_KEY = 'smp-hero-grids';
const readHeroGrids = (): Record<string, true> => {
    try {
        return JSON.parse(window.sessionStorage?.getItem(HERO_GRID_KEY) || '{}') || {};
    } catch {
        return {};
    }
};
export const markHeroGrid = (id: string | null | undefined, hero: boolean) => {
    const key = String(id || '').trim();
    if (!key) return;
    try {
        const next = readHeroGrids();
        if (hero) next[key] = true; else delete next[key];
        window.sessionStorage?.setItem(HERO_GRID_KEY, JSON.stringify(next));
    } catch { /* ignore */ }
};
export const isHeroGrid = (id: string | null | undefined) => !!readHeroGrids()[String(id || '').trim()];
/** Title-art covers for the titles of a Heroes View more page (the Home row already has them; the full list does not). */
export const useHeroArt = (items: PlayerItem[], enabled: boolean) => {
    const [art, setArt] = useState<Record<string, string>>({});
    const asked = useRef<Set<string>>(new Set());
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; };
    }, []);
    useEffect(() => {
        if (!enabled) return;
        const fresh = items.filter((row) => row.ratingKey && !asked.current.has(String(row.ratingKey)));
        if (!fresh.length) return;
        fresh.forEach((row) => asked.current.add(String(row.ratingKey)));
        void fetchMediaPlayerHeroArt(fresh).then((map) => {
            if (alive.current && Object.keys(map).length) setArt((prev) => ({ ...prev, ...map }));
        });
    }, [items, enabled]);
    return art;
};
/** A hero tile for one title: its cover art when we have it, else the plain still. */
export const heroTile = (row: PlayerItem, art: Record<string, string>): PlayerItem => (
    heroRowCardItem(art[String(row.ratingKey)] ? { ...row, heroArt: art[String(row.ratingKey)] } : row)
);
/** Column template for 16:9 tiles (the poster templates are far too narrow for them). */
export const heroGridStyle = (tvShell: boolean): React.CSSProperties => ({
    gridTemplateColumns: tvShell
        ? 'repeat(auto-fill, calc(26rem / var(--tv-text-scale, 1)))'
        : 'repeat(auto-fill, minmax(min(100%, 16rem), 1fr))',
    gap: tvShell ? '1rem' : '0.9rem',
});

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

/** Titles added each time the View more page nears its bottom. */
const HUB_PAGE_SIZE = 120;

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
    const nextStartRef = useRef(0);
    // Random rows: the big shuffled window, handed out a screenful at a time.
    const randomRef = useRef(false);
    const poolRef = useRef<PlayerItem[] | null>(null);
    const itemsRef = useRef<PlayerItem[]>([]);
    const sentinelRef = useRef<HTMLDivElement | null>(null);
    const itemCountRef = useRef(0);

    useEffect(() => {
        nextStartRef.current = 0;
        randomRef.current = false;
        poolRef.current = null;
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
                nextStartRef.current = Number(data.nextStart) || full.length;
                randomRef.current = data.random === true;
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
    itemsRef.current = items;

    // Near the bottom: fetch the next page and add it to the list, again and again while it keeps
    // coming into view, so a long row fills in as you scroll.
    useEffect(() => {
        const node = sentinelRef.current;
        if (!node || !hasMore || loading || loadingMore || typeof IntersectionObserver === 'undefined') return undefined;
        const observer = new IntersectionObserver((entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            observer.disconnect();
            if (randomRef.current) {
                const keyOf = (row: PlayerItem) => `${row.serverId || ''}:${row.ratingKey || ''}`;
                const revealNext = (pool: PlayerItem[]) => {
                    const seen = new Set(itemsRef.current.map(keyOf));
                    const fresh = pool.filter((row) => !seen.has(keyOf(row)));
                    const batch = fresh.slice(0, HUB_PAGE_SIZE);
                    if (batch.length) setItems((current) => [...current, ...batch]);
                    setHasMore(fresh.length > batch.length);
                };
                if (poolRef.current) {
                    revealNext(poolRef.current);
                    return;
                }
                setLoadingMore(true);
                fetchMediaPlayerHub(path, { title: titleHint, identifier, limit: 2000 })
                    .then((data) => {
                        poolRef.current = data.items || [];
                        revealNext(poolRef.current);
                    })
                    .catch(() => setHasMore(false))
                    .finally(() => setLoadingMore(false));
                return;
            }
            const start = nextStartRef.current;
            setLoadingMore(true);
            fetchMediaPlayerHub(path, { title: titleHint, identifier, start, size: HUB_PAGE_SIZE })
                .then((data) => {
                    const page = data.items || [];
                    const moved = Number(data.nextStart) > start;
                    if (moved) nextStartRef.current = Number(data.nextStart);
                    setItems((current) => {
                        const seen = new Set(current.map((row) => `${row.serverId || ''}:${row.ratingKey || ''}`));
                        const added = page.filter((row) => !seen.has(`${row.serverId || ''}:${row.ratingKey || ''}`));
                        return added.length ? [...current, ...added] : current;
                    });
                    setHasMore(data.hasMore === true && moved);
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
    const heroGrid = isHeroGrid(path);
    const heroArt = useHeroArt(items, heroGrid);
    // Posters, like the Home rows: an episode shows its show's poster, not a small still.
    const shownItems = (continueWatchingHub
        ? stabilizeContinueWatchingOrder(items, settings.continueWatchingSort).items
        : (recentHub && settings.hideWatchedFromRecents ? hideWatchedPlayerItems(items) : items)
    ).map((row) => (heroGrid ? heroTile(row, heroArt) : withShowPoster(row)));
    // TV: every card the width of a Home row poster, whatever the grid-size setting says.
    const tvCardRem = posterGridScaleRem(homeRailPosterDensity(gridSize));
    const gridStyle = heroGrid ? heroGridStyle(tvShell) : tvShell
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
                    aspect={heroGrid ? '16/9' : undefined}
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
                            aspect={heroGrid ? '16/9' : '2/3'}
                            imagePriority={index < 12}
                            onOpenItem={onOpenItem}
                            onPlay={onPlay}
                            onToggleWatched={toggleWatched}
                        />
                    ))}
                </div>
            )}
            {hasMore || loadingMore ? (
                <div ref={sentinelRef} className="flex h-16 w-full items-center justify-center" aria-hidden={!loadingMore}>
                    {loadingMore ? (
                        <span className="inline-flex items-center gap-2 text-sm font-semibold text-white/70" role="status">
                            <Loader2 className="h-5 w-5 animate-spin text-plex" />
                            {t('mediaPlayerPage.loadingMore')}
                        </span>
                    ) : null}
                </div>
            ) : (!loading && !error && items.length >= 20 ? (
                <p className="flex h-16 w-full items-center justify-center text-sm font-semibold text-white/45">
                    {t('mediaPlayerPage.endOfList')}
                </p>
            ) : null)}
        </div>
    );
};
