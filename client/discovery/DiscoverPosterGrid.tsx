import React, { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { DiscoverPosterCard } from '../screens';
import { PosterCardSkeleton } from '../shared/skeletons';
import { upgraderPosterGridClass, upgraderPosterGridStyle, type PosterGridValue } from '../shared/portalLayout';
import { dedupeDiscoverResults, getDiscoverItemKey } from './discoverItemUtils';
import { discoveryTheme } from './discoveryThemeClasses';
import { useDiscoverI18n } from './i18n';
import { apiFetch } from '../shared/api';

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
    const resolvedEmptyMessage = emptyMessage || t('common.noResults');
    const visibleItems = useMemo(() => dedupeDiscoverResults(items), [items]);
    const prefetchedDetailsRef = useRef(new Set<string>());
    const prefetchDiscoverDetails = useCallback((item: any) => {
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
    const formattedItems = useMemo(() => (
        visibleItems
            .map((rawItem) => ({ rawItem, formatted: formatItem(rawItem) }))
            .filter(({ formatted }) => !formatted?.hidden)
    ), [visibleItems, formatItem]);
    // Enter-animate only the first paint after a loading cycle. Infinite-scroll appends
    // must not remount or re-animate existing posters (that flashed the grid to opacity 0).
    const wasLoadingRef = useRef(true);
    const animateEnter = !loading && wasLoadingRef.current;

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

    return (
        <div
            className={upgraderPosterGridClass(gridSize)}
            style={upgraderPosterGridStyle(gridSize)}
        >
            {formattedItems.map(({ rawItem, formatted }, index) => {
                const itemKey = getDiscoverItemKey(rawItem) || `${formatted.mediaType || formatted.type}-${formatted.id}`;
                return (
                    <div
                        key={itemKey}
                        className={animateEnter ? 'discover-poster-enter min-w-0' : 'min-w-0'}
                        style={animateEnter
                            ? { animationDelay: `${Math.min(index, 18) * 22}ms` }
                            : undefined}
                    >
                        <DiscoverPosterCard
                            item={formatted}
                            overlay={formatted.overlay}
                            showQualityBadges={false}
                            onPosterClick={() => onSelect(formatted)}
                            onPosterHover={() => prefetchDiscoverDetails(formatted)}
                            quickActions={getQuickActions ? getQuickActions(formatted) : undefined}
                        />
                    </div>
                );
            })}
        </div>
    );
};
