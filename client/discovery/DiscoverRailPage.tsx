import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { CompanyCard, GenreCard } from './DiscoverCards';
import {
    DISCOVER_NETWORKS,
    DISCOVER_STUDIOS,
    MOVIE_GENRES,
    TV_GENRES,
    buildGenreSliderImage,
} from './discoverConstants';
import { DiscoverGridSizeSelect } from './DiscoverGridSizeSelect';
import { DiscoverInfiniteScrollFooter } from './DiscoverInfiniteScrollFooter';
import { DiscoverPosterGrid } from './DiscoverPosterGrid';
import {
    fetchDiscoverHomeRowResults,
    fetchDiscoverPageWithAdvance,
    HOME_RAIL_HIDE_AVAILABLE_MAX_PAGES,
} from './discoverFetchUtils';
import { rankContentGapItems, SEE_ALL_POSTER_RAILS } from './discoverHomeRails';
import { discoverSkeletonCountForGrid } from './discoverPaginationUtils';
import { normalizeRawDiscoveryItem } from './discoverItemUtils';
import { useDiscoverGridSize } from './useDiscoverGridSize';
import { useDiscoverInfiniteScroll } from './useDiscoverInfiniteScroll';
import { useDiscoveryPreferences } from './useDiscoveryPreferences';
import { useDiscoverI18n } from './i18n';

type GenreSliderItem = { id: number; name: string; image?: string };

const mapGenreSliderResponse = (payload: any): GenreSliderItem[] => {
    const list = Array.isArray(payload) ? payload : (Array.isArray(payload?.results) ? payload.results : []);
    return list
        .map((genre: any) => {
            const id = Number(genre?.id);
            const name = String(genre?.name || '').trim();
            if (!Number.isFinite(id) || !name) return null;
            const backdrops = genre?.backdrops || genre?.backdropPaths || genre?.backdrop_paths || [];
            return {
                id,
                name,
                image: genre?.image || buildGenreSliderImage(id, backdrops),
            };
        })
        .filter(Boolean) as GenreSliderItem[];
};

type Props = {
    slug: string;
    onBack: () => void;
    onSelect: (item: any) => void;
    formatItem: (item: any) => any;
    navigate: (path: string) => void;
    getQuickActions?: (item: any) => Array<{
        id: string;
        label: string;
        tone?: 'default' | 'danger';
        onClick: () => void | Promise<void>;
    }>;
};

type GridSize = ReturnType<typeof useDiscoverGridSize>[0];
type SetGridSize = ReturnType<typeof useDiscoverGridSize>[1];

const CARD_SLUGS = new Set(['movie-genres', 'series-genres', 'studios', 'networks']);

export const DiscoverRailPage: React.FC<Props> = ({
    slug,
    onBack,
    onSelect,
    formatItem,
    navigate,
    getQuickActions,
}) => {
    const { t, locale } = useDiscoverI18n();
    const { preferences } = useDiscoveryPreferences();
    const [gridSize, setGridSize] = useDiscoverGridSize();
    const containerRef = useRef<HTMLDivElement>(null);

    if (CARD_SLUGS.has(slug)) {
        return <DiscoverCardCollectionPage slug={slug} onBack={onBack} navigate={navigate} />;
    }

    if (slug === 'content-gap' || slug === 'recently-added') {
        return (
            <DiscoverStaticRailPage
                slug={slug}
                onBack={onBack}
                onSelect={onSelect}
                formatItem={formatItem}
                getQuickActions={getQuickActions}
                gridSize={gridSize}
                setGridSize={setGridSize}
                hideAvailable={preferences.hideAvailableMedia}
                locale={locale}
            />
        );
    }

    const spec = SEE_ALL_POSTER_RAILS[slug];
    if (!spec) {
        return (
            <div className="discovery-theme w-full flex flex-col gap-6 pb-12">
                <button
                    type="button"
                    onClick={onBack}
                    className="inline-flex items-center gap-2 text-sm font-semibold text-muted hover:text-text transition-colors w-fit"
                >
                    <ArrowLeft className="w-4 h-4" />
                    {t('media.backToDiscover')}
                </button>
                <p className="text-sm text-muted">{t('common.noResults')}</p>
            </div>
        );
    }

    return (
        <DiscoverPagedRailPage
            slug={slug}
            spec={spec}
            onBack={onBack}
            onSelect={onSelect}
            formatItem={formatItem}
            getQuickActions={getQuickActions}
            gridSize={gridSize}
            setGridSize={setGridSize}
            hideAvailable={preferences.hideAvailableMedia}
            locale={locale}
            containerRef={containerRef}
        />
    );
};

const DiscoverRailShell: React.FC<{
    title: string;
    onBack: () => void;
    gridSize: GridSize;
    setGridSize: SetGridSize;
    children: React.ReactNode;
}> = ({ title, onBack, gridSize, setGridSize, children }) => {
    const { t } = useDiscoverI18n();
    return (
        <div className="discovery-theme w-full flex flex-col gap-8 pb-12">
            <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-2 text-sm font-semibold text-muted hover:text-text transition-colors w-fit"
            >
                <ArrowLeft className="w-4 h-4" />
                {t('media.backToDiscover')}
            </button>
            <div className="px-2">
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                    <div className="min-w-0">
                        <h1 className="text-3xl sm:text-4xl font-black text-text tracking-tight">{title}</h1>
                        <p className="text-sm text-muted mt-2">{t('home.browseAllInRow')}</p>
                    </div>
                    <DiscoverGridSizeSelect
                        value={gridSize}
                        onChange={setGridSize}
                        className="self-start sm:self-end flex-shrink-0"
                    />
                </div>
            </div>
            {children}
        </div>
    );
};

const DiscoverPagedRailPage: React.FC<{
    slug: string;
    spec: { titleKey: string; buildUrl: (page: number) => string };
    onBack: () => void;
    onSelect: (item: any) => void;
    formatItem: (item: any) => any;
    getQuickActions?: Props['getQuickActions'];
    gridSize: GridSize;
    setGridSize: SetGridSize;
    hideAvailable: boolean;
    locale: string;
    containerRef: React.RefObject<HTMLDivElement | null>;
}> = ({
    slug,
    spec,
    onBack,
    onSelect,
    formatItem,
    getQuickActions,
    gridSize,
    setGridSize,
    hideAvailable,
    locale,
    containerRef,
}) => {
    const { t } = useDiscoverI18n();
    const [seedTitle, setSeedTitle] = useState('');
    const resetKey = `${slug}:${hideAvailable}:${gridSize}:${locale}`;

    const fetchPage = useCallback(async (page: number) => {
        const payload = await fetchDiscoverPageWithAdvance(
            spec.buildUrl,
            page,
            { hideAvailable, hideRequested: false },
        );
        if (slug === 'because-you-watched' && page === 1) {
            try {
                const first = await apiFetch(spec.buildUrl(1));
                if (first?.seed?.title) setSeedTitle(String(first.seed.title));
            } catch {
                // Title is best-effort.
            }
        }
        return payload;
    }, [hideAvailable, slug, spec]);

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
        filterOptions: { hideAvailable, hideRequested: false },
    });

    const title = slug === 'because-you-watched'
        ? t('home.becauseYouWatched', { title: seedTitle || t('mediaType.tvShow') })
        : t(spec.titleKey);
    const skeletonCount = discoverSkeletonCountForGrid(
        gridSize,
        containerRef.current?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1200),
    );

    return (
        <DiscoverRailShell title={title} onBack={onBack} gridSize={gridSize} setGridSize={setGridSize}>
            <div className="px-2 flex flex-col gap-4" ref={containerRef}>
                <DiscoverPosterGrid
                    items={results}
                    gridSize={gridSize}
                    formatItem={formatItem}
                    onSelect={onSelect}
                    getQuickActions={getQuickActions}
                    loading={loading}
                    skeletonCount={skeletonCount}
                    emptyMessage={t('common.noResults')}
                />
                <DiscoverInfiniteScrollFooter
                    sentinelRef={sentinelRef}
                    loadingMore={loadingMore}
                    hasMore={hasMore}
                    loading={loading}
                />
            </div>
        </DiscoverRailShell>
    );
};

const DiscoverStaticRailPage: React.FC<{
    slug: 'content-gap' | 'recently-added';
    onBack: () => void;
    onSelect: (item: any) => void;
    formatItem: (item: any) => any;
    getQuickActions?: Props['getQuickActions'];
    gridSize: GridSize;
    setGridSize: SetGridSize;
    hideAvailable: boolean;
    locale: string;
}> = ({
    slug,
    onBack,
    onSelect,
    formatItem,
    getQuickActions,
    gridSize,
    setGridSize,
    hideAvailable,
    locale,
}) => {
    const { t } = useDiscoverI18n();
    const [items, setItems] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        (async () => {
            try {
                if (slug === 'recently-added') {
                    const res = await apiFetch('/api/discovery/proxy/media?filter=allavailable&take=100&sort=mediaAdded').catch(() => null);
                    if (cancelled) return;
                    setItems((res?.results || []).map(normalizeRawDiscoveryItem));
                    return;
                }

                const rowOpts = {
                    needsBackfill: hideAvailable,
                    maxPages: hideAvailable ? HOME_RAIL_HIDE_AVAILABLE_MAX_PAGES : 3,
                    maxItems: 60,
                    minItems: hideAvailable ? 20 : 40,
                    hideRequested: false,
                    trustAttachedAvailability: true,
                    pageConcurrency: 1,
                    requirePoster: true,
                };
                const [trending, popularMovies, popularSeries, becauseRes] = await Promise.all([
                    fetchDiscoverHomeRowResults(
                        (page) => `/api/discovery/proxy/discover/trending?page=${page}`,
                        hideAvailable,
                        rowOpts,
                    ).catch(() => []),
                    fetchDiscoverHomeRowResults(
                        (page) => `/api/discovery/proxy/discover/movies?sortBy=popularity.desc&page=${page}`,
                        hideAvailable,
                        rowOpts,
                    ).catch(() => []),
                    fetchDiscoverHomeRowResults(
                        (page) => `/api/discovery/proxy/discover/tv?sortBy=popularity.desc&page=${page}`,
                        hideAvailable,
                        rowOpts,
                    ).catch(() => []),
                    apiFetch('/api/discovery/because-you-watched').catch(() => null),
                ]);
                if (cancelled) return;
                setItems(rankContentGapItems([
                    ...(becauseRes?.results || []).map((item: any) => ({ item, boost: 20 })),
                    ...trending.map((item) => ({ item, boost: 12 })),
                    ...popularMovies.map((item) => ({ item, boost: 8 })),
                    ...popularSeries.map((item) => ({ item, boost: 8 })),
                ], 80));
            } catch {
                if (!cancelled) setItems([]);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [hideAvailable, locale, slug]);

    const title = slug === 'recently-added' ? t('home.recentlyAdded') : t('home.contentGapPicks');

    return (
        <DiscoverRailShell title={title} onBack={onBack} gridSize={gridSize} setGridSize={setGridSize}>
            <div className="px-2">
                <DiscoverPosterGrid
                    items={items}
                    gridSize={gridSize}
                    formatItem={formatItem}
                    onSelect={onSelect}
                    getQuickActions={getQuickActions}
                    loading={loading}
                    skeletonCount={18}
                    emptyMessage={slug === 'content-gap' ? t('home.contentGapEmptyBody') : t('common.noResults')}
                />
            </div>
        </DiscoverRailShell>
    );
};

const DiscoverCardCollectionPage: React.FC<{
    slug: string;
    onBack: () => void;
    navigate: (path: string) => void;
}> = ({ slug, onBack, navigate }) => {
    const { t } = useDiscoverI18n();
    const [genres, setGenres] = useState<GenreSliderItem[]>([]);

    useEffect(() => {
        if (slug !== 'movie-genres' && slug !== 'series-genres') return;
        let cancelled = false;
        const kind = slug === 'movie-genres' ? 'movie' : 'tv';
        apiFetch(`/api/discovery/proxy/discover/genreslider/${kind}`)
            .then((payload) => {
                if (cancelled) return;
                const mapped = mapGenreSliderResponse(payload);
                setGenres(mapped.length
                    ? mapped.map((g) => ({ ...g, image: g.image || buildGenreSliderImage(g.id) }))
                    : []);
            })
            .catch(() => {
                if (!cancelled) setGenres([]);
            });
        return () => { cancelled = true; };
    }, [slug]);

    const title = slug === 'movie-genres'
        ? t('home.movieGenres')
        : slug === 'series-genres'
            ? t('home.seriesGenres')
            : slug === 'studios'
                ? t('home.studios')
                : t('home.networks');
    const subtitle = slug === 'movie-genres' || slug === 'series-genres'
        ? t('home.browseAllGenres')
        : slug === 'studios'
            ? t('home.browseAllStudios')
            : t('home.browseAllNetworks');

    const fallbackGenres = slug === 'series-genres' ? TV_GENRES : MOVIE_GENRES;
    const genreItems = genres.length
        ? genres
        : fallbackGenres.map((g) => ({ id: g.id, name: g.name, image: buildGenreSliderImage(g.id) }));
    const genreBase = slug === 'series-genres' ? '/discovery/series' : '/discovery/movies';

    return (
        <div className="discovery-theme w-full flex flex-col gap-8 pb-12">
            <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-2 text-sm font-semibold text-muted hover:text-text transition-colors w-fit"
            >
                <ArrowLeft className="w-4 h-4" />
                {t('media.backToDiscover')}
            </button>
            <div className="px-2">
                <h1 className="text-3xl sm:text-4xl font-black text-text tracking-tight">{title}</h1>
                <p className="text-sm text-muted mt-2">{subtitle}</p>
            </div>
            <div className="px-2 flex flex-wrap gap-3">
                {slug === 'studios' && DISCOVER_STUDIOS.map((studio) => (
                    <CompanyCard
                        key={studio.id}
                        name={studio.name}
                        logoPath={studio.logoPath}
                        onClick={() => navigate(`/discovery/movies/studio/${studio.id}`)}
                    />
                ))}
                {slug === 'networks' && DISCOVER_NETWORKS.map((network) => (
                    <CompanyCard
                        key={`${network.id}-${network.name}`}
                        name={network.name}
                        logoPath={network.logoPath}
                        onClick={() => navigate(`/discovery/series/network/${network.id}`)}
                    />
                ))}
                {(slug === 'movie-genres' || slug === 'series-genres') && genreItems.map((g) => {
                    const fallback = fallbackGenres.find((fg) => fg.id === g.id);
                    return (
                        <GenreCard
                            key={g.id}
                            name={g.name}
                            image={g.image}
                            gradient={fallback?.gradient}
                            onClick={() => navigate(`${genreBase}?genre=${g.id}`)}
                        />
                    );
                })}
            </div>
        </div>
    );
};
