import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Film, Music, Search, Tv } from 'lucide-react';
import {
    DiscoverGridSizeSelect,
    PlayerHomeHeroSkeleton,
    PlayerHomeSkeleton,
    DiscoverSectionHeader,
    discoveryTheme,
    useDiscoverGridSize,
    useDiscoverI18n,
    homeRailPosterDensity,
    upgraderLandscapeGridStyle,
    upgraderPosterGridClass,
    upgraderPosterGridStyle,
} from './host';
import { fetchMediaPlayerHome, fetchMediaPlayerHomeFull, fetchMediaPlayerHomeHero, fetchMediaPlayerHomeHeroRefresh, fetchMediaPlayerItem, fetchMediaPlayerWatchlist, prefetchMediaPlayerItem, searchMediaPlayer, setMediaPlayerWatched } from './api';
import { isPlexDirectMode } from '../plex-client/config';
import { pinTvRailItemToSlot } from '../plex-client/useTvRemote';
import { MediaPlayerHomeHero, type HomeHeroSlide } from './MediaPlayerHomeHero';
import { MediaPlayerNowPlayingChip } from './MediaPlayerNowPlayingChip';
import { PlayerPosterCard } from './PlayerPosterCard';
import { PlayerRail } from './PlayerRail';
import {
    applyHomeRowOrder,
    applyLibraryNavOrder,
    applyLibraryNavOrderToHubs,
    classifyPlayerHomeHub,
    continueWatchingRailAspect,
    PLAYER_SETTINGS_DRAFT_EVENT,
    PLAYER_SETTINGS_EVENT,
    stabilizeContinueWatchingOrder,
} from './playerSettings';
import {
    consumePlayerSearchFocus,
    isHeroSlidesCacheFresh,
    isPlayerHomeCacheFresh,
    mergePlayerHomePayloads,
    PLAYER_HOME_RESET_EVENT,
    PLAYER_SEARCH_INPUT_ID,
    PLAYER_SEARCH_OPEN_EVENT,
    PLAYER_VOICE_RESULT_EVENT,
    playerHomeHasContentHubs,
    playerHomeHasRows,
    playerHomeNeedsFull,
    readHeroSlidesCache,
    readLongPressHintSeen,
    readPlayerHomeCache,
    readPlayerItemCache,
    usePlayerNetworkStatus,
    writeHeroSlidesCache,
    writeLongPressHintSeen,
    writePlayerHomeCache,
} from './playerMemory';
import { PlayerTvStatusPanel } from './PlayerTvStatusPanel';
import { PlayerClearLogo } from './PlayerClearLogo';
import { applyRememberedProgress, formatPlayerDate, formatPlayerDuration, heroRowCardItem, hideWatchedPlayerItems, isMusicPlayerItem, mapContinueWatchingItemsForLayout, plexBackdropPreviewUrl, plexLogoUrl, PLAYER_PROGRESS_EVENT, replaceFamilyContinueSlot, restoreContinueSlot, watchTargetTouches, withShowPoster } from './playerUtils';
import { usePlayerSettings } from './usePlayerSettings';
import type { PlayerHome, PlayerItem, PlayerLibraryHub, PlayerPlayOptions, PlayerSection } from './types';

type Props = {
    active?: boolean;
    onOpenItem: (item: PlayerItem) => void;
    onPlay: (item: PlayerItem, opts?: PlayerPlayOptions) => void;
    onOpenLibrary?: (section: PlayerSection) => void;
    onOpenHub?: (hub: PlayerLibraryHub) => void;
    onOpenWatchlist?: () => void;
    onPlayNext?: (item: PlayerItem) => void;
    onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
    isAdmin?: boolean;
    playlistsEnabled?: boolean;
};

const libraryChipIcon = (type: string) => {
    if (type === 'show') return Tv;
    if (type === 'artist') return Music;
    return Film;
};

const isContinueWatchingHub = (hub: PlayerLibraryHub) => (
    /continue\s*watch|ondeck|on[.\s_-]?deck|in[.\s_-]?progress/i.test(`${hub.identifier || ''} ${hub.title || ''}`)
);

const isPlaylistHub = (hub: PlayerLibraryHub) => (
    Boolean(hub.playlistRatingKey) || /playlist/i.test(`${hub.identifier || ''} ${hub.title || ''}`)
);

const isBecauseYouWatchedHub = (hub: PlayerLibraryHub) => (
    /^because:/.test(String(hub.identifier || ''))
    || /because\s+you\s+watched/i.test(`${hub.identifier || ''} ${hub.title || ''}`)
);

const TV_HOME_ROW_EVENT = 'smp-tv-home-row';

type TvHomeRow = {
    id: string;
    title: string;
    items: PlayerItem[];
    aspect: '2/3' | '16/9' | 'square';
    showProgress?: boolean;
    showRemoveFromContinueWatching?: boolean;
    onViewAll?: () => void;
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

const HomeFocusStill: React.FC<{
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

const HomeSpot: React.FC<{ item: PlayerItem | null }> = ({ item }) => {
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
    const date = formatPlayerDate(item.originallyAvailableAt);
    const duration = formatPlayerDuration(item.durationMs);
    const rating = String(item.contentRating || '').trim();
    const year = item.type === 'episode' ? '' : (item.year ? String(item.year) : '');
    const meta = [epCode, date || year, duration, rating].filter(Boolean);
    const cast = (item.cast || []).slice(0, 4).map((row) => row.name).filter(Boolean).join(', ');
    return (
        <div className="player-home-spot">
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
            {tagline ? <p className="player-home-spot-tagline">{tagline}</p> : null}
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
    );
};

const isRecentHub = (hub: PlayerLibraryHub) => (
    /recent/i.test(`${hub.identifier || ''} ${hub.title || ''}`)
);

const dedupeItems = (list: PlayerItem[]) => {
    const seen = new Set<string>();
    return list.filter((row) => {
        const key = row.dedupeKey || row.ratingKey || row.title;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, 24);
};

export const MediaPlayerHome = React.memo(function MediaPlayerHome({
    active = true,
    onOpenItem,
    onPlay,
    onOpenLibrary,
    onOpenHub,
    onOpenWatchlist,
    onPlayNext,
    onToast,
    isAdmin = false,
    playlistsEnabled = true,
}: Props) {
    const { t } = useDiscoverI18n();
    const [settings] = usePlayerSettings();
    const [draftLibraryOrder, setDraftLibraryOrder] = useState<string[] | null>(null);
    const libraryNavOrder = draftLibraryOrder || settings.libraryNavOrder;
    const [gridSize, setGridSize] = useDiscoverGridSize();
    const homePosterDensity = homeRailPosterDensity(gridSize);
    const [longPressHint, setLongPressHint] = useState(() => !readLongPressHintSeen());
    // TV stage focus stays on posters, so "Got it" is easy to miss — leaving Home
    // marks the tip seen so it never comes back.
    useEffect(() => {
        if (active || !longPressHint) return;
        writeLongPressHintSeen();
        setLongPressHint(false);
    }, [active, longPressHint]);
    const [home, setHome] = useState<PlayerHome | null>(() => {
        const cached = readPlayerHomeCache();
        const hasRows = !!cached && (
            (cached.hubs || []).some((hub) => hub.items?.length)
            || cached.continueWatching.length > 0
            || (cached.recentByLibrary || []).some((row) => row.items?.length)
        );
        return hasRows ? cached : null;
    });
    const [heroSlides, setHeroSlides] = useState<HomeHeroSlide[]>(() => readHeroSlidesCache() || []);
    const [heroPending, setHeroPending] = useState(() => !isHeroSlidesCacheFresh());
    const [heroEffectiveMode, setHeroEffectiveMode] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [homeStale, setHomeStale] = useState(false);
    const [loading, setLoading] = useState(() => {
        const cached = readPlayerHomeCache();
        const hasRows = !!cached && (
            (cached.hubs || []).some((hub) => hub.items?.length)
            || cached.continueWatching.length > 0
            || (cached.recentByLibrary || []).some((row) => row.items?.length)
        );
        return !hasRows;
    });
    const [watchlistItems, setWatchlistItems] = useState<PlayerItem[]>([]);
    const networkOnline = usePlayerNetworkStatus();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<PlayerItem[]>([]);
    const [searching, setSearching] = useState(false);
    const [searchActive, setSearchActive] = useState(false);
    /** TV: focus can land on search without IME; Select/Enter arms editing and opens the keyboard. */
    const [searchArmed, setSearchArmed] = useState(false);
    const searchRef = useRef<HTMLInputElement>(null);
    const isTvShell = typeof document !== 'undefined' && (
        document.documentElement?.dataset?.tv === '1'
        || window.__PLEX_CLIENT__?.isTv === true
    );
    const searchReadOnly = isTvShell && !searchArmed;

    useEffect(() => {
        const openSearch = (arm = false) => {
            setSearchActive(true);
            if (arm && isTvShell) setSearchArmed(true);
            window.setTimeout(() => {
                searchRef.current?.focus({ preventScroll: false });
                if (!isTvShell) searchRef.current?.select();
            }, 0);
        };
        const onOpen = () => openSearch(isTvShell);
        const onVoice = (event: Event) => {
            const query = String((event as CustomEvent<string>).detail || '').trim();
            openSearch(true);
            if (query) setQuery(query);
        };
        if (consumePlayerSearchFocus()) openSearch(isTvShell);
        window.addEventListener(PLAYER_SEARCH_OPEN_EVENT, onOpen);
        window.addEventListener(PLAYER_VOICE_RESULT_EVENT, onVoice);
        return () => {
            window.removeEventListener(PLAYER_SEARCH_OPEN_EVENT, onOpen);
            window.removeEventListener(PLAYER_VOICE_RESULT_EVENT, onVoice);
        };
    }, [isTvShell]);

    useEffect(() => {
        if (!searchArmed || !isTvShell) return;
        const input = searchRef.current;
        if (!input) return;
        input.focus();
        input.select();
    }, [searchArmed, isTvShell]);

    useEffect(() => {
        const clearSearch = () => {
            setQuery('');
            setResults([]);
            setSearching(false);
            setSearchArmed(false);
            setSearchActive(false);
            searchRef.current?.blur();
        };
        window.addEventListener(PLAYER_HOME_RESET_EVENT, clearSearch);
        return () => window.removeEventListener(PLAYER_HOME_RESET_EVENT, clearSearch);
    }, []);

    useEffect(() => {
        const onDraft = (event: Event) => {
            const detail = (event as CustomEvent<{ libraryNavOrder?: string[] }>).detail;
            setDraftLibraryOrder(Array.isArray(detail?.libraryNavOrder) ? detail.libraryNavOrder : null);
        };
        const clearDraft = () => setDraftLibraryOrder(null);
        window.addEventListener(PLAYER_SETTINGS_DRAFT_EVENT, onDraft);
        window.addEventListener(PLAYER_SETTINGS_EVENT, clearDraft);
        return () => {
            window.removeEventListener(PLAYER_SETTINGS_DRAFT_EVENT, onDraft);
            window.removeEventListener(PLAYER_SETTINGS_EVENT, clearDraft);
        };
    }, []);

    useEffect(() => {
        setDraftLibraryOrder(null);
    }, [settings.libraryNavOrder]);

    const refreshHome = useCallback((opts?: { force?: boolean }) => {
        const cachedHome = readPlayerHomeCache();
        const cachedHasRows = playerHomeHasRows(cachedHome);
        const cachedNeedsFull = playerHomeNeedsFull(cachedHome);
        if (!cachedHasRows) setLoading(true);
        else {
            setHome(cachedHome);
            setLoading(false);
        }
        const applyFull = (full: PlayerHome, base: PlayerHome | null) => {
            const merged = playerHomeHasRows(full)
                ? mergePlayerHomePayloads(full, base || full)
                : { ...(base || full), partial: true };
            if (!playerHomeHasContentHubs(full) && !playerHomeHasContentHubs(merged)) {
                merged.partial = true;
            }
            if (playerHomeHasRows(merged)) writePlayerHomeCache(merged);
            setHome(merged);
            setHomeStale(false);
        };
        const followFull = (base: PlayerHome | null) => (
            fetchMediaPlayerHomeFull()
                .then((full) => applyFull(full, base))
                .catch(() => undefined)
        );
        const skipPartial = !opts?.force && cachedHasRows && !!cachedHome && isPlayerHomeCacheFresh();
        if (skipPartial && !cachedNeedsFull) {
            setLoading(false);
            return Promise.resolve();
        }
        if (skipPartial && cachedNeedsFull) {
            setLoading(false);
            return followFull(cachedHome);
        }
        return fetchMediaPlayerHome()
            .then((data) => {
                const cached = readPlayerHomeCache();
                let next = playerHomeHasRows(data) || !playerHomeHasRows(cached) ? data : cached;
                if (
                    data?.partial
                    && cached
                    && playerHomeHasContentHubs(cached)
                    && !playerHomeHasContentHubs(data)
                ) {
                    next = { ...mergePlayerHomePayloads(cached, data), partial: true };
                }
                if (next && playerHomeHasRows(next)) writePlayerHomeCache(next);
                setHome(next);
                setError(null);
                setHomeStale(!playerHomeHasRows(data) && playerHomeHasRows(next));
                setLoading(false);
                if (!playerHomeNeedsFull(next) && !data?.partial) return undefined;
                return followFull(next);
            })
            .catch((err) => {
                if (readPlayerHomeCache()) {
                    setHomeStale(true);
                } else {
                    setError(String(err?.message || t('mediaPlayerPage.loadError')));
                }
            })
            .finally(() => {
                setLoading(false);
            });
    }, [t]);

    useEffect(() => {
        if (!active) return undefined;
        let cancelled = false;
        void refreshHome().then(() => {
            if (cancelled) return;
        });
        if (isTvShell) {
            setHeroSlides([]);
            setHeroPending(false);
            return () => { cancelled = true; };
        }
        const cachedHero = readHeroSlidesCache();
        if (isHeroSlidesCacheFresh() && cachedHero) {
            setHeroSlides(cachedHero);
            setHeroPending(false);
            return () => { cancelled = true; };
        }
        setHeroPending(true);
        fetchMediaPlayerHomeHero()
            .then((data) => {
                if (cancelled) return;
                const mode = data?.effectiveMode ? String(data.effectiveMode) : null;
                if (mode) setHeroEffectiveMode(mode);
                const items = Array.isArray(data?.items) ? data.items.filter((row) => row?.ratingKey && row?.title) : [];
                if (items.length) {
                    writeHeroSlidesCache(items);
                    setHeroSlides(items);
                    setHeroPending(false);
                    return undefined;
                }
                // Off, and Continue Watching with nothing in progress, hide the banner.
                if (mode === 'off' || mode === 'continue_watching') {
                    writeHeroSlidesCache([]);
                    setHeroSlides([]);
                    setHeroPending(false);
                    return undefined;
                }
                if (cachedHero?.length) {
                    setHeroPending(false);
                    return undefined;
                }
                return fetchMediaPlayerHomeHeroRefresh().then((retry) => {
                    if (cancelled) return;
                    if (retry?.effectiveMode) setHeroEffectiveMode(String(retry.effectiveMode));
                    const retryItems = Array.isArray(retry?.items)
                        ? retry.items.filter((row) => row?.ratingKey && row?.title)
                        : [];
                    if (retryItems.length) {
                        writeHeroSlidesCache(retryItems);
                        setHeroSlides(retryItems);
                    }
                }).catch(() => undefined);
            })
            .catch(() => {
                if (!cancelled && !cachedHero?.length) setHeroSlides([]);
            })
            .finally(() => {
                if (!cancelled) setHeroPending(false);
            });
        return () => { cancelled = true; };
    }, [active, refreshHome]);

    useEffect(() => {
        const trimmed = query.trim();
        if (trimmed.length < 2) {
            setResults([]);
            setSearching(false);
            return undefined;
        }
        let cancelled = false;
        setSearching(true);
        const timer = window.setTimeout(() => {
            searchMediaPlayer(trimmed)
                .then((data) => {
                    if (!cancelled) setResults(data.results || []);
                })
                .catch(() => {
                    if (!cancelled) setResults([]);
                })
                .finally(() => {
                    if (!cancelled) setSearching(false);
                });
        }, 280);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [query]);

    const orderedLibraries = useMemo(
        () => applyLibraryNavOrder(home?.libraries || [], libraryNavOrder),
        [home?.libraries, libraryNavOrder],
    );

    const recentRails = useMemo(() => {
        const rows = home?.recentByLibrary || [];
        const byKey = new Map(rows.map((row) => [String(row.library.key), row]));
        if (!settings.mixLibraries) {
            return orderedLibraries.map((library) => {
                const row = byKey.get(String(library.key));
                return {
                    id: `recent:${library.key}`,
                    title: t('mediaPlayerPage.recentlyAddedIn', { name: library.title }),
                    items: (settings.hideWatchedFromRecents
                        ? hideWatchedPlayerItems(row?.items)
                        : (row?.items || [])).map(withShowPoster),
                    hubKey: `/library/sections/${library.key}/recentlyAdded`,
                    identifier: 'recentlyAdded',
                };
            }).filter((row) => row.items.length);
        }
        const typeOrder: Array<'movie' | 'show' | 'artist'> = [];
        const seenTypes = new Set<string>();
        for (const library of orderedLibraries) {
            const type = library.type === 'show' ? 'show' : library.type === 'artist' ? 'artist' : 'movie';
            if (seenTypes.has(type)) continue;
            seenTypes.add(type);
            typeOrder.push(type);
        }
        for (const type of ['movie', 'show', 'artist'] as const) {
            if (!seenTypes.has(type)) typeOrder.push(type);
        }
        const buckets: Record<'movie' | 'show' | 'artist', PlayerItem[]> = { movie: [], show: [], artist: [] };
        for (const row of rows) {
            if (row.library.type === 'show') buckets.show.push(...row.items);
            else if (row.library.type === 'artist') buckets.artist.push(...row.items);
            else buckets.movie.push(...row.items);
        }
        const titles = {
            movie: t('mediaPlayerPage.recentlyAddedMovies'),
            show: t('mediaPlayerPage.recentlyAddedShows'),
            artist: t('mediaPlayerPage.recentlyAddedMusic'),
        };
        return typeOrder.map((type) => ({
            id: `recent:${type}`,
            title: titles[type],
            items: (settings.hideWatchedFromRecents
                ? hideWatchedPlayerItems(dedupeItems(buckets[type]))
                : dedupeItems(buckets[type])).map(withShowPoster),
        })).filter((row) => row.items.length);
    }, [home, orderedLibraries, settings.hideWatchedFromRecents, settings.mixLibraries, t]);

    const hideContinueWatchingRail = !isTvShell && heroEffectiveMode === 'continue_watching';
    const showContinueWatchingRail = settings.showContinueWatching && !hideContinueWatchingRail;
    const showWatchlistRail = settings.showWatchlist;
    const continueWatchingLayout = isTvShell ? 'title' : settings.continueWatchingLayout;
    const continueWatchingAspect = continueWatchingRailAspect(continueWatchingLayout);
    const cwOrderKeysRef = useRef<string[]>([]);
    const cwOrderSortRef = useRef(settings.continueWatchingSort);
    const freezeContinueWatching = useCallback((items: PlayerItem[]) => {
        if (cwOrderSortRef.current !== settings.continueWatchingSort) {
            cwOrderKeysRef.current = [];
            cwOrderSortRef.current = settings.continueWatchingSort;
        }
        const next = stabilizeContinueWatchingOrder(
            items,
            settings.continueWatchingSort,
            cwOrderKeysRef.current,
        );
        cwOrderKeysRef.current = next.keys;
        return next.items;
    }, [settings.continueWatchingSort]);
    const layoutContinueWatching = useCallback(
        (items: PlayerItem[]) => mapContinueWatchingItemsForLayout(
            freezeContinueWatching(items),
            continueWatchingLayout,
            'plex',
        ),
        [continueWatchingLayout, freezeContinueWatching],
    );

    const plexHubs = useMemo(() => {
        const directHome = isPlexDirectMode();
        const filtered = (home?.hubs || []).filter((hub) => {
            if (!hub.items?.length) return false;
            if (isPlaylistHub(hub)) return false;
            if (directHome) return true;
            if (!showContinueWatchingRail && isContinueWatchingHub(hub)) return false;
            if (!settings.showBecauseYouWatched && isBecauseYouWatchedHub(hub)) return false;
            return true;
        }).map((hub) => (
            /recent/i.test(`${hub.identifier || ''} ${hub.title || ''}`)
                ? { ...hub, items: hub.items.map(withShowPoster) }
                : hub
        ));
        if (directHome) return filtered;
        return applyLibraryNavOrderToHubs(filtered, orderedLibraries, libraryNavOrder);
    }, [home, libraryNavOrder, orderedLibraries, showContinueWatchingRail, settings.showBecauseYouWatched]);

    useEffect(() => {
        if (!active || !showWatchlistRail) {
            setWatchlistItems([]);
            return undefined;
        }
        let cancelled = false;
        fetchMediaPlayerWatchlist()
            .then((data) => {
                if (cancelled) return;
                setWatchlistItems(Array.isArray(data?.items) ? data.items : []);
            })
            .catch(() => {
                if (!cancelled) setWatchlistItems([]);
            });
        return () => { cancelled = true; };
    }, [active, showWatchlistRail]);

    const tvHomeRows = useMemo((): TvHomeRow[] => {
        if (!isTvShell || !home) return [];
        const rows: TvHomeRow[] = [];
        const cwHub = plexHubs.find(isContinueWatchingHub);
        const cwItems = freezeContinueWatching(
            (cwHub?.items?.length ? cwHub.items : home.continueWatching) || [],
        );
        if (showContinueWatchingRail && cwItems.length) {
            rows.push({
                id: cwHub?.identifier || 'home.continueWatching',
                title: cwHub?.title || t('mediaPlayerPage.continueWatching'),
                items: cwItems.map(withShowPoster),
                aspect: '2/3',
                showProgress: true,
                showRemoveFromContinueWatching: true,
                onViewAll: onOpenHub ? () => onOpenHub(cwHub || {
                    title: t('mediaPlayerPage.continueWatching'),
                    identifier: 'home.continueWatching',
                    items: cwItems,
                    hubKey: '/library/onDeck',
                }) : undefined,
            });
        }
        if (showWatchlistRail && watchlistItems.length) {
            rows.push({
                id: 'home.watchlist',
                title: t('mediaPlayerPage.navWatchlist'),
                items: watchlistItems,
                aspect: '2/3',
                onViewAll: onOpenWatchlist,
            });
        }
        const becauseHubs = plexHubs.filter(isBecauseYouWatchedHub);
        const others = plexHubs.filter((hub) => !isContinueWatchingHub(hub) && !isBecauseYouWatchedHub(hub));
        for (const hub of others) {
            const hero = Boolean(hub.heroRow);
            rows.push({
                id: hub.identifier || `hub:${hub.title}`,
                title: hub.title,
                items: hero
                    ? hub.items.map(heroRowCardItem)
                    : (isRecentHub(hub)
                        ? (settings.hideWatchedFromRecents
                            ? hideWatchedPlayerItems(hub.items)
                            : hub.items).map(withShowPoster)
                        : hub.items),
                aspect: hero
                    ? '16/9'
                    : (classifyPlayerHomeHub(hub) === 'artist' || hub.items.every((row) => isMusicPlayerItem(row))
                        ? 'square'
                        : '2/3'),
                onViewAll: (hub.hubKey || hub.collectionRatingKey || hub.playlistRatingKey) && onOpenHub
                    ? () => onOpenHub(hub)
                    : undefined,
            });
        }
        if (!others.some(isRecentHub)) {
            for (const row of recentRails) {
                rows.push({
                    id: row.id,
                    title: row.title,
                    items: row.items,
                    aspect: row.id === 'recent:artist' || row.items.every((item) => isMusicPlayerItem(item))
                        ? 'square'
                        : '2/3',
                    onViewAll: row.hubKey && onOpenHub ? () => onOpenHub({
                        title: row.title,
                        identifier: row.identifier || 'recentlyAdded',
                        items: row.items,
                        hubKey: row.hubKey,
                    }) : undefined,
                });
            }
        }
        if (settings.showBecauseYouWatched) {
            for (const hub of becauseHubs) {
                rows.push({
                    id: hub.identifier || `hub:${hub.title}`,
                    title: hub.title,
                    items: hub.items,
                    aspect: '2/3',
                    onViewAll: (hub.hubKey || hub.collectionRatingKey || hub.playlistRatingKey) && onOpenHub
                        ? () => onOpenHub(hub)
                        : undefined,
                });
            }
        }
        return rows.filter((row) => row.items.length);
    }, [
        home,
        isTvShell,
        onOpenHub,
        onOpenWatchlist,
        freezeContinueWatching,
        plexHubs,
        recentRails,
        settings.hideWatchedFromRecents,
        settings.showBecauseYouWatched,
        showContinueWatchingRail,
        showWatchlistRail,
        t,
        watchlistItems,
    ]);

    const tvFocusStillSeed = useMemo(() => {
        if (!isTvShell || !home) return '';
        const first = tvHomeRows[0]?.items?.[0]
            || home.recentByLibrary?.[0]?.items?.[0];
        return plexBackdropPreviewUrl(first?.art || first?.thumb) || '';
    }, [home, isTvShell, tvHomeRows]);

    const searchGroups = useMemo(() => {
        const people: PlayerItem[] = [];
        const shows: PlayerItem[] = [];
        const movies: PlayerItem[] = [];
        const episodes: PlayerItem[] = [];
        const more: PlayerItem[] = [];
        for (const row of results) {
            if (row.type === 'person') people.push(row);
            else if (row.type === 'show') shows.push(row);
            else if (row.type === 'movie') movies.push(row);
            else if (row.type === 'episode') episodes.push(row);
            else more.push(row);
        }
        return [
            { id: 'person', title: t('mediaPlayerPage.searchPeople'), items: people, aspect: '2/3' as const },
            { id: 'show', title: t('mediaPlayerPage.searchShows'), items: shows, aspect: '2/3' as const },
            { id: 'movie', title: t('mediaPlayerPage.searchMovies'), items: movies, aspect: '2/3' as const },
            { id: 'episode', title: t('mediaPlayerPage.searchEpisodes'), items: episodes, aspect: '16/9' as const },
            { id: 'more', title: t('mediaPlayerPage.searchMore'), items: more, aspect: '2/3' as const },
        ].filter((group) => group.items.length);
    }, [results, t]);

    const hasRails = useMemo(() => (
        !!home && (
            plexHubs.length
            || (showContinueWatchingRail && home.continueWatching.length)
            || recentRails.some((row) => row.items.length)
        )
    ), [home, plexHubs, recentRails, showContinueWatchingRail]);

    const [tvRowIndex, setTvRowIndex] = useState(0);
    const [tvFocusKey, setTvFocusKey] = useState('');
    const [tvSpotExtra, setTvSpotExtra] = useState<Record<string, PlayerItem>>({});
    const tvRowIndexRef = useRef(0);
    const tvRowsRef = useRef(tvHomeRows);
    const tvRowFocusRef = useRef<Record<string, string>>({});
    tvRowIndexRef.current = tvRowIndex;
    tvRowsRef.current = tvHomeRows;
    const tvStage = isTvShell && !searchActive;
    const tvRowSafeIndex = Math.min(tvRowIndex, Math.max(0, tvHomeRows.length - 1));
    const tvActiveRow = tvHomeRows[tvRowSafeIndex] || null;
    const tvNextRow = tvHomeRows[tvRowSafeIndex + 1] || null;
    const tvSpotItem = useMemo(() => {
        if (!tvActiveRow) return null;
        const key = tvFocusKey || tvActiveRow.items[0]?.ratingKey || '';
        const base = tvActiveRow.items.find((row) => row.ratingKey === key) || tvActiveRow.items[0] || null;
        const extra = key ? tvSpotExtra[key] : null;
        if (!base) return extra || null;
        if (!extra) return base;
        return {
            ...base,
            ...extra,
            thumb: base.thumb,
            art: extra.art || base.art,
            logo: extra.logo || base.logo,
            title: base.title,
            showTitle: base.showTitle || extra.showTitle,
        };
    }, [tvActiveRow, tvFocusKey, tvSpotExtra]);
    const tvStageStillSeed = plexBackdropPreviewUrl(tvSpotItem?.art || tvSpotItem?.thumb || '')
        || tvFocusStillSeed;

    useEffect(() => {
        if (tvRowIndex >= tvHomeRows.length && tvHomeRows.length) setTvRowIndex(0);
    }, [tvHomeRows.length, tvRowIndex]);

    useEffect(() => {
        if (!tvStage) return undefined;
        const parkStageFocus = () => {
            const stage = document.querySelector<HTMLElement>('.player-home-stage');
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
            const rows = tvRowsRef.current;
            if (!rows.length || (dir !== 'down' && dir !== 'up')) return;
            const current = tvRowIndexRef.current;
            const next = dir === 'down'
                ? Math.min(rows.length - 1, current + 1)
                : Math.max(0, current - 1);
            const prev = rows[current];
            if (prev && tvFocusKey) tvRowFocusRef.current[prev.id] = tvFocusKey;
            if (next !== current) {
                parkStageFocus();
                setTvRowIndex(next);
            }
        };
        window.addEventListener(TV_HOME_ROW_EVENT, onRow);
        return () => window.removeEventListener(TV_HOME_ROW_EVENT, onRow);
    }, [tvFocusKey, tvStage]);

    useEffect(() => {
        if (!tvStage || !tvActiveRow) return undefined;
        const rowId = tvActiveRow.id;
        const saved = tvRowFocusRef.current[rowId];
        let cancelled = false;
        const focusSaved = () => {
            if (cancelled) return true;
            const root = document.querySelector<HTMLElement>('.player-home-stage-rail');
            if (!root) return false;
            const match = saved
                ? root.querySelector<HTMLElement>(`[data-tv-poster-btn="1"][data-tv-key="${CSS.escape(saved)}"]`)
                : null;
            const btn = match || root.querySelector<HTMLElement>('[data-tv-poster-btn="1"]');
            if (!btn) return false;
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
    }, [tvActiveRow?.id, tvStage]);

    useEffect(() => {
        const key = String(tvSpotItem?.ratingKey || '');
        if (!tvStage || !key) return undefined;
        const cached = readPlayerItemCache(key);
        if (cached?.item) {
            setTvSpotExtra((prev) => (prev[key] ? prev : { ...prev, [key]: cached.item }));
            if (cached.item.logo) return undefined;
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
    }, [tvSpotItem?.ratingKey, tvSpotItem?.serverId, tvStage]);

    useEffect(() => {
        const onProgress = (event: Event) => {
            const detail = (event as CustomEvent<{ ratingKey?: string; item?: PlayerItem; dropContinue?: boolean; watched?: boolean; continueWith?: PlayerItem | null; advanceContinue?: boolean; restoreContinue?: PlayerItem | null }>).detail;
            const key = String(detail?.ratingKey || '');
            if (!key) return;
            const drop = detail?.dropContinue === true;
            const advance = detail?.advanceContinue === true;
            const restore = detail?.watched === false ? (detail.restoreContinue || null) : null;
            setHome((prev) => {
                if (!prev) return prev;
                const paint = (row: PlayerItem) => (
                    watchTargetTouches(row, key) ? applyRememberedProgress(row) : row
                );
                const mapItems = (list: PlayerItem[] = []) => list.map(paint);
                const withoutContinue = (list: PlayerItem[] = []) => {
                    if (restore) return restoreContinueSlot(list, key, restore);
                    if (advance) return replaceFamilyContinueSlot(list, key, detail.continueWith);
                    return drop ? list.filter((row) => !watchTargetTouches(row, key)) : mapItems(list);
                };
                const seed = detail.item
                    ? {
                        ...applyRememberedProgress(detail.item),
                        lastViewedAt: Math.floor(Date.now() / 1000),
                    }
                    : null;
                const bumpContinue = (list: PlayerItem[] = []) => {
                    let nextList = withoutContinue(list);
                    if (!drop && seed && Number(seed.viewOffsetMs || 0) > 0 && !seed.watched) {
                        const familyKey = String(seed.grandparentRatingKey || seed.parentRatingKey || seed.ratingKey);
                        const without = nextList.filter((row) => (
                            !watchTargetTouches(row, key)
                            && !watchTargetTouches(row, familyKey)
                            && String(row.ratingKey) !== String(seed.ratingKey)
                        ));
                        nextList = [seed, ...without].slice(0, 20);
                    }
                    return nextList;
                };
                const continueWatching = bumpContinue(prev.continueWatching);
                const next = {
                    ...prev,
                    continueWatching,
                    playlists: mapItems(prev.playlists || []),
                    recentByLibrary: prev.recentByLibrary.map((row) => ({ ...row, items: mapItems(row.items) })),
                    hubs: (prev.hubs || []).map((hub) => ({
                        ...hub,
                        items: isContinueWatchingHub(hub) ? bumpContinue(hub.items) : mapItems(hub.items),
                    })),
                };
                if (playerHomeHasRows(next)) writePlayerHomeCache(next);
                return next;
            });
        };
        window.addEventListener(PLAYER_PROGRESS_EVENT, onProgress);
        return () => window.removeEventListener(PLAYER_PROGRESS_EVENT, onProgress);
    }, []);

    const patchWatched = useCallback((ratingKey: string, watched: boolean) => {
        setHome((prev) => {
            if (!prev) return prev;
            const mapItems = (list: PlayerItem[]) => list.map((row) => (
                row.ratingKey === ratingKey ? { ...row, watched } : row
            ));
            return {
                ...prev,
                continueWatching: mapItems(prev.continueWatching),
                playlists: mapItems(prev.playlists || []),
                recentByLibrary: prev.recentByLibrary.map((row) => ({ ...row, items: mapItems(row.items) })),
                hubs: (prev.hubs || []).map((hub) => ({ ...hub, items: mapItems(hub.items) })),
            };
        });
        setResults((prev) => prev.map((row) => (row.ratingKey === ratingKey ? { ...row, watched } : row)));
    }, []);

    const removeFromContinueWatching = useCallback((item: PlayerItem) => {
        const key = item.ratingKey;
        setHome((prev) => {
            if (!prev) return prev;
            const filterItems = (list: PlayerItem[]) => list.filter((row) => row.ratingKey !== key);
            return {
                ...prev,
                continueWatching: filterItems(prev.continueWatching),
                hubs: (prev.hubs || []).map((hub) => (
                    isContinueWatchingHub(hub) ? { ...hub, items: filterItems(hub.items) } : hub
                )),
            };
        });
    }, []);

    const removeItemEverywhere = useCallback((item: PlayerItem) => {
        const key = item.ratingKey;
        setHome((prev) => {
            if (!prev) return prev;
            const filterItems = (list: PlayerItem[]) => list.filter((row) => row.ratingKey !== key);
            return {
                ...prev,
                continueWatching: filterItems(prev.continueWatching),
                playlists: filterItems(prev.playlists || []),
                recentByLibrary: prev.recentByLibrary.map((row) => ({ ...row, items: filterItems(row.items) })),
                hubs: (prev.hubs || []).map((hub) => ({ ...hub, items: filterItems(hub.items) })),
            };
        });
        setResults((prev) => prev.filter((row) => row.ratingKey !== key));
        setHeroSlides((prev) => prev.filter((row) => row.ratingKey !== key));
    }, []);

    const onWatchedChange = useCallback((item: PlayerItem, watched: boolean) => {
        patchWatched(item.ratingKey, watched);
    }, [patchWatched]);

    const toggleWatched = useCallback(async (item: PlayerItem) => {
        const next = !item.watched;
        patchWatched(item.ratingKey, next);
        try {
            await setMediaPlayerWatched(item.ratingKey, next, item);
        } catch {
            patchWatched(item.ratingKey, !!item.watched);
        }
    }, [patchWatched]);

    const railMenuProps = useMemo(() => ({
        onPlayNext,
        onWatchedChange,
        onRemovedFromContinueWatching: removeFromContinueWatching,
        onDeleted: removeItemEverywhere,
        onToast,
        isAdmin,
        playlistsEnabled,
    }), [
        isAdmin,
        onPlayNext,
        onToast,
        onWatchedChange,
        playlistsEnabled,
        removeFromContinueWatching,
        removeItemEverywhere,
    ]);

    const hasPlexContentHubs = plexHubs.some((hub) => !isContinueWatchingHub(hub));
    const homeSections = useMemo(() => {
        if (!home) return [];
        const hubRail = (hub: PlayerLibraryHub, hubIndex: number) => {
            const viewAllKey = hub.collectionRatingKey || hub.playlistRatingKey;
            const canViewAll = Boolean(viewAllKey || hub.hubKey);
            const isCw = isContinueWatchingHub(hub);
            const hero = Boolean(hub.heroRow);
            return (
                <PlayerRail
                    key={hub.identifier || `hub:${hub.title}:${hubIndex}`}
                    title={hub.title}
                    rowId={`hub:${hub.identifier || hub.title}`}
                    items={isCw
                        ? layoutContinueWatching(hub.items)
                        : (hero
                            ? hub.items.map(heroRowCardItem)
                            : (isRecentHub(hub) && settings.hideWatchedFromRecents
                                ? hideWatchedPlayerItems(hub.items)
                                : hub.items))}
                    density={homePosterDensity}
                    staggerIndex={hubIndex}
                    onOpenItem={onOpenItem}
                    onPlay={onPlay}
                    onToggleWatched={toggleWatched}
                    showProgress={isCw}
                    showRemoveFromContinueWatching={isCw}
                    aspect={isCw ? continueWatchingAspect : (hero ? '16/9' : (isRecentHub(hub) ? '2/3' : undefined))}
                    onViewAll={hub.items.length && canViewAll && onOpenHub ? () => onOpenHub(hub) : (hub.items.length && viewAllKey ? () => onOpenItem({
                        ratingKey: viewAllKey,
                        title: hub.title,
                        type: hub.collectionRatingKey ? 'collection' : 'playlist',
                    } as PlayerItem) : undefined)}
                    viewAllLabel={hub.items.length && canViewAll ? t('common.viewAll') : undefined}
                    {...railMenuProps}
                />
            );
        };
        const watchlistRail = (staggerIndex: number) => (
            showWatchlistRail && watchlistItems.length ? (
                <PlayerRail
                    key="home.watchlist"
                    title={t('mediaPlayerPage.navWatchlist')}
                    rowId="home:watchlist"
                    items={watchlistItems}
                    density={homePosterDensity}
                    staggerIndex={staggerIndex}
                    onOpenItem={onOpenItem}
                    onPlay={onPlay}
                    onToggleWatched={toggleWatched}
                    aspect="2/3"
                    onViewAll={onOpenWatchlist}
                    viewAllLabel={onOpenWatchlist ? t('common.viewAll') : undefined}
                    {...railMenuProps}
                />
            ) : null
        );
        const recentRail = (row: { id: string; title: string; items: PlayerItem[]; hubKey?: string; identifier?: string }, staggerIndex: number) => (
            <PlayerRail
                key={row.id}
                title={row.title}
                rowId={`home:recent:${row.id || row.title}`}
                items={row.items}
                density={homePosterDensity}
                staggerIndex={staggerIndex}
                onOpenItem={onOpenItem}
                onPlay={onPlay}
                onToggleWatched={toggleWatched}
                aspect="2/3"
                onViewAll={row.hubKey && onOpenHub ? () => onOpenHub({
                    title: row.title,
                    identifier: row.identifier || 'recentlyAdded',
                    items: row.items,
                    hubKey: row.hubKey,
                }) : undefined}
                viewAllLabel={row.items.length && row.hubKey ? t('common.viewAll') : undefined}
                {...railMenuProps}
            />
        );

        if (isTvShell) {
            const nodes: React.ReactNode[] = [];
            let stagger = 0;
            const cwHub = plexHubs.find(isContinueWatchingHub);
            const cwItems = (cwHub?.items?.length ? cwHub.items : home.continueWatching) || [];
            if (showContinueWatchingRail && cwItems.length) {
                nodes.push(hubRail(cwHub || {
                    title: t('mediaPlayerPage.continueWatching'),
                    identifier: 'home.continueWatching',
                    items: cwItems,
                    hubKey: '/library/onDeck',
                }, stagger));
                stagger += 1;
            }
            const watchlistNode = watchlistRail(stagger);
            if (watchlistNode) {
                nodes.push(watchlistNode);
                stagger += 1;
            }
            const becauseHubs = plexHubs.filter(isBecauseYouWatchedHub);
            const others = plexHubs.filter((hub) => !isContinueWatchingHub(hub) && !isBecauseYouWatchedHub(hub));
            for (const hub of others) {
                nodes.push(hubRail(hub, stagger));
                stagger += 1;
            }
            if (!others.some(isRecentHub)) {
                for (const row of recentRails) {
                    nodes.push(recentRail(row, stagger));
                    stagger += 1;
                }
            }
            if (settings.showBecauseYouWatched) {
                for (const hub of becauseHubs) {
                    nodes.push(hubRail(hub, stagger));
                    stagger += 1;
                }
            }
            return nodes;
        }

        if (hasPlexContentHubs) {
            const becauseHubs = plexHubs.filter(isBecauseYouWatchedHub);
            const rest = plexHubs.filter((hub) => !isBecauseYouWatchedHub(hub));
            const hubs = [...rest, ...(settings.showBecauseYouWatched ? becauseHubs : [])];
            const nodes: React.ReactNode[] = [];
            let insertedWatchlist = false;
            hubs.forEach((hub, hubIndex) => {
                nodes.push(hubRail(hub, hubIndex));
                if (!insertedWatchlist && isContinueWatchingHub(hub)) {
                    const watchlistNode = watchlistRail(hubIndex + 0.5);
                    if (watchlistNode) nodes.push(watchlistNode);
                    insertedWatchlist = true;
                }
            });
            if (!insertedWatchlist) {
                const watchlistNode = watchlistRail(0);
                if (watchlistNode) nodes.unshift(watchlistNode);
            }
            return nodes;
        }
        return applyHomeRowOrder(
            ['continueWatching', 'recents'],
            settings.homeRowOrder,
        ).map((id, rowIndex) => {
            if (id === 'continueWatching') {
                return (
                    <React.Fragment key="continueWatching">
                        {showContinueWatchingRail ? (
                            <PlayerRail
                                title={t('mediaPlayerPage.continueWatching')}
                                rowId="home:continueWatching"
                                items={layoutContinueWatching(home.continueWatching)}
                                density={homePosterDensity}
                                staggerIndex={rowIndex}
                                onOpenItem={onOpenItem}
                                onPlay={onPlay}
                                onToggleWatched={toggleWatched}
                                showProgress
                                showRemoveFromContinueWatching
                                aspect={continueWatchingAspect}
                                onViewAll={onOpenHub ? () => onOpenHub({
                                    title: t('mediaPlayerPage.continueWatching'),
                                    identifier: 'home.continueWatching',
                                    items: home.continueWatching,
                                    hubKey: '/library/onDeck',
                                }) : undefined}
                                viewAllLabel={t('common.viewAll')}
                                {...railMenuProps}
                            />
                        ) : null}
                        {watchlistRail(rowIndex + 0.5)}
                    </React.Fragment>
                );
            }
            if (id !== 'recents') return null;
            return (
                <React.Fragment key="recents">
                    {recentRails.map((row, recentIndex) => (
                        <PlayerRail
                            key={row.id}
                            title={row.title}
                            rowId={`home:recent:${row.id || row.title}`}
                            items={row.items}
                            density={homePosterDensity}
                            staggerIndex={rowIndex + recentIndex}
                            onOpenItem={onOpenItem}
                            onPlay={onPlay}
                            onToggleWatched={toggleWatched}
                            aspect="2/3"
                            onViewAll={row.hubKey && onOpenHub ? () => onOpenHub({
                                title: row.title,
                                identifier: row.identifier || 'recentlyAdded',
                                items: row.items,
                                hubKey: row.hubKey,
                            }) : undefined}
                            viewAllLabel={row.items.length && row.hubKey ? t('common.viewAll') : undefined}
                            {...railMenuProps}
                        />
                    ))}
                </React.Fragment>
            );
        });
    }, [
        continueWatchingAspect,
        hasPlexContentHubs,
        home,
        homePosterDensity,
        isTvShell,
        layoutContinueWatching,
        onOpenHub,
        onOpenItem,
        onOpenWatchlist,
        onPlay,
        plexHubs,
        railMenuProps,
        recentRails,
        settings.hideWatchedFromRecents,
        settings.homeRowOrder,
        settings.showBecauseYouWatched,
        settings.showPlaylists,
        showContinueWatchingRail,
        showWatchlistRail,
        t,
        toggleWatched,
        watchlistItems,
    ]);

    const waitingForFullHome = Boolean(home?.partial) && !error && !hasRails;
    if ((loading && !home) || waitingForFullHome) {
        if (isTvShell && error) {
            return (
                <PlayerTvStatusPanel
                    title={error}
                    onRetry={() => { setError(null); void refreshHome({ force: true }); }}
                />
            );
        }
        if (!isTvShell) {
            return <PlayerHomeSkeleton />;
        }
        return (
            <div
                className="tv-poster-rows player-home-page player-home-stage"
                aria-busy="true"
                aria-label={t('mediaPlayerPage.navHome')}
            >
                <div className="player-home-focus-still" aria-hidden />
                <div className="player-home-stage-rail" />
            </div>
        );
    }

    if (isTvShell && error && !home) {
        return (
            <PlayerTvStatusPanel
                title={error}
                onRetry={() => { setError(null); void refreshHome({ force: true }); }}
            />
        );
    }

    return (
        <div className={tvStage
            ? 'tv-poster-rows player-home-page player-home-stage'
            : `tv-poster-rows player-home-page flex flex-col pb-8 ${isTvShell ? 'player-home-rows' : 'gap-6'}`
        }>
            <HomeFocusStill
                enabled={tvStage && active}
                seed={tvStage ? tvStageStillSeed : ''}
                onFocusKey={tvStage ? setTvFocusKey : undefined}
            />
            {tvStage ? <HomeSpot item={tvSpotItem} /> : null}
            {tvStage ? <MediaPlayerNowPlayingChip active={active} /> : null}
            {!isTvShell && !searchActive && heroSlides.length ? (
                <MediaPlayerHomeHero
                    items={heroSlides}
                    effectiveMode={heroEffectiveMode}
                    active={active}
                    onOpenItem={onOpenItem}
                    onPlay={onPlay}
                />
            ) : !isTvShell && !searchActive && heroPending ? (
                <PlayerHomeHeroSkeleton />
            ) : null}
            <h1 className="sr-only">{t('mediaPlayerPage.navHome')}</h1>
            {!isTvShell && searchActive && (!orderedLibraries.length || !onOpenLibrary) ? (
                <div className="flex justify-end">
                    <DiscoverGridSizeSelect value={gridSize} onChange={setGridSize} />
                </div>
            ) : null}

            {!searchActive && orderedLibraries.length && onOpenLibrary && !isTvShell ? (
                <section className="flex flex-col gap-2" aria-label={t('mediaPlayerPage.jumpToLibrary')}>
                    <div className="flex items-center justify-between gap-3">
                        <p className="min-w-0 text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
                            {t('mediaPlayerPage.jumpToLibrary')}
                        </p>
                        <DiscoverGridSizeSelect className="player-phone-hide shrink-0 max-md:hidden" value={gridSize} onChange={setGridSize} />
                    </div>
                    <div className="player-library-chips flex gap-2 overflow-x-auto hide-scrollbar pb-1">
                        {orderedLibraries.map((library) => {
                            const Icon = libraryChipIcon(library.type);
                            return (
                                <button
                                    key={library.key}
                                    type="button"
                                    data-tv-item="1"
                                    onClick={() => onOpenLibrary(library)}
                                    className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-white/[0.04] px-3.5 py-2 text-sm font-bold text-text transition hover:border-plex/40 hover:bg-plex/10 hover:text-plex"
                                >
                                    <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" />
                                    <span className="max-w-[10rem] truncate sm:max-w-[14rem]">{library.title}</span>
                                </button>
                            );
                        })}
                    </div>
                </section>
            ) : null}

            {searchActive ? (
            <div className="relative" data-tv-rail={isTvShell ? '1' : undefined}>
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                    id={PLAYER_SEARCH_INPUT_ID}
                    ref={searchRef}
                    value={query}
                    readOnly={searchReadOnly}
                    inputMode={searchReadOnly ? 'none' : 'search'}
                    enterKeyHint="search"
                    data-tv-item={isTvShell ? '1' : undefined}
                    aria-label={t('mediaPlayerPage.searchPlaceholder')}
                    onChange={(event) => setQuery(event.target.value)}
                    onBlur={() => {
                        if (isTvShell) setSearchArmed(false);
                    }}
                    onKeyDown={(event) => {
                        if (!isTvShell) return;
                        if (searchArmed) return;
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        event.stopPropagation();
                        setSearchArmed(true);
                    }}
                    onClick={() => {
                        // Touch / mouse: open IME. TV D-pad focus alone must not.
                        if (isTvShell && !searchArmed) setSearchArmed(true);
                    }}
                    placeholder={t('mediaPlayerPage.searchPlaceholder')}
                    className={discoveryTheme.searchInput}
                />
            </div>
            ) : null}

            {query.trim().length >= 2 ? (
                <div className="flex flex-col gap-6">
                    {searching && !results.length ? (
                        <DiscoverSectionHeader title={t('common.searching')} />
                    ) : null}
                    {searchGroups.map((group) => (
                        <section key={group.id} className="flex flex-col gap-3">
                            <DiscoverSectionHeader title={group.title} />
                            <div
                                data-tv-browse-grid={isTvShell ? '1' : undefined}
                                data-tv-rail={isTvShell ? '1' : undefined}
                                className={upgraderPosterGridClass(gridSize)}
                                style={group.aspect === '16/9' ? upgraderLandscapeGridStyle(gridSize) : upgraderPosterGridStyle(gridSize)}
                            >
                                {group.items.map((item, index) => (
                                    <PlayerPosterCard
                                        key={item.ratingKey}
                                        item={item}
                                        browseIndex={isTvShell ? index : undefined}
                                        aspect={group.aspect}
                                        onOpenItem={onOpenItem}
                                        onPlay={onPlay}
                                        onToggleWatched={toggleWatched}
                                        onPlayNext={onPlayNext}
                                        onWatchedChange={(row, watched) => patchWatched(row.ratingKey, watched)}
                                        onRemovedFromContinueWatching={removeFromContinueWatching}
                                        onDeleted={removeItemEverywhere}
                                        onToast={onToast}
                                        isAdmin={isAdmin}
                                        playlistsEnabled={playlistsEnabled}
                                    />
                                ))}
                            </div>
                        </section>
                    ))}
                    {!searching && !results.length ? (
                        <div className={discoveryTheme.emptyState}>
                            <p className={discoveryTheme.emptyTitle}>{t('mediaPlayerPage.emptySearch')}</p>
                        </div>
                    ) : null}
                </div>
            ) : null}

            {!isTvShell && error ? (
                <div className={discoveryTheme.emptyState}>
                    <p className={discoveryTheme.emptyTitle}>{error}</p>
                </div>
            ) : null}

            {isTvShell && (homeStale || !networkOnline) && home && !query.trim() ? (
                <div
                    data-tv-row={tvStage ? undefined : '1'}
                    className={tvStage
                        ? 'player-home-stage-banner rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-3'
                        : 'flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-3'}
                    aria-live="polite"
                >
                    <p className="text-sm text-amber-100/90">{t('mediaPlayerPage.showingSavedHome')}</p>
                    <button
                        type="button"
                        data-tv-item={tvStage ? undefined : '1'}
                        data-tv-action={tvStage ? undefined : '1'}
                        onClick={() => void refreshHome({ force: true })}
                        className="mt-2 shrink-0 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold text-white outline-none ring-plex/40 focus-visible:ring-2"
                    >
                        {t('common.retry')}
                    </button>
                </div>
            ) : null}

            {!query.trim() && home && tvStage && longPressHint ? (
                <div
                    className="player-home-stage-banner mb-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3"
                    aria-live="polite"
                >
                    <p className="text-sm text-white/80">{t('mediaPlayerPage.longPressHint')}</p>
                    <button
                        type="button"
                        data-tv-item="1"
                        data-tv-action="1"
                        onClick={() => {
                            writeLongPressHintSeen();
                            setLongPressHint(false);
                        }}
                        className="shrink-0 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold text-white outline-none"
                    >
                        {t('mediaPlayerPage.longPressHintDismiss')}
                    </button>
                </div>
            ) : null}

            {!query.trim() && home && tvStage && tvActiveRow ? (
                <div className="player-home-stage-rail">
                    <PlayerRail
                        key={tvActiveRow.id}
                        title={tvActiveRow.title}
                        rowId={`hub:${tvActiveRow.id}`}
                        restoreFocusKey={tvRowFocusRef.current[tvActiveRow.id]}
                        items={tvActiveRow.items}
                        density={homePosterDensity}
                        staggerIndex={0}
                        onOpenItem={onOpenItem}
                        onPlay={onPlay}
                        onToggleWatched={toggleWatched}
                        showProgress={tvActiveRow.showProgress}
                        showRemoveFromContinueWatching={tvActiveRow.showRemoveFromContinueWatching}
                        aspect={tvActiveRow.aspect}
                        onViewAll={tvActiveRow.id === 'home.watchlist' ? tvActiveRow.onViewAll : undefined}
                        viewAllLabel={tvActiveRow.id === 'home.watchlist' ? t('common.viewAll') : undefined}
                        {...railMenuProps}
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
            ) : !query.trim() && home && !tvStage ? (
                <div className="player-home-rows flex min-w-0 flex-col gap-6">
                    {homeSections}
                </div>
            ) : null}

            {!query.trim() && !error && !hasRails && !home?.partial ? (
                isTvShell ? (
                    <PlayerTvStatusPanel
                        title={t('mediaPlayerPage.emptyHome')}
                        onRetry={() => void refreshHome({ force: true })}
                    />
                ) : (
                    <div className={discoveryTheme.emptyState}>
                        <p className={discoveryTheme.emptyTitle}>{t('mediaPlayerPage.emptyHome')}</p>
                    </div>
                )
            ) : null}
        </div>
    );
});
