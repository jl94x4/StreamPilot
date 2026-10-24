import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { fetchMediaPlayerItem, prefetchMediaPlayerItem } from './api';
import { peekRememberedTvFocusKey, pinTvRailItemToSlot, visibleHomeStage } from '../plex-client/useTvRemote';
import { homeRailPosterDensity } from './host';
import { PlayerClearLogo } from './PlayerClearLogo';
import { PlayerServiceBrandMark } from './PlayerServiceBrandMark';
import { PlayerTvRowStack } from './PlayerRail';
import type { ViewMoreShelfSource } from './PlayerViewMoreCard';
import { readPlayerItemCache } from './playerMemory';
import { itemHasBillboardBrandMeta } from './studioLogo.js';
import { formatPlayerDate, formatPlayerDuration, isFuturePlayerDate, isPlayerBackdropReady, pickRicherSummary, pinTvNeighborBackdrops, playerItemBackdropUrl, plexBackdropUrl, plexLogoUrl, prefetchHomeRowPosters, primeNearbyTvBillboard, warmPlayerBackdrop } from './playerUtils';
import { PlayerTvStatusPanel } from './PlayerTvStatusPanel';
import type { PlayerItem, PlayerPlayOptions } from './types';

export const TV_HOME_ROW_EVENT = 'smp-tv-home-row';

export type PlayerTvHubStageRow = {
    id: string;
    title: string;
    items: PlayerItem[];
    aspect: '2/3' | '16/9' | 'square';
    showProgress?: boolean;
    showRemoveFromContinueWatching?: boolean;
    onViewAll?: () => void;
    viewMoreShelf?: ViewMoreShelfSource | null;
};

type Density = ReturnType<typeof homeRailPosterDensity>;

type Props = {
    active?: boolean;
    loading?: boolean;
    rows: PlayerTvHubStageRow[];
    density: Density;
    resetKey?: string;
    ariaLabel?: string;
    header?: React.ReactNode;
    emptyTitle?: string;
    onEmptyRetry?: () => void;
    onEmptyBack?: () => void;
    /** When true, View More is shown for rows that provide onViewAll (Home watchlist). */
    allowViewAll?: boolean;
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
};

/** tvSpotExtra key: rating keys are only unique per Plex server. */
const spotExtraKey = (serverId: string | null | undefined, ratingKey: string) => (
    serverId ? `${serverId}|${ratingKey}` : ratingKey
);

const posterButtonFromTarget = (target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    return (el?.closest?.('[data-tv-poster-btn="1"]') as HTMLElement | null) || null;
};

const backdropFromFocusTarget = (target: EventTarget | null) => {
    const btn = posterButtonFromTarget(target);
    if (!btn) return '';
    return btn.closest('[data-tv-backdrop]')?.getAttribute('data-tv-backdrop') || '';
};

const itemKeyFromFocusTarget = (target: EventTarget | null) => {
    const btn = posterButtonFromTarget(target);
    const key = String(btn?.getAttribute('data-tv-key') || '').trim();
    if (!key || key.startsWith('view-more:')) return '';
    return key;
};

export const PlayerTvFocusStill: React.FC<{
    enabled: boolean;
    seed?: string;
    onFocusKey?: (key: string) => void;
}> = ({ enabled, seed = '', onFocusKey }) => {
    const [front, setFront] = useState(seed);
    const [back, setBack] = useState('');
    const [frontOn, setFrontOn] = useState(true);
    const frontOnRef = useRef(true);
    const currentRef = useRef(seed);
    const pendingRef = useRef('');

    const show = useCallback((next: string) => {
        if (!next || next === currentRef.current || next === pendingRef.current) return;
        pendingRef.current = next;
        const commit = () => {
            if (pendingRef.current !== next) return;
            if (frontOnRef.current) {
                setBack(next);
                frontOnRef.current = false;
                setFrontOn(false);
            } else {
                setFront(next);
                frontOnRef.current = true;
                setFrontOn(true);
            }
            currentRef.current = next;
        };
        if (isPlayerBackdropReady(next)) {
            commit();
            return;
        }
        const img = new Image();
        img.onload = commit;
        img.src = next;
    }, []);

    const showTimerRef = useRef(0);
    const keyTimerRef = useRef(0);
    const showSoon = useCallback((next: string) => {
        window.clearTimeout(showTimerRef.current);
        if (!next) return;
        showTimerRef.current = window.setTimeout(() => show(next), 70);
    }, [show]);
    const keySoon = useCallback((key: string) => {
        window.clearTimeout(keyTimerRef.current);
        if (!key) return;
        keyTimerRef.current = window.setTimeout(() => onFocusKey?.(key), 90);
    }, [onFocusKey]);

    useEffect(() => () => {
        window.clearTimeout(showTimerRef.current);
        window.clearTimeout(keyTimerRef.current);
    }, []);

    useEffect(() => {
        if (enabled && seed) show(seed);
    }, [enabled, seed, show]);

    useEffect(() => {
        if (!enabled) return undefined;
        const onFocus = (event: FocusEvent) => {
            primeNearbyTvBillboard(event.target, prefetchMediaPlayerItem);
            const next = backdropFromFocusTarget(event.target);
            if (next) {
                if (isPlayerBackdropReady(next)) show(next);
                else showSoon(next);
            }
            const key = itemKeyFromFocusTarget(event.target);
            if (key) keySoon(key);
        };
        document.addEventListener('focusin', onFocus, true);
        const focused = document.activeElement;
        const fromFocus = backdropFromFocusTarget(focused);
        if (fromFocus) show(fromFocus);
        const fromKey = itemKeyFromFocusTarget(focused);
        if (fromKey) keySoon(fromKey);
        return () => document.removeEventListener('focusin', onFocus, true);
    }, [enabled, keySoon, onFocusKey, show, showSoon]);

    if (!enabled) return null;
    const visible = frontOn ? front : back;
    if (!visible && !front && !back) return null;
    return (
        <div className="player-home-focus-still" aria-hidden>
            {back ? (
                <img
                    src={back}
                    alt=""
                    className={frontOn ? 'is-behind' : 'is-front'}
                />
            ) : null}
            {front ? (
                <img
                    src={front}
                    alt=""
                    className={frontOn ? 'is-front' : 'is-behind'}
                />
            ) : null}
        </div>
    );
};

export const PlayerTvSpot: React.FC<{ item: PlayerItem | null }> = ({ item }) => {
    const [logoFailed, setLogoFailed] = useState(false);
    const logoKey = String(item?.ratingKey || item?.logo || '');
    useEffect(() => {
        setLogoFailed(false);
    }, [logoKey]);
    if (!item) return null;
    const title = item.type === 'episode' ? (item.showTitle || item.title) : item.title;
    const logoUrl = plexLogoUrl(item.logo);
    const showLogo = Boolean(logoUrl) && !logoFailed;
    const tagline = String(item.tagline || '').trim();
    const summary = String(item.summary || '').trim();
    const season = Number(item.parentIndex);
    const episode = Number(item.index);
    const epCode = item.type === 'episode' && season > 0 && episode > 0 ? `S${season} E${episode}` : '';
    const episodeTitle = item.type === 'episode'
        ? String(
            item.episodeTitle
            || (item.showTitle && item.title && item.title !== item.showTitle ? item.title : '')
            || '',
        ).trim()
        : '';
    const epLine = [epCode, episodeTitle].filter(Boolean).join(' · ');
    const date = formatPlayerDate(item.originallyAvailableAt);
    const dateIsFuture = isFuturePlayerDate(item.originallyAvailableAt);
    const duration = formatPlayerDuration(item.durationMs);
    const rating = String(item.contentRating || '').trim();
    const year = item.type === 'episode' ? '' : (item.year ? String(item.year) : '');
    // Each its own part, so every one gets a separator (S17 E4 · Title · Date · 48m · TV-14).
    const meta = [epCode, episodeTitle, date || year, duration, rating].filter(Boolean);
    const cast = (item.cast || []).slice(0, 4).map((row) => row.name).filter(Boolean).join(', ');
    return (
        <div className="player-home-spot-stage" aria-live="polite">
            <div className="player-home-spot">
                <PlayerServiceBrandMark item={item} className="player-home-spot-service-logo" />
                {showLogo ? (
                    <>
                        <PlayerClearLogo
                            src={logoUrl}
                            alt={title}
                            className="player-home-spot-logo"
                            trimTop={false}
                            onError={() => setLogoFailed(true)}
                        />
                        <h2 className="sr-only">{title}</h2>
                    </>
                ) : (
                    <h2 className="player-home-spot-title">{title}</h2>
                )}
                {!epLine && tagline ? <p className="player-home-spot-tagline">{tagline}</p> : null}
                {item.watched || meta.length ? (
                    <p className="player-home-spot-meta">
                        {item.watched ? (
                            <span className="player-home-spot-watched">
                                <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                                Watched
                            </span>
                        ) : null}
                        {meta.map((part, index) => (
                            <React.Fragment key={`${index}:${part}`}>
                                {index > 0 ? <span className="player-home-spot-meta-sep" aria-hidden="true">·</span> : null}
                                <span
                                className={part === episodeTitle
                                    ? 'player-home-spot-meta-title'
                                    : (dateIsFuture && part === date ? 'text-plex' : undefined)}
                            >
                                {part}
                            </span>
                            </React.Fragment>
                        ))}
                    </p>
                ) : null}
                {summary ? <p className="player-home-spot-summary">{summary}</p> : null}
                {cast ? <p className="player-home-spot-cast">{cast}</p> : null}
            </div>
        </div>
    );
};

export const PlayerTvHubStage: React.FC<Props> = ({
    active = true,
    loading = false,
    rows,
    density,
    resetKey = '',
    ariaLabel,
    header = null,
    emptyTitle,
    onEmptyRetry,
    onEmptyBack,
    allowViewAll = false,
    onOpenItem,
    onPlay,
    onToggleWatched,
    onPlayNext,
    onWatchedChange,
    onRemovedFromContinueWatching,
    onDeleted,
    onToast,
    isAdmin = false,
    playlistsEnabled = true,
}) => {
    const [tvRowIndex, setTvRowIndex] = useState(0);
    const [tvFocusKey, setTvFocusKey] = useState('');
    const [tvSpotExtra, setTvSpotExtra] = useState<Record<string, PlayerItem>>({});
    const stageRef = useRef<HTMLDivElement | null>(null);
    const tvRowIndexRef = useRef(0);
    const tvRowsRef = useRef(rows);
    const tvRowFocusRef = useRef<Record<string, string>>({});
    tvRowIndexRef.current = tvRowIndex;
    tvRowsRef.current = rows;

    const tvRowSafeIndex = Math.min(tvRowIndex, Math.max(0, rows.length - 1));
    const tvActiveRow = rows[tvRowSafeIndex] || null;
    const tvSpotItem = useMemo(() => {
        if (!tvActiveRow) return null;
        const key = tvFocusKey || tvActiveRow.items[0]?.ratingKey || '';
        const base = tvActiveRow.items.find((row) => row.ratingKey === key) || tvActiveRow.items[0] || null;
        // Rating keys repeat across servers: the fetched details are kept per server.
        const extra = key && base ? tvSpotExtra[spotExtraKey(base.serverId, key)] : (key ? tvSpotExtra[key] : null);
        if (!base) return extra || null;
        if (!extra) return base;
        const episodeBase = base.type === 'episode' || extra.type === 'episode';
        return {
            ...base,
            ...extra,
            thumb: base.thumb || extra.thumb,
            art: base.art || extra.art,
            logo: extra.logo || base.logo,
            type: episodeBase ? 'episode' : (extra.type || base.type),
            title: base.title,
            showTitle: base.showTitle || extra.showTitle || (episodeBase ? extra.showTitle : null),
            episodeTitle: base.episodeTitle
                || extra.episodeTitle
                || (episodeBase && extra.title && extra.title !== (base.showTitle || base.title) ? extra.title : null),
            parentIndex: base.parentIndex ?? extra.parentIndex,
            index: base.index ?? extra.index,
            summary: pickRicherSummary(base.summary, extra.summary),
            ratingKey: base.ratingKey,
            parentRatingKey: base.parentRatingKey || extra.parentRatingKey,
            grandparentRatingKey: base.grandparentRatingKey || extra.grandparentRatingKey,
        };
    }, [tvActiveRow, tvFocusKey, tvSpotExtra]);

    const focusStillSeed = useMemo(() => {
        const first = rows[0]?.items?.[0];
        return plexBackdropUrl(
            (first as { backdropArt?: string | null } | undefined)?.backdropArt || first?.art || first?.thumb,
        ) || '';
    }, [rows]);
    const stageStillSeed = plexBackdropUrl(
        (tvSpotItem as { backdropArt?: string | null } | null)?.backdropArt || tvSpotItem?.art || tvSpotItem?.thumb || '',
    ) || focusStillSeed;

    useEffect(() => {
        if (!active) return;
        const prev = rows[tvRowSafeIndex - 1];
        const next = rows[tvRowSafeIndex + 1];
        const neighbors = [
            playerItemBackdropUrl(next?.items?.[0]),
            playerItemBackdropUrl(next?.items?.[1]),
            playerItemBackdropUrl(prev?.items?.[0]),
            playerItemBackdropUrl(prev?.items?.[1]),
        ];
        pinTvNeighborBackdrops(neighbors);
        if (stageStillSeed) warmPlayerBackdrop(stageStillSeed, true);
        const nextFirst = playerItemBackdropUrl(next?.items?.[0]);
        if (nextFirst) warmPlayerBackdrop(nextFirst, true);
        if (rows.length) prefetchHomeRowPosters(rows, tvRowSafeIndex);
    }, [active, rows, stageStillSeed, tvActiveRow?.id, tvRowSafeIndex]);

    const menuProps = useMemo(() => ({
        onPlayNext,
        onWatchedChange,
        onRemovedFromContinueWatching,
        onDeleted,
        onToast,
        isAdmin,
        playlistsEnabled,
    }), [
        isAdmin,
        onDeleted,
        onPlayNext,
        onRemovedFromContinueWatching,
        onToast,
        onWatchedChange,
        playlistsEnabled,
    ]);

    useEffect(() => {
        setTvRowIndex(0);
        setTvFocusKey('');
        setTvSpotExtra({});
        tvRowFocusRef.current = {};
    }, [resetKey]);

    useEffect(() => {
        if (tvRowIndex >= rows.length && rows.length) setTvRowIndex(0);
    }, [rows.length, tvRowIndex]);

    useEffect(() => {
        if (!active) return undefined;
        const stageRoot = () => stageRef.current || visibleHomeStage();
        const onRow = (event: Event) => {
            const dir = (event as CustomEvent<{ dir?: 'up' | 'down' }>).detail?.dir;
            const list = tvRowsRef.current;
            if (!list.length || (dir !== 'down' && dir !== 'up')) return;
            const stage = stageRoot();
            // Ignore row events while this stage is mounted but not the visible one
            // (Home keep-alive under Library).
            if (!stage || stage.closest('[hidden]')) return;
            const current = tvRowIndexRef.current;
            if (dir === 'up' && current <= 0) {
                const tab = stage.querySelector<HTMLElement>(
                    '.player-library-stage-chrome [data-tv-library-tabs="1"] [aria-current="page"],'
                    + '.player-library-stage-chrome [data-tv-library-tabs="1"] [data-tv-item="1"]',
                );
                if (tab) {
                    try {
                        tab.focus({ preventScroll: true });
                    } catch {
                        tab.focus();
                    }
                    return;
                }
            }
            const next = dir === 'down'
                ? Math.min(list.length - 1, current + 1)
                : Math.max(0, current - 1);
            const prev = list[current];
            if (prev && tvFocusKey) tvRowFocusRef.current[prev.id] = tvFocusKey;
            if (next !== current) {
                setTvRowIndex(next);
            }
        };
        window.addEventListener(TV_HOME_ROW_EVENT, onRow);
        return () => window.removeEventListener(TV_HOME_ROW_EVENT, onRow);
    }, [active, tvFocusKey]);

    useEffect(() => {
        if (!active || !tvActiveRow?.id || !tvFocusKey) return;
        tvRowFocusRef.current[tvActiveRow.id] = tvFocusKey;
    }, [active, tvActiveRow?.id, tvFocusKey]);

    useLayoutEffect(() => {
        if (!active || !tvActiveRow) return undefined;
        const rowId = tvActiveRow.id;
        const rowHas = (key: string) => Boolean(key) && tvActiveRow.items.some((item) => String(item.ratingKey || '') === key);
        const remembered = peekRememberedTvFocusKey();
        const saved = (rowHas(remembered) ? remembered : '')
            || (rowHas(tvRowFocusRef.current[rowId] || '') ? tvRowFocusRef.current[rowId] : '')
            || (rowHas(tvFocusKey) ? tvFocusKey : '');
        let cancelled = false;
        const focusSaved = () => {
            if (cancelled) return true;
            const stage = stageRef.current || visibleHomeStage();
            if (!stage || stage.closest('[hidden]')) return false;
            const root = stage.querySelector<HTMLElement>('.player-home-stage-rail');
            if (!root) return false;
            const posters = Array.from(root.querySelectorAll<HTMLElement>('[data-tv-poster-btn="1"]'))
                .filter((el) => !el.closest('[inert]'));
            const match = saved
                ? posters.find((el) => el.getAttribute('data-tv-key') === saved) || null
                : null;
            const btn = match || posters[0];
            if (!btn || btn.closest('.player-library-stage-chrome')) return false;
            try {
                btn.focus({ preventScroll: true });
            } catch {
                btn.focus();
            }
            pinTvRailItemToSlot(btn);
            const activeEl = document.activeElement as HTMLElement | null;
            const focused = Boolean(activeEl && (activeEl === btn || btn.contains(activeEl)));
            if (focused && saved && saved !== tvFocusKey) setTvFocusKey(saved);
            return focused;
        };
        let attempts = 0;
        const tick = () => {
            if (focusSaved()) return;
            if (cancelled || attempts++ >= 24) return;
            window.setTimeout(tick, 16);
        };
        if (focusSaved()) {
            return () => { cancelled = true; };
        }
        const timer = window.setTimeout(tick, 0);
        window.requestAnimationFrame(tick);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [active, tvActiveRow?.id]);

    useEffect(() => {
        const key = String(tvSpotItem?.ratingKey || '');
        if (!active || !key) return undefined;
        const serverId = tvSpotItem?.serverId || null;
        const extraKey = spotExtraKey(serverId, key);
        const cached = readPlayerItemCache(key, serverId);
        if (cached?.item) {
            setTvSpotExtra((prev) => (prev[extraKey] ? prev : { ...prev, [extraKey]: cached.item }));
            if (cached.item.logo && itemHasBillboardBrandMeta(cached.item) && cached.item.summary) return undefined;
        }
        let cancelled = false;
        const timer = window.setTimeout(() => {
            if (cancelled) return;
            prefetchMediaPlayerItem(key, serverId);
            void fetchMediaPlayerItem(key, { core: true, serverId })
                .then((page) => {
                    if (cancelled || !page?.item) return;
                    setTvSpotExtra((prev) => ({ ...prev, [extraKey]: page.item }));
                })
                .catch(() => undefined);
        }, 0);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [active, tvSpotItem?.ratingKey, tvSpotItem?.serverId]);

    if (loading && !rows.length) {
        return (
            <div
                ref={stageRef}
                className="tv-poster-rows player-home-page player-home-stage"
                data-tv-library="1"
                aria-busy="true"
                aria-label={ariaLabel || 'Loading'}
            >
                {header}
                <div className="player-home-focus-still" aria-hidden />
                <div
                    className="player-home-stage-rail flex min-h-[40vh] flex-col items-center justify-center gap-3"
                    data-tv-hub-loading="1"
                >
                    <Loader2 className="h-10 w-10 animate-spin text-white/70" aria-hidden />
                    <p className="text-sm font-semibold text-white/55">Loading…</p>
                </div>
            </div>
        );
    }

    if (!loading && !rows.length && emptyTitle) {
        return (
            <div ref={stageRef} className="tv-poster-rows player-home-page player-home-stage" data-tv-library="1">
                {header}
                <PlayerTvStatusPanel
                    title={emptyTitle}
                    onRetry={onEmptyRetry}
                    onBack={onEmptyBack}
                />
            </div>
        );
    }

    return (
        <div
            ref={stageRef}
            className="tv-poster-rows player-home-page player-home-stage"
            data-tv-library="1"
            aria-label={ariaLabel}
        >
            {header}
            <PlayerTvFocusStill
                enabled={active}
                seed={stageStillSeed}
                onFocusKey={setTvFocusKey}
            />
            <div className="player-home-stage-copy">
                <PlayerTvSpot item={tvSpotItem} />
                {tvActiveRow ? (
                    <PlayerTvRowStack
                        rows={rows.map((row) => ({
                            ...row,
                            onViewAll: allowViewAll ? row.onViewAll : undefined,
                            viewAllLabel: allowViewAll && row.onViewAll ? 'View More' : undefined,
                            viewMoreShelf: allowViewAll ? row.viewMoreShelf : null,
                        }))}
                        activeIndex={tvRowSafeIndex}
                        density={density}
                        restoreFocusById={tvRowFocusRef.current}
                        onOpenItem={onOpenItem}
                        onPlay={onPlay}
                        onToggleWatched={onToggleWatched}
                        {...menuProps}
                    />
                ) : null}
            </div>
        </div>
    );
};
