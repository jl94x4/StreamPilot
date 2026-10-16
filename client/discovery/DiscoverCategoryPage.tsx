import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Film, Tv } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { DiscoverPosterGrid } from './DiscoverPosterGrid';
import { DiscoverGridSizeSelect } from './DiscoverGridSizeSelect';
import { useDiscoverGridSize } from './useDiscoverGridSize';
import { useDiscoveryPreferences } from './useDiscoveryPreferences';
import { findNetwork, findStudio } from './discoverConstants';
import { DiscoveryLogo } from './DiscoveryLogo';
import { useDiscoverInfiniteScroll } from './useDiscoverInfiniteScroll';
import { DiscoverInfiniteScrollFooter } from './DiscoverInfiniteScrollFooter';
import { discoverSkeletonCountForGrid } from './discoverPaginationUtils';
import {
    buildDiscoverNetworkApiUrl,
    buildDiscoverStudioApiUrl,
    fetchDiscoverPageWithAdvance,
} from './discoverFetchUtils';
import { useDiscoverI18n } from './i18n';

type Props = {
    kind: 'studio' | 'network';
    id: number;
    onBack: () => void;
    onSelect: (item: any) => void;
    formatItem: (item: any) => any;
};

export const DiscoverCategoryPage: React.FC<Props> = ({ kind, id, onBack, onSelect, formatItem }) => {
    const { t, locale } = useDiscoverI18n();
    const { preferences } = useDiscoveryPreferences();
    const [gridSize, setGridSize] = useDiscoverGridSize();
    const containerRef = useRef<HTMLDivElement>(null);
    const meta = kind === 'studio' ? findStudio(id) : findNetwork(id);
    const [entityName, setEntityName] = useState(meta?.name || '');

    const resetKey = `${kind}:${id}:${preferences.hideAvailableMedia}:${gridSize}:${locale}`;

    const buildUrl = useCallback((page: number) => (
        kind === 'studio'
            ? buildDiscoverStudioApiUrl(page, id)
            : buildDiscoverNetworkApiUrl(page, id)
    ), [kind, id]);

    const buildFallbackUrl = useCallback((page: number) => (
        kind === 'studio'
            ? `/api/discovery/proxy/discover/movies?page=${page}&studio=${id}`
            : `/api/discovery/proxy/discover/tv?page=${page}&network=${id}`
    ), [kind, id]);

    useEffect(() => {
        apiFetch(buildUrl(1))
            .then((res) => {
                if (res?.studio?.name) setEntityName(res.studio.name);
                if (res?.network?.name) setEntityName(res.network.name);
            })
            .catch(() => undefined);
    }, [buildUrl]);

    const fetchPage = useCallback(async (page: number) => {
        try {
            return await fetchDiscoverPageWithAdvance(
                buildUrl,
                page,
                { hideAvailable: preferences.hideAvailableMedia },
            );
        } catch (primaryError) {
            console.error(primaryError);
            return fetchDiscoverPageWithAdvance(
                buildFallbackUrl,
                page,
                { hideAvailable: preferences.hideAvailableMedia },
            );
        }
    }, [buildFallbackUrl, buildUrl, preferences.hideAvailableMedia]);

    const {
        results,
        loading,
        loadingMore,
        hasMore,
        sentinelRef,
    } = useDiscoverInfiniteScroll({
        resetKey,
        gridSize,
        containerRef,
        fetchPage,
        filterOptions: { hideAvailable: preferences.hideAvailableMedia, hideRequested: false },
    });

    const title = entityName || meta?.name || (kind === 'studio' ? t('filters.studio') : t('filters.network'));
    const skeletonCount = discoverSkeletonCountForGrid(
        gridSize,
        containerRef.current?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1200),
    );

    return (
        <div className="w-full flex flex-col gap-8 pb-12">
            <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-2 text-sm font-semibold text-muted hover:text-text transition-colors w-fit"
            >
                <ArrowLeft className="w-4 h-4" />
                {t('media.backToDiscover')}
            </button>

            <div className="px-2">
                <div className="flex flex-col gap-4 p-6 rounded-2xl border border-border bg-gradient-to-br from-card/90 to-background/60">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-6 flex-1 min-w-0">
                            {meta?.logoPath ? (
                                <div className="w-[200px] h-[112px] rounded-xl border border-border bg-card/80 flex items-center justify-center flex-shrink-0">
                                    <DiscoveryLogo
                                        logoPath={meta.logoPath}
                                        alt={title}
                                        width={780}
                                        duotone
                                        className="max-w-[78%] max-h-[58%] object-contain"
                                    />
                                </div>
                            ) : (
                                <div className="w-[200px] h-[112px] rounded-xl bg-white/5 border border-border flex items-center justify-center text-text font-bold flex-shrink-0">
                                    {title}
                                </div>
                            )}
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 text-plex text-sm font-bold uppercase tracking-wider mb-2">
                                    {kind === 'studio' ? <Film className="w-4 h-4" /> : <Tv className="w-4 h-4" />}
                                    {kind === 'studio' ? t('category.movieStudio') : t('category.tvNetwork')}
                                </div>
                                <h1 className="text-3xl sm:text-4xl font-black text-text tracking-tight">{title}</h1>
                                <p className="text-sm text-muted mt-2">
                                    {kind === 'studio' ? t('category.browseStudio') : t('category.browseNetwork')}
                                </p>
                            </div>
                        </div>
                        <DiscoverGridSizeSelect
                            value={gridSize}
                            onChange={setGridSize}
                            className="self-start sm:self-center flex-shrink-0"
                        />
                    </div>
                </div>
            </div>

            <div className="px-2 flex flex-col gap-4" ref={containerRef}>
                <DiscoverPosterGrid
                    items={results}
                    gridSize={gridSize}
                    formatItem={formatItem}
                    onSelect={onSelect}
                    loading={loading}
                    skeletonCount={skeletonCount}
                    emptyMessage={kind === 'studio'
                        ? t('category.emptyMovies', { name: title })
                        : t('category.emptySeries', { name: title })}
                />

                <DiscoverInfiniteScrollFooter
                    sentinelRef={sentinelRef}
                    loadingMore={loadingMore}
                    hasMore={hasMore}
                    loading={loading}
                />
            </div>
        </div>
    );
};
