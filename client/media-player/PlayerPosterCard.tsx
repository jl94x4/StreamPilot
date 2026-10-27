import React, { memo, useEffect, useRef, useState } from 'react';
import { Check, Eye, Play } from 'lucide-react';
import { DiscoverPosterCard, useDiscoverI18n } from './host';
import { prefetchMediaPlayerItem } from './api';
import { PlayerItemMenu, type PlayerItemMenuHandle } from './PlayerItemMenu';
import { watchedTickPositionClass } from './playerSettings';
import { applyRememberedProgress, formatEpisodeCode, formatRemainingWatchTime, heroRailCardImageUrl, heroRowSubtitle, PLAYER_PROGRESS_EVENT, plexBackdropUrl, PLAYER_POSTER_QUALITY, prefetchPlayerImages, progressPercent, remainingWatchMs, resizePlexArtUrl, resolvePlayerCardAspect, toPosterCardItem } from './playerUtils';
import { usePlayerSettings } from './usePlayerSettings';
import { hideEpisodeSpoilers } from './spoilers';
import { isLanHttpImage, loadLanImage } from './lanImage';
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

const LONG_PRESS_MS = 700;
const LONG_PRESS_MOVE_PX = 12;

/** Phone caption, as Plex mobile writes it: [name, "S1 • E1" | "rating • resolution" | year]. */
const phoneCaptionLines = (item: PlayerItem): [string, string] => {
    if (item.type === 'episode') {
        const show = String(item.showTitle || '').trim();
        const season = Number(item.parentIndex);
        const episode = Number(item.index);
        const code = episode > 0 ? (season > 0 ? `S${season} • E${episode}` : `E${episode}`) : '';
        return [show || item.title, code || (show ? String(item.episodeTitle || '') : '')];
    }
    if (item.type === 'movie') {
        const resolution = String(item.versions?.[0]?.resolution || '').toUpperCase();
        const meta = [item.contentRating, resolution].filter(Boolean).join(' • ');
        return [item.title, meta || (item.year ? String(item.year) : '')];
    }
    return [item.title, item.year ? String(item.year) : ''];
};

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
    const [lanThumb, setLanThumb] = useState<string | null>(null);
    useEffect(() => {
        const raw = String(item.thumb || '').trim();
        if (!isLanHttpImage(raw)) {
            setLanThumb(null);
            return undefined;
        }
        let live = true;
        loadLanImage(raw).then((url) => { if (live) setLanThumb(url); }, () => { if (live) setLanThumb(null); });
        return () => { live = false; };
    }, [item.thumb]);
    const posterItem = lanThumb ? { ...item, thumb: lanThumb } : item;
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
    const landscapeEpisode = item.type === 'episode' && resolvedAspect === '16/9';
    const episodeKey = landscapeEpisode ? String(item.ratingKey || '').replace(/\D/g, '') : '';
    const rawThumb = String(item.episodeThumb || posterItem.thumb || '').trim();
    const thumbOwner = rawThumb.match(/\/library\/metadata\/(\d+)\//)?.[1] || '';
    const episodeStill = episodeKey
        ? ((thumbOwner === episodeKey || (/^https?:\/\//i.test(rawThumb) && !/\/library\/metadata\//.test(rawThumb)))
            ? rawThumb
            : `/library/metadata/${episodeKey}/thumb`)
        : '';
    const cardSource = item.heroCard
        ? (item.heroArt || item.art || posterItem.thumb)
        : (episodeStill || posterItem.thumb);
    const sizedItem = cardSource
        ? {
            ...posterItem,
            cardAspect: landscapeEpisode ? '16/9' as const : item.cardAspect,
            thumb: item.heroCard
                ? heroRailCardImageUrl(cardSource)
                : (landscapeEpisode && String(episodeStill).startsWith('/library/')
                    ? episodeStill
                    : resizePlexArtUrl(cardSource, artWidth, artHeight, PLAYER_POSTER_QUALITY)),
        }
        : posterItem;
    const heroLine = item.heroCard ? heroRowSubtitle(item) : '';
    const episodeCode = formatEpisodeCode(item);
    const phoneLines = phoneUi && !item.heroCard ? phoneCaptionLines(item) : null;
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
    // TV / phone: the long-press menu is created on first open, not with every card. A row
    // change mounts a whole row of cards, and a closed menu per card was a large part of it.
    const hiddenMenu = tvMenu || (phoneUi && menuEnabled);
    const [menuMounted, setMenuMounted] = useState(false);
    const pendingMenuOpenRef = useRef<{ x?: number; y?: number } | null>(null);
    const openItemMenu = (x?: number, y?: number) => {
        const menu = menuRef.current;
        if (menu) {
            if (tvMenu) (menu.openAt as (cx?: number, cy?: number) => void)();
            else (menu.openAt as (cx?: number, cy?: number) => void)(x, y);
            return;
        }
        pendingMenuOpenRef.current = { x, y };
        setMenuMounted(true);
    };
    useEffect(() => {
        const pending = pendingMenuOpenRef.current;
        if (!menuMounted || !pending || !menuRef.current) return;
        pendingMenuOpenRef.current = null;
        if (tvMenu) (menuRef.current.openAt as (cx?: number, cy?: number) => void)();
        else (menuRef.current.openAt as (cx?: number, cy?: number) => void)(pending.x, pending.y);
    }, [menuMounted, tvMenu]);
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
            openItemMenu();
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
        const serverId = item.serverId || null;
        const art = (item as { backdropArt?: string | null }).backdropArt || item.art;
        const delay = isTvShell ? 0 : 450;
        prefetchTimerRef.current = window.setTimeout(() => {
            prefetchTimerRef.current = null;
            prefetchMediaPlayerItem(key, serverId);
            if (art && !isTvShell) prefetchPlayerImages([plexBackdropUrl(art)], 1);
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
        openItemMenu(clientX, clientY);
        window.setTimeout(() => {
            suppressClickRef.current = false;
        }, 500);
    };

    return (
        <div
            ref={rootRef}
            data-browse-index={browseIndex}
            data-tv-backdrop={isTvShell ? (plexBackdropUrl(
                (item as { backdropArt?: string | null }).backdropArt || item.art || item.thumb,
            ) || undefined) : undefined}
            className={`player-poster-hold relative touch-manipulation select-none [-webkit-touch-callout:none] [-webkit-user-select:none] [user-select:none]${
                // Only an episode's own still can spoil; posters and hero art never blur.
                landscapeEpisode && !item.heroCard && hideEpisodeSpoilers(settings, item) ? ' player-spoiler-blur' : ''
            }`}
            onFocusCapture={schedulePrefetch}
            onBlurCapture={cancelPrefetch}
            onPointerEnter={schedulePrefetch}
            onPointerLeave={cancelPrefetch}
            onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!canLongPressMenu) return;
                // TV Select-hold is owned by useTvRemote — synthetic contextmenu must not open the sheet.
                if (isTvShell) return;
                openMenuAt(event.clientX, event.clientY);
            }}
            onDragStart={(event) => event.preventDefault()}
            onPointerDown={(event) => {
                if (!canLongPressMenu) return;
                // TV remotes: Select long-press is handled in useTvRemote. Pointer long-press
                // here raced Select and opened the menu on ordinary presses.
                if (isTvShell) return;
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
                if (isTvShell) return;
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
                posterQuality={PLAYER_POSTER_QUALITY}
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
                ) : phoneLines ? (
                    // Plex mobile: show or movie name, then "S1 • E1" or "gb/PG • 1080P".
                    <div className="player-poster-caption player-poster-caption--phone px-0.5 text-left">
                        <div className="truncate text-[0.9rem] font-medium leading-tight text-text">{phoneLines[0]}</div>
                        {phoneLines[1] ? (
                            <div className="mt-0.5 truncate text-[0.8rem] leading-tight text-muted">{phoneLines[1]}</div>
                        ) : null}
                    </div>
                ) : (
                    <div className="player-poster-caption px-1 text-left">
                        {item.type === 'episode' ? (() => {
                            const epName = String(
                                item.episodeTitle
                                || (item.showTitle && item.title && item.title !== item.showTitle ? item.title : '')
                                || '',
                            ).trim();
                            const heading = [episodeCode, epName].filter(Boolean).join(' · ');
                            const showName = String(item.showTitle || '').trim();
                            const primary = heading || showName || item.title;
                            const secondary = heading && showName && showName !== epName ? showName : '';
                            return (
                                <>
                                    <div className={`${isTvShell ? 'text-base font-semibold' : 'text-xs font-medium'} line-clamp-2 leading-snug text-text`}>
                                        {primary}
                                    </div>
                                    {secondary ? (
                                        <div className={`${isTvShell ? 'text-sm' : 'text-[11px]'} mt-0.5 truncate text-muted`}>
                                            {secondary}
                                        </div>
                                    ) : null}
                                </>
                            );
                        })() : (
                            <>
                                <div className={`${isTvShell ? 'text-base font-semibold' : 'text-xs font-medium'} line-clamp-2 leading-snug text-text`}>
                                    {item.title}
                                </div>
                                {item.year ? (
                                    <div className={`${isTvShell ? 'text-sm' : 'text-[11px]'} mt-0.5 truncate text-muted`}>
                                        {item.year}
                                    </div>
                                ) : null}
                            </>
                        )}
                    </div>
                )}
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
            {hiddenMenu && menuMounted ? (
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
