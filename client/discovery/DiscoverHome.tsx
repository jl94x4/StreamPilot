import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ChevronDown, ChevronUp, ClipboardList, Film, Music, Sparkles } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { DiscoverPosterCard } from '../screens';
import { Carousel } from './Carousel';
import { CompanyCard, GenreCard } from './DiscoverCards';
import {
    DISCOVER_NETWORKS,
    DISCOVER_STUDIOS,
    MOVIE_GENRES,
    TV_GENRES,
    buildGenreSliderImage,
} from './discoverConstants';
import { enrichDiscoveryItems, normalizeRawDiscoveryItem, dedupeDiscoverResults, getDiscoverItemKey } from './discoverItemUtils';
import { portalRequestsToDiscoveryRowItems } from './myRequestUtils';
import { filterHiddenAvailableItems, useDiscoveryPreferences } from './useDiscoveryPreferences';
import {
    fetchDiscoverHomeRowResults,
    HOME_RAIL_HIDE_AVAILABLE_MAX_PAGES,
    HOME_RAIL_HIDE_AVAILABLE_MIN_ITEMS,
} from './discoverFetchUtils';
import { enrichDiscoverBrowseRows, enrichDiscoverItemsWithAvailability } from './discoverAvailabilityEnrich';
import { WatchlistPanel } from './WatchlistPanel';
import { DiscoverSectionHeader } from './DiscoverSectionHeader';
import {
    EXTRA_MOVIE_RAILS,
    EXTRA_SERIES_RAILS,
    discoverRowPath,
    rankContentGapItems,
} from './discoverHomeRails';
import { DiscoverHomeSkeleton } from '../shared/skeletons';
import { discoveryTheme } from './discoveryThemeClasses';
import { useLibraryQueueToggle } from './useLibraryQueueToggle';
import { DiscoverGridSizeSelect } from './DiscoverGridSizeSelect';
import { useDiscoverGridSize } from './useDiscoverGridSize';
import { discoverRowCardWidthClass, posterGridCardWidthStyle, type PosterGridValue } from '../shared/portalLayout';
import { useDiscoverI18n } from './i18n';
import {
    MusicChartItem,
    MusicChartRail,
    MusicGenreItem,
    MusicGenreRail,
    MusicGenreRow,
    useMusicChartNavigation,
} from './DiscoverMusic';

type GenreSliderItem = { id: number; name: string; image?: string; backdrops?: string[] };

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

const EmptyRail: React.FC<{
    title: string;
    body: string;
    actionLabel: string;
    onAction: () => void;
    icon: React.ReactNode;
}> = ({ title, body, actionLabel, onAction, icon }) => (
    <div className={`${discoveryTheme.emptyState} !py-8 px-4 flex flex-col items-center gap-3`}>
        <div className="w-10 h-10 rounded-full bg-plex/15 text-plex flex items-center justify-center">
            {icon}
        </div>
        <div>
            <p className={discoveryTheme.emptyTitle}>{title}</p>
            <p className={discoveryTheme.emptyBody}>{body}</p>
        </div>
        <button
            type="button"
            onClick={onAction}
            className="mt-1 px-4 py-2 rounded-lg bg-plex text-black text-xs font-black hover:bg-plex-hover transition-colors"
        >
            {actionLabel}
        </button>
    </div>
);

/** Stable row component — must live outside DiscoverHome or every setState remounts posters. */
const DiscoverHomeRow: React.FC<{
    title?: string;
    items: any[];
    density: PosterGridValue;
    viewAllLabel: string;
    formatItem: (item: any) => any;
    onSelect: (item: any) => void;
    onViewAll?: () => void;
    empty?: React.ReactNode;
    animateEnter?: boolean;
    aspect?: '2/3' | 'square';
    hideTitle?: boolean;
    getQuickActions?: (item: any) => Array<{
        id: string;
        label: string;
        tone?: 'default' | 'danger';
        onClick: () => void | Promise<void>;
    }>;
}> = ({
    title = '',
    items,
    density,
    viewAllLabel,
    formatItem,
    onSelect,
    onViewAll,
    empty,
    animateEnter = false,
    aspect = '2/3',
    hideTitle = false,
    getQuickActions,
}) => {
    const visibleItems = dedupeDiscoverResults(
        (Array.isArray(items) ? items : [])
            .map((rawItem) => formatItem(rawItem))
            .filter((formatted) => formatted && !formatted.hidden),
    );

    if (!visibleItems.length) {
        if (!empty) return null;
        return (
            <div className="flex flex-col gap-2 relative">
                {!hideTitle && (
                    <DiscoverSectionHeader title={title} onViewAll={onViewAll} viewAllLabel={viewAllLabel} />
                )}
                {empty}
            </div>
        );
    }
    return (
        <div className="flex flex-col gap-2 relative">
            {!hideTitle && (
                <DiscoverSectionHeader title={title} onViewAll={onViewAll} viewAllLabel={viewAllLabel} />
            )}
            <Carousel>
                {visibleItems.map((formatted, idx) => {
                    if (!formatted) return null;
                    const itemKey = getDiscoverItemKey(formatted) || `${title || 'row'}-${formatted.id || idx}`;
                    return (
                        <div
                            key={itemKey}
                            className={`${discoverRowCardWidthClass(density)} flex-shrink-0 relative group snap-start${animateEnter ? ' discover-poster-enter' : ''}`}
                            style={{
                                ...posterGridCardWidthStyle(density),
                                ...(animateEnter ? { animationDelay: `${Math.min(idx, 12) * 30}ms` } : {}),
                            }}
                        >
                            <DiscoverPosterCard
                                item={formatted}
                                aspect={aspect}
                                overlay={formatted.overlay}
                                showQualityBadges={false}
                                onPosterClick={() => onSelect(formatted)}
                                quickActions={getQuickActions ? getQuickActions(formatted) : undefined}
                            />
                        </div>
                    );
                })}
            </Carousel>
        </div>
    );
};

const DiscoverGenreSliderRow: React.FC<{
    title: string;
    apiGenres: GenreSliderItem[];
    fallbackGenres: typeof MOVIE_GENRES;
    basePath: '/discovery/movies' | '/discovery/series';
    navigate: (path: string) => void;
    viewAllLabel: string;
    onViewAll?: () => void;
    density: PosterGridValue;
}> = ({ title, apiGenres, fallbackGenres, basePath, navigate, viewAllLabel, onViewAll }) => {
    const items = (apiGenres?.length ?? 0)
        ? apiGenres
        : fallbackGenres.map((g) => ({
            id: g.id,
            name: g.name,
            image: buildGenreSliderImage(g.id),
        }));

    return (
        <div className="flex flex-col gap-2 relative">
            <DiscoverSectionHeader title={title} onViewAll={onViewAll} viewAllLabel={viewAllLabel} />
            <Carousel>
                {items.map((g) => {
                    const fallback = fallbackGenres.find((fg) => fg.id === g.id);
                    return (
                        <GenreCard
                            key={g.id}
                            name={g.name}
                            image={g.image}
                            gradient={fallback?.gradient}
                            onClick={() => navigate(`${basePath}?genre=${g.id}`)}
                        />
                    );
                })}
            </Carousel>
        </div>
    );
};

export const DiscoverHome: React.FC<{
    onSelect: (item: any) => void;
    formatItem: (item: any) => any;
    navigate: (path: string) => void;
    pushToast?: (msg: string, type: 'success' | 'error') => void;
    providerLabel?: string;
    getQuickActions?: (item: any) => Array<{
        id: string;
        label: string;
        tone?: 'default' | 'danger';
        onClick: () => void | Promise<void>;
    }>;
}> = ({ onSelect, formatItem, navigate, pushToast, providerLabel = 'Plex', getQuickActions }) => {
    const { t, locale } = useDiscoverI18n();
    const { preferences, loaded } = useDiscoveryPreferences();
    const { showLibraryQueue, toggleLibraryQueue } = useLibraryQueueToggle();
    const [gridSize, setGridSize] = useDiscoverGridSize();
    const [rows, setRows] = useState({
        recentlyAdded: [] as any[],
        recentRequests: [] as any[],
        plexWatchlist: [] as any[],
        becauseYouWatched: [] as any[],
        becauseYouWatchedSeed: null as { mediaType: string; tmdbId: number; title?: string | null } | null,
        trending: [] as any[],
        popularMovies: [] as any[],
        upcomingMovies: [] as any[],
        popularSeries: [] as any[],
        upcomingSeries: [] as any[],
    });
    const [extraRows, setExtraRows] = useState<Record<string, any[]>>({});
    const [movieGenres, setMovieGenres] = useState<GenreSliderItem[]>(() => (
        MOVIE_GENRES.map((g) => ({ id: g.id, name: g.name, image: buildGenreSliderImage(g.id) }))
    ));
    const [tvGenres, setTvGenres] = useState<GenreSliderItem[]>(() => (
        TV_GENRES.map((g) => ({ id: g.id, name: g.name, image: buildGenreSliderImage(g.id) }))
    ));
    const [loading, setLoading] = useState(true);
    const loadGenRef = useRef(0);
    const hasPaintedRef = useRef(false);
    const [enterAnim, setEnterAnim] = useState(true);
    const [musicRows, setMusicRows] = useState<{
        topArtists: MusicChartItem[];
        topAlbums: MusicChartItem[];
        genres: MusicGenreItem[];
        genreRows: MusicGenreRow[];
    }>({ topArtists: [], topAlbums: [], genres: [], genreRows: [] });
    const { resolvingKey: musicResolvingKey, openChartItem: openMusicChartItem } = useMusicChartNavigation(
        navigate,
        () => navigate('/discovery/music'),
    );

    // Music rails are independent of the movie/TV pipeline — empty when Lidarr is not configured.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await apiFetch('/api/discovery/music/browse').catch(() => null);
                if (cancelled || !res) return;
                setMusicRows({
                    topArtists: Array.isArray(res.topArtists) ? res.topArtists : [],
                    topAlbums: Array.isArray(res.topAlbums) ? res.topAlbums : [],
                    genres: Array.isArray(res.genres) ? res.genres : [],
                    genreRows: Array.isArray(res.genreRows) ? res.genreRows : [],
                });
            } catch {
                // Best-effort — home still renders without music rails.
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const loadData = useCallback(async () => {
        if (!loaded) return;
        const gen = ++loadGenRef.current;
        const paintAbort = new AbortController();
        const paintTimer = window.setTimeout(() => paintAbort.abort(), 10000);
        // Avoid skeleton ↔ content flicker on preference/locale refreshes after first paint.
        if (!hasPaintedRef.current) setLoading(true);
        try {
            const hideAvailable = preferences.hideAvailableMedia;
            // Seerr-style: one endpoint per rail; advance same URL pages only (no multi-source storm).
            const rowOpts = {
                needsBackfill: hideAvailable,
                maxPages: hideAvailable ? 8 : 2,
                maxItems: 30,
                minItems: hideAvailable ? HOME_RAIL_HIDE_AVAILABLE_MIN_ITEMS : 30,
                hideRequested: false,
                trustAttachedAvailability: true,
                pageConcurrency: 1,
                requirePoster: true,
                signal: paintAbort.signal,
            };
            const refillRowOpts = {
                needsBackfill: true,
                maxPages: HOME_RAIL_HIDE_AVAILABLE_MAX_PAGES,
                maxItems: 30,
                minItems: HOME_RAIL_HIDE_AVAILABLE_MIN_ITEMS,
                hideRequested: false,
                trustAttachedAvailability: true,
                pageConcurrency: 1,
                requirePoster: true,
                enrich: enrichDiscoverBrowseRows,
            };
            const trendingUrl = (page: number) => `/api/discovery/proxy/discover/trending?page=${page}`;
            const moviesUrl = (page: number) => `/api/discovery/proxy/discover/movies?sortBy=popularity.desc&page=${page}`;
            const upcomingMoviesUrl = (page: number) => `/api/discovery/proxy/discover/movies/upcoming?page=${page}`;
            const seriesUrl = (page: number) => `/api/discovery/proxy/discover/tv?sortBy=popularity.desc&page=${page}`;
            const upcomingSeriesUrl = (page: number) => `/api/discovery/proxy/discover/tv/upcoming?page=${page}`;

            const [
                trendingRes,
                popularMovies,
                upcomingMovies,
                popularSeries,
                upcomingSeries,
            ] = await Promise.all([
                fetchDiscoverHomeRowResults(trendingUrl, hideAvailable, rowOpts).catch(() => []),
                fetchDiscoverHomeRowResults(moviesUrl, hideAvailable, rowOpts).catch(() => []),
                fetchDiscoverHomeRowResults(upcomingMoviesUrl, hideAvailable, rowOpts).catch(() => []),
                fetchDiscoverHomeRowResults(seriesUrl, hideAvailable, rowOpts).catch(() => []),
                fetchDiscoverHomeRowResults(upcomingSeriesUrl, hideAvailable, rowOpts).catch(() => []),
            ]);

            if (gen !== loadGenRef.current) return;

            setExtraRows({});
            setRows((prev) => ({
                ...prev,
                recentlyAdded: [],
                recentRequests: [],
                plexWatchlist: [],
                becauseYouWatched: [],
                becauseYouWatchedSeed: null,
                trending: filterHiddenAvailableItems(trendingRes, hideAvailable),
                popularMovies: filterHiddenAvailableItems(popularMovies, hideAvailable),
                upcomingMovies: filterHiddenAvailableItems(upcomingMovies, hideAvailable),
                popularSeries: filterHiddenAvailableItems(popularSeries, hideAvailable),
                upcomingSeries: filterHiddenAvailableItems(upcomingSeries, hideAvailable),
            }));
            hasPaintedRef.current = true;
            setLoading(false);
            // Stagger enter only on the first successful paint.
            window.setTimeout(() => setEnterAnim(false), 700);

            // Disk cache can miss titles that Radarr/Plex already have (common on upcoming rows).
            // Enrich after first paint so browse badges match the detail page without blocking skeletons.
            void (async () => {
                try {
                    const [
                        trending,
                        popularMovies,
                        upcomingMovies,
                        popularSeries,
                        upcomingSeries,
                    ] = await Promise.all([
                        enrichDiscoverBrowseRows(trendingRes),
                        enrichDiscoverBrowseRows(popularMovies),
                        enrichDiscoverBrowseRows(upcomingMovies),
                        enrichDiscoverBrowseRows(popularSeries),
                        enrichDiscoverBrowseRows(upcomingSeries),
                    ]);
                    if (gen !== loadGenRef.current) return;
                    const nextPrimary = {
                        trending: filterHiddenAvailableItems(trending, hideAvailable),
                        popularMovies: filterHiddenAvailableItems(popularMovies, hideAvailable),
                        upcomingMovies: filterHiddenAvailableItems(upcomingMovies, hideAvailable),
                        popularSeries: filterHiddenAvailableItems(popularSeries, hideAvailable),
                        upcomingSeries: filterHiddenAvailableItems(upcomingSeries, hideAvailable),
                    };
                    setRows((prev) => ({ ...prev, ...nextPrimary }));

                    if (hideAvailable) {
                        const refillIfShort = (buildUrl: (page: number) => string, items: any[]) => (
                            items.length >= HOME_RAIL_HIDE_AVAILABLE_MIN_ITEMS
                                ? Promise.resolve(items)
                                : fetchDiscoverHomeRowResults(buildUrl, true, refillRowOpts).catch(() => items)
                        );
                        const [
                            trendingFilled,
                            popularMoviesFilled,
                            upcomingMoviesFilled,
                            popularSeriesFilled,
                            upcomingSeriesFilled,
                        ] = await Promise.all([
                            refillIfShort(trendingUrl, nextPrimary.trending),
                            refillIfShort(moviesUrl, nextPrimary.popularMovies),
                            refillIfShort(upcomingMoviesUrl, nextPrimary.upcomingMovies),
                            refillIfShort(seriesUrl, nextPrimary.popularSeries),
                            refillIfShort(upcomingSeriesUrl, nextPrimary.upcomingSeries),
                        ]);
                        if (gen !== loadGenRef.current) return;
                        setRows((prev) => ({
                            ...prev,
                            trending: trendingFilled,
                            popularMovies: popularMoviesFilled,
                            upcomingMovies: upcomingMoviesFilled,
                            popularSeries: popularSeriesFilled,
                            upcomingSeries: upcomingSeriesFilled,
                        }));
                    }
                } catch {
                    // Best-effort — disk cache badges still render when present.
                }
            })();

            const extraRowOpts = {
                needsBackfill: hideAvailable,
                maxPages: hideAvailable ? HOME_RAIL_HIDE_AVAILABLE_MAX_PAGES : 3,
                maxItems: 36,
                minItems: hideAvailable ? HOME_RAIL_HIDE_AVAILABLE_MIN_ITEMS : 24,
                hideRequested: false,
                trustAttachedAvailability: true,
                pageConcurrency: 1,
                requirePoster: true,
                enrich: hideAvailable ? enrichDiscoverBrowseRows : undefined,
            };
            void (async () => {
                const extraRails = [...EXTRA_MOVIE_RAILS, ...EXTRA_SERIES_RAILS];
                const batchSize = 4;
                for (let i = 0; i < extraRails.length; i += batchSize) {
                    if (gen !== loadGenRef.current) return;
                    const batch = extraRails.slice(i, i + batchSize);
                    const fetched = await Promise.all(batch.map((rail) => (
                        fetchDiscoverHomeRowResults(rail.buildUrl, hideAvailable, {
                            ...extraRowOpts,
                            onPartial: (items) => {
                                if (gen !== loadGenRef.current) return;
                                setExtraRows((prev) => ({
                                    ...prev,
                                    [rail.id]: filterHiddenAvailableItems(items, hideAvailable),
                                }));
                            },
                        }).catch(() => null)
                    )));
                    if (gen !== loadGenRef.current) return;
                    setExtraRows((prev) => {
                        const next = { ...prev };
                        batch.forEach((rail, idx) => {
                            if (!fetched[idx]) return;
                            next[rail.id] = filterHiddenAvailableItems(fetched[idx], hideAvailable);
                        });
                        return next;
                    });
                    if (hideAvailable) continue;
                    if (gen !== loadGenRef.current) return;
                    const enriched = await Promise.all(
                        batch.map((rail, idx) => enrichDiscoverBrowseRows(fetched[idx] || [])),
                    );
                    if (gen !== loadGenRef.current) return;
                    setExtraRows((prev) => {
                        const next = { ...prev };
                        batch.forEach((rail, idx) => {
                            next[rail.id] = filterHiddenAvailableItems(enriched[idx], hideAvailable);
                        });
                        return next;
                    });
                }
            })();

            // Side rails + poster enrich after first paint (never block the skeleton).
            void (async () => {
                try {
                    if (gen !== loadGenRef.current) return;
                    const [addedRes, reqRes, watchlistRes, becauseRes] = await Promise.all([
                        (hideAvailable || preferences.showRecentlyAdded === false)
                            ? Promise.resolve(null)
                            : apiFetch('/api/discovery/proxy/media?filter=allavailable&take=40&sort=mediaAdded').catch(() => null),
                        apiFetch('/api/discovery/my-requests?filter=all&take=40').catch(() => null),
                        preferences.showWatchlist === false
                            ? Promise.resolve(null)
                            : apiFetch('/api/discovery/watchlist').catch(() => null),
                        apiFetch('/api/discovery/because-you-watched').catch(() => null),
                    ]);

                    if (gen !== loadGenRef.current) return;

                    const myRequestItems = Array.isArray(reqRes?.results)
                        ? portalRequestsToDiscoveryRowItems(reqRes.results)
                        : [];

                    // Normalize library/requests; enrich watchlist posters + availability (Request vs Available).
                    const recentlyAdded = (addedRes?.results || []).map(normalizeRawDiscoveryItem);
                    const recentRequests = await enrichDiscoveryItems(myRequestItems);
                    const watchlistPosters = await enrichDiscoveryItems(watchlistRes?.results || []);
                    const plexWatchlist = await enrichDiscoverItemsWithAvailability(watchlistPosters);
                    const becauseItems = await enrichDiscoverItemsWithAvailability(becauseRes?.results || []);

                    if (gen !== loadGenRef.current) return;
                    setRows((prev) => ({
                        ...prev,
                        recentlyAdded,
                        recentRequests: filterHiddenAvailableItems(recentRequests, hideAvailable),
                        plexWatchlist,
                        becauseYouWatched: filterHiddenAvailableItems(becauseItems, hideAvailable),
                        becauseYouWatchedSeed: becauseRes?.seed || null,
                    }));
                } catch {
                    // Side rails are best-effort.
                }
            })();

            // Genre sliders after rows are visible (best-effort, no per-genre fan-out).
            void (async () => {
                try {
                    if (gen !== loadGenRef.current) return;
                    const [movieGenreRes, tvGenreRes] = await Promise.all([
                        apiFetch('/api/discovery/proxy/discover/genreslider/movie').catch(() => null),
                        apiFetch('/api/discovery/proxy/discover/genreslider/tv').catch(() => null),
                    ]);
                    if (gen !== loadGenRef.current) return;
                    const mappedMovies = mapGenreSliderResponse(movieGenreRes);
                    const mappedTv = mapGenreSliderResponse(tvGenreRes);
                    setMovieGenres(mappedMovies.length
                        ? mappedMovies.map((g) => ({ ...g, image: g.image || buildGenreSliderImage(g.id) }))
                        : MOVIE_GENRES.map((g) => ({ id: g.id, name: g.name, image: buildGenreSliderImage(g.id) })));
                    setTvGenres(mappedTv.length
                        ? mappedTv.map((g) => ({ ...g, image: g.image || buildGenreSliderImage(g.id) }))
                        : TV_GENRES.map((g) => ({ id: g.id, name: g.name, image: buildGenreSliderImage(g.id) })));
                } catch {
                    if (gen !== loadGenRef.current) return;
                    setMovieGenres(MOVIE_GENRES.map((g) => ({ id: g.id, name: g.name, image: buildGenreSliderImage(g.id) })));
                    setTvGenres(TV_GENRES.map((g) => ({ id: g.id, name: g.name, image: buildGenreSliderImage(g.id) })));
                }
            })();

            // Refresh stale request badges on home rails (e.g. finished downloads still stamped Processing).
            void (async () => {
                try {
                    if (gen !== loadGenRef.current) return;
                    const [trendingFresh, popularMoviesFresh, popularSeriesFresh] = await Promise.all([
                        enrichDiscoverItemsWithAvailability(trendingRes),
                        enrichDiscoverItemsWithAvailability(popularMovies),
                        enrichDiscoverItemsWithAvailability(popularSeries),
                    ]);
                    if (gen !== loadGenRef.current) return;
                    setRows((prev) => ({
                        ...prev,
                        trending: filterHiddenAvailableItems(trendingFresh, hideAvailable),
                        popularMovies: filterHiddenAvailableItems(popularMoviesFresh, hideAvailable),
                        popularSeries: filterHiddenAvailableItems(popularSeriesFresh, hideAvailable),
                    }));
                } catch {
                    // Best-effort badge refresh.
                }
            })();
        } catch (e) {
            console.error(e);
            if (gen === loadGenRef.current) setLoading(false);
        } finally {
            window.clearTimeout(paintTimer);
            if (gen === loadGenRef.current) setLoading(false);
        }
    }, [loaded, preferences.hideAvailableMedia, preferences.discoverRegion, preferences.discoverLanguage, preferences.showRecentlyAdded, preferences.showWatchlist, locale]);

    useEffect(() => {
        loadData();
        return () => {
            loadGenRef.current += 1;
        };
    }, [loadData]);

    const contentGapItems = useMemo(() => rankContentGapItems([
        ...(rows.becauseYouWatched || []).map((item) => ({ item, boost: 20 })),
        ...(rows.trending || []).map((item) => ({ item, boost: 12 })),
        ...(rows.popularMovies || []).map((item) => ({ item, boost: 8 })),
        ...(rows.popularSeries || []).map((item) => ({ item, boost: 8 })),
    ], 30), [rows.becauseYouWatched, rows.trending, rows.popularMovies, rows.popularSeries]);

    if (loading) {
        return (
            <div aria-busy="true">
                <DiscoverHomeSkeleton />
            </div>
        );
    }

    return (
        <div className={`discover-layout-container flex flex-col gap-6 w-full max-w-full min-w-0 pb-8${enterAnim ? ' discover-content-enter' : ''}`}>
            <section className={discoveryTheme.personalPanel}>
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-[10px] font-black text-plex">{t('home.forYou')}</p>
                        <h2 className="text-lg sm:text-xl font-black text-text mt-1">{t('home.libraryQueue')}</h2>
                        {showLibraryQueue && (
                            <p className="text-sm text-muted mt-1">{t('home.libraryQueueHint')}</p>
                        )}
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-2">
                        <button
                            type="button"
                            onClick={toggleLibraryQueue}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-white/5 hover:bg-white/10 text-xs font-bold text-muted hover:text-text transition-colors"
                            aria-expanded={showLibraryQueue}
                            aria-controls="discover-library-queue"
                            title={showLibraryQueue ? t('home.hideLibraryQueue') : t('home.showLibraryQueue')}
                        >
                            {showLibraryQueue ? t('common.hide') : t('common.show')}
                            {showLibraryQueue ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                    </div>
                </div>

                {showLibraryQueue && (
                    <div id="discover-library-queue" className="flex flex-col gap-5">
                        <DiscoverHomeRow
                            title={t('home.yourRequests')}
                            items={rows.recentRequests}
                            density={gridSize}
                            viewAllLabel={t('common.viewAll')}
                            formatItem={formatItem}
                            onSelect={onSelect}
                            animateEnter={enterAnim}
                            getQuickActions={getQuickActions}
                            onViewAll={() => navigate('/discovery/requests')}
                            empty={(
                                <EmptyRail
                                    title={t('home.noRequestsTitle')}
                                    body={t('home.noRequestsBody')}
                                    actionLabel={t('home.browseMovies')}
                                    onAction={() => navigate('/discovery/movies')}
                                    icon={<ClipboardList className="w-5 h-5" />}
                                />
                            )}
                        />

                        {preferences.showWatchlist !== false && (rows.plexWatchlist?.length ?? 0) > 0 ? (
                            <WatchlistPanel
                                items={rows.plexWatchlist}
                                formatItem={formatItem}
                                onSelect={onSelect}
                                navigate={navigate}
                                pushToast={pushToast}
                                onRefresh={loadData}
                                variant="row"
                                providerLabel={providerLabel}
                                density={gridSize}
                            />
                        ) : preferences.showWatchlist !== false ? (
                            <div className="flex flex-col gap-2">
                                <DiscoverSectionHeader
                                    title={t('watchlist.title', { provider: providerLabel })}
                                    onViewAll={() => navigate('/discovery/watchlist')}
                                    viewAllLabel={t('common.viewAll')}
                                />
                                <EmptyRail
                                    title={t('home.watchlistEmptyTitle')}
                                    body={t('home.watchlistEmptyBody', { provider: providerLabel })}
                                    actionLabel={t('home.seeTrending')}
                                    onAction={() => {
                                        document.getElementById('discover-trending')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                    }}
                                    icon={<Sparkles className="w-5 h-5" />}
                                />
                            </div>
                        ) : null}

                        {rows.becauseYouWatchedSeed && (
                            <DiscoverHomeRow
                                title={t('home.becauseYouWatched', {
                                    title: rows.becauseYouWatchedSeed.title || t('mediaType.tvShow'),
                                })}
                                items={rows.becauseYouWatched || []}
                                density={gridSize}
                                viewAllLabel={t('common.viewAll')}
                                formatItem={formatItem}
                                onSelect={onSelect}
                                animateEnter={enterAnim}
                                getQuickActions={getQuickActions}
                                onViewAll={() => navigate(discoverRowPath('because-you-watched'))}
                            />
                        )}
                    </div>
                )}
            </section>

            <section className={discoveryTheme.browseSection}>
                <div className="flex items-end justify-between gap-3 flex-wrap">
                    <div>
                        <p className={discoveryTheme.personalEyebrow}>{t('home.browse')}</p>
                        <h2 className="text-lg sm:text-xl font-black text-text mt-1">{t('home.whatsPopular')}</h2>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3">
                        <DiscoverGridSizeSelect value={gridSize} onChange={setGridSize} />
                        <button
                            type="button"
                            onClick={() => navigate('/discovery/movies')}
                            className="text-xs font-bold text-plex hover:underline inline-flex items-center gap-1"
                        >
                            <Film className="w-3.5 h-3.5" /> {t('home.allMovies')}
                        </button>
                    </div>
                </div>

                {preferences.showRecentlyAdded !== false && (
                    <DiscoverHomeRow
                        title={t('home.recentlyAdded')}
                        items={rows.recentlyAdded}
                        density={gridSize}
                        viewAllLabel={t('common.viewAll')}
                        formatItem={formatItem}
                        onSelect={onSelect}
                        animateEnter={enterAnim}
                        getQuickActions={getQuickActions}
                        onViewAll={() => navigate(discoverRowPath('recently-added'))}
                    />
                )}
                <div id="discover-trending">
                    <DiscoverHomeRow
                        title={t('home.trending')}
                        items={rows.trending}
                        density={gridSize}
                        viewAllLabel={t('common.viewAll')}
                        formatItem={formatItem}
                        onSelect={onSelect}
                        animateEnter={enterAnim}
                        getQuickActions={getQuickActions}
                        onViewAll={() => navigate(discoverRowPath('trending'))}
                    />
                </div>
                <DiscoverHomeRow
                    title={t('home.contentGapPicks')}
                    items={contentGapItems}
                    density={gridSize}
                    viewAllLabel={t('common.viewAll')}
                    formatItem={formatItem}
                    onSelect={onSelect}
                    animateEnter={enterAnim}
                    getQuickActions={getQuickActions}
                    onViewAll={() => navigate(discoverRowPath('content-gap'))}
                    empty={(
                        <EmptyRail
                            title={t('home.contentGapEmptyTitle')}
                            body={t('home.contentGapEmptyBody')}
                            actionLabel={t('home.browseMovies')}
                            onAction={() => navigate('/discovery/movies')}
                            icon={<Sparkles className="w-5 h-5" />}
                        />
                    )}
                />
                <DiscoverHomeRow
                    title={t('home.popularMovies')}
                    items={rows.popularMovies}
                    density={gridSize}
                    viewAllLabel={t('common.viewAll')}
                    formatItem={formatItem}
                    onSelect={onSelect}
                    animateEnter={enterAnim}
                    getQuickActions={getQuickActions}
                    onViewAll={() => navigate('/discovery/movies')}
                />
                <DiscoverGenreSliderRow
                    title={t('home.movieGenres')}
                    apiGenres={movieGenres}
                    fallbackGenres={MOVIE_GENRES}
                    basePath="/discovery/movies"
                    navigate={navigate}
                    viewAllLabel={t('common.viewAll')}
                    onViewAll={() => navigate(discoverRowPath('movie-genres'))}
                    density={gridSize}
                />
                <DiscoverHomeRow
                    title={t('home.upcomingMovies')}
                    items={rows.upcomingMovies}
                    density={gridSize}
                    viewAllLabel={t('common.viewAll')}
                    formatItem={formatItem}
                    onSelect={onSelect}
                    animateEnter={enterAnim}
                    getQuickActions={getQuickActions}
                    onViewAll={() => navigate(discoverRowPath('upcoming-movies'))}
                />
                {EXTRA_MOVIE_RAILS.map((rail) => (
                    <DiscoverHomeRow
                        key={rail.id}
                        title={t(rail.titleKey, rail.titleVars)}
                        items={extraRows[rail.id] || []}
                        density={gridSize}
                        viewAllLabel={t('common.viewAll')}
                        formatItem={formatItem}
                        onSelect={onSelect}
                        animateEnter={enterAnim}
                        getQuickActions={getQuickActions}
                        onViewAll={() => navigate(rail.viewAllPath())}
                    />
                ))}

                <div className="flex flex-col gap-2 relative rounded-2xl border border-border/60 bg-white/[0.02] p-3 sm:p-4">
                    <DiscoverSectionHeader
                        title={t('home.studios')}
                        onViewAll={() => navigate(discoverRowPath('studios'))}
                        viewAllLabel={t('common.viewAll')}
                    />
                    <Carousel>
                        {DISCOVER_STUDIOS.map((studio) => (
                            <CompanyCard
                                key={studio.id}
                                name={studio.name}
                                logoPath={studio.logoPath}
                                onClick={() => navigate(`/discovery/movies/studio/${studio.id}`)}
                            />
                        ))}
                    </Carousel>
                </div>

                <DiscoverHomeRow
                    title={t('home.popularSeries')}
                    items={rows.popularSeries}
                    density={gridSize}
                    viewAllLabel={t('common.viewAll')}
                    formatItem={formatItem}
                    onSelect={onSelect}
                    animateEnter={enterAnim}
                    getQuickActions={getQuickActions}
                    onViewAll={() => navigate('/discovery/series')}
                />
                <DiscoverGenreSliderRow
                    title={t('home.seriesGenres')}
                    apiGenres={tvGenres}
                    fallbackGenres={TV_GENRES}
                    basePath="/discovery/series"
                    navigate={navigate}
                    viewAllLabel={t('common.viewAll')}
                    onViewAll={() => navigate(discoverRowPath('series-genres'))}
                    density={gridSize}
                />
                <DiscoverHomeRow
                    title={t('home.upcomingSeries')}
                    items={rows.upcomingSeries}
                    density={gridSize}
                    viewAllLabel={t('common.viewAll')}
                    formatItem={formatItem}
                    onSelect={onSelect}
                    animateEnter={enterAnim}
                    getQuickActions={getQuickActions}
                    onViewAll={() => navigate(discoverRowPath('upcoming-series'))}
                />
                {EXTRA_SERIES_RAILS.map((rail) => (
                    <DiscoverHomeRow
                        key={rail.id}
                        title={t(rail.titleKey, rail.titleVars)}
                        items={extraRows[rail.id] || []}
                        density={gridSize}
                        viewAllLabel={t('common.viewAll')}
                        formatItem={formatItem}
                        onSelect={onSelect}
                        animateEnter={enterAnim}
                        getQuickActions={getQuickActions}
                        onViewAll={() => navigate(rail.viewAllPath())}
                    />
                ))}

                <div className="flex flex-col gap-2 relative rounded-2xl border border-border/60 bg-white/[0.02] p-3 sm:p-4">
                    <DiscoverSectionHeader
                        title={t('home.networks')}
                        onViewAll={() => navigate(discoverRowPath('networks'))}
                        viewAllLabel={t('common.viewAll')}
                    />
                    <Carousel>
                        {DISCOVER_NETWORKS.map((network) => (
                            <CompanyCard
                                key={`${network.id}-${network.name}`}
                                name={network.name}
                                logoPath={network.logoPath}
                                onClick={() => navigate(`/discovery/series/network/${network.id}`)}
                            />
                        ))}
                    </Carousel>
                </div>

                {(musicRows.topArtists.length > 0 || musicRows.topAlbums.length > 0) && (
                    <>
                        <div className="flex items-end justify-between gap-3 flex-wrap mt-2">
                            <div>
                                <p className={discoveryTheme.personalEyebrow}>{t('home.browse')}</p>
                                <button
                                    type="button"
                                    onClick={() => navigate('/discovery/music')}
                                    className="text-lg sm:text-xl font-black text-text mt-1 text-left hover:text-plex transition-colors"
                                >
                                    {t('home.musicSection')}
                                </button>
                            </div>
                            <button
                                type="button"
                                onClick={() => navigate('/discovery/music')}
                                className="text-xs font-bold text-plex hover:underline inline-flex items-center gap-1"
                            >
                                <Music className="w-3.5 h-3.5" /> {t('home.allMusic')}
                            </button>
                        </div>
                        <MusicChartRail
                            title={t('music.topArtists')}
                            items={musicRows.topArtists}
                            kind="artist"
                            resolvingKey={musicResolvingKey}
                            onPick={openMusicChartItem}
                            viewAllLabel={t('common.viewAll')}
                            onViewAll={() => navigate('/discovery/music')}
                            density={gridSize}
                        />
                        <MusicGenreRail
                            title={t('music.genres')}
                            genres={musicRows.genres}
                            navigate={navigate}
                            viewAllLabel={t('common.viewAll')}
                            onViewAll={() => navigate('/discovery/music')}
                            density={gridSize}
                        />
                        <MusicChartRail
                            title={t('music.topAlbums')}
                            items={musicRows.topAlbums}
                            kind="album"
                            resolvingKey={musicResolvingKey}
                            onPick={openMusicChartItem}
                            viewAllLabel={t('common.viewAll')}
                            onViewAll={() => navigate('/discovery/music')}
                            density={gridSize}
                        />
                        {musicRows.genreRows.slice(0, 4).map((row) => (
                            <MusicChartRail
                                key={`home-genre-row-${row.id}`}
                                title={t('music.genreAlbums', { name: row.name })}
                                items={row.albums}
                                kind="album"
                                resolvingKey={musicResolvingKey}
                                onPick={openMusicChartItem}
                                viewAllLabel={t('common.viewAll')}
                                onViewAll={() => navigate(`/discovery/music?genre=${row.id}&genreName=${encodeURIComponent(row.name)}`)}
                                density={gridSize}
                            />
                        ))}
                    </>
                )}
            </section>
        </div>
    );
};
