import React, { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Carousel, DiscoverSectionHeader, discoverRowCardWidthClass, posterGridCardWidthStyle, posterGridScaleRem, useDiscoverI18n } from './host';
import { PlayerPosterCard } from './PlayerPosterCard';
import { PlayerViewMoreCard, type ViewMoreShelfSource } from './PlayerViewMoreCard';
import { isHomeRowsBusy, playerItemRef, PLAYER_HOME_ROWS_IDLE_EVENT, prefetchTvRowItems } from './api';
import { beginTvRowBackdropPreload, isMusicPlayerItem, playerItemBackdropUrl, playerRailPosterUrl, plexLogoUrl, prefetchPlayerImages, resolvePlayerCardAspect, warmPlayerBackdrop, warmPlayerPoster } from './playerUtils';
import type { PlayerItem, PlayerPlayOptions } from './types';
import { STORAGE_PLEX_SERVERS } from '../plex-client/configStorageKeys';

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

/** Phone row subtitle, as Plex mobile shows it: the server the row comes from. */
const rowServerName = (items: PlayerItem[]): string => {
    try {
        const raw = localStorage.getItem(STORAGE_PLEX_SERVERS);
        if (!raw) return '';
        const parsed = JSON.parse(raw) as { servers?: Array<{ id?: string; name?: string }>; enabledIds?: string[] };
        const servers = (parsed.servers || []).filter((server) => server?.id);
        if (!servers.length) return '';
        const ids = Array.from(new Set(items.map((item) => String(item.serverId || '')).filter(Boolean)));
        if (ids.length > 1) return '';
        const enabled = parsed.enabledIds?.length ? parsed.enabledIds : servers.map((server) => String(server.id));
        const id = ids[0] || (enabled.length === 1 ? enabled[0] : '');
        return String(servers.find((server) => server.id === id)?.name || '').trim();
    } catch {
        return '';
    }
};

const PlayerRailImpl: React.FC<{
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
    // TV Home keeps the rows above/below mounted. They only show their first few cards, so
    // mount 8 there; building every card of the new neighbour row on each up/down press was
    // what made row changes lag. The active row fills in after its slide-in (below).
    const armedFloor = tvShell
        ? Math.min(items.length, !tvActive ? 8 : (items.length <= 48 ? items.length : 28))
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
    const armedCountRef = useRef(armedCount);
    armedCountRef.current = armedCount;

    // Live Home: cards that weren't in this row on the last render slide in. The first
    // paint and whole new rows don't animate. Layout effect so no frame shows them unstyled.
    const [freshKeys, setFreshKeys] = useState<Set<string>>(() => new Set());
    const seenKeysRef = useRef<Set<string> | null>(null);
    const itemKeySig = items.map((item) => String(item.ratingKey || '')).join('|');
    useLayoutEffect(() => {
        const keys = itemKeySig ? itemKeySig.split('|') : [];
        const seen = seenKeysRef.current;
        seenKeysRef.current = new Set(keys);
        if (!seen) return undefined;
        const added = keys.filter((key) => key && !seen.has(key));
        if (!added.length) return undefined;
        setFreshKeys(new Set(added));
        const timer = window.setTimeout(() => setFreshKeys(new Set()), 900);
        return () => window.clearTimeout(timer);
    }, [itemKeySig]);

    useEffect(() => {
        if (!lazyMount) {
            setArmedCount(items.length);
            return undefined;
        }
        const target = () => {
            const restored = restoreIndex >= 0 ? restoreIndex + 6 : 0;
            return Math.min(items.length, Math.max(armedFloor, restored));
        };
        const grow = () => setArmedCount((current) => {
            if (!items.length) return 0;
            return Math.max(current, target());
        });
        // A TV row that just became active fills in once the remote has been still for a
        // moment, a few cards per idle slot: filling in 220ms after a press landed on the next
        // press. Cards you move right to are added on focus anyway (onFocusCapture below).
        if (tvShell && tvActive) {
            let shown = armedCountRef.current;
            let idle = 0;
            const ric = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
                .requestIdleCallback;
            const cic = (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
            const step = () => {
                const goal = target();
                if (shown >= goal) return;
                shown = Math.min(goal, shown + 6);
                setArmedCount((current) => Math.max(current, shown));
                if (shown < goal) schedule(120);
            };
            const schedule = (wait: number) => {
                timer = window.setTimeout(() => {
                    if (ric) idle = ric(step, { timeout: 500 });
                    else step();
                }, wait);
            };
            let timer = 0;
            schedule(600);
            return () => {
                window.clearTimeout(timer);
                if (idle && cic) cic(idle);
            };
        }
        grow();
        return undefined;
    }, [armedFloor, items.length, lazyMount, restoreIndex, tvActive, tvShell]);

    useEffect(() => {
        const take = tvShell
            ? Math.min(items.length, Math.max(armedCount, TV_RAIL_POSTER_WARM))
            : eagerCount;
        const urls = items.slice(0, take).map((item) => playerRailPosterUrl(item, aspect));
        prefetchPlayerImages(urls, take);
    }, [armedCount, aspect, eagerCount, items, tvShell]);

    useEffect(() => {
        if (!tvShell || !tvActive || !items.length) return undefined;
        const start = Math.max(0, restoreIndex);
        const ordered = items.slice(start).concat(items.slice(0, start));
        const urls: string[] = [];
        const keys: string[] = [];
        ordered.forEach((item) => {
            const url = playerItemBackdropUrl(item);
            if (url) urls.push(url);
            const key = String(item.ratingKey || '').trim();
            if (key && /^\d+$/.test(key) && item.type !== 'collection' && item.type !== 'playlist') keys.push(playerItemRef(item));
        });
        const nearUrls = urls.slice(0, TV_RAIL_BACKDROP_WARM);
        const nearKeys = keys.slice(0, TV_RAIL_META_WARM);
        // Only the focused card's backdrop is needed now; the rest wait (startExtras).
        let stopArt = beginTvRowBackdropPreload(nearUrls.slice(0, 1), 0);
        if (nearUrls[0]) warmPlayerBackdrop(nearUrls[0], true);
        let stopMeta = () => {};
        let timer = 0;
        const startExtras = () => {
            if (isHomeRowsBusy()) {
                window.addEventListener(PLAYER_HOME_ROWS_IDLE_EVENT, arm);
                return;
            }
            stopArt = beginTvRowBackdropPreload(nearUrls, 0);
            stopMeta = prefetchTvRowItems(nearKeys);
            ordered.slice(0, 6).forEach((item) => {
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
    }, [itemKeySig, restoreIndex, rowId, tvShell, tvActive]);

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

    // Continue Watching mixes servers; Plex only names the server under library rows.
    const phoneServer = phoneShell && !showProgress ? rowServerName(items) : '';

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
                    chevron={phoneShell}
                    subtitle={phoneServer || undefined}
                />
            ) : null}
            <Carousel posterRow>
                {visibleItems.map((item, idx) => {
                    const cardAspect = resolvePlayerCardAspect(item, aspect);
                    const landscape = cardAspect === '16/9';
                    const square = cardAspect === 'square';
                    const cardWidth = landscape
                        ? { width: `calc(${posterGridScaleRem(density) * 1.85}rem / var(--tv-text-scale, 1))` }
                        : (square && tvShell
                            ? { width: `calc(${posterGridScaleRem(density) * 1.25}rem / var(--tv-text-scale, 1))` }
                            : posterGridCardWidthStyle(density));
                    return (
                        <div
                            key={item.ratingKey || `${title}-${idx}`}
                            className={`${landscape ? 'player-rail-landscape' : square ? 'player-rail-square' : discoverRowCardWidthClass(density)} relative z-0 flex-shrink-0 snap-start group hover:z-20 focus-within:z-20${
                                freshKeys.has(String(item.ratingKey || '')) ? ' player-rail-card-new' : ''
                            }`}
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
                            ? { width: `calc(${posterGridScaleRem(density) * 1.85}rem / var(--tv-text-scale, 1))` }
                            : (aspect === 'square' && tvShell
                                ? { width: `calc(${posterGridScaleRem(density) * 1.25}rem / var(--tv-text-scale, 1))` }
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
/** TV: warm what is on screen plus a few neighbours, not every card in a long hub. */
const TV_RAIL_POSTER_WARM = 12;
const TV_RAIL_BACKDROP_WARM = 8;
const TV_RAIL_META_WARM = 8;

/** Memoised: a TV row change re-renders the stack, and rows whose props did not change skip. */
export const PlayerRail = memo(PlayerRailImpl);

/** Rows kept built on each side of the active row once the remote is still. */
const TV_STACK_WARM_ROWS = 2;
/** Quiet time after a row change before the rows ahead are built (past remote repeat). */
const TV_STACK_WARM_DELAY_MS = 350;

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

/** Row slide on a TV Home row change (Plex-style): one ease, transform + opacity only. */
const TV_ROW_SLIDE_MS = 240;
const TV_ROW_SLIDE_EASE = 'cubic-bezier(0.25, 0.8, 0.3, 1)';
/** The row you leave is fully faded by this point of the slide (~70ms). */
const TV_ROW_LEAVE_FADE = 0.3;

const tvRowSlideOff = () => {
    try {
        const root = document.documentElement;
        return root.dataset.reduceMotion === '1'
            || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    } catch {
        return false;
    }
};

/** Top of each on-screen row (active + peek), read before React swaps their classes. */
const snapshotTvRowTops = (stage: HTMLElement) => {
    const tops = new Map<string, number>();
    stage.querySelectorAll<HTMLElement>('.player-home-row-active, .player-home-next-row').forEach((el) => {
        const id = el.dataset.tvStackId;
        if (id) tops.set(id, el.getBoundingClientRect().top);
    });
    return tops;
};

/**
 * FLIP: every row that was or is on screen starts where it was and glides to its new
 * place. A row coming on screen enters from one step below (Down) or above (Up); the
 * row leaving slides one step on and fades. Rapid presses cancel and restart from where
 * each row is drawn, so nothing queues up.
 */
const slideTvRows = (stage: HTMLElement, before: Map<string, number>, dir: 'up' | 'down') => {
    const rows = Array.from(stage.querySelectorAll<HTMLElement>('[data-tv-stack-id]'));
    rows.forEach((el) => el.getAnimations?.().forEach((a) => a.cancel()));
    if (tvRowSlideOff() || typeof stage.animate !== 'function') return;
    const active = stage.querySelector<HTMLElement>('.player-home-row-active');
    if (!active) return;
    const activeBox = active.getBoundingClientRect();
    // getBoundingClientRect is in zoomed px; transforms are in the element's own px.
    const scale = activeBox.height > 0 ? active.offsetHeight / activeBox.height : 1;
    const activeFrom = before.get(active.dataset.tvStackId || '');
    // One step = how far the rows travel: the old peek row to the active slot.
    const step = activeFrom != null && Math.abs(activeFrom - activeBox.top) > 8
        ? Math.abs(activeFrom - activeBox.top)
        : Math.max(120, activeBox.height);
    const sign = dir === 'down' ? 1 : -1;
    const opts: KeyframeAnimationOptions = { duration: TV_ROW_SLIDE_MS, easing: TV_ROW_SLIDE_EASE };
    rows.forEach((el) => {
        const id = el.dataset.tvStackId || '';
        const shown = el.classList.contains('player-home-row-active') || el.classList.contains('player-home-next-row');
        const was = before.get(id);
        if (!shown && was == null) return;
        const now = el.getBoundingClientRect().top;
        if (shown) {
            const from = was ?? now + sign * step;
            const dy = (from - now) * scale;
            if (Math.abs(dy) < 1) return;
            // Transform only: rows coming on screen are fully drawn from the first frame
            // (fading them in read as lag).
            el.animate([
                { transform: `translate3d(0, ${dy}px, 0)` },
                { transform: 'translate3d(0, 0, 0)' },
            ], opts);
            return;
        }
        // Leaving: keep moving the same way, but gone within the first third so it never
        // sits half-faded over the title and description.
        const startDy = ((was as number) - now) * scale;
        const endDy = startDy - sign * step * scale;
        el.animate([
            { transform: `translate3d(0, ${startDy}px, 0)`, opacity: 1, easing: 'linear' },
            { transform: `translate3d(0, ${startDy + (endDy - startDy) * 0.35}px, 0)`, opacity: 0, offset: TV_ROW_LEAVE_FADE },
            { transform: `translate3d(0, ${endDy}px, 0)`, opacity: 0 },
        ], { duration: TV_ROW_SLIDE_MS, easing: 'linear' });
    });
};

/** Keep the previous, current, and next Home rows mounted so posters stay decoded. */
/** Memoised: Home re-renders on every focus move; the stack only needs to on a row change. */
export const PlayerTvRowStack = memo(function PlayerTvRowStack({
    rows,
    activeIndex,
    density,
    restoreFocusById,
    rowDir = null,
    ...railProps
}: {
    rows: PlayerTvStackRow[];
    activeIndex: number;
    density: number;
    restoreFocusById: Record<string, string>;
    /** Last up/down move — the row that becomes active slides in from that side. */
    rowDir?: 'up' | 'down' | null;
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
}) {
    // Rows two away are built while the remote is still, so the next press only swaps
    // classes: mounting (and unmounting) a row of cards on the press frame was the stutter.
    // Rows that fall out of range are dropped in that same quiet moment, not on the press.
    const [warm, setWarm] = useState(() => ({ lo: activeIndex - 1, hi: activeIndex + 1 }));
    useEffect(() => {
        const timer = window.setTimeout(() => {
            setWarm({ lo: activeIndex - TV_STACK_WARM_ROWS, hi: activeIndex + TV_STACK_WARM_ROWS });
        }, TV_STACK_WARM_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [activeIndex]);
    const lo = Math.min(warm.lo, activeIndex - 1);
    const hi = Math.max(warm.hi, activeIndex + 1);
    const stageRef = useRef<HTMLDivElement>(null);
    const shownIndexRef = useRef(activeIndex);
    const beforeTopsRef = useRef<Map<string, number> | null>(null);
    // Read where the rows are drawn while the DOM still shows the old row (render runs
    // before commit); the layout effect then slides them from there.
    if (shownIndexRef.current !== activeIndex && stageRef.current && !beforeTopsRef.current) {
        beforeTopsRef.current = snapshotTvRowTops(stageRef.current);
    }
    useLayoutEffect(() => {
        const prev = shownIndexRef.current;
        shownIndexRef.current = activeIndex;
        const before = beforeTopsRef.current;
        beforeTopsRef.current = null;
        if (prev === activeIndex || !before || !stageRef.current) return;
        slideTvRows(stageRef.current, before, rowDir || (activeIndex > prev ? 'down' : 'up'));
    }, [activeIndex, rowDir]);
    return (
        <div className="player-home-stage-rail" ref={stageRef}>
            {rows.map((row, index) => {
                if (index < lo || index > hi) return null;
                const active = index === activeIndex;
                const peek = index === activeIndex + 1;
                return (
                    <div
                        key={row.id}
                        data-tv-stack-index={index}
                        data-tv-stack-id={row.id}
                        className={peek ? 'player-home-next-row' : (active ? 'player-home-row-active' : 'player-home-row-park')}
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
});
