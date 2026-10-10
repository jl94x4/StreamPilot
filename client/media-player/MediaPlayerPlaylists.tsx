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
import { fetchMediaPlayerPlaylists } from './api';
import { PlayerPosterCard } from './PlayerPosterCard';
import { PlayerTvStatusPanel } from './PlayerTvStatusPanel';
import type { PlayerItem, PlayerPlayOptions } from './types';

type Props = {
    onBack: () => void;
    onOpenItem: (item: PlayerItem) => void;
    onPlay: (item: PlayerItem, opts?: PlayerPlayOptions) => void;
    onPlayNext?: (item: PlayerItem) => void;
    onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
    isAdmin?: boolean;
    playlistsEnabled?: boolean;
};

const isTvShell = () => {
    try {
        return document.documentElement?.dataset?.tv === '1'
            || window.__PLEX_CLIENT__?.isTv === true;
    } catch {
        return false;
    }
};

export const MediaPlayerPlaylists: React.FC<Props> = ({
    onBack,
    onOpenItem,
    onPlay,
    onPlayNext,
    onToast,
    isAdmin = false,
    playlistsEnabled = true,
}) => {
    const { t } = useDiscoverI18n();
    const [gridSize, setGridSize] = useDiscoverGridSize();
    const [items, setItems] = useState<PlayerItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const tvShell = isTvShell();

    const load = () => {
        setLoading(true);
        fetchMediaPlayerPlaylists({ force: true })
            .then((data) => {
                setItems(data.items || []);
                setError(null);
            })
            .catch((err) => setError(String(err?.message || t('mediaPlayerPage.loadError'))))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetchMediaPlayerPlaylists({ force: true })
            .then((data) => {
                if (cancelled) return;
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
    }, [t]);

    if (tvShell && error) {
        return (
            <PlayerTvStatusPanel
                title={error}
                onRetry={load}
                onBack={onBack}
            />
        );
    }

    return (
        <div className="flex flex-col gap-5 pb-8">
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
                    <h1 className={discoveryTheme.heading}>{t('mediaPlayerPage.playlists')}</h1>
                </div>
                {!tvShell ? (
                    <DiscoverGridSizeSelect value={gridSize} onChange={setGridSize} />
                ) : null}
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
                    <p className={discoveryTheme.emptyTitle}>{t('mediaPlayerPage.emptyPlaylists')}</p>
                </div>
            ) : (
                <div
                    className={upgraderPosterGridClass(gridSize)}
                    style={upgraderPosterGridStyle(gridSize)}
                    data-tv-rail={tvShell ? '1' : undefined}
                    data-tv-poster-rail={tvShell ? '1' : undefined}
                >
                    {items.map((item, index) => (
                        <PlayerPosterCard
                            key={item.ratingKey}
                            item={item}
                            imagePriority={index < 12}
                            onOpenItem={onOpenItem}
                            onPlay={onPlay}
                            onPlayNext={onPlayNext}
                            onToast={onToast}
                            isAdmin={isAdmin}
                            playlistsEnabled={playlistsEnabled}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};
