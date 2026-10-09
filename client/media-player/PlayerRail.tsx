import React, { useEffect, useState } from 'react';
import { Carousel, DiscoverSectionHeader, discoverRowCardWidthClass, posterGridCardWidthStyle, posterGridScaleRem, useDiscoverI18n } from './host';
import { PlayerPosterCard } from './PlayerPosterCard';
import { PlayerViewMoreCard } from './PlayerViewMoreCard';
import { isMusicPlayerItem, playerCardImageUrl, prefetchPlayerImages, resizePlexArtUrl, resolvePlayerCardAspect } from './playerUtils';
import type { PlayerItem, PlayerPlayOptions } from './types';

const isTvShell = () => {
    try {
        return document.documentElement?.dataset?.tv === '1'
            || window.__PLEX_CLIENT__?.isTv === true;
    } catch {
        return false;
    }
};

export const PlayerRail: React.FC<{
    title: string;
    items: PlayerItem[];
    density: number;
    onOpenItem: (item: PlayerItem) => void;
    onPlay: (item: PlayerItem, opts?: PlayerPlayOptions) => void;
    onToggleWatched?: (item: PlayerItem) => void;
    onPlayNext?: (item: PlayerItem) => void;
    onWatchedChange?: (item: PlayerItem, watched: boolean) => void;
    onRemovedFromContinueWatching?: (item: PlayerItem) => void;
    onDeleted?: (item: PlayerItem) => void;
    onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
    showProgress?: boolean;
    showRemoveFromContinueWatching?: boolean;
    isAdmin?: boolean;
    playlistsEnabled?: boolean;
    /** Force card shape. Continue Watching should stay poster (`2/3`). */
    aspect?: '2/3' | 'square' | '16/9';
    onViewAll?: () => void;
    viewAllLabel?: string;
    staggerIndex?: number;
    /** Stable id for TV per-row focus restore (up/down). */
    rowId?: string;
}> = ({
    title,
    items,
    density,
    onOpenItem,
    onPlay,
    onToggleWatched,
    onPlayNext,
    onWatchedChange,
    onRemovedFromContinueWatching,
    onDeleted,
    onToast,
    showProgress = false,
    showRemoveFromContinueWatching = false,
    isAdmin = false,
    playlistsEnabled = true,
    aspect,
    onViewAll,
    viewAllLabel,
    staggerIndex = 0,
    rowId,
}) => {
    const { t } = useDiscoverI18n();
    const tvShell = isTvShell();
    const moreLabel = t('common.viewMore');
    const eagerCount = tvShell
        ? (staggerIndex === 0 ? 12 : staggerIndex <= 2 ? 6 : 2)
        : (staggerIndex === 0 ? 8 : 4);
    const tvArmedFloor = staggerIndex === 0 ? 14 : 8;
    const [armedCount, setArmedCount] = useState(() => (
        tvShell ? Math.min(items.length, tvArmedFloor) : items.length
    ));
    useEffect(() => {
        if (!tvShell) {
            setArmedCount(items.length);
            return;
        }
        setArmedCount((current) => {
            if (!items.length) return 0;
            return Math.min(items.length, Math.max(current, Math.min(tvArmedFloor, items.length)));
        });
    }, [items.length, tvArmedFloor, tvShell]);
    useEffect(() => {
        const take = tvShell ? Math.max(eagerCount, 12) : eagerCount + 8;
        const urls = items.slice(0, take).map((item) => {
            const cardAspect = resolvePlayerCardAspect(item, aspect);
            const raw = playerCardImageUrl(item.thumb, cardAspect);
            if (cardAspect === 'square') return resizePlexArtUrl(raw, 300, 300);
            if (cardAspect === '16/9') return resizePlexArtUrl(raw, 426, 240);
            return raw;
        });
        prefetchPlayerImages(urls, take);
    }, [aspect, eagerCount, items, tvShell]);

    if (!items.length) return null;
    const visibleItems = tvShell ? items.slice(0, Math.max(1, armedCount)) : items;
    return (
        <div
            data-tv-row="1"
            data-tv-row-id={rowId || `rail:${title}`}
            className="player-rail-enter flex min-w-0 max-w-full flex-col gap-2"
            style={{ animationDelay: `${Math.min(Math.max(staggerIndex, 0), 12) * 55}ms` }}
        >
            <DiscoverSectionHeader
                title={title}
                onViewAll={tvShell ? undefined : onViewAll}
                viewAllLabel={tvShell ? undefined : viewAllLabel}
            />
            <Carousel posterRow>
                {visibleItems.map((item, idx) => {
                    const cardAspect = resolvePlayerCardAspect(item, aspect);
                    const landscape = cardAspect === '16/9';
                    const square = cardAspect === 'square';
                    const cardWidth = landscape
                        ? { width: `${posterGridScaleRem(density) * 1.85}rem` }
                        : (square && tvShell
                            ? { width: `${posterGridScaleRem(density) * 1.25}rem` }
                            : posterGridCardWidthStyle(density));
                    return (
                        <div
                            key={item.ratingKey || `${title}-${idx}`}
                            className={`${landscape ? 'player-rail-landscape' : square ? 'player-rail-square' : discoverRowCardWidthClass(density)} relative z-0 flex-shrink-0 snap-start group hover:z-20 focus-within:z-20`}
                            style={cardWidth}
                            onFocusCapture={() => {
                                if (!tvShell) return;
                                setArmedCount((current) => Math.max(current, Math.min(items.length, idx + 5)));
                            }}
                        >
                            <PlayerPosterCard
                                item={item}
                                aspect={cardAspect}
                                imagePriority={idx < eagerCount}
                                showProgress={showProgress}
                                showRemoveFromContinueWatching={showRemoveFromContinueWatching}
                                isAdmin={isAdmin}
                                playlistsEnabled={playlistsEnabled}
                                onOpenItem={onOpenItem}
                                onPlay={onPlay}
                                onToggleWatched={onToggleWatched}
                                onPlayNext={onPlayNext}
                                onWatchedChange={onWatchedChange}
                                onRemovedFromContinueWatching={onRemovedFromContinueWatching}
                                onDeleted={onDeleted}
                                onToast={onToast}
                            />
                        </div>
                    );
                })}
                {tvShell && onViewAll ? (
                    <div
                        className={`${aspect === '16/9' ? 'player-rail-landscape' : aspect === 'square' ? 'player-rail-square' : discoverRowCardWidthClass(density)} relative z-0 flex-shrink-0 snap-start hover:z-20 focus-within:z-20`}
                        style={aspect === '16/9'
                            ? { width: `${posterGridScaleRem(density) * 1.85}rem` }
                            : (aspect === 'square' && tvShell
                                ? { width: `${posterGridScaleRem(density) * 1.25}rem` }
                                : posterGridCardWidthStyle(density))}
                    >
                        <PlayerViewMoreCard
                            label={moreLabel.startsWith('common.') ? 'View More' : moreLabel}
                            title={title}
                            aspect={items.every((row) => isMusicPlayerItem(row) || row.cardAspect === 'square')
                                ? 'square'
                                : (aspect === 'square' || aspect === '16/9' ? aspect : '2/3')}
                            onClick={onViewAll}
                        />
                    </div>
                ) : null}
            </Carousel>
        </div>
    );
};
