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
import { fetchMediaPlayerStudio, setMediaPlayerWatched } from './api';
import { PlayerPosterCard } from './PlayerPosterCard';
import type { PlayerItem, PlayerPlayOptions } from './types';

type Props = {
    studioKey: string;
    name?: string;
    sectionKey?: string;
    mediaType?: 'movie' | 'show';
    onBack: () => void;
    onOpenItem: (item: PlayerItem) => void;
    onPlay: (item: PlayerItem, opts?: PlayerPlayOptions) => void;
};

export const MediaPlayerStudio: React.FC<Props> = ({
    studioKey,
    name,
    sectionKey,
    mediaType,
    onBack,
    onOpenItem,
    onPlay,
}) => {
    const { t } = useDiscoverI18n();
    const [gridSize, setGridSize] = useDiscoverGridSize();
    const [title, setTitle] = useState(name || (mediaType === 'show' ? t('mediaPlayerPage.network') : t('media.studio')));
    const [items, setItems] = useState<PlayerItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const tvShell = typeof document !== 'undefined' && (
        document.documentElement?.dataset?.tv === '1' || window.__PLEX_CLIENT__?.isTv === true
    );
    const eyebrow = mediaType === 'show' ? t('mediaPlayerPage.network') : t('media.studio');

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetchMediaPlayerStudio(studioKey, { name, sectionKey, mediaType })
            .then((data) => {
                if (cancelled) return;
                setTitle(data.studio?.name || name || eyebrow);
                setItems(data.items || []);
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
    }, [eyebrow, mediaType, name, sectionKey, studioKey, t]);

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
        <div className="flex flex-col gap-5 pb-8">
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
                    <p className={discoveryTheme.personalEyebrow}>{eyebrow}</p>
                    <h1 className={discoveryTheme.heading}>{title}</h1>
                </div>
                <DiscoverGridSizeSelect value={gridSize} onChange={setGridSize} />
            </div>

            {loading && !tvShell ? (
                <PosterGridSkeleton
                    className={upgraderPosterGridClass(gridSize)}
                    style={upgraderPosterGridStyle(gridSize)}
                />
            ) : loading ? null : error ? (
                <div className={discoveryTheme.emptyState}>
                    <p className={discoveryTheme.emptyTitle}>{error}</p>
                </div>
            ) : !items.length ? (
                <div className={discoveryTheme.emptyState}>
                    <p className={discoveryTheme.emptyTitle}>{t('mediaPlayerPage.emptyStudio')}</p>
                </div>
            ) : (
                <div className={upgraderPosterGridClass(gridSize)} style={upgraderPosterGridStyle(gridSize)}>
                    {items.map((item) => (
                        <PlayerPosterCard
                            key={item.ratingKey}
                            item={item}
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
