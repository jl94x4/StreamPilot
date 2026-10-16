import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import {
    CustomSelect,
    DiscoverGridSizeSelect,
    discoveryTheme,
    PosterGridSkeleton,
    homeRailPosterDensity,
    posterGridScaleRem,
    upgraderPosterGridClass,
    upgraderPosterGridStyle,
    useDiscoverGridSize,
    useDiscoverI18n,
} from './host';
import {
    fetchMediaPlayerCollections,
    fetchMediaPlayerLibrary,
    fetchMediaPlayerLibraryFilters,
    fetchMediaPlayerLibraryHome,
    setMediaPlayerWatched,
} from './api';
import { readLibraryBrowseState, readLibraryHomeCache, writeLibraryBrowseState, writeLibraryHomeCache } from './playerMemory';
import { PLAYER_SCROLL_ID } from './paths';
import { PlayerPosterCard } from './PlayerPosterCard';
import { PlayerRail } from './PlayerRail';
import { viewMoreShelfFromHub } from './PlayerViewMoreCard';
import { PlayerTvHubStage, type PlayerTvHubStageRow } from './PlayerTvHubStage';
import { PlayerTvStatusPanel } from './PlayerTvStatusPanel';
import { classifyPlayerHomeHub, continueWatchingRailAspect, stabilizeContinueWatchingOrder } from './playerSettings';
import { usePlayerSettings } from './usePlayerSettings';
import {
    applyRememberedProgress,
    BROWSE_FOCUS_ABS_EVENT,
    clearPrefetchedPlayerImages,
    heroRowCardItem,
    hideWatchedPlayerItems,
    isMusicPlayerItem,
    mapContinueWatchingItemsForLayout,
    playerCardImageUrl,
    PLAYER_PROGRESS_EVENT,
    prefetchPlayerImages,
    replaceFamilyContinueSlot,
    restoreContinueSlot,
    watchTargetTouches,
    withShowPoster,
} from './playerUtils';
import type { PlayerItem, PlayerLibraryHub, PlayerPlayOptions } from './types';

type LibraryTab = 'home' | 'browse' | 'collections';

type Props = {
    sectionKey: string;
    tab: LibraryTab;
    active?: boolean;
    onBack: () => void;
    onOpenItem: (item: PlayerItem) => void;
    onOpenCollection: (sectionKey: string, item: PlayerItem) => void;
    onOpenHub?: (hub: PlayerLibraryHub) => void;
    onChangeTab: (tab: LibraryTab) => void;
    onPlay: (item: PlayerItem, opts?: PlayerPlayOptions) => void;
    onPlayNext?: (item: PlayerItem) => void;
    onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
    isAdmin?: boolean;
    playlistsEnabled?: boolean;
};

/** Browse loads this many poster rows, then the next batch while several rows are still ahead. */
const BROWSE_PAGE_ROWS = 7;
const BROWSE_PREFETCH_LEAD = 8;
const BROWSE_MAX_PAGE = 80;
const STATIC_ALPHA = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((title) => ({ key: title, title }));

/** Plex title sort files "The Matrix" under M. */
const browseLetterOf = (title?: string | null) => {
    const trimmed = String(title || '').trim().replace(/^(the|a|an)\s+/i, '');
    const ch = trimmed.charAt(0).toUpperCase();
    if (ch >= 'A' && ch <= 'Z') return ch;
    return '#';
};

const estimateBrowseColumns = (size: Parameters<typeof posterGridScaleRem>[0]) => {
    if (size === 'list' || typeof document === 'undefined') return 1;
    const rem = posterGridScaleRem(size);
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const gapRem = rem < 6.25 ? 0.375 : rem < 8.25 ? 0.5 : rem < 11.5 ? 0.625 : 0.75;
    const col = rem * rootPx;
    const gap = gapRem * rootPx;
    const scroller = document.getElementById(PLAYER_SCROLL_ID);
    const width = scroller?.clientWidth || window.innerWidth || col;
    if (col <= 0) return 1;
    return Math.max(1, Math.floor((width + gap) / (col + gap)));
};

const isContinueWatchingHub = (hub: PlayerLibraryHub) => (
    /continue\s*watch|ondeck|on[.\s_-]?deck|in[.\s_-]?progress/i.test(`${hub.identifier || ''} ${hub.title || ''}`)
);

const hubBlob = (hub: PlayerLibraryHub) => `${hub.identifier || ''} ${hub.title || ''}`;
const isRecentHub = (hub: PlayerLibraryHub) => /recently\s*added|recentlyadded/i.test(hubBlob(hub));
const isReleasedHub = (hub: PlayerLibraryHub) => /recently\s*released|recentlyreleased/i.test(hubBlob(hub));

const itemHead = (items: PlayerItem[] = []) => items.slice(0, 8).map((row) => row.ratingKey).join('|');

const isTvShell = () => {
    try {
        return document.documentElement?.dataset?.tv === '1'
            || window.__PLEX_CLIENT__?.isTv === true;
    } catch {
        return false;
    }
};

/** Paint library rows from the section list while the slower hub request is still in flight. */
const withLibraryListRows = (prev: PlayerLibraryHub[], recentItems: PlayerItem[], releasedItems: PlayerItem[]) => {
    const next = prev.slice();
    let insertAt = next.filter(isContinueWatchingHub).length;
    const push = (identifier: string, title: string, items: PlayerItem[]) => {
        if (!items.length) return;
        if (identifier === 'recentlyAdded' && next.some(isRecentHub)) return;
        if (identifier === 'recentlyReleased' && (next.some(isReleasedHub) || itemHead(items) === itemHead(recentItems))) return;
        if (next.some((hub) => hub.identifier === identifier)) return;
        next.splice(insertAt, 0, { identifier, title, items });
        insertAt += 1;
    };
    push('recentlyAdded', 'Recently Added', recentItems);
    push('recentlyReleased', 'Recently Released', releasedItems);
    return next;
};

const mergeServerLibraryHubs = (serverHubs: PlayerLibraryHub[], prev: PlayerLibraryHub[]) => {
    const server = serverHubs || [];
    const extras: PlayerLibraryHub[] = [];
    if (!server.some(isRecentHub)) {
        const row = prev.find((hub) => hub.identifier === 'recentlyAdded');
        if (row?.items?.length) extras.push(row);
    }
    const recentItems = extras[0]?.items || server.find(isRecentHub)?.items || [];
    if (!server.some(isReleasedHub)) {
        const row = prev.find((hub) => hub.identifier === 'recentlyReleased');
        if (row?.items?.length && itemHead(row.items) !== itemHead(recentItems)) extras.push(row);
    }
    if (!extras.length) return server;
    const seen = new Set(server.map((hub) => hub.identifier));
    return [...server, ...extras.filter((hub) => !seen.has(hub.identifier))];
};

const SORT_IDS = [
    'titleSort',
    'titleSort:desc',
    'addedAt:desc',
    'year:desc',
    'originallyAvailableAt:desc',
    'audienceRating:desc',
    'rating:desc',
    'lastViewedAt:desc',
    'viewCount:desc',
    'duration:desc',
    'mediaHeight:desc',
] as const;

type FilterOption = { key: string; title: string };

export const MediaPlayerLibrary: React.FC<Props> = ({
    sectionKey,
    tab,
    active = true,
    onBack,
    onOpenItem,
    onOpenCollection,
    onOpenHub,
    onChangeTab,
    onPlay,
    onPlayNext,
    onToast,
    isAdmin = false,
    playlistsEnabled = true,
}) => {
    const { t } = useDiscoverI18n();
    const [settings] = usePlayerSettings();
    const continueWatchingAspect = continueWatchingRailAspect(settings.continueWatchingLayout);
    const cwOrderKeysRef = useRef<string[]>([]);
    const cwOrderSortRef = useRef(settings.continueWatchingSort);
    const layoutContinueWatching = useCallback(
        (items: PlayerItem[]) => {
            if (cwOrderSortRef.current !== settings.continueWatchingSort) {
                cwOrderKeysRef.current = [];
                cwOrderSortRef.current = settings.continueWatchingSort;
            }
            const frozen = stabilizeContinueWatchingOrder(
                items,
                settings.continueWatchingSort,
                cwOrderKeysRef.current,
            );
            cwOrderKeysRef.current = frozen.keys;
            return mapContinueWatchingItemsForLayout(
                frozen.items,
                settings.continueWatchingLayout,
                'plex',
            );
        },
        [settings.continueWatchingLayout, settings.continueWatchingSort],
    );
    const homeLoadRef = useRef(0);
    const activeRef = useRef(active);
    activeRef.current = active;
    const [gridSize, setGridSize] = useDiscoverGridSize();
    const recommendedPosterDensity = homeRailPosterDensity(gridSize);
    const [title, setTitle] = useState(t('mediaPlayerPage.libraries'));
    const [libraryType, setLibraryType] = useState(() => readLibraryHomeCache(sectionKey)?.type || '');
    const musicLibrary = libraryType === 'artist';
    const [hubs, setHubs] = useState<PlayerLibraryHub[]>(() => readLibraryHomeCache(sectionKey)?.hubs || []);
    const [items, setItems] = useState<PlayerItem[]>([]);
    const [collections, setCollections] = useState<PlayerItem[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(() => tab === 'home' ? !readLibraryHomeCache(sectionKey)?.hubs?.length : true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [browseHasMore, setBrowseHasMore] = useState(false);
    const [browseAbsStart, setBrowseAbsStart] = useState(0);
    const browseSentinelRef = useRef<HTMLDivElement>(null);
    const browseLoadingRef = useRef(false);
    const browseHasMoreRef = useRef(false);
    const browseGenRef = useRef(0);
    /** Absolute library index after the last loaded browse item (end exclusive). */
    const browseCountRef = useRef(0);
    /** Absolute library index of items[0] in the current browse window. */
    const browseAbsStartRef = useRef(0);
    const browseColumnsRef = useRef(0);
    const browseRowRef = useRef(-1);
    /** Index within the loaded window of the focused browse poster. */
    const browseFocusAbsRef = useRef(-1);
    const itemsLengthRef = useRef(0);
    const itemsRef = useRef(items);
    const scrollLetterRef = useRef('');
    itemsLengthRef.current = items.length;
    itemsRef.current = items;
    const gridSizeRef = useRef(gridSize);
    gridSizeRef.current = gridSize;
    const [error, setError] = useState<string | null>(null);
    const [hydrated, setHydrated] = useState(false);
    const [sort, setSort] = useState<string>('titleSort');
    const [genre, setGenre] = useState('');
    const [decade, setDecade] = useState('');
    const [year, setYear] = useState('');
    const [contentRating, setContentRating] = useState('');
    const [resolution, setResolution] = useState('');
    const [studio, setStudio] = useState('');
    const [network, setNetwork] = useState('');
    const [country, setCountry] = useState('');
    const [collection, setCollection] = useState('');
    const [audioLanguage, setAudioLanguage] = useState('');
    const [subtitleLanguage, setSubtitleLanguage] = useState('');
    const [actor, setActor] = useState('');
    const [director, setDirector] = useState('');
    const [writer, setWriter] = useState('');
    const [producer, setProducer] = useState('');
    const [label, setLabel] = useState('');
    const [unwatched, setUnwatched] = useState(false);
    const [inProgress, setInProgress] = useState(false);
    const [hdr, setHdr] = useState(false);
    const [duplicate, setDuplicate] = useState(false);
    const [letter, setLetter] = useState('');
    const [scrollLetter, setScrollLetter] = useState('');
    const [letters, setLetters] = useState<FilterOption[]>([]);
    const [genres, setGenres] = useState<FilterOption[]>([]);
    const [decades, setDecades] = useState<FilterOption[]>([]);
    const [years, setYears] = useState<FilterOption[]>([]);
    const [contentRatings, setContentRatings] = useState<FilterOption[]>([]);
    const [resolutions, setResolutions] = useState<FilterOption[]>([]);
    const [studios, setStudios] = useState<FilterOption[]>([]);
    const [networks, setNetworks] = useState<FilterOption[]>([]);
    const [countries, setCountries] = useState<FilterOption[]>([]);
    const [collectionOptions, setCollectionOptions] = useState<FilterOption[]>([]);
    const [audioLanguages, setAudioLanguages] = useState<FilterOption[]>([]);
    const [subtitleLanguages, setSubtitleLanguages] = useState<FilterOption[]>([]);
    const [actors, setActors] = useState<FilterOption[]>([]);
    const [directors, setDirectors] = useState<FilterOption[]>([]);
    const [writers, setWriters] = useState<FilterOption[]>([]);
    const [producers, setProducers] = useState<FilterOption[]>([]);
    const [labels, setLabels] = useState<FilterOption[]>([]);
    const homeHubs = useMemo(() => {
        let keptContinue = false;
        return hubs.filter((hub) => {
            if (!hub.items?.length) return false;
            if (!isContinueWatchingHub(hub)) return true;
            if (keptContinue) return false;
            keptContinue = true;
            return true;
        }).map((hub) => {
            const recent = /recent/i.test(`${hub.identifier || ''} ${hub.title || ''}`);
            if (!recent) return hub;
            const items = settings.hideWatchedFromRecents
                ? hideWatchedPlayerItems(hub.items)
                : (hub.items || []);
            return { ...hub, items: items.map(withShowPoster) };
        }).filter((hub) => hub.items?.length);
    }, [hubs, settings.hideWatchedFromRecents]);

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

    const tvRecommendedRows = useMemo((): PlayerTvHubStageRow[] => {
        const rows: PlayerTvHubStageRow[] = [];
        for (const hub of homeHubs) {
            const isCw = isContinueWatchingHub(hub);
            const hero = Boolean(hub.heroRow);
            const recent = isRecentHub(hub);
            const items = isCw
                ? freezeContinueWatching(hub.items).map(withShowPoster)
                : hero
                    ? hub.items.map(heroRowCardItem)
                    : hub.items;
            if (!items.length) continue;
            rows.push({
                id: hub.identifier || `hub:${hub.title}`,
                title: hub.title,
                items,
                aspect: hero
                    ? '16/9'
                    : (isCw || recent
                        ? '2/3'
                        : (musicLibrary
                            || classifyPlayerHomeHub(hub) === 'artist'
                            || hub.items.every((row) => isMusicPlayerItem(row))
                            ? 'square'
                            : '2/3')),
                showProgress: isCw,
                showRemoveFromContinueWatching: isCw,
                onViewAll: (hub.collectionRatingKey || hub.playlistRatingKey || hub.hubKey) && onOpenHub
                    ? () => onOpenHub(hub)
                    : undefined,
                viewMoreShelf: viewMoreShelfFromHub(hub),
            });
        }
        return rows;
    }, [freezeContinueWatching, homeHubs, musicLibrary, onOpenHub]);

    const loadHome = useCallback(async () => {
        const seq = homeLoadRef.current + 1;
        homeLoadRef.current = seq;
        const alive = () => homeLoadRef.current === seq;
        const cached = readLibraryHomeCache(sectionKey);
        if (cached?.hubs?.length) {
            setTitle(cached.title || t('mediaPlayerPage.libraries'));
            if (cached.type) setLibraryType(cached.type);
            setHubs(cached.hubs);
            setLoading(false);
        } else {
            setLoading(true);
        }
        // Extra list calls compete with the home request. Only use them when
        // the home payload is still missing Recently Added / Released.
        const paintLists = async () => {
            try {
                const [recent, released] = await Promise.all([
                    fetchMediaPlayerLibrary(sectionKey, 0, 18, { sort: 'addedAt:desc' }),
                    fetchMediaPlayerLibrary(sectionKey, 0, 18, { sort: 'originallyAvailableAt:desc' }),
                ]);
                if (!alive()) return false;
                if (recent.title) setTitle(recent.title);
                if (recent.type) setLibraryType(recent.type);
                const recentItems = recent.items || [];
                const releasedItems = released.items || [];
                setHubs((prev) => {
                    const next = withLibraryListRows(prev, recentItems, releasedItems);
                    if (next.some((hub) => hub.items?.length && !isContinueWatchingHub(hub))) {
                        writeLibraryHomeCache(sectionKey, {
                            title: recent.title || undefined,
                            type: recent.type || undefined,
                            hubs: next,
                        });
                    }
                    return next;
                });
                setError(null);
                setLoading(false);
                return recentItems.length > 0 || releasedItems.length > 0;
            } catch {
                return false;
            }
        };
        try {
            const data = await fetchMediaPlayerLibraryHome(sectionKey);
            if (!alive()) return;
            setTitle(data.title || t('mediaPlayerPage.libraries'));
            if (data.type) setLibraryType(data.type);
            const incoming = data.hubs || [];
            // Continue Watching alone is incomplete — keep older richer hubs and
            // still run list fallbacks for Recently Added / Released.
            const hasContentHub = incoming.some((hub) => hub.items?.length && !isContinueWatchingHub(hub));
            setHubs((prev) => {
                if (hasContentHub && incoming.length > 1) {
                    writeLibraryHomeCache(sectionKey, { ...data, hubs: incoming });
                    return incoming;
                }
                if (prev.length > incoming.length) return prev;
                const next = mergeServerLibraryHubs(incoming, prev);
                if (next.some((hub) => hub.items?.length && !isContinueWatchingHub(hub))) {
                    writeLibraryHomeCache(sectionKey, { ...data, hubs: next });
                }
                return next.length ? next : prev;
            });
            setError(null);
            if (!hasContentHub) await paintLists();
        } catch (err: any) {
            const painted = await paintLists();
            if (!alive()) return;
            if (!painted && !cached?.hubs?.length) {
                setError(String(err?.message || t('mediaPlayerPage.loadError')));
            }
        } finally {
            if (alive()) setLoading(false);
        }
    }, [sectionKey, t]);

    const browsePageSize = () => {
        if (!browseColumnsRef.current) {
            browseColumnsRef.current = estimateBrowseColumns(gridSizeRef.current);
        }
        return Math.min(BROWSE_MAX_PAGE, Math.max(1, browseColumnsRef.current) * BROWSE_PAGE_ROWS);
    };

    const loadBrowse = useCallback(async (start: number, append: boolean, prepend = false) => {
        if (append || prepend) {
            if (browseLoadingRef.current) return;
            if (append && !browseHasMoreRef.current) return;
            if (prepend && browseAbsStartRef.current <= 0) return;
            browseLoadingRef.current = true;
            setLoadingMore(true);
        } else {
            browseGenRef.current += 1;
            browseLoadingRef.current = true;
            browseHasMoreRef.current = false;
            browseCountRef.current = 0;
            browseAbsStartRef.current = 0;
            browseFocusAbsRef.current = -1;
            setBrowseAbsStart(0);
            setBrowseHasMore(false);
            setLoading(true);
            if (activeRef.current) {
                const scroller = document.getElementById(PLAYER_SCROLL_ID);
                if (scroller) scroller.scrollTop = 0;
            }
        }
        const gen = browseGenRef.current;
        const pageSize = browsePageSize();
        const jumpLetter = !append && !prepend && sort === 'titleSort' ? letter : '';
        const fetchStart = prepend
            ? Math.max(0, browseAbsStartRef.current - pageSize)
            : start;
        const fetchSize = prepend
            ? Math.max(1, browseAbsStartRef.current - fetchStart)
            : pageSize;
        try {
            const data = await fetchMediaPlayerLibrary(sectionKey, fetchStart, fetchSize, {
                sort,
                genre,
                decade,
                year,
                contentRating,
                resolution,
                studio,
                network,
                country,
                collection,
                audioLanguage,
                subtitleLanguage,
                actor,
                director,
                writer,
                producer,
                label,
                unwatched,
                inProgress,
                hdr,
                duplicate,
                letter: jumpLetter,
            });
            if (gen !== browseGenRef.current) return;
            const batch = data.items || [];
            const reported = Number(data.total) || 0;
            const offset = Number(data.offset);
            const absStart = Number.isFinite(offset) ? Math.max(0, offset) : Math.max(0, fetchStart);
            const windowEnd = prepend
                ? Math.max(browseCountRef.current, absStart + batch.length)
                : absStart + batch.length;
            const knownTotal = reported > 0 ? reported : 0;
            const hasMore = knownTotal > 0
                ? windowEnd < knownTotal
                : !prepend && batch.length >= pageSize;
            browseHasMoreRef.current = hasMore;
            setTitle(data.title || t('mediaPlayerPage.libraries'));
            if (data.type) setLibraryType(data.type);
            setTotal(knownTotal || reported);
            setBrowseHasMore(hasMore);
            if (prepend) {
                if (batch.length) {
                    browseAbsStartRef.current = absStart;
                    setBrowseAbsStart(absStart);
                    setItems((prev) => {
                        const seen = new Set(batch.map((row) => row.ratingKey));
                        return [...batch, ...prev.filter((row) => !seen.has(row.ratingKey))];
                    });
                } else {
                    browseAbsStartRef.current = 0;
                    setBrowseAbsStart(0);
                }
            } else if (append) {
                browseCountRef.current = windowEnd;
                // New posters go on the end. Do not move scroll or focus — same as Plex.
                setItems((prev) => [...prev, ...batch]);
            } else {
                browseAbsStartRef.current = absStart;
                setBrowseAbsStart(absStart);
                browseCountRef.current = windowEnd;
                const jumped = (jumpLetter && (jumpLetter === '#' || /^[A-Z]$/i.test(jumpLetter)))
                    ? jumpLetter.toUpperCase()
                    : browseLetterOf(batch[0]?.title);
                if (jumped) {
                    scrollLetterRef.current = jumped;
                    setScrollLetter(jumped);
                }
                setItems(batch);
                if (jumpLetter && batch.length) {
                    let focusAt = batch.findIndex((row) => browseLetterOf(row.title) === jumped);
                    if (focusAt < 0) focusAt = 0;
                    browseFocusAbsRef.current = focusAt;
                    browseRowRef.current = -1;
                    window.setTimeout(() => {
                        const btn = document.querySelector<HTMLElement>(
                            `[data-browse-index="${focusAt}"] [data-tv-poster-btn="1"]`,
                        );
                        btn?.focus();
                    }, 80);
                }
            }
            setError(null);
        } catch (err: any) {
            if (gen !== browseGenRef.current) return;
            setError(String(err?.message || t('mediaPlayerPage.loadError')));
        } finally {
            if (gen === browseGenRef.current) {
                browseLoadingRef.current = false;
                setLoading(false);
                setLoadingMore(false);
            }
        }
    }, [
        actor,
        audioLanguage,
        collection,
        contentRating,
        country,
        decade,
        director,
        duplicate,
        genre,
        hdr,
        inProgress,
        label,
        letter,
        network,
        producer,
        resolution,
        sectionKey,
        sort,
        studio,
        subtitleLanguage,
        t,
        unwatched,
        writer,
        year,
    ]);

    const loadCollections = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchMediaPlayerCollections(sectionKey);
            setTitle(data.title || t('mediaPlayerPage.collections'));
            setCollections(data.items || []);
            setError(null);
        } catch (err: any) {
            setError(String(err?.message || t('mediaPlayerPage.loadError')));
        } finally {
            setLoading(false);
        }
    }, [sectionKey, t]);

    useEffect(() => {
        if (tab !== 'browse') {
            browseGenRef.current += 1;
            browseLoadingRef.current = false;
            browseRowRef.current = -1;
            setError(null);
            clearPrefetchedPlayerImages();
        }
        // Wait for section hydrate so we don't start+abort a duplicate home fetch.
        if (!hydrated) return;
        if (tab === 'home') void loadHome();
        else if (tab === 'collections') void loadCollections();
        else {
            setItems([]);
            clearPrefetchedPlayerImages();
            void loadBrowse(0, false);
        }
    }, [hydrated, loadBrowse, loadCollections, loadHome, tab]);

    useEffect(() => {
        clearPrefetchedPlayerImages();
    }, [sectionKey]);

    useEffect(() => {
        if (tab === 'collections') {
            if (!collections.length) return;
            prefetchPlayerImages(
                collections.slice(0, 12).map((item) => playerCardImageUrl(item.thumb, musicLibrary ? 'square' : '2/3')),
                8,
            );
            return;
        }
        if (tab !== 'browse' || !items.length) return;
        const cols = Math.max(1, browseColumnsRef.current || estimateBrowseColumns(gridSize));
        const from = Math.max(0, browseFocusAbsRef.current);
        const count = cols * (BROWSE_PAGE_ROWS + BROWSE_PREFETCH_LEAD);
        const slice = items.slice(from, from + count);
        prefetchPlayerImages(
            slice.map((item) => playerCardImageUrl(item.thumb, item.type === 'episode' ? '16/9' : musicLibrary ? 'square' : '2/3')),
            Math.min(16, slice.length),
        );
    }, [collections, gridSize, items, musicLibrary, tab]);

    useEffect(() => {
        if (!active || tab !== 'browse' || !browseHasMore || !items.length) return;
        const el = document.getElementById(PLAYER_SCROLL_ID);
        if (!el || el.scrollHeight > el.clientHeight + 8) return;
        const paintedEnd = browseAbsStartRef.current + items.length;
        if (browseCountRef.current > paintedEnd) return;
        if (items.length >= browsePageSize() * 2) return;
        void loadBrowse(browseCountRef.current, true);
    }, [active, browseHasMore, items.length, loadBrowse, tab]);

    useEffect(() => {
        if (!active || tab !== 'browse' || !browseHasMore) return undefined;
        const scroller = document.getElementById(PLAYER_SCROLL_ID);
        let measuredCardCount = 0;
        let scrollRaf = 0;
        const measureColumns = (cards: HTMLElement[], force = false) => {
            if (!force && browseColumnsRef.current > 0 && cards.length === measuredCardCount) {
                return browseColumnsRef.current;
            }
            measuredCardCount = cards.length;
            if (cards.length < 2) return browseColumnsRef.current || estimateBrowseColumns(gridSizeRef.current);
            const top = cards[0].offsetTop;
            let cols = 1;
            for (let i = 1; i < cards.length; i += 1) {
                if (Math.abs(cards[i].offsetTop - top) > 2) break;
                cols += 1;
            }
            browseColumnsRef.current = Math.max(1, cols);
            return browseColumnsRef.current;
        };
        const maybeLoad = (rowIndex: number, paintedRows: number, paintedCount: number, movingDown: boolean) => {
            if (!movingDown || rowIndex < 0 || paintedRows <= 0) return;
            const paintedEnd = browseAbsStartRef.current + paintedCount;
            if (browseCountRef.current > paintedEnd) return;
            if (rowIndex + 1 < paintedRows - BROWSE_PREFETCH_LEAD) return;
            void loadBrowse(browseCountRef.current, true);
        };
        let lastScrollTop = scroller?.scrollTop || 0;
        const runScrollPass = () => {
            scrollRaf = 0;
            const el = scroller;
            const grid = document.querySelector<HTMLElement>('[data-tv-browse-grid="1"]');
            if (!el || !grid) return;
            // TV D-pad focus drives paging; skip duplicate scroll work when focus is in-grid.
            const active = document.activeElement as HTMLElement | null;
            if (active?.closest?.('[data-tv-browse-grid="1"]')) return;
            const movingDown = el.scrollTop >= lastScrollTop - 2;
            lastScrollTop = el.scrollTop;
            if (!movingDown) return;
            if (el.scrollHeight <= el.clientHeight + 8) return;
            const cards = Array.from(grid.querySelectorAll<HTMLElement>('[data-tv-poster-btn="1"]'));
            if (!cards.length) return;
            const cols = measureColumns(cards);
            const viewBottom = el.getBoundingClientRect().bottom + 4;
            let last = 0;
            for (let i = 0; i < cards.length; i += 1) {
                if (cards[i].getBoundingClientRect().top < viewBottom) last = i;
                else break;
            }
            const absLast = Number(cards[last].closest('[data-browse-index]')?.getAttribute('data-browse-index'));
            const loaded = itemsLengthRef.current;
            maybeLoad(
                Math.floor((Number.isFinite(absLast) ? absLast : last) / cols),
                Math.ceil(loaded / cols),
                loaded,
                true,
            );
        };
        const onScroll = () => {
            if (scrollRaf) return;
            scrollRaf = window.requestAnimationFrame(runScrollPass);
        };
        const onFocus = (event: FocusEvent) => {
            const card = (event.target as HTMLElement | null)?.closest?.('[data-tv-poster-btn="1"]') as HTMLElement | null;
            const grid = card?.closest?.('[data-tv-browse-grid="1"]') as HTMLElement | null;
            if (!card || !grid) return;
            const abs = Number(card.closest('[data-browse-index]')?.getAttribute('data-browse-index'));
            let cols = browseColumnsRef.current;
            if (!cols) {
                const cards = Array.from(grid.querySelectorAll<HTMLElement>('[data-tv-poster-btn="1"]'));
                cols = measureColumns(cards, true);
            }
            cols = Math.max(1, cols || estimateBrowseColumns(gridSizeRef.current));
            const absIndex = Number.isFinite(abs) ? abs : 0;
            const rowIndex = Math.floor(absIndex / cols);
            const movingDown = browseRowRef.current < 0 || rowIndex >= browseRowRef.current;
            browseRowRef.current = rowIndex;
            browseFocusAbsRef.current = absIndex;
            const loaded = itemsLengthRef.current;
            const nextLetter = browseLetterOf(itemsRef.current[absIndex]?.title);
            if (nextLetter && nextLetter !== scrollLetterRef.current) {
                scrollLetterRef.current = nextLetter;
                setScrollLetter(nextLetter);
            }
            maybeLoad(rowIndex, Math.ceil(loaded / cols), loaded, movingDown);
        };
        const grid = document.querySelector<HTMLElement>('[data-tv-browse-grid="1"]');
        scroller?.addEventListener('scroll', onScroll, { passive: true });
        scroller?.addEventListener('focusin', onFocus);
        grid?.addEventListener('focusin', onFocus);
        return () => {
            if (scrollRaf) window.cancelAnimationFrame(scrollRaf);
            scroller?.removeEventListener('scroll', onScroll);
            scroller?.removeEventListener('focusin', onFocus);
            grid?.removeEventListener('focusin', onFocus);
        };
    }, [active, browseHasMore, loadBrowse, tab]);

    useEffect(() => {
        if (tab !== 'browse') return undefined;
        const onFocusAbs = (event: Event) => {
            const targetAbs = Number((event as CustomEvent<{ absIndex: number }>).detail?.absIndex);
            if (!Number.isFinite(targetAbs) || targetAbs < 0) return;
            const cols = Math.max(1, browseColumnsRef.current || estimateBrowseColumns(gridSizeRef.current));
            const loaded = itemsLengthRef.current;
            // Next row is not loaded yet — fetch it and leave the current poster selected.
            if (targetAbs >= loaded) {
                if (browseHasMoreRef.current && !browseLoadingRef.current) {
                    void loadBrowse(browseCountRef.current, true);
                }
                return;
            }
            browseRowRef.current = Math.floor(targetAbs / cols);
            browseFocusAbsRef.current = targetAbs;
        };
        const onNeedMore = () => {
            if (!browseHasMoreRef.current || browseLoadingRef.current) return;
            void loadBrowse(browseCountRef.current, true);
        };
        const onNeedBefore = () => {
            if (browseLoadingRef.current || browseAbsStartRef.current <= 0) return;
            void loadBrowse(0, false, true);
        };
        window.addEventListener(BROWSE_FOCUS_ABS_EVENT, onFocusAbs);
        window.addEventListener('smp-browse-need-more', onNeedMore);
        window.addEventListener('smp-browse-need-before', onNeedBefore);
        return () => {
            window.removeEventListener(BROWSE_FOCUS_ABS_EVENT, onFocusAbs);
            window.removeEventListener('smp-browse-need-more', onNeedMore);
            window.removeEventListener('smp-browse-need-before', onNeedBefore);
        };
    }, [loadBrowse, tab]);

    const filtersKey = useRef('');
    const landedKey = useRef('');

    useEffect(() => {
        if (tab !== 'browse') return undefined;
        if (filtersKey.current === sectionKey) return undefined;
        filtersKey.current = sectionKey;
        let started = false;
        let cancelled = false;
        const handle = window.setTimeout(() => {
            started = true;
            fetchMediaPlayerLibraryFilters(sectionKey)
                .then((data) => {
                    if (cancelled) return;
                    setGenres(data.genres || []);
                    setDecades(data.decades || []);
                    setYears(data.years || []);
                    setContentRatings(data.contentRatings || []);
                    setResolutions(data.resolutions || []);
                    setStudios(data.studios || []);
                    setNetworks(data.networks || []);
                    setCountries(data.countries || []);
                    setCollectionOptions(data.collections || []);
                    setAudioLanguages(data.audioLanguages || []);
                    setSubtitleLanguages(data.subtitleLanguages || []);
                    setActors(data.actors || []);
                    setDirectors(data.directors || []);
                    setWriters(data.writers || []);
                    setProducers(data.producers || []);
                    setLabels(data.labels || []);
                    setLetters(data.letters || []);
                })
                .catch(() => {
                    if (cancelled) return;
                    filtersKey.current = '';
                    setGenres([]);
                    setDecades([]);
                    setYears([]);
                    setContentRatings([]);
                    setResolutions([]);
                    setStudios([]);
                    setNetworks([]);
                    setCountries([]);
                    setCollectionOptions([]);
                    setAudioLanguages([]);
                    setSubtitleLanguages([]);
                    setActors([]);
                    setDirectors([]);
                    setWriters([]);
                    setProducers([]);
                    setLabels([]);
                    setLetters([]);
                });
        }, 40);
        return () => {
            cancelled = true;
            window.clearTimeout(handle);
            if (!started && filtersKey.current === sectionKey) filtersKey.current = '';
        };
    }, [sectionKey, tab]);

    const posterReady = tab === 'home'
        ? homeHubs.some((hub) => hub.items?.length)
        : tab === 'collections'
            ? collections.length > 0
            : items.length > 0;

    useEffect(() => {
        if (!isTvShell() || !posterReady) return undefined;
        const token = `${sectionKey}:${tab}`;
        if (landedKey.current === token) return undefined;
        const handle = window.setTimeout(() => {
            landedKey.current = token;
            window.dispatchEvent(new Event('smp-tv-focus-posters'));
        }, 60);
        return () => window.clearTimeout(handle);
    }, [posterReady, sectionKey, tab]);

    useEffect(() => {
        const saved = readLibraryBrowseState(sectionKey);
        const cachedHome = readLibraryHomeCache(sectionKey);
        setHydrated(false);
        setSort(saved.sort);
        setGenre(saved.genre);
        setDecade(saved.decade);
        setYear(saved.year);
        setContentRating(saved.contentRating);
        setResolution(saved.resolution);
        setStudio(saved.studio);
        setNetwork(saved.network);
        setCountry(saved.country);
        setCollection(saved.collection);
        setAudioLanguage(saved.audioLanguage);
        setSubtitleLanguage(saved.subtitleLanguage);
        setActor(saved.actor);
        setDirector(saved.director);
        setWriter(saved.writer);
        setProducer(saved.producer);
        setLabel(saved.label);
        setUnwatched(saved.unwatched);
        setInProgress(saved.inProgress);
        setHdr(saved.hdr);
        setDuplicate(saved.duplicate);
        setLetter('');
        setLetters([]);
        filtersKey.current = '';
        if (cachedHome?.hubs?.length) {
            setTitle(cachedHome.title || t('mediaPlayerPage.libraries'));
            setHubs(cachedHome.hubs);
            setLoading(false);
        } else {
            setHubs([]);
            setCollections([]);
            setItems([]);
            // Avoid a blank Recommended frame before loadHome sets busy.
            setLoading(true);
        }
        setHydrated(true);
    }, [sectionKey, t]);

    useEffect(() => {
        if (!hydrated) return;
        writeLibraryBrowseState(sectionKey, {
            sort,
            genre,
            decade,
            year,
            contentRating,
            resolution,
            studio,
            network,
            country,
            collection,
            audioLanguage,
            subtitleLanguage,
            actor,
            director,
            writer,
            producer,
            label,
            unwatched,
            inProgress,
            hdr,
            duplicate,
        });
    }, [
        actor,
        audioLanguage,
        collection,
        contentRating,
        country,
        decade,
        director,
        duplicate,
        genre,
        hdr,
        hydrated,
        inProgress,
        label,
        network,
        producer,
        resolution,
        sectionKey,
        sort,
        studio,
        subtitleLanguage,
        unwatched,
        writer,
        year,
    ]);

    useEffect(() => {
        const onProgress = (event: Event) => {
            const detail = (event as CustomEvent<{ ratingKey?: string; dropContinue?: boolean; continueWith?: PlayerItem | null; advanceContinue?: boolean; restoreContinue?: PlayerItem | null; watched?: boolean }>).detail;
            const key = String(detail?.ratingKey || '');
            if (!key || detail?.dropContinue !== true) return;
            const paint = (row: PlayerItem) => (
                watchTargetTouches(row, key) ? applyRememberedProgress(row) : row
            );
            const drop = (list: PlayerItem[]) => {
                if (detail.watched === false) return restoreContinueSlot(list, key, detail.restoreContinue);
                return detail.advanceContinue
                    ? replaceFamilyContinueSlot(list, key, detail.continueWith)
                    : list.filter((row) => !watchTargetTouches(row, key));
            };
            setItems((prev) => (inProgress ? drop(prev) : prev.map(paint)));
            setHubs((prev) => {
                const next = prev.map((hub) => ({
                    ...hub,
                    items: isContinueWatchingHub(hub) ? drop(hub.items) : hub.items.map(paint),
                }));
                if (sectionKey && next.length) {
                    const cached = readLibraryHomeCache(sectionKey);
                    writeLibraryHomeCache(sectionKey, { ...(cached || {}), hubs: next });
                }
                return next;
            });
        };
        window.addEventListener(PLAYER_PROGRESS_EVENT, onProgress);
        return () => window.removeEventListener(PLAYER_PROGRESS_EVENT, onProgress);
    }, [inProgress, sectionKey]);

    const patchWatched = useCallback((ratingKey: string, watched: boolean) => {
        const mapItems = (list: PlayerItem[]) => list.map((row) => (
            row.ratingKey === ratingKey ? { ...row, watched } : row
        ));
        setItems((prev) => mapItems(prev));
        setCollections((prev) => mapItems(prev));
        setHubs((prev) => prev.map((hub) => ({ ...hub, items: mapItems(hub.items) })));
    }, []);

    const removeFromContinueWatching = useCallback((item: PlayerItem) => {
        const key = item.ratingKey;
        const filterItems = (list: PlayerItem[]) => list.filter((row) => row.ratingKey !== key);
        setHubs((prev) => prev.map((hub) => (
            isContinueWatchingHub(hub) ? { ...hub, items: filterItems(hub.items) } : hub
        )));
        setItems((prev) => filterItems(prev));
    }, []);

    const removeItemEverywhere = useCallback((item: PlayerItem) => {
        const key = item.ratingKey;
        const filterItems = (list: PlayerItem[]) => list.filter((row) => row.ratingKey !== key);
        setItems((prev) => filterItems(prev));
        setCollections((prev) => filterItems(prev));
        setHubs((prev) => prev.map((hub) => ({ ...hub, items: filterItems(hub.items) })));
        setTotal((prev) => Math.max(0, prev - 1));
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

    const menuProps = useMemo(() => ({
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

    const tabs: Array<{ id: LibraryTab; label: string }> = [
        { id: 'home', label: t('mediaPlayerPage.libraryHome') },
        { id: 'browse', label: t('mediaPlayerPage.browse') },
        { id: 'collections', label: t('mediaPlayerPage.collections') },
    ];

    const sortLabels: Record<string, string> = {
        'addedAt:desc': t('mediaPlayerPage.sortAdded'),
        titleSort: t('mediaPlayerPage.sortTitle'),
        'titleSort:desc': t('mediaPlayerPage.sortTitleDesc'),
        'year:desc': t('mediaPlayerPage.sortYear'),
        'originallyAvailableAt:desc': t('mediaPlayerPage.sortReleased'),
        'audienceRating:desc': t('mediaPlayerPage.sortRating'),
        'rating:desc': t('mediaPlayerPage.sortCriticRating'),
        'lastViewedAt:desc': t('mediaPlayerPage.sortLastPlayed'),
        'viewCount:desc': t('mediaPlayerPage.sortPlayCount'),
        'duration:desc': t('mediaPlayerPage.sortDuration'),
        'mediaHeight:desc': t('mediaPlayerPage.sortResolution'),
    };
    const tvShell = isTvShell();
    const filterSelectClass = 'player-library-filter-select min-w-[10rem] max-md:min-w-0 max-md:flex-1 max-md:basis-[calc(50%-0.25rem)]';
    const filterTriggerClass = 'rounded-full';
    const filterToggleClass = (on: boolean) => (
        `rounded-full border px-3 py-2 text-xs font-bold ${
            on ? 'border-plex/50 bg-plex/15 text-plex' : 'border-border bg-white/5 text-muted'
        }`
    );
    const tvFilterTrigger = (key: string) => (
        tvShell
            ? { 'data-tv-item': '1' as const, 'data-tv-action': '1' as const, 'data-tv-key': key, className: filterTriggerClass }
            : { className: filterTriggerClass }
    );

    const browseCols = Math.max(1, browseColumnsRef.current || estimateBrowseColumns(gridSize));
    const alphaLetters = letters.length ? letters : STATIC_ALPHA;
    const markedLetter = (scrollLetter || (letter
        ? (alphaLetters.find((row) => row.key === letter)?.title || letter)
        : '')).toUpperCase();
    useEffect(() => {
        if (tab !== 'browse' || !markedLetter) return;
        const bar = document.querySelector<HTMLElement>('[data-tv-alpha="1"]');
        const btn = bar?.querySelector<HTMLElement>('[aria-current="true"]');
        if (!bar || !btn) return;
        const top = btn.offsetTop - (bar.clientHeight - btn.offsetHeight) / 2;
        bar.scrollTop = Math.max(0, top);
    }, [markedLetter, tab, alphaLetters.length]);

    const libraryChrome = (
        <>
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <button
                        type="button"
                        tabIndex={tvShell ? -1 : undefined}
                        onClick={onBack}
                        className="player-page-back mb-2 inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-text"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        {t('mediaPlayerPage.back')}
                    </button>
                    <h1 className={`${discoveryTheme.heading} player-library-title`}>{title}</h1>
                </div>
                {tvShell ? null : <DiscoverGridSizeSelect value={gridSize} onChange={setGridSize} />}
            </div>

            <div
                className="flex flex-wrap gap-2"
                data-tv-library-tabs="1"
                data-tv-row="1"
                data-tv-rail="1"
            >
                {tabs.map((row) => {
                    const selected = tab === row.id;
                    return (
                        <button
                            key={row.id}
                            type="button"
                            data-tv-item="1"
                            data-tv-action="1"
                            data-tv-key={`library-tab-${row.id}`}
                            aria-current={selected ? 'page' : undefined}
                            onClick={() => onChangeTab(row.id)}
                            className={`player-library-tab-pill rounded-full border px-4 py-2 text-sm font-bold ${
                                selected
                                    ? 'border-plex/50 bg-plex/15 text-plex'
                                    : 'border-border bg-white/5 text-muted hover:text-text'
                            }`}
                        >
                            {row.label}
                        </button>
                    );
                })}
            </div>
        </>
    );

    if (tvShell && tab === 'home') {
        const homeBusy = loading && !tvRecommendedRows.length;
        return (
            <PlayerTvHubStage
                active={active}
                loading={homeBusy}
                rows={tvRecommendedRows}
                density={recommendedPosterDensity}
                resetKey={sectionKey}
                ariaLabel={title}
                header={<div className="player-library-stage-chrome">{libraryChrome}</div>}
                emptyTitle={error || t('mediaPlayerPage.emptyLibrary')}
                onEmptyRetry={() => {
                    setError(null);
                    void loadHome();
                }}
                onEmptyBack={onBack}
                onOpenItem={onOpenItem}
                onPlay={onPlay}
                onToggleWatched={toggleWatched}
                {...menuProps}
            />
        );
    }

    return (
        <div className="flex flex-col gap-5 pb-8" data-tv-library="1">
            {libraryChrome}

            {tab === 'browse' ? (
                <div className="flex flex-wrap items-center gap-2" data-tv-library-filters="1">
                    <CustomSelect
                        compact
                        value={sort}
                        onChange={(value) => {
                            setSort(value);
                            if (value !== 'titleSort') setLetter('');
                        }}
                        dropdownClassName="player-filter-menu"
                        className={`${filterSelectClass} min-w-[11rem]`}
                        triggerProps={tvFilterTrigger('library-sort')}
                        options={SORT_IDS.map((id) => ({ value: id, label: sortLabels[id] || id }))}
                    />
                    <CustomSelect
                        compact
                        value={genre}
                        onChange={setGenre}
                        dropdownClassName="player-filter-menu"
                        className={filterSelectClass}
                        triggerProps={tvFilterTrigger('library-genre')}
                        options={[
                            { value: '', label: t('mediaPlayerPage.allGenres') },
                            ...genres.map((row) => ({ value: row.key, label: row.title })),
                        ]}
                    />
                    {decades.length ? (
                        <CustomSelect
                            compact
                            value={decade}
                            onChange={(value) => {
                                setDecade(value);
                                if (value) setYear('');
                            }}
                            dropdownClassName="player-filter-menu"
                            className={filterSelectClass}
                            triggerProps={tvFilterTrigger('library-decade')}
                            options={[
                                { value: '', label: t('mediaPlayerPage.allDecades') },
                                ...decades.map((row) => ({ value: row.key, label: row.title })),
                            ]}
                        />
                    ) : null}
                    {years.length ? (
                        <CustomSelect
                            compact
                            value={year}
                            onChange={(value) => {
                                setYear(value);
                                if (value) setDecade('');
                            }}
                            dropdownClassName="player-filter-menu"
                            className={`${filterSelectClass} min-w-[9rem]`}
                            triggerProps={tvFilterTrigger('library-year')}
                            options={[
                                { value: '', label: t('mediaPlayerPage.allYears') },
                                ...years.map((row) => ({ value: row.key, label: row.title })),
                            ]}
                        />
                    ) : null}
                    {contentRatings.length ? (
                        <CustomSelect
                            compact
                            value={contentRating}
                            onChange={setContentRating}
                            dropdownClassName="player-filter-menu"
                            className={filterSelectClass}
                            triggerProps={tvFilterTrigger('library-content-rating')}
                            options={[
                                { value: '', label: t('mediaPlayerPage.allContentRatings') },
                                ...contentRatings.map((row) => ({ value: row.key, label: row.title })),
                            ]}
                        />
                    ) : null}
                    {resolutions.length ? (
                        <CustomSelect
                            compact
                            value={resolution}
                            onChange={setResolution}
                            dropdownClassName="player-filter-menu"
                            className={filterSelectClass}
                            triggerProps={tvFilterTrigger('library-resolution')}
                            options={[
                                { value: '', label: t('mediaPlayerPage.allResolutions') },
                                ...resolutions.map((row) => ({ value: row.key, label: row.title })),
                            ]}
                        />
                    ) : null}
                    {networks.length ? (
                        <CustomSelect
                            compact
                            value={network}
                            onChange={setNetwork}
                            dropdownClassName="player-filter-menu"
                            className={filterSelectClass}
                            triggerProps={tvFilterTrigger('library-network')}
                            options={[
                                { value: '', label: t('mediaPlayerPage.allNetworks') },
                                ...networks.map((row) => ({ value: row.key, label: row.title })),
                            ]}
                        />
                    ) : null}
                    {studios.length ? (
                        <CustomSelect
                            compact
                            value={studio}
                            onChange={setStudio}
                            dropdownClassName="player-filter-menu"
                            className={filterSelectClass}
                            triggerProps={tvFilterTrigger('library-studio')}
                            options={[
                                { value: '', label: t('mediaPlayerPage.allStudios') },
                                ...studios.map((row) => ({ value: row.key, label: row.title })),
                            ]}
                        />
                    ) : null}
                    {countries.length ? (
                        <CustomSelect
                            compact
                            value={country}
                            onChange={setCountry}
                            dropdownClassName="player-filter-menu"
                            className={filterSelectClass}
                            triggerProps={tvFilterTrigger('library-country')}
                            options={[
                                { value: '', label: t('mediaPlayerPage.allCountries') },
                                ...countries.map((row) => ({ value: row.key, label: row.title })),
                            ]}
                        />
                    ) : null}
                    {collectionOptions.length ? (
                        <CustomSelect
                            compact
                            value={collection}
                            onChange={setCollection}
                            dropdownClassName="player-filter-menu"
                            className={filterSelectClass}
                            triggerProps={tvFilterTrigger('library-collection')}
                            options={[
                                { value: '', label: t('mediaPlayerPage.allCollections') },
                                ...collectionOptions.map((row) => ({ value: row.key, label: row.title })),
                            ]}
                        />
                    ) : null}
                    {audioLanguages.length ? (
                        <CustomSelect
                            compact
                            value={audioLanguage}
                            onChange={setAudioLanguage}
                            dropdownClassName="player-filter-menu"
                            className={filterSelectClass}
                            triggerProps={tvFilterTrigger('library-audio-language')}
                            options={[
                                { value: '', label: t('mediaPlayerPage.allAudioLanguages') },
                                ...audioLanguages.map((row) => ({ value: row.key, label: row.title })),
                            ]}
                        />
                    ) : null}
                    {subtitleLanguages.length ? (
                        <CustomSelect
                            compact
                            value={subtitleLanguage}
                            onChange={setSubtitleLanguage}
                            dropdownClassName="player-filter-menu"
                            className={filterSelectClass}
                            triggerProps={tvFilterTrigger('library-subtitle-language')}
                            options={[
                                { value: '', label: t('mediaPlayerPage.allSubtitleLanguages') },
                                ...subtitleLanguages.map((row) => ({ value: row.key, label: row.title })),
                            ]}
                        />
                    ) : null}
                    {actors.length ? (
                        <CustomSelect
                            compact
                            value={actor}
                            onChange={setActor}
                            dropdownClassName="player-filter-menu"
                            className={filterSelectClass}
                            triggerProps={tvFilterTrigger('library-actor')}
                            options={[
                                { value: '', label: t('mediaPlayerPage.allActors') },
                                ...actors.map((row) => ({ value: row.key, label: row.title })),
                            ]}
                        />
                    ) : null}
                    {directors.length ? (
                        <CustomSelect
                            compact
                            value={director}
                            onChange={setDirector}
                            dropdownClassName="player-filter-menu"
                            className={filterSelectClass}
                            triggerProps={tvFilterTrigger('library-director')}
                            options={[
                                { value: '', label: t('mediaPlayerPage.allDirectors') },
                                ...directors.map((row) => ({ value: row.key, label: row.title })),
                            ]}
                        />
                    ) : null}
                    {writers.length ? (
                        <CustomSelect
                            compact
                            value={writer}
                            onChange={setWriter}
                            dropdownClassName="player-filter-menu"
                            className={filterSelectClass}
                            triggerProps={tvFilterTrigger('library-writer')}
                            options={[
                                { value: '', label: t('mediaPlayerPage.allWriters') },
                                ...writers.map((row) => ({ value: row.key, label: row.title })),
                            ]}
                        />
                    ) : null}
                    {producers.length ? (
                        <CustomSelect
                            compact
                            value={producer}
                            onChange={setProducer}
                            dropdownClassName="player-filter-menu"
                            className={filterSelectClass}
                            triggerProps={tvFilterTrigger('library-producer')}
                            options={[
                                { value: '', label: t('mediaPlayerPage.allProducers') },
                                ...producers.map((row) => ({ value: row.key, label: row.title })),
                            ]}
                        />
                    ) : null}
                    {labels.length ? (
                        <CustomSelect
                            compact
                            value={label}
                            onChange={setLabel}
                            dropdownClassName="player-filter-menu"
                            className={filterSelectClass}
                            triggerProps={tvFilterTrigger('library-label')}
                            options={[
                                { value: '', label: t('mediaPlayerPage.allLabels') },
                                ...labels.map((row) => ({ value: row.key, label: row.title })),
                            ]}
                        />
                    ) : null}
                    <button
                        type="button"
                        data-tv-item={tvShell ? '1' : undefined}
                        data-tv-action={tvShell ? '1' : undefined}
                        data-tv-key={tvShell ? 'library-unwatched' : undefined}
                        onClick={() => {
                            setUnwatched((prev) => !prev);
                            setInProgress(false);
                        }}
                        className={filterToggleClass(unwatched)}
                    >
                        {t('mediaPlayerPage.unwatched')}
                    </button>
                    <button
                        type="button"
                        data-tv-item={tvShell ? '1' : undefined}
                        data-tv-action={tvShell ? '1' : undefined}
                        data-tv-key={tvShell ? 'library-in-progress' : undefined}
                        onClick={() => {
                            setInProgress((prev) => !prev);
                            setUnwatched(false);
                        }}
                        className={filterToggleClass(inProgress)}
                    >
                        {t('mediaPlayerPage.inProgress')}
                    </button>
                    {!musicLibrary ? (
                        <>
                            <button
                                type="button"
                                data-tv-item={tvShell ? '1' : undefined}
                                data-tv-action={tvShell ? '1' : undefined}
                                data-tv-key={tvShell ? 'library-hdr' : undefined}
                                onClick={() => setHdr((prev) => !prev)}
                                className={filterToggleClass(hdr)}
                            >
                                {t('mediaPlayerPage.hdr')}
                            </button>
                            <button
                                type="button"
                                data-tv-item={tvShell ? '1' : undefined}
                                data-tv-action={tvShell ? '1' : undefined}
                                data-tv-key={tvShell ? 'library-duplicates' : undefined}
                                onClick={() => setDuplicate((prev) => !prev)}
                                className={filterToggleClass(duplicate)}
                            >
                                {t('mediaPlayerPage.duplicates')}
                            </button>
                        </>
                    ) : null}
                </div>
            ) : null}

            {loading && tab === 'home' && !homeHubs.length ? (
                <div className="flex min-h-[40vh] w-full flex-col items-center justify-center gap-3">
                    <Loader2 className="h-10 w-10 animate-spin text-white/70" aria-hidden />
                    <p className="text-sm font-semibold text-muted">{t('mediaPlayerPage.loading')}</p>
                </div>
            ) : loading && tab === 'collections' && !collections.length && !tvShell ? (
                <PosterGridSkeleton
                    className={upgraderPosterGridClass(gridSize)}
                    style={upgraderPosterGridStyle(gridSize)}
                />
            ) : error && tab !== 'browse' ? (
                tvShell ? (
                    <PlayerTvStatusPanel
                        title={error}
                        onRetry={() => {
                            setError(null);
                            if (tab === 'collections') void loadCollections();
                            else void loadBrowse(0, false);
                        }}
                        onBack={onBack}
                    />
                ) : (
                    <div className={discoveryTheme.emptyState}>
                        <p className={discoveryTheme.emptyTitle}>{error}</p>
                    </div>
                )
            ) : tab === 'home' ? (
                homeHubs.length ? (
                    <div className="tv-poster-rows player-home-rows flex flex-col gap-6">
                        {homeHubs.map((hub) => {
                            const isCw = isContinueWatchingHub(hub);
                            const hero = Boolean(hub.heroRow);
                            const recent = isRecentHub(hub);
                            return (
                            <PlayerRail
                                key={hub.identifier || hub.title}
                                title={hub.title}
                                rowId={`lib:${hub.identifier || hub.title}`}
                                items={isCw
                                    ? layoutContinueWatching(hub.items)
                                    : (hero ? hub.items.map(heroRowCardItem) : hub.items)}
                                density={recommendedPosterDensity}
                                onOpenItem={onOpenItem}
                                onPlay={onPlay}
                                onToggleWatched={toggleWatched}
                                showProgress={isCw}
                                showRemoveFromContinueWatching={isCw}
                                aspect={musicLibrary
                                    || classifyPlayerHomeHub(hub) === 'artist'
                                    || (hub.items?.length
                                        ? hub.items.every((row) => isMusicPlayerItem(row))
                                        : false)
                                    ? 'square'
                                    : (isCw
                                        ? continueWatchingAspect
                                        : (hero ? '16/9' : (recent ? '2/3' : undefined)))}
                                onViewAll={(hub.collectionRatingKey || hub.playlistRatingKey || hub.hubKey) && onOpenHub
                                    ? () => onOpenHub(hub)
                                    : undefined}
                                viewAllLabel={t('common.viewAll')}
                                {...menuProps}
                            />
                            );
                        })}
                    </div>
                ) : (
                    <div className={discoveryTheme.emptyState}>
                        <p className={discoveryTheme.emptyTitle}>{t('mediaPlayerPage.emptyLibrary')}</p>
                    </div>
                )
            ) : tab === 'collections' ? (
                collections.length ? (
                    <div
                        className={upgraderPosterGridClass(gridSize)}
                        style={upgraderPosterGridStyle(gridSize)}
                        data-tv-rail={tvShell ? '1' : undefined}
                        data-tv-poster-rail={tvShell ? '1' : undefined}
                    >
                        {collections.map((item, index) => (
                            <PlayerPosterCard
                                key={item.ratingKey}
                                item={item}
                                aspect={musicLibrary ? 'square' : undefined}
                                imagePriority={index < 12}
                                onOpenItem={() => onOpenCollection(sectionKey, item)}
                            />
                        ))}
                    </div>
                ) : (
                    <div className={discoveryTheme.emptyState}>
                        <p className={discoveryTheme.emptyTitle}>{t('mediaPlayerPage.emptyCollections')}</p>
                    </div>
                )
            ) : (
                <div data-tv-browse-layout="1">
                    {sort === 'titleSort' ? (
                        <div data-tv-alpha-track="1">
                            <div data-tv-alpha="1" role="listbox" aria-label={t('mediaPlayerPage.alphaJump')}>
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={!letter}
                                    data-tv-item={tvShell ? '1' : undefined}
                                    data-tv-alpha-btn={tvShell ? '1' : undefined}
                                    data-tv-key={tvShell ? 'alpha-all' : undefined}
                                    onClick={() => setLetter('')}
                                >
                                    {t('mediaPlayerPage.alphaAll')}
                                </button>
                                {alphaLetters.map((row) => {
                                    const current = row.title.toUpperCase() === markedLetter || (!!letter && row.key === letter);
                                    return (
                                        <button
                                            key={row.key}
                                            type="button"
                                            role="option"
                                            aria-selected={letter === row.key}
                                            aria-current={current ? 'true' : undefined}
                                            data-tv-item={tvShell ? '1' : undefined}
                                            data-tv-alpha-btn={tvShell ? '1' : undefined}
                                            data-tv-key={tvShell ? `alpha-${row.key}` : undefined}
                                            onClick={() => setLetter(letter === row.key ? '' : row.key)}
                                        >
                                            {row.title}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ) : null}
                    <div data-tv-browse-main="1">
                        {loading && !tvShell ? (
                            <PosterGridSkeleton
                                className={upgraderPosterGridClass(gridSize)}
                                style={upgraderPosterGridStyle(gridSize)}
                            />
                        ) : loading ? null : error ? (
                            tvShell ? (
                                <PlayerTvStatusPanel
                                    title={error}
                                    onRetry={() => {
                                        setError(null);
                                        void loadBrowse(0, false);
                                    }}
                                    onBack={onBack}
                                />
                            ) : (
                                <div className={discoveryTheme.emptyState}>
                                    <p className={discoveryTheme.emptyTitle}>{error}</p>
                                </div>
                            )
                        ) : !items.length ? (
                            <div className={discoveryTheme.emptyState}>
                                <p className={discoveryTheme.emptyTitle}>{t('mediaPlayerPage.emptyLibrary')}</p>
                            </div>
                        ) : (
                            <>
                                <div
                                    className={upgraderPosterGridClass(gridSize)}
                                    style={upgraderPosterGridStyle(gridSize)}
                                    data-tv-browse-grid="1"
                                    data-browse-abs-start={browseAbsStart}
                                    data-tv-rail={tvShell ? '1' : undefined}
                                >
                                    {items.map((item, index) => {
                                        const eagerCount = Math.max(1, browseCols * 2);
                                        return (
                                            <PlayerPosterCard
                                                key={item.ratingKey}
                                                item={item}
                                                browseIndex={index}
                                                aspect={musicLibrary ? 'square' : undefined}
                                                imagePriority={index < eagerCount}
                                                loading={index < eagerCount ? 'eager' : 'lazy'}
                                                onOpenItem={onOpenItem}
                                                onPlay={onPlay}
                                                onToggleWatched={toggleWatched}
                                                {...menuProps}
                                            />
                                        );
                                    })}
                                </div>
                                {browseHasMore ? (
                                    <div ref={browseSentinelRef} className="flex min-h-16 w-full items-center justify-center py-4">
                                        {loadingMore ? (
                                            <p className="text-sm font-bold text-muted">{t('common.loadingMore')}</p>
                                        ) : null}
                                    </div>
                                ) : null}
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
