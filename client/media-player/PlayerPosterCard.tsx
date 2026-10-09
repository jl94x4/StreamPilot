import React, { memo, useEffect, useRef, useState } from 'react';
import { Check, Eye, Play } from 'lucide-react';
import { DiscoverPosterCard, useDiscoverI18n } from './host';
import { prefetchMediaPlayerItem } from './api';
import { PlayerItemMenu, type PlayerItemMenuHandle } from './PlayerItemMenu';
import { watchedTickPositionClass } from './playerSettings';
import { applyRememberedProgress, formatEpisodeCode, formatRemainingWatchTime, heroRailCardImageUrl, heroRowSubtitle, PLAYER_PROGRESS_EVENT, plexBackdropPreviewUrl, PLAYER_POSTER_QUALITY, prefetchPlayerImages, progressPercent, remainingWatchMs, resizePlexArtUrl, resolvePlayerCardAspect, toPosterCardItem } from './playerUtils';
import { usePlayerSettings } from './usePlayerSettings';
import type { PlayerItem, PlayerPlayOptions } from './types';

type Props = {
    item: PlayerItem;
    onOpenItem: (item: PlayerItem) => void;
    onPlay?: (item: PlayerItem, opts?: PlayerPlayOptions) => void;
    onToggleWatched?: (item: PlayerItem) => void;
    onPlayNext?: (item: PlayerItem) => void;
    onWatchedChange?: (item: PlayerItem, watched: boolean) => void;
    onRemovedFromContinueWatching?: (item: PlayerItem) => void;
    onDeleted?: (item: PlayerItem) => void;
    onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
    showProgress?: boolean;
    showMenu?: boolean;
    showRemoveFromContinueWatching?: boolean;
    isAdmin?: boolean;
    playlistsEnabled?: boolean;
    aspect?: '2/3' | 'square' | '16/9';
    className?: string;
    /** Load this poster immediately. Later cards stay lazy so they don't clog the image queue. */
    imagePriority?: boolean;
    loading?: 'lazy' | 'eager';
    browseIndex?: number;
};

const LONG_PRESS_MS = 450;
const LONG_PRESS_MOVE_PX = 12;

export const PlayerPosterCard = memo(function PlayerPosterCard({
    item,
    onOpenItem,
    onPlay,
    onToggleWatched,
    onPlayNext,
    onWatchedChange,
    onRemovedFromContinueWatching,
    onDeleted,
    onToast,
    showProgress = false,
    showMenu = true,
    showRemoveFromContinueWatching = false,
    isAdmin = false,
    playlistsEnabled = true,
    aspect,
    className,
    imagePriority = false,
    loading: loadingProp,
    browseIndex,
}: Props) {
    const { t } = useDiscoverI18n();
    const [settings] = usePlayerSettings();
    const menuRef = useRef<PlayerItemMenuHandle | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const longPressTimerRef = useRef<number | null>(null);
    const prefetchTimerRef = useRef<number | null>(null);
    const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);
    const suppressClickRef = useRef(false);
    const isTvShell = typeof document !== 'undefined' && (
        document.documentElement?.dataset?.tv === '1'
        || window.__PLEX_CLIENT__?.isTv === true
    );
    const [liveOffset, setLiveOffset] = useState<number | null>(null);
    useEffect(() => {
        setLiveOffset(null);
        const onProgress = (event: Event) => {
            const detail = (event as CustomEvent<{ ratingKey?: string; viewOffsetMs?: number }>).detail;
            if (String(detail?.ratingKey || '') !== String(item.ratingKey || '')) return;
            setLiveOffset(Math.max(0, Math.floor(Number(detail.viewOffsetMs) || 0)));
        };
        window.addEventListener(PLAYER_PROGRESS_EVENT, onProgress);
        return () => window.removeEventListener(PLAYER_PROGRESS_EVENT, onProgress);
    }, [item.ratingKey]);
    const remembered = applyRememberedProgress(item);
    const shownItem = remembered.watched
        ? { ...remembered, viewOffsetMs: 0, watched: true }
        : liveOffset == null
            ? remembered
            : { ...item, viewOffsetMs: liveOffset, watched: liveOffset > 0 ? false : item.watched };
    const progress = progressPercent(shownItem);
    const remainingLabel = showProgress
        ? formatRemainingWatchTime(remainingWatchMs(shownItem))
        : '';
    const phoneUi = typeof document !== 'undefined' && document.documentElement?.dataset?.phone === '1';
    const canHoverPlay = !isTvShell && !phoneUi && !!onPlay && item.canPlay !== false && item.type !== 'collection' && item.type !== 'artist' && item.type !== 'album' && item.type !== 'playlist' && item.type !== 'person';
    const canToggleWatched = !isTvShell && !phoneUi && !!onToggleWatched && (item.type === 'movie' || item.type === 'episode' || item.type === 'show' || item.type === 'season');
    const resolvedAspect = resolvePlayerCardAspect(item, aspect);
    const artWidth = resolvedAspect === '16/9' ? 426 : 300;
    const artHeight = resolvedAspect === 'square' ? 300 : resolvedAspect === '16/9' ? 240 : 450;
    const cardSource = item.heroCard ? (item.heroArt || item.art || item.thumb) : item.thumb;
    const sizedItem = cardSource
        ? { ...item, thumb: item.heroCard ? heroRailCardImageUrl(cardSource) : resizePlexArtUrl(cardSource, artWidth, artHeight) }
        : item;
    const heroLine = item.heroCard ? heroRowSubtitle(item) : '';
    const episodeCode = formatEpisodeCode(item);
    // Nested menu/play/watched controls inside the poster <button> break Android TV spatial nav.
    const menuAllowed = showMenu && item.type !== 'collection' && item.type !== 'artist' && item.type !== 'album' && item.type !== 'playlist' && item.type !== 'person';
    const menuEnabled = !isTvShell && menuAllowed;
    const tvMenu = isTvShell && menuAllowed;
    // Episodes keep a fixed top-right tick; posters follow the user setting.
    const tickCorner = item.type === 'episode'
        ? 'top-right'
        : settings.watchedTickPosition;
    const tickPosClass = watchedTickPositionClass(tickCorner, { aboveProgress: progress > 0 || showProgress });
    const tickClass = `${tickPosClass} player-watched-tick z-30 flex h-6 w-6 items-center justify-center rounded-full bg-plex text-zinc-950 shadow-md`;
    const markWatchedClass = `pointer-events-auto ${tickPosClass} player-watched-tick flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black`;

    const clearLongPress = () => {
        if (longPressTimerRef.current) {
            window.clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
        longPressOriginRef.current = null;
    };

    useEffect(() => () => clearLongPress(), []);

    useEffect(() => {
        if (!tvMenu) return undefined;
        const onOpen = (event: Event) => {
            const detail = (event as CustomEvent).detail || {};
            const key = String(detail.ratingKey || '');
            const poster = detail.poster as HTMLElement | undefined;
            if (!key || key !== String(item.ratingKey || '')) return;
            const btn = rootRef.current?.querySelector<HTMLElement>('[data-tv-poster-btn="1"]');
            if (!btn || (poster && poster !== btn)) return;
            detail.handled = true;
            // Remote long-press can still synthesize a click on release — block open.
            suppressClickRef.current = true;
            menuRef.current?.openAt();
            window.setTimeout(() => {
                suppressClickRef.current = false;
            }, 600);
        };
        window.addEventListener('smp-tv-poster-menu', onOpen);
        return () => window.removeEventListener('smp-tv-poster-menu', onOpen);
    }, [item.ratingKey, tvMenu]);

    const canLongPressMenu = menuEnabled || tvMenu;
    const schedulePrefetch = () => {
        if (!item?.ratingKey || item.type === 'collection' || item.type === 'playlist') return;
        if (prefetchTimerRef.current) window.clearTimeout(prefetchTimerRef.current);
        const key = item.ratingKey;
        const art = item.art;
        const delay = isTvShell ? 1000 : 450;
        prefetchTimerRef.current = window.setTimeout(() => {
            prefetchTimerRef.current = null;
            prefetchMediaPlayerItem(key);
            if (art) prefetchPlayerImages([plexBackdropPreviewUrl(art)], 1);
        }, delay);
    };
    const cancelPrefetch = () => {
        if (!prefetchTimerRef.current) return;
        window.clearTimeout(prefetchTimerRef.current);
        prefetchTimerRef.current = null;
    };
    useEffect(() => cancelPrefetch, []);

    const openMenuAt = (clientX?: number, clientY?: number) => {
        if (!canLongPressMenu) return;
        suppressClickRef.current = true;
        if (tvMenu) menuRef.current?.openAt();
        else menuRef.current?.openAt(clientX, clientY);
        window.setTimeout(() => {
            suppressClickRef.current = false;
        }, 500);
    };

    return (
        <div
            ref={rootRef}
            data-browse-index={browseIndex}
            data-tv-backdrop={isTvShell ? (plexBackdropPreviewUrl(item.art || item.thumb) || undefined) : undefined}
            className="player-poster-hold relative touch-manipulation select-none [-webkit-touch-callout:none] [-webkit-user-select:none] [user-select:none]"
            onFocusCapture={schedulePrefetch}
            onBlurCapture={cancelPrefetch}
            onPointerEnter={schedulePrefetch}
            onPointerLeave={cancelPrefetch}
            onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!canLongPressMenu) return;
                openMenuAt(event.clientX, event.clientY);
            }}
            onDragStart={(event) => event.preventDefault()}
            onPointerDown={(event) => {
                if (!canLongPressMenu) return;
                if (event.pointerType === 'mouse' && event.button !== 0) return;
                clearLongPress();
                longPressOriginRef.current = { x: event.clientX, y: event.clientY };
                const blockNativeMenu = (nativeEvent: Event) => {
                    nativeEvent.preventDefault();
                    nativeEvent.stopPropagation();
                };
                document.addEventListener('contextmenu', blockNativeMenu, true);
                window.setTimeout(() => {
                    document.removeEventListener('contextmenu', blockNativeMenu, true);
                }, 1200);
                longPressTimerRef.current = window.setTimeout(() => {
                    const origin = longPressOriginRef.current;
                    longPressTimerRef.current = null;
                    if (!origin) return;
                    try {
                        window.getSelection()?.removeAllRanges();
                    } catch {
                        /* ignore */
                    }
                    openMenuAt(origin.x, origin.y);
                    try {
                        navigator.vibrate?.(10);
                    } catch {
                        /* ignore */
                    }
                }, LONG_PRESS_MS);
            }}
            onPointerMove={(event) => {
                const origin = longPressOriginRef.current;
                if (!origin) return;
                const dx = Math.abs(event.clientX - origin.x);
                const dy = Math.abs(event.clientY - origin.y);
                if (dx > LONG_PRESS_MOVE_PX || dy > LONG_PRESS_MOVE_PX) clearLongPress();
            }}
            onPointerUp={clearLongPress}
            onPointerCancel={clearLongPress}
            onClickCapture={(event) => {
                if (!suppressClickRef.current) return;
                event.preventDefault();
                event.stopPropagation();
            }}
        >
            <DiscoverPosterCard
                className={className}
                item={toPosterCardItem(sizedItem)}
                aspect={resolvedAspect}
                posterWidth={item.heroCard ? 854 : (resolvedAspect === '16/9' ? 426 : 300)}
                posterQuality={item.heroCard ? 72 : PLAYER_POSTER_QUALITY}
                loading={loadingProp || (imagePriority ? 'eager' : 'lazy')}
                fetchPriority={imagePriority ? 'high' : 'low'}
                posterHeight={item.heroCard ? 480 : (resolvedAspect === '16/9' ? 360 : undefined)}
                disableImageScale={!!item.heroCard}
                frameClassName=""
                footer={item.heroCard ? (
                    <div className="player-poster-caption px-1 text-left">
                        <div className={`${isTvShell ? 'text-base font-semibold' : 'text-xs font-medium'} line-clamp-2 leading-snug text-text`}>
                            {item.title}
                        </div>
                        {heroLine ? (
                            <div className={`${isTvShell ? 'text-sm' : 'text-[11px]'} mt-0.5 truncate text-muted`}>
                                {heroLine}
                            </div>
                        ) : null}
                    </div>
                ) : item.type === 'episode' ? (
                    <div className="player-poster-caption px-1 text-left">
                        <div className={`${isTvShell ? 'text-base font-semibold' : 'text-xs font-medium'} line-clamp-2 leading-snug text-text`}>
                            {item.showTitle && item.showTitle !== item.title ? item.showTitle : item.title}
                        </div>
                        {item.showTitle && item.showTitle !== item.title ? (
                            <div className={`${isTvShell ? 'text-sm' : 'text-[11px]'} mt-0.5 truncate text-muted`}>
                                {item.title}
                            </div>
                        ) : null}
                        {episodeCode ? (
                            <div className={`${isTvShell ? 'text-sm' : 'text-[11px]'} mt-0.5 truncate text-muted/80`}>
                                {episodeCode}
                            </div>
                        ) : null}
                    </div>
                ) : undefined}
                showQualityBadges={false}
                posterOnlyLink={isTvShell}
                onPosterClick={() => {
                    if (suppressClickRef.current) return;
                    onOpenItem(item);
                }}
                overlay={(
                    <>
                        {progress > 0 || showProgress ? (
                            progress > 0 ? (
                                <div className="player-watch-bar absolute inset-x-0 bottom-0 z-10 bg-black/70">
                                    {remainingLabel ? (
                                        <div className="pointer-events-none absolute inset-x-0 bottom-full mb-1 flex justify-end px-1.5">
                                            <span className="rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white/90 sm:text-[11px]">
                                                {remainingLabel}
                                                {' '}
                                                {t('mediaPlayerPage.remaining')}
                                            </span>
                                        </div>
                                    ) : null}
                                    <div className="h-full bg-plex" style={{ width: `${progress}%` }} />
                                </div>
                            ) : null
                        ) : null}
                        {/* Non-interactive watched tick only — never nest buttons inside the poster control on TV. */}
                        {item.watched ? (
                            <span title={t('mediaPlayerPage.watched')} className={`${tickClass} pointer-events-none`}>
                                <Check className="h-3 w-3 stroke-[2.5]" />
                            </span>
                        ) : null}
                        {!isTvShell && !phoneUi && (canHoverPlay || canToggleWatched || menuEnabled) ? (
                            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100 max-md:opacity-100 max-md:bg-transparent max-md:group-hover:bg-black/40">
                                {canHoverPlay ? (
                                    <span
                                        role="button"
                                        tabIndex={-1}
                                        aria-label={t('mediaPlayerPage.play')}
                                        className="player-card-play pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full bg-plex text-black shadow-lg transition duration-200 group-hover:scale-105 max-md:opacity-0 max-md:group-hover:opacity-100"
                                        onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            onPlay?.(item);
                                        }}
                                    >
                                        <Play className="h-5 w-5 fill-current" />
                                    </span>
                                ) : null}
                                {item.watched && item.type !== 'episode' && canToggleWatched ? (
                                    <button
                                        type="button"
                                        aria-label={t('mediaPlayerPage.markUnwatched')}
                                        title={t('mediaPlayerPage.watched')}
                                        className={`${tickClass} pointer-events-auto opacity-0 transition-opacity duration-200 group-hover:opacity-100 [@media(hover:none)]:opacity-100`}
                                        onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            onToggleWatched?.(item);
                                        }}
                                    >
                                        <Check className="h-3 w-3 stroke-[2.5]" />
                                    </button>
                                ) : null}
                                {!item.watched && canToggleWatched ? (
                                    <button
                                        type="button"
                                        aria-label={t('mediaPlayerPage.markWatched')}
                                        className={`${markWatchedClass} opacity-0 transition-opacity duration-200 group-hover:opacity-100 [@media(hover:none)]:opacity-100`}
                                        onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            onToggleWatched?.(item);
                                        }}
                                    >
                                        <Eye className="h-3 w-3" />
                                    </button>
                                ) : null}
                                {menuEnabled ? (
                                    <PlayerItemMenu
                                        ref={menuRef}
                                        item={item}
                                        isAdmin={isAdmin}
                                        playlistsEnabled={playlistsEnabled}
                                        onOpenItem={onOpenItem}
                                        showRemoveFromContinueWatching={showRemoveFromContinueWatching || progress > 0}
                                        onPlay={onPlay}
                                        onPlayNext={onPlayNext}
                                        onWatchedChange={onWatchedChange}
                                        onRemovedFromContinueWatching={onRemovedFromContinueWatching}
                                        onDeleted={onDeleted}
                                        onToast={onToast}
                                    />
                                ) : null}
                            </div>
                        ) : null}
                    </>
                )}
            />
            {tvMenu || (phoneUi && menuEnabled) ? (
                <PlayerItemMenu
                    ref={menuRef}
                    hideTrigger
                    item={item}
                    isAdmin={isAdmin}
                    playlistsEnabled={playlistsEnabled}
                    onOpenItem={onOpenItem}
                    showRemoveFromContinueWatching={showRemoveFromContinueWatching || progress > 0}
                    onPlay={onPlay}
                    onPlayNext={onPlayNext}
                    onWatchedChange={onWatchedChange}
                    onRemovedFromContinueWatching={onRemovedFromContinueWatching}
                    onDeleted={onDeleted}
                    onToast={onToast}
                />
            ) : null}
        </div>
    );
}, (prev, next) => (
    prev.item.ratingKey === next.item.ratingKey
    && prev.item.thumb === next.item.thumb
    && prev.item.art === next.item.art
    && prev.item.heroCard === next.item.heroCard
    && prev.item.heroArt === next.item.heroArt
    && prev.item.year === next.item.year
    && prev.item.childCount === next.item.childCount
    && prev.item.leafCount === next.item.leafCount
    && prev.item.title === next.item.title
    && prev.item.watched === next.item.watched
    && prev.item.viewOffsetMs === next.item.viewOffsetMs
    && prev.item.durationMs === next.item.durationMs
    && prev.browseIndex === next.browseIndex
    && prev.imagePriority === next.imagePriority
    && prev.loading === next.loading
    && prev.aspect === next.aspect
    && prev.className === next.className
    && prev.showProgress === next.showProgress
    && prev.showMenu === next.showMenu
    && prev.isAdmin === next.isAdmin
    && prev.playlistsEnabled === next.playlistsEnabled
    && prev.onOpenItem === next.onOpenItem
    && prev.onPlay === next.onPlay
    && prev.onToggleWatched === next.onToggleWatched
    && prev.onPlayNext === next.onPlayNext
    && prev.onWatchedChange === next.onWatchedChange
    && prev.onToast === next.onToast
));
