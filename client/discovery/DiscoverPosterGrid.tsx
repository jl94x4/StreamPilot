import React, { memo, useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { DiscoverPosterCard } from '../screens';
import { PosterCardSkeleton } from '../shared/skeletons';
import { upgraderPosterGridClass, upgraderPosterGridStyle, type PosterGridValue } from '../shared/portalLayout';
import { dedupeDiscoverResults, getDiscoverItemKey } from './discoverItemUtils';
import { discoveryTheme } from './discoveryThemeClasses';
import { useDiscoverI18n } from './i18n';
import { DiscoverSelectable } from './DiscoverSelectable';
import { DiscoverListRow } from './DiscoverListRow';
import { DiscoverSelectionBar } from './DiscoverSelectionBar';
import { useDiscoverLayout, type DiscoverLayout } from './discoverViewState';
import { apiFetch } from '../shared/api';

type QuickAction = {
    id: string;
    label: string;
    tone?: 'default' | 'danger';
    onClick: () => void | Promise<void>;
};

/** Hover prefetch only makes sense with a real pointer; touch fires emulated hover on tap. */
const canHoverPrefetch = () => {
    try {
        return typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    } catch {
        return false;
    }
};
const isCoarsePointer = () => {
    try {
        return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
    } catch {
        return false;
    }
};

type CellProps = {
    itemKey: string;
    rawItem: any;
    layout: DiscoverLayout;
    formatted: any;
    animate: boolean;
    delayMs: number;
    onSelect: (item: any) => void;
    getQuickActions?: (item: any) => QuickAction[];
    prefetch?: (item: any) => void;
};

/** Memoised so infinite-scroll appends don't re-render every poster already on screen. */
const DiscoverGridCell = memo(({ itemKey, rawItem, layout, formatted, animate, delayMs, onSelect, getQuickActions, prefetch }: CellProps) => {
    const quickActions = useMemo(
        () => (getQuickActions ? getQuickActions(formatted) : undefined),
        [getQuickActions, formatted],
    );
    const handleClick = useCallback(() => onSelect(formatted), [onSelect, formatted]);
    const handleHover = useMemo(
        () => (prefetch ? () => prefetch(formatted) : undefined),
        [prefetch, formatted],
    );
    // People are not requestable; everything else can be ticked for a bulk request.
    const selectable = formatted?.mediaType !== 'person' && formatted?.type !== 'person';
    if (layout !== 'grid') {
        return (
            <DiscoverSelectable itemKey={itemKey} item={formatted} selectable={selectable} className="min-w-0">
                <DiscoverListRow item={formatted} compact={layout === 'compact'} onClick={handleClick} onHover={handleHover} />
            </DiscoverSelectable>
        );
    }
    return (
        <DiscoverSelectable
            itemKey={itemKey}
            item={formatted}
            selectable={selectable}
            className={animate ? 'discover-poster-enter min-w-0' : 'min-w-0'}
            style={animate ? { animationDelay: `${delayMs}ms` } : undefined}
        >
            <DiscoverPosterCard
                item={formatted}
                overlay={formatted.overlay}
                showQualityBadges={false}
                onPosterClick={handleClick}
                onPosterHover={handleHover}
                quickActions={quickActions}
            />
        </DiscoverSelectable>
    );
});

type Props = {
    items: any[];
    gridSize: PosterGridValue;
    formatItem: (item: any) => any;
    onSelect: (item: any) => void;
    getQuickActions?: (item: any) => Array<{
        id: string;
        label: string;
        tone?: 'default' | 'danger';
        onClick: () => void | Promise<void>;
    }>;
    loading?: boolean;
    skeletonCount?: number;
    emptyMessage?: string;
};

export const DiscoverPosterGrid: React.FC<Props> = ({
    items,
    gridSize,
    formatItem,
    onSelect,
    getQuickActions,
    loading = false,
    skeletonCount = 15,
    emptyMessage,
}) => {
    const { t } = useDiscoverI18n();
    const [layout] = useDiscoverLayout();
    const resolvedEmptyMessage = emptyMessage || t('common.noResults');
    const visibleItems = useMemo(() => dedupeDiscoverResults(items), [items]);
    const prefetchedDetailsRef = useRef(new Set<string>());
    const prefetchDiscoverDetails = useCallback((item: any) => {
        if (!canHoverPrefetch()) return;
        const mediaType = item?.mediaType === 'tv' ? 'tv' : item?.mediaType === 'movie' ? 'movie' : null;
        const mediaId = Number(item?.id || item?.tmdbId || 0);
        if (!mediaType || !Number.isFinite(mediaId) || mediaId <= 0) return;
        const key = `${mediaType}:${mediaId}`;
        if (prefetchedDetailsRef.current.has(key)) return;
        prefetchedDetailsRef.current.add(key);
        void apiFetch(`/api/discovery/proxy/${mediaType}/${mediaId}`).catch(() => {
            // allow retry if warm-up failed
            prefetchedDetailsRef.current.delete(key);
        });
    }, []);
    // Reuse formatted objects per raw item so memoised cells keep stable props across appends.
    const formatCacheRef = useRef<{ fn: typeof formatItem; map: WeakMap<object, any> }>({ fn: formatItem, map: new WeakMap() });
    const formattedItems = useMemo(() => {
        if (formatCacheRef.current.fn !== formatItem) {
            formatCacheRef.current = { fn: formatItem, map: new WeakMap() };
        }
        const cache = formatCacheRef.current.map;
        return visibleItems
            .map((rawItem) => {
                let formatted = rawItem && typeof rawItem === 'object' ? cache.get(rawItem) : undefined;
                if (!formatted) {
                    formatted = formatItem(rawItem);
                    if (rawItem && typeof rawItem === 'object') cache.set(rawItem, formatted);
                }
                return { rawItem, formatted };
            })
            .filter(({ formatted }) => !formatted?.hidden);
    }, [visibleItems, formatItem]);
    // Enter-animate only the first paint after a loading cycle. Infinite-scroll appends
    // must not remount or re-animate existing posters (that flashed the grid to opacity 0).
    const wasLoadingRef = useRef(true);
    const animateEnter = !loading && wasLoadingRef.current && !isCoarsePointer();

    useLayoutEffect(() => {
        wasLoadingRef.current = loading;
    }, [loading]);

    if (loading) {
        return (
            <div
                className={upgraderPosterGridClass(gridSize)}
                style={upgraderPosterGridStyle(gridSize)}
                aria-busy="true"
                aria-label={t('common.loadingResults')}
            >
                {[...Array(skeletonCount)].map((_, i) => (
                    <PosterCardSkeleton
                        key={i}
                        variant="discover"
                        delayMs={Math.min(i, 14) * 28}
                    />
                ))}
            </div>
        );
    }

    if (formattedItems.length === 0) {
        return (
            <div className={`${discoveryTheme.posterEmpty} discover-content-enter`}>
                <p className={discoveryTheme.emptyTitle}>{resolvedEmptyMessage}</p>
                <p className={discoveryTheme.emptyBody}>{t('browse.emptyHint')}</p>
            </div>
        );
    }

    const listLayout = layout !== 'grid';
    return (
        <>
            <div
                className={listLayout ? `flex flex-col ${layout === 'compact' ? 'gap-1.5' : 'gap-2.5'} pb-4` : upgraderPosterGridClass(gridSize)}
                style={listLayout ? undefined : upgraderPosterGridStyle(gridSize)}
            >
                {formattedItems.map(({ rawItem, formatted }, index) => {
                    const itemKey = getDiscoverItemKey(rawItem) || `${formatted.mediaType || formatted.type}-${formatted.id}`;
                    return (
                        <DiscoverGridCell
                            key={itemKey}
                            itemKey={itemKey}
                            rawItem={rawItem}
                            layout={layout}
                            formatted={formatted}
                            animate={animateEnter && !listLayout}
                            delayMs={Math.min(index, 18) * 22}
                            onSelect={onSelect}
                            getQuickActions={getQuickActions}
                            prefetch={prefetchDiscoverDetails}
                        />
                    );
                })}
            </div>
            <DiscoverSelectionBar />
        </>
    );
};
