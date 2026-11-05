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

/**
 * TV Home rows glide like Plex: every row is full size in one column, and the whole
 * column slides as a single layer so the focused row lands in the same slot each time.
 * Rows above the focused one fade away over the details; the next row peeks in below.
 */
const TV_ROW_SLIDE_MS = 260;
const TV_ROW_SLIDE_EASE = 'cubic-bezier(0.25, 0.8, 0.3, 1)';
/** Room under the focused row for the next row to show (it runs on off the screen). */
const TV_STACK_PEEK = '7.05rem';

const tvRowSlideOff = () => {
    try {
        return document.documentElement.dataset.reduceMotion === '1'
            || document.documentElement.dataset.simpleMotion === '1'
            || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    } catch {
        return false;
    }
};

/**
 * Where the sliding column is drawn right now, worked out from the clock and the slide's own
 * timing curve. Reading it back from the page (getBoundingClientRect) returns where the
 * last frame the page managed to draw had it: on a slow TV stick that is several frames
 * behind what is on screen, so the next press restarted the slide from there and the rows
 * jumped backwards ("bouncing").
 */
const slideBezier = (() => {
    const [x1, y1, x2, y2] = [0.25, 0.8, 0.3, 1];
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;
    const x = (t: number) => ((ax * t + bx) * t + cx) * t;
    const y = (t: number) => ((ay * t + by) * t + cy) * t;
    return (progress: number) => {
        if (progress <= 0) return 0;
        if (progress >= 1) return 1;
        let lo = 0;
        let hi = 1;
        let t = progress;
        for (let i = 0; i < 16; i += 1) {
            const dx = x(t) - progress;
            if (Math.abs(dx) < 1e-4) break;
            if (dx < 0) lo = t;
            else hi = t;
            t = (lo + hi) / 2;
        }
        return y(t);
    };
})();

type TvSlide = { anim: Animation; created: number; from: number; to: number; duration: number };

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
    const railRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const slotHeightRef = useRef(0);
    const shownIndexRef = useRef<number | null>(null);
    /** Each built row's offset in the column at the last commit, and the offset applied then. */
    const offsetsRef = useRef<Map<string, number>>(new Map());
    const slideRef = useRef<TvSlide | null>(null);
    /** Column offset applied by the previous commit. */
    const lastTargetRef = useRef<number | null>(null);
    /**
     * Row heights and the row gap, measured once. Reading offsetHeight / offsetTop on every commit
     * forced a full layout in the middle of the press (about 50 ms on a TV stick); the offsets are
     * now worked out from these, and the DOM is only read when a row appears for the first time.
     */
    const heightsRef = useRef<Map<string, number>>(new Map());
    const heightsForRef = useRef<{ rows: PlayerTvStackRow[]; density: number } | null>(null);
    const gapRef = useRef<number | null>(null);
    const clipSupportedRef = useRef<boolean>((() => {
        try { return window.CSS?.supports?.('overflow', 'clip') === true; } catch { return false; }
    })());
    useEffect(() => () => {
        slideRef.current?.anim.cancel();
        slideRef.current = null;
    }, []);
    // Every commit: rows may have been built or dropped above the focused one, so the
    // column offset is re-read; it only animates on a row change.
    useLayoutEffect(() => {
        const rail = railRef.current;
        const track = trackRef.current;
        if (!rail || !track) return;
        // Several rows at once (the nav bar's Home button from deep in the list): no slide through
        // every row in between and no fades, just land on the row. Set before anything reads layout,
        // so the class changes of this commit start no transitions.
        const jumped = shownIndexRef.current !== null && Math.abs(activeIndex - shownIndexRef.current) > 1;
        if (jumped) {
            track.dataset.jump = '1';
            window.requestAnimationFrame(() => window.requestAnimationFrame(() => { delete track.dataset.jump; }));
        }
        const rowEls = Array.from(track.children as HTMLCollectionOf<HTMLElement>);
        const active = rowEls.find((el) => el.dataset.tvStackIndex === String(activeIndex));
        if (!active) return;
        const heights = heightsRef.current;
        const measuredFor = heightsForRef.current;
        if (!measuredFor || measuredFor.rows !== rows || measuredFor.density !== density) {
            // New data or poster size: heights may differ, measure again.
            heights.clear();
            gapRef.current = null;
            heightsForRef.current = { rows, density };
        }
        const idOf = (el: HTMLElement) => el.dataset.tvStackId || '';
        for (const el of rowEls) {
            if (!heights.has(idOf(el))) heights.set(idOf(el), el.offsetHeight);
        }
        if (gapRef.current === null) gapRef.current = Number.parseFloat(getComputedStyle(track).rowGap) || 0;
        const gap = gapRef.current;
        // The slot is the tallest row built so far and only grows, so the details above
        // never hop when a shorter (landscape) row takes the slot.
        const tallest = Math.max(slotHeightRef.current, ...rowEls.map((el) => heights.get(idOf(el)) || 0));
        if (tallest !== slotHeightRef.current) {
            slotHeightRef.current = tallest;
            rail.style.height = `calc(${tallest}px + ${TV_STACK_PEEK})`;
            // The details block above is positioned from this (see .player-home-stage-copy).
            rail.parentElement?.style.setProperty('--tv-rail-h', `calc(${tallest}px + ${TV_STACK_PEEK})`);
        }
        const prevIndex = shownIndexRef.current;
        shownIndexRef.current = activeIndex;
        const prevOffsets = offsetsRef.current;
        const offsets = new Map<string, number>();
        let top = 0;
        for (const el of rowEls) {
            offsets.set(idOf(el), top);
            top += (heights.get(idOf(el)) || 0) + gap;
        }
        offsetsRef.current = offsets;
        const target = -(offsets.get(idOf(active)) || 0);
        // Focus moves can scroll these boxes on engines without overflow:clip (the CSS makes them
        // unscrollable otherwise); the column offset does the moving. Reading scrollTop forces a layout.
        if (!clipSupportedRef.current) {
            for (let el: HTMLElement | null = rail; el && !el.classList.contains('player-home-stage'); el = el.parentElement) {
                if (el.scrollTop) el.scrollTop = 0;
            }
        }
        const now = performance.now();
        const slide = slideRef.current;
        // Where the column is on screen this instant, from the slide's own timing.
        // With no slide running the column sits where the last commit put it (not at the new target).
        let drawn = lastTargetRef.current ?? target;
        lastTargetRef.current = target;
        let running = false;
        if (slide) {
            const startedAt = typeof slide.anim.startTime === 'number' ? Number(slide.anim.startTime) : slide.created;
            const progress = (now - startedAt) / slide.duration;
            if (progress < 1) {
                running = true;
                drawn = slide.from + (slide.to - slide.from) * slideBezier(progress);
            } else {
                // Finished: forget it. Its end offset goes stale the moment rows above are built or
                // dropped, and a later press started from that stale spot (the new row began about
                // half a row above its slot, then snapped).
                slideRef.current = null;
            }
        }
        const rowChanged = prevIndex !== null && prevIndex !== activeIndex;
        const stopSlide = () => {
            if (slideRef.current) slideRef.current.anim.cancel();
            slideRef.current = null;
        };
        track.style.transform = `translate3d(0, ${target}px, 0)`;
        if (prevIndex === null || jumped || tvRowSlideOff() || typeof track.animate !== 'function') {
            stopSlide();
            return;
        }
        // Layout moved under a slide that is still running (rows built above): carry on from
        // where the row it was showing is now, over the time that is left.
        if (!rowChanged && !(running && slide && Math.abs(slide.to - target) >= 1)) return;
        // A row that was in the column before is the anchor: its place on screen then is its
        // old offset plus where the column was drawn.
        const anchorId = [active.dataset.tvStackId || '', ...Array.from(offsets.keys())]
            .find((id) => prevOffsets.has(id) && offsets.has(id));
        if (!anchorId) {
            stopSlide();
            return;
        }
        const from = (prevOffsets.get(anchorId) as number) + drawn - (offsets.get(anchorId) as number);
        if (Math.abs(from - target) < 1) {
            stopSlide();
            return;
        }
        const duration = rowChanged ? TV_ROW_SLIDE_MS : Math.max(90, slide ? slide.duration - (now - slide.created) : TV_ROW_SLIDE_MS);
        stopSlide();
        const anim = track.animate([
            { transform: `translate3d(0, ${from}px, 0)` },
            { transform: `translate3d(0, ${target}px, 0)` },
        ], { duration, easing: TV_ROW_SLIDE_EASE });
        slideRef.current = { anim, created: now, from, to: target, duration };
    });
    return (
        <div className="player-home-stage-rail" ref={railRef}>
            <div className="player-home-track" ref={trackRef}>
                {rows.map((row, index) => {
                    if (index < lo || index > hi) return null;
                    const active = index === activeIndex;
                    const place = active
                        ? 'player-home-row-active'
                        : (index < activeIndex ? 'player-home-row-above' : 'player-home-row-below');
                    return (
                        <div
                            key={row.id}
                            data-tv-stack-index={index}
                            data-tv-stack-id={row.id}
                            className={`player-home-track-row ${place}`}
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
        </div>
    );
});
