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
import { PlayerTvStatusPanel } from './PlayerTvStatusPanel';
import type { PlayerItem, PlayerPlayOptions } from './types';

type Props = {
    ratingKey: string;
    onBack: () => void;
    onOpenItem: (item: PlayerItem) => void;
    onPlay: (item: PlayerItem, opts?: PlayerPlayOptions) => void;
    onPlayNext?: (item: PlayerItem) => void;
    onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
    isAdmin?: boolean;
    playlistsEnabled?: boolean;
};

export const MediaPlayerPlaylist: React.FC<Props> = ({
    ratingKey,
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
    const [title, setTitle] = useState(t('mediaPlayerPage.playlists'));
    const [items, setItems] = useState<PlayerItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const tvShell = typeof document !== 'undefined' && (
        document.documentElement?.dataset?.tv === '1' || window.__PLEX_CLIENT__?.isTv === true
    );

    const load = () => {
        setLoading(true);
        fetchMediaPlayerPlaylist(ratingKey)
            .then((data) => {
                setTitle(data.item?.title || t('mediaPlayerPage.playlists'));
                setItems(data.children || []);
                setError(null);
            })
            .catch((err) => setError(String(err?.message || t('mediaPlayerPage.loadError'))))
            .finally(() => setLoading(false));
    };

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
            row.ratingKey === item.ratingKey
                ? { ...row, watched: next, viewCount: next ? Math.max(1, row.viewCount || 0) : 0 }
                : row
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
                onRetry={load}
                onBack={onBack}
            />
        );
    }

    if (tvShell && !loading && !items.length && !error) {
        return (
            <div className="flex flex-col gap-5 pb-8" data-tv-playlist="1">
                <div>
                    <p className={discoveryTheme.personalEyebrow}>{t('mediaPlayerPage.playlists')}</p>
                    <h1 className={discoveryTheme.heading}>{title}</h1>
                </div>
                <PlayerTvStatusPanel
                    title={t('mediaPlayerPage.emptyPlaylist')}
                    onBack={onBack}
                />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-5 pb-8" data-tv-playlist={tvShell ? '1' : undefined}>
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
                    <p className={discoveryTheme.personalEyebrow}>{t('mediaPlayerPage.playlists')}</p>
                    <h1 className={discoveryTheme.heading}>{title}</h1>
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
                    <p className={discoveryTheme.emptyTitle}>{t('mediaPlayerPage.emptyPlaylist')}</p>
                </div>
            ) : (
                <div
                    className={upgraderPosterGridClass(gridSize)}
                    style={upgraderPosterGridStyle(gridSize)}
                    data-tv-row={tvShell ? '1' : undefined}
                    data-tv-rail={tvShell ? '1' : undefined}
                    data-tv-poster-grid={tvShell ? '1' : undefined}
                >
                    {items.map((item, index) => (
                        <PlayerPosterCard
                            key={item.ratingKey}
                            item={item}
                            imagePriority={index < 12}
                            onOpenItem={onOpenItem}
                            onPlay={onPlay}
                            onPlayNext={onPlayNext}
                            onToggleWatched={toggleWatched}
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
