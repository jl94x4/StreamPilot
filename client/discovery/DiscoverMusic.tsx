import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Music, Search } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { Carousel } from './Carousel';
import { discoveryTheme } from './discoveryThemeClasses';
import { enrichDiscoverItemsWithAvailability } from './discoverAvailabilityEnrich';
import { enrichDiscoveryItems } from './discoverItemUtils';
import { portalRequestsToDiscoveryRowItems } from './myRequestUtils';
import { DiscoverStatusOverlay } from './DiscoverStatusOverlay';
import { resolveMediaAvailabilityState } from './discoverAvailability';
import { resolvePortalAssetUrl } from '../shared/basePath';
import { useDiscoverI18n } from './i18n';
import { DiscoverSectionHeader } from './DiscoverSectionHeader';
import { discoverMusicRowCardWidthClass, posterGridCardWidthStyle, type PosterGridValue } from '../shared/portalLayout';

type ArtistHit = {
    mbid: string;
    id: string;
    name: string;
    title: string;
    disambiguation?: string | null;
    posterPath?: string | null;
    overview?: string;
};

const ArtistArt: React.FC<{ src?: string | null; title?: string }> = ({ src, title }) => {
    const [failed, setFailed] = useState(false);
    const resolved = src ? resolvePortalAssetUrl(src) : '';
    useEffect(() => {
        setFailed(false);
    }, [resolved]);

    if (!resolved || failed) {
        return (
            <div className="w-full h-full flex items-center justify-center text-muted">
                <Music className="w-10 h-10 opacity-40" />
            </div>
        );
    }
    return (
        <img
            src={resolved}
            alt={title || ''}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setFailed(true)}
        />
    );
};

const MusicArtistGrid: React.FC<{
    items: any[];
    formatItem?: (item: any) => any;
    onSelect: (item: any) => void;
}> = ({ items, formatItem, onSelect }) => {
    if (!items.length) return null;

    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 px-2">
            {items.map((artist) => {
                const formatted = formatItem ? formatItem(artist) : artist;
                const poster = formatted.thumbUrl || formatted.posterPath || formatted.posterUrl;
                return (
                    <button
                        key={artist.mbid || artist.id}
                        type="button"
                        onClick={() => onSelect(formatted)}
                        className="group text-left rounded-xl border border-border/60 bg-white/[0.02] overflow-hidden hover:border-plex/40 transition-colors relative"
                    >
                        {formatted.overlay && (
                            <div className="absolute top-2 left-2 z-10">{formatted.overlay}</div>
                        )}
                        <div className="aspect-square bg-white/5 relative">
                            <ArtistArt src={poster} title={formatted.name || formatted.title} />
                        </div>
                        <div className="p-2.5">
                            <p className="font-bold text-sm leading-tight line-clamp-2 group-hover:text-plex transition-colors">
                                {formatted.name || formatted.title}
                            </p>
                            {artist.disambiguation && (
                                <p className="text-[11px] text-muted mt-1 line-clamp-2">{artist.disambiguation}</p>
                            )}
                        </div>
                    </button>
                );
            })}
        </div>
    );
};

export type MusicChartItem = {
    deezerId?: number;
    name: string;
    title: string;
    artistName?: string;
    posterUrl?: string | null;
    posterPath?: string | null;
};

export type MusicGenreItem = {
    id: number;
    name: string;
    image?: string | null;
};

export type MusicGenreRow = {
    id: number;
    name: string;
    albums: MusicChartItem[];
};

/** Resolve a Deezer chart entry to its MusicBrainz artist and open the artist page. */
export const useMusicChartNavigation = (
    navigate: (path: string) => void,
    onResolveFail?: (artistName: string) => void,
) => {
    const [resolvingKey, setResolvingKey] = useState<string | null>(null);

    const openChartItem = useCallback(async (item: MusicChartItem, key: string) => {
        const artistName = item.artistName || item.name;
        if (!artistName) return;
        setResolvingKey(key);
        try {
            const res = await apiFetch(`/api/discovery/music/resolve?name=${encodeURIComponent(artistName)}`);
            if (res?.mbid) {
                navigate(`/discovery/music/artist/${encodeURIComponent(String(res.mbid))}`);
                return;
            }
            onResolveFail?.(artistName);
        } catch {
            onResolveFail?.(artistName);
        } finally {
            setResolvingKey(null);
        }
    }, [navigate, onResolveFail]);

    return { resolvingKey, openChartItem };
};

export const MusicGenreRail: React.FC<{
    title: string;
    genres: MusicGenreItem[];
    activeGenreId?: number | null;
    navigate: (path: string) => void;
    viewAllLabel?: string;
    onViewAll?: () => void;
    density?: PosterGridValue;
}> = ({ title, genres, activeGenreId = null, navigate, viewAllLabel, onViewAll }) => {
    if (!genres.length) return null;
    return (
        <section className="flex flex-col gap-2">
            <DiscoverSectionHeader
                title={title}
                onViewAll={onViewAll || (() => navigate('/discovery/music'))}
                viewAllLabel={viewAllLabel}
            />
            <Carousel>
                {genres.map((g) => (
                    <button
                        key={g.id}
                        type="button"
                        onClick={() => navigate(`/discovery/music?genre=${g.id}&genreName=${encodeURIComponent(g.name)}`)}
                        className={`relative shrink-0 w-[150px] h-[84px] rounded-xl overflow-hidden border transition-colors group snap-start ${
                            activeGenreId === g.id ? 'border-plex' : 'border-border/60 hover:border-plex/40'
                        }`}
                    >
                        {g.image && (
                            <img src={g.image} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-50 group-hover:opacity-70 transition-opacity" />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-black/20" />
                        <span className="absolute bottom-2 left-2.5 right-2 text-sm font-black text-white text-left leading-tight">
                            {g.name}
                        </span>
                    </button>
                ))}
            </Carousel>
        </section>
    );
};

export const MusicChartRail: React.FC<{
    title: string;
    items: MusicChartItem[];
    kind: 'artist' | 'album';
    resolvingKey: string | null;
    onPick: (item: MusicChartItem, key: string) => void;
    viewAllLabel?: string;
    onViewAll?: () => void;
    density?: PosterGridValue;
}> = ({ title, items, kind, resolvingKey, onPick, viewAllLabel, onViewAll, density }) => {
    if (!items.length) return null;
    return (
        <section className="flex flex-col gap-2">
            <DiscoverSectionHeader title={title} onViewAll={onViewAll} viewAllLabel={viewAllLabel} />
            <Carousel>
                {items.map((item, idx) => {
                    const key = `${kind}-${item.deezerId ?? idx}`;
                    const busy = resolvingKey === key;
                    return (
                        <button
                            key={key}
                            type="button"
                            onClick={() => onPick(item, key)}
                            disabled={busy}
                            className={`group text-left rounded-xl border border-border/60 bg-white/[0.02] overflow-hidden hover:border-plex/40 transition-colors relative shrink-0 ${discoverMusicRowCardWidthClass(density || 9.5)} snap-start disabled:opacity-60`}
                            style={posterGridCardWidthStyle(density || 9.5)}
                        >
                            <div className="aspect-square bg-white/5 relative">
                                <ArtistArt src={item.posterUrl || item.posterPath} title={item.title} />
                                {busy && (
                                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                        <Loader2 className="w-5 h-5 animate-spin text-plex" />
                                    </div>
                                )}
                            </div>
                            <div className="p-2.5">
                                <p className="font-bold text-sm leading-tight line-clamp-2 group-hover:text-plex transition-colors">
                                    {item.title}
                                </p>
                                {kind === 'album' && item.artistName && (
                                    <p className="text-[11px] text-muted mt-1 line-clamp-1">{item.artistName}</p>
                                )}
                            </div>
                        </button>
                    );
                })}
            </Carousel>
        </section>
    );
};

export const DiscoverMusic: React.FC<{
    navigate: (path: string) => void;
    formatItem?: (item: any) => any;
    onSelect?: (item: any) => void;
}> = ({ navigate, formatItem, onSelect }) => {
    const { t } = useDiscoverI18n();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<ArtistHit[]>([]);
    const [requestArtists, setRequestArtists] = useState<ArtistHit[]>([]);
    const [loading, setLoading] = useState(false);
    const [requestsLoading, setRequestsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [charts, setCharts] = useState<{
        topArtists: MusicChartItem[];
        topAlbums: MusicChartItem[];
        genres: MusicGenreItem[];
        genreRows: MusicGenreRow[];
    }>({
        topArtists: [],
        topAlbums: [],
        genres: [],
        genreRows: [],
    });
    const [genre, setGenre] = useState<MusicGenreItem | null>(null);
    const [genreCharts, setGenreCharts] = useState<{ topArtists: MusicChartItem[]; topAlbums: MusicChartItem[] } | null>(null);
    const { resolvingKey, openChartItem } = useMusicChartNavigation(navigate, setQuery);
    const seqRef = useRef(0);
    const inputRef = useRef<HTMLInputElement | null>(null);

    const readGenreFromUrl = useCallback(() => {
        const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
        const id = Number(params.get('genre'));
        const name = String(params.get('genreName') || '').trim();
        setGenre(Number.isFinite(id) && id > 0 ? { id, name: name || `#${id}` } : null);
    }, []);

    useEffect(() => {
        readGenreFromUrl();
        window.addEventListener('popstate', readGenreFromUrl);
        window.addEventListener('portal-discovery-navigate', readGenreFromUrl);
        return () => {
            window.removeEventListener('popstate', readGenreFromUrl);
            window.removeEventListener('portal-discovery-navigate', readGenreFromUrl);
        };
    }, [readGenreFromUrl]);

    const openArtist = useCallback((item: any) => {
        const mbid = item?.mbid || item?.id;
        if (onSelect) {
            onSelect(item);
            return;
        }
        navigate(`/discovery/music/artist/${encodeURIComponent(String(mbid))}`);
    }, [navigate, onSelect]);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setRequestsLoading(true);
            try {
                const reqRes = await apiFetch('/api/discovery/my-requests?filter=all&take=40').catch(() => null);
                if (cancelled) return;
                const musicRequests = portalRequestsToDiscoveryRowItems(reqRes?.results || [])
                    .filter((item) => item?.type === 'music' || item?.media?.mediaType === 'music');
                const requestEnriched = await enrichDiscoverItemsWithAvailability(
                    await enrichDiscoveryItems(musicRequests),
                );
                if (!cancelled) setRequestArtists(requestEnriched);
            } catch {
                if (!cancelled) setRequestArtists([]);
            } finally {
                if (!cancelled) setRequestsLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await apiFetch('/api/discovery/music/browse').catch(() => null);
                if (cancelled || !res) return;
                setCharts({
                    topArtists: Array.isArray(res.topArtists) ? res.topArtists : [],
                    topAlbums: Array.isArray(res.topAlbums) ? res.topAlbums : [],
                    genres: Array.isArray(res.genres) ? res.genres : [],
                    genreRows: Array.isArray(res.genreRows) ? res.genreRows : [],
                });
            } catch {
                // Charts are optional — search still works without them.
            }
        })();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!genre?.id) {
            setGenreCharts(null);
            return undefined;
        }
        let cancelled = false;
        (async () => {
            try {
                const res = await apiFetch(`/api/discovery/music/browse?genreId=${genre.id}`).catch(() => null);
                if (cancelled || !res) return;
                setGenreCharts({
                    topArtists: Array.isArray(res.topArtists) ? res.topArtists : [],
                    topAlbums: Array.isArray(res.topAlbums) ? res.topAlbums : [],
                });
            } catch {
                if (!cancelled) setGenreCharts(null);
            }
        })();
        return () => { cancelled = true; };
    }, [genre?.id]);

    const runSearch = useCallback(async (q: string) => {
        const trimmed = q.trim();
        if (trimmed.length < 2) {
            setResults([]);
            setError(null);
            setLoading(false);
            return;
        }
        const seq = ++seqRef.current;
        setLoading(true);
        setError(null);
        try {
            const res = await apiFetch(`/api/discovery/music/search?q=${encodeURIComponent(trimmed)}`);
            if (seq !== seqRef.current) return;
            const raw = Array.isArray(res?.results) ? res.results : [];
            const enriched = await enrichDiscoverItemsWithAvailability(raw);
            if (seq !== seqRef.current) return;
            setResults(enriched);
        } catch (e: any) {
            if (seq !== seqRef.current) return;
            setResults([]);
            setError(e?.message || t('music.searchFailed'));
        } finally {
            if (seq === seqRef.current) setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void runSearch(query);
        }, 350);
        return () => window.clearTimeout(timer);
    }, [query, runSearch]);

    const searching = query.trim().length >= 2;

    return (
        <div className="discover-layout-container flex flex-col gap-5 px-1 pb-8">
            <div className="px-2">
                <p className={discoveryTheme.personalEyebrow}>{t('music.eyebrow')}</p>
                <h2 className="text-lg sm:text-xl font-black text-text mt-1">{t('music.title')}</h2>
                <p className="text-sm text-muted mt-1">{t('music.subtitle')}</p>
            </div>

            <div className="relative px-2">
                <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                <input
                    ref={inputRef}
                    type="text"
                    inputMode="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('music.searchPlaceholder')}
                    className="w-full appearance-none pl-11 pr-4 py-3 rounded-xl border border-border bg-white/5 text-[16px] leading-5 focus:outline-none focus:ring-2 focus:ring-plex/40"
                />
            </div>

            {loading && (
                <div className="py-12 flex justify-center text-muted">
                    <Loader2 className="w-6 h-6 animate-spin" />
                </div>
            )}

            {error && !loading && (
                <p className="px-3 text-sm text-red-400">{error}</p>
            )}

            {searching && !loading && !error && results.length === 0 && (
                <p className="px-3 text-sm text-muted">{t('music.noResults')}</p>
            )}

            {searching && !loading && results.length > 0 && (
                <MusicArtistGrid items={results} formatItem={formatItem} onSelect={openArtist} />
            )}

            {!searching && !loading && (
                <>
                    {(charts.topArtists.length === 0 && charts.topAlbums.length === 0 && !genre) && (
                        <div className={`${discoveryTheme.emptyState} mx-2`}>
                            <div className="w-10 h-10 rounded-full bg-plex/15 text-plex flex items-center justify-center mx-auto">
                                <Music className="w-5 h-5" />
                            </div>
                            <p className={discoveryTheme.emptyTitle}>{t('music.startTitle')}</p>
                            <p className={discoveryTheme.emptyBody}>{t('music.startBody')}</p>
                        </div>
                    )}

                    {genre && (
                        <div className="px-2 flex items-center gap-2 flex-wrap">
                            <span className="px-3 py-1.5 rounded-full bg-plex/15 border border-plex/30 text-plex text-xs font-black">
                                {genre.name}
                            </span>
                            <button
                                type="button"
                                onClick={() => navigate('/discovery/music')}
                                className="text-xs font-bold text-muted hover:text-text underline"
                            >
                                {t('music.allGenres')}
                            </button>
                        </div>
                    )}

                    <MusicChartRail
                        title={genre ? t('music.genreArtists', { name: genre.name }) : t('music.topArtists')}
                        items={genre ? (genreCharts?.topArtists || []) : charts.topArtists}
                        kind="artist"
                        resolvingKey={resolvingKey}
                        onPick={openChartItem}
                    />
                    <MusicChartRail
                        title={genre ? t('music.genreAlbums', { name: genre.name }) : t('music.topAlbums')}
                        items={genre ? (genreCharts?.topAlbums || []) : charts.topAlbums}
                        kind="album"
                        resolvingKey={resolvingKey}
                        onPick={openChartItem}
                    />

                    {genre && !genreCharts && (
                        <div className="py-8 flex justify-center text-muted">
                            <Loader2 className="w-5 h-5 animate-spin" />
                        </div>
                    )}

                    <MusicGenreRail
                        title={t('music.genres')}
                        genres={charts.genres}
                        activeGenreId={genre?.id ?? null}
                        navigate={navigate}
                    />

                    {!genre && charts.genreRows.map((row) => (
                        <MusicChartRail
                            key={`genre-row-${row.id}`}
                            title={t('music.genreAlbums', { name: row.name })}
                            items={row.albums}
                            kind="album"
                            resolvingKey={resolvingKey}
                            onPick={openChartItem}
                        />
                    ))}

                    {requestsLoading ? (
                        <div className="py-6 flex justify-center text-muted">
                            <Loader2 className="w-5 h-5 animate-spin" />
                        </div>
                    ) : requestArtists.length > 0 ? (
                        <section className="flex flex-col gap-3">
                            <h3 className={`${discoveryTheme.sectionTitle} px-2`}>{t('music.yourRequests')}</h3>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 px-2">
                                {requestArtists.map((artist) => {
                                    const formatted = formatItem ? formatItem(artist) : artist;
                                    const poster = formatted.thumbUrl || formatted.posterPath || formatted.posterUrl;
                                    const availability = resolveMediaAvailabilityState(artist);
                                    return (
                                        <button
                                            key={`req-${artist.mbid || artist.id}`}
                                            type="button"
                                            onClick={() => openArtist(formatted)}
                                            className="group text-left rounded-xl border border-border/60 bg-white/[0.02] overflow-hidden hover:border-plex/40 transition-colors"
                                        >
                                            <div className="aspect-square bg-white/5 relative">
                                                <ArtistArt src={poster} title={formatted.name || formatted.title} />
                                                {availability.kind !== 'none' && (
                                                    <DiscoverStatusOverlay state={availability} />
                                                )}
                                            </div>
                                            <div className="p-2.5">
                                                <p className="font-bold text-sm leading-tight line-clamp-2 group-hover:text-plex transition-colors">
                                                    {formatted.name || formatted.title}
                                                </p>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </section>
                    ) : null}
                </>
            )}
        </div>
    );
};
