import React, { useEffect, useRef, useState } from 'react';
import { Carousel, DiscoverSectionHeader, discoverRowCardWidthClass, posterGridCardWidthStyle, posterGridScaleRem, useDiscoverI18n } from './host';
import { PlayerPosterCard } from './PlayerPosterCard';
import { PlayerViewMoreCard, type ViewMoreShelfSource } from './PlayerViewMoreCard';
import { isHomeRowsBusy, PLAYER_HOME_ROWS_IDLE_EVENT, prefetchTvRowItems } from './api';
import { beginTvRowBackdropPreload, isMusicPlayerItem, playerRailPosterUrl, plexBackdropUrl, plexLogoUrl, prefetchPlayerImages, resolvePlayerCardAspect, warmPlayerBackdrop, warmPlayerPoster } from './playerUtils';
import type { PlayerItem, PlayerPlayOptions } from './types';

const isTvShell = () => {
    try {
        return document.documentElement?.dataset?.tv === '1'
            || window.__PLEX_CLIENT__?.isTv === true;
    } catch {
        return false;
    }
};

const isPhoneShell = () => {
    try {
        return document.documentElement?.dataset?.phone === '1';
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
    /** Where to load View More shelf posters from (beyond the visible rail). */
    viewMoreShelf?: ViewMoreShelfSource | null;
    staggerIndex?: number;
    /** Stable id for TV per-row focus restore (up/down). */
    rowId?: string;
    /** TV: mount enough cards so a restored focus key is in the DOM. */
    restoreFocusKey?: string;
    /** TV Home: only the focused row warms backdrops. Parked rows keep posters. */
    tvActive?: boolean;
    /** TV Home draws the row name itself so it cannot sit on the billboard. */
    showHeader?: boolean;
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
    viewMoreShelf = null,
    staggerIndex = 0,
    rowId,
    restoreFocusKey,
    tvActive = true,
    showHeader = true,
}) => {
    const { t } = useDiscoverI18n();
    const tvShell = isTvShell();
    const phoneShell = !tvShell && isPhoneShell();
    const lazyMount = tvShell || phoneShell;
    const moreLabel = t('common.viewMore');
    const eagerCount = tvShell
        ? 6
        : phoneShell
            ? (staggerIndex === 0 ? 6 : staggerIndex <= 2 ? 4 : 2)
            : (staggerIndex === 0 ? 8 : 4);
    const armedFloor = tvShell
        ? Math.min(items.length, items.length <= 48 ? items.length : 28)
        : phoneShell
            ? (staggerIndex === 0 ? 8 : 6)
            : items.length;
    const restoreIndex = restoreFocusKey
        ? items.findIndex((item) => String(item.ratingKey || '') === restoreFocusKey)
        : -1;
    const [armedCount, setArmedCount] = useState(() => (
        lazyMount
            ? Math.min(items.length, Math.max(armedFloor, restoreIndex >= 0 ? restoreIndex + 6 : 0))
            : items.length
    ));
    const armSentinelRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!lazyMount) {
            setArmedCount(items.length);
            return;
        }
        setArmedCount((current) => {
            if (!items.length) return 0;
            const restored = restoreIndex >= 0 ? restoreIndex + 6 : 0;
            return Math.min(items.length, Math.max(current, armedFloor, restored));
        });
    }, [armedFloor, items.length, lazyMount, restoreIndex]);

    useEffect(() => {
        const take = tvShell ? items.length : eagerCount;
        const urls = items.slice(0, take).map((item) => playerRailPosterUrl(item, aspect));
        prefetchPlayerImages(urls, take);
    }, [aspect, eagerCount, items, tvShell]);

    const tvRowKey = tvShell
        ? `${rowId || title}|${items.map((item) => `${item.ratingKey}|${item.art || ''}|${(item as { backdropArt?: string | null }).backdropArt || ''}|${item.logo || ''}`).join(',')}`
        : '';

    useEffect(() => {
        if (!tvShell || !tvActive || !items.length) return undefined;
        const start = Math.max(0, restoreIndex);
        const ordered = items.slice(start).concat(items.slice(0, start));
        const urls: string[] = [];
        const keys: string[] = [];
        ordered.forEach((item) => {
            const url = plexBackdropUrl(
                (item as { backdropArt?: string | null }).backdropArt || item.art || item.thumb,
            );
            if (url) urls.push(url);
            const key = String(item.ratingKey || '').trim();
            if (key && /^\d+$/.test(key) && item.type !== 'collection' && item.type !== 'playlist') keys.push(key);
        });
        let stopArt = beginTvRowBackdropPreload(urls.slice(0, 2), 0);
        if (urls[0]) warmPlayerBackdrop(urls[0], true);
        if (urls[1]) warmPlayerBackdrop(urls[1], true);
        let stopMeta = () => {};
        let timer = 0;
        const startExtras = () => {
            if (isHomeRowsBusy()) {
                window.addEventListener(PLAYER_HOME_ROWS_IDLE_EVENT, arm);
                return;
            }
            stopArt = beginTvRowBackdropPreload(urls, 0);
            stopMeta = prefetchTvRowItems(keys);
            ordered.slice(0, 8).forEach((item) => {
                const logo = plexLogoUrl(item.logo);
                if (logo) warmPlayerPoster(logo);
            });
        };
        const arm = () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(startExtras, 400);
        };
        if (!isHomeRowsBusy()) arm();
        else window.addEventListener(PLAYER_HOME_ROWS_IDLE_EVENT, arm);
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener(PLAYER_HOME_ROWS_IDLE_EVENT, arm);
            stopArt();
            stopMeta();
        };
    }, [tvRowKey, tvShell, tvActive]);

    useEffect(() => {
        if (!phoneShell || armedCount >= items.length) return undefined;
        const node = armSentinelRef.current;
        if (!node || typeof IntersectionObserver === 'undefined') return undefined;
        const observer = new IntersectionObserver((entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            setArmedCount((current) => Math.min(items.length, current + 8));
        }, { root: null, rootMargin: '0px 160px', threshold: 0.01 });
        observer.observe(node);
        return () => observer.disconnect();
    }, [armedCount, items.length, phoneShell]);

    if (!items.length) return null;
    const visibleItems = lazyMount ? items.slice(0, Math.max(1, armedCount)) : items;
    return (
        <div
            data-tv-row="1"
            data-tv-row-id={rowId || `rail:${title}`}
            className="player-rail-enter flex min-w-0 max-w-full flex-col gap-2"
            style={{ animationDelay: `${Math.min(Math.max(staggerIndex, 0), 12) * (phoneShell ? 28 : 55)}ms` }}
        >
            {showHeader ? (
                <DiscoverSectionHeader
                    title={title}
                    onViewAll={tvShell ? undefined : onViewAll}
                    viewAllLabel={tvShell ? undefined : viewAllLabel}
                />
            ) : null}
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
                                if (!tvShell && !phoneShell) return;
                                setArmedCount((current) => Math.max(current, Math.min(items.length, idx + 18)));
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
                {phoneShell && armedCount < items.length ? (
                    <div
                        ref={armSentinelRef}
                        className="h-px w-px flex-shrink-0 self-stretch"
                        aria-hidden
                    />
                ) : null}
                {tvShell && onViewAll && armedCount >= items.length ? (
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
                            aspect={aspect === '16/9' || aspect === 'square'
                                ? aspect
                                : (items.every((row) => isMusicPlayerItem(row) || row.cardAspect === 'square')
                                    ? 'square'
                                    : '2/3')}
                            excludeRatingKeys={items.map((item) => String(item.ratingKey || '').trim()).filter(Boolean)}
                            shelfSource={viewMoreShelf}
                            onClick={onViewAll}
                        />
                    </div>
                ) : null}
            </Carousel>
        </div>
    );
};

export type PlayerTvStackRow = {
    id: string;
    title: string;
    items: PlayerItem[];
    aspect?: '2/3' | 'square' | '16/9';
    showProgress?: boolean;
    showRemoveFromContinueWatching?: boolean;
    onViewAll?: () => void;
    viewAllLabel?: string;
    viewMoreShelf?: ViewMoreShelfSource | null;
};

/** Keep the previous, current, and next Home rows mounted so posters stay decoded. */
export const PlayerTvRowStack: React.FC<{
    rows: PlayerTvStackRow[];
    activeIndex: number;
    density: number;
    restoreFocusById: Record<string, string>;
    onOpenItem: (item: PlayerItem) => void;
    onPlay: (item: PlayerItem, opts?: PlayerPlayOptions) => void;
    onToggleWatched?: (item: PlayerItem) => void;
    onPlayNext?: (item: PlayerItem) => void;
    onWatchedChange?: (item: PlayerItem, watched: boolean) => void;
    onRemovedFromContinueWatching?: (item: PlayerItem) => void;
    onDeleted?: (item: PlayerItem) => void;
    onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
    isAdmin?: boolean;
    playlistsEnabled?: boolean;
}> = ({
    rows,
    activeIndex,
    density,
    restoreFocusById,
    ...railProps
}) => {
    return (
        <div className="player-home-stage-rail">
            {rows.map((row, index) => {
                if (index < activeIndex - 1 || index > activeIndex + 1) return null;
                const active = index === activeIndex;
                const peek = index === activeIndex + 1;
                return (
                    <div
                        key={row.id}
                        data-tv-stack-index={index}
                        className={peek ? 'player-home-next-row' : (active ? undefined : 'player-home-row-park')}
                        inert={!active ? true : undefined}
                        aria-hidden={!active}
                    >
                        <PlayerRail
                            tvActive={active}
                            title={row.title}
                                rowId={`hub:${row.id}`}
                                restoreFocusKey={restoreFocusById[row.id]}
                                items={row.items}
                                density={density}
                                staggerIndex={0}
                                aspect={row.aspect}
                                showProgress={row.showProgress}
                                showRemoveFromContinueWatching={row.showRemoveFromContinueWatching}
                                onViewAll={row.onViewAll}
                                viewAllLabel={row.viewAllLabel}
                                viewMoreShelf={row.viewMoreShelf}
                            {...railProps}
                        />
                    </div>
                );
            })}
        </div>
    );
};
