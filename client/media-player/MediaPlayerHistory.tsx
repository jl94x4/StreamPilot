import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import {
    DiscoverGridSizeSelect,
    discoveryTheme,
    PosterGridSkeleton,
    RowHeaderMark,
    upgraderPosterGridClass,
    upgraderPosterGridStyle,
    useDiscoverGridSize,
    useDiscoverI18n,
} from './host';
import { fetchMediaPlayerHistory, setMediaPlayerWatched } from './api';
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

type HistoryGroup = { label: string; items: PlayerItem[] };

const DAY_MS = 86_400_000;

const isTvShell = () => {
    try {
        return document.documentElement?.dataset?.tv === '1'
            || window.__PLEX_CLIENT__?.isTv === true;
    } catch {
        return false;
    }
};

/** Today / Yesterday / This week / Earlier this month, then one group per month. */
const groupHistory = (
    items: PlayerItem[],
    t: (key: string) => string,
    locale: string,
): HistoryGroup[] => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const groups: HistoryGroup[] = [];
    for (const item of items) {
        const at = Number(item.lastViewedAt) || 0;
        const date = new Date(at);
        let label: string;
        if (at >= today) label = t('mediaPlayerPage.historyToday');
        else if (at >= today - DAY_MS) label = t('mediaPlayerPage.historyYesterday');
        else if (at >= today - 6 * DAY_MS) label = t('mediaPlayerPage.historyThisWeek');
        else if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) {
            label = t('mediaPlayerPage.historyThisMonth');
        } else {
            label = date.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
        }
        const last = groups[groups.length - 1];
        if (last && last.label === label) last.items.push(item);
        else groups.push({ label, items: [item] });
    }
    return groups;
};

export const MediaPlayerHistory: React.FC<Props> = ({
    onBack,
    onOpenItem,
    onPlay,
    onPlayNext,
    onToast,
    isAdmin = false,
    playlistsEnabled = true,
}) => {
    const { t, locale } = useDiscoverI18n();
    const [gridSize, setGridSize] = useDiscoverGridSize();
    const [items, setItems] = useState<PlayerItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const tvShell = isTvShell();

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetchMediaPlayerHistory()
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
    }, [t, attempt]);

    const groups = useMemo(() => groupHistory(items, t, locale), [items, t, locale]);

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

    const heading = <h1 className={discoveryTheme.heading}>{t('mediaPlayerPage.navHistory')}</h1>;

    if (tvShell && error && !loading) {
        return (
            <div className="flex flex-col gap-5 pb-8">
                {heading}
                <PlayerTvStatusPanel
                    title={error}
                    onRetry={() => setAttempt((n) => n + 1)}
                    onBack={onBack}
                />
            </div>
        );
    }

    if (tvShell && !loading && !items.length) {
        return (
            <div className="flex flex-col gap-5 pb-8">
                {heading}
                <PlayerTvStatusPanel title={t('mediaPlayerPage.historyEmpty')} onBack={onBack} />
            </div>
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
                    {heading}
                </div>
                {!tvShell ? (
                    <DiscoverGridSizeSelect value={gridSize} onChange={setGridSize} />
                ) : null}
            </div>

            {loading ? (
                <PosterGridSkeleton
                    className={upgraderPosterGridClass(gridSize)}
                    style={upgraderPosterGridStyle(gridSize)}
                    {...(tvShell ? { count: 24, variant: 'home' as const } : {})}
                />
            ) : error ? (
                <div className={discoveryTheme.emptyState}>
                    <p className={discoveryTheme.emptyTitle}>{error}</p>
                </div>
            ) : !items.length ? (
                <div className={discoveryTheme.emptyState}>
                    <p className={discoveryTheme.emptyTitle}>{t('mediaPlayerPage.historyEmpty')}</p>
                </div>
            ) : (
                groups.map((group, groupIndex) => (
                    <section key={group.label} className="flex flex-col gap-2">
                        <div className="player-row-header flex min-w-0 items-center gap-3">
                            <RowHeaderMark />
                            <h2 className="player-row-header-title text-lg font-black text-white">{group.label}</h2>
                        </div>
                        <div
                            className={upgraderPosterGridClass(gridSize)}
                            style={upgraderPosterGridStyle(gridSize)}
                            data-tv-row={tvShell ? '1' : undefined}
                            data-tv-rail={tvShell ? '1' : undefined}
                            data-tv-poster-grid={tvShell ? '1' : undefined}
                            data-tv-row-id={tvShell ? `history:${group.label}` : undefined}
                        >
                            {group.items.map((item, index) => (
                                <PlayerPosterCard
                                    key={item.ratingKey}
                                    item={item}
                                    imagePriority={groupIndex === 0 && index < 12}
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
                    </section>
                ))
            )}
        </div>
    );
};
