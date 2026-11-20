import React, { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import {
    DiscoverGridSizeSelect,
    discoveryTheme,
    PosterGridSkeleton,
    upgraderPosterGridClass,
    upgraderPosterGridStyle,
    useDiscoverGridSize,
    useDiscoverI18n,
} from './host';
import { fetchMediaPlayerCollection, setMediaPlayerWatched } from './api';
import { heroGridStyle, heroTile, isHeroGrid, useHeroArt } from './MediaPlayerHub';
import { PlayerPosterCard } from './PlayerPosterCard';
import { PlayerTvStatusPanel } from './PlayerTvStatusPanel';
import { useNativeBrowseGrid } from './useNativeBrowseGrid';
import { usePlayerSettings } from './usePlayerSettings';
import { newSeasonInfo, premiereLineText } from './playerUtils';
import type { PlayerItem, PlayerPlayOptions } from './types';

type Props = {
    ratingKey: string;
    sectionKey?: string;
    onBack: () => void;
    onOpenItem: (item: PlayerItem) => void;
    onPlay: (item: PlayerItem, opts?: PlayerPlayOptions) => void;
};

export const MediaPlayerCollection: React.FC<Props> = ({ ratingKey, sectionKey = '', onBack, onOpenItem, onPlay }) => {
    const { t } = useDiscoverI18n();
    const [gridSize, setGridSize] = useDiscoverGridSize();
    const [title, setTitle] = useState(t('mediaPlayerPage.collections'));
    const [items, setItems] = useState<PlayerItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const retry = () => setAttempt((n) => n + 1);
    const heroGrid = isHeroGrid(ratingKey);
    const heroArt = useHeroArt(items, heroGrid);
    const tvShell = typeof document !== 'undefined' && (
        document.documentElement?.dataset?.tv === '1' || window.__PLEX_CLIENT__?.isTv === true
    );

    const [settings] = usePlayerSettings();
    const shownItems = React.useMemo(
        () => (heroGrid ? items.map((item) => heroTile(item, heroArt)) : items),
        [heroGrid, heroArt, items],
    );

    // The poster grid is drawn by the native view on Android TV (Native Home on); the page keeps its own copy for actions.
    useNativeBrowseGrid({
        active: tvShell,
        loading,
        error: Boolean(error),
        items: shownItems,
        captions: {
            sub: (item) => (item.year ? String(item.year) : ''),
            note: (item) => (settings.showNewSeasonBadge && !item.heroCard ? premiereLineText(newSeasonInfo(item), t) || '' : ''),
        },
        tickPosition: settings.watchedTickPosition,
        resetKey: `collection:${ratingKey}`,
        onOpenItem,
    });

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetchMediaPlayerCollection(ratingKey, sectionKey || undefined)
            .then((data) => {
                if (cancelled) return;
                setTitle(data.item?.title || t('mediaPlayerPage.collections'));
                setItems(data.children || []);
                setError(null);
            })
            .catch((err) => {
                if (cancelled) return;
                setError(String(err?.message || t('mediaPlayerPage.loadError')));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [ratingKey, sectionKey, t, attempt]);

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

    return (
        <div className="flex flex-col gap-5 pb-8" data-tv-grid-top={tvShell ? '1' : undefined} data-tv-browse-root={tvShell ? '1' : undefined}>
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <button
                        type="button"
                        onClick={onBack}
                        className="player-page-back mb-2 inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-text"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        {t('mediaPlayerPage.back')}
                    </button>
                    <p className={discoveryTheme.personalEyebrow}>{t('mediaPlayerPage.collections')}</p>
                    <h1 className={discoveryTheme.heading}>{title}</h1>
                </div>
                <DiscoverGridSizeSelect value={gridSize} onChange={setGridSize} />
            </div>

            {loading ? (
                    <PosterGridSkeleton
                        className={upgraderPosterGridClass(gridSize)}
                        style={heroGrid ? heroGridStyle(tvShell) : upgraderPosterGridStyle(gridSize)}
                        aspect={heroGrid ? '16/9' : undefined}
                        {...(tvShell ? { count: 24, variant: 'home' as const } : {})}
                    />
            ) : error && tvShell ? (
                <PlayerTvStatusPanel title={error} onRetry={retry} onBack={onBack} />
            ) : error ? (
                <div className={discoveryTheme.emptyState}>
                    <p className={discoveryTheme.emptyTitle}>{error}</p>
                </div>
            ) : !items.length ? (
                <div className={discoveryTheme.emptyState}>
                    <p className={discoveryTheme.emptyTitle}>{t('mediaPlayerPage.emptyCollection')}</p>
                </div>
            ) : (
                <div
                    className={upgraderPosterGridClass(gridSize)}
                    style={heroGrid ? heroGridStyle(tvShell) : upgraderPosterGridStyle(gridSize)}
                    data-tv-browse-grid={tvShell ? '1' : undefined}
                    data-tv-row={tvShell ? '1' : undefined}
                    data-tv-rail={tvShell ? '1' : undefined}
                    data-tv-poster-grid={tvShell ? '1' : undefined}
                >
                    {items.map((item, index) => (
                        <PlayerPosterCard
                            key={item.ratingKey}
                            browseIndex={tvShell ? index : undefined}
                            item={heroGrid ? heroTile(item, heroArt) : item}
                            aspect={heroGrid ? '16/9' : undefined}
                            onOpenItem={onOpenItem}
                            onPlay={onPlay}
                            onToggleWatched={toggleWatched}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};
