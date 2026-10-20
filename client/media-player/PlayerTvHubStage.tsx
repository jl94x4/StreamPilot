import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { fetchMediaPlayerItem, prefetchMediaPlayerItem } from './api';
import { pinTvRailItemToSlot, visibleHomeStage } from '../plex-client/useTvRemote';
import { homeRailPosterDensity } from './host';
import { PlayerClearLogo } from './PlayerClearLogo';
import { PlayerServiceBrandMark } from './PlayerServiceBrandMark';
import { PlayerRail } from './PlayerRail';
import type { ViewMoreShelfSource } from './PlayerViewMoreCard';
import { readPlayerItemCache } from './playerMemory';
import { itemHasBillboardBrandMeta } from './studioLogo.js';
import { formatPlayerDate, formatPlayerDuration, pickRicherSummary, plexBackdropPreviewUrl, plexLogoUrl } from './playerUtils';
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
        const img = new Image();
        img.onload = () => {
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
        img.src = next;
    }, []);

    useEffect(() => {
        if (enabled && seed) show(seed);
    }, [enabled, seed, show]);

    useEffect(() => {
        if (!enabled) return undefined;
        const onFocus = (event: FocusEvent) => {
            const next = backdropFromFocusTarget(event.target);
            if (next) show(next);
            const key = itemKeyFromFocusTarget(event.target);
            if (key) onFocusKey?.(key);
        };
        document.addEventListener('focusin', onFocus, true);
        const focused = document.activeElement;
        const fromFocus = backdropFromFocusTarget(focused);
        if (fromFocus) show(fromFocus);
        const fromKey = itemKeyFromFocusTarget(focused);
        if (fromKey) onFocusKey?.(fromKey);
        return () => document.removeEventListener('focusin', onFocus, true);
    }, [enabled, onFocusKey, show]);

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
    const duration = formatPlayerDuration(item.durationMs);
    const rating = String(item.contentRating || '').trim();
    const year = item.type === 'episode' ? '' : (item.year ? String(item.year) : '');
    const meta = [epLine || null, date || year, duration, rating].filter(Boolean);
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
                        {meta.map((part) => (
                            <span key={part}>{part}</span>
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
    const tvNextRow = rows[tvRowSafeIndex + 1] || null;
    const tvSpotItem = useMemo(() => {
        if (!tvActiveRow) return null;
        const key = tvFocusKey || tvActiveRow.items[0]?.ratingKey || '';
        const base = tvActiveRow.items.find((row) => row.ratingKey === key) || tvActiveRow.items[0] || null;
        const extra = key ? tvSpotExtra[key] : null;
        if (!base) return extra || null;
        if (!extra) return base;
        const episodeBase = base.type === 'episode' || extra.type === 'episode';
        return {
            ...base,
            ...extra,
            thumb: base.thumb,
            art: extra.art || base.art,
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
        return plexBackdropPreviewUrl(first?.art || first?.thumb) || '';
    }, [rows]);
    const stageStillSeed = plexBackdropPreviewUrl(tvSpotItem?.art || tvSpotItem?.thumb || '')
        || focusStillSeed;

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
        const parkStageFocus = () => {
            // Posters unmount on row swap; without a park target the WebView jumps
            // focus to the library tabs and the orange ring vanishes for a beat.
            const stage = stageRoot();
            if (!stage) return;
            if (!stage.hasAttribute('tabindex')) stage.tabIndex = -1;
            try {
                stage.focus({ preventScroll: true });
            } catch {
                stage.focus();
            }
        };
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
                parkStageFocus();
                setTvRowIndex(next);
            }
        };
        window.addEventListener(TV_HOME_ROW_EVENT, onRow);
        return () => window.removeEventListener(TV_HOME_ROW_EVENT, onRow);
    }, [active, tvFocusKey]);

    useEffect(() => {
        if (!active || !tvActiveRow) return undefined;
        const rowId = tvActiveRow.id;
        const saved = tvRowFocusRef.current[rowId];
        let cancelled = false;
        const focusSaved = () => {
            if (cancelled) return true;
            const stage = stageRef.current || visibleHomeStage();
            if (!stage || stage.closest('[hidden]')) return false;
            const root = stage.querySelector<HTMLElement>('.player-home-stage-rail');
            if (!root) return false;
            const match = saved
                ? root.querySelector<HTMLElement>(`[data-tv-poster-btn="1"][data-tv-key="${CSS.escape(saved)}"]`)
                : null;
            const btn = match || root.querySelector<HTMLElement>('[data-tv-poster-btn="1"]');
            if (!btn || btn.closest('.player-library-stage-chrome')) return false;
            try {
                btn.focus({ preventScroll: true });
            } catch {
                btn.focus();
            }
            pinTvRailItemToSlot(btn);
            const activeEl = document.activeElement as HTMLElement | null;
            return Boolean(activeEl && (activeEl === btn || btn.contains(activeEl)));
        };
        let attempts = 0;
        const tick = () => {
            if (focusSaved()) return;
            if (cancelled || attempts++ >= 24) return;
            window.setTimeout(tick, 16);
        };
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
        const cached = readPlayerItemCache(key);
        if (cached?.item) {
            setTvSpotExtra((prev) => (prev[key] ? prev : { ...prev, [key]: cached.item }));
            if (cached.item.logo && itemHasBillboardBrandMeta(cached.item)) return undefined;
        }
        prefetchMediaPlayerItem(key);
        let cancelled = false;
        void fetchMediaPlayerItem(key, { core: true, serverId: tvSpotItem?.serverId || null })
            .then((page) => {
                if (cancelled || !page?.item) return;
                setTvSpotExtra((prev) => ({ ...prev, [key]: page.item }));
            })
            .catch(() => undefined);
        return () => { cancelled = true; };
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
            <PlayerTvSpot item={tvSpotItem} />
            {tvActiveRow ? (
                <div className="player-home-stage-rail">
                    <PlayerRail
                        key={tvActiveRow.id}
                        title={tvActiveRow.title}
                        rowId={`hub:${tvActiveRow.id}`}
                        restoreFocusKey={tvRowFocusRef.current[tvActiveRow.id]}
                        items={tvActiveRow.items}
                        density={density}
                        staggerIndex={0}
                        onOpenItem={onOpenItem}
                        onPlay={onPlay}
                        onToggleWatched={onToggleWatched}
                        showProgress={tvActiveRow.showProgress}
                        showRemoveFromContinueWatching={tvActiveRow.showRemoveFromContinueWatching}
                        aspect={tvActiveRow.aspect}
                        onViewAll={allowViewAll ? tvActiveRow.onViewAll : undefined}
                        viewAllLabel={allowViewAll && tvActiveRow.onViewAll ? 'View More' : undefined}
                        viewMoreShelf={allowViewAll ? tvActiveRow.viewMoreShelf : null}
                        {...menuProps}
                    />
                    {tvNextRow ? (
                        <div className="player-home-next-row" aria-hidden="true">
                            <div className="player-row-header">
                                <span className="player-row-header-mark" />
                                <p className="player-row-header-title truncate">{tvNextRow.title}</p>
                            </div>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
};
