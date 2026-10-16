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
import { fetchMediaPlayerPlaylist, setMediaPlayerWatched } from './api';
import { PlayerPosterCard } from './PlayerPosterCard';
import type { PlayerItem, PlayerPlayOptions } from './types';

type Props = {
    ratingKey: string;
    onBack: () => void;
    onOpenItem: (item: PlayerItem) => void;
    onPlay: (item: PlayerItem, opts?: PlayerPlayOptions) => void;
};

export const MediaPlayerPlaylist: React.FC<Props> = ({ ratingKey, onBack, onOpenItem, onPlay }) => {
    const { t } = useDiscoverI18n();
    const [gridSize, setGridSize] = useDiscoverGridSize();
    const [title, setTitle] = useState(t('mediaPlayerPage.playlists'));
    const [items, setItems] = useState<PlayerItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const tvShell = typeof document !== 'undefined' && (
        document.documentElement?.dataset?.tv === '1' || window.__PLEX_CLIENT__?.isTv === true
    );

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetchMediaPlayerPlaylist(ratingKey)
            .then((data) => {
                if (cancelled) return;
                setTitle(data.item?.title || t('mediaPlayerPage.playlists'));
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
    }, [ratingKey, t]);

    const toggleWatched = async (item: PlayerItem) => {
        const next = !item.watched;
        setItems((prev) => prev.map((row) => (
            row.ratingKey === item.ratingKey ? { ...row, watched: next, viewCount: next ? Math.max(1, row.viewCount || 0) : 0 } : row
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
                    <p className={discoveryTheme.personalEyebrow}>{t('mediaPlayerPage.playlists')}</p>
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
                    <p className={discoveryTheme.emptyTitle}>{t('mediaPlayerPage.emptyPlaylist')}</p>
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
